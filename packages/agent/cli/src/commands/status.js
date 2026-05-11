import chalk from 'chalk';
import { existsSync } from 'node:fs';
import {
  assertSupportedPlatform,
  CHISEL_BIN_PATH,
  serviceConfigPath,
  agentLogFile,
  agentDataDir,
} from '@lamalibre/lamaste/agent';
import { loadAgentConfig } from '@lamalibre/lamaste/agent';
import { isAgentLoaded, getAgentPid, isPanelServiceLoaded } from '@lamalibre/lamaste/agent';
import { getInstalledVersion } from '../lib/chisel.js';
import { fetchTunnels, fetchPanelTunnelStatus } from '../lib/panel-api.js';

/**
 * Print formatted status information about the agent.
 * @param {{ label: string }} options
 */
export async function runStatus({ label }) {
  assertSupportedPlatform();

  const b = chalk.bold;
  const c = chalk.cyan;
  const g = chalk.green;
  const r = chalk.red;
  const d = chalk.dim;
  const y = chalk.yellow;

  console.log('');
  console.log(b(`  Lamaste Agent Status — ${c(label)}`));
  console.log(d('  ─'.repeat(28)));

  const config = await loadAgentConfig(label);
  if (!config) {
    console.log(
      `  ${r('Not configured.')} Run ${c(`lamaste-agent setup --label ${label}`)} first.`,
    );
    console.log('');
    return;
  }

  const loaded = await isAgentLoaded(label);
  const pid = await getAgentPid(label);

  console.log(
    `  ${b('Agent:')}     ${loaded ? g('loaded') : r('not loaded')}${pid ? ` (PID ${pid})` : ''}`,
  );
  console.log(`  ${b('Panel:')}     ${c(config.panelUrl)}`);

  if (config.domain) {
    console.log(`  ${b('Domain:')}    ${c(config.domain)}`);
  }

  const chiselVersion = await getInstalledVersion();
  const chiselInstalled = existsSync(CHISEL_BIN_PATH);
  console.log(
    `  ${b('Chisel:')}    ${chiselInstalled ? g(chiselVersion || 'installed') : r('not installed')}`,
  );

  const svcPath = serviceConfigPath(label);
  const dataDir = agentDataDir(label);
  const logFile = agentLogFile(label);

  console.log(`  ${b('Service:')}   ${existsSync(svcPath) ? g('present') : y('missing')}`);
  console.log(`  ${b('Config:')}    ${existsSync(dataDir) ? g('present') : y('missing')}`);
  console.log(`  ${b('Logs:')}      ${d(logFile)}`);

  if (config.setupAt) {
    console.log(`  ${b('Setup at:')}  ${d(config.setupAt)}`);
  }
  if (config.updatedAt) {
    console.log(`  ${b('Updated:')}   ${d(config.updatedAt)}`);
  }

  // Panel server status
  const panelRunning = await isPanelServiceLoaded(label);
  console.log(`  ${b('Web Panel:')} ${panelRunning ? g('running') : d('stopped')}`);

  if (panelRunning || config.panelEnabled) {
    try {
      const panelStatus = await fetchPanelTunnelStatus(config);
      if (panelStatus.enabled && panelStatus.fqdn) {
        console.log(`  ${b('Panel URL:')} ${c(`https://${panelStatus.fqdn}`)}`);
      }
    } catch {
      // panel:expose capability not available
    }
  }

  console.log('');
  console.log(b('  Tunnels'));
  console.log(d('  ─'.repeat(28)));

  try {
    const data = await fetchTunnels(config);
    const tunnels = data.tunnels || [];

    if (tunnels.length === 0) {
      console.log(`  ${d('No tunnels configured.')}`);
    } else {
      for (const t of tunnels) {
        console.log(
          `  ${c('•')} ${b(t.subdomain)}.${config.domain || '?'} → localhost:${t.port}${t.description ? d(` (${t.description})`) : ''}`,
        );
      }
    }
  } catch {
    console.log(`  ${y('Could not reach panel to fetch tunnel list.')}`);
  }

  console.log('');
}
