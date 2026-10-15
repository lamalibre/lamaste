/**
 * Caller assertions — how the relay proves to an agent-hosted plugin's
 * application (its *agent half*) that a request on the plugin's internal
 * tunnel came through the panel's forwarder, and who the caller was.
 *
 * The internal tunnel ends on the relay's loopback, which every process on
 * the relay can reach, so the agent half must not trust the network
 * position. Each forwarded request therefore carries
 *
 *     X-Lamalibre-Caller: <base64url(payload)>.<base64url(hmac)>
 *
 * where the payload names the plugin, the caller, the method and the target
 * path, the issue time and a nonce, and the HMAC-SHA256 is keyed with the
 * installation secret both halves hold. The agent half verifies with a
 * constant-time comparison, rejects anything older than
 * {@link CALLER_ASSERTION_MAX_AGE_MS} (allowing {@link CALLER_ASSERTION_CLOCK_SKEW_MS}
 * of clock difference) and rejects a nonce it has already seen.
 *
 * Shared between the server subpath (signing) and the agent subpath
 * (verifying); the two never import each other.
 */

import crypto from 'node:crypto';

/** The request header that carries the assertion (lower case, as Node reports headers). */
export const CALLER_ASSERTION_HEADER = 'x-lamalibre-caller';

/** How long an assertion is valid after it was issued. */
export const CALLER_ASSERTION_MAX_AGE_MS = 60_000;

/** Clock difference tolerated between the relay and the agent. */
export const CALLER_ASSERTION_CLOCK_SKEW_MS = 5_000;

export const CALLER_ASSERTION_VERSION = 1 as const;

/** Installation secrets are 32 random bytes, hex encoded. */
export const HOSTING_SECRET_BYTES = 32;
const HOSTING_SECRET_RE = /^[a-f0-9]{64}$/;
const NONCE_BYTES = 16;
const NONCE_RE = /^[a-f0-9]{32}$/;

/**
 * Who made the request. `admin` and `agent` are callers the panel admitted
 * and forwards; `lamaste` is Lamaste itself — its health probes and the
 * lifecycle hook calls (`/admin/hooks/*`), which no forwarded caller can
 * reach.
 */
export type CallerIdentity =
  | { readonly type: 'admin' }
  | { readonly type: 'agent'; readonly label: string }
  | { readonly type: 'lamaste' };

export interface CallerAssertionPayload {
  readonly v: typeof CALLER_ASSERTION_VERSION;
  /** The plugin's route (manifest `name`). */
  readonly plugin: string;
  readonly caller: CallerIdentity;
  /** Upper-case HTTP method of the forwarded request. */
  readonly method: string;
  /** The path (with query string) the request is forwarded to on the agent half. */
  readonly path: string;
  /** Issue time, milliseconds since the epoch. */
  readonly iat: number;
  /** 16 random bytes, hex; rejected on a second sight. */
  readonly nonce: string;
}

/** A fresh installation secret. */
export function generateHostingSecret(): string {
  return crypto.randomBytes(HOSTING_SECRET_BYTES).toString('hex');
}

export function assertHostingSecret(secret: string): void {
  if (typeof secret !== 'string' || !HOSTING_SECRET_RE.test(secret)) {
    throw new Error('Invalid installation secret format');
  }
}

function hmac(secret: string, data: string): Buffer {
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(data).digest();
}

/**
 * Sign a caller assertion for one forwarded request. `iat` and `nonce` are
 * filled in when omitted; passing them is for tests.
 */
export function signCallerAssertion(
  input: Omit<CallerAssertionPayload, 'v' | 'iat' | 'nonce'> &
    Partial<Pick<CallerAssertionPayload, 'iat' | 'nonce'>>,
  secret: string,
): string {
  assertHostingSecret(secret);
  const payload: CallerAssertionPayload = {
    v: CALLER_ASSERTION_VERSION,
    plugin: input.plugin,
    caller: input.caller,
    method: input.method.toUpperCase(),
    path: input.path,
    iat: input.iat ?? Date.now(),
    nonce: input.nonce ?? crypto.randomBytes(NONCE_BYTES).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  return `${encoded}.${hmac(secret, encoded).toString('base64url')}`;
}

export type CallerAssertionRejection =
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'future'
  | 'replayed'
  | 'wrong_plugin'
  | 'wrong_request';

export type VerifyCallerAssertionResult =
  | { readonly ok: true; readonly payload: CallerAssertionPayload; readonly secretIndex: number }
  | { readonly ok: false; readonly reason: CallerAssertionRejection };

/**
 * Remembers nonces until their assertions could no longer be valid anyway.
 * One per verifying process; a nonce seen twice means a replay.
 */
export class NonceStore {
  readonly #seen = new Map<string, number>();
  #lastPrune = 0;

  /** True when `nonce` was not seen before; records it until `expiresAt`. */
  record(nonce: string, expiresAt: number, now = Date.now()): boolean {
    if (now - this.#lastPrune > CALLER_ASSERTION_MAX_AGE_MS) this.prune(now);
    if (this.#seen.has(nonce)) return false;
    this.#seen.set(nonce, expiresAt);
    return true;
  }

  prune(now = Date.now()): void {
    this.#lastPrune = now;
    for (const [nonce, expiresAt] of this.#seen) {
      if (expiresAt <= now) this.#seen.delete(nonce);
    }
  }

  get size(): number {
    return this.#seen.size;
  }
}

export interface VerifyCallerAssertionOptions {
  /** Secrets accepted, current first; the previous one during a rotation. */
  readonly secrets: readonly string[];
  readonly plugin: string;
  readonly method: string;
  readonly path: string;
  readonly nonces: NonceStore;
  readonly now?: number | undefined;
}

function parsePayload(encoded: string): CallerAssertionPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  const caller = p['caller'] as Record<string, unknown> | undefined;
  if (
    p['v'] !== CALLER_ASSERTION_VERSION ||
    typeof p['plugin'] !== 'string' ||
    typeof p['method'] !== 'string' ||
    typeof p['path'] !== 'string' ||
    typeof p['iat'] !== 'number' ||
    !Number.isFinite(p['iat']) ||
    typeof p['nonce'] !== 'string' ||
    !NONCE_RE.test(p['nonce']) ||
    !caller ||
    typeof caller !== 'object'
  ) {
    return null;
  }
  let identity: CallerIdentity;
  if (caller['type'] === 'admin') {
    identity = { type: 'admin' };
  } else if (caller['type'] === 'agent' && typeof caller['label'] === 'string') {
    identity = { type: 'agent', label: caller['label'] };
  } else if (caller['type'] === 'lamaste') {
    identity = { type: 'lamaste' };
  } else {
    return null;
  }
  return {
    v: CALLER_ASSERTION_VERSION,
    plugin: p['plugin'],
    caller: identity,
    method: p['method'],
    path: p['path'],
    iat: p['iat'],
    nonce: p['nonce'],
  };
}

/**
 * Verify the `X-Lamalibre-Caller` header of a request the agent half
 * received. Checks, in order: shape, signature against each accepted secret
 * (constant time), plugin, method and path, age, and replay. The nonce is
 * recorded only when everything else passed, so a forged assertion cannot
 * poison the store.
 */
export function verifyCallerAssertion(
  header: string | undefined,
  opts: VerifyCallerAssertionOptions,
): VerifyCallerAssertionResult {
  if (typeof header !== 'string' || header.length === 0 || header.length > 4096) {
    return { ok: false, reason: 'malformed' };
  }
  const dot = header.indexOf('.');
  if (dot <= 0 || dot === header.length - 1) return { ok: false, reason: 'malformed' };
  const encoded = header.slice(0, dot);
  const signature = Buffer.from(header.slice(dot + 1), 'base64url');
  if (signature.length !== 32) return { ok: false, reason: 'malformed' };

  const secretIndex = opts.secrets.findIndex(
    (secret) =>
      HOSTING_SECRET_RE.test(secret) && crypto.timingSafeEqual(hmac(secret, encoded), signature),
  );
  if (secretIndex === -1) return { ok: false, reason: 'bad_signature' };

  const payload = parsePayload(encoded);
  if (!payload) return { ok: false, reason: 'malformed' };
  if (payload.plugin !== opts.plugin) return { ok: false, reason: 'wrong_plugin' };
  if (payload.method !== opts.method.toUpperCase() || payload.path !== opts.path) {
    return { ok: false, reason: 'wrong_request' };
  }

  const now = opts.now ?? Date.now();
  if (payload.iat > now + CALLER_ASSERTION_CLOCK_SKEW_MS) return { ok: false, reason: 'future' };
  const expiresAt = payload.iat + CALLER_ASSERTION_MAX_AGE_MS + CALLER_ASSERTION_CLOCK_SKEW_MS;
  if (expiresAt <= now) return { ok: false, reason: 'expired' };
  if (!opts.nonces.record(payload.nonce, expiresAt, now)) {
    return { ok: false, reason: 'replayed' };
  }
  return { ok: true, payload, secretIndex };
}
