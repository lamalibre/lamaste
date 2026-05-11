import crypto from 'node:crypto';
import { base32Decode, generateTotpSecret } from './authelia.js';

/**
 * Generate a 6-digit TOTP code for a given secret and time step (RFC 6238 / RFC 4226).
 *
 * @param {string} secretBase32 - Base32-encoded secret
 * @param {number} timeStep - The time step counter value
 * @returns {string} 6-digit zero-padded code
 */
export function generateCode(secretBase32, timeStep) {
  const key = base32Decode(secretBase32);
  const timeBuffer = Buffer.alloc(8);
  // Write 64-bit big-endian counter
  timeBuffer.writeUInt32BE(Math.floor(timeStep / 0x100000000), 0);
  timeBuffer.writeUInt32BE(timeStep >>> 0, 4);

  const hmac = crypto.createHmac('sha1', key).update(timeBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % 1000000).padStart(6, '0');
}

// Replay protection: track recently used codes per RFC 6238 Section 5.2.
// Key = "code:timeStep", purged after 90s (covers the full +/- 1 step window).
const usedCodes = new Map();
const USED_CODE_TTL_MS = 90_000;

function pruneUsedCodes() {
  const now = Date.now();
  for (const [key, ts] of usedCodes) {
    if (now - ts > USED_CODE_TTL_MS) usedCodes.delete(key);
  }
}

/**
 * Verify a TOTP code against the secret, allowing +/- 1 time step (30s each = 60s window).
 * Each code can only be used once (replay protection per RFC 6238 Section 5.2).
 *
 * @param {string} secretBase32 - Base32-encoded secret
 * @param {string} code - The 6-digit code to verify
 * @returns {boolean}
 */
export function verifyTotp(secretBase32, code) {
  const now = Math.floor(Date.now() / 1000);
  const period = 30;
  const currentStep = Math.floor(now / period);

  for (let i = -1; i <= 1; i++) {
    const step = currentStep + i;
    if (generateCode(secretBase32, step) === code) {
      const replayKey = `${code}:${step}`;
      if (usedCodes.has(replayKey)) {
        return false;
      }
      usedCodes.set(replayKey, Date.now());
      pruneUsedCodes();
      return true;
    }
  }
  return false;
}

/**
 * Generate a TOTP secret and otpauth URI for the admin panel.
 *
 * @returns {{ secret: string, uri: string }}
 */
export function generateAdminTotpSecret() {
  return generateTotpSecret('admin', { issuer: 'Lamaste Panel' });
}
