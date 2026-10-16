/**
 * Hosting an agent-hosted plugin's agent half on an agent — the daemon's
 * wiring of `@lamalibre/lamaste/server`'s plugin hosting store, the internal
 * tunnel workflow, the agent registry and the health monitor.
 *
 * Hosting a plugin on an agent is three things done together, and undone
 * together: an internal plugin tunnel carried by that agent (its port is
 * assigned from the internal range), a hosting record with a fresh
 * installation secret, and the `plugin:<route>:host` capability on the
 * agent's certificate — the only thing that lets the agent fetch the secret.
 *
 * When Lamaste installs the agent half itself (`agent.package`, slice 3) the
 * relay has the agent install, switch or remove code as root. Hosting,
 * updating and removing such a hosting are therefore pushes: the agent must
 * be able to host it (`hostEligibility` over the host facts it reported)
 * and the push-install gates must allow the action on the agent package
 * (global switch, the agent's window, the source IP, the policy). A plugin
 * whose agent half is installed by hand is hosted as before, unchecked.
 * The agent's helper runs only app jobs this relay signed, so it must also
 * trust the key the relay signs with (the agent reports the one pinned).
 */

import {
  AGENT_LABEL_REGEX,
  PLUGIN_AGENT_CN_PREFIX,
  agentHookSetOf,
  derivePluginRoute,
  hasAgentHalf,
  hostEligibility,
  pluginHostCapability,
} from '@lamalibre/lamaste';
import {
  TUNNEL_MAX_BODY_MB,
  getPluginHosting,
  pluginHostingOwner,
  readPluginHostings,
  rotatePluginHostingSecret,
  acknowledgePluginHostingSecret,
  updatePluginHostingHealth,
  signingSecretFor,
  pluginHostingView,
  agentPluginConfigFor,
  agentPluginAssignments,
  startPluginHealthMonitor,
  pluginHostingPhase,
  PluginHostingError,
} from '@lamalibre/lamaste/server';
import { httpError } from './app-error.js';
import { getConfig } from './config.js';
import { readTunnels } from './state.js';
import {
  getAgentHostFacts,
  loadAgentRegistry,
  saveAgentRegistry,
  withRegistryLock,
} from './mtls.js';
import { startPluginOperation } from './plugin-operations.js';
import {
  pipelineContext,
  runInstallPipeline,
  runPurgeRetainedData,
  runUninstallPipeline,
} from './hook-pipelines.js';
import { installedAgentHalf, installedVersionApproved } from './plugin-hooks.js';
import { checkPushInstallAction, logPushInstallSession } from './push-install.js';
import { relaySigner } from './relay-signing.js';
import { findRetainedData, forgetRetainedData, listRetainedData } from './retained-data.js';
import { recordAudit } from './audit.js';
import { onHealthTransition } from './tunnel-hooks.js';
import { agentLastSeenAt, agentPresenceMap } from './agent-presence.js';
import { refreshPluginSettingsBestEffort } from './plugin-settings.js';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';

/**
 * The installed plugin `name` must be agent-hosted with an agent half, and
 * hold its route — the route keys its hosting and everything the hosting
 * creates, on the relay and on the agent.
 * @param {string} name
 */
async function requireHostablePlugin(name) {
  const { findPlugin } = await import('./plugins.js');
  const plugin = await findPlugin(name);
  if (!plugin) throw httpError(`Plugin "${name}" not found`, 404);
  if (!hasAgentHalf(plugin)) {
    throw httpError(
      plugin.hosting === 'agent'
        ? `Plugin "${name}" has no agent half (its manifest declares no "agent" block)`
        : `Plugin "${name}" is a server plugin and runs on the panel`,
      400,
    );
  }
  if (plugin.route === null) {
    throw httpError(
      `Plugin "${name}" shares the route "${derivePluginRoute(name)}" with another installed plugin (both were installed before routes were unique) — uninstall one of them, then reinstall`,
      409,
      { code: 'route_conflict' },
    );
  }
  if (plugin.route !== plugin.name) {
    throw httpError(
      `A plugin with an agent half is named by its route: "${name}" would be served as "${plugin.route}" — reinstall it named "${plugin.route}"`,
      409,
      { code: 'route_conflict' },
    );
  }
  return plugin;
}

/**
 * The hosting installed plugin `plugin` owns, or null. A hosting on its
 * route that names another plugin as its owner is not its own — no
 * operation of one plugin reads, changes or removes another's hosting.
 *
 * @param {{ name: string, route: string | null }} plugin registry entry
 */
export async function ownHosting(plugin) {
  if (!plugin.route) return null;
  const record = await getPluginHosting(STATE_DIR, plugin.route);
  return record && pluginHostingOwner(record) === plugin.name ? record : null;
}

/** {@link ownHosting} of installed plugin `name`; null when it is not installed. */
async function ownHostingOf(name) {
  const { findPlugin } = await import('./plugins.js');
  const plugin = await findPlugin(name);
  return plugin ? ownHosting(plugin) : null;
}

/** Add or remove one capability on an agent's certificate record, under the registry lock. */
export function setAgentCapability(label, capability, present) {
  return withRegistryLock(async () => {
    const registry = await loadAgentRegistry();
    const agent = registry.agents.find((a) => a.label === label && !a.revoked);
    if (!agent) throw httpError(`Agent "${label}" is not enrolled or has been revoked`, 400);
    const current = Array.isArray(agent.capabilities) ? agent.capabilities : ['tunnels:read'];
    const has = current.includes(capability);
    if (present === has) return;
    agent.capabilities = present
      ? [...current, capability]
      : current.filter((c) => c !== capability);
    await saveAgentRegistry(registry);
  });
}

export async function isActiveAgent(label) {
  const registry = await loadAgentRegistry();
  return registry.agents.some((a) => a.label === label && !a.revoked);
}

// ---------------------------------------------------------------------------
// Pushing an agent half: eligibility and the push-install gates
// ---------------------------------------------------------------------------

/**
 * What this relay brings to eligibility: the id of the key it signs app
 * jobs with — null when the key is unusable (it signs nothing then).
 *
 * @returns {Promise<import('@lamalibre/lamaste').HostEligibilityRelay>}
 */
export async function relayEligibility() {
  try {
    return { relayKid: (await relaySigner.current())?.kid ?? null };
  } catch {
    return { relayKid: null };
  }
}

/**
 * Refuse (409 `agent_not_eligible`, with the reasons) an agent that cannot
 * host agent half `agentHalf` of a plugin requiring `requires`.
 */
export async function assertAgentEligible(label, requires, agentHalf, pluginName) {
  const { eligible, reasons } = hostEligibility(
    requires,
    agentHalf,
    await getAgentHostFacts(label),
    await relayEligibility(),
  );
  if (!eligible) {
    throw httpError(
      `Agent "${label}" cannot host plugin "${pluginName}": ${reasons.join('; ')}`,
      409,
      { code: 'agent_not_eligible', reasons },
    );
  }
}

/**
 * The push-install gates for `action` on agent half package `packageName`
 * to agent `label`, from `sourceIp`. Refused with the gate's status and code
 * `push_install_refused`. Returns the push to log once its operation runs.
 */
export async function assertAgentHalfPush(label, sourceIp, action, packageName) {
  const gate = await checkPushInstallAction(label, sourceIp, action, packageName);
  if (!gate.ok) {
    throw httpError(gate.error, gate.statusCode, { code: 'push_install_refused' });
  }
  return { agentLabel: label, action, packageName, sourceIp, policyId: gate.policy.id };
}

/** Record a push in the push-install session log (best effort: its operation already runs). */
export async function logAgentHalfPush(push, operationId, logger) {
  if (!push) return;
  try {
    await logPushInstallSession({ ...push, status: 'started', operationId });
  } catch (err) {
    logger?.warn({ err: err.message }, 'Failed to log the push-install session');
  }
}

/**
 * The checks before a hosting is removed (unhost, or uninstalling a hosted
 * plugin). `purge` applies to an agent half Lamaste installs only. Removing
 * one is a push (`uninstall`) — unless its agent is no longer enrolled:
 * nothing can be pushed to it then, the pipeline skips the removal and says
 * how to finish it on the machine. Returns the push to log, or null.
 *
 * @param {object} plugin registry entry
 * @param {{ agentLabel: string }} record the hosting (the plugin's own — see {@link ownHosting})
 * @param {{ purge: boolean, sourceIp: string }} opts
 */
export async function prepareHostingRemoval(plugin, record, { purge, sourceIp }) {
  if (pluginHostingOwner(record) !== plugin.name) {
    throw httpError(
      `The hosting on route "${record.plugin}" is not plugin "${plugin.name}"'s`,
      409,
      {
        code: 'hosting_owner_mismatch',
      },
    );
  }
  const agentHalf = installedAgentHalf(plugin);
  if (!agentHalf) {
    if (purge) {
      throw httpError(
        `purge removes the data of an agent half Lamaste installed — the agent half of "${plugin.name}" is installed by hand`,
        400,
      );
    }
    return null;
  }
  if (!(await isActiveAgent(record.agentLabel))) return null;
  return assertAgentHalfPush(record.agentLabel, sourceIp, 'uninstall', agentHalf.package);
}

/**
 * Which machine agents can host plugin `name` and, for each that cannot,
 * why — what the host dialog lists. For a plugin whose agent half is
 * installed by hand every enrolled agent is listed as eligible: hosting
 * checks nothing then (as before slice 3).
 *
 * @param {string} name
 * @returns {Promise<Array<{ label: string, eligible: boolean, reasons: string[] }>>}
 */
export async function hostingEligibility(name) {
  const plugin = await requireHostablePlugin(name);
  const agentHalf = installedAgentHalf(plugin);
  const registry = await loadAgentRegistry();
  const relay = agentHalf ? await relayEligibility() : null;
  return registry.agents
    .filter((a) => !a.revoked && AGENT_LABEL_REGEX.test(a.label))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((a) => {
      if (!agentHalf) return { label: a.label, eligible: true, reasons: [] };
      const { eligible, reasons } = hostEligibility(
        plugin.agent?.requires,
        agentHalf,
        a.hostFacts ?? null,
        relay,
      );
      return { label: a.label, eligible, reasons };
    });
}

/**
 * Host plugin `name` on agent `agentLabel`: start the install pipeline
 * (`hook-pipelines.js`) as an operation and return it. Checked first, so a
 * request that cannot succeed is refused at once: the plugin is installed
 * and has an agent half, the agent is enrolled, the plugin is not hosted,
 * the relay is onboarded, and what it brings (relay hooks, an agent half
 * Lamaste installs) is approved. An agent half Lamaste installs also needs
 * an eligible agent and the push-install gates (`sourceIp`: the admin's).
 *
 * @param {string} name
 * @param {string} agentLabel
 * @param {{ actor: string, logger: import('pino').Logger, sourceIp: string }} opts
 * @returns {Promise<object>} the operation
 */
export async function hostPlugin(name, agentLabel, { actor, logger, sourceIp }) {
  const plugin = await requireHostablePlugin(name);
  const route = derivePluginRoute(plugin.name);
  if (!AGENT_LABEL_REGEX.test(agentLabel) || agentLabel.startsWith(PLUGIN_AGENT_CN_PREFIX)) {
    throw httpError('agentLabel must name an enrolled machine agent', 400);
  }
  if (!(await isActiveAgent(agentLabel))) {
    throw httpError(`Agent "${agentLabel}" is not enrolled or has been revoked`, 400);
  }
  const existing = await getPluginHosting(STATE_DIR, route);
  if (existing) {
    const owner = pluginHostingOwner(existing);
    throw owner === plugin.name
      ? httpError(`Plugin "${name}" is already hosted — clear its hosting first`, 409)
      : httpError(`The route "${route}" is hosted for plugin "${owner}"`, 409, {
          code: 'hosting_owner_mismatch',
        });
  }
  const config = getConfig();
  if (!config.domain || !config.email) {
    throw httpError('Domain and email must be configured before hosting a plugin', 400);
  }
  if (!(await installedVersionApproved(plugin))) {
    throw httpError(
      `Plugin "${name}" brings relay hooks or an agent half that are not approved — review and approve them first`,
      409,
      { code: 'hooks_not_approved' },
    );
  }
  let push = null;
  const agentHalf = installedAgentHalf(plugin);
  if (agentHalf) {
    await assertAgentEligible(agentLabel, plugin.agent?.requires, agentHalf, plugin.name);
    await assertNoForeignRetainedData(agentLabel, route, agentHalf.package);
    push = await assertAgentHalfPush(agentLabel, sourceIp, 'install', agentHalf.package);
  }

  const ctx = pipelineContext({
    plugin,
    agentLabel,
    domain: config.domain,
    email: config.email,
    logger,
  });
  const { operation } = await startPluginOperation({
    plugin: plugin.name,
    kind: 'host',
    actor,
    params: { agentLabel },
    logger,
    run: async (op) => {
      const result = await runInstallPipeline(op, ctx);
      // The agent half starts without settings — or with those it kept on
      // this agent from an earlier hosting: the relay's cache follows it.
      if (result.status === 'succeeded') await refreshPluginSettingsBestEffort(plugin.name, logger);
      return result;
    },
  });
  await logAgentHalfPush(push, operation.id, logger);
  return operation;
}

/**
 * Remove plugin `name`'s hosting: start the uninstall pipeline as an
 * operation. `force` lets failing pre-teardown stages pass (reported and
 * audited) — for an agent that is gone or a half that no longer answers.
 * `purge` removes the data directory and service account of an agent half
 * Lamaste installed (kept by default).
 *
 * @param {string} name
 * @param {{ actor: string, logger: import('pino').Logger, force?: boolean, purge?: boolean, sourceIp: string }} opts
 * @returns {Promise<object>} the operation
 */
export async function unhostPlugin(
  name,
  { actor, logger, force = false, purge = false, sourceIp },
) {
  const plugin = await requireHostablePlugin(name);
  const record = await ownHosting(plugin);
  if (!record) {
    throw httpError(`Plugin "${name}" is not hosted on an agent`, 404);
  }
  const push = await prepareHostingRemoval(plugin, record, { purge, sourceIp });
  const { operation } = await startPluginOperation({
    plugin: plugin.name,
    kind: 'unhost',
    actor,
    params: { force, ...(purge ? { purge } : {}) },
    logger,
    run: (op) => teardownHosting(op, plugin, { force, purge, logger }),
  });
  await logAgentHalfPush(push, operation.id, logger);
  return operation;
}

/**
 * The uninstall pipeline for a plugin's hosting, inside an operation that
 * is already running (unhost, or uninstalling a hosted plugin).
 */
export async function teardownHosting(op, plugin, { force = false, purge = false, logger }) {
  const config = getConfig();
  const ctx = pipelineContext({
    plugin,
    agentLabel: null,
    domain: config.domain,
    email: config.email,
    logger,
    purge,
  });
  return runUninstallPipeline(op, ctx, { force });
}

/** Whether installed plugin `name` has a hosting of its own (in any phase). */
export async function isPluginHosted(name) {
  return (await ownHostingOf(name)) !== null;
}

/**
 * The plugin's hosting as the panel shows it, with when its agent last
 * synced (`agentLastSeenAt`, null when it never did since the panel knew).
 *
 * @param {string} name
 * @returns {Promise<(import('@lamalibre/lamaste/server').PluginHostingView & { agentLastSeenAt: string | null }) | null>}
 */
export async function getHostingView(name) {
  const record = await ownHostingOf(name);
  if (!record) return null;
  return {
    ...withLiveHealth(pluginHostingView(record)),
    agentLastSeenAt: await agentLastSeenAt(record.agentLabel),
  };
}

/**
 * `agentHosting` for every plugin of a list — null for plugins that are not
 * hosted; with `agentLastSeenAt` as in {@link getHostingView} — and
 * `retainedData`: what agents keep of the plugin's agent half after it was
 * removed without purge.
 */
export async function attachHostings(plugins) {
  const store = await readPluginHostings(STATE_DIR);
  const retained = await listRetainedData();
  const lastSeen = await agentPresenceMap();
  return plugins.map((p) => {
    const record = p.route ? store[p.route] : undefined;
    const own = record && pluginHostingOwner(record) === p.name ? record : null;
    return {
      ...p,
      agentHosting: own
        ? {
            ...withLiveHealth(pluginHostingView(own)),
            agentLastSeenAt: lastSeen.get(own.agentLabel) ?? null,
          }
        : null,
      retainedData: retained.filter((r) => r.plugin === p.name),
    };
  });
}

/**
 * @param {string} name
 * @param {import('pino').Logger} logger
 */
export async function rotateHostingSecret(name, logger) {
  const record = await ownHostingOf(name);
  if (!record) throw httpError(`Plugin "${name}" is not hosted on an agent`, 404);
  try {
    const rotated = await rotatePluginHostingSecret(STATE_DIR, record.plugin);
    logger.info({ plugin: record.plugin }, 'Plugin installation secret rotated');
    return pluginHostingView(rotated);
  } catch (err) {
    if (err instanceof PluginHostingError) throw httpError(err.message, 404);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Data agent halves left on agents
// ---------------------------------------------------------------------------

/**
 * Refuse (409 `retained_data_conflict`) installing agent package `pkg` for
 * route `route` on agent `label` while that agent keeps the data of another
 * agent package for the route — the agent's helper would refuse it too, and
 * the data would otherwise go to code it does not belong to. Data of the
 * same package is taken back by the install.
 */
export async function assertNoForeignRetainedData(label, route, pkg) {
  const retained = await findRetainedData(label, route);
  if (retained && retained.package !== pkg) {
    throw httpError(
      `Agent "${label}" keeps the data of ${retained.package} (plugin "${retained.plugin}") for route "${route}" since ${retained.since} — Lamaste does not install ${pkg} over it; purge that data first: Purge under Retained data on the Plugins page, or lamaste-server plugins purge-data ${retained.plugin} --agent ${label}`,
      409,
      { code: 'retained_data_conflict', retained },
    );
  }
}

/**
 * What agents keep of plugin `name`'s agent half — by the name the plugin
 * had, so it is found after the plugin is uninstalled too.
 * @param {string} name
 */
export function retainedDataOf(name) {
  return listRetainedData({ plugin: name });
}

/**
 * Purge the data agent `agentLabel` keeps of plugin `name`'s agent half —
 * its data directory and service account — through the agent's helper (an
 * `app-remove` job with purge, push-install gated as `uninstall`), as an
 * operation. Works whether the plugin is still installed or not. `forget`
 * only drops the relay's record and leaves the agent alone — for an agent
 * that is gone, or data removed on the machine by hand; audited.
 *
 * @param {string} name the plugin the data belonged to
 * @param {string} agentLabel
 * @param {{ actor: string, logger: import('pino').Logger, sourceIp: string, forget?: boolean }} opts
 * @returns {Promise<{ operation: object } | { forgotten: object }>}
 */
export async function purgeRetainedData(name, agentLabel, { actor, logger, sourceIp, forget }) {
  const retained = (await listRetainedData({ plugin: name, agentLabel }))[0] ?? null;
  if (!retained) {
    throw httpError(`Agent "${agentLabel}" keeps no data of plugin "${name}"`, 404);
  }
  const hosting = await ownHostingOf(name);
  if (hosting && hosting.agentLabel === agentLabel) {
    throw httpError(
      `Plugin "${name}" is hosted on agent "${agentLabel}" and uses that data — remove its hosting with purge instead`,
      409,
      { code: 'retained_data_in_use' },
    );
  }
  if (forget) {
    await forgetRetainedData(agentLabel, retained.route);
    await recordAudit({
      actor,
      action: 'plugin.agent-half.retained-data.forgotten',
      plugin: name,
      details: { agentLabel, route: retained.route, package: retained.package },
    });
    return { forgotten: retained };
  }
  if (!(await isActiveAgent(agentLabel))) {
    throw httpError(
      `Agent "${agentLabel}" is no longer enrolled — nothing can be pushed to it. Purge the data on the machine (sudo lamaste-agent apphost remove ${retained.route} --purge), then forget the relay's record: Forget under Retained data on the Plugins page, or lamaste-server plugins forget-data ${name} --agent ${agentLabel}`,
      409,
      { code: 'agent_not_enrolled' },
    );
  }
  const push = await assertAgentHalfPush(agentLabel, sourceIp, 'uninstall', retained.package);
  const { operation } = await startPluginOperation({
    plugin: name,
    kind: 'purge-data',
    actor,
    params: { agentLabel },
    logger,
    run: (op) => runPurgeRetainedData(op, { retained, logger }),
  });
  await logAgentHalfPush(push, operation.id, logger);
  return { operation };
}

// ---------------------------------------------------------------------------
// The hosting agent's side
// ---------------------------------------------------------------------------

/**
 * The `appPlugins` entries of the agent-config response for agent `label`,
 * each with the tunnel-state hooks its agent half declares — the agent's
 * sync calls them on its loopback when the relay's view of the tunnel
 * changes (`health`).
 */
export async function listAgentPluginAssignments(label) {
  const { findPlugin } = await import('./plugins.js');
  const store = await readPluginHostings(STATE_DIR);
  const assignments = agentPluginAssignments(store, label);
  return Promise.all(
    assignments.map(async (a) => {
      const owner = store[a.route] ? pluginHostingOwner(store[a.route]) : null;
      const plugin = owner ? await findPlugin(owner) : null;
      const stages = agentHookSetOf({ hooks: plugin?.hooks })?.stages ?? [];
      return {
        ...a,
        agentHooks: stages
          .filter((h) => h.stage === 'tunnel:down' || h.stage === 'tunnel:up')
          .map((h) => ({ stage: h.stage, timeoutMs: h.timeoutMs })),
      };
    }),
  );
}

/**
 * The plugin config for the hosting agent `label` — port and secrets. Null
 * when the plugin is not hosted on that agent.
 * @param {string} label
 * @param {string} route
 */
export async function agentPluginConfig(label, route) {
  const record = await getPluginHosting(STATE_DIR, route);
  if (!record || record.agentLabel !== label) return null;
  return agentPluginConfigFor(record);
}

/**
 * The hosting agent confirms it holds the secret issued at `issuedAt`.
 * @param {string} label
 * @param {string} route
 * @param {string} issuedAt
 */
export async function acknowledgeAgentPluginConfig(label, route, issuedAt) {
  const record = await getPluginHosting(STATE_DIR, route);
  if (!record || record.agentLabel !== label) return null;
  const { record: next, acknowledged } = await acknowledgePluginHostingSecret(
    STATE_DIR,
    route,
    issuedAt,
  );
  return { acknowledged, secretIssuedAt: next.current.issuedAt };
}

// ---------------------------------------------------------------------------
// The forwarder's side
// ---------------------------------------------------------------------------

/**
 * Resolve a route to a forward target (see `agentForwarderPlugin`).
 * @param {string} route
 */
export async function resolveForwardTarget(route) {
  const { findPluginByRoute } = await import('./plugins.js');
  const plugin = await findPluginByRoute(route);
  if (!plugin || !hasAgentHalf(plugin)) return { kind: 'not_found' };
  if (plugin.status !== 'enabled') return { kind: 'disabled' };
  const record = await ownHosting(plugin);
  if (!record || pluginHostingPhase(record) !== 'active') return { kind: 'not_hosted' };
  const tunnels = await readTunnels();
  const tunnel = tunnels.find((t) => t.id === record.tunnelId);
  const maxBodyMb = tunnel?.maxBodySizeMb ?? TUNNEL_MAX_BODY_MB.default;
  return {
    plugin: route,
    port: record.port,
    secret: signingSecretFor(record),
    maxBodyBytes: maxBodyMb * 1024 * 1024,
  };
}

/**
 * Who the panel admits on a hosted plugin's routes: an administrator, or an
 * agent holding one of the plugin's declared capabilities. The host
 * capability is not one of them — hosting the application is not using it.
 * @param {import('fastify').FastifyRequest} request
 * @param {string} plugin
 */
export async function authorizeForwardedCaller(request, plugin) {
  if (request.certRole === 'admin') return { type: 'admin' };
  if (request.certRole === 'agent' || request.certRole === 'plugin-agent') {
    const prefix = `plugin:${plugin}:`;
    const host = pluginHostCapability(plugin);
    const caps = request.certCapabilities || [];
    if (caps.some((c) => c.startsWith(prefix) && c !== host) && request.certLabel) {
      return { type: 'agent', label: request.certLabel };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Health monitor
// ---------------------------------------------------------------------------

let monitor = null;

/** Start probing every hosting; idempotent. */
export function startHostedPluginHealthMonitor(logger) {
  if (monitor) return monitor;
  monitor = startPluginHealthMonitor({
    listHostings: async () => {
      const { readPlugins } = await import('./plugins.js');
      const enabled = new Set(
        (await readPlugins()).plugins.filter((p) => p.status === 'enabled').map((p) => p.name),
      );
      return Object.values(await readPluginHostings(STATE_DIR))
        .filter((r) => enabled.has(pluginHostingOwner(r)) && pluginHostingPhase(r) === 'active')
        .map((r) => ({
          plugin: r.plugin,
          port: r.port,
          secret: signingSecretFor(r),
          health: r.health,
        }));
    },
    onTransition: async (plugin, health) => {
      const before = (await getPluginHosting(STATE_DIR, plugin))?.health ?? null;
      await updatePluginHostingHealth(STATE_DIR, plugin, health);
      // The relay's tunnel:down / tunnel:up hooks, beside the monitor.
      void onHealthTransition(plugin, before, health, logger);
    },
    logger,
  });
  return monitor;
}

export function stopHostedPluginHealthMonitor() {
  monitor?.stop();
  monitor = null;
}

/** Merge the monitor's last probe time into a persisted view. */
function withLiveHealth(view) {
  const tracker = monitor?.snapshot().get(view.plugin);
  if (!tracker) return view;
  return {
    ...view,
    health: {
      ...view.health,
      ...(tracker.checkedAt ? { checkedAt: tracker.checkedAt } : {}),
      ...(tracker.lastError && view.health.state !== 'up' ? { lastError: tracker.lastError } : {}),
    },
  };
}
