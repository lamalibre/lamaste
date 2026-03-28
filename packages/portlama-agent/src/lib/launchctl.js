import { execa } from 'execa';
import { plistPath, plistLabel } from './platform.js';

/**
 * Check if the launchd agent is currently loaded.
 * @param {string} label - Agent label
 * @returns {Promise<boolean>}
 */
export async function isAgentLoaded(label) {
  try {
    const target = plistLabel(label);
    const { stdout } = await execa('launchctl', ['list']);
    for (const line of stdout.split('\n')) {
      const cols = line.split('\t');
      if (cols[2] === target) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Get the PID of the running agent, or null if not running.
 * @param {string} label - Agent label
 * @returns {Promise<number | null>}
 */
export async function getAgentPid(label) {
  try {
    const target = plistLabel(label);
    const { stdout } = await execa('launchctl', ['list']);
    for (const line of stdout.split('\n')) {
      const cols = line.split('\t');
      if (cols[2] === target) {
        const parsed = parseInt(cols[0], 10);
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
 * @param {string} label - Agent label
 */
export async function loadAgent(label) {
  try {
    await execa('launchctl', ['load', plistPath(label)]);
  } catch (err) {
    throw new Error(`Failed to load agent: ${err.stderr || err.message}`);
  }
}

/**
 * Unload the launchd agent. Silent if not loaded.
 * @param {string} label - Agent label
 */
export async function unloadAgent(label) {
  try {
    await execa('launchctl', ['unload', plistPath(label)]);
  } catch {
    // Agent may not be loaded — this is fine
  }
}
