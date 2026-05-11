import chalk from 'chalk';
import { assertSupportedPlatform } from '@lamalibre/lamaste/agent';
import { listAgents, getCurrentLabel } from '@lamalibre/lamaste/agent';
import { isAgentLoaded, getAgentPid } from '@lamalibre/lamaste/agent';

/**
 * List all configured agents with their status.
 */
export async function runList() {
  assertSupportedPlatform();

  const b = chalk.bold;
  const c = chalk.cyan;
  const g = chalk.green;
  const r = chalk.red;
  const d = chalk.dim;

  const agents = await listAgents();
  const currentLabel = await getCurrentLabel();

  console.log('');
  console.log(b('  Lamaste Agents'));
  console.log(d('  ─'.repeat(28)));

  if (agents.length === 0) {
    console.log(`  ${d('No agents configured.')} Run ${c('lamaste-agent setup')} to add one.`);
    console.log('');
    return;
  }

  for (const agent of agents) {
    const isCurrent = agent.label === currentLabel;
    const marker = isCurrent ? c(' ← current') : '';

    let statusText;
    try {
      const loaded = await isAgentLoaded(agent.label);
      const pid = await getAgentPid(agent.label);
      if (loaded && pid) {
        statusText = g(`running (PID ${pid})`);
      } else if (loaded) {
        statusText = chalk.yellow('loaded (starting...)');
      } else {
        statusText = r('stopped');
      }
    } catch {
      statusText = d('unknown');
    }

    console.log(`  ${c('•')} ${b(agent.label)}${marker}`);
    console.log(`    ${d('Panel:')}  ${agent.panelUrl}`);
    if (agent.domain) {
      console.log(`    ${d('Domain:')} ${agent.domain}`);
    }
    console.log(`    ${d('Status:')} ${statusText}`);
    console.log(`    ${d('Auth:')}   ${agent.authMethod || 'p12'}`);
  }

  console.log('');
}
