/**
 * The agent forwarder — the panel's own handling of `/api/<route>/*` for an
 * agent-hosted plugin whose agent half is hosted on an agent.
 *
 * The plugin host never imports such a plugin. Instead every request under
 * its route is forwarded to `http://127.0.0.1:<port>/admin/<rest>` — the
 * relay end of the plugin's internal tunnel — with a caller assertion
 * (`caller-assertion.ts`) naming who the panel admitted. Only `/admin/*` of
 * the agent half is reachable this way; its `/app/*` (the user surface) is
 * not, because the forwarder prefixes `/admin` to whatever it is given. Nor
 * is the agent half's `/admin/app` or anything under it: on the panel,
 * `/api/<route>/app` and `/api/<route>/app/*` are the user surface's routes
 * ({@link userSurfacePlugin}, on the same router), which win over this
 * forwarder's `/:route/*` as static segments win over a wildcard — an
 * agent half keeps none of its admin routes there.
 * Within `/admin`, three subtrees are Lamaste's own and answered 404 however
 * they are spelled ({@link isAgentHalfReservedPath}): `/admin/hooks*`, the
 * lifecycle hook calls, `/admin/settings*`, where Lamaste writes the
 * plugin's settings and secrets after validating them — no forwarded
 * caller reads or changes them behind the panel's back, so the relay's
 * cache cannot drift from the agent half — and `/admin/identity*`, the
 * identity feed only Lamaste sends.
 *
 * The user surface has its own entry, {@link userSurfacePlugin}:
 * `/api/<route>/app/*` on the host bound to a plugin that declares
 * `identity`, admitted by a relay assertion Gatekeeper signs for the panel
 * (the session's username) and forwarded to `/app/*` with a `user` caller
 * — the directory's user id, username and the plugin's roles. Both entries
 * share one pipeline: the same header strips, body limit, signing,
 * responder check, streaming and request hooks. A user surface's answers
 * also carry {@link USER_SURFACE_RESPONSE_HEADERS} and never
 * `Access-Control-*`, its own errors are fixed texts, a request another
 * site started is refused, and a response is ended when its user loses
 * access or after {@link USER_SURFACE_MAX_RESPONSE_MS}.
 *
 * Every answer must authenticate itself: the agent half signs it with
 * `X-Lamalibre-Responder` (the `-` form: the request's nonce and the
 * answer's status, keyed with the installation secret — `responderHeaderFor`
 * in `@lamalibre/lamaste/agent`), and the forwarder checks that before it
 * sends the client a status, a header or a byte. A process that took the
 * relay-loopback port while the hosting agent was away cannot serve
 * anything — a plugin's `panel.js` least of all, which runs in the panel's
 * own document — and gets a 502 (`reason: 'app'`) instead.
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
 *   connection drops before the response headers — and, once the health
 *   monitor has marked the hosting down, the same answer (or the plugin's
 *   `tunnel:down` fallback) without connecting at all: whatever took the
 *   port meanwhile receives nothing.
 *
 * What never reaches the agent half: the caller's cookies and
 * `Authorization` header (the panel's own session must not leak to an
 * application), the client-certificate headers nginx set, anything the
 * client sent under `X-Lamalibre-*` or `Remote-*`, hop-by-hop headers, and
 * the headers that make some frameworks take a request for another method
 * or path than the one the caller assertion signs
 * (`METHOD_URL_OVERRIDE_HEADERS`: `X-HTTP-Method-Override`,
 * `X-Original-URL`, `X-Forwarded-Prefix`, …).
 * What never reaches the client: `Set-Cookie` from the application (the
 * assertion is the authentication; a cookie on the panel's origin would be
 * the application's, not the panel's), `Service-Worker-Allowed` and
 * `Clear-Site-Data` (a plugin's answer must not widen a service worker's
 * scope over the panel or wipe the panel's storage), anything under
 * `X-Lamalibre-*` (the responder signature is the relay's to check, not the
 * client's to see) and anything under `X-Accel-*` — nginx in front of the
 * panel obeys `X-Accel-Redirect` and its kin from 3100, so an application
 * could otherwise have nginx serve a file or an internal location; the
 * forwarder sets `X-Accel-Buffering: no` itself on an event stream. A
 * request that fetches a service worker's script (`Service-Worker: script`)
 * is refused with 403 before it enters the tunnel: no plugin installs a
 * service worker on the panel's origin. Plugin admin bundles share the
 * panel's document — a documented boundary until plugin UIs are isolated
 * in sandboxed frames.
 *
 * Nothing of a body is ever logged — one metadata line per request:
 * plugin, caller (a user as `user:<userId>`, never by name), method, path
 * (no query), status, duration.
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

import {
  CALLER_ASSERTION_HEADER,
  RESPONDER_HEADER,
  generateCallerAssertionNonce,
  parseCallerIdentity,
  signCallerAssertion,
  verifyResponder,
} from '../caller-assertion.js';
import type { CallerIdentity, UserCallerIdentity } from '../caller-assertion.js';
import { RESERVED_API_PREFIXES } from '../constants.js';
import {
  AGENT_HALF_HOOKS_PREFIX,
  matchRoutePattern,
  requestPathSegments,
  routePattern,
} from '../hooks/index.js';
import type {
  HookCaller,
  PreForwardDecision,
  RoutePattern,
  TunnelFallback,
} from '../hooks/index.js';
import type { RequestHook } from '../hook-set.js';
import { AGENT_HALF_IDENTITY_PREFIX } from '../identity.js';
import { AGENT_HALF_SETTINGS_PATH } from '../plugin-settings.js';
import {
  AGENT_HALF_APP_PREFIX,
  USER_SURFACE_API_PREFIX,
  USER_SURFACE_MAX_RESPONSE_SECONDS,
  isUserSurfaceUrl,
  routerSegment,
  userSurfaceApiPath,
} from '../user-surface.js';
import { METHOD_URL_OVERRIDE_HEADERS, isHookEditableHeader } from './hook-decisions.js';
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

export interface AgentForwarderOptions extends AgentForwardTimeouts {
  /**
   * Resolve the route of a request to a target, or say why not. Called on
   * every request so a hosting created or rotated a moment ago takes effect
   * at once. `down` is answered — after the guard and the caller's
   * authorization — as a request into a dead tunnel is (the plugin's
   * `tunnel:down` fallback, or `502` with the reason), without sending
   * anything to the port.
   */
  resolveTarget(route: string): Promise<AgentForwardResolution>;
  /**
   * Who the panel admits for this plugin's routes — after the panel's own
   * authentication: an admin or an agent. Return `null` to refuse (403).
   * Never called for a route that does not resolve to a target.
   */
  authorize(request: FastifyRequest, plugin: string): Promise<AdminSurfaceCaller | null>;
  /**
   * Called before a target request is forwarded; a non-null reply status
   * is sent instead (the onboarding guard: 503 before the relay is set up).
   */
  guard?: ((request: FastifyRequest) => { status: number; body: unknown } | null) | undefined;
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
const UNAUTHENTICATED_ANSWER = 'The agent half did not authenticate its answer';

/**
 * The admin API's answer while the plugin's hosting is down — the answer a
 * request forwarded into a dead tunnel gets (`502`, with the reason), never
 * sent to the port: the `tunnel:down` fallback when the plugin has one.
 */
function downFailure(reason: 'tunnel' | 'app'): Extract<UpstreamResult, { ok: false }> {
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
      HOP_BY_HOP.has(name) ||
      STRIPPED_RESPONSE_HEADERS.has(name) ||
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
export function applyUserSurfaceResponseHeaders(res: ServerResponse): void {
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

/** `hooks`, a segment after `/admin` that Lamaste keeps for itself. */
const AGENT_HALF_HOOKS_SEGMENT = AGENT_HALF_HOOKS_PREFIX.split('/')[2] ?? 'hooks';

/** `settings`, another one. */
const AGENT_HALF_SETTINGS_SEGMENT = AGENT_HALF_SETTINGS_PATH.split('/')[2] ?? 'settings';

/** `identity`, the third: the identity feed. */
const AGENT_HALF_IDENTITY_SEGMENT = AGENT_HALF_IDENTITY_PREFIX.split('/')[2] ?? 'identity';

/**
 * Whether an agent-half path is under `/admin/hooks` — Lamaste's lifecycle
 * hook calls, which no forwarded caller may reach. The segment after
 * `/admin` is compared as `routerSegment` reduces it (one that does not
 * decode is reserved), and reserved when it *starts with* `hooks`:
 * `/admin/Hooks`, `/admin/%2568ooks`, `/admin/hooks.json` and
 * `/admin/hooks-v2` alike, whatever a framework's router would make of
 * them. Pure; exported for tests.
 */
export function isAgentHalfHooksPath(targetPath: string): boolean {
  const segment = routerSegment(targetPath, 1);
  return (
    segment === null || (segment !== undefined && segment.startsWith(AGENT_HALF_HOOKS_SEGMENT))
  );
}

/**
 * Whether an agent-half path is one the forwarder must never reach:
 * `/admin/hooks*` (lifecycle hook calls), `/admin/settings*` (settings and
 * secrets, written only by Lamaste after its own validation) or
 * `/admin/identity*` (the identity feed, sent only by Lamaste) — the
 * segment after `/admin` reduced as `routerSegment` does (one that does not
 * decode is reserved), then compared by prefix, so `/admin/Settings`,
 * `/admin/%73ettings/x`, `/admin/settings.json`, `/admin/settings_v2` and
 * `/admin/IDENTITY` are reserved too. Pure; exported for tests.
 */
export function isAgentHalfReservedPath(targetPath: string): boolean {
  const segment = routerSegment(targetPath, 1);
  return (
    segment === null ||
    (segment !== undefined &&
      (segment.startsWith(AGENT_HALF_HOOKS_SEGMENT) ||
        segment.startsWith(AGENT_HALF_SETTINGS_SEGMENT) ||
        segment.startsWith(AGENT_HALF_IDENTITY_SEGMENT)))
  );
}

/** How a caller appears in logs: a user by the directory's id, never by name. */
export function callerLabel(caller: CallerIdentity): string {
  if (caller.type === 'agent') return `agent:${caller.label}`;
  if (caller.type === 'user') return `user:${caller.userId}`;
  return caller.type;
}

/** How a caller appears in a request hook's input: a user by id and roles only. */
function hookCallerOf(caller: ForwardedCaller): HookCaller {
  if (caller.type === 'user') {
    return { type: 'user', userId: caller.userId, roles: [...caller.roles] };
  }
  if (caller.type === 'agent') return { type: 'agent', label: caller.label };
  return { type: 'admin' };
}

function isEventStream(headers: IncomingHttpHeaders): boolean {
  const type = headers['content-type'];
  return typeof type === 'string' && type.toLowerCase().startsWith('text/event-stream');
}

/**
 * Which entry a request came through: the admin API (`/api/<route>/*` →
 * `/admin/*`, administrators and agents) or a plugin's user surface
 * (`/api/<route>/app/*` → `/app/*`, people).
 */
type ForwardSurface = 'admin' | 'user';

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
      callback(new Error('Request body exceeds the plugin tunnel body limit'));
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
  readonly timeouts: AgentForwardTimeouts;
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

/**
 * A forwarded answer's headers as `surface` sends them: on a user surface,
 * {@link userSurfaceResponseHeaders}.
 */
function clientResponseHeaders(
  headers: OutgoingHttpHeaders,
  surface: ForwardSurface,
): OutgoingHttpHeaders {
  return surface === 'user' ? userSurfaceResponseHeaders(headers) : headers;
}

/**
 * Write the relay's own error answer: `body` on the admin API, the fixed
 * text of its status ({@link userSurfaceErrorText}) on a user surface.
 */
function writeError(
  res: ServerResponse,
  surface: ForwardSurface,
  status: number,
  body: Readonly<Record<string, unknown>>,
): void {
  writeJson(res, status, surface === 'user' ? { error: userSurfaceErrorText(status) } : body);
}

/** Answer a forwarding failure — or, while the plugin is down, its `tunnel:down` fallback. */
function answerFailure(
  res: ServerResponse,
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
function streamResponse(
  upstreamRes: IncomingMessage,
  res: ServerResponse,
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
  caller: ForwardedCaller,
  targetPath: string,
  opts: AgentForwardTimeouts = {},
): Promise<ForwardOutcome> {
  return forward(request, reply, target, caller, targetPath, opts, null, 'admin');
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
function largestBodyMax(hooks: readonly MatchedRequestHook[]): number {
  return hooks.reduce((max, p) => Math.max(max, p.hook.bodyMaxBytes ?? 0), 0);
}

async function forward(
  request: FastifyRequest,
  reply: FastifyReply,
  target: AgentForwardTarget,
  caller: ForwardedCaller,
  targetPath: string,
  opts: AgentForwardTimeouts,
  plan: RequestHookPlan | null,
  surface: ForwardSurface,
): Promise<ForwardOutcome> {
  const method = request.method.toUpperCase();
  const bodyIdleTimeoutMs = opts.bodyIdleTimeoutMs ?? AGENT_FORWARD_DEFAULTS.bodyIdleTimeoutMs;
  const fallback = plan?.runtime.fallbackFor(target.plugin) ?? null;

  if (isServiceWorkerRequest(request.headers)) {
    return answer(reply, surface, 403, { error: 'A plugin route cannot serve a service worker' });
  }

  const declared = request.headers['content-length'];
  if (declared !== undefined) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) {
      return answer(reply, surface, 400, { error: 'Invalid Content-Length' });
    }
    if (length > target.maxBodyBytes) {
      return answer(reply, surface, 413, {
        error: 'Request body exceeds the plugin tunnel body limit',
        maxBodyBytes: target.maxBodyBytes,
      });
    }
  }

  const headers = forwardedRequestHeaders(request.headers, target.port, opts.host ?? '127.0.0.1');
  const query = targetPath.includes('?') ? targetPath.slice(targetPath.indexOf('?') + 1) : '';
  const pathOnly = targetPath.split('?')[0] ?? targetPath;
  const requestInfo = { method, path: pathOnly, query, caller: hookCallerOf(caller) };

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
        writeError(res, surface, 400, { error: 'The request body could not be read' });
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
        writeError(res, surface, 413, {
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

/** Answer with the relay's own error before anything was forwarded (see {@link writeError}). */
function answer(
  reply: FastifyReply,
  surface: ForwardSurface,
  status: number,
  body: Readonly<Record<string, unknown>>,
): ForwardOutcome {
  reply.hijack();
  writeError(reply.raw, surface, status, body);
  return { status };
}

/** The one metadata line a forwarded request leaves: never a body, a query or a username. */
function logForwarded(
  logger: AgentForwarderLogger,
  entry: {
    readonly plugin: string;
    readonly caller: ForwardedCaller;
    readonly method: string;
    readonly targetPath: string;
    readonly startedAt: number;
    readonly plan: RequestHookPlan | null;
    readonly outcome: ForwardOutcome;
  },
  messages: { readonly done: string; readonly failed: string },
): void {
  const { plan, outcome } = entry;
  const line = {
    plugin: entry.plugin,
    caller: callerLabel(entry.caller),
    method: entry.method,
    path: entry.targetPath.split('?')[0] ?? entry.targetPath,
    status: outcome.status,
    durationMs: Date.now() - entry.startedAt,
    ...(plan && (plan.pre.length > 0 || plan.post.length > 0)
      ? { hooks: { pre: plan.pre.length, post: plan.post.length } }
      : {}),
    ...(outcome.hook ? { hook: outcome.hook } : {}),
    ...(outcome.error ? { error: outcome.error } : {}),
  };
  if (outcome.error) logger.warn(line, messages.failed);
  else logger.info(line, messages.done);
}

/** The body reaches the forwarder as the raw stream, whatever its type: nothing here parses it. */
function passBodiesThrough(fastify: FastifyInstance): void {
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', (_request, payload, done) => {
    done(null, payload);
  });
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

  passBodiesThrough(fastify);

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
      if (resolved.kind !== 'down') return reply.callNotFound();
    }
    const guarded = opts.guard?.(request) ?? null;
    if (guarded) {
      return reply.code(guarded.status).send(guarded.body);
    }
    // A plugin with an agent half is named by its route.
    const plugin = 'kind' in resolved ? route : resolved.plugin;
    const caller = await opts.authorize(request, plugin);
    // Only an admin or an agent reaches the admin surface; the panel's
    // authorizer names nothing else, and anything else is refused.
    if (!caller || (caller.type !== 'admin' && caller.type !== 'agent')) {
      return reply.code(403).send({
        error: 'Insufficient scope for plugin route',
        details: { required: `admin OR agent with a "plugin:${route}:*" capability` },
      });
    }
    const targetPath = agentHalfPath(request.raw.url ?? '', apiPrefix, route);
    if (targetPath === null) {
      return reply.code(400).send({ error: 'Invalid plugin path' });
    }
    if (isAgentHalfReservedPath(targetPath)) {
      return reply.callNotFound();
    }

    if ('kind' in resolved) {
      // The hosting is down: answered as a request into a dead tunnel is —
      // the plugin's `tunnel:down` fallback, or 502 with the reason — and
      // nothing is sent to whatever holds the port.
      const startedAt = Date.now();
      reply.hijack();
      const outcome = answerFailure(
        reply.raw,
        downFailure(resolved.reason),
        opts.hooks?.fallbackFor(plugin) ?? null,
        'admin',
      );
      logForwarded(
        logger,
        { plugin, caller, method: request.method, targetPath, startedAt, plan: null, outcome },
        {
          done: 'Plugin request answered while its hosting is down',
          failed: 'Plugin request not forwarded: its hosting is down',
        },
      );
      return;
    }

    let plan: RequestHookPlan | null = null;
    if (opts.hooks) {
      const built = await buildRequestHookPlan(
        opts.hooks,
        resolved.plugin,
        request.method,
        targetPath,
      );
      if ('refuse' in built) {
        return reply.code(503).send({ error: built.refuse, code: 'hooks_not_approved' });
      }
      plan = built;
    }

    const startedAt = Date.now();
    const outcome = await forward(
      request,
      reply,
      resolved,
      caller,
      targetPath,
      opts,
      plan,
      'admin',
    );
    logForwarded(
      logger,
      {
        plugin: resolved.plugin,
        caller,
        method: request.method,
        targetPath,
        startedAt,
        plan,
        outcome,
      },
      { done: 'Forwarded plugin request', failed: 'Plugin request not completed' },
    );
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
 * with its `tunnel:down` fallback. The user surface ({@link userSurfacePlugin})
 * runs the same hooks on `/app/*` routes, so they behave the same on both.
 */
export function createHookedForwarder(
  opts: HookedForwarderOptions,
): (fastify: FastifyInstance) => Promise<void> {
  return (fastify) => agentForwarderPlugin(fastify, opts);
}

// ---------------------------------------------------------------------------
// The user surface: /api/<route>/app/* → the agent half's /app/*
// ---------------------------------------------------------------------------

/**
 * Map the request URL of a user-surface request (`/api/<route>/app[/<rest>][?query]`)
 * to the path on the agent half (`/app[/<rest>][?query]`). Null when the
 * URL is not on the route's user surface, or when its path has a segment a
 * server could resolve differently from the check (`isUserSurfaceUrl`, the
 * relay assertion's check: `.` and `..`, encoded `.`, `/` and `\`,
 * backslashes, undecodable escapes). Pure; exported for tests.
 */
export function userSurfaceHalfPath(rawUrl: string, route: string): string | null {
  if (!isUserSurfaceUrl(rawUrl, route)) return null;
  return `${AGENT_HALF_APP_PREFIX}${rawUrl.slice(userSurfaceApiPath(route).length)}`;
}

/** What the panel's relay check made of a user-surface request. */
export type UserSurfaceRelayVerification =
  | {
      readonly ok: true;
      /** The Authelia username Gatekeeper attested. */
      readonly username: string;
      /** The plugin route the assertion is bound to. */
      readonly route: string;
    }
  | { readonly ok: false; readonly reason: string };

/** Who the user is to the plugin, or why they may not use it. */
export type UserCallerResolution =
  | { readonly ok: true; readonly caller: UserCallerIdentity }
  | {
      readonly ok: false;
      /** 403: disabled, removed or not entitled; 404: no such user surface; 503: not ready. */
      readonly status: 403 | 404 | 503;
      readonly error: string;
    };

type MaybePromise<T> = T | Promise<T>;

/**
 * A user-surface response the panel is sending — from the moment its
 * request is forwarded until the answer has been sent or the request ended.
 * The panel keeps the open ones to re-check their user while they last.
 */
export interface OpenUserSurfaceResponse {
  readonly route: string;
  readonly plugin: string;
  /** The user caller the request was forwarded with. */
  readonly caller: UserCallerIdentity;
  /** When the request was forwarded (milliseconds since the epoch). */
  readonly startedAt: number;
  /**
   * End it now — the browser's connection and the request to the agent
   * half — and say why in the request's log line. Idempotent.
   */
  end(reason: string): void;
}

/**
 * The longest a user-surface response lives, in milliseconds
 * ({@link USER_SURFACE_MAX_RESPONSE_SECONDS}).
 */
export const USER_SURFACE_MAX_RESPONSE_MS = USER_SURFACE_MAX_RESPONSE_SECONDS * 1000;

export interface UserSurfaceOptions extends AgentForwardTimeouts {
  /**
   * Check the request's relay assertion (`RELAY_PANEL_AUDIENCE`, bound to
   * the method and the raw request target): the username Gatekeeper
   * attested and the route the assertion is for.
   */
  verifyRelay(request: FastifyRequest): MaybePromise<UserSurfaceRelayVerification>;
  /**
   * The forward target of a route with a user surface — bound to a host its
   * hosting agent carries, its plugin hosted — or why not: null or
   * `not_found` (404: no user surface on the route), `disabled`,
   * `not_hosted` or `down` (503: the plugin is not available right now;
   * nothing is forwarded). Called on every request.
   */
  resolveTarget(route: string): MaybePromise<AgentForwardResolution | null>;
  /** The directory's user behind `username` for this plugin: id, username and roles. */
  resolveUserCaller(route: string, username: string): MaybePromise<UserCallerResolution>;
  /**
   * The origin of the host bound as the route's user surface
   * (`https://<fqdn>`), or null when none is. A request that may change
   * something — any method but GET, HEAD and OPTIONS — must carry exactly
   * that `Origin`.
   */
  originFor(route: string): MaybePromise<string | null>;
  /**
   * Called when a request is forwarded, with what the panel needs to end
   * its response early; returns the function called once it is over. The
   * panel re-checks every open response's user while it lasts — a
   * response must not outlive its user's access.
   */
  trackResponse?: ((response: OpenUserSurfaceResponse) => () => void) | undefined;
  /**
   * The longest a response lives before the panel ends it (default
   * {@link USER_SURFACE_MAX_RESPONSE_MS}).
   */
  readonly maxResponseMs?: number | undefined;
  /** The plugins' request hooks; without it every request streams through untouched. */
  readonly hooks?: RequestHookRuntime | undefined;
  readonly logger?: AgentForwarderLogger | undefined;
  /**
   * Fastify route config of the two routes (`config`) — the panel gives
   * them a rate limit of their own there, and turns its CORS off for them.
   */
  readonly routeConfig?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Whether a request's `Sec-Fetch-Site` lets it on a user surface: absent (a
 * client that does not send it — no browser of this decade), `same-origin`
 * (the bound host's own pages) or `none` (the user typed it, a bookmark).
 * A request another site started — `cross-site`, and `same-site`: another
 * host under the relay's domain, which every tunnel is — is refused, whatever
 * its method: the session cookie travels with it. Pure; exported for tests.
 */
export function isSameOriginFetch(headers: IncomingHttpHeaders): boolean {
  const site = headers['sec-fetch-site'];
  return site === undefined || site === 'same-origin' || site === 'none';
}

/**
 * Fastify plugin serving plugins' user surfaces: `/:route/app` and
 * `/:route/app/*`, registered under the prefix `/api` (anything else
 * throws — the relay assertion binds the path `/api/<route>/app…`), in a
 * context of its own that answers only what Gatekeeper vouched for. Every
 * answer carries {@link USER_SURFACE_RESPONSE_HEADERS} and no
 * `Access-Control-*`. Per request, in order:
 *
 * 1. a request another site started (`Sec-Fetch-Site` present and neither
 *    `same-origin` nor `none`) — 403 `{ error: 'cross-site request
 *    refused' }`, whatever its method;
 * 2. the relay assertion must verify and be bound to the URL's route —
 *    else 401 `{ error: 'unauthenticated' }`, JSON (no redirect for an
 *    XHR), before anything is looked up;
 * 3. the route must have a user surface (`resolveTarget`) — else 404 — and
 *    its plugin be available (enabled, hosted, its hosting not down) —
 *    else 503;
 * 4. a request that may change something must carry `Origin` equal to the
 *    bound host's origin — else 403 `{ error: 'cross-origin request
 *    refused' }` (CSRF: the session cookie travels with any cross-site
 *    request);
 * 5. the directory must know the user for this plugin
 *    (`resolveUserCaller`) — else its 403, 404 or 503;
 * 6. the request is forwarded to `/app/<rest>` with the `user` caller,
 *    through the plugin's request hooks — the admin forwarder's pipeline:
 *    credentials, Lamaste's headers and method/URL overrides stripped (the
 *    relay assertion and the session cookie among them), the body limit,
 *    the signed assertion, the responder check, streaming, and no
 *    `Set-Cookie` or `X-Accel-*` back. While it is sent the response is
 *    tracked (`trackResponse`) and ended after `maxResponseMs`.
 *
 * Every error the relay answers itself is a fixed text per status, never an
 * internal message (`userSurfaceErrorText`). Logs one metadata line per
 * forwarded request, the user as `user:<userId>`; never a body, a query
 * string or a username.
 */
export async function userSurfacePlugin(
  fastify: FastifyInstance,
  opts: UserSurfaceOptions,
): Promise<void> {
  if (fastify.prefix !== USER_SURFACE_API_PREFIX) {
    throw new Error(
      `The user surface is served under "${USER_SURFACE_API_PREFIX}" (registered under "${fastify.prefix}")`,
    );
  }
  const logger = opts.logger ?? fastify.log;
  const reserved = new Set<string>(RESERVED_API_PREFIXES);
  const maxResponseMs = opts.maxResponseMs ?? USER_SURFACE_MAX_RESPONSE_MS;

  passBodiesThrough(fastify);

  // Every answer of these routes — the relay's refusals included — carries
  // the user surface's response headers, and no CORS header: no other
  // origin reads a user's answers.
  fastify.addHook('onRequest', async (_request, reply) => {
    applyUserSurfaceResponseHeaders(reply.raw);
  });
  fastify.addHook('onSend', async (_request, reply, payload) => {
    for (const name of Object.keys(reply.getHeaders())) {
      if (name.toLowerCase().startsWith('access-control-')) reply.removeHeader(name);
    }
    return payload;
  });

  const handler = async (
    request: FastifyRequest<{ Params: { route: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const { route } = request.params;
    if (!isSameOriginFetch(request.headers)) {
      return reply.code(403).send({ error: 'cross-site request refused' });
    }
    const relay = await opts.verifyRelay(request);
    if (!relay.ok || relay.route !== route) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    if (!ROUTE_RE.test(route) || reserved.has(route)) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const target = await opts.resolveTarget(route);
    if (!target || ('kind' in target && target.kind === 'not_found')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    if ('kind' in target) {
      return reply.code(503).send({ error: 'The plugin is not available right now' });
    }

    const method = request.method.toUpperCase();
    if (hasRequestBody(method)) {
      const origin = await opts.originFor(route);
      if (origin === null || request.headers.origin !== origin) {
        return reply.code(403).send({ error: 'cross-origin request refused' });
      }
    }

    const resolution = await opts.resolveUserCaller(route, relay.username);
    if (!resolution.ok) {
      return reply.code(resolution.status).send({ error: resolution.error });
    }
    // The assertion carries exactly what is checked here: a valid user
    // caller, and the user Gatekeeper attested — never someone else.
    const caller = parseCallerIdentity(resolution.caller);
    if (!caller || caller.type !== 'user' || caller.username !== relay.username) {
      logger.warn(
        { plugin: target.plugin, route },
        'The user surface resolved a caller that is not the attested user',
      );
      return reply.code(500).send({ error: userSurfaceErrorText(500) });
    }

    const targetPath = userSurfaceHalfPath(request.raw.url ?? '', route);
    if (targetPath === null) {
      return reply.code(400).send({ error: userSurfaceErrorText(400) });
    }

    let plan: RequestHookPlan | null = null;
    if (opts.hooks) {
      const built = await buildRequestHookPlan(opts.hooks, target.plugin, method, targetPath);
      if ('refuse' in built) {
        return reply
          .code(503)
          .send({ error: userSurfaceErrorText(503), code: 'hooks_not_approved' });
      }
      plan = built;
    }

    // While the response is sent it can be ended: when its user loses
    // access (the panel's sweep), and once it has lived maxResponseMs.
    const startedAt = Date.now();
    const ended: { reason: string | null } = { reason: null };
    const end = (reason: string): void => {
      if (ended.reason !== null || reply.raw.writableFinished) return;
      ended.reason = reason;
      reply.raw.destroy();
    };
    const lifetime = setTimeout(() => end('lifetime'), maxResponseMs);
    lifetime.unref();
    const untrack =
      opts.trackResponse?.({ route, plugin: target.plugin, caller, startedAt, end }) ?? null;
    let outcome: ForwardOutcome;
    try {
      outcome = await forward(request, reply, target, caller, targetPath, opts, plan, 'user');
    } finally {
      clearTimeout(lifetime);
      untrack?.();
    }
    if (ended.reason !== null) {
      outcome = { ...outcome, error: `ended by the relay: ${ended.reason}` };
    }
    logForwarded(
      logger,
      {
        plugin: target.plugin,
        caller,
        method: request.method,
        targetPath,
        startedAt,
        plan,
        outcome,
      },
      { done: 'Forwarded user request', failed: 'User request not completed' },
    );
  };

  const routeOptions = { config: { ...opts.routeConfig } };
  fastify.all('/:route/app', routeOptions, handler);
  fastify.all('/:route/app/*', routeOptions, handler);
}
