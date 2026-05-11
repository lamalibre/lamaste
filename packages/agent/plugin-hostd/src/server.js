import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import cors from '@fastify/cors';

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

  const startedAt = Date.now();
  const registryPath = localPluginsFile();

  server.get('/api/status', async () => {
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
