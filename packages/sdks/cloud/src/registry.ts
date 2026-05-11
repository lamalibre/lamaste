/**
 * Server registry — manages ~/.lamalibre/lamaste/servers.json.
 *
 * Stores the list of provisioned and adopted servers.
 * Uses atomic writes (temp → 0600 → fsync → rename) for safety.
 */

import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { atomicWriteJSON } from '@lamalibre/lamaste';
import { LEGACY_CONFIG_PATH, SERVERS_REGISTRY_PATH } from '@lamalibre/lamaste/agent';
import type { ServerEntry } from './types.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function registryPath(): string {
  return SERVERS_REGISTRY_PATH;
}

function agentConfigPath(): string {
  return LEGACY_CONFIG_PATH;
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

/**
 * Load the server registry. Returns an empty array if the file does not exist.
 */
export async function loadServers(): Promise<ServerEntry[]> {
  try {
    const raw = await readFile(registryPath(), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ServerEntry[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Atomically save the server registry.
 */
export async function saveServers(entries: readonly ServerEntry[]): Promise<void> {
  await atomicWriteJSON(registryPath(), entries, {
    mkdirp: true,
    dirMode: 0o700,
    mode: 0o600,
  });
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Add a server to the registry.
 * If `active` is true, deactivates all other servers first.
 */
export async function addServer(entry: ServerEntry): Promise<void> {
  const servers = await loadServers();

  const updated = entry.active
    ? servers.map((s) => ({ ...s, active: false }))
    : [...servers];

  updated.push(entry);
  await saveServers(updated);
}

/**
 * Remove a server from the registry by ID.
 */
export async function removeServer(id: string): Promise<void> {
  const servers = await loadServers();
  const filtered = servers.filter((s) => s.id !== id);
  await saveServers(filtered);
}

/**
 * Set a server as the active server. Deactivates all others.
 */
export async function setActiveServer(id: string): Promise<void> {
  const servers = await loadServers();

  if (!servers.some((s) => s.id === id)) {
    throw new Error(`Server not found: ${id}`);
  }

  const updated = servers.map((s) => ({
    ...s,
    active: s.id === id,
  }));

  await saveServers(updated);
}

/**
 * Get the currently active server, or null if none.
 */
export async function getActiveServer(): Promise<ServerEntry | null> {
  const servers = await loadServers();
  return servers.find((s) => s.active) ?? null;
}

/**
 * Migrate from single agent.json to servers.json.
 *
 * If servers.json does not exist but agent.json does, creates servers.json
 * with a single entry derived from agent.json. The original agent.json
 * is preserved (the lamaste-agent CLI still uses it).
 */
export async function migrateFromAgentConfig(): Promise<boolean> {
  const servers = await loadServers();
  if (servers.length > 0) return false;

  let agentConfig: Record<string, unknown>;
  try {
    const raw = await readFile(agentConfigPath(), 'utf-8');
    agentConfig = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return false;
  }

  if (typeof agentConfig.panelUrl !== 'string') return false;

  // Extract IP from panel URL
  let ip = '';
  try {
    const url = new URL(agentConfig.panelUrl as string);
    ip = url.hostname;
  } catch {
    ip = '';
  }

  const authMethod = agentConfig.authMethod === 'keychain' ? 'keychain' as const : 'p12' as const;

  const entry: ServerEntry = {
    id: crypto.randomUUID(),
    label: agentConfig.domain
      ? String(agentConfig.domain)
      : ip || 'my-server',
    panelUrl: agentConfig.panelUrl as string,
    ip,
    createdAt: (agentConfig.setupAt as string) ?? new Date().toISOString(),
    active: true,
    authMethod,
    keychainIdentity: authMethod === 'keychain'
      ? (agentConfig.keychainIdentity as string | undefined)
      : undefined,
    p12Path: authMethod === 'p12'
      ? (agentConfig.p12Path as string | undefined)
      : undefined,
    p12Password: authMethod === 'p12'
      ? (agentConfig.p12Password as string | undefined)
      : undefined,
  };

  await saveServers([entry]);
  return true;
}
