import crypto from 'node:crypto';
import { isIdentityUuid } from '@lamalibre/lamaste';

const SESSION_MAX_AGE = 12 * 60 * 60; // 12 hours in seconds
const INACTIVITY_TIMEOUT = 2 * 60 * 60; // 2 hours in seconds
const REFRESH_THRESHOLD = 60; // Only re-sign if lastActivity is older than 60s

export { SESSION_MAX_AGE, INACTIVITY_TIMEOUT, REFRESH_THRESHOLD };

/**
 * HMAC-sign a base64url payload string.
 *
 * @param {string} payloadB64 - Base64url-encoded payload
 * @param {string} secretHex - Hex-encoded secret
 * @returns {string} Base64url-encoded HMAC signature
 */
function signPayload(payloadB64, secretHex) {
  return crypto
    .createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update(payloadB64)
    .digest('base64url');
}

/**
 * Create a signed user-access session token, bound to the user's directory
 * id as well as their username: a later user given the same username never
 * holds this session (the middleware checks the username's current holder).
 *
 * @param {string} sessionSecret - Hex-encoded session secret
 * @param {{ username: string, userId: string }} user - the Authelia username and its directory id
 * @returns {{ value: string, maxAge: number, expiresAt: string }}
 */
export function createUserSession(sessionSecret, { username, userId }) {
  if (!isIdentityUuid(userId)) throw new Error('A user session names a directory user id');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now,
    exp: now + SESSION_MAX_AGE,
    lastActivity: now,
    username,
    userId,
    type: 'user-access',
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = signPayload(payloadB64, sessionSecret);

  return {
    value: `${payloadB64}.${sig}`,
    maxAge: SESSION_MAX_AGE,
    expiresAt: new Date((now + SESSION_MAX_AGE) * 1000).toISOString(),
  };
}

/**
 * Validate a user-access session token.
 *
 * @param {string} tokenValue - The token (payload.sig)
 * @param {string} sessionSecret - Hex-encoded session secret
 * @param {{ userEpochs?: Record<string, number> }} [options]
 *   userEpochs maps a directory user id → Unix-second epoch. If the
 *   session's `iat` is older than its user's epoch, the session is rejected
 *   as revoked. This is how offboarding (disable, delete) invalidates live
 *   sessions whose HMAC signature is otherwise still valid. A session
 *   without a user id (issued before 4.5) is rejected: it could not be
 *   told from a later user's.
 * @returns {{ valid: boolean, payload?: object, reason?: string }}
 */
export function validateUserSession(tokenValue, sessionSecret, options = {}) {
  if (!tokenValue || typeof tokenValue !== 'string') {
    return { valid: false, reason: 'missing' };
  }

  const dotIndex = tokenValue.indexOf('.');
  if (dotIndex === -1) {
    return { valid: false, reason: 'malformed' };
  }

  const payloadB64 = tokenValue.slice(0, dotIndex);
  const sig = tokenValue.slice(dotIndex + 1);

  const expectedSig = signPayload(payloadB64, sessionSecret);

  // Timing-safe comparison
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, reason: 'invalid_signature' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  } catch {
    return { valid: false, reason: 'parse_error' };
  }

  // Must be a user-access session (not a 2FA session)
  if (payload.type !== 'user-access') {
    return { valid: false, reason: 'wrong_type' };
  }

  if (!payload.username) {
    return { valid: false, reason: 'missing_username' };
  }

  if (!isIdentityUuid(payload.userId)) {
    return { valid: false, reason: 'missing_user_id' };
  }

  const now = Math.floor(Date.now() / 1000);

  if (payload.exp && now > payload.exp) {
    return { valid: false, reason: 'expired' };
  }

  if (payload.lastActivity && now - payload.lastActivity > INACTIVITY_TIMEOUT) {
    return { valid: false, reason: 'inactive' };
  }

  // Per-user invalidation epoch (set when a user is offboarded). Reject
  // sessions issued before it.
  const userEpochs = options.userEpochs;
  if (userEpochs && typeof userEpochs === 'object') {
    const epoch = userEpochs[payload.userId];
    if (typeof epoch === 'number' && typeof payload.iat === 'number' && payload.iat < epoch) {
      return { valid: false, reason: 'revoked' };
    }
  }

  return { valid: true, payload };
}

/**
 * Refresh a user-access session by updating lastActivity and re-signing.
 *
 * @param {object} payload - The existing session payload
 * @param {string} sessionSecret - Hex-encoded session secret
 * @returns {{ value: string, maxAge: number }}
 */
export function refreshUserSession(payload, sessionSecret) {
  const now = Math.floor(Date.now() / 1000);
  const updated = { ...payload, lastActivity: now };
  const payloadB64 = Buffer.from(JSON.stringify(updated)).toString('base64url');
  const sig = signPayload(payloadB64, sessionSecret);

  const remaining = Math.max(0, updated.exp - now);

  return {
    value: `${payloadB64}.${sig}`,
    maxAge: remaining,
  };
}
