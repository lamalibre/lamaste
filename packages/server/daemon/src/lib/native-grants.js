/**
 * Native grants — one person's sign-in on one device with one native client
 * (native-apps-design.md D4, review R7–R14).
 *
 * A grant is made by the token broker (`routes/native-oauth.js`) when a
 * native client exchanges an authorization code, and lives as the chain of
 * refresh tokens Authelia rotates: Lamaste keeps only their SHA-256 — the
 * `current` one, and the `spent` ones that tell a reuse — and the SHA-256 of
 * every access token it saw issued (the allow-list of the user surface's
 * bearer path, {@link liveAccessToken}). A grant ends (`revoked_at`, with a
 * reason from core `NATIVE_GRANT_END_REASONS`) when:
 *
 * - its idle or absolute lifetime passes (checked at every refresh, every
 *   bearer request and every tick);
 * - a spent refresh token is presented again after the grace window
 *   (`reuse` — audited and notified);
 * - Authelia refuses its current token, or answers 5xx three times while it
 *   is up (`issuer_refused`);
 * - the person's **standing** ends ({@link nativeStanding}): disabled,
 *   removed or erased, no longer a member of the host's domain, no role on
 *   any plugin the host serves, or — on a restricted host — no grant for
 *   the host;
 * - its client is disabled or deleted, its host deleted, the app signs out,
 *   or an administrator revokes it.
 *
 * **Locks (R14).** Grants are a leaf: a per-grant lock serializes the
 * broker's work on one grant, and nothing is awaited inside it but state.db
 * and Authelia on loopback. Revocation takes no lock at all — one
 * transaction — so offboarding, domain changes and the tick call it from
 * inside their own locks; the broker's rotation commits with a
 * compare-and-swap on the grant's version (R7) and loses to a revocation
 * that came first.
 */

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

import { isNativeGrantEndReason } from '@lamalibre/lamaste';

import { recordAuditBestEffort } from './audit.js';
import { listGatekeeperGroups, listResourceGrants } from './gatekeeper-client.js';
import { getStateDb } from './state-db.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long an ended grant's row stays for the listings (the audit keeps the history). */
export const NATIVE_GRANT_ENDED_RETENTION_MS = 30 * DAY_MS;

/** How often the tick checks every live grant. */
export const NATIVE_TICK_INTERVAL_MS = 60_000;

/**
 * Where the broker tells who signed in (sign-in events, design D7): emits
 * `sign-in` with `{ grantId, clientId, userId, at }` after a grant is made.
 * Delivery to the plugins is lib/sign-in-events.js's.
 */
export const nativeSignIns = new EventEmitter();

// ---------------------------------------------------------------------------
// The per-grant lock
// ---------------------------------------------------------------------------

const grantLocks = new Map();

/**
 * Run `fn` holding grant `grantId`'s lock (a leaf: never take another lock
 * inside). The key is dropped once its queue is empty.
 *
 * @template T
 * @param {string} grantId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withGrantLock(grantId, fn) {
  const previous = grantLocks.get(grantId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  grantLocks.set(grantId, settled);
  void settled.then(() => {
    if (grantLocks.get(grantId) === settled) grantLocks.delete(grantId);
  });
  return run;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** SHA-256 of a token, hex. */
export function tokenSha256(token) {
  return crypto.createHash('sha256').update(token, 'utf-8').digest('hex');
}

function grantOf(row) {
  return {
    grantId: row.grant_id,
    clientId: row.client_id,
    userId: row.user_id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    absoluteExpiresAt: row.absolute_expires_at,
    deviceName: row.device_name,
    userAgent: row.user_agent,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
    issuerFailures: row.issuer_failures,
    version: row.version,
  };
}

/**
 * The refresh token whose SHA-256 is `sha256`, with its grant: `{ token:
 * { state, spentAt, graceUntil, graceAnswer }, grant }`, or null.
 *
 * @param {string} sha256
 */
export async function findRefreshToken(sha256) {
  const db = await getStateDb();
  const row = db.prepare('SELECT * FROM native_refresh_tokens WHERE sha256 = ?').get(sha256);
  if (!row) return null;
  const grant = db.prepare('SELECT * FROM native_grants WHERE grant_id = ?').get(row.grant_id);
  if (!grant) return null;
  return {
    token: {
      state: row.state,
      issuedAt: row.issued_at,
      spentAt: row.spent_at,
      graceUntil: row.grace_until,
      graceAnswer: row.grace_answer,
    },
    grant: grantOf(grant),
  };
}

/** One grant, or null. */
export async function getNativeGrant(grantId) {
  const db = await getStateDb();
  const row = db.prepare('SELECT * FROM native_grants WHERE grant_id = ?').get(grantId);
  return row ? grantOf(row) : null;
}

/**
 * Whether grant `grant` of a client with these lifetimes has run out at
 * `now`: `idle_expired`, `absolute_expired`, or null.
 *
 * @param {{ lastUsedAt: number, absoluteExpiresAt: number }} grant
 * @param {{ idleDays: number }} client
 */
export function grantExpiry(grant, client, now = Date.now()) {
  if (now >= grant.absoluteExpiresAt) return 'absolute_expired';
  if (now >= grant.lastUsedAt + client.idleDays * DAY_MS) return 'idle_expired';
  return null;
}

/**
 * Make a grant from an authorization-code exchange, in one transaction
 * that first checks the user is still active (R7: standing's directory
 * part, again, where nothing can change it before the row exists).
 * Returns the grant, or null when the user is no longer active.
 *
 * @param {{ clientId: string, userId: string, absoluteDays: number, deviceName: string | null, userAgent: string | null, refreshSha256: string, accessSha256: string, accessExpiresAt: number }} spec
 */
export async function createNativeGrant(spec) {
  const db = await getStateDb();
  const now = Date.now();
  const grantId = crypto.randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    const user = db
      .prepare('SELECT status FROM directory_users WHERE user_id = ?')
      .get(spec.userId);
    if (user?.status !== 'active') {
      db.exec('ROLLBACK');
      return null;
    }
    db.prepare(
      `INSERT INTO native_grants (grant_id, client_id, user_id, created_at, last_used_at,
         absolute_expires_at, device_name, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      grantId,
      spec.clientId,
      spec.userId,
      now,
      now,
      now + spec.absoluteDays * DAY_MS,
      spec.deviceName,
      spec.userAgent,
    );
    db.prepare(
      `INSERT INTO native_refresh_tokens (sha256, grant_id, state, issued_at)
       VALUES (?, ?, 'current', ?)`,
    ).run(spec.refreshSha256, grantId, now);
    db.prepare(
      'INSERT INTO native_access_tokens (token_sha256, grant_id, expires_at) VALUES (?, ?, ?)',
    ).run(spec.accessSha256, grantId, spec.accessExpiresAt);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getNativeGrant(grantId);
}

/**
 * Commit a rotation with compare-and-swap (R7): grant `grantId` still live
 * at `version`, `oldSha256` still its current token. The old token becomes
 * spent with its sealed answer kept until `graceUntil`; the new one current;
 * the new access token allow-listed; `last_used_at` now; the issuer's
 * failure count reset. Returns false when it lost (revoked or rotated
 * meanwhile) — nothing is written then.
 *
 * @param {{ grantId: string, version: number, oldSha256: string, newSha256: string, accessSha256: string, accessExpiresAt: number, graceUntil: number, graceAnswer: string }} spec
 */
export async function commitNativeRotation(spec) {
  const db = await getStateDb();
  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const bumped = db
      .prepare(
        `UPDATE native_grants SET last_used_at = ?, issuer_failures = 0, version = version + 1
         WHERE grant_id = ? AND version = ? AND revoked_at IS NULL`,
      )
      .run(now, spec.grantId, spec.version);
    const spent = db
      .prepare(
        `UPDATE native_refresh_tokens SET state = 'spent', spent_at = ?, grace_until = ?,
           grace_answer = ?
         WHERE sha256 = ? AND grant_id = ? AND state = 'current'`,
      )
      .run(now, spec.graceUntil, spec.graceAnswer, spec.oldSha256, spec.grantId);
    if (bumped.changes !== 1 || spent.changes !== 1) {
      db.exec('ROLLBACK');
      return false;
    }
    db.prepare(
      `INSERT INTO native_refresh_tokens (sha256, grant_id, state, issued_at)
       VALUES (?, ?, 'current', ?)`,
    ).run(spec.newSha256, spec.grantId, now);
    db.prepare(
      'INSERT INTO native_access_tokens (token_sha256, grant_id, expires_at) VALUES (?, ?, ?)',
    ).run(spec.accessSha256, spec.grantId, spec.accessExpiresAt);
    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Count one 5xx Authelia answered for grant `grantId`'s current token while
 * it was up (R9); returns the count now.
 *
 * @param {string} grantId
 */
export async function countIssuerFailure(grantId) {
  const db = await getStateDb();
  db.prepare(
    'UPDATE native_grants SET issuer_failures = issuer_failures + 1 WHERE grant_id = ? AND revoked_at IS NULL',
  ).run(grantId);
  return (
    db.prepare('SELECT issuer_failures FROM native_grants WHERE grant_id = ?').get(grantId)
      ?.issuer_failures ?? 0
  );
}

/**
 * End the live grants `filter` names — one `grantId`, or all of a
 * `clientId` and/or a `userId` — for `reason`, in one transaction (no
 * lock: callers may hold theirs). Each grant's current refresh token
 * becomes spent (a later presentation is refused, never a reuse to report
 * twice) and its access tokens leave the allow-list — the bearer path
 * refuses them at once. Audited `native-app.grant.revoked` (ids and the
 * reason only). Returns the ended grants.
 *
 * @param {{ grantId?: string, clientId?: string, userId?: string }} filter
 * @param {import('@lamalibre/lamaste').NativeGrantEndReason} reason
 * @param {{ actor?: string, logger?: import('pino').Logger }} [opts]
 * @returns {Promise<Array<{ grantId: string, clientId: string, userId: string }>>}
 */
export async function revokeNativeGrants(filter, reason, { actor = 'lamaste', logger } = {}) {
  if (!isNativeGrantEndReason(reason)) throw new Error(`Not a grant end reason: ${reason}`);
  const where = [];
  const args = [];
  for (const [column, value] of [
    ['grant_id', filter.grantId],
    ['client_id', filter.clientId],
    ['user_id', filter.userId],
  ]) {
    if (value === undefined) continue;
    where.push(`${column} = ?`);
    args.push(value);
  }
  if (where.length === 0) throw new Error('A revocation names a grant, a client or a user');
  const db = await getStateDb();
  const now = Date.now();
  let ended;
  db.exec('BEGIN IMMEDIATE');
  try {
    ended = db
      .prepare(
        `SELECT grant_id, client_id, user_id FROM native_grants
         WHERE ${where.join(' AND ')} AND revoked_at IS NULL`,
      )
      .all(...args);
    const end = db.prepare(
      `UPDATE native_grants SET revoked_at = ?, revoked_reason = ?, version = version + 1
       WHERE grant_id = ? AND revoked_at IS NULL`,
    );
    // The current token spent, every grace answer dropped: nothing of the
    // grant is answered again.
    const spend = db.prepare(
      `UPDATE native_refresh_tokens SET state = 'spent', spent_at = ? WHERE grant_id = ? AND state = 'current'`,
    );
    const dropGrace = db.prepare(
      'UPDATE native_refresh_tokens SET grace_until = NULL, grace_answer = NULL WHERE grant_id = ?',
    );
    const unlist = db.prepare('DELETE FROM native_access_tokens WHERE grant_id = ?');
    for (const g of ended) {
      end.run(now, reason, g.grant_id);
      spend.run(now, g.grant_id);
      dropGrace.run(g.grant_id);
      unlist.run(g.grant_id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const result = ended.map((g) => ({
    grantId: g.grant_id,
    clientId: g.client_id,
    userId: g.user_id,
  }));
  if (result.length > 0) {
    await recordAuditBestEffort(
      {
        actor,
        action: 'native-app.grant.revoked',
        details: {
          reason,
          count: result.length,
          grants: result.slice(0, 20).map(({ grantId, clientId, userId }) => ({
            grantId,
            clientId,
            userId,
          })),
        },
      },
      logger,
    );
    logger?.info({ reason, count: result.length }, 'Native grants revoked');
  }
  return result;
}

/** Drop every grant of client `clientId` and its tokens (the client is deleted). */
export async function deleteNativeGrantsOfClient(clientId) {
  const db = await getStateDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const ids = db
      .prepare('SELECT grant_id FROM native_grants WHERE client_id = ?')
      .all(clientId)
      .map((r) => r.grant_id);
    dropGrantRowsSync(db, ids);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function dropGrantRowsSync(db, grantIds) {
  const tokens = db.prepare('DELETE FROM native_refresh_tokens WHERE grant_id = ?');
  const access = db.prepare('DELETE FROM native_access_tokens WHERE grant_id = ?');
  const grant = db.prepare('DELETE FROM native_grants WHERE grant_id = ?');
  for (const id of grantIds) {
    tokens.run(id);
    access.run(id);
    grant.run(id);
  }
}

/**
 * Forget an erased user: their grants (ended by then) and tokens, and the
 * sign-in events still queued for them.
 *
 * @param {string} userId
 */
export async function eraseNativeDataOfUser(userId) {
  const db = await getStateDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const ids = db
      .prepare('SELECT grant_id FROM native_grants WHERE user_id = ?')
      .all(userId)
      .map((r) => r.grant_id);
    dropGrantRowsSync(db, ids);
    db.prepare('DELETE FROM native_sign_in_events WHERE user_id = ?').run(userId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// The bearer path's allow-list
// ---------------------------------------------------------------------------

/**
 * Whether the access token whose SHA-256 is `tokenSha256` is live for
 * client `clientId` and user `username` (design D3, R10, R15): issued
 * through the broker for a grant of that client, not expired, its grant
 * live and within its idle and absolute lifetimes, its user active and
 * holding that username. `{ ok: true, grantId, userId }`, or `{ ok: false,
 * reason }` (`unknown`, `expired`, `revoked`, `wrong_client`,
 * `grant_expired`, `wrong_user`).
 *
 * @param {string} tokenSha256
 * @param {string} clientId
 * @param {string} username
 */
export async function liveAccessToken(tokenSha256, clientId, username, now = Date.now()) {
  const db = await getStateDb();
  const row = db
    .prepare(
      `SELECT a.expires_at, g.grant_id, g.client_id, g.user_id, g.revoked_at, g.last_used_at,
              g.absolute_expires_at, c.idle_days, u.username, u.status
       FROM native_access_tokens a
       JOIN native_grants g ON g.grant_id = a.grant_id
       LEFT JOIN native_clients c ON c.client_id = g.client_id
       LEFT JOIN directory_users u ON u.user_id = g.user_id
       WHERE a.token_sha256 = ?`,
    )
    .get(tokenSha256);
  if (!row) return { ok: false, reason: 'unknown' };
  if (row.expires_at <= now) return { ok: false, reason: 'expired' };
  if (row.revoked_at !== null) return { ok: false, reason: 'revoked' };
  if (row.client_id !== clientId || row.idle_days === null) {
    return { ok: false, reason: 'wrong_client' };
  }
  const expiry = grantExpiry(
    { lastUsedAt: row.last_used_at, absoluteExpiresAt: row.absolute_expires_at },
    { idleDays: row.idle_days },
    now,
  );
  if (expiry) return { ok: false, reason: 'grant_expired' };
  if (row.status !== 'active' || row.username !== username) {
    return { ok: false, reason: 'wrong_user' };
  }
  return { ok: true, grantId: row.grant_id, userId: row.user_id };
}

/**
 * Whether grant `grantId` is still live — for the open-response sweep of
 * the bearer path.
 *
 * @param {string} grantId
 */
export async function isNativeGrantLive(grantId) {
  const db = await getStateDb();
  const row = db.prepare('SELECT revoked_at FROM native_grants WHERE grant_id = ?').get(grantId);
  return row !== undefined && row.revoked_at === null;
}

// ---------------------------------------------------------------------------
// Standing
// ---------------------------------------------------------------------------

/**
 * A standing check's shared reads: the host state and, per restricted
 * host, who holds its grant (directly or through a Lamaste group) — read
 * from Gatekeeper at most once per check (R13).
 *
 * @param {{ checkHostGrant: boolean, state?: object }} opts
 */
export async function standingContext({ checkHostGrant, state }) {
  const { readHostState } = await import('./native-apps.js');
  return {
    checkHostGrant,
    state: state ?? (await readHostState()),
    hostHolders: new Map(),
    groups: null,
  };
}

async function hostGrantHolders(ctx, host) {
  const key = `${host.kind}:${host.id}`;
  if (!ctx.hostHolders.has(key)) {
    ctx.hostHolders.set(
      key,
      (async () => {
        const listed = await listResourceGrants(host.kind, host.id);
        if (!listed.ok) return null;
        const holders = new Set(
          listed.grants.filter((g) => g.principalType === 'user').map((g) => g.principalId),
        );
        const granted = new Set(
          listed.grants.filter((g) => g.principalType === 'group').map((g) => g.principalId),
        );
        if (granted.size > 0) {
          ctx.groups ??= listGatekeeperGroups();
          const groups = await ctx.groups;
          if (!groups.ok) return null;
          for (const group of groups.groups) {
            if (granted.has(group.name)) for (const m of group.members) holders.add(m);
          }
        }
        return holders;
      })(),
    );
  }
  return ctx.hostHolders.get(key);
}

/**
 * A user's standing with a native client (design D4): `{ ok: true }`;
 * `{ ok: false, reason }` — a `standing:*` reason, `client_disabled` or
 * `host_deleted` — when it has ended; `{ unavailable: true }` when it
 * cannot be told now (Gatekeeper unreadable, the host bound to no route,
 * its domain not active): never a reason to end a grant.
 *
 * In order: the directory user is active (`standing:disabled`,
 * `standing:removed`, `standing:erased`) and holds no username a pending
 * principal cleanup still names (`standing:cleanup_pending`); the client
 * is served; the user is a member of the host's domain, or an external
 * member and the host restricted (`standing:not_member`); an active member
 * of the audience of at least one plugin bound to the host, with a role it
 * declares (`standing:no_role`); on a restricted host, holding the host's
 * grant (`standing:no_grant`) — only when `ctx.checkHostGrant`.
 *
 * @param {string} userId
 * @param {ReturnType<typeof import('./native-apps.js').resolveNativeClient>} client
 * @param {Awaited<ReturnType<typeof standingContext>>} ctx
 */
export async function nativeStanding(userId, client, ctx) {
  const db = await getStateDb();
  const user = db
    .prepare('SELECT username, status, erased_at FROM directory_users WHERE user_id = ?')
    .get(userId);
  if (!user || user.status === 'removed') {
    return { ok: false, reason: user?.erased_at ? 'standing:erased' : 'standing:removed' };
  }
  if (user.status !== 'active') return { ok: false, reason: 'standing:disabled' };
  const { principalCleanupPending } = await import('./directory.js');
  if (user.username === null || (await principalCleanupPending(user.username))) {
    return { ok: false, reason: 'standing:cleanup_pending' };
  }

  if (!client.served) {
    if (client.reason === 'disabled') return { ok: false, reason: 'client_disabled' };
    if (client.reason === 'host_missing') return { ok: false, reason: 'host_deleted' };
    return { unavailable: true, why: client.reason };
  }
  const { host } = client;
  if (!host || host.routes.length === 0) return { unavailable: true, why: 'host_unbound' };

  const membership = db
    .prepare('SELECT kind FROM domain_members WHERE domain = ? AND user_id = ?')
    .get(client.domain, userId);
  if (!membership) return { ok: false, reason: 'standing:not_member' };
  if (membership.kind === 'external' && host.accessMode !== 'restricted') {
    return { ok: false, reason: 'standing:not_member' };
  }

  if (!(await holdsRoleOnHost(userId, host))) return { ok: false, reason: 'standing:no_role' };

  if (host.accessMode === 'restricted' && ctx.checkHostGrant) {
    const holders = await hostGrantHolders(ctx, host);
    if (holders === null) return { unavailable: true, why: 'gatekeeper' };
    if (!holders.has(user.username)) return { ok: false, reason: 'standing:no_grant' };
  }
  return { ok: true };
}

/**
 * Whether user `userId` is an active member, with a declared role, of the
 * audience of a plugin bound to `host` — bound, not only served: a hosting
 * that is down for a while ends no one's grant.
 */
async function holdsRoleOnHost(userId, host) {
  const { findPluginByRoute } = await import('./plugins.js');
  const { readAudienceRow } = await import('./audience.js');
  const { declaredRoleIds } = await import('./entitlements.js');
  for (const route of host.routes) {
    const plugin = await findPluginByRoute(route);
    if (!plugin?.identity) continue;
    const row = await readAudienceRow(plugin.name, userId);
    const member = row?.change?.kind === 'upsert' ? row.change.member : null;
    if (!member || member.status !== 'active' || member.userId !== userId) continue;
    const declared = declaredRoleIds(plugin.identity);
    if ((Array.isArray(member.roles) ? member.roles : []).some((r) => declared.has(r))) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// The checks over every live grant
// ---------------------------------------------------------------------------

/**
 * Check every live grant now: its lifetimes, its client, and its user's
 * standing — the restricted hosts' grants only with `checkHostGrant` (they
 * cost Gatekeeper calls; the tick asks, the hook after an audience
 * recompute does not). Ends the grants whose time or standing is over.
 * Returns how many were ended.
 *
 * @param {{ checkHostGrant?: boolean, logger?: import('pino').Logger }} [opts]
 */
export async function runNativeStandingCheck({ checkHostGrant = false, logger } = {}) {
  const db = await getStateDb();
  const live = db
    .prepare('SELECT * FROM native_grants WHERE revoked_at IS NULL ORDER BY client_id')
    .all()
    .map(grantOf);
  if (live.length === 0) return 0;
  const { findResolvedNativeClient } = await import('./native-apps.js');
  const ctx = await standingContext({ checkHostGrant });
  const clients = new Map();
  const now = Date.now();
  let ended = 0;
  for (const grant of live) {
    if (!clients.has(grant.clientId)) {
      clients.set(grant.clientId, await findResolvedNativeClient(grant.clientId, ctx.state));
    }
    const client = clients.get(grant.clientId);
    let reason = null;
    if (!client) {
      reason = 'client_deleted';
    } else {
      reason = grantExpiry(grant, client, now);
      if (!reason) {
        const standing = await nativeStanding(grant.userId, client, ctx);
        if (standing.ok === false) reason = standing.reason;
      }
    }
    if (reason) {
      ended += (await revokeNativeGrants({ grantId: grant.grantId }, reason, { logger })).length;
    }
  }
  return ended;
}

/**
 * Drop what is no longer needed: access tokens past their expiry, grace
 * answers past their window, and grants ended more than
 * {@link NATIVE_GRANT_ENDED_RETENTION_MS} ago with their tokens.
 */
export async function pruneNativeGrants(now = Date.now()) {
  const db = await getStateDb();
  db.prepare('DELETE FROM native_access_tokens WHERE expires_at <= ?').run(now);
  db.prepare(
    'UPDATE native_refresh_tokens SET grace_answer = NULL, grace_until = NULL WHERE grace_until IS NOT NULL AND grace_until < ?',
  ).run(now);
  const old = db
    .prepare('SELECT grant_id FROM native_grants WHERE revoked_at IS NOT NULL AND revoked_at < ?')
    .all(now - NATIVE_GRANT_ENDED_RETENTION_MS)
    .map((r) => r.grant_id);
  if (old.length > 0) {
    db.exec('BEGIN IMMEDIATE');
    try {
      dropGrantRowsSync(db, old);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

let checkQueue = Promise.resolve();
/** @type {{ checkHostGrant: boolean, promise: Promise<number> } | null} */
let pendingCheck = null;

/**
 * Check every live grant soon ({@link runNativeStandingCheck}); calls made
 * while one waits join it (asking for the restricted hosts' grants if any
 * caller did). Never await it inside a lock: it reads what locks guard.
 *
 * @param {{ checkHostGrant?: boolean, logger?: import('pino').Logger }} [opts]
 * @returns {Promise<number>}
 */
export function scheduleNativeStandingCheck({ checkHostGrant = false, logger } = {}) {
  if (pendingCheck) {
    pendingCheck.checkHostGrant ||= checkHostGrant;
    return pendingCheck.promise;
  }
  const job = { checkHostGrant, promise: null };
  job.promise = checkQueue.then(async () => {
    pendingCheck = null;
    try {
      return await runNativeStandingCheck({ checkHostGrant: job.checkHostGrant, logger });
    } catch (err) {
      logger?.warn({ err: err.message }, 'Native grant standing check failed');
      return 0;
    }
  });
  pendingCheck = job;
  checkQueue = job.promise.then(
    () => undefined,
    () => undefined,
  );
  return job.promise;
}

/**
 * One tick: native clients whose host is gone removed, every live grant
 * checked (restricted hosts' grants too), old rows pruned, the hosts'
 * association files and redirect pages written where they changed.
 *
 * @param {import('pino').Logger} [logger]
 */
export async function nativeTick(logger) {
  try {
    const { reconcileNativeClientHosts } = await import('./native-apps.js');
    await reconcileNativeClientHosts(logger);
    await scheduleNativeStandingCheck({ checkHostGrant: true, logger });
    await pruneNativeGrants();
  } catch (err) {
    logger?.warn({ err: err.message }, 'Native grant tick failed');
  }
  // The hosts' files follow the clients and their domains' brand and
  // language (a change of either is seen within a minute).
  try {
    const { syncNativeAppFiles } = await import('./native-files.js');
    await syncNativeAppFiles({ logger });
  } catch (err) {
    logger?.warn({ err: err.message }, 'Native app files were not written');
  }
}

let tickTimer = null;

/** Start the native tick (every minute; the first one now). */
export function startNativeServices(logger) {
  if (tickTimer) return;
  void nativeTick(logger);
  tickTimer = setInterval(() => void nativeTick(logger), NATIVE_TICK_INTERVAL_MS);
  tickTimer.unref();
}

export function stopNativeServices() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());

/**
 * Grants as the API lists them: `clientId` and/or `userId` filters,
 * `status` `live` (default), `ended` or `all`. Newest first, at most 500.
 *
 * @param {{ clientId?: string, userId?: string, status?: 'live' | 'ended' | 'all' }} filter
 */
export async function listNativeGrants({ clientId, userId, status = 'live' } = {}) {
  const where = [];
  const args = [];
  if (clientId !== undefined) {
    where.push('g.client_id = ?');
    args.push(clientId);
  }
  if (userId !== undefined) {
    where.push('g.user_id = ?');
    args.push(userId);
  }
  if (status === 'live') where.push('g.revoked_at IS NULL');
  if (status === 'ended') where.push('g.revoked_at IS NOT NULL');
  const db = await getStateDb();
  const rows = db
    .prepare(
      `SELECT g.*, c.idle_days, u.username FROM native_grants g
       LEFT JOIN native_clients c ON c.client_id = g.client_id
       LEFT JOIN directory_users u ON u.user_id = g.user_id
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY g.created_at DESC LIMIT 500`,
    )
    .all(...args);
  return rows.map((row) => {
    const grant = grantOf(row);
    const idleUntil = row.idle_days === null ? null : grant.lastUsedAt + row.idle_days * DAY_MS;
    return {
      grantId: grant.grantId,
      clientId: grant.clientId,
      userId: grant.userId,
      username: row.username ?? null,
      deviceName: grant.deviceName,
      userAgent: grant.userAgent,
      createdAt: iso(grant.createdAt),
      lastUsedAt: iso(grant.lastUsedAt),
      expiresAt: iso(
        idleUntil === null ? grant.absoluteExpiresAt : Math.min(idleUntil, grant.absoluteExpiresAt),
      ),
      absoluteExpiresAt: iso(grant.absoluteExpiresAt),
      status: grant.revokedAt === null ? 'live' : 'ended',
      endedAt: iso(grant.revokedAt),
      endedReason: grant.revokedReason,
    };
  });
}
