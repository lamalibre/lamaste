/**
 * lamaste-agent panel — manage the agent web panel.
 *
 * Usage:
 *   lamaste-agent panel --enable [--port 9393]
 *   lamaste-agent panel --disable
 *   lamaste-agent panel --status
 *   lamaste-agent panel reset-pin   # re-capture the panel TLS server pin (B10)
 */

import chalk from 'chalk';
import {
  loadAgentConfig,
  saveAgentConfig,
  assertSupportedPlatform,
  isPanelServiceLoaded,
  loadPanelService,
  unloadPanelService,
} from '@lamalibre/lamaste/agent';
import {
  generatePanelServiceConfig,
  writePanelServiceConfig,
  removePanelServiceConfig,
} from '../lib/panel-service.js';
import { exposePanelTunnel, retractPanelTunnel, fetchPanelTunnelStatus } from '../lib/panel-api.js';
import { fetchPanelServerCertDigests } from '../lib/panel-cert.js';

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
  const isResetPin = args.includes('reset-pin');
  const isEnable = args.includes('--enable');
  const isDisable = args.includes('--disable');
  const isLocalOnly = args.includes('--local-only');
  const isStatus = args.includes('--status') || (!isEnable && !isDisable && !isResetPin);

  // Parse --port flag
  let port = config.panelPort || DEFAULT_PANEL_PORT;
  const portIdx = args.indexOf('--port');
  if (portIdx !== -1 && args[portIdx + 1]) {
    const parsed = parseInt(args[portIdx + 1], 10);
    if (!Number.isNaN(parsed) && parsed >= 1024 && parsed <= 65535) {
      port = parsed;
    }
  }

  if (isResetPin) {
    await resetPin(label, config, isJson);
  } else if (isEnable) {
    await enablePanel(label, config, port, isJson, isLocalOnly);
  } else if (isDisable) {
    await disablePanel(label, config, isJson, isLocalOnly);
  } else if (isStatus) {
    await showStatus(label, config, isJson);
  }
}

/**
 * Re-run the TOFU capture of the panel server's TLS cert pin. Used after
 * a legitimate panel cert/key rotation. This is destructive in the sense
 * that the agent will trust whatever cert is currently presented at the
 * panel URL — operators must verify the captured digest out-of-band.
 *
 * @param {string} label
 * @param {object} config
 * @param {boolean} isJson
 */
async function resetPin(label, config, isJson) {
  const oldPin = config.panelServerPubkeySha256 || null;
  if (!isJson) {
    console.log(chalk.bold('\nRe-pinning panel server certificate (TOFU)\n'));
    console.log(`  Panel URL: ${chalk.cyan(config.panelUrl)}`);
    if (oldPin) {
      console.log(`  Old pin:   ${chalk.dim(`sha256//${oldPin}`)}`);
    }
  }

  let digests;
  try {
    digests = await fetchPanelServerCertDigests(config.panelUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isJson) {
      console.log(JSON.stringify({ error: msg }));
    } else {
      console.error(chalk.red(`\n  Failed to capture pin: ${msg}\n`));
    }
    process.exit(1);
  }

  let chiselDigests = null;
  if (config.domain) {
    try {
      chiselDigests = await fetchPanelServerCertDigests(`https://tunnel.${config.domain}:443`);
    } catch {
      chiselDigests = null;
    }
  }

  const updated = {
    ...config,
    panelServerPubkeySha256: digests.pubkeySha256Base64,
    panelServerCertSha256Hex: digests.certSha256Hex,
    panelServerCertPinnedAt: new Date().toISOString(),
    chiselServerCertSha256Hex: chiselDigests?.certSha256Hex || config.chiselServerCertSha256Hex,
    updatedAt: new Date().toISOString(),
  };
  await saveAgentConfig(label, updated);

  if (isJson) {
    console.log(
      JSON.stringify({
        ok: true,
        previousPin: oldPin,
        panelServerPubkeySha256: digests.pubkeySha256Base64,
        panelServerCertSha256Hex: digests.certSha256Hex,
        chiselServerCertSha256Hex: updated.chiselServerCertSha256Hex || null,
      }),
    );
    return;
  }

  console.log(`  New pin:   ${chalk.cyan(`sha256//${digests.pubkeySha256Base64}`)}`);
  console.log(`  Cert hash: ${chalk.cyan(digests.certSha256Hex)}`);
  if (updated.chiselServerCertSha256Hex) {
    console.log(`  Chisel hash: ${chalk.cyan(updated.chiselServerCertSha256Hex)}`);
  } else {
    console.log(
      chalk.yellow(
        `  Chisel server pin not refreshed (tunnel.${config.domain || '?'} unreachable)`,
      ),
    );
  }
  console.log(chalk.dim('\n  Verify the new pin out-of-band before continuing.'));
  console.log(chalk.dim('  Run `lamaste-agent update` to apply the chisel pin.\n'));
}

async function enablePanel(label, config, port, isJson, localOnly = false) {
  // 1. Check if already enabled
  const loaded = await isPanelServiceLoaded(label);
  if (loaded) {
    if (isJson) {
      console.log(
        JSON.stringify({ ok: true, alreadyRunning: true, port: config.panelPort || port }),
      );
    } else {
      console.log(chalk.yellow('Panel service is already running.'));
    }
    return;
  }

  // 2. Generate and write service config
  const content = await generatePanelServiceConfig(label, port);
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
    const { generateServiceConfig, writeServiceConfigFile, injectChiselFingerprint } =
      await import('../lib/service-config.js');
    const { unloadAgent, loadAgent } = await import('@lamalibre/lamaste/agent');
    const agentConfig = await fetchAgentConfig(config);
    const chiselArgs = config.chiselServerCertSha256Hex
      ? injectChiselFingerprint(agentConfig.chiselArgs, config.chiselServerCertSha256Hex)
      : agentConfig.chiselArgs;
    const serviceContent = generateServiceConfig(chiselArgs, label);
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
      const { generateServiceConfig, writeServiceConfigFile, injectChiselFingerprint } =
        await import('../lib/service-config.js');
      const { unloadAgent, loadAgent } = await import('@lamalibre/lamaste/agent');
      const agentConfig = await fetchAgentConfig(config);
      const chiselArgs = config.chiselServerCertSha256Hex
        ? injectChiselFingerprint(agentConfig.chiselArgs, config.chiselServerCertSha256Hex)
        : agentConfig.chiselArgs;
      const serviceContent = generateServiceConfig(chiselArgs, label);
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
  const loaded = await isPanelServiceLoaded(label);
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
