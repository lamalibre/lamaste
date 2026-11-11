/**
 * Google's return from the relay's mail consent
 * (packages/core/docs/mail-design.md §3.3): `GET /mail/google/callback`,
 * public — Google redirects the administrator's browser here, to
 * `https://auth.<primary>/mail/google/callback`, which the primary auth
 * vhost proxies to the panel with its `Host` written as a literal.
 *
 * Answered only for that host (read raw — `request.host` would follow a
 * client's `X-Forwarded-Host` behind the trusted loopback hop); anything
 * else is a 404. The state binds the request to a consent an
 * administrator started (single use, 10 minutes). The page is static —
 * no script — in the primary domain's brand and language; it never shows
 * what Google answered, only whether the transport was stored.
 */

import { authPageStaticHeaders, renderMailConsentPage } from '@lamalibre/lamaste/server';

import { domainPresentation } from '../lib/auth-branding.js';
import { completeGoogleConsent } from '../lib/mail.js';

/** A handful a minute is all a consent needs. */
const CALLBACK_RATE_LIMIT = { max: 20, timeWindow: '1 minute' };

export default async function mailCallbackRoutes(fastify) {
  fastify.get(
    '/mail/google/callback',
    { config: { rateLimit: CALLBACK_RATE_LIMIT } },
    async (request, reply) => {
      const outcome = await completeGoogleConsent({
        query: request.query ?? {},
        host: request.headers.host,
        logger: request.log,
      });
      if (!outcome.found) return reply.code(404).send({ error: 'Not found' });
      const { pageBrand, language } = await domainPresentation(outcome.primary);
      reply
        .headers(authPageStaticHeaders())
        .type('text/html; charset=utf-8')
        .code(outcome.result.ok ? 200 : 400);
      return renderMailConsentPage({
        brand: pageBrand,
        language,
        domain: outcome.primary,
        result: outcome.result,
      });
    },
  );
}
