import { homedir } from 'node:os';
import path from 'node:path';

const HOME = homedir();

export const AGENT_DIR = path.join(HOME, '.portlama');
export const CHISEL_BIN_DIR = path.join(AGENT_DIR, 'bin');
export const CHISEL_BIN_PATH = path.join(CHISEL_BIN_DIR, 'chisel');
export const LOGS_DIR = path.join(AGENT_DIR, 'logs');
export const CONFIG_PATH = path.join(AGENT_DIR, 'agent.json');
export const PLIST_LABEL = 'com.portlama.chisel';
export const PLIST_PATH = path.join(HOME, 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);
export const LOG_FILE = path.join(LOGS_DIR, 'chisel.log');
export const ERROR_LOG_FILE = path.join(LOGS_DIR, 'chisel.error.log');

/** systemd unit file path on Linux */
export const SYSTEMD_UNIT_PATH = '/etc/systemd/system/portlama-chisel.service';

/**
 * Platform-appropriate service config path.
 * - macOS: ~/Library/LaunchAgents/com.portlama.chisel.plist
 * - Linux: /etc/systemd/system/portlama-chisel.service
 */
export const SERVICE_CONFIG_PATH = process.platform === 'darwin' ? PLIST_PATH : SYSTEMD_UNIT_PATH;

// ---------------------------------------------------------------------------
// Per-agent (label-parameterized) path helpers
// ---------------------------------------------------------------------------

/**
 * Per-agent data directory.
 * @param {string} label - Validated agent label
 * @returns {string}
 */
export function agentDataDir(label) {
  return path.join(AGENT_DIR, 'agents', label);
}

/**
 * Per-agent config file path.
 * @param {string} label
 * @returns {string}
 */
export function agentConfigPath(label) {
  return path.join(agentDataDir(label), 'config.json');
}

/**
 * Per-agent logs directory.
 * @param {string} label
 * @returns {string}
 */
export function agentLogsDir(label) {
  return path.join(agentDataDir(label), 'logs');
}

/**
 * Per-agent chisel stdout log.
 * @param {string} label
 * @returns {string}
 */
export function agentLogFile(label) {
  return path.join(agentLogsDir(label), 'chisel.log');
}

/**
 * Per-agent chisel stderr log.
 * @param {string} label
 * @returns {string}
 */
export function agentErrorLogFile(label) {
  return path.join(agentLogsDir(label), 'chisel.error.log');
}

/**
 * Per-agent launchd plist label.
 * @param {string} label
 * @returns {string}
 */
export function plistLabel(label) {
  return `com.portlama.chisel-${label}`;
}

/**
 * Per-agent launchd plist file path.
 * @param {string} label
 * @returns {string}
 */
export function plistPath(label) {
  return path.join(HOME, 'Library', 'LaunchAgents', `${plistLabel(label)}.plist`);
}

/**
 * Per-agent systemd unit name.
 * @param {string} label
 * @returns {string}
 */
export function systemdUnitName(label) {
  return `portlama-chisel-${label}`;
}

/**
 * Per-agent systemd unit file path.
 * @param {string} label
 * @returns {string}
 */
export function systemdUnitPath(label) {
  return `/etc/systemd/system/portlama-chisel-${label}.service`;
}

/**
 * Per-agent service config path (platform-aware).
 * @param {string} label
 * @returns {string}
 */
export function serviceConfigPath(label) {
  return process.platform === 'darwin' ? plistPath(label) : systemdUnitPath(label);
}

/**
 * Per-agent plugins registry file.
 * @param {string} label
 * @returns {string}
 */
export function agentPluginsFile(label) {
  return path.join(agentDataDir(label), 'plugins.json');
}

/**
 * Per-agent plugins directory.
 * @param {string} label
 * @returns {string}
 */
export function agentPluginsDir(label) {
  return path.join(agentDataDir(label), 'plugins');
}

/**
 * @returns {boolean} true if running on macOS
 */
export function isDarwin() {
  return process.platform === 'darwin';
}

/**
 * @returns {boolean} true if running on Linux
 */
export function isLinux() {
  return process.platform === 'linux';
}

/**
 * Assert we are running on a supported platform (macOS or Linux).
 * Throws if not.
 */
export function assertSupportedPlatform() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new Error(
      'portlama-agent supports macOS and Linux only. ' +
        `Detected platform: ${process.platform}`,
    );
  }
}

/**
 * Detect architecture and return the Chisel release suffix.
 * @returns {'darwin_arm64' | 'darwin_amd64' | 'linux_arm64' | 'linux_amd64'}
 */
export function detectArch() {
  const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
  switch (process.arch) {
    case 'arm64':
      return `${platform}_arm64`;
    case 'x64':
      return `${platform}_amd64`;
    default:
      throw new Error(`Unsupported architecture: ${process.arch}. Expected arm64 or x64.`);
  }
}
