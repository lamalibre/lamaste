/**
 * A plugin's lifecycle hooks on the relay: its relay hook set as installed,
 * the administrator's approval of what Lamaste runs and installs for it,
 * auto-approve, and the hook runner that holds the approved module.
 *
 * Approval binds bytes (see `hook-set.ts` in the core library): one digest
 * (`approvalDigest`) covers the relay hook set — the normalised relay
 * declarations and the SHA-256 of the relay entry module — the agent half
 * Lamaste installs onto the hosting agent — its package, version, tarball
 * integrity, service and system packages — and the plugin's identity block
 * — the roles its users hold and the attributes it receives about them.
 * Approval is needed when any exists. Lamaste runs relay hooks, hosts the
 * plugin, installs its agent half and sends it its users only while the
 * installed version's digest is the approved one. Settings are outside the
 * digest, but an update that turns a secret setting into a plain one waits
 * for an administrator's approval all the same (`plugin-lifecycle.js`), and
 * so does one that adds or removes a role or widens the attributes: the
 * same pending update, approved here.
 *
 * The runner is about the relay part alone: it holds a root-owned copy of
 * the approved module that lamaste-priv installed after checking its
 * SHA-256, and its state (`installedDigest`) names the *relay hook set's*
 * digest (`relayHookSetDigest`) — so a new agent half with an unchanged
 * relay module leaves the runner current.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import {
  agentHalfOf,
  agentHalfPreview,
  agentHookSetOf,
  approvalDigest,
  derivePluginRoute,
  hookEntrySha256,
  relayHookSetDigest,
  relayHookSetNeedsEntry,
  relayHookSetOf,
  relayHookSetPackVersions,
  relayHookSetPreview,
} from '@lamalibre/lamaste';
import { HOOK_RUNNER_SOCKET_DIR } from '@lamalibre/lamaste/server';
import { httpError } from './app-error.js';
import { getStateDb } from './state-db.js';
import { recordAudit, recordAuditBestEffort } from './audit.js';
import { notifyAdminsBestEffort } from './notifications.js';
import { installedPackageDir, readInstalledHookModule } from './plugin-packages.js';

const PRIV = '/usr/local/sbin/lamaste-priv';
/** Where lamaste-priv puts each plugin's approved module and runner.env (root-owned, world-readable). */
const HOOKS_DIR = process.env.LAMALIBRE_LAMASTE_HOOKS_DIR || '/opt/lamalibre/lamaste/hooks';
/** A stuck runner is restarted at most this often. */
const RUNNER_RESTART_MIN_INTERVAL_MS = 10_000;

/** The directory of the runner sockets (systemd's; a test points it elsewhere). */
export function hookSocketDir() {
  return process.env.LAMALIBRE_LAMASTE_HOOKS_SOCKET_DIR || HOOK_RUNNER_SOCKET_DIR;
}

// ---------------------------------------------------------------------------
// The runner manager: lamaste-priv on a relay, replaced in tests.
// ---------------------------------------------------------------------------

const privRunnerManager = {
  async install(route, entrySha256, moduleBytes) {
    await execa('sudo', [PRIV, 'hooks', 'install', route, entrySha256 ?? 'none'], {
      ...(moduleBytes ? { input: moduleBytes } : {}),
      timeout: 60_000,
    });
  },
  async activate(route, entrySha256) {
    await execa('sudo', [PRIV, 'hooks', 'activate', route, entrySha256], { timeout: 60_000 });
  },
  async remove(route) {
    await execa('sudo', [PRIV, 'hooks', 'remove', route], { timeout: 60_000 });
  },
  async restart(route) {
    await execa('sudo', [PRIV, 'hooks', 'restart', route], { timeout: 30_000 });
  },
  /** The entry SHA-256 the runner is set up with: null for shared hooks only, undefined when not installed. */
  async installedEntry(route) {
    let text;
    try {
      text = await readFile(path.join(HOOKS_DIR, route, 'runner.env'), 'utf-8');
    } catch {
      return undefined;
    }
    const m = /^LAMASTE_HOOK_RUNNER_ARGS=--entry \S*\/([a-f0-9]{64})\.mjs$/m.exec(text);
    return m ? m[1] : null;
  },
};

let runnerManager = privRunnerManager;

/** Replace how runners are installed and restarted (tests run the runner themselves). */
export function setHookRunnerManagerForTests(manager) {
  runnerManager = manager ?? privRunnerManager;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function rowToState(row) {
  if (!row) return null;
  return {
    approvedDigest: row.approved_digest,
    approvedVersion: row.approved_version,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    autoApprove: row.auto_approve === 1,
    installedDigest: row.installed_digest,
    packVersions: JSON.parse(row.pack_versions || '{}'),
    pendingUpdate: row.pending_update ? JSON.parse(row.pending_update) : null,
    tunnelFallback: row.tunnel_fallback ? JSON.parse(row.tunnel_fallback) : null,
  };
}

export async function readHookState(plugin) {
  const db = await getStateDb();
  return rowToState(db.prepare('SELECT * FROM plugin_hook_sets WHERE plugin = ?').get(plugin));
}

async function writeHookState(plugin, patch) {
  const db = await getStateDb();
  const current = (await readHookState(plugin)) ?? {
    approvedDigest: null,
    approvedVersion: null,
    approvedAt: null,
    approvedBy: null,
    autoApprove: false,
    installedDigest: null,
    packVersions: {},
    pendingUpdate: null,
    tunnelFallback: null,
  };
  const next = { ...current, ...patch };
  db.prepare(
    `INSERT INTO plugin_hook_sets
       (plugin, approved_digest, approved_version, approved_at, approved_by, auto_approve,
        installed_digest, pack_versions, pending_update, tunnel_fallback)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(plugin) DO UPDATE SET
       approved_digest = excluded.approved_digest,
       approved_version = excluded.approved_version,
       approved_at = excluded.approved_at,
       approved_by = excluded.approved_by,
       auto_approve = excluded.auto_approve,
       installed_digest = excluded.installed_digest,
       pack_versions = excluded.pack_versions,
       pending_update = excluded.pending_update,
       tunnel_fallback = excluded.tunnel_fallback`,
  ).run(
    plugin,
    next.approvedDigest,
    next.approvedVersion,
    next.approvedAt,
    next.approvedBy,
    next.autoApprove ? 1 : 0,
    next.installedDigest,
    JSON.stringify(next.packVersions ?? {}),
    next.pendingUpdate ? JSON.stringify(next.pendingUpdate) : null,
    next.tunnelFallback ? JSON.stringify(next.tunnelFallback) : null,
  );
  return next;
}

/** Put back a state read earlier with {@link readHookState} (reverting an update). */
export async function restoreHookState(plugin, state) {
  if (state === null) {
    await deleteHookState(plugin);
    return;
  }
  await writeHookState(plugin, { ...state, pendingUpdate: null });
}

export async function deleteHookState(plugin) {
  const db = await getStateDb();
  db.prepare('DELETE FROM plugin_hook_sets WHERE plugin = ?').run(plugin);
}

// ---------------------------------------------------------------------------
// What an installed plugin brings, and its approval
// ---------------------------------------------------------------------------

/**
 * The relay hook set of an installed plugin (registry entry), with the
 * digest of that set alone (`relayHookSetDigest` — what the runner holds);
 * null when the plugin declares no relay hook.
 */
export function installedRelayHooks(plugin) {
  const set = relayHookSetOf({ hooks: plugin.hooks });
  if (!set) return null;
  const entrySha256 = relayHookSetNeedsEntry(set) ? (plugin.hooksEntrySha256 ?? null) : null;
  return { set, entrySha256, digest: relayHookSetDigest(set, entrySha256) };
}

/**
 * The agent half Lamaste installs for a plugin (registry entry, or a staged
 * version in the same shape): the manifest's declaration with the version
 * and tarball integrity pinned when that version was staged. Null when the
 * manifest names no `agent.package`. A declaration without a pin for this
 * version is refused — nothing unpinned is ever approved or installed.
 *
 * @returns {import('@lamalibre/lamaste').AgentHalfSpec | null}
 */
export function installedAgentHalf(plugin) {
  const declaration = agentHalfOf({ agent: plugin.agent });
  if (!declaration) return null;
  const pin = plugin.agentHalfPin;
  if (!pin || pin.package !== declaration.package || pin.version !== plugin.version) {
    throw httpError(
      `The agent half of "${plugin.name}" ${plugin.version} has no pinned integrity — reinstall the plugin`,
      409,
    );
  }
  return { ...declaration, version: pin.version, integrity: pin.integrity };
}

/**
 * What approving a plugin version covers — its relay hook set, the agent
 * half Lamaste installs and its identity block (normalized, as the registry
 * stores it) — and the digest the approval names. `digest` is null when
 * there is nothing to approve. A plugin without an identity block has the
 * digest it had before identity existed.
 */
export function installedApproval(plugin) {
  const relay = installedRelayHooks(plugin);
  const agentHalf = installedAgentHalf(plugin);
  const identity = plugin.identity ?? null;
  const required = relay !== null || agentHalf !== null || identity !== null;
  return {
    relay,
    agentHalf,
    identity,
    required,
    digest: required
      ? approvalDigest({
          relay: relay ? { set: relay.set, entrySha256: relay.entrySha256 } : null,
          agentHalf,
          identity,
        })
      : null,
  };
}

/** Whether `state` approves the installed version (nothing to approve counts as approved). */
function isApproved(approval, state) {
  return !approval.required || state?.approvedDigest === approval.digest;
}

/**
 * Whether the installed version is approved — it brings no relay hooks, no
 * agent half Lamaste installs and no identity block, or its digest is the
 * approved one. Relay hooks run, the plugin is hosted and its users are
 * sent to it only then.
 */
export async function installedVersionApproved(plugin) {
  const approval = installedApproval(plugin);
  if (!approval.required) return true;
  return isApproved(approval, await readHookState(plugin.name));
}

/**
 * What the panel shows about a plugin's hooks, its agent half, its identity
 * (`identity`: whether the installed version declares it, whether that
 * version is approved, and the normalized block) and their approval.
 */
export async function hookStatus(plugin) {
  const approval = installedApproval(plugin);
  const { relay, agentHalf, identity } = approval;
  const agent = agentHookSetOf({ hooks: plugin.hooks });
  const state = await readHookState(plugin.name);
  const approved = isApproved(approval, state);
  let pendingUpdate = null;
  if (state?.pendingUpdate) {
    const { withIdentityGrantImpact } = await import('./entitlements.js');
    pendingUpdate = await withIdentityGrantImpact(
      pendingUpdateView(state.pendingUpdate),
      plugin.route,
    );
  }
  return {
    relay: relay ? relayHookSetPreview(relay.set, relay.entrySha256) : null,
    agent,
    agentHalf: agentHalf ? agentHalfPreview(derivePluginRoute(plugin.name), agentHalf) : null,
    identity: {
      declared: identity !== null,
      approved: identity !== null && approved,
      block: identity,
    },
    approval: {
      required: approval.required,
      state: !approval.required ? 'not-required' : approved ? 'approved' : 'pending',
      // The digest to approve the installed version with (relay hooks and agent half).
      digest: approval.digest,
      approvedDigest: state?.approvedDigest ?? null,
      approvedVersion: state?.approvedVersion ?? null,
      approvedAt: state?.approvedAt ?? null,
      approvedBy: state?.approvedBy ?? null,
    },
    autoApprove: state?.autoApprove ?? false,
    runner: {
      installedDigest: state?.installedDigest ?? null,
      current: relay !== null && approved && state?.installedDigest === relay.digest,
    },
    pendingUpdate,
  };
}

/** Why an update waits: its approval digest is not the approved one. */
export const DIGEST_UNAPPROVED = 'digest.unapproved';
/** Why an update waits: it turns secret settings into plain ones. */
export const SETTINGS_SECRET_TO_PLAIN = 'settings.secret-to-plain';
/** Why an update waits: it adds or removes a role, or widens the attributes it receives. */
export const IDENTITY_CHANGED = 'identity.changed';

/**
 * The reason a staged version waits because what it brings — its relay
 * hooks (`relay`), the agent half Lamaste installs (`agentHalf`), its
 * identity block (`identity`); each truthy when it brings one — is not what
 * was approved.
 *
 * @returns {{ code: string, reason: string }}
 */
export function digestUnapprovedReason({ relay, agentHalf, identity = null }) {
  const parts = [
    ...(relay || (!agentHalf && !identity) ? ['relay hooks'] : []),
    ...(agentHalf ? ['agent half'] : []),
    ...(identity ? ['identity'] : []),
  ];
  const named =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const verb = parts.length === 1 && parts[0] !== 'relay hooks' ? 'is' : 'are';
  return { code: DIGEST_UNAPPROVED, reason: `its ${named} ${verb} not what was approved` };
}

/**
 * Why a stored pending update waits for an administrator. A record staged
 * before the reasons were stored waited for one reason only: its digest.
 *
 * @returns {Array<{ code: string, reason: string }>}
 */
function pendingApprovalRequired(pending) {
  return (
    pending.approvalRequired ?? [
      digestUnapprovedReason({
        relay: pending.preview,
        agentHalf: pending.agentHalf,
        identity: pending.identity?.after ?? null,
      }),
    ]
  );
}

/**
 * A staged update waiting for approval as clients see it — in the hook
 * status and in the update response alike: its version, the digest to
 * approve it with (null when it brings neither relay hooks nor an agent
 * half Lamaste installs nor an identity block: it is approved by its
 * version), what it brings (its relay hook set and the agent half Lamaste
 * installs, each null when it brings none), how it changes the settings
 * schema (`settings`: `{ added: [{ key, type }], removed: [{ key, type }],
 * retyped: [{ key, from, to }], newRequired: [key], secretToPlain: [key] }`,
 * null when neither version declares settings — not part of the digest),
 * how it changes the identity block (`identity`: `{ before, after,
 * rolesAdded, rolesRemoved, attributesAdded, attributesRemoved,
 * labelsChanged }` with the normalized blocks, null when neither version
 * declares one — part of the digest), why it waits for an administrator
 * (`approvalRequired`: `[{ code, reason }]`, `digest.unapproved`,
 * `settings.secret-to-plain` and `identity.changed`; never empty), and —
 * when the plugin has auto-approve on — why auto-approve did not cover it
 * (`autoApproveWithheld`, sentences; null otherwise). The stored record
 * names the relay hook set's preview `preview`.
 */
export function pendingUpdateView(pending) {
  return {
    version: pending.version,
    digest: pending.digest ?? null,
    stagedAt: pending.stagedAt,
    relay: pending.preview ?? null,
    agentHalf: pending.agentHalf ?? null,
    settings: pending.settings ?? null,
    identity: pending.identity ?? null,
    approvalRequired: pendingApprovalRequired(pending),
    autoApproveWithheld: pending.autoApproveWithheld ?? null,
  };
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

/**
 * Put the plugin's approved relay hook module into its runner when the
 * runner does not hold it — after an approval, an update, and at start-up
 * (a redeploy may have reset the install directory). Reads the module from
 * the installed package and refuses it when its SHA-256 is not the one the
 * approval names. Returns whether anything changed.
 */
export async function ensureRelayHooksInstalled(plugin, logger) {
  const approval = installedApproval(plugin);
  const { relay } = approval;
  if (!relay) return false;
  const state = await readHookState(plugin.name);
  if (!isApproved(approval, state)) return false;
  const installedEntry = await runnerManager.installedEntry(plugin.name);
  if (installedEntry !== undefined && installedEntry === relay.entrySha256) {
    if (state.installedDigest !== relay.digest) {
      await writeHookState(plugin.name, { installedDigest: relay.digest });
    }
    return false;
  }
  let moduleBytes = null;
  if (relay.entrySha256 !== null) {
    const dir = await installedPackageDir(plugin.packageName);
    moduleBytes = await readInstalledHookModule(dir, relay.set.entry);
    if (hookEntrySha256(moduleBytes) !== relay.entrySha256) {
      throw httpError(
        `The relay hook module of "${plugin.name}" changed on disk since it was approved — reinstall the plugin`,
        409,
      );
    }
  }
  await runnerManager.install(plugin.name, relay.entrySha256, moduleBytes);
  await writeHookState(plugin.name, { installedDigest: relay.digest });
  logger?.info({ plugin: plugin.name, digest: relay.digest }, 'Relay hook runner installed');
  return true;
}

/**
 * Put a module whose hook set is already approved into the plugin's runner
 * — an update, before its package is installed (the new version's relay
 * stages run from it) — and record that set (`digest`, the relay hook set's
 * own digest) as the one the runner holds. `moduleBytes` null: shared hooks
 * only.
 *
 * @param {string} plugin
 * @param {{ digest: string, entrySha256: string | null, moduleBytes: Buffer | null }} module
 */
export async function installRunnerModule(plugin, { digest, entrySha256, moduleBytes }) {
  await runnerManager.install(plugin, entrySha256, moduleBytes);
  await writeHookState(plugin, { installedDigest: digest });
}

/**
 * Point the runner back at a module it kept (the previous one, of relay hook
 * set `digest`) — reverting an update — and record that set as the one it
 * holds again. lamaste-priv keeps the active module and the one before it.
 *
 * @param {string} plugin
 * @param {{ digest: string, entrySha256: string | null }} module
 */
export async function restoreRunnerModule(plugin, { digest, entrySha256 }) {
  if (entrySha256 === null) await runnerManager.install(plugin, null, null);
  else await runnerManager.activate(plugin, entrySha256);
  await writeHookState(plugin, { installedDigest: digest });
}

/** Remove the plugin's runner, keeping its approval state. */
export async function removeRunner(plugin) {
  if ((await runnerManager.installedEntry(plugin)) !== undefined)
    await runnerManager.remove(plugin);
  if (await readHookState(plugin)) await writeHookState(plugin, { installedDigest: null });
}

/** Remove the plugin's runner and its approval state (uninstall). */
export async function removeRelayHooks(plugin, logger) {
  const state = await readHookState(plugin);
  if (state?.installedDigest || (await runnerManager.installedEntry(plugin)) !== undefined) {
    await runnerManager.remove(plugin);
    logger?.info({ plugin }, 'Relay hook runner removed');
  }
  await deleteHookState(plugin);
}

const lastRestart = new Map();

/**
 * Restart a runner that let a hook overrun its deadline — a hook in a busy
 * loop blocks the whole runner, so the next call must get a fresh one. At
 * most once per {@link RUNNER_RESTART_MIN_INTERVAL_MS} per plugin.
 */
export async function restartRelayHookRunner(plugin, logger) {
  const now = Date.now();
  if (now - (lastRestart.get(plugin) ?? 0) < RUNNER_RESTART_MIN_INTERVAL_MS) return false;
  lastRestart.set(plugin, now);
  try {
    await runnerManager.restart(plugin);
    logger?.warn({ plugin }, 'Restarted a relay hook runner after a hook timed out');
    return true;
  } catch (err) {
    logger?.error({ plugin, err: err.message }, 'Failed to restart the relay hook runner');
    return false;
  }
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

/**
 * An administrator approves what a plugin version brings — its relay hook
 * set, the agent half Lamaste installs and its identity block — with the
 * digest they were shown: the installed version's, or a pending update's.
 * A pending update is also approved by naming its `version`, with its
 * digest when it has one — the only way to approve one that brings neither
 * relay hooks nor an agent half nor an identity block (its digest is
 * null), and what binds the approval of a settings change to the release
 * that was shown. Approving an installed version that declares identity
 * computes its audience and sends it to its agent half.
 *
 * The installed version's approval is recorded here, in the hook state and
 * the audit log. A pending update's is checked against the update that is
 * waiting and handed back for the caller to apply (`updatePlugin` with
 * `approvedUpdate`): its version, its digest and the secret settings it
 * turns plain as they were shown. It approves everything the update waits
 * for (`approvalRequired`), its digest changed or not, and is audited when
 * the update starts under it.
 *
 * @param {object} plugin the installed registry entry
 * @param {string | null} digest
 * @param {{ actor: string, certSerial: string | null, logger?: object, version?: string | null }} options
 * @returns {Promise<{ target: 'installed', digest: string } | { target: 'update', digest: string | null, version: string, secretToPlain: string[] }>}
 */
export async function approveHookSet(
  plugin,
  digest,
  { actor, certSerial, logger, version = null },
) {
  const approval = installedApproval(plugin);
  const { relay } = approval;
  const state = await readHookState(plugin.name);
  const pending = state?.pendingUpdate ?? null;
  const now = new Date().toISOString();

  if (version !== null) {
    if (!pending) {
      throw httpError(`Plugin "${plugin.name}" has no update waiting for approval`, 409);
    }
    if (pending.version !== version) {
      throw httpError(
        `The update waiting for approval is version ${pending.version}, not ${version} — review it again`,
        409,
      );
    }
    const pendingDigest = pending.digest ?? null;
    if (digest === null && pendingDigest !== null) {
      throw httpError(
        `Version ${version} brings relay hooks, an agent half or an identity block — approve it with the approval digest it shows`,
        400,
      );
    }
    if (digest !== pendingDigest) {
      throw httpError(
        `What version ${version} brings changed since it was shown — review it again`,
        409,
        {
          currentDigest: pendingDigest,
        },
      );
    }
    return pendingUpdateApproval(pending);
  }
  if (digest === null) {
    throw httpError(
      "Approving names the approval digest that was shown, or a pending update's version",
      400,
    );
  }
  if (pending && pending.digest === digest) return pendingUpdateApproval(pending);
  if (!approval.required) {
    throw httpError(
      `Plugin "${plugin.name}" has no relay hooks, no agent half Lamaste installs and no identity block — nothing to approve`,
      400,
    );
  }
  if (approval.digest !== digest) {
    throw httpError('The hook set changed since it was shown — review it again', 409, {
      currentDigest: approval.digest,
    });
  }
  await writeHookState(plugin.name, {
    approvedDigest: digest,
    approvedVersion: plugin.version,
    approvedAt: now,
    approvedBy: actor,
    packVersions: relay ? relayHookSetPackVersions(relay.set) : {},
  });
  await recordAudit({
    actor,
    action: 'hooks.approved',
    plugin: plugin.name,
    details: { digest, version: plugin.version, for: 'installed', certSerial },
  });
  await ensureRelayHooksInstalled(plugin, logger);
  // An approved identity block lets the plugin's users through: its
  // audience is computed and sent to its agent half (when it is hosted), and
  // the hosts its user surface is bound to start serving it.
  if (approval.identity) {
    const { refreshPluginIdentity } = await import('./identity-sync.js');
    await refreshPluginIdentity(plugin.name, logger);
    const { refreshUserSurfaceVhosts } = await import('./user-surface.js');
    await refreshUserSurfaceVhosts(plugin.route, logger);
  }
  return { target: 'installed', digest };
}

/** What approving the pending update `pending` hands its caller to apply: the update as it was shown. */
function pendingUpdateApproval(pending) {
  return {
    target: 'update',
    digest: pending.digest ?? null,
    version: pending.version,
    secretToPlain: pending.settings?.secretToPlain ?? [],
  };
}

/**
 * Record an approval of an applied update (by an admin or auto-approve):
 * `digest` is the version's approval digest (`installedApproval`).
 */
export async function recordApprovedSet(plugin, digest, version, approvedBy) {
  const relay = installedRelayHooks(plugin);
  await writeHookState(plugin.name, {
    approvedDigest: digest,
    approvedVersion: version,
    approvedAt: new Date().toISOString(),
    approvedBy,
    pendingUpdate: null,
    packVersions: relay ? relayHookSetPackVersions(relay.set) : {},
  });
}

export async function setPendingUpdate(plugin, pendingUpdate) {
  await writeHookState(plugin, { pendingUpdate });
}

/** The fallback the plugin's `tunnel:down` hook returned (null clears it, on `tunnel:up`). */
export async function setTunnelFallback(plugin, fallback) {
  await writeHookState(plugin, { tunnelFallback: fallback ?? null });
}

export async function setAutoApprove(plugin, enabled, { actor, certSerial }) {
  const state = await readHookState(plugin);
  if ((state?.autoApprove ?? false) === enabled) return { autoApprove: enabled };
  await writeHookState(plugin, { autoApprove: enabled });
  await recordAudit({
    actor,
    action: enabled ? 'hooks.auto-approve.enabled' : 'hooks.auto-approve.disabled',
    plugin,
    details: { certSerial },
  });
  return { autoApprove: enabled };
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

/**
 * At start-up: make sure each approved runner holds its module, and audit
 * — once per plugin — a shared-hook rule pack that changed with this Lamaste
 * version (rules ride Lamaste releases and need no re-approval).
 */
export async function reconcileRelayHooks(plugins, logger) {
  for (const plugin of plugins) {
    try {
      const approval = installedApproval(plugin);
      const { relay } = approval;
      if (!relay) continue;
      const state = await readHookState(plugin.name);
      if (!isApproved(approval, state)) {
        logger?.info({ plugin: plugin.name }, 'Relay hooks wait for approval');
        continue;
      }
      await ensureRelayHooksInstalled(plugin, logger);
      const packs = relayHookSetPackVersions(relay.set);
      const before = state.packVersions ?? {};
      const changed = Object.keys(packs).filter((p) => before[p] !== packs[p]);
      if (changed.length > 0) {
        await writeHookState(plugin.name, { packVersions: packs });
        const from = changed.map((p) => `${p}@${before[p] ?? '-'}`).join(',');
        const to = changed.map((p) => `${p}@${packs[p]}`).join(',');
        await recordAuditBestEffort(
          {
            actor: 'lamaste',
            action: 'hooks.rules-updated',
            plugin: plugin.name,
            details: { from, to },
          },
          logger,
        );
        await notifyAdminsBestEffort(
          {
            source: 'lamaste',
            level: 'info',
            message: `Secret-scan rules used by ${plugin.name} were updated with Lamaste (${to}).`,
          },
          logger,
        );
      }
    } catch (err) {
      logger?.error(
        { plugin: plugin.name, err: err.message },
        'Failed to reconcile the relay hook runner',
      );
    }
  }
}
