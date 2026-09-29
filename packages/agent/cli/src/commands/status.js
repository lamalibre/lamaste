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
import {
  isAgentLoaded,
  getAgentPid,
  isPanelServiceLoaded,
  userLingerStatus,
  enableLingerCommand,
  installedAgentChiselVersion,
  isSyncServiceLoaded,
  isSyncServiceInstalled,
  readSyncState,
  isSyncStale,
} from '@lamalibre/lamaste/agent';
import { CHISEL_RELEASE } from '@lamalibre/lamaste';
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

  const chiselVersion = await installedAgentChiselVersion();
  const chiselInstalled = existsSync(CHISEL_BIN_PATH);
  const chiselText = !chiselInstalled
    ? r('not installed')
    : chiselVersion === CHISEL_RELEASE.version
      ? g(chiselVersion)
      : y(`${chiselVersion || 'unknown'} (the next sync installs ${CHISEL_RELEASE.version})`);
  console.log(`  ${b('Chisel:')}    ${chiselText}`);

  const syncLoaded = await isSyncServiceLoaded(label);
  const syncInstalled = syncLoaded || (await isSyncServiceInstalled(label));
  const syncState = await readSyncState(label);
  let syncText;
  if (!syncInstalled) {
    syncText = y('not installed — run `lamaste-agent update` (needs a global install)');
  } else if (!syncLoaded) {
    syncText = y('installed but not running');
  } else if (syncState && isSyncStale(syncState)) {
    syncText = r(
      `last ran ${syncState.lastRunAt} — the timer is not running its program; run \`lamaste-agent update\``,
    );
  } else if (syncState?.lastError) {
    syncText = r(`failing since ${syncState.lastOkAt ?? 'setup'}: ${syncState.lastError}`);
  } else if (syncState?.lastOkAt) {
    const what =
      syncState.lastState === 'idle'
        ? 'no tunnels assigned'
        : syncState.lastState === 'stopped'
          ? 'tunnels stopped by the operator'
          : `${syncState.tunnels ?? 0} tunnel(s)`;
    syncText = g(`every 30s, last ok ${syncState.lastOkAt} (${what})`);
  } else {
    syncText = g('every 30s');
  }
  console.log(`  ${b('Sync:')}      ${syncText}`);

  const svcPath = serviceConfigPath(label);
  const dataDir = agentDataDir(label);
  const logFile = agentLogFile(label);

  console.log(`  ${b('Service:')}   ${existsSync(svcPath) ? g('present') : y('missing')}`);

  const linger = await userLingerStatus();
  if (linger === 'enabled') {
    console.log(`  ${b('At boot:')}   ${g('starts without login (linger enabled)')}`);
  } else if (linger !== 'n/a') {
    console.log(
      `  ${b('At boot:')}   ${y('only while this user is logged in')} ${d(`— fix: ${enableLingerCommand()}`)}`,
    );
  }
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
