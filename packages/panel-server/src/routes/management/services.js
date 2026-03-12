import { z } from 'zod';
import {
  ALLOWED_SERVICES,
  getAllServiceStatuses,
  isAllowedService,
  isAllowedAction,
  executeServiceAction,
} from '../../lib/services.js';

const ServiceActionParamsSchema = z.object({
  name: z.string().refine((v) => ALLOWED_SERVICES.includes(v), {
    message: 'Unknown service',
  }),
  action: z.enum(['start', 'stop', 'restart', 'reload']),
});

export default async function servicesRoutes(fastify, _opts) {
  fastify.get('/services', {
    preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'services:read' }),
  }, async (_request, _reply) => {
    const services = await getAllServiceStatuses();
    return { services };
  });

  fastify.post('/services/:name/:action', {
    preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'services:write' }),
  }, async (request, reply) => {
    const { name, action } = request.params;

    // Validate service name
    if (!isAllowedService(name)) {
      return reply.code(400).send({ error: 'Unknown service' });
    }

    // Validate action
    if (!isAllowedAction(action)) {
      return reply.code(400).send({ error: 'Invalid action' });
    }

    // Parse for Zod validation (will throw ZodError caught by error handler)
    ServiceActionParamsSchema.parse({ name, action });

    try {
      const result = await executeServiceAction(name, action);
      return result;
    } catch (err) {
      const statusCode = err.statusCode || 500;
      const body = { error: err.message };
      if (err.details) {
        body.details = err.details;
      }
      return reply.code(statusCode).send(body);
    }
  });
}
