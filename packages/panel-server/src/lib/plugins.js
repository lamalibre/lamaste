import { readFile, writeFile, rename, open, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { z } from 'zod';
import { execa } from 'execa';

const STATE_DIR = process.env.PORTLAMA_STATE_DIR || '/etc/portlama';
const PLUGINS_DIR = path.join(STATE_DIR, 'plugins');

// Promise-chain mutex to serialize plugin registry modifications
let pluginLock = Promise.resolve();
function withPluginLock(fn) {
  const prev = pluginLock;
  let resolve;
  pluginLock = new Promise((r) => {
    resolve = r;
  });
  return prev.then(fn).finally(resolve);
}

// --- Plugin manifest schema ---

const ManifestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Plugin name must contain only lowercase letters, numbers, and hyphens'),
  version: z.string().min(1).max(50),
  description: z.string().max(500).optional().default(''),
  capabilities: z
    .array(
      z
        .string()
        .min(1)
        .max(100)
        .regex(
          /^[a-z0-9-]+:[a-z0-9-]+$/,
          'Capabilities must follow the format "scope:action" (lowercase, hyphens allowed)',
        ),
    )
    .optional()
    .default([]),
  packages: z
    .object({
      server: z.string().min(1).regex(/^@lamalibre\//, 'Server package must be in the @lamalibre/ scope').optional(),
      agent: z.string().min(1).regex(/^@lamalibre\//, 'Agent package must be in the @lamalibre/ scope').optional(),
    })
    .optional()
    .default({}),
  panel: z
    .object({
      label: z.string().min(1).max(100).optional(),
      icon: z.string().max(50).optional(),
      route: z.string().max(200).optional(),
    })
    .optional()
    .default({}),
});

// --- Plugin registry persistence ---

function pluginsPath() {
  return path.join(STATE_DIR, 'plugins.json');
}

/**
 * Read the plugin registry from disk.
 * Returns `{ plugins: [] }` if the file does not exist.
 */
export async function readPlugins() {
  try {
    const raw = await readFile(pluginsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.plugins)) {
      return { plugins: [] };
    }
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { plugins: [] };
    }
    throw new Error(`Failed to read plugin registry: ${err.message}`);
  }
}

/**
 * Write the plugin registry to disk atomically.
 */
export async function writePlugins(data) {
  const filePath = pluginsPath();
  const tmpPath = `${filePath}.tmp`;

  const content = JSON.stringify(data, null, 2) + '\n';
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });

  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();

  await rename(tmpPath, filePath);
}

/**
 * Validate a raw plugin manifest against the schema.
 *
 * @param {object} raw - The raw manifest object
 * @returns {object} The validated and parsed manifest
 * @throws {z.ZodError} If validation fails
 */
export function validateManifest(raw) {
  return ManifestSchema.parse(raw);
}

/**
 * Install a plugin by npm package name.
 * Only @lamalibre/ scoped packages are allowed.
 *
 * @param {string} packageName - The npm package name (must start with @lamalibre/)
 * @param {import('pino').Logger} logger
 * @returns {Promise<object>} The installed plugin entry
 */
export function installPlugin(packageName, logger) {
  return withPluginLock(async () => {
    // Validate package scope
    if (!packageName.startsWith('@lamalibre/')) {
      throw Object.assign(
        new Error('Only @lamalibre/ scoped packages are allowed'),
        { statusCode: 400 },
      );
    }

    // Check if already installed
    const registry = await readPlugins();
    const existing = registry.plugins.find((p) => p.packageName === packageName);
    if (existing) {
      throw Object.assign(
        new Error(`Plugin "${packageName}" is already installed`),
        { statusCode: 409 },
      );
    }

    // Ensure STATE_DIR has a package.json so npm does not walk up the tree
    const statePackageJson = path.join(STATE_DIR, 'package.json');
    try {
      await readFile(statePackageJson, 'utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        await writeFile(statePackageJson, '{"private":true}\n', { encoding: 'utf-8', mode: 0o600 });
      }
    }

    // Install the npm package
    logger.info({ packageName }, 'Installing plugin package');
    try {
      await execa('npm', ['install', '--ignore-scripts', packageName], {
        cwd: STATE_DIR,
        timeout: 120000,
      });
    } catch (err) {
      logger.error({ packageName, stderr: err.stderr, err: err.message }, 'npm install failed');
      throw Object.assign(
        new Error(`Failed to install "${packageName}"`),
        { statusCode: 500 },
      );
    }

    // Read the plugin manifest from the installed package
    let manifest;
    try {
      const require = createRequire(`${STATE_DIR}/`);
      const manifestPath = require.resolve(`${packageName}/portlama-plugin.json`);
      const manifestRaw = await readFile(manifestPath, 'utf-8');
      manifest = validateManifest(JSON.parse(manifestRaw));
    } catch (err) {
      // Clean up the installed package if manifest is missing/invalid
      logger.warn({ packageName, err: err.message }, 'Invalid or missing manifest, uninstalling');
      await execa('npm', ['uninstall', packageName], { cwd: STATE_DIR }).catch(() => {});

      if (err instanceof z.ZodError) {
        throw Object.assign(
          new Error(`Invalid plugin manifest: ${err.errors.map((e) => e.message).join(', ')}`),
          { statusCode: 400 },
        );
      }
      throw Object.assign(
        new Error(`Plugin manifest not found in "${packageName}"`),
        { statusCode: 400 },
      );
    }

    // Reject names that collide with core API route prefixes
    const RESERVED_NAMES = [
      'health', 'onboarding', 'invite', 'tunnels', 'sites', 'system',
      'services', 'logs', 'users', 'certs', 'invitations', 'shell', 'plugins',
    ];
    if (RESERVED_NAMES.includes(manifest.name)) {
      await execa('npm', ['uninstall', packageName], { cwd: STATE_DIR }).catch(() => {});
      throw Object.assign(
        new Error(`Plugin name "${manifest.name}" is reserved`),
        { statusCode: 400 },
      );
    }

    // Create the plugin state directory
    const pluginDir = path.join(PLUGINS_DIR, manifest.name);
    await mkdir(pluginDir, { recursive: true, mode: 0o700 });

    // Add to registry
    const entry = {
      name: manifest.name,
      packageName,
      version: manifest.version,
      description: manifest.description,
      capabilities: manifest.capabilities,
      packages: manifest.packages,
      panel: manifest.panel,
      status: 'disabled',
      installedAt: new Date().toISOString(),
    };

    registry.plugins.push(entry);
    await writePlugins(registry);

    logger.info({ name: manifest.name, packageName }, 'Plugin installed');
    return entry;
  });
}

/**
 * Uninstall a plugin. Must be disabled first.
 *
 * @param {string} name - The plugin name
 * @param {import('pino').Logger} logger
 * @returns {Promise<{ ok: true, name: string }>}
 */
export function uninstallPlugin(name, logger) {
  return withPluginLock(async () => {
    const registry = await readPlugins();
    const index = registry.plugins.findIndex((p) => p.name === name);

    if (index === -1) {
      throw Object.assign(
        new Error(`Plugin "${name}" not found`),
        { statusCode: 404 },
      );
    }

    const plugin = registry.plugins[index];

    if (plugin.status === 'enabled') {
      throw Object.assign(
        new Error(`Plugin "${name}" must be disabled before uninstalling`),
        { statusCode: 400 },
      );
    }

    // Uninstall the npm package
    logger.info({ name, packageName: plugin.packageName }, 'Uninstalling plugin package');
    await execa('npm', ['uninstall', plugin.packageName], {
      cwd: STATE_DIR,
    }).catch((err) => {
      logger.warn({ err: err.message }, 'npm uninstall failed (continuing)');
    });

    // Remove the plugin state directory
    const pluginDir = path.join(PLUGINS_DIR, name);
    await rm(pluginDir, { recursive: true, force: true }).catch((err) => {
      logger.warn({ err: err.message }, 'Failed to remove plugin state directory');
    });

    // Remove from registry
    registry.plugins.splice(index, 1);
    await writePlugins(registry);

    logger.info({ name }, 'Plugin uninstalled');
    return { ok: true, name };
  });
}

/**
 * Enable a plugin.
 *
 * @param {string} name - The plugin name
 * @param {import('pino').Logger} [logger]
 * @returns {Promise<{ ok: true, name: string, status: string }>}
 */
export function enablePlugin(name, logger) {
  return withPluginLock(async () => {
    const registry = await readPlugins();
    const plugin = registry.plugins.find((p) => p.name === name);

    if (!plugin) {
      throw Object.assign(
        new Error(`Plugin "${name}" not found`),
        { statusCode: 404 },
      );
    }

    if (plugin.status === 'enabled') {
      return { ok: true, name, status: 'enabled' };
    }

    plugin.status = 'enabled';
    plugin.enabledAt = new Date().toISOString();
    await writePlugins(registry);

    logger?.info({ name }, 'Plugin enabled');
    return { ok: true, name, status: 'enabled' };
  });
}

/**
 * Disable a plugin.
 *
 * @param {string} name - The plugin name
 * @param {import('pino').Logger} [logger]
 * @returns {Promise<{ ok: true, name: string, status: string }>}
 */
export function disablePlugin(name, logger) {
  return withPluginLock(async () => {
    const registry = await readPlugins();
    const plugin = registry.plugins.find((p) => p.name === name);

    if (!plugin) {
      throw Object.assign(
        new Error(`Plugin "${name}" not found`),
        { statusCode: 404 },
      );
    }

    if (plugin.status === 'disabled') {
      return { ok: true, name, status: 'disabled' };
    }

    plugin.status = 'disabled';
    delete plugin.enabledAt;
    await writePlugins(registry);

    logger?.info({ name }, 'Plugin disabled');
    return { ok: true, name, status: 'disabled' };
  });
}

/**
 * Get all enabled plugins.
 *
 * @returns {Promise<Array>}
 */
export async function getEnabledPlugins() {
  const registry = await readPlugins();
  return registry.plugins.filter((p) => p.status === 'enabled');
}

/**
 * Get capabilities contributed by all installed plugins.
 *
 * @returns {Promise<string[]>}
 */
export async function getPluginCapabilities() {
  const registry = await readPlugins();
  const caps = [];
  for (const plugin of registry.plugins) {
    if (plugin.status === 'enabled' && Array.isArray(plugin.capabilities)) {
      caps.push(...plugin.capabilities);
    }
  }
  return [...new Set(caps)];
}
