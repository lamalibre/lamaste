import crypto from 'node:crypto';

/**
 * Whether the presented management secret is Gatekeeper's, compared in
 * constant time (both sides hashed first, so their lengths never show).
 */
export function secretMatches(presented: unknown, secret: string): boolean {
  if (typeof presented !== 'string') return false;
  const digest = (value: string): Buffer => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(presented), digest(secret));
}
