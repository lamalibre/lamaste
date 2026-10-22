/**
 * The user directory (slice 6), admin only:
 *
 *   GET  /identity/directory                 every user the directory knows —
 *                                            tombstones and erased ones too — with
 *                                            the plugins whose agent half has not
 *                                            yet acknowledged an erasure
 *   POST /identity/directory/:userId/erase   erase a removed user
 *
 * Business logic lives in `lib/directory.js` and `lib/identity-sync.js`.
 */

import { z } from 'zod';
import { IDENTITY_UUID_REGEX } from '@lamalibre/lamaste';
import { actorFromRequest } from '../../lib/actor.js';
import {
  eraseDirectoryUser,
  getDirectoryId,
  listDirectoryUsers,
  listErasures,
} from '../../lib/directory.js';
import { pendingErasuresByUser } from '../../lib/identity-sync.js';

const UserIdParamSchema = z.object({
  userId: z.string().regex(IDENTITY_UUID_REGEX, 'userId is a directory user id'),
});

export default async function identityDirectoryRoutes(fastify, _opts) {
  fastify.get('/identity/directory', { preHandler: fastify.requireRole(['admin']) }, async () => {
    const [directoryId, users, erasures, pending] = await Promise.all([
      getDirectoryId(),
      listDirectoryUsers(),
      listErasures(),
      pendingErasuresByUser(),
    ]);
    return {
      directoryId,
      users: users.map((user) => ({
        ...user,
        erasure: erasures.get(user.userId) ?? null,
        pendingErasures: pending.get(user.userId) ?? [],
      })),
    };
  });

  fastify.post(
    '/identity/directory/:userId/erase',
    {
      preHandler: fastify.requireRole(['admin']),
      // Moderate tier, as deleting a user: destructive, and it calls Gatekeeper.
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { userId } = UserIdParamSchema.parse(request.params);
      try {
        const erased = await eraseDirectoryUser(userId, {
          actor: actorFromRequest(request),
          logger: request.log,
        });
        return { ok: true, ...erased };
      } catch (err) {
        if (Number.isInteger(err.statusCode)) {
          return reply
            .code(err.statusCode)
            .send({ error: err.message, ...(err.code ? { code: err.code } : {}) });
        }
        request.log.error(err, 'Failed to erase the user');
        return reply.code(500).send({ error: 'Failed to erase the user' });
      }
    },
  );
}
