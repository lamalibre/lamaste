/**
 * Native apps' access tokens and the broker's grace window
 * (packages/core/docs/native-apps-design.md D3, R6, R8, R15).
 *
 * **Verifying an access token.** Authelia issues a native client's access
 * tokens as RFC 9068 JWTs signed with the relay's OIDC issuer key (RS256,
 * `typ: at+jwt`). Gatekeeper verifies one on every user-surface request
 * that carries it ({@link verifyNativeAccessToken}): the signature by a key
 * of the issuer's set, the issuer of the host's domain, the host's audience,
 * the host's native client, the times, and the username. It is pure given
 * the key set and the clock. A signature that fails under every key of the
 * `kid` is told apart from an unknown `kid`, so the caller can refetch the
 * key set in both cases (the issuer key keeps its `kid` across a
 * regeneration — R6).
 *
 * **Binding.** A token is named by the SHA-256 of its exact text
 * ({@link nativeTokenSha256}) — what the panel's allow-list and the relay
 * assertion carry, never the token (R15).
 *
 * **Grace window.** After a rotation the broker keeps Authelia's answer for
 * the spent refresh token for a short while, sealed under a key only that
 * token derives (HKDF-SHA256 of its bytes): the database alone yields
 * nothing usable, and the app that retries with the spent token gets the
 * same answer again ({@link sealGraceAnswer}, {@link openGraceAnswer}).
 */

import crypto from 'node:crypto';

import { isLamasteUsername } from './constants.js';
import { isNativeClientId } from './native-apps.js';

/** The longest access token a request may carry. */
export const NATIVE_ACCESS_TOKEN_MAX_LENGTH = 8192;

/** Clock difference tolerated on a token's times, in seconds. */
export const NATIVE_TOKEN_CLOCK_SKEW_SECONDS = 30;

/** The longest an access token may live (`exp − iat`), in seconds, before the skew. */
export const NATIVE_TOKEN_MAX_LIFETIME_SECONDS = 15 * 60;

/** The `typ` of an RFC 9068 access token. */
export const NATIVE_ACCESS_TOKEN_TYPE = 'at+jwt';

/** One key of the issuer: its `kid` and the RSA public key. */
export interface NativeIssuerKey {
  readonly kid: string;
  readonly key: crypto.KeyObject;
  /** RFC 7638 thumbprint (base64url): how a key set tells a regenerated key from the old one. */
  readonly thumbprint: string;
}

const KID_MAX_LENGTH = 128;
const JWKS_MAX_KEYS = 16;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The RSA signing keys of a JWKS document (Authelia's `/jwks.json`): keys
 * with `kty: RSA`, `use` absent or `sig`, `alg` absent or `RS256`, a `kid`,
 * and a modulus of at least 2048 bits. Other keys are skipped; a document
 * that is not a key set, or holds more than 16 keys, throws.
 */
export function parseNativeIssuerKeys(document: unknown): NativeIssuerKey[] {
  if (!isRecord(document) || !Array.isArray(document['keys'])) {
    throw new Error('Not a JWKS document');
  }
  const keys = document['keys'] as unknown[];
  if (keys.length > JWKS_MAX_KEYS) throw new Error('The JWKS document holds too many keys');
  const out: NativeIssuerKey[] = [];
  for (const jwk of keys) {
    if (!isRecord(jwk)) continue;
    const { kty, use, alg, kid, n, e } = jwk;
    if (kty !== 'RSA' || (use !== undefined && use !== 'sig')) continue;
    if (alg !== undefined && alg !== 'RS256') continue;
    if (typeof kid !== 'string' || kid.length === 0 || kid.length > KID_MAX_LENGTH) continue;
    if (typeof n !== 'string' || typeof e !== 'string') continue;
    if (!BASE64URL_RE.test(n) || !BASE64URL_RE.test(e)) continue;
    let key: crypto.KeyObject;
    try {
      key = crypto.createPublicKey({ key: { kty: 'RSA', n, e }, format: 'jwk' });
    } catch {
      continue;
    }
    const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
    if (bits < 2048) continue;
    const thumbprint = crypto
      .createHash('sha256')
      .update(JSON.stringify({ e, kty: 'RSA', n }), 'utf-8')
      .digest('base64url');
    out.push({ kid, key, thumbprint });
  }
  return out;
}

/** The SHA-256 of a token's exact text, hex — how the relay names a token without holding it. */
export function nativeTokenSha256(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf-8').digest('hex');
}

/** What a verified access token says. */
export interface NativeAccessTokenClaims {
  /** `preferred_username`: the Lamaste username the token was issued for. */
  readonly username: string;
  readonly clientId: string;
  readonly jti: string;
  /** Seconds since the epoch. */
  readonly exp: number;
  readonly iat: number;
  /** {@link nativeTokenSha256} of the token. */
  readonly tokenSha256: string;
}

/** Why a token was refused. */
export type NativeAccessTokenRejection =
  | 'malformed'
  | 'unsupported_algorithm'
  | 'wrong_type'
  | 'unknown_key'
  | 'bad_signature'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'wrong_client'
  | 'expired'
  | 'not_yet_valid'
  | 'lifetime_too_long'
  | 'invalid_username';

export type VerifyNativeAccessTokenResult =
  | { readonly ok: true; readonly claims: NativeAccessTokenClaims }
  | { readonly ok: false; readonly reason: NativeAccessTokenRejection };

export interface VerifyNativeAccessTokenOptions {
  /** The issuer's keys ({@link parseNativeIssuerKeys}). */
  readonly keys: readonly NativeIssuerKey[];
  /** `https://auth.<the host's domain>`. */
  readonly issuer: string;
  /** The host's audience (`nativeAudience(fqdn)`). */
  readonly audience: string;
  /** The host's native client id. */
  readonly clientId: string;
  /** Now, in seconds since the epoch (default: the clock). */
  readonly now?: number | undefined;
}

function decodeSegment(segment: string): Record<string, unknown> | null {
  if (!BASE64URL_RE.test(segment)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf-8'));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Verify a native client's access token for one host. In order: shape
 * (three base64url segments, ≤ 8 KiB), header (`alg: RS256`,
 * `typ: at+jwt`, a `kid`), the key (`unknown_key` when no key has the
 * `kid`), the signature (`bad_signature` when it fails under every key with
 * the `kid`), the claims' shape, `iss`, `aud` (a string or an array holding
 * the host's audience), `client_id`, the times (`exp` in the future, `nbf`
 * and `iat` not in the future, `exp − iat` at most 15 minutes — each with
 * 30 s of skew), `jti` a UUID, and `preferred_username` a Lamaste username.
 * Pure given the keys and the clock.
 */
export function verifyNativeAccessToken(
  token: unknown,
  opts: VerifyNativeAccessTokenOptions,
): VerifyNativeAccessTokenResult {
  const refuse = (reason: NativeAccessTokenRejection): VerifyNativeAccessTokenResult => ({
    ok: false,
    reason,
  });
  if (typeof token !== 'string' || token.length === 0) return refuse('malformed');
  if (token.length > NATIVE_ACCESS_TOKEN_MAX_LENGTH) return refuse('malformed');
  const parts = token.split('.');
  if (parts.length !== 3) return refuse('malformed');
  const [encodedHeader = '', encodedClaims = '', encodedSignature = ''] = parts;
  const header = decodeSegment(encodedHeader);
  const claims = decodeSegment(encodedClaims);
  if (!header || !claims || !BASE64URL_RE.test(encodedSignature)) return refuse('malformed');
  if (header['alg'] !== 'RS256') return refuse('unsupported_algorithm');
  if (header['typ'] !== NATIVE_ACCESS_TOKEN_TYPE) return refuse('wrong_type');
  if ('crit' in header) return refuse('malformed');
  const kid = header['kid'];
  if (typeof kid !== 'string' || kid.length === 0 || kid.length > KID_MAX_LENGTH) {
    return refuse('malformed');
  }

  const candidates = opts.keys.filter((k) => k.kid === kid);
  if (candidates.length === 0) return refuse('unknown_key');
  const signed = Buffer.from(`${encodedHeader}.${encodedClaims}`, 'utf-8');
  const signature = Buffer.from(encodedSignature, 'base64url');
  const verified = candidates.some((candidate) => {
    try {
      return crypto.verify('sha256', signed, candidate.key, signature);
    } catch {
      return false;
    }
  });
  if (!verified) return refuse('bad_signature');

  if (claims['iss'] !== opts.issuer) return refuse('wrong_issuer');
  const aud = claims['aud'];
  const audiences = typeof aud === 'string' ? [aud] : Array.isArray(aud) ? aud : null;
  if (!audiences || !audiences.includes(opts.audience)) return refuse('wrong_audience');
  const clientId = claims['client_id'];
  if (!isNativeClientId(clientId) || clientId !== opts.clientId) return refuse('wrong_client');

  const { exp, iat, nbf, jti } = claims;
  if (!isSeconds(exp) || !isSeconds(iat) || (nbf !== undefined && !isSeconds(nbf))) {
    return refuse('malformed');
  }
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const skew = NATIVE_TOKEN_CLOCK_SKEW_SECONDS;
  if (exp <= now) return refuse('expired');
  if (iat > now + skew || (nbf !== undefined && nbf > now + skew)) return refuse('not_yet_valid');
  if (exp - iat > NATIVE_TOKEN_MAX_LIFETIME_SECONDS + skew) return refuse('lifetime_too_long');
  if (typeof jti !== 'string' || !UUID_RE.test(jti)) return refuse('malformed');
  const username = claims['preferred_username'];
  if (!isLamasteUsername(username)) return refuse('invalid_username');

  return {
    ok: true,
    claims: {
      username,
      clientId,
      jti: jti.toLowerCase(),
      exp,
      iat,
      tokenSha256: nativeTokenSha256(token),
    },
  };
}

/**
 * The bearer token of an `Authorization` header: `Bearer <token>` (the
 * scheme in any case, one space, nothing after the token), or null for
 * anything else — another scheme, an empty token, a second value.
 */
export function bearerTokenOf(header: unknown): string | null {
  if (typeof header !== 'string' || header.length > NATIVE_ACCESS_TOKEN_MAX_LENGTH + 7) {
    return null;
  }
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(header);
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// The broker's grace window (R8)
// ---------------------------------------------------------------------------

const GRACE_SALT = Buffer.from('lamaste/native-grace/v1', 'utf-8');
const GRACE_IV_BYTES = 12;
const GRACE_TAG_BYTES = 16;
const GRACE_KEY_BYTES = 32;

/** An answer the broker keeps for a spent refresh token, sealed under that token. */
export interface SealedGraceAnswer {
  readonly v: 1;
  /** base64url of the 12 IV bytes. */
  readonly iv: string;
  /** base64url of the ciphertext followed by the 16-byte tag. */
  readonly ct: string;
}

function graceKey(spentRefreshToken: string, grantId: string): Buffer {
  if (typeof spentRefreshToken !== 'string' || spentRefreshToken.length === 0) {
    throw new Error('A grace answer is sealed under a refresh token');
  }
  if (typeof grantId !== 'string' || grantId.length === 0) {
    throw new Error('A grace answer names its grant');
  }
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(spentRefreshToken, 'utf-8'),
      GRACE_SALT,
      Buffer.from(grantId, 'utf-8'),
      GRACE_KEY_BYTES,
    ),
  );
}

/**
 * Seal the answer (Authelia's response body) the broker gave for a
 * rotation, under the refresh token it spent: AES-256-GCM, key
 * HKDF-SHA256(token, salt `lamaste/native-grace/v1`, info grant id), the
 * grant id as additional data. Only someone holding the spent token opens it.
 */
export function sealGraceAnswer(input: {
  readonly spentRefreshToken: string;
  readonly grantId: string;
  readonly answer: string;
}): SealedGraceAnswer {
  const key = graceKey(input.spentRefreshToken, input.grantId);
  const iv = crypto.randomBytes(GRACE_IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: GRACE_TAG_BYTES });
  cipher.setAAD(Buffer.from(input.grantId, 'utf-8'));
  const ct = Buffer.concat([cipher.update(input.answer, 'utf-8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64url'),
    ct: Buffer.concat([ct, cipher.getAuthTag()]).toString('base64url'),
  };
}

/**
 * Open a sealed grace answer with the spent refresh token presented again.
 * Null when it does not open (another token, another grant, altered).
 */
export function openGraceAnswer(input: {
  readonly spentRefreshToken: string;
  readonly grantId: string;
  readonly sealed: SealedGraceAnswer;
}): string | null {
  const { sealed } = input;
  if (!isRecord(sealed) || sealed.v !== 1) return null;
  if (typeof sealed.iv !== 'string' || typeof sealed.ct !== 'string') return null;
  if (!BASE64URL_RE.test(sealed.iv) || !BASE64URL_RE.test(sealed.ct)) return null;
  const iv = Buffer.from(sealed.iv, 'base64url');
  const ct = Buffer.from(sealed.ct, 'base64url');
  if (iv.length !== GRACE_IV_BYTES || ct.length <= GRACE_TAG_BYTES) return null;
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      graceKey(input.spentRefreshToken, input.grantId),
      iv,
      { authTagLength: GRACE_TAG_BYTES },
    );
    decipher.setAAD(Buffer.from(input.grantId, 'utf-8'));
    decipher.setAuthTag(ct.subarray(ct.length - GRACE_TAG_BYTES));
    return Buffer.concat([
      decipher.update(ct.subarray(0, ct.length - GRACE_TAG_BYTES)),
      decipher.final(),
    ]).toString('utf-8');
  } catch {
    return null;
  }
}
