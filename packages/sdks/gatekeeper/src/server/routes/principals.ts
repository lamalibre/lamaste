import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { removeUserPrincipal } from '../../lib/principals.js';

/** A username as grants and group members hold it — in the body, never in a URL. */
const RemoveUserBodySchema = z.object({ username: z.string().min(1).max(100) }).strict();

export async function principalRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/principals/user/remove { username } — remove a user principal
  // everywhere: every grant naming the username (any resource type) and its
  // membership of every group, in one transaction. The panel calls it when
  // a user is removed, and before it creates one whose username an earlier
  // user held, so a reused username inherits nothing. The username travels
  // in the body: a URL is what request logs keep.
  fastify.post('/principals/user/remove', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = RemoveUserBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'The body is { username } (1-100 characters)' });
    }
    try {
      const removed = await removeUserPrincipal(parsed.data.username);
      return { ok: true, ...removed };
    } catch (err) {
      request.log.error({ err: (err as Error).message }, 'Removing a user principal failed');
      return reply.code(500).send({ error: 'Removing the user principal failed' });
    }
  });
}
