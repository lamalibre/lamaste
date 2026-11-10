/**
 * The peer gateway — what the relay does with a stream a consumer's agent
 * half opens on its peer channel (`peer-channel.ts`): a call to another
 * plugin's peer surface, or a pull of the events it subscribes to.
 *
 * The stream's consumer is the channel's: the relay dialled that consumer's
 * internal tunnel and the half proved itself with its installation secret,
 * so nothing on the stream names who calls — the gateway is told.
 *
 * **A call** (`:path` = the provider-relative path, `x-lamalibre-peer-scope`)
 * is decided in this order, each refusal a JSON answer of the relay's own
 * carrying `peer: { code }` and the `x-lamalibre-peer-relay` header:
 *
 * 1. the path in origin form, no unsafe segment (`hasUnsafePathSegments`),
 *    not one of the relay's own (`/.lamaste/`) — else `400 bad_path`;
 * 2. the hop count the SDK passed on, plus this one, at most
 *    `PEER_MAX_HOPS` — else `508 hop_limit`;
 * 3. an effective edge consumer → scope — else `403 not_granted`, the same
 *    answer for a malformed scope, an unknown one, a provider not installed
 *    and an edge not granted, so a refusal tells a consumer nothing of what
 *    is installed;
 * 4. an endpoint of the provider's approved declaration admitting the
 *    method and the raw path for the consumer's major
 *    (`matchPeerEndpoint`) — else `403 endpoint_not_allowed`;
 * 5. the delegation, when the call carries one — else `401
 *    delegation_invalid` or `403 user_not_entitled`;
 * 6. the provider hosted, active, up and peer-ready — else `503
 *    peer_unavailable` with its reason and `Retry-After`;
 * 7. the provider's declaration *now* still serving that endpoint in that
 *    major (an update between the edge check and here) — else `409
 *    version_mismatch`;
 * 8. a declared body within the provider's limit — else `413 too_large`;
 *    the provider's approved request hooks — `503 hooks_not_approved` while
 *    they may not run.
 *
 * Then the forwarding core (`forward-core.ts`) sends it to
 * `127.0.0.1:<provider port>/peer<path>` with a `peer` caller assertion —
 * the consumer, the scope, its major, the endpoint pattern matched (the
 * provider runs no other handler), the hop count and, on behalf of a person,
 * the user — signed with the provider's secret, runs the provider's request
 * hooks, and passes the answer back only once its responder signature
 * verifies.
 *
 * **An events pull** (`POST /.lamaste/events`) is the consumer asking for the
 * events of one scope after its cursor (`peer-events.ts`): the relay checks
 * the subscription, answers a gap when the cursor cannot be continued, and
 * otherwise asks the provider (`POST /admin/peers/events/pull`, Lamaste's
 * own call) and checks what comes back. Nothing is stored here.
 *
 * Every piece of state — edges, targets, readiness, delegations, the
 * directory — comes from the caller ({@link PeerGatewayOptions}); one
 * metadata line per stream: consumer, provider, scope, method, the
 * endpoint pattern, status, duration — never the path's parameters, the
 * query or a user.
 */

import type { Http2ServerRequest, Http2ServerResponse } from 'node:http2';

import { callAgentHalf } from '../agent-half-call.js';
import type { PeerCallerIdentity, PeerCallerUser } from '../caller-assertion.js';
import { isOriginFormPath } from '../caller-assertion.js';
import {
  AGENT_HALF_PEERS_EVENTS_PULL_PATH,
  PEER_CALL_TIMEOUT_DEFAULT_MS,
  PEER_CALL_TIMEOUT_MAX_MS,
  PEER_CHANNEL_EVENTS_PATH,
  PEER_CHANNEL_RELAY_PREFIX,
  PEER_DELEGATION_HEADER,
  PEER_EVENTS_PULL_MAX,
  PEER_EVENTS_WAIT_MAX_MS,
  PEER_HOPS_HEADER,
  PEER_MAX_HOPS,
  PEER_SCOPE_HEADER,
  PEER_TIMEOUT_HEADER,
  isPeerScope,
  matchPeerEndpoint,
  peerScopeProvider,
} from '../peers.js';
import type {
  PeerGapReason,
  PeerProvidedScope,
  PeerRelayCode,
  PeerUnavailableReason,
} from '../peers.js';
import { AGENT_HALF_PEER_PREFIX, hasUnsafePathSegments } from '../user-surface.js';
import {
  buildRequestHookPlan,
  forwardRequest,
  markPeerRelayAnswer,
  writeJson,
} from './forward-core.js';
import type {
  AgentForwardTarget,
  AgentForwardTimeouts,
  AgentForwarderLogger,
  ForwardOutcome,
  RequestHookPlan,
  RequestHookRuntime,
} from './forward-core.js';
import {
  PEER_EVENTS_ANSWER_MAX_BYTES,
  PEER_EVENTS_REQUEST_MAX_BYTES,
  parsePeerEventsPullAnswer,
  parsePeerEventsRequest,
} from '../peer-events.js';
import type { PeerEventsChannelAnswer } from '../peer-events.js';

type MaybePromise<T> = T | Promise<T>;

/** An effective edge consumer → scope, as the relay holds it (the provider's approved declaration). */
export interface PeerGatewayEdge {
  /** The provider's route (the scope's namespace). */
  readonly provider: string;
  /** The major the consumer's approved version speaks. */
  readonly major: number;
  /** The provider's approved declaration of the scope. */
  readonly provided: PeerProvidedScope;
}

/** Where a call to a provider goes, or why it cannot go there now. */
export type PeerProviderResolution =
  | {
      readonly kind: 'ok';
      readonly target: AgentForwardTarget;
      /** The provider's declaration of the scope as installed now (an update may have changed it). */
      readonly provided: PeerProvidedScope | null;
    }
  | { readonly kind: 'unavailable'; readonly reason: PeerUnavailableReason };

/** A delegation checked by the relay: the user to name, and the onward delegation, if any. */
export type PeerDelegationResolution =
  | {
      readonly ok: true;
      readonly user: PeerCallerUser;
      /** A delegation for the provider's own onward calls (it has an outgoing edge), or null. */
      readonly onward: string | null;
    }
  | {
      readonly ok: false;
      readonly code: 'delegation_invalid' | 'user_not_entitled';
    };

/** An effective subscription consumer ← scope: the types it receives and their epoch. */
export interface PeerGatewaySubscription {
  readonly provider: string;
  /** Sorted, non-empty: what both approved versions share and the edge grants. */
  readonly types: readonly string[];
  /** Changes when the edge is granted anew or the subscribed types change. */
  readonly epoch: string;
}

/** A refused call, for the caller's audit (`peer.call.denied`). */
export interface PeerCallDenial {
  readonly consumer: string;
  readonly scope: string | null;
  readonly code: PeerRelayCode;
}

export interface PeerGatewayOptions extends AgentForwardTimeouts {
  /** The effective edge consumer → scope, or null (not granted, unknown, not installed). */
  edge(consumer: string, scope: string): MaybePromise<PeerGatewayEdge | null>;
  /** The provider's forward target and its declaration of `scope` now, or why it is unavailable. */
  providerTarget(provider: string, scope: string): MaybePromise<PeerProviderResolution>;
  /**
   * Check a delegation a call carries: its signature, holder (`consumer`),
   * expiry and depth, the user's standing in the directory and in the root
   * plugin's audience, and that `provider` declares identity and holds the
   * user as an active member — the user to name, with their roles in the
   * provider.
   */
  resolveDelegation(input: {
    readonly consumer: string;
    readonly provider: string;
    readonly token: string;
  }): MaybePromise<PeerDelegationResolution>;
  /** The effective subscription consumer ← scope, or null (none granted or subscribed). */
  subscription(consumer: string, scope: string): MaybePromise<PeerGatewaySubscription | null>;
  /** The providers' request hooks; without it every call streams through untouched. */
  readonly hooks?: RequestHookRuntime | undefined;
  /** Called for every refusal (the caller rate-limits its audit). */
  onDenied?: ((denial: PeerCallDenial) => void) | undefined;
  readonly logger?: AgentForwarderLogger | undefined;
}

/** Seconds a consumer is told to wait before trying an unavailable provider again. */
const RETRY_AFTER_SECONDS = 10;

/** The relay's own answer to a stream: JSON, marked with its code. */
function refuse(
  res: Http2ServerResponse,
  status: number,
  code: PeerRelayCode,
  error: string,
  extra: Readonly<Record<string, unknown>> = {},
  headers: Readonly<Record<string, string>> = {},
): ForwardOutcome {
  if (!res.headersSent) {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  }
  markPeerRelayAnswer(res, code);
  writeJson(res, status, { error, ...extra, peer: { code } });
  return { status, error: code };
}

function headerOf(req: Http2ServerRequest, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** The hop count the SDK passed on: absent is 0; anything but a small integer is null. */
function hopsOf(req: Http2ServerRequest): number | null {
  const raw = headerOf(req, PEER_HOPS_HEADER);
  if (raw === undefined) return 0;
  if (!/^[0-9]{1,2}$/.test(raw)) return null;
  return Number(raw);
}

/** The headers timeout a call asked for, clamped to the protocol's bounds. */
function headersTimeoutOf(req: Http2ServerRequest): number {
  const raw = headerOf(req, PEER_TIMEOUT_HEADER);
  if (raw === undefined || !/^[0-9]{1,6}$/.test(raw)) return PEER_CALL_TIMEOUT_DEFAULT_MS;
  return Math.min(Math.max(Number(raw), 1_000), PEER_CALL_TIMEOUT_MAX_MS);
}

function pathPartOf(url: string): string {
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

/** Read a small body whole; null past `limit`. */
async function readSmallBody(req: Http2ServerRequest, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

/**
 * The gateway: a function the channel server calls with every stream and the
 * consumer its channel belongs to. Resolves once the stream is answered;
 * never throws (a failure is a `500 relay_error`).
 */
export function createPeerGateway(
  opts: PeerGatewayOptions,
): (req: Http2ServerRequest, res: Http2ServerResponse, consumer: string) => Promise<void> {
  const logger = opts.logger;

  function log(entry: {
    readonly consumer: string;
    readonly provider: string | null;
    readonly scope: string | null;
    readonly method: string;
    readonly endpoint: string | null;
    readonly startedAt: number;
    readonly outcome: ForwardOutcome;
    readonly plan?: RequestHookPlan | null;
    readonly user?: boolean;
  }): void {
    if (!logger) return;
    const { outcome, plan } = entry;
    const line = {
      consumer: entry.consumer,
      provider: entry.provider,
      scope: entry.scope,
      method: entry.method,
      endpoint: entry.endpoint,
      status: outcome.status,
      durationMs: Date.now() - entry.startedAt,
      ...(entry.user ? { onBehalfOfUser: true } : {}),
      ...(plan && (plan.pre.length > 0 || plan.post.length > 0)
        ? { hooks: { pre: plan.pre.length, post: plan.post.length } }
        : {}),
      ...(outcome.hook ? { hook: outcome.hook } : {}),
      ...(outcome.error ? { error: outcome.error } : {}),
    };
    if (outcome.error) logger.warn(line, 'Peer call not completed');
    else logger.info(line, 'Peer call forwarded');
  }

  function denied(consumer: string, scope: string | null, code: PeerRelayCode): void {
    try {
      opts.onDenied?.({ consumer, scope, code });
    } catch {
      // An audit that fails never fails the answer.
    }
  }

  async function handleCall(
    req: Http2ServerRequest,
    res: Http2ServerResponse,
    consumer: string,
    startedAt: number,
  ): Promise<void> {
    const method = req.method.toUpperCase();
    const url = req.url;
    const pathPart = pathPartOf(url);
    const rawScope = headerOf(req, PEER_SCOPE_HEADER) ?? '';
    const scope = isPeerScope(rawScope) ? rawScope : null;
    const done = (outcome: ForwardOutcome, extra: Partial<Parameters<typeof log>[0]> = {}): void =>
      log({
        consumer,
        provider: scope ? peerScopeProvider(scope) : null,
        scope,
        method,
        endpoint: null,
        startedAt,
        outcome,
        ...extra,
      });
    const deny = (
      status: number,
      code: PeerRelayCode,
      error: string,
      extra: Readonly<Record<string, unknown>> = {},
      headers: Readonly<Record<string, string>> = {},
    ): void => {
      denied(consumer, scope, code);
      done(refuse(res, status, code, error, extra, headers));
    };

    // 1. The path.
    if (
      !isOriginFormPath(url) ||
      hasUnsafePathSegments(pathPart) ||
      pathPart.startsWith(PEER_CHANNEL_RELAY_PREFIX)
    ) {
      return deny(400, 'bad_path', 'Not a path a provider can be called at');
    }
    // 2. Hops.
    const hops = hopsOf(req);
    if (hops === null) return deny(400, 'bad_request', 'Malformed hop count');
    if (hops + 1 > PEER_MAX_HOPS) {
      return deny(508, 'hop_limit', `A call goes at most ${PEER_MAX_HOPS} hops`);
    }
    // 3. The edge — one answer for every way of not having one.
    const notGranted = (): void => deny(403, 'not_granted', 'This plugin may not call that scope');
    if (!scope) return notGranted();
    const edge = await opts.edge(consumer, scope);
    if (!edge) return notGranted();
    const provider = edge.provider;
    // 4. The endpoint.
    const endpoint = matchPeerEndpoint(edge.provided, edge.major, method, url);
    if (endpoint === null) {
      return deny(403, 'endpoint_not_allowed', 'The provider does not offer that endpoint');
    }
    // 5. The delegation.
    let user: PeerCallerUser | null = null;
    let onward: string | null = null;
    const token = headerOf(req, PEER_DELEGATION_HEADER);
    if (token !== undefined) {
      const checked = await opts.resolveDelegation({ consumer, provider, token });
      if (!checked.ok) {
        return checked.code === 'delegation_invalid'
          ? deny(401, 'delegation_invalid', 'The delegation is not valid')
          : deny(403, 'user_not_entitled', 'The provider may not be called for this person');
      }
      user = checked.user;
      onward = checked.onward;
    }
    // 6. The provider.
    const resolved = await opts.providerTarget(provider, scope);
    if (resolved.kind === 'unavailable') {
      return deny(
        503,
        'peer_unavailable',
        'The provider is not available right now',
        { reason: resolved.reason },
        { 'retry-after': String(RETRY_AFTER_SECONDS) },
      );
    }
    // 7. An update since the edge was read.
    if (
      !resolved.provided ||
      matchPeerEndpoint(resolved.provided, edge.major, method, url) !== endpoint
    ) {
      return deny(409, 'version_mismatch', "The provider's API changed; try again");
    }
    const target = resolved.target;
    // 8. The body and the hooks.
    const declared = headerOf(req, 'content-length');
    if (declared !== undefined && Number(declared) > target.maxBodyBytes) {
      return deny(413, 'too_large', "Request body exceeds the provider's body limit", {
        maxBodyBytes: target.maxBodyBytes,
      });
    }
    const targetPath = `${AGENT_HALF_PEER_PREFIX}${url}`;
    let plan: RequestHookPlan | null = null;
    if (opts.hooks) {
      const built = await buildRequestHookPlan(opts.hooks, target.plugin, method, targetPath);
      if ('refuse' in built) {
        return deny(503, 'hooks_not_approved', built.refuse);
      }
      plan = built;
    }

    const caller: PeerCallerIdentity = {
      type: 'peer',
      peer: consumer,
      scope,
      major: edge.major,
      endpoint,
      hops: hops + 1,
      ...(user ? { user } : {}),
    };
    const outcome = await forwardRequest(
      { method, headers: req.headers, body: req },
      res,
      target,
      caller,
      targetPath,
      {
        headersTimeoutMs: headersTimeoutOf(req),
        ...(opts.bodyIdleTimeoutMs !== undefined
          ? { bodyIdleTimeoutMs: opts.bodyIdleTimeoutMs }
          : {}),
        ...(opts.connectTimeoutMs !== undefined ? { connectTimeoutMs: opts.connectTimeoutMs } : {}),
        ...(opts.host !== undefined ? { host: opts.host } : {}),
      },
      plan,
      'peer',
      onward !== null ? { [PEER_DELEGATION_HEADER]: onward } : {},
    );
    done(outcome, { provider, endpoint, plan, user: user !== null });
  }

  async function handleEvents(
    req: Http2ServerRequest,
    res: Http2ServerResponse,
    consumer: string,
    startedAt: number,
  ): Promise<void> {
    const answer = (
      status: number,
      body: PeerEventsChannelAnswer | Record<string, unknown>,
    ): void => {
      writeJson(res, status, body);
      log({
        consumer,
        provider: null,
        scope: null,
        method: 'EVENTS',
        endpoint: null,
        startedAt,
        outcome: { status },
      });
    };
    if (req.method.toUpperCase() !== 'POST') {
      return void refuse(res, 405, 'bad_request', 'Events are pulled with POST');
    }
    const raw = await readSmallBody(req, PEER_EVENTS_REQUEST_MAX_BYTES);
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw.toString('utf-8')) : null;
    } catch {
      parsed = null;
    }
    const pull = parsePeerEventsRequest(parsed);
    if (!pull) return void refuse(res, 400, 'bad_request', 'Malformed events pull');

    const subscription = await opts.subscription(consumer, pull.scope);
    if (!subscription) {
      denied(consumer, pull.scope, 'not_granted');
      return void refuse(res, 403, 'not_granted', 'This plugin receives no events of that scope');
    }
    const resolved = await opts.providerTarget(subscription.provider, pull.scope);
    if (resolved.kind === 'unavailable') {
      return void refuse(
        res,
        503,
        'peer_unavailable',
        'The provider is not available right now',
        { reason: resolved.reason },
        { 'retry-after': String(RETRY_AFTER_SECONDS) },
      );
    }
    const target = resolved.target;
    const providerPull = async (
      after: number,
      max: number,
      waitMs: number,
    ): Promise<ReturnType<typeof parsePeerEventsPullAnswer> | 'unreachable'> => {
      const result = await callAgentHalf({
        plugin: target.plugin,
        port: target.port,
        secret: target.secret,
        method: 'POST',
        path: AGENT_HALF_PEERS_EVENTS_PULL_PATH,
        body: { scope: pull.scope, types: subscription.types, after, max, waitMs },
        timeoutMs: waitMs + 10_000,
        maxResponseBytes: PEER_EVENTS_ANSWER_MAX_BYTES,
        ...(opts.host !== undefined ? { host: opts.host } : {}),
      });
      if (!result.ok || result.status !== 200) return 'unreachable';
      return parsePeerEventsPullAnswer(result.body, {
        scope: pull.scope,
        types: subscription.types,
        after,
      });
    };
    const gap = (reason: PeerGapReason, head: number, streamId: string): void =>
      answer(200, {
        gap: { reason, resumeFrom: head, epoch: subscription.epoch, streamId },
      });
    const unreachable = (): void =>
      void refuse(res, 502, 'provider_unreachable', 'The provider did not answer the pull');

    // A cursor that cannot be continued: learn the provider's head and answer a gap.
    const fresh =
      pull.after === null || pull.epoch !== subscription.epoch || pull.streamId === null;
    if (fresh) {
      const probe = await providerPull(0, 0, 0);
      if (probe === 'unreachable' || probe === null) return unreachable();
      const reason: PeerGapReason =
        pull.after === null || pull.epoch === null
          ? 'initial'
          : pull.epoch !== subscription.epoch
            ? subscriptionChangeReason(pull.epoch, subscription.epoch)
            : 'stream_changed';
      return gap(reason, probe.head, probe.streamId);
    }
    const after = pull.after as number;
    const waitMs = Math.min(pull.waitMs, PEER_EVENTS_WAIT_MAX_MS);
    const pulled = await providerPull(after, PEER_EVENTS_PULL_MAX, waitMs);
    if (pulled === 'unreachable' || pulled === null) return unreachable();
    if (pulled.streamId !== pull.streamId || after > pulled.head) {
      return gap('stream_changed', pulled.head, pulled.streamId);
    }
    if (after < pulled.horizon) return gap('horizon', pulled.head, pulled.streamId);
    answer(200, {
      to: pulled.to,
      head: pulled.head,
      epoch: subscription.epoch,
      streamId: pulled.streamId,
      events: pulled.events,
    });
  }

  return async (req, res, consumer) => {
    const startedAt = Date.now();
    try {
      if (pathPartOf(req.url) === PEER_CHANNEL_EVENTS_PATH) {
        await handleEvents(req, res, consumer, startedAt);
      } else {
        await handleCall(req, res, consumer, startedAt);
      }
    } catch (err: unknown) {
      logger?.warn(
        { consumer, error: err instanceof Error ? err.name : typeof err },
        'The peer gateway failed on a stream',
      );
      if (!res.headersSent) refuse(res, 500, 'relay_error', 'The relay failed on this call');
      else res.destroy();
    }
  };
}

/**
 * Why an epoch changed: the edge granted anew (its sequence part differs)
 * or the subscribed types changed. Epochs are `<granted seq>:<types digest>`
 * (`peerSubscriptionEpoch`); anything else reads as a new grant.
 */
function subscriptionChangeReason(before: string, now: string): PeerGapReason {
  const seqOf = (epoch: string): string => epoch.split(':')[0] ?? epoch;
  return seqOf(before) === seqOf(now) ? 'subscribed' : 'granted';
}
