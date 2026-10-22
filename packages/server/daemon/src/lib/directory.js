/**
 * The user directory — every user the panel knows, by a stable id.
 *
 * Authelia's users.yml stays its credential file and keys users by a
 * username anyone can reuse. The directory (state.db, migration 0013) gives
 * each user a UUID v4 the moment their username appears and keeps the row
 * for good: plugins key their data on the id, and a username that comes
 * back after a deletion is a new user with a new id. A row is `active`,
 * `disabled` (Authelia's `disabled: true` — the one offboarding action) or
 * `removed` — deleted through Lamaste (`deleted`) or gone from users.yml
 * without it (`deleted-outside`) — and a removed row keeps the username,
 * display name and email it last had, so history stays readable, until an
 * administrator erases it ({@link eraseDirectoryUser}).
 *
 * users.yml is never written from here. Every write of it goes through
 * {@link changeUsers}: one in-process lock around the read-modify-write,
 * then the directory is reconciled against the file, then Authelia
 * restarts, then the plugins' audiences are recomputed. The reconcile
 * ({@link reconcileDirectory}) also runs at start, every minute and after
 * onboarding — read only: writing users.yml restarts Authelia and ends
 * every session. It adopts what changed outside Lamaste (Authelia's own
 * password reset rewrites the file; an operator may edit it), and only
 * after reading the file twice does it take a user for deleted outside —
 * Authelia rewrites the file in place, and a read that met a half-written
 * file must not tombstone anyone.
 *
 * Gatekeeper keys users by username too: the grants naming a user and
 * their memberships of Lamaste groups would pass to anyone who later holds
 * the username. Every removed user's principal is therefore cleared in
 * Gatekeeper (`principal_cleared_at`): when Lamaste deletes them, then
 * every minute while it is pending (a deletion outside Lamaste, Gatekeeper
 * down), before an erasure scrubs the username it needs, and before
 * anything is created under the username again — a new user (refused while
 * the cleanup cannot complete), a grant or a group membership. While a
 * username's cleanup is pending it holds no role in any plugin.
 *
 * Audit entries name users by their id alone: never a username, a name or
 * an address.
 */

import crypto from 'node:crypto';
import { PromiseChainMutex } from '@lamalibre/lamaste';
import { httpError } from './app-error.js';
import { recordAuditBestEffort } from './audit.js';
import { readUsersRaw, reloadAuthelia } from './authelia.js';
import {
  bustGatekeeperSessions,
  purgeAccessLogForUser,
  removeUserPrincipal,
} from './gatekeeper-client.js';
import { getStateDb } from './state-db.js';
import { readInvitations, withInvitationsLock, writeInvitations } from './state.js';

/** How long the reconcile waits before reading users.yml again to confirm a user is gone. */
const DIRECTORY_CONFIRM_DELAY_MS = 500;

/** The Authelia group whose enabled members administer Lamaste. */
export const ADMIN_GROUP = 'admins';

/**
 * A user as the directory keeps them.
 *
 * @typedef {object} DirectoryUser
 * @property {string} userId UUID v4
 * @property {string | null} username null once erased
 * @property {string | null} displayName
 * @property {string | null} email
 * @property {'active' | 'disabled' | 'removed'} status
 * @property {'deleted' | 'deleted-outside' | null} removedReason
 * @property {string | null} removedAt
 * @property {string | null} erasedAt
 * @property {string | null} principalClearedAt when Gatekeeper dropped what it held under the
 *   username (removed users only; null on a removed user: pending)
 * @property {number} version
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} DirectoryReconcileResult
 * @property {number} created
 * @property {number} updated
 * @property {Array<{ userId: string, username: string, reason: 'deleted' | 'deleted-outside' }>} removed
 *   in memory only — never logged or audited with the username
 */

// ---------------------------------------------------------------------------
// The users lock
// ---------------------------------------------------------------------------

const usersMutex = new PromiseChainMutex();

/**
 * Run `fn` holding the users lock — the one lock around every
 * read-modify-write of users.yml and every change of the directory in this
 * process (core's users functions take none).
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withUsersLock(fn) {
  return usersMutex.run(fn);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** @returns {DirectoryUser} */
function rowToUser(row) {
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    status: row.status,
    removedReason: row.removed_reason,
    removedAt: row.removed_at,
    erasedAt: row.erased_at,
    principalClearedAt: row.principal_cleared_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The directory's id (UUID v4), made with the store. */
export async function getDirectoryId() {
  const db = await getStateDb();
  const row = db.prepare('SELECT directory_id FROM directory_meta WHERE id = 1').get();
  if (!row) throw new Error('The user directory has no id (state.db migration 0013 missing)');
  return row.directory_id;
}

/**
 * Every user the directory knows — removed and erased ones too: members
 * first by username, then the removed, then the erased.
 *
 * @returns {Promise<DirectoryUser[]>}
 */
export async function listDirectoryUsers() {
  const db = await getStateDb();
  return db
    .prepare(
      `SELECT * FROM directory_users
       ORDER BY status = 'removed', erased_at IS NOT NULL, username, created_at, user_id`,
    )
    .all()
    .map(rowToUser);
}

/**
 * One user by id, or null.
 *
 * @param {string} userId
 * @returns {Promise<DirectoryUser | null>}
 */
export async function getDirectoryUser(userId) {
  const db = await getStateDb();
  const row = db.prepare('SELECT * FROM directory_users WHERE user_id = ?').get(userId);
  return row ? rowToUser(row) : null;
}

/**
 * The user who holds `username` now (active or disabled), or null — a
 * removed user keeps their username but no longer holds it.
 *
 * @param {string} username
 * @returns {Promise<DirectoryUser | null>}
 */
export async function findDirectoryUser(username) {
  const db = await getStateDb();
  const row = db
    .prepare("SELECT * FROM directory_users WHERE username = ? AND status <> 'removed'")
    .get(username);
  return row ? rowToUser(row) : null;
}

/**
 * The users who hold a username now, by username.
 *
 * @returns {Promise<Map<string, DirectoryUser>>}
 */
export async function directoryUsersByUsername() {
  const db = await getStateDb();
  const rows = db.prepare("SELECT * FROM directory_users WHERE status <> 'removed'").all();
  return new Map(rows.map((row) => [row.username, rowToUser(row)]));
}

// ---------------------------------------------------------------------------
// Gatekeeper principals of removed users
// ---------------------------------------------------------------------------

/**
 * The usernames whose Gatekeeper principal is still to be cleared — of
 * removed users whose cleanup has not succeeded yet. No role is counted for
 * them, whoever holds the username now.
 *
 * @returns {Promise<Set<string>>}
 */
export async function pendingPrincipalCleanups() {
  const db = await getStateDb();
  return new Set(
    db
      .prepare(
        `SELECT DISTINCT username FROM directory_users
         WHERE status = 'removed' AND principal_cleared_at IS NULL AND username IS NOT NULL`,
      )
      .all()
      .map((row) => row.username),
  );
}

/**
 * Whether a removed user held `username` and Gatekeeper may still hold
 * their grants or group memberships under it.
 *
 * @param {string} username
 */
export async function principalCleanupPending(username) {
  const db = await getStateDb();
  return (
    db
      .prepare(
        `SELECT 1 FROM directory_users
         WHERE username = ? AND status = 'removed' AND principal_cleared_at IS NULL`,
      )
      .get(username) !== undefined
  );
}

/** The longest username a grant or a group member can name: Gatekeeper holds nothing longer. */
const GATEKEEPER_PRINCIPAL_MAX = 100;

/**
 * Have Gatekeeper drop everything it holds under `username` and record it
 * on every removed user whose cleanup was pending under it — users lock
 * held. A username Gatekeeper cannot hold needs no call. Returns
 * `{ ok: true }` or the failure (`error`, never thrown); audited by user id.
 *
 * @param {string} username
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 * @returns {Promise<{ ok: true, grantsRemoved: number, groupsLeft: number } | { ok: false, error: string }>}
 */
async function clearPrincipalUnlocked(username, { actor, logger }) {
  let removed = { grantsRemoved: 0, groupsLeft: 0 };
  if (username.length > 0 && username.length <= GATEKEEPER_PRINCIPAL_MAX) {
    const result = await removeUserPrincipal(username);
    if (!result.ok) return { ok: false, error: result.error };
    removed = { grantsRemoved: result.grantsRemoved, groupsLeft: result.groupsLeft };
  }
  const db = await getStateDb();
  const cleared = db
    .prepare(
      `SELECT user_id FROM directory_users
       WHERE username = ? AND status = 'removed' AND principal_cleared_at IS NULL`,
    )
    .all(username)
    .map((row) => row.user_id);
  if (cleared.length > 0) {
    db.prepare(
      `UPDATE directory_users SET principal_cleared_at = ?
       WHERE username = ? AND status = 'removed' AND principal_cleared_at IS NULL`,
    ).run(new Date().toISOString(), username);
    await recordAuditBestEffort(
      {
        actor,
        action: 'directory.user.principal-cleared',
        details: { userIds: cleared, ...removed },
      },
      logger,
    );
  }
  logger?.info(
    { userIds: cleared, ...removed },
    'Cleared what Gatekeeper held under a removed user’s username',
  );
  return { ok: true, ...removed };
}

/**
 * Before anything is created under `username` — a user, a grant, a group
 * membership — clear what Gatekeeper still holds of a removed user who had
 * it; users lock held. Throws 503 `gatekeeper_unavailable` when that
 * cleanup is pending and cannot complete now.
 */
async function ensurePrincipalClearedUnlocked(username, { actor, logger }) {
  if (!(await principalCleanupPending(username))) return;
  const result = await clearPrincipalUnlocked(username, { actor, logger });
  if (!result.ok) {
    throw httpError(
      `A removed user's grants and group memberships under this username are not cleared yet, and Gatekeeper cannot clear them now (${result.error}) — try again once Gatekeeper answers`,
      503,
      { code: 'gatekeeper_unavailable' },
    );
  }
}

/**
 * {@link ensurePrincipalClearedUnlocked} holding the users lock — for what
 * creates a grant or a group membership for `username` (entitlements, the
 * Gatekeeper proxy).
 *
 * @param {string} username
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export function ensurePrincipalCleared(username, opts) {
  return withUsersLock(() => ensurePrincipalClearedUnlocked(username, opts));
}

/**
 * Retry every pending cleanup (the minute's tick): one Gatekeeper call per
 * username, failures logged and left pending. Returns how many usernames
 * were cleared and how many are still pending.
 *
 * @param {{ logger?: import('pino').Logger }} [opts]
 * @returns {Promise<{ cleared: number, pending: number }>}
 */
export function clearPendingPrincipals({ logger } = {}) {
  return withUsersLock(async () => {
    let cleared = 0;
    let pending = 0;
    for (const username of await pendingPrincipalCleanups()) {
      const result = await clearPrincipalUnlocked(username, { actor: 'lamaste', logger });
      if (result.ok) cleared += 1;
      else pending += 1;
    }
    if (pending > 0) {
      logger?.warn(
        { pending },
        'Gatekeeper principals of removed users are still to be cleared — retried every minute',
      );
    }
    return { cleared, pending };
  });
}

// ---------------------------------------------------------------------------
// Reconcile (read only on users.yml)
// ---------------------------------------------------------------------------

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Why users.yml could not be read, in words that carry none of its content:
 * a YAML parser's message quotes the lines around the fault — usernames,
 * addresses, password hashes — and must never reach a log.
 *
 * @param {unknown} err
 * @returns {Error}
 */
export function usersFileError(err) {
  const cause =
    err?.name === 'YAMLException'
      ? `not valid YAML${Number.isInteger(err.mark?.line) ? ` at line ${err.mark.line + 1}` : ''}`
      : typeof err?.code === 'string'
        ? err.code
        : (err?.name ?? 'unknown error');
  return new Error(`users.yml could not be read (${cause})`);
}

/**
 * users.yml as the directory sees it: username → display name, email and
 * status. Throws when the file cannot be read or parsed (without its
 * content: {@link usersFileError}), or is not a users file — a reconcile
 * then changes nothing.
 *
 * @returns {Promise<Map<string, { displayName: string | null, email: string | null, status: 'active' | 'disabled' }>>}
 */
async function readUsersSnapshot() {
  let raw;
  try {
    raw = await readUsersRaw();
  } catch (err) {
    throw usersFileError(err);
  }
  if (!isRecord(raw) || !isRecord(raw.users)) {
    throw new Error('users.yml is not a users file (no "users" map)');
  }
  const users = new Map();
  for (const [username, value] of Object.entries(raw.users)) {
    const entry = isRecord(value) ? value : {};
    users.set(username, {
      displayName: textOrNull(entry.displayname),
      email: textOrNull(entry.email),
      status: entry.disabled === true ? 'disabled' : 'active',
    });
  }
  return users;
}

/** Refuse a users.yml that lists nobody while the directory has users: never a real state. */
function assertNotEmpty(snapshot, live) {
  if (snapshot.size === 0 && live.length > 0) {
    throw new Error('users.yml lists no users — the directory is left as it is');
  }
}

/**
 * {@link reconcileDirectory} with the users lock already held.
 *
 * @param {{ actor: string, logger?: import('pino').Logger, deleted?: string[], confirmDelayMs?: number }} opts
 * @returns {Promise<DirectoryReconcileResult>}
 */
async function reconcileUnlocked({
  actor,
  logger,
  deleted = [],
  confirmDelayMs = DIRECTORY_CONFIRM_DELAY_MS,
}) {
  const db = await getStateDb();
  const live = db
    .prepare("SELECT * FROM directory_users WHERE status <> 'removed'")
    .all()
    .map(rowToUser);
  const deletedByLamaste = new Set(deleted);

  let snapshot = await readUsersSnapshot();
  assertNotEmpty(snapshot, live);
  const absentFirst = new Set(live.filter((u) => !snapshot.has(u.username)).map((u) => u.username));
  if ([...absentFirst].some((username) => !deletedByLamaste.has(username))) {
    // Someone left users.yml without Lamaste — or the read met a file
    // Authelia was rewriting in place. Read it again before believing it.
    if (confirmDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, confirmDelayMs));
    snapshot = await readUsersSnapshot();
    assertNotEmpty(snapshot, live);
  }
  // Gone in every read made: Lamaste's own deletions after one, anyone
  // else's after two.
  const missing = live.filter((u) => absentFirst.has(u.username) && !snapshot.has(u.username));

  const now = new Date().toISOString();
  const events = [];
  const result = { created: 0, updated: 0, removed: [] };
  const selectLive = db.prepare(
    "SELECT * FROM directory_users WHERE username = ? AND status <> 'removed'",
  );
  const remove = db.prepare(
    `UPDATE directory_users
       SET status = 'removed', removed_reason = ?, removed_at = ?, version = version + 1,
           updated_at = ?
     WHERE user_id = ? AND status <> 'removed'`,
  );
  const insert = db.prepare(
    `INSERT INTO directory_users
       (user_id, username, display_name, email, status, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  const update = db.prepare(
    `UPDATE directory_users
       SET display_name = ?, email = ?, status = ?, version = version + 1, updated_at = ?
     WHERE user_id = ?`,
  );
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const user of missing) {
      const reason = deletedByLamaste.has(user.username) ? 'deleted' : 'deleted-outside';
      remove.run(reason, now, now, user.userId);
      result.removed.push({ userId: user.userId, username: user.username, reason });
      events.push({ action: 'directory.user.removed', details: { userId: user.userId, reason } });
    }
    for (const [username, attrs] of snapshot) {
      const row = selectLive.get(username);
      if (!row) {
        const userId = crypto.randomUUID();
        insert.run(userId, username, attrs.displayName, attrs.email, attrs.status, now, now);
        result.created += 1;
        events.push({
          action: 'directory.user.created',
          details: { userId, status: attrs.status },
        });
        continue;
      }
      const changed = [];
      if (row.display_name !== attrs.displayName) changed.push('displayName');
      if (row.email !== attrs.email) changed.push('email');
      if (row.status !== attrs.status) changed.push('status');
      if (changed.length === 0) continue;
      update.run(attrs.displayName, attrs.email, attrs.status, now, row.user_id);
      result.updated += 1;
      events.push({
        action: 'directory.user.updated',
        details: { userId: row.user_id, changed, status: attrs.status },
      });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  for (const event of events) {
    await recordAuditBestEffort({ actor, action: event.action, details: event.details }, logger);
  }
  if (events.length > 0) {
    logger?.info(
      { created: result.created, updated: result.updated, removed: result.removed.length },
      'User directory reconciled',
    );
  }
  return result;
}

/**
 * Bring the directory in line with users.yml — read only on the file: a
 * username it does not know gets a new user (active, or disabled per
 * `disabled: true`), a user whose username left the file (seen in two reads
 * {@link DIRECTORY_CONFIRM_DELAY_MS} apart) is removed as deleted outside
 * Lamaste, and a changed display name, email or `disabled` is adopted
 * (version + 1). Each change is audited by user id. Throws, changing
 * nothing, when users.yml cannot be read or lists nobody while the
 * directory has users.
 *
 * @param {{ actor?: string, logger?: import('pino').Logger, confirmDelayMs?: number }} [opts]
 * @returns {Promise<DirectoryReconcileResult>}
 */
export function reconcileDirectory({ actor = 'lamaste', logger, confirmDelayMs } = {}) {
  return withUsersLock(() => reconcileUnlocked({ actor, logger, confirmDelayMs }));
}

// ---------------------------------------------------------------------------
// Writing users.yml
// ---------------------------------------------------------------------------

/**
 * Change users.yml: run `mutate` — a read-modify-write of the file through
 * `lib/authelia.js` — holding the users lock, then reconcile the directory
 * (`deleted` names the usernames `mutate` deletes: they are removed as
 * `deleted`, and known to the directory before the write so they leave a
 * tombstone), then clear the deleted users' Gatekeeper principals, then
 * restart Authelia (unless `restartAuthelia` is false: onboarding starts it
 * next) — which ends every session — and drop Gatekeeper's cached session
 * verdicts with them, all still under the lock; then recompute the plugins'
 * audiences.
 * `creates` names the usernames `mutate` creates: a removed user's pending
 * Gatekeeper cleanup under one of them runs first, and when it cannot
 * complete the change is refused (503 `gatekeeper_unavailable`) — a new
 * user never inherits an earlier one's grants or groups. A refusal `mutate`
 * throws comes back as it was, nothing written; what goes wrong after the
 * write is returned in `warnings` (`{ step, message }`) — the write stays,
 * and a cleanup that failed stays pending (retried every minute).
 *
 * @template T
 * @param {() => Promise<T>} mutate
 * @param {{ actor: string, logger?: import('pino').Logger, creates?: string[], deleted?: string[], restartAuthelia?: boolean, confirmDelayMs?: number }} opts
 * @returns {Promise<{ result: T, directory: DirectoryReconcileResult | null, warnings: Array<{ step: string, message: string }> }>}
 */
export async function changeUsers(
  mutate,
  { actor, logger, creates = [], deleted = [], restartAuthelia = true, confirmDelayMs },
) {
  const warnings = [];
  const { result, directory } = await withUsersLock(async () => {
    for (const username of creates) {
      await ensurePrincipalClearedUnlocked(username, { actor, logger });
    }
    if (deleted.length > 0) {
      // A user who is about to be deleted must be in the directory to leave
      // a tombstone — they are, unless users.yml changed outside Lamaste
      // since the last reconcile.
      try {
        await reconcileUnlocked({ actor, logger, confirmDelayMs });
      } catch (err) {
        logger?.warn({ err: err.message }, 'Could not reconcile the directory before a deletion');
      }
    }
    const value = await mutate();
    let reconciled = null;
    try {
      reconciled = await reconcileUnlocked({ actor, logger, deleted, confirmDelayMs });
    } catch (err) {
      logger?.error({ err: err.message }, 'Could not bring the user directory in line');
      warnings.push({
        step: 'directory',
        message: `The user directory was not updated (${err.message}); it catches up at the next reconcile, within a minute`,
      });
    }
    for (const username of deleted) {
      const cleared = await clearPrincipalUnlocked(username, { actor, logger });
      if (!cleared.ok) {
        logger?.warn({ err: cleared.error }, 'Gatekeeper did not clear a deleted user’s principal');
        warnings.push({
          step: 'gatekeeper',
          message: `Gatekeeper did not remove the user's grants and group memberships (${cleared.error}) — retried every minute; until it succeeds the username holds no role and cannot be given to a new user`,
        });
      }
    }
    if (restartAuthelia) {
      try {
        await reloadAuthelia();
      } catch (err) {
        logger?.warn({ err: err.message }, 'Failed to restart Authelia after a users change');
        warnings.push({ step: 'authelia', message: `Authelia was not restarted: ${err.message}` });
      }
      const busted = await bustGatekeeperSessions();
      if (!busted.ok) {
        logger?.warn({ err: busted.error }, 'Gatekeeper did not drop its cached sessions');
        warnings.push({
          step: 'gatekeeper',
          message: `Gatekeeper did not drop its cached sessions (${busted.error}); they expire within 30 seconds`,
        });
      }
    }
    return { result: value, directory: reconciled };
  });

  const { recomputeAudiences } = await import('./audience.js');
  await recomputeAudiences({ logger });
  return { result, directory, warnings };
}

// ---------------------------------------------------------------------------
// Erasure
// ---------------------------------------------------------------------------

/** Whether an invitation was made at or before `time` (or says nothing usable about when). */
function madeBy(invitation, time) {
  const made = Date.parse(invitation?.createdAt);
  return !Number.isFinite(made) || made <= Date.parse(time);
}

/**
 * Delete the invitations of `username` made at or before `removedAt` — the
 * removed user's, accepted or not; a later invitation for the same
 * username is someone else's.
 *
 * @returns {Promise<number>} how many went
 */
function purgeInvitations(username, removedAt) {
  return withInvitationsLock(async () => {
    const invitations = await readInvitations();
    const kept = invitations.filter(
      (inv) => !(inv?.username === username && madeBy(inv, removedAt)),
    );
    if (kept.length === invitations.length) return 0;
    await writeInvitations(kept);
    return invitations.length - kept.length;
  });
}

/**
 * Erase removed user `userId`: with the username the tombstone still holds,
 * clear their Gatekeeper principal if that is still pending, delete
 * Gatekeeper's access-request log rows and their invitations (both as of
 * when they were removed), then scrub the row to the bare id
 * (`erased_at` set, version + 1), record who asked, audit it, and recompute
 * the audiences — every plugin that had them as a member is sent
 * `remove/erased`, and acknowledges it when its half's cursor passes it.
 *
 * Refuses (409 `user_not_removed`) a user who is active or disabled —
 * delete them first, or delete and erase in one step — and (409
 * `already_erased`) a second erasure. When Gatekeeper cannot purge its log
 * (503 `gatekeeper_unavailable`) nothing is scrubbed: the tombstone still
 * names the username a later attempt needs.
 *
 * @param {string} userId
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 * @returns {Promise<{ userId: string, erasedAt: string, invitationsPurged: number, accessLogPurged: number }>}
 */
export async function eraseDirectoryUser(userId, { actor, logger }) {
  const erased = await withUsersLock(async () => {
    const db = await getStateDb();
    const row = db.prepare('SELECT * FROM directory_users WHERE user_id = ?').get(userId);
    if (!row)
      throw httpError('No user with this id in the directory', 404, { code: 'user_not_found' });
    if (row.status !== 'removed') {
      throw httpError(
        'Only a removed user is erased — delete the user first, or delete and erase in one step (DELETE /api/users/:username?erase=true)',
        409,
        { code: 'user_not_removed' },
      );
    }
    if (row.erased_at !== null) {
      throw httpError('This user was erased already', 409, { code: 'already_erased' });
    }

    // Gatekeeper first: the one service that may be unavailable, so a
    // refusal leaves everything here as it was. The principal is cleared
    // while the username that names it is still known; both Gatekeeper
    // steps and the purge of invitations can be repeated.
    let invitationsPurged = 0;
    let accessLogPurged = 0;
    if (row.username !== null) {
      if (row.principal_cleared_at === null) {
        const cleared = await clearPrincipalUnlocked(row.username, { actor, logger });
        if (!cleared.ok) {
          throw httpError(
            `Gatekeeper could not remove the user's grants and group memberships (${cleared.error}) — nothing was erased; try again once Gatekeeper answers`,
            503,
            { code: 'gatekeeper_unavailable' },
          );
        }
      }
      const purge = await purgeAccessLogForUser(row.username, { before: row.removed_at });
      if (!purge.ok) {
        throw httpError(
          `Gatekeeper's access-request log could not be purged (${purge.error}) — nothing was erased; try again once Gatekeeper answers`,
          503,
          { code: 'gatekeeper_unavailable' },
        );
      }
      accessLogPurged = purge.removed;
      invitationsPurged = await purgeInvitations(row.username, row.removed_at);
    }

    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE directory_users
           SET username = NULL, display_name = NULL, email = NULL, erased_at = ?,
               version = version + 1, updated_at = ?
         WHERE user_id = ? AND status = 'removed' AND erased_at IS NULL`,
      ).run(now, now, userId);
      db.prepare(
        'INSERT INTO directory_erasures (user_id, requested_at, requested_by) VALUES (?, ?, ?)',
      ).run(userId, now, actor);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    await recordAuditBestEffort(
      {
        actor,
        action: 'directory.user.erased',
        details: { userId, invitationsPurged, accessLogPurged },
      },
      logger,
    );
    logger?.info({ userId, invitationsPurged, accessLogPurged }, 'Erased a removed user');
    return { userId, erasedAt: now, invitationsPurged, accessLogPurged };
  });

  const { recomputeAudiences } = await import('./audience.js');
  await recomputeAudiences({ logger });
  return erased;
}

/**
 * Who erased each erased user, and when.
 *
 * @returns {Promise<Map<string, { requestedAt: string, requestedBy: string }>>}
 */
export async function listErasures() {
  const db = await getStateDb();
  return new Map(
    db
      .prepare('SELECT * FROM directory_erasures')
      .all()
      .map((row) => [
        row.user_id,
        { requestedAt: row.requested_at, requestedBy: row.requested_by },
      ]),
  );
}
