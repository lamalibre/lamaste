/**
 * Unified Fastify plugin for mounting plugin server routes, serving panel
 * bundles, and handling disabled-plugin 503 responses.
 *
 * Extracted and unified from the three implementations:
 * - serverd/src/routes/plugin-router.js        (server mode)
 * - lamaste-agent/src/lib/agent-plugin-router.js   (agent mode)
 * - lamaste-agent/src/lib/local-plugin-host.js     (local mode)
 *
 * The plugin host is configurable per deployment via `PluginHostOptions`.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  DISABLED_PLUGIN_CACHE_TTL_MS,
  PANEL_BUNDLE_CACHE_SECONDS,
  RESERVED_API_PREFIXES,
} from './constants.js';
import type { PluginRegistry, PluginRegistryEntry } from './types.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Auth strategy that the plugin host uses to protect routes.
 *
 * - `'none'`    — no auth guard (local plugin host, localhost only)
 * - `'mtls'`    — decorates an outer Fastify scope with a role guard hook
 * - `'inherit'` — parent Fastify instance already enforces auth (agent panel)
 */
export type PluginHostAuthStrategy = 'none' | 'mtls' | 'inherit';

/**
 * Configuration for the unified plugin host.
 */
export interface PluginHostOptions {
  /**
   * Base directory that contains `node_modules/` for installed plugins.
   * Used with `createRequire` to resolve plugin packages.
   */
  baseDir: string;

  /**
   * Base directory for per-plugin data directories.
   * Each plugin gets `${pluginsDataDir}/<pluginName>/`.
   */
  pluginsDataDir: string;

  /**
   * Read the current plugin registry from disk.
   * The host does NOT own the registry — it only reads it.
   */
  readRegistry: () => Promise<PluginRegistry>;

  /**
   * Auth strategy for plugin routes.
   * @default 'inherit'
   */
  auth?: PluginHostAuthStrategy;

  /**
   * When `auth` is `'mtls'`, this hook is registered on the outer scope
   * of each plugin's route encapsulation.
   * Signature matches Fastify's `onRequest` hook.
   */
  authHook?: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

  /**
   * Alternative to {@link authHook}. Called once per mounted plugin with the
   * plugin's manifest `name`; the returned hook is used for that plugin's
   * routes. Enables per-plugin auth decisions without widening the single
   * static hook shared across all plugins. If both are provided,
   * `authHookFactory` wins.
   */
  authHookFactory?: (
    pluginName: string,
  ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

  /**
   * Optional callback to resolve additional options passed to each plugin
   * when it is registered (e.g., storage config on the server).
   */
  resolvePluginOptions?: (
    plugin: PluginRegistryEntry,
    logger: FastifyInstance['log'],
  ) => Promise<Record<string, unknown>>;

  /**
   * Set of route prefixes that are never plugin names at the level where
   * the disabled-plugin catch-all hook operates.
   *
   * For the server plugin-router this is `RESERVED_API_PREFIXES`.
   * For the agent plugin-router this is `['install']`.
   * For the local plugin host this is `['health', 'plugins', 'api']`.
   *
   * @default RESERVED_API_PREFIXES
   */
  reservedPrefixes?: ReadonlySet<string> | readonly string[];

  /**
   * Regex pattern used to extract the plugin name from the request URL
   * in the disabled-plugin catch-all hook.
   *
   * Must capture the plugin name in group 1.
   *
   * @default /^\/([a-z0-9-]+)(\/|$)/
   */
  pluginNamePattern?: RegExp;
}

// ---------------------------------------------------------------------------
// Disabled-plugin cache invalidation
// ---------------------------------------------------------------------------

/**
 * Registered invalidation callbacks — one per live pluginHostPlugin
 * registration. Called when plugin lifecycle operations (enable/disable/
 * uninstall) mutate the registry so the 503 catch-all does not serve stale
 * data for up to DISABLED_PLUGIN_CACHE_TTL_MS after the change.
 */
const invalidators = new Set<() => void>();

/**
 * Clear the disabled-plugin cache across all registered plugin hosts in this
 * process. Invoked by plugin lifecycle mutations (enable/disable/uninstall)
 * so the next request re-reads the registry immediately.
 */
export function invalidatePluginHostCache(): void {
  for (const fn of invalidators) fn();
}

// ---------------------------------------------------------------------------
// Fastify plugin
// ---------------------------------------------------------------------------

/**
 * Unified Fastify plugin that mounts enabled plugin routes, serves panel
 * bundles, and returns 503 for disabled plugins.
 *
 * Register on the appropriate Fastify scope — it respects encapsulation.
 */
export async function pluginHostPlugin(
  fastify: FastifyInstance,
  opts: PluginHostOptions,
): Promise<void> {
  const {
    baseDir,
    pluginsDataDir,
    readRegistry,
    auth = 'inherit',
    authHook,
    authHookFactory,
    resolvePluginOptions,
    reservedPrefixes = RESERVED_API_PREFIXES,
    pluginNamePattern = /^\/([a-z0-9-]+)(\/|$)/,
  } = opts;

  const reservedSet =
    reservedPrefixes instanceof Set
      ? (reservedPrefixes as ReadonlySet<string>)
      : new Set(reservedPrefixes);

  const registry = await readRegistry();

  for (const plugin of registry.plugins) {
    if (plugin.status !== 'enabled') continue;

    const pluginName = plugin.name;
    const serverPkg = plugin.packages?.server;

    // --- Mount server-side routes ---
    if (serverPkg) {
      if (!serverPkg.startsWith('@lamalibre/')) {
        fastify.log.error(
          { plugin: pluginName },
          'Plugin server package scope violation — skipping',
        );
        continue;
      }

      try {
        const pluginFn = await loadPluginModule(baseDir, serverPkg);

        if (typeof pluginFn === 'function') {
          const pluginDir = path.join(pluginsDataDir, pluginName) + '/';

          // Resolve optional extra options (e.g. storage config)
          let extraOpts: Record<string, unknown> = {};
          if (resolvePluginOptions) {
            try {
              extraOpts = await resolvePluginOptions(plugin, fastify.log);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              fastify.log.warn(
                { plugin: pluginName, err: msg },
                'Failed to resolve extra plugin options — mounting without them',
              );
            }
          }

          const registerOpts = {
            pluginDir,
            logger: fastify.log,
            ...extraOpts,
          };

          const effectiveAuthHook = authHookFactory
            ? authHookFactory(pluginName)
            : authHook;

          if (auth === 'mtls' && effectiveAuthHook) {
            // Two-level encapsulation: auth guard on outer scope
            await fastify.register(
              async function authScope(outer: FastifyInstance) {
                outer.addHook('onRequest', effectiveAuthHook);
                await outer.register(async function pluginScope(inner: FastifyInstance) {
                  await inner.register(pluginFn, registerOpts);
                });
              },
              { prefix: `/${pluginName}` },
            );
          } else if (auth === 'inherit') {
            // Parent already enforces auth — single encapsulation level
            await fastify.register(
              async function pluginScope(scope: FastifyInstance) {
                await scope.register(pluginFn, registerOpts);
              },
              { prefix: `/${pluginName}` },
            );
          } else {
            // 'none' — no auth guard
            await fastify.register(pluginFn, {
              prefix: `/${pluginName}`,
              ...registerOpts,
            });
          }

          fastify.log.info({ plugin: pluginName }, 'Plugin server routes mounted');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(
          { plugin: pluginName, err: msg },
          'Failed to mount plugin server routes',
        );
      }
    }

    // --- Serve panel bundle ---
    if (serverPkg) {
      const capturedServerPkg = serverPkg;
      fastify.get(`/${pluginName}/panel.js`, async (_request: FastifyRequest, reply: FastifyReply) => {
        try {
          if (!capturedServerPkg.startsWith('@lamalibre/')) {
            return reply.code(403).send({ error: 'Plugin server package scope violation' });
          }
          const require = createRequire(path.join(baseDir, '/'));
          const panelPath = require.resolve(`${capturedServerPkg}/panel.js`);
          const content = await readFile(panelPath, 'utf-8');
          return reply
            .header('Content-Type', 'application/javascript')
            .header('Cache-Control', `public, max-age=${PANEL_BUNDLE_CACHE_SECONDS}`)
            .send(content);
        } catch {
          return reply.code(404).send({ error: 'Plugin panel bundle not found' });
        }
      });
    }
  }

  // --- Disabled plugin catch-all ---
  let cachedDisabledPlugins = new Set<string>();
  let cacheExpiry = 0;

  const invalidate = (): void => {
    cacheExpiry = 0;
    cachedDisabledPlugins = new Set<string>();
  };
  invalidators.add(invalidate);
  fastify.addHook('onClose', async () => {
    invalidators.delete(invalidate);
  });

  async function getDisabledPlugins(): Promise<Set<string>> {
    const now = Date.now();
    if (now < cacheExpiry) return cachedDisabledPlugins;

    const currentRegistry = await readRegistry();
    cachedDisabledPlugins = new Set(
      currentRegistry.plugins
        .filter((p) => p.status !== 'enabled')
        .map((p) => p.name),
    );
    cacheExpiry = now + DISABLED_PLUGIN_CACHE_TTL_MS;
    return cachedDisabledPlugins;
  }

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const match = request.url.match(pluginNamePattern);
    if (!match?.[1]) return;

    const name = match[1];
    if (reservedSet.has(name)) return;

    const disabled = await getDisabledPlugins();
    if (disabled.has(name)) {
      return reply.code(503).send({ error: `Plugin "${name}" is disabled` });
    }
  });
}

// ---------------------------------------------------------------------------
// Module loader
// ---------------------------------------------------------------------------

/**
 * Load a plugin's Fastify module from the installed package.
 *
 * Tries CJS require first, falls back to ESM dynamic import.
 * Resolves factory patterns (`buildPlugin()`) and default exports.
 *
 * @returns The resolved Fastify plugin function, or `undefined` if not loadable.
 */
async function loadPluginModule(
  baseDir: string,
  serverPkg: string,
): Promise<((...args: unknown[]) => unknown) | undefined> {
  const require = createRequire(path.join(baseDir, '/'));
  const modulePath = require.resolve(serverPkg);

  let serverModule: Record<string, unknown>;
  try {
    serverModule = require(serverPkg) as Record<string, unknown>;
  } catch {
    serverModule = (await import(modulePath)) as Record<string, unknown>;
  }

  let pluginFn = (serverModule['default'] ?? serverModule) as unknown;

  if (
    typeof pluginFn !== 'function' &&
    typeof serverModule['buildPlugin'] === 'function'
  ) {
    pluginFn = (serverModule['buildPlugin'] as () => unknown)();
  }

  return typeof pluginFn === 'function'
    ? (pluginFn as (...args: unknown[]) => unknown)
    : undefined;
}
