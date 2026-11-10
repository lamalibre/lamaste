/**
 * A person's own account on a domain's sign-in host
 * (packages/core/docs/mail-design.md §6.2, §6.3) — public, no mTLS:
 *
 * - `POST /api/account/reset/start|lookup|finish` — forgot password; the
 *   token always in the body, never in a URL a log keeps;
 * - `POST /api/account/password` — change password: nginx asks Gatekeeper
 *   (`/authz/account/<domain>`), which asks Authelia about the session (two
 *   factors) and vouches for its user with a relay assertion bound to this
 *   request — the only thing the panel takes the user from (any local
 *   process can send `Remote-User` to its loopback port).
 *
 * The domain is the raw `Host`'s (lib/account.js). Every change must come
 * from the sign-in host's own page: `Sec-Fetch-Site` absent or
 * `same-origin`, and an `Origin` — required for a password change, checked
 * when a browser sends one — exactly `https://auth.<host's domain>`.
 * Answers are never cached and never carry the server's own words to the
 * page (it words a refusal by its `code`).
 */

import {
  PasswordChangeSchema,
  PasswordResetFinishSchema,
  PasswordResetLookupSchema,
  PasswordResetStartSchema,
  refusedField,
} from '@lamalibre/lamaste';

import {
  authHostDomain,
  changeOwnPassword,
  finishPasswordReset,
  lookupPasswordReset,
  resetStartAnswerAt,
  startPasswordReset,
} from '../lib/account.js';
import { sendFailure } from '../lib/app-error.js';
import { verifyAccountRelay } from '../lib/user-surface.js';

/** A page's own requests: a handful a minute per address. */
const ACCOUNT_RATE_LIMIT = { max: 20, timeWindow: '1 minute' };

/** Whether a change comes from the sign-in host's own page. */
async function sameOrigin(request, { originRequired }) {
  const site = request.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin') return false;
  // No sign-in host: the handler answers 404, as for any other request.
  const domain = await authHostDomain(request.headers.host);
  if (domain === null) return true;
  const origin = request.headers.origin;
  if (origin === undefined) return !originRequired;
  return origin === `https://auth.${domain}`;
}

/** The body as `schema` reads it, or the 400 already sent (null). */
function parsed(schema, request, reply) {
  const result = schema.safeParse(request.body);
  if (result.success) return result.data;
  const field = refusedField(result.error);
  reply.code(400).send({
    error: field ? `Invalid ${field}` : 'Invalid request',
    code: 'invalid_request',
    ...(field ? { field } : {}),
  });
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

export default async function accountRoutes(fastify, opts = {}) {
  // Tests replace the relay check.
  const verifyRelay = opts.verifyRelay ?? verifyAccountRelay;
  const routeOptions = { config: { rateLimit: ACCOUNT_RATE_LIMIT, cors: false } };

  fastify.addHook('onRequest', async (_request, reply) => {
    reply.headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  });

  /** Refuse a cross-origin change before anything is read; true when refused. */
  async function crossOrigin(request, reply, originRequired = false) {
    if (await sameOrigin(request, { originRequired })) return false;
    reply.code(403).send({ error: 'cross-origin request refused', code: 'forbidden' });
    return true;
  }

  // POST /api/account/reset/start { identifier } — always 202 after the same
  // delay, whatever was found; 404 where this host cannot reset
  fastify.post('/reset/start', routeOptions, async (request, reply) => {
    const arrivedAt = Date.now();
    if (await crossOrigin(request, reply)) return reply;
    const body = parsed(PasswordResetStartSchema, request, reply);
    if (!body) return reply;
    try {
      await startPasswordReset(body, {
        host: request.headers.host,
        address: request.ip,
        logger: request.log,
      });
    } catch (err) {
      return sendFailure(request, reply, err, 'Password reset is not available');
    }
    await sleep(resetStartAnswerAt(arrivedAt) - Date.now());
    return reply.code(202).send({ sent: true });
  });

  // POST /api/account/reset/lookup { token } → { username, displayName }
  fastify.post('/reset/lookup', routeOptions, async (request, reply) => {
    if (await crossOrigin(request, reply)) return reply;
    const body = parsed(PasswordResetLookupSchema, request, reply);
    if (!body) return reply;
    try {
      return await lookupPasswordReset(body, { host: request.headers.host });
    } catch (err) {
      return sendFailure(request, reply, err, 'Failed to read the link');
    }
  });

  // POST /api/account/reset/finish { token, password, totp }
  fastify.post('/reset/finish', routeOptions, async (request, reply) => {
    if (await crossOrigin(request, reply)) return reply;
    const body = parsed(PasswordResetFinishSchema, request, reply);
    if (!body) return reply;
    try {
      return await finishPasswordReset(body, {
        host: request.headers.host,
        logger: request.log,
      });
    } catch (err) {
      return sendFailure(request, reply, err, 'Failed to set the password');
    }
  });

  // POST /api/account/password { currentPassword, newPassword } — signed in
  fastify.post('/password', routeOptions, async (request, reply) => {
    if (await crossOrigin(request, reply, true)) return reply;
    const body = parsed(PasswordChangeSchema, request, reply);
    if (!body) return reply;
    const relay = await verifyRelay(request);
    try {
      return await changeOwnPassword(body, {
        host: request.headers.host,
        caller: relay.ok ? { username: relay.username, domain: relay.domain } : null,
        logger: request.log,
      });
    } catch (err) {
      return sendFailure(request, reply, err, 'Failed to change the password');
    }
  });
}
