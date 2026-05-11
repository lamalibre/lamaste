/**
 * lamaste-server restart — Restart the panel server and optionally the gatekeeper.
 *
 * Waits for the service to reach active state after restart.
 */

import chalk from 'chalk';
import { execa } from 'execa';
import { PANEL_SERVICE, GATEKEEPER_SERVICE } from '../config.js';
import { emitStep, emitError, emitComplete } from '../ndjson.js';

const HEALTH_CHECK_ATTEMPTS = 10;
const HEALTH_CHECK_INTERVAL_MS = 1000;

/**
 * @param {string[]} args  Remaining CLI arguments after 'restart'
 * @param {{ json: boolean }} options
 */
export async function runRestart(args, { json }) {
  const all = args.includes('--all');
  const gatekeeperOnly = args.includes('--gatekeeper');
  const services = gatekeeperOnly
    ? [GATEKEEPER_SERVICE]
    : all
      ? [PANEL_SERVICE, GATEKEEPER_SERVICE]
      : [PANEL_SERVICE];

  for (const service of services) {
    if (json) {
      emitStep(service, 'running', `Restarting ${service}`);
    } else {
      process.stderr.write(`  Restarting ${chalk.cyan(service)}...`);
    }

    try {
      await execa('systemctl', ['restart', service]);
    } catch (err) {
      const msg = `Failed to restart ${service}: ${err.stderr || err.message}`;
      if (json) {
        emitStep(service, 'failed', msg);
        emitError(msg);
      } else {
        console.error(` ${chalk.red('failed')}`);
        console.error(`  ${chalk.red(msg)}`);
      }
      process.exit(1);
    }

    // Wait for service to become active
    let healthy = false;
    for (let i = 0; i < HEALTH_CHECK_ATTEMPTS; i++) {
      await sleep(HEALTH_CHECK_INTERVAL_MS);
      try {
        const { stdout } = await execa('systemctl', ['is-active', service]);
        if (stdout.trim() === 'active') {
          healthy = true;
          break;
        }
      } catch {
        // Not active yet, retry
      }
    }

    if (!healthy) {
      const msg = `Service ${service} did not become active within ${HEALTH_CHECK_ATTEMPTS} seconds`;
      if (json) {
        emitStep(service, 'failed', msg);
        emitError(msg);
      } else {
        console.error(` ${chalk.yellow('timeout')}`);
        console.error(`  ${chalk.yellow(msg)}`);
      }
      process.exit(1);
    }

    if (json) {
      emitStep(service, 'complete');
    } else {
      console.log(` ${chalk.green('ok')}`);
    }
  }

  if (json) {
    emitComplete({ restarted: services });
  }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
