/**
 * The invitation page's API (public, no mTLS): both kinds of invitation,
 * the administrator's and delegated ones (lib/invitation-acceptance.js;
 * delegated-invitations-design.md §7).
 *
 * The token travels in the body, never in a URL a log keeps — the link
 * carries it in its fragment. A delegated token is answered only by the
 * sign-in host of its domain: the `Host` the auth vhost writes as a literal,
 * read raw (`request.headers.host`) — `request.host` would follow a
 * client's `X-Forwarded-Host` behind the trusted loopback hop.
 */

import { sendFailure } from '../lib/app-error.js';
import { acceptInvitation, lookupInvitation } from '../lib/invitation-acceptance.js';

/** At most this many requests a minute from one address — a link holder needs a handful. */
const INVITE_RATE_LIMIT = { max: 20, timeWindow: '1 minute' };

export default async function inviteRoutes(fastify, _opts) {
  const routeOptions = { config: { rateLimit: INVITE_RATE_LIMIT } };

  // POST /api/invite/lookup { token } — what the invitation page shows
  fastify.post('/lookup', routeOptions, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      return await lookupInvitation(request.body, { host: request.headers.host });
    } catch (err) {
      return sendFailure(request, reply, err, 'Failed to read the invitation');
    }
  });

  // POST /api/invite/accept { token, password } (an administrator's) or
  // { token, username, displayName, password } (a delegated one)
  fastify.post('/accept', routeOptions, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      return await acceptInvitation(request.body, {
        host: request.headers.host,
        logger: request.log,
      });
    } catch (err) {
      if (err.field) {
        return reply.code(400).send({ error: err.message, code: err.code, field: err.field });
      }
      return sendFailure(request, reply, err, 'Failed to create user account');
    }
  });
}
