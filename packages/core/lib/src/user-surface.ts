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
 * percent-encoded `.`, `/` or `\`, no escape that does not decode — so the
 * path a check approves is the path every server after it resolves.
 *
 * On the agent half the paths are a boundary between callers
 * (`verifyCallerAssertion`): a `user` caller is valid only under `/app`
 * ({@link isAgentHalfAppPath}, read literally), and every other caller
 * never there ({@link isUnderAgentHalfApp}, read the way a lenient router
 * might) — so an admin's assertion cannot act on a user's routes, and a
 * user's never reaches `/admin`.
 *
 * Pure; shared by the root (caller and relay assertions) and the server
 * subpath (the forwarder).
 */

/** The agent half's user surface, the only prefix a `user` caller reaches. */
export const AGENT_HALF_APP_PREFIX = '/app';

/** Where the relay serves a plugin's user surface: `/api/<route>/app/*`. */
export const USER_SURFACE_API_PREFIX = '/api';

/** A plugin route as the forwarder accepts it. */
const ROUTE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** A percent-encoded `.`, `/` or `\`, in either case. */
const ENCODED_SEPARATOR_RE = /%(?:2e|2f|5c)/i;

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
 * or a segment that does not percent-decode. Pure; exported for the checks
 * of the user surface (and their tests).
 */
export function hasUnsafePathSegments(pathPart: string): boolean {
  if (pathPart.includes('\\') || ENCODED_SEPARATOR_RE.test(pathPart)) return true;
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
