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
 * Gatekeeper (`principal_cleared_at`): when the user is removed (through
 * Lamaste or outside it), then every minute while it is pending
 * (Gatekeeper down), before an erasure scrubs the username it needs, and
 * whenever a user is created under a username a removed user held — always
 * then, pending or not: a restored gatekeeper.db or a grant that raced the
 * deletion can bring grants back (refused while it cannot complete). A
 * username a removed user held and nobody holds now takes no new grant or
 * group membership (409 `username_deleted`), and grants are created under
 * the users lock, so none races a deletion. While a username's cleanup is
 * pending it holds no role in any plugin.
 *
 * Authelia keys a user's second factors and the OpenID Connect identity it
 * gives relying parties by username as well (`authelia-user-storage.ts` in
 * core): a removed user's TOTP configuration and WebAuthn credentials are
 * deleted when they are removed and again before a user is created under
 * the username, and a username Authelia holds an opaque identifier for is
 * never given to a new user (409 `username_has_oidc_identity`) — Authelia
 * cannot delete one, and every relying party would take the new user for
 * the old.
 *
 * **Offboarding** ({@link offboardUserUnlocked}, keyed by user id) is one
 * function for every way a user stops being one — disabled or removed,
 * through the users API or adopted from users.yml by a reconcile: the
 * user's desktop sessions end (their session epoch, panel.json keyed by
 * user id), their registry tokens are revoked, and for a removal their
 * legacy user-plugin-access grants, their Gatekeeper principal and their
 * Authelia second factors go; Gatekeeper's cached session verdicts are
 * dropped. Every reconcile offboards exactly the users it saw change.
 *
 * **Domains** (lib/domains.js): a user created here becomes a member of
 * the domains they are created with (`changeUsers`' `domains`) — or, while
 * the relay has one domain, of that one, whoever created them; a removed
 * user's memberships end in the same transaction. Every `changeUsers`
 * renders the domains' members into Authelia and Gatekeeper's projection
 * before Authelia restarts.
 *
 * Audit entries name users by their id alone: never a username, a name or
 * an address.
 */

import crypto from 'node:crypto';
import { PromiseChainMutex } from '@lamalibre/lamaste';
import { httpError } from './app-error.js';
import { recordAuditBestEffort } from './audit.js';
import {
  autheliaHoldsOidcIdentity,
  purgeAutheliaUserSecondFactors,
  readUsersRaw,
  reloadAuthelia,
} from './authelia.js';
import { bumpUserEpoch } from './config.js';
import {
  deleteMembershipsSync,
  domainsForNewUser,
  insertMembershipsSync,
  syncDomainAccess,
} from './domains.js';
import {
  bustGatekeeperSessions,
  purgeAccessLogForUser,
  removeUserPrincipal,
} from './gatekeeper-client.js';
import { revokeUserRegistryTokens } from './registry-credential.js';
import { getStateDb } from './state-db.js';
import { readInvitations, withInvitationsLock, writeInvitations } from './state.js';
import { removeGrantsForUser } from './user-access.js';

/** How long the reconcile waits before reading users.yml again to confirm a user is gone. */
const DIRECTORY_CONFIRM_DELAY_MS = 500;

/** A logger for callees that need one when the caller passed none. */
const SILENT_LOGGER = Object.freeze({ info() {}, warn() {}, error() {} });

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
 * @property {string[]} disabled the ids of users this reconcile saw become disabled
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
 * Whether a removed user (not erased: an erased one no longer has a
 * username) held `username`.
 *
 * @param {string} username
 */
async function usernameHasTombstone(username) {
  const db = await getStateDb();
  return (
    db
      .prepare("SELECT 1 FROM directory_users WHERE username = ? AND status = 'removed'")
      .get(username) !== undefined
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
  if (cleared.length > 0 || removed.grantsRemoved > 0 || removed.groupsLeft > 0) {
    logger?.info(
      { userIds: cleared, ...removed },
      'Cleared what Gatekeeper held under a removed user’s username',
    );
  }
  return { ok: true, ...removed };
}

/** 503 `gatekeeper_unavailable`: what Gatekeeper holds under a username could not be cleared. */
function gatekeeperCleanupError(error) {
  return httpError(
    `A removed user's grants and group memberships under this username could not be cleared — Gatekeeper cannot clear them now (${error}); try again once Gatekeeper answers`,
    503,
    { code: 'gatekeeper_unavailable' },
  );
}

/** 503 `authelia_storage_unavailable`: Authelia's per-user storage could not be read or changed. */
function autheliaStorageError(what, err) {
  return httpError(
    `Authelia's storage could not ${what} (${err.message}) — nothing was changed; try again`,
    503,
    { code: 'authelia_storage_unavailable' },
  );
}

/**
 * Before a user is created under `username` — users lock held: refuse a
 * username Authelia holds an OpenID Connect opaque identifier for (409
 * `username_has_oidc_identity`), and when a removed user held it, clear
 * everything Gatekeeper holds under it and delete Authelia's second factors
 * for it — always, whether or not a cleanup was pending: a restored
 * gatekeeper.db or Authelia database, or a grant that raced the deletion,
 * may have brought something back. Throws 503 (`gatekeeper_unavailable`,
 * `authelia_storage_unavailable`) when that cannot be done now.
 * `autheliaStorage: false` skips Authelia's storage (onboarding: it does not
 * exist yet).
 *
 * @param {string} username
 * @param {{ actor: string, logger?: import('pino').Logger, autheliaStorage: boolean }} opts
 */
async function prepareUsernameUnlocked(username, { actor, logger, autheliaStorage }) {
  if (autheliaStorage) {
    let held;
    try {
      held = await autheliaHoldsOidcIdentity(username);
    } catch (err) {
      throw autheliaStorageError('be checked for an OpenID Connect identity of this username', err);
    }
    if (held) {
      throw httpError(
        'Authelia holds an OpenID Connect identity for this username (it was signed in to an OpenID Connect relying party before): every relying party — plugins signing users in through Lamaste — would take a new user for the earlier one, and Authelia cannot forget it. Choose another username.',
        409,
        { code: 'username_has_oidc_identity' },
      );
    }
  }
  if (!(await usernameHasTombstone(username))) return;
  const cleared = await clearPrincipalUnlocked(username, { actor, logger });
  if (!cleared.ok) throw gatekeeperCleanupError(cleared.error);
  if (autheliaStorage) {
    try {
      await purgeAutheliaUserSecondFactors(username);
    } catch (err) {
      throw autheliaStorageError(
        'delete an earlier user’s second factors under this username',
        err,
      );
    }
  }
}

/**
 * Hold the users lock while something is given to `usernames` in
 * Gatekeeper — a grant or a group membership — so no deletion runs
 * between the checks and `give`: a username a removed user held and nobody
 * holds now is refused (409 `username_deleted` — whatever was given would
 * pass to whoever is given the username next), and a pending Gatekeeper
 * cleanup under one is completed first (503 `gatekeeper_unavailable` when
 * it cannot be). With `requireUser`, a username nobody holds is refused
 * too (404 `user_not_found`). A username the directory has never seen
 * goes through: Gatekeeper may hold grants for a user still to come.
 *
 * @template T
 * @param {string[]} usernames
 * @param {{ actor: string, logger?: import('pino').Logger, requireUser?: boolean }} opts
 * @param {() => Promise<T>} give
 * @returns {Promise<T>}
 */
export function withUsernamesForGrants(usernames, { actor, logger, requireUser = false }, give) {
  return withUsersLock(async () => {
    for (const username of usernames) {
      const holder = await findDirectoryUser(username);
      if (!holder) {
        if (await usernameHasTombstone(username)) {
          throw httpError(
            'This username belonged to a user who was deleted, and nobody holds it now — nothing is given to it until a user is created under it',
            409,
            { code: 'username_deleted' },
          );
        }
        if (requireUser) {
          throw httpError('No user with this username in the directory', 404, {
            code: 'user_not_found',
          });
        }
      }
      if (await principalCleanupPending(username)) {
        const cleared = await clearPrincipalUnlocked(username, { actor, logger });
        if (!cleared.ok) throw gatekeeperCleanupError(cleared.error);
      }
    }
    return give();
  });
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
 * {@link reconcileDirectory} with the users lock already held. A user it
 * creates becomes a member of `domains[username]` when given, else of the
 * relay's one domain (none with two or more).
 *
 * @param {{ actor: string, logger?: import('pino').Logger, deleted?: string[], confirmDelayMs?: number, domains?: Readonly<Record<string, readonly string[]>> }} opts
 * @returns {Promise<DirectoryReconcileResult>}
 */
async function reconcileUnlocked({
  actor,
  logger,
  deleted = [],
  confirmDelayMs = DIRECTORY_CONFIRM_DELAY_MS,
  domains = {},
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
  const defaultDomains = await domainsForNewUser(undefined);
  const events = [];
  const result = { created: 0, updated: 0, removed: [], disabled: [] };
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
      events.push(...deleteMembershipsSync(db, user.userId, reason));
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
        const memberOf = Object.hasOwn(domains, username) ? domains[username] : defaultDomains;
        events.push(...insertMembershipsSync(db, userId, memberOf, { actor, now }));
        continue;
      }
      const changed = [];
      if (row.display_name !== attrs.displayName) changed.push('displayName');
      if (row.email !== attrs.email) changed.push('email');
      if (row.status !== attrs.status) changed.push('status');
      if (changed.length === 0) continue;
      update.run(attrs.displayName, attrs.email, attrs.status, now, row.user_id);
      result.updated += 1;
      if (row.status !== 'disabled' && attrs.status === 'disabled') {
        result.disabled.push(row.user_id);
      }
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

// ---------------------------------------------------------------------------
// Offboarding
// ---------------------------------------------------------------------------

/**
 * Offboard user `userId` — users lock held — who was just disabled
 * (`kind: 'disabled'`) or removed (`'deleted'`), whoever did it: end their
 * desktop sessions (bump their session epoch), revoke their registry
 * tokens, and for a removal remove their legacy user-plugin-access grants,
 * clear their Gatekeeper principal (pending and retried every minute when
 * Gatekeeper fails) and delete their Authelia second factors (done again
 * before the username is given to anyone). Each step is best effort; what
 * failed comes back as `warnings` (`{ step, message }`, never naming the
 * user). Gatekeeper's cached session verdicts are not dropped here: the
 * caller does that once, after Authelia restarted where it restarts it.
 *
 * @param {string} userId
 * @param {{ kind: 'disabled' | 'deleted', actor: string, logger?: import('pino').Logger }} opts
 * @returns {Promise<Array<{ step: string, message: string }>>}
 */
async function offboardUserUnlocked(userId, { kind, actor, logger }) {
  const warnings = [];
  const db = await getStateDb();
  const row = db.prepare('SELECT username FROM directory_users WHERE user_id = ?').get(userId);
  const username = row?.username ?? null;
  const failed = (step, message, err) => {
    logger?.warn({ userId, step, err: err.message }, message);
    warnings.push({ step, message: `${message}: ${err.message}` });
  };

  try {
    await bumpUserEpoch(userId);
  } catch (err) {
    failed('session-epoch', 'Live desktop sessions were not ended', err);
  }
  if (username !== null) {
    try {
      await revokeUserRegistryTokens(username, { deleted: true }, logger, { userId });
    } catch (err) {
      failed('registry', 'Registry tokens were not revoked', err);
    }
  }
  if (kind === 'deleted' && username !== null) {
    try {
      const removed = await removeGrantsForUser(username, logger ?? SILENT_LOGGER);
      if (removed > 0)
        logger?.info({ userId, removed }, 'Removed legacy user-plugin-access grants');
    } catch (err) {
      failed('user-plugin-access', 'Legacy user-plugin-access grants were not removed', err);
    }
    const cleared = await clearPrincipalUnlocked(username, { actor, logger });
    if (!cleared.ok) {
      logger?.warn(
        { userId, err: cleared.error },
        'Gatekeeper did not clear a removed user’s principal',
      );
      warnings.push({
        step: 'gatekeeper',
        message: `Gatekeeper did not remove the user's grants and group memberships (${cleared.error}) — retried every minute; until it succeeds the username holds no role and cannot be given to a new user`,
      });
    }
    try {
      await purgeAutheliaUserSecondFactors(username);
    } catch (err) {
      failed(
        'authelia-storage',
        'Authelia kept the user’s second factors (TOTP, WebAuthn) — they are deleted before the username is given to anyone',
        err,
      );
    }
  }
  logger?.info({ userId, kind }, 'User offboarded');
  return warnings;
}

/**
 * Offboard every user a reconcile saw stop being one — removed, or newly
 * disabled — users lock held; with `bustSessions`, drop Gatekeeper's cached
 * session verdicts once after them. Returns the warnings.
 *
 * @param {DirectoryReconcileResult} reconciled
 * @param {{ actor: string, logger?: import('pino').Logger, bustSessions: boolean }} opts
 */
async function offboardTransitionsUnlocked(reconciled, { actor, logger, bustSessions }) {
  const warnings = [];
  for (const { userId } of reconciled.removed) {
    warnings.push(...(await offboardUserUnlocked(userId, { kind: 'deleted', actor, logger })));
  }
  for (const userId of reconciled.disabled) {
    warnings.push(...(await offboardUserUnlocked(userId, { kind: 'disabled', actor, logger })));
  }
  if (bustSessions && reconciled.removed.length + reconciled.disabled.length > 0) {
    warnings.push(...(await bustCachedSessions(logger)));
  }
  return warnings;
}

/**
 * Drop Gatekeeper's cached session verdicts. Returns the warning when it
 * did not (the cache expires within 30 seconds anyway).
 *
 * @param {import('pino').Logger} [logger]
 * @returns {Promise<Array<{ step: string, message: string }>>}
 */
async function bustCachedSessions(logger) {
  const busted = await bustGatekeeperSessions();
  if (busted.ok) return [];
  logger?.warn({ err: busted.error }, 'Gatekeeper did not drop its cached sessions');
  return [
    {
      step: 'gatekeeper',
      message: `Gatekeeper did not drop its cached sessions (${busted.error}); they expire within 30 seconds`,
    },
  ];
}

/**
 * Bring the directory in line with users.yml — read only on the file: a
 * username it does not know gets a new user (active, or disabled per
 * `disabled: true`), a user whose username left the file (seen in two reads
 * {@link DIRECTORY_CONFIRM_DELAY_MS} apart) is removed as deleted outside
 * Lamaste, and a changed display name, email or `disabled` is adopted
 * (version + 1). Each change is audited by user id, and a user who was
 * removed or became disabled is offboarded ({@link offboardUserUnlocked}).
 * Throws, changing nothing, when users.yml cannot be read or lists nobody
 * while the directory has users.
 *
 * @param {{ actor?: string, logger?: import('pino').Logger, confirmDelayMs?: number }} [opts]
 * @returns {Promise<DirectoryReconcileResult>}
 */
export function reconcileDirectory({ actor = 'lamaste', logger, confirmDelayMs } = {}) {
  return withUsersLock(async () => {
    const reconciled = await reconcileUnlocked({ actor, logger, confirmDelayMs });
    await offboardTransitionsUnlocked(reconciled, { actor, logger, bustSessions: true });
    return reconciled;
  });
}

// ---------------------------------------------------------------------------
// Writing users.yml
// ---------------------------------------------------------------------------

/**
 * Change users.yml — a read-modify-write `mutate` through `lib/authelia.js`
 * — holding the users lock, all of it:
 *
 * 1. when it creates or deletes users, reconcile first (a user deleted
 *    outside Lamaste a moment ago is tombstoned before a namesake is
 *    created; a user about to be deleted must be in the directory to leave
 *    a tombstone), offboarding whatever that reconcile saw change;
 * 2. for every username `creates` names, {@link prepareUsernameUnlocked}:
 *    refused when Authelia holds an OpenID Connect identity for it (409
 *    `username_has_oidc_identity`); when a removed user held it, Gatekeeper
 *    drops everything under it and Authelia its second factors — always
 *    (503 `gatekeeper_unavailable` / `authelia_storage_unavailable` when
 *    that cannot be done: a new user never inherits an earlier one's grants,
 *    groups or second factors);
 * 3. `mutate`, then reconcile the directory (`deleted` names the usernames
 *    `mutate` deletes: removed as `deleted`; `domains` the domains of the
 *    users it creates — lib/domains.js), offboarding every user that
 *    reconcile saw removed or newly disabled ({@link offboardUserUnlocked});
 * 4. render the domains' members (lib/domains.js `syncDomainAccess`), then
 *    restart Authelia (unless `restartAuthelia` is false: onboarding starts
 *    it next; or the rendering restarted it already) — which ends every
 *    session — and drop Gatekeeper's cached session verdicts with them;
 * 5. with `expect` (`(users) => boolean` over users.yml's `users` map: does
 *    the file hold the intended change?), read users.yml again: Authelia's
 *    own password reset rewrites the file from what it read at start, so a
 *    write made just before its restart can be lost. When the change is not
 *    there it is made once more (steps 3 and 4); when it is still not
 *    there, `persisted` is false and a `persist` warning says so.
 *
 * Then the plugins' audiences are recomputed. A refusal `mutate` (or step
 * 2) throws comes back as it was, nothing written; what goes wrong after
 * the write is returned in `warnings` (`{ step, message }`) — the write
 * stays, and a cleanup that failed stays pending (Gatekeeper: retried every
 * minute; Authelia: done again before the username is given to anyone).
 *
 * @template T
 * @param {() => Promise<T>} mutate
 * @param {{ actor: string, logger?: import('pino').Logger, creates?: string[], deleted?: string[], domains?: Readonly<Record<string, readonly string[]>>, restartAuthelia?: boolean, autheliaStorage?: boolean, confirmDelayMs?: number, expect?: (users: Record<string, unknown>) => boolean }} opts
 * @returns {Promise<{ result: T, directory: DirectoryReconcileResult | null, warnings: Array<{ step: string, message: string }>, persisted: boolean }>}
 */
export async function changeUsers(
  mutate,
  {
    actor,
    logger,
    creates = [],
    deleted = [],
    domains = {},
    restartAuthelia = true,
    autheliaStorage = true,
    confirmDelayMs,
    expect,
  },
) {
  const warnings = [];

  /** Reconcile after the write and offboard what it saw; null when users.yml cannot be read. */
  const settle = async () => {
    let reconciled = null;
    try {
      reconciled = await reconcileUnlocked({ actor, logger, deleted, confirmDelayMs, domains });
    } catch (err) {
      logger?.error({ err: err.message }, 'Could not bring the user directory in line');
      warnings.push({
        step: 'directory',
        message: `The user directory was not updated (${err.message}); it catches up at the next reconcile, within a minute`,
      });
    }
    if (reconciled) {
      warnings.push(
        ...(await offboardTransitionsUnlocked(reconciled, { actor, logger, bustSessions: false })),
      );
    } else {
      // No tombstone yet (the next reconcile makes it, pending): Gatekeeper
      // drops what it holds under the deleted usernames now all the same.
      for (const username of deleted) {
        const cleared = await clearPrincipalUnlocked(username, { actor, logger });
        if (!cleared.ok) {
          warnings.push({
            step: 'gatekeeper',
            message: `Gatekeeper did not remove the user's grants and group memberships (${cleared.error}) — retried every minute`,
          });
        }
      }
    }
    return reconciled;
  };

  const restart = async () => {
    let restarted = false;
    try {
      restarted = (await syncDomainAccess({ logger })).changed;
    } catch (err) {
      logger?.error({ err: err.message }, 'Rendering domain access after a users change failed');
      warnings.push({
        step: 'domains',
        message: `Who may reach each domain was not rendered (${err.message}); the panel renders it again within a minute`,
      });
    }
    if (!restartAuthelia) return;
    if (restarted) {
      warnings.push(...(await bustCachedSessions(logger)));
      return;
    }
    try {
      await reloadAuthelia();
    } catch (err) {
      logger?.warn({ err: err.message }, 'Failed to restart Authelia after a users change');
      warnings.push({ step: 'authelia', message: `Authelia was not restarted: ${err.message}` });
    }
    warnings.push(...(await bustCachedSessions(logger)));
  };

  const holds = async () => {
    try {
      const raw = await readUsersRaw();
      return expect(isRecord(raw?.users) ? raw.users : {});
    } catch {
      return false;
    }
  };

  const outcome = await withUsersLock(async () => {
    if (creates.length > 0 || deleted.length > 0) {
      try {
        const before = await reconcileUnlocked({ actor, logger, confirmDelayMs });
        warnings.push(
          ...(await offboardTransitionsUnlocked(before, { actor, logger, bustSessions: false })),
        );
      } catch (err) {
        logger?.warn(
          { err: err.message },
          'Could not reconcile the directory before a users change',
        );
      }
    }
    for (const username of creates) {
      await prepareUsernameUnlocked(username, { actor, logger, autheliaStorage });
    }
    let value = await mutate();
    let reconciled = await settle();
    await restart();

    let persisted = true;
    if (expect && !(await holds())) {
      // Authelia rewrote users.yml over the change (its own password reset
      // writes the file from what it read at start): make it once more.
      logger?.warn('users.yml lost a change while Authelia restarted — making it again');
      try {
        value = await mutate();
        const again = await settle();
        if (again) {
          reconciled = reconciled
            ? {
                created: reconciled.created + again.created,
                updated: reconciled.updated + again.updated,
                removed: [...reconciled.removed, ...again.removed],
                disabled: [...reconciled.disabled, ...again.disabled],
              }
            : again;
        }
        await restart();
        persisted = await holds();
      } catch (err) {
        logger?.warn({ err: err.message }, 'Making a lost users change again failed');
        persisted = false;
      }
      if (!persisted) {
        logger?.error('users.yml does not hold a users change after it was made twice');
        warnings.push({
          step: 'persist',
          message:
            'users.yml does not hold the change: Authelia rewrote the file while it was being made (a password reset, say), and making it again did not stick either — check the user and make the change again',
        });
      }
    }
    return { result: value, directory: reconciled, persisted };
  });

  const { recomputeAudiences } = await import('./audience.js');
  await recomputeAudiences({ logger });
  return { ...outcome, warnings };
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
 * Gatekeeper's access-request log rows, their Authelia second factors and
 * their invitations (log and invitations as of when they were removed),
 * then scrub the row to the bare id
 * (`erased_at` set, version + 1), record who asked, audit it, and recompute
 * the audiences — every plugin that had them as a member is sent
 * `remove/erased`, and acknowledges it when its half's cursor passes it.
 *
 * Refuses (409 `user_not_removed`) a user who is active or disabled —
 * delete them first, or delete and erase in one step — and (409
 * `already_erased`) a second erasure. When Gatekeeper cannot purge its log
 * (503 `gatekeeper_unavailable`) or Authelia's storage cannot be changed
 * (503 `authelia_storage_unavailable`) nothing is scrubbed: the tombstone
 * still names the username a later attempt needs. What Lamaste cannot reach
 * stays: Authelia's OpenID Connect opaque identifier for the username and
 * its authentication log.
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
      // Authelia's second factors under the username go before it is
      // forgotten (they went at removal unless that failed — then never
      // again, once nothing here names it).
      try {
        await purgeAutheliaUserSecondFactors(row.username);
      } catch (err) {
        throw httpError(
          `Authelia's storage could not delete the user's second factors (${err.message}) — nothing was erased; try again`,
          503,
          { code: 'authelia_storage_unavailable' },
        );
      }
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
