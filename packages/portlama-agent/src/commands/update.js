import { Listr } from 'listr2';
import chalk from 'chalk';
import { assertSupportedPlatform } from '../lib/platform.js';
import { requireAgentConfig, saveAgentConfig } from '../lib/config.js';
import { fetchAgentConfig, fetchTunnels } from '../lib/panel-api.js';
import { generateServiceConfig, writeServiceConfigFile } from '../lib/service-config.js';
import { isAgentLoaded, unloadAgent, loadAgent, getAgentPid } from '../lib/service.js';

/**
 * Re-fetch tunnel config from the panel and restart the agent.
 * Used after adding/removing tunnels on the panel.
 * @param {{ label: string }} options
 */
export async function runUpdate({ label }) {
  assertSupportedPlatform();

  const config = await requireAgentConfig(label);

  const ctx = {
    serviceConfig: null,
    tunnels: [],
  };

  const tasks = new Listr(
    [
      {
        title: 'Fetching updated tunnel configuration',
        task: async (_ctx, task) => {
          const agentConfig = await fetchAgentConfig(config);
          ctx.serviceConfig = generateServiceConfig(agentConfig.chiselArgs, label);

          const tunnelData = await fetchTunnels(config);
          ctx.tunnels = tunnelData.tunnels || [];
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
        title: 'Unloading agent',
        skip: async () => {
          const loaded = await isAgentLoaded(label);
          return !loaded && 'Agent not currently loaded';
        },
        task: async () => {
          await unloadAgent(label);
        },
      },
      {
        title: 'Loading agent',
        task: async () => {
          await loadAgent(label);
        },
      },
      {
        title: 'Verifying agent is running',
        task: async (_ctx, task) => {
          await new Promise((r) => setTimeout(r, 2000));
          const pid = await getAgentPid(label);
          if (pid) {
            task.output = `Agent running (PID ${pid})`;
          } else {
            const loaded = await isAgentLoaded(label);
            if (loaded) {
              task.output = 'Agent loaded (process starting...)';
            } else {
              throw new Error('Agent failed to load. Check logs with: portlama-agent logs');
            }
          }
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Saving configuration',
        task: async () => {
          await saveAgentConfig(label, {
            ...config,
            updatedAt: new Date().toISOString(),
          });
        },
      },
      {
        title: 'Reporting installed plugins',
        task: async (_ctx, task) => {
          const { readAgentPluginRegistry } = await import('../lib/agent-plugins.js');
          const registry = await readAgentPluginRegistry(label);
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
            const { curlAuthenticatedJson } = await import('../lib/panel-api.js');
            await curlAuthenticatedJson(config, [
              '-X', 'POST',
              '-H', 'Content-Type: application/json',
              '-d', JSON.stringify({ plugins: pluginReport }),
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
  if (ctx.tunnels.length > 0) {
    console.log(chalk.dim(`  ${ctx.tunnels.length} tunnel(s) active.`));
  }
  console.log('');
}
