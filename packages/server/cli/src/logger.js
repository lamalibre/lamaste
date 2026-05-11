/**
 * CLI logger that satisfies the PluginLogger / TunnelLogger / SiteLogger
 * interfaces expected by @lamalibre/lamaste/server.
 *
 * In normal mode, logs are written to stderr with chalk formatting.
 * In --json mode, logs are suppressed (output goes through ndjson.js).
 */

import chalk from 'chalk';

/**
 * Create a logger for CLI command use.
 * @param {{ json: boolean }} options
 * @returns {{ info: Function, warn: Function, error: Function }}
 */
export function createLogger({ json }) {
  if (json) {
    return {
      info() {},
      warn() {},
      error() {},
    };
  }

  return {
    /** @param {Record<string, unknown>} _obj @param {string} [msg] */
    info(_obj, msg) {
      if (msg) process.stderr.write(`  ${chalk.dim(msg)}\n`);
    },
    /** @param {Record<string, unknown>} _obj @param {string} [msg] */
    warn(_obj, msg) {
      if (msg) process.stderr.write(`  ${chalk.yellow('warn:')} ${msg}\n`);
    },
    /** @param {Record<string, unknown>} _obj @param {string} [msg] */
    error(_obj, msg) {
      if (msg) process.stderr.write(`  ${chalk.red('error:')} ${msg}\n`);
    },
  };
}
