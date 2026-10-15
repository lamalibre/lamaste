import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { request as undiciRequest } from 'undici';
import { RELAY_ASSERTION_HEADER, signRelayAssertion } from '@lamalibre/lamaste';
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
 * Extract the Authelia session cookie value from the full cookie header.
 *
 * Returns null when the cookie header is missing the `authelia_session=`
 * pair. The Authelia session cookie is the only auth signal we accept on
 * this path — any other cookie (CSRF tokens, analytics, etc.) carries no
 * identity. Falling back to the raw header would let unrelated cookies
 * drive the cache key, which would either pollute the cache or — once a
 * future refactor caches negative results — let an unauthenticated request
 * poison a downstream entry.
 */
function extractAutheliaCookie(cookie: string): string | null {
  const match = cookie.match(/(?:^|;\s*)authelia_session=([^;]*)/);
  return match?.[1] ?? null;
}

/**
 * Derive a session cache key from a cookie string using HMAC-SHA256.
 *
 * The HMAC key is per-process random — keys are not predictable from cookie
 * values alone, which prevents an outsider from probing/seeding the cache.
 */
function hashCookie(cookie: string): string {
  return crypto.createHmac('sha256', COOKIE_HMAC_KEY).update(cookie).digest('hex');
}

/**
 * Forward the request's cookies to Authelia's verify endpoint
 * and extract the identity headers from the response.
 */
async function validateWithAuthelia(
  cookie: string,
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
        Cookie: cookie,
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

/** A tunnel hostname as a vhost writes it into the subrequest's path. */
const TUNNEL_FQDN_RE =
  /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/**
 * nginx is the only client of the authorization routes (Gatekeeper binds
 * 127.0.0.1) and calls them on every protected request. Per-IP throttling
 * would punish legitimate traffic because every caller arrives as
 * 127.0.0.1, so the key is one bucket with an effectively-unlimited 10k/min
 * ceiling: the rate limit is structurally present (CodeQL
 * js/missing-rate-limiting) without breaking the hot path.
 */
const INTERNAL_RATE_LIMIT = {
  rateLimit: {
    max: 10_000,
    timeWindow: '1 minute',
    keyGenerator: () => 'gatekeeper-internal',
  },
};

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

export async function authzRoutes(fastify: FastifyInstance): Promise<void> {
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
    { config: INTERNAL_RATE_LIMIT },
    async (request, reply) => authorizeTunnelRequest(fastify, request, reply, request.params.fqdn),
  );

  /**
   * GET /authz/check — what tunnel vhosts written before 4.3 call. They name
   * the tunnel by the client's Host header (`$http_host`), which an
   * absolute-form request line can point at another tunnel than the one
   * nginx serves, so their requests are refused: until the panel rewrites
   * such a vhost (it does when it starts) its tunnel is closed, rather than
   * open to the users of every other tunnel.
   */
  fastify.get('/authz/check', { config: INTERNAL_RATE_LIMIT }, async (request, reply) => {
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

  const cookie = request.headers['cookie'] ?? '';
  const originalUrl = (request.headers['x-original-url'] as string) ?? '';
  if (!cookie || !originalUrl) {
    return reply.code(401).send();
  }

  const parsed = parseOriginalUrl(originalUrl);
  if (!parsed) {
    request.log.info({ requestId, reason: 'invalid_original_url' }, 'authz denied');
    return reply.code(401).send();
  }

  // The vhost writes the same hostname into the path, X-Original-URL and
  // Host. Disagreement means a request that did not come from a tunnel
  // vhost of this version: refuse it before Authelia is asked anything.
  const named = fqdn.toLowerCase();
  const hostHeader = (request.headers['host'] as string | undefined) ?? '';
  const hostOnly = hostHeader.split(':')[0]?.toLowerCase() ?? '';
  if (parsed.hostname.toLowerCase() !== named || hostOnly !== named) {
    request.log.info(
      {
        requestId,
        reason: hostOnly ? 'tunnel_name_mismatch' : 'missing_host_header',
        tunnel: fqdn,
        originalHost: parsed.hostname,
        hostHeader,
      },
      'authz denied',
    );
    return reply.code(401).send();
  }

  const tunnels = fastify.getTunnels();
  const tunnel = findTunnelByFqdn(tunnels, fqdn);
  if (!tunnel) {
    request.log.info({ requestId, reason: 'unknown_tunnel_fqdn', fqdn }, 'authz denied');
    return reply.code(401).send();
  }

  // Check session cache (keyed by Authelia session cookie only to prevent
  // cache pollution via unrelated cookies like CSRF tokens or analytics).
  const autheliaCookie = extractAutheliaCookie(cookie);
  if (!autheliaCookie) {
    // No authelia_session — short-circuit before any cache work or the
    // upstream Authelia /verify call. Without this, an unauthenticated
    // request would still cost us an Authelia round-trip.
    request.log.info(
      { requestId, reason: 'missing_authelia_cookie', fqdn: parsed.hostname },
      'authz denied',
    );
    return reply.code(401).send();
  }
  const cacheKey = hashCookie(autheliaCookie);
  const sessionCache = fastify.getSessionCache();
  const cached = sessionCache.get(cacheKey);
  const now = Date.now();
  let session: AutheliaSession | undefined;

  if (cached && cached.expiresAt > now) {
    session = cached;
  } else {
    if (cached) {
      // Lazy TTL eviction — one stale entry pruned per request.
      sessionCache.delete(cacheKey);
    }
    const validated = await validateWithAuthelia(cookie, originalUrl, requestId);
    if (!validated) {
      request.log.info(
        { requestId, reason: 'authelia_rejected', fqdn: parsed.hostname },
        'authz denied',
      );
      return reply.code(401).send();
    }

    // Opportunistic eviction — drop oldest (insertion-order head) when at cap.
    while (sessionCache.size >= MAX_SESSION_CACHE_ENTRIES) {
      const oldestKey = sessionCache.keys().next().value;
      if (oldestKey === undefined) break;
      sessionCache.delete(oldestKey);
    }

    sessionCache.set(cacheKey, validated);
    session = validated;
  }

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

  request.log.info(
    {
      requestId,
      reason: 'no_matching_grant',
      username: session.username,
      resourceType: 'tunnel',
      resourceId: tunnel.id,
      requiredGrant: `tunnel:${tunnel.id}`,
      fqdn: parsed.hostname,
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
  let key: RelaySigningKey | null = null;
  try {
    key = await fastify.getRelaySigner().current();
  } catch (err: unknown) {
    request.log.error(
      { err: err instanceof Error ? err.message : String(err) },
      'Relay signing key unusable',
    );
  }
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
