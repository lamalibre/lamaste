/**
 * Server-side plugin lifecycle — install, uninstall, enable, disable, update.
 *
 * Operates on the server state directory (default `/etc/lamalibre/lamaste/`).
 * All functions are pure: they accept config/paths as parameters.
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { z } from 'zod';
import {
  RESERVED_API_PREFIXES,
  RESERVED_NAV_LABELS,
  derivePluginRoute,
} from '../constants.js';
import { PromiseChainMutex, atomicWriteJSON } from '../file-helpers.js';
import { invalidatePluginHostCache } from '../plugin-host.js';
import { ManifestSchema as SharedManifestSchema } from '../schemas.js';
import { revokePluginCapabilitiesFromAgents } from './mtls.js';
export { ManifestSchema } from '../schemas.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A validated plugin manifest. */
export interface PluginManifest {
  readonly name: string;
  readonly displayName?: string | undefined;
  readonly version: string;
  readonly description: string;
  readonly capabilities: string[];
  readonly packages: {
    readonly server?: string | undefined;
    readonly agent?: string | undefined;
  };
  readonly panel:
    | { readonly label?: string; readonly icon?: string; readonly route?: string }
    | {
        readonly pages: ReadonlyArray<{
          readonly path: string;
          readonly title: string;
          readonly icon?: string;
          readonly description?: string;
        }>;
        readonly apiPrefix?: string;
      };
  readonly config: Record<
    string,
    {
      readonly type: 'string' | 'number' | 'boolean';
      readonly default?: string | number | boolean;
      readonly description?: string;
      readonly enum?: ReadonlyArray<string | number>;
    }
  >;
  readonly modes: ReadonlyArray<'server' | 'agent' | 'local'>;
}

/** A single plugin entry in the registry. */
export interface PluginEntry extends PluginManifest {
  readonly packageName: string;
  readonly status: 'enabled' | 'disabled';
  readonly installedAt: string;
  readonly enabledAt?: string | undefined;
}

/** The full plugin registry on disk. */
export interface PluginRegistry {
  plugins: PluginEntry[];
}

/** Logger interface expected by plugin operations. */
export interface PluginLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

/** Abstraction for running shell commands (e.g. npm install). */
export interface ExecFn {
  (file: string, args: string[], options?: { cwd?: string; timeout?: number }): Promise<{
    stdout: string;
    stderr: string;
  }>;
}

// ---------------------------------------------------------------------------
// Zod Schemas — single source of truth lives in src/schemas.ts. The duplicate
// definitions formerly in this file have been removed; ManifestSchema is
// re-exported above so callers that imported from this module keep working.
// ---------------------------------------------------------------------------

// (No local schema body — see ../schemas.ts for the canonical definition.)

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

export class PluginError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'ALREADY_INSTALLED'
      | 'NOT_FOUND'
      | 'MUST_DISABLE_FIRST'
      | 'INVALID_SCOPE'
      | 'INVALID_MANIFEST'
      | 'MANIFEST_NOT_FOUND'
      | 'RESERVED_NAME'
      | 'RESERVED_LABEL'
      | 'INVALID_API_PREFIX'
      | 'INSTALL_FAILED',
  ) {
    super(message);
    this.name = 'PluginError';
  }
}

// ---------------------------------------------------------------------------
// Promise-chain mutex
// ---------------------------------------------------------------------------

const pluginMutex = new PromiseChainMutex();

function withPluginLock<T>(fn: () => Promise<T>): Promise<T> {
  return pluginMutex.run(fn);
}

/**
 * Best-effort rollback of an npm install. Never throws — failures are logged
 * but do not mask the original error that triggered the rollback.
 */
async function safeUninstall(
  exec: ExecFn,
  stateDir: string,
  packageName: string,
  logger: PluginLogger,
): Promise<void> {
  try {
    await exec('npm', ['uninstall', packageName], { cwd: stateDir });
  } catch (err: unknown) {
    logger.warn(
      { packageName, err: err instanceof Error ? err.message : String(err) },
      'Rollback npm uninstall failed',
    );
  }
}

// ---------------------------------------------------------------------------
// Registry persistence
// ---------------------------------------------------------------------------

function pluginsPath(stateDir: string): string {
  return path.join(stateDir, 'plugins.json');
}

/**
 * Read the plugin registry from disk.
 * Returns `{ plugins: [] }` if the file does not exist.
 */
export async function readPlugins(stateDir: string): Promise<PluginRegistry> {
  try {
    const raw = await readFile(pluginsPath(stateDir), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('plugins' in parsed) ||
      !Array.isArray((parsed as PluginRegistry).plugins)
    ) {
      return { plugins: [] };
    }
    return parsed as PluginRegistry;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { plugins: [] };
    }
    throw new Error(
      `Failed to read plugin registry: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Write the plugin registry to disk atomically.
 */
export async function writePlugins(stateDir: string, data: PluginRegistry): Promise<void> {
  await atomicWriteJSON(pluginsPath(stateDir), data, { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

/**
 * Validate a raw plugin manifest against the canonical schema.
 *
 * @throws {z.ZodError} if validation fails
 */
export function validateManifest(raw: unknown): PluginManifest {
  return SharedManifestSchema.parse(raw) as PluginManifest;
}

// ---------------------------------------------------------------------------
// Plugin lifecycle
// ---------------------------------------------------------------------------

export interface InstallPluginOptions {
  /** npm package name (must start with `@lamalibre/`) */
  packageName: string;
  /** Absolute path to the state directory */
  stateDir: string;
  /** Shell command executor (e.g. wrapping execa) */
  exec: ExecFn;
  logger: PluginLogger;
}

/**
 * Install a plugin by npm package name.
 * Only `@lamalibre/` scoped packages are allowed.
 */
export function installPlugin(opts: InstallPluginOptions): Promise<PluginEntry> {
  const { packageName, stateDir, exec, logger } = opts;

  return withPluginLock(async () => {
    // Validate package scope
    if (!packageName.startsWith('@lamalibre/')) {
      throw new PluginError('Only @lamalibre/ scoped packages are allowed', 'INVALID_SCOPE');
    }

    // Check if already installed
    const registry = await readPlugins(stateDir);
    const existing = registry.plugins.find((p) => p.packageName === packageName);
    if (existing) {
      throw new PluginError(
        `Plugin "${packageName}" is already installed`,
        'ALREADY_INSTALLED',
      );
    }

    // Ensure stateDir has a package.json so npm does not walk up the tree
    const statePackageJson = path.join(stateDir, 'package.json');
    try {
      await readFile(statePackageJson, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await writeFile(statePackageJson, '{"private":true}\n', {
          encoding: 'utf-8',
          mode: 0o600,
        });
      }
    }

    // Install the npm package
    logger.info({ packageName }, 'Installing plugin package');
    try {
      await exec('npm', ['install', '--ignore-scripts', packageName], {
        cwd: stateDir,
        timeout: 120000,
      });
    } catch (err: unknown) {
      const stderr = err instanceof Error && 'stderr' in err ? (err as { stderr: string }).stderr : '';
      logger.error(
        { packageName, stderr, err: err instanceof Error ? err.message : String(err) },
        'npm install failed',
      );
      throw new PluginError(`Failed to install "${packageName}"`, 'INSTALL_FAILED');
    }

    // Everything below must roll back `npm install` on failure.
    try {
      // --- Resolve manifest path ---
      const require = createRequire(`${stateDir}/`);
      let manifestPath: string;
      try {
        manifestPath = require.resolve(`${packageName}/lamaste-plugin.json`);
      } catch {
        throw new PluginError(
          `Plugin manifest not found in "${packageName}"`,
          'MANIFEST_NOT_FOUND',
        );
      }

      // --- Read manifest file ---
      let manifestRaw: string;
      try {
        manifestRaw = await readFile(manifestPath, 'utf-8');
      } catch (err: unknown) {
        throw new PluginError(
          `Failed to read plugin manifest at ${manifestPath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          'MANIFEST_NOT_FOUND',
        );
      }

      // --- Parse JSON ---
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(manifestRaw);
      } catch {
        throw new PluginError(
          `Malformed JSON in plugin manifest at ${manifestPath}`,
          'INVALID_MANIFEST',
        );
      }

      // --- Validate schema ---
      let manifest: PluginManifest;
      try {
        manifest = validateManifest(parsedJson);
      } catch (err: unknown) {
        if (err instanceof z.ZodError) {
          throw new PluginError(
            `Invalid plugin manifest: ${err.errors.map((e) => e.message).join(', ')}`,
            'INVALID_MANIFEST',
          );
        }
        throw err;
      }

      // Reject names that collide with core API route prefixes
      if ((RESERVED_API_PREFIXES as readonly string[]).includes(manifest.name)) {
        throw new PluginError(`Plugin name "${manifest.name}" is reserved`, 'RESERVED_NAME');
      }

      // Reject displayName that matches reserved navigation labels
      if (manifest.displayName) {
        if (
          (RESERVED_NAV_LABELS as readonly string[]).includes(
            manifest.displayName.toLowerCase(),
          )
        ) {
          throw new PluginError(
            `Plugin display name "${manifest.displayName}" conflicts with a core navigation label`,
            'RESERVED_LABEL',
          );
        }
      }

      // Validate apiPrefix matches plugin name if specified
      const panel = manifest.panel as Record<string, unknown>;
      if (panel?.apiPrefix && panel.apiPrefix !== `/api/${manifest.name}`) {
        throw new PluginError(
          `Plugin apiPrefix must be "/api/${manifest.name}" but got "${String(panel.apiPrefix)}"`,
          'INVALID_API_PREFIX',
        );
      }

      // Create the plugin state directory
      const pluginsDir = path.join(stateDir, 'plugins');
      const pluginDir = path.join(pluginsDir, manifest.name);
      await mkdir(pluginDir, { recursive: true, mode: 0o700 });

      // Add to registry
      const entry: PluginEntry = {
        ...manifest,
        packageName,
        status: 'disabled',
        installedAt: new Date().toISOString(),
      };

      registry.plugins.push(entry);
      await writePlugins(stateDir, registry);
      invalidatePluginHostCache();

      logger.info({ name: manifest.name, packageName }, 'Plugin installed');
      return entry;
    } catch (err) {
      await safeUninstall(exec, stateDir, packageName, logger);
      throw err;
    }
  });
}

export interface UninstallPluginOptions {
  name: string;
  stateDir: string;
  exec: ExecFn;
  logger: PluginLogger;
  /**
   * PKI directory used by the agent registry. When provided, the uninstall
   * flow will sweep the plugin's capabilities off every agent's stored
   * capability set so that re-installing the plugin later does NOT silently
   * re-grant them. The route used for the sweep is derived from
   * `manifest.name` via {@link derivePluginRoute}.
   *
   * Optional only because some non-server lifecycles share this module's
   * type without owning a PKI directory; production server installs (the
   * daemon at `packages/server/daemon`) always pass it.
   */
  pkiDir?: string;
}

/**
 * Uninstall a plugin. Must be disabled first.
 */
export function uninstallPlugin(opts: UninstallPluginOptions): Promise<{ ok: true; name: string }> {
  const { name, stateDir, exec, logger, pkiDir } = opts;

  return withPluginLock(async () => {
    const registry = await readPlugins(stateDir);
    const index = registry.plugins.findIndex((p) => p.name === name);

    if (index === -1) {
      throw new PluginError(`Plugin "${name}" not found`, 'NOT_FOUND');
    }

    const plugin = registry.plugins[index]!;

    if (plugin.status === 'enabled') {
      throw new PluginError(
        `Plugin "${name}" must be disabled before uninstalling`,
        'MUST_DISABLE_FIRST',
      );
    }

    // Uninstall the npm package — propagate failures so callers can diagnose
    // rather than allowing node_modules state to diverge from the registry.
    logger.info({ name, packageName: plugin.packageName }, 'Uninstalling plugin package');
    await exec('npm', ['uninstall', plugin.packageName], { cwd: stateDir });

    // Remove the plugin state directory
    const pluginDir = path.join(stateDir, 'plugins', name);
    await rm(pluginDir, { recursive: true, force: true }).catch((err: unknown) => {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Failed to remove plugin state directory',
      );
    });

    // Remove from registry
    registry.plugins.splice(index, 1);
    await writePlugins(stateDir, registry);
    invalidatePluginHostCache();

    // Sweep plugin capabilities off every agent so re-installing the plugin
    // later does not silently re-grant. Failure here is non-fatal — the
    // plugin's npm package is already gone — but logged loudly.
    if (pkiDir) {
      try {
        const route = derivePluginRoute(plugin.name);
        const diffs = await revokePluginCapabilitiesFromAgents(pkiDir, route);
        if (diffs.length > 0) {
          logger.info(
            { name, route, diffs },
            'Revoked plugin capabilities from agents on uninstall',
          );
        }
      } catch (err: unknown) {
        logger.warn(
          {
            name,
            err: err instanceof Error ? err.message : String(err),
          },
          'Failed to sweep plugin capabilities from agent registry on uninstall',
        );
      }
    }

    logger.info({ name }, 'Plugin uninstalled');
    return { ok: true as const, name };
  });
}

export interface TogglePluginOptions {
  name: string;
  stateDir: string;
  logger?: PluginLogger | undefined;
}

/**
 * Enable a plugin.
 */
export function enablePlugin(
  opts: TogglePluginOptions,
): Promise<{ ok: true; name: string; status: 'enabled' }> {
  const { name, stateDir, logger } = opts;

  return withPluginLock(async () => {
    const registry = await readPlugins(stateDir);
    const plugin = registry.plugins.find((p) => p.name === name);

    if (!plugin) {
      throw new PluginError(`Plugin "${name}" not found`, 'NOT_FOUND');
    }

    if (plugin.status === 'enabled') {
      return { ok: true as const, name, status: 'enabled' as const };
    }

    // Use type assertion since PluginEntry has readonly status but we need to mutate
    (plugin as { status: string }).status = 'enabled';
    (plugin as { enabledAt?: string }).enabledAt = new Date().toISOString();
    await writePlugins(stateDir, registry);
    invalidatePluginHostCache();

    logger?.info({ name }, 'Plugin enabled');
    return { ok: true as const, name, status: 'enabled' as const };
  });
}

/**
 * Disable a plugin.
 */
export function disablePlugin(
  opts: TogglePluginOptions,
): Promise<{ ok: true; name: string; status: 'disabled' }> {
  const { name, stateDir, logger } = opts;

  return withPluginLock(async () => {
    const registry = await readPlugins(stateDir);
    const plugin = registry.plugins.find((p) => p.name === name);

    if (!plugin) {
      throw new PluginError(`Plugin "${name}" not found`, 'NOT_FOUND');
    }

    if (plugin.status === 'disabled') {
      return { ok: true as const, name, status: 'disabled' as const };
    }

    (plugin as { status: string }).status = 'disabled';
    delete (plugin as { enabledAt?: string }).enabledAt;
    await writePlugins(stateDir, registry);
    invalidatePluginHostCache();

    logger?.info({ name }, 'Plugin disabled');
    return { ok: true as const, name, status: 'disabled' as const };
  });
}

/**
 * Get all enabled plugins.
 */
export async function getEnabledPlugins(stateDir: string): Promise<PluginEntry[]> {
  const registry = await readPlugins(stateDir);
  return registry.plugins.filter((p) => p.status === 'enabled');
}

/**
 * Get capabilities contributed by all enabled plugins.
 */
export async function getPluginCapabilities(stateDir: string): Promise<string[]> {
  const registry = await readPlugins(stateDir);
  const caps: string[] = [];
  for (const plugin of registry.plugins) {
    if (plugin.status === 'enabled' && Array.isArray(plugin.capabilities)) {
      caps.push(...plugin.capabilities);
    }
  }
  return [...new Set(caps)];
}
