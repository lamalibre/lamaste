/**
 * Server registry CRUD — manages ~/.lamalibre/lamaste/servers.json and
 * ~/.lamalibre/lamaste/storage-servers.json for the desktop app.
 *
 * Ported from the Tauri desktop app's cloud.rs server registry operations.
 */

import { readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { atomicWriteJSON } from '../file-helpers.js';
import { LAMASTE_DIR, SERVERS_REGISTRY_PATH, STORAGE_SERVERS_REGISTRY_PATH } from './platform.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminAuth {
  method: 'p12' | 'keychain';
  p12Path?: string | undefined;
  keychainIdentity?: string | undefined;
}

export interface ServerEntry {
  id: string;
  label: string;
  panelUrl: string;
  ip: string;
  domain?: string | undefined;
  provider?: string | undefined;
  providerId?: string | undefined;
  region?: string | undefined;
  createdAt: string;
  active: boolean;
  authMethod: 'p12' | 'keychain';
  keychainIdentity?: string | undefined;
  p12Path?: string | undefined;
  /** P12 password — should be stored in OS credential store, not JSON. */
  p12Password?: string | undefined;
  adminAuth?: AdminAuth | undefined;
  activeMode?: string | undefined;
}

export interface StorageServerEntry {
  id: string;
  label: string;
  provider: string;
  region: string;
  bucket: string;
  endpoint: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a server label: lowercase alphanumeric + hyphens, 1-64 chars,
 * must start and end with a letter or number.
 */
export function validateServerLabel(label: string): void {
  if (label.length === 0 || label.length > 64) {
    throw new Error('Label must be 1-64 characters');
  }
  const bytes = [...label];
  const isAlnum = (c: string): boolean => /^[a-z0-9]$/.test(c);
  if (!isAlnum(bytes[0]!) || (bytes.length > 1 && !isAlnum(bytes[bytes.length - 1]!))) {
    throw new Error('Label must start and end with a lowercase letter or number');
  }
  if (!/^[a-z0-9-]+$/.test(label)) {
    throw new Error('Label must contain only lowercase letters, numbers, and hyphens');
  }
}

/**
 * Validate that a panel URL is safe to use (HTTPS only, no private IPs).
 */
export function validatePanelUrl(url: string): void {
  const trimmed = url.replace(/\/+$/, '');
  if (!trimmed.startsWith('https://')) {
    throw new Error('Panel URL must use HTTPS scheme');
  }

  const afterScheme = trimmed.slice('https://'.length);
  let host: string;
  if (afterScheme.startsWith('[')) {
    // IPv6 literal: [::1]:9292
    const closingBracket = afterScheme.indexOf(']');
    host = closingBracket !== -1 ? afterScheme.slice(1, closingBracket) : '';
  } else {
    host = afterScheme.split(':')[0] ?? '';
  }

  if (host.length === 0) {
    throw new Error('Panel URL has no hostname');
  }

  // Block obvious private/reserved ranges for IP addresses
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    // Looks like an IP address — do basic private range checks
    const parts = host.split('.').map(Number);
    if (
      parts.length === 4 &&
      (
        parts[0] === 127 ||                                       // loopback
        parts[0] === 10 ||                                        // 10.0.0.0/8
        (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) || // 172.16.0.0/12
        (parts[0] === 192 && parts[1] === 168) ||                 // 192.168.0.0/16
        (parts[0] === 169 && parts[1] === 254) ||                 // link-local
        (parts[0] === 100 && (parts[1]! & 0xC0) === 64) ||       // CGNAT
        parts[0] === 0                                            // 0.0.0.0
      )
    ) {
      throw new Error('Panel URL must not point to a private or reserved IP address');
    }
  }
}

/**
 * Validate a server ID does not contain path traversal characters.
 */
function validateServerId(serverId: string): void {
  if (serverId.includes('/') || serverId.includes('\\') || serverId.includes('\0') || serverId.includes('..')) {
    throw new Error('Server ID contains invalid characters');
  }
}

// ---------------------------------------------------------------------------
// Atomic write helper (delegates to the shared core helper)
// ---------------------------------------------------------------------------

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await atomicWriteJSON(filePath, data, {
    mkdirp: true,
    dirMode: 0o700,
    mode: 0o600,
  });
}

// ---------------------------------------------------------------------------
// Servers registry (~/.lamalibre/lamaste/servers.json)
// ---------------------------------------------------------------------------

/** Load the servers registry. Returns empty array if file does not exist. */
export async function loadServersRegistry(): Promise<ServerEntry[]> {
  try {
    const raw = await readFile(SERVERS_REGISTRY_PATH, 'utf-8');
    return JSON.parse(raw) as ServerEntry[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`Failed to read servers.json: ${(err as Error).message}`);
  }
}

/** Save the servers registry atomically. */
export async function saveServersRegistry(servers: ServerEntry[]): Promise<void> {
  await atomicWriteJson(SERVERS_REGISTRY_PATH, servers);
}

/** Get the list of servers (p12Password redacted). */
export async function getServers(): Promise<ServerEntry[]> {
  const servers = await loadServersRegistry();
  return servers.map((s) => ({ ...s, p12Password: undefined }));
}

/** Get a server by ID. */
export async function getServer(serverId: string): Promise<ServerEntry | null> {
  const servers = await loadServersRegistry();
  return servers.find((s) => s.id === serverId) ?? null;
}

/** Set the active server. Exactly one server can be active at a time. */
export async function setActiveServer(serverId: string): Promise<void> {
  const servers = await loadServersRegistry();
  let found = false;
  for (const s of servers) {
    s.active = s.id === serverId;
    if (s.id === serverId) found = true;
  }
  if (!found) {
    throw new Error('Server not found');
  }
  await saveServersRegistry(servers);
}

/** Add a server entry to the registry. */
export async function addServer(entry: ServerEntry): Promise<void> {
  validateServerLabel(entry.label);
  validatePanelUrl(entry.panelUrl);

  await mkdir(LAMASTE_DIR, { recursive: true, mode: 0o700 });

  const servers = await loadServersRegistry();
  servers.push(entry);
  await saveServersRegistry(servers);
}

/**
 * Remove a server from the registry.
 * Also cleans up the per-server data directory (~/.lamalibre/lamaste/servers/<id>/)
 * with symlink traversal protection.
 */
export async function removeServer(serverId: string): Promise<void> {
  validateServerId(serverId);

  const servers = await loadServersRegistry();
  const filtered = servers.filter((s) => s.id !== serverId);
  if (filtered.length === servers.length) {
    throw new Error('Server not found');
  }
  await saveServersRegistry(filtered);

  // Clean up server directory (admin.p12 etc.)
  // Symlink attack protection: verify canonical path is under ~/.lamalibre/lamaste/servers/
  const serverDir = path.join(LAMASTE_DIR, 'servers', serverId);
  if (existsSync(serverDir)) {
    const { realpath } = await import('node:fs/promises');
    try {
      const canonical = await realpath(serverDir);
      const expectedParent = path.join(LAMASTE_DIR, 'servers');
      if (existsSync(expectedParent)) {
        const canonicalParent = await realpath(expectedParent);
        if (canonical.startsWith(canonicalParent + path.sep)) {
          await rm(canonical, { recursive: true, force: true });
        }
      }
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * Update a server entry in the registry.
 * Merges the provided fields with the existing entry.
 */
export async function updateServer(
  serverId: string,
  updates: Partial<ServerEntry>,
): Promise<ServerEntry> {
  validateServerId(serverId);
  const servers = await loadServersRegistry();
  const idx = servers.findIndex((s) => s.id === serverId);
  if (idx === -1) {
    throw new Error('Server not found');
  }
  servers[idx] = { ...servers[idx]!, ...updates, id: serverId };
  await saveServersRegistry(servers);
  return servers[idx]!;
}

// ---------------------------------------------------------------------------
// Storage servers registry (~/.lamalibre/lamaste/storage-servers.json)
// ---------------------------------------------------------------------------

/** Load the storage servers registry. Returns empty array if file does not exist. */
export async function loadStorageServersRegistry(): Promise<StorageServerEntry[]> {
  try {
    const raw = await readFile(STORAGE_SERVERS_REGISTRY_PATH, 'utf-8');
    return JSON.parse(raw) as StorageServerEntry[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`Failed to read storage-servers.json: ${(err as Error).message}`);
  }
}

/** Save the storage servers registry atomically. */
export async function saveStorageServersRegistry(servers: StorageServerEntry[]): Promise<void> {
  await atomicWriteJson(STORAGE_SERVERS_REGISTRY_PATH, servers);
}

/** Get the list of storage servers. */
export async function getStorageServers(): Promise<StorageServerEntry[]> {
  return loadStorageServersRegistry();
}

/** Get a storage server by ID. */
export async function getStorageServer(serverId: string): Promise<StorageServerEntry | null> {
  const servers = await loadStorageServersRegistry();
  return servers.find((s) => s.id === serverId) ?? null;
}

/** Add a storage server entry to the registry. */
export async function addStorageServer(entry: StorageServerEntry): Promise<void> {
  await mkdir(LAMASTE_DIR, { recursive: true, mode: 0o700 });
  const servers = await loadStorageServersRegistry();
  servers.push(entry);
  await saveStorageServersRegistry(servers);
}

/** Remove a storage server from the registry. */
export async function removeStorageServer(serverId: string): Promise<void> {
  const servers = await loadStorageServersRegistry();
  const filtered = servers.filter((s) => s.id !== serverId);
  if (filtered.length === servers.length) {
    throw new Error('Storage server not found');
  }
  await saveStorageServersRegistry(filtered);
}
