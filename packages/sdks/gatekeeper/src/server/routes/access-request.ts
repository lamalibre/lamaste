import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { buildAccessRequestPage } from '../../lib/templates.js';

/**
 * Standalone access-request page route.
 * Used as a fallback when the inline 403 body approach isn't available.
 */
export async function accessRequestRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/access-request',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tunnel = (request.query as Record<string, string>).tunnel ?? 'unknown';
      const username = (request.headers['remote-user'] as string) ?? 'unknown';

      const html = buildAccessRequestPage(
        username,
        tunnel,
        {
          adminContact: fastify.getSettings().adminEmail,
          adminName: fastify.getSettings().adminName,
        },
      );

      return reply.type('text/html; charset=utf-8').send(html);
    },
  );
}
