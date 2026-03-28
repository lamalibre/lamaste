/**
 * Multi-agent registry management.
 *
 * Registry file: ~/.portlama/agents.json
 * Per-agent data: ~/.portlama/agents/<label>/
 */

import { readFile, writeFile, rename, mkdir, cp, open, unlink, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  AGENT_DIR,
  CONFIG_PATH,
  PLIST_LABEL,
  PLIST_PATH,
  LOG_FILE,
  ERROR_LOG_FILE,
  SERVICE_CONFIG_PATH,
  isDarwin,
  agentDataDir,
  agentLogsDir,
  agentLogFile,
  agentErrorLogFile,
  plistLabel,
  plistPath,
  systemdUnitName,
  systemdUnitPath,
  agentPluginsFile,
  agentPluginsDir,
  agentConfigPath,
} from './platform.js';

const REGISTRY_PATH = path.join(AGENT_DIR, 'agents.json');

/**
 * Label validation regex: lowercase alphanumeric and hyphens, 1-63 chars,
 * must start and end with a letter or digit.
 */
const LABEL_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Validate an agent label.
 * @param {string} label
 * @throws {Error} if invalid
 */
export function validateLabel(label) {
  if (typeof label !== 'string') {
    throw new Error('Agent label must be a string');
  }
  if (label.length === 0 || label.length > 63) {
    throw new Error('Agent label must be 1-63 characters');
  }
  if (!LABEL_REGEX.test(label)) {
    throw new Error(
      `Invalid agent label "${label}". Must be lowercase alphanumeric and hyphens, ` +
        'starting and ending with a letter or digit.',
    );
  }
  // Reject path traversal attempts
  if (label.includes('..') || label.includes('/') || label.includes('\\')) {
    throw new Error('Agent label contains forbidden characters');
  }
}

/**
 * Derive a valid label from a domain or agent label string.
 * Falls back to "default" if derivation fails.
 * @param {string | undefined} domain
 * @param {string | undefined} agentLabel
 * @returns {string}
 */
export function deriveLabel(domain, agentLabel) {
  const raw = agentLabel || domain || 'default';
  // Take the first subdomain component, sanitize to label format
  const candidate = raw
    .split('.')[0]
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  if (candidate.length > 0 && LABEL_REGEX.test(candidate)) {
    return candidate;
  }
  return 'default';
}

/**
 * Load the agents registry.
 * @returns {Promise<{ version: number, currentLabel: string | null, agents: object[] } | null>}
 */
export async function loadRegistry() {
  try {
    const raw = await readFile(REGISTRY_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Failed to read agents registry: ${err.message}`);
  }
}

/**
 * Save the agents registry atomically (write tmp -> rename).
 * @param {{ version: number, currentLabel: string | null, agents: object[] }} registry
 */
export async function saveRegistry(registry) {
  await mkdir(AGENT_DIR, { recursive: true, mode: 0o700 });
  const tmp = REGISTRY_PATH + '.tmp';
  await writeFile(tmp, JSON.stringify(registry, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  const fd = await open(tmp, 'r');
  await fd.sync();
  await fd.close();
  await rename(tmp, REGISTRY_PATH);
}

/**
 * Get a specific agent entry from the registry.
 * @param {string} label
 * @returns {Promise<object | null>}
 */
export async function getAgent(label) {
  const registry = await loadRegistry();
  if (!registry) return null;
  return registry.agents.find((a) => a.label === label) || null;
}

/**
 * Add an agent entry to the registry.
 * @param {object} entry - Must include `label`
 */
export async function addAgent(entry) {
  validateLabel(entry.label);
  let registry = await loadRegistry();
  if (!registry) {
    registry = { version: 1, currentLabel: null, agents: [] };
  }
  if (registry.agents.some((a) => a.label === entry.label)) {
    throw new Error(`Agent "${entry.label}" already exists in registry`);
  }
  registry.agents.push(entry);
  // If this is the first agent, set as current
  if (!registry.currentLabel) {
    registry.currentLabel = entry.label;
  }
  await saveRegistry(registry);
}

/**
 * Add or update an agent entry in the registry.
 * If the agent already exists, its fields are merged with the new entry
 * and it becomes the current agent. Otherwise, it is added.
 * @param {object} entry - Must include `label`
 */
export async function upsertAgent(entry) {
  validateLabel(entry.label);
  let registry = await loadRegistry();
  if (!registry) {
    registry = { version: 1, currentLabel: null, agents: [] };
  }
  const idx = registry.agents.findIndex((a) => a.label === entry.label);
  if (idx >= 0) {
    registry.agents[idx] = { ...registry.agents[idx], ...entry };
  } else {
    registry.agents.push(entry);
  }
  registry.currentLabel = entry.label;
  await saveRegistry(registry);
}

/**
 * Remove an agent entry from the registry.
 * @param {string} label
 */
export async function removeAgent(label) {
  const registry = await loadRegistry();
  if (!registry) return;
  registry.agents = registry.agents.filter((a) => a.label !== label);
  if (registry.currentLabel === label) {
    registry.currentLabel = registry.agents.length > 0 ? registry.agents[0].label : null;
  }
  await saveRegistry(registry);
}

/**
 * Set the current (default) agent.
 * @param {string} label
 */
export async function setCurrentAgent(label) {
  const registry = await loadRegistry();
  if (!registry) {
    throw new Error('No agents registry found. Run "portlama-agent setup" first.');
  }
  if (!registry.agents.some((a) => a.label === label)) {
    throw new Error(`Agent "${label}" not found in registry`);
  }
  registry.currentLabel = label;
  await saveRegistry(registry);
}

/**
 * List all agent entries.
 * @returns {Promise<object[]>}
 */
export async function listAgents() {
  const registry = await loadRegistry();
  return registry ? registry.agents : [];
}

/**
 * Get the current label from the registry.
 * @returns {Promise<string | null>}
 */
export async function getCurrentLabel() {
  const registry = await loadRegistry();
  return registry ? registry.currentLabel : null;
}

/**
 * Resolve which agent label to use.
 * Priority: explicit --label > registry currentLabel > single-agent > migration > error
 * @param {string | undefined} explicitLabel
 * @returns {Promise<string>}
 */
export async function resolveLabel(explicitLabel) {
  if (explicitLabel) {
    validateLabel(explicitLabel);
    return explicitLabel;
  }

  const registry = await loadRegistry();
  if (registry) {
    if (registry.currentLabel) return registry.currentLabel;
    if (registry.agents.length === 1) return registry.agents[0].label;
    if (registry.agents.length > 1) {
      throw new Error(
        'Multiple agents configured. Use --label to specify one, or "portlama-agent switch <label>".',
      );
    }
  }

  // Check for legacy agent.json and migrate
  if (existsSync(CONFIG_PATH)) {
    const label = await migrateFromLegacy();
    return label;
  }

  throw new Error('No agents configured. Run "portlama-agent setup" first.');
}

/**
 * Migrate from legacy single-agent config to multi-agent registry.
 * - Reads ~/.portlama/agent.json
 * - Creates per-agent directory
 * - Moves files
 * - Updates service file
 * - Creates registry
 * - Backs up agent.json
 *
 * @returns {Promise<string>} The migrated agent label
 */
export async function migrateFromLegacy() {
  const raw = await readFile(CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw);

  // Default authMethod for backward compatibility
  if (!config.authMethod) {
    config.authMethod = 'p12';
  }

  const label = deriveLabel(config.domain, config.agentLabel);
  validateLabel(label);
  const dataDir = agentDataDir(label);
  const logsDir = agentLogsDir(label);

  // Create per-agent directory structure
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await mkdir(logsDir, { recursive: true, mode: 0o700 });

  // Move config
  await writeFile(
    agentConfigPath(label),
    JSON.stringify(config, null, 2) + '\n',
    { encoding: 'utf8', mode: 0o600 },
  );

  // Move cert files if they exist
  const filesToMove = [
    { src: path.join(AGENT_DIR, 'client.p12'), dst: path.join(dataDir, 'client.p12') },
    { src: path.join(AGENT_DIR, 'ca.crt'), dst: path.join(dataDir, 'ca.crt') },
  ];

  for (const { src, dst } of filesToMove) {
    if (existsSync(src)) {
      await cp(src, dst, { force: true });
    }
  }

  // Move log files if they exist
  const logFiles = [
    { src: LOG_FILE, dst: agentLogFile(label) },
    { src: ERROR_LOG_FILE, dst: agentErrorLogFile(label) },
  ];

  for (const { src, dst } of logFiles) {
    if (existsSync(src)) {
      await cp(src, dst, { force: true });
    }
  }

  // Move plugins if they exist
  const legacyPluginsFile = path.join(AGENT_DIR, 'plugins.json');
  if (existsSync(legacyPluginsFile)) {
    await cp(legacyPluginsFile, agentPluginsFile(label), { force: true });
  }
  const legacyPluginsDir = path.join(AGENT_DIR, 'plugins');
  if (existsSync(legacyPluginsDir)) {
    await cp(legacyPluginsDir, agentPluginsDir(label), { recursive: true, force: true });
  }

  // Move services.json if it exists
  const legacyServicesFile = path.join(AGENT_DIR, 'services.json');
  if (existsSync(legacyServicesFile)) {
    await cp(legacyServicesFile, path.join(dataDir, 'services.json'), { force: true });
  }

  // Update service file to use new label and paths
  await migrateServiceFile(label, config);

  // Update p12Path in config if it pointed to the old location
  if (config.p12Path) {
    const oldP12 = path.join(AGENT_DIR, 'client.p12');
    if (config.p12Path === oldP12) {
      config.p12Path = path.join(dataDir, 'client.p12');
      await writeFile(
        agentConfigPath(label),
        JSON.stringify(config, null, 2) + '\n',
        { encoding: 'utf8', mode: 0o600 },
      );
    }
  }

  // Create registry
  const registry = {
    version: 1,
    currentLabel: label,
    agents: [
      {
        label,
        panelUrl: config.panelUrl,
        authMethod: config.authMethod,
        p12Path: config.p12Path,
        keychainIdentity: config.keychainIdentity || null,
        agentLabel: config.agentLabel || null,
        domain: config.domain || null,
        chiselVersion: config.chiselVersion || null,
        setupAt: config.setupAt || null,
        updatedAt: config.updatedAt || null,
      },
    ],
  };
  await saveRegistry(registry);

  // Clean up legacy files (originals already copied to per-agent directory)
  const legacyFiles = [
    path.join(AGENT_DIR, 'client.p12'),
    path.join(AGENT_DIR, 'ca.crt'),
    LOG_FILE,
    ERROR_LOG_FILE,
    path.join(AGENT_DIR, 'plugins.json'),
    path.join(AGENT_DIR, 'services.json'),
  ];
  for (const f of legacyFiles) {
    await unlink(f).catch(() => {});
  }
  const legacyPluginsDirPath = path.join(AGENT_DIR, 'plugins');
  if (existsSync(legacyPluginsDirPath)) {
    await rm(legacyPluginsDirPath, { recursive: true, force: true }).catch(() => {});
  }

  // Backup the old config
  await rename(CONFIG_PATH, CONFIG_PATH + '.backup');

  return label;
}

/**
 * Migrate the legacy service file to use a per-agent label and paths.
 * @param {string} label
 * @param {object} config
 */
async function migrateServiceFile(label, _config) {
  const legacyServicePath = SERVICE_CONFIG_PATH;
  if (!existsSync(legacyServicePath)) return;

  try {
    const content = await readFile(legacyServicePath, 'utf8');
    const newLogFile = agentLogFile(label);
    const newErrorLogFile = agentErrorLogFile(label);

    let updated;
    if (isDarwin()) {
      // Replace plist label and log paths
      updated = content
        .replace(`<string>${PLIST_LABEL}</string>`, `<string>${plistLabel(label)}</string>`)
        .replace(`<string>${LOG_FILE}</string>`, `<string>${newLogFile}</string>`)
        .replace(`<string>${ERROR_LOG_FILE}</string>`, `<string>${newErrorLogFile}</string>`);

      // Write to new path
      const newPath = plistPath(label);
      const dir = path.dirname(newPath);
      await mkdir(dir, { recursive: true });
      const tmp = newPath + '.tmp';
      await writeFile(tmp, updated, 'utf8');
      await rename(tmp, newPath);
    } else {
      // Replace systemd log paths
      updated = content
        .replace(`append:${LOG_FILE}`, `append:${newLogFile}`)
        .replace(`append:${ERROR_LOG_FILE}`, `append:${newErrorLogFile}`)
        .replace(`ReadWritePaths=${path.dirname(LOG_FILE)}`, `ReadWritePaths=${agentLogsDir(label)}`);

      // Write to new path
      const newPath = systemdUnitPath(label);
      const tmp = newPath + '.tmp';
      await writeFile(tmp, updated, { encoding: 'utf8', mode: 0o644 });
      await rename(tmp, newPath);
    }

    // Unload old service, load new one
    if (isDarwin()) {
      const { execa } = await import('execa');
      try {
        await execa('launchctl', ['unload', PLIST_PATH]);
      } catch {
        // May not be loaded
      }
      try {
        await execa('launchctl', ['load', plistPath(label)]);
      } catch {
        // Best-effort
      }
    } else {
      const { execa } = await import('execa');
      try {
        await execa('systemctl', ['disable', '--now', 'portlama-chisel']);
      } catch {
        // May not be active
      }
      await execa('systemctl', ['daemon-reload']);
      try {
        await execa('systemctl', ['enable', '--now', systemdUnitName(label)]);
      } catch {
        // Best-effort
      }
    }
  } catch {
    // Migration of service file is best-effort; agent can be re-updated manually
  }
}
