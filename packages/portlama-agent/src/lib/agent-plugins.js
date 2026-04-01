/**
 * Agent plugin lifecycle management.
 *
 * Manages plugin installation, enable/disable, uninstall, and update for
 * per-agent plugin registries. Plugins are installed into the agent's data
 * directory and mounted on the agent panel server (port 9393) when enabled.
 *
 * Adapted from local-plugins.js — key differences:
 * - All functions take `label` as first parameter (per-agent isolation)
 * - Uses agentDataDir/agentPluginsFile/agentPluginsDir from platform.js
 * - Validates modes.includes('agent') instead of 'local'
 */

import { readFile, writeFile, rename, open, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { execa } from 'execa';
import { agentDataDir, agentPluginsFile, agentPluginsDir } from './platform.js';

// Reserved names that cannot be used as plugin names (matches panel-server constants).
const RESERVED_NAMES = [
  'health', 'onboarding', 'invite', 'enroll', 'tunnels', 'sites', 'system',
  'services', 'logs', 'users', 'certs', 'invitations', 'plugins', 'tickets',
  'settings', 'identity', 'storage', 'agents',
];

// --- Promise-chain mutex (serialises registry modifications) ---

let lockTail = Promise.resolve();

function withLock(fn) {
  const next = lockTail.then(fn, fn);
  lockTail = next.catch(() => {});
  return next;
}

// --- Registry read / write ---

/**
 * Read the agent plugin registry.
 * @param {string} label - Agent label
 * @returns {Promise<{plugins: Array}>}
 */
export async function readAgentPluginRegistry(label) {
  try {
    const raw = await readFile(agentPluginsFile(label), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.plugins) ? parsed : { plugins: [] };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { plugins: [] };
    }
    throw new Error(`Failed to read agent plugin registry: ${err.message}`);
  }
}

/**
 * Write the agent plugin registry atomically.
 * @param {string} label - Agent label
 * @param {object} data
 */
export async function writeAgentPluginRegistry(label, data) {
  const filePath = agentPluginsFile(label);
  const tmpPath = `${filePath}.tmp`;

  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });

  const content = JSON.stringify(data, null, 2) + '\n';
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });

  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();

  await rename(tmpPath, filePath);
}

// --- Plugin lifecycle ---

/**
 * Install a plugin on the agent.
 * @param {string} label - Agent label
 * @param {string} packageName - Must be @lamalibre/ scoped
 * @returns {Promise<object>} The new registry entry
 */
export function installAgentPlugin(label, packageName) {
  return withLock(async () => {
    if (!packageName.startsWith('@lamalibre/')) {
      throw new Error('Only @lamalibre/ scoped packages are allowed');
    }

    // Validate the portion after scope to prevent path traversal
    const pkgName = packageName.slice('@lamalibre/'.length);
    if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(pkgName)) {
      throw new Error('Invalid package name');
    }

    const registry = await readAgentPluginRegistry(label);
    if (registry.plugins.find((p) => p.packageName === packageName)) {
      throw new Error(`Plugin "${packageName}" is already installed`);
    }

    // Hard cap to prevent disk exhaustion
    if (registry.plugins.length >= 20) {
      throw new Error('Maximum of 20 agent plugins allowed');
    }

    // Ensure agent dir has a package.json so npm installs locally
    const dir = agentDataDir(label);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const pkgJsonPath = path.join(dir, 'package.json');
    try {
      await readFile(pkgJsonPath, 'utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        await writeFile(pkgJsonPath, '{"private":true}\n', { encoding: 'utf-8', mode: 0o600 });
      }
    }

    // Install via npm
    await execa('npm', ['install', '--ignore-scripts', packageName], { cwd: dir, timeout: 120_000 });

    // Read and validate manifest
    let manifest;
    try {
      const require = createRequire(path.join(dir, '/'));
      const manifestPath = require.resolve(`${packageName}/portlama-plugin.json`);
      const manifestRaw = await readFile(manifestPath, 'utf-8');
      manifest = JSON.parse(manifestRaw);
    } catch {
      // Clean up on manifest failure
      await execa('npm', ['uninstall', packageName], { cwd: dir }).catch(() => {});
      throw new Error(`No valid portlama-plugin.json found in "${packageName}"`);
    }

    // Validate name
    if (!/^[a-z0-9-]+$/.test(manifest.name)) {
      await execa('npm', ['uninstall', packageName], { cwd: dir }).catch(() => {});
      throw new Error(`Invalid plugin name: "${manifest.name}"`);
    }

    if (RESERVED_NAMES.includes(manifest.name)) {
      await execa('npm', ['uninstall', packageName], { cwd: dir }).catch(() => {});
      throw new Error(`Plugin name "${manifest.name}" is reserved`);
    }

    // Check for duplicate name (different package, same manifest name)
    if (registry.plugins.find((p) => p.name === manifest.name)) {
      await execa('npm', ['uninstall', packageName], { cwd: dir }).catch(() => {});
      throw new Error(`A plugin named "${manifest.name}" is already installed`);
    }

    // Validate agent mode support
    const modes = manifest.modes || ['server', 'agent'];
    if (!modes.includes('agent')) {
      await execa('npm', ['uninstall', packageName], { cwd: dir }).catch(() => {});
      throw new Error(`Plugin "${manifest.name}" does not support agent mode`);
    }

    // Create plugin data directory
    const pluginDir = path.join(agentPluginsDir(label), manifest.name);
    await mkdir(pluginDir, { recursive: true, mode: 0o700 });

    const entry = {
      name: manifest.name,
      displayName: manifest.displayName,
      packageName,
      version: manifest.version,
      description: manifest.description || '',
      capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : [],
      packages: manifest.packages || {},
      panel: manifest.panel || {},
      modes,
      config: manifest.config || {},
      status: 'disabled',
      installedAt: new Date().toISOString(),
    };

    registry.plugins.push(entry);
    await writeAgentPluginRegistry(label, registry);
    return entry;
  });
}

/**
 * Uninstall an agent plugin. Must be disabled first.
 * @param {string} label - Agent label
 * @param {string} name - Plugin name
 */
export function uninstallAgentPlugin(label, name) {
  return withLock(async () => {
    const registry = await readAgentPluginRegistry(label);
    const index = registry.plugins.findIndex((p) => p.name === name);
    if (index === -1) {
      throw new Error(`Plugin "${name}" not found`);
    }

    const plugin = registry.plugins[index];
    if (plugin.status === 'enabled') {
      throw new Error(`Plugin "${name}" must be disabled before uninstalling`);
    }

    if (!plugin.packageName.startsWith('@lamalibre/')) {
      throw new Error('Registry corruption: invalid package scope');
    }

    // npm uninstall
    await execa('npm', ['uninstall', plugin.packageName], { cwd: agentDataDir(label) }).catch(() => {});

    // Remove plugin data directory
    const pluginDir = path.join(agentPluginsDir(label), plugin.name);
    await rm(pluginDir, { recursive: true, force: true }).catch(() => {});

    registry.plugins.splice(index, 1);
    await writeAgentPluginRegistry(label, registry);
  });
}

/**
 * Enable an agent plugin.
 * @param {string} label - Agent label
 * @param {string} name - Plugin name
 */
export function enableAgentPlugin(label, name) {
  return withLock(async () => {
    const registry = await readAgentPluginRegistry(label);
    const plugin = registry.plugins.find((p) => p.name === name);
    if (!plugin) {
      throw new Error(`Plugin "${name}" not found`);
    }
    if (plugin.status === 'enabled') return;

    plugin.status = 'enabled';
    plugin.enabledAt = new Date().toISOString();
    await writeAgentPluginRegistry(label, registry);
  });
}

/**
 * Disable an agent plugin.
 * @param {string} label - Agent label
 * @param {string} name - Plugin name
 */
export function disableAgentPlugin(label, name) {
  return withLock(async () => {
    const registry = await readAgentPluginRegistry(label);
    const plugin = registry.plugins.find((p) => p.name === name);
    if (!plugin) {
      throw new Error(`Plugin "${name}" not found`);
    }
    if (plugin.status === 'disabled') return;

    plugin.status = 'disabled';
    delete plugin.enabledAt;
    await writeAgentPluginRegistry(label, registry);
  });
}

/**
 * Update an agent plugin to the latest version.
 * @param {string} label - Agent label
 * @param {string} nameOrPackage - Plugin name or package name
 * @returns {Promise<object>} The updated registry entry
 */
export function updateAgentPlugin(label, nameOrPackage) {
  return withLock(async () => {
    const registry = await readAgentPluginRegistry(label);
    const plugin = registry.plugins.find(
      (p) => p.name === nameOrPackage || p.packageName === nameOrPackage,
    );

    if (!plugin) {
      throw new Error(`Plugin "${nameOrPackage}" not found`);
    }

    if (!plugin.packageName.startsWith('@lamalibre/')) {
      throw new Error('Registry corruption: invalid package scope');
    }

    const dir = agentDataDir(label);
    await execa('npm', ['install', '--ignore-scripts', plugin.packageName], { cwd: dir, timeout: 120_000 });

    // Re-read manifest to capture the updated version
    try {
      const require = createRequire(path.join(dir, '/'));
      const manifestPath = require.resolve(`${plugin.packageName}/portlama-plugin.json`);
      const manifestRaw = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestRaw);
      plugin.version = manifest.version || plugin.version;
      if (manifest.capabilities) plugin.capabilities = manifest.capabilities;
      if (manifest.panel) plugin.panel = manifest.panel;
      if (manifest.packages) plugin.packages = manifest.packages;
      if (manifest.description) plugin.description = manifest.description;
      if (manifest.displayName) plugin.displayName = manifest.displayName;
    } catch {
      // Manifest may not exist — keep existing metadata
    }

    plugin.updatedAt = new Date().toISOString();
    await writeAgentPluginRegistry(label, registry);
    return plugin;
  });
}

/**
 * Read a plugin's panel.js bundle from the installed package.
 * @param {string} label - Agent label
 * @param {string} name - Plugin name
 * @returns {Promise<string>} JavaScript source
 */
export async function checkAgentPluginUpdate(label, name) {
  const registry = await readAgentPluginRegistry(label);
  const plugin = registry.plugins.find((p) => p.name === name);
  if (!plugin) {
    throw new Error(`Plugin "${name}" not found`);
  }

  const pkg = plugin.packageName;
  if (!pkg || !pkg.startsWith('@lamalibre/')) {
    throw new Error('Invalid package scope');
  }

  const { stdout } = await execa('npm', ['view', pkg, 'version', '--json'], {
    cwd: agentDataDir(label),
  });

  const latestVersion = JSON.parse(stdout.trim());
  const currentVersion = plugin.version;

  return {
    name,
    currentVersion,
    latestVersion,
    hasUpdate: latestVersion !== currentVersion,
  };
}

export async function readAgentPluginBundle(label, name) {
  const registry = await readAgentPluginRegistry(label);
  const plugin = registry.plugins.find((p) => p.name === name);
  if (!plugin) {
    throw new Error(`Plugin "${name}" not found`);
  }

  const serverPkg = plugin.packages?.server;
  if (!serverPkg) {
    throw new Error(`Plugin "${name}" has no server package with panel bundle`);
  }

  // Defense-in-depth: verify scope in case registry was tampered
  if (!serverPkg.startsWith('@lamalibre/')) {
    throw new Error('Server package scope violation');
  }

  const require = createRequire(path.join(agentDataDir(label), '/'));
  const panelPath = require.resolve(`${serverPkg}/panel.js`);
  return readFile(panelPath, 'utf-8');
}
