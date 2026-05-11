/**
 * Unified plugin lifecycle management.
 *
 * Parameterized by data directory and mode filter so the same logic
 * serves both agent plugins and local plugins:
 *   - Agent plugins: dataDir = agentDataDir(label), mode = 'agent', cap = 20
 *   - Local plugins:  dataDir = localDir(),         mode = 'local', cap = 20
 *
 * All registry operations are serialized through a promise-chain mutex
 * to prevent concurrent modifications from racing.
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { RESERVED_API_PREFIXES, MAX_PLUGINS_PER_REGISTRY } from '../constants.js';
import type { PluginMode } from '../constants.js';
import { KeyedPromiseChainMutex, atomicWriteJSON } from '../file-helpers.js';
import { invalidatePluginHostCache } from '../plugin-host.js';
import {
  agentDataDir,
  agentPluginsFile,
  agentPluginsDir,
  localDir,
  localPluginsFile,
  localPluginsDir,
} from './platform.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PluginRegistryEntry {
  name: string;
  displayName?: string | undefined;
  packageName: string;
  version: string;
  description: string;
  capabilities: string[];
  packages: Record<string, string>;
  panel: Record<string, unknown>;
  modes: PluginMode[];
  config: Record<string, unknown>;
  status: 'enabled' | 'disabled';
  installedAt: string;
  enabledAt?: string | undefined;
  updatedAt?: string | undefined;
}

export interface PluginRegistry {
  plugins: PluginRegistryEntry[];
}

export interface PluginUpdateInfo {
  name: string;
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
}

/**
 * Configuration for a plugin lifecycle context.
 * Parameterizes the shared logic for agent vs. local modes.
 */
export interface PluginLifecycleConfig {
  /** Root data directory (agent data dir or local dir). */
  dataDir: string;
  /** Registry file path (e.g., agentPluginsFile(label) or localPluginsFile()). */
  registryPath: string;
  /** Plugin data directories root. */
  pluginsDir: string;
  /** Which plugin mode to validate against ('agent' or 'local'). */
  requiredMode: PluginMode;
  /** Maximum number of plugins allowed. */
  maxPlugins?: number | undefined;
}

// ---------------------------------------------------------------------------
// Shared manifest type (read from lamaste-plugin.json)
// ---------------------------------------------------------------------------

interface PluginManifest {
  name: string;
  displayName?: string;
  version: string;
  description?: string;
  capabilities?: string[] | { agent?: string[] };
  packages?: Record<string, string>;
  panel?: Record<string, unknown>;
  modes?: PluginMode[];
  config?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Promise-chain mutex (serializes registry modifications, keyed by registry path)
// ---------------------------------------------------------------------------

const registryMutexes = new KeyedPromiseChainMutex();

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return registryMutexes.run(key, fn);
}

// ---------------------------------------------------------------------------
// Reserved names (single source of truth from constants)
// ---------------------------------------------------------------------------

const RESERVED_NAMES: readonly string[] = RESERVED_API_PREFIXES;

// ---------------------------------------------------------------------------
// Error types for manifest failures
// ---------------------------------------------------------------------------

export class PluginManifestMissingError extends Error {
  constructor(packageName: string) {
    super(`No lamaste-plugin.json found in "${packageName}"`);
    this.name = 'PluginManifestMissingError';
  }
}

export class PluginManifestReadError extends Error {
  constructor(packageName: string, cause: unknown) {
    super(
      `Failed to read lamaste-plugin.json for "${packageName}": ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'PluginManifestReadError';
  }
}

export class PluginManifestParseError extends Error {
  constructor(manifestPath: string) {
    super(`Malformed JSON in plugin manifest at ${manifestPath}`);
    this.name = 'PluginManifestParseError';
  }
}

export class PluginManifestValidationError extends Error {
  constructor(packageName: string, detail: string) {
    super(`Invalid plugin manifest for "${packageName}": ${detail}`);
    this.name = 'PluginManifestValidationError';
  }
}

/**
 * Best-effort rollback of an npm install. Never throws — failures are silent
 * so callers can chain this into any error path without masking the original
 * error.
 */
async function safeUninstall(cwd: string, packageName: string): Promise<void> {
  try {
    const { execa } = await import('execa');
    await execa('npm', ['uninstall', packageName], { cwd });
  } catch {
    // Swallow — rollback is best-effort, original error must not be masked.
  }
}

// ---------------------------------------------------------------------------
// Package name validation
// ---------------------------------------------------------------------------

const PKG_NAME_REGEX = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;
const PLUGIN_NAME_REGEX = /^[a-z0-9-]+$/;

function validatePackageName(packageName: string): void {
  if (!packageName.startsWith('@lamalibre/')) {
    throw new Error('Only @lamalibre/ scoped packages are allowed');
  }
  const pkgName = packageName.slice('@lamalibre/'.length);
  if (!PKG_NAME_REGEX.test(pkgName)) {
    throw new Error('Invalid package name');
  }
}

// ---------------------------------------------------------------------------
// Normalize capabilities from manifest
// ---------------------------------------------------------------------------

function normalizeCapabilities(raw: string[] | { agent?: string[] } | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && Array.isArray(raw.agent)) return raw.agent;
  return [];
}

// ---------------------------------------------------------------------------
// Registry read/write
// ---------------------------------------------------------------------------

/**
 * Read a plugin registry from disk. Returns empty registry if file does not exist.
 * Accepts either the registry file path or a PluginLifecycleConfig; the latter is
 * the common caller shape (e.g. `agentPluginConfig(label)`), so we normalize here.
 */
export async function readPluginRegistry(
  source: string | PluginLifecycleConfig,
): Promise<PluginRegistry> {
  const registryPath = typeof source === 'string' ? source : source.registryPath;
  try {
    const raw = await readFile(registryPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PluginRegistry>;
    return Array.isArray(parsed.plugins) ? (parsed as PluginRegistry) : { plugins: [] };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { plugins: [] };
    }
    throw new Error(`Failed to read plugin registry: ${(err as Error).message}`);
  }
}

/** Write a plugin registry atomically (tmp -> fsync -> rename). */
export async function writePluginRegistry(
  registryPath: string,
  data: PluginRegistry,
): Promise<void> {
  await atomicWriteJSON(registryPath, data, {
    mkdirp: true,
    dirMode: 0o700,
    mode: 0o600,
  });
}

// ---------------------------------------------------------------------------
// Plugin lifecycle operations
// ---------------------------------------------------------------------------

/**
 * Install a plugin.
 *
 * - Validates package scope and name
 * - Enforces the registry cap
 * - Runs `npm install --ignore-scripts`
 * - Reads and validates the lamaste-plugin.json manifest
 * - Creates the plugin data directory
 * - Appends the entry to the registry
 */
export function installPlugin(
  cfg: PluginLifecycleConfig,
  packageName: string,
): Promise<PluginRegistryEntry> {
  return withLock(cfg.registryPath, async () => {
    validatePackageName(packageName);

    const registry = await readPluginRegistry(cfg.registryPath);
    if (registry.plugins.find((p) => p.packageName === packageName)) {
      throw new Error(`Plugin "${packageName}" is already installed`);
    }

    const maxPlugins = cfg.maxPlugins ?? MAX_PLUGINS_PER_REGISTRY;
    if (registry.plugins.length >= maxPlugins) {
      throw new Error(`Maximum of ${maxPlugins} plugins allowed`);
    }

    // Ensure data dir has a package.json so npm installs locally
    await mkdir(cfg.dataDir, { recursive: true, mode: 0o700 });
    const pkgJsonPath = path.join(cfg.dataDir, 'package.json');
    try {
      await readFile(pkgJsonPath, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await writeFile(pkgJsonPath, '{"private":true}\n', { encoding: 'utf-8', mode: 0o600 });
      }
    }

    // Install via npm
    const { execa } = await import('execa');
    await execa('npm', ['install', '--ignore-scripts', packageName], {
      cwd: cfg.dataDir,
      timeout: 120_000,
    });

    // Everything below must roll back `npm install` on failure.
    try {
      // --- Resolve manifest path ---
      const require = createRequire(path.join(cfg.dataDir, '/'));
      let manifestPath: string;
      try {
        manifestPath = require.resolve(`${packageName}/lamaste-plugin.json`);
      } catch {
        throw new PluginManifestMissingError(packageName);
      }

      // --- Read manifest file ---
      let manifestRaw: string;
      try {
        manifestRaw = await readFile(manifestPath, 'utf-8');
      } catch (err: unknown) {
        throw new PluginManifestReadError(packageName, err);
      }

      // --- Parse JSON ---
      let manifest: PluginManifest;
      try {
        manifest = JSON.parse(manifestRaw) as PluginManifest;
      } catch {
        throw new PluginManifestParseError(manifestPath);
      }

      // --- Validate plugin name ---
      if (typeof manifest.name !== 'string' || !PLUGIN_NAME_REGEX.test(manifest.name)) {
        throw new PluginManifestValidationError(packageName, `invalid plugin name: "${manifest.name}"`);
      }

      if (RESERVED_NAMES.includes(manifest.name)) {
        throw new PluginManifestValidationError(
          packageName,
          `plugin name "${manifest.name}" is reserved`,
        );
      }

      // Check for duplicate name (different package, same manifest name)
      if (registry.plugins.find((p) => p.name === manifest.name)) {
        throw new PluginManifestValidationError(
          packageName,
          `a plugin named "${manifest.name}" is already installed`,
        );
      }

      // Validate required mode support
      const modes = (manifest.modes ?? ['server', 'agent']) as PluginMode[];
      if (!modes.includes(cfg.requiredMode)) {
        throw new PluginManifestValidationError(
          packageName,
          `plugin "${manifest.name}" does not support ${cfg.requiredMode} mode`,
        );
      }

      // Create plugin data directory
      const pluginDir = path.join(cfg.pluginsDir, manifest.name);
      await mkdir(pluginDir, { recursive: true, mode: 0o700 });

      const entry: PluginRegistryEntry = {
        name: manifest.name,
        displayName: manifest.displayName,
        packageName,
        version: manifest.version,
        description: manifest.description ?? '',
        capabilities: normalizeCapabilities(manifest.capabilities),
        packages: manifest.packages ?? {},
        panel: manifest.panel ?? {},
        modes,
        config: manifest.config ?? {},
        status: 'disabled',
        installedAt: new Date().toISOString(),
      };

      registry.plugins.push(entry);
      await writePluginRegistry(cfg.registryPath, registry);
      invalidatePluginHostCache();
      return entry;
    } catch (err) {
      await safeUninstall(cfg.dataDir, packageName);
      throw err;
    }
  });
}

/**
 * Uninstall a plugin. Must be disabled first.
 */
export function uninstallPlugin(
  cfg: PluginLifecycleConfig,
  name: string,
): Promise<void> {
  return withLock(cfg.registryPath, async () => {
    const registry = await readPluginRegistry(cfg.registryPath);
    const index = registry.plugins.findIndex((p) => p.name === name);
    if (index === -1) {
      throw new Error(`Plugin "${name}" not found`);
    }

    const plugin = registry.plugins[index]!;
    if (plugin.status === 'enabled') {
      throw new Error(`Plugin "${name}" must be disabled before uninstalling`);
    }

    if (!plugin.packageName.startsWith('@lamalibre/')) {
      throw new Error('Registry corruption: invalid package scope');
    }

    // npm uninstall — propagate failures so callers can diagnose rather than
    // allowing the on-disk node_modules state to diverge from the registry.
    const { execa } = await import('execa');
    await execa('npm', ['uninstall', plugin.packageName], { cwd: cfg.dataDir });

    // Remove plugin data directory
    const pluginDir = path.join(cfg.pluginsDir, plugin.name);
    await rm(pluginDir, { recursive: true, force: true }).catch(() => {});

    registry.plugins.splice(index, 1);
    await writePluginRegistry(cfg.registryPath, registry);
    invalidatePluginHostCache();
  });
}

/**
 * Enable a plugin.
 */
export function enablePlugin(
  cfg: PluginLifecycleConfig,
  name: string,
): Promise<void> {
  return withLock(cfg.registryPath, async () => {
    const registry = await readPluginRegistry(cfg.registryPath);
    const plugin = registry.plugins.find((p) => p.name === name);
    if (!plugin) {
      throw new Error(`Plugin "${name}" not found`);
    }
    if (plugin.status === 'enabled') return;

    plugin.status = 'enabled';
    plugin.enabledAt = new Date().toISOString();
    await writePluginRegistry(cfg.registryPath, registry);
    invalidatePluginHostCache();
  });
}

/**
 * Disable a plugin.
 */
export function disablePlugin(
  cfg: PluginLifecycleConfig,
  name: string,
): Promise<void> {
  return withLock(cfg.registryPath, async () => {
    const registry = await readPluginRegistry(cfg.registryPath);
    const plugin = registry.plugins.find((p) => p.name === name);
    if (!plugin) {
      throw new Error(`Plugin "${name}" not found`);
    }
    if (plugin.status === 'disabled') return;

    plugin.status = 'disabled';
    delete plugin.enabledAt;
    await writePluginRegistry(cfg.registryPath, registry);
    invalidatePluginHostCache();
  });
}

/**
 * Update a plugin to the latest version.
 */
export function updatePlugin(
  cfg: PluginLifecycleConfig,
  nameOrPackage: string,
): Promise<PluginRegistryEntry> {
  return withLock(cfg.registryPath, async () => {
    const registry = await readPluginRegistry(cfg.registryPath);
    const plugin = registry.plugins.find(
      (p) => p.name === nameOrPackage || p.packageName === nameOrPackage,
    );

    if (!plugin) {
      throw new Error(`Plugin "${nameOrPackage}" not found`);
    }

    if (!plugin.packageName.startsWith('@lamalibre/')) {
      throw new Error('Registry corruption: invalid package scope');
    }

    const { execa } = await import('execa');
    await execa('npm', ['install', '--ignore-scripts', plugin.packageName], {
      cwd: cfg.dataDir,
      timeout: 120_000,
    });

    // Re-read manifest to capture the updated version
    try {
      const require = createRequire(path.join(cfg.dataDir, '/'));
      const manifestPath = require.resolve(`${plugin.packageName}/lamaste-plugin.json`);
      const manifestRaw = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestRaw) as PluginManifest;
      plugin.version = manifest.version ?? plugin.version;
      if (manifest.capabilities) plugin.capabilities = normalizeCapabilities(manifest.capabilities);
      if (manifest.panel) plugin.panel = manifest.panel;
      if (manifest.packages) plugin.packages = manifest.packages;
      if (manifest.description) plugin.description = manifest.description;
      if (manifest.displayName) plugin.displayName = manifest.displayName;
    } catch {
      // Manifest may not exist — keep existing metadata
    }

    plugin.updatedAt = new Date().toISOString();
    await writePluginRegistry(cfg.registryPath, registry);
    return plugin;
  });
}

/**
 * Check if an update is available for a plugin.
 */
export async function checkPluginUpdate(
  cfg: PluginLifecycleConfig,
  name: string,
): Promise<PluginUpdateInfo> {
  const registry = await readPluginRegistry(cfg.registryPath);
  const plugin = registry.plugins.find((p) => p.name === name);
  if (!plugin) {
    throw new Error(`Plugin "${name}" not found`);
  }

  const pkg = plugin.packageName;
  if (!pkg || !pkg.startsWith('@lamalibre/')) {
    throw new Error('Invalid package scope');
  }

  const { execa } = await import('execa');
  const { stdout } = await execa('npm', ['view', pkg, 'version', '--json'], {
    cwd: cfg.dataDir,
  });

  const latestVersion = JSON.parse(stdout.trim()) as string;
  const currentVersion = plugin.version;

  return {
    name,
    currentVersion,
    latestVersion,
    hasUpdate: latestVersion !== currentVersion,
  };
}

/**
 * Read a plugin's panel.js bundle from the installed package.
 */
export async function readPluginBundle(
  cfg: PluginLifecycleConfig,
  name: string,
): Promise<string> {
  const registry = await readPluginRegistry(cfg.registryPath);
  const plugin = registry.plugins.find((p) => p.name === name);
  if (!plugin) {
    throw new Error(`Plugin "${name}" not found`);
  }

  const serverPkg = plugin.packages['server'];
  if (!serverPkg) {
    throw new Error(`Plugin "${name}" has no server package with panel bundle`);
  }

  // Defense-in-depth: verify scope in case registry was tampered
  if (!serverPkg.startsWith('@lamalibre/')) {
    throw new Error('Server package scope violation');
  }

  const require = createRequire(path.join(cfg.dataDir, '/'));
  const panelPath = require.resolve(`${serverPkg}/panel.js`);
  return readFile(panelPath, 'utf-8');
}

// ---------------------------------------------------------------------------
// Convenience factories for agent and local modes
// ---------------------------------------------------------------------------

/**
 * Create a PluginLifecycleConfig for agent plugins.
 */
export function agentPluginConfig(label: string): PluginLifecycleConfig {
  return {
    dataDir: agentDataDir(label),
    registryPath: agentPluginsFile(label),
    pluginsDir: agentPluginsDir(label),
    requiredMode: 'agent',
    maxPlugins: MAX_PLUGINS_PER_REGISTRY,
  };
}

/**
 * Create a PluginLifecycleConfig for local plugins.
 */
export function localPluginConfig(): PluginLifecycleConfig {
  return {
    dataDir: localDir(),
    registryPath: localPluginsFile(),
    pluginsDir: localPluginsDir(),
    requiredMode: 'local',
    maxPlugins: MAX_PLUGINS_PER_REGISTRY,
  };
}
