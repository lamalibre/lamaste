import crypto from 'node:crypto';
import { readFile, writeFile, rename, open } from 'node:fs/promises';
import path from 'node:path';
import { loadAgentRegistry } from './mtls.js';

const PKI_DIR = process.env.PORTLAMA_PKI_DIR || '/etc/portlama/pki';
const TOKENS_PATH = path.join(PKI_DIR, 'enrollment-tokens.json');

/**
 * Token expiry for enrollment (10 minutes).
 */
const TOKEN_EXPIRY_MS = 10 * 60 * 1000;

/**
 * Stale token cleanup threshold (1 hour).
 */
const CLEANUP_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * Promise-chain mutex to serialize token file operations,
 * preventing race conditions on concurrent token creation/consumption.
 */
let tokenLock = Promise.resolve();
function withTokenLock(fn) {
  const prev = tokenLock;
  let resolve;
  tokenLock = new Promise((r) => {
    resolve = r;
  });
  return prev.then(fn).finally(resolve);
}

/**
 * Timing-safe token comparison.
 * Uses crypto.timingSafeEqual to prevent timing side-channel attacks
 * on the enrollment token (the sole auth gate for the public endpoint).
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeTokenCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Load enrollment tokens from disk.
 * Returns an empty array if the file does not exist.
 *
 * @returns {Promise<Array>}
 */
async function loadTokens() {
  try {
    const raw = await readFile(TOKENS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tokens)) {
      return [];
    }
    return parsed.tokens;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw new Error(`Failed to read enrollment tokens: ${err.message}`);
  }
}

/**
 * Atomically save enrollment tokens to disk.
 * Writes to a temp file with restrictive permissions, fsyncs, then renames.
 *
 * @param {Array} tokens
 */
async function saveTokens(tokens) {
  const tmpPath = `${TOKENS_PATH}.tmp`;
  const content = JSON.stringify({ tokens }, null, 2) + '\n';
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });

  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();

  await rename(tmpPath, TOKENS_PATH);
}

/**
 * Remove tokens that are older than the cleanup threshold.
 *
 * @param {Array} tokens
 * @returns {Array} Cleaned token list
 */
function cleanExpiredTokens(tokens) {
  const cutoff = Date.now() - CLEANUP_THRESHOLD_MS;
  return tokens.filter((t) => new Date(t.createdAt).getTime() > cutoff);
}

/**
 * Create a one-time enrollment token for agent certificate enrollment.
 *
 * Validates that no duplicate active (non-revoked) agent label exists in the
 * registry. Generates a cryptographically random token with a 10-minute expiry.
 *
 * @param {string} label - Agent label (e.g. "macbook-pro")
 * @param {string[]} capabilities - Capability list
 * @param {string[]} allowedSites - Allowed site labels
 * @param {import('pino').Logger} logger
 * @returns {Promise<{ token: string, label: string, expiresAt: string }>}
 */
export async function createEnrollmentToken(label, capabilities, allowedSites, logger) {
  return withTokenLock(async () => {
    // Check registry for duplicate (non-revoked) label
    const registry = await loadAgentRegistry();
    const existing = registry.agents.find((a) => a.label === label && !a.revoked);
    if (existing) {
      throw Object.assign(new Error(`Agent certificate with label "${label}" already exists`), {
        statusCode: 409,
      });
    }

    let tokens = await loadTokens();

    // Clean expired tokens lazily
    tokens = cleanExpiredTokens(tokens);

    // Check for an active (unused, unexpired) token with the same label
    const now = Date.now();
    const activeToken = tokens.find(
      (t) => t.label === label && !t.used && new Date(t.expiresAt).getTime() > now,
    );
    if (activeToken) {
      throw Object.assign(
        new Error(`An active enrollment token for label "${label}" already exists`),
        { statusCode: 409 },
      );
    }

    const token = crypto.randomBytes(32).toString('hex');
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString();

    tokens.push({
      token,
      label,
      capabilities,
      allowedSites,
      createdAt,
      expiresAt,
      used: false,
    });

    await saveTokens(tokens);
    logger.info({ label, expiresAt }, 'Created enrollment token');

    return { token, label, expiresAt };
  });
}

/**
 * Validate and consume a one-time enrollment token.
 *
 * Finds the token using timing-safe comparison, verifies it is not used
 * and not expired, marks it as used, saves atomically, and returns the
 * associated enrollment data. Serialized via mutex to prevent TOCTOU races.
 *
 * @param {string} token - The enrollment token to validate
 * @returns {Promise<{ label: string, capabilities: string[], allowedSites: string[] }>}
 */
export async function validateAndConsumeToken(token) {
  return withTokenLock(async () => {
    let tokens = await loadTokens();

    // Clean expired tokens lazily
    tokens = cleanExpiredTokens(tokens);

    // Timing-safe comparison to prevent side-channel attacks on the token
    const entry = tokens.find((t) => safeTokenCompare(t.token, token));

    if (!entry) {
      throw Object.assign(new Error('Invalid enrollment token'), { statusCode: 401 });
    }

    if (entry.used) {
      throw Object.assign(new Error('Enrollment token has already been used'), { statusCode: 401 });
    }

    if (new Date(entry.expiresAt).getTime() < Date.now()) {
      throw Object.assign(new Error('Enrollment token has expired'), { statusCode: 401 });
    }

    // Mark as used
    entry.used = true;
    entry.usedAt = new Date().toISOString();

    await saveTokens(tokens);

    return {
      label: entry.label,
      capabilities: entry.capabilities,
      allowedSites: entry.allowedSites,
    };
  });
}
