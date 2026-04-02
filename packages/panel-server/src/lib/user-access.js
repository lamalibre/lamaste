import crypto from 'node:crypto';
import { readFile, writeFile, rename, open, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = process.env.PORTLAMA_DATA_DIR || '/etc/portlama';
const STATE_PATH = path.join(DATA_DIR, 'user-plugin-access.json');

/**
 * OTP token expiry (60 seconds).
 */
const OTP_EXPIRY_MS = 60 * 1000;

/**
 * Stale OTP cleanup threshold (5 minutes).
 */
const OTP_CLEANUP_MS = 5 * 60 * 1000;

/**
 * Hard cap on active (unused) OTP tokens to prevent DoS.
 */
const MAX_ACTIVE_OTPS = 50;

/**
 * Hard cap on active grants to prevent Authelia config DoS.
 */
const MAX_ACTIVE_GRANTS = 200;

/**
 * Consumed grant retention (90 days). Older consumed grants are pruned for cleanup.
 */
const GRANT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Promise-chain mutex to serialize state file operations.
 */
let accessLock = Promise.resolve();
function withAccessLock(fn) {
  const prev = accessLock;
  let resolve;
  accessLock = new Promise((r) => {
    resolve = r;
  });
  return prev.then(fn).finally(resolve);
}

/**
 * Per-process random key for HMAC-based timing-safe comparison.
 * HMAC both values to get fixed-length digests, avoiding length-leak
 * in timingSafeEqual (same pattern as tickets.js).
 */
const COMPARE_KEY = crypto.randomBytes(32);

/**
 * Timing-safe token comparison using HMAC digests.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHmac('sha256', COMPARE_KEY).update(a).digest();
  const hb = crypto.createHmac('sha256', COMPARE_KEY).update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Load state from disk.
 *
 * @returns {Promise<{ grants: Array, otpTokens: Array }>}
 */
async function loadState() {
  try {
    const raw = await readFile(STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      grants: Array.isArray(parsed.grants) ? parsed.grants : [],
      otpTokens: Array.isArray(parsed.otpTokens) ? parsed.otpTokens : [],
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { grants: [], otpTokens: [] };
    }
    throw new Error(`Failed to read user-plugin-access state: ${err.message}`);
  }
}

/**
 * Atomically save state to disk (tmp → fsync → rename).
 *
 * @param {{ grants: Array, otpTokens: Array }} state
 */
async function saveState(state) {
  // Ensure data directory exists
  await mkdir(path.dirname(STATE_PATH), { recursive: true });

  const tmpPath = `${STATE_PATH}.tmp`;
  const content = JSON.stringify(state, null, 2) + '\n';
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });

  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();

  await rename(tmpPath, STATE_PATH);
}

/**
 * Remove expired OTP tokens.
 *
 * @param {Array} tokens
 * @returns {Array}
 */
function cleanExpiredOTPs(tokens) {
  const cutoff = Date.now() - OTP_CLEANUP_MS;
  return tokens.filter((t) => new Date(t.createdAt).getTime() > cutoff);
}

/**
 * Remove consumed grants older than the retention period.
 *
 * @param {Array} grants
 * @returns {Array}
 */
function cleanOldGrants(grants) {
  const cutoff = Date.now() - GRANT_RETENTION_MS;
  return grants.filter(
    (g) => !g.used || new Date(g.usedAt || g.createdAt).getTime() > cutoff,
  );
}

// --- Grant CRUD ---

/**
 * Create a user-plugin access grant.
 *
 * @param {string} username - Authelia username
 * @param {string} pluginName - Plugin package name (e.g. "@lamalibre/herd-server")
 * @param {import('pino').Logger} logger
 * @param {{ target?: string }} [options]
 * @returns {Promise<{ grantId: string, username: string, pluginName: string, target: string, createdAt: string }>}
 */
export function createGrant(username, pluginName, logger, { target = 'local' } = {}) {
  return withAccessLock(async () => {
    const state = await loadState();

    // Lazily clean old consumed grants
    state.grants = cleanOldGrants(state.grants);

    // Enforce hard cap on active grants (DoS protection for Authelia config)
    if (state.grants.length >= MAX_ACTIVE_GRANTS) {
      throw Object.assign(new Error('Too many active grants'), { statusCode: 503 });
    }

    const grantId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    // Agent-side grants are immediately active (browser access, no enrollment)
    const isAgentTarget = target.startsWith('agent:');

    const grant = {
      grantId,
      username,
      pluginName,
      target,
      used: isAgentTarget,
      createdAt,
      usedAt: isAgentTarget ? createdAt : null,
    };

    state.grants.push(grant);
    await saveState(state);
    logger.info({ grantId, username, pluginName, target }, 'Created user plugin access grant');

    return { grantId, username, pluginName, target, used: grant.used, createdAt, usedAt: grant.usedAt };
  });
}

/**
 * List all grants.
 *
 * @returns {Promise<Array>}
 */
export function listGrants() {
  return withAccessLock(async () => {
    const state = await loadState();
    return state.grants;
  });
}

/**
 * List grants for a specific user.
 *
 * @param {string} username
 * @returns {Promise<Array>}
 */
export function listGrantsForUser(username) {
  return withAccessLock(async () => {
    const state = await loadState();
    return state.grants.filter((g) => g.username === username);
  });
}

/**
 * Revoke a grant. Local grants can only be revoked if unused; agent-side
 * grants can always be revoked (they are auto-consumed on creation).
 *
 * @param {string} grantId
 * @param {import('pino').Logger} logger
 * @returns {Promise<{ ok: boolean, grant: object }>}
 */
export function revokeGrant(grantId, logger) {
  return withAccessLock(async () => {
    const state = await loadState();
    const idx = state.grants.findIndex((g) => g.grantId === grantId);

    if (idx === -1) {
      throw Object.assign(new Error('Grant not found'), { statusCode: 404 });
    }

    const grant = state.grants[idx];
    const isAgentTarget = (grant.target || 'local').startsWith('agent:');

    // Local grants cannot be revoked after consumption; agent grants can
    // always be revoked because they are auto-consumed on creation.
    if (grant.used && !isAgentTarget) {
      throw Object.assign(new Error('Cannot revoke a consumed grant'), { statusCode: 409 });
    }

    state.grants.splice(idx, 1);
    await saveState(state);
    logger.info({ grantId, target: grant.target }, 'Revoked user plugin access grant');

    return { ok: true, grant };
  });
}

/**
 * Consume a grant (mark as used). Returns the grant data.
 *
 * @param {string} grantId
 * @param {string} username - Must match the grant's username (authorization check)
 * @param {import('pino').Logger} logger
 * @returns {Promise<{ grantId: string, username: string, pluginName: string }>}
 */
export function consumeGrant(grantId, username, logger) {
  return withAccessLock(async () => {
    const state = await loadState();
    const grant = state.grants.find((g) => g.grantId === grantId);

    if (!grant) {
      throw Object.assign(new Error('Invalid grant'), { statusCode: 401 });
    }

    // Authorization: only the grant owner can consume it
    if (grant.username !== username) {
      throw Object.assign(new Error('Invalid grant'), { statusCode: 401 });
    }

    if (grant.used) {
      throw Object.assign(new Error('Invalid grant'), { statusCode: 401 });
    }

    grant.used = true;
    grant.usedAt = new Date().toISOString();

    await saveState(state);
    logger.info({ grantId, username, pluginName: grant.pluginName }, 'Consumed user plugin access grant');

    return {
      grantId: grant.grantId,
      username: grant.username,
      pluginName: grant.pluginName,
    };
  });
}

// --- OTP tokens ---

/**
 * Create a one-time password for the OAuth-like authorize/exchange flow.
 *
 * @param {string} username - Authelia username from Remote-User header
 * @param {import('pino').Logger} logger
 * @returns {Promise<{ token: string, expiresAt: string }>}
 */
export function createOTP(username, logger) {
  return withAccessLock(async () => {
    const state = await loadState();

    // Clean expired OTPs lazily
    state.otpTokens = cleanExpiredOTPs(state.otpTokens);

    // Enforce hard cap on active OTP tokens (DoS protection)
    const activeCount = state.otpTokens.filter((t) => !t.used).length;
    if (activeCount >= MAX_ACTIVE_OTPS) {
      throw Object.assign(new Error('Too many pending login attempts'), { statusCode: 503 });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS).toISOString();

    state.otpTokens.push({
      token,
      username,
      createdAt,
      expiresAt,
      used: false,
    });

    await saveState(state);
    logger.info({ username }, 'Created user access OTP');

    return { token, expiresAt };
  });
}

/**
 * Validate and consume a one-time password.
 * Uses timing-safe comparison and mutex serialization.
 *
 * @param {string} token
 * @returns {Promise<{ username: string }>}
 */
export function validateAndConsumeOTP(token) {
  return withAccessLock(async () => {
    const state = await loadState();

    // Clean expired OTPs lazily
    state.otpTokens = cleanExpiredOTPs(state.otpTokens);

    // Timing-safe comparison
    const entry = state.otpTokens.find((t) => safeCompare(t.token, token));

    if (!entry) {
      throw Object.assign(new Error('Invalid or expired token'), { statusCode: 401 });
    }

    if (entry.used) {
      throw Object.assign(new Error('Invalid or expired token'), { statusCode: 401 });
    }

    if (new Date(entry.expiresAt).getTime() < Date.now()) {
      throw Object.assign(new Error('Invalid or expired token'), { statusCode: 401 });
    }

    entry.used = true;
    entry.usedAt = new Date().toISOString();

    await saveState(state);

    return { username: entry.username };
  });
}
