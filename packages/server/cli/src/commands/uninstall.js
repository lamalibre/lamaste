/**
 * lamaste-server uninstall — Full server teardown.
 *
 * Cleanup order (reverse of installation):
 *
 * 1. Stop and disable services (panel, gatekeeper)
 * 2. Remove systemd service files
 * 3. Remove nginx configurations (vhosts, sites)
 * 4. Reload nginx (falls back to default config)
 * 5. Remove certbot certificates
 * 6. Remove Authelia configuration
 * 7. Remove Lamaste data directory (/etc/lamalibre/lamaste)
 * 8. Remove installed npm packages
 * 9. Remove lamaste system user
 *
 * Requires root access. Interactive confirmation unless --force is passed.
 */

import { readFile, access, constants } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { execa } from 'execa';
import { CONFIG_PATH, STATE_DIR, PANEL_SERVICE, GATEKEEPER_SERVICE } from '../config.js';
import { emitStep, emitError, emitComplete } from '../ndjson.js';

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
export async function runUninstall(args, { json }) {
  // Verify running as root
  if (process.getuid && process.getuid() !== 0) {
    const msg = 'lamaste-server uninstall must be run as root.';
    if (json) emitError(msg);
    else {
      console.error(`\n  Error: ${msg}`);
      console.error('  Usage: sudo lamaste-server uninstall\n');
    }
    process.exit(1);
  }

  const force = args.includes('--force');

  // Read config to get domain info for display
  let config = null;
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    config = JSON.parse(raw);
  } catch {
    // Config may not exist
  }

  const domain = config?.domain || 'unknown';

  if (!force && !json) {
    console.log('');
    console.log(chalk.bold.red('  WARNING: This will completely remove Lamaste from this server.'));
    console.log('');
    console.log(`  Domain:   ${chalk.cyan(String(domain))}`);
    console.log(`  Data dir: ${chalk.dim(STATE_DIR)}`);
    console.log('');
    console.log('  This action will:');
    console.log('    - Stop and remove all Lamaste services');
    console.log('    - Remove all nginx tunnel/site configurations');
    console.log('    - Remove all certificates (mTLS and Let\'s Encrypt)');
    console.log('    - Remove Authelia configuration');
    console.log('    - Delete all Lamaste data');
    console.log('');

    const confirmed = await promptConfirm('  Type "uninstall" to confirm: ', 'uninstall');
    if (!confirmed) {
      console.log('\n  Aborted.\n');
      process.exit(0);
    }
    console.log('');
  }

  const steps = [
    { name: 'stop-services', label: 'Stopping services', fn: stopServices },
    { name: 'remove-services', label: 'Removing service files', fn: removeServices },
    { name: 'remove-nginx', label: 'Removing nginx configurations', fn: removeNginxConfigs },
    { name: 'reload-nginx', label: 'Reloading nginx', fn: reloadNginx },
    { name: 'remove-certbot', label: 'Removing certbot certificates', fn: removeCertbotCerts },
    { name: 'remove-authelia', label: 'Removing Authelia configuration', fn: removeAuthelia },
    { name: 'remove-data', label: 'Removing Lamaste data', fn: removeData },
    { name: 'remove-packages', label: 'Removing npm packages', fn: removePackages },
    { name: 'remove-user', label: 'Removing lamaste user', fn: removeUser },
  ];

  for (const step of steps) {
    if (json) emitStep(step.name, 'running', step.label);
    else process.stderr.write(`  ${step.label}...`);

    try {
      await step.fn(config);
      if (json) emitStep(step.name, 'complete');
      else console.log(` ${chalk.green('ok')}`);
    } catch (err) {
      // Non-fatal: log and continue with remaining steps
      const msg = err.message || String(err);
      if (json) emitStep(step.name, 'failed', msg);
      else console.log(` ${chalk.yellow('skipped')} ${chalk.dim(`(${msg})`)}`);
    }
  }

  if (json) {
    emitComplete({ uninstalled: true });
  } else {
    console.log('');
    console.log(chalk.green('  Lamaste has been removed from this server.'));
    console.log('');
  }
}

async function stopServices() {
  for (const service of [PANEL_SERVICE, GATEKEEPER_SERVICE]) {
    try {
      await execa('systemctl', ['stop', service], { timeout: 15000 });
    } catch {
      // Service may not be running
    }
    try {
      await execa('systemctl', ['disable', service], { timeout: 10000 });
    } catch {
      // Service may not be enabled
    }
  }
}

async function removeServices() {
  const serviceFiles = [
    `/etc/systemd/system/${PANEL_SERVICE}.service`,
    `/etc/systemd/system/${GATEKEEPER_SERVICE}.service`,
  ];

  for (const file of serviceFiles) {
    await execa('rm', ['-f', file]).catch(() => {});
  }

  await execa('systemctl', ['daemon-reload']).catch(() => {});

  // Remove sudoers file
  await execa('rm', ['-f', '/etc/sudoers.d/lamaste']).catch(() => {});
}

/**
 * @param {Record<string, unknown> | null} config
 */
async function removeNginxConfigs(config) {
  // Remove lamaste-specific sites
  const patterns = [
    '/etc/nginx/sites-enabled/lamalibre-lamaste-*',
    '/etc/nginx/sites-available/lamalibre-lamaste-*',
    '/etc/nginx/snippets/lamalibre-lamaste-*',
  ];

  for (const pattern of patterns) {
    // Use shell glob expansion safely via rm
    await execa('sh', ['-c', `rm -f ${pattern}`]).catch(() => {});
  }

  // Remove any tunnel/site vhosts (they use the subdomain as filename)
  // Read tunnels and sites to identify their vhost files
  try {
    const tunnelsRaw = await readFile(`${STATE_DIR}/tunnels.json`, 'utf-8');
    const tunnels = JSON.parse(tunnelsRaw);
    if (Array.isArray(tunnels)) {
      for (const t of tunnels) {
        if (t.subdomain) {
          await execa('rm', ['-f',
            `/etc/nginx/sites-enabled/${t.subdomain}`,
            `/etc/nginx/sites-available/${t.subdomain}`,
          ]).catch(() => {});
        }
      }
    }
  } catch {
    // No tunnels file
  }

  try {
    const sitesRaw = await readFile(`${STATE_DIR}/sites.json`, 'utf-8');
    const sites = JSON.parse(sitesRaw);
    if (Array.isArray(sites)) {
      for (const s of sites) {
        if (s.id) {
          await execa('rm', ['-f',
            `/etc/nginx/sites-enabled/site-${s.id}`,
            `/etc/nginx/sites-available/site-${s.id}`,
          ]).catch(() => {});
        }
      }
    }
  } catch {
    // No sites file
  }
}

async function reloadNginx() {
  await execa('nginx', ['-t'], { timeout: 10000 });
  await execa('systemctl', ['reload', 'nginx'], { timeout: 10000 });
}

async function removeCertbotCerts() {
  // List all certbot certificates and delete lamaste-related ones
  try {
    const { stdout } = await execa('certbot', ['certificates', '--non-interactive'], {
      timeout: 30000,
    });

    const certNames = [];
    for (const match of stdout.matchAll(/Certificate Name:\s+(.+)/g)) {
      certNames.push(match[1].trim());
    }

    for (const name of certNames) {
      await execa('certbot', ['delete', '--non-interactive', '--cert-name', name], {
        timeout: 15000,
      }).catch(() => {});
    }
  } catch {
    // certbot may not be installed
  }
}

async function removeAuthelia() {
  // Stop and disable authelia
  await execa('systemctl', ['stop', 'authelia']).catch(() => {});
  await execa('systemctl', ['disable', 'authelia']).catch(() => {});

  // Remove authelia config (but not the binary — it may be system-managed)
  await execa('rm', ['-rf', '/etc/authelia']).catch(() => {});
}

async function removeData() {
  // Remove the entire lamaste data directory
  await execa('rm', ['-rf', STATE_DIR]);

  // Remove site content directories
  await execa('rm', ['-rf', '/var/www/lamaste']).catch(() => {});

  // Remove chisel binary
  await execa('rm', ['-f', '/usr/local/bin/chisel']).catch(() => {});

  // Remove the lamaste-reset-admin symlink (legacy)
  await execa('rm', ['-f', '/usr/local/bin/lamaste-reset-admin']).catch(() => {});
}

async function removePackages() {
  // Locate and remove globally installed lamaste packages
  try {
    const { stdout } = await execa('npm', ['ls', '-g', '--depth=0', '--json'], {
      timeout: 15000,
    });
    const globalPkgs = JSON.parse(stdout);
    const deps = globalPkgs.dependencies || {};

    for (const [name] of Object.entries(deps)) {
      if (name.startsWith('@lamalibre/')) {
        await execa('npm', ['uninstall', '-g', name], { timeout: 30000 }).catch(() => {});
      }
    }
  } catch {
    // Global packages listing may fail
  }

  // Remove the panel server installation directory
  await execa('rm', ['-rf', '/opt/lamalibre/lamaste']).catch(() => {});
}

async function removeUser() {
  // Check if lamaste user exists
  try {
    await execa('id', ['lamaste']);
  } catch {
    return; // User does not exist
  }

  // Remove the user and its home directory
  await execa('userdel', ['-r', 'lamaste']).catch(() => {});

  // Remove group if it still exists
  await execa('groupdel', ['lamaste']).catch(() => {});
}

/**
 * Prompt the user for confirmation.
 * @param {string} prompt
 * @param {string} expected  The exact text the user must type
 * @returns {Promise<boolean>}
 */
function promptConfirm(prompt, expected) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim() === expected);
    });
  });
}
