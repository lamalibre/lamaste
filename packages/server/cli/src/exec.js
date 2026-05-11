/**
 * Shared exec helper that wraps execa for use by core library functions.
 *
 * The core library (@lamalibre/lamaste/server) accepts an ExecFn dependency.
 * This module provides the concrete implementation backed by execa.
 */

import { execa } from 'execa';

/**
 * Execute a command with array arguments via execa.
 * Conforms to the ExecFn interface expected by @lamalibre/lamaste/server.
 *
 * @param {string} file
 * @param {string[]} args
 * @param {{ cwd?: string, timeout?: number, input?: string }} [options]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export async function exec(file, args, options) {
  const result = await execa(file, args, {
    cwd: options?.cwd,
    timeout: options?.timeout,
    input: options?.input,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}
