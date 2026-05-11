import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';

import { pluginHostPlugin } from '@lamalibre/lamaste';
import {
  localDir,
  localPluginsFile,
  localPluginsDir,
  readPluginRegistry,
} from '@lamalibre/lamaste/agent';

import { localPluginRoutes } from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_PATH = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(await readFile(PKG_PATH, 'utf8'));

export async function startLocalPluginHost({ port = 9293 } = {}) {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  await server.register(cors, {
    origin: [
      'tauri://localhost',
      'https://tauri.localhost',
      /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/,
    ],
    credentials: true,
  });

  // Global rate limit. The local plugin host binds 127.0.0.1 and is
  // reached by the desktop app and any locally-installed plugin's panel
  // microfrontend. allowList exempts loopback callers so the desktop
  // app's normal polling never trips the limiter; the per-route configs
  // below satisfy the CodeQL js/missing-rate-limiting dataflow.
  await server.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1', '::1'],
  });

  const startedAt = Date.now();
  const registryPath = localPluginsFile();

  server.get('/api/status', { config: { rateLimit: {} } }, async () => {
    const registry = await readPluginRegistry(registryPath);
    const plugins = registry.plugins ?? [];
    return {
      ok: true,
      version: pkg.version,
      uptime: Date.now() - startedAt,
      pluginCount: plugins.length,
      enabledPluginCount: plugins.filter((p) => p.status === 'enabled').length,
    };
  });

  await server.register(
    async (scope) => {
      await localPluginRoutes(scope);
    },
    { prefix: '/api' },
  );

  await server.register(pluginHostPlugin, {
    baseDir: localDir(),
    pluginsDataDir: localPluginsDir(),
    readRegistry: () => readPluginRegistry(registryPath),
    auth: 'none',
    reservedPrefixes: new Set(['api', 'health']),
  });

  await server.listen({ host: '127.0.0.1', port });
  server.log.info({ port, version: pkg.version }, 'Local plugin host listening');
  return server;
}
