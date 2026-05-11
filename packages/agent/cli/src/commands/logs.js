import { existsSync } from 'node:fs';
import { execa } from 'execa';
import chalk from 'chalk';
import { assertSupportedPlatform, agentLogFile, agentErrorLogFile } from '@lamalibre/lamaste/agent';

/**
 * Stream chisel logs to the terminal.
 * Tails both stdout and stderr log files for the specified agent.
 * @param {{ label: string }} options
 */
export async function runLogs({ label }) {
  assertSupportedPlatform();

  const logFile = agentLogFile(label);
  const errorLogFile = agentErrorLogFile(label);

  const files = [];
  if (existsSync(logFile)) files.push(logFile);
  if (existsSync(errorLogFile)) files.push(errorLogFile);

  if (files.length === 0) {
    console.log('');
    console.log(chalk.yellow(`  No log files found for agent "${label}".`));
    console.log(chalk.dim(`  Expected: ${logFile}`));
    console.log(chalk.dim(`  Expected: ${errorLogFile}`));
    console.log(chalk.dim(`  Has the agent been started? Run "lamaste-agent setup --label ${label}" first.`));
    console.log('');
    process.exit(1);
  }

  console.log(chalk.dim(`  Streaming logs for agent "${label}" from: ${files.join(', ')}`));
  console.log(chalk.dim('  Press Ctrl+C to stop.'));
  console.log('');

  await execa('tail', ['-f', ...files], { stdio: 'inherit' });
}
