---
title: SQLite for lamaste-serverd and lamaste-gatekeeper state
status: Accepted (fresh-install design — pre-v2.0 ship, no JSON upgrade path)
date: 2026-05-02
---

# SQLite migration

## 1. Decision summary

Move mutable server-side state from JSON-files-with-mutex to SQLite, in two
databases — one per process boundary:

- `/etc/lamalibre/lamaste/state.db` — owned by `lamaste-serverd`. Holds
  enrollment_tokens, tickets, ticket_scopes, ticket_instances,
  ticket_assignments, ticket_sessions, plugins, agents, revoked_certs.
- `/etc/lamalibre/lamaste/gatekeeper.db` — owned by `lamaste-gatekeeper`
  (`:9294`, separate systemd unit, separate npm package). Holds groups,
  access_grants, access_request_log.

**Why two DBs, not one.** Gatekeeper sits on the auth hot path: every
nginx forward-auth call hits it, and tail latency on `auth_request` matters
more than throughput. A single shared file would put gatekeeper readers in
the same WAL queue as serverd writers; WAL gives concurrent readers a
consistent snapshot but still couples the two processes' fsync cadence and
crash semantics. It would also force giving up gatekeeper's `fs.watch`-based
live-config refresh (cross-process change notification on a SQLite file is
not a thing without polling) and entangle two release cycles that ship as
separate npm packages today. Two DBs preserves the existing process
boundary one-for-one.

**Why not "one DB per former JSON file" (rejected Option B).** That would
multiply foundation cost (one open handle, one WAL, one PRAGMA-tuning
exercise per file), block referential integrity between `agents` and
`revoked_certs`, and produce a worse memory footprint than today's JSON
on the 512 MB target droplet.

**In scope.** The eight tables in `state.db` and the three in `gatekeeper.db`
listed above.

**Out of scope.** Anything that is configuration rather than mutable runtime
state. See section 9.

## 2. Foundation module — `lib/state-db.js`

Lives at `packages/server/daemon/src/lib/state-db.js`. The same module ships
twice: one copy in serverd, a second (or shared via `@lamalibre/lamaste`
core) copy in `packages/sdks/gatekeeper/src/lib/state-db.ts`. Same shape,
parameterised by file path and migrations directory. The simplest landing
is a duplicated 80-line module per process — they are independent and small
— with a TODO to consolidate into core after both are green.

### Public API surface

```js
// Returns the singleton DB handle for state.db. Lazy-opens on first call.
export async function getStateDb();

// Returns the singleton DB handle for gatekeeper.db (gatekeeper module only).
export async function getGatekeeperDb();

// Domain modules call this once at module-load to assert their migrations
// have been applied. Idempotent. Safe to call concurrently from multiple
// modules — internally serialised behind the connection mutex.
export async function ensureMigrations(db, migrationsDir);
```

Domain modules do **not** instantiate `DatabaseSync` themselves. They never
touch PRAGMAs. They never open a second connection. Foundation owns
lifecycle.

### Lifecycle

- **Lazy open.** First `getStateDb()` call opens the file, applies PRAGMAs,
  runs migrations, returns the handle. Subsequent calls return cached.
- **Never close.** Process-lifetime singleton. No teardown hook. Node exit
  flushes WAL.
- **Dynamic import.** `node:sqlite` is `await import()`-ed inside `getDb()`
  so `boot.js`'s ExperimentalWarning filter (which the spike pioneered) is
  installed before the SQLite module evaluates. A static top-level import
  emits the warning during ESM link, before any user code runs.

### PRAGMAs

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA cache_size = -2048;     -- 2 MiB page cache
PRAGMA temp_store = MEMORY;
PRAGMA busy_timeout = 5000;    -- 5 s
```

**Cache budget.** The pilot used `-512` (512 KiB) because it was an isolated
file with one table and short-lived rows. With `state.db` consolidating
eight tables — including `agents` and `plugins` which are read on every
mTLS handshake — the working set is larger. Going to `-2048` (2 MiB) buys
headroom for index pages and frequent-read tables without hurting the
512 MB droplet (two databases × 2 MiB = 4 MiB total; trivial against the
~50 MB Node baseline). `-4096` is also defensible if early profiling shows
we are spilling cache; revisit after Step 4 rodeo numbers land. Do not
commit to `-4096` blind — measure first.

`busy_timeout = 5000` covers the case where a slow checkpoint or the
backup API briefly holds the writer.

### File permissions

`0o600` on `state.db`, `state.db-wal`, `state.db-shm`. Same for the
gatekeeper triplet. Applied with `chmod` after the first connect (matching
the pilot's pattern — `existsSync` guards the sidecar files because they
appear lazily). The owning unix user is whoever owns the daemon process
(`lamaste:lamaste` for serverd, `lamaste-gatekeeper:lamaste-gatekeeper`
for gatekeeper).

### Dual-DB factory shape

A single `openManagedDb({ path, migrationsDir })` helper does the open +
PRAGMAs + chmod + `ensureMigrations`. `getStateDb()` and `getGatekeeperDb()`
are thin wrappers that pass the right path and migrations directory.

## 3. Migrations framework

### Layout

```
packages/server/daemon/src/lib/migrations/state/
  0001_enrollment_tokens.sql
  0002_tickets.sql
  0003_plugins.sql
  ...

packages/sdks/gatekeeper/src/lib/migrations/gatekeeper/
  0001_groups.sql
  0002_access_grants.sql
  0003_access_request_log.sql
```

### Tracking table

Each DB carries a `schema_migrations` table:

```sql
CREATE TABLE schema_migrations (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);
```

The `id` is the integer prefix of the filename (`0001` → `1`).

### Runner

```js
async function runMigrations(db, migrationsDir) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    db
      .prepare('SELECT name FROM schema_migrations')
      .all()
      .map((r) => r.name),
  );
  const files = (await readdir(migrationsDir))
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(migrationsDir, file), 'utf-8');
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
```

### Forward-only

No `down` migrations. If a schema mistake ships, the fix is `0007_fix_typo.sql`,
not a rollback. To revert state entirely: stop the daemon, remove the `.db`
triplet (`*.db`, `*.db-wal`, `*.db-shm`), restart — the next start opens an
empty DB and re-applies all migrations. There is no upgrade-from-JSON path:
v2.0 has not shipped, so no installed base carries pre-SQLite state.

### Parallelisation rule

This is the load-bearing constraint for Step 3. **Each domain agent
adds a NEW numbered migration file. No agent ever edits a prior
migration.** File-level disjoint = parallel-safe under git's three-way
merge. The integer prefix is contended only for _next number_; resolve at
merge time by renumbering the later-merging branch (the SQL is
agent-private, so renumbering does not break callers).

## 4. Per-domain table schemas

DDL sketches below. Real implementations belong in the migration `.sql`
files; what's written here is the contract the domain modules must
satisfy.

### state.db

#### `enrollment_tokens` — replaces `/etc/lamalibre/lamaste/pki/enrollment-tokens.json`

```sql
CREATE TABLE enrollment_tokens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token         TEXT    NOT NULL,
  label         TEXT    NOT NULL,
  capabilities  TEXT    NOT NULL,   -- JSON array
  allowed_sites TEXT    NOT NULL,   -- JSON array
  type          TEXT,               -- 'standard' | 'delegated' | NULL
  delegated_by  TEXT,
  scope         TEXT,
  created_at    TEXT    NOT NULL,
  expires_at    TEXT    NOT NULL,
  used          INTEGER NOT NULL DEFAULT 0,
  used_at       TEXT
);
CREATE INDEX idx_enrollment_label_active ON enrollment_tokens(label, used);
CREATE INDEX idx_enrollment_created_at  ON enrollment_tokens(created_at);
```

Volume: a handful of rows at any moment (10 min TTL, cleanup at 1 h).
Re-folded from the pilot's standalone `enrollment-tokens.db` — that file
goes away. Indexes match the actual queries (active-by-label scan during
re-issue; created-at cutoff during stale cleanup). Keep the linear
HMAC-compare scan in the lookup path; do not add a `token` index. The
spike preserved this deliberately to keep the timing-safe property.

#### `tickets` — replaces `/etc/lamalibre/lamaste/tickets.json` (the `tickets` key)

```sql
CREATE TABLE tickets (
  index_hash    TEXT    PRIMARY KEY,    -- sha256(ticket.id), base64url
  id            TEXT    NOT NULL,        -- the full 256-bit token, hex
  scope         TEXT    NOT NULL,
  instance_id   TEXT    NOT NULL,
  source        TEXT    NOT NULL,
  target        TEXT    NOT NULL,
  created_at    TEXT    NOT NULL,
  expires_at    TEXT    NOT NULL,
  used          INTEGER NOT NULL DEFAULT 0,
  used_at       TEXT,
  session_id    TEXT,                    -- nullable; set on session creation
  transport     TEXT    NOT NULL         -- JSON object
);
CREATE INDEX idx_tickets_target_active ON tickets(target, used);
CREATE INDEX idx_tickets_instance_id   ON tickets(instance_id);
CREATE INDEX idx_tickets_created_at    ON tickets(created_at);
```

The PK is `index_hash`, mirroring the existing in-memory `Record` keyed
by `ticketIndex(ticketId)`. The full `id` column is preserved because the
defense-against-collision constant-time-equal compare in `validateTicket`
needs it. Volume: ≤ MAX_TICKETS = 1000.

#### `ticket_scopes` — replaces `/etc/lamalibre/lamaste/ticket-scopes.json` (`scopes` key)

```sql
CREATE TABLE ticket_scopes (
  name          TEXT    PRIMARY KEY,
  version       TEXT    NOT NULL,
  description   TEXT    NOT NULL,
  scopes        TEXT    NOT NULL,    -- JSON array of {name, description, instanceScoped}
  transport     TEXT    NOT NULL,    -- JSON object {strategies, preferred, port, protocol}
  hooks         TEXT    NOT NULL DEFAULT '{}',  -- JSON object
  installed_at  TEXT    NOT NULL
);
```

The sub-scope array stays inline as JSON rather than a separate table.
The existing module always loads the whole scope row to enumerate
sub-scopes; a normalised `ticket_sub_scopes` table would force a join on
every read for no win at this volume (a few dozen rows total). Volume:
single-digit to low-double-digit rows.

#### `ticket_instances` — replaces `/etc/lamalibre/lamaste/ticket-scopes.json` (`instances` key)

```sql
CREATE TABLE ticket_instances (
  instance_id    TEXT    PRIMARY KEY,
  scope          TEXT    NOT NULL,
  agent_label    TEXT    NOT NULL,
  registered_at  TEXT    NOT NULL,
  last_heartbeat TEXT    NOT NULL,
  status         TEXT    NOT NULL,           -- 'active' | 'stale' | 'dead'
  transport      TEXT    NOT NULL            -- JSON object
);
CREATE INDEX idx_ticket_instances_scope_agent ON ticket_instances(scope, agent_label);
CREATE INDEX idx_ticket_instances_status      ON ticket_instances(status);
```

Volume: ≤ MAX_INSTANCES = 200. Indexes match the existing predicates
(`find by (scope, agentLabel)` for re-registration; `filter by status` for
liveness sweep).

#### `ticket_assignments` — replaces `/etc/lamalibre/lamaste/ticket-scopes.json` (`assignments` key)

```sql
CREATE TABLE ticket_assignments (
  agent_label    TEXT    NOT NULL,
  instance_scope TEXT    NOT NULL,           -- "plugin:foo:bar:<hex>"
  assigned_at    TEXT    NOT NULL,
  assigned_by    TEXT    NOT NULL DEFAULT 'admin',
  PRIMARY KEY (agent_label, instance_scope)
);
CREATE INDEX idx_ticket_assignments_instance_scope ON ticket_assignments(instance_scope);
```

Composite PK matches the duplicate-detection logic. Index on
`instance_scope` covers the cascade-on-deregister query.

#### `ticket_sessions` — replaces `/etc/lamalibre/lamaste/tickets.json` (`sessions` key)

```sql
CREATE TABLE ticket_sessions (
  session_id                 TEXT    PRIMARY KEY,
  ticket_id                  TEXT    NOT NULL,
  scope                      TEXT    NOT NULL,
  instance_id                TEXT    NOT NULL,
  source                     TEXT    NOT NULL,
  target                     TEXT    NOT NULL,
  created_at                 TEXT    NOT NULL,
  last_activity_at           TEXT    NOT NULL,
  status                     TEXT    NOT NULL,   -- 'active' | 'grace' | 'dead'
  reconnect_grace_seconds    INTEGER NOT NULL DEFAULT 60,
  terminated_by              TEXT,
  terminated_at              TEXT
);
CREATE INDEX idx_sessions_target_active   ON ticket_sessions(target, status);
CREATE INDEX idx_sessions_instance_id     ON ticket_sessions(instance_id);
CREATE INDEX idx_sessions_last_activity   ON ticket_sessions(last_activity_at);
```

Volume: ≤ MAX_SESSIONS = 500. The `target+status` index covers the
heartbeat lookup; `last_activity_at` covers the stale-session sweep.

#### `plugins` — replaces `/etc/lamalibre/lamaste/plugins.json`

```sql
CREATE TABLE plugins (
  name          TEXT    PRIMARY KEY,
  display_name  TEXT,
  package_name  TEXT    NOT NULL,
  version       TEXT    NOT NULL,
  description   TEXT,
  capabilities  TEXT    NOT NULL DEFAULT '[]',  -- JSON array
  packages      TEXT,                            -- JSON array (optional)
  panel         TEXT,                            -- JSON object (optional)
  config        TEXT,                            -- JSON object (optional)
  modes         TEXT,                            -- JSON array (optional)
  status        TEXT    NOT NULL,                -- 'enabled' | 'disabled'
  installed_at  TEXT    NOT NULL,
  enabled_at    TEXT
);
```

Volume: single-digit. No indexes beyond PK; full-table scan is constant.
The `packages`, `panel`, `config`, `modes` columns hold the manifest
fragments verbatim (JSON-encoded TEXT) — never queried on, only round-tripped.

#### `agents` — replaces `/etc/lamalibre/lamaste/pki/agents/registry.json`

```sql
CREATE TABLE agents (
  label             TEXT    PRIMARY KEY,
  serial            TEXT    NOT NULL,
  capabilities      TEXT    NOT NULL DEFAULT '[]',     -- JSON array
  allowed_sites     TEXT    NOT NULL DEFAULT '[]',     -- JSON array
  enrollment_method TEXT    NOT NULL DEFAULT 'p12',    -- 'p12' | 'hardware-bound' | 'delegated'
  delegated_by      TEXT,                              -- non-null for plugin-agent rows
  created_at        TEXT    NOT NULL,
  expires_at        TEXT    NOT NULL,
  revoked           INTEGER NOT NULL DEFAULT 0,
  revoked_at        TEXT
);
CREATE INDEX idx_agents_serial ON agents(serial);
```

`delegated_by` carries the parent agent's label when this row is a
plugin-agent enrolled via delegated CSR (csr-signing.js sets it; the
`revokeAgentCert` cascade reads it to revoke all dependents when the
parent is revoked). The `enrollment_method` enum admits three values:
`'p12'`, `'hardware-bound'`, `'delegated'` (the column is unconstrained
TEXT, so the enum is documentation-level only).

The `serial` index covers cert-revocation lookup paths
(`addToRevocationList(agent.serial, ...)`). Volume: tens.

#### `revoked_certs` — replaces `/etc/lamalibre/lamaste/pki/revoked.json`

```sql
CREATE TABLE revoked_certs (
  serial      TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  revoked_at  TEXT NOT NULL
);
```

Volume: small, monotonically growing. Lookup is by serial only —
`isRevoked(serial)` and the in-memory `Set<serial>` rebuilt on every read.
A `loadRevocationList()` becomes `SELECT serial FROM revoked_certs` and
materialises the Set the caller already expects.

### gatekeeper.db

#### `groups` — replaces `/etc/lamalibre/lamaste/groups.json`

```sql
CREATE TABLE groups (
  name         TEXT    PRIMARY KEY,
  description  TEXT    NOT NULL DEFAULT '',
  members      TEXT    NOT NULL DEFAULT '[]',   -- JSON array of usernames
  created_at   TEXT    NOT NULL,
  created_by   TEXT    NOT NULL DEFAULT 'admin'
);
```

Volume: ≤ MAX_GROUPS = 200. Membership stays inline as a JSON array — the
existing API loads the whole group entry on every member read; a
normalised `group_members(group_name, username)` table would force a join
plus an aggregation for `getGroup` and a separate query for
`getGroupsForUser`. Keep simple.

#### `access_grants` — replaces `/etc/lamalibre/lamaste/access-grants.json`

```sql
CREATE TABLE access_grants (
  grant_id        TEXT    PRIMARY KEY,         -- UUID
  principal_type  TEXT    NOT NULL,             -- 'user' | 'group'
  principal_id    TEXT    NOT NULL,
  resource_type   TEXT    NOT NULL,             -- 'tunnel' | 'plugin' | extensible
  resource_id     TEXT    NOT NULL,
  context         TEXT    NOT NULL DEFAULT '{}',-- JSON object
  used            INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL,
  used_at         TEXT
);
CREATE INDEX idx_grants_principal     ON access_grants(principal_type, principal_id);
CREATE INDEX idx_grants_resource      ON access_grants(resource_type, resource_id);
CREATE INDEX idx_grants_used_used_at  ON access_grants(used, used_at);
```

Volume: ≤ MAX_GRANTS = 1000. Retention: consumed grants pruned at
GRANT_RETENTION_MS (90 days) — port the existing `pruneStaleGrants` to a
single `DELETE FROM access_grants WHERE used = 1 AND used_at < ?` on every
write. The three indexes match the three existing filter axes
(by-principal cascade, by-resource lookup, by-used-and-age cleanup).

#### `access_request_log` — replaces `/etc/lamalibre/lamaste/access-request-log.json` (currently JSONL with size-rotation)

```sql
CREATE TABLE access_request_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp     TEXT    NOT NULL,
  username      TEXT    NOT NULL,
  resource_type TEXT    NOT NULL,
  resource_id   TEXT    NOT NULL,
  resource_fqdn TEXT    NOT NULL
);
CREATE INDEX idx_access_log_timestamp ON access_request_log(timestamp);
```

Today's log is append-only JSONL with 10 MB rotation and 7-file retention.
The SQLite version replaces both with a single retention sweep:
`DELETE FROM access_request_log WHERE timestamp < ?` driven by the
existing `accessLogRetentionDays` setting (default 90 days). Drop the
JSONL rotation and the filesystem `.json.<timestamp>` rotation files —
their reason for existing was to bound write-amplification on a growing
JSON array, which SQLite handles natively. The 100 ms batched-drainer
queue stays (it batches 1000 inserts into one transaction). Volume: high
write rate (one row per denied access on the auth hot path), bounded by
retention + DELETE sweep.

## 5. Domain module pattern

Every Step 3 agent ports its module by following this pattern. Compare to
the spike's `enrollment.js` for a worked example.

1. Replace top-level `readFile`/`writeFile` imports with
   `import { getStateDb } from './state-db.js';` (or `getGatekeeperDb`).
2. Define a module-private `stmts` bundle initialised on first DB access.
   The pilot pattern: initialise inline in `getDb()` after the migrations
   finish. For the new shape, do it in a one-time `initStmts(db)` helper
   called lazily.
3. Wrap mutations in `BEGIN IMMEDIATE` … `COMMIT` / `ROLLBACK`. Reads
   that don't mutate need no transaction.
4. Keep exported function signatures **byte-identical** to the JSON
   version. Callers (routes, other lib modules) must not need to change.
5. **Keep the promise-chain mutex initially.** SQLite's `BEGIN IMMEDIATE`
   already serialises writers; the mutex is redundant for correctness but
   buys behavioural parity with the JSON era — read-modify-write
   sequences that span multiple statements still see the same atomicity
   the mutex gave them. Drop it as a follow-up after Step 4 (rodeo) is
   green.
6. **Do not change algorithms.** Storage migration only. The pilot kept
   the linear HMAC-compare token scan instead of adding an indexed lookup
   for exactly this reason — algorithm changes belong to a separate PR
   that can be measured independently.
7. JSON-typed columns: encode with `JSON.stringify` on write, parse with
   `JSON.parse` on read, abstract into a per-module `rowToEntry()` helper.
   The pilot's helper is the template — copy and adapt.
8. No upgrade-from-JSON path: v2.0 has not shipped, so no installed base
   carries pre-SQLite state. Each module's first DB call applies its
   migrations against an empty DB and routes populate it from there.

## 6. Parallelisation safety rules for Step 3

Hard rules each domain agent must obey to avoid stepping on each other:

- **One module file per agent.** The tickets agent touches
  `lib/tickets.js` and nothing else in `lib/`. The plugins agent touches
  `lib/plugins.js`. Etc.
- **One new numbered migration file per agent**, in the right
  migrations directory (`lib/migrations/state/` for serverd domains,
  `lib/migrations/gatekeeper/` for gatekeeper domains). Never edit a
  previously-merged migration.
- **Never edit `lib/state-db.js`.** Foundation is frozen after Step 2
  lands. Bug fixes to foundation are their own out-of-band PR.
- **Never edit another domain's module.** Cross-module reads (e.g.
  `tickets.js` imports `loadAgentRegistry` from `mtls.js`) continue to
  work because the public function signatures don't change.
- **Never edit callers.** Routes, middleware, and other lib modules
  must not need touching. The whole point of preserving signatures.
- **Each agent on its own branch off `feature/sqlite-migration`.**
  Branches: `feature/sqlite-enrollment`, `feature/sqlite-tickets`,
  `feature/sqlite-gatekeeper`, `feature/sqlite-plugins`,
  `feature/sqlite-agents`. Each merges back to the integration branch
  via PR.

Migration-number contention is the only real merge friction. Resolve by
renumbering the later-merging branch's `0NNN_*.sql` upward — the SQL
itself is module-private, so renumbering doesn't break anything.

## 7. Branch and merge strategy

- **Integration branch.** `feature/sqlite-migration`, off `main`.
- **Step 2 (foundation)** lands on the integration branch first. This is
  `lib/state-db.js`, the migrations runner, the empty `migrations/state/`
  and `migrations/gatekeeper/` directories, and the re-folded
  enrollment-tokens module (which validates the foundation end-to-end).
- **Step 3 agents** branch off the integration branch, work in parallel,
  merge back via PR with the rules in section 6.
- **Step 4 rodeo verification** runs against the integration branch.
  Tests 12 and 27 (enrollment lifecycle / public endpoints) plus the
  ticket-flow tests plus the gatekeeper tests must all pass.
- **Step 5 merge to main** happens only after rodeo is green on a fresh
  install (the only install path — see §3 "Forward-only").
- **`spike/sqlite-enrollment` is reference only.** Its enrollment code
  re-lands as part of Step 2 in the new shape (using the foundation
  module rather than its bespoke DB handle). Delete the spike branch
  after Step 2 merges.

## 8. Risk register

**`node:sqlite` is experimental.** The API has been stable since Node
22.5, but Node 24 LTS may shift it. Mitigation: pin `engines.node` to
`>=22.5.0 <25.0.0` in both `packages/server/daemon/package.json` and
`packages/sdks/gatekeeper/package.json`. Add a rodeo check that runs the
test suite against both Node 22 and Node 24 before any major-version
bump. Document in the daemon's CHANGELOG that node-version bumps require
re-validating the SQLite call sites.

**Two DBs across one rodeo run.** Both must initialise cleanly on the
same fresh install. The lazy-open design means each DB is created on
the first call from its owning daemon — nothing in the install path
needs to pre-create them. But the install path _does_ need to ensure
the parent directory `/etc/lamalibre/lamaste/` exists with the right
ownership and `0o750` mode before either daemon starts. That's already
the case today (the JSON state files have the same requirement); call
out in the gatekeeper provisioner that the SQLite sidecars
(`gatekeeper.db-wal`, `gatekeeper.db-shm`) will appear there at
runtime.

**Gatekeeper readers vs serverd writers.** The carve-out's whole
justification. Confirmed: with two separate DB files, gatekeeper's
read transactions never block on serverd's write transactions —
different files, different WAL queues, different shared-memory regions.
What gatekeeper _still_ shares with serverd is the `tunnels.json` file
that gatekeeper reads via `fs.watch` for live config refresh; that file
stays JSON (out of migration scope). If a future iteration wants to move
`tunnels.json` to SQLite, the design tension re-opens — flag at that
time.

**Backup / restore.** Operational rule: with daemons stopped, `cp
state.db state.db-wal state.db-shm gatekeeper.db gatekeeper.db-wal
gatekeeper.db-shm <backup-dir>/`. With daemons running, use the SQLite
`.backup` API (a separate one-shot script that opens each DB read-only
and runs `VACUUM INTO`). Pick **stopped-daemon `cp`** as the documented
default — it is what the existing JSON backup story already assumes
(stop daemon, copy `/etc/lamalibre/lamaste/`, restart). The `.backup`
API path is a follow-up if anyone asks for hot backups.

**Schema mistakes.** Forward-only migrations mean a typo ships forever
as `0NNN_fix_typo.sql`. Mitigation: each Step 3 PR must include a local
rodeo run output proving the migration applies cleanly on a fresh DB.
Reviewers should reject PRs lacking this. There's no automated guard —
this is a process discipline.

## 9. Out of scope for this migration

The following stay as-is. They are configuration or per-agent state, not
mutable runtime state owned by `state.db`'s owning daemon:

- `panel.json` — server-process configuration, hand-edited by admins.
  Schema changes here would break the operator-facing config contract.
- `users.yml` — Authelia identity store. Authelia owns the format; we
  must not move it.
- `tunnels.json`, `sites.json`, `invitations.json` — server-side state
  but not in the agreed scope. Gatekeeper's `fs.watch`-based live
  refresh depends on `tunnels.json` being a watchable file. Punt.
- `push-install-config.json`, `push-install-sessions.json` — discovered
  during the survey, not mentioned in the original ordering. Stay JSON.
  Re-evaluate if they grow.
- `chisel-users.json`, `chisel.json` — chisel-server credential file
  format, not ours to redesign.
- `~/.lamalibre/lamaste/agents/<label>/...` — per-agent state on the
  agent side. Different process, different host, different scope.
- `~/.lamalibre/lamaste/servers.json`, `storage-servers.json` —
  desktop-side registries.
- Per-plugin data directories under `/etc/lamalibre/lamaste/plugins/`
  — owned by the individual plugins, not by this migration.
- Authelia rules YAML, nginx site configs, sudoers fragments — config
  artifacts, not state.

The principle: if a human edits it, or if it spans the agent/server
process boundary, or if a tool we don't own reads it, it stays a file.
