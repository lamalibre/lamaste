import { existsSync } from 'node:fs';
import { execa } from 'execa';
import chalk from 'chalk';
import { assertMacOS, LOG_FILE, ERROR_LOG_FILE } from '../lib/platform.js';

/**
 * Stream chisel logs to the terminal.
 * Tails both stdout and stderr log files.
 */
export async function runLogs() {
  assertMacOS();

  const files = [];
  if (existsSync(LOG_FILE)) files.push(LOG_FILE);
  if (existsSync(ERROR_LOG_FILE)) files.push(ERROR_LOG_FILE);

  if (files.length === 0) {
    console.log('');
    console.log(chalk.yellow('  No log files found.'));
    console.log(chalk.dim(`  Expected: ${LOG_FILE}`));
    console.log(chalk.dim(`  Expected: ${ERROR_LOG_FILE}`));
    console.log(chalk.dim('  Has the agent been started? Run "portlama-agent setup" first.'));
    console.log('');
    process.exit(1);
  }

  console.log(chalk.dim(`  Streaming logs from: ${files.join(', ')}`));
  console.log(chalk.dim('  Press Ctrl+C to stop.'));
  console.log('');

  // tail -f streams indefinitely — use stdio: 'inherit' to forward to terminal
  await execa('tail', ['-f', ...files], { stdio: 'inherit' });
}
