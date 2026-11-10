/**
 * What a verified peer call leaves on the request a provider is serving, so
 * that the provider's own onward calls (`peers.call(…, { from: request })`)
 * carry its hop count. Set by `peerRoute` (`peer-surface.ts`); read by the
 * consumer SDK (`peer-client.ts`).
 */

import type { PeerCallerIdentity } from '../caller-assertion.js';

/** A verified peer call being served. */
export interface PeerRequestContext {
  readonly caller: PeerCallerIdentity;
  /** The call's hop count (1 for a direct call). */
  readonly hops: number;
}

const contexts = new WeakMap<object, PeerRequestContext>();

/** Remember the verified peer call `request` serves. */
export function setPeerContext(request: object, context: PeerRequestContext): void {
  contexts.set(request, context);
}

/** The verified peer call `request` serves, or null (a user's request, or none). */
export function peerContextOf(request: object): PeerRequestContext | null {
  return contexts.get(request) ?? null;
}
