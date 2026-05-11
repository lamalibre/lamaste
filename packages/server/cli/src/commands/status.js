/**
 * lamaste-server status — Server health, uptime, resource usage.
 *
 * Reads systemctl status, panel.json config, and cert expiry info.
 */

import chalk from 'chalk';
import { execa } from 'execa';
import { readConfigSafe, PANEL_SERVICE, GATEKEEPER_SERVICE, PKI_DIR } from '../config.js';
import { getMtlsCerts } from '@lamalibre/lamaste/server';
import { exec } from '../exec.js';
import { emit } from '../ndjson.js';

/**
 * @param {{ json: boolean }} options
 */
export async function runStatus({ json }) {
  const config = await readConfigSafe();
  const domain = config?.domain ?? null;

  // Collect service statuses
  const panelStatus = await getServiceStatus(PANEL_SERVICE);
  const gatekeeperStatus = await getServiceStatus(GATEKEEPER_SERVICE);
  const nginxStatus = await getServiceStatus('nginx');
  const autheliaStatus = await getServiceStatus('authelia');

  // Collect cert info
  let certs = [];
  try {
    certs = await getMtlsCerts(PKI_DIR, exec);
  } catch {
    // PKI dir may not be readable
  }

  // Collect system info
  const uptime = await getUptime();
  const memory = await getMemoryUsage();

  if (json) {
    emit({
      domain,
      services: {
        panel: panelStatus,
        gatekeeper: gatekeeperStatus,
        nginx: nginxStatus,
        authelia: autheliaStatus,
      },
      certificates: certs,
      uptime,
      memory,
    });
    return;
  }

  const b = chalk.bold;
  const c = chalk.cyan;
  const g = chalk.green;
  const r = chalk.red;
  const d = chalk.dim;
  const y = chalk.yellow;

  console.log('');
  console.log(b('  Lamaste Server Status'));
  console.log(d('  ' + '\u2500'.repeat(40)));

  if (domain) {
    console.log(`  ${b('Domain:')}     ${c(String(domain))}`);
  }

  if (uptime) {
    console.log(`  ${b('Uptime:')}     ${d(uptime)}`);
  }
  if (memory) {
    console.log(`  ${b('Memory:')}     ${d(memory)}`);
  }

  console.log('');
  console.log(b('  Services'));
  console.log(d('  ' + '\u2500'.repeat(40)));

  printService('Panel', panelStatus, { b, g, r, d });
  printService('Gatekeeper', gatekeeperStatus, { b, g, r, d });
  printService('Nginx', nginxStatus, { b, g, r, d });
  printService('Authelia', autheliaStatus, { b, g, r, d });

  if (certs.length > 0) {
    console.log('');
    console.log(b('  Certificates'));
    console.log(d('  ' + '\u2500'.repeat(40)));

    for (const cert of certs) {
      const label = cert.type === 'mtls-ca' ? 'CA' : 'Client';
      const status = cert.expiringSoon ? y('expiring soon') : g('valid');
      console.log(
        `  ${b(label + ':')}  ${status}  ${d(`(expires in ${cert.daysUntilExpiry} days)`)}`,
      );
    }
  }

  console.log('');
}

/**
 * @param {string} name
 * @param {{ active: boolean, status: string }} info
 * @param {Record<string, Function>} colors
 */
function printService(name, info, { b, g, r, d }) {
  const pad = name.length < 12 ? ' '.repeat(12 - name.length) : ' ';
  const statusText = info.active ? g('active') : r(info.status || 'inactive');
  console.log(`  ${b(name + ':')}${pad}${statusText}`);
}

/**
 * Get systemd service status.
 * @param {string} service
 * @returns {Promise<{ active: boolean, status: string }>}
 */
async function getServiceStatus(service) {
  try {
    const { stdout } = await execa('systemctl', ['is-active', service]);
    const status = stdout.trim();
    return { active: status === 'active', status };
  } catch (err) {
    const status = err?.stdout?.trim() || 'inactive';
    return { active: false, status };
  }
}

/**
 * Get system uptime as a human-readable string.
 * @returns {Promise<string | null>}
 */
async function getUptime() {
  try {
    const { stdout } = await execa('uptime', ['-p']);
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Get memory usage summary.
 * @returns {Promise<string | null>}
 */
async function getMemoryUsage() {
  try {
    const { stdout } = await execa('free', ['-h', '--si']);
    const lines = stdout.trim().split('\n');
    const memLine = lines.find((l) => l.startsWith('Mem:'));
    if (!memLine) return null;
    const parts = memLine.split(/\s+/);
    return `${parts[2]} used / ${parts[1]} total`;
  } catch {
    return null;
  }
}
