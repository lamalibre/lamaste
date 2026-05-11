/**
 * Certificate revocation list (CRL) management.
 *
 * Backed by SQLite (`state.db`, table `revoked_certs`) per
 * docs/decisions/sqlite-migration.md §3d. The companion `agents` table
 * created by `0004_agents.sql` is owned by `lib/mtls.js`.
 *
 * Hot path: the mTLS middleware calls `isRevoked(serial)` on every
 * authenticated request — a single indexed `SELECT serial FROM revoked_certs`
 * materialising the `Set<serial>` the caller expects. No in-memory cache.
 */
import { getStateDb } from './state-db.js';

// --- SQLite prepared-statement bundle (lazy init) ---

let stmts = null;

async function getStmts() {
  if (stmts) return stmts;

  const db = await getStateDb();

  stmts = {
    db,

    selectAll: db.prepare('SELECT * FROM revoked_certs'),
    selectSerials: db.prepare('SELECT serial FROM revoked_certs'),
    selectBySerial: db.prepare('SELECT serial FROM revoked_certs WHERE serial = ?'),
    insert: db.prepare(
      'INSERT INTO revoked_certs (serial, label, revoked_at) VALUES (?, ?, ?)',
    ),
    deleteBySerial: db.prepare('DELETE FROM revoked_certs WHERE serial = ?'),

    begin: db.prepare('BEGIN IMMEDIATE'),
    commit: db.prepare('COMMIT'),
    rollback: db.prepare('ROLLBACK'),
  };

  return stmts;
}

/**
 * Load the revocation list and return a Set of revoked serial numbers.
 *
 * The Set<serial> shape is what the mTLS middleware's hot-path lookup
 * expects.
 *
 * @returns {Promise<Set<string>>} Set of revoked certificate serial numbers.
 */
export async function loadRevocationList() {
  const s = await getStmts();
  const rows = s.selectSerials.all();
  return new Set(rows.map((r) => r.serial));
}

/**
 * Add a certificate serial to the revocation list.
 *
 * Duplicate serials are silently skipped (idempotent). The check runs with
 * a SELECT inside the BEGIN IMMEDIATE so concurrent callers cannot race
 * past it.
 *
 * @param {string} serial - The certificate serial number to revoke.
 * @param {string} label - A human-readable label for the revoked certificate.
 */
export async function addToRevocationList(serial, label) {
  const s = await getStmts();
  const revokedAt = new Date().toISOString();

  s.begin.run();
  try {
    const existing = s.selectBySerial.get(serial);
    if (!existing) {
      s.insert.run(serial, label, revokedAt);
    }
    s.commit.run();
  } catch (err) {
    s.rollback.run();
    throw err;
  }
}

/**
 * Remove a certificate serial from the revocation list.
 *
 * @param {string} serial - The certificate serial number to un-revoke.
 */
export async function removeFromRevocationList(serial) {
  const s = await getStmts();

  s.begin.run();
  try {
    s.deleteBySerial.run(serial);
    s.commit.run();
  } catch (err) {
    s.rollback.run();
    throw err;
  }
}

/**
 * Check if a certificate serial is in the revocation list.
 *
 * Hot-path call from the mTLS middleware on every authenticated request.
 * Uses an indexed primary-key lookup — O(log N) on the SQLite B-tree.
 *
 * @param {string} serial - The certificate serial number to check.
 * @returns {Promise<boolean>} True if the serial is revoked.
 */
export async function isRevoked(serial) {
  const s = await getStmts();
  const row = s.selectBySerial.get(serial);
  return row !== undefined;
}
