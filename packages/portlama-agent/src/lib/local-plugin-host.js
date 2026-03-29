/**
 * Local plugin host — a lightweight Fastify server that mounts enabled
 * plugin server routes and serves plugin panel bundles.
 *
 * Binds to 127.0.0.1 only. No mTLS — localhost trust boundary.
 * Managed as a launchd (macOS) / systemd (Linux) user-level service.
 */

import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import {
  readLocalPluginRegistry,
  installLocalPlugin,
  uninstallLocalPlugin,
  enableLocalPlugin,
  disableLocalPlugin,
} from './local-plugins.js';
import { localDir, localPluginsDir } from './platform.js';

// Reserved names — requests for these prefixes are never plugin routes.
const RESERVED_PREFIXES = new Set(['health', 'plugins']);

// Allowed Host header values to prevent DNS rebinding attacks.
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * Generate or read the host auth token.
 * Stored at ~/.portlama/local/host-token with 0600 permissions.
 * @returns {Promise<string>}
 */
async function getOrCreateHostToken() {
  const tokenPath = path.join(localDir(), 'host-token');
  try {
    const token = await readFile(tokenPath, 'utf-8');
    if (token.trim().length >= 32) return token.trim();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const token = crypto.randomBytes(32).toString('hex');
  await mkdir(localDir(), { recursive: true, mode: 0o700 });
  await writeFile(tokenPath, token + '\n', { encoding: 'utf-8', mode: 0o600 });
  return token;
}

/**
 * Start the local plugin host Fastify server.
 * @param {{ port?: number }} options
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function startLocalPluginHost({ port = 9293 } = {}) {
  const server = Fastify({
    logger: { level: 'info' },
  });

  const hostToken = await getOrCreateHostToken();

  await server.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // --- DNS rebinding protection ---
  // Reject requests where Host header is not localhost/127.0.0.1
  server.addHook('onRequest', async (request, reply) => {
    const host = (request.headers.host || '').replace(/:\d+$/, '');
    if (!ALLOWED_HOSTS.has(host)) {
      return reply.code(403).send({ error: 'Forbidden: invalid Host header' });
    }
  });

  // --- Bearer token auth for management endpoints ---
  // Health endpoint is exempt (used for status checks).
  server.addHook('onRequest', async (request, reply) => {
    if (request.url === '/api/health') return;
    // Plugin panel bundles and plugin routes also require auth
    const auth = request.headers.authorization || '';
    if (auth !== `Bearer ${hostToken}`) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // --- Management API routes ---

  // Health endpoint — no auth required, used for status probing
  server.get('/api/health', async () => ({ status: 'ok' }));

  server.get('/api/plugins', async () => {
    return readLocalPluginRegistry();
  });

  server.post('/api/plugins/install', async (request, reply) => {
    const { packageName } = request.body || {};
    if (!packageName || typeof packageName !== 'string') {
      return reply.code(400).send({ error: 'packageName is required' });
    }
    try {
      const entry = await installLocalPlugin(packageName);
      return { ok: true, plugin: entry };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  server.post('/api/plugins/:name/enable', async (request, reply) => {
    try {
      await enableLocalPlugin(request.params.name);
      return { ok: true, name: request.params.name, status: 'enabled' };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  server.post('/api/plugins/:name/disable', async (request, reply) => {
    try {
      await disableLocalPlugin(request.params.name);
      return { ok: true, name: request.params.name, status: 'disabled' };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  server.delete('/api/plugins/:name', async (request, reply) => {
    try {
      await uninstallLocalPlugin(request.params.name);
      return { ok: true, name: request.params.name };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // --- Mount enabled plugin server routes ---

  const registry = await readLocalPluginRegistry();

  for (const plugin of registry.plugins) {
    if (plugin.status !== 'enabled') continue;

    const pluginName = plugin.name;

    if (plugin.packages?.server) {
      // Defense-in-depth: verify scope at load time
      if (!plugin.packages.server.startsWith('@lamalibre/')) {
        server.log.error(
          { plugin: pluginName },
          'Plugin server package scope violation — skipping',
        );
        continue;
      }

      try {
        const require = createRequire(path.join(localDir(), '/'));
        const serverModule = require(plugin.packages.server);
        const pluginFn = serverModule.default || serverModule;

        if (typeof pluginFn === 'function') {
          const pluginDir = path.join(localPluginsDir(), pluginName) + '/';

          // No auth guard needed — localhost only
          await server.register(pluginFn, {
            prefix: `/${pluginName}`,
            pluginDir,
            logger: server.log,
          });
          server.log.info({ plugin: pluginName }, 'Plugin server routes mounted');
        }
      } catch (err) {
        server.log.error(
          { plugin: pluginName, err: err.message },
          'Failed to mount plugin server routes',
        );
      }
    }

    // Serve plugin panel bundle
    if (plugin.packages?.server) {
      server.get(`/${pluginName}/panel.js`, async (_request, reply) => {
        try {
          if (!plugin.packages.server.startsWith('@lamalibre/')) {
            return reply.code(403).send({ error: 'Plugin server package scope violation' });
          }
          const require = createRequire(path.join(localDir(), '/'));
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

  // --- Disabled plugin catch-all ---

  let cachedDisabledPlugins = new Set();
  let cacheExpiry = 0;

  async function getDisabledPlugins() {
    const now = Date.now();
    if (now < cacheExpiry) return cachedDisabledPlugins;

    const currentRegistry = await readLocalPluginRegistry();
    cachedDisabledPlugins = new Set(
      currentRegistry.plugins.filter((p) => p.status !== 'enabled').map((p) => p.name),
    );
    cacheExpiry = now + 5000;
    return cachedDisabledPlugins;
  }

  server.addHook('onRequest', async (request, reply) => {
    const match = request.url.match(/^\/([a-z0-9-]+)(\/|$)/);
    if (!match) return;

    const name = match[1];
    if (RESERVED_PREFIXES.has(name) || name === 'api') return;

    const disabled = await getDisabledPlugins();
    if (disabled.has(name)) {
      return reply.code(503).send({ error: `Plugin "${name}" is disabled` });
    }
  });

  // --- Start ---

  await server.listen({ port, host: '127.0.0.1' });
  server.log.info(`Local plugin host listening on http://127.0.0.1:${port}`);

  return server;
}
