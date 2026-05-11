/**
 * macOS-specific launchctl service operations.
 *
 * Manages launchd plist loading/unloading for per-agent chisel services.
 * All subprocess calls use execa with array arguments (never shell interpolation).
 */

import { plistPath, plistLabel } from './platform.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runLaunchctl(args: string[]): Promise<{ stdout: string }> {
  const { execa } = await import('execa');
  return execa('launchctl', args);
}

// ---------------------------------------------------------------------------
// Agent service
// ---------------------------------------------------------------------------

/**
 * Check if the launchd agent is currently loaded.
 */
export async function isAgentLoaded(label: string): Promise<boolean> {
  try {
    const target = plistLabel(label);
    const { stdout } = await runLaunchctl(['list']);
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
 */
export async function getAgentPid(label: string): Promise<number | null> {
  try {
    const target = plistLabel(label);
    const { stdout } = await runLaunchctl(['list']);
    for (const line of stdout.split('\n')) {
      const cols = line.split('\t');
      if (cols[2] === target) {
        const parsed = parseInt(cols[0] ?? '', 10);
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
export async function loadAgent(label: string): Promise<void> {
  try {
    await runLaunchctl(['load', plistPath(label)]);
  } catch (err: unknown) {
    const message = (err as { stderr?: string; message?: string }).stderr ??
      (err as Error).message;
    throw new Error(`Failed to load agent: ${message}`);
  }
}

/**
 * Unload the launchd agent. Silent if not loaded.
 */
export async function unloadAgent(label: string): Promise<void> {
  try {
    await runLaunchctl(['unload', plistPath(label)]);
  } catch {
    // Agent may not be loaded — this is fine
  }
}
