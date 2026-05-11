import crypto from 'node:crypto';
import { getConfig, updateConfig } from './config.js';

const SESSION_MAX_AGE = 12 * 60 * 60; // 12 hours in seconds
const INACTIVITY_TIMEOUT = 2 * 60 * 60; // 2 hours in seconds
const COOKIE_NAME = 'lamaste_2fa_session';
const REFRESH_THRESHOLD = 60; // Only re-sign if lastActivity is older than 60s

/**
 * Standard cookie attributes for the 2FA session cookie.
 * Used by the middleware (refresh), routes (set/clear), and exported for consistency.
 */
const COOKIE_OPTIONS = Object.freeze({
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
});

export { COOKIE_NAME, SESSION_MAX_AGE, COOKIE_OPTIONS, REFRESH_THRESHOLD };

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
 * Create a signed session cookie value.
 *
 * @param {string} sessionSecret - Hex-encoded session secret
 * @param {string} [certSerial] - Certificate serial number to bind session to
 * @returns {{ value: string, maxAge: number }}
 */
export function createSessionCookie(sessionSecret, certSerial) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now,
    exp: now + SESSION_MAX_AGE,
    lastActivity: now,
    ...(certSerial && { certSerial }),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = signPayload(payloadB64, sessionSecret);

  return {
    value: `${payloadB64}.${sig}`,
    maxAge: SESSION_MAX_AGE,
  };
}

/**
 * Validate a session cookie value.
 *
 * @param {string} cookieValue - The cookie value (payload.sig)
 * @param {string} sessionSecret - Hex-encoded session secret
 * @param {string} [certSerial] - Certificate serial to verify against (if bound)
 * @returns {{ valid: boolean, payload?: object, reason?: string }}
 */
export function validateSession(cookieValue, sessionSecret, certSerial) {
  if (!cookieValue || typeof cookieValue !== 'string') {
    return { valid: false, reason: 'missing' };
  }

  const dotIndex = cookieValue.indexOf('.');
  if (dotIndex === -1) {
    return { valid: false, reason: 'malformed' };
  }

  const payloadB64 = cookieValue.slice(0, dotIndex);
  const sig = cookieValue.slice(dotIndex + 1);

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

  const now = Math.floor(Date.now() / 1000);

  if (payload.exp && now > payload.exp) {
    return { valid: false, reason: 'expired' };
  }

  if (payload.lastActivity && now - payload.lastActivity > INACTIVITY_TIMEOUT) {
    return { valid: false, reason: 'inactive' };
  }

  // Verify certificate binding if present in session
  if (payload.certSerial && certSerial && payload.certSerial !== certSerial) {
    return { valid: false, reason: 'cert_mismatch' };
  }

  return { valid: true, payload };
}

/**
 * Refresh a session by updating lastActivity and re-signing.
 *
 * @param {object} payload - The existing session payload
 * @param {string} sessionSecret - Hex-encoded session secret
 * @returns {{ value: string, maxAge: number }}
 */
export function refreshSession(payload, sessionSecret) {
  const now = Math.floor(Date.now() / 1000);
  const updated = { ...payload, lastActivity: now };
  const payloadB64 = Buffer.from(JSON.stringify(updated)).toString('base64url');
  const sig = signPayload(payloadB64, sessionSecret);

  // Remaining time until absolute expiry
  const remaining = Math.max(0, updated.exp - now);

  return {
    value: `${payloadB64}.${sig}`,
    maxAge: remaining,
  };
}

/**
 * Ensure a sessionSecret exists in the config. If not, generate and persist one.
 *
 * @returns {Promise<string>} The session secret (hex)
 */
export async function ensureSessionSecret() {
  const config = getConfig();
  if (config.sessionSecret) {
    return config.sessionSecret;
  }

  const secret = crypto.randomBytes(32).toString('hex');
  await updateConfig({ sessionSecret: secret });
  return secret;
}
