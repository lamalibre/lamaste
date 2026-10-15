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
import { execa } from 'execa';
import {
  DEFAULT_PLUGIN_HOSTING,
  ManifestValidationError,
  RESERVED_API_PREFIXES,
  RESERVED_NAV_LABELS,
  derivePluginRoute,
  hasAgentHalf,
  pluginHostCapability,
  validateManifest as coreValidateManifest,
} from '@lamalibre/lamaste';
import { listRegisteredSubScopeNames } from './tickets.js';
import { getStateDb } from './state-db.js';
import { revokePluginCapabilitiesFromAgents } from './mtls.js';
import {
  bareLamalibrePackageName,
  installedHookEntrySha256,
  pinAgentHalf,
} from './plugin-packages.js';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';
const PLUGINS_DIR = path.join(STATE_DIR, 'plugins');

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
    selectByRoute: db.prepare('SELECT * FROM plugins WHERE route = ?'),
    selectByPackageName: db.prepare('SELECT * FROM plugins WHERE package_name = ?'),
    insert: db.prepare(`
      INSERT INTO plugins
        (name, route, display_name, package_name, version, description, capabilities,
         packages, panel, config, modes, hosting, agent, hooks, hooks_entry_sha256,
         agent_half_pin, status, installed_at, enabled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
// missing keys are absent rather than null). `hosting` is plain TEXT
// ('server' | 'agent'; rows from before 4.2 default to 'server'): an
// agent-hosted plugin is installed (npm, manifest) like any other, but the
// plugin host never imports it — see `pluginHostPlugin`. `route` is the
// plugin's route (`derivePluginRoute(name)`), unique among installed
// plugins; null only for a plugin installed before routes were unique that
// shares its route with an older one (migration 0010) — such a plugin is
// never hosted and its uninstall leaves the route's capabilities alone.

function rowToPlugin(row) {
  const entry = {
    name: row.name,
    route: row.route ?? null,
    packageName: row.package_name,
    version: row.version,
    capabilities: row.capabilities ? JSON.parse(row.capabilities) : [],
    hosting: row.hosting,
    status: row.status,
    installedAt: row.installed_at,
  };
  if (row.display_name != null) entry.displayName = row.display_name;
  if (row.description != null) entry.description = row.description;
  if (row.packages != null) entry.packages = JSON.parse(row.packages);
  if (row.panel != null) entry.panel = JSON.parse(row.panel);
  if (row.config != null) entry.config = JSON.parse(row.config);
  if (row.modes != null) entry.modes = JSON.parse(row.modes);
  if (row.agent != null) entry.agent = JSON.parse(row.agent);
  if (row.hooks != null) entry.hooks = JSON.parse(row.hooks);
  if (row.hooks_entry_sha256 != null) entry.hooksEntrySha256 = row.hooks_entry_sha256;
  if (row.agent_half_pin != null) entry.agentHalfPin = JSON.parse(row.agent_half_pin);
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
        p.route === undefined ? derivePluginRoute(p.name) : p.route,
        nullableString(p.displayName),
        p.packageName,
        p.version,
        nullableString(p.description),
        JSON.stringify(p.capabilities ?? []),
        nullableJson(p.packages),
        nullableJson(p.panel),
        nullableJson(p.config),
        nullableJson(p.modes),
        p.hosting ?? DEFAULT_PLUGIN_HOSTING,
        nullableJson(p.agent),
        nullableJson(p.hooks),
        nullableString(p.hooksEntrySha256),
        nullableJson(p.agentHalfPin),
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
 * @throws {ManifestValidationError} If validation fails
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

/**
 * After a lifecycle change, bring Authelia's OIDC clients and the secret
 * store in line with the installed plugins. Best effort — logged, never
 * thrown — so a plugin operation does not fail because Authelia could not
 * be restarted. Returns the secrets of confidential clients this change
 * created (`[{ id, secret }]`), shown to the admin exactly once.
 * @param {import('pino').Logger} logger
 * @returns {Promise<Array<{ id: string, secret: string }>>}
 */
async function syncOidcClientsBestEffort(logger) {
  try {
    const { syncOidcClients } = await import('./plugin-oidc.js');
    const result = await syncOidcClients(logger);
    return (result?.createdSecrets ?? []).map(({ id, secret }) => ({ id, secret }));
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to sync plugin OIDC clients to Authelia');
    return [];
  }
}

/**
 * The panel's rules for a manifest beyond its schema — checked at install
 * and again for an update. Returns `{ message, statusCode }` or null.
 */
export async function manifestPolicyError(manifest) {
  // Names that collide with core API route prefixes
  if (RESERVED_API_PREFIXES.includes(manifest.name)) {
    return { message: `Plugin name "${manifest.name}" is reserved`, statusCode: 400 };
  }
  // A displayName that matches a core navigation label
  if (manifest.displayName && RESERVED_NAV_LABELS.includes(manifest.displayName.toLowerCase())) {
    return {
      message: `Plugin display name "${manifest.displayName}" conflicts with a core navigation label`,
      statusCode: 400,
    };
  }
  // A plugin with an agent half is named by its route: the route keys its
  // hosting, its internal tunnel, its agent half's account and directories
  // on the agent and its forwarded API (`/api/<route>`), while its hook
  // state, operations and audit entries go by name — the two must be one.
  if (hasAgentHalf(manifest)) {
    const route = derivePluginRoute(manifest.name);
    if (route !== manifest.name) {
      return {
        message: `A plugin with an agent half is named by its route: "${manifest.name}" would be served as "${route}" — name it "${route}" (its packages keep their names)`,
        statusCode: 400,
      };
    }
  }
  // apiPrefix must match the plugin name
  if (manifest.panel?.apiPrefix && manifest.panel.apiPrefix !== `/api/${manifest.name}`) {
    return {
      message: `Plugin apiPrefix must be "/api/${manifest.name}" but got "${manifest.panel.apiPrefix}"`,
      statusCode: 400,
    };
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
      return {
        message:
          `Plugin capability "${collision}" collides with an existing ticket scope sub-scope name. ` +
          'Pick a different action name or unregister the conflicting ticket scope first.',
        statusCode: 409,
      };
    }
  }
  return null;
}

export function installPlugin(packageName, logger) {
  return withPluginLock(async () => {
    // Validate package scope
    assertSafeLamalibrePackage(packageName);
    // `@lamalibre/x@1.2.3` installs that version; the registry knows the
    // package by its bare name (the manifest is resolved by it, too).
    const installSpec = packageName;
    packageName = bareLamalibrePackageName(installSpec);
    // Remove the package npm installed when it is refused below.
    const discardPackage = () =>
      execa('npm', ['uninstall', packageName], { cwd: STATE_DIR }).catch(() => {});

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
    logger.info({ packageName: installSpec }, 'Installing plugin package');
    try {
      await execa('npm', ['install', '--ignore-scripts', installSpec], {
        cwd: STATE_DIR,
        timeout: 120000,
      });
    } catch (err) {
      logger.error(
        { packageName: installSpec, stderr: err.stderr, err: err.message },
        'npm install failed',
      );
      throw Object.assign(new Error(`Failed to install "${installSpec}"`), { statusCode: 500 });
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
      await discardPackage();

      if (err instanceof ManifestValidationError) {
        throw Object.assign(new Error(err.message), { statusCode: 400 });
      }
      throw Object.assign(new Error(`Plugin manifest not found in "${packageName}"`), {
        statusCode: 400,
      });
    }

    const policyError = await manifestPolicyError(manifest);
    if (policyError) {
      await discardPackage();
      throw Object.assign(new Error(policyError.message), { statusCode: policyError.statusCode });
    }

    // A plugin with relay hooks of its own: its module must be in the
    // package; its SHA-256 goes into the hook set's digest, which an admin
    // approves before Lamaste runs it.
    let hooksEntrySha256 = null;
    try {
      hooksEntrySha256 = await installedHookEntrySha256(packageName, manifest);
    } catch (err) {
      await discardPackage();
      throw Object.assign(new Error(err.message), { statusCode: err.statusCode || 400 });
    }

    // An agent half Lamaste installs: its tarball's integrity is pinned now,
    // from the registry this install used — the approval covers it and the
    // agent installs only a tarball that matches it.
    let agentHalfPin = null;
    try {
      agentHalfPin = await pinAgentHalf(manifest);
    } catch (err) {
      await discardPackage();
      throw Object.assign(new Error(err.message), { statusCode: err.statusCode || 400 });
    }

    // A name another installed package already uses would fail the INSERT
    // below and leave this package behind.
    if (s.selectByName.get(manifest.name)) {
      await discardPackage();
      throw Object.assign(new Error(`A plugin named "${manifest.name}" is already installed`), {
        statusCode: 409,
      });
    }
    // So would its route (unique index): one installed plugin per route.
    const route = derivePluginRoute(manifest.name);
    const routeOwner = s.selectByRoute.get(route);
    if (routeOwner) {
      await discardPackage();
      throw routeTakenError(manifest.name, route, routeOwner.name);
    }

    // Create the plugin state directory
    const pluginDir = path.join(PLUGINS_DIR, manifest.name);
    await mkdir(pluginDir, { recursive: true, mode: 0o700 });

    // Build the entry, then persist via INSERT
    const entry = {
      name: manifest.name,
      route,
      displayName: manifest.displayName,
      packageName,
      version: manifest.version,
      description: manifest.description,
      capabilities: manifest.capabilities,
      packages: manifest.packages,
      panel: manifest.panel,
      config: manifest.config,
      modes: manifest.modes,
      hosting: manifest.hosting,
      agent: manifest.agent,
      hooks: manifest.hooks,
      hooksEntrySha256,
      agentHalfPin,
      status: 'disabled',
      installedAt: new Date().toISOString(),
    };

    s.begin.run();
    try {
      s.insert.run(
        entry.name,
        entry.route,
        nullableString(entry.displayName),
        entry.packageName,
        entry.version,
        nullableString(entry.description),
        JSON.stringify(entry.capabilities ?? []),
        nullableJson(entry.packages),
        nullableJson(entry.panel),
        nullableJson(entry.config),
        nullableJson(entry.modes),
        entry.hosting,
        nullableJson(entry.agent),
        nullableJson(entry.hooks),
        nullableString(entry.hooksEntrySha256),
        nullableJson(entry.agentHalfPin),
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
    const oidcClients = await syncOidcClientsBestEffort(logger);
    return { ...entry, oidcClients };
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

    // A hosted plugin is uninstalled by an operation that runs its
    // uninstall pipeline first (plugin-lifecycle.js); by the time it gets
    // here the hosting is gone.
    if (hasAgentHalf(plugin)) {
      const { isPluginHosted } = await import('./plugin-hosting.js');
      if (await isPluginHosted(name)) {
        throw Object.assign(
          new Error(`Plugin "${name}" is hosted on an agent — its hosting is removed first`),
          { statusCode: 409 },
        );
      }
    }

    // Its relay hook runner and approval go with it: a later install of the
    // plugin is approved afresh.
    const { removeRelayHooks } = await import('./plugin-hooks.js');
    await removeRelayHooks(name, logger);

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
    // (the plugin is already gone), but logged loudly. A plugin without a
    // route of its own shares its namespace with the plugin that holds the
    // route: the capabilities are that plugin's, and stay.
    try {
      const route = plugin.route;
      if (route === null) {
        logger.warn(
          { name, route: derivePluginRoute(plugin.name) },
          'Plugin shares its route with another installed plugin — its capabilities are left in place',
        );
      } else {
        const diffs = await revokePluginCapabilitiesFromAgents(route);
        if (diffs.length > 0) {
          logger.info(
            { name, route, diffs },
            'Revoked plugin capabilities from agents on uninstall',
          );
        }
      }
    } catch (err) {
      logger.warn(
        { name, err: err.message },
        'Failed to sweep plugin capabilities from agent registry on uninstall',
      );
    }

    logger.info({ name }, 'Plugin uninstalled');
    await syncOidcClientsBestEffort(logger);
    return { ok: true, name };
  });
}

// --- In-place update (agent-hosted plugins) ---

const updateRowSql = `
  UPDATE plugins SET
    display_name = ?, version = ?, description = ?, capabilities = ?, packages = ?, panel = ?,
    config = ?, modes = ?, hosting = ?, agent = ?, hooks = ?, hooks_entry_sha256 = ?,
    agent_half_pin = ?
  WHERE name = ?`;

/**
 * Rewrite an installed plugin's row from a manifest (an update, or its
 * reversal) with the agent half pinned for that version (null when Lamaste
 * installs none). Status and install time stay.
 */
export async function writePluginRow(name, manifest, hooksEntrySha256, agentHalfPin) {
  const s = await getStmts();
  s.db
    .prepare(updateRowSql)
    .run(
      nullableString(manifest.displayName),
      manifest.version,
      nullableString(manifest.description),
      JSON.stringify(manifest.capabilities ?? []),
      nullableJson(manifest.packages),
      nullableJson(manifest.panel),
      nullableJson(manifest.config),
      nullableJson(manifest.modes),
      manifest.hosting ?? DEFAULT_PLUGIN_HOSTING,
      nullableJson(manifest.agent),
      nullableJson(manifest.hooks),
      nullableString(hooksEntrySha256),
      nullableJson(agentHalfPin),
      name,
    );
}

/**
 * Install `<packageName>@<version>` over the installed copy and read it
 * back: the validated manifest and its relay entry module's SHA-256. The
 * row is not touched — the caller compares the result with what was
 * reviewed and then writes it. Refuses a package whose manifest names
 * another plugin.
 */
export function replacePluginPackage(name, packageName, version, logger) {
  return withPluginLock(async () => {
    const bare = bareLamalibrePackageName(packageName);
    const spec = `${bare}@${version}`;
    assertSafeLamalibrePackage(spec);
    logger?.info({ name, spec }, 'Installing plugin package version');
    try {
      await execa('npm', ['install', '--ignore-scripts', spec], {
        cwd: STATE_DIR,
        timeout: 120000,
      });
    } catch (err) {
      logger?.error({ spec, stderr: err.stderr, err: err.message }, 'npm install failed');
      throw Object.assign(new Error(`Failed to install "${spec}"`), { statusCode: 502 });
    }
    const require = createRequire(`${STATE_DIR}/`);
    const manifestPath = require.resolve(`${bare}/lamaste-plugin.json`);
    const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf-8')));
    if (manifest.name !== name) {
      throw Object.assign(new Error(`${spec} is plugin "${manifest.name}", not "${name}"`), {
        statusCode: 400,
      });
    }
    if (manifest.version !== version) {
      throw Object.assign(
        new Error(`${spec} installed version ${manifest.version} according to its manifest`),
        { statusCode: 400 },
      );
    }
    const hooksEntrySha256 = await installedHookEntrySha256(packageName, manifest);
    return { manifest, hooksEntrySha256 };
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
    const oidcClients = await syncOidcClientsBestEffort(logger);
    return { ok: true, name, status: 'enabled', oidcClients };
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
    await syncOidcClientsBestEffort(logger);
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
    // `plugin:<route>:host` is never declared: Lamaste contributes it for
    // every installed agent-hosted plugin with an agent half, enabled or
    // not — hosting is an administrator's binding and outlives a disable.
    if (row.hosting === 'agent' && row.agent != null && row.route != null) {
      caps.push(pluginHostCapability(row.route));
    }
  }
  return [...new Set(caps)];
}

/**
 * One installed plugin by name, or null.
 * @param {string} name
 */
export async function findPlugin(name) {
  const s = await getStmts();
  const row = s.selectByName.get(name);
  return row ? rowToPlugin(row) : null;
}

/**
 * The installed plugin that holds route `route`, or null.
 * @param {string} route
 */
export async function findPluginByRoute(route) {
  const s = await getStmts();
  const row = s.selectByRoute.get(route);
  return row ? rowToPlugin(row) : null;
}

/** 409 `route_taken`: another installed plugin holds the route. */
function routeTakenError(name, route, owner) {
  return Object.assign(
    new Error(
      `Plugin "${name}" would use route "${route}", which installed plugin "${owner}" holds — a route (the name without "-server" or "-agent") names one plugin's API, capabilities, hosting and agent half`,
    ),
    { statusCode: 409, code: 'route_taken', route, owner },
  );
}
