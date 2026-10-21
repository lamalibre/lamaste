/**
 * Caller assertions — how the relay proves to an agent-hosted plugin's
 * application (its *agent half*) that a request on the plugin's internal
 * tunnel came through the panel's forwarder, and who the caller was — and
 * responder signatures, how the agent half proves its answer back.
 *
 * The internal tunnel ends on loopback ports, which every process on the
 * relay (and on the agent) can reach — and take, while the tunnel or the
 * agent half is down. Neither end may therefore trust the network
 * position. Each request carries
 *
 *     X-Lamalibre-Caller: <base64url(payload)>.<base64url(hmac)>
 *
 * where the payload names the plugin, the caller, the method and the target
 * path, the issue time, a nonce and — for a request Lamaste sends with a
 * body — the SHA-256 of the exact body bytes (`bodySha256`), and the
 * HMAC-SHA256 is keyed with the installation secret both halves hold. The
 * agent half verifies with a constant-time comparison, rejects anything
 * older than {@link CALLER_ASSERTION_MAX_AGE_MS} (allowing
 * {@link CALLER_ASSERTION_CLOCK_SKEW_MS} of clock difference), a nonce it
 * has already seen, and — where it requires the binding — a body whose
 * hash is not the signed one, so an assertion cannot be lifted onto
 * another body. A verifier built before `bodySha256` existed ignores the
 * field.
 *
 * Every answer the agent half gives to a verified request carries
 *
 *     X-Lamalibre-Responder: base64url(HMAC-SHA256(secret,
 *       "lamaste.responder.v1\n" + nonce + "\n" + status + "\n" + (bodySha256 | "-")))
 *
 * keyed with the secret that verified the request and bound to the
 * request's nonce and the answer's status — and, for the buffered answers
 * to Lamaste's own calls (settings, hooks, health), to the SHA-256 of the
 * exact answer body; `-` for forwarded answers, which stream. The relay
 * verifies it before it believes or passes on anything, so whatever squats
 * a port without the secret can serve nothing: not a health answer, not a
 * hook decision, not `panel.js`.
 *
 * Paths are a boundary between callers (`user-surface.ts`): a `user` caller
 * — a person on the plugin's user surface — is valid only for a path under
 * `/app`, and every other caller never for one there. Signing refuses
 * either mistake and verifying answers `wrong_request`, so an assertion of
 * one kind can never act on the other's routes. A verifier built before
 * the `user` caller existed refuses it as `malformed`.
 *
 * Shared between the server subpath (signing, responder checks) and the
 * agent subpath (verifying, responder signing); the two never import each
 * other.
 */

import crypto from 'node:crypto';

import { isLamasteUsername } from './constants.js';
import { isIdentityRoleList, isIdentityUuid } from './identity.js';
import { decryptSettingsSecret } from './settings-secrets.js';
import type { EncryptedSettingsSecret } from './settings-secrets.js';
import { isAgentHalfAppPath, isUnderAgentHalfApp } from './user-surface.js';

/** The request header that carries the assertion (lower case, as Node reports headers). */
export const CALLER_ASSERTION_HEADER = 'x-lamalibre-caller';

/** The response header with which the agent half authenticates its answer (lower case). */
export const RESPONDER_HEADER = 'x-lamalibre-responder';

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
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

/** Domain separation: a responder signature can never pass for anything else keyed alike. */
const RESPONDER_CONTEXT = 'lamaste.responder.v1';

/** The base64url length of an HMAC-SHA256 (32 bytes, unpadded). */
const MAC_BASE64URL_LENGTH = 43;

/**
 * A person on a plugin's user surface (`/app/*`), as the panel's directory
 * knows them: the stable `userId` (UUID v4) to key anything on, the
 * username to show, and their roles in this plugin (1–32 of the role ids
 * its manifest declares).
 */
export interface UserCallerIdentity {
  readonly type: 'user';
  readonly userId: string;
  readonly username: string;
  readonly roles: readonly string[];
}

/**
 * Who made the request. `admin` and `agent` are callers the panel admitted
 * and forwards to `/admin/*`; `user` one it forwards to `/app/*` (the user
 * surface, {@link UserCallerIdentity}); `lamaste` is Lamaste itself — its
 * health probes, the lifecycle hook calls (`/admin/hooks/*`), the settings
 * calls (`/admin/settings*`) and the identity feed (`/admin/identity/*`),
 * the last three of which no forwarded caller can reach.
 */
export type CallerIdentity =
  | { readonly type: 'admin' }
  | { readonly type: 'agent'; readonly label: string }
  | UserCallerIdentity
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
  /**
   * SHA-256 (64 lower-case hex characters) of the exact request body bytes.
   * Lamaste's own calls with a body always carry it; forwarded requests,
   * whose bodies stream, never do.
   */
  readonly bodySha256?: string;
}

/** What {@link signCallerAssertion} signs; `iat`, `nonce` and `bodySha256` are optional. */
export interface CallerAssertionInput {
  readonly plugin: string;
  readonly caller: CallerIdentity;
  readonly method: string;
  readonly path: string;
  /** Filled in with the current time when omitted. */
  readonly iat?: number | undefined;
  /**
   * Filled in with 16 random bytes when omitted. A caller that must know
   * the nonce before it signs — to bind a responder check or a sealed
   * secret to it — passes one from {@link generateCallerAssertionNonce}.
   */
  readonly nonce?: string | undefined;
  /** {@link bodySha256Hex} of the body the request will carry. */
  readonly bodySha256?: string | undefined;
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

/** A fresh assertion nonce (16 random bytes, hex). */
export function generateCallerAssertionNonce(): string {
  return crypto.randomBytes(NONCE_BYTES).toString('hex');
}

/** SHA-256 of the exact bytes of a body (a string counts as its UTF-8 bytes), lower-case hex. */
export function bodySha256Hex(body: Buffer | string): string {
  return crypto.createHash('sha256').update(body).digest('hex');
}

function hmac(secret: string, data: string): Buffer {
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(data).digest();
}

/**
 * A caller as an assertion may name one, or null. An `agent` needs a
 * string label; a `user` a lower-case UUID v4 `userId`, a Lamaste
 * username and 1–32 distinct role ids. Unknown fields are dropped — the
 * `user` caller is rebuilt from the three it has.
 */
export function parseCallerIdentity(raw: unknown): CallerIdentity | null {
  if (!raw || typeof raw !== 'object') return null;
  const caller = raw as Record<string, unknown>;
  if (caller['type'] === 'admin') return { type: 'admin' };
  if (caller['type'] === 'agent' && typeof caller['label'] === 'string') {
    return { type: 'agent', label: caller['label'] };
  }
  if (caller['type'] === 'lamaste') return { type: 'lamaste' };
  if (caller['type'] === 'user') {
    const { userId, username, roles } = caller;
    if (!isIdentityUuid(userId) || !isLamasteUsername(username) || !isIdentityRoleList(roles)) {
      return null;
    }
    return { type: 'user', userId, username, roles: [...roles] };
  }
  return null;
}

/**
 * Whether `caller` may be named for a request to `path` on the agent half:
 * a `user` only under `/app` (read literally), every other caller never
 * where a router could take the path for `/app` (`user-surface.ts`).
 */
function callerMayReach(caller: CallerIdentity, path: string): boolean {
  return caller.type === 'user' ? isAgentHalfAppPath(path) : !isUnderAgentHalfApp(path);
}

/**
 * Sign a caller assertion for one request. `iat` and `nonce` are filled in
 * when omitted; `bodySha256` is included only when given. Throws on a
 * malformed secret, nonce, body hash or caller, and on a caller the path
 * is not for (a `user` outside `/app`, anyone else under it) — a mistake
 * in Lamaste, never sent.
 */
export function signCallerAssertion(input: CallerAssertionInput, secret: string): string {
  assertHostingSecret(secret);
  if (input.nonce !== undefined && !NONCE_RE.test(input.nonce)) {
    throw new Error('Invalid caller assertion nonce');
  }
  if (input.bodySha256 !== undefined && !SHA256_HEX_RE.test(input.bodySha256)) {
    throw new Error('Invalid caller assertion body hash');
  }
  const parsedCaller = parseCallerIdentity(input.caller);
  if (!parsedCaller) throw new Error('Invalid caller in caller assertion');
  if (!callerMayReach(parsedCaller, input.path)) {
    throw new Error(
      parsedCaller.type === 'user'
        ? 'A user caller is only valid for a path under /app'
        : 'Only a user caller is valid for a path under /app',
    );
  }
  const payload: CallerAssertionPayload = {
    v: CALLER_ASSERTION_VERSION,
    plugin: input.plugin,
    // A user caller is signed in its canonical form; the others exactly as
    // given, as before the user caller existed.
    caller: parsedCaller.type === 'user' ? parsedCaller : input.caller,
    method: input.method.toUpperCase(),
    path: input.path,
    iat: input.iat ?? Date.now(),
    nonce: input.nonce ?? generateCallerAssertionNonce(),
    ...(input.bodySha256 !== undefined ? { bodySha256: input.bodySha256 } : {}),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  return `${encoded}.${hmac(secret, encoded).toString('base64url')}`;
}

// ---------------------------------------------------------------------------
// Responder signatures (the agent half's answer)
// ---------------------------------------------------------------------------

/** What a responder signature covers. */
export interface ResponderInput {
  /** The secret that verified the request (relay: the one it signed with). */
  readonly secret: string;
  /** The request's assertion nonce. */
  readonly nonce: string;
  /** The answer's HTTP status. */
  readonly status: number;
  /**
   * The exact answer body, for a buffered answer to Lamaste's own call (an
   * empty body is `''`); null or omitted for a forwarded answer, whose body
   * streams (the `-` form).
   */
  readonly body?: Buffer | string | null | undefined;
}

function isStatus(status: unknown): status is number {
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599;
}

function responderMac(input: ResponderInput): string {
  const bodyPart =
    input.body === null || input.body === undefined ? '-' : bodySha256Hex(input.body);
  return hmac(
    input.secret,
    `${RESPONDER_CONTEXT}\n${input.nonce}\n${input.status}\n${bodyPart}`,
  ).toString('base64url');
}

/**
 * The `X-Lamalibre-Responder` value for one answer. An agent half uses the
 * `responder` of its verified request instead, which keeps the secret
 * inside the verifier; this is the primitive under it. Throws on a
 * malformed secret, nonce or status.
 */
export function signResponder(input: ResponderInput): string {
  assertHostingSecret(input.secret);
  if (typeof input.nonce !== 'string' || !NONCE_RE.test(input.nonce)) {
    throw new Error('Invalid caller assertion nonce');
  }
  if (!isStatus(input.status)) throw new Error('Invalid HTTP status');
  return responderMac(input);
}

/**
 * Whether `header` (the answer's `X-Lamalibre-Responder`, as Node reports
 * it) authenticates an answer with this status — and this body, unless the
 * body is omitted (the `-` form). Constant time in the signature; false for
 * anything missing or malformed.
 */
export function verifyResponder(header: unknown, input: ResponderInput): boolean {
  if (typeof header !== 'string' || header.length !== MAC_BASE64URL_LENGTH) return false;
  if (typeof input.secret !== 'string' || !HOSTING_SECRET_RE.test(input.secret)) return false;
  if (typeof input.nonce !== 'string' || !NONCE_RE.test(input.nonce)) return false;
  if (!isStatus(input.status)) return false;
  return crypto.timingSafeEqual(Buffer.from(header, 'utf-8'), Buffer.from(responderMac(input)));
}

// ---------------------------------------------------------------------------
// Verifying
// ---------------------------------------------------------------------------

export type CallerAssertionRejection =
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'future'
  | 'replayed'
  | 'wrong_plugin'
  | 'wrong_request'
  /** The body is not the one the assertion signed, or a required body hash is missing. */
  | 'wrong_body';

/**
 * A verified request. The functions close over the secret that verified
 * it, so whoever answers can authenticate the answer and open the sealed
 * secrets of this request without ever holding the secret.
 */
export interface VerifiedCallerAssertion {
  readonly ok: true;
  readonly payload: CallerAssertionPayload;
  /** Which of the accepted secrets verified it (0: current, 1: previous). */
  readonly secretIndex: number;
  /**
   * The `X-Lamalibre-Responder` value for an answer with `status` — and,
   * when `body` is given, exactly that body (the form Lamaste's own calls
   * expect: pass `''` for an empty one); without `body` the `-` form a
   * forwarded answer carries.
   */
  responder(status: number, body?: Buffer | string | null): string;
  /**
   * Open a secret value sealed for this request (`PUT /admin/settings`):
   * bound to this plugin and this request's nonce, the setting's `key` and
   * the update's `baseRevision`. Throws, without the value, when it does
   * not open.
   */
  decryptSettingsSecret(key: string, baseRevision: number, sealed: EncryptedSettingsSecret): string;
}

export type VerifyCallerAssertionResult =
  | VerifiedCallerAssertion
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
  /**
   * The request body exactly as received; null for a request without one.
   * When given and the assertion carries `bodySha256`, the two must match.
   */
  readonly body?: Buffer | string | null | undefined;
  /**
   * Refuse an assertion without `bodySha256` (and check it against `body`,
   * an absent body counting as empty). For routes only Lamaste calls with a
   * body — settings updates and hook calls — so an assertion cannot be
   * replayed with another body.
   */
  readonly requireBodyHash?: boolean | undefined;
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
  if (
    p['v'] !== CALLER_ASSERTION_VERSION ||
    typeof p['plugin'] !== 'string' ||
    typeof p['method'] !== 'string' ||
    typeof p['path'] !== 'string' ||
    typeof p['iat'] !== 'number' ||
    !Number.isFinite(p['iat']) ||
    typeof p['nonce'] !== 'string' ||
    !NONCE_RE.test(p['nonce'])
  ) {
    return null;
  }
  const bodySha256 = p['bodySha256'];
  if (
    bodySha256 !== undefined &&
    (typeof bodySha256 !== 'string' || !SHA256_HEX_RE.test(bodySha256))
  ) {
    return null;
  }
  const identity = parseCallerIdentity(p['caller']);
  if (!identity) return null;
  return {
    v: CALLER_ASSERTION_VERSION,
    plugin: p['plugin'],
    caller: identity,
    method: p['method'],
    path: p['path'],
    iat: p['iat'],
    nonce: p['nonce'],
    ...(bodySha256 !== undefined ? { bodySha256 } : {}),
  };
}

/** Whether the signed body hash matches the body, as the options require. */
function bodyMatches(payload: CallerAssertionPayload, opts: VerifyCallerAssertionOptions): boolean {
  const check = opts.requireBodyHash === true || opts.body !== undefined;
  if (!check) return true;
  if (payload.bodySha256 === undefined) return opts.requireBodyHash !== true;
  const actual = crypto
    .createHash('sha256')
    .update(opts.body ?? Buffer.alloc(0))
    .digest();
  return crypto.timingSafeEqual(actual, Buffer.from(payload.bodySha256, 'hex'));
}

/**
 * Verify the `X-Lamalibre-Caller` header of a request the agent half
 * received. Checks, in order: shape, signature against each accepted secret
 * (constant time), plugin, method and path, whether the caller may be named
 * for that path (a `user` only under `/app`, every other caller never
 * there — `wrong_request`), body (constant time), age, and replay. The
 * nonce is recorded only when everything else passed, so a forged
 * assertion — or a true one with another body — cannot poison the store.
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
  if (!callerMayReach(payload.caller, payload.path)) return { ok: false, reason: 'wrong_request' };
  if (!bodyMatches(payload, opts)) return { ok: false, reason: 'wrong_body' };

  const now = opts.now ?? Date.now();
  if (payload.iat > now + CALLER_ASSERTION_CLOCK_SKEW_MS) return { ok: false, reason: 'future' };
  const expiresAt = payload.iat + CALLER_ASSERTION_MAX_AGE_MS + CALLER_ASSERTION_CLOCK_SKEW_MS;
  if (expiresAt <= now) return { ok: false, reason: 'expired' };
  if (!opts.nonces.record(payload.nonce, expiresAt, now)) {
    return { ok: false, reason: 'replayed' };
  }

  // Safe: findIndex matched this index, so it holds a string.
  const secret = opts.secrets[secretIndex] as string;
  return {
    ok: true,
    payload,
    secretIndex,
    responder: (status, body) => signResponder({ secret, nonce: payload.nonce, status, body }),
    decryptSettingsSecret: (key, baseRevision, sealed) =>
      decryptSettingsSecret({
        secret,
        plugin: payload.plugin,
        nonce: payload.nonce,
        key,
        baseRevision,
        sealed,
      }),
  };
}
