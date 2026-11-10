/**
 * Peers — calls and events between agent-hosted app plugins.
 *
 * A plugin's manifest declares, in its `peers` block ({@link PeersBlockSchema}),
 * the scopes it **provides** — endpoints on its agent half's peer surface
 * (`/peer/*`), the API majors it serves and the events it publishes — and
 * the scopes it **consumes**, with the major it speaks and the events it
 * subscribes to. A scope is `<route>:<name>`: a plugin provides only scopes
 * of its own route (as capabilities are namespaced), so a scope names its
 * provider ({@link peerScopeProvider}).
 *
 * Whether a consumer may call a scope is the relay's decision, along the
 * edges an applied shelf grants; which endpoint a call may reach is this
 * module's: {@link matchPeerEndpoint} matches a request against the
 * provider's declaration and answers the endpoint *pattern* it matched. The
 * relay puts that pattern into the `peer` caller assertion
 * (`caller-assertion.ts`), and the provider's SDK refuses a request whose
 * own route is not that pattern ({@link peerEndpointAdmitsRoute}) — so an
 * allowlisted `GET /units/:unitId` can never run the provider's
 * `/units/export`, which the same path also matches.
 *
 * Matching errs towards refusing (request hooks err the other way): it runs
 * on the raw path, case-sensitive; a literal segment matches only byte for
 * byte (no `%`-escape can spell one); a `:name` or final `*` segment may
 * carry escapes, but none that `hasUnsafePathSegments` refuses; empty
 * segments (`//`, a trailing `/`) match nothing. When several endpoints
 * match, the most specific wins — per segment a literal before a parameter
 * before `*` — which is how the provider's router (find-my-way) picks
 * among its routes too.
 *
 * The block enters the plugin's approval digest when present (`hook-set.ts`;
 * a plugin without it keeps its digest), and an update that widens it waits
 * for an administrator ({@link peersDiff}'s `widened` — `peers.changed`).
 *
 * See `plugin-development/design/agent-hosted-app-plugins.md`, "Slice 8".
 */

import { z } from 'zod';

import { displayText } from './plugin-settings.js';
import {
  AGENT_HALF_PEER_PREFIX,
  hasUnsafePathSegments,
  isAgentHalfPeerPath,
} from './user-surface.js';

// ---------------------------------------------------------------------------
// Protocol: paths, headers and limits
// ---------------------------------------------------------------------------

/** The version of the peers protocol a half answers on `GET /admin/peers`. */
export const PEER_PROTOCOL_VERSION = 1 as const;

/** The agent half's Lamaste routes for peers; the forwarder never reaches anything under it. */
export const AGENT_HALF_PEERS_PREFIX = '/admin/peers';

/** `GET`: the half's peers readiness (`{ protocol, consumer, outbox, inbox }`). */
export const AGENT_HALF_PEERS_PATH = AGENT_HALF_PEERS_PREFIX;

/** `GET` with `Upgrade`: the relay attaches the consumer's peer channel. */
export const AGENT_HALF_PEERS_ATTACH_PATH = `${AGENT_HALF_PEERS_PREFIX}/attach`;

/** `POST`: the relay pulls a provider's events. */
export const AGENT_HALF_PEERS_EVENTS_PULL_PATH = `${AGENT_HALF_PEERS_PREFIX}/events/pull`;

/** The `Upgrade` token of the peer channel. */
export const PEER_CHANNEL_UPGRADE = 'lamaste-peers/1';

/**
 * Paths on the peer channel that are the relay's own (events), never a
 * provider's: a provider-relative call path never starts with it.
 */
export const PEER_CHANNEL_RELAY_PREFIX = '/.lamaste/';

/** `POST` on the peer channel: the consumer pulls a scope's events. */
export const PEER_CHANNEL_EVENTS_PATH = `${PEER_CHANNEL_RELAY_PREFIX}events`;

/** Request header of a call on the channel: the scope called. */
export const PEER_SCOPE_HEADER = 'x-lamalibre-peer-scope';

/** Request header of a call on the channel: the hop count of the request the caller is handling. */
export const PEER_HOPS_HEADER = 'x-lamalibre-peer-hops';

/** Request header of a call on the channel: how long to wait for the provider's headers, in ms. */
export const PEER_TIMEOUT_HEADER = 'x-lamalibre-peer-timeout';

/** A delegation (`peer-delegation.ts`): to a half with a user's request, from a half with a call. */
export const PEER_DELEGATION_HEADER = 'x-lamalibre-delegation';

/**
 * The header the relay sets on every answer it gives a peer call itself — a
 * refusal or a failure to reach the provider — with its code
 * ({@link PeerRelayCode}): the SDK tells the relay's answers from the
 * provider's own by it. A provider cannot send it: the relay strips every
 * `x-lamalibre-*` header of a forwarded answer.
 */
export const PEER_RELAY_HEADER = 'x-lamalibre-peer-relay';

/**
 * What the relay answers a peer call with when it does not pass on the
 * provider's answer: refusals (`bad_path`, `hop_limit`, `not_granted`,
 * `endpoint_not_allowed`, `delegation_invalid`, `user_not_entitled`,
 * `version_mismatch`, `too_large`, `peer_unavailable`, `hooks_not_approved`,
 * `hook_rejected`, `hook_failed`) and failures of the forward itself
 * (`provider_unreachable`, `provider_unauthenticated`, `timeout`,
 * `relay_error`).
 */
export const PEER_RELAY_CODES = [
  'bad_path',
  'bad_request',
  'hop_limit',
  'not_granted',
  'endpoint_not_allowed',
  'delegation_invalid',
  'user_not_entitled',
  'version_mismatch',
  'too_large',
  'peer_unavailable',
  'hooks_not_approved',
  'hook_rejected',
  'hook_failed',
  'provider_unreachable',
  'provider_unauthenticated',
  'timeout',
  'relay_error',
] as const;

export type PeerRelayCode = (typeof PEER_RELAY_CODES)[number];

/** Why a provider is not available to a peer call or an events pull right now. */
export const PEER_UNAVAILABLE_REASONS = [
  'not_hosted',
  'down_tunnel',
  'down_app',
  'not_ready',
] as const;

export type PeerUnavailableReason = (typeof PEER_UNAVAILABLE_REASONS)[number];

/** Why an events pull answers a gap instead of events (`resumeFrom` is the provider's head). */
export const PEER_GAP_REASONS = [
  'initial',
  'granted',
  'subscribed',
  'stream_changed',
  'horizon',
] as const;

export type PeerGapReason = (typeof PEER_GAP_REASONS)[number];

/** A call never goes further than this many hops from the request that started it. */
export const PEER_MAX_HOPS = 4;

/** How long a call waits for the provider's headers unless it asks otherwise. */
export const PEER_CALL_TIMEOUT_DEFAULT_MS = 30_000;

/** The longest a call may ask to wait for the provider's headers. */
export const PEER_CALL_TIMEOUT_MAX_MS = 120_000;

/** Concurrent streams on one peer channel. */
export const PEER_CHANNEL_MAX_STREAMS = 64;

/** The largest header list of a stream on the peer channel. */
export const PEER_CHANNEL_MAX_HEADER_LIST_BYTES = 16 * 1024;

/** The relay pings a channel this often… */
export const PEER_CHANNEL_PING_INTERVAL_MS = 20_000;

/** …and closes it when an answer takes longer than this. */
export const PEER_CHANNEL_PING_TIMEOUT_MS = 10_000;

/** How long a call made while the channel is detached waits for the relay to attach. */
export const PEER_ATTACH_WAIT_MS = 5_000;

/** The relay's reattach backoff: from this… */
export const PEER_REATTACH_MIN_MS = 1_000;

/** …doubling up to this. */
export const PEER_REATTACH_MAX_MS = 30_000;

/** The largest `data` of one event, as JSON. */
export const PEER_EVENT_DATA_MAX_BYTES = 16 * 1024;

/** At most this many events in one pull… */
export const PEER_EVENTS_PULL_MAX = 256;

/** …and at most this many bytes of them. */
export const PEER_EVENTS_PULL_MAX_BYTES = 1024 * 1024;

/** The longest a pull holds, waiting for an event. */
export const PEER_EVENTS_WAIT_MAX_MS = 25_000;

/** How long a provider's outbox keeps events unless it says otherwise. */
export const PEER_OUTBOX_RETENTION_DEFAULT_DAYS = 7;

// ---------------------------------------------------------------------------
// Formats and manifest limits
// ---------------------------------------------------------------------------

/** `<namespace>:<name>`, both DNS-label shaped, lower case, 1–32 characters (Shelf's `SCOPE_KEY_RE`). */
export const PEER_SCOPE_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?:[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

/** An event type: dot-separated words of lower-case letters, digits and `-`, each starting with a letter. */
export const PEER_EVENT_TYPE_RE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;

export const PEER_EVENT_TYPE_MAX_LENGTH = 64;

/** A plugin route (manifest `name` of a plugin with an agent half). */
const ROUTE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** The methods an endpoint may declare; `GET` also admits `HEAD`. */
export const PEER_ENDPOINT_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export type PeerEndpointMethod = (typeof PEER_ENDPOINT_METHODS)[number];

export const PEER_ENDPOINT_PATH_MAX_LENGTH = 200;
export const PEER_PROVIDED_SCOPES_MAX = 32;
export const PEER_CONSUMED_SCOPES_MAX = 64;
export const PEER_ENDPOINTS_MAX = 64;
export const PEER_EVENTS_MAX = 64;
export const PEER_MAJOR_MAX = 999;
export const PEER_MAJORS_MAX = 8;

/** Whether `value` is a well-formed scope key. */
export function isPeerScope(value: unknown): value is string {
  return typeof value === 'string' && PEER_SCOPE_RE.test(value);
}

/** Whether `value` is a well-formed event type. */
export function isPeerEventType(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= PEER_EVENT_TYPE_MAX_LENGTH &&
    PEER_EVENT_TYPE_RE.test(value)
  );
}

/** Whether `value` is an API major: an integer from 1 to {@link PEER_MAJOR_MAX}. */
export function isPeerMajor(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= PEER_MAJOR_MAX
  );
}

/** Whether `value` is a plugin route as a peer caller names one. */
export function isPeerRoute(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100 && ROUTE_RE.test(value);
}

/** The route of the plugin that provides `scope` — its namespace. Throws on a malformed scope. */
export function peerScopeProvider(scope: string): string {
  if (!isPeerScope(scope)) throw new Error(`Invalid peer scope: "${scope}"`);
  return scope.slice(0, scope.indexOf(':'));
}

// ---------------------------------------------------------------------------
// Endpoint patterns
// ---------------------------------------------------------------------------

/** One segment of an endpoint pattern. */
export type PeerPatternSegment =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'param'; readonly name: string }
  | { readonly kind: 'rest' };

const LITERAL_SEGMENT_RE = /^[A-Za-z0-9._~-]+$/;
const PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * Parse an endpoint path (`/units/:unitId`, `/files/*`): origin form, at
 * most {@link PEER_ENDPOINT_PATH_MAX_LENGTH} characters, no query, one or
 * more segments, each a literal (`[A-Za-z0-9._~-]+`, not `.` or `..`), a
 * `:name` parameter (names not repeated) or — last only — `*`. Returns the
 * segments, or a message saying why it is not one.
 */
export function parsePeerEndpointPath(
  path: string,
): readonly PeerPatternSegment[] | { readonly error: string } {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > PEER_ENDPOINT_PATH_MAX_LENGTH
  ) {
    return { error: `An endpoint path is 1–${PEER_ENDPOINT_PATH_MAX_LENGTH} characters` };
  }
  if (!path.startsWith('/')) return { error: 'An endpoint path starts with /' };
  const raw = path.slice(1).split('/');
  const segments: PeerPatternSegment[] = [];
  const names = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const segment = raw[i] ?? '';
    if (segment === '*') {
      if (i !== raw.length - 1) return { error: '* is only valid as the last segment' };
      segments.push({ kind: 'rest' });
    } else if (segment.startsWith(':')) {
      const name = segment.slice(1);
      if (!PARAM_NAME_RE.test(name)) return { error: `Invalid parameter "${segment}"` };
      if (names.has(name)) return { error: `Parameter "${segment}" is repeated` };
      names.add(name);
      segments.push({ kind: 'param', name });
    } else if (LITERAL_SEGMENT_RE.test(segment) && segment !== '.' && segment !== '..') {
      segments.push({ kind: 'literal', value: segment });
    } else {
      return {
        error: `Invalid path segment "${segment}" (letters, digits, . _ ~ -, a :name, or a final *)`,
      };
    }
  }
  return segments;
}

/**
 * The shape of a pattern: parameters spelled `:`, so `/a/:x` and `/a/:y` —
 * which route alike — share one. Two endpoints of a scope with the same
 * method and shape are one endpoint declared twice.
 */
function shapeOf(segments: readonly PeerPatternSegment[]): string {
  return segments
    .map((s) => (s.kind === 'literal' ? s.value : s.kind === 'param' ? ':' : '*'))
    .join('/');
}

/**
 * The raw segments of a request path (no query) a pattern may be matched
 * against, or null when it can match none: not origin form, an unsafe
 * segment (`hasUnsafePathSegments`), or an empty segment.
 */
function requestSegments(rawPath: string): string[] | null {
  const query = rawPath.indexOf('?');
  const pathPart = query === -1 ? rawPath : rawPath.slice(0, query);
  if (!pathPart.startsWith('/') || pathPart.startsWith('//')) return null;
  if (hasUnsafePathSegments(pathPart)) return null;
  const segments = pathPart.slice(1).split('/');
  if (segments.some((s) => s.length === 0)) return null;
  return segments;
}

/**
 * How specifically `pattern` matches `segments`: one rank per pattern
 * segment (0 literal, 1 parameter, 2 rest), or null when it does not match.
 */
function matchRanks(
  pattern: readonly PeerPatternSegment[],
  segments: readonly string[],
): number[] | null {
  const ranks: number[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const want = pattern[i];
    const have = segments[i];
    if (want === undefined || have === undefined) return null;
    if (want.kind === 'rest') {
      ranks.push(2);
      return ranks;
    }
    if (want.kind === 'literal') {
      if (want.value !== have) return null;
      ranks.push(0);
    } else {
      ranks.push(1);
    }
  }
  return segments.length === pattern.length ? ranks : null;
}

/** Negative when rank list `a` is more specific than `b`. */
function compareRanks(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return b.length - a.length;
}

function methodAdmits(declared: string, method: string): boolean {
  const m = method.toUpperCase();
  return m === declared || (declared === 'GET' && m === 'HEAD');
}

// ---------------------------------------------------------------------------
// Manifest block
// ---------------------------------------------------------------------------

const MajorsSchema = z
  .array(z.number().int().min(1).max(PEER_MAJOR_MAX))
  .min(1)
  .max(PEER_MAJORS_MAX)
  .refine((majors) => new Set(majors).size === majors.length, 'majors must not repeat');

const EventTypeSchema = z
  .string()
  .max(PEER_EVENT_TYPE_MAX_LENGTH)
  .regex(
    PEER_EVENT_TYPE_RE,
    'An event type is dot-separated words of lower-case letters, digits and hyphens, each starting with a letter (at most 64)',
  );

const EventListSchema = z
  .array(EventTypeSchema)
  .max(PEER_EVENTS_MAX)
  .refine((events) => new Set(events).size === events.length, 'events must not repeat');

export const PeerEndpointSchema = z
  .object({
    method: z.enum(PEER_ENDPOINT_METHODS),
    path: z.string().superRefine((path, ctx) => {
      const parsed = parsePeerEndpointPath(path);
      if ('error' in parsed) ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.error });
    }),
    /** The majors this endpoint is served in; omitted: every major of its scope. */
    majors: MajorsSchema.optional(),
  })
  .strict();

export const PeerProvidedScopeSchema = z
  .object({
    description: displayText(z.string().min(1).max(200)),
    /** The API majors the scope is served in. */
    majors: MajorsSchema.default([1]),
    endpoints: z.array(PeerEndpointSchema).min(1).max(PEER_ENDPOINTS_MAX),
    /** The event types the provider publishes under the scope. */
    events: EventListSchema.default([]),
  })
  .strict()
  .superRefine((scope, ctx) => {
    const seen = new Set<string>();
    scope.endpoints.forEach((endpoint, idx) => {
      for (const major of endpoint.majors ?? []) {
        if (!scope.majors.includes(major)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['endpoints', idx, 'majors'],
            message: `Major ${major} is not one of the scope's majors`,
          });
        }
      }
      const parsed = parsePeerEndpointPath(endpoint.path);
      if ('error' in parsed) return;
      const key = `${endpoint.method} ${shapeOf(parsed)}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endpoints', idx],
          message: `Endpoint "${endpoint.method} ${endpoint.path}" is declared twice`,
        });
      }
      seen.add(key);
    });
  });

export const PeerConsumedScopeSchema = z
  .object({
    /** Whether the plugin cannot work without the scope (Shelf refuses a shelf that leaves it out). */
    required: z.boolean(),
    reason: displayText(z.string().min(1).max(200)),
    /** The API major the plugin speaks. */
    major: z.number().int().min(1).max(PEER_MAJOR_MAX).default(1),
    /** The provider's event types the plugin subscribes to. */
    events: EventListSchema.default([]),
  })
  .strict();

const ScopeKeySchema = z
  .string()
  .regex(
    PEER_SCOPE_RE,
    'A scope is "<route>:<name>", both lower-case DNS labels of 1–32 characters',
  );

/**
 * The `peers` block of a manifest: what the plugin provides to other app
 * plugins and what it consumes from them. Only for an agent-hosted plugin
 * with an agent half (`ManifestSchema` checks that, and that a provided
 * scope is of the plugin's own route and a consumed one of another's).
 */
export const PeersBlockSchema = z
  .object({
    provides: z
      .record(ScopeKeySchema, PeerProvidedScopeSchema)
      .default({})
      .refine(
        (provides) => Object.keys(provides).length <= PEER_PROVIDED_SCOPES_MAX,
        `At most ${PEER_PROVIDED_SCOPES_MAX} provided scopes`,
      ),
    consumes: z
      .record(ScopeKeySchema, PeerConsumedScopeSchema)
      .default({})
      .refine(
        (consumes) => Object.keys(consumes).length <= PEER_CONSUMED_SCOPES_MAX,
        `At most ${PEER_CONSUMED_SCOPES_MAX} consumed scopes`,
      ),
  })
  .strict()
  .refine(
    (block) => Object.keys(block.provides).length + Object.keys(block.consumes).length > 0,
    'peers declares nothing: provide or consume at least one scope',
  );

export type PeersBlockInput = z.input<typeof PeersBlockSchema>;
export type PeersBlock = z.infer<typeof PeersBlockSchema>;
export type PeerProvidedScope = z.infer<typeof PeerProvidedScopeSchema>;
export type PeerConsumedScope = z.infer<typeof PeerConsumedScopeSchema>;
export type PeerEndpoint = z.infer<typeof PeerEndpointSchema>;

/**
 * Issues of a `peers` block against the plugin's route, for the manifest
 * schema: a provided scope must be of `route`, a consumed one of another
 * plugin. Paths are relative to the block.
 */
export function peersRouteIssues(
  block: PeersBlock,
  route: string,
): { readonly path: (string | number)[]; readonly message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  for (const scope of Object.keys(block.provides)) {
    if (peerScopeProvider(scope) !== route) {
      issues.push({
        path: ['provides', scope],
        message: `A plugin provides only scopes of its own route: "${scope}" must start with "${route}:"`,
      });
    }
  }
  for (const scope of Object.keys(block.consumes)) {
    if (peerScopeProvider(scope) === route) {
      issues.push({
        path: ['consumes', scope],
        message: `A plugin does not consume its own scope "${scope}"`,
      });
    }
  }
  return issues;
}

/** The canonical text of an endpoint: `"GET /units/:unitId"` — what a `peer` assertion names. */
export function peerEndpointKey(endpoint: Pick<PeerEndpoint, 'method' | 'path'>): string {
  return `${endpoint.method} ${endpoint.path}`;
}

/** Parse a {@link peerEndpointKey}; null when it is not one. */
export function parsePeerEndpointKey(
  key: unknown,
): { readonly method: PeerEndpointMethod; readonly path: string } | null {
  if (typeof key !== 'string') return null;
  const space = key.indexOf(' ');
  if (space <= 0) return null;
  const method = key.slice(0, space);
  const path = key.slice(space + 1);
  if (!(PEER_ENDPOINT_METHODS as readonly string[]).includes(method)) return null;
  if ('error' in parsePeerEndpointPath(path)) return null;
  return { method: method as PeerEndpointMethod, path };
}

/** The majors an endpoint of `scope` is served in. */
function endpointMajors(scope: PeerProvidedScope, endpoint: PeerEndpoint): readonly number[] {
  return endpoint.majors ?? scope.majors;
}

/**
 * The endpoint of a provided scope a request matches, for a consumer
 * speaking `major`: its {@link peerEndpointKey}, or null when none admits it
 * — the major is not served, no endpoint of that major admits the method,
 * or none matches the raw provider-relative path (see the module comment
 * for the rules). Several matching: the most specific.
 */
export function matchPeerEndpoint(
  scope: PeerProvidedScope,
  major: number,
  method: string,
  rawPath: string,
): string | null {
  if (!scope.majors.includes(major)) return null;
  const segments = requestSegments(rawPath);
  if (!segments) return null;
  let best: { key: string; ranks: number[] } | null = null;
  for (const endpoint of scope.endpoints) {
    if (!endpointMajors(scope, endpoint).includes(major)) continue;
    if (!methodAdmits(endpoint.method, method)) continue;
    const pattern = parsePeerEndpointPath(endpoint.path);
    if ('error' in pattern) continue;
    const ranks = matchRanks(pattern, segments);
    if (!ranks) continue;
    if (!best || compareRanks(ranks, best.ranks) < 0) {
      best = { key: peerEndpointKey(endpoint), ranks };
    }
  }
  return best ? best.key : null;
}

/**
 * Whether the provider's own route — the method of the request and the
 * pattern its router matched, as registered (`/peer/units/:id`, or without
 * the `/peer` prefix) — is the endpoint a `peer` assertion names. Parameter
 * names may differ (`:id` routes as `:unitId` does); a framework's `*`
 * wildcard is the final `*`. For the provider's SDK (`peerRoute`), which
 * refuses a request whose route is not the asserted endpoint.
 */
export function peerEndpointAdmitsRoute(
  endpointKey: string,
  method: string,
  routePattern: string,
): boolean {
  const endpoint = parsePeerEndpointKey(endpointKey);
  if (!endpoint || !methodAdmits(endpoint.method, method)) return false;
  let route = routePattern;
  if (isAgentHalfPeerPath(route)) route = route.slice(AGENT_HALF_PEER_PREFIX.length);
  const declared = parsePeerEndpointPath(endpoint.path);
  const registered = parsePeerEndpointPath(route);
  if ('error' in declared || 'error' in registered) return false;
  return shapeOf(declared) === shapeOf(registered);
}

/**
 * The block in the canonical form the approval digest covers: scopes by
 * key (the digest's canonical JSON sorts keys), endpoints by their key,
 * majors ascending, event lists sorted. Throws on a block that is not valid.
 */
export function normalizePeersBlock(block: PeersBlockInput): PeersBlock {
  const parsed = PeersBlockSchema.safeParse(block);
  if (!parsed.success) {
    throw new Error(
      `Not a valid peers block (${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')})`,
    );
  }
  const sortNumbers = (list: readonly number[]): number[] => [...list].sort((a, b) => a - b);
  const provides: Record<string, PeerProvidedScope> = {};
  for (const [scope, entry] of Object.entries(parsed.data.provides)) {
    provides[scope] = {
      description: entry.description,
      majors: sortNumbers(entry.majors),
      endpoints: entry.endpoints
        .map((e) => ({
          method: e.method,
          path: e.path,
          ...(e.majors !== undefined ? { majors: sortNumbers(e.majors) } : {}),
        }))
        .sort((a, b) => (peerEndpointKey(a) < peerEndpointKey(b) ? -1 : 1)),
      events: [...entry.events].sort(),
    };
  }
  const consumes: Record<string, PeerConsumedScope> = {};
  for (const [scope, entry] of Object.entries(parsed.data.consumes)) {
    consumes[scope] = {
      required: entry.required,
      reason: entry.reason,
      major: entry.major,
      events: [...entry.events].sort(),
    };
  }
  return { provides, consumes };
}

// ---------------------------------------------------------------------------
// Updates: what changed, and what it breaks
// ---------------------------------------------------------------------------

/** An endpoint served in one major of a scope. */
export interface PeerServedEndpoint {
  readonly scope: string;
  readonly major: number;
  readonly endpoint: string;
}

export interface PeerScopedEvent {
  readonly scope: string;
  readonly type: string;
}

/** What an update changes in a plugin's `peers` block. */
export interface PeersDiff {
  readonly provides: {
    readonly scopesAdded: readonly string[];
    readonly scopesRemoved: readonly string[];
    /** Endpoints newly served in a major (a new scope's, endpoint's or major's). */
    readonly endpointsAdded: readonly PeerServedEndpoint[];
    readonly endpointsRemoved: readonly PeerServedEndpoint[];
    readonly eventsAdded: readonly PeerScopedEvent[];
    readonly eventsRemoved: readonly PeerScopedEvent[];
  };
  readonly consumes: {
    readonly scopesAdded: readonly string[];
    readonly scopesRemoved: readonly string[];
    readonly majorsChanged: readonly {
      readonly scope: string;
      readonly from: number;
      readonly to: number;
    }[];
    readonly requiredChanged: readonly {
      readonly scope: string;
      readonly from: boolean;
      readonly to: boolean;
    }[];
    readonly subscriptionsAdded: readonly PeerScopedEvent[];
    readonly subscriptionsRemoved: readonly PeerScopedEvent[];
  };
  /**
   * Whether the update widens what the plugin reaches or exposes — a
   * consumed scope, a subscription or another consumed major; a provided
   * scope, endpoint, event or major — and so waits for an administrator
   * (`peers.changed`, never auto-approved). Narrowing only changes the
   * digest.
   */
  readonly widened: boolean;
}

function servedEndpoints(block: PeersBlock | null): Map<string, PeerServedEndpoint> {
  const out = new Map<string, PeerServedEndpoint>();
  for (const [scope, entry] of Object.entries(block?.provides ?? {})) {
    for (const endpoint of entry.endpoints) {
      for (const major of endpointMajors(entry, endpoint)) {
        const item = { scope, major, endpoint: peerEndpointKey(endpoint) };
        out.set(`${scope} ${major} ${item.endpoint}`, item);
      }
    }
  }
  return out;
}

function scopedEvents(
  entries: Record<string, { readonly events: readonly string[] }> | undefined,
): Map<string, PeerScopedEvent> {
  const out = new Map<string, PeerScopedEvent>();
  for (const [scope, entry] of Object.entries(entries ?? {})) {
    for (const type of entry.events) out.set(`${scope} ${type}`, { scope, type });
  }
  return out;
}

function added<T>(before: Map<string, T>, after: Map<string, T>): T[] {
  return [...after].filter(([key]) => !before.has(key)).map(([, value]) => value);
}

/** What changes from `before` to `after` (either may be absent), typed for the approval preview. */
export function peersDiff(
  before: PeersBlockInput | null | undefined,
  after: PeersBlockInput | null | undefined,
): PeersDiff {
  const b = before ? normalizePeersBlock(before) : null;
  const a = after ? normalizePeersBlock(after) : null;
  const keys = (record: Record<string, unknown> | undefined): Set<string> =>
    new Set(Object.keys(record ?? {}));
  const diffKeys = (x: Set<string>, y: Set<string>): string[] => [...y].filter((k) => !x.has(k));

  const providedBefore = keys(b?.provides);
  const providedAfter = keys(a?.provides);
  const endpointsBefore = servedEndpoints(b);
  const endpointsAfter = servedEndpoints(a);
  const eventsBefore = scopedEvents(b?.provides);
  const eventsAfter = scopedEvents(a?.provides);
  const consumedBefore = keys(b?.consumes);
  const consumedAfter = keys(a?.consumes);
  const subsBefore = scopedEvents(b?.consumes);
  const subsAfter = scopedEvents(a?.consumes);

  const majorsChanged: { scope: string; from: number; to: number }[] = [];
  const requiredChanged: { scope: string; from: boolean; to: boolean }[] = [];
  for (const scope of consumedAfter) {
    const was = b?.consumes[scope];
    const is = a?.consumes[scope];
    if (!was || !is) continue;
    if (was.major !== is.major) majorsChanged.push({ scope, from: was.major, to: is.major });
    if (was.required !== is.required) {
      requiredChanged.push({ scope, from: was.required, to: is.required });
    }
  }

  const diff = {
    provides: {
      scopesAdded: diffKeys(providedBefore, providedAfter),
      scopesRemoved: diffKeys(providedAfter, providedBefore),
      endpointsAdded: added(endpointsBefore, endpointsAfter),
      endpointsRemoved: added(endpointsAfter, endpointsBefore),
      eventsAdded: added(eventsBefore, eventsAfter),
      eventsRemoved: added(eventsAfter, eventsBefore),
    },
    consumes: {
      scopesAdded: diffKeys(consumedBefore, consumedAfter),
      scopesRemoved: diffKeys(consumedAfter, consumedBefore),
      majorsChanged,
      requiredChanged,
      subscriptionsAdded: added(subsBefore, subsAfter),
      subscriptionsRemoved: added(subsAfter, subsBefore),
    },
  };
  const widened =
    diff.provides.scopesAdded.length > 0 ||
    diff.provides.endpointsAdded.length > 0 ||
    diff.provides.eventsAdded.length > 0 ||
    diff.consumes.scopesAdded.length > 0 ||
    diff.consumes.majorsChanged.length > 0 ||
    diff.consumes.subscriptionsAdded.length > 0;
  return { ...diff, widened };
}

/** An effective edge into a provider: who consumes which of its scopes, in which major, subscribed to what. */
export interface PeerUsedEdge {
  readonly consumer: string;
  readonly scope: string;
  readonly major: number;
  readonly events: readonly string[];
}

/** One way an update of a provider would end or narrow an edge its consumers rely on. */
export type PeerBreak =
  | { readonly consumer: string; readonly scope: string; readonly reason: 'scope_removed' }
  | {
      readonly consumer: string;
      readonly scope: string;
      readonly reason: 'major_removed';
      readonly major: number;
    }
  | {
      readonly consumer: string;
      readonly scope: string;
      readonly reason: 'endpoints_removed';
      readonly major: number;
      readonly endpoints: readonly string[];
    }
  | {
      readonly consumer: string;
      readonly scope: string;
      readonly reason: 'events_removed';
      readonly events: readonly string[];
    };

/**
 * What an update of a provider from `before` to `after` breaks for the
 * edges in `used`: a scope gone, a consumer's major no longer served, an
 * endpoint no longer served in the consumer's major, a subscribed event no
 * longer published. An update that breaks anything is never auto-approved.
 */
export function peersBreaks(
  before: PeersBlockInput | null | undefined,
  after: PeersBlockInput | null | undefined,
  used: readonly PeerUsedEdge[],
): PeerBreak[] {
  const b = before ? normalizePeersBlock(before) : null;
  const a = after ? normalizePeersBlock(after) : null;
  const out: PeerBreak[] = [];
  for (const edge of used) {
    const was = b?.provides[edge.scope];
    if (!was) continue; // The edge was not effective before; nothing to break.
    const is = a?.provides[edge.scope];
    if (!is) {
      out.push({ consumer: edge.consumer, scope: edge.scope, reason: 'scope_removed' });
      continue;
    }
    if (was.majors.includes(edge.major) && !is.majors.includes(edge.major)) {
      out.push({
        consumer: edge.consumer,
        scope: edge.scope,
        reason: 'major_removed',
        major: edge.major,
      });
      continue;
    }
    const servedIn = (entry: PeerProvidedScope): Set<string> =>
      new Set(
        entry.endpoints
          .filter((e) => endpointMajors(entry, e).includes(edge.major))
          .map((e) => peerEndpointKey(e)),
      );
    const afterServed = servedIn(is);
    const lost = [...servedIn(was)].filter((key) => !afterServed.has(key));
    if (lost.length > 0) {
      out.push({
        consumer: edge.consumer,
        scope: edge.scope,
        reason: 'endpoints_removed',
        major: edge.major,
        endpoints: lost,
      });
    }
    const lostEvents = edge.events.filter((t) => was.events.includes(t) && !is.events.includes(t));
    if (lostEvents.length > 0) {
      out.push({
        consumer: edge.consumer,
        scope: edge.scope,
        reason: 'events_removed',
        events: lostEvents,
      });
    }
  }
  return out;
}
