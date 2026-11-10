/**
 * The token broker's endpoints — `/api/native-apps/oauth/token` and
 * `/api/native-apps/oauth/revocation`, where nginx sends every domain's
 * `auth.<domain>/api/oidc/token` and `/api/oidc/revocation`
 * (native-apps-design.md D4; the work is `lib/native-broker.js`).
 *
 * A context of its own on the panel's root instance: no mTLS, no 2FA, no
 * role, no CORS, no rate limit of the panel's (the broker limits native
 * requests itself — a plugin client's device-code polling, passed to
 * Authelia, is never throttled here). Its bodies are read raw, at most
 * 16 KiB, whatever their type: a request no native client makes reaches
 * Authelia byte for byte, provided it is a form (`lib/native-broker.js`
 * `bodyRefusal`). 503 before onboarding completes. Logs metadata
 * only (the panel's request logging: the route pattern, never a body).
 */

import errorHandler from '../middleware/errors.js';
import { managementOnly } from '../middleware/onboarding-guard.js';
import { NATIVE_BROKER_BODY_LIMIT, handleBrokerRequest } from '../lib/native-broker.js';

/** The broker's routes under the panel's API prefix. */
export const NATIVE_BROKER_PREFIX = '/api/native-apps/oauth';

async function brokerRoutes(fastify) {
  // Every body raw: a form for Authelia is passed as it came.
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser(
    '*',
    { parseAs: 'buffer', bodyLimit: NATIVE_BROKER_BODY_LIMIT },
    (_request, body, done) => done(null, body),
  );

  const options = {
    bodyLimit: NATIVE_BROKER_BODY_LIMIT,
    config: { rateLimit: false, cors: false },
  };
  for (const endpoint of ['token', 'revocation']) {
    fastify.post(`/${endpoint}`, options, async (request, reply) => {
      const answer = await handleBrokerRequest({
        endpoint,
        host: request.headers.host,
        contentType: request.headers['content-type'],
        contentEncoding: request.headers['content-encoding'],
        authorization: request.headers.authorization,
        userAgent: request.headers['user-agent'],
        accept: request.headers.accept,
        clientIp: request.ip,
        body: Buffer.isBuffer(request.body) ? request.body : undefined,
        logger: request.log,
      });
      reply.code(answer.status);
      for (const [name, value] of Object.entries(answer.headers)) reply.header(name, value);
      return reply.send(answer.body);
    });
  }
}

/**
 * The broker's context. Register it on the panel's root instance (not
 * inside another context): it must not inherit the protected context's
 * hooks.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export default async function nativeOauthContext(app) {
  app.addHook('onRequest', managementOnly());
  await app.register(errorHandler);
  await app.register(brokerRoutes, { prefix: NATIVE_BROKER_PREFIX });
}
