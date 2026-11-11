/**
 * A consumer's own edges — the wire contract between the relay and a
 * consumer's agent half (4.14.1): which of the scopes the half's approved
 * version consumes are granted to it now, so a half that may use one of
 * several providers knows which one before it calls.
 *
 * `POST /.lamaste/edges` on the consumer's peer channel:
 * {@link PeerEdgesRequest} → {@link PeerEdgesAnswer}. The relay answers at
 * once when the half's `digest` is not the current list's (or it sent
 * none, or `waitMs` is 0); otherwise it holds the request until the list
 * changes or `waitMs` passes, and answers the list as it is then. A half
 * reads on every attach and keeps one such request open.
 *
 * An entry is **effective** when an applied shelf grants the edge and both
 * sides' installed, approved versions agree on it — what lets the half
 * call the scope. It says nothing of the provider's health: a call to an
 * effective scope may still be answered `peer_unavailable`.
 */

import crypto from 'node:crypto';

import {
  PEER_CONSUMED_SCOPES_MAX,
  PEER_EVENTS_MAX,
  isPeerEventType,
  isPeerScope,
} from './peers.js';

/** The longest an edges request is held, waiting for a change. */
export const PEER_EDGES_WAIT_MAX_MS = 25_000;

/** The largest edges request a consumer sends on its channel. */
export const PEER_EDGES_REQUEST_MAX_BYTES = 1024;

/** The largest edges answer a consumer accepts. */
export const PEER_EDGES_ANSWER_MAX_BYTES = 256 * 1024;

/**
 * Why a consumed scope is not effective. `not_granted`: no applied shelf
 * grants it. The others: an applied grant is pending because the
 * provider is not installed, does not provide the scope (in its approved
 * version), is disabled or not approved, the majors do not meet, or the
 * consumer itself is not installed, disabled or not approved.
 * A newer relay may name a reason not listed here.
 */
export const PEER_EDGE_REASONS = [
  'not_granted',
  'provider_not_installed',
  'not_provided',
  'provider_disabled',
  'provider_not_approved',
  'major_mismatch',
  'consumer_not_installed',
  'not_consumed',
  'consumer_disabled',
  'consumer_not_approved',
] as const;

export type PeerEdgeReason = (typeof PEER_EDGE_REASONS)[number];

/** One scope the consumer's approved version consumes, and whether it may call it now. */
export interface PeerEdge {
  readonly scope: string;
  /** The provider's route (the scope's namespace). */
  readonly provider: string;
  /** The major the consumer speaks. */
  readonly major: number;
  /** Whether the consumer declares it cannot work without the scope. */
  readonly required: boolean;
  /** The event types the edge carries (both sides share them); empty when not effective. */
  readonly events: readonly string[];
  readonly effective: boolean;
  /** Null when effective; otherwise why not (see {@link PEER_EDGE_REASONS}). */
  readonly reason: string | null;
}

/** What a consumer sends: the digest of the list it holds (null: none) and how long to wait. */
export interface PeerEdgesRequest {
  readonly digest: string | null;
  readonly waitMs: number;
}

/** What the relay answers: the list (sorted by scope) and its digest. */
export interface PeerEdgesAnswer {
  readonly digest: string;
  readonly consumes: readonly PeerEdge[];
}

const DIGEST_RE = /^[0-9a-f]{64}$/;
const REASON_RE = /^[a-z][a-z0-9_]{0,63}$/;
const MAJOR_MAX = 999;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSmallInt(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

/** Sorted by scope, events sorted: the order the digest is taken in. */
function canonicalEdges(edges: readonly PeerEdge[]): PeerEdge[] {
  return [...edges]
    .map((e) => ({
      scope: e.scope,
      provider: e.provider,
      major: e.major,
      required: e.required,
      events: [...e.events].sort(),
      effective: e.effective,
      reason: e.effective ? null : e.reason,
    }))
    .sort((a, b) => (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0));
}

/** The relay's answer for a list of edges: canonical order and its SHA-256 digest. */
export function peerEdgesAnswer(edges: readonly PeerEdge[]): PeerEdgesAnswer {
  const consumes = canonicalEdges(edges);
  const digest = crypto.createHash('sha256').update(JSON.stringify(consumes)).digest('hex');
  return { digest, consumes };
}

/** An edges request as the relay reads it, or null. */
export function parsePeerEdgesRequest(raw: unknown): PeerEdgesRequest | null {
  if (!isRecord(raw)) return null;
  const { digest, waitMs } = raw;
  if (digest !== null && (typeof digest !== 'string' || !DIGEST_RE.test(digest))) return null;
  if (!isSmallInt(waitMs, PEER_EDGES_WAIT_MAX_MS)) return null;
  return { digest, waitMs };
}

function parseEdge(raw: unknown): PeerEdge | null {
  if (!isRecord(raw)) return null;
  const { scope, provider, major, required, events, effective, reason } = raw;
  if (!isPeerScope(scope)) return null;
  if (typeof provider !== 'string' || scope.split(':')[0] !== provider) return null;
  if (!isSmallInt(major, MAJOR_MAX) || major === 0) return null;
  if (typeof required !== 'boolean' || typeof effective !== 'boolean') return null;
  if (!Array.isArray(events) || events.length > PEER_EVENTS_MAX) return null;
  if (!events.every((t) => isPeerEventType(t))) return null;
  let why: string | null = null;
  if (effective) {
    if (reason !== null) return null;
  } else {
    if (typeof reason !== 'string' || !REASON_RE.test(reason)) return null;
    why = reason;
  }
  return { scope, provider, major, required, events: events as string[], effective, reason: why };
}

/**
 * An edges answer as the consumer reads it, or null: well formed, at most
 * one entry per scope, and its digest that of its list.
 */
export function parsePeerEdgesAnswer(raw: unknown): PeerEdgesAnswer | null {
  if (!isRecord(raw)) return null;
  const { digest, consumes } = raw;
  if (typeof digest !== 'string' || !DIGEST_RE.test(digest)) return null;
  if (!Array.isArray(consumes) || consumes.length > PEER_CONSUMED_SCOPES_MAX) return null;
  const edges: PeerEdge[] = [];
  const seen = new Set<string>();
  for (const entry of consumes) {
    const edge = parseEdge(entry);
    if (!edge || seen.has(edge.scope)) return null;
    seen.add(edge.scope);
    edges.push(edge);
  }
  const answer = peerEdgesAnswer(edges);
  if (answer.digest !== digest) return null;
  return answer;
}
