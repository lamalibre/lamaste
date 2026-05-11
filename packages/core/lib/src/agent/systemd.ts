/**
 * Linux-specific systemctl service operations.
 *
 * Manages user-level systemd units for per-agent chisel services. The agent
 * runs without sudo, so its unit lives under ~/.config/systemd/user/ and every
 * systemctl call uses --user.
 *
 * All subprocess calls use execa with array arguments (never shell interpolation).
 */

import { systemdUnitName } from './platform.js';
import { runUserSystemctl } from './user-systemd-env.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runSystemctl(args: string[]): Promise<{ stdout: string }> {
  const result = await runUserSystemctl(args);
  return { stdout: typeof result.stdout === 'string' ? result.stdout : '' };
}

// ---------------------------------------------------------------------------
// Agent service
// ---------------------------------------------------------------------------

/**
 * Check if the systemd agent unit is active.
 */
export async function isAgentActive(label: string): Promise<boolean> {
  try {
    await runSystemctl(['is-active', '--quiet', systemdUnitName(label)]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the PID of the running agent unit, or null if not running.
 */
export async function getAgentPid(label: string): Promise<number | null> {
  try {
    const { stdout } = await runSystemctl([
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

/**
 * Enable and start the systemd agent unit.
 */
export async function startAgent(label: string): Promise<void> {
  try {
    await runSystemctl(['daemon-reload']);
    await runSystemctl(['enable', '--now', systemdUnitName(label)]);
  } catch (err: unknown) {
    const message = (err as { stderr?: string; message?: string }).stderr ?? (err as Error).message;
    throw new Error(`Failed to start agent: ${message}`);
  }
}

/**
 * Disable and stop the systemd agent unit. Silent if not active.
 */
export async function stopAgent(label: string): Promise<void> {
  try {
    await runSystemctl(['disable', '--now', systemdUnitName(label)]);
  } catch {
    // Agent may not be active — this is fine
  }
}
