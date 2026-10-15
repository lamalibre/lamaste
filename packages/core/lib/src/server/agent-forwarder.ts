/**
 * The agent forwarder — the panel's own handling of `/api/<route>/*` for an
 * agent-hosted plugin whose agent half is hosted on an agent.
 *
 * The plugin host never imports such a plugin. Instead every request under
 * its route is forwarded to `http://127.0.0.1:<port>/admin/<rest>` — the
 * relay end of the plugin's internal tunnel — with a caller assertion
 * (`caller-assertion.ts`) naming who the panel admitted. Only `/admin/*` of
 * the agent half is reachable this way; its `/app/*` (the user surface) is
 * not, because the forwarder prefixes `/admin` to whatever it is given.
 *
 * Streaming both ways over Node's own HTTP client (no dependency): bodies
 * are piped, never buffered, so uploads, downloads and server-sent events
 * pass through as they arrive. What the forwarder enforces:
 *
 * - the plugin's body limit (the internal tunnel's `maxBodySizeMb`): a
 *   larger `Content-Length` is refused with 413 before anything is sent,
 *   and a chunked body that grows past it is cut off;
 * - a headers timeout (default 30 s) — 504 when the agent half has not
 *   answered by then; and an idle timeout on the response body, except for
 *   `text/event-stream`, which may stay quiet as long as the application
 *   keeps the connection;
 * - a clean 502 when nothing listens on the port (the tunnel is down) or the
 *   connection drops before the response headers.
 *
 * What never reaches the agent half: the caller's cookies and
 * `Authorization` header (the panel's own session must not leak to an
 * application), the client-certificate headers nginx set, anything the
 * client sent under `X-Lamalibre-*` or `Remote-*`, and hop-by-hop headers.
 * What never reaches the client: `Set-Cookie` from the application (the
 * assertion is the authentication; a cookie on the panel's origin would be
 * the application's, not the panel's). Nothing of a body is ever logged —
 * one metadata line per request: plugin, caller, method, path (no query),
 * status, duration.
 */

import http from 'node:http';
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse,
} from 'node:http';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { CALLER_ASSERTION_HEADER, signCallerAssertion } from '../caller-assertion.js';
import type { CallerIdentity } from '../caller-assertion.js';
import { RESERVED_API_PREFIXES } from '../constants.js';
import {
  AGENT_HALF_HOOKS_PREFIX,
  matchRoutePattern,
  requestPathSegments,
  routePattern,
} from '../hooks/index.js';
import type { PreForwardDecision, RoutePattern, TunnelFallback } from '../hooks/index.js';
import type { RequestHook } from '../hook-set.js';
import { isHookEditableHeader } from './hook-decisions.js';
import type { ValidatedDecision } from './hook-decisions.js';

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
  readonly maxBodyBytes: number;
}

/** Why a route cannot be forwarded right now. */
export type AgentForwardRefusal =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'not_hosted' };

export type AgentForwardResolution = AgentForwardTarget | AgentForwardRefusal;

export interface AgentForwarderLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export interface AgentForwarderOptions {
  /**
   * Resolve the route of a request to a target, or say why not. Called on
   * every request so a hosting created or rotated a moment ago takes effect
   * at once.
   */
  resolveTarget(route: string): Promise<AgentForwardResolution>;
  /**
   * Who the panel admits for this plugin's routes — after the panel's own
   * authentication. Return `null` to refuse (403). Never called for a route
   * that does not resolve to a target.
   */
  authorize(request: FastifyRequest, plugin: string): Promise<CallerIdentity | null>;
  /**
   * Called before a target request is forwarded; a non-null reply status
   * is sent instead (the onboarding guard: 503 before the relay is set up).
   */
  guard?: ((request: FastifyRequest) => { status: number; body: unknown } | null) | undefined;
  readonly headersTimeoutMs?: number | undefined;
  readonly bodyIdleTimeoutMs?: number | undefined;
  readonly connectTimeoutMs?: number | undefined;
  /** Where the agent half is reached. Default 127.0.0.1 — the relay loopback. */
  readonly host?: string | undefined;
  readonly logger?: AgentForwarderLogger | undefined;
  /**
   * The plugins' request hooks (`createHookedForwarder`). Without it every
   * request streams through untouched, as in 2a.
   */
  readonly hooks?: RequestHookRuntime | undefined;
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

const ROUTE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

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

/** Request headers that carry the caller's credentials or nginx's verdicts. */
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
]);

/** Response headers the panel keeps to itself. */
const STRIPPED_RESPONSE_HEADERS = new Set(['set-cookie', 'set-cookie2']);

function isStrippedRequestHeader(name: string): boolean {
  return (
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

/** The response headers passed back to the client. Pure; exported for tests. */
export function forwardedResponseHeaders(incoming: IncomingHttpHeaders): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined || HOP_BY_HOP.has(name) || STRIPPED_RESPONSE_HEADERS.has(name)) {
      continue;
    }
    out[name] = value;
  }
  return out;
}

/**
 * Map the request URL (`/api/<route>[/<rest>][?query]`) to the path on the
 * agent half (`/admin[/<rest>][?query]`). Returns null when the URL does
 * not start with the route, or when `rest` tries to climb out of `/admin`
 * (a decoded segment of `..`). Pure; exported for tests.
 */
export function agentHalfPath(rawUrl: string, apiPrefix: string, route: string): string | null {
  const prefix = `${apiPrefix}/${route}`;
  if (rawUrl !== prefix && !rawUrl.startsWith(`${prefix}/`) && !rawUrl.startsWith(`${prefix}?`)) {
    return null;
  }
  const rest = rawUrl.slice(prefix.length);
  const query = rest.indexOf('?');
  const pathPart = query === -1 ? rest : rest.slice(0, query);
  for (const segment of pathPart.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    // An encoded `/` or `\` would let one segment look like two to the agent
    // half and like one to a request hook's route pattern.
    if (decoded === '..' || decoded === '.' || decoded.includes('\\') || decoded.includes('/')) {
      return null;
    }
  }
  return `${AGENT_HALF_ADMIN_PREFIX}${rest}`;
}

/** `hooks`, the segment after `/admin` that Lamaste keeps for itself. */
const AGENT_HALF_HOOKS_SEGMENT = AGENT_HALF_HOOKS_PREFIX.split('/')[2] ?? 'hooks';

/**
 * Whether an agent-half path is under `/admin/hooks` — Lamaste's lifecycle
 * hook calls, which no forwarded caller may reach. Compared decoded and
 * case-insensitively, like a request hook's route pattern. Pure; exported
 * for tests.
 */
export function isAgentHalfHooksPath(targetPath: string): boolean {
  const query = targetPath.indexOf('?');
  const pathOnly = query === -1 ? targetPath : targetPath.slice(0, query);
  const segments = pathOnly.split('/').filter((s) => s.length > 0);
  const second = segments[1];
  if (second === undefined) return false;
  try {
    return decodeURIComponent(second).toLowerCase() === AGENT_HALF_HOOKS_SEGMENT;
  } catch {
    return true;
  }
}

/** How a caller appears in logs and hook inputs. */
export function callerLabel(caller: CallerIdentity): string {
  if (caller.type === 'agent') return `agent:${caller.label}`;
  return caller.type;
}

function isEventStream(headers: IncomingHttpHeaders): boolean {
  const type = headers['content-type'];
  return typeof type === 'string' && type.toLowerCase().startsWith('text/event-stream');
}

function errorBody(error: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ error, ...extra });
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
      callback(new Error('Request body exceeds the plugin tunnel body limit'));
      return;
    }
    callback(null, chunk);
  }
}

interface ForwardOutcome {
  readonly status: number;
  readonly error?: string | undefined;
  /**
   * What a request hook did (`rejected`, `blocked`, `replaced`, `oversize`,
   * `failed`, `fallback`), for the log line.
   */
  readonly hook?: string | undefined;
}

type ForwardTimeouts = Pick<
  AgentForwarderOptions,
  'headersTimeoutMs' | 'bodyIdleTimeoutMs' | 'connectTimeoutMs' | 'host'
>;

/** What the upstream request sends as its body. */
type UpstreamBody =
  | { readonly kind: 'none' }
  | { readonly kind: 'stream'; readonly stream: Readable }
  | { readonly kind: 'buffer'; readonly bytes: Buffer }
  | { readonly kind: 'prefixed'; readonly prefix: Buffer; readonly rest: Readable };

type UpstreamResult =
  | { readonly ok: true; readonly res: IncomingMessage }
  | {
      readonly ok: false;
      readonly status: number;
      readonly error: string;
      readonly extra: Readonly<Record<string, unknown>>;
    };

function hasRequestBody(method: string): boolean {
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
  readonly timeouts: ForwardTimeouts;
  readonly clientRes: ServerResponse;
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

    // The client went away before the response was complete: stop the
    // upstream request too. Watched on the response, not the request — an
    // IncomingMessage emits 'close' as soon as its body has been read, which
    // for a piped request body is long before the reply exists.
    clientRes.once('close', () => {
      if (!clientRes.writableFinished) upstream.destroy();
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
        fail(413, 'Request body exceeds the plugin tunnel body limit', {
          maxBodyBytes: target.maxBodyBytes,
        });
        return;
      }
      fail(502, `Forwarding the request body failed: ${err.message}`);
    });
  });
}

/** Write a JSON answer on a hijacked reply. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
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

/** Answer a forwarding failure — or, while the plugin is down, its `tunnel:down` fallback. */
function answerFailure(
  res: ServerResponse,
  failure: Extract<UpstreamResult, { ok: false }>,
  fallback: TunnelFallback | null,
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
  writeJson(res, failure.status, { error: failure.error, ...failure.extra });
  return { status: failure.status, error: failure.error };
}

/**
 * Stream a response to the client: headers, an optional prefix already
 * read, then the rest. Server-sent events are flushed and never cut for
 * silence; any other body is cut after `bodyIdleTimeoutMs` of silence.
 */
function streamResponse(
  upstreamRes: IncomingMessage,
  res: ServerResponse,
  timeouts: ForwardTimeouts,
  prefix: Buffer | null = null,
): Promise<ForwardOutcome> {
  const bodyIdleTimeoutMs = timeouts.bodyIdleTimeoutMs ?? AGENT_FORWARD_DEFAULTS.bodyIdleTimeoutMs;
  const status = upstreamRes.statusCode ?? 502;
  const responseHeaders = forwardedResponseHeaders(upstreamRes.headers);
  const eventStream = isEventStream(upstreamRes.headers);
  if (eventStream) {
    // nginx in front of the panel buffers responses; this header turns
    // that off for this response so events reach the browser as sent.
    responseHeaders['x-accel-buffering'] = 'no';
    responseHeaders['cache-control'] = 'no-cache';
  }
  res.writeHead(status, responseHeaders);
  if (eventStream) res.flushHeaders();
  if (prefix && prefix.length > 0) res.write(prefix);

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
function readUpTo(
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

/**
 * Forward one request to `target` and stream the response back — no hooks.
 * Takes over the reply (`reply.hijack()`) so nothing between the agent half
 * and the client buffers or rewrites the body. Resolves once the response
 * has been sent, or the failure answered.
 */
export async function forwardToAgentHalf(
  request: FastifyRequest,
  reply: FastifyReply,
  target: AgentForwardTarget,
  caller: CallerIdentity,
  targetPath: string,
  opts: ForwardTimeouts = {},
): Promise<ForwardOutcome> {
  return forward(request, reply, target, caller, targetPath, opts, null);
}

/** A request hook that matched a request, and the route pattern it matched with. */
interface MatchedHook {
  readonly hook: RequestHook;
  readonly route: string;
}

interface HookPlan {
  readonly runtime: RequestHookRuntime;
  readonly pre: readonly MatchedHook[];
  readonly post: readonly MatchedHook[];
}

/** The most body any of `hooks` reads: 0 when none reads one. */
function largestBodyMax(hooks: readonly MatchedHook[]): number {
  return hooks.reduce((max, p) => Math.max(max, p.hook.bodyMaxBytes ?? 0), 0);
}

async function forward(
  request: FastifyRequest,
  reply: FastifyReply,
  target: AgentForwardTarget,
  caller: CallerIdentity,
  targetPath: string,
  opts: ForwardTimeouts,
  plan: HookPlan | null,
): Promise<ForwardOutcome> {
  const method = request.method.toUpperCase();
  const bodyIdleTimeoutMs = opts.bodyIdleTimeoutMs ?? AGENT_FORWARD_DEFAULTS.bodyIdleTimeoutMs;
  const fallback = plan?.runtime.fallbackFor(target.plugin) ?? null;

  const declared = request.headers['content-length'];
  if (declared !== undefined) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) {
      return answer(reply, 400, errorBody('Invalid Content-Length'));
    }
    if (length > target.maxBodyBytes) {
      return answer(
        reply,
        413,
        errorBody('Request body exceeds the plugin tunnel body limit', {
          maxBodyBytes: target.maxBodyBytes,
        }),
      );
    }
  }

  const headers = forwardedRequestHeaders(request.headers, target.port, opts.host ?? '127.0.0.1');
  const query = targetPath.includes('?') ? targetPath.slice(targetPath.indexOf('?') + 1) : '';
  const pathOnly = targetPath.split('?')[0] ?? targetPath;
  const requestInfo = { method, path: pathOnly, query, caller };

  reply.hijack();
  const res = reply.raw;
  const withBody = hasRequestBody(method);

  // --- request:pre-forward ---------------------------------------------------
  let body: UpstreamBody = withBody ? { kind: 'stream', stream: request.raw } : { kind: 'none' };
  if (plan && plan.pre.length > 0) {
    const wanted = largestBodyMax(plan.pre);
    let seen: { bytes: Buffer; complete: boolean } | null = null;
    if (withBody && wanted > 0) {
      let read;
      try {
        read = await readUpTo(
          request.raw,
          Math.min(wanted, target.maxBodyBytes),
          bodyIdleTimeoutMs,
        );
      } catch (err: unknown) {
        writeJson(res, 400, { error: 'The request body could not be read' });
        return { status: 400, error: err instanceof Error ? err.message : String(err) };
      }
      seen = { bytes: read.bytes, complete: read.complete };
      body = read.complete
        ? { kind: 'buffer', bytes: read.bytes }
        : {
            kind: 'prefixed',
            prefix: Buffer.concat([read.bytes, read.overflow]),
            rest: request.raw,
          };
      if (!read.complete && wanted >= target.maxBodyBytes) {
        writeJson(res, 413, {
          error: 'Request body exceeds the plugin tunnel body limit',
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
          writeJson(res, 413, {
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
        writeJson(res, 503, {
          error: 'A request hook of this plugin failed',
          reasonId: 'hook-failed',
        });
        return { status: 503, hook: 'failed' };
      }
      const decision = run.decision as PreForwardDecision;
      if (decision.action === 'reject') {
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
  const wantedResponse = plan ? largestBodyMax(plan.post) : 0;
  if (wantedResponse > 0) headers['accept-encoding'] = 'identity';
  headers[CALLER_ASSERTION_HEADER] = signCallerAssertion(
    { plugin: target.plugin, caller, method, path: targetPath },
    target.secret,
  );
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
  if (!upstream.ok) return answerFailure(res, upstream, fallback);
  const upstreamRes = upstream.res;

  if (!plan || plan.post.length === 0) return streamResponse(upstreamRes, res, opts);

  // --- request:post-forward ---------------------------------------------------
  const status = upstreamRes.statusCode ?? 502;
  const responseHeaders = forwardedResponseHeaders(upstreamRes.headers);
  if (isEventStream(upstreamRes.headers)) {
    // A stream cannot be checked as a whole: a body-reading post hook
    // treats it as too large.
    if (plan.post.some((p) => p.hook.bodyMaxBytes !== null && p.hook.onOversize !== 'pass')) {
      upstreamRes.destroy();
      writeJson(res, 502, {
        error: "A streaming response cannot be checked by this plugin's response hook",
        reasonId: 'response-not-checkable',
      });
      return { status: 502, hook: 'blocked' };
    }
    return streamResponse(upstreamRes, res, opts);
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
      writeJson(res, 502, { error: "The hosting agent's response ended early", reason: 'app' });
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
        writeJson(res, 502, {
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
      writeJson(res, 502, {
        error: 'A response hook of this plugin failed',
        reasonId: 'hook-failed',
      });
      return { status: 502, hook: 'failed' };
    }
    const decision = run.decision as ValidatedDecision<'request:post-forward'>;
    if (decision.action === 'block') {
      upstreamRes.destroy();
      const blockedStatus = decision.status ?? 502;
      writeJson(res, blockedStatus, {
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
      res.writeHead(status, responseHeaders);
      res.end(current.bytes);
    }
    return { status, ...(replaced ? { hook: 'replaced' } : {}) };
  }
  // Every hook passed on a body it could not see whole: stream it on.
  const outcome = await streamResponse(
    upstreamRes,
    res,
    opts,
    Buffer.concat([current.bytes, current.overflow]),
  );
  upstreamRes.resume();
  return outcome;
}

function answer(reply: FastifyReply, status: number, body: string): ForwardOutcome {
  reply.hijack();
  reply.raw.writeHead(status, { 'content-type': 'application/json' });
  reply.raw.end(body);
  return { status };
}

/**
 * Fastify plugin registering `/:route` and `/:route/*` (under the prefix it
 * is registered with — `/api` on the panel). Register it after every core
 * and plugin-host route: static routes win over the parameters, so only
 * what nothing else answers reaches the forwarder, and a route that
 * resolves to no hosted plugin is answered with the panel's own 404.
 */
export async function agentForwarderPlugin(
  fastify: FastifyInstance,
  opts: AgentForwarderOptions,
): Promise<void> {
  const logger = opts.logger ?? fastify.log;
  const reserved = new Set<string>(RESERVED_API_PREFIXES);
  const apiPrefix = fastify.prefix;

  // The body is handed to the forwarder as the raw stream, whatever its
  // content type: nothing here reads or parses it.
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', (_request, payload, done) => {
    done(null, payload);
  });

  const handler = async (
    request: FastifyRequest<{ Params: { route: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const { route } = request.params;
    if (!ROUTE_RE.test(route) || reserved.has(route)) {
      return reply.callNotFound();
    }
    const resolved = await opts.resolveTarget(route);
    if ('kind' in resolved) {
      if (resolved.kind === 'disabled') {
        return reply.code(503).send({ error: `Plugin "${route}" is disabled` });
      }
      if (resolved.kind === 'not_hosted') {
        return reply.code(503).send({
          error: `Plugin "${route}" is not hosted on an agent yet`,
          hint: `POST /api/plugins/${route}/hosting with the agent that runs it`,
        });
      }
      return reply.callNotFound();
    }
    const guarded = opts.guard?.(request) ?? null;
    if (guarded) {
      return reply.code(guarded.status).send(guarded.body);
    }
    const caller = await opts.authorize(request, resolved.plugin);
    if (!caller) {
      return reply.code(403).send({
        error: 'Insufficient scope for plugin route',
        details: { required: `admin OR agent with a "plugin:${route}:*" capability` },
      });
    }
    const targetPath = agentHalfPath(request.raw.url ?? '', apiPrefix, route);
    if (targetPath === null) {
      return reply.code(400).send({ error: 'Invalid plugin path' });
    }
    if (isAgentHalfHooksPath(targetPath)) {
      return reply.callNotFound();
    }

    let plan: HookPlan | null = null;
    if (opts.hooks) {
      const found = await opts.hooks.hooksFor(resolved.plugin);
      if ('refuse' in found) {
        return reply.code(503).send({ error: found.refuse, code: 'hooks_not_approved' });
      }
      const method = request.method.toUpperCase();
      const segments = requestPathSegments(targetPath) ?? [];
      const pre: MatchedHook[] = [];
      const post: MatchedHook[] = [];
      for (const hook of found.hooks) {
        const matched = matchedRoute(hook, method, segments);
        if (matched === null) continue;
        (hook.stage === 'pre-forward' ? pre : post).push({ hook, route: matched });
      }
      plan = { runtime: opts.hooks, pre, post };
    }

    const startedAt = Date.now();
    const outcome = await forward(request, reply, resolved, caller, targetPath, opts, plan);
    const pathOnly = targetPath.split('?')[0] ?? targetPath;
    const line = {
      plugin: resolved.plugin,
      caller: callerLabel(caller),
      method: request.method,
      path: pathOnly,
      status: outcome.status,
      durationMs: Date.now() - startedAt,
      ...(plan && (plan.pre.length > 0 || plan.post.length > 0)
        ? { hooks: { pre: plan.pre.length, post: plan.post.length } }
        : {}),
      ...(outcome.hook ? { hook: outcome.hook } : {}),
      ...(outcome.error ? { error: outcome.error } : {}),
    };
    if (outcome.error) logger.warn(line, 'Plugin request not completed');
    else logger.info(line, 'Forwarded plugin request');
  };

  fastify.all('/:route', handler);
  fastify.all('/:route/*', handler);
}

export interface HookedForwarderOptions extends AgentForwarderOptions {
  readonly hooks: RequestHookRuntime;
}

/**
 * The forwarder with request hooks: matching routes have their request
 * buffered for `request:pre-forward` (validate, reject before anything
 * enters the tunnel) and their response for `request:post-forward` (scan,
 * redact or block before it leaves the relay); every other route streams
 * through untouched. While the plugin is down, a failed request is answered
 * with its `tunnel:down` fallback. The admin forwarder uses it now; the
 * plugin gateway of the user surface will, so hooks behave the same on both.
 */
export function createHookedForwarder(
  opts: HookedForwarderOptions,
): (fastify: FastifyInstance) => Promise<void> {
  return (fastify) => agentForwarderPlugin(fastify, opts);
}
