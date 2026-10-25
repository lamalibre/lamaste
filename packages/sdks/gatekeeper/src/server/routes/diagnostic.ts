import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StatementSync } from 'node:sqlite';
import { z } from 'zod';
import { atomicWriteJSON } from '@lamalibre/lamaste';
import { checkAccess } from '../../lib/authz.js';
import { DEFAULT_DATA_DIR, SETTINGS_FILE } from '../../lib/constants.js';
import { getGatekeeperDb } from '../../lib/state-db.js';
import type { GatekeeperSettings, AccessRequestEntry, GatekeeperLogger } from '../../lib/types.js';

const dataDir = process.env['LAMALIBRE_LAMASTE_DATA_DIR'] ?? DEFAULT_DATA_DIR;
const settingsPath = path.join(dataDir, SETTINGS_FILE);

const LOG_QUEUE_MAX = 1000;
const LOG_DRAIN_INTERVAL_MS = 100;
const LOG_OVERFLOW_WARN_INTERVAL_MS = 60_000;
const DEFAULT_RETENTION_DAYS = 90;
// Retention sweep cadence — once per drain tick is wasteful (DELETE every
// 100ms), and once per process lifetime is too coarse. Hourly matches the
// JSON-era rotation cadence loosely and is comfortably below any sensible
// retention setting.
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * `POST /api/access-log/purge { username, before? }`: the rows of one
 * username, before a time when given. The username travels in the body —
 * a URL is what request logs keep.
 */
const PurgeBodySchema = z
  .object({
    username: z.string().min(1).max(100),
    before: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, 'before is an ISO 8601 UTC time')
      .optional(),
  })
  .strict();

const UpdateSettingsSchema = z.object({
  adminEmail: z.string().email().max(200).optional(),
  adminName: z.string().max(200).optional(),
  slackChannel: z.string().max(200).optional(),
  teamsChannel: z.string().max(200).optional(),
  sessionCacheTtlMs: z.number().int().min(1000).max(300000).optional(),
  accessLoggingEnabled: z.boolean().optional(),
  accessLogRetentionDays: z.number().int().min(1).max(365).optional(),
});

// ---------------------------------------------------------------------------
// SQLite prepared-statement bundle (lazy init)
// ---------------------------------------------------------------------------

interface LogStmts {
  insert: StatementSync;
  selectPage: StatementSync;
  countAll: StatementSync;
  deleteAll: StatementSync;
  deleteOlderThan: StatementSync;
  deleteByUsername: StatementSync;
  deleteByUsernameBefore: StatementSync;
  begin: StatementSync;
  commit: StatementSync;
  rollback: StatementSync;
}

let stmts: LogStmts | null = null;

async function getStmts(): Promise<LogStmts> {
  if (stmts) return stmts;
  const db = await getGatekeeperDb();
  stmts = {
    insert: db.prepare(`
      INSERT INTO access_request_log
        (timestamp, username, resource_type, resource_id, resource_fqdn)
      VALUES (?, ?, ?, ?, ?)
    `),
    // Newest-first pagination: id is autoincrement so DESC order matches
    // insertion order more cheaply than sorting on `timestamp`.
    selectPage: db.prepare('SELECT * FROM access_request_log ORDER BY id DESC LIMIT ? OFFSET ?'),
    countAll: db.prepare('SELECT COUNT(*) AS n FROM access_request_log'),
    deleteAll: db.prepare('DELETE FROM access_request_log'),
    deleteOlderThan: db.prepare('DELETE FROM access_request_log WHERE timestamp < ?'),
    // Erasing a removed user (the panel): their rows only — those logged
    // before they were removed, when the panel says when that was (a later
    // user may have the same username).
    deleteByUsername: db.prepare('DELETE FROM access_request_log WHERE username = ?'),
    deleteByUsernameBefore: db.prepare(
      'DELETE FROM access_request_log WHERE username = ? AND timestamp < ?',
    ),
    begin: db.prepare('BEGIN IMMEDIATE'),
    commit: db.prepare('COMMIT'),
    rollback: db.prepare('ROLLBACK'),
  };
  return stmts;
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

interface LogRow {
  id: number;
  timestamp: string;
  username: string;
  resource_type: string;
  resource_id: string;
  resource_fqdn: string;
}

function rowToEntry(row: LogRow): AccessRequestEntry {
  return {
    timestamp: row.timestamp,
    username: row.username,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    resourceFqdn: row.resource_fqdn,
  };
}

// ---------------------------------------------------------------------------
// Persistence (batched insert, retention sweep)
// ---------------------------------------------------------------------------

async function persistEntries(entries: AccessRequestEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const s = await getStmts();
  s.begin.run();
  try {
    for (const e of entries) {
      s.insert.run(e.timestamp, e.username, e.resourceType, e.resourceId, e.resourceFqdn);
    }
    s.commit.run();
  } catch (err) {
    s.rollback.run();
    throw err;
  }
}

let lastRetentionSweepAt = 0;
let retentionDaysOverride: number | null = null;

function setRetentionDays(days: number | null): void {
  retentionDaysOverride = days;
}

async function maybeSweepRetention(): Promise<void> {
  const now = Date.now();
  if (now - lastRetentionSweepAt < RETENTION_SWEEP_INTERVAL_MS) return;
  lastRetentionSweepAt = now;
  const days = retentionDaysOverride ?? DEFAULT_RETENTION_DAYS;
  const cutoff = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  const s = await getStmts();
  s.deleteOlderThan.run(cutoff);
}

// ---------------------------------------------------------------------------
// Fire-and-forget queue + drainer
// ---------------------------------------------------------------------------

let logQueue: AccessRequestEntry[] = [];
let drainTimer: ReturnType<typeof setInterval> | null = null;
let lastOverflowWarnAt = 0;
let accessLogger: GatekeeperLogger | null = null;

function startDrainerIfNeeded(): void {
  if (drainTimer) return;
  drainTimer = setInterval(() => {
    if (logQueue.length === 0) {
      // Even when idle, occasionally sweep retention so a long-running
      // gatekeeper does not accumulate ancient entries.
      maybeSweepRetention().catch((err) => {
        accessLogger?.error({ err: (err as Error).message }, 'Failed retention sweep');
      });
      return;
    }
    const batch = logQueue;
    logQueue = [];
    persistEntries(batch)
      .then(() => maybeSweepRetention())
      .catch((err) => {
        accessLogger?.error({ err: (err as Error).message }, 'Failed to persist access log batch');
      });
  }, LOG_DRAIN_INTERVAL_MS);
  // Allow the process to exit cleanly during shutdown / tests.
  drainTimer.unref?.();
}

function enqueueAccessLog(entry: AccessRequestEntry): void {
  if (logQueue.length >= LOG_QUEUE_MAX) {
    // Drop oldest to bound memory. Rate-limit the warning to once per minute
    // so a sustained overflow does not itself become a log storm.
    logQueue.shift();
    const now = Date.now();
    if (now - lastOverflowWarnAt >= LOG_OVERFLOW_WARN_INTERVAL_MS) {
      lastOverflowWarnAt = now;
      accessLogger?.warn(
        { queueMax: LOG_QUEUE_MAX },
        'Access log queue full — dropping oldest entries',
      );
    }
  }
  logQueue.push(entry);
  startDrainerIfNeeded();
}

// ---------------------------------------------------------------------------
// Settings I/O (gatekeeper.json stays JSON — out of migration scope)
// ---------------------------------------------------------------------------

async function saveSettings(settings: GatekeeperSettings): Promise<void> {
  await atomicWriteJSON(settingsPath, settings, { mkdirp: true, mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function diagnosticRoutes(fastify: FastifyInstance): Promise<void> {
  // Adopt the Fastify logger for access-log queue diagnostics.
  accessLogger = fastify.log as GatekeeperLogger;
  // Pick up the initial retention setting from the in-memory settings cache.
  setRetentionDays(fastify.getSettings().accessLogRetentionDays ?? null);
  startDrainerIfNeeded();

  // GET /api/access/check — test access for a user
  fastify.get('/access/check', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string | undefined>;
    const username = query.username;
    const resourceType = query.resourceType;
    const resourceId = query.resourceId;

    if (!username || !resourceType || !resourceId) {
      return reply.code(400).send({
        error: 'Missing required query params: username, resourceType, resourceId',
      });
    }

    try {
      const result = await checkAccess(username, resourceType, resourceId);
      return result;
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // POST /api/cache/bust — invalidate all cached auth decisions. The panel
  // calls it after every membership change: the projection is read again
  // first, so a missed watch event never leaves a removed member admitted.
  fastify.post('/cache/bust', async (_request: FastifyRequest, _reply: FastifyReply) => {
    await fastify.reloadDomains();
    fastify.bustCache();
    return { ok: true };
  });

  // GET /api/settings — get gatekeeper settings
  fastify.get('/settings', async (_request: FastifyRequest, _reply: FastifyReply) => {
    return { settings: fastify.getSettings() };
  });

  // PATCH /api/settings — update gatekeeper settings
  fastify.patch('/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    let body: z.infer<typeof UpdateSettingsSchema>;
    try {
      body = UpdateSettingsSchema.parse(request.body);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: 'Invalid request body', details: (err as z.ZodError).errors });
    }

    try {
      const current = fastify.getSettings();
      const updated: GatekeeperSettings = { ...current, ...body };
      await saveSettings(updated);
      fastify.updateSettings(updated);
      // Honor a freshly-set retention without waiting for a daemon restart.
      if (body.accessLogRetentionDays !== undefined) {
        setRetentionDays(body.accessLogRetentionDays);
      }
      return { ok: true, settings: updated };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // GET /api/access-log — get access request log (newest first, paginated)
  fastify.get('/access-log', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string | undefined>;
    const limit = Math.max(1, Math.min(Number(query.limit) || 100, 1000));
    const offset = Math.max(0, Number(query.offset) || 0);

    try {
      const s = await getStmts();
      const totalRow = s.countAll.get() as { n: number };
      const rows = s.selectPage.all(limit, offset) as unknown as LogRow[];
      return {
        entries: rows.map(rowToEntry),
        total: totalRow.n,
        limit,
        offset,
      };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // DELETE /api/access-log — clear the whole access request log (and the
  // entries still queued for it). It takes no query: a purge of one user's
  // rows is POST /api/access-log/purge, and a query an older caller sent to
  // narrow the purge must never clear everything instead. Answers how many
  // rows went (`removed`).
  fastify.delete('/access-log', async (request: FastifyRequest, reply: FastifyReply) => {
    if (Object.keys((request.query as Record<string, unknown> | undefined) ?? {}).length > 0) {
      return reply.code(400).send({
        error:
          "DELETE clears the whole log and takes no query — purge one user's rows with POST /api/access-log/purge",
      });
    }
    try {
      const s = await getStmts();
      logQueue = [];
      const result = s.deleteAll.run();
      return { ok: true, removed: Number(result.changes) };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // POST /api/access-log/purge { username, before? } — one user's rows,
  // logged before `before` when given (a later user may hold the username),
  // and the matching entries still queued for the log, so none of them is
  // written after the purge. Answers how many rows went (`removed`).
  fastify.post('/access-log/purge', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = PurgeBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid body',
        details: parsed.error.issues.map((i) => i.message),
      });
    }
    const { username, before } = parsed.data;
    try {
      const s = await getStmts();
      const matches = (e: AccessRequestEntry) =>
        e.username === username && (before === undefined || e.timestamp < before);
      const kept = logQueue.filter((e) => !matches(e));
      const queued = logQueue.length - kept.length;
      logQueue = kept;
      const result =
        before === undefined
          ? s.deleteByUsername.run(username)
          : s.deleteByUsernameBefore.run(username, before);
      return { ok: true, removed: Number(result.changes) + queued };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });
}

/**
 * Log a denied access request (called from authz route).
 *
 * Non-blocking: enqueues the entry and returns synchronously. A background
 * drainer flushes batches every 100ms via a single SQLite transaction.
 * Entries queued within the last 100ms of a crash may be lost — the trade-off
 * for keeping the nginx hot path free of disk I/O.
 */
export function logAccessRequest(entry: AccessRequestEntry): void {
  enqueueAccessLog(entry);
}
