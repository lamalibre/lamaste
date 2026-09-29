/**
 * lamaste-agent chisel — manage chisel tunnel-server credential.
 *
 * Subcommands:
 *   refresh-credential   Re-fetch this agent's chisel credential from the
 *                        panel and rewrite the local service config. Used
 *                        after an admin rotates the credential server-side.
 */

import chalk from 'chalk';
import { Listr } from 'listr2';
import { requireAgentConfig, saveChiselCredential } from '@lamalibre/lamaste/agent';
import { fetchChiselCredential } from '../lib/panel-api.js';
import { convergeWithPanel, describeConverge } from '../lib/converge.js';

/**
 * @param {string[]} args
 * @param {{ label: string }} options
 */
export async function runChisel(args, { label }) {
  const sub = args[0];

  switch (sub) {
    case 'refresh-credential':
      return refreshCredential({ label });
    default:
      printChiselUsage();
      process.exit(sub ? 1 : 0);
  }
}

function printChiselUsage() {
  const b = chalk.bold;
  const c = chalk.cyan;
  console.log(`
${b('Usage:')} lamaste-agent chisel <subcommand>

${b('Subcommands:')}
  ${c('refresh-credential')}   Re-fetch chisel tunnel credential from the panel
                       and restart the agent service. The sync timer does
                       this by itself after a rotation; use this to apply
                       it immediately.
`);
}

/**
 * @param {{ label: string }} opts
 */
async function refreshCredential({ label }) {
  const config = await requireAgentConfig(label);
  const ctx = { result: null };

  const tasks = new Listr(
    [
      {
        title: 'Fetching the chisel credential',
        task: async (_c, task) => {
          const credential = await fetchChiselCredential(config);
          await saveChiselCredential(label, { ...credential, issuedAt: credential.createdAt });
          task.output = `Stored credential for ${credential.user}`;
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Converging the tunnel client',
        task: async (_c, task) => {
          const { result } = await convergeWithPanel(label, { forceRestart: true });
          ctx.result = result;
          task.output = describeConverge(result);
        },
        rendererOptions: { persistentOutput: true },
      },
    ],
    { renderer: 'default', rendererOptions: { collapseSubtasks: false }, exitOnError: true },
  );

  await tasks.run();

  console.log('');
  console.log(chalk.green(`  Chisel credential refreshed for "${label}".`));
  console.log('');
}
