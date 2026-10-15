/**
 * Route patterns of request hooks — `"POST /admin/import/*"`.
 *
 * A pattern names an optional method and a path on the agent half:
 *
 * - the method is `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`
 *   or `*`; a pattern without one matches every method, and `GET` also
 *   matches `HEAD` (servers answer `HEAD` with their `GET` handler);
 * - the path starts with `/admin` (the forwarded admin API) or `/app` (the
 *   user surface, reached once the plugin gateway exists);
 * - a segment is a literal or `*`. `*` matches exactly one segment, except as
 *   the last segment, where it matches one or more.
 *
 * Matching errs towards running the hook: a hook that runs once too often
 * costs a little time, a hook that is skipped is a bypass. So literal
 * segments match case-insensitively (some servers route that way), segments
 * are compared percent-decoded (`/admin/%65xport` is `/admin/export` to the
 * application), and empty segments (`//`, a trailing `/`) are ignored.
 */

export const ROUTE_PATTERN_METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
] as const;

export type RoutePatternSurface = 'admin' | 'app';

export interface RoutePattern {
  /** The pattern as written. */
  readonly raw: string;
  /** Upper-case method, or `*` for any. */
  readonly method: string;
  /** Lower-case literal segments and `*`, without the leading empty one. */
  readonly segments: readonly string[];
  readonly surface: RoutePatternSurface;
}

const SEGMENT_RE = /^[A-Za-z0-9._~-]+$/;
const MAX_PATTERN_LENGTH = 200;

/** Parse a pattern. Returns the pattern, or a message saying why it is not one. */
export function parseRoutePattern(raw: string): RoutePattern | { readonly error: string } {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_PATTERN_LENGTH) {
    return { error: `A route pattern is 1–${MAX_PATTERN_LENGTH} characters` };
  }
  const parts = raw.split(' ');
  let method = '*';
  let pathPart: string;
  if (parts.length === 1) {
    pathPart = parts[0] ?? '';
  } else if (parts.length === 2) {
    const m = parts[0] ?? '';
    if (m !== '*' && !(ROUTE_PATTERN_METHODS as readonly string[]).includes(m)) {
      return { error: `Unknown method "${m}" (use ${ROUTE_PATTERN_METHODS.join(', ')} or *)` };
    }
    method = m;
    pathPart = parts[1] ?? '';
  } else {
    return { error: 'A route pattern is "<METHOD> <path>" or "<path>"' };
  }
  if (!pathPart.startsWith('/')) return { error: 'The path of a route pattern starts with /' };
  const segments = pathPart.slice(1).split('/');
  const first = segments[0];
  if (first !== 'admin' && first !== 'app') {
    return { error: 'A route pattern names a path under /admin or /app' };
  }
  for (const segment of segments) {
    if (segment !== '*' && !SEGMENT_RE.test(segment)) {
      return {
        error: `Invalid path segment "${segment}" (letters, digits, . _ ~ - or a single *)`,
      };
    }
  }
  return {
    raw,
    method,
    segments: segments.map((s) => (s === '*' ? s : s.toLowerCase())),
    surface: first,
  };
}

/** Parse a pattern known to be valid (validated by the manifest schema). Throws otherwise. */
export function routePattern(raw: string): RoutePattern {
  const parsed = parseRoutePattern(raw);
  if ('error' in parsed) throw new Error(`Invalid route pattern "${raw}": ${parsed.error}`);
  return parsed;
}

/**
 * The comparable segments of a request path (no query string): decoded,
 * lower-cased, empty ones dropped. Null when a segment cannot be decoded —
 * the forwarder refuses such a path before it gets here.
 */
export function requestPathSegments(path: string): string[] | null {
  const query = path.indexOf('?');
  const pathOnly = query === -1 ? path : path.slice(0, query);
  const out: string[] = [];
  for (const segment of pathOnly.split('/')) {
    if (segment.length === 0) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    out.push(decoded.toLowerCase());
  }
  return out;
}

function methodMatches(patternMethod: string, method: string): boolean {
  if (patternMethod === '*') return true;
  const m = method.toUpperCase();
  return m === patternMethod || (patternMethod === 'GET' && m === 'HEAD');
}

/** Whether a request (method, path on the agent half) matches `pattern`. */
export function matchRoutePattern(
  pattern: RoutePattern,
  method: string,
  pathSegments: readonly string[],
): boolean {
  if (!methodMatches(pattern.method, method)) return false;
  const p = pattern.segments;
  for (let i = 0; i < p.length; i++) {
    const want = p[i];
    const have = pathSegments[i];
    if (have === undefined) return false;
    if (want === '*') {
      // The last `*` swallows the rest (at least one segment).
      if (i === p.length - 1) return true;
      continue;
    }
    if (want !== have) return false;
  }
  return pathSegments.length === p.length;
}
