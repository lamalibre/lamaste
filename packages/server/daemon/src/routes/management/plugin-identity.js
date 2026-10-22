/**
 * A plugin's users (slice 6): what its identity block declares, who is
 * entitled to it with which roles, its audience as the agent half is told,
 * and the feed that tells it. Admin only. Business logic lives in
 * `lib/entitlements.js`, `lib/audience.js` and `lib/identity-sync.js`.
 *
 *   GET    /plugins/:name/identity        declared block, approval, readiness,
 *                                         sync state, audience counts, pending erasures
 *   GET    /plugins/:name/audience        members and tombstones, in seq order
 *   GET    /plugins/:name/entitlements    role grants (and how many grants carry no roles)
 *   PUT    /plugins/:name/entitlements    { principalType, principalId, roles }
 *   DELETE /plugins/:name/entitlements?principalType=&principalId=
 *   POST   /plugins/:name/identity/sync   { reconcile? } — sync now
 */

import { z } from 'zod';
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_REGEX } from '@lamalibre/lamaste';
import { actorFromRequest } from '../../lib/actor.js';
import { listAudience } from '../../lib/audience.js';
import { listEntitlements, removeEntitlement, setEntitlement } from '../../lib/entitlements.js';
import { identityView, syncPluginIdentity } from '../../lib/identity-sync.js';
import { hookStatus } from '../../lib/plugin-hooks.js';
import { findPlugin } from '../../lib/plugins.js';

const PluginNameParamSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Plugin name must contain only lowercase letters, numbers, and hyphens'),
});

/** A user principal is a username, a group principal a Lamaste group name (Gatekeeper's rule). */
const USER_PRINCIPAL = {
  principalType: z.literal('user'),
  principalId: z
    .string()
    .min(USERNAME_MIN_LENGTH)
    .max(USERNAME_MAX_LENGTH)
    .regex(USERNAME_REGEX, 'principalId is a username'),
};
const GROUP_PRINCIPAL = {
  principalType: z.literal('group'),
  principalId: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'principalId is a group name'),
};
/** Role ids are checked against the manifest by the library. */
const ROLES = z.array(z.string().min(1).max(32)).min(1).max(32);

const PrincipalSchema = z.discriminatedUnion('principalType', [
  z.object(USER_PRINCIPAL).strict(),
  z.object(GROUP_PRINCIPAL).strict(),
]);

const EntitlementBodySchema = z.discriminatedUnion('principalType', [
  z.object({ ...USER_PRINCIPAL, roles: ROLES }).strict(),
  z.object({ ...GROUP_PRINCIPAL, roles: ROLES }).strict(),
]);

const SyncBodySchema = z.object({ reconcile: z.boolean().optional() }).strict();

/** The refusal a library threw (its `statusCode`, message and `code`), or a 500. */
function sendFailure(request, reply, err, fallback) {
  if (Number.isInteger(err.statusCode)) {
    return reply.code(err.statusCode).send({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(Array.isArray(err.unknown) ? { unknown: err.unknown } : {}),
    });
  }
  request.log.error(err, fallback);
  return reply.code(500).send({ error: fallback });
}

/** The installed plugin, answering 404 (not installed) or 400 `no_identity` (when it must declare identity). */
async function pluginFor(request, reply, { requireIdentity }) {
  const { name } = PluginNameParamSchema.parse(request.params);
  const plugin = await findPlugin(name);
  if (!plugin) {
    reply.code(404).send({ error: `Plugin "${name}" not found` });
    return null;
  }
  if (requireIdentity && !plugin.identity) {
    reply
      .code(400)
      .send({ error: `Plugin "${name}" declares no identity (roles)`, code: 'no_identity' });
    return null;
  }
  return plugin;
}

export default async function pluginIdentityRoutes(fastify, _opts) {
  fastify.get(
    '/plugins/:name/identity',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const plugin = await pluginFor(request, reply, { requireIdentity: false });
      if (!plugin) return reply;
      const [view, hooks] = await Promise.all([identityView(plugin.name), hookStatus(plugin)]);
      return {
        identity: {
          ...view,
          approval: { approved: hooks.identity.approved, state: hooks.approval.state },
        },
      };
    },
  );

  fastify.get(
    '/plugins/:name/audience',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const plugin = await pluginFor(request, reply, { requireIdentity: true });
      if (!plugin) return reply;
      const rows = await listAudience(plugin.name);
      return {
        head: rows.reduce((head, row) => Math.max(head, row.seq), 0),
        audience: rows.map((row) => ({
          userId: row.userId,
          seq: row.seq,
          version: row.version,
          updatedAt: row.updatedAt,
          change: row.change,
        })),
      };
    },
  );

  fastify.get(
    '/plugins/:name/entitlements',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const plugin = await pluginFor(request, reply, { requireIdentity: true });
      if (!plugin) return reply;
      try {
        return await listEntitlements(plugin);
      } catch (err) {
        return sendFailure(request, reply, err, 'Failed to read the entitlements');
      }
    },
  );

  fastify.put(
    '/plugins/:name/entitlements',
    {
      preHandler: fastify.requireRole(['admin']),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const plugin = await pluginFor(request, reply, { requireIdentity: true });
      if (!plugin) return reply;
      const body = EntitlementBodySchema.parse(request.body);
      try {
        const result = await setEntitlement(plugin, body, {
          actor: actorFromRequest(request),
          logger: request.log,
        });
        return {
          ok: true,
          entitlement: result.entitlement,
          changed: result.changed,
          ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
        };
      } catch (err) {
        return sendFailure(request, reply, err, 'Failed to set the entitlement');
      }
    },
  );

  fastify.delete(
    '/plugins/:name/entitlements',
    {
      preHandler: fastify.requireRole(['admin']),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const plugin = await pluginFor(request, reply, { requireIdentity: true });
      if (!plugin) return reply;
      const principal = PrincipalSchema.parse(request.query ?? {});
      try {
        const result = await removeEntitlement(plugin, principal, {
          actor: actorFromRequest(request),
          logger: request.log,
        });
        return {
          ok: true,
          revoked: result.revoked,
          ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
        };
      } catch (err) {
        return sendFailure(request, reply, err, 'Failed to remove the entitlement');
      }
    },
  );

  fastify.post(
    '/plugins/:name/identity/sync',
    {
      preHandler: fastify.requireRole(['admin']),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const plugin = await pluginFor(request, reply, { requireIdentity: true });
      if (!plugin) return reply;
      const body = SyncBodySchema.parse(request.body ?? {});
      const result = await syncPluginIdentity(plugin.name, {
        reconcile: body.reconcile === true,
        logger: request.log,
      });
      const view = await identityView(plugin.name);
      return {
        ok: result.status === 'synced' || result.status === 'up-to-date',
        result,
        sync: view?.sync ?? null,
      };
    },
  );
}
