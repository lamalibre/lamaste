import { Listr } from 'listr2';
import chalk from 'chalk';
import { assertSupportedPlatform } from '@lamalibre/lamaste/agent';
import { requireAgentConfig, saveAgentConfig } from '@lamalibre/lamaste/agent';
import { isAgentLoaded, unloadAgent, loadAgent, getAgentPid } from '@lamalibre/lamaste/agent';
import { readPluginRegistry, agentPluginsFile } from '@lamalibre/lamaste/agent';
import {
  fetchAgentConfig,
  fetchTunnels,
  fetchChiselCredential,
  curlAuthenticatedJson,
} from '../lib/panel-api.js';
import {
  generateServiceConfig,
  writeServiceConfigFile,
  injectChiselAuth,
  injectChiselFingerprint,
} from '../lib/service-config.js';
import { loadChiselCredential, saveChiselCredential } from '../lib/chisel-credential.js';

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

          // Prefer the persisted credential — only re-fetch if we have none
          // on disk. The credential rarely changes; refreshing it on every
          // `lamaste-agent update` would needlessly hit the panel.
          let credential = await loadChiselCredential(label);
          if (!credential) {
            credential = await fetchChiselCredential(config);
            await saveChiselCredential(label, credential);
          }

          // Re-pin the chisel TLS server cert if we already have a stored
          // fingerprint. We don't TOFU here — that would silently accept a
          // rotated cert. Use the saved pin as-is and let the operator run
          // `lamaste-agent panel reset-pin` if rotation was intentional.
          let chiselArgs = injectChiselAuth(agentConfig.chiselArgs, credential);
          if (config.chiselServerCertSha256Hex) {
            chiselArgs = injectChiselFingerprint(chiselArgs, config.chiselServerCertSha256Hex);
          }
          ctx.serviceConfig = generateServiceConfig(chiselArgs, label);

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
              throw new Error('Agent failed to load. Check logs with: lamaste-agent logs');
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
  if (ctx.tunnels.length > 0) {
    console.log(chalk.dim(`  ${ctx.tunnels.length} tunnel(s) active.`));
  }
  console.log('');
}
