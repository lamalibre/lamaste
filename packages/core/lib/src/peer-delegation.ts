/**
 * Peer delegations — how an app plugin calls another on behalf of a person
 * it is serving (`peers.ts`; design: `plugin-development/design/
 * agent-hosted-app-plugins.md`, "Slice 8", *Delegation*).
 *
 * When the relay forwards a person's request to a plugin's user surface
 * (`/app/*`), and that plugin consumes another's scope, the relay hands it
 * a delegation in `X-Lamalibre-Delegation`:
 *
 *     <base64url(payload)>.<base64url(HMAC-SHA256(key, payload))>
 *
 * with the payload {@link PeerDelegationPayload}: the plugin it was given
 * to (`holder`), the plugin the person used (`root`), the person's
 * `userId`, how many peer hops from the person's request it was issued at
 * (`depth`, 0 for the root), and its lifetime — at most
 * {@link PEER_DELEGATION_LIFETIME_MS} after issue, never past the token it
 * was derived from. It means "this person made a request through `root`
 * within the last few minutes", and no more.
 *
 * A call on behalf of the person presents it on the plugin's peer channel;
 * the relay verifies it ({@link verifyPeerDelegation}) — its own key, the
 * holder is the calling plugin, not expired, depth within bounds — and then
 * checks the person against the directory and the audiences. When the call
 * carries a user to a provider that itself consumes, the relay gives the
 * provider an onward token ({@link onwardPeerDelegation}): `holder` the
 * provider, `depth` + 1, at most {@link PEER_DELEGATION_MAX_DEPTH}.
 *
 * The key is the relay's alone: an agent half can neither mint nor alter a
 * token, and one that leaks is useless outside its holder's channel. Keys
 * rotate; a token names its key (`kid`), and the verifier holds the
 * current key and the previous one for a lifetime.
 *
 * Pure: keys are passed in. Shared by the server subpath (which issues and
 * verifies) and the agent subpath (which only passes tokens on — opaque).
 */

import crypto from 'node:crypto';

import { isPeerRoute } from './peers.js';
import { isIdentityUuid } from './identity.js';

export const PEER_DELEGATION_VERSION = 1 as const;

/** The token's type, so it can never pass for another HMAC'd payload. */
export const PEER_DELEGATION_TYPE = 'lamaste.peer.delegation' as const;

/** The longest a delegation lives. */
export const PEER_DELEGATION_LIFETIME_MS = 5 * 60_000;

/** The deepest a delegation goes: the root's is 0, a provider's onward one 1, … */
export const PEER_DELEGATION_MAX_DEPTH = 3;

/** Clock difference tolerated on `iat` (the relay issues and verifies, so this is slack, not skew). */
export const PEER_DELEGATION_CLOCK_SKEW_MS = 5_000;

/** A token longer than this is not one. */
const MAX_TOKEN_LENGTH = 2048;

const KID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const KEY_SECRET_RE = /^[a-f0-9]{64}$/;

/** A delegation key: an id the token names, and 32 random bytes, hex. */
export interface PeerDelegationKey {
  readonly kid: string;
  readonly secret: string;
}

export interface PeerDelegationPayload {
  readonly v: typeof PEER_DELEGATION_VERSION;
  readonly typ: typeof PEER_DELEGATION_TYPE;
  readonly kid: string;
  /** The plugin (route) the token was given to — the only one that may present it. */
  readonly holder: string;
  /** The plugin (route) the person used, whose audience must still hold them. */
  readonly root: string;
  readonly userId: string;
  /** Peer hops from the person's request: 0 for the root's token. */
  readonly depth: number;
  /** Issue time, ms since the epoch. */
  readonly iat: number;
  /** Expiry, ms since the epoch. */
  readonly exp: number;
}

export type PeerDelegationRejection =
  | 'malformed'
  | 'unknown_key'
  | 'bad_signature'
  | 'future'
  | 'expired'
  | 'wrong_holder'
  | 'too_deep';

export type VerifyPeerDelegationResult =
  | { readonly ok: true; readonly payload: PeerDelegationPayload }
  | { readonly ok: false; readonly reason: PeerDelegationRejection };

/** Whether `key` is a well-formed delegation key. */
export function isPeerDelegationKey(key: unknown): key is PeerDelegationKey {
  if (!key || typeof key !== 'object') return false;
  const k = key as Record<string, unknown>;
  return (
    typeof k['kid'] === 'string' &&
    KID_RE.test(k['kid']) &&
    typeof k['secret'] === 'string' &&
    KEY_SECRET_RE.test(k['secret'])
  );
}

/** A fresh delegation key; `kid` defaults to 8 random bytes, base64url. */
export function generatePeerDelegationKey(kid?: string): PeerDelegationKey {
  const key = {
    kid: kid ?? crypto.randomBytes(8).toString('base64url'),
    secret: crypto.randomBytes(32).toString('hex'),
  };
  if (!isPeerDelegationKey(key)) throw new Error('Invalid delegation key id');
  return key;
}

function mac(key: PeerDelegationKey, encoded: string): Buffer {
  return crypto
    .createHmac('sha256', Buffer.from(key.secret, 'hex'))
    .update(`${PEER_DELEGATION_TYPE}\n${encoded}`)
    .digest();
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function parsePayload(encoded: string): PeerDelegationPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const { v, typ, kid, holder, root, userId, depth, iat, exp } = p;
  if (
    v !== PEER_DELEGATION_VERSION ||
    typ !== PEER_DELEGATION_TYPE ||
    typeof kid !== 'string' ||
    !KID_RE.test(kid) ||
    !isPeerRoute(holder) ||
    !isPeerRoute(root) ||
    !isIdentityUuid(userId) ||
    !isInt(depth) ||
    depth < 0 ||
    !isInt(iat) ||
    !isInt(exp) ||
    exp <= iat ||
    exp - iat > PEER_DELEGATION_LIFETIME_MS
  ) {
    return null;
  }
  return { v, typ, kid, holder, root, userId, depth, iat, exp };
}

export interface SignPeerDelegationInput {
  readonly holder: string;
  readonly root: string;
  readonly userId: string;
  /** 0 (default) for a token given with a person's request. */
  readonly depth?: number | undefined;
  /** Issue time; now when omitted. */
  readonly iat?: number | undefined;
  /** Lifetime; {@link PEER_DELEGATION_LIFETIME_MS} when omitted, never more. */
  readonly lifetimeMs?: number | undefined;
  /** A bound the expiry never passes (the token it is derived from expires then). */
  readonly notAfter?: number | undefined;
}

/**
 * Issue a delegation. Throws on a malformed key, route, user id, depth
 * beyond {@link PEER_DELEGATION_MAX_DEPTH}, or a lifetime that leaves
 * nothing — a mistake in the relay, never sent.
 */
export function signPeerDelegation(input: SignPeerDelegationInput, key: PeerDelegationKey): string {
  if (!isPeerDelegationKey(key)) throw new Error('Invalid delegation key');
  const depth = input.depth ?? 0;
  if (!isPeerRoute(input.holder) || !isPeerRoute(input.root)) {
    throw new Error('Invalid plugin route in a delegation');
  }
  if (!isIdentityUuid(input.userId)) throw new Error('Invalid user id in a delegation');
  if (!isInt(depth) || depth < 0 || depth > PEER_DELEGATION_MAX_DEPTH) {
    throw new Error('Invalid delegation depth');
  }
  const iat = input.iat ?? Date.now();
  const lifetime = Math.min(
    input.lifetimeMs ?? PEER_DELEGATION_LIFETIME_MS,
    PEER_DELEGATION_LIFETIME_MS,
  );
  const exp = Math.min(iat + lifetime, input.notAfter ?? Number.MAX_SAFE_INTEGER);
  if (!isInt(iat) || !isInt(exp) || exp <= iat) throw new Error('A delegation must live');
  const payload: PeerDelegationPayload = {
    v: PEER_DELEGATION_VERSION,
    typ: PEER_DELEGATION_TYPE,
    kid: key.kid,
    holder: input.holder,
    root: input.root,
    userId: input.userId,
    depth,
    iat,
    exp,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  return `${encoded}.${mac(key, encoded).toString('base64url')}`;
}

export interface VerifyPeerDelegationOptions {
  /** The keys accepted: the current one and the previous one. */
  readonly keys: readonly PeerDelegationKey[];
  /** The plugin presenting the token — the consumer whose channel carried it. */
  readonly holder: string;
  readonly now?: number | undefined;
}

/**
 * Verify a delegation a plugin presented. Checks, in order: shape, key,
 * signature (constant time), issue time, expiry, holder, depth. Says only
 * why it failed, never echoing the token.
 */
export function verifyPeerDelegation(
  token: unknown,
  opts: VerifyPeerDelegationOptions,
): VerifyPeerDelegationResult {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: 'malformed' };
  }
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return { ok: false, reason: 'malformed' };
  const encoded = token.slice(0, dot);
  const signature = Buffer.from(token.slice(dot + 1), 'base64url');
  if (signature.length !== 32) return { ok: false, reason: 'malformed' };
  const payload = parsePayload(encoded);
  if (!payload) return { ok: false, reason: 'malformed' };
  const key = opts.keys.find((k) => isPeerDelegationKey(k) && k.kid === payload.kid);
  if (!key) return { ok: false, reason: 'unknown_key' };
  if (!crypto.timingSafeEqual(mac(key, encoded), signature)) {
    return { ok: false, reason: 'bad_signature' };
  }
  const now = opts.now ?? Date.now();
  if (payload.iat > now + PEER_DELEGATION_CLOCK_SKEW_MS) return { ok: false, reason: 'future' };
  if (payload.exp <= now) return { ok: false, reason: 'expired' };
  if (payload.holder !== opts.holder) return { ok: false, reason: 'wrong_holder' };
  if (payload.depth > PEER_DELEGATION_MAX_DEPTH) return { ok: false, reason: 'too_deep' };
  return { ok: true, payload };
}

/**
 * The token a provider receives with a call that carried a user, for its
 * own onward calls: `holder` the provider, the same `root` and user,
 * `depth` + 1, expiring no later than `parent`. Null when that would go
 * deeper than {@link PEER_DELEGATION_MAX_DEPTH} — the provider then calls
 * onward only as itself.
 */
export function onwardPeerDelegation(
  parent: PeerDelegationPayload,
  holder: string,
  key: PeerDelegationKey,
  now: number = Date.now(),
): string | null {
  if (parent.depth + 1 > PEER_DELEGATION_MAX_DEPTH || parent.exp <= now) return null;
  return signPeerDelegation(
    {
      holder,
      root: parent.root,
      userId: parent.userId,
      depth: parent.depth + 1,
      iat: now,
      notAfter: parent.exp,
    },
    key,
  );
}
