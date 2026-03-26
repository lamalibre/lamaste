import crypto from 'node:crypto';
import { readFile, writeFile, rename, open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  setTicketScopeCapabilitiesOnMtls,
  loadAgentRegistry,
} from './mtls.js';
import { RESERVED_API_PREFIXES } from './constants.js';

const STATE_DIR = process.env.PORTLAMA_STATE_DIR || '/etc/portlama';
const SCOPES_PATH = path.join(STATE_DIR, 'ticket-scopes.json');
const TICKETS_PATH = path.join(STATE_DIR, 'tickets.json');

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
// Single lock for both scope registry and ticket store to prevent deadlock.
// Contention is low (admin + agent API calls), so a single lock is simplest.
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

const CapabilityStringSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(
    /^[a-z0-9-]+:[a-z0-9-]+$/,
    'Must follow scope:action format',
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
  target: z.string().min(1).max(100),
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
  instanceScope: z.string().min(1).max(200).regex(/^[a-z0-9-]+:[a-z0-9-]+:[a-f0-9]+$/),
});

// --- Scope registry persistence ---

async function loadScopeRegistry() {
  try {
    const raw = await readFile(SCOPES_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes : [],
      instances: Array.isArray(parsed.instances) ? parsed.instances : [],
      assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [],
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { scopes: [], instances: [], assignments: [] };
    }
    throw new Error(`Failed to read ticket scope registry: ${err.message}`);
  }
}

async function saveScopeRegistry(data) {
  const tmpPath = `${SCOPES_PATH}.tmp`;
  const content = JSON.stringify(data, null, 2) + '\n';
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });

  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();

  await rename(tmpPath, SCOPES_PATH);
}

// --- Ticket storage persistence ---

async function loadTicketStore() {
  try {
    const raw = await readFile(TICKETS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { tickets: [], sessions: [] };
    }
    throw new Error(`Failed to read ticket store: ${err.message}`);
  }
}

async function saveTicketStore(data) {
  const tmpPath = `${TICKETS_PATH}.tmp`;
  const content = JSON.stringify(data, null, 2) + '\n';
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });

  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();

  await rename(tmpPath, TICKETS_PATH);
}

function cleanTickets(store) {
  const prevTickets = store.tickets.length;
  const prevSessions = store.sessions.length;
  const now = Date.now();
  const cutoff = now - TICKET_CLEANUP_MS;
  store.tickets = store.tickets.filter(
    (t) => new Date(t.createdAt).getTime() > cutoff,
  );
  // Mark stale sessions as dead (no heartbeat for SESSION_STALE_MS)
  for (const session of store.sessions) {
    if (session.status !== 'dead' && (now - new Date(session.lastActivityAt).getTime()) > SESSION_STALE_MS) {
      session.status = 'dead';
      session.terminatedBy = 'system';
      session.terminatedAt = new Date().toISOString();
    }
  }
  const sessionCutoff = now - SESSION_CLEANUP_MS;
  store.sessions = store.sessions.filter(
    (s) => s.status !== 'dead' || new Date(s.createdAt).getTime() > sessionCutoff,
  );
  return store.tickets.length !== prevTickets || store.sessions.length !== prevSessions;
}

// --- Timing-safe comparison ---

// Per-process random key prevents pre-computation if source is read
const COMPARE_KEY = crypto.randomBytes(32);

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // HMAC both values to get fixed-length digests, avoiding length-leak in timingSafeEqual.
  const ha = crypto.createHmac('sha256', COMPARE_KEY).update(a).digest();
  const hb = crypto.createHmac('sha256', COMPARE_KEY).update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
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
  const registry = await loadScopeRegistry();
  const caps = [];
  for (const scope of registry.scopes) {
    for (const s of scope.scopes) {
      caps.push(s.name);
    }
  }
  setTicketScopeCapabilitiesOnMtls([...new Set(caps)]);
}

export async function loadTicketScopeCapabilities() {
  await refreshTicketScopeCapabilities();
}

// --- Scope management ---

export function registerScope(body, logger) {
  return withTicketLock(async () => {
    const registry = await loadScopeRegistry();

    const existing = registry.scopes.find((s) => s.name === body.name);
    if (existing) {
      throw Object.assign(
        new Error(`Ticket scope "${body.name}" is already registered`),
        { statusCode: 409 },
      );
    }

    const entry = {
      ...body,
      hooks: {},
      installedAt: new Date().toISOString(),
    };

    registry.scopes.push(entry);
    await saveScopeRegistry(registry);

    await refreshTicketScopeCapabilities();

    const registered = body.scopes.map((s) => s.name);
    logger.info({ name: body.name, registered }, 'Ticket scope registered');
    return { ok: true, registered };
  });
}

export function listScopes() {
  return withTicketLock(async () => {
    const registry = await loadScopeRegistry();
    return registry;
  });
}

export function unregisterScope(name, logger) {
  return withTicketLock(async () => {
    const registry = await loadScopeRegistry();
    const index = registry.scopes.findIndex((s) => s.name === name);

    if (index === -1) {
      throw Object.assign(
        new Error(`Ticket scope "${name}" not found`),
        { statusCode: 404 },
      );
    }

    const scope = registry.scopes[index];
    const scopeNames = scope.scopes.map((s) => s.name);

    // Remove instances for this scope
    registry.instances = registry.instances.filter(
      (inst) => !scopeNames.includes(inst.scope),
    );

    // Remove assignments for this scope
    registry.assignments = registry.assignments.filter(
      (a) => !scopeNames.some((sn) => a.instanceScope.startsWith(`${sn}:`)),
    );

    registry.scopes.splice(index, 1);
    await saveScopeRegistry(registry);

    // Invalidate active tickets for removed scopes (already under lock)
    const store = await loadTicketStore();
    for (const ticket of store.tickets) {
      if (scopeNames.includes(ticket.scope) && !ticket.used) {
        ticket.used = true;
        ticket.usedAt = new Date().toISOString();
      }
    }
    await saveTicketStore(store);

    await refreshTicketScopeCapabilities();

    logger.info({ name }, 'Ticket scope unregistered');
    return { ok: true, name };
  });
}

// --- Instance management ---

export function registerInstance(scope, transport, agentLabel, logger) {
  return withTicketLock(async () => {
    const registry = await loadScopeRegistry();

    // Verify scope exists
    let scopeEntry = null;
    for (const s of registry.scopes) {
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
    const existingIndex = registry.instances.findIndex(
      (inst) => inst.scope === scope && inst.agentLabel === agentLabel,
    );

    if (existingIndex !== -1) {
      // Re-register: update transport and heartbeat
      const existing = registry.instances[existingIndex];
      existing.transport = transport;
      existing.lastHeartbeat = new Date().toISOString();
      existing.status = 'active';
      await saveScopeRegistry(registry);

      logger.info({ scope, agentLabel, instanceId: existing.instanceId }, 'Instance re-registered');
      return {
        ok: true,
        instanceId: existing.instanceId,
        instanceScope: `${scope}:${existing.instanceId}`,
        isReregistration: true,
      };
    }

    // New registration — enforce hard cap
    if (registry.instances.length >= MAX_INSTANCES) {
      throw Object.assign(new Error('Instance limit reached'), { statusCode: 503 });
    }

    const instanceId = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();

    const instance = {
      scope,
      instanceId,
      agentLabel,
      registeredAt: now,
      lastHeartbeat: now,
      status: 'active',
      transport,
    };

    registry.instances.push(instance);
    await saveScopeRegistry(registry);

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
    const registry = await loadScopeRegistry();
    const index = registry.instances.findIndex((inst) => inst.instanceId === instanceId);

    if (index === -1) {
      throw Object.assign(new Error('Instance not found'), { statusCode: 404 });
    }

    const instance = registry.instances[index];

    // Only the owning agent or admin can deregister (return 404 to avoid leaking existence)
    if (callerRole !== 'admin' && callerLabel !== instance.agentLabel) {
      throw Object.assign(new Error('Instance not found'), { statusCode: 404 });
    }

    // Remove assignments for this instance
    const instanceScope = `${instance.scope}:${instanceId}`;
    registry.assignments = registry.assignments.filter(
      (a) => a.instanceScope !== instanceScope,
    );

    registry.instances.splice(index, 1);
    await saveScopeRegistry(registry);

    // Invalidate pending tickets and kill active sessions for this instance
    const store = await loadTicketStore();
    for (const ticket of store.tickets) {
      if (ticket.instanceId === instanceId && !ticket.used) {
        ticket.used = true;
        ticket.usedAt = new Date().toISOString();
      }
    }
    for (const session of store.sessions) {
      if (session.instanceId === instanceId && session.status !== 'dead') {
        session.status = 'dead';
        session.terminatedBy = 'system';
        session.terminatedAt = new Date().toISOString();
      }
    }
    await saveTicketStore(store);

    logger.info({ instanceId, scope: instance.scope }, 'Instance deregistered');
    return { ok: true, instanceId };
  });
}

export function instanceHeartbeat(instanceId, agentLabel) {
  return withTicketLock(async () => {
    const registry = await loadScopeRegistry();
    const instance = registry.instances.find(
      (inst) => inst.instanceId === instanceId && inst.agentLabel === agentLabel,
    );

    if (!instance) {
      throw Object.assign(new Error('Instance not found'), { statusCode: 404 });
    }

    // Verify agent still has the scope capability
    const agentRegistry = await loadAgentRegistry();
    const agent = agentRegistry.agents.find((a) => a.label === agentLabel && !a.revoked);
    if (!agent) {
      throw Object.assign(new Error('Instance not found'), { statusCode: 404 });
    }
    const agentCaps = agent.capabilities || ['tunnels:read'];
    if (!agentCaps.includes(instance.scope)) {
      throw Object.assign(new Error('Instance not found'), { statusCode: 404 });
    }

    instance.lastHeartbeat = new Date().toISOString();
    instance.status = 'active';
    await saveScopeRegistry(registry);

    return { ok: true };
  });
}

// --- Instance assignment ---

export function createAssignment(agentLabel, instanceScope, logger) {
  return withTicketLock(async () => {
    const registry = await loadScopeRegistry();

    // Parse instanceScope: "shell:connect:a7f3b2c9d1e2f3a4"
    const parts = instanceScope.match(/^([a-z0-9-]+:[a-z0-9-]+):([a-f0-9]+)$/);
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

    // Verify agent has the base capability
    const agentCaps = agent.capabilities || ['tunnels:read'];
    if (!agentCaps.includes(baseScope)) {
      throw Object.assign(
        new Error(`Agent "${agentLabel}" lacks capability "${baseScope}"`),
        { statusCode: 400 },
      );
    }

    // Verify instance exists and is active
    const instance = registry.instances.find(
      (inst) => inst.instanceId === instanceId && inst.scope === baseScope,
    );
    if (!instance || instance.status === 'dead') {
      throw Object.assign(new Error('Instance not found or not active'), { statusCode: 404 });
    }

    // Check for duplicate assignment
    const existing = registry.assignments.find(
      (a) => a.agentLabel === agentLabel && a.instanceScope === instanceScope,
    );
    if (existing) {
      return { ok: true, assignment: existing, isExisting: true };
    }

    const assignment = {
      agentLabel,
      instanceScope,
      assignedAt: new Date().toISOString(),
      assignedBy: 'admin',
    };

    registry.assignments.push(assignment);
    await saveScopeRegistry(registry);

    logger.info({ agentLabel, instanceScope }, 'Assignment created');
    return { ok: true, assignment };
  });
}

export function removeAssignment(agentLabel, instanceScope, logger) {
  return withTicketLock(async () => {
    const registry = await loadScopeRegistry();
    const index = registry.assignments.findIndex(
      (a) => a.agentLabel === agentLabel && a.instanceScope === instanceScope,
    );

    if (index === -1) {
      throw Object.assign(new Error('Assignment not found'), { statusCode: 404 });
    }

    registry.assignments.splice(index, 1);
    await saveScopeRegistry(registry);

    logger.info({ agentLabel, instanceScope }, 'Assignment removed');
    return { ok: true };
  });
}

export function listAssignments(filters) {
  return withTicketLock(async () => {
    const registry = await loadScopeRegistry();
    let { assignments } = registry;

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
    // Rate limit
    checkRateLimit(sourceLabel);

    const store = await loadTicketStore();
    cleanTickets(store);

    // Load scope registry (read-only, no lock needed since we have ticketsLock)
    const registry = await loadScopeRegistry();

    // Stage 1: Verify source agent has the base capability
    const agentRegistry = await loadAgentRegistry();
    const sourceAgent = agentRegistry.agents.find((a) => a.label === sourceLabel && !a.revoked);
    if (!sourceAgent) {
      throw Object.assign(new Error('Not found'), { statusCode: 404 });
    }
    const sourceCaps = sourceAgent.capabilities || ['tunnels:read'];
    if (!sourceCaps.includes(scope)) {
      throw Object.assign(new Error('Not found'), { statusCode: 404 });
    }

    // Stage 1: Verify target agent has the base capability
    const targetAgent = agentRegistry.agents.find((a) => a.label === target && !a.revoked);
    if (!targetAgent) {
      throw Object.assign(new Error('Not found'), { statusCode: 404 });
    }
    const targetCaps = targetAgent.capabilities || ['tunnels:read'];
    if (!targetCaps.includes(scope)) {
      throw Object.assign(new Error('Not found'), { statusCode: 404 });
    }

    // Stage 2: Verify source owns the instance
    const instance = registry.instances.find(
      (inst) => inst.instanceId === instanceId && inst.scope === scope,
    );
    if (!instance || instance.agentLabel !== sourceLabel) {
      throw Object.assign(new Error('Not found'), { statusCode: 404 });
    }

    // Check instance status
    if (instance.status === 'stale') {
      throw Object.assign(new Error('Instance is stale'), { statusCode: 503 });
    }
    if (instance.status === 'dead') {
      throw Object.assign(new Error('Not found'), { statusCode: 404 });
    }

    // Reject self-tickets (source cannot also be the target)
    if (sourceLabel === target) {
      throw Object.assign(new Error('Not found'), { statusCode: 404 });
    }

    // Stage 3: Verify target is assigned to this instance
    const instanceScope = `${scope}:${instanceId}`;
    const assignment = registry.assignments.find(
      (a) => a.agentLabel === target && a.instanceScope === instanceScope,
    );
    if (!assignment) {
      throw Object.assign(new Error('Not found'), { statusCode: 404 });
    }

    // Enforce ticket cap
    if (store.tickets.length >= MAX_TICKETS) {
      throw Object.assign(new Error('Ticket limit reached'), { statusCode: 503 });
    }

    // Create ticket
    const ticketId = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TICKET_EXPIRY_MS);

    const ticket = {
      id: ticketId,
      scope,
      instanceId,
      source: sourceLabel,
      target,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      used: false,
      usedAt: null,
      sessionId: null,
      transport: instance.transport,
    };

    store.tickets.push(ticket);
    await saveTicketStore(store);

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
      },
    };
  });
}

export function getTicketInbox(agentLabel) {
  return withTicketLock(async () => {
    const store = await loadTicketStore();
    const now = Date.now();

    const tickets = store.tickets.filter(
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

export function validateTicket(ticketId, callerLabel) {
  return withTicketLock(async () => {
    const store = await loadTicketStore();
    cleanTickets(store);

    const ticket = store.tickets.find((t) => safeCompare(t.id, ticketId));

    if (!ticket) {
      throw Object.assign(new Error('Invalid ticket'), { statusCode: 401 });
    }

    if (ticket.used) {
      throw Object.assign(new Error('Invalid ticket'), { statusCode: 401 });
    }

    if (new Date(ticket.expiresAt).getTime() < Date.now()) {
      throw Object.assign(new Error('Invalid ticket'), { statusCode: 401 });
    }

    if (ticket.target !== callerLabel) {
      throw Object.assign(new Error('Invalid ticket'), { statusCode: 401 });
    }

    // Mark as used atomically
    ticket.used = true;
    ticket.usedAt = new Date().toISOString();
    await saveTicketStore(store);

    return {
      valid: true,
      scope: ticket.scope,
      instanceId: ticket.instanceId,
      source: ticket.source,
      target: ticket.target,
      transport: ticket.transport,
    };
  });
}

export function listTickets() {
  return withTicketLock(async () => {
    const store = await loadTicketStore();
    const changed = cleanTickets(store);
    if (changed) await saveTicketStore(store);
    // Admin is fully trusted (mTLS admin cert) — return full IDs so revoke works
    return { tickets: store.tickets };
  });
}

export function revokeTicket(ticketId, logger) {
  return withTicketLock(async () => {
    const store = await loadTicketStore();
    const ticket = store.tickets.find((t) => safeCompare(t.id, ticketId));

    if (!ticket) {
      throw Object.assign(new Error('Ticket not found'), { statusCode: 404 });
    }

    if (!ticket.used) {
      ticket.used = true;
      ticket.usedAt = new Date().toISOString();
    }

    // If the ticket had a session, mark it for termination
    if (ticket.sessionId) {
      const session = store.sessions.find((s) => s.sessionId === ticket.sessionId);
      if (session && session.status !== 'dead') {
        session.status = 'dead';
        session.terminatedBy = 'admin';
        session.terminatedAt = new Date().toISOString();
      }
    }

    await saveTicketStore(store);
    logger.info({ ticketId: ticketId.slice(0, 8) }, 'Ticket revoked');
    return { ok: true };
  });
}

// --- Session management ---

export function createSession(ticketId, callerLabel, logger) {
  return withTicketLock(async () => {
    const store = await loadTicketStore();

    const ticket = store.tickets.find((t) => safeCompare(t.id, ticketId));
    if (!ticket || !ticket.used || ticket.target !== callerLabel) {
      throw Object.assign(new Error('Invalid ticket'), { statusCode: 400 });
    }

    // Prevent duplicate sessions for the same ticket
    if (ticket.sessionId) {
      throw Object.assign(new Error('Session already exists for this ticket'), { statusCode: 409 });
    }

    // Enforce session cap
    if (store.sessions.filter((s) => s.status !== 'dead').length >= MAX_SESSIONS) {
      throw Object.assign(new Error('Session limit reached'), { statusCode: 503 });
    }

    // Generate session ID server-side for uniqueness guarantee
    const sessionId = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const session = {
      sessionId,
      ticketId,
      scope: ticket.scope,
      instanceId: ticket.instanceId,
      source: ticket.source,
      target: ticket.target,
      createdAt: now,
      lastActivityAt: now,
      status: 'active',
      reconnectGraceSeconds: 60,
    };

    ticket.sessionId = sessionId;
    store.sessions.push(session);
    await saveTicketStore(store);

    logger.info({ sessionId, ticketId: ticketId.slice(0, 8), scope: ticket.scope }, 'Session created');
    return { ok: true, session };
  });
}

export function sessionHeartbeat(sessionId, callerLabel) {
  return withTicketLock(async () => {
    const store = await loadTicketStore();
    const session = store.sessions.find(
      (s) => s.sessionId === sessionId && s.target === callerLabel,
    );

    if (!session) {
      throw Object.assign(new Error('Session not found'), { statusCode: 404 });
    }

    if (session.status === 'dead') {
      return { authorized: false, reason: 'admin_killed' };
    }

    // Re-validate authorization
    const agentRegistry = await loadAgentRegistry();

    // Check source cert is not revoked
    const sourceAgent = agentRegistry.agents.find((a) => a.label === session.source);
    if (!sourceAgent || sourceAgent.revoked) {
      session.status = 'dead';
      session.terminatedBy = 'system';
      session.terminatedAt = new Date().toISOString();
      await saveTicketStore(store);
      return { authorized: false, reason: 'source_revoked' };
    }

    // Check source still has capability
    const sourceCaps = sourceAgent.capabilities || ['tunnels:read'];
    if (!sourceCaps.includes(session.scope)) {
      session.status = 'dead';
      session.terminatedBy = 'system';
      session.terminatedAt = new Date().toISOString();
      await saveTicketStore(store);
      return { authorized: false, reason: 'capability_removed' };
    }

    // Check target agent still has capability (defense-in-depth)
    const targetAgent = agentRegistry.agents.find((a) => a.label === session.target);
    if (!targetAgent || targetAgent.revoked) {
      session.status = 'dead';
      session.terminatedBy = 'system';
      session.terminatedAt = new Date().toISOString();
      await saveTicketStore(store);
      return { authorized: false, reason: 'target_revoked' };
    }
    const targetCaps = targetAgent.capabilities || ['tunnels:read'];
    if (!targetCaps.includes(session.scope)) {
      session.status = 'dead';
      session.terminatedBy = 'system';
      session.terminatedAt = new Date().toISOString();
      await saveTicketStore(store);
      return { authorized: false, reason: 'capability_removed' };
    }

    // Check assignment still valid
    const scopeRegistry = await loadScopeRegistry();
    const instanceScope = `${session.scope}:${session.instanceId}`;
    const assignment = scopeRegistry.assignments.find(
      (a) => a.agentLabel === callerLabel && a.instanceScope === instanceScope,
    );
    if (!assignment) {
      session.status = 'dead';
      session.terminatedBy = 'system';
      session.terminatedAt = new Date().toISOString();
      await saveTicketStore(store);
      return { authorized: false, reason: 'assignment_removed' };
    }

    // All checks passed
    session.lastActivityAt = new Date().toISOString();
    await saveTicketStore(store);
    return { authorized: true };
  });
}

export function updateSession(sessionId, status, callerLabel) {
  return withTicketLock(async () => {
    const store = await loadTicketStore();
    const session = store.sessions.find(
      (s) => s.sessionId === sessionId && (s.target === callerLabel || s.source === callerLabel),
    );

    if (!session) {
      throw Object.assign(new Error('Session not found'), { statusCode: 404 });
    }

    // Prevent reactivation of admin-killed or system-terminated sessions
    if (session.status === 'dead') {
      throw Object.assign(new Error('Session is terminated'), { statusCode: 409 });
    }

    // Re-validate authorization on every status transition
    const agentRegistry = await loadAgentRegistry();

    // Check source cert is not revoked and still has capability
    const sourceAgent = agentRegistry.agents.find((a) => a.label === session.source);
    if (!sourceAgent || sourceAgent.revoked) {
      session.status = 'dead';
      session.terminatedBy = 'system';
      session.terminatedAt = new Date().toISOString();
      await saveTicketStore(store);
      throw Object.assign(new Error('Session is terminated'), { statusCode: 409 });
    }
    const sourceCaps = sourceAgent.capabilities || ['tunnels:read'];
    if (!sourceCaps.includes(session.scope)) {
      session.status = 'dead';
      session.terminatedBy = 'system';
      session.terminatedAt = new Date().toISOString();
      await saveTicketStore(store);
      throw Object.assign(new Error('Session is terminated'), { statusCode: 409 });
    }

    // Check target assignment is still valid (always check against target, not caller)
    const scopeRegistry = await loadScopeRegistry();
    const instanceScope = `${session.scope}:${session.instanceId}`;
    const assignment = scopeRegistry.assignments.find(
      (a) => a.agentLabel === session.target && a.instanceScope === instanceScope,
    );
    if (!assignment) {
      session.status = 'dead';
      session.terminatedBy = 'system';
      session.terminatedAt = new Date().toISOString();
      await saveTicketStore(store);
      throw Object.assign(new Error('Session is terminated'), { statusCode: 409 });
    }

    session.status = status;
    // Always set server-side timestamp to prevent clients from extending session lifetime
    session.lastActivityAt = new Date().toISOString();
    await saveTicketStore(store);

    return { ok: true };
  });
}

export function killSession(sessionId, logger) {
  return withTicketLock(async () => {
    const store = await loadTicketStore();
    const session = store.sessions.find((s) => s.sessionId === sessionId);

    if (!session) {
      throw Object.assign(new Error('Session not found'), { statusCode: 404 });
    }

    session.status = 'dead';
    session.terminatedBy = 'admin';
    session.terminatedAt = new Date().toISOString();
    await saveTicketStore(store);

    logger.info({ sessionId }, 'Session killed by admin');
    return { ok: true };
  });
}

export function listSessions() {
  return withTicketLock(async () => {
    const store = await loadTicketStore();
    const changed = cleanTickets(store);
    if (changed) await saveTicketStore(store);
    return { sessions: store.sessions };
  });
}

// --- Instance liveness check (call periodically) ---

export async function checkInstanceLiveness(logger) {
  return withTicketLock(async () => {
    const registry = await loadScopeRegistry();
    const now = Date.now();
    let changed = false;

    for (const instance of registry.instances) {
      const lastBeat = new Date(instance.lastHeartbeat).getTime();
      const elapsed = now - lastBeat;

      if (instance.status === 'active' && elapsed > INSTANCE_STALE_MS) {
        instance.status = 'stale';
        changed = true;
        logger.warn({ instanceId: instance.instanceId, scope: instance.scope }, 'Instance marked stale');
      }

      if (instance.status !== 'dead' && elapsed > INSTANCE_DEAD_MS) {
        instance.status = 'dead';
        changed = true;
        logger.warn({ instanceId: instance.instanceId, scope: instance.scope }, 'Instance marked dead');
      }
    }

    // Remove dead instances and their assignments to free up capacity
    const deadIds = registry.instances
      .filter((inst) => inst.status === 'dead')
      .map((inst) => ({ instanceId: inst.instanceId, scope: inst.scope }));

    if (deadIds.length > 0) {
      changed = true;
      registry.instances = registry.instances.filter((inst) => inst.status !== 'dead');
      for (const { instanceId, scope } of deadIds) {
        const instanceScope = `${scope}:${instanceId}`;
        registry.assignments = registry.assignments.filter(
          (a) => a.instanceScope !== instanceScope,
        );
        logger.info({ instanceId, scope }, 'Dead instance removed');
      }

      // Invalidate pending tickets and kill active sessions for dead instances
      const store = await loadTicketStore();
      const deadInstanceIds = new Set(deadIds.map((d) => d.instanceId));
      for (const ticket of store.tickets) {
        if (deadInstanceIds.has(ticket.instanceId) && !ticket.used) {
          ticket.used = true;
          ticket.usedAt = new Date().toISOString();
        }
      }
      for (const session of store.sessions) {
        if (deadInstanceIds.has(session.instanceId) && session.status !== 'dead') {
          session.status = 'dead';
          session.terminatedBy = 'system';
          session.terminatedAt = new Date().toISOString();
        }
      }
      await saveTicketStore(store);
    }

    // Save scope registry after ticket store — if crash occurs between writes,
    // liveness re-check will find dead instances still in registry and re-process them
    if (changed) {
      await saveScopeRegistry(registry);
    }
  });
}
