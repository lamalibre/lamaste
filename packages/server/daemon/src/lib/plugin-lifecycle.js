/**
 * Plugin lifecycle operations that span hosting and hooks:
 *
 * - **Uninstall** of a hosted plugin: the uninstall pipeline first (its
 *   hooks, tunnel, the agent half Lamaste installed, secret, capability),
 *   then the package — one operation.
 * - **Update** of an agent-hosted plugin in place: the new version is
 *   fetched and read without installing it, and the agent half it brings is
 *   pinned (its tarball's integrity, from the registry); when what it
 *   brings — relay hooks, agent half — differs from what was approved it
 *   waits for an administrator's approval (or the plugin's auto-approve)
 *   and the installed version stays live; then the install pipeline runs
 *   with `phase: "upgrade"` around installing it — the new agent half
 *   first, then the relay package — and a failure restores the previous
 *   version on both sides. Settings are outside the approval: the preview
 *   lists how the settings schema changes (`pendingUpdate.settings`),
 *   auto-approve does not cover a version that turns a secret setting into
 *   a plain one, and the relay re-reads the agent half's settings after
 *   the update.
 */

import {
  ManifestValidationError,
  agentHalfPreview,
  derivePluginRoute,
  hasAgentHalf,
  hookEntrySha256,
  relayHookSetNeedsEntry,
  relayHookSetOf,
  relayHookSetPreview,
  settingsSchemaDiff,
  validateManifest,
} from '@lamalibre/lamaste';
import { pluginHostingPhase } from '@lamalibre/lamaste/server';
import { httpError } from './app-error.js';
import { setPluginCapabilities } from './mtls.js';
import {
  findPlugin,
  getPluginCapabilities,
  manifestPolicyError,
  replacePluginPackage,
  uninstallPlugin,
  writePluginRow,
} from './plugins.js';
import { pinAgentHalf, readRegistryPackage } from './plugin-packages.js';
import {
  installRunnerModule,
  installedAgentHalf,
  installedApproval,
  installedRelayHooks,
  pendingUpdateView,
  readHookState,
  recordApprovedSet,
  removeRunner,
  restoreHookState,
  restoreRunnerModule,
  setPendingUpdate,
} from './plugin-hooks.js';
import {
  StageFailure,
  isPluginOperationRunning,
  startPluginOperation,
} from './plugin-operations.js';
import {
  assertAgentEligible,
  assertAgentHalfPush,
  isActiveAgent,
  isPluginHosted,
  logAgentHalfPush,
  ownHosting,
  prepareHostingRemoval,
  retainedDataOf,
  teardownHosting,
} from './plugin-hosting.js';
import { pipelineContext, runUpgradePipeline } from './hook-pipelines.js';
import { getConfig } from './config.js';
import { recordAudit, recordAuditBestEffort } from './audit.js';
import { notifyAdminsBestEffort } from './notifications.js';
import { refreshPluginSettingsBestEffort, settingsBlockOf } from './plugin-settings.js';

/** Replaces the OIDC client sync (tests: there is no Authelia to write to). */
let oidcSyncOverride = null;

/** @param {((logger: object) => Promise<{ createdSecrets?: Array<{ id: string, secret: string }> } | null>) | null} sync */
export function setOidcSyncForTests(sync) {
  oidcSyncOverride = sync;
}

/**
 * Bring Authelia's OIDC clients in line with the installed plugins (best
 * effort: logged, never thrown). Returns the secrets of the confidential
 * clients the sync created (`[{ id, secret }]`) — shown to the admin once.
 *
 * @returns {Promise<Array<{ id: string, secret: string }>>}
 */
async function syncOidcBestEffort(logger) {
  try {
    const syncOidcClients = oidcSyncOverride ?? (await import('./plugin-oidc.js')).syncOidcClients;
    const result = await syncOidcClients(logger);
    return (result?.createdSecrets ?? []).map(({ id, secret }) => ({ id, secret }));
  } catch (err) {
    logger?.warn({ err: err.message }, 'Failed to sync plugin OIDC clients to Authelia');
    return [];
  }
}

// ---------------------------------------------------------------------------
// Uninstall
// ---------------------------------------------------------------------------

/**
 * Uninstall plugin `name`. A plugin that is not hosted is removed at once
 * (`{ removed }`); a hosted one by an operation (`{ operation }`). `purge`
 * (a hosted plugin whose agent half Lamaste installed) removes the agent
 * half's data directory and service account too; `sourceIp` is the
 * admin's, for the push-install gates of removing that agent half.
 */
export async function uninstallPluginWithHosting(
  name,
  { actor, logger, force = false, purge = false, sourceIp },
) {
  const plugin = await findPlugin(name);
  if (!plugin) throw httpError(`Plugin "${name}" not found`, 404);
  if (plugin.status === 'enabled') {
    throw httpError(`Plugin "${name}" must be disabled before uninstalling`, 400);
  }
  if (isPluginOperationRunning(name)) {
    throw httpError(`Plugin "${name}" has an operation in progress — wait for it to finish`, 409);
  }
  // Only the plugin's own hosting: never one another plugin holds on its route.
  const record = hasAgentHalf(plugin) ? await ownHosting(plugin) : null;
  if (!record) {
    if (purge) {
      const retained = await retainedDataOf(name);
      throw httpError(
        retained.length > 0
          ? `Plugin "${name}" is not hosted — the data agents keep of it (${retained.map((r) => r.agentLabel).join(', ')}) is purged per agent: Purge under Retained data on the Plugins page, or lamaste-server plugins purge-data ${name} --agent <label>`
          : `Plugin "${name}" is not hosted and no agent keeps data of it — nothing to purge`,
        400,
      );
    }
    const removed = await uninstallPlugin(name, logger);
    setPluginCapabilities(await getPluginCapabilities());
    await recordAuditBestEffort({ actor, action: 'plugin.uninstalled', plugin: name }, logger);
    return { removed };
  }
  const push = await prepareHostingRemoval(plugin, record, { purge, sourceIp });
  const { operation } = await startPluginOperation({
    plugin: name,
    kind: 'uninstall',
    actor,
    params: { force, ...(purge ? { purge } : {}) },
    logger,
    run: async (op) => {
      await teardownHosting(op, plugin, { force, purge, logger });
      if (await isPluginHosted(name)) {
        throw new StageFailure('The hosting could not be removed — the plugin stays installed');
      }
      await op.step('remove the package', () => uninstallPlugin(name, logger));
      setPluginCapabilities(await getPluginCapabilities());
      await recordAuditBestEffort(
        { actor, action: 'plugin.uninstalled', plugin: name, details: { operation: op.id } },
        logger,
      );
      return { status: 'succeeded' };
    },
  });
  await logAgentHalfPush(push, operation.id, logger);
  return { operation };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Why auto-approve does not cover a new version's agent half, compared
 * with the installed one (`before`): the agent's helper installs it, and
 * its system packages, as root, so an agent half where there was none,
 * another agent package, added system packages or another service spec
 * wait for an administrator. A new version and tarball of the same agent
 * half — what every release brings — do not. Empty when auto-approve
 * covers it.
 *
 * @param {import('@lamalibre/lamaste').AgentHalfSpec | null} before
 * @param {import('@lamalibre/lamaste').AgentHalfSpec | null} after
 * @returns {string[]}
 */
export function autoApproveWithheld(before, after) {
  return agentHalfWithheld(before, after).map((reason) => reason.message);
}

/**
 * {@link autoApproveWithheld}, each reason with its stable code (what the
 * audit entry records beside the sentence): `agent-half.added`,
 * `agent-half.package`, `agent-half.system-packages`, `agent-half.entry`,
 * `agent-half.memory-max`.
 *
 * @returns {Array<{ code: string, message: string }>}
 */
function agentHalfWithheld(before, after) {
  if (!after) return [];
  if (!before) {
    return [{ code: 'agent-half.added', message: 'it brings an agent half Lamaste installs' }];
  }
  const reasons = [];
  if (after.package !== before.package) {
    reasons.push({
      code: 'agent-half.package',
      message: `its agent package changes (${before.package} → ${after.package})`,
    });
  }
  const added = after.systemPackages.filter((p) => !before.systemPackages.includes(p));
  if (added.length > 0) {
    reasons.push({
      code: 'agent-half.system-packages',
      message: `it adds system packages (${added.join(', ')})`,
    });
  }
  if (after.service.entry !== before.service.entry) {
    reasons.push({
      code: 'agent-half.entry',
      message: `its service entry changes (${before.service.entry} → ${after.service.entry})`,
    });
  }
  if (after.service.memoryMax !== before.service.memoryMax) {
    reasons.push({
      code: 'agent-half.memory-max',
      message: `its service memory limit changes (${before.service.memoryMax ?? 'none'} → ${after.service.memoryMax ?? 'none'})`,
    });
  }
  return reasons;
}

/**
 * Why auto-approve does not cover a version because of how it changes the
 * settings schema: fields that are secrets now and plain values after it
 * (`settings.secret-to-plain`). Their secrets are dropped on both sides,
 * never moved — but whatever an administrator types into them next is kept
 * on the relay and shown in clear, which a plugin release must not decide
 * on its own. Settings are outside the approval digest; this only keeps
 * auto-approve from covering such an update.
 *
 * @param {import('@lamalibre/lamaste').SettingsSchemaDiff | null} diff
 * @returns {Array<{ code: string, message: string }>}
 */
export function settingsWithheld(diff) {
  const keys = diff?.secretToPlain ?? [];
  if (keys.length === 0) return [];
  return [
    {
      code: 'settings.secret-to-plain',
      message: `it turns secret settings into plain ones (${keys.join(', ')}) — what is typed into them next is kept on the relay and shown in clear`,
    },
  ];
}

/**
 * What a staged version brings, read without installing it: its manifest,
 * its relay hook set and module, the agent half pinned for it, and the
 * approval that covers them (`installedApproval` over the staged entry).
 *
 * @param {object} plugin the installed registry entry
 * @param {string} requestedVersion
 * @param {object | null} record the plugin's hosting, if any
 */
async function stageVersion(plugin, requestedVersion, record) {
  const staged = await readRegistryPackage(plugin.packageName, requestedVersion);
  let manifest;
  try {
    manifest = validateManifest(staged.manifestRaw);
  } catch (err) {
    if (err instanceof ManifestValidationError) {
      throw httpError(
        `Invalid plugin manifest in ${staged.version}: ${err.issues.map((i) => i.message).join(', ')}`,
        400,
      );
    }
    throw err;
  }
  if (manifest.name !== plugin.name) {
    throw httpError(
      `Version ${staged.version} is plugin "${manifest.name}", not "${plugin.name}"`,
      400,
    );
  }
  if (manifest.version !== staged.version) {
    throw httpError(
      `Version ${staged.version} declares version ${manifest.version} in its manifest`,
      400,
    );
  }
  if (manifest.hosting !== 'agent') {
    throw httpError('Version changes the plugin to a server plugin — reinstall it instead', 400);
  }
  const policy = await manifestPolicyError(manifest);
  if (policy) throw httpError(policy.message, policy.statusCode);
  if (hasAgentHalf(plugin) && !hasAgentHalf(manifest) && record) {
    throw httpError(
      'Version drops the agent half of a hosted plugin — clear its hosting first',
      400,
    );
  }

  // The agent half's tarball is pinned now: approval binds it, and the
  // agent installs only a tarball that matches.
  const agentHalfPin = await pinAgentHalf(manifest);
  if (record) {
    // Who installs the agent half cannot change under a hosting: Lamaste
    // would install a second copy beside the hand-installed one, or leave
    // its own behind unmanaged.
    if (agentHalfPin && !record.agentHalf) {
      throw httpError(
        `Version ${staged.version} has Lamaste install the agent half, which runs on agent "${record.agentLabel}" installed by hand — clear its hosting first`,
        400,
      );
    }
    if (!agentHalfPin && record.agentHalf) {
      throw httpError(
        `Version ${staged.version} no longer has an agent half Lamaste installs — clear its hosting first`,
        400,
      );
    }
  }

  const relaySet = relayHookSetOf(manifest);
  let moduleBytes = null;
  let entrySha256 = null;
  if (relaySet && relayHookSetNeedsEntry(relaySet) && relaySet.entry !== null) {
    moduleBytes = staged.readHookModule(relaySet.entry);
    if (!moduleBytes) {
      throw httpError(
        `Version ${staged.version} has no relay hook module at "${relaySet.entry}"`,
        400,
      );
    }
    entrySha256 = hookEntrySha256(moduleBytes);
  }
  // The staged version as a registry entry, so it is judged exactly as the
  // installed one will be.
  const entry = {
    ...plugin,
    version: staged.version,
    hooks: manifest.hooks,
    hooksEntrySha256: entrySha256,
    agent: manifest.agent,
    agentHalfPin,
    settings: manifest.settings,
  };
  const approval = installedApproval(entry);
  return {
    version: staged.version,
    manifest,
    entry,
    relaySet,
    moduleBytes,
    entrySha256,
    agentHalfPin,
    agentHalf: approval.agentHalf,
    // The relay hook set's own digest — what the runner holds.
    relayDigest: approval.relay?.digest ?? null,
    approvalRequired: approval.required,
    // The approval digest (relay hooks and agent half), or null when nothing needs approving.
    digest: approval.digest,
  };
}

/**
 * How a staged version changes the settings schema, for the update's
 * preview (core's typed `settingsSchemaDiff`): fields added and removed
 * with their types, retyped ones `from` → `to` (a retyped field's value is
 * dropped on both sides, never converted), the fields the plugin will need
 * filled, and the secrets that become plain values (`secretToPlain`, which
 * withholds auto-approve) — null when neither version declares settings.
 *
 * @param {object} plugin the installed registry entry
 * @param {object} manifest the staged version's manifest
 */
function settingsPreview(plugin, manifest) {
  const installed = settingsBlockOf(plugin);
  const staged = settingsBlockOf(manifest);
  if (!installed && !staged) return null;
  return settingsSchemaDiff(installed, staged);
}

/**
 * Update plugin `name` to `requestedVersion` (an exact version or a
 * dist-tag; default `latest`). Returns `{ upToDate }`, `{ pendingUpdate }`
 * (what it brings awaits approval — shaped as the hook status's
 * `pendingUpdate`) or `{ operation }`.
 *
 * `approvedDigest` is set when an administrator approves the pending
 * update: the version is fetched again and must still bring exactly that.
 * A hosted plugin whose agent half Lamaste installs is updated on its agent
 * too: the agent must be able to host the new version and the push-install
 * gates must allow `update` (`sourceIp`: the admin's) — checked when the
 * update starts, not while it waits for approval.
 */
export async function updatePlugin(
  name,
  requestedVersion,
  { actor, certSerial, logger, approvedDigest = null, sourceIp },
) {
  const plugin = await findPlugin(name);
  if (!plugin) throw httpError(`Plugin "${name}" not found`, 404);
  if (plugin.hosting !== 'agent') {
    throw httpError(
      'Updating in place is for agent-hosted plugins; a server plugin is reinstalled (its code runs in the panel)',
      400,
    );
  }
  if (isPluginOperationRunning(name)) {
    throw httpError(`Plugin "${name}" has an operation in progress — wait for it to finish`, 409);
  }

  const record = await ownHosting(plugin);
  const staged = await stageVersion(plugin, requestedVersion ?? 'latest', record);
  if (staged.version === plugin.version) return { upToDate: true, version: plugin.version };
  if (
    record &&
    pluginHostingPhase(record) !== 'active' &&
    (staged.agentHalf || installedAgentHalf(plugin))
  ) {
    throw httpError(
      `Plugin "${name}" is ${pluginHostingPhase(record)} on agent "${record.agentLabel}" — finish removing its hosting before updating`,
      409,
    );
  }

  const state = await readHookState(name);
  let approvedBy = null;
  let autoApproved = false;
  if (staged.approvalRequired) {
    if (state?.approvedDigest === staged.digest) {
      approvedBy = state.approvedBy ?? 'unchanged';
    } else if (approvedDigest !== null) {
      if (approvedDigest !== staged.digest) {
        throw httpError(
          `Version ${staged.version} no longer brings what was approved — review it again`,
          409,
        );
      }
      approvedBy = actor;
    } else {
      // Auto-approve covers a new version of the same agent half, never one
      // that changes what runs as root on the agent, nor one that turns a
      // secret setting into a plain one.
      const settings = settingsPreview(plugin, staged.manifest);
      const withheldReasons = state?.autoApprove
        ? [
            ...agentHalfWithheld(installedAgentHalf(plugin), staged.agentHalf),
            ...settingsWithheld(settings),
          ]
        : [];
      const withheld = withheldReasons.map((reason) => reason.message);
      if (state?.autoApprove && withheld.length === 0) {
        approvedBy = 'auto-approve';
        autoApproved = true;
      } else {
        const pendingUpdate = {
          version: staged.version,
          digest: staged.digest,
          stagedAt: new Date().toISOString(),
          preview: staged.relaySet
            ? relayHookSetPreview(staged.relaySet, staged.entrySha256)
            : null,
          agentHalf: staged.agentHalf
            ? agentHalfPreview(derivePluginRoute(plugin.name), staged.agentHalf)
            : null,
          settings,
          ...(withheld.length > 0 ? { autoApproveWithheld: withheld } : {}),
        };
        await setPendingUpdate(name, pendingUpdate);
        if (withheld.length > 0) {
          await recordAudit({
            actor: 'auto-approve',
            action: 'hooks.auto-approve.withheld',
            plugin: name,
            details: {
              digest: staged.digest,
              version: staged.version,
              reasons: withheld,
              codes: withheldReasons.map((reason) => reason.code),
              requestedBy: actor,
            },
          });
        }
        await recordAudit({
          actor,
          action: 'plugin.update.awaiting-approval',
          plugin: name,
          details: { from: plugin.version, to: staged.version, digest: staged.digest, certSerial },
        });
        await notifyAdminsBestEffort(
          {
            source: 'lamaste',
            level: 'warning',
            message:
              withheld.length > 0
                ? `${name} ${staged.version} waits for your approval — auto-approve does not cover it: ${withheld.join('; ')}.`
                : staged.agentHalf
                  ? `${name} ${staged.version} brings a new agent half${staged.relaySet ? ' and relay hooks' : ''} — it waits for your approval.`
                  : `${name} ${staged.version} brings a changed relay hook set — it waits for your approval.`,
          },
          logger,
        );
        return { pendingUpdate: pendingUpdateView(pendingUpdate) };
      }
    }
  }

  // The agent half goes onto the hosting agent: a push the agent must be
  // able to take, and the gates must allow.
  const hosted = record !== null && pluginHostingPhase(record) === 'active';
  let push = null;
  if (hosted && staged.agentHalf) {
    if (!(await isActiveAgent(record.agentLabel))) {
      throw httpError(
        `Agent "${record.agentLabel}" hosting "${name}" is no longer enrolled — remove the plugin's hosting before updating it`,
        409,
      );
    }
    await assertAgentEligible(
      record.agentLabel,
      staged.manifest.agent?.requires,
      staged.agentHalf,
      plugin.name,
    );
    push = await assertAgentHalfPush(
      record.agentLabel,
      sourceIp,
      'update',
      staged.agentHalf.package,
    );
  }
  if (autoApproved) {
    await recordAudit({
      actor: 'auto-approve',
      action: 'hooks.approved',
      plugin: name,
      details: {
        digest: staged.digest,
        version: staged.version,
        for: 'update',
        requestedBy: actor,
      },
    });
  }

  const { operation } = await startPluginOperation({
    plugin: name,
    kind: 'update',
    actor,
    params: { from: plugin.version, to: staged.version },
    logger,
    run: (op) => applyUpdate(op, { plugin, staged, approvedBy, actor, logger }),
  });
  await logAgentHalfPush(push, operation.id, logger);
  return { operation };
}

async function applyUpdate(op, { plugin, staged, approvedBy, actor, logger }) {
  const name = plugin.name;
  const oldRelay = installedRelayHooks(plugin);
  const priorHookState = await readHookState(name);
  const record = await ownHosting(plugin);
  const hosted = record !== null && pluginHostingPhase(record) === 'active';
  const config = getConfig();
  const nextEntry = staged.entry;
  const ctx = pipelineContext({
    plugin: nextEntry,
    agentLabel: record?.agentLabel ?? null,
    domain: config.domain,
    email: config.email,
    logger,
  });
  ctx.version = staged.version;
  ctx.previousVersion = plugin.version;

  // The new version's relay stages run from its module: it goes into the
  // runner first (approved above); a failure points the runner back.
  if (staged.relaySet) {
    await op.step('install the new relay hook module', () =>
      installRunnerModule(name, {
        digest: staged.relayDigest,
        entrySha256: staged.entrySha256,
        moduleBytes: staged.moduleBytes,
      }),
    );
  }

  // Secrets of confidential OIDC clients the new version adds: shown once,
  // and only when the update stays (a revert deletes them again).
  let createdSecrets = [];
  const result = await runUpgradePipeline(op, ctx, {
    hosted,
    apply: async () => {
      const installed = await replacePluginPackage(
        name,
        plugin.packageName,
        staged.version,
        logger,
      );
      const installedEntry = {
        ...nextEntry,
        hooks: installed.manifest.hooks,
        hooksEntrySha256: installed.hooksEntrySha256,
        agent: installed.manifest.agent,
      };
      let approval;
      try {
        approval = installedApproval(installedEntry);
      } catch {
        approval = null;
      }
      if (!approval || approval.digest !== staged.digest) {
        throw new StageFailure('The installed package differs from the version that was reviewed');
      }
      await writePluginRow(
        name,
        installed.manifest,
        installed.hooksEntrySha256,
        staged.agentHalfPin,
      );
      if (approval.required) {
        await recordApprovedSet(installedEntry, approval.digest, staged.version, approvedBy);
      } else await setPendingUpdate(name, null);
      setPluginCapabilities(await getPluginCapabilities());
      createdSecrets = await syncOidcBestEffort(logger);
    },
    revert: async ({ applied }) => {
      if (applied) {
        const restored = await replacePluginPackage(
          name,
          plugin.packageName,
          plugin.version,
          logger,
        );
        await writePluginRow(
          name,
          restored.manifest,
          restored.hooksEntrySha256,
          plugin.agentHalfPin ?? null,
        );
        await restoreHookState(name, priorHookState);
        setPluginCapabilities(await getPluginCapabilities());
        await syncOidcBestEffort(logger);
      }
      if (staged.relaySet) {
        if (oldRelay) {
          await restoreRunnerModule(name, {
            digest: oldRelay.digest,
            entrySha256: oldRelay.entrySha256,
          });
        } else await removeRunner(name);
      }
    },
  });

  if (result.status === 'succeeded') op.revealOidcClientSecrets(createdSecrets);

  // The agent half may have dropped values the new version retyped or no
  // longer knows (and keeps that after a revert): the relay re-reads them.
  if (hosted) await refreshPluginSettingsBestEffort(name, logger);

  // Hooks the new version no longer has: the old runner goes once the new
  // version is in place.
  if (result.status === 'succeeded' && oldRelay && !staged.relaySet) {
    await removeRunner(name).catch((err) =>
      op.warn(`Could not remove the old hook runner: ${err.message}`),
    );
  }
  await recordAuditBestEffort(
    {
      actor,
      action: result.status === 'succeeded' ? 'plugin.updated' : 'plugin.update.reverted',
      plugin: name,
      details: {
        from: plugin.version,
        to: staged.version,
        approvedBy,
        hosted,
        operation: op.id,
      },
    },
    logger,
  );
  return result;
}
