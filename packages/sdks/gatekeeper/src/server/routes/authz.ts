import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { request as undiciRequest } from 'undici';
import {
  AUTHELIA_SESSION_COOKIE,
  RELAY_ASSERTION_HEADER,
  RELAY_PANEL_AUDIENCE,
  RELAY_PANEL_PORT,
  autheliaSessionCookies,
  isUserSurfaceUrl,
  signRelayAssertion,
} from '@lamalibre/lamaste';
import type { RelaySigningKey } from '@lamalibre/lamaste';
import { AUTHELIA_VERIFY_URL, SESSION_CACHE_TTL_MS } from '../../lib/constants.js';
import { checkAccess } from '../../lib/authz.js';
import { buildAccessRequestPage } from '../../lib/templates.js';
import { logAccessRequest } from '../routes/diagnostic.js';
import type { AutheliaSession, TunnelInfo } from '../../lib/types.js';

/** Hard cap on session cache entries to prevent memory exhaustion on 512MB droplets. */
const MAX_SESSION_CACHE_ENTRIES = 10_000;

/** Cache-Control max-age for a successful authz response (matches nginx 200 TTL). */
const AUTHZ_SUCCESS_MAX_AGE_SECONDS = 10;

/** Upper bound on Authelia /verify call latency before we treat it as a denial. */
const AUTHELIA_VERIFY_TIMEOUT_MS = 2_500;

/**
 * Per-process random key used to HMAC the cookie before storing it as a cache
 * key. Without this, any actor with a valid cookie could compute the cache
 * key and trigger collision-based attacks against cache-eviction logic.
 */
const COOKIE_HMAC_KEY = crypto.randomBytes(32);

/**
 * The Authelia session a request presents: its `authelia_session` cookie —
 * the only auth signal accepted here; any other cookie (CSRF tokens,
 * analytics, etc.) carries no identity and never reaches Authelia or the
 * cache key — or `none`, or `many` when the browser sent more than one.
 * Another host under the relay's domain can plant a second
 * `authelia_session` (another path or domain attribute), and which one
 * Authelia would read is not Gatekeeper's to guess: such a request is
 * refused (401 — the user surface's single reload bounds the retry).
 */
type PresentedSession =
  | { readonly kind: 'none' }
  | { readonly kind: 'one'; readonly value: string }
  | { readonly kind: 'many' };

function presentedSession(cookieHeader: string | string[] | undefined): PresentedSession {
  // Every pair counts towards "more than one", an empty one too: a planted
  // `authelia_session=` beside the real cookie is still a second cookie.
  const values = autheliaSessionCookies(cookieHeader);
  if (values.length > 1) return { kind: 'many' };
  const [value] = values;
  return value ? { kind: 'one', value } : { kind: 'none' };
}

/**
 * The session cache key of a session cookie on one tunnel host —
 * HMAC-SHA256 under a per-process random key, so keys are not predictable
 * from cookie values, and nobody can probe or seed the cache. Keyed by the
 * host too: Authelia decides per host (a site's or plugin tunnel's rules
 * name users), so a session it accepted for one host proves nothing on
 * another.
 */
function sessionCacheKey(session: string, host: string): string {
  return crypto
    .createHmac('sha256', COOKIE_HMAC_KEY)
    .update(`${host.toLowerCase()}\n${session}`)
    .digest('hex');
}

/**
 * Ask Authelia's verify endpoint about one session cookie for one URL, and
 * take the identity headers from its answer. Authelia is sent that cookie
 * alone (`authelia_session=<value>`), never the browser's others.
 */
async function validateWithAuthelia(
  session: string,
  originalUrl: string,
  requestId: string,
): Promise<AutheliaSession | null> {
  try {
    // Authelia's `/api/authz/auth-request` needs both the target URL and
    // method — without `X-Original-Method` it assumes `GET`, which is fine
    // for navigation but silently mis-gates non-GET paths (e.g. form POSTs
    // to protected endpoints). Send both.
    const { statusCode, headers } = await undiciRequest(AUTHELIA_VERIFY_URL, {
      method: 'GET',
      headers: {
        Cookie: `${AUTHELIA_SESSION_COOKIE}=${session}`,
        'X-Original-URL': originalUrl,
        'X-Original-Method': 'GET',
        'X-Forwarded-For': '127.0.0.1',
        'X-Request-ID': requestId,
      },
      // Deny by default if Authelia is hung — the call gates every authz check
      // on the hot path; a stuck request would block the whole request queue.
      signal: AbortSignal.timeout(AUTHELIA_VERIFY_TIMEOUT_MS),
    });

    if (statusCode !== 200) {
      return null;
    }

    const username = getHeader(headers, 'remote-user');
    if (!username) return null;

    return {
      username,
      groups: getHeader(headers, 'remote-groups') ?? '',
      displayName: getHeader(headers, 'remote-name') ?? '',
      email: getHeader(headers, 'remote-email') ?? '',
      expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const val = headers[name];
  if (Array.isArray(val)) return val[0];
  return val;
}

/**
 * Look up a tunnel by its FQDN from the in-memory cache. Hostnames compare
 * case-insensitively.
 */
function findTunnelByFqdn(tunnels: readonly TunnelInfo[], fqdn: string): TunnelInfo | undefined {
  const wanted = fqdn.toLowerCase();
  return tunnels.find((t) => t.fqdn.toLowerCase() === wanted);
}

/**
 * Why the hostnames a tunnel vhost writes into the subrequest's path,
 * X-Original-URL and Host disagree, or null when they agree.
 */
function hostnameMismatch(
  request: FastifyRequest,
  fqdn: string,
  originalHost: string,
): { reason: string; originalHost: string; hostHeader: string } | null {
  const named = fqdn.toLowerCase();
  const hostHeader = (request.headers['host'] as string | undefined) ?? '';
  const hostOnly = hostHeader.split(':')[0]?.toLowerCase() ?? '';
  if (originalHost.toLowerCase() === named && hostOnly === named) return null;
  return {
    reason: hostOnly ? 'tunnel_name_mismatch' : 'missing_host_header',
    originalHost,
    hostHeader,
  };
}

/** A tunnel hostname as a vhost writes it into the subrequest's path. */
const TUNNEL_FQDN_RE =
  /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/**
 * How many authorization subrequests one client may cause on one tunnel
 * host per minute. nginx asks on every request a protected host serves — a
 * page and its assets, an application's polling — so the bound is
 * generous; what it stops is one client (a script hammering Authelia with
 * made-up session cookies, each an Authelia round trip) starving the
 * others.
 */
export const AUTHZ_RATE_LIMIT_PER_CLIENT = 6_000;

/**
 * The bucket of an authorization subrequest: the client's address and the
 * tunnel host. nginx is the only client of these routes (Gatekeeper binds
 * 127.0.0.1) and sets `X-Forwarded-For` to `$remote_addr` on every
 * subrequest; Gatekeeper trusts that header from 127.0.0.1 only
 * (`trustProxy` in `server/index.ts`), so `request.ip` is the address nginx
 * accepted the browser's connection from — never one the browser named.
 * The host is the tunnel the vhost names in the path (or its `Host`).
 */
function authzRateLimitKey(request: FastifyRequest): string {
  const fqdn = (request.params as { fqdn?: unknown } | undefined)?.fqdn;
  const host =
    typeof fqdn === 'string' ? fqdn : ((request.headers['host'] as string | undefined) ?? '');
  return `${request.ip}|${host.toLowerCase()}`;
}

/** Options of {@link authzRoutes}. */
export interface AuthzRoutesOptions {
  /** Per-client, per-host requests a minute (default {@link AUTHZ_RATE_LIMIT_PER_CLIENT}). */
  readonly rateLimitPerClient?: number | undefined;
}

/**
 * Parse an X-Original-URL header into its hostname and host components.
 * Returns null when the value is not a parseable absolute URL.
 */
function parseOriginalUrl(originalUrl: string): { hostname: string; host: string } | null {
  try {
    const parsed = new URL(originalUrl);
    return { hostname: parsed.hostname, host: parsed.host };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export async function authzRoutes(
  fastify: FastifyInstance,
  opts: AuthzRoutesOptions = {},
): Promise<void> {
  const authzRateLimit = {
    rateLimit: {
      max: opts.rateLimitPerClient ?? AUTHZ_RATE_LIMIT_PER_CLIENT,
      timeWindow: '1 minute',
      keyGenerator: authzRateLimitKey,
    },
  };

  /**
   * GET /authz/tunnel/:fqdn — the nginx auth_request target of a tunnel vhost
   *
   * The vhost names its tunnel in the path, written into its configuration
   * (`proxy_pass http://127.0.0.1:9294/authz/tunnel/<fqdn>;`), as the
   * agent-panel vhost names its agent: nothing in the request can choose
   * another tunnel. X-Original-URL — the URL Authelia is asked about, with
   * the request's path and query — and Host carry the same hostname and must
   * agree with it.
   *
   * Flow:
   * 1. Check the tunnel named, X-Original-URL and Host agree
   * 2. Validate the Authelia session (cached in memory)
   * 3. Check access mode and grants
   * 4. Return 200 (allowed), 401 (not authenticated), or 403 (not authorized)
   *
   * On 403, the response body is the full access-request HTML page
   * (nginx serves this inline on the tunnel's FQDN via error_page 403 =).
   */
  fastify.get<{ Params: { fqdn: string } }>(
    '/authz/tunnel/:fqdn',
    { config: authzRateLimit },
    async (request, reply) => authorizeTunnelRequest(fastify, request, reply, request.params.fqdn),
  );

  /**
   * GET /authz/user-surface/:fqdn — the nginx auth_request target of a
   * plugin's user surface: `/api/<route>/app` and everything under it, on
   * the host of a tunnel bound to the plugin (`userSurface` in
   * tunnels.json). The vhost names the tunnel as for `/authz/tunnel/:fqdn`.
   *
   * Gatekeeper authenticates the session — on a restricted tunnel it checks
   * the user's grant too — and vouches for its user to the panel: a relay
   * assertion for the panel's audience and port, naming the username alone
   * and bound to the method and the raw request target, which must lie on
   * the user surface of a route bound to this tunnel. The panel takes
   * everything else about the user from its own directory.
   *
   * 200 with the assertion (never cacheable, no `Remote-*`), 401 without a
   * session (nginx answers with `/authz/user-surface-unauthenticated`), 403
   * for anything else refused — never the access-request page, never a
   * redirect: the caller is an application's request. 503 while the relay
   * signing key is unusable.
   */
  fastify.get<{ Params: { fqdn: string } }>(
    '/authz/user-surface/:fqdn',
    { config: authzRateLimit },
    async (request, reply) =>
      authorizeUserSurfaceRequest(fastify, request, reply, request.params.fqdn),
  );

  /**
   * GET /authz/user-surface-unauthenticated — what a user-surface request
   * without a session is answered with (nginx `error_page 401`): JSON, so
   * the application can tell its user to sign in again; never a redirect.
   */
  fastify.get(
    '/authz/user-surface-unauthenticated',
    { config: authzRateLimit },
    async (_request, reply) =>
      reply.code(401).header('Cache-Control', 'no-store').send({ error: 'unauthenticated' }),
  );

  /**
   * GET /authz/check — what tunnel vhosts written before 4.3 call. They name
   * the tunnel by the client's Host header (`$http_host`), which an
   * absolute-form request line can point at another tunnel than the one
   * nginx serves, so their requests are refused: until the panel rewrites
   * such a vhost (it does when it starts) its tunnel is closed, rather than
   * open to the users of every other tunnel.
   */
  fastify.get('/authz/check', { config: authzRateLimit }, async (request, reply) => {
    request.log.error(
      {
        requestId: request.id,
        reason: 'vhost_predates_host_binding',
        hostHeader: request.headers['host'],
      },
      'authz refused: this tunnel vhost names its tunnel by the client Host header; restart lamalibre-lamaste-serverd to rewrite it',
    );
    return reply
      .code(403)
      .header('Cache-Control', 'no-store')
      .type('text/plain; charset=utf-8')
      .send('This tunnel is unavailable until the relay rewrites its configuration.\n');
  });
}

/**
 * The Authelia session behind the request's `authelia_session` cookie, or
 * null: none, more than one (refused — see {@link presentedSession}), or
 * Authelia refused it. The session cache — one shared by every route here
 * — is keyed by that cookie's value and the tunnel host, so unrelated
 * cookies (CSRF tokens, analytics) cannot pollute it, and a session Authelia
 * accepted on one host is never taken for another.
 */
async function authenticatedSession(
  fastify: FastifyInstance,
  request: FastifyRequest,
  cookieHeader: string | string[] | undefined,
  originalUrl: string,
  hostname: string,
): Promise<AutheliaSession | null> {
  const requestId = request.id;
  const presented = presentedSession(cookieHeader);
  if (presented.kind !== 'one') {
    // Short-circuit before any cache work or the upstream Authelia /verify
    // call: an unauthenticated request costs no Authelia round-trip.
    request.log.info(
      {
        requestId,
        reason: presented.kind === 'none' ? 'missing_authelia_cookie' : 'duplicate_authelia_cookie',
        fqdn: hostname,
      },
      'authz denied',
    );
    return null;
  }
  const cacheKey = sessionCacheKey(presented.value, hostname);
  const sessionCache = fastify.getSessionCache();
  const cached = sessionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached;
  if (cached) {
    // Lazy TTL eviction — one stale entry pruned per request.
    sessionCache.delete(cacheKey);
  }
  const validated = await validateWithAuthelia(presented.value, originalUrl, requestId);
  if (!validated) {
    request.log.info({ requestId, reason: 'authelia_rejected', fqdn: hostname }, 'authz denied');
    return null;
  }

  // Opportunistic eviction — drop oldest (insertion-order head) when at cap.
  while (sessionCache.size >= MAX_SESSION_CACHE_ENTRIES) {
    const oldestKey = sessionCache.keys().next().value;
    if (oldestKey === undefined) break;
    sessionCache.delete(oldestKey);
  }

  sessionCache.set(cacheKey, validated);
  return validated;
}

/**
 * Authorize one request on the tunnel named `fqdn` (see the
 * `/authz/tunnel/:fqdn` route).
 */
async function authorizeTunnelRequest(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  fqdn: string,
): Promise<FastifyReply> {
  const requestId = request.id;
  if (!TUNNEL_FQDN_RE.test(fqdn)) {
    request.log.info({ requestId, reason: 'invalid_tunnel_name' }, 'authz denied');
    return reply.code(401).send();
  }

  const cookie = request.headers['cookie'];
  const originalUrl = (request.headers['x-original-url'] as string) ?? '';
  if (!cookie || !originalUrl) {
    return reply.code(401).send();
  }

  const parsed = parseOriginalUrl(originalUrl);
  if (!parsed) {
    request.log.info({ requestId, reason: 'invalid_original_url' }, 'authz denied');
    return reply.code(401).send();
  }

  // Disagreement means a request that did not come from a tunnel vhost of
  // this version: refuse it before Authelia is asked anything.
  const mismatch = hostnameMismatch(request, fqdn, parsed.hostname);
  if (mismatch) {
    const { reason, ...detail } = mismatch;
    request.log.info({ requestId, reason, tunnel: fqdn, ...detail }, 'authz denied');
    return reply.code(401).send();
  }

  const tunnels = fastify.getTunnels();
  const tunnel = findTunnelByFqdn(tunnels, fqdn);
  if (!tunnel) {
    request.log.info({ requestId, reason: 'unknown_tunnel_fqdn', fqdn }, 'authz denied');
    return reply.code(401).send();
  }

  const session = await authenticatedSession(
    fastify,
    request,
    cookie,
    originalUrl,
    parsed.hostname,
  );
  if (!session) return reply.code(401).send();

  // Check access mode
  if (tunnel.accessMode === 'public' || tunnel.accessMode === 'authenticated') {
    return allow(fastify, request, reply, tunnel, session);
  }

  // restricted — check grants
  const result = await checkAccess(session.username, 'tunnel', tunnel.id, {
    adminContact: fastify.getSettings().adminEmail,
    adminName: fastify.getSettings().adminName,
  });

  if (result.allowed) {
    return allow(fastify, request, reply, tunnel, session);
  }

  // The tunnel and the reason only — never who was refused.
  request.log.info(
    {
      requestId,
      reason: 'no_matching_grant',
      tunnel: fqdn,
      resourceType: 'tunnel',
      resourceId: tunnel.id,
    },
    'authz denied',
  );

  if (fastify.getSettings().accessLoggingEnabled) {
    logAccessRequest({
      timestamp: new Date().toISOString(),
      username: session.username,
      resourceType: 'tunnel',
      resourceId: tunnel.id,
      resourceFqdn: parsed.hostname,
    });
  }

  // Access denied — return inline HTML page as 403 body.
  // Cache-Control: no-store so nginx never caches the denial; the matching
  // proxy_cache_valid 403 0 in the snippet is the authoritative setting.
  const html = buildAccessRequestPage(session.username, parsed.hostname, {
    adminContact: fastify.getSettings().adminEmail,
    adminName: fastify.getSettings().adminName,
  });

  return reply
    .code(403)
    .header('Cache-Control', 'no-store')
    .type('text/html; charset=utf-8')
    .send(html);
}

/**
 * Authorize one request on the user surface of the tunnel named `fqdn` (see
 * the `/authz/user-surface/:fqdn` route).
 */
async function authorizeUserSurfaceRequest(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  fqdn: string,
): Promise<FastifyReply> {
  const requestId = request.id;
  // Single use: nothing of this answer may be cached, a refusal included.
  reply.header('Cache-Control', 'no-store');
  const refuse = (reason: string, extra: Record<string, unknown> = {}): FastifyReply => {
    request.log.info({ requestId, reason, tunnel: fqdn, ...extra }, 'user-surface authz denied');
    return reply.code(403).send();
  };

  if (!TUNNEL_FQDN_RE.test(fqdn)) return refuse('invalid_tunnel_name');
  const originalUrl = request.headers['x-original-url'];
  const originalMethod = request.headers['x-original-method'];
  if (typeof originalUrl !== 'string' || typeof originalMethod !== 'string') {
    return refuse('missing_original_request');
  }
  const parsed = parseOriginalUrl(originalUrl);
  if (!parsed) return refuse('invalid_original_url');

  const mismatch = hostnameMismatch(request, fqdn, parsed.hostname);
  if (mismatch) {
    const { reason, ...detail } = mismatch;
    return refuse(reason, detail);
  }

  const tunnel = findTunnelByFqdn(fastify.getTunnels(), fqdn);
  if (!tunnel) return refuse('unknown_tunnel_fqdn');
  if (!tunnel.enabled) return refuse('tunnel_disabled');
  if (tunnel.accessMode === 'public' || !tunnel.userSurface) return refuse('no_user_surface');

  // The request target exactly as the browser sent it — what follows the
  // hostname the vhost wrote — never re-encoded by a URL parser: the panel
  // receives it unchanged and holds the assertion against it byte for byte.
  const prefix = `https://${fqdn.toLowerCase()}`;
  if (originalUrl.slice(0, prefix.length).toLowerCase() !== prefix) {
    return refuse('invalid_original_url');
  }
  const target = originalUrl.slice(prefix.length);
  const route = tunnel.userSurface.routes.find((r) => isUserSurfaceUrl(target, r));
  if (!route) return refuse('not_on_user_surface');
  // Bound, but its plugin is not hosted by the agent carrying this tunnel
  // (moved, revoked, hosted elsewhere): nothing of it is served here.
  if (!tunnel.userSurface.served.includes(route)) return refuse('not_hosting_agent', { route });

  const session = await authenticatedSession(
    fastify,
    request,
    request.headers['cookie'],
    originalUrl,
    parsed.hostname,
  );
  if (!session) return reply.code(401).send();

  if (tunnel.accessMode !== 'authenticated') {
    // restricted — the user's grant for the tunnel, as on its other paths
    const result = await checkAccess(session.username, 'tunnel', tunnel.id, {
      adminContact: fastify.getSettings().adminEmail,
      adminName: fastify.getSettings().adminName,
    });
    if (!result.allowed) {
      // The tunnel and the reason only — never who was refused.
      return refuse('no_matching_grant', { resourceType: 'tunnel', resourceId: tunnel.id });
    }
  }

  const key = await currentRelayKey(fastify, request);
  if (!key) {
    request.log.error(
      { requestId, reason: 'relay_signing_key_unavailable', tunnel: fqdn },
      'user-surface authz failed',
    );
    return reply.code(503).send();
  }

  let assertion: string;
  try {
    assertion = signRelayAssertion(
      {
        aud: RELAY_PANEL_AUDIENCE,
        port: RELAY_PANEL_PORT,
        caller: { type: 'user', username: session.username },
        method: originalMethod,
        target: { route, path: target },
      },
      key,
    );
  } catch (err: unknown) {
    // A username, method or target an assertion cannot carry.
    return refuse('not_assertable', { detail: err instanceof Error ? err.message : String(err) });
  }
  reply.header(RELAY_ASSERTION_HEADER, assertion);
  return reply.code(200).send();
}

/** The relay signing key, or null when there is none or it is unusable (logged). */
async function currentRelayKey(
  fastify: FastifyInstance,
  request: FastifyRequest,
): Promise<RelaySigningKey | null> {
  try {
    return await fastify.getRelaySigner().current();
  } catch (err: unknown) {
    request.log.error(
      { err: err instanceof Error ? err.message : String(err) },
      'Relay signing key unusable',
    );
    return null;
  }
}

/**
 * Answer an allowed request: the Authelia identity headers nginx forwards
 * to the tunnel backend.
 *
 * A plugin tunnel's backend is the agent's lamaste-agentd, which takes the
 * user only from a relay assertion — anything that reaches its loopback port
 * could write `Remote-User`. Sign one for this request: the agent, its
 * daemon's port, the plugin route, the method, a nonce. It is single use,
 * so the answer must never be cached.
 */
async function allow(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  tunnel: TunnelInfo,
  session: AutheliaSession,
): Promise<FastifyReply> {
  reply.header('X-Gatekeeper-Cache-Version', String(fastify.getCacheVersion()));
  if (!tunnel.plugin) {
    setAutheliaHeaders(reply, session);
    reply.header('Cache-Control', `public, max-age=${AUTHZ_SUCCESS_MAX_AGE_SECONDS}`);
    return reply.code(200).send();
  }

  reply.header('Cache-Control', 'no-store');
  const key = await currentRelayKey(fastify, request);
  if (!key) {
    request.log.error(
      { requestId: request.id, reason: 'relay_signing_key_unavailable', fqdn: tunnel.fqdn },
      'authz failed',
    );
    return reply.code(503).send();
  }

  const originalMethod = request.headers['x-original-method'];
  let assertion: string;
  try {
    assertion = signRelayAssertion(
      {
        aud: tunnel.plugin.agentLabel,
        port: tunnel.plugin.port,
        caller: {
          type: 'user',
          username: session.username,
          groups: session.groups
            .split(',')
            .map((g) => g.trim())
            .filter((g) => g.length > 0),
          name: session.displayName,
          email: session.email,
        },
        method: typeof originalMethod === 'string' ? originalMethod : 'GET',
        target: { route: tunnel.plugin.route },
      },
      key,
    );
  } catch (err: unknown) {
    // An identity an assertion cannot carry (a username outside
    // [A-Za-z0-9_.-], control characters, ...) — the agent would refuse it.
    request.log.info(
      {
        requestId: request.id,
        reason: 'identity_not_assertable',
        detail: err instanceof Error ? err.message : String(err),
        fqdn: tunnel.fqdn,
      },
      'authz denied',
    );
    return reply.code(403).send();
  }

  setAutheliaHeaders(reply, session);
  reply.header(RELAY_ASSERTION_HEADER, assertion);
  return reply.code(200).send();
}

/**
 * Set Authelia identity headers on the response so nginx can
 * forward them to the tunnel backend.
 */
function setAutheliaHeaders(reply: FastifyReply, session: AutheliaSession): void {
  reply.header('remote-user', session.username);
  reply.header('remote-groups', session.groups);
  reply.header('remote-name', session.displayName);
  reply.header('remote-email', session.email);
}
