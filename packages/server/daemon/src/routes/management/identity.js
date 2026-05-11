import { z } from 'zod';
import { readUsers } from '../../lib/authelia.js';

const UsernameParamSchema = z.object({
  username: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_.-]+$/),
});

/**
 * Extract a single string value from a header that may be string, string[], or undefined.
 *
 * @param {string | string[] | undefined} value
 * @returns {string | undefined}
 */
function headerValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function identityRoutes(fastify, _opts) {
  // GET /api/identity/self — Returns caller's identity from Authelia headers.
  // Only meaningful behind an Authelia-protected vhost. On the mTLS panel vhost,
  // nginx strips Remote-* headers so this will return 400.
  fastify.get(
    '/identity/self',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const user = headerValue(request.headers['remote-user']);
      if (!user) {
        return reply.code(400).send({
          error:
            'Identity headers not present — this endpoint requires an Authelia-protected vhost',
        });
      }

      const groupsRaw = headerValue(request.headers['remote-groups']) || '';
      const groups = groupsRaw
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean);
      const name = headerValue(request.headers['remote-name']) || '';
      const email = headerValue(request.headers['remote-email']) || '';

      return { username: user, displayName: name, email, groups };
    },
  );

  // GET /api/identity/users — List Authelia users
  fastify.get(
    '/identity/users',
    { preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'identity:query' }) },
    async (request, reply) => {
      try {
        const users = await readUsers();
        return { users };
      } catch (err) {
        request.log.error({ err }, 'Failed to read Authelia users');
        return reply.code(500).send({ error: 'Failed to read users' });
      }
    },
  );

  // GET /api/identity/users/:username — Single user metadata
  fastify.get(
    '/identity/users/:username',
    { preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'identity:query' }) },
    async (request, reply) => {
      const { username } = UsernameParamSchema.parse(request.params);
      try {
        const users = await readUsers();
        const user = users.find((u) => u.username === username);
        if (!user) {
          return reply.code(404).send({ error: 'User not found' });
        }
        return { user };
      } catch (err) {
        request.log.error({ err }, 'Failed to read Authelia users');
        return reply.code(500).send({ error: 'Failed to read users' });
      }
    },
  );

  // GET /api/identity/groups — List all groups
  fastify.get(
    '/identity/groups',
    { preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'identity:query' }) },
    async (request, reply) => {
      try {
        const users = await readUsers();
        /** @type {Set<string>} */
        const groupSet = new Set();
        for (const u of users) {
          for (const g of u.groups) {
            groupSet.add(g);
          }
        }
        return { groups: [...groupSet].sort() };
      } catch (err) {
        request.log.error({ err }, 'Failed to read Authelia users');
        return reply.code(500).send({ error: 'Failed to read groups' });
      }
    },
  );
}
