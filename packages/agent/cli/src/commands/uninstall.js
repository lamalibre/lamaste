import { createInterface } from 'node:readline';
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Listr } from 'listr2';
import chalk from 'chalk';
import {
  assertSupportedPlatform,
  LAMASTE_DIR,
  isLinux,
  serviceConfigPath,
  agentDataDir,
  LEGACY_SERVICE_CONFIG_PATH,
  runUserSystemctl,
} from '@lamalibre/lamaste/agent';
import {
  isAgentLoaded,
  unloadAgent,
  isPanelServiceLoaded,
  unloadPanelService,
} from '@lamalibre/lamaste/agent';
import { listAgents, removeAgent, loadRegistry } from '@lamalibre/lamaste/agent';
import { removePanelServiceConfig } from '../lib/panel-service.js';

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
    console.error(
      `  Use ${chalk.cyan('lamaste-agent uninstall --label <name>')} or ${chalk.cyan('--all')}`,
    );
    console.error('');
    process.exit(1);
  }

  if (registry && registry.agents.length === 1) {
    return uninstallSingle(registry.agents[0].label);
  }

  // No registry — fall back to legacy uninstall (remove the agent root directory)
  return uninstallLegacy();
}

/**
 * Uninstall a single agent by label.
 * @param {string} label
 */
async function uninstallSingle(label) {
  const svcPath = serviceConfigPath(label);
  const dataDir = agentDataDir(label);

  const isTTY = process.stdout.isTTY && process.stderr.isTTY;
  const tasks = new Listr(
    [
      {
        title: `Stopping panel server "${label}"`,
        skip: async () => {
          const loaded = await isPanelServiceLoaded(label);
          return !loaded && 'Panel not running';
        },
        task: async () => {
          await unloadPanelService(label);
          await removePanelServiceConfig(label);
        },
      },
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
            await runUserSystemctl(['daemon-reload']);
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
      renderer: isTTY ? 'default' : 'simple',
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
 * Uninstall all agents and remove ~/.lamalibre/lamaste.
 */
async function uninstallAll() {
  const agents = await listAgents();

  // Confirm destructive operation — certificates may not be recoverable
  const confirmed = await new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const count = agents.length;
    rl.question(
      chalk.yellow(
        `  This will remove ${count} agent(s) and delete ~/.lamalibre/lamaste. Continue? (y/N) `,
      ),
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

  const isTTY = process.stdout.isTTY && process.stderr.isTTY;
  const tasks = new Listr(
    [
      // Stop all panel services
      ...agents.map((agent) => ({
        title: `Stopping panel server "${agent.label}"`,
        skip: async () => {
          const loaded = await isPanelServiceLoaded(agent.label);
          return !loaded && 'Panel not running';
        },
        task: async () => {
          await unloadPanelService(agent.label);
          await removePanelServiceConfig(agent.label);
        },
      })),
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
          await runUserSystemctl(['daemon-reload']);
        },
      },
      {
        title: 'Removing ~/.lamalibre/lamaste directory',
        skip: () => !existsSync(LAMASTE_DIR) && 'Directory not found',
        task: async () => {
          await rm(LAMASTE_DIR, { recursive: true });
        },
      },
    ],
    {
      renderer: isTTY ? 'default' : 'simple',
      rendererOptions: { collapseSubtasks: false },
      exitOnError: true,
    },
  );

  await tasks.run();

  console.log('');
  console.log(chalk.green('  All Lamaste agents uninstalled successfully.'));
  console.log(chalk.dim('  All agent files have been removed.'));
  console.log('');
}

/**
 * Legacy uninstall for pre-registry installations.
 */
async function uninstallLegacy() {
  const isTTY = process.stdout.isTTY && process.stderr.isTTY;
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
        skip: () => !existsSync(LEGACY_SERVICE_CONFIG_PATH) && 'Service config not found',
        task: async () => {
          await rm(LEGACY_SERVICE_CONFIG_PATH);
          if (isLinux()) {
            const { execa } = await import('execa');
            await execa('systemctl', ['daemon-reload']);
          }
        },
      },
      {
        title: 'Removing ~/.lamalibre/lamaste directory',
        skip: () => !existsSync(LAMASTE_DIR) && 'Directory not found',
        task: async () => {
          await rm(LAMASTE_DIR, { recursive: true });
        },
      },
    ],
    {
      renderer: isTTY ? 'default' : 'simple',
      rendererOptions: { collapseSubtasks: false },
      exitOnError: true,
    },
  );

  await tasks.run();

  console.log('');
  console.log(chalk.green('  Lamaste Agent uninstalled successfully.'));
  console.log(chalk.dim('  All agent files have been removed.'));
  console.log('');
}
