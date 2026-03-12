import { execa } from 'execa';
import { PLIST_PATH, PLIST_LABEL } from './platform.js';

/**
 * Check if the launchd agent is currently loaded.
 * @returns {Promise<boolean>}
 */
export async function isAgentLoaded() {
  try {
    const { stdout } = await execa('launchctl', ['list']);
    return stdout.includes(PLIST_LABEL);
  } catch {
    return false;
  }
}

/**
 * Get the PID of the running agent, or null if not running.
 * @returns {Promise<number | null>}
 */
export async function getAgentPid() {
  try {
    const { stdout } = await execa('launchctl', ['list']);
    for (const line of stdout.split('\n')) {
      if (line.includes(PLIST_LABEL)) {
        const pid = line.split('\t')[0];
        const parsed = parseInt(pid, 10);
        return Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Load the launchd agent.
 */
export async function loadAgent() {
  try {
    await execa('launchctl', ['load', PLIST_PATH]);
  } catch (err) {
    throw new Error(`Failed to load agent: ${err.stderr || err.message}`);
  }
}

/**
 * Unload the launchd agent. Silent if not loaded.
 */
export async function unloadAgent() {
  try {
    await execa('launchctl', ['unload', PLIST_PATH]);
  } catch {
    // Agent may not be loaded — this is fine
  }
}
