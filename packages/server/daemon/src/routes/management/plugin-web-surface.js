/**
 * A plugin's web surface (slice 7): the site it owns, where the relay
 * serves the shell its server package ships beside its user surface's API.
 * Admin only. Business logic lives in `lib/web-surface.js`.
 *
 *   GET    /plugins/:name/web-surface        what the installed version declares, the
 *                                            site, whether it is served, the trees, the offer
 *   POST   /plugins/:name/web-surface        { subdomain?, accessMode? } — create the site
 *   POST   /plugins/:name/web-surface/move   { tunnelId } — take over the bound tunnel's host
 *   DELETE /plugins/:name/web-surface        delete the site and its trees
 */

import { z } from 'zod';
import { WEB_SURFACE_ACCESS_MODES } from '@lamalibre/lamaste';
import { actorFromRequest } from '../../lib/actor.js';
import { findPlugin } from '../../lib/plugins.js';
import {
  createWebSurface,
  deleteWebSurface,
  moveWebSurfaceFromTunnel,
  webSurfaceStatus,
} from '../../lib/web-surface.js';

const PluginNameParamSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Plugin name must contain only lowercase letters, numbers, and hyphens'),
});

const CreateBodySchema = z
  .object({
    subdomain: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'subdomain is a DNS label')
      .optional(),
    accessMode: z.enum(WEB_SURFACE_ACCESS_MODES).optional(),
  })
  .strict();

const MoveBodySchema = z.object({ tunnelId: z.string().min(1).max(64) }).strict();

/** The refusal a library threw (its `statusCode`, message and `code`), or a 500. */
function sendFailure(request, reply, err, fallback) {
  if (Number.isInteger(err.statusCode) && err.statusCode < 500) {
    return reply
      .code(err.statusCode)
      .send({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  request.log.error(err, fallback);
  return reply
    .code(Number.isInteger(err.statusCode) ? err.statusCode : 500)
    .send({ error: fallback, details: err.message });
}

/** The installed plugin's route, or null having answered 404. */
async function routeOf(request, reply) {
  const { name } = PluginNameParamSchema.parse(request.params);
  const plugin = await findPlugin(name);
  if (!plugin?.route) {
    reply.code(404).send({ error: `Plugin "${name}" not found` });
    return null;
  }
  return plugin.route;
}

export default async function pluginWebSurfaceRoutes(fastify, _opts) {
  fastify.get(
    '/plugins/:name/web-surface',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const route = await routeOf(request, reply);
      if (!route) return reply;
      try {
        return { webSurface: await webSurfaceStatus(route) };
      } catch (err) {
        return sendFailure(request, reply, err, 'Failed to read the web surface');
      }
    },
  );

  fastify.post(
    '/plugins/:name/web-surface',
    {
      preHandler: fastify.requireRole(['admin']),
      // Issues a certificate and reloads nginx.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const route = await routeOf(request, reply);
      if (!route) return reply;
      const body = CreateBodySchema.parse(request.body ?? {});
      try {
        const webSurface = await createWebSurface(route, body, {
          actor: actorFromRequest(request),
          logger: request.log,
        });
        return reply.code(201).send({ webSurface });
      } catch (err) {
        return sendFailure(request, reply, err, 'Failed to create the web surface');
      }
    },
  );

  fastify.post(
    '/plugins/:name/web-surface/move',
    {
      preHandler: fastify.requireRole(['admin']),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const route = await routeOf(request, reply);
      if (!route) return reply;
      const { tunnelId } = MoveBodySchema.parse(request.body);
      try {
        return {
          webSurface: await moveWebSurfaceFromTunnel(route, tunnelId, {
            actor: actorFromRequest(request),
            logger: request.log,
          }),
        };
      } catch (err) {
        return sendFailure(
          request,
          reply,
          err,
          'Failed to move the user surface to the web surface',
        );
      }
    },
  );

  fastify.delete(
    '/plugins/:name/web-surface',
    {
      preHandler: fastify.requireRole(['admin']),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const route = await routeOf(request, reply);
      if (!route) return reply;
      try {
        return await deleteWebSurface(route, {
          actor: actorFromRequest(request),
          logger: request.log,
        });
      } catch (err) {
        return sendFailure(request, reply, err, 'Failed to delete the web surface');
      }
    },
  );
}
