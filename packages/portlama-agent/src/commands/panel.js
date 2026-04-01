/**
 * portlama-agent panel — manage the agent web panel.
 *
 * Usage:
 *   portlama-agent panel --enable [--port 9393]
 *   portlama-agent panel --disable
 *   portlama-agent panel --status
 */

import chalk from 'chalk';
import { loadAgentConfig, saveAgentConfig } from '../lib/config.js';
import { assertSupportedPlatform } from '../lib/platform.js';
import {
  generatePanelServiceConfig,
  writePanelServiceConfig,
  isPanelLoaded,
  loadPanelService,
  unloadPanelService,
  removePanelServiceConfig,
} from '../lib/panel-service.js';
import { exposePanelTunnel, retractPanelTunnel, fetchPanelTunnelStatus } from '../lib/panel-api.js';

const DEFAULT_PANEL_PORT = 9393;

/**
 * @param {string[]} args
 * @param {{ label: string, json?: boolean }} options
 */
export async function runPanel(args, { label, json: globalJson = false }) {
  assertSupportedPlatform();

  const config = await loadAgentConfig(label);
  if (!config) {
    console.error(chalk.red('Agent not configured. Run setup first.'));
    process.exit(1);
  }

  const isJson = globalJson || args.includes('--json');
  const isEnable = args.includes('--enable');
  const isDisable = args.includes('--disable');
  const isLocalOnly = args.includes('--local-only');
  const isStatus = args.includes('--status') || (!isEnable && !isDisable);

  // Parse --port flag
  let port = config.panelPort || DEFAULT_PANEL_PORT;
  const portIdx = args.indexOf('--port');
  if (portIdx !== -1 && args[portIdx + 1]) {
    const parsed = parseInt(args[portIdx + 1], 10);
    if (!Number.isNaN(parsed) && parsed >= 1024 && parsed <= 65535) {
      port = parsed;
    }
  }

  if (isEnable) {
    await enablePanel(label, config, port, isJson, isLocalOnly);
  } else if (isDisable) {
    await disablePanel(label, config, isJson, isLocalOnly);
  } else if (isStatus) {
    await showStatus(label, config, isJson);
  }
}

async function enablePanel(label, config, port, isJson, localOnly = false) {
  // 1. Check if already enabled
  const loaded = await isPanelLoaded(label);
  if (loaded) {
    if (isJson) {
      console.log(JSON.stringify({ ok: true, alreadyRunning: true, port: config.panelPort || port }));
    } else {
      console.log(chalk.yellow('Panel service is already running.'));
    }
    return;
  }

  // 2. Generate and write service config
  const content = generatePanelServiceConfig(label, port);
  await writePanelServiceConfig(content, label);

  // 3. Start the panel service
  await loadPanelService(label);

  // 4. Save panel config
  config.panelPort = port;
  config.panelEnabled = true;
  config.updatedAt = new Date().toISOString();
  await saveAgentConfig(label, config);

  // 5. If local-only, skip tunnel exposure and chisel restart
  if (localOnly) {
    if (isJson) {
      console.log(JSON.stringify({ ok: true, port }));
    } else {
      console.log(chalk.green('\nAgent panel started locally.'));
      console.log(`  Port: ${chalk.cyan(port)}`);
    }
    return;
  }

  // 6. Create the tunnel on the panel server
  let tunnel;
  try {
    const result = await exposePanelTunnel(config, port);
    tunnel = result.tunnel;
  } catch (err) {
    // Rollback: stop the panel service we just started
    await unloadPanelService(label);
    await removePanelServiceConfig(label);
    config.panelEnabled = false;
    delete config.panelPort;
    await saveAgentConfig(label, config);
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (isJson) {
      console.log(JSON.stringify({ error: msg }));
    } else {
      console.error(chalk.red(`Failed to expose panel: ${msg}`));
    }
    process.exit(1);
  }

  // 7. Update the agent's chisel service (needs new tunnel mapping)
  try {
    const { fetchAgentConfig } = await import('../lib/panel-api.js');
    const { generateServiceConfig, writeServiceConfigFile } =
      await import('../lib/service-config.js');
    const { unloadAgent, loadAgent } = await import('../lib/service.js');
    const agentConfig = await fetchAgentConfig(config);
    const serviceContent = generateServiceConfig(agentConfig.chiselArgs, label);
    await writeServiceConfigFile(serviceContent, label);
    await unloadAgent(label);
    await loadAgent(label);
  } catch (err) {
    if (!isJson) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.log(chalk.yellow(`Warning: Could not restart chisel with new tunnel: ${msg}`));
    }
  }

  if (isJson) {
    console.log(JSON.stringify({ ok: true, fqdn: tunnel?.fqdn, port }));
  } else {
    console.log(chalk.green('\nAgent panel exposed successfully!'));
    if (tunnel?.fqdn) {
      console.log(`\n  URL: ${chalk.cyan(`https://${tunnel.fqdn}`)}`);
    }
    console.log(`  Port: ${chalk.cyan(port)}`);
    console.log(chalk.dim('\n  Access requires a valid mTLS certificate (admin or agent cert).'));
  }
}

async function disablePanel(label, config, isJson, localOnly = false) {
  // 1. Retract the tunnel (skip in local-only mode)
  if (!localOnly) {
    try {
      await retractPanelTunnel(config);
    } catch (err) {
      if (!isJson) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.log(chalk.yellow(`Warning: Could not retract panel tunnel: ${msg}`));
      }
    }
  }

  // 2. Stop the panel service
  await unloadPanelService(label);

  // 3. Remove service config
  await removePanelServiceConfig(label);

  // 4. Update chisel (remove the panel tunnel mapping) — skip in local-only mode
  if (!localOnly) {
    try {
      const { fetchAgentConfig } = await import('../lib/panel-api.js');
      const { generateServiceConfig, writeServiceConfigFile } =
        await import('../lib/service-config.js');
      const { unloadAgent, loadAgent } = await import('../lib/service.js');
      const agentConfig = await fetchAgentConfig(config);
      const serviceContent = generateServiceConfig(agentConfig.chiselArgs, label);
      await writeServiceConfigFile(serviceContent, label);
      await unloadAgent(label);
      await loadAgent(label);
    } catch (err) {
      if (!isJson) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.log(chalk.yellow(`Warning: Could not restart chisel: ${msg}`));
      }
    }
  }

  // 5. Update config
  config.panelEnabled = false;
  delete config.panelPort;
  config.updatedAt = new Date().toISOString();
  await saveAgentConfig(label, config);

  if (isJson) {
    console.log(JSON.stringify({ ok: true }));
  } else {
    console.log(chalk.green(localOnly ? 'Agent panel stopped.' : 'Agent panel retracted.'));
  }
}

async function showStatus(label, config, isJson) {
  const loaded = await isPanelLoaded(label);
  let tunnelStatus = { enabled: false, fqdn: null, port: null };

  try {
    tunnelStatus = await fetchPanelTunnelStatus(config);
  } catch {
    // Agent may not have panel:expose capability — that is fine
  }

  if (isJson) {
    console.log(
      JSON.stringify({
        running: loaded,
        enabled: tunnelStatus.enabled,
        fqdn: tunnelStatus.fqdn,
        port: config.panelPort || null,
      }),
    );
    return;
  }

  console.log(chalk.bold('\nAgent Panel Status\n'));
  console.log(`  Service:  ${loaded ? chalk.green('running') : chalk.red('stopped')}`);
  console.log(
    `  Tunnel:   ${tunnelStatus.enabled ? chalk.green('exposed') : chalk.dim('not exposed')}`,
  );

  if (tunnelStatus.fqdn) {
    console.log(`  URL:      ${chalk.cyan(`https://${tunnelStatus.fqdn}`)}`);
  }

  if (config.panelPort) {
    console.log(`  Port:     ${chalk.cyan(config.panelPort)}`);
  }

  console.log();
}
