import fp from 'fastify-plugin';
import { getConfig } from '../lib/config.js';
import {
  REFRESH_THRESHOLD,
  validateUserSession,
  refreshUserSession,
} from '../lib/user-access-session.js';

/**
 * Fastify plugin that validates user-access session tokens from the
 * Authorization: Bearer header. Sets request.userAccessUsername on success.
 *
 * Refreshed tokens are returned via X-User-Session response header so the
 * desktop client can update its stored token.
 */
async function userAccessSessionPlugin(fastify, _opts) {
  fastify.addHook('onRequest', async (request, reply) => {
    const config = getConfig();
    const sessionSecret = config.sessionSecret;

    if (!sessionSecret) {
      return reply.code(401).send({ error: 'user_session_required' });
    }

    // Extract Bearer token from Authorization header
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'user_session_required' });
    }

    const tokenValue = authHeader.slice(7);
    const result = validateUserSession(tokenValue, sessionSecret, {
      userEpochs: config.userEpochs ?? {},
    });

    if (!result.valid) {
      return reply.code(401).send({ error: 'user_session_required' });
    }

    // Set username on request for downstream route handlers
    request.userAccessUsername = result.payload.username;

    // Throttle refresh: only re-sign if lastActivity is stale (>60s)
    const now = Math.floor(Date.now() / 1000);
    if (now - result.payload.lastActivity >= REFRESH_THRESHOLD) {
      const refreshed = refreshUserSession(result.payload, sessionSecret);
      reply.header('X-User-Session', refreshed.value);
    }
  });
}

export default fp(userAccessSessionPlugin, { name: 'user-access-session' });
