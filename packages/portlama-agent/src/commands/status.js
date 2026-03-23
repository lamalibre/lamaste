import chalk from 'chalk';
import { assertMacOS, CHISEL_BIN_PATH, PLIST_PATH, LOG_FILE, AGENT_DIR } from '../lib/platform.js';
import { loadAgentConfig } from '../lib/config.js';
import { isAgentLoaded, getAgentPid } from '../lib/launchctl.js';
import { getInstalledVersion } from '../lib/chisel.js';
import { fetchTunnels } from '../lib/panel-api.js';
import { existsSync } from 'node:fs';

/**
 * Print formatted status information about the agent.
 */
export async function runStatus() {
  assertMacOS();

  const b = chalk.bold;
  const c = chalk.cyan;
  const g = chalk.green;
  const r = chalk.red;
  const d = chalk.dim;
  const y = chalk.yellow;

  console.log('');
  console.log(b('  Portlama Agent Status'));
  console.log(d('  ─'.repeat(28)));

  // Config
  const config = await loadAgentConfig();
  if (!config) {
    console.log(`  ${r('Not configured.')} Run ${c('portlama-agent setup')} first.`);
    console.log('');
    return;
  }

  // Agent status
  const loaded = await isAgentLoaded();
  const pid = await getAgentPid();

  console.log(
    `  ${b('Agent:')}     ${loaded ? g('loaded') : r('not loaded')}${pid ? ` (PID ${pid})` : ''}`,
  );
  console.log(`  ${b('Panel:')}     ${c(config.panelUrl)}`);

  if (config.domain) {
    console.log(`  ${b('Domain:')}    ${c(config.domain)}`);
  }

  // Chisel
  const chiselVersion = await getInstalledVersion();
  const chiselInstalled = existsSync(CHISEL_BIN_PATH);
  console.log(
    `  ${b('Chisel:')}    ${chiselInstalled ? g(chiselVersion || 'installed') : r('not installed')}`,
  );

  // Files
  console.log(`  ${b('Plist:')}     ${existsSync(PLIST_PATH) ? g('present') : y('missing')}`);
  console.log(`  ${b('Config:')}    ${existsSync(AGENT_DIR) ? g('present') : y('missing')}`);
  console.log(`  ${b('Logs:')}      ${d(LOG_FILE)}`);

  if (config.setupAt) {
    console.log(`  ${b('Setup at:')}  ${d(config.setupAt)}`);
  }
  if (config.updatedAt) {
    console.log(`  ${b('Updated:')}   ${d(config.updatedAt)}`);
  }

  // Try to fetch tunnels from panel
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
