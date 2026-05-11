import chalk from 'chalk';
import {
  assertSupportedPlatform,
  setCurrentAgent,
  validateLabel,
  listAgents,
} from '@lamalibre/lamaste/agent';

/**
 * Switch the current (default) agent.
 * @param {string | undefined} targetLabel
 */
export async function runSwitch(targetLabel) {
  assertSupportedPlatform();

  if (!targetLabel) {
    console.error(`\n  Usage: ${chalk.cyan('lamaste-agent switch <label>')}\n`);

    const agents = await listAgents();
    if (agents.length > 0) {
      console.error(chalk.dim('  Available agents:'));
      for (const agent of agents) {
        console.error(`    ${chalk.cyan('•')} ${agent.label}`);
      }
      console.error('');
    }
    process.exit(1);
  }

  validateLabel(targetLabel);
  await setCurrentAgent(targetLabel);

  console.log('');
  console.log(`  ${chalk.green('✓')} Default agent switched to ${chalk.bold(targetLabel)}`);
  console.log('');
}
