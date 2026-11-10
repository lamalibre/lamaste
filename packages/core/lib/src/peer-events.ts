/**
 * Events between app plugins — the wire contract shared by the provider's
 * outbox, the relay and the consumer's inbox (design: slice 8, *Events*).
 *
 * A provider writes events into its **outbox** in the same transaction as
 * the change they describe; each gets a `seq` (increasing, gaps possible
 * where a transaction rolled back). Its outbox is one **stream**
 * (`streamId`, a UUID made with its tables — a replaced database is another
 * stream), pruned by age: `horizon` is the highest `seq` ever pruned (0
 * when none), so a cursor below it may have missed events.
 *
 * Two pulls carry them:
 *
 * - **relay → provider**, `POST /admin/peers/events/pull` (Lamaste's own
 *   call, the body hash bound, the answer signed over its body):
 *   {@link PeerEventsPullRequest} → {@link PeerEventsPullAnswer} — the
 *   events of one scope and some types after a `seq`, and `to`, the last
 *   `seq` examined (events of other scopes and types move a cursor too);
 * - **consumer → relay**, `POST /.lamaste/events` on the consumer's peer
 *   channel: {@link PeerEventsRequest} → {@link PeerEventsChannelAnswer} —
 *   events, or a **gap** when the consumer's cursor cannot be continued
 *   (first contact, a new or renewed grant, a new subscription, another
 *   stream, a cursor below the horizon). A gap's `resumeFrom` is the
 *   provider's head when the gap was answered: the consumer reconciles
 *   through the provider's endpoints, then continues from there.
 *
 * The relay stores neither events nor cursors: a subscription's **epoch**
 * ({@link peerSubscriptionEpoch}) is computed from the edge's grant and the
 * types it covers, and a consumer whose stored epoch differs starts over
 * with a gap — so it neither receives events from before its grant nor
 * misses the start of a new subscription silently.
 */

import crypto from 'node:crypto';

import {
  PEER_EVENTS_PULL_MAX,
  PEER_EVENTS_PULL_MAX_BYTES,
  PEER_EVENTS_WAIT_MAX_MS,
  PEER_EVENT_DATA_MAX_BYTES,
  PEER_GAP_REASONS,
  isPeerEventType,
  isPeerScope,
} from './peers.js';
import type { PeerGapReason } from './peers.js';

/** The largest events pull a consumer sends on its channel (it carries a cursor, not data). */
export const PEER_EVENTS_REQUEST_MAX_BYTES = 4 * 1024;

const STREAM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EPOCH_RE = /^[0-9]{1,15}:[0-9a-f]{16}$/;
const KEY_MAX_LENGTH = 200;

/** One event, as it leaves the outbox. */
export interface PeerEvent {
  readonly seq: number;
  readonly scope: string;
  readonly type: string;
  /** What the event is about (an id), for idempotent handlers; null when none. */
  readonly key: string | null;
  /** JSON, at most `PEER_EVENT_DATA_MAX_BYTES` serialized. */
  readonly data: unknown;
  /** When it was published (ISO 8601). */
  readonly at: string;
}

/** Relay → provider. */
export interface PeerEventsPullRequest {
  readonly scope: string;
  readonly types: readonly string[];
  readonly after: number;
  /** 0: no events, only the stream's position. */
  readonly max: number;
  readonly waitMs: number;
}

/** Provider → relay. */
export interface PeerEventsPullAnswer {
  readonly streamId: string;
  readonly head: number;
  readonly horizon: number;
  readonly to: number;
  readonly events: readonly PeerEvent[];
}

/** Consumer → relay. `after`, `epoch` and `streamId` are null before the first gap. */
export interface PeerEventsRequest {
  readonly scope: string;
  readonly after: number | null;
  readonly epoch: string | null;
  readonly streamId: string | null;
  readonly waitMs: number;
}

/** A gap: reconcile, then continue from `resumeFrom` with this epoch and stream. */
export interface PeerEventsGap {
  readonly reason: PeerGapReason;
  readonly resumeFrom: number;
  readonly epoch: string;
  readonly streamId: string;
}

/** Relay → consumer. */
export type PeerEventsChannelAnswer =
  | { readonly gap: PeerEventsGap }
  | {
      readonly to: number;
      readonly head: number;
      readonly epoch: string;
      readonly streamId: string;
      readonly events: readonly PeerEvent[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSeq(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Whether `value` is a stream id (a UUID v4, lower case). */
export function isPeerStreamId(value: unknown): value is string {
  return typeof value === 'string' && STREAM_ID_RE.test(value);
}

/** Whether `value` is an epoch as {@link peerSubscriptionEpoch} makes one. */
export function isPeerEpoch(value: unknown): value is string {
  return typeof value === 'string' && EPOCH_RE.test(value);
}

/**
 * A subscription's epoch: `<granted seq>:<16 hex of the SHA-256 of the
 * sorted types>` — a renewed grant (a new sequence) and a changed type set
 * both make another one.
 */
export function peerSubscriptionEpoch(grantedSeq: number, types: readonly string[]): string {
  if (!isSeq(grantedSeq)) throw new Error('A granted sequence is a non-negative integer');
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify([...new Set(types)].sort()))
    .digest('hex')
    .slice(0, 16);
  return `${grantedSeq}:${digest}`;
}

function isTypeList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 64 &&
    value.every(isPeerEventType) &&
    new Set(value).size === value.length
  );
}

/** A {@link PeerEventsPullRequest}, or null. */
export function parsePeerEventsPullRequest(raw: unknown): PeerEventsPullRequest | null {
  if (!isRecord(raw)) return null;
  const { scope, types, after, max, waitMs } = raw;
  if (!isPeerScope(scope) || !isTypeList(types) || !isSeq(after)) return null;
  if (!isSeq(max) || max > PEER_EVENTS_PULL_MAX) return null;
  if (!isSeq(waitMs) || waitMs > PEER_EVENTS_WAIT_MAX_MS) return null;
  return { scope, types: [...types], after, max, waitMs };
}

/** A {@link PeerEventsRequest}, or null. */
export function parsePeerEventsRequest(raw: unknown): PeerEventsRequest | null {
  if (!isRecord(raw)) return null;
  const { scope, after, epoch, streamId, waitMs } = raw;
  if (!isPeerScope(scope)) return null;
  if (after !== null && !isSeq(after)) return null;
  if (epoch !== null && !isPeerEpoch(epoch)) return null;
  if (streamId !== null && !isPeerStreamId(streamId)) return null;
  if (!isSeq(waitMs) || waitMs > PEER_EVENTS_WAIT_MAX_MS) return null;
  return { scope, after, epoch, streamId, waitMs };
}

/** One event as the wire carries it, or null. */
export function parsePeerEvent(raw: unknown): PeerEvent | null {
  if (!isRecord(raw)) return null;
  const { seq, scope, type, key, data, at } = raw;
  if (!isSeq(seq) || seq === 0 || !isPeerScope(scope) || !isPeerEventType(type)) return null;
  if (key !== null && (typeof key !== 'string' || key.length > KEY_MAX_LENGTH)) return null;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  if (data === undefined) return null;
  const size = Buffer.byteLength(JSON.stringify(data), 'utf-8');
  if (size > PEER_EVENT_DATA_MAX_BYTES) return null;
  return { seq, scope, type, key, data, at };
}

/** What a list of events must be against what was asked: ascending, past `after`, up to `to`, of the scope and types. */
function eventsFit(
  events: readonly PeerEvent[],
  expect: { readonly scope: string; readonly types: readonly string[]; readonly after: number },
  to: number,
): boolean {
  let last = expect.after;
  for (const event of events) {
    if (event.seq <= last || event.seq > to) return false;
    if (event.scope !== expect.scope || !expect.types.includes(event.type)) return false;
    last = event.seq;
  }
  return true;
}

/**
 * The provider's answer to a pull, checked against what was asked — the
 * scope, the types, the cursor — or null: a provider cannot hand a
 * consumer events of a scope or a type it was not asked for, out of order,
 * or past the position it reports.
 */
export function parsePeerEventsPullAnswer(
  raw: unknown,
  expect: { readonly scope: string; readonly types: readonly string[]; readonly after: number },
): PeerEventsPullAnswer | null {
  if (!isRecord(raw)) return null;
  const { streamId, head, horizon, to, events } = raw;
  if (!isPeerStreamId(streamId) || !isSeq(head) || !isSeq(horizon) || !isSeq(to)) return null;
  if (horizon > head || to > head || !Array.isArray(events)) return null;
  if (events.length > PEER_EVENTS_PULL_MAX) return null;
  const parsed: PeerEvent[] = [];
  for (const item of events) {
    const event = parsePeerEvent(item);
    if (!event) return null;
    parsed.push(event);
  }
  if (to < expect.after) return null;
  if (!eventsFit(parsed, expect, to)) return null;
  return { streamId, head, horizon, to, events: parsed };
}

/** The relay's answer to a consumer's pull, or null. */
export function parsePeerEventsChannelAnswer(
  raw: unknown,
  expect: { readonly scope: string; readonly after: number | null },
): PeerEventsChannelAnswer | null {
  if (!isRecord(raw)) return null;
  if (isRecord(raw['gap'])) {
    const { reason, resumeFrom, epoch, streamId } = raw['gap'];
    if (
      typeof reason !== 'string' ||
      !(PEER_GAP_REASONS as readonly string[]).includes(reason) ||
      !isSeq(resumeFrom) ||
      !isPeerEpoch(epoch) ||
      !isPeerStreamId(streamId)
    ) {
      return null;
    }
    return { gap: { reason: reason as PeerGapReason, resumeFrom, epoch, streamId } };
  }
  const { to, head, epoch, streamId, events } = raw;
  if (!isSeq(to) || !isSeq(head) || !isPeerEpoch(epoch) || !isPeerStreamId(streamId)) return null;
  if (!Array.isArray(events) || expect.after === null || to < expect.after) return null;
  const parsed: PeerEvent[] = [];
  let last = expect.after;
  for (const item of events) {
    const event = parsePeerEvent(item);
    if (!event || event.scope !== expect.scope || event.seq <= last || event.seq > to) return null;
    last = event.seq;
    parsed.push(event);
  }
  return { to, head, epoch, streamId, events: parsed };
}

/** The bytes a pull answer may carry, events included (the relay's response cap). */
export const PEER_EVENTS_ANSWER_MAX_BYTES = PEER_EVENTS_PULL_MAX_BYTES + 64 * 1024;
