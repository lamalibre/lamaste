/**
 * The identity feed — each plugin's audience (`lib/audience.js`) pushed to
 * its agent half through the internal tunnel, which the agent half cannot
 * reach the panel through (core `identity.ts`):
 *
 *     POST /admin/identity/notify   { protocol, directoryId, seq: head }
 *       → { protocol, directoryId, cursor }      what the half holds
 *     POST /admin/identity/changes  { protocol, directoryId, from, to, reset,
 *                                     reconcile, pass, final, changes: sealed }
 *
 * Lamaste's own calls (`callAgentHalf`: caller `lamaste`, the body hash
 * bound, the answer authenticated by its responder signature over the
 * body). A batch's `changes` are sealed to the request (core
 * `sealIdentityChanges`: AES-256-GCM, a key derived from the installation
 * secret, bound to the assertion's nonce and the envelope), so neither the
 * chisel server nor anything holding a loopback end of the tunnel sees a
 * member in clear. A half is *ready* for the installed version once it has
 * applied everything up to the head — a sync that ends with its cursor at
 * the head after at least one complete replay since it was hosted
 * (`ready_version`): users reach its `/app` only then
 * ({@link identityReadiness}), never with a half that answered the
 * notification but is still behind. It gets what it lacks:
 *
 * - **incremental** — the rows stamped after its cursor, in batches of at
 *   most `IDENTITY_BATCH_MAX_CHANGES` changes and `IDENTITY_BATCH_MAX_BYTES`;
 * - **replay from 0** — every row, the first batch `reset` from 0, the
 *   others stamping the same `pass` (`reconcile`), the last `final`: the
 *   half then marks every row the pass did not mention as removed. A replay
 *   is the snapshot: for a half that follows another directory (or none), a
 *   cursor ahead of the head, a half that has not completed one (the first
 *   sync since the plugin was installed or hosted, or after a replay was
 *   cut short), and the daily reconcile — every batch `reconcile`, the
 *   mismatches the half reports recorded and audited
 *   (`identity.reconcile.mismatches`) when there are any.
 *
 * When a hosting is removed, what the panel knew of its half goes with it
 * ({@link forgetIdentityHalf}).
 *
 * A 409 `cursor_mismatch` restarts from the cursor the half reports (or
 * replays, when it follows another directory). One sync per plugin at a
 * time; requests made while one runs share the next. Preconditions —
 * installed, declares `identity` (nothing identity is ever sent to a plugin
 * that does not: a half without the routes answers an unsigned 404), its
 * installed version approved, hosted, the hosting active and not down —
 * are checked first, and a sync that cannot run records why. Triggers: a
 * recompute that changed the plugin's rows, its half coming up
 * (`tunnel-hooks.js`), a hosting or update that succeeded, approval, the
 * panel's start, a minute's tick for a plugin that is behind or failed, the
 * daily reconcile, and the manual route.
 *
 * Logs carry the plugin, counts and cursors — never a member's attributes.
 */

import crypto from 'node:crypto';
import {
  AGENT_HALF_IDENTITY_CHANGES_PATH,
  AGENT_HALF_IDENTITY_NOTIFY_PATH,
  AudienceChangeSchema,
  IDENTITY_ANSWER_MAX_BYTES,
  IDENTITY_BATCH_MAX_BYTES,
  IDENTITY_BATCH_MAX_CHANGES,
  IDENTITY_PROTOCOL_VERSION,
  callAgentHalf,
  parseIdentityChangesAnswer,
  parseIdentityCursorConflict,
  parseIdentityNotifyAnswer,
  sealIdentityChanges,
} from '@lamalibre/lamaste';
import { pluginHostingPhase, signingSecretFor } from '@lamalibre/lamaste/server';
import { recordAuditBestEffort } from './audit.js';
import {
  audienceHead,
  audienceRowsAfter,
  audiencesIdle,
  audienceSummary,
  recomputeAudiences,
} from './audience.js';
import { getConfig } from './config.js';
import { clearPendingPrincipals, getDirectoryId, reconcileDirectory } from './directory.js';
import { ensurePrimaryDomain, syncDomainAccess } from './domains.js';
import { reconcileAuthBranding } from './auth-branding.js';
import { installedVersionApproved } from './plugin-hooks.js';
import { findPlugin, findPluginByRoute, readPlugins } from './plugins.js';
import { retainedIdentityPositions } from './retained-data.js';
import { getStateDb } from './state-db.js';

/** How long the half may take to answer a notification. */
const IDENTITY_NOTIFY_TIMEOUT_MS = 5_000;

/** How long the half may take to apply a batch (up to 1 MiB of changes). */
const IDENTITY_CHANGES_TIMEOUT_MS = 15_000;

/** The daily reconcile: a full replay at most this long after the last. */
const IDENTITY_RECONCILE_INTERVAL_MS = 24 * 60 * 60_000;

/** How often the panel reconciles the directory, recomputes the audiences and retries syncs. */
const IDENTITY_TICK_INTERVAL_MS = 60_000;

/** How many times one sync restarts after a 409 before it gives up until the next trigger. */
const SYNC_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Sync state
// ---------------------------------------------------------------------------

/**
 * @typedef {object} IdentitySyncState
 * @property {string | null} directoryId the directory the half follows, as it last answered
 * @property {number | null} cursor the seq it has applied up to, as it last answered
 * @property {string | null} readyVersion the plugin version whose half applied everything up to
 *   the head after a complete replay
 * @property {string | null} lastSyncAt the last sync that left the half up to date
 * @property {string | null} lastReconcileAt the last full replay
 * @property {number | null} lastMismatches what the last daily reconcile found
 * @property {string | null} lastError why the last sync did not finish, or was not tried
 * @property {string} updatedAt
 */

function rowToState(row) {
  if (!row) return null;
  return {
    directoryId: row.directory_id,
    cursor: row.cursor === null ? null : Number(row.cursor),
    readyVersion: row.ready_version,
    lastSyncAt: row.last_sync_at,
    lastReconcileAt: row.last_reconcile_at,
    lastMismatches: row.last_mismatches === null ? null : Number(row.last_mismatches),
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

/**
 * What the panel knows of plugin `name`'s feed, or null before its first
 * sync.
 *
 * @param {string} name
 * @returns {Promise<IdentitySyncState | null>}
 */
export async function readIdentitySyncState(name) {
  const db = await getStateDb();
  return rowToState(db.prepare('SELECT * FROM plugin_identity_sync WHERE plugin = ?').get(name));
}

/** Merge `patch` into plugin `name`'s sync state. */
async function writeSyncState(name, patch) {
  const db = await getStateDb();
  const current = (await readIdentitySyncState(name)) ?? {
    directoryId: null,
    cursor: null,
    readyVersion: null,
    lastSyncAt: null,
    lastReconcileAt: null,
    lastMismatches: null,
    lastError: null,
  };
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  db.prepare(
    `INSERT INTO plugin_identity_sync
       (plugin, directory_id, cursor, ready_version, last_sync_at, last_reconcile_at,
        last_mismatches, last_error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(plugin) DO UPDATE SET
       directory_id = excluded.directory_id,
       cursor = excluded.cursor,
       ready_version = excluded.ready_version,
       last_sync_at = excluded.last_sync_at,
       last_reconcile_at = excluded.last_reconcile_at,
       last_mismatches = excluded.last_mismatches,
       last_error = excluded.last_error,
       updated_at = excluded.updated_at`,
  ).run(
    name,
    next.directoryId,
    next.cursor,
    next.readyVersion,
    next.lastSyncAt,
    next.lastReconcileAt,
    next.lastMismatches,
    next.lastError,
    next.updatedAt,
  );
  return next;
}

/**
 * Forget what the panel knew of plugin `name`'s agent half: its hosting is
 * gone. The half of a later hosting gets the whole audience (a replay) and
 * is ready for users only once it has applied it. Where the removed half's
 * projection stood went with its data, when an agent retains that
 * (`recordRetainedData`), so the erasures owed there stay pending. The
 * audience itself stays: it is the plugin's ledger, not the hosting's.
 *
 * @param {string} name
 */
export async function forgetIdentityHalf(name) {
  const db = await getStateDb();
  db.prepare('DELETE FROM plugin_identity_sync WHERE plugin = ?').run(name);
}

// ---------------------------------------------------------------------------
// Readiness and pending erasures
// ---------------------------------------------------------------------------

/** The hosting installed plugin `plugin` owns, or null (see `ownHosting`). */
async function ownHostingOf(plugin) {
  const { ownHosting } = await import('./plugin-hosting.js');
  return ownHosting(plugin);
}

/**
 * @typedef {object} IdentityReadiness
 * @property {boolean} ready users may reach the plugin's `/app`
 * @property {boolean} declared the installed version declares `identity`
 * @property {boolean} approved the installed version is approved
 * @property {boolean} hostingActive its hosting is active
 * @property {string | null} version the installed version
 * @property {string | null} readyVersion the version whose half last applied everything up to
 *   the head after a complete replay
 * @property {'not_installed' | 'no_identity' | 'not_approved' | 'not_hosted' | 'not_answered' | null} reason
 */

/**
 * Whether the plugin on `route` is ready for user callers: it declares
 * `identity`, its installed version is approved, its hosting is active, and
 * its agent half — since this version was installed — applied every change
 * up to the head after a complete replay (answering protocol 1 alone is not
 * enough: a half that is still behind would serve stale roles and names).
 *
 * @param {string} route
 * @returns {Promise<IdentityReadiness>}
 */
export async function identityReadiness(route) {
  return readinessOf(await findPluginByRoute(route));
}

/** {@link identityReadiness} of an installed plugin's registry entry (null: not installed). */
async function readinessOf(plugin) {
  if (!plugin?.identity) {
    return {
      ready: false,
      declared: false,
      approved: false,
      hostingActive: false,
      version: plugin?.version ?? null,
      readyVersion: null,
      reason: plugin ? 'no_identity' : 'not_installed',
    };
  }
  // A version whose approval cannot even be judged (an agent half without
  // its pinned integrity) is not approved.
  const approved = await installedVersionApproved(plugin).catch(() => false);
  const record = await ownHostingOf(plugin);
  const hostingActive = record !== null && pluginHostingPhase(record) === 'active';
  const state = await readIdentitySyncState(plugin.name);
  const readyVersion = state?.readyVersion ?? null;
  const reason = !approved
    ? 'not_approved'
    : !hostingActive
      ? 'not_hosted'
      : readyVersion !== plugin.version
        ? 'not_answered'
        : null;
  return {
    ready: reason === null,
    declared: true,
    approved,
    hostingActive,
    version: plugin.version,
    readyVersion,
    reason,
  };
}

/** The seq up to which the half holds this directory's feed (0 when it follows another, or none). */
function acknowledgedCursor(state, directoryId) {
  return state && state.directoryId === directoryId && state.cursor !== null ? state.cursor : 0;
}

/**
 * The erasures plugin `name` has not acknowledged — wherever its data is:
 * while it is installed, the `remove/erased` rows of its ledger stamped
 * after the cursor its hosting's agent half last answered (every one when
 * no half has: the next hosting's half is sent them); for every agent that
 * retains data of it, those stamped after the position recorded with that
 * data (`retained-data.js`; every one when none was). User ids in `seq`
 * order, each once. An uninstalled plugin no agent keeps data of owes
 * nothing.
 *
 * @param {string} name
 * @returns {Promise<string[]>}
 */
export async function pendingErasures(name) {
  const directoryId = await getDirectoryId();
  const cursors = [];
  if (await findPlugin(name)) {
    cursors.push(acknowledgedCursor(await readIdentitySyncState(name), directoryId));
  }
  for (const position of await retainedIdentityPositions(name)) {
    cursors.push(
      position.directoryId === directoryId && position.cursor !== null ? position.cursor : 0,
    );
  }
  if (cursors.length === 0) return [];
  const db = await getStateDb();
  return db
    .prepare(
      `SELECT user_id FROM plugin_audience
       WHERE plugin = ? AND json_extract(change, '$.reason') = 'erased' AND seq > ?
       ORDER BY seq`,
    )
    .all(name, Math.min(...cursors))
    .map((row) => row.user_id);
}

/**
 * For every erased user some plugin has not acknowledged yet, those
 * plugins: `{ plugin, inactive }` — `inactive` when the plugin is not
 * installed or no longer declares identity, so the feed does not reach it:
 * an agent keeps its data (retained, or a hosted half that no longer takes
 * the feed), and the erasure reaches that data when the plugin comes back
 * — or goes with it when the data is purged.
 *
 * @returns {Promise<Map<string, Array<{ plugin: string, inactive: boolean }>>>}
 */
export async function pendingErasuresByUser() {
  const db = await getStateDb();
  const plugins = db
    .prepare(
      `SELECT DISTINCT plugin FROM plugin_audience
       WHERE json_extract(change, '$.reason') = 'erased' ORDER BY plugin`,
    )
    .all()
    .map((row) => row.plugin);
  const out = new Map();
  for (const plugin of plugins) {
    const inactive = !(await findPlugin(plugin))?.identity;
    for (const userId of await pendingErasures(plugin)) {
      out.set(userId, [...(out.get(userId) ?? []), { plugin, inactive }]);
    }
  }
  return out;
}

/**
 * Everything the panel shows about plugin `name`'s identity: the declared
 * block, readiness, the feed's state (with the head and how far behind the
 * half is), the audience counts and the erasures pending. Null when the
 * plugin is not installed.
 *
 * @param {string} name
 */
export async function identityView(name) {
  const plugin = await findPlugin(name);
  if (!plugin) return null;
  const readiness = await readinessOf(plugin);
  if (!plugin.identity) {
    // A plugin that stopped declaring identity may still owe erasures (its ledger).
    return {
      declared: null,
      readiness,
      sync: null,
      audience: null,
      pendingErasures: await pendingErasures(name),
    };
  }
  const directoryId = await getDirectoryId();
  const state = await readIdentitySyncState(name);
  const summary = await audienceSummary(name);
  const cursor = acknowledgedCursor(state, directoryId);
  return {
    declared: plugin.identity,
    readiness,
    sync: {
      directoryId,
      halfDirectoryId: state?.directoryId ?? null,
      cursor: state?.cursor ?? null,
      head: summary.head,
      behind: (await audienceRowsAfter(name, cursor)).length,
      readyVersion: state?.readyVersion ?? null,
      lastSyncAt: state?.lastSyncAt ?? null,
      lastReconcileAt: state?.lastReconcileAt ?? null,
      lastMismatches: state?.lastMismatches ?? null,
      lastError: state?.lastError ?? null,
    },
    audience: {
      active: summary.active,
      disabled: summary.disabled,
      removed: summary.removed,
      erased: summary.erased,
    },
    pendingErasures: await pendingErasures(name),
  };
}

// ---------------------------------------------------------------------------
// One sync
// ---------------------------------------------------------------------------

/**
 * The bytes of a batch request at its largest without its ciphertext:
 * numbers at their widest, flags `false`, the sealed changes' `v` and IV.
 */
function envelopeBytes(directoryId) {
  return Buffer.byteLength(
    JSON.stringify({
      protocol: IDENTITY_PROTOCOL_VERSION,
      directoryId,
      from: Number.MAX_SAFE_INTEGER,
      to: Number.MAX_SAFE_INTEGER,
      reset: false,
      reconcile: false,
      pass: crypto.randomUUID(),
      final: false,
      changes: { v: 1, iv: 'A'.repeat(16), ct: '' },
    }),
  );
}

/**
 * The largest JSON array of changes whose sealed request stays within
 * `IDENTITY_BATCH_MAX_BYTES` (the ciphertext is base64url: four characters
 * for every three bytes, the tag included).
 */
function maxChangesBytes(directoryId) {
  const room = IDENTITY_BATCH_MAX_BYTES - envelopeBytes(directoryId);
  // ceil((n + 16) * 4 / 3) <= room for this n (the 16 bytes: GCM's tag).
  return Math.floor((room * 3) / 4) - 16;
}

/**
 * The stored rows as the feed's changes, in batches of at most
 * `IDENTITY_BATCH_MAX_CHANGES` changes whose sealed request stays within
 * `IDENTITY_BATCH_MAX_BYTES`. Throws on a row that is not the contract.
 */
function batchesOf(rows, directoryId) {
  const limit = maxChangesBytes(directoryId);
  const batches = [];
  let current = [];
  // The array's brackets.
  let size = 2;
  for (const row of rows) {
    const change = { seq: row.seq, ...row.change };
    if (!AudienceChangeSchema.safeParse(change).success) {
      const err = new Error(
        `The audience holds a row that is not an identity change (user ${row.userId})`,
      );
      err.code = 'corrupt_row';
      throw err;
    }
    // One more byte for the comma between changes.
    const bytes = Buffer.byteLength(JSON.stringify(change)) + 1;
    if (
      current.length > 0 &&
      (current.length >= IDENTITY_BATCH_MAX_CHANGES || size + bytes > limit)
    ) {
      batches.push(current);
      current = [];
      size = 2;
    }
    current.push(change);
    size += bytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** What an answer that is not the contract is called — never its body. */
function describeFailure(result) {
  if (!result.ok) return `${result.code}: ${result.error}`;
  if (result.status === 404) return 'the agent half does not take the identity feed (404)';
  if (result.status === 400) {
    const protocol = result.body?.protocol;
    return protocol != null && protocol !== IDENTITY_PROTOCOL_VERSION
      ? `the agent half speaks identity protocol ${protocol}, not ${IDENTITY_PROTOCOL_VERSION}`
      : 'the agent half refused the identity call (400)';
  }
  return `the agent half answered the identity call with status ${result.status}`;
}

/**
 * Send `batches` from `from`: a replay (`replay`) resets with its first
 * batch and stamps `pass` with every batch, the last `final`. Each batch's
 * changes are sealed (`seal`) to the request that carries them. Returns
 * `{ kind: 'done', cursor, mismatches }`, `{ kind: 'conflict', position }`
 * (a 409 with what the half holds) or `{ kind: 'failed', error }`.
 */
async function sendBatches(
  call,
  seal,
  { name, directoryId, batches, from, replay, reconcile, logger },
) {
  const pass = crypto.randomUUID();
  let cursor = from;
  let mismatches = 0;
  // A replay with nothing to say still resets and ends the pass.
  const list = batches.length > 0 ? batches : replay ? [[]] : [];
  for (let i = 0; i < list.length; i += 1) {
    const changes = list[i];
    const to = changes.length > 0 ? changes[changes.length - 1].seq : cursor;
    const envelope = {
      directoryId,
      from: cursor,
      to,
      reset: replay && i === 0,
      reconcile: replay && (reconcile || i > 0),
      pass,
      final: replay && i === list.length - 1,
    };
    const result = await call(
      AGENT_HALF_IDENTITY_CHANGES_PATH,
      // Sealed to the nonce of the very request that carries them.
      (nonce) => ({
        protocol: IDENTITY_PROTOCOL_VERSION,
        ...envelope,
        changes: seal(nonce, envelope, changes),
      }),
      IDENTITY_CHANGES_TIMEOUT_MS,
    );
    if (result.ok && result.status === 409) {
      const conflict = parseIdentityCursorConflict(result.body);
      if (!conflict)
        return { kind: 'failed', error: 'the agent half answered 409 in an unexpected shape' };
      return {
        kind: 'conflict',
        position: { directoryId: conflict.directoryId, cursor: conflict.cursor },
      };
    }
    if (!result.ok || result.status !== 200) {
      return { kind: 'failed', error: describeFailure(result) };
    }
    const answer = parseIdentityChangesAnswer(result.body);
    if (!answer || answer.directoryId !== directoryId || answer.cursor !== to) {
      return { kind: 'failed', error: 'the agent half answered a batch with another cursor' };
    }
    cursor = to;
    mismatches += answer.mismatches ?? 0;
    await writeSyncState(name, { directoryId, cursor });
    logger?.info(
      { plugin: name, from: envelope.from, to, changes: changes.length, replay, reconcile },
      'Sent an identity batch',
    );
  }
  return { kind: 'done', cursor, mismatches };
}

/**
 * @typedef {object} IdentitySyncResult
 * @property {'synced' | 'up-to-date' | 'skipped' | 'failed'} status
 * @property {string} [reason] why it was skipped
 * @property {string} [error] why it failed (or was skipped)
 * @property {number} [cursor] where the half is now
 * @property {boolean} [replay] whether everything was sent from 0
 * @property {number} [mismatches] what the reconcile found
 */

/** Record why a sync did not run — written only when the reason changed. */
async function recordSkip(name, reason, message, logger) {
  const state = await readIdentitySyncState(name);
  if (state?.lastError !== message) {
    await writeSyncState(name, { lastError: message });
    logger?.info({ plugin: name, reason }, 'Identity sync not run');
  }
  return { status: 'skipped', reason, error: message };
}

async function recordFailure(name, error, logger) {
  await writeSyncState(name, { lastError: error });
  logger?.warn({ plugin: name, error }, 'Identity sync failed');
  return { status: 'failed', error };
}

/** One sync of plugin `name` (see the module comment). */
async function syncOnce(name, { reconcile, logger }) {
  const plugin = await findPlugin(name);
  if (!plugin) return { status: 'skipped', reason: 'not_installed', error: 'not installed' };
  // Nothing identity is ever sent to a plugin that does not declare it.
  if (!plugin.identity) {
    return { status: 'skipped', reason: 'no_identity', error: 'declares no identity' };
  }
  if (!(await installedVersionApproved(plugin))) {
    return recordSkip(
      name,
      'not_approved',
      `Version ${plugin.version} waits for approval — its users are not sent until it is approved`,
      logger,
    );
  }
  const record = await ownHostingOf(plugin);
  if (!record) {
    return recordSkip(name, 'not_hosted', 'The plugin is not hosted on an agent', logger);
  }
  const phase = pluginHostingPhase(record);
  if (phase !== 'active') {
    return recordSkip(name, 'hosting_not_active', `The hosting is ${phase}`, logger);
  }
  if (record.health?.state === 'down') {
    return recordSkip(
      name,
      'down',
      `The agent half is down (${record.health.reason ?? 'unknown'}) since ${record.health.since ?? 'unknown'}`,
      logger,
    );
  }

  const directoryId = await getDirectoryId();
  const before = await readIdentitySyncState(name);
  // One secret for the whole sync: requests are signed and changes sealed with it.
  const secret = signingSecretFor(record);
  const call = (path, body, timeoutMs) =>
    callAgentHalf({
      plugin: record.plugin,
      port: record.port,
      secret,
      method: 'POST',
      path,
      body,
      timeoutMs,
      maxResponseBytes: IDENTITY_ANSWER_MAX_BYTES,
    });
  const seal = (nonce, envelope, changes) =>
    sealIdentityChanges({ secret, plugin: record.plugin, nonce, envelope, changes });

  const head = await audienceHead(name);
  const notified = await call(
    AGENT_HALF_IDENTITY_NOTIFY_PATH,
    { protocol: IDENTITY_PROTOCOL_VERSION, directoryId, seq: head },
    IDENTITY_NOTIFY_TIMEOUT_MS,
  );
  if (!notified.ok || notified.status !== 200) {
    return recordFailure(name, describeFailure(notified), logger);
  }
  const answer = parseIdentityNotifyAnswer(notified.body);
  if (!answer) {
    return recordFailure(
      name,
      'the agent half answered the notification in an unexpected shape',
      logger,
    );
  }
  // What the half holds. It is not ready for user callers yet: that waits
  // until it has applied everything up to the head (below).
  await writeSyncState(name, { directoryId: answer.directoryId, cursor: answer.cursor });

  // A plugin that has not completed a full replay since it was installed
  // (its first sync), or since a replay was cut short, replays — whatever
  // its half holds was not built from this installation's audience.
  const replayOwed = !before?.lastReconcileAt;
  let position = { directoryId: answer.directoryId, cursor: answer.cursor };
  for (let attempt = 0; attempt < SYNC_ATTEMPTS; attempt += 1) {
    const rows = await audienceRowsAfter(name, 0);
    const currentHead = rows.length > 0 ? rows[rows.length - 1].seq : 0;
    const replay =
      reconcile ||
      replayOwed ||
      position.directoryId !== directoryId ||
      position.cursor > currentHead;
    if (!replay && position.cursor === currentHead) {
      // At the head, a complete replay behind it: ready for this version.
      await writeSyncState(name, {
        directoryId,
        cursor: position.cursor,
        readyVersion: plugin.version,
        lastSyncAt: new Date().toISOString(),
        lastError: null,
      });
      return { status: 'up-to-date', cursor: position.cursor, replay: false };
    }
    let batches;
    try {
      batches = batchesOf(
        replay ? rows : rows.filter((row) => row.seq > position.cursor),
        directoryId,
      );
    } catch (err) {
      return recordFailure(name, err.message, logger);
    }
    // A replay cut short leaves a half that was reset but never told which
    // rows the pass did not mention: until one completes, every sync replays.
    if (replay) await writeSyncState(name, { lastReconcileAt: null });
    const sent = await sendBatches(call, seal, {
      name,
      directoryId,
      batches,
      from: replay ? 0 : position.cursor,
      replay,
      reconcile,
      logger,
    });
    if (sent.kind === 'failed') return recordFailure(name, sent.error, logger);
    if (sent.kind === 'conflict') {
      logger?.warn(
        {
          plugin: name,
          cursor: sent.position.cursor,
          sameDirectory: sent.position.directoryId === directoryId,
        },
        'The agent half holds another cursor — continuing from it',
      );
      position = sent.position;
      continue;
    }
    const now = new Date().toISOString();
    // Every row up to the head applied (after a complete replay, this one or
    // an earlier one): ready for this version.
    await writeSyncState(name, {
      directoryId,
      cursor: sent.cursor,
      readyVersion: plugin.version,
      lastSyncAt: now,
      lastError: null,
      ...(replay
        ? { lastReconcileAt: now, lastMismatches: reconcile ? sent.mismatches : null }
        : {}),
    });
    if (reconcile && sent.mismatches > 0) {
      logger?.warn(
        { plugin: name, mismatches: sent.mismatches },
        'The identity reconcile found the agent half’s projection out of step',
      );
      await recordAuditBestEffort(
        {
          actor: 'lamaste',
          action: 'identity.reconcile.mismatches',
          plugin: name,
          details: { mismatches: sent.mismatches, directoryId },
        },
        logger,
      );
    }
    return {
      status: 'synced',
      cursor: sent.cursor,
      replay,
      ...(reconcile ? { mismatches: sent.mismatches } : {}),
    };
  }
  return recordFailure(
    name,
    `the agent half answered ${SYNC_ATTEMPTS} batches with another cursor — will try again`,
    logger,
  );
}

// ---------------------------------------------------------------------------
// One sync per plugin at a time
// ---------------------------------------------------------------------------

/** plugin → { tail, queued: { reconcile, promise } | null } */
const syncs = new Map();
/** The logger of the latest request — background syncs log through it. */
let lastLogger = null;

/**
 * Sync plugin `name`'s audience to its agent half. One sync per plugin at a
 * time: a request made while one runs waits for the next, which every
 * request made meanwhile shares (a `reconcile` among them makes it a
 * reconcile). Never rejects.
 *
 * @param {string} name
 * @param {{ reconcile?: boolean, logger?: import('pino').Logger }} [opts]
 * @returns {Promise<IdentitySyncResult>}
 */
export function syncPluginIdentity(name, { reconcile = false, logger } = {}) {
  if (logger) lastLogger = logger;
  let entry = syncs.get(name);
  if (!entry) {
    entry = { tail: Promise.resolve(), queued: null };
    syncs.set(name, entry);
  }
  if (entry.queued) {
    entry.queued.reconcile = entry.queued.reconcile || reconcile;
    return entry.queued.promise;
  }
  const queued = { reconcile, promise: null };
  queued.promise = entry.tail.then(async () => {
    entry.queued = null;
    try {
      return await syncOnce(name, { reconcile: queued.reconcile, logger: lastLogger });
    } catch (err) {
      lastLogger?.error({ plugin: name, err: err.message }, 'Identity sync failed unexpectedly');
      return { status: 'failed', error: err.message };
    }
  });
  entry.queued = queued;
  const tail = queued.promise.then(() => {
    if (entry.tail === tail && entry.queued === null) syncs.delete(name);
  });
  entry.tail = tail;
  return queued.promise;
}

/**
 * After the plugin's identity may have changed (approval, a hosting, an
 * update or its revert): once its installed version is approved, drop from
 * its role grants every role that version does not declare (a role a
 * manifest removed stays removed — `pruneUndeclaredRoles`); recompute the
 * audiences; then sync the plugin when it declares identity. Never throws;
 * null when nothing was synced.
 *
 * @param {string} name
 * @param {import('pino').Logger} [logger]
 * @returns {Promise<IdentitySyncResult | null>}
 */
export async function refreshPluginIdentity(name, logger) {
  let plugin = null;
  try {
    plugin = await findPlugin(name);
    if (plugin && (await installedVersionApproved(plugin).catch(() => false))) {
      const { pruneUndeclaredRoles } = await import('./entitlements.js');
      await pruneUndeclaredRoles(plugin, { actor: 'lamaste', logger });
    }
  } catch (err) {
    logger?.warn({ plugin: name, err: err.message }, 'Could not read the plugin to sync its users');
  }
  await recomputeAudiences({ logger });
  return plugin?.identity ? syncPluginIdentity(name, { logger }) : null;
}

/** Resolves once no recompute and no sync runs or waits (tests). */
export async function identityIdle() {
  for (;;) {
    await audiencesIdle();
    const tails = [...syncs.values()].map((entry) => entry.tail);
    if (tails.length === 0) return;
    await Promise.all(tails);
  }
}

// ---------------------------------------------------------------------------
// The minute's tick
// ---------------------------------------------------------------------------

/**
 * Sync every plugin that declares identity and is behind — no state yet,
 * another directory or cursor than the head, a version that has not
 * answered, or a last sync that did not finish — and reconcile those whose
 * last full replay is a day old.
 */
async function syncDuePlugins(logger) {
  const directoryId = await getDirectoryId();
  const plugins = (await readPlugins()).plugins.filter((p) => p.identity);
  const now = Date.now();
  for (const plugin of plugins) {
    const state = await readIdentitySyncState(plugin.name);
    const reconcileDue =
      state?.lastReconcileAt != null &&
      now - Date.parse(state.lastReconcileAt) >= IDENTITY_RECONCILE_INTERVAL_MS;
    const behind =
      !state ||
      state.directoryId !== directoryId ||
      state.cursor !== (await audienceHead(plugin.name)) ||
      state.readyVersion !== plugin.version ||
      state.lastError !== null;
    if (reconcileDue || behind) {
      void syncPluginIdentity(plugin.name, { reconcile: reconcileDue, logger });
    }
  }
}

let tickTimer = null;
let ticking = false;

/** The OIDC sync failure the tick last logged — logged again only when it changes. */
let lastOidcSyncError = null;

/**
 * One tick: reconcile the directory with users.yml (once onboarding is
 * done), clear the Gatekeeper principals of removed users still pending,
 * recompute the audiences (catching Gatekeeper CLI edits), then start the
 * syncs that are due. Never throws.
 */
export async function identityTick(logger) {
  if (ticking) return;
  ticking = true;
  try {
    if (getConfig().onboarding?.status === 'COMPLETED') {
      try {
        await reconcileDirectory({ actor: 'lamaste', logger });
      } catch (err) {
        logger?.warn({ err: err.message }, 'Could not reconcile the user directory');
      }
      // Who may reach each domain, as the directory now says: users adopted
      // or removed outside Lamaste, and a rendering a failure left behind.
      try {
        await ensurePrimaryDomain({ logger });
        await syncDomainAccess({ logger });
      } catch (err) {
        logger?.warn({ err: err.message }, 'Could not render domain access');
      }
      // users.yml touched once a minute: a reload Authelia skipped (its
      // cooldown) or that a restart of the panel cut short is never missing
      // for longer, and a hand edit gets Lamaste's groups back.
      try {
        const { touchUsersFile } = await import('./authelia.js');
        await touchUsersFile();
      } catch (err) {
        logger?.warn({ err: err.message }, 'Could not touch users.yml');
      }
      // The OIDC provider too, as the plugins and the members now say: a
      // plugin moved to another domain whose sync failed is healed here.
      // Compare-first, so a steady relay writes nothing.
      try {
        const { syncOidcClients } = await import('./plugin-oidc.js');
        await syncOidcClients(logger);
        lastOidcSyncError = null;
      } catch (err) {
        // Once per distinct failure, not every minute.
        if (err.message !== lastOidcSyncError) {
          logger?.warn({ err: err.message }, 'Could not sync the OIDC clients');
        }
        lastOidcSyncError = err.message;
      }
      // The brands' renderings, as their records now say: a rendering a
      // failure left behind is tried again (compare-first; never throws).
      await reconcileAuthBranding({ logger });
    }
    await clearPendingPrincipals({ logger });
    await recomputeAudiences({ logger });
    await syncDuePlugins(logger);
  } catch (err) {
    logger?.error({ err: err.message }, 'Identity tick failed');
  } finally {
    ticking = false;
  }
}

/**
 * Start the identity services at panel start: one tick now (reconcile,
 * recompute, the first syncs), then one every minute. Idempotent.
 *
 * @param {import('pino').Logger} logger
 */
export function startIdentityServices(logger) {
  if (tickTimer) return;
  void identityTick(logger);
  tickTimer = setInterval(() => void identityTick(logger), IDENTITY_TICK_INTERVAL_MS);
  tickTimer.unref();
}

export function stopIdentityServices() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}
