import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { removeUserPrincipal } from '../../lib/principals.js';

/** A username as grants and group members hold it. */
const UserParamSchema = z.object({ username: z.string().min(1).max(100) }).strict();

export async function principalRoutes(fastify: FastifyInstance): Promise<void> {
  // DELETE /api/principals/user/:username — remove a user principal
  // everywhere: every grant naming the username (any resource type) and its
  // membership of every group, in one transaction. The panel calls it when
  // it deletes a user, and before it creates one whose username an earlier
  // user held, so a reused username inherits nothing.
  fastify.delete(
    '/principals/user/:username',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = UserParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'username is 1-100 characters' });
      }
      try {
        const removed = await removeUserPrincipal(parsed.data.username);
        return { ok: true, ...removed };
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    },
  );
}
