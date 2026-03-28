/**
 * Unified service management interface.
 *
 * Dispatches to launchctl (macOS) or systemctl (Linux) based on process.platform.
 * All functions accept a `label` parameter for per-agent service isolation.
 */

import { execa } from 'execa';
import { isDarwin, systemdUnitName } from './platform.js';

// Lazy imports for macOS-specific modules to avoid loading them on Linux

/**
 * Check if the agent service is currently loaded/active.
 * @param {string} label - Agent label
 * @returns {Promise<boolean>}
 */
export async function isAgentLoaded(label) {
  if (isDarwin()) {
    const { isAgentLoaded: macIsLoaded } = await import('./launchctl.js');
    return macIsLoaded(label);
  }
  return systemctlIsActive(label);
}

/**
 * Get the PID of the running agent, or null if not running.
 * @param {string} label - Agent label
 * @returns {Promise<number | null>}
 */
export async function getAgentPid(label) {
  if (isDarwin()) {
    const { getAgentPid: macGetPid } = await import('./launchctl.js');
    return macGetPid(label);
  }
  return systemctlGetPid(label);
}

/**
 * Load/start the agent service.
 * @param {string} label - Agent label
 */
export async function loadAgent(label) {
  if (isDarwin()) {
    const { loadAgent: macLoad } = await import('./launchctl.js');
    return macLoad(label);
  }
  return systemctlStart(label);
}

/**
 * Unload/stop the agent service. Silent if not loaded.
 * @param {string} label - Agent label
 */
export async function unloadAgent(label) {
  if (isDarwin()) {
    const { unloadAgent: macUnload } = await import('./launchctl.js');
    return macUnload(label);
  }
  return systemctlStop(label);
}

// ---------------------------------------------------------------------------
// Linux / systemd helpers
// ---------------------------------------------------------------------------

async function systemctlIsActive(label) {
  try {
    await execa('systemctl', ['is-active', '--quiet', systemdUnitName(label)]);
    return true;
  } catch {
    return false;
  }
}

async function systemctlGetPid(label) {
  try {
    const { stdout } = await execa('systemctl', [
      'show',
      '-p',
      'MainPID',
      '--value',
      systemdUnitName(label),
    ]);
    const pid = parseInt(stdout.trim(), 10);
    return Number.isNaN(pid) || pid <= 0 ? null : pid;
  } catch {
    return null;
  }
}

async function systemctlStart(label) {
  try {
    await execa('systemctl', ['daemon-reload']);
    await execa('systemctl', ['enable', '--now', systemdUnitName(label)]);
  } catch (err) {
    throw new Error(`Failed to start agent: ${err.stderr || err.message}`);
  }
}

async function systemctlStop(label) {
  try {
    await execa('systemctl', ['disable', '--now', systemdUnitName(label)]);
  } catch {
    // Agent may not be active — this is fine
  }
}
