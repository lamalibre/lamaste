import { getConfig } from '../../lib/config.js';

export default async function statusRoute(fastify, _opts) {
  fastify.get('/status', async (_request, _reply) => {
    const config = getConfig();
    return {
      status: config.onboarding.status,
      domain: config.domain ?? null,
      ip: config.ip,
    };
  });
}
