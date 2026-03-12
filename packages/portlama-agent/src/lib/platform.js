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

/**
 * Assert we are running on macOS. Throws if not.
 */
export function assertMacOS() {
  if (process.platform !== 'darwin') {
    throw new Error(
      'portlama-agent is designed for macOS only. ' +
        `Detected platform: ${process.platform}`,
    );
  }
}

/**
 * Detect architecture and return the Chisel release suffix.
 * @returns {'darwin_arm64' | 'darwin_amd64'}
 */
export function detectArch() {
  switch (process.arch) {
    case 'arm64':
      return 'darwin_arm64';
    case 'x64':
      return 'darwin_amd64';
    default:
      throw new Error(`Unsupported architecture: ${process.arch}. Expected arm64 or x64.`);
  }
}
