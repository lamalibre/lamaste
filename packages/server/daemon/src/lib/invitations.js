/**
 * Invitations — the administrator's (`POST /api/invitations`) and delegated
 * ones (a plugin user holding an inviting role; see
 * packages/core/docs/delegated-invitations-design.md) — in state.db
 * (migration 0020). This module is their store: tokens, rows, the views the
 * APIs answer, the claim an acceptance takes, revocations and erasure.
 *
 * A token is 32 random bytes, hex in the link; only its SHA-256 is stored
 * and looked up, so nothing at rest opens an invitation and a lookup has no
 * timing to measure. It is shown once, in the answer that makes it.
 *
 * Every change of an invitation holds the invitations lock of its plugin
 * (the administrator's invitations share one key): a check and the write it
 * depends on never interleave with another. The lock is never held across
 * `changeUsers` or a grant (each takes the users lock); an acceptance under
 * way is a `accepting` row instead, which nothing else may change.
 *
 * invitations.json, where 4.8 kept them with their tokens in clear, is
 * imported whenever it exists (a restored backup brings it back) and then
 * deleted: by id, never over a row state.db holds.
 */

import crypto from 'node:crypto';

import {
  INVITATION_ACCEPTING_STALE_MS,
  INVITATION_MAX_FAILED_ATTEMPTS,
  INVITATION_RETENTION_DAYS,
  INVITATION_TOKEN_BYTES,
  INVITATION_TOKEN_RE,
  KeyedPromiseChainMutex,
  emailDomainOf,
} from '@lamalibre/lamaste';

import { httpError } from './app-error.js';
import { getStateDb } from './state-db.js';
import { readLegacyInvitations, removeLegacyInvitations } from './state.js';

/** The invitations lock's key for the administrator's invitations. */
const ADMIN_KEY = '';

const locks = new KeyedPromiseChainMutex();

/**
 * Run `fn` holding the invitations lock of `plugin` (null: the
 * administrator's invitations).
 *
 * @template T
 * @param {string | null} plugin
 * @param {() => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
export function withInvitationsLock(plugin, fn) {
  return locks.run(plugin ?? ADMIN_KEY, fn);
}

/** `fn(db)` in one `BEGIN IMMEDIATE` transaction, rolled back when it throws. */
function inTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/**
 * The SHA-256 of a token, hex — what is stored and looked up. Null for
 * anything that is not a token.
 *
 * @param {unknown} token
 * @returns {string | null}
 */
export function hashInvitationToken(token) {
  if (typeof token !== 'string' || !INVITATION_TOKEN_RE.test(token)) return null;
  return crypto.createHash('sha256').update(Buffer.from(token, 'hex')).digest('hex');
}

/** A new token and its hash. */
export function newInvitationToken() {
  const token = crypto.randomBytes(INVITATION_TOKEN_BYTES).toString('hex');
  return { token, tokenSha256: /** @type {string} */ (hashInvitationToken(token)) };
}

// ---------------------------------------------------------------------------
// Rows and views
// ---------------------------------------------------------------------------

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * What a row shows: `expired` is a pending invitation past its expiry.
 *
 * @param {{ status: string, expires_at: string }} row
 * @param {number} [now]
 */
export function shownStatus(row, now = Date.now()) {
  if (row.status === 'pending' && !(Date.parse(row.expires_at) > now)) return 'expired';
  return row.status;
}

/**
 * An invitation as this module hands it on — every field, the token's hash
 * never. `domains` is the stored list, or null for an invitation imported
 * from before the multi-domain relay (it names none: the relay's one
 * domain).
 */
function rowToInvitation(row) {
  return {
    id: row.id,
    kind: row.kind,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    emailDomain: row.email_domain,
    groups: parseJson(row.groups_json, []),
    domains: parseJson(row.domains_json, null),
    plugin: row.plugin,
    role: row.role,
    siteId: row.site_id,
    inviterUserId: row.inviter_user_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status,
    shownStatus: shownStatus(row),
    statusAt: row.status_at,
    failedAttempts: row.failed_attempts,
    revokedBy: row.revoked_by,
    revokedReason: row.revoked_reason,
    acceptedUserId: row.accepted_user_id,
    acceptedAt: row.status === 'accepted' ? row.status_at : null,
    roleGrantedAt: row.role_granted_at,
    siteGrantedAt: row.site_granted_at,
    renderedAt: row.rendered_at,
  };
}

/** Whether a delegated invitation's acceptance has completed every grant. */
export function isFulfilled(invitation) {
  if (invitation.kind !== 'delegated') return invitation.status === 'accepted';
  return (
    invitation.status === 'accepted' &&
    invitation.roleGrantedAt !== null &&
    invitation.siteGrantedAt !== null &&
    invitation.renderedAt !== null
  );
}

/**
 * Every invitation, newest first, optionally of one plugin or one inviter.
 *
 * @param {{ plugin?: string, inviterUserId?: string, kind?: 'admin' | 'delegated' }} [filter]
 */
export async function listInvitations({ plugin, inviterUserId, kind } = {}) {
  const db = await getStateDb();
  const where = [];
  const args = [];
  if (plugin !== undefined) {
    where.push('plugin = ?');
    args.push(plugin);
  }
  if (inviterUserId !== undefined) {
    where.push('inviter_user_id = ?');
    args.push(inviterUserId);
  }
  if (kind !== undefined) {
    where.push('kind = ?');
    args.push(kind);
  }
  const sql = `SELECT * FROM invitations${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC, id`;
  return db
    .prepare(sql)
    .all(...args)
    .map(rowToInvitation);
}

/** @param {string} id */
export async function getInvitation(id) {
  const db = await getStateDb();
  const row = db.prepare('SELECT * FROM invitations WHERE id = ?').get(id);
  return row ? rowToInvitation(row) : null;
}

/**
 * The invitation a token opens, whatever its status, or null.
 *
 * @param {unknown} token
 */
export async function findInvitationByToken(token) {
  const sha = hashInvitationToken(token);
  if (!sha) return null;
  const db = await getStateDb();
  const row = db.prepare('SELECT * FROM invitations WHERE token_sha256 = ?').get(sha);
  return row ? rowToInvitation(row) : null;
}

// ---------------------------------------------------------------------------
// The administrator's invitations
// ---------------------------------------------------------------------------

/**
 * Make an administrator's invitation: refused (409) while another open one
 * names the username. Returns the invitation and its token, shown once.
 *
 * @param {{ username: string, email: string, groups: string[], domains: Array<{ name: string, kind: 'member' | 'external' }>, expiresInDays: number }} input
 */
export function createAdminInvitation({ username, email, groups, domains, expiresInDays }) {
  return withInvitationsLock(null, async () => {
    const db = await getStateDb();
    const now = new Date();
    const nowIso = now.toISOString();
    const { token, tokenSha256 } = newInvitationToken();
    const id = crypto.randomUUID();
    inTransaction(db, () => {
      const open = db
        .prepare(
          `SELECT 1 FROM invitations
           WHERE username = ? AND (status = 'accepting' OR (status = 'pending' AND expires_at > ?))`,
        )
        .get(username, nowIso);
      if (open) {
        throw httpError('A pending invitation already exists for this username', 409);
      }
      db.prepare(
        `INSERT INTO invitations (id, token_sha256, kind, username, email, email_domain,
           groups_json, domains_json, created_by, created_at, expires_at, status, status_at)
         VALUES (?, ?, 'admin', ?, ?, ?, ?, ?, 'admin', ?, ?, 'pending', ?)`,
      ).run(
        id,
        tokenSha256,
        username,
        email,
        emailDomainOf(email) ?? '',
        JSON.stringify(groups),
        JSON.stringify(domains),
        nowIso,
        new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString(),
        nowIso,
      );
    });
    return { invitation: await getInvitation(id), token };
  });
}

// ---------------------------------------------------------------------------
// Claims: an acceptance under way
// ---------------------------------------------------------------------------

/**
 * Count a refused acceptance against the invitation behind `token`; the
 * fifth locks it (`revoked`, `attempts_exhausted`). Silent on a token that
 * opens nothing pending.
 *
 * @param {string} id
 * @returns {Promise<{ locked: boolean }>}
 */
export function recordFailedAttempt(id, plugin) {
  return withInvitationsLock(plugin, async () => {
    const db = await getStateDb();
    const now = new Date().toISOString();
    return inTransaction(db, () => {
      const row = db
        .prepare(`SELECT failed_attempts FROM invitations WHERE id = ? AND status = 'pending'`)
        .get(id);
      if (!row) return { locked: false };
      const attempts = row.failed_attempts + 1;
      if (attempts >= INVITATION_MAX_FAILED_ATTEMPTS) {
        db.prepare(
          `UPDATE invitations SET failed_attempts = ?, status = 'revoked', status_at = ?,
             revoked_by = 'lamaste', revoked_reason = 'attempts_exhausted'
           WHERE id = ?`,
        ).run(attempts, now, id);
        return { locked: true };
      }
      db.prepare('UPDATE invitations SET failed_attempts = ? WHERE id = ?').run(attempts, id);
      return { locked: false };
    });
  });
}

/**
 * Inside the invitations lock of the invitation's plugin and a
 * transaction: claim pending, unexpired, unlocked invitation `id` for
 * `username` (`accepting`). Throws 410 when it cannot be claimed any more.
 * The caller holds the lock (it checks the invitation's preconditions in
 * the same hold).
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} id
 * @param {string} username
 */
export function claimInvitationSync(db, id, username) {
  const now = new Date().toISOString();
  const claimed = db
    .prepare(
      `UPDATE invitations SET status = 'accepting', username = ?, status_at = ?
       WHERE id = ? AND status = 'pending' AND expires_at > ? AND failed_attempts < ?`,
    )
    .run(username, now, id, now, INVITATION_MAX_FAILED_ATTEMPTS);
  if (claimed.changes !== 1) throw httpError('This invitation can no longer be accepted', 410);
}

/**
 * Give a claim up: the invitation is pending again (an administrator's keeps
 * its username; a delegated one's is cleared).
 *
 * @param {string} id
 * @param {string | null} plugin
 */
export function releaseClaim(id, plugin) {
  return withInvitationsLock(plugin, async () => {
    const db = await getStateDb();
    db.prepare(
      `UPDATE invitations SET status = 'pending', status_at = ?,
         username = CASE kind WHEN 'delegated' THEN NULL ELSE username END
       WHERE id = ? AND status = 'accepting'`,
    ).run(new Date().toISOString(), id);
  });
}

/**
 * Record a claimed invitation accepted by user `userId`: the copies of the
 * address and name go (the directory holds them).
 *
 * @param {string} id
 * @param {string | null} plugin
 * @param {string} userId
 */
export function markAccepted(id, plugin, userId) {
  return withInvitationsLock(plugin, async () => {
    const db = await getStateDb();
    db.prepare(
      `UPDATE invitations SET status = 'accepted', status_at = ?, accepted_user_id = ?,
         email = NULL, display_name = NULL
       WHERE id = ? AND status = 'accepting'`,
    ).run(new Date().toISOString(), userId, id);
    return getInvitation(id);
  });
}

/**
 * Usernames an acceptance under way has claimed, or an open administrator's
 * invitation names — a delegated invitee may not take one.
 *
 * @returns {Promise<Set<string>>}
 */
export async function reservedInvitationUsernames() {
  const db = await getStateDb();
  const now = new Date().toISOString();
  return new Set(
    db
      .prepare(
        `SELECT username FROM invitations WHERE username IS NOT NULL
           AND (status = 'accepting' OR (status = 'pending' AND expires_at > ?))`,
      )
      .all(now)
      .map((r) => r.username),
  );
}

/**
 * Claims older than {@link INVITATION_ACCEPTING_STALE_MS}: acceptances a
 * crash or a lost request left behind.
 */
export async function staleClaims(now = Date.now()) {
  const db = await getStateDb();
  const before = new Date(now - INVITATION_ACCEPTING_STALE_MS).toISOString();
  return db
    .prepare(`SELECT * FROM invitations WHERE status = 'accepting' AND status_at < ?`)
    .all(before)
    .map(rowToInvitation);
}

// ---------------------------------------------------------------------------
// Revocation, deletion, retention, erasure
// ---------------------------------------------------------------------------

/**
 * Inside the plugin's invitations lock: revoke open invitation `id`
 * (pending, expired or not). Returns whether it was revoked; an `accepting`
 * one is refused (409) — its acceptance is under way.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function revokeInvitationSync(db, id, { by, reason }) {
  const row = db.prepare('SELECT status FROM invitations WHERE id = ?').get(id);
  if (!row) return false;
  if (row.status === 'accepting') {
    throw httpError('This invitation is being accepted right now — try again shortly', 409, {
      code: 'invitation_accepting',
    });
  }
  if (row.status !== 'pending') return false;
  db.prepare(
    `UPDATE invitations SET status = 'revoked', status_at = ?, revoked_by = ?, revoked_reason = ?
     WHERE id = ? AND status = 'pending'`,
  ).run(new Date().toISOString(), by, reason, id);
  return true;
}

/**
 * The administrator's `DELETE /api/invitations/:id`: a pending invitation is
 * revoked, an ended one deleted. 404 when there is none; 409 while it is
 * being accepted.
 *
 * @param {string} id
 * @returns {Promise<{ action: 'revoked' | 'deleted', invitation: object }>}
 */
export async function revokeOrDeleteInvitation(id) {
  const found = await getInvitation(id);
  if (!found) throw httpError('Invitation not found', 404);
  return withInvitationsLock(found.plugin, async () => {
    const db = await getStateDb();
    return inTransaction(db, () => {
      const current = db.prepare('SELECT * FROM invitations WHERE id = ?').get(id);
      if (!current) throw httpError('Invitation not found', 404);
      if (revokeInvitationSync(db, id, { by: 'admin', reason: 'admin' })) {
        return { action: 'revoked', invitation: rowToInvitation(current) };
      }
      db.prepare('DELETE FROM invitations WHERE id = ?').run(id);
      return { action: 'deleted', invitation: rowToInvitation(current) };
    });
  });
}

/**
 * Delete invitations that ended without acceptance (revoked, or pending
 * past expiry) more than {@link INVITATION_RETENTION_DAYS} ago.
 *
 * @returns {Promise<number>} how many went
 */
export async function pruneEndedInvitations(now = Date.now()) {
  const db = await getStateDb();
  const before = new Date(now - INVITATION_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const result = db
    .prepare(
      `DELETE FROM invitations
       WHERE (status = 'revoked' AND status_at < ?) OR (status = 'pending' AND expires_at < ?)`,
    )
    .run(before, before);
  return Number(result.changes);
}

/**
 * Erasing a removed user: delete the invitations they accepted and the
 * administrator's invitations naming their username made at or before
 * `removedAt` (a later one is someone else's).
 *
 * @param {{ userId: string, username: string | null, removedAt: string }} user
 * @returns {Promise<number>} how many went
 */
export async function purgeInvitationsOf({ userId, username, removedAt }) {
  const db = await getStateDb();
  return inTransaction(db, () => {
    let count = Number(
      db.prepare('DELETE FROM invitations WHERE accepted_user_id = ?').run(userId).changes,
    );
    if (username) {
      count += Number(
        db
          .prepare(
            `DELETE FROM invitations WHERE kind = 'admin' AND username = ? AND created_at <= ?`,
          )
          .run(username, removedAt).changes,
      );
    }
    return count;
  });
}

// ---------------------------------------------------------------------------
// The import of invitations.json
// ---------------------------------------------------------------------------

/** An ISO time a legacy row carries, or `fallback`. */
function isoOr(value, fallback) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : fallback;
}

/**
 * Import invitations.json into state.db, then delete it — whenever it
 * exists. By id, in one transaction: a row state.db already holds is never
 * touched; tokens are hashed; `used` becomes `accepted` (the user found by
 * username in the directory). A row without a usable token, username or
 * address is dropped (it could never be accepted). Returns how many rows
 * were imported, or null when there was no file.
 *
 * @param {{ logger?: import('pino').Logger }} [opts]
 * @returns {Promise<number | null>}
 */
export async function importLegacyInvitations({ logger } = {}) {
  const legacy = await readLegacyInvitations();
  if (legacy === null) return null;
  const imported = await withInvitationsLock(null, async () => {
    const db = await getStateDb();
    const userIdOf = db.prepare(
      `SELECT user_id FROM directory_users WHERE username = ? ORDER BY created_at DESC LIMIT 1`,
    );
    const insert = db.prepare(
      `INSERT OR IGNORE INTO invitations (id, token_sha256, kind, username, email, email_domain,
         groups_json, domains_json, created_by, created_at, expires_at, status, status_at,
         accepted_user_id)
       VALUES (?, ?, 'admin', ?, ?, ?, ?, ?, 'admin', ?, ?, ?, ?, ?)`,
    );
    const nowIso = new Date().toISOString();
    return inTransaction(db, () => {
      let count = 0;
      for (const inv of legacy) {
        if (!inv || typeof inv !== 'object') continue;
        const sha = hashInvitationToken(inv.token);
        if (typeof inv.id !== 'string' || inv.id.length === 0 || inv.id.length > 64) continue;
        if (!sha || typeof inv.username !== 'string' || typeof inv.email !== 'string') continue;
        const createdAt = isoOr(inv.createdAt, nowIso);
        const accepted = inv.used === true;
        const acceptedAt = isoOr(inv.acceptedAt, createdAt);
        const result = insert.run(
          inv.id,
          sha,
          inv.username,
          accepted ? null : inv.email,
          emailDomainOf(inv.email) ?? '',
          JSON.stringify(Array.isArray(inv.groups) ? inv.groups : []),
          JSON.stringify(Array.isArray(inv.domains) ? inv.domains : null),
          createdAt,
          isoOr(inv.expiresAt, createdAt),
          accepted ? 'accepted' : 'pending',
          accepted ? acceptedAt : createdAt,
          accepted ? (userIdOf.get(inv.username)?.user_id ?? null) : null,
        );
        count += Number(result.changes);
      }
      return count;
    });
  });
  await removeLegacyInvitations();
  logger?.info({ imported, rows: legacy.length }, 'invitations.json imported into state.db');
  return imported;
}
