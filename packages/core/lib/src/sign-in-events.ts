/**
 * Sign-in events for agent halves (packages/core/docs/native-apps-design.md
 * D7).
 *
 * A plugin whose `identity` block declares `signInEvents: true` is told
 * when one of its users signs in with a native client of the host that
 * serves it: the user, the time and the client. The panel queues each event
 * and sends it through the plugin's internal tunnel:
 *
 *     POST /admin/identity/sign-ins   { protocol: 1, from, to, events: sealed }
 *       → 200 { protocol: 1, acknowledged: <the last seq it holds> }
 *
 * `from`/`to` are the first and last `seq` of the batch (the panel's queue
 * order, per plugin). `events` travels sealed as identity changes do
 * (`identity-seal.ts`: AES-256-GCM under an HKDF key from the installation
 * secret, its own salt `lamaste/sign-in-events/v1`, bound to the plugin,
 * the assertion's nonce, `from` and `to`), so the tunnel's loopback ends
 * carry no user id in clear. Delivery is at least once: a half that
 * acknowledges a seq has every event up to it, and must take a repeated
 * event as the same one (same `seq`).
 */

import { z } from 'zod';

import { IDENTITY_PROTOCOL_VERSION, IDENTITY_UUID_REGEX } from './identity.js';
import {
  checkSealParties,
  openPluginJson,
  parseSealedIdentityChanges,
  sealPluginJson,
} from './identity-seal.js';
import type { SealedIdentityChanges } from './identity-seal.js';
import { isNativeClientId } from './native-apps.js';

/** Where an agent half receives sign-in events. */
export const AGENT_HALF_SIGN_IN_EVENTS_PATH = '/admin/identity/sign-ins';

/** The protocol of the call (the identity feed's). */
export const SIGN_IN_EVENTS_PROTOCOL_VERSION = IDENTITY_PROTOCOL_VERSION;

/** The most events one call carries. */
export const SIGN_IN_EVENTS_BATCH_MAX = 200;

/** The largest call body. */
export const SIGN_IN_EVENTS_MAX_BYTES = 256 * 1024;

/** How long an event waits for its half before the panel drops it, in milliseconds. */
export const SIGN_IN_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const SEAL_SALT = Buffer.from('lamaste/sign-in-events/v1', 'utf-8');

/** The client a person signed in with. */
export const SignInClientSchema = z
  .object({
    kind: z.literal('native'),
    clientId: z.string().refine(isNativeClientId, { message: 'Not a native client id' }),
  })
  .strict();

/** One sign-in, as the half receives it. */
export const SignInEventSchema = z
  .object({
    seq: z.number().int().positive(),
    userId: z.string().regex(IDENTITY_UUID_REGEX),
    /** ISO 8601, UTC. */
    at: z.string().datetime({ offset: false }),
    client: SignInClientSchema,
  })
  .strict();

export type SignInEvent = z.output<typeof SignInEventSchema>;

/** What the sealed events are bound to besides the request. */
export interface SignInEventsEnvelope {
  readonly from: number;
  readonly to: number;
}

/** The call's body as it travels. */
export interface SignInEventsWire {
  readonly protocol: typeof SIGN_IN_EVENTS_PROTOCOL_VERSION;
  readonly from: number;
  readonly to: number;
  readonly events: SealedIdentityChanges;
}

function aad(plugin: string, nonce: string, envelope: SignInEventsEnvelope): Buffer {
  return Buffer.from(JSON.stringify([plugin, nonce, envelope.from, envelope.to]), 'utf-8');
}

function checkEnvelope(envelope: SignInEventsEnvelope): void {
  if (
    typeof envelope !== 'object' ||
    envelope === null ||
    !Number.isSafeInteger(envelope.from) ||
    !Number.isSafeInteger(envelope.to) ||
    envelope.from < 1 ||
    envelope.to < envelope.from
  ) {
    throw new Error('Sealed sign-in events are bound to a batch envelope');
  }
}

/**
 * Seal a batch's events for one request: the events must lie in
 * `[from, to]` in ascending order, at most {@link SIGN_IN_EVENTS_BATCH_MAX}.
 */
export function sealSignInEvents(input: {
  readonly secret: string;
  readonly plugin: string;
  readonly nonce: string;
  readonly envelope: SignInEventsEnvelope;
  readonly events: readonly SignInEvent[];
}): SealedIdentityChanges {
  checkSealParties(input.secret, input.plugin, input.nonce);
  checkEnvelope(input.envelope);
  if (!eventsFitEnvelope(input.events, input.envelope)) {
    throw new Error('Sign-in events do not fit their envelope');
  }
  return sealPluginJson(
    input.secret,
    input.plugin,
    SEAL_SALT,
    aad(input.plugin, input.nonce, input.envelope),
    input.events,
  );
}

/**
 * Open a batch's events (the parsed JSON — {@link parseSignInEvents} checks
 * it). Throws, without the events, when they were sealed for another
 * plugin, request or envelope, or altered.
 */
export function openSignInEvents(input: {
  readonly secret: string;
  readonly plugin: string;
  readonly nonce: string;
  readonly envelope: SignInEventsEnvelope;
  readonly sealed: SealedIdentityChanges;
}): unknown {
  checkSealParties(input.secret, input.plugin, input.nonce);
  checkEnvelope(input.envelope);
  return openPluginJson(
    input.secret,
    input.plugin,
    SEAL_SALT,
    aad(input.plugin, input.nonce, input.envelope),
    input.sealed,
    'The sign-in events could not be opened',
  );
}

function eventsFitEnvelope(
  events: readonly { readonly seq: number }[],
  envelope: SignInEventsEnvelope,
): boolean {
  if (events.length === 0 || events.length > SIGN_IN_EVENTS_BATCH_MAX) return false;
  let previous = envelope.from - 1;
  for (const event of events) {
    if (event.seq <= previous || event.seq > envelope.to) return false;
    previous = event.seq;
  }
  return events[0]?.seq === envelope.from && previous === envelope.to;
}

/**
 * The call's body as it travels, checked: protocol 1, integer `from ≤ to`,
 * the sealed form, nothing else. Null for anything else.
 */
export function parseSignInEventsWire(raw: unknown): SignInEventsWire | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).length !== 4) return null;
  const { protocol, from, to, events } = r;
  if (protocol !== SIGN_IN_EVENTS_PROTOCOL_VERSION) return null;
  if (typeof from !== 'number' || typeof to !== 'number') return null;
  try {
    checkEnvelope({ from, to });
  } catch {
    return null;
  }
  const sealed = parseSealedIdentityChanges(events);
  if (!sealed) return null;
  return { protocol, from, to, events: sealed };
}

/**
 * Opened events, checked against their envelope: each one the contract,
 * `seq` ascending from `from` to `to`. Null for anything else.
 */
export function parseSignInEvents(
  raw: unknown,
  envelope: SignInEventsEnvelope,
): SignInEvent[] | null {
  const parsed = z.array(SignInEventSchema).safeParse(raw);
  if (!parsed.success) return null;
  return eventsFitEnvelope(parsed.data, envelope) ? parsed.data : null;
}
