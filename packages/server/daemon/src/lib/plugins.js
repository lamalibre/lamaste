/**
 * Server-side plugin lifecycle.
 *
 * Schema validation and constants are imported from @lamalibre/lamaste (core).
 * This module retains server-specific lifecycle operations (install, uninstall,
 * enable, disable) that use the local promise-chain mutex and execa for npm.
 *
 * Backed by SQLite (`state.db`, table `plugins`) per
 * docs/decisions/sqlite-migration.md §3c.
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { z } from 'zod';
import { execa } from 'execa';
import {
  RESERVED_API_PREFIXES,
  RESERVED_NAV_LABELS,
  derivePluginRoute,
  validateManifest as coreValidateManifest,
} from '@lamalibre/lamaste';
import { revokePluginCapabilitiesFromAgents } from '@lamalibre/lamaste/server';
import { listRegisteredSubScopeNames } from './tickets.js';
import { getStateDb } from './state-db.js';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';
const PLUGINS_DIR = path.join(STATE_DIR, 'plugins');
const PKI_DIR = process.env.LAMALIBRE_LAMASTE_PKI_DIR || '/etc/lamalibre/lamaste/pki';

// Promise-chain mutex. SQLite's BEGIN IMMEDIATE serialises a single write
// transaction, but install/uninstall are read-modify-write sequences that
// span multiple statements (and shell out to npm in between). This lock
// keeps each such sequence atomic. Removable once each operation is
// collapsed into one transaction.
let pluginLock = Promise.resolve();
function withPluginLock(fn) {
  const prev = pluginLock;
  let resolve;
  pluginLock = new Promise((r) => {
    resolve = r;
  });
  return prev.then(fn).finally(resolve);
}

// --- SQLite prepared-statement bundle (lazy init) ---

let stmts = null;

async function getStmts() {
  if (stmts) return stmts;

  const db = await getStateDb();

  stmts = {
    db,

    selectAll: db.prepare('SELECT * FROM plugins'),
    selectByName: db.prepare('SELECT * FROM plugins WHERE name = ?'),
    selectByPackageName: db.prepare('SELECT * FROM plugins WHERE package_name = ?'),
    insert: db.prepare(`
      INSERT INTO plugins
        (name, display_name, package_name, version, description, capabilities,
         packages, panel, config, modes, status, installed_at, enabled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    deleteByName: db.prepare('DELETE FROM plugins WHERE name = ?'),
    deleteAll: db.prepare('DELETE FROM plugins'),
    updateStatusEnable: db.prepare(`
      UPDATE plugins SET status = 'enabled', enabled_at = ? WHERE name = ?
    `),
    updateStatusDisable: db.prepare(`
      UPDATE plugins SET status = 'disabled', enabled_at = NULL WHERE name = ?
    `),

    begin: db.prepare('BEGIN IMMEDIATE'),
    commit: db.prepare('COMMIT'),
    rollback: db.prepare('ROLLBACK'),
  };

  return stmts;
}

// --- Row → JS object helper ---
//
// JSON-typed columns (capabilities, packages, panel, config, modes) are
// JSON-encoded TEXT in storage. They round-trip through JSON.parse/stringify
// so callers see the same shape the JSON-backed module returned — including
// `undefined` for optional fields (mirroring the JSON object layout where
// missing keys are absent rather than null).

function rowToPlugin(row) {
  const entry = {
    name: row.name,
    packageName: row.package_name,
    version: row.version,
    capabilities: row.capabilities ? JSON.parse(row.capabilities) : [],
    status: row.status,
    installedAt: row.installed_at,
  };
  if (row.display_name != null) entry.displayName = row.display_name;
  if (row.description != null) entry.description = row.description;
  if (row.packages != null) entry.packages = JSON.parse(row.packages);
  if (row.panel != null) entry.panel = JSON.parse(row.panel);
  if (row.config != null) entry.config = JSON.parse(row.config);
  if (row.modes != null) entry.modes = JSON.parse(row.modes);
  if (row.enabled_at != null) entry.enabledAt = row.enabled_at;
  return entry;
}

function nullableString(value) {
  return value === undefined || value === null ? null : value;
}

function nullableJson(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

// --- Plugin registry persistence ---

/**
 * Read the plugin registry from disk.
 * Returns `{ plugins: [] }` if the file does not exist.
 */
export async function readPlugins() {
  const s = await getStmts();
  const rows = s.selectAll.all();
  return { plugins: rows.map(rowToPlugin) };
}

/**
 * Write the plugin registry to disk atomically.
 *
 * The function preserves its byte-identical signature from the JSON era: it
 * accepts a `{ plugins: [...] }` shape and replaces the entire registry. The
 * SQLite implementation runs DELETE + INSERTs in one BEGIN IMMEDIATE
 * transaction so observers see either the old or the new state, never a
 * partial write.
 */
export async function writePlugins(data) {
  const s = await getStmts();
  const list = Array.isArray(data?.plugins) ? data.plugins : [];

  s.begin.run();
  try {
    s.deleteAll.run();
    for (const p of list) {
      s.insert.run(
        p.name,
        nullableString(p.displayName),
        p.packageName,
        p.version,
        nullableString(p.description),
        JSON.stringify(p.capabilities ?? []),
        nullableJson(p.packages),
        nullableJson(p.panel),
        nullableJson(p.config),
        nullableJson(p.modes),
        p.status,
        p.installedAt,
        nullableString(p.enabledAt),
      );
    }
    s.commit.run();
  } catch (err) {
    s.rollback.run();
    throw err;
  }
}

/**
 * Validate a raw plugin manifest against the schema.
 * Delegates to the core library's ManifestSchema.
 *
 * @param {object} raw - The raw manifest object
 * @returns {object} The validated and parsed manifest
 * @throws {z.ZodError} If validation fails
 */
export function validateManifest(raw) {
  return coreValidateManifest(raw);
}

/**
 * Install a plugin by npm package name.
 * Only @lamalibre/ scoped packages are allowed.
 *
 * @param {string} packageName - The npm package name (must start with @lamalibre/)
 * @param {import('pino').Logger} logger
 * @returns {Promise<object>} The installed plugin entry
 */
// Reject npm aliases (e.g. "@lamalibre/x@npm:totally-evil") and any name that
// could resolve outside the @lamalibre/ scope. Optional version suffix
// (`@1.2.3`, `@beta`, etc.) is allowed; alias schemes (`@npm:`, `@github:`,
// etc.) and shell metacharacters are not.
const LAMALIBRE_PACKAGE_RE = /^@lamalibre\/[a-z0-9][a-z0-9._-]{0,213}(@[A-Za-z0-9._-]+)?$/;

function assertSafeLamalibrePackage(packageName) {
  if (typeof packageName !== 'string' || packageName.length === 0 || packageName.length > 256) {
    throw Object.assign(new Error('Invalid package name'), { statusCode: 400 });
  }
  if (!LAMALIBRE_PACKAGE_RE.test(packageName)) {
    throw Object.assign(
      new Error('Only @lamalibre/ scoped packages are allowed (alias schemes are rejected)'),
      { statusCode: 400 },
    );
  }
  // Defense-in-depth against npm alias syntax even if the regex above shifts.
  const versionSuffix = packageName.indexOf('@', 1);
  if (versionSuffix !== -1 && packageName.slice(versionSuffix).startsWith('@npm:')) {
    throw Object.assign(new Error('npm: alias references are not permitted'), { statusCode: 400 });
  }
}

export function installPlugin(packageName, logger) {
  return withPluginLock(async () => {
    // Validate package scope
    assertSafeLamalibrePackage(packageName);

    const s = await getStmts();

    // Check if already installed
    const existingRow = s.selectByPackageName.get(packageName);
    if (existingRow) {
      throw Object.assign(new Error(`Plugin "${packageName}" is already installed`), {
        statusCode: 409,
      });
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
      throw Object.assign(new Error(`Failed to install "${packageName}"`), { statusCode: 500 });
    }

    // Read the plugin manifest from the installed package
    let manifest;
    try {
      const require = createRequire(`${STATE_DIR}/`);
      const manifestPath = require.resolve(`${packageName}/lamaste-plugin.json`);
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
      throw Object.assign(new Error(`Plugin manifest not found in "${packageName}"`), {
        statusCode: 400,
      });
    }

    // Reject names that collide with core API route prefixes
    if (RESERVED_API_PREFIXES.includes(manifest.name)) {
      await execa('npm', ['uninstall', packageName], { cwd: STATE_DIR }).catch(() => {});
      throw Object.assign(new Error(`Plugin name "${manifest.name}" is reserved`), {
        statusCode: 400,
      });
    }

    // Reject displayName that matches reserved navigation labels
    if (manifest.displayName) {
      if (RESERVED_NAV_LABELS.includes(manifest.displayName.toLowerCase())) {
        await execa('npm', ['uninstall', packageName], { cwd: STATE_DIR }).catch(() => {});
        throw Object.assign(
          new Error(
            `Plugin display name "${manifest.displayName}" conflicts with a core navigation label`,
          ),
          { statusCode: 400 },
        );
      }
    }

    // Validate apiPrefix matches plugin name if specified
    if (manifest.panel?.apiPrefix && manifest.panel.apiPrefix !== `/api/${manifest.name}`) {
      await execa('npm', ['uninstall', packageName], { cwd: STATE_DIR }).catch(() => {});
      throw Object.assign(
        new Error(
          `Plugin apiPrefix must be "/api/${manifest.name}" but got "${manifest.panel.apiPrefix}"`,
        ),
        { statusCode: 400 },
      );
    }

    // Cross-namespace collision: any capability declared by the plugin must
    // not match a sub-scope name already owned by a registered ticket scope.
    // Schema-level namespacing puts both sides in `plugin:*`; this check is
    // a flat set intersection. The reverse direction (registering a scope
    // that collides with an installed plugin's cap) is enforced in
    // `registerScope`.
    if (Array.isArray(manifest.capabilities) && manifest.capabilities.length > 0) {
      const subScopeNames = new Set(await listRegisteredSubScopeNames());
      const collision = manifest.capabilities.find((c) => subScopeNames.has(c));
      if (collision) {
        await execa('npm', ['uninstall', packageName], { cwd: STATE_DIR }).catch(() => {});
        throw Object.assign(
          new Error(
            `Plugin capability "${collision}" collides with an existing ticket scope sub-scope name. ` +
              'Pick a different action name or unregister the conflicting ticket scope first.',
          ),
          { statusCode: 409 },
        );
      }
    }

    // Create the plugin state directory
    const pluginDir = path.join(PLUGINS_DIR, manifest.name);
    await mkdir(pluginDir, { recursive: true, mode: 0o700 });

    // Build the entry, then persist via INSERT
    const entry = {
      name: manifest.name,
      displayName: manifest.displayName,
      packageName,
      version: manifest.version,
      description: manifest.description,
      capabilities: manifest.capabilities,
      packages: manifest.packages,
      panel: manifest.panel,
      config: manifest.config,
      modes: manifest.modes,
      status: 'disabled',
      installedAt: new Date().toISOString(),
    };

    s.begin.run();
    try {
      s.insert.run(
        entry.name,
        nullableString(entry.displayName),
        entry.packageName,
        entry.version,
        nullableString(entry.description),
        JSON.stringify(entry.capabilities ?? []),
        nullableJson(entry.packages),
        nullableJson(entry.panel),
        nullableJson(entry.config),
        nullableJson(entry.modes),
        entry.status,
        entry.installedAt,
        null,
      );
      s.commit.run();
    } catch (err) {
      s.rollback.run();
      throw err;
    }

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
    const s = await getStmts();
    const row = s.selectByName.get(name);

    if (!row) {
      throw Object.assign(new Error(`Plugin "${name}" not found`), { statusCode: 404 });
    }

    const plugin = rowToPlugin(row);

    if (plugin.status === 'enabled') {
      throw Object.assign(new Error(`Plugin "${name}" must be disabled before uninstalling`), {
        statusCode: 400,
      });
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
    s.begin.run();
    try {
      s.deleteByName.run(name);
      s.commit.run();
    } catch (err) {
      s.rollback.run();
      throw err;
    }

    // Sweep this plugin's capabilities off every agent so re-installing the
    // plugin later does NOT silently re-grant. Failure here is non-fatal
    // (the plugin is already gone), but logged loudly.
    try {
      const route = derivePluginRoute(plugin.name);
      const diffs = await revokePluginCapabilitiesFromAgents(PKI_DIR, route);
      if (diffs.length > 0) {
        logger.info({ name, route, diffs }, 'Revoked plugin capabilities from agents on uninstall');
      }
    } catch (err) {
      logger.warn(
        { name, err: err.message },
        'Failed to sweep plugin capabilities from agent registry on uninstall',
      );
    }

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
    const s = await getStmts();
    const row = s.selectByName.get(name);

    if (!row) {
      throw Object.assign(new Error(`Plugin "${name}" not found`), { statusCode: 404 });
    }

    if (row.status === 'enabled') {
      return { ok: true, name, status: 'enabled' };
    }

    s.begin.run();
    try {
      s.updateStatusEnable.run(new Date().toISOString(), name);
      s.commit.run();
    } catch (err) {
      s.rollback.run();
      throw err;
    }

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
    const s = await getStmts();
    const row = s.selectByName.get(name);

    if (!row) {
      throw Object.assign(new Error(`Plugin "${name}" not found`), { statusCode: 404 });
    }

    if (row.status === 'disabled') {
      return { ok: true, name, status: 'disabled' };
    }

    s.begin.run();
    try {
      s.updateStatusDisable.run(name);
      s.commit.run();
    } catch (err) {
      s.rollback.run();
      throw err;
    }

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
  const s = await getStmts();
  const rows = s.selectAll.all();
  return rows.filter((r) => r.status === 'enabled').map(rowToPlugin);
}

/**
 * Get capabilities contributed by all installed plugins.
 *
 * @returns {Promise<string[]>}
 */
export async function getPluginCapabilities() {
  const s = await getStmts();
  const rows = s.selectAll.all();
  const caps = [];
  for (const row of rows) {
    if (row.status === 'enabled' && row.capabilities) {
      const parsed = JSON.parse(row.capabilities);
      if (Array.isArray(parsed)) caps.push(...parsed);
    }
  }
  return [...new Set(caps)];
}
