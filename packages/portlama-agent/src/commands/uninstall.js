import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Listr } from 'listr2';
import chalk from 'chalk';
import { assertMacOS, AGENT_DIR, PLIST_PATH } from '../lib/platform.js';
import { isAgentLoaded, unloadAgent } from '../lib/launchctl.js';

/**
 * Unload the agent, remove the plist, chisel binary, and config.
 */
export async function runUninstall() {
  assertMacOS();

  const tasks = new Listr(
    [
      {
        title: 'Unloading agent',
        skip: async () => {
          const loaded = await isAgentLoaded();
          return !loaded && 'Agent not loaded';
        },
        task: async () => {
          await unloadAgent();
        },
      },
      {
        title: 'Removing plist file',
        skip: () => !existsSync(PLIST_PATH) && 'Plist not found',
        task: async () => {
          await rm(PLIST_PATH);
        },
      },
      {
        title: 'Removing ~/.portlama directory',
        skip: () => !existsSync(AGENT_DIR) && 'Directory not found',
        task: async () => {
          await rm(AGENT_DIR, { recursive: true });
        },
      },
    ],
    {
      renderer: 'default',
      rendererOptions: { collapseSubtasks: false },
      exitOnError: true,
    },
  );

  await tasks.run();

  console.log('');
  console.log(chalk.green('  Portlama Agent uninstalled successfully.'));
  console.log(chalk.dim('  All agent files have been removed.'));
  console.log('');
}
