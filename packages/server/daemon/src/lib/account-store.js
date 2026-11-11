/**
 * What a person's own account flows keep in state.db
 * (packages/core/docs/mail-design.md §6.2, §6.3; migration 0023):
 *
 * - `password_resets` — forgot-password links: the token's SHA-256 only,
 *   30 minutes, single use, five failures void one; a new link for a user
 *   voids that user's earlier ones; swept a day after they were made;
 * - `account_totp_steps` — the TOTP steps a reset accepted, per user, so a
 *   code is good once (after a restart too); swept after 10 minutes;
 * - `account_password_failures` — wrong current passwords on the
 *   change-password page, per user; swept after an hour.
 *
 * Synchronous helpers over the one state.db connection; the callers
 * (lib/account.js) serialise each user's changes.
 */

import crypto from 'node:crypto';

import { PASSWORD_RESET_TOKEN_RE, PASSWORD_RESET_TTL_MINUTES } from '@lamalibre/lamaste';

const MINUTE_MS = 60_000;
/** A reset row is kept this long after it was made. */
const RESET_RETENTION_MS = 24 * 60 * MINUTE_MS;
/** An accepted TOTP step is remembered this long (well past ±1 step of 30 s). */
const TOTP_STEP_RETENTION_MS = 10 * MINUTE_MS;
/** A wrong current password is remembered this long. */
const PASSWORD_FAILURE_RETENTION_MS = 60 * MINUTE_MS;

/** The SHA-256 of a reset token, hex — what is stored and looked up; null for anything else. */
export function hashResetToken(token) {
  if (typeof token !== 'string' || !PASSWORD_RESET_TOKEN_RE.test(token)) return null;
  return crypto.createHash('sha256').update(Buffer.from(token, 'hex')).digest('hex');
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

/** How many reset links user `userId` was given since `since`. */
export function resetsSince(db, userId, since) {
  return Number(
    db
      .prepare('SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at > ?')
      .get(userId, since.toISOString()).n,
  );
}

/**
 * Whether user `userId` holds a live link (unused, unexpired) made after
 * `since` — a new start then mails nothing (§6.2): the link they have
 * still works.
 */
export function hasRecentLiveReset(db, userId, since, now) {
  return (
    db
      .prepare(
        `SELECT 1 FROM password_resets
         WHERE user_id = ? AND used_at IS NULL AND expires_at > ? AND created_at > ? LIMIT 1`,
      )
      .get(userId, now.toISOString(), since.toISOString()) !== undefined
  );
}

/**
 * A new reset link for user `userId` on `domain`: their earlier live links
 * voided, the new one's hash stored. Returns the token (mailed, never kept).
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ userId: string, username: string, domain: string, now: Date }} input
 */
export function issueReset(db, { userId, username, domain, now }) {
  const token = crypto.randomBytes(32).toString('hex');
  const sha = /** @type {string} */ (hashResetToken(token));
  const nowIso = now.toISOString();
  inTransaction(db, () => {
    voidResetsSync(db, userId, nowIso);
    db.prepare(
      `INSERT INTO password_resets (token_sha256, user_id, username, domain, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      sha,
      userId,
      username,
      domain,
      nowIso,
      new Date(now.getTime() + PASSWORD_RESET_TTL_MINUTES * MINUTE_MS).toISOString(),
    );
  });
  return token;
}

/** Void every live link of `userId` (a new one, or a password set). */
function voidResetsSync(db, userId, nowIso) {
  db.prepare(
    `UPDATE password_resets SET expires_at = ?
     WHERE user_id = ? AND used_at IS NULL AND expires_at > ?`,
  ).run(nowIso, userId, nowIso);
}

/**
 * The live reset row a token opens on `domain` — unused, unexpired, fewer
 * than `maxFailures` failures — or null.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} tokenSha256
 * @param {string} domain
 * @param {number} maxFailures
 * @param {Date} now
 */
export function liveReset(db, tokenSha256, domain, maxFailures, now) {
  return (
    db
      .prepare(
        `SELECT * FROM password_resets
         WHERE token_sha256 = ? AND domain = ? AND used_at IS NULL AND expires_at > ?
           AND failed_attempts < ?`,
      )
      .get(tokenSha256, domain, now.toISOString(), maxFailures) ?? null
  );
}

/** Count a failure against reset `id`; the number of failures it now has. */
export function recordResetFailure(db, id) {
  db.prepare('UPDATE password_resets SET failed_attempts = failed_attempts + 1 WHERE id = ?').run(
    id,
  );
  return Number(
    db.prepare('SELECT failed_attempts AS n FROM password_resets WHERE id = ?').get(id).n,
  );
}

/** Reset `id` used: it and every other live link of its user are void. */
export function finishReset(db, id, userId, now) {
  const nowIso = now.toISOString();
  inTransaction(db, () => {
    db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(nowIso, id);
    voidResetsSync(db, userId, nowIso);
  });
}

/**
 * Accept TOTP step `step` for `userId` once: false when it was accepted
 * before (a replayed code).
 */
export function acceptTotpStep(db, userId, step, now) {
  const result = db
    .prepare(
      'INSERT OR IGNORE INTO account_totp_steps (user_id, step, accepted_at) VALUES (?, ?, ?)',
    )
    .run(userId, step, now.toISOString());
  return Number(result.changes) === 1;
}

/** Wrong current passwords of `userId` since `since`. */
export function passwordFailuresSince(db, userId, since) {
  return Number(
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM account_password_failures WHERE user_id = ? AND failed_at > ?',
      )
      .get(userId, since.toISOString()).n,
  );
}

/** One more wrong current password of `userId`. */
export function recordPasswordFailure(db, userId, now) {
  db.prepare('INSERT INTO account_password_failures (user_id, failed_at) VALUES (?, ?)').run(
    userId,
    now.toISOString(),
  );
}

/** Forget what the account flows keep past its retention. */
export function sweepAccountRecords(db, now) {
  const before = (ms) => new Date(now.getTime() - ms).toISOString();
  db.prepare('DELETE FROM password_resets WHERE created_at < ?').run(before(RESET_RETENTION_MS));
  db.prepare('DELETE FROM account_totp_steps WHERE accepted_at < ?').run(
    before(TOTP_STEP_RETENTION_MS),
  );
  db.prepare('DELETE FROM account_password_failures WHERE failed_at < ?').run(
    before(PASSWORD_FAILURE_RETENTION_MS),
  );
}

/** Erasing user `userId`: nothing of their account flows stays. */
export function purgeAccountRecordsOf(db, userId) {
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM account_totp_steps WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM account_password_failures WHERE user_id = ?').run(userId);
}
