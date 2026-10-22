/**
 * Plugins' user surfaces on the panel's own listener (slice 6):
 * `/api/<route>/app` and `/api/<route>/app/*`, which nginx sends here from
 * the host bound to the plugin once Gatekeeper has vouched for the
 * session's user (core `userSurfacePlugin`; `lib/user-surface.js`).
 *
 * A context of its own, beside the protected one: no mTLS, no 2FA session,
 * no role guard — the request carries a relay assertion Gatekeeper signed
 * for the panel, bound to its method and raw request target, and nothing
 * else of it is trusted. The directory turns the attested username into
 * the plugin's user (`lib/user-caller.js`: 403 disabled, removed or not
 * entitled; 404 no identity; 503 not ready), the agent half gets it in the
 * caller assertion on `/app/<rest>`, and the plugin's approved request hooks
 * run as on its admin API. Its own rate limit, no CORS; 503 before
 * onboarding completes, as every management route. Every answer of the
 * context — those refusals and the rate limit's included — carries the
 * user surface's response headers (core `applyUserSurfaceResponseHeaders`:
 * `Cross-Origin-Resource-Policy: same-origin`, `nosniff`,
 * `Content-Security-Policy: sandbox; default-src 'none'`). Each response
 * is tracked while it is sent and ended once its user may no longer use the
 * plugin (`lib/user-surface.js` sweep), or after an hour.
 *
 * These routes are static where the admin forwarder's `/api/:route/*` is a
 * wildcard, so they win on the shared router: the admin forwarder never
 * reaches an agent half's `/admin/app` or anything under it.
 */

import { applyUserSurfaceResponseHeaders, userSurfacePlugin } from '@lamalibre/lamaste/server';
import errorHandler from '../middleware/errors.js';
import { managementOnly } from '../middleware/onboarding-guard.js';
import { requestHookRuntime } from '../lib/request-hooks.js';
import { resolveUserCaller } from '../lib/user-caller.js';
import {
  USER_SURFACE_ROUTE_CONFIG,
  resolveUserSurfaceTarget,
  userSurfaceOrigin,
  userSurfaceResponseTracker,
  verifyUserSurfaceRelay,
} from '../lib/user-surface.js';

async function userSurfaceRoutes(fastify) {
  await fastify.register(userSurfacePlugin, {
    verifyRelay: verifyUserSurfaceRelay,
    resolveTarget: resolveUserSurfaceTarget,
    resolveUserCaller,
    originFor: userSurfaceOrigin,
    trackResponse: userSurfaceResponseTracker(fastify.log),
    hooks: requestHookRuntime,
    logger: fastify.log,
    routeConfig: USER_SURFACE_ROUTE_CONFIG,
  });
}

/**
 * The user-surface context. Register it on the panel's root instance (not
 * inside another context): it must not inherit the protected context's
 * hooks, and must share its router.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export default async function userSurfaceContext(app) {
  // First, before anything can answer: the user surface's response headers.
  app.addHook('onRequest', async (_request, reply) => {
    applyUserSurfaceResponseHeaders(reply.raw);
  });
  app.addHook('onRequest', managementOnly());
  await app.register(errorHandler);
  await app.register(userSurfaceRoutes, { prefix: '/api' });
}
