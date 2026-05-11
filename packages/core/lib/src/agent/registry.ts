/**
 * Multi-agent registry management.
 *
 * Registry file: ~/.lamalibre/lamaste/agents.json
 * Per-agent data: ~/.lamalibre/lamaste/agents/<label>/
 */

import { readFile, writeFile, rename, mkdir, cp, unlink, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PromiseChainMutex, atomicWriteJSON } from '../file-helpers.js';
import { productUnit } from '../branding.js';
import {
  LAMASTE_DIR,
  AGENTS_REGISTRY_PATH,
  LEGACY_CONFIG_PATH,
  LEGACY_PLIST_LABEL,
  LEGACY_PLIST_PATH,
  LEGACY_LOG_FILE,
  LEGACY_ERROR_LOG_FILE,
  LEGACY_SERVICE_CONFIG_PATH,
  isDarwin,
  agentDataDir,
  agentLogsDir,
  agentLogFile,
  agentErrorLogFile,
  agentConfigPath,
  agentPluginsFile,
  agentPluginsDir,
  plistLabel,
  plistPath,
  systemdUnitName,
  systemdUnitPath,
} from './platform.js';
import { runUserSystemctl } from './user-systemd-env.js';

// ---------------------------------------------------------------------------
// Concurrency control
// ---------------------------------------------------------------------------

// Module-level mutex serializes every read-modify-write on agents.json so that
// concurrent CLI/daemon invocations cannot clobber each other. The Promise-chain
// mutex is the same primitive used by all other registries in @lamalibre/lamaste.
const registryMutex = new PromiseChainMutex();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentRegistryEntry {
  label: string;
  panelUrl: string;
  authMethod: 'p12' | 'keychain';
  p12Path?: string | undefined;
  keychainIdentity?: string | undefined;
  agentLabel?: string | undefined;
  domain?: string | undefined;
  chiselVersion?: string | undefined;
  setupAt?: string | undefined;
  updatedAt?: string | undefined;
  // Pinned fingerprint of the chisel server's TLS cert (hex-encoded SHA-256).
  // Captured at setup and injected as --tls-fingerprint when the agent starts.
  chiselServerCertSha256Hex?: string | undefined;
  // Pinned fingerprints for the panel server's TLS cert (B10 TOFU capture).
  // Used by panel-cert.js and the CLI's `panel reset-pin` command.
  panelServerPubkeySha256?: string | undefined;
  panelServerCertSha256Hex?: string | undefined;
  panelServerCertPinnedAt?: string | undefined;
  // Agent management panel (separate Fastify server on :9393 per agent).
  panelEnabled?: boolean | undefined;
  panelPort?: number | undefined;
}

export interface AgentRegistry {
  version: number;
  currentLabel: string | null;
  agents: AgentRegistryEntry[];
}

// ---------------------------------------------------------------------------
// Label validation
// ---------------------------------------------------------------------------

/**
 * Label validation regex: lowercase alphanumeric and hyphens, 1-63 chars,
 * must start and end with a letter or digit.
 */
const LABEL_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Validate an agent label. */
export function validateLabel(label: string): void {
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
 */
export function deriveLabel(domain: string | undefined, agentLabel: string | undefined): string {
  const raw = agentLabel ?? domain ?? 'default';
  // Take the leftmost DNS label and lowercase it. Labels are capped at 63
  // characters by RFC 1035 — slice before the per-character normalisation so
  // downstream string ops always operate on a bounded buffer.
  const head = raw.split('.', 1)[0]!.toLowerCase().slice(0, 63);
  const normalised = head.replace(/[^a-z0-9-]/g, '-');
  // Trim leading/trailing '-' deterministically (no regex quantifier
  // backtracking on inputs full of hyphens).
  let start = 0;
  let end = normalised.length;
  while (start < end && normalised.charCodeAt(start) === 0x2d /* '-' */) start++;
  while (end > start && normalised.charCodeAt(end - 1) === 0x2d /* '-' */) end--;
  const candidate = normalised.slice(start, end);
  if (candidate.length > 0 && LABEL_REGEX.test(candidate)) {
    return candidate;
  }
  return 'default';
}

// ---------------------------------------------------------------------------
// Registry I/O
// ---------------------------------------------------------------------------

/** Load the agents registry. Returns null if file does not exist. */
export async function loadRegistry(): Promise<AgentRegistry | null> {
  try {
    const raw = await readFile(AGENTS_REGISTRY_PATH, 'utf8');
    return JSON.parse(raw) as AgentRegistry;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Failed to read agents registry: ${(err as Error).message}`);
  }
}

/** Save the agents registry atomically (write tmp -> fsync -> rename). */
export async function saveRegistry(registry: AgentRegistry): Promise<void> {
  await atomicWriteJSON(AGENTS_REGISTRY_PATH, registry, {
    mkdirp: true,
    dirMode: 0o700,
    mode: 0o600,
  });
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/** Get a specific agent entry from the registry. */
export async function getAgent(label: string): Promise<AgentRegistryEntry | null> {
  const registry = await loadRegistry();
  if (!registry) return null;
  return registry.agents.find((a) => a.label === label) ?? null;
}

/** Add an agent entry to the registry. */
export async function addAgent(entry: AgentRegistryEntry): Promise<void> {
  validateLabel(entry.label);
  return registryMutex.run(async () => {
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
  });
}

/**
 * Add or update an agent entry in the registry.
 * If the agent already exists, its fields are merged with the new entry
 * and it becomes the current agent. Otherwise, it is added.
 */
export async function upsertAgent(entry: AgentRegistryEntry): Promise<void> {
  validateLabel(entry.label);
  return registryMutex.run(async () => {
    let registry = await loadRegistry();
    if (!registry) {
      registry = { version: 1, currentLabel: null, agents: [] };
    }
    const idx = registry.agents.findIndex((a) => a.label === entry.label);
    if (idx >= 0) {
      registry.agents[idx] = { ...registry.agents[idx]!, ...entry };
    } else {
      registry.agents.push(entry);
    }
    registry.currentLabel = entry.label;
    await saveRegistry(registry);
  });
}

/** Remove an agent entry from the registry. */
export async function removeAgent(label: string): Promise<void> {
  return registryMutex.run(async () => {
    const registry = await loadRegistry();
    if (!registry) return;
    registry.agents = registry.agents.filter((a) => a.label !== label);
    if (registry.currentLabel === label) {
      registry.currentLabel =
        registry.agents.length > 0 ? (registry.agents[0]?.label ?? null) : null;
    }
    await saveRegistry(registry);
  });
}

/** Set the current (default) agent. */
export async function setCurrentAgent(label: string): Promise<void> {
  return registryMutex.run(async () => {
    const registry = await loadRegistry();
    if (!registry) {
      throw new Error('No agents registry found. Run "lamaste-agent setup" first.');
    }
    if (!registry.agents.some((a) => a.label === label)) {
      throw new Error(`Agent "${label}" not found in registry`);
    }
    registry.currentLabel = label;
    await saveRegistry(registry);
  });
}

/** List all agent entries. */
export async function listAgents(): Promise<AgentRegistryEntry[]> {
  const registry = await loadRegistry();
  return registry ? registry.agents : [];
}

/** Get the current label from the registry. */
export async function getCurrentLabel(): Promise<string | null> {
  const registry = await loadRegistry();
  return registry ? registry.currentLabel : null;
}

/**
 * Resolve which agent label to use.
 * Priority: explicit --label > registry currentLabel > single-agent > migration > error
 */
export async function resolveLabel(explicitLabel?: string | undefined): Promise<string> {
  if (explicitLabel) {
    validateLabel(explicitLabel);
    return explicitLabel;
  }

  const registry = await loadRegistry();
  if (registry) {
    if (registry.currentLabel) return registry.currentLabel;
    if (registry.agents.length === 1 && registry.agents[0]) return registry.agents[0].label;
    if (registry.agents.length > 1) {
      throw new Error(
        'Multiple agents configured. Use --label to specify one, or "lamaste-agent switch <label>".',
      );
    }
  }

  // Check for legacy agent.json and migrate
  if (existsSync(LEGACY_CONFIG_PATH)) {
    const label = await migrateFromLegacy();
    return label;
  }

  throw new Error('No agents configured. Run "lamaste-agent setup" first.');
}

// ---------------------------------------------------------------------------
// Legacy migration
// ---------------------------------------------------------------------------

/**
 * Migrate from legacy single-agent config to multi-agent registry.
 * - Reads ~/.lamalibre/lamaste/agent.json
 * - Creates per-agent directory
 * - Moves files
 * - Updates service file
 * - Creates registry
 * - Backs up agent.json
 */
export async function migrateFromLegacy(): Promise<string> {
  const raw = await readFile(LEGACY_CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw) as Record<string, unknown>;

  // Default authMethod for backward compatibility
  if (!config['authMethod']) {
    config['authMethod'] = 'p12';
  }

  const label = deriveLabel(
    config['domain'] as string | undefined,
    config['agentLabel'] as string | undefined,
  );
  validateLabel(label);
  const dataDir = agentDataDir(label);
  const logsDir = agentLogsDir(label);

  // Create per-agent directory structure
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await mkdir(logsDir, { recursive: true, mode: 0o700 });

  // Move config
  await writeFile(agentConfigPath(label), JSON.stringify(config, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });

  // Move cert files if they exist
  const filesToMove = [
    { src: path.join(LAMASTE_DIR, 'client.p12'), dst: path.join(dataDir, 'client.p12') },
    { src: path.join(LAMASTE_DIR, 'ca.crt'), dst: path.join(dataDir, 'ca.crt') },
  ];

  for (const { src, dst } of filesToMove) {
    if (existsSync(src)) {
      await cp(src, dst, { force: true });
    }
  }

  // Move log files if they exist
  const logFiles = [
    { src: LEGACY_LOG_FILE, dst: agentLogFile(label) },
    { src: LEGACY_ERROR_LOG_FILE, dst: agentErrorLogFile(label) },
  ];

  for (const { src, dst } of logFiles) {
    if (existsSync(src)) {
      await cp(src, dst, { force: true });
    }
  }

  // Move plugins if they exist
  const legacyPluginsFile = path.join(LAMASTE_DIR, 'plugins.json');
  if (existsSync(legacyPluginsFile)) {
    await cp(legacyPluginsFile, agentPluginsFile(label), { force: true });
  }
  const legacyPluginsDir = path.join(LAMASTE_DIR, 'plugins');
  if (existsSync(legacyPluginsDir)) {
    await cp(legacyPluginsDir, agentPluginsDir(label), { recursive: true, force: true });
  }

  // Move services.json if it exists
  const legacyServicesFile = path.join(LAMASTE_DIR, 'services.json');
  if (existsSync(legacyServicesFile)) {
    await cp(legacyServicesFile, path.join(dataDir, 'services.json'), { force: true });
  }

  // Update service file to use new label and paths
  await migrateServiceFile(label);

  // Update p12Path in config if it pointed to the old location
  const p12Path = config['p12Path'] as string | undefined;
  if (p12Path) {
    const oldP12 = path.join(LAMASTE_DIR, 'client.p12');
    if (p12Path === oldP12) {
      config['p12Path'] = path.join(dataDir, 'client.p12');
      await writeFile(agentConfigPath(label), JSON.stringify(config, null, 2) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
      });
    }
  }

  // Create registry
  const registry: AgentRegistry = {
    version: 1,
    currentLabel: label,
    agents: [
      {
        label,
        panelUrl: config['panelUrl'] as string,
        authMethod: (config['authMethod'] as 'p12' | 'keychain') ?? 'p12',
        p12Path: config['p12Path'] as string | undefined,
        keychainIdentity: (config['keychainIdentity'] as string | undefined) ?? undefined,
        agentLabel: (config['agentLabel'] as string | undefined) ?? undefined,
        domain: (config['domain'] as string | undefined) ?? undefined,
        chiselVersion: (config['chiselVersion'] as string | undefined) ?? undefined,
        setupAt: (config['setupAt'] as string | undefined) ?? undefined,
        updatedAt: (config['updatedAt'] as string | undefined) ?? undefined,
      },
    ],
  };
  await saveRegistry(registry);

  // Clean up legacy files (originals already copied to per-agent directory)
  const legacyFiles = [
    path.join(LAMASTE_DIR, 'client.p12'),
    path.join(LAMASTE_DIR, 'ca.crt'),
    LEGACY_LOG_FILE,
    LEGACY_ERROR_LOG_FILE,
    path.join(LAMASTE_DIR, 'plugins.json'),
    path.join(LAMASTE_DIR, 'services.json'),
  ];
  for (const f of legacyFiles) {
    await unlink(f).catch(() => {});
  }
  const legacyPluginsDirPath = path.join(LAMASTE_DIR, 'plugins');
  if (existsSync(legacyPluginsDirPath)) {
    await rm(legacyPluginsDirPath, { recursive: true, force: true }).catch(() => {});
  }

  // Backup the old config
  await rename(LEGACY_CONFIG_PATH, LEGACY_CONFIG_PATH + '.backup');

  return label;
}

/**
 * Migrate the legacy service file to use a per-agent label and paths.
 * Best-effort — failure here does not block the migration.
 */
async function migrateServiceFile(label: string): Promise<void> {
  const legacyServicePath = LEGACY_SERVICE_CONFIG_PATH;
  if (!existsSync(legacyServicePath)) return;

  try {
    const content = await readFile(legacyServicePath, 'utf8');
    const newLogFile = agentLogFile(label);
    const newErrorLogFile = agentErrorLogFile(label);

    let updated: string;
    if (isDarwin()) {
      // Replace plist label and log paths
      updated = content
        .replace(`<string>${LEGACY_PLIST_LABEL}</string>`, `<string>${plistLabel(label)}</string>`)
        .replace(`<string>${LEGACY_LOG_FILE}</string>`, `<string>${newLogFile}</string>`)
        .replace(
          `<string>${LEGACY_ERROR_LOG_FILE}</string>`,
          `<string>${newErrorLogFile}</string>`,
        );

      // Write to new path
      const newPath = plistPath(label);
      const dir = path.dirname(newPath);
      await mkdir(dir, { recursive: true });
      const tmp = newPath + '.tmp';
      await writeFile(tmp, updated, 'utf8');
      await rename(tmp, newPath);
    } else {
      // Replace systemd log paths and switch to user-level install target
      // (legacy unit was system-level with WantedBy=multi-user.target; the new
      // unit lives under ~/.config/systemd/user/ and must target default.target).
      updated = content
        .replace(`append:${LEGACY_LOG_FILE}`, `append:${newLogFile}`)
        .replace(`append:${LEGACY_ERROR_LOG_FILE}`, `append:${newErrorLogFile}`)
        .replace(
          `ReadWritePaths=${path.dirname(LEGACY_LOG_FILE)}`,
          `ReadWritePaths=${agentLogsDir(label)}`,
        )
        .replace('WantedBy=multi-user.target', 'WantedBy=default.target');

      // Write to new (user-level) path
      const newPath = systemdUnitPath(label);
      const dir = path.dirname(newPath);
      await mkdir(dir, { recursive: true });
      const tmp = newPath + '.tmp';
      await writeFile(tmp, updated, { encoding: 'utf8', mode: 0o644 });
      await rename(tmp, newPath);
    }

    // Unload old service, load new one
    const { execa } = await import('execa');
    if (isDarwin()) {
      try {
        await execa('launchctl', ['unload', LEGACY_PLIST_PATH]);
      } catch {
        // May not be loaded
      }
      try {
        await execa('launchctl', ['load', plistPath(label)]);
      } catch {
        // Best-effort
      }
    } else {
      // Legacy unit lives at /etc/systemd/system/ (system-level). The new unit
      // lives under ~/.config/systemd/user/ and uses --user. Disable the legacy
      // unit best-effort (may need sudo), then load the new user-level unit.
      try {
        // Legacy single-agent unit name (no per-label suffix).
        await execa('systemctl', ['disable', '--now', productUnit('chisel')]);
      } catch {
        // May not be active or may require sudo — best-effort
      }
      await runUserSystemctl(['daemon-reload']);
      try {
        await runUserSystemctl(['enable', '--now', systemdUnitName(label)]);
      } catch {
        // Best-effort
      }
    }
  } catch {
    // Migration of service file is best-effort; agent can be re-updated manually
  }
}
