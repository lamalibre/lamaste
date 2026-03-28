import { createInterface } from 'node:readline';
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Listr } from 'listr2';
import chalk from 'chalk';
import { assertSupportedPlatform, AGENT_DIR, isLinux, serviceConfigPath, agentDataDir } from '../lib/platform.js';
import { isAgentLoaded, unloadAgent } from '../lib/service.js';
import { listAgents, removeAgent, loadRegistry } from '../lib/registry.js';

/**
 * Unload the agent, remove the service config, and config.
 * Supports --label for single-agent and --all for everything.
 * @param {{ label?: string, all?: boolean }} options
 */
export async function runUninstall({ label, all }) {
  assertSupportedPlatform();

  if (all) {
    return uninstallAll();
  }

  if (label) {
    return uninstallSingle(label);
  }

  // No label, no --all: check how many agents exist
  const registry = await loadRegistry();
  if (registry && registry.agents.length > 1) {
    console.error('');
    console.error(chalk.red('  Multiple agents configured. Specify which to uninstall:'));
    console.error('');
    for (const a of registry.agents) {
      console.error(`    ${chalk.cyan('•')} ${chalk.bold(a.label)}`);
    }
    console.error('');
    console.error(`  Use ${chalk.cyan('portlama-agent uninstall --label <name>')} or ${chalk.cyan('--all')}`);
    console.error('');
    process.exit(1);
  }

  if (registry && registry.agents.length === 1) {
    return uninstallSingle(registry.agents[0].label);
  }

  // No registry — fall back to legacy uninstall (remove ~/.portlama)
  return uninstallLegacy();
}

/**
 * Uninstall a single agent by label.
 * @param {string} label
 */
async function uninstallSingle(label) {
  const svcPath = serviceConfigPath(label);
  const dataDir = agentDataDir(label);

  const tasks = new Listr(
    [
      {
        title: `Unloading agent "${label}"`,
        skip: async () => {
          const loaded = await isAgentLoaded(label);
          return !loaded && 'Agent not loaded';
        },
        task: async () => {
          await unloadAgent(label);
        },
      },
      {
        title: 'Removing service config',
        skip: () => !existsSync(svcPath) && 'Service config not found',
        task: async () => {
          await rm(svcPath);
          if (isLinux()) {
            const { execa } = await import('execa');
            await execa('systemctl', ['daemon-reload']);
          }
        },
      },
      {
        title: `Removing agent data (${label})`,
        skip: () => !existsSync(dataDir) && 'Agent data not found',
        task: async () => {
          await rm(dataDir, { recursive: true });
        },
      },
      {
        title: 'Updating registry',
        task: async () => {
          await removeAgent(label);
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
  console.log(chalk.green(`  Agent "${label}" uninstalled successfully.`));
  console.log('');
}

/**
 * Uninstall all agents and remove ~/.portlama.
 */
async function uninstallAll() {
  const agents = await listAgents();

  // Confirm destructive operation — certificates may not be recoverable
  const confirmed = await new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const count = agents.length;
    rl.question(
      chalk.yellow(`  This will remove ${count} agent(s) and delete ~/.portlama. Continue? (y/N) `),
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y');
      },
    );
  });

  if (!confirmed) {
    console.log(chalk.dim('  Aborted.'));
    return;
  }

  const tasks = new Listr(
    [
      // Unload all agents
      ...agents.map((agent) => ({
        title: `Unloading agent "${agent.label}"`,
        skip: async () => {
          const loaded = await isAgentLoaded(agent.label);
          return !loaded && 'Agent not loaded';
        },
        task: async () => {
          await unloadAgent(agent.label);
        },
      })),
      // Remove all service config files
      ...agents.map((agent) => {
        const svcPath = serviceConfigPath(agent.label);
        return {
          title: `Removing service config (${agent.label})`,
          skip: () => !existsSync(svcPath) && 'Service config not found',
          task: async () => {
            await rm(svcPath);
          },
        };
      }),
      {
        title: 'Reloading service manager',
        skip: () => !isLinux() && 'macOS',
        task: async () => {
          const { execa } = await import('execa');
          await execa('systemctl', ['daemon-reload']);
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
  console.log(chalk.green('  All Portlama agents uninstalled successfully.'));
  console.log(chalk.dim('  All agent files have been removed.'));
  console.log('');
}

/**
 * Legacy uninstall for pre-registry installations.
 */
async function uninstallLegacy() {
  const { SERVICE_CONFIG_PATH } = await import('../lib/platform.js');

  const tasks = new Listr(
    [
      {
        title: 'Unloading agent',
        skip: async () => {
          // Check if legacy service is loaded
          try {
            const loaded = await isAgentLoaded('default');
            return !loaded && 'Agent not loaded';
          } catch {
            return 'Could not check agent status';
          }
        },
        task: async () => {
          await unloadAgent('default').catch(() => {});
        },
      },
      {
        title: 'Removing service config',
        skip: () => !existsSync(SERVICE_CONFIG_PATH) && 'Service config not found',
        task: async () => {
          await rm(SERVICE_CONFIG_PATH);
          if (isLinux()) {
            const { execa } = await import('execa');
            await execa('systemctl', ['daemon-reload']);
          }
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
