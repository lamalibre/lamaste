import { readPlugins } from '../lib/plugins.js';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { managementOnly } from '../middleware/onboarding-guard.js';

const STATE_DIR = process.env.PORTLAMA_STATE_DIR || '/etc/portlama';
const PLUGINS_DIR = `${STATE_DIR}/plugins`;

/**
 * Dynamic plugin route mounting.
 *
 * On startup, reads enabled plugins from plugins.json and for each plugin
 * that has a `packages.server` entry, loads the package via `createRequire`
 * and mounts its routes under `/api/<pluginName>/`.
 *
 * Plugin routes are protected by the managementOnly guard (503 before
 * onboarding completes) and default to admin-only access.
 *
 * Disabled plugins get a preHandler returning 503 since Fastify cannot
 * remove routes at runtime — clean state requires a restart.
 */
export default async function pluginRouter(fastify, _opts) {
  // Block all plugin routes until onboarding is complete
  fastify.addHook('onRequest', managementOnly());

  const registry = await readPlugins();

  for (const plugin of registry.plugins) {
    const pluginName = plugin.name;

    if (plugin.status !== 'enabled') {
      // Register a catch-all 503 handler for disabled plugins that were
      // previously enabled (routes mounted on a prior boot)
      continue;
    }

    // Mount server-side routes if the plugin declares a server package
    if (plugin.packages?.server) {
      // Defense-in-depth: verify scope at load time in case registry was tampered
      if (!plugin.packages.server.startsWith('@lamalibre/')) {
        fastify.log.error({ plugin: pluginName }, 'Plugin server package scope violation — skipping');
        continue;
      }

      try {
        const require = createRequire(`${STATE_DIR}/`);
        const serverModule = require(plugin.packages.server);
        const pluginFn = serverModule.default || serverModule;

        if (typeof pluginFn === 'function') {
          // Two-level encapsulation: auth guard on outer scope (plugin cannot override),
          // plugin code on inner scope (isolated from the auth hook)
          await fastify.register(async function authScope(outer) {
            outer.addHook('onRequest', fastify.requireRole(['admin']));
            await outer.register(async function pluginScope(inner) {
              await inner.register(pluginFn, {
                pluginDir: `${PLUGINS_DIR}/${pluginName}/`,
                logger: fastify.log,
              });
            });
          }, { prefix: `/${pluginName}` });
          fastify.log.info({ plugin: pluginName }, 'Plugin server routes mounted');
        }
      } catch (err) {
        fastify.log.error(
          { plugin: pluginName, err: err.message },
          'Failed to mount plugin server routes',
        );
      }
    }

    // Serve the plugin panel bundle if available
    if (plugin.packages?.server) {
      fastify.get(`/${pluginName}/panel.js`, {
        preHandler: fastify.requireRole(['admin']),
      }, async (request, reply) => {
        try {
          // Defense-in-depth: verify scope at serve time in case registry was tampered
          if (!plugin.packages.server.startsWith('@lamalibre/')) {
            return reply.code(403).send({ error: 'Plugin server package scope violation' });
          }
          const require = createRequire(`${STATE_DIR}/`);
          const panelPath = require.resolve(`${plugin.packages.server}/panel.js`);
          const content = await readFile(panelPath, 'utf-8');
          return reply
            .header('Content-Type', 'application/javascript')
            .header('Cache-Control', 'public, max-age=3600')
            .send(content);
        } catch {
          return reply.code(404).send({ error: 'Plugin panel bundle not found' });
        }
      });
    }
  }

  // Cache disabled-plugin set with a short TTL to avoid disk I/O on every request
  let cachedDisabledPlugins = new Set();
  let cacheExpiry = 0;
  const CACHE_TTL_MS = 5000;

  async function getDisabledPlugins() {
    const now = Date.now();
    if (now < cacheExpiry) return cachedDisabledPlugins;

    const currentRegistry = await readPlugins();
    cachedDisabledPlugins = new Set(
      currentRegistry.plugins
        .filter((p) => p.status !== 'enabled')
        .map((p) => p.name),
    );
    cacheExpiry = now + CACHE_TTL_MS;
    return cachedDisabledPlugins;
  }

  // Register a catch-all for any plugin routes targeting disabled plugins.
  // This handles the case where a plugin was enabled, routes were mounted,
  // then the plugin was disabled without a restart.
  fastify.addHook('onRequest', async (request, reply) => {
    // Only intercept /api/<pluginName>/... routes
    const match = request.url.match(/^\/api\/([a-z0-9-]+)(\/|$)/);
    if (!match) return;

    const pluginName = match[1];

    // Skip known non-plugin prefixes
    const reservedPrefixes = [
      'health', 'onboarding', 'invite', 'tunnels', 'sites', 'system',
      'services', 'logs', 'users', 'certs', 'invitations', 'plugins',
    ];
    if (reservedPrefixes.includes(pluginName)) return;

    const disabled = await getDisabledPlugins();
    if (disabled.has(pluginName)) {
      return reply.code(503).send({
        error: `Plugin "${pluginName}" is disabled`,
      });
    }
  });
}
