/**
 * The forwarding core every relay entry into an agent half shares — the
 * admin forwarder and the user surface (`agent-forwarder.ts`) and the peer
 * gateway (`peer-gateway.ts`): which headers cross in each direction, the
 * body limit, the caller assertion and the responder check, streaming with
 * its timeouts, and the request hooks' pipeline. See `agent-forwarder.ts`
 * for what each of them guarantees.
 *
 * It works on any request that reads like Node's `IncomingMessage` and any
 * response that writes like its `ServerResponse` — HTTP/1.1 objects, and
 * HTTP/2's compatibility objects alike (the peer channel's calls arrive on
 * HTTP/2): HTTP/2 pseudo-headers never cross, hop-by-hop headers (which an
 * HTTP/2 response refuses) are stripped both ways, and a response is only
 * ever ended or destroyed through its own API, never its socket.
 */

import http from 'node:http';
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse,
} from 'node:http';
import type { Http2ServerResponse } from 'node:http2';
import { Readable, Transform } from 'node:stream';
import type { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  CALLER_ASSERTION_HEADER,
  RESPONDER_HEADER,
  generateCallerAssertionNonce,
  signCallerAssertion,
  verifyResponder,
} from '../caller-assertion.js';
import type { CallerIdentity } from '../caller-assertion.js';
import { matchRoutePattern, requestPathSegments, routePattern } from '../hooks/index.js';
import type {
  HookCaller,
  PreForwardDecision,
  RoutePattern,
  TunnelFallback,
} from '../hooks/index.js';
import type { RequestHook } from '../hook-set.js';
import { PEER_RELAY_HEADER } from '../peers.js';
import type { PeerRelayCode } from '../peers.js';
import { isHookEditableHeader, METHOD_URL_OVERRIDE_HEADERS } from './hook-decisions.js';
import type { ValidatedDecision } from './hook-decisions.js';

/** The request a forward reads: its method, headers and body stream. */
export interface ForwardRequest {
  readonly method: string;
  readonly headers: IncomingHttpHeaders;
  /** The body as it arrives — read only when the method carries one. */
  readonly body: Readable;
}

/** The response a forward writes: an HTTP/1.1 response or HTTP/2's compatibility one. */
export type ForwardResponse = ServerResponse | Http2ServerResponse;

/** The path prefix on the agent half every forwarded request goes under. */
export const AGENT_HALF_ADMIN_PREFIX = '/admin';

export const AGENT_FORWARD_DEFAULTS = Object.freeze({
  /** Waiting for the agent half's response headers. */
  headersTimeoutMs: 30_000,
  /** Silence on a response body (not server-sent events). */
  bodyIdleTimeoutMs: 300_000,
  /** Connecting to the relay-loopback port. */
  connectTimeoutMs: 5_000,
});

/** Where one plugin's requests go, resolved per request. */
export interface AgentForwardTarget {
  readonly plugin: string;
  readonly port: number;
  /** The installation secret the forwarder signs with. */
  readonly secret: string;
  /** The plugin's request body limit, in bytes (`agentHalfMaxBodyMb` × 1 MiB). */
  readonly maxBodyBytes: number;
}

/**
 * Why a route cannot be forwarded right now. `down`: its hosting's health
 * is down, for `reason` — nothing answered on the relay-loopback port
 * (`tunnel`), or something did that is not the agent half (`app`).
 * Whatever holds that port may not be the agent half, so neither entry
 * forwards then: nothing of an administrator's, an agent's or a user's
 * request reaches it. Lamaste's own calls (health probes, settings, hooks,
 * the identity feed) never come this way and still find the half when it
 * is back.
 */
export type AgentForwardRefusal =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'not_hosted' }
  | { readonly kind: 'down'; readonly reason: 'tunnel' | 'app' };

export type AgentForwardResolution = AgentForwardTarget | AgentForwardRefusal;

export interface AgentForwarderLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

/** A caller the panel forwards: every caller but Lamaste itself. */
export type ForwardedCaller = Exclude<CallerIdentity, { readonly type: 'lamaste' }>;

/** A caller of the admin surface (`/admin/*`): an admin or an agent. */
export type AdminSurfaceCaller = Extract<CallerIdentity, { readonly type: 'admin' | 'agent' }>;

/** How long the forwarder waits, and where it connects. */
export interface AgentForwardTimeouts {
  readonly headersTimeoutMs?: number | undefined;
  readonly bodyIdleTimeoutMs?: number | undefined;
  readonly connectTimeoutMs?: number | undefined;
  /** Where the agent half is reached. Default 127.0.0.1 — the relay loopback. */
  readonly host?: string | undefined;
}

/** The outcome of one request hook, as the runtime reports it. */
export type RequestHookRun =
  | {
      readonly ok: true;
      readonly decision: PreForwardDecision | ValidatedDecision<'request:post-forward'>;
      /** A `replace` decision's body. */
      readonly body: Buffer | null;
    }
  | { readonly ok: false };

/**
 * What the forwarder needs from the panel to run request hooks: which
 * hooks a plugin has (approved ones only), how to run one (the runner round
 * trip, validation and effects — the panel's), and the `tunnel:down`
 * fallback while the plugin is down.
 */
export interface RequestHookRuntime {
  /**
   * The plugin's request hooks. `refuse` when it declares relay hooks Lamaste
   * may not run (not approved): its traffic is refused rather than let past
   * hooks that do not run.
   */
  hooksFor(
    plugin: string,
  ): Promise<{ readonly hooks: readonly RequestHook[] } | { readonly refuse: string }>;
  run(
    plugin: string,
    hook: RequestHook,
    input: Readonly<Record<string, unknown>>,
    body: { readonly bytes: Buffer; readonly contentType: string | null } | null,
  ): Promise<RequestHookRun>;
  /** The fallback the plugin's `tunnel:down` hook returned, while the plugin is down; else null. */
  fallbackFor(plugin: string): TunnelFallback | null;
}

/** Headers never copied in either direction (RFC 9110 §7.6.1 and friends). */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Request headers that carry the caller's credentials or nginx's verdicts,
 * and those that would make the agent half's framework take the request for
 * another method or path than the one the caller assertion signs.
 */
const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'content-length',
  'cookie',
  'authorization',
  'expect',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
  ...METHOD_URL_OVERRIDE_HEADERS,
]);

/**
 * Response headers the panel keeps to itself: the application's cookies,
 * and what would let an answer reach beyond itself into the panel's
 * origin — a service worker scope widened over the panel, the panel's
 * storage and cookies cleared.
 */
const STRIPPED_RESPONSE_HEADERS = new Set([
  'set-cookie',
  'set-cookie2',
  'service-worker-allowed',
  'clear-site-data',
]);

/** What a forwarded answer that does not authenticate itself gets instead. */
export const UNAUTHENTICATED_ANSWER = 'The agent half did not authenticate its answer';

/**
 * The admin API's answer while the plugin's hosting is down — the answer a
 * request forwarded into a dead tunnel gets (`502`, with the reason), never
 * sent to the port: the `tunnel:down` fallback when the plugin has one.
 */
export function downFailure(reason: 'tunnel' | 'app'): Extract<UpstreamResult, { ok: false }> {
  return {
    ok: false,
    status: 502,
    error:
      reason === 'tunnel' ? 'The hosting agent is unreachable' : 'The agent half is not responding',
    extra: { reason },
  };
}

function isStrippedRequestHeader(name: string): boolean {
  return (
    // HTTP/2 pseudo-headers (`:method`, `:path`, …) that a request read
    // through HTTP/2's compatibility API lists among its headers: they are
    // not header fields, and Node's HTTP/1.1 client refuses the names.
    name.startsWith(':') ||
    HOP_BY_HOP.has(name) ||
    STRIPPED_REQUEST_HEADERS.has(name) ||
    name.startsWith('x-lamalibre-') ||
    name.startsWith('x-ssl-client-') ||
    name.startsWith('remote-')
  );
}

/**
 * The request headers forwarded to the agent half. Pure; exported for
 * tests. `Content-Length` is passed only when the body will be sent as is.
 */
export function forwardedRequestHeaders(
  incoming: IncomingHttpHeaders,
  port: number,
  host = '127.0.0.1',
): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined || isStrippedRequestHeader(name)) continue;
    out[name] = value;
  }
  out['host'] = `${host}:${port}`;
  return out;
}

/**
 * The response headers passed back to the client: without hop-by-hop
 * headers, the ones the panel keeps to itself, anything under
 * `X-Lamalibre-*` (the responder signature among them) and anything under
 * `X-Accel-*` (nginx obeys `X-Accel-Redirect`, `X-Accel-Buffering` and the
 * rest from the panel's port — an application must never steer it). Pure;
 * exported for tests.
 */
export function forwardedResponseHeaders(incoming: IncomingHttpHeaders): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (
      value === undefined ||
      name.startsWith(':') ||
      HOP_BY_HOP.has(name) ||
      STRIPPED_RESPONSE_HEADERS.has(name) ||
      CONNECTION_RESPONSE_HEADERS.has(name) ||
      name.startsWith('x-lamalibre-') ||
      name.startsWith('x-accel-')
    ) {
      continue;
    }
    out[name] = value;
  }
  return out;
}

/**
 * What every answer on a plugin's user surface carries — the agent half's,
 * a hook's, and the panel's own refusals alike: it may be read only by the
 * bound host's own pages (`Cross-Origin-Resource-Policy: same-origin`), its
 * type is never sniffed (`nosniff`), and a document rendered from it runs
 * nothing and loads nothing (`sandbox; default-src 'none'`) — so an answer
 * from a compromised application cannot act as a page of the host whose
 * session cookie reaches the plugin's users.
 */
export const USER_SURFACE_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'cross-origin-resource-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "sandbox; default-src 'none'",
});

/**
 * Set {@link USER_SURFACE_RESPONSE_HEADERS} on a response before anything
 * is written: Node merges them into whatever `writeHead` sends later, so
 * every answer of the request carries them — an early refusal, a rate
 * limit, an error, a forwarded answer.
 */
export function applyUserSurfaceResponseHeaders(res: ForwardResponse): void {
  if (res.headersSent) return;
  for (const [name, value] of Object.entries(USER_SURFACE_RESPONSE_HEADERS)) {
    res.setHeader(name, value);
  }
}

/**
 * The headers of an answer forwarded from (or written by a hook for) a
 * user surface: the forwarded headers ({@link forwardedResponseHeaders})
 * without `Access-Control-*` (no other origin reads a user's data — the
 * panel's CORS and the application's alike), with
 * {@link USER_SURFACE_RESPONSE_HEADERS}' resource policy and `nosniff` in
 * place of the application's, and its `Content-Security-Policy` sent first
 * — the application's own policies stay as further ones, which can only
 * restrict more. Pure; exported for tests.
 */
export function userSurfaceResponseHeaders(headers: OutgoingHttpHeaders): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (value === undefined || lower.startsWith('access-control-')) continue;
    if (lower in USER_SURFACE_RESPONSE_HEADERS) continue;
    out[lower] = value;
  }
  const csp = headers['content-security-policy'];
  const theirs = csp === undefined ? [] : Array.isArray(csp) ? csp : [String(csp)];
  for (const [name, value] of Object.entries(USER_SURFACE_RESPONSE_HEADERS)) {
    out[name] =
      name === 'content-security-policy' && theirs.length > 0 ? [value, ...theirs] : value;
  }
  return out;
}

/**
 * Whether a request fetches a service worker's script: browsers send
 * `Service-Worker: script` for that (any value is refused — no plugin route
 * has a reason to be asked for a service worker). Pure; exported for tests.
 */
export function isServiceWorkerRequest(headers: IncomingHttpHeaders): boolean {
  return headers['service-worker'] !== undefined;
}

/**
 * Map the request URL (`/api/<route>[/<rest>][?query]`) to the path on the
 * agent half (`/admin[/<rest>][?query]`). Returns null when the URL does
 * not start with the route, or when `rest` tries to climb out of `/admin`
 * (a decoded segment of `..`). Pure; exported for tests.
/** How a caller appears in logs: a user by the directory's id, never by name. */
export function callerLabel(caller: CallerIdentity): string {
  if (caller.type === 'agent') return `agent:${caller.label}`;
  if (caller.type === 'user') return `user:${caller.userId}`;
  if (caller.type === 'peer') return `peer:${caller.peer}`;
  return caller.type;
}

/** How a caller appears in a request hook's input: a user by id and roles only. */
export function hookCallerOf(caller: ForwardedCaller): HookCaller {
  if (caller.type === 'user') {
    return { type: 'user', userId: caller.userId, roles: [...caller.roles] };
  }
  if (caller.type === 'agent') return { type: 'agent', label: caller.label };
  if (caller.type === 'peer') {
    return {
      type: 'peer',
      peer: caller.peer,
      scope: caller.scope,
      ...(caller.user ? { userId: caller.user.userId } : {}),
    };
  }
  return { type: 'admin' };
}

export function isEventStream(headers: IncomingHttpHeaders): boolean {
  const type = headers['content-type'];
  return typeof type === 'string' && type.toLowerCase().startsWith('text/event-stream');
}

/**
 * Which entry a request came through: the admin API (`/api/<route>/*` →
 * `/admin/*`, administrators and agents) or a plugin's user surface
 * (`/api/<route>/app/*` → `/app/*`, people).
 */
export type ForwardSurface = 'admin' | 'user' | 'peer';

/**
 * What a person on a user surface is told when the relay — not the
 * application — answers with an error: one fixed text per status, never an
 * internal message (a socket error, a timeout, which side failed).
 */
const USER_SURFACE_ERROR_TEXTS: Readonly<Record<number, string>> = Object.freeze({
  400: 'Bad request',
  401: 'unauthenticated',
  403: 'Forbidden',
  404: 'Not found',
  413: 'Request body too large',
  499: 'Request cancelled',
  500: 'Internal error',
  502: 'The application is unavailable',
  503: 'The application is unavailable right now',
  504: 'The application did not answer in time',
});

/** The fixed error text of a user-surface answer with `status`. Pure; exported for tests. */
export function userSurfaceErrorText(status: number): string {
  return (
    USER_SURFACE_ERROR_TEXTS[status] ??
    (status >= 500 ? 'The application is unavailable' : 'Request refused')
  );
}

/** A body that stops at `limit` bytes; the stream errors past it. */
class BodyLimit extends Transform {
  #seen = 0;
  readonly limit: number;
  exceeded = false;

  constructor(limit: number) {
    super();
    this.limit = limit;
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    this.#seen += chunk.length;
    if (this.#seen > this.limit) {
      this.exceeded = true;
      callback(new Error("Request body exceeds the plugin's body limit"));
      return;
    }
    callback(null, chunk);
  }
}

/** How one forwarded request ended, for the log line. */
export interface ForwardOutcome {
  readonly status: number;
  readonly error?: string | undefined;
  /**
   * What a request hook did (`rejected`, `blocked`, `replaced`, `oversize`,
   * `failed`, `fallback`), for the log line.
   */
  readonly hook?: string | undefined;
}

/** What the upstream request sends as its body. */
type UpstreamBody =
  | { readonly kind: 'none' }
  | { readonly kind: 'stream'; readonly stream: Readable }
  | { readonly kind: 'buffer'; readonly bytes: Buffer }
  | { readonly kind: 'prefixed'; readonly prefix: Buffer; readonly rest: Readable };

export type UpstreamResult =
  | { readonly ok: true; readonly res: IncomingMessage }
  | {
      readonly ok: false;
      readonly status: number;
      readonly error: string;
      readonly extra: Readonly<Record<string, unknown>>;
    };

export function hasRequestBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

async function* prefixed(prefix: Buffer, rest: Readable): AsyncGenerator<Buffer> {
  if (prefix.length > 0) yield prefix;
  for await (const chunk of rest) yield chunk as Buffer;
}

/**
 * Send the request to the agent half and wait for its response headers.
 * Failures before the headers are outcomes (502/504/413), never throws. The
 * client going away destroys the upstream request.
 */
function openUpstream(params: {
  readonly method: string;
  readonly targetPath: string;
  readonly headers: OutgoingHttpHeaders;
  readonly body: UpstreamBody;
  readonly target: AgentForwardTarget;
  readonly timeouts: AgentForwardTimeouts;
  readonly clientRes: ForwardResponse;
}): Promise<UpstreamResult> {
  const { method, targetPath, headers, body, target, timeouts, clientRes } = params;
  const headersTimeoutMs = timeouts.headersTimeoutMs ?? AGENT_FORWARD_DEFAULTS.headersTimeoutMs;
  const connectTimeoutMs = timeouts.connectTimeoutMs ?? AGENT_FORWARD_DEFAULTS.connectTimeoutMs;
  const host = timeouts.host ?? '127.0.0.1';

  return new Promise<UpstreamResult>((resolve) => {
    let settled = false;
    let response: IncomingMessage | null = null;
    const settle = (result: UpstreamResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(headersTimer);
      resolve(result);
    };
    const fail = (status: number, error: string, extra: Record<string, unknown> = {}): void => {
      if (settled) return;
      upstream.destroy();
      settle({ ok: false, status, error, extra });
    };

    const upstream = http.request({
      host,
      port: target.port,
      method,
      path: targetPath,
      headers,
      timeout: connectTimeoutMs,
    });
    const headersTimer = setTimeout(() => {
      fail(504, 'The hosting agent did not answer in time', { timeoutMs: headersTimeoutMs });
    }, headersTimeoutMs);

    upstream.once('timeout', () => {
      // Only the connect phase arms Node's socket timeout here; once the
      // request is written the headers timer owns the wait.
      if (!upstream.socket || upstream.socket.connecting) {
        fail(502, 'The hosting agent is unreachable', { reason: 'tunnel' });
      }
    });
    upstream.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) {
        // After the headers: the response reader sees the stream end early.
        response?.destroy(err);
        return;
      }
      const refused = err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET';
      fail(502, refused ? 'The hosting agent is unreachable' : 'Forwarding failed', {
        reason: err.code === 'ECONNREFUSED' ? 'tunnel' : 'app',
      });
    });

    // The client went away — or the relay ended the response (a user
    // surface's lifetime, a revoked user) — before the response was
    // complete: stop the upstream request too, and stop waiting for its
    // headers. Watched on the response, not the request — an IncomingMessage
    // emits 'close' as soon as its body has been read, which for a piped
    // request body is long before the reply exists.
    clientRes.once('close', () => {
      if (clientRes.writableFinished) return;
      upstream.destroy();
      fail(499, 'The client closed the connection');
    });

    upstream.once('response', (res: IncomingMessage) => {
      response = res;
      settle({ ok: true, res });
    });

    if (body.kind === 'none') {
      upstream.end();
      return;
    }
    if (body.kind === 'buffer') {
      upstream.end(body.bytes);
      return;
    }
    const source =
      body.kind === 'stream' ? body.stream : Readable.from(prefixed(body.prefix, body.rest));
    const limit = new BodyLimit(target.maxBodyBytes);
    pipeline(source, limit, upstream).catch((err: Error) => {
      if (limit.exceeded) {
        fail(413, "Request body exceeds the plugin's body limit", {
          maxBodyBytes: target.maxBodyBytes,
        });
        return;
      }
      fail(502, `Forwarding the request body failed: ${err.message}`);
    });
  });
}

/** Write a JSON answer on a hijacked reply. */
export function writeJson(res: ForwardResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const json = Buffer.from(JSON.stringify(body), 'utf-8');
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(json.length),
  });
  res.end(json);
}

/**
 * Response headers that describe a connection, never an answer: `host`
 * and HTTP/2's `http2-settings` — an HTTP/2 response refuses both (it
 * throws), and an HTTP/1.1 one has no use for either.
 */
const CONNECTION_RESPONSE_HEADERS = new Set(['host', 'http2-settings']);

/**
 * A forwarded answer's headers as `surface` sends them: on a user surface,
 * {@link userSurfaceResponseHeaders}.
 */
export function clientResponseHeaders(
  headers: OutgoingHttpHeaders,
  surface: ForwardSurface,
): OutgoingHttpHeaders {
  return surface === 'user' ? userSurfaceResponseHeaders(headers) : headers;
}

/**
 * Write the relay's own error answer: `body` on the admin API, the fixed
 * text of its status ({@link userSurfaceErrorText}) on a user surface.
 */
export function writeError(
  res: ForwardResponse,
  surface: ForwardSurface,
  status: number,
  body: Readonly<Record<string, unknown>>,
): void {
  if (surface === 'peer') {
    const code = peerRelayCodeFor(status, body);
    markPeerRelayAnswer(res, code);
    writeJson(res, status, { ...body, peer: { code } });
    return;
  }
  writeJson(res, status, surface === 'user' ? { error: userSurfaceErrorText(status) } : body);
}

/**
 * Mark an answer as the relay's own on the peer surface
 * (`PEER_RELAY_HEADER`), so a consumer's SDK never mistakes it for the
 * provider's.
 */
export function markPeerRelayAnswer(res: ForwardResponse, code: PeerRelayCode): void {
  if (!res.headersSent) res.setHeader(PEER_RELAY_HEADER, code);
}

/** The peer relay code of one of the forwarding core's own error answers. */
function peerRelayCodeFor(status: number, body: Readonly<Record<string, unknown>>): PeerRelayCode {
  const reasonId = body['reasonId'];
  if (reasonId === 'hook-failed' || reasonId === 'response-not-checkable') return 'hook_failed';
  if (typeof reasonId === 'string') return 'hook_rejected';
  if (status === 413) return 'too_large';
  if (status === 504) return 'timeout';
  if (status === 502) {
    return body['reason'] === 'tunnel' ? 'provider_unreachable' : 'provider_unauthenticated';
  }
  if (status === 400 || status === 403) return 'bad_request';
  return 'relay_error';
}

/** Answer a forwarding failure — or, while the plugin is down, its `tunnel:down` fallback. */
export function answerFailure(
  res: ForwardResponse,
  failure: Extract<UpstreamResult, { ok: false }>,
  fallback: TunnelFallback | null,
  surface: ForwardSurface,
): ForwardOutcome {
  const tunnelOrApp = failure.status === 502 && failure.extra['reason'] !== undefined;
  if (fallback && tunnelOrApp && !res.headersSent) {
    const contentType = fallback.contentType ?? 'application/json';
    const payload =
      fallback.body === undefined
        ? Buffer.alloc(0)
        : typeof fallback.body === 'string' && !contentType.startsWith('application/json')
          ? Buffer.from(fallback.body, 'utf-8')
          : Buffer.from(JSON.stringify(fallback.body), 'utf-8');
    res.writeHead(fallback.status, {
      'content-type': contentType,
      'content-length': String(payload.length),
      'cache-control': 'no-store',
      ...(fallback.retryAfter !== undefined ? { 'retry-after': String(fallback.retryAfter) } : {}),
    });
    res.end(payload);
    return { status: fallback.status, error: failure.error, hook: 'fallback' };
  }
  writeError(res, surface, failure.status, { error: failure.error, ...failure.extra });
  return { status: failure.status, error: failure.error };
}

/**
 * Stream a response to the client: headers, an optional prefix already
 * read, then the rest. Server-sent events are flushed and never cut for
 * silence; any other body is cut after `bodyIdleTimeoutMs` of silence.
 */
export function streamResponse(
  upstreamRes: IncomingMessage,
  res: ForwardResponse,
  timeouts: AgentForwardTimeouts,
  surface: ForwardSurface,
  prefix: Buffer | null = null,
): Promise<ForwardOutcome> {
  const bodyIdleTimeoutMs = timeouts.bodyIdleTimeoutMs ?? AGENT_FORWARD_DEFAULTS.bodyIdleTimeoutMs;
  const status = upstreamRes.statusCode ?? 502;
  const responseHeaders = clientResponseHeaders(
    forwardedResponseHeaders(upstreamRes.headers),
    surface,
  );
  const eventStream = isEventStream(upstreamRes.headers);
  if (eventStream) {
    // nginx in front of the panel buffers responses; this header — the
    // only X-Accel-* the panel ever sends, set here, never the
    // application's — turns that off so events reach the browser as sent.
    responseHeaders['x-accel-buffering'] = 'no';
    responseHeaders['cache-control'] = 'no-cache';
  }
  try {
    res.writeHead(status, responseHeaders);
  } catch (err: unknown) {
    // A header the response refuses: nothing was sent — let go of the
    // agent half's answer, or its connection waits for a reader.
    upstreamRes.destroy();
    throw err;
  }
  // Both response kinds have `flushHeaders` (HTTP/2's compatibility one
  // too, though its type does not say so); both are writables.
  if (eventStream) (res as { flushHeaders?: () => void }).flushHeaders?.();
  if (prefix && prefix.length > 0) (res as Writable).write(prefix);

  return new Promise<ForwardOutcome>((resolve) => {
    let idleTimer: NodeJS.Timeout | null = null;
    let done = false;
    const finish = (outcome: ForwardOutcome): void => {
      if (done) return;
      done = true;
      if (idleTimer) clearTimeout(idleTimer);
      resolve(outcome);
    };
    const armIdle = (): void => {
      if (eventStream) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        upstreamRes.destroy(new Error('idle'));
        res.destroy();
        finish({ status, error: 'response body idle timeout' });
      }, bodyIdleTimeoutMs);
    };
    armIdle();
    upstreamRes.on('data', armIdle);
    pipeline(upstreamRes, res)
      .then(() => finish({ status }))
      .catch((err: Error) => {
        res.destroy();
        finish({ status, error: err.message });
      });
  });
}

/**
 * Read up to `limit` bytes of a stream. `complete` when it ended within the
 * limit; otherwise the stream is left paused after `bytes` and `overflow`
 * (the part of the last chunk past the limit), ready to be streamed on.
 */
export function readUpTo(
  stream: Readable,
  limit: number,
  idleMs: number,
): Promise<{ bytes: Buffer; complete: boolean; overflow: Buffer }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let idleTimer: NodeJS.Timeout | null = null;
    const cleanup = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
      stream.off('close', onClose);
    };
    const armIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        cleanup();
        stream.destroy();
        reject(new Error('body idle timeout'));
      }, idleMs);
    };
    const onData = (chunk: Buffer): void => {
      armIdle();
      if (size + chunk.length > limit) {
        const keep = limit - size;
        if (keep > 0) chunks.push(chunk.subarray(0, keep));
        stream.pause();
        cleanup();
        resolve({
          bytes: Buffer.concat(chunks, limit),
          complete: false,
          overflow: Buffer.from(chunk.subarray(Math.max(0, keep))),
        });
        return;
      }
      chunks.push(chunk);
      size += chunk.length;
    };
    const onEnd = (): void => {
      cleanup();
      resolve({ bytes: Buffer.concat(chunks, size), complete: true, overflow: Buffer.alloc(0) });
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    const onClose = (): void => {
      // 'close' without 'end': the peer went away mid-body.
      if (!stream.readableEnded) {
        cleanup();
        reject(new Error('the body ended early'));
      }
    };
    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
    stream.once('close', onClose);
    armIdle();
  });
}

/** Lower-case, single-valued headers for a hook's input (arrays joined). */
function hookHeaders(headers: OutgoingHttpHeaders | IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return out;
}

function applyHeaderEdits(
  headers: OutgoingHttpHeaders,
  set: Readonly<Record<string, string>> | undefined,
  remove: readonly string[] | undefined,
): void {
  for (const name of remove ?? []) {
    const lower = name.toLowerCase();
    if (isHookEditableHeader(lower)) delete headers[lower];
  }
  for (const [name, value] of Object.entries(set ?? {})) {
    const lower = name.toLowerCase();
    if (isHookEditableHeader(lower)) headers[lower] = value;
  }
}

function contentTypeOf(headers: IncomingHttpHeaders | OutgoingHttpHeaders): string | null {
  const type = headers['content-type'];
  return typeof type === 'string' ? type : null;
}

/** Parsed route patterns, per raw pattern. */
const patternCache = new Map<string, RoutePattern>();

function patternOf(raw: string): RoutePattern {
  let pattern = patternCache.get(raw);
  if (!pattern) {
    pattern = routePattern(raw);
    patternCache.set(raw, pattern);
  }
  return pattern;
}

/** The first route of `hook` the request matches, or null. */
function matchedRoute(
  hook: RequestHook,
  method: string,
  segments: readonly string[],
): string | null {
  for (const raw of hook.routes) {
    if (matchRoutePattern(patternOf(raw), method, segments)) return raw;
  }
  return null;
}

/** A request hook that matched a request, and the route pattern it matched with. */
export interface MatchedRequestHook {
  readonly hook: RequestHook;
  readonly route: string;
}

/** The request hooks one request runs: before it is forwarded, and on its answer. */
export interface RequestHookPlan {
  readonly runtime: RequestHookRuntime;
  readonly pre: readonly MatchedRequestHook[];
  readonly post: readonly MatchedRequestHook[];
}

/**
 * The request hooks of `plugin` that a request (`method`, `targetPath` on
 * the agent half) matches, in declaration order — or `refuse` when the
 * plugin declares relay hooks Lamaste may not run (not approved): its
 * traffic is refused rather than let past hooks that do not run.
 */
export async function buildRequestHookPlan(
  runtime: RequestHookRuntime,
  plugin: string,
  method: string,
  targetPath: string,
): Promise<RequestHookPlan | { readonly refuse: string }> {
  const found = await runtime.hooksFor(plugin);
  if ('refuse' in found) return { refuse: found.refuse };
  const upper = method.toUpperCase();
  const segments = requestPathSegments(targetPath) ?? [];
  const pre: MatchedRequestHook[] = [];
  const post: MatchedRequestHook[] = [];
  for (const hook of found.hooks) {
    const matched = matchedRoute(hook, upper, segments);
    if (matched === null) continue;
    (hook.stage === 'pre-forward' ? pre : post).push({ hook, route: matched });
  }
  return { runtime, pre, post };
}

/** The most body any of `hooks` reads: 0 when none reads one. */
export function largestBodyMax(hooks: readonly MatchedRequestHook[]): number {
  return hooks.reduce((max, p) => Math.max(max, p.hook.bodyMaxBytes ?? 0), 0);
}

export async function forwardRequest(
  request: ForwardRequest,
  res: ForwardResponse,
  target: AgentForwardTarget,
  caller: ForwardedCaller,
  targetPath: string,
  opts: AgentForwardTimeouts,
  plan: RequestHookPlan | null,
  surface: ForwardSurface,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<ForwardOutcome> {
  const method = request.method.toUpperCase();
  const bodyIdleTimeoutMs = opts.bodyIdleTimeoutMs ?? AGENT_FORWARD_DEFAULTS.bodyIdleTimeoutMs;
  // A plugin's `tunnel:down` fallback answers its own clients, never a peer
  // (the peer gateway refuses a provider known to be down before this).
  const fallback = surface === 'peer' ? null : (plan?.runtime.fallbackFor(target.plugin) ?? null);

  if (isServiceWorkerRequest(request.headers)) {
    writeError(res, surface, 403, { error: 'A plugin route cannot serve a service worker' });
    return { status: 403 };
  }

  const declared = request.headers['content-length'];
  if (declared !== undefined) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) {
      writeError(res, surface, 400, { error: 'Invalid Content-Length' });
      return { status: 400 };
    }
    if (length > target.maxBodyBytes) {
      writeError(res, surface, 413, {
        error: "Request body exceeds the plugin's body limit",
        maxBodyBytes: target.maxBodyBytes,
      });
      return { status: 413 };
    }
  }

  const headers = forwardedRequestHeaders(request.headers, target.port, opts.host ?? '127.0.0.1');
  const query = targetPath.includes('?') ? targetPath.slice(targetPath.indexOf('?') + 1) : '';
  const pathOnly = targetPath.split('?')[0] ?? targetPath;
  const requestInfo = { method, path: pathOnly, query, caller: hookCallerOf(caller) };

  const withBody = hasRequestBody(method);

  // --- request:pre-forward ---------------------------------------------------
  let body: UpstreamBody = withBody ? { kind: 'stream', stream: request.body } : { kind: 'none' };
  if (plan && plan.pre.length > 0) {
    const wanted = largestBodyMax(plan.pre);
    let seen: { bytes: Buffer; complete: boolean } | null = null;
    if (withBody && wanted > 0) {
      let read;
      try {
        read = await readUpTo(
          request.body,
          Math.min(wanted, target.maxBodyBytes),
          bodyIdleTimeoutMs,
        );
      } catch (err: unknown) {
        writeError(res, surface, 400, { error: 'The request body could not be read' });
        return { status: 400, error: err instanceof Error ? err.message : String(err) };
      }
      seen = { bytes: read.bytes, complete: read.complete };
      body = read.complete
        ? { kind: 'buffer', bytes: read.bytes }
        : {
            kind: 'prefixed',
            prefix: Buffer.concat([read.bytes, read.overflow]),
            rest: request.body,
          };
      if (!read.complete && wanted >= target.maxBodyBytes) {
        writeError(res, surface, 413, {
          error: "Request body exceeds the plugin's body limit",
          maxBodyBytes: target.maxBodyBytes,
        });
        return { status: 413 };
      }
    }
    const hookInputHeaders = hookHeaders(headers);
    delete hookInputHeaders['host'];
    for (const { hook, route } of plan.pre) {
      let hookBody: { bytes: Buffer; contentType: string | null } | null = null;
      if (hook.bodyMaxBytes !== null && withBody && seen) {
        if (!seen.complete || seen.bytes.length > hook.bodyMaxBytes) {
          if (hook.onOversize === 'continue') continue;
          writeError(res, surface, 413, {
            error: 'The request body is too large for a request hook of this plugin',
            maxBytes: hook.bodyMaxBytes,
          });
          return { status: 413, hook: 'oversize' };
        }
        hookBody = { bytes: seen.bytes, contentType: contentTypeOf(request.headers) };
      }
      const run = await plan.runtime.run(
        target.plugin,
        hook,
        { ...requestInfo, headers: hookInputHeaders, route },
        hookBody,
      );
      if (!run.ok) {
        if (hook.onError === 'continue') continue;
        writeError(res, surface, 503, {
          error: 'A request hook of this plugin failed',
          reasonId: 'hook-failed',
        });
        return { status: 503, hook: 'failed' };
      }
      const decision = run.decision as PreForwardDecision;
      if (decision.action === 'reject') {
        if (surface === 'peer') markPeerRelayAnswer(res, 'hook_rejected');
        writeJson(
          res,
          decision.status,
          decision.body ?? { error: 'Rejected by a request hook of this plugin' },
        );
        return { status: decision.status, hook: 'rejected' };
      }
      applyHeaderEdits(headers, decision.setHeaders, decision.removeHeaders);
    }
  }

  // --- forward ----------------------------------------------------------------
  // What the relay itself adds (a peer delegation for the agent half's
  // onward calls): after every strip and hook edit, so neither a client nor
  // a hook can supply or remove it.
  for (const [name, value] of Object.entries(extraHeaders)) headers[name.toLowerCase()] = value;
  const wantedResponse = plan ? largestBodyMax(plan.post) : 0;
  if (wantedResponse > 0) headers['accept-encoding'] = 'identity';
  // The nonce is chosen here so the answer's responder signature can be
  // checked against it.
  const nonce = generateCallerAssertionNonce();
  try {
    headers[CALLER_ASSERTION_HEADER] = signCallerAssertion(
      { plugin: target.plugin, caller, method, path: targetPath, nonce },
      target.secret,
    );
  } catch (err: unknown) {
    // A malformed secret, or a caller the path is not for: a mistake in
    // Lamaste — nothing is sent, and the hijacked reply is still answered.
    writeError(res, surface, 500, { error: 'The request could not be signed for the agent half' });
    return { status: 500, error: err instanceof Error ? err.message : String(err) };
  }
  if (body.kind === 'buffer') headers['content-length'] = String(body.bytes.length);
  else if (withBody && declared !== undefined) headers['content-length'] = declared;

  const upstream = await openUpstream({
    method,
    targetPath,
    headers,
    body,
    target,
    timeouts: opts,
    clientRes: res,
  });
  if (!upstream.ok) return answerFailure(res, upstream, fallback, surface);
  const upstreamRes = upstream.res;

  // Nothing of an answer reaches the client — not its status, not a header —
  // before it has shown it is the agent half's.
  const responder = upstreamRes.headers[RESPONDER_HEADER];
  if (
    !verifyResponder(responder, {
      secret: target.secret,
      nonce,
      status: upstreamRes.statusCode ?? 0,
    })
  ) {
    upstreamRes.destroy();
    const outcome = answerFailure(
      res,
      { ok: false, status: 502, error: UNAUTHENTICATED_ANSWER, extra: { reason: 'app' } },
      fallback,
      surface,
    );
    // The log line says which: an old or foreign answer, or a forged one.
    return {
      ...outcome,
      error:
        responder === undefined
          ? `${UNAUTHENTICATED_ANSWER} (no X-Lamalibre-Responder header)`
          : `${UNAUTHENTICATED_ANSWER} (its X-Lamalibre-Responder header does not verify)`,
    };
  }

  if (!plan || plan.post.length === 0) return streamResponse(upstreamRes, res, opts, surface);

  // --- request:post-forward ---------------------------------------------------
  const status = upstreamRes.statusCode ?? 502;
  const responseHeaders = forwardedResponseHeaders(upstreamRes.headers);
  if (isEventStream(upstreamRes.headers)) {
    // A stream cannot be checked as a whole: a body-reading post hook
    // treats it as too large.
    if (plan.post.some((p) => p.hook.bodyMaxBytes !== null && p.hook.onOversize !== 'pass')) {
      upstreamRes.destroy();
      writeError(res, surface, 502, {
        error: "A streaming response cannot be checked by this plugin's response hook",
        reasonId: 'response-not-checkable',
      });
      return { status: 502, hook: 'blocked' };
    }
    return streamResponse(upstreamRes, res, opts, surface);
  }

  let current: { bytes: Buffer; complete: boolean; overflow: Buffer } = {
    bytes: Buffer.alloc(0),
    complete: false,
    overflow: Buffer.alloc(0),
  };
  if (wantedResponse > 0) {
    try {
      current = await readUpTo(upstreamRes, wantedResponse, bodyIdleTimeoutMs);
    } catch (err: unknown) {
      upstreamRes.destroy();
      writeError(res, surface, 502, {
        error: "The hosting agent's response ended early",
        reason: 'app',
      });
      return { status: 502, error: err instanceof Error ? err.message : String(err) };
    }
  }
  let replaced = false;
  for (const { hook, route } of plan.post) {
    let hookBody: { bytes: Buffer; contentType: string | null } | null = null;
    if (hook.bodyMaxBytes !== null) {
      if (!current.complete || current.bytes.length > hook.bodyMaxBytes) {
        if (hook.onOversize === 'pass') continue;
        upstreamRes.destroy();
        writeError(res, surface, 502, {
          error: 'The response is too large for a response hook of this plugin',
          reasonId: 'response-too-large',
        });
        return { status: 502, hook: 'oversize' };
      }
      hookBody = { bytes: current.bytes, contentType: contentTypeOf(responseHeaders) };
    }
    const run = await plan.runtime.run(
      target.plugin,
      hook,
      {
        status,
        headers: hookHeaders(responseHeaders),
        request: requestInfo,
        route,
      },
      hookBody,
    );
    if (!run.ok) {
      if (hook.onError === 'pass') continue;
      upstreamRes.destroy();
      writeError(res, surface, 502, {
        error: 'A response hook of this plugin failed',
        reasonId: 'hook-failed',
      });
      return { status: 502, hook: 'failed' };
    }
    const decision = run.decision as ValidatedDecision<'request:post-forward'>;
    if (decision.action === 'block') {
      upstreamRes.destroy();
      const blockedStatus = decision.status ?? 502;
      writeError(res, surface, blockedStatus, {
        error: 'Blocked by a response hook of this plugin',
        reasonId: decision.reasonId,
      });
      return { status: blockedStatus, hook: 'blocked' };
    }
    if (decision.action === 'replace') {
      if (!current.complete) upstreamRes.destroy();
      current = { bytes: run.body ?? Buffer.alloc(0), complete: true, overflow: Buffer.alloc(0) };
      if (decision.contentType) responseHeaders['content-type'] = decision.contentType;
      // The new body is what the hook wrote: no longer the encoding or the
      // validator of the original.
      delete responseHeaders['content-encoding'];
      delete responseHeaders['etag'];
      applyHeaderEdits(responseHeaders, decision.setHeaders, undefined);
      replaced = true;
    }
  }

  if (current.complete) {
    upstreamRes.resume();
    responseHeaders['content-length'] = String(current.bytes.length);
    delete responseHeaders['transfer-encoding'];
    if (!res.headersSent) {
      res.writeHead(status, clientResponseHeaders(responseHeaders, surface));
      res.end(current.bytes);
    }
    return { status, ...(replaced ? { hook: 'replaced' } : {}) };
  }
  // Every hook passed on a body it could not see whole: stream it on.
  const outcome = await streamResponse(
    upstreamRes,
    res,
    opts,
    surface,
    Buffer.concat([current.bytes, current.overflow]),
  );
  upstreamRes.resume();
  return outcome;
}
