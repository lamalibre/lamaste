/**
 * Admin management of the relay's trusted publisher scopes.
 *
 *   GET    /api/settings/trusted-scopes          { builtIn, additional, effective }
 *   POST   /api/settings/trusted-scopes          { scope } — trust one more scope
 *   DELETE /api/settings/trusted-scopes/:scope   stop trusting one
 *
 * A trusted scope's plugins run with the same privileges as Lamalibre's own
 * — server plugins in this panel's process, admin bundles in its page —
 * so only an administrator changes the list, every change is audited
 * (`settings.trusted-scope.added|removed`) and announced to the
 * administrators. Adding needs a registry credential whose registry hosts
 * the scope; removing is refused while an installed plugin or a push-install
 * policy uses it. See `lib/trusted-scope-settings.js`.
 */

import { z } from 'zod';
import { actorFromRequest } from '../../lib/actor.js';
import {
  addTrustedScope,
  removeTrustedScope,
  trustedScopesView,
} from '../../lib/trusted-scope-settings.js';

const ScopeBodySchema = z.object({ scope: z.string().min(1).max(64) }).strict();
const ScopeParamSchema = z.object({ scope: z.string().min(1).max(64) });

/** Send a refusal of the settings module (`statusCode`, `code`, extra fields). */
function sendRefusal(request, reply, err, fallback) {
  const statusCode = err.statusCode ?? 500;
  if (statusCode >= 500 && !err.code) {
    request.log.error({ err: err.message }, fallback);
    return reply.code(500).send({ error: fallback });
  }
  const body = { error: err.message };
  if (err.code) body.code = err.code;
  if (err.plugins) body.plugins = err.plugins;
  if (err.policies) body.policies = err.policies;
  return reply.code(statusCode).send(body);
}

export default async function trustedScopeRoutes(fastify) {
  fastify.get(
    '/settings/trusted-scopes',
    { preHandler: fastify.requireRole(['admin']), config: { rateLimit: {} } },
    async () => trustedScopesView(),
  );

  fastify.post(
    '/settings/trusted-scopes',
    {
      preHandler: fastify.requireRole(['admin']),
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = ScopeBodySchema.parse(request.body);
      try {
        const view = await addTrustedScope(body.scope, {
          actor: actorFromRequest(request),
          log: request.log,
        });
        return reply.code(201).send(view);
      } catch (err) {
        return sendRefusal(request, reply, err, 'Failed to add the trusted scope');
      }
    },
  );

  fastify.delete(
    '/settings/trusted-scopes/:scope',
    {
      preHandler: fastify.requireRole(['admin']),
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const params = ScopeParamSchema.parse(request.params);
      try {
        return await removeTrustedScope(params.scope, {
          actor: actorFromRequest(request),
          log: request.log,
        });
      } catch (err) {
        return sendRefusal(request, reply, err, 'Failed to remove the trusted scope');
      }
    },
  );
}
