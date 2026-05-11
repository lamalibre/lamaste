/**
 * Mode management — controls the active mode (agent/admin) for a server
 * and admin certificate file operations.
 *
 * Ported from the Tauri desktop app's mode.rs.
 */

import { existsSync } from 'node:fs';
import { serverAdminP12Path, LAMASTE_DIR } from './platform.js';
import {
  loadServersRegistry,
  saveServersRegistry,
} from './server-registry.js';

// Re-export for convenience
export { serverAdminP12Path } from './platform.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ServerMode = 'agent' | 'admin';

// ---------------------------------------------------------------------------
// Mode management
// ---------------------------------------------------------------------------

/**
 * Set the active mode for a server ("agent" or "admin").
 */
export async function setServerMode(serverId: string, mode: ServerMode): Promise<void> {
  if (mode !== 'agent' && mode !== 'admin') {
    throw new Error("Mode must be 'agent' or 'admin'");
  }

  const servers = await loadServersRegistry();
  const server = servers.find((s) => s.id === serverId);
  if (!server) {
    throw new Error(`Server ${serverId} not found`);
  }

  server.activeMode = mode;
  await saveServersRegistry(servers);
}

/**
 * Get the active server's mode. Defaults to "agent" if no servers or no active server.
 */
export async function getServerMode(): Promise<ServerMode> {
  const servers = await loadServersRegistry();
  const active = servers.find((s) => s.active);
  if (!active) return 'agent';
  return (active.activeMode === 'admin' ? 'admin' : 'agent');
}

// ---------------------------------------------------------------------------
// Admin cert operations
// ---------------------------------------------------------------------------

/**
 * Check if the active server has an admin certificate configured.
 *
 * Returns true if:
 * - The server has explicit adminAuth, OR
 * - The server has a provider field (cloud-provisioned servers use admin cert as primary)
 */
export async function hasAdminCert(): Promise<boolean> {
  const servers = await loadServersRegistry();
  const active = servers.find((s) => s.active);
  if (!active) return false;

  // Has explicit admin_auth
  if (active.adminAuth) return true;

  // Cloud-provisioned servers (have provider field) use admin cert as primary
  if (active.provider) return true;

  return false;
}

/**
 * Get the admin P12 path for a server, if one exists on disk.
 */
export function getAdminCertPath(serverId: string): string | null {
  const p12Path = serverAdminP12Path(serverId);
  return existsSync(p12Path) ? p12Path : null;
}

/**
 * Get the active server's ID, or null if no active server.
 */
export async function getActiveServerId(): Promise<string | null> {
  const servers = await loadServersRegistry();
  const active = servers.find((s) => s.active);
  return active?.id ?? null;
}

/**
 * Import an admin P12 certificate for a server.
 *
 * - Validates the server ID and source file
 * - Copies P12 to ~/.lamalibre/lamaste/servers/<id>/admin.p12
 * - Updates the server entry in servers.json with adminAuth
 *
 * NOTE: The caller is responsible for storing the P12 password in the OS
 * credential store (this module does not handle credential storage).
 */
export async function importAdminCert(
  serverId: string,
  p12SourcePath: string,
): Promise<{ p12Path: string }> {
  const { mkdir, copyFile, chmod, lstat } = await import('node:fs/promises');
  const pathMod = await import('node:path');

  // Validate server_id is safe for filesystem paths
  if (serverId.includes('/') || serverId.includes('\\') || serverId.includes('\0') || serverId.includes('..')) {
    throw new Error('Server ID contains invalid characters');
  }

  // Validate the source P12 file exists and is a regular file
  const srcStats = await lstat(p12SourcePath);
  if (!srcStats.isFile()) {
    throw new Error('P12 path must be a regular file');
  }

  // Create server directory if needed
  const serverDir = pathMod.join(LAMASTE_DIR, 'servers', serverId);
  await mkdir(serverDir, { recursive: true, mode: 0o700 });

  // Copy P12 to admin.p12
  const dest = pathMod.join(serverDir, 'admin.p12');
  await copyFile(p12SourcePath, dest);
  await chmod(dest, 0o600);

  // Update servers.json with admin_auth
  const servers = await loadServersRegistry();
  const server = servers.find((s) => s.id === serverId);
  if (server) {
    server.adminAuth = {
      method: 'p12',
      p12Path: dest,
    };
    await saveServersRegistry(servers);
  }

  return { p12Path: dest };
}

/**
 * Remove the admin certificate for a server.
 *
 * - Deletes the admin P12 file
 * - Removes adminAuth from servers.json
 * - Resets activeMode to "agent"
 *
 * NOTE: The caller is responsible for cleaning up the credential store entry.
 */
export async function removeAdminCert(serverId: string): Promise<void> {
  const { unlink } = await import('node:fs/promises');

  // Validate server_id is safe for filesystem paths
  if (serverId.includes('/') || serverId.includes('\\') || serverId.includes('\0') || serverId.includes('..')) {
    throw new Error('Server ID contains invalid characters');
  }

  // Delete admin P12 file
  const p12Path = serverAdminP12Path(serverId);
  if (existsSync(p12Path)) {
    await unlink(p12Path);
  }

  // Remove admin_auth from servers.json and reset to agent mode
  const servers = await loadServersRegistry();
  const server = servers.find((s) => s.id === serverId);
  if (server) {
    delete server.adminAuth;
    server.activeMode = 'agent';
    await saveServersRegistry(servers);
  }
}
