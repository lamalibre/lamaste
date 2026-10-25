/**
 * Lifecycle pipelines of a hosted agent-hosted plugin — the onion around
 * each of Lamaste's own steps:
 *
 *     relay pre-X  →  agent pre-X  →  [ Lamaste: X ]  →  agent post-X  →  relay post-X
 *
 * Relay hooks run in the plugin's sandboxed runner (`relay-hooks.js`).
 * Agent hooks are calls to the agent half's `POST /admin/hooks/<stage>`:
 * through the internal tunnel while it exists, otherwise by the agent's own
 * sync on its loopback (an agent job). So that the agent can sign those
 * calls, the installation secret is delivered before the tunnel is granted
 * and revoked only after it is removed (the hosting's `installing` and
 * `removing` phases).
 *
 * Install: a failing *pre* stage stops the pipeline — nothing after it ran,
 * and what Lamaste had prepared is undone without hooks. A failing *post*
 * stage (or a failure of Lamaste's own step after the agent's pre stage)
 * rolls back: the uninstall pipeline runs with `phase: "rollback"` for the
 * sides that had taken part. Uninstall: a failing pre-teardown stage stops
 * it unless forced; post-teardown failures are reported and the uninstall
 * completes. Upgrade: the pipeline runs around replacing the relay package;
 * a failure restores the previous package and hook module.
 *
 * An agent half Lamaste installs (slice 3: `agent.package`, pinned when the
 * version was staged) is installed, switched and removed by the agent's
 * root helper through app jobs (`agent-jobs.js`):
 *
 *     install    relay pre → reserve → install the agent half → agent pre (job)
 *                → grant → wait for the agent half → agent post → relay post
 *     uninstall  … → agent post-teardown → remove the agent half → revoke → relay post
 *     upgrade    relay pre → agent pre → install the new agent half → the relay
 *                package → agent post → relay post
 *
 * Once an install job is dispatched the agent may act on it, whatever it
 * reports: a rollback then removes the agent half (data kept, and recorded
 * so it can be purged later — `retained-data.js`), and a failed upgrade
 * activates the version that ran before. The agent's helper runs only app
 * jobs the relay signed, so these recoveries are the relay's to start — the
 * agent never undoes an install on its own. Every hosting record names the
 * plugin that owns it; a teardown acts only on the plugin's own.
 *
 * Hook outputs are passed forward in `outputs` (`relay:install:pre-tunnel`, …).
 * Relay stages see the plugin's effective non-secret settings (the relay's
 * cache, `plugin-settings.js`); agent stages see none — the agent half holds
 * them. The cache goes once the hosting it describes is removed.
 */

import {
  AGENT_LABEL_REGEX,
  PLUGIN_AGENT_CN_PREFIX,
  agentHookSetOf,
  derivePluginRoute,
  pluginHostCapability,
} from '@lamalibre/lamaste';
import {
  TUNNEL_MAX_BODY_MB,
  TunnelError,
  PluginHostingError,
  callAgentHalfHook,
  createPluginHosting,
  createTunnel,
  deleteTunnel,
  getPluginHosting,
  pluginHostingOwner,
  pluginHostingPhase,
  probePluginHosting,
  removePluginHosting,
  setPluginHostingAgentHalf,
  setPluginHostingPhase,
  signingSecretFor,
  toggleTunnel,
} from '@lamalibre/lamaste/server';
import { StageFailure } from './plugin-operations.js';
import {
  AppJobSigningError,
  createAgentJob,
  createAppJob,
  cancelAgentJobs,
  waitForAgentJob,
} from './agent-jobs.js';
import { installedAgentHalf, installedRelayHooks } from './plugin-hooks.js';
import { forgetRetainedData, recordRetainedData } from './retained-data.js';
import { runRelayHook } from './relay-hooks.js';
import { recordAuditBestEffort } from './audit.js';
import { deleteSettingsCache, relayHookSettings } from './plugin-settings.js';
import { forgetIdentityHalf } from './identity-sync.js';
import { refreshUserSurfaceVhosts } from './user-surface.js';
import {
  tunnelNginxDeps,
  tunnelCertbotDeps,
  tunnelChiselDeps,
  tunnelStateDeps,
} from './tunnel-deps.js';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';

/** How long Lamaste waits for the agent half to answer through a newly granted tunnel. */
export const TUNNEL_READY_TIMEOUT_MS =
  Number(process.env.LAMALIBRE_LAMASTE_TUNNEL_READY_MS) || 150_000;
const TUNNEL_READY_POLL_MS = 3_000;

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/**
 * The pipeline-wide context: who, what, and the outputs so far. `settings`
 * is the plugin's effective non-secret settings for a relay stage, `{}` for
 * an agent stage.
 */
function lifecycleInput(ctx, phase, settings = {}) {
  return {
    plugin: ctx.plugin.name,
    version: ctx.version ?? ctx.plugin.version,
    ...(ctx.previousVersion ? { previousVersion: ctx.previousVersion } : {}),
    phase,
    agent: { label: ctx.agentLabel },
    settings,
    outputs: { ...ctx.outputs },
    ...(ctx.port ? { port: ctx.port } : {}),
  };
}

function relayStageDecl(ctx, stage) {
  return ctx.relay?.set.stages.find((s) => s.stage === stage) ?? null;
}

function agentStageDecl(ctx, stage) {
  return ctx.agentHooks?.stages.find((s) => s.stage === stage) ?? null;
}

/**
 * Run a relay lifecycle stage when the plugin declares it. Returns false
 * when there was nothing to run; throws {@link StageFailure} when the hook
 * failed or refused.
 */
async function relayStage(op, ctx, stage, phase) {
  const decl = relayStageDecl(ctx, stage);
  if (!decl) return false;
  await op.step(`relay ${stage}`, async () => {
    const result = await runRelayHook({
      plugin: ctx.plugin.name,
      stage,
      call: { kind: 'app' },
      input: lifecycleInput(ctx, phase, await relayHookSettings(ctx.plugin)),
      timeoutMs: decl.timeoutMs,
      effects: ctx.relay.set.effects,
      logger: ctx.logger,
    });
    if (!result.ok) {
      throw new StageFailure(
        `relay ${stage} failed (${result.kind})${result.message ? `: ${result.message}` : ''}`,
      );
    }
    if (!result.decision.ok) {
      throw new StageFailure(`relay ${stage} refused: ${result.decision.reason}`);
    }
    if (result.decision.output !== undefined) {
      ctx.outputs[`relay:${stage}`] = result.decision.output;
    }
  });
  return true;
}

/**
 * Run an agent lifecycle stage when the agent half declares it — through the
 * tunnel (`via: 'tunnel'`) or by the agent's sync on its loopback (`via: 'job'`).
 */
async function agentStage(op, ctx, stage, phase, via) {
  const decl = agentStageDecl(ctx, stage);
  if (!decl) return false;
  await op.step(`agent ${stage}`, async () => {
    const input = lifecycleInput(ctx, phase);
    let result;
    if (via === 'tunnel') {
      const record = await ownHostingRecord(ctx);
      if (!record) throw new StageFailure(`agent ${stage}: the plugin is not hosted`);
      result = await callAgentHalfHook({
        plugin: ctx.route,
        port: record.port,
        secret: signingSecretFor(record),
        stage,
        input,
        timeoutMs: decl.timeoutMs,
      });
    } else {
      const jobId = await createAgentJob({
        agentLabel: ctx.agentLabel,
        plugin: ctx.route,
        stage,
        input,
        timeoutMs: decl.timeoutMs,
      });
      result = await waitForAgentJob(jobId);
    }
    if (!result.ok) throw new StageFailure(`agent ${stage} failed: ${result.error}`);
    const { decision } = result;
    if (!decision.ok) throw new StageFailure(`agent ${stage} refused: ${decision.reason}`);
    if (decision.output !== undefined) ctx.outputs[`agent:${stage}`] = decision.output;
  });
  return true;
}

/** {@link relayStage}, recording the stage as skipped when the plugin does not declare it. */
async function relayStageOrSkip(op, ctx, stage, phase) {
  const ran = await relayStage(op, ctx, stage, phase);
  if (!ran) op.skip(`relay ${stage}`, 'not declared');
  return ran;
}

/** {@link agentStage}, recording the stage as skipped when the agent half does not declare it. */
async function agentStageOrSkip(op, ctx, stage, phase, via) {
  const ran = await agentStage(op, ctx, stage, phase, via);
  if (!ran) op.skip(`agent ${stage}`, 'not declared');
  return ran;
}

// ---------------------------------------------------------------------------
// Lamaste's own steps
// ---------------------------------------------------------------------------

/**
 * The internal tunnel's workflow: the core tunnel functions wired to the
 * daemon's nginx, certbot, chisel and state, and the wait until the agent
 * half answers through the tunnel. Replaced in tests, which have no chisel
 * to grant through. Each throws TunnelError as the core does.
 */
const coreTunnelOps = Object.freeze({
  /** Create the plugin's internal tunnel, disabled (the port is held, chisel grants nothing). */
  async create(ctx) {
    const { isActiveAgent } = await import('./plugin-hosting.js');
    return createTunnel({
      exposure: 'internal',
      type: 'plugin',
      pluginName: ctx.plugin.packageName,
      agentLabel: ctx.agentLabel,
      description: `Internal tunnel of plugin ${ctx.plugin.name}`,
      maxBodySizeMb: TUNNEL_MAX_BODY_MB.default,
      enabled: false,
      domain: ctx.domain,
      email: ctx.email,
      nginx: tunnelNginxDeps,
      certbot: tunnelCertbotDeps,
      chisel: tunnelChiselDeps,
      state: tunnelStateDeps,
      agents: { isActiveAgent },
      logger: ctx.logger,
    });
  },
  /** Grant the tunnel (chisel). */
  async enable(ctx) {
    await toggleTunnel({
      id: ctx.tunnelId,
      enabled: true,
      nginx: tunnelNginxDeps,
      chisel: tunnelChiselDeps,
      state: tunnelStateDeps,
      logger: ctx.logger,
    });
  },
  async remove(ctx) {
    await deleteTunnel({
      id: ctx.tunnelId,
      nginx: tunnelNginxDeps,
      chisel: tunnelChiselDeps,
      state: tunnelStateDeps,
      logger: ctx.logger,
    });
  },
  /** Resolve once the agent half answers `/admin/health` through the tunnel of `record`. */
  async waitForAgentHalf(record) {
    const deadline = Date.now() + TUNNEL_READY_TIMEOUT_MS;
    let last = 'no probe yet';
    while (Date.now() < deadline) {
      const probe = await probePluginHosting({
        plugin: record.plugin,
        port: record.port,
        secret: signingSecretFor(record),
      });
      if (probe.ok) return;
      last = `${probe.reason}: ${probe.error}`;
      await new Promise((r) => setTimeout(r, TUNNEL_READY_POLL_MS));
    }
    throw new StageFailure(
      `The agent half did not answer through the tunnel within ${Math.round(TUNNEL_READY_TIMEOUT_MS / 1000)} s (${last})`,
    );
  },
});

let tunnelOps = coreTunnelOps;

/** Replace the internal tunnel's workflow (tests); null restores the real one. */
export function setTunnelOpsForTests(ops) {
  tunnelOps = ops ? { ...coreTunnelOps, ...ops } : coreTunnelOps;
}

/** Add or remove one capability on an agent's record (registry lock inside). */
async function setHostCapability(ctx, present) {
  const { setAgentCapability } = await import('./plugin-hosting.js');
  try {
    await setAgentCapability(ctx.agentLabel, pluginHostCapability(ctx.route), present);
  } catch (err) {
    // A revoked agent has no record to edit; the capability went with it.
    if (present || err.statusCode !== 400) throw err;
  }
}

/**
 * Reserve: the internal tunnel without its chisel grant (the port is held),
 * the hosting record with its secret (`installing`), and the host capability
 * — enough for the agent to fetch its config and for its agent half to
 * answer hook calls on its loopback. Undone in reverse on failure.
 */
async function reserveHosting(ctx) {
  let tunnel;
  try {
    tunnel = await tunnelOps.create(ctx);
  } catch (err) {
    if (err instanceof TunnelError) throw new StageFailure(err.message);
    throw err;
  }
  ctx.tunnelId = tunnel.id;
  ctx.port = tunnel.port;
  try {
    await createPluginHosting(STATE_DIR, {
      plugin: ctx.route,
      pluginName: ctx.plugin.name,
      agentLabel: ctx.agentLabel,
      port: tunnel.port,
      tunnelId: tunnel.id,
      phase: 'installing',
    });
  } catch (err) {
    await removeTunnel(ctx);
    if (err instanceof PluginHostingError) throw new StageFailure(err.message);
    throw err;
  }
  try {
    await setHostCapability(ctx, true);
  } catch (err) {
    await removePluginHosting(STATE_DIR, ctx.route).catch(() => undefined);
    await removeTunnel(ctx);
    throw err;
  }
  ctx.reserved = true;
}

async function removeTunnel(ctx) {
  if (!ctx.tunnelId) return;
  try {
    await tunnelOps.remove(ctx);
  } catch (err) {
    if (!(err instanceof TunnelError && err.code === 'NOT_FOUND')) throw err;
  }
  ctx.tunnelGranted = false;
}

/**
 * The hosting of the pipeline's plugin, or null. A record on its route that
 * names another plugin as its owner is refused — a pipeline never acts on
 * another plugin's hosting.
 */
async function ownHostingRecord(ctx) {
  const record = await getPluginHosting(STATE_DIR, ctx.route);
  if (record && pluginHostingOwner(record) !== ctx.plugin.name) {
    throw new StageFailure(
      `The hosting on route "${ctx.route}" belongs to plugin "${pluginHostingOwner(record)}", not "${ctx.plugin.name}"`,
    );
  }
  return record;
}

/** Wait until the agent half answers through the tunnel. */
async function waitForAgentHalf(ctx) {
  const record = await ownHostingRecord(ctx);
  if (!record) throw new StageFailure('The plugin is no longer hosted');
  await tunnelOps.waitForAgentHalf(record);
}

/** Grant the tunnel (chisel), then wait until the agent half answers through it. */
async function grantTunnel(ctx) {
  try {
    await tunnelOps.enable(ctx);
  } catch (err) {
    if (err instanceof TunnelError) throw new StageFailure(err.message);
    throw err;
  }
  ctx.tunnelGranted = true;
  await waitForAgentHalf(ctx);
}

/** Revoke the secret and the capability (the record goes). */
async function releaseHosting(ctx) {
  await setHostCapability(ctx, false);
  await removePluginHosting(STATE_DIR, ctx.route);
  ctx.reserved = false;
}

// ---------------------------------------------------------------------------
// The agent half Lamaste installs (app jobs through the agent's root helper)
// ---------------------------------------------------------------------------

/**
 * Dispatch one app job for the plugin to its hosting agent and wait for its
 * result. `onDispatched` runs once the job exists — from then on the agent
 * may act on it, whatever it reports later. A job the relay cannot sign
 * (its signing key is unusable) is never created: the step fails.
 */
async function runAppJob(ctx, kind, params, onDispatched) {
  let id;
  try {
    id = await createAppJob({ agentLabel: ctx.agentLabel, plugin: ctx.route, kind, ...params });
  } catch (err) {
    if (err instanceof AppJobSigningError) throw new StageFailure(err.message);
    throw err;
  }
  onDispatched?.();
  return waitForAgentJob(id);
}

/** Record on the hosting which version of the agent half the agent runs (null: none). */
async function recordAgentHalf(ctx, pkg, version) {
  await setPluginHostingAgentHalf(
    STATE_DIR,
    ctx.route,
    version === null ? null : { package: pkg, version, installedAt: new Date().toISOString() },
  );
}

/**
 * Have the hosting agent install the pinned agent half (`ctx.agentHalf`)
 * and start it; for an upgrade the helper switches `current` to it. Sets
 * `ctx.appInstall` to what may now be on the agent: `dispatched` as soon as
 * the job exists — the agent may act on it whatever it reports, so what
 * undoes the install runs in any case (removing is idempotent) — then
 * `failed` when the helper reported a failure, `installed` when it
 * reported the install. The install is audited only once the reported
 * version and unit state are verified.
 */
async function installAgentHalf(op, ctx, phase) {
  const spec = ctx.agentHalf;
  const result = await runAppJob(ctx, 'app-install', { spec }, () => {
    ctx.appInstall = 'dispatched';
  });
  if (!result.ok) {
    if (!result.expired) ctx.appInstall = 'failed';
    throw new StageFailure(`Installing the agent half failed: ${result.error}`);
  }
  ctx.appInstall = 'installed';
  const { version, unit } = result.app;
  if (version !== null) await recordAgentHalf(ctx, spec.package, version);
  // Data this agent kept of the same agent package is the installed half's again.
  const retained = await forgetRetainedData(ctx.agentLabel, ctx.route);
  if (version !== spec.version) {
    throw new StageFailure(
      `The agent reports version ${version ?? 'none'} of the agent half after installing ${spec.version}`,
    );
  }
  if (unit !== 'active') {
    throw new StageFailure(
      `The agent half ${spec.version} is installed, but its service is ${unit}`,
    );
  }
  await recordAuditBestEffort(
    {
      actor: op.actor ?? 'admin',
      action: 'plugin.agent-half.installed',
      plugin: ctx.plugin.name,
      details: {
        agentLabel: ctx.agentLabel,
        package: spec.package,
        version: spec.version,
        integrity: spec.integrity,
        ...(retained > 0 ? { retainedDataReused: true } : {}),
        phase,
        operation: op.id,
      },
    },
    ctx.logger,
  );
}

/** The `app-remove` result must say the agent half is gone: no version, no unit. */
function assertRemoved(result, what) {
  if (!result.ok) throw new StageFailure(`${what} failed: ${result.error}`);
  const { version, unit } = result.app;
  if (version !== null || unit !== 'absent') {
    throw new StageFailure(
      `The agent still reports the agent half after removing it (version ${version ?? 'none'}, service ${unit})`,
    );
  }
}

/**
 * Have the hosting agent remove the agent half: unit, code and config;
 * with `purge` its data directory and service account too. Without purge
 * they stay on the agent, and the relay keeps a record of them
 * (`retained-data.js`) so they can be purged later — the plugin's removal
 * included. After an install the helper reported as failed nothing new is
 * recorded: the helper undoes its own failed work, and data that was there
 * before it is not this package's to claim (a record of it, if any, stays).
 * An install that never reported is recorded: the helper creates the data
 * directory early, and losing track of data that is there would be worse
 * than a record of data that is not (purging it is harmless).
 */
async function removeAgentHalf(op, ctx, phase, purge) {
  const record = await ownHostingRecord(ctx);
  const pkg = record?.agentHalf?.package ?? ctx.agentHalf?.package ?? null;
  if (pkg === null) {
    // The signed job names the package, so the helper never removes or
    // purges an agent half another package owns.
    throw new StageFailure(
      "The agent half's package is not known, so its removal cannot be signed",
    );
  }
  const helperFailed = ctx.appInstall === 'failed';
  const result = await runAppJob(ctx, 'app-remove', { purge, package: pkg });
  assertRemoved(result, 'Removing the agent half');
  ctx.appInstall = null;
  await recordAgentHalf(ctx, null, null);
  if (purge) {
    await forgetRetainedData(ctx.agentLabel, ctx.route);
  } else if (helperFailed) {
    // Nothing of this install's to keep a record of.
  } else {
    await recordRetainedData({
      agentLabel: ctx.agentLabel,
      route: ctx.route,
      plugin: ctx.plugin.name,
      package: pkg,
      operation: op.id,
    });
  }
  await recordAuditBestEffort(
    {
      actor: op.actor ?? 'admin',
      action: 'plugin.agent-half.removed',
      plugin: ctx.plugin.name,
      details: {
        agentLabel: ctx.agentLabel,
        version: record?.agentHalf?.version ?? null,
        purge,
        phase,
        operation: op.id,
      },
    },
    ctx.logger,
  );
}

/** A failed upgrade: point the agent half back at the version that ran before it. */
async function activatePreviousAgentHalf(op, ctx) {
  const previous = ctx.previousAgentHalfVersion;
  if (!previous) throw new StageFailure('No earlier version of the agent half is known');
  const pkg = ctx.previousAgentHalfPackage ?? ctx.agentHalf.package;
  const result = await runAppJob(ctx, 'app-activate', { version: previous, package: pkg });
  if (!result.ok) {
    throw new StageFailure(`Activating agent half ${previous} failed: ${result.error}`);
  }
  const { version, unit } = result.app;
  if (version !== null) await recordAgentHalf(ctx, pkg, version);
  if (version !== previous) {
    throw new StageFailure(
      `The agent reports version ${version ?? 'none'} of the agent half after activating ${previous}`,
    );
  }
  if (unit !== 'active') {
    throw new StageFailure(
      `The agent half ${previous} is active again, but its service is ${unit}`,
    );
  }
  await recordAuditBestEffort(
    {
      actor: op.actor ?? 'admin',
      action: 'plugin.agent-half.activated',
      plugin: ctx.plugin.name,
      details: {
        agentLabel: ctx.agentLabel,
        version: previous,
        from: ctx.agentHalf?.version ?? null,
        operation: op.id,
      },
    },
    ctx.logger,
  );
}

/**
 * Remove the agent half as part of a teardown — when Lamaste installed it
 * there, or may have (an install job was dispatched). An agent that is no
 * longer enrolled cannot be reached: the step is skipped and the operator
 * told how to remove it on the machine.
 */
async function teardownAgentHalf(op, ctx, phase) {
  const { isActiveAgent } = await import('./plugin-hosting.js');
  if (!(await isActiveAgent(ctx.agentLabel))) {
    op.skip('remove the agent half', 'the agent is no longer enrolled');
    op.warn(
      `The agent half stays on agent "${ctx.agentLabel}" — remove it there: sudo lamaste-agent apphost remove ${ctx.route}${ctx.purge ? ' --purge' : ''}`,
    );
    return;
  }
  const purge = phase === 'rollback' ? false : ctx.purge;
  await op.step('remove the agent half', () => removeAgentHalf(op, ctx, phase, purge));
}

/**
 * Purge the data agent `retained.agentLabel` kept of an agent half removed
 * without purge: an `app-remove` job with purge (the unit and code are gone
 * already; the helper removes the data directory and the service account),
 * then the record goes. The plugin may be uninstalled by now.
 *
 * @param {import('./plugin-operations.js').OperationContext} op
 * @param {{ retained: { agentLabel: string, route: string, plugin: string, package: string }, logger?: import('pino').Logger }} input
 */
export async function runPurgeRetainedData(op, { retained, logger }) {
  const ctx = { agentLabel: retained.agentLabel, route: retained.route };
  await op.step('purge the retained data', async () => {
    const result = await runAppJob(ctx, 'app-remove', {
      purge: true,
      package: retained.package,
    });
    assertRemoved(result, 'Purging the retained data');
    await forgetRetainedData(retained.agentLabel, retained.route);
    // The last data of an uninstalled plugin: its identity ledger goes too.
    const { dropIdentityLedgerIfNoData } = await import('./audience.js');
    await dropIdentityLedgerIfNoData(retained.plugin, logger);
  });
  await recordAuditBestEffort(
    {
      actor: op.actor ?? 'admin',
      action: 'plugin.agent-half.purged',
      plugin: retained.plugin,
      details: {
        agentLabel: retained.agentLabel,
        route: retained.route,
        package: retained.package,
        operation: op.id,
      },
    },
    logger,
  );
  return { status: 'succeeded' };
}

/**
 * The context every pipeline works from. `agentHalf` is the pinned agent
 * half Lamaste installs (null: none, or installed by hand); `purge`
 * (uninstall) removes its data and service account with it.
 */
export function pipelineContext({ plugin, agentLabel, domain, email, logger, purge = false }) {
  return {
    plugin,
    route: plugin.route ?? derivePluginRoute(plugin.name),
    agentLabel,
    domain,
    email,
    logger,
    relay: installedRelayHooks(plugin),
    agentHooks: agentHookSetOf({ hooks: plugin.hooks }),
    agentHalf: installedAgentHalf(plugin),
    purge,
    outputs: {},
    touched: { relay: false, agent: false },
    reserved: false,
    tunnelGranted: false,
    tunnelId: null,
    port: null,
    /**
     * What this pipeline may have left of the agent half on the agent: null
     * (nothing), `dispatched` (an install job exists and the agent has not
     * answered — it may have acted on it), `failed` (the helper reported a
     * failure; it may still have left something) or `installed`.
     */
    appInstall: null,
    /** The version (and package) the agent ran before an upgrade switched it. */
    previousAgentHalfVersion: null,
    previousAgentHalfPackage: null,
  };
}

/** Host the plugin on its agent: the install pipeline. */
export async function runInstallPipeline(op, ctx) {
  if (
    !AGENT_LABEL_REGEX.test(ctx.agentLabel) ||
    ctx.agentLabel.startsWith(PLUGIN_AGENT_CN_PREFIX)
  ) {
    throw new StageFailure('agentLabel must name an enrolled machine agent');
  }
  // relay pre: nothing exists yet; a failure leaves nothing.
  if (await relayStageOrSkip(op, ctx, 'install:pre-tunnel', 'install')) ctx.touched.relay = true;

  try {
    await op.step('reserve port, secret and capability', () => reserveHosting(ctx));
  } catch (err) {
    if (ctx.touched.relay) await rollback(op, ctx, err);
    throw err;
  }

  if (ctx.agentHalf) {
    try {
      // The agent fetches the package, checks it against the pinned
      // integrity and has its root helper install and start it — with the
      // secret reserved above, so the agent half can answer the agent's
      // hook calls next.
      await op.step('install the agent half', () => installAgentHalf(op, ctx, 'install'));
    } catch (err) {
      await rollback(op, ctx, err);
      throw err;
    }
  }

  try {
    // agent pre: on its loopback, before the tunnel exists.
    if (await agentStageOrSkip(op, ctx, 'install:pre-tunnel', 'install', 'job')) {
      ctx.touched.agent = true;
    }
  } catch (err) {
    // A failing pre stage: what Lamaste prepared goes, the relay side's
    // pre stage (if it ran) is rolled back. The agent's own stage failed and
    // cleans up after itself.
    await rollback(op, ctx, err);
    throw err;
  }

  try {
    await op.step('grant the tunnel and wait for the agent half', () => grantTunnel(ctx));
    if (await agentStageOrSkip(op, ctx, 'install:post-tunnel', 'install', 'tunnel')) {
      ctx.touched.agent = true;
    }
    if (await relayStageOrSkip(op, ctx, 'install:post-tunnel', 'install')) {
      ctx.touched.relay = true;
    }
    await op.step('activate', async () => {
      await setPluginHostingPhase(STATE_DIR, ctx.route, 'active');
    });
  } catch (err) {
    await rollback(op, ctx, err);
    return { status: 'rolled-back', error: String(err.message).slice(0, 500) };
  }
  await recordAuditBestEffort(
    {
      actor: op.actor ?? 'admin',
      action: 'plugin.hosted',
      plugin: ctx.plugin.name,
      details: { agentLabel: ctx.agentLabel, port: ctx.port, operation: op.id },
    },
    ctx.logger,
  );
  return { status: 'succeeded' };
}

/**
 * Roll an unfinished install back: the uninstall pipeline with
 * `phase: "rollback"` for the sides that took part, then Lamaste's own
 * steps in reverse. Never throws; what fails is reported as a warning.
 */
async function rollback(op, ctx, cause) {
  op.warn(`Rolling back: ${String(cause?.message ?? cause).slice(0, 300)}`);
  await cancelAgentJobs(ctx.route).catch(() => undefined);
  await runTeardown(op, ctx, { phase: 'rollback', force: true });
}

/**
 * The teardown both uninstall and rollback run. With `force`, a failing
 * pre-teardown stage is reported and the teardown goes on.
 */
async function runTeardown(op, ctx, { phase, force }) {
  const warnOnFailure = async (fn) => {
    try {
      await fn();
    } catch (err) {
      op.warn(String(err.message ?? err));
    }
  };
  // Without `force`, a failing step stops the teardown.
  const soft = force ? warnOnFailure : (fn) => fn();
  const relaySide = phase !== 'rollback' || ctx.touched.relay;
  const agentSide = phase !== 'rollback' || ctx.touched.agent;

  if (relaySide) await soft(() => relayStage(op, ctx, 'uninstall:pre-teardown', phase));
  if (agentSide && ctx.reserved) {
    await soft(() =>
      agentStage(op, ctx, 'uninstall:pre-teardown', phase, ctx.tunnelGranted ? 'tunnel' : 'job'),
    );
  }

  if (ctx.reserved || ctx.tunnelId) {
    await soft(() =>
      op.step('remove the tunnel', async () => {
        if (ctx.reserved) await setPluginHostingPhase(STATE_DIR, ctx.route, 'removing');
        await removeTunnel(ctx);
      }),
    );
  }
  // The agent still holds the secret: its post-teardown runs on its loopback.
  if (agentSide && ctx.reserved) {
    await warnOnFailure(() => agentStage(op, ctx, 'uninstall:post-teardown', phase, 'job'));
  }
  // The agent half Lamaste installed goes before the secret it runs with.
  if (ctx.reserved && ctx.appInstall !== null) {
    await soft(() => teardownAgentHalf(op, ctx, phase));
  }
  if (ctx.reserved) {
    await soft(() => op.step('revoke the secret and the capability', () => releaseHosting(ctx)));
  }
  if (relaySide) await warnOnFailure(() => relayStage(op, ctx, 'uninstall:post-teardown', phase));
}

/**
 * Remove a plugin's hosting: the uninstall pipeline. With `force`, failing
 * pre-teardown stages do not stop it (a broken or gone agent must not keep
 * a plugin on the relay); the admin chose that, and it is audited. The
 * agent half Lamaste installed is removed (`ctx.purge`: with its data); one
 * whose install never finished is removed as well, in case it ran.
 */
export async function runUninstallPipeline(op, ctx, { force = false } = {}) {
  // Only the plugin's own hosting is ever torn down (throws on another's).
  const record = await ownHostingRecord(ctx);
  if (!record) {
    op.skip('teardown', 'the plugin is not hosted');
    return { status: 'succeeded' };
  }
  const phase = pluginHostingPhase(record);
  ctx.agentLabel = record.agentLabel;
  ctx.tunnelId = record.tunnelId;
  ctx.port = record.port;
  ctx.reserved = true;
  ctx.tunnelGranted = phase === 'active';
  ctx.appInstall = record.agentHalf
    ? 'installed'
    : ctx.agentHalf !== null && phase !== 'active'
      ? 'dispatched'
      : null;
  await runTeardown(op, ctx, { phase: 'uninstall', force });
  await cancelAgentJobs(ctx.route).catch(() => undefined);
  // The relay's cache of the settings describes the hosting's agent half:
  // with the hosting gone it describes nothing (a later hosting reads them
  // afresh — from data the agent kept, or none).
  if (!(await getPluginHosting(STATE_DIR, ctx.route))) {
    await deleteSettingsCache(ctx.plugin.name).catch((err) =>
      op.warn(`Could not drop the cached settings: ${err.message}`),
    );
    // So does what the relay knew of the half's identity feed: the next
    // hosting's half answers protocol 1 before users reach it, and replays.
    await forgetIdentityHalf(ctx.plugin.name).catch((err) =>
      op.warn(`Could not forget the agent half's identity feed: ${err.message}`),
    );
    // Its user surface's locations no longer take the internal tunnel's
    // body limit (best effort; the panel answers 503 until it is hosted).
    await refreshUserSurfaceVhosts(ctx.route, ctx.logger);
  }
  await recordAuditBestEffort(
    {
      actor: op.actor ?? 'admin',
      action: 'plugin.unhosted',
      plugin: ctx.plugin.name,
      details: {
        agentLabel: record.agentLabel,
        force,
        ...(ctx.purge ? { purge: true } : {}),
        operation: op.id,
        warnings: op.warnings.length,
      },
    },
    ctx.logger,
  );
  return { status: 'succeeded' };
}

/**
 * The install pipeline around an upgrade of the relay package (the agent
 * half is already running; its stages go through the tunnel). `apply` is
 * Lamaste's step — install the new package and its hook module; `serve`,
 * when given, is the last step (the new version's web tree served, once
 * every stage passed);
 * `revert` restores the previous ones. Agent and relay stages see `phase: "upgrade"`.
 *
 * A hosted plugin whose agent half Lamaste installs gets the new version of
 * it first (after the agent's pre stage): the agent's helper installs it
 * and switches `current`, and Lamaste waits until it answers through the
 * tunnel. A failure after that switch activates the version that ran
 * before (`ctx.previousAgentHalfVersion`).
 */
export async function runUpgradePipeline(op, ctx, { apply, serve, revert, hosted }) {
  let applied = false;
  try {
    if (hosted) {
      await relayStageOrSkip(op, ctx, 'install:pre-tunnel', 'upgrade');
      const record = await ownHostingRecord(ctx);
      ctx.agentLabel = record?.agentLabel ?? ctx.agentLabel;
      ctx.port = record?.port ?? null;
      ctx.previousAgentHalfVersion = record?.agentHalf?.version ?? null;
      ctx.previousAgentHalfPackage = record?.agentHalf?.package ?? null;
      await agentStageOrSkip(op, ctx, 'install:pre-tunnel', 'upgrade', 'tunnel');
      if (ctx.agentHalf) {
        await op.step('install the new agent half', async () => {
          await installAgentHalf(op, ctx, 'upgrade');
          await waitForAgentHalf(ctx);
        });
      }
    }
    await op.step('install the new version', async () => {
      await apply();
      applied = true;
    });
    if (hosted) {
      await agentStageOrSkip(op, ctx, 'install:post-tunnel', 'upgrade', 'tunnel');
      await relayStageOrSkip(op, ctx, 'install:post-tunnel', 'upgrade');
    }
    // What the new version serves its users from the relay (its web tree):
    // the last step, once every stage passed — a failure still reverts.
    if (serve) await op.step('serve the new web tree', serve);
  } catch (err) {
    op.warn(`Reverting: ${String(err.message ?? err).slice(0, 300)}`);
    try {
      await op.step('restore the previous version', () => revert({ applied }));
    } catch (revertErr) {
      op.warn(`Could not restore the previous version: ${revertErr.message}`);
    }
    // Once the install job was dispatched the helper may have switched
    // `current`, whatever it reported — the version that ran before goes
    // back (activating it is idempotent).
    const switched = ctx.appInstall !== null;
    if (switched) {
      try {
        await op.step('activate the previous agent half', () => activatePreviousAgentHalf(op, ctx));
      } catch (activateErr) {
        op.warn(`Could not activate the previous agent half: ${activateErr.message}`);
      }
    }
    if (!applied && !switched) throw err;
    return { status: 'rolled-back', error: String(err.message).slice(0, 500) };
  }
  return { status: 'succeeded' };
}
