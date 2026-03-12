import { getSystemStats } from '../../lib/system-stats.js';

export default async function systemRoutes(fastify, _opts) {
  fastify.get('/system/stats', {
    preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'system:read' }),
  }, async (request, reply) => {
    try {
      const stats = await getSystemStats(request.log);
      return stats;
    } catch {
      return reply.code(500).send({ error: 'Failed to retrieve system stats' });
    }
  });
}
