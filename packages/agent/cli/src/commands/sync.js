import chalk from 'chalk';
import { assertSupportedPlatform, readSyncState, writeSyncState } from '@lamalibre/lamaste/agent';
import { convergeWithPanel, describeConverge } from '../lib/converge.js';

/**
 * Converge the chisel client with the relay once. This is what the sync timer
 * runs every 30 seconds; it is also safe to run by hand.
 *
 * With `--quiet` (the timer) it prints only when something changed or a new
 * error appears, so the log stays small when nothing happens — a failure that
 * repeats every 30 seconds is logged once, and again once it clears.
 *
 * @param {{ label: string, quiet?: boolean }} options
 */
export async function runSync({ label, quiet = false }) {
  assertSupportedPlatform();
  const previous = await readSyncState(label);
  const now = new Date().toISOString();

  try {
    const { result } = await convergeWithPanel(label);
    await writeSyncState(label, {
      lastRunAt: now,
      lastOkAt: now,
      lastError: null,
      lastState: result.state,
      tunnels: result.tunnels,
      lastWarnings: result.warnings,
    });

    // A warning that repeats every run (e.g. a relay that cannot rotate the
    // credential yet) is logged when it first appears, not every 30 seconds.
    const seen = new Set(previous?.lastWarnings ?? []);
    const newWarnings = result.warnings.filter((w) => !seen.has(w));
    const noteworthy =
      result.serviceChanged ||
      result.credential !== 'kept' ||
      result.binaryUpdated ||
      newWarnings.length > 0 ||
      previous?.lastError ||
      previous?.lastState !== result.state;
    if (!quiet) {
      console.log(chalk.green(`  ${label}: ${describeConverge(result)}`));
      for (const warning of result.warnings) console.log(chalk.yellow(`  ${warning}`));
    } else if (noteworthy) {
      console.log(`${now} ${label}: ${describeConverge(result)}`);
      for (const warning of newWarnings) console.log(`${now} ${label}: warning: ${warning}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeSyncState(label, {
      lastRunAt: now,
      lastOkAt: previous?.lastOkAt ?? null,
      lastError: message,
      lastState: previous?.lastState ?? null,
      tunnels: previous?.tunnels ?? null,
      lastWarnings: previous?.lastWarnings ?? [],
    }).catch(() => undefined);
    if (!quiet) {
      console.error(chalk.red(`  ${label}: sync failed: ${message}`));
    } else if (previous?.lastError !== message) {
      console.error(`${now} ${label}: sync failed: ${message}`);
    }
    // The timer run records the failure (sync-state.json, the log) and exits
    // 0 so its unit does not linger in a failed state; a manual run fails.
    process.exitCode = quiet ? 0 : 1;
  }
}
