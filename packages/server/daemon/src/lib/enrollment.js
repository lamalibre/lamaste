import crypto from 'node:crypto';
import { loadAgentRegistry, PLUGIN_AGENT_CN_PREFIX, BASE_CAPABILITIES } from './mtls.js';
import { isRegisteredTicketScope } from './tickets.js';
import { getStateDb } from './state-db.js';

const TOKEN_EXPIRY_MS = 10 * 60 * 1000;
const CLEANUP_THRESHOLD_MS = 60 * 60 * 1000;

// Promise-chain mutex. Each operation is a single SQLite transaction so
// BEGIN IMMEDIATE already serialises writers — this lock is defensive
// belt-and-braces around the read-modify-write helpers below. Removable
// once each operation is collapsed into one transaction.
let tokenLock = Promise.resolve();
function withTokenLock(fn) {
  const prev = tokenLock;
  let resolve;
  tokenLock = new Promise((r) => {
    resolve = r;
  });
  return prev.then(fn).finally(resolve);
}

const COMPARE_KEY = crypto.randomBytes(32);

function safeTokenCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHmac('sha256', COMPARE_KEY).update(a).digest();
  const hb = crypto.createHmac('sha256', COMPARE_KEY).update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

let stmts = null;

async function getStmts() {
  if (stmts) return stmts;

  const db = await getStateDb();

  stmts = {
    selectActive: db.prepare(`
      SELECT * FROM enrollment_tokens
      WHERE used = 0 AND expires_at > ?
    `),
    insert: db.prepare(`
      INSERT INTO enrollment_tokens
        (token, label, capabilities, allowed_sites, type, delegated_by, scope, created_at, expires_at, used)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `),
    markUsed: db.prepare(`
      UPDATE enrollment_tokens SET used = 1, used_at = ? WHERE id = ?
    `),
    deleteActiveByLabel: db.prepare(`
      DELETE FROM enrollment_tokens
      WHERE label = ? AND used = 0 AND expires_at > ?
    `),
    deleteStale: db.prepare(`
      DELETE FROM enrollment_tokens WHERE created_at < ?
    `),
    begin: db.prepare('BEGIN IMMEDIATE'),
    commit: db.prepare('COMMIT'),
    rollback: db.prepare('ROLLBACK'),
  };

  return stmts;
}

function rowToEntry(row) {
  return {
    id: row.id,
    token: row.token,
    label: row.label,
    capabilities: JSON.parse(row.capabilities),
    allowedSites: JSON.parse(row.allowed_sites),
    type: row.type ?? undefined,
    delegatedBy: row.delegated_by ?? undefined,
    scope: row.scope ?? undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    used: row.used === 1,
    usedAt: row.used_at ?? undefined,
  };
}

function purgeStale() {
  const cutoff = new Date(Date.now() - CLEANUP_THRESHOLD_MS).toISOString();
  stmts.deleteStale.run(cutoff);
}

export async function createEnrollmentToken(label, capabilities, allowedSites, logger) {
  return withTokenLock(async () => {
    const registry = await loadAgentRegistry();
    const existing = registry.agents.find((a) => a.label === label && !a.revoked);
    if (existing) {
      throw Object.assign(new Error(`Agent certificate with label "${label}" already exists`), {
        statusCode: 409,
      });
    }

    await getStmts();
    purgeStale();

    const token = crypto.randomBytes(32).toString('hex');
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString();

    stmts.begin.run();
    try {
      // Replace any active (unused, unexpired) token for the same label so a
      // retried installation does not 409 on the create-token side.
      stmts.deleteActiveByLabel.run(label, new Date().toISOString());
      stmts.insert.run(
        token,
        label,
        JSON.stringify(capabilities),
        JSON.stringify(allowedSites),
        null,
        null,
        null,
        createdAt,
        expiresAt,
      );
      stmts.commit.run();
    } catch (err) {
      stmts.rollback.run();
      throw err;
    }

    logger.info({ label, expiresAt }, 'Created enrollment token');
    return { token, label, expiresAt };
  });
}

export async function validateAndConsumeToken(token) {
  return withTokenLock(async () => {
    await getStmts();
    purgeStale();

    // Linear scan over active tokens with timing-safe HMAC compare. SQLite
    // gives us O(log N) on indexed columns, but the timing-safe comparison
    // is the security-relevant part — an indexed lookup would leak which
    // candidate token was found via differential timing. Keep the scan.
    const rows = stmts.selectActive.all(new Date().toISOString());
    const entryRow = rows.find((r) => safeTokenCompare(r.token, token));

    if (!entryRow) {
      throw Object.assign(new Error('Invalid enrollment token'), { statusCode: 401 });
    }
    const entry = rowToEntry(entryRow);

    if (entry.used) {
      throw Object.assign(new Error('Enrollment token has already been used'), { statusCode: 401 });
    }
    if (new Date(entry.expiresAt).getTime() < Date.now()) {
      throw Object.assign(new Error('Enrollment token has expired'), { statusCode: 401 });
    }

    // For delegated tokens, re-check that the delegating agent is still valid.
    // The agent may have been revoked between token creation and consumption.
    if (entry.type === 'delegated' && entry.delegatedBy) {
      const registry = await loadAgentRegistry();
      const delegator = registry.agents.find((a) => a.label === entry.delegatedBy && !a.revoked);
      if (!delegator) {
        throw Object.assign(new Error('Invalid enrollment token'), { statusCode: 401 });
      }
    }

    stmts.markUsed.run(new Date().toISOString(), entry.id);

    /** @type {{ label: string, capabilities: string[], allowedSites: string[], type?: string, delegatedBy?: string, scope?: string }} */
    const result = {
      label: entry.label,
      capabilities: entry.capabilities,
      allowedSites: entry.allowedSites,
    };
    if (entry.type) result.type = entry.type;
    if (entry.delegatedBy) result.delegatedBy = entry.delegatedBy;
    if (entry.scope) result.scope = entry.scope;
    return result;
  });
}

export async function createDelegatedEnrollmentToken(
  delegatingLabel,
  scope,
  pluginAgentLabel,
  logger,
) {
  // Validate that the scope is a registered ticket scope, not a base capability.
  // Base capabilities (tunnels:read, services:write, etc.) must never be
  // delegated through enrollment — they are admin-assigned per-agent. These
  // checks run outside the token lock because scope validation is independent
  // of token operations and avoids nesting the ticket lock inside the token
  // lock.
  if (BASE_CAPABILITIES.includes(scope)) {
    throw Object.assign(new Error('Scope conflicts with a base capability'), {
      statusCode: 400,
    });
  }

  const isTicketScope = await isRegisteredTicketScope(scope);
  if (!isTicketScope) {
    throw Object.assign(new Error(`Scope "${scope}" is not a registered ticket scope`), {
      statusCode: 400,
    });
  }

  return withTokenLock(async () => {
    const registry = await loadAgentRegistry();
    const delegatingAgent = registry.agents.find((a) => a.label === delegatingLabel && !a.revoked);
    if (!delegatingAgent) {
      throw Object.assign(new Error(`Delegating agent "${delegatingLabel}" not found or revoked`), {
        statusCode: 404,
      });
    }

    const fullLabel = `${PLUGIN_AGENT_CN_PREFIX}${delegatingLabel}:${pluginAgentLabel}`;

    const existing = registry.agents.find((a) => a.label === fullLabel && !a.revoked);
    if (existing) {
      throw Object.assign(
        new Error(
          `Plugin agent certificate with label "${pluginAgentLabel}" for delegator "${delegatingLabel}" already exists`,
        ),
        { statusCode: 409 },
      );
    }

    await getStmts();
    purgeStale();

    const token = crypto.randomBytes(32).toString('hex');
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString();

    stmts.begin.run();
    try {
      stmts.deleteActiveByLabel.run(fullLabel, new Date().toISOString());
      stmts.insert.run(
        token,
        fullLabel,
        JSON.stringify([scope]),
        JSON.stringify([]),
        'delegated',
        delegatingLabel,
        scope,
        createdAt,
        expiresAt,
      );
      stmts.commit.run();
    } catch (err) {
      stmts.rollback.run();
      throw err;
    }

    logger.info(
      { delegatingLabel, pluginAgentLabel, scope, expiresAt },
      'Created delegated enrollment token',
    );
    return { token, pluginAgentLabel, expiresAt };
  });
}

export async function lookupToken(token) {
  return withTokenLock(async () => {
    await getStmts();
    purgeStale();

    const rows = stmts.selectActive.all(new Date().toISOString());
    const entryRow = rows.find((r) => safeTokenCompare(r.token, token));

    if (!entryRow) {
      throw Object.assign(new Error('Invalid enrollment token'), { statusCode: 401 });
    }
    const entry = rowToEntry(entryRow);

    if (entry.used) {
      throw Object.assign(new Error('Enrollment token has already been used'), { statusCode: 401 });
    }
    if (new Date(entry.expiresAt).getTime() < Date.now()) {
      throw Object.assign(new Error('Enrollment token has expired'), { statusCode: 401 });
    }

    /** @type {{ label: string, type?: string }} */
    const result = { label: entry.label };
    if (entry.type) result.type = entry.type;
    return result;
  });
}

export async function revokeEnrollmentToken(label, logger) {
  return withTokenLock(async () => {
    await getStmts();
    purgeStale();

    const result = stmts.deleteActiveByLabel.run(label, new Date().toISOString());
    const revoked = result.changes > 0;
    if (revoked) {
      logger.info({ label }, 'Revoked unused enrollment token');
    }
    return { revoked };
  });
}
