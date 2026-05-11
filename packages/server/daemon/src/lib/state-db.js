// Foundation for SQLite-backed state in lamaste-serverd. Owns the singleton
// DB handle, PRAGMA tuning, file-permission tightening, and the forward-only
// numbered-migrations runner. Domain modules consume this via `getStateDb()`
// and never instantiate `DatabaseSync` themselves.

import { chmod, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR_ENV = 'LAMALIBRE_LAMASTE_DATA_DIR';
const DEFAULT_DATA_DIR = '/etc/lamalibre/lamaste';
const STATE_DB_FILENAME = 'state.db';
const STATE_MIGRATIONS_DIR = path.join(__dirname, 'migrations', 'state');

const MIGRATION_FILENAME_RE = /^\d{4}_[a-z0-9_]+\.sql$/;

let dbPromise = null;

/**
 * Returns the singleton `state.db` handle for lamaste-serverd. Lazy-opens on
 * first call; subsequent calls return the cached handle. Safe to call
 * concurrently from multiple modules at startup — the open is wrapped in a
 * promise singleton so only one open ever races.
 */
export async function getStateDb() {
  if (!dbPromise) {
    const dataDir = process.env[DATA_DIR_ENV] || DEFAULT_DATA_DIR;
    dbPromise = openManagedDb({
      path: path.join(dataDir, STATE_DB_FILENAME),
      migrationsDir: STATE_MIGRATIONS_DIR,
    });
  }
  return dbPromise;
}

/**
 * Apply every pending migration in `migrationsDir` against `db`. Idempotent —
 * the second call is a no-op once `schema_migrations` has caught up. Each
 * migration runs inside `BEGIN IMMEDIATE` … `COMMIT`; a failure rolls the
 * statement back and rethrows with the migration filename in the message.
 */
export async function ensureMigrations(db, migrationsDir) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    db
      .prepare('SELECT name FROM schema_migrations')
      .all()
      .map((r) => r.name),
  );

  let entries;
  try {
    entries = await readdir(migrationsDir);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }

  const files = entries.filter((f) => MIGRATION_FILENAME_RE.test(f)).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir, file), 'utf-8');
    const id = Number(file.slice(0, 4));

    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        id,
        file,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }
}

/**
 * Open `path`, apply PRAGMAs, tighten file modes, and run any pending
 * migrations from `migrationsDir`. Single source of truth for DB lifecycle —
 * `getStateDb()` is a thin wrapper that supplies serverd's path/migrations.
 *
 * `node:sqlite` is dynamically imported so `boot.js`'s `process.on('warning')`
 * filter (installed during user-code evaluation) catches the
 * ExperimentalWarning. A static import would emit it during ESM link.
 */
async function openManagedDb({ path: dbPath, migrationsDir }) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);

  // PRAGMA order matters: journal_mode must be set before any write that
  // would lock the rollback journal. cache_size = -2048 caps the page cache
  // at 2 MiB (negative = KiB). synchronous = NORMAL is safe with WAL and
  // skips the per-commit fsync.
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA cache_size = -2048;
    PRAGMA temp_store = MEMORY;
    PRAGMA busy_timeout = 5000;
  `);

  // 0o600 on the DB plus its WAL/SHM sidecars (which appear lazily on first
  // write — guard with existsSync). Best-effort: a failure here is logged by
  // the caller's surrounding context, not fatal.
  try {
    await chmod(dbPath, 0o600);
    if (existsSync(`${dbPath}-wal`)) await chmod(`${dbPath}-wal`, 0o600);
    if (existsSync(`${dbPath}-shm`)) await chmod(`${dbPath}-shm`, 0o600);
  } catch {
    // best-effort
  }

  await ensureMigrations(db, migrationsDir);

  return db;
}
