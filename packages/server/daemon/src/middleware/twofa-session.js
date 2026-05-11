import fp from 'fastify-plugin';
import { getConfig } from '../lib/config.js';
import {
  COOKIE_NAME,
  COOKIE_OPTIONS,
  REFRESH_THRESHOLD,
  validateSession,
  refreshSession,
} from '../lib/session.js';

/**
 * Exempt paths that must remain accessible without a 2FA session.
 * These include the health check, the 2FA status endpoint, and the verify endpoint.
 */
const EXEMPT_PATHS = new Set(['/api/health', '/api/settings/2fa', '/api/settings/2fa/verify']);

async function twofaSessionPlugin(fastify, _opts) {
  fastify.addHook('onRequest', async (request, reply) => {
    const config = getConfig();

    // 2FA not enabled — skip entirely
    if (!config.panel2fa || !config.panel2fa.enabled) {
      return;
    }

    // Agents bypass 2FA — both regular agent certs and plugin-agent certs
    // (plugin-agents are automated callers; only humans need the second factor)
    if (request.certRole === 'agent' || request.certRole === 'plugin-agent') {
      return;
    }

    // Exempt paths
    if (EXEMPT_PATHS.has(request.url) || EXEMPT_PATHS.has(request.url.split('?')[0])) {
      return;
    }

    // Admin must have a valid 2FA session
    if (request.certRole === 'admin') {
      const sessionSecret = config.sessionSecret;
      if (!sessionSecret) {
        return reply.code(401).send({ error: '2fa_required' });
      }

      const cookieValue = request.cookies?.[COOKIE_NAME];
      const certSerial = request.headers['x-ssl-client-serial'] || undefined;
      const result = validateSession(cookieValue, sessionSecret, certSerial);

      if (!result.valid) {
        return reply.code(401).send({ error: '2fa_required' });
      }

      // Throttle refresh: only re-sign if lastActivity is stale (>60s)
      const now = Math.floor(Date.now() / 1000);
      if (now - result.payload.lastActivity >= REFRESH_THRESHOLD) {
        const refreshed = refreshSession(result.payload, sessionSecret);
        reply.setCookie(COOKIE_NAME, refreshed.value, {
          ...COOKIE_OPTIONS,
          maxAge: refreshed.maxAge,
        });
      }
    }
  });
}

export default fp(twofaSessionPlugin, { name: 'twofa-session' });
