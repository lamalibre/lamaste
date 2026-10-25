/**
 * Exit a command with a usage error or a panel refusal — as text, or as an
 * NDJSON error carrying the refusal's `code` (e.g. `last_admin`,
 * `domain_in_use`). The message is printed only as terminal text.
 */

import chalk from 'chalk';
import { emitError } from './ndjson.js';
import { terminalText } from './plugin-settings.js';

/**
 * @param {string} message
 * @param {boolean} json
 * @param {{ code?: string }} [err]
 * @returns {never}
 */
export function fail(message, json, err = {}) {
  if (json) emitError(message, false, typeof err.code === 'string' ? { code: err.code } : {});
  else console.error(`\n  ${chalk.red(terminalText(message))}\n`);
  process.exit(1);
}
