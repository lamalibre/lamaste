import { Listr } from 'listr2';
import chalk from 'chalk';
import {
  assertSupportedPlatform,
  requireAgentConfig,
  updateAgentConfig,
  readPluginRegistry,
  agentPluginsFile,
  resolveInstalledAgentCli,
  installSyncService,
} from '@lamalibre/lamaste/agent';
import { curlAuthenticatedJson } from '../lib/panel-api.js';
import { convergeWithPanel, describeConverge } from '../lib/converge.js';

/**
 * Converge with the panel now and restart the tunnel client, and make sure
 * the sync timer is installed (agents set up before it existed get it here).
 * The timer applies tunnel changes within 30 seconds on its own; `update` is
 * for applying one immediately.
 * @param {{ label: string }} options
 */
export async function runUpdate({ label }) {
  assertSupportedPlatform();

  const config = await requireAgentConfig(label);
  // The sync timer must run an installed program — fail before changing anything.
  const program = await resolveInstalledAgentCli(process.argv[1]);

  const ctx = { result: null };

  const tasks = new Listr(
    [
      {
        title: 'Converging with the panel',
        task: async (_ctx, task) => {
          const { result } = await convergeWithPanel(label, { forceRestart: true });
          ctx.result = result;
          task.output = describeConverge(result);
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Installing the sync timer',
        task: async (_ctx, task) => {
          await installSyncService(label, program);
          task.output = 'Tunnel changes on the panel apply within 30 seconds';
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Saving configuration',
        task: async () => {
          await updateAgentConfig(label, (current) => {
            current.updatedAt = new Date().toISOString();
          });
        },
      },
      {
        title: 'Reporting installed plugins',
        task: async (_ctx, task) => {
          const registry = await readPluginRegistry(agentPluginsFile(label));
          const enabledPlugins = registry.plugins.filter((p) => p.status === 'enabled');
          if (enabledPlugins.length === 0) {
            task.skip('No enabled plugins');
            return;
          }
          const pluginReport = enabledPlugins.map((p) => ({
            name: p.name,
            version: p.version,
            capabilities: p.capabilities || [],
          }));
          try {
            await curlAuthenticatedJson(config, [
              '-X',
              'POST',
              '-H',
              'Content-Type: application/json',
              '-d',
              JSON.stringify({ plugins: pluginReport }),
              `${config.panelUrl}/api/agents/plugins/report`,
            ]);
            task.output = `Reported ${enabledPlugins.length} plugin(s)`;
          } catch {
            task.skip('Server does not support plugin reporting yet');
          }
        },
        rendererOptions: { persistentOutput: true },
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
  console.log(chalk.green(`  Agent "${label}" updated successfully.`));
  if (ctx.result) {
    console.log(chalk.dim(`  ${describeConverge(ctx.result)}`));
    for (const warning of ctx.result.warnings) console.log(chalk.yellow(`  ${warning}`));
  }
  console.log('');
}
