import {
  localPluginConfig,
  readPluginRegistry,
  installPlugin,
  enablePlugin,
  disablePlugin,
  uninstallPlugin,
  updatePlugin,
  checkPluginUpdate,
  readPluginBundle,
} from '@lamalibre/lamaste/agent';
import { invalidatePluginHostCache } from '@lamalibre/lamaste';

const PLUGIN_NAME_RE = /^[a-z0-9-]+$/;

export async function localPluginRoutes(fastify) {
  const cfg = localPluginConfig();

  // Per-route rateLimit configs opt these routes into the host's
  // globally-registered @fastify/rate-limit instance. Empty `{}` inherits
  // the global cap (100/min, loopback-allowlisted); writes are tiered to
  // moderate (30/min) because plugin lifecycle mutations are heavier.
  fastify.get('/local-plugins', { config: { rateLimit: {} } }, async () => {
    return readPluginRegistry(cfg.registryPath);
  });

  fastify.post(
    '/local-plugins/install',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const name = request.body?.name;
      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'name is required' });
      }
      try {
        const entry = await installPlugin(cfg, name);
        invalidatePluginHostCache();
        request.log.info({ name }, 'Local plugin installed');
        return { ok: true, plugin: entry };
      } catch (err) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  fastify.post(
    '/local-plugins/:name/enable',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { name } = request.params;
      if (!PLUGIN_NAME_RE.test(name)) {
        return reply.code(400).send({ error: 'Invalid plugin name' });
      }
      try {
        await enablePlugin(cfg, name);
        invalidatePluginHostCache();
        request.log.info({ name }, 'Local plugin enabled');
        return { ok: true, name, status: 'enabled' };
      } catch (err) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  fastify.post(
    '/local-plugins/:name/disable',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { name } = request.params;
      if (!PLUGIN_NAME_RE.test(name)) {
        return reply.code(400).send({ error: 'Invalid plugin name' });
      }
      try {
        await disablePlugin(cfg, name);
        invalidatePluginHostCache();
        request.log.info({ name }, 'Local plugin disabled');
        return { ok: true, name, status: 'disabled' };
      } catch (err) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  fastify.delete(
    '/local-plugins/:name',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { name } = request.params;
      if (!PLUGIN_NAME_RE.test(name)) {
        return reply.code(400).send({ error: 'Invalid plugin name' });
      }
      try {
        await uninstallPlugin(cfg, name);
        invalidatePluginHostCache();
        request.log.info({ name }, 'Local plugin uninstalled');
        return { ok: true, name };
      } catch (err) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  fastify.post(
    '/local-plugins/:name/update',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { name } = request.params;
      if (!PLUGIN_NAME_RE.test(name)) {
        return reply.code(400).send({ error: 'Invalid plugin name' });
      }
      try {
        const plugin = await updatePlugin(cfg, name);
        invalidatePluginHostCache();
        request.log.info({ name }, 'Local plugin updated');
        return { ok: true, plugin };
      } catch (err) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  fastify.get(
    '/local-plugins/:name/check-update',
    { config: { rateLimit: {} } },
    async (request, reply) => {
      const { name } = request.params;
      if (!PLUGIN_NAME_RE.test(name)) {
        return reply.code(400).send({ error: 'Invalid plugin name' });
      }
      try {
        return await checkPluginUpdate(cfg, name);
      } catch (err) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  fastify.get(
    '/local-plugins/:name/bundle',
    { config: { rateLimit: {} } },
    async (request, reply) => {
      const { name } = request.params;
      if (!PLUGIN_NAME_RE.test(name)) {
        return reply.code(400).send({ error: 'Invalid plugin name' });
      }
      try {
        const source = await readPluginBundle(cfg, name);
        return { source };
      } catch (err) {
        return reply.code(404).send({ error: err.message });
      }
    },
  );
}
