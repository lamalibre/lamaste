/**
 * lamaste-server logs — View server log output.
 *
 * Wraps journalctl for the panel service. Supports --follow and --lines.
 */

import { execa } from 'execa';
import { PANEL_SERVICE, GATEKEEPER_SERVICE } from '../config.js';

/**
 * @param {string[]} args  Remaining CLI arguments after 'logs'
 * @param {{ json: boolean }} options
 */
export async function runLogs(args, { json }) {
  const follow = args.includes('--follow') || args.includes('-f');
  const service = args.includes('--gatekeeper') ? GATEKEEPER_SERVICE : PANEL_SERVICE;

  let lines = '50';
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--lines' || args[i] === '-n') && args[i + 1]) {
      lines = args[i + 1];
    }
  }

  const journalArgs = ['-u', service, '-n', lines, '--no-pager'];

  if (follow) {
    journalArgs.push('-f');
  }

  if (json) {
    journalArgs.push('-o', 'json');
  }

  // For --follow we need to stream output to the user's terminal.
  // For non-follow we capture and print.
  if (follow) {
    const proc = execa('journalctl', journalArgs, { stdio: 'inherit' });
    // Let the user Ctrl+C to stop
    await proc.catch((err) => {
      // SIGINT/SIGTERM are expected when tailing
      if (err.signal === 'SIGINT' || err.signal === 'SIGTERM') return;
      throw err;
    });
  } else {
    const { stdout } = await execa('journalctl', journalArgs);
    process.stdout.write(stdout + '\n');
  }
}
