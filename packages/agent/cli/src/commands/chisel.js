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
import {
  requireAgentConfig,
  isAgentLoaded,
  unloadAgent,
  loadAgent,
  getAgentPid,
} from '@lamalibre/lamaste/agent';
import { fetchAgentConfig, fetchChiselCredential } from '../lib/panel-api.js';
import {
  generateServiceConfig,
  writeServiceConfigFile,
  injectChiselAuth,
  injectChiselFingerprint,
} from '../lib/service-config.js';
import { saveChiselCredential } from '../lib/chisel-credential.js';

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
                       and restart the agent service.
`);
}

/**
 * @param {{ label: string }} opts
 */
async function refreshCredential({ label }) {
  const config = await requireAgentConfig(label);

  const ctx = { tunnels: [], serviceConfig: null };

  const tasks = new Listr(
    [
      {
        title: 'Fetching new chisel credential',
        task: async (_c, task) => {
          const credential = await fetchChiselCredential(config);
          await saveChiselCredential(label, credential);
          ctx._credential = credential;
          task.output = `Stored credential for ${credential.user}`;
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Refreshing tunnel configuration',
        task: async (_c, task) => {
          const agentConfig = await fetchAgentConfig(config);
          let chiselArgs = injectChiselAuth(agentConfig.chiselArgs, ctx._credential);
          if (config.chiselServerCertSha256Hex) {
            chiselArgs = injectChiselFingerprint(chiselArgs, config.chiselServerCertSha256Hex);
          }
          ctx.serviceConfig = generateServiceConfig(chiselArgs, label);
          ctx.tunnels = (agentConfig.tunnels || []);
          task.output = `${ctx.tunnels.length} tunnel(s) configured`;
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Writing service config',
        task: async () => {
          await writeServiceConfigFile(ctx.serviceConfig, label);
        },
      },
      {
        title: 'Restarting agent',
        skip: () => ctx.tunnels.length === 0 && 'No tunnels configured — service not started',
        task: async () => {
          if (await isAgentLoaded(label)) {
            await unloadAgent(label);
          }
          await loadAgent(label);
        },
      },
      {
        title: 'Verifying agent is running',
        skip: () => ctx.tunnels.length === 0 && 'No tunnels configured',
        task: async (_c, task) => {
          await new Promise((r) => setTimeout(r, 2000));
          const pid = await getAgentPid(label);
          if (pid) {
            task.output = `Agent running (PID ${pid})`;
          } else if (await isAgentLoaded(label)) {
            task.output = 'Agent loaded (process starting...)';
          } else {
            throw new Error('Agent failed to load. Check logs with: lamaste-agent logs');
          }
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
