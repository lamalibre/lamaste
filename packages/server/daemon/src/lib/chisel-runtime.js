/**
 * When an authfile change must restart chisel.
 *
 * Chisel >= 1.12.0 reloads its authfile on every atomic replace, and the
 * reload applies to new sessions: a new agent, a new password or a new port
 * grant takes effect without a restart. What a live session already holds —
 * its authenticated user and the reverse listeners it bound — survives a
 * reload, so a change that *revokes* something (a removed or rotated
 * password, a withdrawn port) needs a restart to take effect.
 *
 * An older chisel does not reload reliably across atomic renames, so until
 * this process has seen chisel running the pinned release, every change
 * restarts it. Startup reconciliation and onboarding set that flag after they
 * (re)start chisel on the pinned binary.
 */

import { execa } from 'execa';
import { reloadChiselAuth } from '@lamalibre/lamaste/server';

let runningPinnedRelease = false;

/** Record whether the chisel process now running is the pinned release. */
export function setChiselRunningPinnedRelease(value) {
  runningPinnedRelease = value === true;
}

/** True when an additive authfile change takes effect without a restart. */
export function chiselReloadsAuthfile() {
  return runningPinnedRelease;
}

/**
 * Restart chisel if the change requires it. `try-restart` leaves a stopped
 * chisel stopped (see chisel-reconcile.js: a server that failed to reconcile
 * keeps chisel down until it succeeds).
 *
 * @param {{ changed: boolean, revoked: boolean }} change
 * @param {import('pino').Logger} [logger]
 * @returns {Promise<{ restartOk: boolean, restartError?: string }>}
 */
export async function applyAuthfileChange(change, logger) {
  const needsRestart = change.revoked || (change.changed && !runningPinnedRelease);
  if (!needsRestart) return { restartOk: true };
  const result = await reloadChiselAuth(execa, logger);
  return result.ok ? { restartOk: true } : { restartOk: false, restartError: result.error };
}
