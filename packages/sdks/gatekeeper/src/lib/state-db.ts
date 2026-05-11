// Foundation for SQLite-backed state in lamaste-gatekeeper. Owns the singleton
// DB handle, PRAGMA tuning, file-permission tightening, and the forward-only
// numbered-migrations runner. Domain modules consume this via
// `getGatekeeperDb()` and never instantiate `DatabaseSync` themselves.
//
// Mirrors the serverd foundation at packages/server/daemon/src/lib/state-db.js.
// Duplicated rather than hoisted to core per design note §2 — hoist once both
// copies are green and identical in shape.

import { chmod, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR_ENV = 'LAMALIBRE_LAMASTE_DATA_DIR';
const DEFAULT_DATA_DIR = '/etc/lamalibre/lamaste';
const GATEKEEPER_DB_FILENAME = 'gatekeeper.db';

// Migrations live as raw .sql files under src/lib/migrations/gatekeeper/.
// `tsc` does not copy non-TS assets into `dist/`, so at runtime the compiled
// state-db.js sits in `dist/lib/` while the migration sources sit in
// `src/lib/migrations/gatekeeper/` (one level up + over). We prefer the
// `dist`-relative location so a future build-time copy step (or a published
// package that bundles SQL into dist) just works, and we fall back to the
// `src`-relative location when running from a checkout where dist doesn't
// have its own copy. The fallback walks up looking for the first ancestor
// that contains a `package.json` and reaches into its `src/lib/migrations/...`
// from there, mirroring how serverd's pure-JS foundation finds the same path
// via `__dirname`.
const GATEKEEPER_MIGRATIONS_DIR = resolveMigrationsDir();

function resolveMigrationsDir(): string {
  const distRelative = path.join(__dirname, 'migrations', 'gatekeeper');
  if (existsSync(distRelative)) return distRelative;

  // Walk up from __dirname looking for the package root (the directory whose
  // parent contains `package.json`). This handles the dev/test path where
  // `tsc` emitted to `dist/` but did not copy the SQL files alongside.
  let cursor = __dirname;
  for (let i = 0; i < 6; i += 1) {
    const candidatePkg = path.join(cursor, 'package.json');
    if (existsSync(candidatePkg)) {
      const srcCandidate = path.join(cursor, 'src', 'lib', 'migrations', 'gatekeeper');
      if (existsSync(srcCandidate)) return srcCandidate;
      break;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return distRelative; // fall through; ensureMigrations will ENOENT-shortcut
}

const MIGRATION_FILENAME_RE = /^\d{4}_[a-z0-9_]+\.sql$/;

let dbPromise: Promise<DatabaseSync> | null = null;

/**
 * Returns the singleton `gatekeeper.db` handle for lamaste-gatekeeper.
 * Lazy-opens on first call; subsequent calls return the cached handle. Safe to
 * call concurrently from multiple modules at startup — the open is wrapped in
 * a promise singleton so only one open ever races.
 */
export async function getGatekeeperDb(): Promise<DatabaseSync> {
  if (!dbPromise) {
    const dataDir = process.env[DATA_DIR_ENV] ?? DEFAULT_DATA_DIR;
    dbPromise = openManagedDb({
      path: path.join(dataDir, GATEKEEPER_DB_FILENAME),
      migrationsDir: GATEKEEPER_MIGRATIONS_DIR,
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
export async function ensureMigrations(
  db: DatabaseSync,
  migrationsDir: string,
): Promise<void> {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    db
      .prepare('SELECT name FROM schema_migrations')
      .all()
      .map((r) => (r as { name: string }).name),
  );

  let entries: string[];
  try {
    entries = await readdir(migrationsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
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
      db.prepare(
        'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
      ).run(id, file, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
}

/**
 * Open `path`, apply PRAGMAs, tighten file modes, and run any pending
 * migrations from `migrationsDir`. Single source of truth for DB lifecycle —
 * `getGatekeeperDb()` is a thin wrapper that supplies gatekeeper's
 * path/migrations.
 *
 * `node:sqlite` is dynamically imported so `boot.ts`'s `process.on('warning')`
 * filter (installed during user-code evaluation) catches the
 * ExperimentalWarning. A static import would emit it during ESM link.
 */
async function openManagedDb({
  path: dbPath,
  migrationsDir,
}: {
  path: string;
  migrationsDir: string;
}): Promise<DatabaseSync> {
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
