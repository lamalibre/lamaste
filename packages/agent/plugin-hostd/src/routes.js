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

  fastify.get('/local-plugins', async () => {
    return readPluginRegistry(cfg.registryPath);
  });

  fastify.post('/local-plugins/install', async (request, reply) => {
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
  });

  fastify.post('/local-plugins/:name/enable', async (request, reply) => {
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
  });

  fastify.post('/local-plugins/:name/disable', async (request, reply) => {
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
  });

  fastify.delete('/local-plugins/:name', async (request, reply) => {
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
  });

  fastify.post('/local-plugins/:name/update', async (request, reply) => {
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
  });

  fastify.get('/local-plugins/:name/check-update', async (request, reply) => {
    const { name } = request.params;
    if (!PLUGIN_NAME_RE.test(name)) {
      return reply.code(400).send({ error: 'Invalid plugin name' });
    }
    try {
      return await checkPluginUpdate(cfg, name);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  fastify.get('/local-plugins/:name/bundle', async (request, reply) => {
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
  });
}
