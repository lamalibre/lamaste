import { Listr } from 'listr2';
import chalk from 'chalk';
import { assertMacOS } from '../lib/platform.js';
import { requireAgentConfig, saveAgentConfig } from '../lib/config.js';
import { fetchPlist, fetchTunnels } from '../lib/panel-api.js';
import { rewritePlist, writePlistFile } from '../lib/plist.js';
import { isAgentLoaded, unloadAgent, loadAgent, getAgentPid } from '../lib/launchctl.js';

/**
 * Re-fetch the plist from the panel and restart the agent.
 * Used after adding/removing tunnels on the panel.
 */
export async function runUpdate() {
  assertMacOS();

  const config = await requireAgentConfig();

  const ctx = {
    plistXml: null,
    tunnels: [],
  };

  const tasks = new Listr(
    [
      {
        title: 'Fetching updated tunnel configuration',
        task: async (_ctx, task) => {
          const data = await fetchPlist(config.panelUrl, config.p12Path, config.p12Password);
          ctx.plistXml = data.plist;

          const tunnelData = await fetchTunnels(config.panelUrl, config.p12Path, config.p12Password);
          ctx.tunnels = tunnelData.tunnels || [];
          task.output = `${ctx.tunnels.length} tunnel(s) configured`;
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Rewriting plist paths',
        task: async () => {
          ctx.plistXml = rewritePlist(ctx.plistXml);
        },
      },
      {
        title: 'Writing plist file',
        task: async () => {
          await writePlistFile(ctx.plistXml);
        },
      },
      {
        title: 'Unloading agent',
        skip: async () => {
          const loaded = await isAgentLoaded();
          return !loaded && 'Agent not currently loaded';
        },
        task: async () => {
          await unloadAgent();
        },
      },
      {
        title: 'Loading agent',
        task: async () => {
          await loadAgent();
        },
      },
      {
        title: 'Verifying agent is running',
        task: async (_ctx, task) => {
          await new Promise((r) => setTimeout(r, 2000));
          const pid = await getAgentPid();
          if (pid) {
            task.output = `Agent running (PID ${pid})`;
          } else {
            const loaded = await isAgentLoaded();
            if (loaded) {
              task.output = 'Agent loaded (process starting...)';
            } else {
              throw new Error(
                'Agent failed to load. Check logs with: portlama-agent logs',
              );
            }
          }
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Saving configuration',
        task: async () => {
          await saveAgentConfig({
            ...config,
            updatedAt: new Date().toISOString(),
          });
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
  console.log(chalk.green('  Agent updated successfully.'));
  if (ctx.tunnels.length > 0) {
    console.log(chalk.dim(`  ${ctx.tunnels.length} tunnel(s) active.`));
  }
  console.log('');
}
