import { randomBytes } from 'node:crypto';

/**
 * Generate a URL-safe random password string.
 * @param {number} [length=24] Number of random bytes (output is base64url-encoded, so longer).
 * @returns {string}
 */
export function generatePassword(length = 24) {
  return randomBytes(length).toString('base64url');
}

/**
 * Generate a hex-encoded random secret.
 * @param {number} [length=32] Number of random bytes.
 * @returns {string}
 */
export function generateHex(length = 32) {
  return randomBytes(length).toString('hex');
}
