/**
 * The user surface of an agent-hosted plugin — the paths its users reach,
 * and whose path is whose on the agent half.
 *
 * A plugin that declares `identity` serves its users at `/app/*` on its
 * agent half. The relay exposes that as `/api/<route>/app/*` on the host
 * bound as the plugin's user surface: Gatekeeper authenticates the
 * Authelia session and attests the username to the panel (a relay
 * assertion for `RELAY_PANEL_AUDIENCE`, bound to the raw request path),
 * and the panel forwards the request to the agent half's `/app/*` with a
 * `user` caller assertion (`userSurfacePlugin` in
 * `@lamalibre/lamaste/server`).
 *
 * Every place that checks a user-surface path applies one rule
 * ({@link hasUnsafePathSegments}): no `.` or `..` segment, no backslash, no
 * percent-encoded `.`, `/`, `\` or `%`, no escape that does not decode — so
 * the path a check approves is the path every server after it resolves,
 * even one that decodes twice.
 *
 * On the agent half the paths are a boundary between callers
 * (`verifyCallerAssertion`): a `user` caller is valid only under `/app`
 * ({@link isAgentHalfAppPath}, read literally), and every other caller
 * never there ({@link isUnderAgentHalfApp}, read the way a lenient router
 * might) — so an admin's assertion cannot act on a user's routes, and a
 * user's never reaches `/admin`.
 *
 * A host serves a plugin's user surface once a tunnel is *bound* to it
 * (`TunnelEntry.userSurface` in `tunnels.json`): {@link tunnelUserSurfaceRoutes}
 * is how everything that reads that state — the panel, its vhost renderer,
 * Gatekeeper — reads a binding. A bound route is *served* only while the
 * tunnel's agent is the plugin's hosting agent — the agent carrying the
 * plugin's internal tunnel ({@link userSurfaceHostingAgent},
 * {@link tunnelServedUserSurfaceRoutes}): a host whose tunnel another agent
 * carries — reassigned, or its agent revoked — keeps the binding but serves
 * nothing of it, so no agent but the hosting one can answer on the host
 * whose sessions reach the plugin's users.
 *
 * Pure; shared by the root (caller and relay assertions) and the server
 * subpath (the forwarder, the tunnel workflows).
 */

import { AGENT_LABEL_REGEX, RESERVED_API_PREFIXES } from './constants.js';

/** The agent half's user surface, the only prefix a `user` caller reaches. */
export const AGENT_HALF_APP_PREFIX = '/app';

/** Where the relay serves a plugin's user surface: `/api/<route>/app/*`. */
export const USER_SURFACE_API_PREFIX = '/api';

/** How many plugins' user surfaces one host may serve. */
export const USER_SURFACE_MAX_ROUTES_PER_HOST = 16;

/**
 * The longest a user-surface response lives, in seconds: the panel ends one
 * still open after this long (a stream, a slow download), and nginx's
 * timeouts on the user-surface locations are this bound. An open response
 * is also ended as soon as its user loses access (the panel re-checks every
 * open one every few seconds).
 */
export const USER_SURFACE_MAX_RESPONSE_SECONDS = 3600;

/**
 * The longest route a user surface is bound for: what a relay assertion's
 * target may carry.
 */
const USER_SURFACE_ROUTE_MAX_LENGTH = 64;

/** A plugin route as the forwarder accepts it. */
const ROUTE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * A percent-encoded `.`, `/` or `\` (in either case), or `%` itself: a
 * `%25` decodes to an escape that a router decoding twice would read as
 * the character it names (`%252e%252e` → `%2e%2e` → `..`).
 */
const UNSAFE_ESCAPE_RE = /%(?:25|2e|2f|5c)/i;

/** How many times a segment is percent-decoded before it counts as undecodable. */
const ROUTER_DECODE_ROUNDS = 3;

function pathPartOf(url: string): string {
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

/**
 * Whether the path part of a URL (no query string) has anything a server
 * could resolve differently from how a check read it: a `.` or `..`
 * segment, a backslash, a percent-encoded `.`, `/` or `\` (in either case),
 * an encoded `%` (`%25` — a second decoding would turn `%252e` into `.`),
 * or a segment that does not percent-decode. Pure; exported for the checks
 * of the user surface (Gatekeeper, the panel and the agent half) and their
 * tests.
 */
export function hasUnsafePathSegments(pathPart: string): boolean {
  if (pathPart.includes('\\') || UNSAFE_ESCAPE_RE.test(pathPart)) return true;
  for (const segment of pathPart.split('/')) {
    if (segment === '.' || segment === '..') return true;
    try {
      decodeURIComponent(segment);
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Whether the path part of `url` is `prefix` or lies under it, read
 * literally, with no unsafe segment ({@link hasUnsafePathSegments}).
 */
function isSafelyUnder(url: string, prefix: string): boolean {
  const pathPart = pathPartOf(url);
  if (pathPart !== prefix && !pathPart.startsWith(`${prefix}/`)) return false;
  return !hasUnsafePathSegments(pathPart);
}

/**
 * Whether `path` (with its query string) is on the agent half's user
 * surface: `/app`, `/app/…` or `/app?…`, read literally, with no unsafe
 * segment ({@link hasUnsafePathSegments}). The only paths a `user` caller
 * is valid for.
 */
export function isAgentHalfAppPath(path: string): boolean {
  return isSafelyUnder(path, AGENT_HALF_APP_PREFIX);
}

/**
 * Segment `index` of a path (empty segments skipped), reduced to what a
 * router could take it for: percent-decoded until it no longer changes (at
 * most {@link ROUTER_DECODE_ROUNDS} rounds), lower case, and stripped of
 * everything but `a-z` and `0-9`. Undefined when there is no such segment,
 * null when it does not decode — or still decodes further after the last
 * round — which callers treat as the worst case: a path no one can read is
 * no one's.
 */
export function routerSegment(path: string, index: number): string | null | undefined {
  const segments = pathPartOf(path)
    .split('/')
    .filter((s) => s.length > 0);
  let segment = segments[index];
  if (segment === undefined) return undefined;
  for (let round = 0; ; round += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (decoded === segment) break;
    if (round === ROUTER_DECODE_ROUNDS) return null;
    segment = decoded;
  }
  return segment.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** `app`, the first segment of the user surface. */
const APP_SEGMENT = AGENT_HALF_APP_PREFIX.slice(1);

/**
 * Whether a router could take `path` for one under `/app`: its first
 * segment, reduced as {@link routerSegment} does, starts with `app` — or
 * does not decode. `/App/x`, `/%61pp`, `//app`, `/app.json` and `/apps`
 * alike. No caller but a `user` may have such a path signed for it.
 */
export function isUnderAgentHalfApp(path: string): boolean {
  const segment = routerSegment(path, 0);
  return segment === null || (segment !== undefined && segment.startsWith(APP_SEGMENT));
}

/** `/api/<route>/app` — the relay path of a plugin's user surface. Throws on an invalid route. */
export function userSurfaceApiPath(route: string): string {
  if (!ROUTE_RE.test(route)) throw new Error(`Invalid plugin route: "${route}"`);
  return `${USER_SURFACE_API_PREFIX}/${route}${AGENT_HALF_APP_PREFIX}`;
}

/**
 * Whether `url` (the raw request target, with its query string) lies on
 * the user surface of `route`: `/api/<route>/app`, followed by nothing, `/`
 * or `?`, with no unsafe segment ({@link hasUnsafePathSegments}). False for
 * an invalid route.
 */
export function isUserSurfaceUrl(url: string, route: string): boolean {
  return ROUTE_RE.test(route) && isSafelyUnder(url, userSurfaceApiPath(route));
}

/**
 * Whether `route` is a plugin route a host can be bound to serve the user
 * surface of: a route the forwarder accepts, short enough for a relay
 * assertion to carry, and none of the panel's own API prefixes.
 */
export function isUserSurfaceRoute(route: unknown): route is string {
  return (
    typeof route === 'string' &&
    route.length <= USER_SURFACE_ROUTE_MAX_LENGTH &&
    ROUTE_RE.test(route) &&
    !(RESERVED_API_PREFIXES as readonly string[]).includes(route)
  );
}

/**
 * The plugin routes a tunnel entry as `tunnels.json` stores it binds as a
 * user surface (`userSurface: { routes: [...] }`), read defensively: only an
 * app tunnel's (`type` 'app', or none — tunnels persisted before `type`
 * existed), never an internal one's; only valid routes
 * ({@link isUserSurfaceRoute}), each once, at most
 * {@link USER_SURFACE_MAX_ROUTES_PER_HOST}; `[]` for anything else. The file
 * is the panel's, but Gatekeeper and the vhost renderer write what they read
 * into signatures and nginx configuration, so nothing malformed in it may
 * pass.
 */
export function tunnelUserSurfaceRoutes(tunnel: unknown): string[] {
  if (!tunnel || typeof tunnel !== 'object') return [];
  const t = tunnel as { type?: unknown; exposure?: unknown; userSurface?: unknown };
  if ((t.type !== undefined && t.type !== 'app') || t.exposure === 'internal') return [];
  const binding = t.userSurface;
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return [];
  const routes = (binding as { routes?: unknown }).routes;
  if (!Array.isArray(routes)) return [];
  const out: string[] = [];
  for (const route of routes) {
    if (isUserSurfaceRoute(route) && !out.includes(route)) out.push(route);
    if (out.length === USER_SURFACE_MAX_ROUTES_PER_HOST) break;
  }
  return out;
}

/**
 * The agent hosting the plugin of `route`, as `tunnels.json` records it:
 * the agent that carries the route's internal plugin tunnel (the tunnel
 * Lamaste creates when it hosts the plugin's agent half). Null when there
 * is no such tunnel, more than one, or it is carried by no agent (its agent
 * was revoked) — nothing is served then. Read defensively, as
 * {@link tunnelUserSurfaceRoutes} reads a binding.
 */
export function userSurfaceHostingAgent(tunnels: unknown, route: string): string | null {
  if (!Array.isArray(tunnels)) return null;
  let agent: string | null = null;
  let found = 0;
  for (const entry of tunnels as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const t = entry as { exposure?: unknown; pluginRoute?: unknown; agentLabel?: unknown };
    if (t.exposure !== 'internal' || t.pluginRoute !== route) continue;
    found += 1;
    agent =
      typeof t.agentLabel === 'string' && AGENT_LABEL_REGEX.test(t.agentLabel)
        ? t.agentLabel
        : null;
  }
  return found === 1 ? agent : null;
}

/**
 * Of the routes a tunnel binds as a user surface ({@link tunnelUserSurfaceRoutes}),
 * the ones its host may serve as far as `tunnels.json` tells: those whose
 * plugin is hosted by the agent that carries this tunnel
 * ({@link userSurfaceHostingAgent}). Whether a served route also has an
 * installed, approved version declaring `identity` is the panel's to decide;
 * Gatekeeper reads this alone.
 *
 * @param tunnels - every entry of `tunnels.json` (the internal tunnels among them)
 * @param tunnel - one of them
 */
export function tunnelServedUserSurfaceRoutes(tunnels: unknown, tunnel: unknown): string[] {
  const routes = tunnelUserSurfaceRoutes(tunnel);
  if (routes.length === 0) return [];
  const agent = (tunnel as { agentLabel?: unknown }).agentLabel;
  if (typeof agent !== 'string' || !AGENT_LABEL_REGEX.test(agent)) return [];
  return routes.filter((route) => userSurfaceHostingAgent(tunnels, route) === agent);
}
