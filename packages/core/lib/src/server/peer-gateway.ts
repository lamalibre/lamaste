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
 * Before any of it, the consumer must still qualify (`consumerAllowed`:
 * enabled, approved, hosted, up) — a channel the relay has not closed yet
 * carries nothing for a consumer that no longer does — else `403
 * not_granted`. A provider with `PEER_PROVIDER_MAX_IN_FLIGHT` calls open
 * answers `503 peer_unavailable` (`busy`).
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
 * own call) and checks what comes back — and checks the subscription again
 * before it answers, so nothing crosses after a revocation that landed
 * while the provider held the pull.
 *
 * **Floors.** Every gap the relay answers records the position it told the
 * consumer to resume from (`recordEventFloor`, per consumer and scope, with
 * the epoch and stream it was given for); a pull whose cursor is below the
 * floor of its epoch and stream, or names an epoch and stream the relay
 * never gave a gap for, is answered with a gap again. The epoch is no
 * secret, so without a floor a consumer could ask from an old cursor — or
 * from the horizon — and read what was published before its grant. A floor
 * is a number, not an event: the relay still stores no event.
 *
 * **Open answers** are tracked: each ends after `PEER_RESPONSE_MAX_MS`, a
 * call on behalf of a person when its delegation lapses, and every
 * `PEER_RESPONSE_SWEEP_MS` each is checked again (`recheck`: the edge still
 * effective, the consumer still qualifying, the person still active and
 * entitled) and ended when it is not.
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
  PEER_PROVIDER_MAX_IN_FLIGHT,
  PEER_RESPONSE_MAX_MS,
  PEER_RESPONSE_SWEEP_MS,
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
import type { PeerEventsChannelAnswer, PeerEventsRequest } from '../peer-events.js';

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
      /** The plugin the person used (the delegation's root). */
      readonly root: string;
      /** When the delegation lapses (ms since the epoch): the call's answer ends then. */
      readonly expiresAt: number;
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

/** A peer call whose answer is open, as {@link PeerGatewayOptions.recheck} sees it. */
export interface PeerOpenCall {
  readonly consumer: string;
  readonly provider: string;
  readonly scope: string;
  /** On behalf of a person: who, and the plugin they used. */
  readonly user: { readonly userId: string; readonly root: string } | null;
}

export interface PeerGatewayOptions extends AgentForwardTimeouts {
  /**
   * Whether `consumer` may use its channel at all now (installed, enabled,
   * approved, hosted, up). Checked for every stream; without it, every
   * consumer whose channel the relay keeps may.
   */
  consumerAllowed?: ((consumer: string) => MaybePromise<boolean>) | undefined;
  /**
   * The floor of `consumer`'s events of `scope` for that epoch and stream —
   * the position the relay last told it to resume from — or null when the
   * relay gave it no gap for them.
   */
  eventFloor(
    consumer: string,
    scope: string,
    epoch: string,
    streamId: string,
  ): MaybePromise<number | null>;
  /** Remember a floor the relay is about to answer in a gap (never lowered for one epoch and stream). */
  recordEventFloor(
    consumer: string,
    scope: string,
    epoch: string,
    streamId: string,
    floor: number,
  ): MaybePromise<void>;
  /**
   * Whether an open call may go on: the edge still effective, the consumer
   * still qualifying, the person (if any) still active and entitled. Called
   * every `sweepMs`; false ends the answer. Without it, only lifetimes end
   * answers.
   */
  recheck?: ((call: PeerOpenCall) => MaybePromise<boolean>) | undefined;
  /** Calls open to one provider at most; default `PEER_PROVIDER_MAX_IN_FLIGHT`. */
  readonly maxInFlightPerProvider?: number | undefined;
  /** The longest an answer stays open; default `PEER_RESPONSE_MAX_MS`. */
  readonly responseMaxMs?: number | undefined;
  /** How often open answers are checked; default `PEER_RESPONSE_SWEEP_MS`. */
  readonly sweepMs?: number | undefined;
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
  /**
   * Take the one slot a consumer has for an outstanding events pull of a
   * scope: a release function, or null while another pull of that scope is
   * open (`429 too_many_pulls`). Without it pulls are not limited.
   */
  acquireEventsPull?: ((consumer: string, scope: string) => (() => void) | null) | undefined;
  /** The providers' request hooks; without it every call streams through untouched. */
  readonly hooks?: RequestHookRuntime | undefined;
  /**
   * Called for every refusal (the caller rate-limits its audit). Returning
   * false says the refusal is past the consumer's allowance: the gateway
   * then writes no log line for it either.
   */
  onDenied?: ((denial: PeerCallDenial) => boolean | void) | undefined;
  readonly logger?: AgentForwarderLogger | undefined;
}

/** Seconds a consumer is told to wait before trying an unavailable provider again. */
const RETRY_AFTER_SECONDS = 10;

/** …and a busy one. */
const BUSY_RETRY_AFTER_SECONDS = 1;

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
  const maxInFlight = opts.maxInFlightPerProvider ?? PEER_PROVIDER_MAX_IN_FLIGHT;
  const responseMaxMs = opts.responseMaxMs ?? PEER_RESPONSE_MAX_MS;
  const sweepMs = opts.sweepMs ?? PEER_RESPONSE_SWEEP_MS;

  /** Calls open per provider. */
  const inFlight = new Map<string, number>();

  interface OpenEntry {
    readonly call: PeerOpenCall;
    readonly deadline: number;
    checking: boolean;
  }
  /** Answers open now, and the timer that checks them while there are any. */
  const open = new Map<Http2ServerResponse, OpenEntry>();
  let sweeper: NodeJS.Timeout | null = null;

  function end(res: Http2ServerResponse, why: string, call: PeerOpenCall): void {
    open.delete(res);
    logger?.info(
      { consumer: call.consumer, provider: call.provider, scope: call.scope, why },
      'Peer answer ended by the relay',
    );
    // Reset, whether or not the provider answered yet: the forwarding core
    // sees the stream close unfinished and cancels the provider's request
    // too — an answer written here instead would leave the provider working
    // on a call no longer allowed.
    res.destroy();
  }

  function sweep(): void {
    const now = Date.now();
    for (const [res, entry] of open) {
      if (now >= entry.deadline) {
        end(res, 'lifetime', entry.call);
        continue;
      }
      if (!opts.recheck || entry.checking) continue;
      entry.checking = true;
      Promise.resolve()
        .then(() => opts.recheck?.(entry.call))
        .then(
          (allowed) => {
            entry.checking = false;
            if (allowed === false && open.has(res)) end(res, 'revoked', entry.call);
          },
          () => {
            // A check that fails cannot say the call is still allowed.
            entry.checking = false;
            if (open.has(res)) end(res, 'recheck_failed', entry.call);
          },
        );
    }
    if (open.size === 0 && sweeper) {
      clearInterval(sweeper);
      sweeper = null;
    }
  }

  function track(res: Http2ServerResponse, call: PeerOpenCall, expiresAt: number | null): void {
    const deadline = Math.min(Date.now() + responseMaxMs, expiresAt ?? Infinity);
    open.set(res, { call, deadline, checking: false });
    if (!sweeper) {
      sweeper = setInterval(sweep, Math.min(sweepMs, Math.max(deadline - Date.now(), 1)));
      sweeper.unref();
    }
  }

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

  /** Tell the caller of a refusal; false when it is past the consumer's allowance. */
  function denied(consumer: string, scope: string | null, code: PeerRelayCode): boolean {
    try {
      return opts.onDenied?.({ consumer, scope, code }) !== false;
    } catch {
      // An audit that fails never fails the answer.
      return true;
    }
  }

  /** A call's answer is complete: no longer open, one less in flight to its provider. */
  function untrack(res: Http2ServerResponse, provider: string): void {
    open.delete(res);
    const left = (inFlight.get(provider) ?? 1) - 1;
    if (left <= 0) inFlight.delete(provider);
    else inFlight.set(provider, left);
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
      const noted = denied(consumer, scope, code);
      const outcome = refuse(res, status, code, error, extra, headers);
      if (noted) done(outcome);
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
    let delegationRoot: string | null = null;
    let delegationExpiresAt: number | null = null;
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
      delegationRoot = checked.root;
      delegationExpiresAt = checked.expiresAt;
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

    const openToProvider = inFlight.get(provider) ?? 0;
    if (openToProvider >= maxInFlight) {
      return deny(
        503,
        'peer_unavailable',
        'The provider is busy',
        { reason: 'busy' },
        { 'retry-after': String(BUSY_RETRY_AFTER_SECONDS) },
      );
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
    inFlight.set(provider, openToProvider + 1);
    track(
      res,
      {
        consumer,
        provider,
        scope,
        user: user && delegationRoot ? { userId: user.userId, root: delegationRoot } : null,
      },
      delegationExpiresAt,
    );
    let outcome: ForwardOutcome;
    try {
      outcome = await forwardRequest(
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
          ...(opts.connectTimeoutMs !== undefined
            ? { connectTimeoutMs: opts.connectTimeoutMs }
            : {}),
          ...(opts.host !== undefined ? { host: opts.host } : {}),
        },
        plan,
        'peer',
        onward !== null ? { [PEER_DELEGATION_HEADER]: onward } : {},
      );
    } finally {
      untrack(res, provider);
    }
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
    const release = opts.acquireEventsPull
      ? opts.acquireEventsPull(consumer, pull.scope)
      : () => {};
    if (release === null) {
      return void refuse(
        res,
        429,
        'too_many_pulls',
        'An events pull of this scope is already open',
      );
    }
    try {
      await pullEventsFor(res, consumer, pull, answer);
    } finally {
      release();
    }
  }

  async function pullEventsFor(
    res: Http2ServerResponse,
    consumer: string,
    pull: PeerEventsRequest,
    answer: (status: number, body: PeerEventsChannelAnswer | Record<string, unknown>) => void,
  ): Promise<void> {
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
    const unreachable = (): void =>
      void refuse(res, 502, 'provider_unreachable', 'The provider did not answer the pull');
    /**
     * Answer a gap: first the floor it sets — what the consumer may resume
     * from, for this epoch and stream — so a later pull cannot ask from
     * below it.
     */
    const gap = async (
      reason: PeerGapReason,
      head: number,
      streamId: string,
      epoch: string = subscription.epoch,
    ): Promise<void> => {
      await opts.recordEventFloor(consumer, pull.scope, epoch, streamId, head);
      answer(200, { gap: { reason, resumeFrom: head, epoch, streamId } });
    };
    /** The provider's head and stream, for a gap. */
    const probeHead = async (): Promise<{ head: number; streamId: string } | null> => {
      const probe = await providerPull(0, 0, 0);
      return probe === 'unreachable' || probe === null
        ? null
        : { head: probe.head, streamId: probe.streamId };
    };

    // A cursor that cannot be continued: learn the provider's head and answer a gap.
    const fresh =
      pull.after === null || pull.epoch !== subscription.epoch || pull.streamId === null;
    if (fresh) {
      const probe = await probeHead();
      if (!probe) return unreachable();
      const reason: PeerGapReason =
        pull.after === null || pull.epoch === null
          ? 'initial'
          : pull.epoch !== subscription.epoch
            ? subscriptionChangeReason(pull.epoch, subscription.epoch)
            : 'stream_changed';
      return gap(reason, probe.head, probe.streamId);
    }
    const after = pull.after as number;
    const streamId = pull.streamId as string;
    // The cursor must rest on a gap the relay answered for this epoch and
    // stream, at or past its floor: an epoch is no secret, a floor is.
    const floor = await opts.eventFloor(consumer, pull.scope, subscription.epoch, streamId);
    if (floor === null || after < floor) {
      const probe = await probeHead();
      if (!probe) return unreachable();
      return gap(floor === null ? 'initial' : 'granted', probe.head, probe.streamId);
    }
    const waitMs = Math.min(pull.waitMs, PEER_EVENTS_WAIT_MAX_MS);
    const pulled = await providerPull(after, PEER_EVENTS_PULL_MAX, waitMs);
    if (pulled === 'unreachable' || pulled === null) return unreachable();

    // The provider may have held the pull for a while: what was true when it
    // was asked must still be true before anything crosses.
    if (opts.consumerAllowed && !(await opts.consumerAllowed(consumer))) {
      denied(consumer, pull.scope, 'not_granted');
      return void refuse(res, 403, 'not_granted', 'This plugin may not use its channel now');
    }
    const now = await opts.subscription(consumer, pull.scope);
    if (!now || now.provider !== subscription.provider) {
      denied(consumer, pull.scope, 'not_granted');
      return void refuse(res, 403, 'not_granted', 'This plugin receives no events of that scope');
    }
    if (now.epoch !== subscription.epoch) {
      return gap(
        subscriptionChangeReason(subscription.epoch, now.epoch),
        pulled.head,
        pulled.streamId,
        now.epoch,
      );
    }
    const floorNow = await opts.eventFloor(consumer, pull.scope, subscription.epoch, streamId);
    if (floorNow === null || after < floorNow) {
      return gap('granted', pulled.head, pulled.streamId);
    }

    if (pulled.streamId !== streamId || after > pulled.head) {
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
      if (opts.consumerAllowed && !(await opts.consumerAllowed(consumer))) {
        const noted = denied(consumer, null, 'not_granted');
        const outcome = refuse(res, 403, 'not_granted', 'This plugin may not use its channel now');
        if (noted) {
          log({
            consumer,
            provider: null,
            scope: null,
            method: req.method.toUpperCase(),
            endpoint: null,
            startedAt,
            outcome,
          });
        }
        return;
      }
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
