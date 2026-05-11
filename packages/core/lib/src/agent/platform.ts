/**
 * Agent platform paths and detection utilities.
 *
 * All paths are relative to ~/.${ORG}/${PROJECT}/ — the user-level data
 * directory used by agents, the desktop app, and the local plugin host.
 *
 * `ORG` and `PROJECT` are the single source of truth for the two identifiers
 * that brand the on-disk and service-manager surface. Defaults are
 * (~/.lamalibre/lamaste/, com.lamalibre.lamaste.*, lamalibre-lamaste-*);
 * env vars `LAMALIBRE_ORG` and `LAMALIBRE_PROJECT` override them. The v3
 * rebrand from "lamaste" to "lamaste" is therefore a single-line default
 * change.
 */

import { homedir } from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Branded identifiers — single source of truth
// ---------------------------------------------------------------------------

// Hoisted to ../branding.ts so both agent and server domains share one source.
// Re-exported here so existing consumers (`from './platform.js'`) keep working.
import {
  ORG,
  PROJECT,
  ecosystemBundleId,
  ecosystemUnit,
  productBundleId,
  productUnit,
  userEcosystemRoot,
  userProductRoot,
} from '../branding.js';
export { ORG, PROJECT };

// ---------------------------------------------------------------------------
// Base directories
// ---------------------------------------------------------------------------

const HOME = homedir();

/** Root agent data directory (~/.${ORG}/${PROJECT}/). */
export const LAMASTE_DIR = userProductRoot();

/** Chisel binary directory. */
export const CHISEL_BIN_DIR = path.join(LAMASTE_DIR, 'bin');

/** Chisel binary path. */
export const CHISEL_BIN_PATH = path.join(CHISEL_BIN_DIR, 'chisel');

/** Legacy logs directory. */
export const LOGS_DIR = path.join(LAMASTE_DIR, 'logs');

/** Legacy single-agent config path. */
export const LEGACY_CONFIG_PATH = path.join(LAMASTE_DIR, 'agent.json');

/** Multi-agent registry path. */
export const AGENTS_REGISTRY_PATH = path.join(LAMASTE_DIR, 'agents.json');

/** Servers registry path. */
export const SERVERS_REGISTRY_PATH = path.join(LAMASTE_DIR, 'servers.json');

/** Storage servers registry path. */
export const STORAGE_SERVERS_REGISTRY_PATH = path.join(LAMASTE_DIR, 'storage-servers.json');

/** Service discovery registry path. */
export const SERVICES_REGISTRY_PATH = path.join(LAMASTE_DIR, 'services.json');

// ---------------------------------------------------------------------------
// Temporary working directories
// ---------------------------------------------------------------------------

/** Root temp directory (~/.${ORG}/${PROJECT}/tmp/). */
export const TMP_DIR = path.join(LAMASTE_DIR, 'tmp');

/** Root temp directory (function form). */
export function tmpDir(): string {
  return TMP_DIR;
}

/** Admin-cert provisioner temp directory. */
export function adminTmpDir(): string {
  return path.join(TMP_DIR, 'admin');
}

/** Agent-cert provisioner temp directory. */
export function agentTmpDir(): string {
  return path.join(TMP_DIR, 'agent');
}

// ---------------------------------------------------------------------------
// Legacy (single-agent) paths
// ---------------------------------------------------------------------------

export const LEGACY_PLIST_LABEL = productBundleId('chisel');
export const LEGACY_PLIST_PATH = path.join(
  HOME,
  'Library',
  'LaunchAgents',
  `${LEGACY_PLIST_LABEL}.plist`,
);
export const LEGACY_LOG_FILE = path.join(LOGS_DIR, 'chisel.log');
export const LEGACY_ERROR_LOG_FILE = path.join(LOGS_DIR, 'chisel.error.log');
export const LEGACY_SYSTEMD_UNIT_PATH = `/etc/systemd/system/${productUnit('chisel')}.service`;

/** Platform-appropriate legacy service config path. */
export const LEGACY_SERVICE_CONFIG_PATH =
  process.platform === 'darwin' ? LEGACY_PLIST_PATH : LEGACY_SYSTEMD_UNIT_PATH;

// ---------------------------------------------------------------------------
// Per-agent path helpers
// ---------------------------------------------------------------------------

/** Agents root directory. */
export function agentsDir(): string {
  return path.join(LAMASTE_DIR, 'agents');
}

/** Per-agent data directory. */
export function agentDataDir(label: string): string {
  return path.join(LAMASTE_DIR, 'agents', label);
}

/** Per-agent config file path. */
export function agentConfigPath(label: string): string {
  return path.join(agentDataDir(label), 'config.json');
}

/** Per-agent logs directory. */
export function agentLogsDir(label: string): string {
  return path.join(agentDataDir(label), 'logs');
}

/** Per-agent chisel stdout log. */
export function agentLogFile(label: string): string {
  return path.join(agentLogsDir(label), 'chisel.log');
}

/** Per-agent chisel stderr log. */
export function agentErrorLogFile(label: string): string {
  return path.join(agentLogsDir(label), 'chisel.error.log');
}

/** Per-agent launchd plist label. */
export function plistLabel(label: string): string {
  return productBundleId(`chisel-${label}`);
}

/** Per-agent launchd plist file path. */
export function plistPath(label: string): string {
  return path.join(HOME, 'Library', 'LaunchAgents', `${plistLabel(label)}.plist`);
}

/** Per-agent systemd unit name. */
export function systemdUnitName(label: string): string {
  return productUnit(`chisel-${label}`);
}

/** Per-agent systemd unit file path (user-level). */
export function systemdUnitPath(label: string): string {
  return path.join(HOME, '.config', 'systemd', 'user', `${systemdUnitName(label)}.service`);
}

/** Per-agent service config path (platform-aware). */
export function serviceConfigPath(label: string): string {
  return process.platform === 'darwin' ? plistPath(label) : systemdUnitPath(label);
}

/** Per-agent plugins registry file. */
export function agentPluginsFile(label: string): string {
  return path.join(agentDataDir(label), 'plugins.json');
}

/** Per-agent plugins directory. */
export function agentPluginsDir(label: string): string {
  return path.join(agentDataDir(label), 'plugins');
}

// ---------------------------------------------------------------------------
// Per-agent panel service paths
// ---------------------------------------------------------------------------

/** Per-agent panel service stdout log. */
export function panelLogFile(label: string): string {
  return path.join(agentLogsDir(label), 'panel.log');
}

/** Per-agent panel service stderr log. */
export function panelErrorLogFile(label: string): string {
  return path.join(agentLogsDir(label), 'panel.error.log');
}

/** Per-agent panel launchd plist label. */
export function panelPlistLabel(label: string): string {
  return productBundleId(`panel-${label}`);
}

/** Per-agent panel launchd plist file path. */
export function panelPlistPath(label: string): string {
  return path.join(HOME, 'Library', 'LaunchAgents', `${panelPlistLabel(label)}.plist`);
}

/** Per-agent panel systemd unit name. */
export function panelSystemdUnitName(label: string): string {
  return productUnit(`panel-${label}`);
}

/** Per-agent panel systemd unit file path (user-level). */
export function panelSystemdUnitPath(label: string): string {
  return path.join(HOME, '.config', 'systemd', 'user', `${panelSystemdUnitName(label)}.service`);
}

/** Per-agent panel service config path (platform-aware). */
export function panelServiceConfigPath(label: string): string {
  return process.platform === 'darwin' ? panelPlistPath(label) : panelSystemdUnitPath(label);
}

// ---------------------------------------------------------------------------
// Local plugin host paths (not per-agent — shared across the machine,
// hoisted to ecosystem root because the host is product-agnostic)
// ---------------------------------------------------------------------------

/** Local plugin host data directory (~/.${ORG}/local/). */
export const LOCAL_DIR = path.join(userEcosystemRoot(), 'local');

/** Local plugin host data directory (function form). */
export function localDir(): string {
  return LOCAL_DIR;
}

/** Local plugin registry file. */
export function localPluginsFile(): string {
  return path.join(LOCAL_DIR, 'plugins.json');
}

/** Local per-plugin data directories root. */
export function localPluginsDir(): string {
  return path.join(LOCAL_DIR, 'plugins');
}

/** Local plugin host logs directory. */
export function localHostLogsDir(): string {
  return path.join(LOCAL_DIR, 'logs');
}

/** Local plugin host stdout log. */
export function localHostLogFile(): string {
  return path.join(localHostLogsDir(), 'host.log');
}

/** Local plugin host stderr log. */
export function localHostErrorLogFile(): string {
  return path.join(localHostLogsDir(), 'host.error.log');
}

/** Local plugin host launchd plist label. */
export function localHostPlistLabel(): string {
  // Ecosystem-level: the local plugin host is shared across the machine and not
  // bound to any single product (lamaste/lamaste/...) — uses ORG namespace only.
  return ecosystemBundleId('local-plugin-host');
}

/** Local plugin host launchd plist file path. */
export function localHostPlistPath(): string {
  return path.join(HOME, 'Library', 'LaunchAgents', `${localHostPlistLabel()}.plist`);
}

/** Local plugin host systemd unit name. */
export function localHostSystemdUnitName(): string {
  // Ecosystem-level (see localHostPlistLabel).
  return ecosystemUnit('local-plugin-host');
}

/** Local plugin host systemd unit file path (user-level). */
export function localHostSystemdUnitPath(): string {
  return path.join(HOME, '.config', 'systemd', 'user', `${localHostSystemdUnitName()}.service`);
}

/** Local plugin host service config path (platform-aware). */
export function localHostServiceConfigPath(): string {
  return process.platform === 'darwin' ? localHostPlistPath() : localHostSystemdUnitPath();
}

// ---------------------------------------------------------------------------
// Server directory paths (for desktop admin cert management)
// ---------------------------------------------------------------------------

/** Per-server data directory. */
export function serverDataDir(serverId: string): string {
  return path.join(LAMASTE_DIR, 'servers', serverId);
}

/** Per-server admin P12 path. */
export function serverAdminP12Path(serverId: string): string {
  return path.join(serverDataDir(serverId), 'admin.p12');
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

/** Returns true if running on macOS. */
export function isDarwin(): boolean {
  return process.platform === 'darwin';
}

/** Returns true if running on Linux. */
export function isLinux(): boolean {
  return process.platform === 'linux';
}

/**
 * Assert we are running on a supported platform (macOS or Linux).
 * @throws if platform is unsupported
 */
export function assertSupportedPlatform(): void {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new Error(
      `Lamaste supports macOS and Linux only. Detected platform: ${process.platform}`,
    );
  }
}

/**
 * Detect architecture and return the Chisel release suffix.
 */
export function detectArch(): 'darwin_arm64' | 'darwin_amd64' | 'linux_arm64' | 'linux_amd64' {
  const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
  switch (process.arch) {
    case 'arm64':
      return `${platform}_arm64` as const;
    case 'x64':
      return `${platform}_amd64` as const;
    default:
      throw new Error(`Unsupported architecture: ${process.arch}. Expected arm64 or x64.`);
  }
}
