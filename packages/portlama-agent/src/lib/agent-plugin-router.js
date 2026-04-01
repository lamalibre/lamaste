/**
 * Agent plugin router — mounts enabled plugin server routes and serves
 * panel bundles on the agent panel server.
 *
 * Registered as a Fastify plugin under '/api/plugins' prefix in panel-server.js.
 * mTLS validation is handled by the parent panel server (panel-server.js),
 * so no additional auth guard is needed here.
 *
 * Combines patterns from:
 * - plugin-router.js (server-side two-level encapsulation)
 * - local-plugin-host.js (CJS/ESM plugin loading)
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readAgentPluginRegistry } from './agent-plugins.js';
import { agentDataDir, agentPluginsDir } from './platform.js';

// Reserved prefixes that are never plugin route names.
const RESERVED_PREFIXES = new Set(['install']);

/**
 * Fastify plugin that mounts agent plugin routes and panel bundles.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ label: string }} opts
 */
export default async function agentPluginRouter(fastify, { label }) {
  const registry = await readAgentPluginRegistry(label);
  const dir = agentDataDir(label);
  const pluginsDir = agentPluginsDir(label);

  for (const plugin of registry.plugins) {
    if (plugin.status !== 'enabled') continue;

    const pluginName = plugin.name;

    if (plugin.packages?.server) {
      // Defense-in-depth: verify scope at load time
      if (!plugin.packages.server.startsWith('@lamalibre/')) {
        fastify.log.error(
          { plugin: pluginName },
          'Plugin server package scope violation — skipping',
        );
        continue;
      }

      try {
        const require = createRequire(path.join(dir, '/'));
        const modulePath = require.resolve(plugin.packages.server);
        let serverModule;
        try {
          // Try require first (CJS packages)
          serverModule = require(plugin.packages.server);
        } catch {
          // Fall back to dynamic import (ESM packages)
          serverModule = await import(modulePath);
        }

        // Resolve the Fastify plugin function from the module.
        let pluginFn = serverModule.default || serverModule;
        if (typeof pluginFn !== 'function' && typeof serverModule.buildPlugin === 'function') {
          pluginFn = serverModule.buildPlugin();
        }

        if (typeof pluginFn === 'function') {
          const pluginDir = path.join(pluginsDir, pluginName) + '/';

          // Two-level encapsulation: outer scope isolates the plugin code from
          // the router's hooks, preventing plugins from overriding auth or
          // adding hooks above their encapsulation boundary.
          await fastify.register(async function pluginScope(outer) {
            await outer.register(pluginFn, {
              pluginDir,
              logger: fastify.log,
            });
          }, { prefix: `/${pluginName}` });
          fastify.log.info({ plugin: pluginName }, 'Agent plugin routes mounted');
        }
      } catch (err) {
        fastify.log.error(
          { plugin: pluginName, err: err.message },
          'Failed to mount agent plugin routes',
        );
      }
    }

    // Serve plugin panel bundle
    if (plugin.packages?.server) {
      const serverPkg = plugin.packages.server;
      fastify.get(`/${pluginName}/panel.js`, async (_request, reply) => {
        try {
          if (!serverPkg.startsWith('@lamalibre/')) {
            return reply.code(403).send({ error: 'Plugin server package scope violation' });
          }
          const require = createRequire(path.join(dir, '/'));
          const panelPath = require.resolve(`${serverPkg}/panel.js`);
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

  // --- Disabled plugin catch-all ---

  let cachedDisabledPlugins = new Set();
  let cacheExpiry = 0;

  async function getDisabledPlugins() {
    const now = Date.now();
    if (now < cacheExpiry) return cachedDisabledPlugins;

    const currentRegistry = await readAgentPluginRegistry(label);
    cachedDisabledPlugins = new Set(
      currentRegistry.plugins.filter((p) => p.status !== 'enabled').map((p) => p.name),
    );
    cacheExpiry = now + 5000;
    return cachedDisabledPlugins;
  }

  fastify.addHook('onRequest', async (request, reply) => {
    // Match /<pluginName>/... under the /api/plugins prefix
    const match = request.url.match(/^\/([a-z0-9-]+)(\/|$)/);
    if (!match) return;

    const name = match[1];
    if (RESERVED_PREFIXES.has(name)) return;

    const disabled = await getDisabledPlugins();
    if (disabled.has(name)) {
      return reply.code(503).send({ error: `Plugin "${name}" is disabled` });
    }
  });
}
