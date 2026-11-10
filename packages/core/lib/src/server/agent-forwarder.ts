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
 * - the plugin's body limit (`maxBodyBytes`: its manifest's
 *   `agent.maxBodySizeMb`, `agentHalfMaxBodyMb`): a larger `Content-Length`
 *   is refused with 413 before anything is sent, and a chunked body that
 *   grows past it is cut off. The body is counted as it streams through,
 *   never held: a limit of any size costs no memory;
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

import type { IncomingHttpHeaders } from 'node:http';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { parseCallerIdentity } from '../caller-assertion.js';
import type { UserCallerIdentity } from '../caller-assertion.js';
import { RESERVED_API_PREFIXES } from '../constants.js';
import { AGENT_HALF_HOOKS_PREFIX } from '../hooks/index.js';
import { AGENT_HALF_IDENTITY_PREFIX } from '../identity.js';
import { AGENT_HALF_PEERS_PREFIX, PEER_DELEGATION_HEADER } from '../peers.js';
import { AGENT_HALF_SETTINGS_PATH } from '../plugin-settings.js';
import {
  AGENT_HALF_APP_PREFIX,
  USER_SURFACE_API_PREFIX,
  USER_SURFACE_MAX_RESPONSE_SECONDS,
  isUserSurfaceUrl,
  routerSegment,
  userSurfaceApiPath,
} from '../user-surface.js';
import {
  AGENT_HALF_ADMIN_PREFIX,
  answerFailure,
  applyUserSurfaceResponseHeaders,
  buildRequestHookPlan,
  callerLabel,
  downFailure,
  forwardRequest,
  hasRequestBody,
  userSurfaceErrorText,
  writeError,
} from './forward-core.js';
import type {
  AgentForwardResolution,
  AgentForwardTarget,
  AgentForwardTimeouts,
  AgentForwarderLogger,
  AdminSurfaceCaller,
  ForwardOutcome,
  ForwardSurface,
  ForwardedCaller,
  RequestHookPlan,
  RequestHookRuntime,
} from './forward-core.js';

// What the forwarding core defines, re-exported where callers always found it.
export {
  AGENT_HALF_ADMIN_PREFIX,
  AGENT_FORWARD_DEFAULTS,
  USER_SURFACE_RESPONSE_HEADERS,
  applyUserSurfaceResponseHeaders,
  buildRequestHookPlan,
  callerLabel,
  forwardedRequestHeaders,
  forwardedResponseHeaders,
  isServiceWorkerRequest,
  userSurfaceErrorText,
  userSurfaceResponseHeaders,
} from './forward-core.js';
export type {
  AgentForwardRefusal,
  AgentForwardResolution,
  AgentForwardTarget,
  AgentForwardTimeouts,
  AgentForwarderLogger,
  AdminSurfaceCaller,
  ForwardOutcome,
  ForwardedCaller,
  MatchedRequestHook,
  RequestHookPlan,
  RequestHookRun,
  RequestHookRuntime,
} from './forward-core.js';

/**
 * Forward a request that came in through Fastify: take over its reply
 * (`reply.hijack()`) so nothing between the agent half and the client
 * buffers or rewrites the body, then run the shared core.
 */
function forward(
  request: FastifyRequest,
  reply: FastifyReply,
  target: AgentForwardTarget,
  caller: ForwardedCaller,
  targetPath: string,
  opts: AgentForwardTimeouts,
  plan: RequestHookPlan | null,
  surface: ForwardSurface,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<ForwardOutcome> {
  reply.hijack();
  return forwardRequest(
    { method: request.method, headers: request.headers, body: request.raw },
    reply.raw,
    target,
    caller,
    targetPath,
    opts,
    plan,
    surface,
    extraHeaders,
  );
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

const ROUTE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

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

/** `peers`, the fourth: the peer channel's attach, readiness and event pulls. */
const AGENT_HALF_PEERS_SEGMENT = AGENT_HALF_PEERS_PREFIX.split('/')[2] ?? 'peers';

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
 * secrets, written only by Lamaste after its own validation),
 * `/admin/identity*` (the identity feed, sent only by Lamaste) or
 * `/admin/peers*` (the peer channel and event pulls, Lamaste's only) — the
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
        segment.startsWith(AGENT_HALF_IDENTITY_SEGMENT) ||
        segment.startsWith(AGENT_HALF_PEERS_SEGMENT)))
  );
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
      /**
       * Set when the user came with a native app's bearer access token
       * the panel found live (native-apps-design.md D3): the grant it
       * belongs to. No browser attaches such a token by itself, so the
       * `Origin` rule does not apply to it; the open-response sweep ends
       * its responses once the grant ends.
       */
      readonly bearer?: { readonly grantId: string } | undefined;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      /**
       * A bearer token that is not (or no longer) live: answered 401
       * `invalid_token` with `WWW-Authenticate: Bearer error="invalid_token"`
       * so the app refreshes it.
       */
      readonly invalidToken?: boolean | undefined;
      /**
       * A live bearer token for a route or a client not served for now (a
       * hosting moving, a host disabled): answered 503, so the app keeps
       * its token rather than refreshing in a loop.
       */
      readonly unavailable?: boolean | undefined;
    };

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
  /** The native grant of a bearer request (see {@link UserSurfaceRelayVerification}). */
  readonly grantId?: string | undefined;
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
  /**
   * A peer delegation for this request's person (`peer-delegation.ts`), or
   * null — the relay's only: sent to the agent half as
   * `X-Lamalibre-Delegation` after every strip, for its calls to other
   * plugins on the person's behalf. The panel gives one only to a plugin
   * with an effective outgoing edge.
   */
  delegationFor?:
    | ((route: string, caller: UserCallerIdentity) => MaybePromise<string | null>)
    | undefined;
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
 * `Sec-Fetch-Dest` values a user surface's API never answers: a script, a
 * style sheet, a worker or a worklet. A web surface's Content-Security-
 * Policy allows code from its own host — `'self'` takes in the API's paths
 * too — so an answer of the agent half's would otherwise run as the shell's
 * code, though the approval covers only the tree. Data is fetched (`empty`)
 * and pages are navigated to; nothing else loads from the API.
 */
const CODE_FETCH_DESTINATIONS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'worker',
  'sharedworker',
  'serviceworker',
  'audioworklet',
  'paintworklet',
  'xslt',
]);

/**
 * Whether a request's `Sec-Fetch-Dest` loads code (see
 * {@link CODE_FETCH_DESTINATIONS}). Absent: a client that does not say.
 * Pure; exported for tests.
 */
export function isCodeFetch(headers: IncomingHttpHeaders): boolean {
  const dest = headers['sec-fetch-dest'];
  return typeof dest === 'string' && CODE_FETCH_DESTINATIONS.has(dest);
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
 *    refused' }`, whatever its method; a request loading code (a script,
 *    a style sheet, a worker — {@link isCodeFetch}) — 403 `{ error: 'not
 *    a script or style source' }`;
 * 2. the relay assertion must verify and be bound to the URL's route —
 *    else 401 `{ error: 'unauthenticated' }`, JSON (no redirect for an
 *    XHR), before anything is looked up;
 * 3. the route must have a user surface (`resolveTarget`) — else 404 — and
 *    its plugin be available (enabled, hosted, its hosting not down) —
 *    else 503;
 * 4. a request that may change something must carry `Origin` equal to the
 *    bound host's origin — else 403 `{ error: 'cross-origin request
 *    refused' }` (CSRF: the session cookie travels with any cross-site
 *    request) — unless it came with a native app's bearer token
 *    (`bearer` on the relay check; no browser attaches one by itself). A
 *    bearer token that is not live is answered 401 `{ error:
 *    'invalid_token' }` with `WWW-Authenticate`, one whose route or client
 *    is not served for now 503;
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
    if (isCodeFetch(request.headers)) {
      return reply.code(403).send({ error: 'not a script or style source' });
    }
    const relay = await opts.verifyRelay(request);
    if (!relay.ok && relay.unavailable === true) {
      return reply.code(503).send({ error: 'The plugin is not available right now' });
    }
    if (!relay.ok && relay.invalidToken === true) {
      return reply
        .code(401)
        .header('www-authenticate', 'Bearer error="invalid_token"')
        .send({ error: 'invalid_token' });
    }
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
    // A bearer token is no ambient credential (no browser sends one by
    // itself): no cross-site request can carry it, so no Origin is asked of
    // it — a native HTTP stack sends none.
    if (hasRequestBody(method) && relay.bearer === undefined) {
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

    const delegation = (await opts.delegationFor?.(route, caller)) ?? null;
    const extraHeaders: Record<string, string> =
      delegation !== null ? { [PEER_DELEGATION_HEADER]: delegation } : {};

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
      opts.trackResponse?.({
        route,
        plugin: target.plugin,
        caller,
        startedAt,
        end,
        grantId: relay.bearer?.grantId,
      }) ?? null;
    let outcome: ForwardOutcome;
    try {
      outcome = await forward(
        request,
        reply,
        target,
        caller,
        targetPath,
        opts,
        plan,
        'user',
        extraHeaders,
      );
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
