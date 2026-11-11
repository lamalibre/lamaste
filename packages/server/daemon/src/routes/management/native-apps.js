/**
 * Native clients and their grants (native-apps-design.md D2, D4). Admin
 * only. Business logic lives in `lib/native-apps.js` and
 * `lib/native-grants.js`.
 *
 *   GET    /native-apps                              every native client, its host resolved
 *   POST   /native-apps                              register one (core NativeClientCreateSchema)
 *   GET    /native-apps/:clientId                    one
 *   PATCH  /native-apps/:clientId                    change one (core NativeClientUpdateSchema)
 *   DELETE /native-apps/:clientId                    delete one, its grants ended
 *   GET    /native-apps/:clientId/grants             ?userId=&status=live|ended|all
 *   DELETE /native-apps/:clientId/grants/:grantId    end one grant
 *   POST   /native-apps/:clientId/grants/revoke      { userId } — end all of a person's
 *   GET    /users/:username/native-grants            a person's grants, every client
 *
 * The bodies of POST and PATCH are validated by the core schemas inside the
 * library; this layer validates the parameters and the revoke body.
 */

import { z } from 'zod';
import { isNativeClientId } from '@lamalibre/lamaste';

import { actorFromRequest } from '../../lib/actor.js';
import { sendFailure } from '../../lib/app-error.js';
import { findDirectoryUser } from '../../lib/directory.js';
import {
  createNativeClient,
  deleteNativeClient,
  getNativeClient,
  listNativeClients,
  updateNativeClient,
} from '../../lib/native-apps.js';
import { getNativeGrant, listNativeGrants, revokeNativeGrants } from '../../lib/native-grants.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const ClientParamSchema = z.object({
  clientId: z.string().refine(isNativeClientId, 'Not a native client id'),
});
const GrantParamSchema = ClientParamSchema.extend({ grantId: z.string().regex(UUID_RE) });
const GrantsQuerySchema = z
  .object({
    userId: z.string().regex(UUID_RE).optional(),
    status: z.enum(['live', 'ended', 'all']).default('live'),
  })
  .strict();
const RevokeBodySchema = z.object({ userId: z.string().regex(UUID_RE) }).strict();
const UsernameParamSchema = z.object({ username: z.string().min(1).max(64) });
const UserGrantsQuerySchema = z
  .object({ status: z.enum(['live', 'ended', 'all']).default('live') })
  .strict();

/** Parse `schema` from `value`, or answer 400 and return null. */
function parsed(schema, value, reply) {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  reply.code(400).send({
    error: result.error.issues[0]?.message ?? 'Invalid request',
    code: 'invalid_request',
  });
  return null;
}

export default async function nativeAppsRoutes(fastify) {
  const admin = { preHandler: fastify.requireRole(['admin']) };

  fastify.get('/native-apps', admin, async () => ({ clients: await listNativeClients() }));

  fastify.post('/native-apps', admin, async (request, reply) => {
    try {
      const created = await createNativeClient(request.body, {
        actor: actorFromRequest(request),
        logger: request.log,
      });
      return reply.code(201).send(created);
    } catch (err) {
      return sendFailure(request, reply, err, 'Failed to register the native client');
    }
  });

  fastify.get('/native-apps/:clientId', admin, async (request, reply) => {
    const params = parsed(ClientParamSchema, request.params, reply);
    if (!params) return reply;
    try {
      return { client: await getNativeClient(params.clientId) };
    } catch (err) {
      return sendFailure(request, reply, err, 'Failed to read the native client');
    }
  });

  fastify.patch('/native-apps/:clientId', admin, async (request, reply) => {
    const params = parsed(ClientParamSchema, request.params, reply);
    if (!params) return reply;
    try {
      return await updateNativeClient(params.clientId, request.body, {
        actor: actorFromRequest(request),
        logger: request.log,
      });
    } catch (err) {
      return sendFailure(request, reply, err, 'Failed to change the native client');
    }
  });

  fastify.delete('/native-apps/:clientId', admin, async (request, reply) => {
    const params = parsed(ClientParamSchema, request.params, reply);
    if (!params) return reply;
    try {
      return await deleteNativeClient(params.clientId, {
        actor: actorFromRequest(request),
        logger: request.log,
      });
    } catch (err) {
      return sendFailure(request, reply, err, 'Failed to delete the native client');
    }
  });

  fastify.get('/native-apps/:clientId/grants', admin, async (request, reply) => {
    const params = parsed(ClientParamSchema, request.params, reply);
    if (!params) return reply;
    const query = parsed(GrantsQuerySchema, request.query, reply);
    if (!query) return reply;
    try {
      await getNativeClient(params.clientId);
      return {
        grants: await listNativeGrants({
          clientId: params.clientId,
          status: query.status,
          ...(query.userId ? { userId: query.userId } : {}),
        }),
      };
    } catch (err) {
      return sendFailure(request, reply, err, 'Failed to list the grants');
    }
  });

  fastify.delete('/native-apps/:clientId/grants/:grantId', admin, async (request, reply) => {
    const params = parsed(GrantParamSchema, request.params, reply);
    if (!params) return reply;
    const grant = await getNativeGrant(params.grantId);
    if (!grant || grant.clientId !== params.clientId) {
      return reply.code(404).send({ error: 'No such grant', code: 'not_found' });
    }
    const ended = await revokeNativeGrants({ grantId: params.grantId }, 'revoked_by_admin', {
      actor: actorFromRequest(request),
      logger: request.log,
    });
    return { ok: true, ended: ended.length };
  });

  fastify.post('/native-apps/:clientId/grants/revoke', admin, async (request, reply) => {
    const params = parsed(ClientParamSchema, request.params, reply);
    if (!params) return reply;
    const body = parsed(RevokeBodySchema, request.body, reply);
    if (!body) return reply;
    try {
      await getNativeClient(params.clientId);
    } catch (err) {
      return sendFailure(request, reply, err, 'Failed to end the grants');
    }
    const ended = await revokeNativeGrants(
      { clientId: params.clientId, userId: body.userId },
      'revoked_by_admin',
      { actor: actorFromRequest(request), logger: request.log },
    );
    return { ok: true, ended: ended.length };
  });

  fastify.get('/users/:username/native-grants', admin, async (request, reply) => {
    const params = parsed(UsernameParamSchema, request.params, reply);
    if (!params) return reply;
    const query = parsed(UserGrantsQuerySchema, request.query, reply);
    if (!query) return reply;
    const user = await findDirectoryUser(params.username);
    if (!user) return reply.code(404).send({ error: 'No such user', code: 'user_not_found' });
    return { grants: await listNativeGrants({ userId: user.userId, status: query.status }) };
  });
}
