import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { request as undiciRequest } from 'undici';
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
 * Look up a tunnel by its FQDN from the in-memory cache.
 */
function findTunnelByFqdn(tunnels: readonly TunnelInfo[], fqdn: string): TunnelInfo | undefined {
  return tunnels.find((t) => t.fqdn === fqdn);
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

export async function authzRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /authz/check — nginx auth_request target
   *
   * Flow:
   * 1. Read Cookie and X-Original-URL from nginx
   * 2. Validate Authelia session (cached in memory)
   * 3. Look up tunnel by hostname
   * 4. Check access mode and grants
   * 5. Return 200 (allowed), 401 (not authenticated), or 403 (not authorized)
   *
   * On 403, the response body is the full access-request HTML page
   * (nginx serves this inline on the tunnel's FQDN via error_page 403 =).
   */
  fastify.get('/authz/check', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;
    const cookie = request.headers['cookie'] ?? '';
    const originalUrl = (request.headers['x-original-url'] as string) ?? '';

    if (!cookie || !originalUrl) {
      return reply.code(401).send();
    }

    // Parse and validate X-Original-URL before any other work.
    // Defense-in-depth: the 127.0.0.1 bind + nginx auth_request boundary is
    // the primary guarantee that this header is trustworthy; host matching
    // ensures a misconfigured proxy chain cannot forge tunnel identity.
    const parsed = parseOriginalUrl(originalUrl);
    if (!parsed) {
      request.log.info({ requestId, reason: 'invalid_original_url' }, 'authz denied');
      return reply.code(401).send();
    }

    // Host header check: when nginx forwards the parent request's Host to the
    // subrequest (default behavior for auth_request), the hostname portion
    // must match the hostname parsed from X-Original-URL. Port differences
    // are ignored — nginx often normalizes them. An absent Host header skips
    // the check (some proxies strip it from internal subrequests).
    const hostHeader = (request.headers['host'] as string | undefined) ?? '';
    if (hostHeader) {
      const hostOnly = hostHeader.split(':')[0]?.toLowerCase() ?? '';
      if (hostOnly && hostOnly !== parsed.hostname.toLowerCase()) {
        request.log.info(
          { requestId, reason: 'host_header_mismatch', originalHost: parsed.hostname, hostHeader },
          'authz denied',
        );
        return reply.code(401).send();
      }
    }

    const tunnels = fastify.getTunnels();
    const tunnel = findTunnelByFqdn(tunnels, parsed.hostname);
    if (!tunnel) {
      request.log.info(
        { requestId, reason: 'unknown_tunnel_fqdn', fqdn: parsed.hostname },
        'authz denied',
      );
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
      setAutheliaHeaders(reply, session);
      reply.header('Cache-Control', `public, max-age=${AUTHZ_SUCCESS_MAX_AGE_SECONDS}`);
      reply.header('X-Gatekeeper-Cache-Version', String(fastify.getCacheVersion()));
      return reply.code(200).send();
    }

    // restricted — check grants
    const result = await checkAccess(session.username, 'tunnel', tunnel.id, {
      adminContact: fastify.getSettings().adminEmail,
      adminName: fastify.getSettings().adminName,
    });

    if (result.allowed) {
      setAutheliaHeaders(reply, session);
      reply.header('Cache-Control', `public, max-age=${AUTHZ_SUCCESS_MAX_AGE_SECONDS}`);
      reply.header('X-Gatekeeper-Cache-Version', String(fastify.getCacheVersion()));
      return reply.code(200).send();
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
  });
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
