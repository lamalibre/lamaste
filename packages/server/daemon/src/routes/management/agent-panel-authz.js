/**
 * GET /api/agent-panel/authz/:label — the `auth_request` target of an
 * agent-panel vhost (`agent-<label>.<domain>`).
 *
 * nginx calls it for every request on that vhost, with the client
 * certificate's verification result in the `X-SSL-Client-*` headers (so the
 * mTLS middleware refuses a revoked or unknown certificate, as for any panel
 * route) and the request's method and target in `X-Original-Method` /
 * `X-Original-URI`. On success it answers 200 with a relay assertion in
 * `X-Lamalibre-Relay-Assertion`, which nginx forwards to the agent's
 * lamaste-agentd — the only proof of the caller the daemon accepts from the
 * relay. A 401/403 from here is what nginx answers the browser.
 *
 * Through the panel's own vhosts this route is reachable too, with
 * client-chosen `X-Original-*`. That gains nothing: the assertion only ever
 * names the caller's own, nginx-verified certificate, for a panel that
 * certificate may use anyway.
 */

import { z } from 'zod';
import { signRelayAssertion, RELAY_ASSERTION_HEADER } from '@lamalibre/lamaste';
import { authorizeAgentPanelRequest } from '@lamalibre/lamaste/server';
import { readTunnels } from '../../lib/state.js';
import { relaySigner } from '../../lib/relay-signing.js';

const LabelParamSchema = z.object({
  label: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Invalid agent label'),
});

/** @param {string | string[] | undefined} value */
function single(value) {
  return typeof value === 'string' ? value : undefined;
}

export default async function agentPanelAuthzRoutes(fastify, _opts) {
  fastify.get(
    '/agent-panel/authz/:label',
    {
      preHandler: fastify.requireRole(['admin', 'agent']),
      // One call per request on an agent panel — its SPA's assets and API
      // polling included — keyed by the browser's address (nginx sets
      // X-Forwarded-For to $remote_addr on the subrequest). Well above what
      // the daemon behind it serves (100/min), so it never is the limit.
      config: { rateLimit: { max: 1200, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { label } = LabelParamSchema.parse(request.params);
      reply.header('Cache-Control', 'no-store');

      const decision = authorizeAgentPanelRequest(
        {
          label,
          certRole: request.certRole,
          certLabel: request.certLabel,
          method: single(request.headers['x-original-method']),
          uri: single(request.headers['x-original-uri']),
        },
        await readTunnels(),
      );
      if (!decision.ok) {
        request.log.info(
          { label, certRole: request.certRole, reason: decision.reason },
          'Agent panel request refused',
        );
        return reply.code(decision.status).send();
      }

      let key;
      try {
        key = await relaySigner.current();
      } catch (err) {
        request.log.error(
          { err: err instanceof Error ? err.message : String(err) },
          'Relay signing key unusable',
        );
        key = null;
      }
      if (!key) return reply.code(503).send();

      const assertion = signRelayAssertion(
        {
          aud: decision.aud,
          port: decision.port,
          caller: decision.caller,
          method: decision.method,
          target: { path: decision.path },
        },
        key,
      );
      return reply.header(RELAY_ASSERTION_HEADER, assertion).code(200).send();
    },
  );
}
