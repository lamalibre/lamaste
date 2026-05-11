import crypto from 'node:crypto';
import { z } from 'zod';
import {
  setTicketScopeCapabilitiesOnMtls,
  loadAgentRegistry,
  getValidCapabilities,
} from './mtls.js';
import { getPluginCapabilities } from './plugins.js';
import { RESERVED_API_PREFIXES } from './constants.js';
import { PLUGIN_CAPABILITY_REGEX } from '@lamalibre/lamaste';
import { getStateDb } from './state-db.js';

// Module-scoped logger used as the default for `validateTicket` when no
// per-request logger is passed. Routes still hand in their own request-scoped
// logger for normal operations.
let moduleLogger = {
  warn: (..._args) => {},
  info: (..._args) => {},
};

export function setTicketModuleLogger(logger) {
  if (logger && typeof logger.warn === 'function') {
    moduleLogger = logger;
  }
}

// --- Failed-validation surveillance (per-process, resets on restart) ---
//
// Brute-force of ticket tokens is mathematically infeasible (256 bits), but
// we still want operators to see active enumeration attempts. Two tiers:
//
//   1. Cumulative counter, logged every FAILURE_LOG_INTERVAL failures.
//   2. 5-minute rolling rate window — sustained > THRESHOLD/min for
//      RATE_BURST_MINUTES consecutive minutes triggers a one-time warn until
//      the rate drops back below threshold.
//
// Defense-in-depth only: the panel still returns a generic 401 to the caller.
const FAILURE_LOG_INTERVAL = 50;
const RATE_THRESHOLD_PER_MIN = 10;
const RATE_BURST_MINUTES = 5;
const RATE_WINDOW_MS = RATE_BURST_MINUTES * 60 * 1000;
let ticketValidationFailureCount = 0;
const ticketValidationFailureTimestamps = [];
let ticketValidationBurstActive = false;

function recordTicketValidationFailure(logger, reason) {
  ticketValidationFailureCount += 1;

  if (ticketValidationFailureCount % FAILURE_LOG_INTERVAL === 0) {
    logger.warn(
      { count: ticketValidationFailureCount, reason },
      'ticket validation repeated failures — possible enumeration attack',
    );
  }

  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  ticketValidationFailureTimestamps.push(now);
  while (
    ticketValidationFailureTimestamps.length > 0 &&
    ticketValidationFailureTimestamps[0] < cutoff
  ) {
    ticketValidationFailureTimestamps.shift();
  }

  // Sustained-burst escalation. Only fires once per "above threshold" episode
  // — clears when the window drops back below threshold so a renewed burst
  // can re-escalate without log spam in between.
  const ratePerMinute = ticketValidationFailureTimestamps.length / RATE_BURST_MINUTES;
  if (ratePerMinute >= RATE_THRESHOLD_PER_MIN) {
    if (!ticketValidationBurstActive) {
      ticketValidationBurstActive = true;
      logger.warn(
        {
          rate: Number(ratePerMinute.toFixed(2)),
          threshold: RATE_THRESHOLD_PER_MIN,
          windowMinutes: RATE_BURST_MINUTES,
          note: 'possible ticket enumeration attack',
        },
        'ticket validation failure rate sustained above threshold',
      );
    }
  } else if (ticketValidationBurstActive) {
    ticketValidationBurstActive = false;
  }
}

// --- Ticket expiry constants ---
const TICKET_EXPIRY_MS = 30 * 1000; // 30 seconds
const TICKET_CLEANUP_MS = 60 * 60 * 1000; // 1 hour
const INSTANCE_STALE_MS = 5 * 60 * 1000; // 5 minutes → stale
const INSTANCE_DEAD_MS = 60 * 60 * 1000; // 1 hour → dead
const SESSION_STALE_MS = 10 * 60 * 1000; // 10 minutes without activity → dead
const SESSION_CLEANUP_MS = 24 * 60 * 60 * 1000; // 24 hours

// --- Hard caps (DoS protection on 512MB droplets) ---
const MAX_INSTANCES = 200;
const MAX_TICKETS = 1000;
const MAX_SESSIONS = 500;

// --- Rate limiting ---
const TICKET_RATE_LIMIT = 10; // per agent per minute
const TICKET_RATE_WINDOW_MS = 60 * 1000;
const MAX_RATE_ENTRIES = 1000;
const ticketRateCounts = new Map();

// --- Promise-chain mutex ---
//
// SQLite's BEGIN IMMEDIATE serialises a single write transaction, but many
// exported operations are read-modify-write sequences spanning multiple
// statements. This lock keeps each such sequence atomic. Tracking as a
// follow-up: collapse each sequence into a single transaction, then drop
// the mutex.
let ticketLock = Promise.resolve();
function withTicketLock(fn) {
  const prev = ticketLock;
  let resolve;
  ticketLock = new Promise((r) => {
    resolve = r;
  });
  return prev.then(fn).finally(resolve);
}

// --- Zod schemas ---

const RESERVED_NAMES = RESERVED_API_PREFIXES;

export const TicketScopeNameSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9-]+$/, 'Must be lowercase alphanumeric with hyphens')
  .refine((v) => !RESERVED_NAMES.includes(v), 'Name is reserved');

// Ticket scope sub-scope names share the plugin capability namespace
// (`plugin:<short-name>:<action>`) — this is the only top-level namespace
// any non-core code can declare. Forces sub-scopes to coexist cleanly with
// plugin-declared capabilities and makes "plugin owns its own scopes"
// the only mental model needed at call sites.
const CapabilityStringSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(
    PLUGIN_CAPABILITY_REGEX,
    'Must use the "plugin:<short-name>:<action>" namespace (lowercase alphanumeric with optional internal hyphens)',
  );

const ScopeDeclarationSchema = z.object({
  name: CapabilityStringSchema,
  description: z.string().min(1).max(500),
  instanceScoped: z.boolean(),
});

const TransportStrategySchema = z.enum(['tunnel', 'relay', 'direct']);

const TransportSchema = z.object({
  strategies: z.array(TransportStrategySchema).min(1),
  preferred: TransportStrategySchema,
  port: z.number().int().refine((v) => v === 0 || (v >= 1024 && v <= 65535), 'Port must be 0 or 1024-65535'),
  protocol: z.enum(['wss', 'tcp']),
}).refine(
  (t) => t.strategies.includes(t.preferred),
  'Preferred strategy must be in strategies array',
);

export const RegisterScopeSchema = z.object({
  name: TicketScopeNameSchema,
  version: z.string().min(1).max(50),
  description: z.string().min(1).max(500),
  scopes: z.array(ScopeDeclarationSchema).min(1).max(50),
  transport: TransportSchema,
});

// Hostname/IP validation: reject private, loopback, link-local, and metadata IPs
const HostnameSchema = z.string().min(1).max(255).refine((host) => {
  // Block metadata endpoint (AWS/GCP/Azure)
  if (host === '169.254.169.254' || host === 'metadata.google.internal') return false;
  // Block loopback
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
  // Block IPv4 private ranges and link-local
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 10) return false;                         // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return false;  // 172.16.0.0/12
    if (a === 192 && b === 168) return false;            // 192.168.0.0/16
    if (a === 169 && b === 254) return false;            // 169.254.0.0/16 link-local
    if (a === 0) return false;                           // 0.0.0.0/8
  }
  return true;
}, { message: 'Host must be a public hostname or IP address' });

export const RegisterInstanceSchema = z.object({
  scope: CapabilityStringSchema,
  transport: z.object({
    strategies: z.array(TransportStrategySchema).min(1),
    preferred: TransportStrategySchema.optional(),
    direct: z.object({
      host: HostnameSchema,
      port: z.number().int().min(1024).max(65535),
    }).optional(),
  }),
});

export const RequestTicketSchema = z.object({
  scope: CapabilityStringSchema,
  instanceId: z.string().min(1).max(64).regex(/^[a-f0-9]+$/),
  // max 150 to accommodate plugin-agent:<delegating>:<plugin> labels
  target: z.string().min(1).max(150),
});

export const ValidateTicketSchema = z.object({
  ticketId: z.string().min(1).max(128).regex(/^[a-f0-9]+$/),
});

export const CreateSessionSchema = z.object({
  ticketId: z.string().min(1).max(128).regex(/^[a-f0-9]+$/),
});

export const UpdateSessionSchema = z.object({
  status: z.enum(['active', 'grace']),
});

export const AssignmentSchema = z.object({
  agentLabel: z.string().min(1).max(100),
  instanceScope: z.string().min(1).max(200).regex(/^plugin:[a-z0-9-]+:[a-z0-9-]+:[a-f0-9]+$/),
});

// --- SQLite prepared-statement bundle (lazy init) ---

let stmts = null;

async function getStmts() {
  if (stmts) return stmts;

  const db = await getStateDb();

  stmts = {
    db,

    // Scope statements
    selectAllScopes: db.prepare('SELECT * FROM ticket_scopes'),
    selectScopeByName: db.prepare('SELECT * FROM ticket_scopes WHERE name = ?'),
    insertScope: db.prepare(`
      INSERT INTO ticket_scopes
        (name, version, description, scopes, transport, hooks, installed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    deleteScope: db.prepare('DELETE FROM ticket_scopes WHERE name = ?'),

    // Instance statements
    selectAllInstances: db.prepare('SELECT * FROM ticket_instances'),
    selectInstanceById: db.prepare('SELECT * FROM ticket_instances WHERE instance_id = ?'),
    selectInstanceByScopeAgent: db.prepare(
      'SELECT * FROM ticket_instances WHERE scope = ? AND agent_label = ?',
    ),
    countInstances: db.prepare('SELECT COUNT(*) AS n FROM ticket_instances'),
    insertInstance: db.prepare(`
      INSERT INTO ticket_instances
        (instance_id, scope, agent_label, registered_at, last_heartbeat, status, transport)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    updateInstanceTransportHeartbeat: db.prepare(`
      UPDATE ticket_instances
      SET transport = ?, last_heartbeat = ?, status = 'active'
      WHERE instance_id = ?
    `),
    updateInstanceHeartbeat: db.prepare(`
      UPDATE ticket_instances
      SET last_heartbeat = ?, status = 'active'
      WHERE instance_id = ?
    `),
    updateInstanceStatus: db.prepare(`
      UPDATE ticket_instances SET status = ? WHERE instance_id = ?
    `),
    deleteInstance: db.prepare('DELETE FROM ticket_instances WHERE instance_id = ?'),
    deleteInstanceByStatus: db.prepare('DELETE FROM ticket_instances WHERE status = ?'),

    // Assignment statements
    selectAllAssignments: db.prepare('SELECT * FROM ticket_assignments'),
    selectAssignment: db.prepare(
      'SELECT * FROM ticket_assignments WHERE agent_label = ? AND instance_scope = ?',
    ),
    insertAssignment: db.prepare(`
      INSERT INTO ticket_assignments
        (agent_label, instance_scope, assigned_at, assigned_by)
      VALUES (?, ?, ?, ?)
    `),
    deleteAssignment: db.prepare(
      'DELETE FROM ticket_assignments WHERE agent_label = ? AND instance_scope = ?',
    ),
    deleteAssignmentsByInstanceScope: db.prepare(
      'DELETE FROM ticket_assignments WHERE instance_scope = ?',
    ),
    deleteAssignmentsByInstanceScopePrefix: db.prepare(
      'DELETE FROM ticket_assignments WHERE instance_scope LIKE ?',
    ),

    // Ticket statements
    selectAllTickets: db.prepare('SELECT * FROM tickets'),
    selectTicketByIndex: db.prepare('SELECT * FROM tickets WHERE index_hash = ?'),
    selectTicketsByInstance: db.prepare('SELECT * FROM tickets WHERE instance_id = ?'),
    selectTicketsByScope: db.prepare('SELECT * FROM tickets WHERE scope = ?'),
    countTickets: db.prepare('SELECT COUNT(*) AS n FROM tickets'),
    insertTicket: db.prepare(`
      INSERT INTO tickets
        (index_hash, id, scope, instance_id, source, target, created_at, expires_at, used, used_at, session_id, transport)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    markTicketUsed: db.prepare(
      'UPDATE tickets SET used = 1, used_at = ? WHERE index_hash = ?',
    ),
    setTicketSession: db.prepare(
      'UPDATE tickets SET session_id = ? WHERE index_hash = ?',
    ),
    deleteTicketsCreatedBefore: db.prepare(
      'DELETE FROM tickets WHERE created_at <= ?',
    ),

    // Session statements
    selectAllSessions: db.prepare('SELECT * FROM ticket_sessions'),
    selectSessionById: db.prepare('SELECT * FROM ticket_sessions WHERE session_id = ?'),
    selectSessionsByInstance: db.prepare('SELECT * FROM ticket_sessions WHERE instance_id = ?'),
    countLiveSessions: db.prepare(
      "SELECT COUNT(*) AS n FROM ticket_sessions WHERE status != 'dead'"
    ),
    insertSession: db.prepare(`
      INSERT INTO ticket_sessions
        (session_id, ticket_id, scope, instance_id, source, target, created_at, last_activity_at, status, reconnect_grace_seconds, terminated_by, terminated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateSessionActivity: db.prepare(
      'UPDATE ticket_sessions SET last_activity_at = ? WHERE session_id = ?',
    ),
    updateSessionStatusActivity: db.prepare(
      'UPDATE ticket_sessions SET status = ?, last_activity_at = ? WHERE session_id = ?',
    ),
    killSessionStmt: db.prepare(`
      UPDATE ticket_sessions
      SET status = 'dead', terminated_by = ?, terminated_at = ?
      WHERE session_id = ?
    `),
    deleteDeadOldSessions: db.prepare(
      "DELETE FROM ticket_sessions WHERE status = 'dead' AND created_at <= ?"
    ),

    // Transaction control
    begin: db.prepare('BEGIN IMMEDIATE'),
    commit: db.prepare('COMMIT'),
    rollback: db.prepare('ROLLBACK'),
  };

  return stmts;
}

// --- Row → JS object helpers (one per table) ---

function rowToScope(row) {
  return {
    name: row.name,
    version: row.version,
    description: row.description,
    scopes: JSON.parse(row.scopes),
    transport: JSON.parse(row.transport),
    hooks: JSON.parse(row.hooks),
    installedAt: row.installed_at,
  };
}

function rowToInstance(row) {
  return {
    instanceId: row.instance_id,
    scope: row.scope,
    agentLabel: row.agent_label,
    registeredAt: row.registered_at,
    lastHeartbeat: row.last_heartbeat,
    status: row.status,
    transport: JSON.parse(row.transport),
  };
}

function rowToAssignment(row) {
  return {
    agentLabel: row.agent_label,
    instanceScope: row.instance_scope,
    assignedAt: row.assigned_at,
    assignedBy: row.assigned_by,
  };
}

function rowToTicket(row) {
  return {
    id: row.id,
    scope: row.scope,
    instanceId: row.instance_id,
    source: row.source,
    target: row.target,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    used: row.used === 1,
    usedAt: row.used_at ?? null,
    sessionId: row.session_id ?? null,
    transport: JSON.parse(row.transport),
  };
}

function rowToSession(row) {
  const session = {
    sessionId: row.session_id,
    ticketId: row.ticket_id,
    scope: row.scope,
    instanceId: row.instance_id,
    source: row.source,
    target: row.target,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    status: row.status,
    reconnectGraceSeconds: row.reconnect_grace_seconds,
  };
  if (row.terminated_by) session.terminatedBy = row.terminated_by;
  if (row.terminated_at) session.terminatedAt = row.terminated_at;
  return session;
}

// --- Ticket index (hash of full token) ---
//
// Tickets are stored keyed by `sha256(ticketId)` (base64url) so validate /
// revoke / createSession lookups are O(1) and constant-cost regardless of
// how many tickets are live. The hash is purely an index — it is recomputed
// from the inbound token, so the persisted form leaks no usable secret.
function ticketIndex(ticketId) {
  return crypto
    .createHash('sha256')
    .update(ticketId, 'utf-8')
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function constantTimeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf-8'), Buffer.from(b, 'utf-8'));
}

// --- Cleanup helpers ---
//
// Delete expired tickets, mark stale sessions as dead. Writes happen
// in-place; the helper returns void.
function cleanExpiredTickets() {
  const cutoff = new Date(Date.now() - TICKET_CLEANUP_MS).toISOString();
  stmts.deleteTicketsCreatedBefore.run(cutoff);

  // Mark stale (no heartbeat for SESSION_STALE_MS) sessions as dead.
  const now = Date.now();
  const staleCutoff = new Date(now - SESSION_STALE_MS).toISOString();
  const allSessions = stmts.selectAllSessions.all();
  for (const row of allSessions) {
    if (row.status !== 'dead' && row.last_activity_at < staleCutoff) {
      stmts.killSessionStmt.run('system', new Date().toISOString(), row.session_id);
    }
  }

  const sessionCutoff = new Date(now - SESSION_CLEANUP_MS).toISOString();
  stmts.deleteDeadOldSessions.run(sessionCutoff);
}

// --- Rate limiting ---

function checkRateLimit(agentLabel) {
  const now = Date.now();
  const key = agentLabel;
  let entry = ticketRateCounts.get(key);

  if (!entry || now - entry.windowStart > TICKET_RATE_WINDOW_MS) {
    // Evict oldest entries if map is too large
    if (ticketRateCounts.size >= MAX_RATE_ENTRIES && !ticketRateCounts.has(key)) {
      const firstKey = ticketRateCounts.keys().next().value;
      ticketRateCounts.delete(firstKey);
    }
    entry = { windowStart: now, count: 0 };
    ticketRateCounts.set(key, entry);
  }

  entry.count++;
  if (entry.count > TICKET_RATE_LIMIT) {
    throw Object.assign(new Error('Rate limit exceeded'), { statusCode: 429 });
  }
}

// Periodic cleanup of stale rate limit entries
const rateLimitInterval = setInterval(() => {
  const cutoff = Date.now() - TICKET_RATE_WINDOW_MS * 2;
  for (const [key, entry] of ticketRateCounts) {
    if (entry.windowStart < cutoff) ticketRateCounts.delete(key);
  }
}, TICKET_RATE_WINDOW_MS * 2);
rateLimitInterval.unref();

export function clearRateLimitInterval() {
  clearInterval(rateLimitInterval);
}

// --- Ticket scope capabilities ---

async function refreshTicketScopeCapabilities() {
  const scopeRows = stmts.selectAllScopes.all();
  const caps = [];
  for (const row of scopeRows) {
    const scope = rowToScope(row);
    for (const s of scope.scopes) {
      caps.push(s.name);
    }
  }
  setTicketScopeCapabilitiesOnMtls([...new Set(caps)]);
}

export async function loadTicketScopeCapabilities() {
  await getStmts();
  await refreshTicketScopeCapabilities();
}

/**
 * Check whether a given capability name is a registered ticket scope capability.
 *
 * Iterates the scope registry and checks if any registered scope has a
 * sub-scope whose name matches the provided capability.
 *
 * @param {string} capability - Capability string to check (e.g., "plugin:sync:connect")
 * @returns {Promise<boolean>}
 */
export function isRegisteredTicketScope(capability) {
  return withTicketLock(async () => {
    await getStmts();
    const scopeRows = stmts.selectAllScopes.all();
    for (const row of scopeRows) {
      const scope = rowToScope(row);
      for (const s of scope.scopes) {
        if (s.name === capability) {
          return true;
        }
      }
    }
    return false;
  });
}

/**
 * List every sub-scope name currently held by the ticket scope registry.
 *
 * Used by the plugin install path to detect a collision between an incoming
 * plugin's declared capability and an already-registered ticket scope. The
 * namespacing rule guarantees both sides live under `plugin:*`, so a flat
 * set intersection is sufficient.
 *
 * @returns {Promise<string[]>}
 */
export function listRegisteredSubScopeNames() {
  return withTicketLock(async () => {
    await getStmts();
    const scopeRows = stmts.selectAllScopes.all();
    const names = [];
    for (const row of scopeRows) {
      const scope = rowToScope(row);
      for (const s of scope.scopes) {
        names.push(s.name);
      }
    }
    return names;
  });
}

// --- Instance ownership check ---

/**
 * Check whether an agent owns at least one active instance for the given scope.
 *
 * Used by delegated enrollment to verify the delegating agent has a live
 * ticket instance for the scope it is delegating.
 *
 * @param {string} agentLabel - Agent label to check
 * @param {string} scope - Ticket scope (e.g., "sync:connect")
 * @returns {Promise<boolean>}
 */
export function agentOwnsInstanceForScope(agentLabel, scope) {
  return withTicketLock(async () => {
    await getStmts();
    const rows = stmts.selectInstanceByScopeAgent.all(scope, agentLabel);
    return rows.some((r) => r.status !== 'dead');
  });
}

// --- Scope management ---

export function registerScope(body, logger) {
  return withTicketLock(async () => {
    await getStmts();

    const existing = stmts.selectScopeByName.get(body.name);
    if (existing) {
      throw Object.assign(
        new Error(`Ticket scope "${body.name}" is already registered`),
        { statusCode: 409 },
      );
    }

    // Sub-scope name uniqueness across the registry: even with namespacing,
    // two unrelated scope manifests could declare the same `plugin:foo:bar`
    // sub-scope and the union in `getValidCapabilities()` would prevent
    // either owner from cleanly revoking it. Reject the second registration
    // deterministically.
    const subScopeNames = body.scopes.map((s) => s.name);
    const duplicateInBody = subScopeNames.find(
      (n, i) => subScopeNames.indexOf(n) !== i,
    );
    if (duplicateInBody) {
      throw Object.assign(
        new Error(`Ticket scope manifest declares sub-scope "${duplicateInBody}" twice`),
        { statusCode: 400 },
      );
    }

    const allScopeRows = stmts.selectAllScopes.all();
    let collisionWithExistingScope = null;
    let offender = null;
    for (const row of allScopeRows) {
      const scope = rowToScope(row);
      const collide = scope.scopes.find((sub) => subScopeNames.includes(sub.name));
      if (collide) {
        collisionWithExistingScope = scope;
        offender = collide;
        break;
      }
    }
    if (collisionWithExistingScope) {
      throw Object.assign(
        new Error(
          `Sub-scope "${offender?.name}" is already registered by ticket scope ` +
            `"${collisionWithExistingScope.name}"`,
        ),
        { statusCode: 409 },
      );
    }

    // Cross-namespace collision: a sub-scope name MUST NOT match any
    // capability already contributed by an installed (enabled) plugin. The
    // namespacing rule enforces both sides live in `plugin:*` so the check
    // is a flat set intersection.
    const pluginCaps = new Set(await getPluginCapabilities());
    const collidingPluginCap = subScopeNames.find((n) => pluginCaps.has(n));
    if (collidingPluginCap) {
      throw Object.assign(
        new Error(
          `Sub-scope "${collidingPluginCap}" is already declared by an enabled plugin — ` +
            'pick a different action name or revoke the plugin first',
        ),
        { statusCode: 409 },
      );
    }

    const installedAt = new Date().toISOString();

    stmts.begin.run();
    try {
      stmts.insertScope.run(
        body.name,
        body.version,
        body.description,
        JSON.stringify(body.scopes),
        JSON.stringify(body.transport),
        JSON.stringify({}),
        installedAt,
      );
      stmts.commit.run();
    } catch (err) {
      stmts.rollback.run();
      throw err;
    }

    await refreshTicketScopeCapabilities();

    logger.info({ name: body.name, registered: subScopeNames }, 'Ticket scope registered');
    return { ok: true, registered: subScopeNames };
  });
}

export function listScopes() {
  return withTicketLock(async () => {
    await getStmts();
    const scopeRows = stmts.selectAllScopes.all();
    const instanceRows = stmts.selectAllInstances.all();
    const assignmentRows = stmts.selectAllAssignments.all();
    return {
      scopes: scopeRows.map(rowToScope),
      instances: instanceRows.map(rowToInstance),
      assignments: assignmentRows.map(rowToAssignment),
    };
  });
}

export function unregisterScope(name, logger) {
  return withTicketLock(async () => {
    await getStmts();
    const scopeRow = stmts.selectScopeByName.get(name);
    if (!scopeRow) {
      throw Object.assign(
        new Error(`Ticket scope "${name}" not found`),
        { statusCode: 404 },
      );
    }

    const scope = rowToScope(scopeRow);
    const scopeNames = scope.scopes.map((s) => s.name);

    stmts.begin.run();
    try {
      // Remove instances for any sub-scope of this manifest (cascade).
      const allInstances = stmts.selectAllInstances.all();
      for (const inst of allInstances) {
        if (scopeNames.includes(inst.scope)) {
          stmts.deleteInstance.run(inst.instance_id);
        }
      }

      // Remove assignments whose instanceScope starts with `${subScope}:`.
      for (const sn of scopeNames) {
        stmts.deleteAssignmentsByInstanceScopePrefix.run(`${sn}:%`);
      }

      // Delete the scope row itself.
      stmts.deleteScope.run(name);

      // Invalidate active tickets for removed scopes (mark used).
      const usedAt = new Date().toISOString();
      for (const sn of scopeNames) {
        const ticketRows = stmts.selectTicketsByScope.all(sn);
        for (const tr of ticketRows) {
          if (tr.used === 0) {
            stmts.markTicketUsed.run(usedAt, tr.index_hash);
          }
        }
      }

      stmts.commit.run();
    } catch (err) {
      stmts.rollback.run();
      throw err;
    }

    await refreshTicketScopeCapabilities();

    logger.info({ name }, 'Ticket scope unregistered');
    return { ok: true, name };
  });
}

// --- Instance management ---

export function registerInstance(scope, transport, agentLabel, logger) {
  return withTicketLock(async () => {
    await getStmts();

    // Verify scope exists (search across all scope manifests)
    const scopeRows = stmts.selectAllScopes.all();
    let scopeEntry = null;
    for (const row of scopeRows) {
      const s = rowToScope(row);
      for (const decl of s.scopes) {
        if (decl.name === scope) {
          scopeEntry = decl;
          break;
        }
      }
      if (scopeEntry) break;
    }

    if (!scopeEntry) {
      throw Object.assign(
        new Error('Scope not registered'),
        { statusCode: 404 },
      );
    }

    // Check for existing instance from this agent for this scope (idempotent re-registration)
    const existingRows = stmts.selectInstanceByScopeAgent.all(scope, agentLabel);
    if (existingRows.length > 0) {
      const existing = existingRows[0];
      stmts.begin.run();
      try {
        stmts.updateInstanceTransportHeartbeat.run(
          JSON.stringify(transport),
          new Date().toISOString(),
          existing.instance_id,
        );
        stmts.commit.run();
      } catch (err) {
        stmts.rollback.run();
        throw err;
      }

      logger.info({ scope, agentLabel, instanceId: existing.instance_id }, 'Instance re-registered');
      return {
        ok: true,
        instanceId: existing.instance_id,
        instanceScope: `${scope}:${existing.instance_id}`,
        isReregistration: true,
      };
    }

    // New registration — enforce hard cap
    const { n } = stmts.countInstances.get();
    if (n >= MAX_INSTANCES) {
      throw Object.assign(new Error('Instance limit reached'), { statusCode: 503 });
    }

    const instanceId = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();

    stmts.begin.run();
    try {
      stmts.insertInstance.run(
        instanceId,
        scope,
        agentLabel,
        now,
        now,
        'active',
        JSON.stringify(transport),
      );
      stmts.commit.run();
    } catch (err) {
      stmts.rollback.run();
      throw err;
    }

    logger.info({ scope, agentLabel, instanceId }, 'Instance registered');
    return {
      ok: true,
      instanceId,
      instanceScope: `${scope}:${instanceId}`,
      isReregistration: false,
    };
  });
}

export function deregisterInstance(instanceId, callerLabel, callerRole, logger) {
  return withTicketLock(async () => {
    await getStmts();

    const instanceRow = stmts.selectInstanceById.get(instanceId);
    if (!instanceRow) {
      throw Object.assign(new Error('Instance not found'), { statusCode: 404 });
    }

    // Only the owning agent or admin can deregister (return 404 to avoid leaking existence)
    if (callerRole !== 'admin' && callerLabel !== instanceRow.agent_label) {
      throw Object.assign(new Error('Instance not found'), { statusCode: 404 });
    }

    const instanceScope = `${instanceRow.scope}:${instanceId}`;

    stmts.begin.run();
    try {
      // Remove assignments for this instance.
      stmts.deleteAssignmentsByInstanceScope.run(instanceScope);

      // Delete the instance row.
      stmts.deleteInstance.run(instanceId);

      // Invalidate pending tickets and kill active sessions for this instance.
      const usedAt = new Date().toISOString();
      const ticketRows = stmts.selectTicketsByInstance.all(instanceId);
      for (const tr of ticketRows) {
        if (tr.used === 0) {
          stmts.markTicketUsed.run(usedAt, tr.index_hash);
        }
      }
      const sessionRows = stmts.selectSessionsByInstance.all(instanceId);
      for (const sr of sessionRows) {
        if (sr.status !== 'dead') {
          stmts.killSessionStmt.run('system', new Date().toISOString(), sr.session_id);
        }
      }
      stmts.commit.run();
    } catch (err) {
      stmts.rollback.run();
      throw err;
    }

    logger.info({ instanceId, scope: instanceRow.scope }, 'Instance deregistered');
    return { ok: true, instanceId };
  });
}

export function instanceHeartbeat(instanceId, agentLabel) {
  return withTicketLock(async () => {
    await getStmts();
    const instanceRow = stmts.selectInstanceById.get(instanceId);

    if (!instanceRow || instanceRow.agent_label !== agentLabel) {
      throw Object.assign(new Error('Instance not found'), { statusCode: 404 });
    }

    // Verify agent still has the scope capability. Filter the stored list
    // through the live valid set so that capabilities contributed by an
    // uninstalled plugin or deregistered scope are not honored.
    const agentRegistry = await loadAgentRegistry();
    const agent = agentRegistry.agents.find((a) => a.label === agentLabel && !a.revoked);
    if (!agent) {
      throw Object.assign(new Error('Instance not found'), { statusCode: 404 });
    }
    if (!liveCapsInclude(agent, instanceRow.scope)) {
      throw Object.assign(new Error('Instance not found'), { statusCode: 404 });
    }

    stmts.begin.run();
    try {
      stmts.updateInstanceHeartbeat.run(new Date().toISOString(), instanceId);
      stmts.commit.run();
    } catch (err) {
      stmts.rollback.run();
      throw err;
    }

    return { ok: true };
  });
}

/**
 * Check whether `capability` is currently honored for `agent`.
 *
 * Single source of truth for "does this agent currently hold this cap?".
 * Reads `agent.capabilities` and intersects with the live valid set
 * (`getValidCapabilities()`), so an entry that became invalid after a
 * plugin uninstall or ticket scope deregistration is treated as absent.
 *
 * Defaults a missing capability list to ['tunnels:read'] to preserve the
 * legacy behaviour for agents enrolled before capabilities were stored.
 */
function liveCapsInclude(agent, capability) {
  const stored = Array.isArray(agent?.capabilities)
    ? agent.capabilities
    : ['tunnels:read'];
  if (!stored.includes(capability)) return false;
  const valid = new Set(getValidCapabilities());
  return valid.has(capability);
}

// --- Instance assignment ---

export function createAssignment(agentLabel, instanceScope, logger) {
  return withTicketLock(async () => {
    await getStmts();

    // Parse instanceScope: "plugin:<route>:<action>:<hex-id>"
    const parts = instanceScope.match(/^(plugin:[a-z0-9-]+:[a-z0-9-]+):([a-f0-9]+)$/);
    if (!parts) {
      throw Object.assign(new Error('Invalid instance scope format'), { statusCode: 400 });
    }
    const [, baseScope, instanceId] = parts;

    // Verify agent exists and is not revoked
    const agentRegistry = await loadAgentRegistry();
    const agent = agentRegistry.agents.find((a) => a.label === agentLabel && !a.revoked);
    if (!agent) {
      throw Object.assign(new Error('Agent not found or revoked'), { statusCode: 404 });
    }

    // Verify agent has the base capability — check against the live valid
    // set so caps from uninstalled plugins / deregistered scopes are not
    // honored (see liveCapsInclude).
    if (!liveCapsInclude(agent, baseScope)) {
      throw Object.assign(
        new Error(`Agent "${agentLabel}" lacks capability "${baseScope}"`),
        { statusCode: 400 },
      );
    }

    // Verify instance exists and is active
    const instanceRow = stmts.selectInstanceById.get(instanceId);
    if (!instanceRow || instanceRow.scope !== baseScope || instanceRow.status === 'dead') {
      throw Object.assign(new Error('Instance not found or not active'), { statusCode: 404 });
    }

    // Check for duplicate assignment
    const existingRow = stmts.selectAssignment.get(agentLabel, instanceScope);
    if (existingRow) {
      return { ok: true, assignment: rowToAssignment(existingRow), isExisting: true };
    }

    const assignedAt = new Date().toISOString();
    const assignedBy = 'admin';

    stmts.begin.run();
    try {
      stmts.insertAssignment.run(agentLabel, instanceScope, assignedAt, assignedBy);
      stmts.commit.run();
    } catch (err) {
      stmts.rollback.run();
      throw err;
    }

    const assignment = { agentLabel, instanceScope, assignedAt, assignedBy };
    logger.info({ agentLabel, instanceScope }, 'Assignment created');
    return { ok: true, assignment };
  });
}

export function removeAssignment(agentLabel, instanceScope, logger) {
  return withTicketLock(async () => {
    await getStmts();
    const existingRow = stmts.selectAssignment.get(agentLabel, instanceScope);
    if (!existingRow) {
      throw Object.assign(new Error('Assignment not found'), { statusCode: 404 });
    }

    stmts.begin.run();
    try {
      stmts.deleteAssignment.run(agentLabel, instanceScope);
      stmts.commit.run();
    } catch (err) {
      stmts.rollback.run();
      throw err;
    }

    logger.info({ agentLabel, instanceScope }, 'Assignment removed');
    return { ok: true };
  });
}

export function listAssignments(filters) {
  return withTicketLock(async () => {
    await getStmts();
    let assignments = stmts.selectAllAssignments.all().map(rowToAssignment);

    if (filters?.agentLabel) {
      assignments = assignments.filter((a) => a.agentLabel === filters.agentLabel);
    }
    if (filters?.instanceScope) {
      assignments = assignments.filter((a) => a.instanceScope === filters.instanceScope);
    }

    return { assignments };
  });
}

// --- Ticket operations ---

export function requestTicket(scope, instanceId, target, sourceLabel, logger) {
  return withTicketLock(async () => {
    await getStmts();

    // Rate limit
    checkRateLimit(sourceLabel);

    cleanExpiredTickets();

    // Stage 1: Verify source/target agents have the base capability —
    // checked through liveCapsInclude so caps from uninstalled plugins or
    // deregistered scopes do not satisfy the check.
    const agentRegistry = await loadAgentRegistry();
    const sourceAgent = agentRegistry.agents.find((a) => a.label === sourceLabel && !a.revoked);
    if (!sourceAgent || !liveCapsInclude(sourceAgent, scope)) {
      throw Object.assign(new Error('Not found'), { statusCode: 404 });
    }

    const targetAgent = agentRegistry.agents.find((a) => a.label === target && !a.revoked);
    if (!targetAgent || !liveCapsInclude(targetAgent, scope)) {
      throw Object.assign(new Error('Not found'), { statusCode: 404 });
    }

    // Stage 2: Verify source owns the instance
    const instanceRow = stmts.selectInstanceById.get(instanceId);
    if (!instanceRow || instanceRow.scope !== scope || instanceRow.agent_label !== sourceLabel) {
      throw Object.assign(new Error('Not found'), { statusCode: 404 });
    }

    // Check instance status
    if (instanceRow.status === 'stale') {
      throw Object.assign(new Error('Instance is stale'), { statusCode: 503 });
    }
    if (instanceRow.status === 'dead') {
      throw Object.assign(new Error('Not found'), { statusCode: 404 });
    }

    // Reject self-tickets (source cannot also be the target)
    if (sourceLabel === target) {
      throw Object.assign(new Error('Not found'), { statusCode: 404 });
    }

    // Stage 3: Verify target is assigned to this instance
    const instanceScope = `${scope}:${instanceId}`;
    const assignmentRow = stmts.selectAssignment.get(target, instanceScope);
    if (!assignmentRow) {
      throw Object.assign(new Error('Not found'), { statusCode: 404 });
    }

    // Enforce ticket cap
    const { n } = stmts.countTickets.get();
    if (n >= MAX_TICKETS) {
      throw Object.assign(new Error('Ticket limit reached'), { statusCode: 503 });
    }

    // Create ticket
    const ticketId = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TICKET_EXPIRY_MS);
    const transportObj = JSON.parse(instanceRow.transport);

    stmts.begin.run();
    try {
      stmts.insertTicket.run(
        ticketIndex(ticketId),
        ticketId,
        scope,
        instanceId,
        sourceLabel,
        target,
        now.toISOString(),
        expiresAt.toISOString(),
        0,
        null,
        null,
        instanceRow.transport,
      );
      stmts.commit.run();
    } catch (err) {
      stmts.rollback.run();
      throw err;
    }

    logger.info({ ticketId: ticketId.slice(0, 8), scope, source: sourceLabel, target }, 'Ticket issued');
    return {
      ok: true,
      ticket: {
        id: ticketId,
        scope,
        instanceId,
        source: sourceLabel,
        target,
        expiresAt: expiresAt.toISOString(),
        transport: transportObj,
      },
    };
  });
}

export function getTicketInbox(agentLabel) {
  return withTicketLock(async () => {
    await getStmts();
    const now = Date.now();
    const allTickets = stmts.selectAllTickets.all().map(rowToTicket);
    const tickets = allTickets.filter(
      (t) =>
        t.target === agentLabel &&
        !t.used &&
        new Date(t.expiresAt).getTime() > now,
    );

    return {
      tickets: tickets.map((t) => ({
        id: t.id,
        scope: t.scope,
        instanceId: t.instanceId,
        source: t.source,
        expiresAt: t.expiresAt,
        transport: t.transport,
      })),
    };
  });
}

/**
 * Validate a ticket and atomically mark it used.
 *
 * `logger` is the request-scoped Fastify logger; structured `reason` for the
 * specific failure mode is written to the panel log on every denial. The HTTP
 * response always uses the generic "Invalid ticket" message — no information
 * leakage to the calling agent.
 */
export function validateTicket(ticketId, callerLabel, logger = moduleLogger) {
  return withTicketLock(async () => {
    await getStmts();
    cleanExpiredTickets();

    // Discriminated reason for the panel log only — never returned to caller.
    const deny = (reason) => {
      logger.info(
        { ticketId: ticketId.slice(0, 8), reason, caller: callerLabel },
        'ticket validation denied',
      );
      recordTicketValidationFailure(logger, reason);
      throw Object.assign(new Error('Invalid ticket'), { statusCode: 401, reason });
    };

    const key = ticketIndex(ticketId);
    const row = stmts.selectTicketByIndex.get(key);

    if (!row) deny('not_found');
    // Defense against a hash collision: confirm the stored full token matches
    // the caller-supplied one with a constant-time compare. ticketIndex is a
    // SHA-256 — a collision is computationally infeasible — but the equality
    // is cheap and removes any reliance on collision resistance for auth.
    if (!constantTimeStringEqual(row.id, ticketId)) deny('not_found');

    if (row.used === 1) deny('already_used');
    if (new Date(row.expires_at).getTime() < Date.now()) deny('expired');
    if (row.target !== callerLabel) deny('target_mismatch');

    // Mark as used atomically
    stmts.begin.run();
    try {
      stmts.markTicketUsed.run(new Date().toISOString(), key);
      stmts.commit.run();
    } catch (err) {
      stmts.rollback.run();
      throw err;
    }

    return {
      valid: true,
      scope: row.scope,
      instanceId: row.instance_id,
      source: row.source,
      target: row.target,
      transport: JSON.parse(row.transport),
    };
  });
}

export function listTickets() {
  return withTicketLock(async () => {
    await getStmts();
    cleanExpiredTickets();
    // Admin is fully trusted (mTLS admin cert) — return full IDs so revoke works.
    // Tickets are stored hash-indexed in SQLite for O(1) validate; the admin UI
    // consumes a plain array, so flatten on the way out.
    return { tickets: stmts.selectAllTickets.all().map(rowToTicket) };
  });
}

export function revokeTicket(ticketId, logger) {
  return withTicketLock(async () => {
    await getStmts();
    const key = ticketIndex(ticketId);
    const row = stmts.selectTicketByIndex.get(key);

    // Defense against hash collision (see validateTicket): require the stored
    // full token to constant-time-equal the inbound one.
    if (!row || !constantTimeStringEqual(row.id, ticketId)) {
      throw Object.assign(new Error('Ticket not found'), { statusCode: 404 });
    }

    stmts.begin.run();
    try {
      if (row.used === 0) {
        stmts.markTicketUsed.run(new Date().toISOString(), key);
      }

      // If the ticket had a session, mark it for termination
      if (row.session_id) {
        const sessionRow = stmts.selectSessionById.get(row.session_id);
        if (sessionRow && sessionRow.status !== 'dead') {
          stmts.killSessionStmt.run('admin', new Date().toISOString(), row.session_id);
        }
      }
      stmts.commit.run();
    } catch (err) {
      stmts.rollback.run();
      throw err;
    }

    logger.info({ ticketId: ticketId.slice(0, 8) }, 'Ticket revoked');
    return { ok: true };
  });
}

// --- Session management ---

export function createSession(ticketId, callerLabel, logger) {
  return withTicketLock(async () => {
    await getStmts();

    const key = ticketIndex(ticketId);
    const row = stmts.selectTicketByIndex.get(key);
    if (
      !row ||
      !constantTimeStringEqual(row.id, ticketId) ||
      row.used !== 1 ||
      row.target !== callerLabel
    ) {
      throw Object.assign(new Error('Invalid ticket'), { statusCode: 400 });
    }

    // Prevent duplicate sessions for the same ticket
    if (row.session_id) {
      throw Object.assign(new Error('Session already exists for this ticket'), { statusCode: 409 });
    }

    // Enforce session cap
    const { n } = stmts.countLiveSessions.get();
    if (n >= MAX_SESSIONS) {
      throw Object.assign(new Error('Session limit reached'), { statusCode: 503 });
    }

    // Generate session ID server-side for uniqueness guarantee
    const sessionId = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const session = {
      sessionId,
      ticketId,
      scope: row.scope,
      instanceId: row.instance_id,
      source: row.source,
      target: row.target,
      createdAt: now,
      lastActivityAt: now,
      status: 'active',
      reconnectGraceSeconds: 60,
    };

    stmts.begin.run();
    try {
      stmts.insertSession.run(
        sessionId,
        ticketId,
        row.scope,
        row.instance_id,
        row.source,
        row.target,
        now,
        now,
        'active',
        60,
        null,
        null,
      );
      stmts.setTicketSession.run(sessionId, key);
      stmts.commit.run();
    } catch (err) {
      stmts.rollback.run();
      throw err;
    }

    logger.info({ sessionId, ticketId: ticketId.slice(0, 8), scope: row.scope }, 'Session created');
    return { ok: true, session };
  });
}

export function sessionHeartbeat(sessionId, callerLabel) {
  return withTicketLock(async () => {
    await getStmts();
    const sessionRow = stmts.selectSessionById.get(sessionId);

    if (!sessionRow || sessionRow.target !== callerLabel) {
      throw Object.assign(new Error('Session not found'), { statusCode: 404 });
    }

    if (sessionRow.status === 'dead') {
      return { authorized: false, reason: 'admin_killed' };
    }

    const session = rowToSession(sessionRow);

    // Re-validate authorization
    const agentRegistry = await loadAgentRegistry();

    // Check source cert is not revoked
    const sourceAgent = agentRegistry.agents.find((a) => a.label === session.source);
    if (!sourceAgent || sourceAgent.revoked) {
      stmts.killSessionStmt.run('system', new Date().toISOString(), sessionId);
      return { authorized: false, reason: 'source_revoked' };
    }

    // Check source still has capability — through the live valid set so a
    // capability whose backing plugin/scope was removed counts as gone.
    if (!liveCapsInclude(sourceAgent, session.scope)) {
      stmts.killSessionStmt.run('system', new Date().toISOString(), sessionId);
      return { authorized: false, reason: 'capability_removed' };
    }

    // Check target agent still has capability (defense-in-depth)
    const targetAgent = agentRegistry.agents.find((a) => a.label === session.target);
    if (!targetAgent || targetAgent.revoked) {
      stmts.killSessionStmt.run('system', new Date().toISOString(), sessionId);
      return { authorized: false, reason: 'target_revoked' };
    }
    if (!liveCapsInclude(targetAgent, session.scope)) {
      stmts.killSessionStmt.run('system', new Date().toISOString(), sessionId);
      return { authorized: false, reason: 'capability_removed' };
    }

    // Check assignment still valid
    const instanceScope = `${session.scope}:${session.instanceId}`;
    const assignmentRow = stmts.selectAssignment.get(callerLabel, instanceScope);
    if (!assignmentRow) {
      stmts.killSessionStmt.run('system', new Date().toISOString(), sessionId);
      return { authorized: false, reason: 'assignment_removed' };
    }

    // All checks passed
    stmts.updateSessionActivity.run(new Date().toISOString(), sessionId);
    return { authorized: true };
  });
}

export function updateSession(sessionId, status, callerLabel) {
  return withTicketLock(async () => {
    await getStmts();
    const sessionRow = stmts.selectSessionById.get(sessionId);
    if (!sessionRow || (sessionRow.target !== callerLabel && sessionRow.source !== callerLabel)) {
      throw Object.assign(new Error('Session not found'), { statusCode: 404 });
    }

    // Prevent reactivation of admin-killed or system-terminated sessions
    if (sessionRow.status === 'dead') {
      throw Object.assign(new Error('Session is terminated'), { statusCode: 409 });
    }

    const session = rowToSession(sessionRow);

    // Re-validate authorization on every status transition
    const agentRegistry = await loadAgentRegistry();

    // Check source cert is not revoked and still has capability
    const sourceAgent = agentRegistry.agents.find((a) => a.label === session.source);
    if (!sourceAgent || sourceAgent.revoked) {
      stmts.killSessionStmt.run('system', new Date().toISOString(), sessionId);
      throw Object.assign(new Error('Session is terminated'), { statusCode: 409 });
    }
    if (!liveCapsInclude(sourceAgent, session.scope)) {
      stmts.killSessionStmt.run('system', new Date().toISOString(), sessionId);
      throw Object.assign(new Error('Session is terminated'), { statusCode: 409 });
    }

    // Check target assignment is still valid (always check against target, not caller)
    const instanceScope = `${session.scope}:${session.instanceId}`;
    const assignmentRow = stmts.selectAssignment.get(session.target, instanceScope);
    if (!assignmentRow) {
      stmts.killSessionStmt.run('system', new Date().toISOString(), sessionId);
      throw Object.assign(new Error('Session is terminated'), { statusCode: 409 });
    }

    // Always set server-side timestamp to prevent clients from extending session lifetime
    stmts.updateSessionStatusActivity.run(status, new Date().toISOString(), sessionId);

    return { ok: true };
  });
}

export function killSession(sessionId, logger) {
  return withTicketLock(async () => {
    await getStmts();
    const sessionRow = stmts.selectSessionById.get(sessionId);
    if (!sessionRow) {
      throw Object.assign(new Error('Session not found'), { statusCode: 404 });
    }

    stmts.killSessionStmt.run('admin', new Date().toISOString(), sessionId);

    logger.info({ sessionId }, 'Session killed by admin');
    return { ok: true };
  });
}

export function listSessions() {
  return withTicketLock(async () => {
    await getStmts();
    cleanExpiredTickets();
    return { sessions: stmts.selectAllSessions.all().map(rowToSession) };
  });
}

// --- Instance liveness check (call periodically) ---

export async function checkInstanceLiveness(logger) {
  return withTicketLock(async () => {
    await getStmts();
    const now = Date.now();

    const allInstances = stmts.selectAllInstances.all();

    for (const inst of allInstances) {
      const lastBeat = new Date(inst.last_heartbeat).getTime();
      const elapsed = now - lastBeat;

      if (inst.status === 'active' && elapsed > INSTANCE_STALE_MS) {
        stmts.updateInstanceStatus.run('stale', inst.instance_id);
        inst.status = 'stale';
        logger.warn({ instanceId: inst.instance_id, scope: inst.scope }, 'Instance marked stale');
      }

      if (inst.status !== 'dead' && elapsed > INSTANCE_DEAD_MS) {
        stmts.updateInstanceStatus.run('dead', inst.instance_id);
        inst.status = 'dead';
        logger.warn({ instanceId: inst.instance_id, scope: inst.scope }, 'Instance marked dead');
      }
    }

    // Remove dead instances and their assignments to free up capacity
    const deadIds = allInstances
      .filter((inst) => inst.status === 'dead')
      .map((inst) => ({ instanceId: inst.instance_id, scope: inst.scope }));

    if (deadIds.length > 0) {
      const usedAt = new Date().toISOString();

      stmts.begin.run();
      try {
        for (const { instanceId, scope } of deadIds) {
          const instanceScope = `${scope}:${instanceId}`;
          stmts.deleteAssignmentsByInstanceScope.run(instanceScope);
          stmts.deleteInstance.run(instanceId);
          logger.info({ instanceId, scope }, 'Dead instance removed');

          // Invalidate pending tickets for this dead instance.
          const ticketRows = stmts.selectTicketsByInstance.all(instanceId);
          for (const tr of ticketRows) {
            if (tr.used === 0) {
              stmts.markTicketUsed.run(usedAt, tr.index_hash);
            }
          }

          // Kill active sessions for this dead instance.
          const sessionRows = stmts.selectSessionsByInstance.all(instanceId);
          for (const sr of sessionRows) {
            if (sr.status !== 'dead') {
              stmts.killSessionStmt.run('system', new Date().toISOString(), sr.session_id);
            }
          }
        }
        stmts.commit.run();
      } catch (err) {
        stmts.rollback.run();
        throw err;
      }
    }
  });
}
