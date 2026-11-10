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
 * Whether an authfile change must restart chisel: a grant withdrawn (so
 * live sessions drop the binding) — unless `keepLiveSessions` — or any
 * change a chisel too old to reload its authfile would not see.
 *
 * @param {{ changed: boolean, revoked: boolean }} change
 * @param {{ keepLiveSessions?: boolean }} [opts]
 */
export function authfileChangeNeedsRestart(change, { keepLiveSessions = false } = {}) {
  return (change.revoked && !keepLiveSessions) || (change.changed && !runningPinnedRelease);
}

/** Requests within this window share one restart. */
export const CHISEL_RESTART_SETTLE_MS = 500;
/** Two restarts never start closer together than this. */
export const CHISEL_RESTART_MIN_INTERVAL_MS = 2000;

/**
 * Coalesce restarts: a burst of revocations (several plugin uninstalls in a
 * row) becomes one restart, not one each. Every restart drops every agent's
 * session, and agents back off between reconnects, so a series of restarts
 * keeps tunnels dark far longer than one.
 *
 * Guarantee: the restart that answers a request *starts after* the request
 * was made — after the authfile write that preceded it — so no revocation is
 * left live. A request joins the restart still waiting to start, if there is
 * one; otherwise it schedules one that starts once the settle window has
 * passed, the restart in progress has ended and the minimum interval since
 * the last start has elapsed. Every caller gets that restart's result.
 *
 * @template T
 * @param {() => Promise<T>} restart
 * @param {{ settleMs?: number, minIntervalMs?: number, now?: () => number,
 *   sleep?: (ms: number) => Promise<void> }} [opts]
 * @returns {() => Promise<T>}
 */
export function createRestartCoalescer(restart, opts = {}) {
  const settleMs = opts.settleMs ?? CHISEL_RESTART_SETTLE_MS;
  const minIntervalMs = opts.minIntervalMs ?? CHISEL_RESTART_MIN_INTERVAL_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  /** @type {Promise<T> | null} the scheduled restart that has not started yet */
  let waiting = null;
  /** @type {Promise<unknown> | null} the restart in progress */
  let running = null;
  let lastStartAt = -Infinity;

  return function requestRestart() {
    if (waiting) return waiting;
    const scheduled = (async () => {
      await sleep(settleMs);
      for (;;) {
        if (running) {
          await running.catch(() => {});
          continue;
        }
        const wait = lastStartAt + minIntervalMs - now();
        if (wait > 0) {
          await sleep(wait);
          continue;
        }
        break;
      }
      // Starting now: later requests schedule the next restart.
      waiting = null;
      lastStartAt = now();
      const current = restart();
      running = current;
      try {
        return await current;
      } finally {
        if (running === current) running = null;
      }
    })();
    waiting = scheduled;
    return scheduled;
  };
}

const restartChiselCoalesced = createRestartCoalescer(() => reloadChiselAuth(execa));

/**
 * Restart chisel if the change requires it ({@link authfileChangeNeedsRestart}).
 * `try-restart` leaves a stopped chisel stopped (see chisel-reconcile.js: a
 * server that failed to reconcile keeps chisel down until it succeeds).
 * Restarts are coalesced ({@link createRestartCoalescer}).
 *
 * @param {{ changed: boolean, revoked: boolean }} change
 * @param {import('pino').Logger} [logger]
 * @param {{ keepLiveSessions?: boolean }} [opts]
 * @returns {Promise<{ restartOk: boolean, restartError?: string }>}
 */
export async function applyAuthfileChange(change, logger, opts = {}) {
  if (!authfileChangeNeedsRestart(change, opts)) return { restartOk: true };
  const result = await restartChiselCoalesced();
  if (result.ok) return { restartOk: true };
  logger?.warn(
    { err: result.error },
    'Failed to restart chisel after an authfile change that revokes access — ' +
      'live sessions keep what was revoked until chisel restarts',
  );
  return { restartOk: false, restartError: result.error };
}
