import { z } from 'zod';
import {
  registerStorageServer,
  removeStorageServer,
  listStorageServers,
  bindPluginStorage,
  unbindPluginStorage,
  listBindings,
  getBinding,
} from '../../lib/storage.js';
import { readPlugins } from '../../lib/plugins.js';

// --- Zod schemas ---

const RegisterServerSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(100),
  provider: z.string().min(1).max(50),
  region: z.string().min(1).max(50),
  bucket: z.string().min(1).max(200),
  endpoint: z.string().url(),
  accessKey: z.string().min(1).max(500),
  secretKey: z.string().min(1).max(500),
});

const ServerIdParamSchema = z.object({
  id: z.string().uuid(),
});

const BindingBodySchema = z.object({
  pluginName: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Plugin name must contain only lowercase letters, numbers, and hyphens'),
  storageServerId: z.string().uuid(),
});

const PluginNameParamSchema = z.object({
  pluginName: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Plugin name must contain only lowercase letters, numbers, and hyphens'),
});

export default async function storageRoutes(fastify, _opts) {
  // ===========================================================================
  // Storage server routes
  // ===========================================================================

  // POST /storage/servers — register a storage server
  fastify.post(
    '/storage/servers',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const body = RegisterServerSchema.parse(request.body);

      try {
        const entry = await registerStorageServer(body);
        return reply.code(201).send(entry);
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({
          error: err.message || 'Failed to register storage server',
        });
      }
    },
  );

  // GET /storage/servers — list registered storage servers
  fastify.get(
    '/storage/servers',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (_request, _reply) => {
      const servers = await listStorageServers();
      return { servers };
    },
  );

  // DELETE /storage/servers/:id — remove storage server and bindings
  fastify.delete(
    '/storage/servers/:id',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = ServerIdParamSchema.parse(request.params);

      try {
        const result = await removeStorageServer(params.id);
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({
          error: err.message || 'Failed to remove storage server',
        });
      }
    },
  );

  // ===========================================================================
  // Storage binding routes
  // ===========================================================================

  // POST /storage/bindings — bind storage to plugin
  fastify.post(
    '/storage/bindings',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const body = BindingBodySchema.parse(request.body);

      // Validate plugin exists in registry
      const registry = await readPlugins();
      const pluginExists = registry.plugins.some((p) => p.name === body.pluginName);
      if (!pluginExists) {
        return reply.code(404).send({
          error: `Plugin "${body.pluginName}" not found in registry`,
        });
      }

      try {
        const binding = await bindPluginStorage(body.pluginName, body.storageServerId);
        return reply.code(201).send(binding);
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({
          error: err.message || 'Failed to bind storage to plugin',
        });
      }
    },
  );

  // GET /storage/bindings — list all bindings
  fastify.get(
    '/storage/bindings',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (_request, _reply) => {
      const bindings = await listBindings();
      return { bindings };
    },
  );

  // GET /storage/bindings/:pluginName — get binding for a specific plugin
  fastify.get(
    '/storage/bindings/:pluginName',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);

      const binding = await getBinding(params.pluginName);
      if (!binding) {
        return reply.code(404).send({
          error: `No storage binding for plugin "${params.pluginName}"`,
        });
      }

      return binding;
    },
  );

  // DELETE /storage/bindings/:pluginName — unbind storage from plugin
  fastify.delete(
    '/storage/bindings/:pluginName',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);

      try {
        const result = await unbindPluginStorage(params.pluginName);
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({
          error: err.message || 'Failed to unbind storage from plugin',
        });
      }
    },
  );
}
