import { createInterface } from 'node:readline';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Listr } from 'listr2';
import chalk from 'chalk';
import { execa } from 'execa';
import { detectOS, detectIP, checkRoot } from './lib/env.js';
import { printSummary } from './lib/summary.js';
import { hardenTasks } from './tasks/harden.js';
import { nodeTasks } from './tasks/node.js';
import { mtlsTasks } from './tasks/mtls.js';
import { nginxTasks } from './tasks/nginx.js';
import { panelTasks } from './tasks/panel.js';
import { redeployTasks } from './tasks/redeploy.js';

/**
 * Parse minimal CLI flags from process.argv.
 * @returns {{ skipHarden: boolean, uninstall: boolean, dev: boolean, help: boolean, yes: boolean }}
 */
function parseFlags() {
  const args = process.argv.slice(2);
  return {
    skipHarden: args.includes('--skip-harden'),
    uninstall: args.includes('--uninstall'),
    dev: args.includes('--dev'),
    help: args.includes('--help') || args.includes('-h'),
    yes: args.includes('--yes') || args.includes('-y'),
    forceFull: args.includes('--force-full'),
  };
}

/**
 * Print help message describing Portlama and what the installer does,
 * then exit with code 0.
 */
function printHelp() {
  const b = chalk.bold;
  const c = chalk.cyan;
  const y = chalk.yellow;
  const d = chalk.dim;

  console.log(`
${b('Portlama')} — A self-hosted secure tunneling platform

${b('DESCRIPTION')}

  Portlama exposes web apps running behind a firewall through a VPS
  via WebSocket-over-HTTPS tunnels. This installer provisions a fresh
  Ubuntu 24.04 droplet with nginx, mTLS client certificates, and a
  browser-based management panel — all in a single command.

${b('USAGE')}

  ${c('npx @lamalibre/create-portlama')} ${d('[flags]')}

${b('SYSTEM MODIFICATIONS')}

  This installer makes the following changes to the machine:

  ${y('Swap & Memory')}
    • Creates a 1GB swap file

  ${y('Firewall & Security')}
    • Resets UFW firewall (allows only ports 22, 443, 9292)
    • Installs fail2ban with SSH and nginx jails
    • Hardens SSH (disables password authentication)

  ${y('Packages')}
    • Installs Node.js 20, nginx, certbot

  ${y('Certificates')}
    • Generates mTLS CA, server, and client certificates
    • Creates a PKCS12 (.p12) bundle for browser-based access

  ${y('Users & Services')}
    • Creates ${c('portlama')} system user
    • Creates systemd service ${c('portlama-panel')}
    • Deploys panel server + client to ${c('/opt/portlama/')}

  ${y('Directories')}
    • ${c('/etc/portlama/')}   — configuration and PKI certificates
    • ${c('/opt/portlama/')}   — panel server and client files
    • ${c('/var/www/portlama/')} — static web assets

${b('REQUIREMENTS')}

  • Ubuntu 24.04
  • Root access
  • Public IP address (unless --dev is used)

${b('FLAGS')}

  ${c('--help')}, ${c('-h')}         Show this help message and exit
  ${c('--yes')}, ${c('-y')}          Skip the confirmation prompt
  ${c('--skip-harden')}       Skip OS hardening (swap, UFW, fail2ban, SSH)
  ${c('--dev')}               Allow private/non-routable IP addresses
  ${c('--force-full')}        Run full installation even on existing installs
  ${c('--uninstall')}         Show manual removal guide for Portlama
`);
  process.exit(0);
}

/**
 * Print detailed uninstall guide listing all components installed by Portlama,
 * then exit with code 0.
 */
function printUninstallGuide() {
  const b = chalk.bold;
  const c = chalk.cyan;
  const y = chalk.yellow;
  const d = chalk.dim;

  console.log(`
${b('Portlama — Manual Removal Guide')}

${y('⚠  Automated uninstall is not yet implemented.')}
${y('   Follow the steps below to fully remove Portlama from this machine.')}

${b('1. Stop and disable services')}

  ${c('sudo systemctl stop portlama-panel')}
  ${c('sudo systemctl disable portlama-panel')}
  ${c('sudo rm /etc/systemd/system/portlama-panel.service')}
  ${c('sudo systemctl daemon-reload')}

${b('2. Remove nginx configuration')}

  ${c('sudo rm /etc/nginx/sites-enabled/portlama-*')}
  ${c('sudo rm /etc/nginx/sites-available/portlama-*')}
  ${c('sudo rm /etc/nginx/snippets/portlama-mtls.conf')}
  ${c('sudo nginx -t && sudo systemctl reload nginx')}

${b('3. Remove Portlama directories')}

  ${c('sudo rm -rf /etc/portlama/')}       ${d('# Configuration, PKI certificates, state')}
  ${c('sudo rm -rf /opt/portlama/')}       ${d('# Panel server and client files')}
  ${c('sudo rm -rf /var/www/portlama/')}   ${d('# Static site files')}

${b('4. Remove portlama user')}

  ${c('sudo userdel -r portlama')}

${b('5. Remove sudoers rules')}

  ${c('sudo rm /etc/sudoers.d/portlama')}

${b('6. Remove fail2ban config (optional)')}

  ${c('sudo rm /etc/fail2ban/jail.d/portlama.conf')}
  ${c('sudo systemctl restart fail2ban')}

${b('7. Revert SSH hardening (optional)')}

  ${d('If a backup was created during install:')}
  ${c('sudo cp /etc/ssh/sshd_config.pre-portlama /etc/ssh/sshd_config')}
  ${c('sudo sshd -t && sudo systemctl restart ssh')}

${b('8. Revert firewall changes (optional)')}

  ${d('Remove Portlama-specific UFW rules:')}
  ${c('sudo ufw delete allow 9292/tcp')}

${b('9. Remove swap file (optional)')}

  ${d('Only if Portlama created it:')}
  ${c('sudo swapoff /swapfile')}
  ${c('sudo rm /swapfile')}
  ${d('Remove the /swapfile line from /etc/fstab')}

${b('10. Remove Let\'s Encrypt certificates (optional)')}

  ${d('List Portlama-issued certs:')}
  ${c('sudo certbot certificates')}
  ${d('Delete specific ones:')}
  ${c('sudo certbot delete --cert-name <domain>')}

${d('Note: Steps 6-10 are optional. They revert OS hardening changes that')}
${d('may be useful to keep even after removing Portlama.')}
`);
  process.exit(0);
}

/**
 * Detect existing system state to surface warnings before installation.
 * All checks are wrapped in try/catch — detection failures never block the installer.
 * @returns {Promise<{
 *   portlamaExists: boolean,
 *   onboardingStatus: string | null,
 *   existingNginxSites: string[],
 *   port3100InUse: boolean,
 *   ufwActive: boolean,
 *   ufwRuleCount: number,
 * }>}
 */
async function detectExistingState() {
  const state = {
    portlamaExists: false,
    onboardingStatus: null,
    existingNginxSites: [],
    port3100InUse: false,
    ufwActive: false,
    ufwRuleCount: 0,
  };

  // 1. Check for existing Portlama installation
  try {
    if (existsSync('/etc/portlama/panel.json')) {
      state.portlamaExists = true;
      const raw = await readFile('/etc/portlama/panel.json', 'utf8');
      const config = JSON.parse(raw);
      state.onboardingStatus = config.onboardingStatus || 'FRESH';
    }
  } catch {
    // If panel.json exists but is unreadable/invalid, still flag it
    if (existsSync('/etc/portlama/panel.json')) {
      state.portlamaExists = true;
      state.onboardingStatus = 'UNKNOWN';
    }
  }

  // 2. Check for existing nginx sites (non-portlama, non-default)
  try {
    const entries = await readdir('/etc/nginx/sites-enabled');
    state.existingNginxSites = entries.filter(
      (name) => !name.startsWith('portlama-') && name !== 'default',
    );
  } catch {
    // nginx not installed or sites-enabled doesn't exist — nothing to report
  }

  // 3. Check if port 3100 is in use
  try {
    const { stdout } = await execa('ss', ['-tlnp', 'sport', '=', ':3100']);
    // ss always prints a header line; if there are more lines, the port is in use
    const lines = stdout.trim().split('\n');
    state.port3100InUse = lines.length > 1;
  } catch {
    // ss not available or command failed — assume port is free
  }

  // 4. Check UFW status
  try {
    const { stdout } = await execa('ufw', ['status']);
    state.ufwActive = stdout.includes('Status: active');
    if (state.ufwActive) {
      // Count rule lines: each rule line starts with a port number or an action keyword
      // Skip the header lines (Status, blank lines, header dividers)
      const lines = stdout.split('\n');
      let ruleCount = 0;
      let pastHeader = false;
      for (const line of lines) {
        if (line.startsWith('--')) {
          pastHeader = true;
          continue;
        }
        if (pastHeader && line.trim().length > 0) {
          ruleCount++;
        }
      }
      state.ufwRuleCount = ruleCount;
    }
  } catch {
    // ufw not installed — nothing to report
  }

  return state;
}

/**
 * Print a confirmation banner and optionally wait for user input.
 * @param {{ yes: boolean }} flags - Parsed CLI flags.
 * @param {boolean} isRedeploy - Whether we are in redeploy mode.
 * @param {{ portlamaExists: boolean, onboardingStatus: string | null, existingNginxSites: string[], port3100InUse: boolean, ufwActive: boolean, ufwRuleCount: number }} existingState - Detection results.
 */
async function confirmInstallation(flags, isRedeploy, existingState) {
  let banner;

  if (isRedeploy) {
    banner = `
${chalk.cyan.bold('┌─────────────────────────────────────────────────────────────┐')}
${chalk.cyan.bold('│')}  ${chalk.white.bold('Portlama Panel Update')}                                       ${chalk.cyan.bold('│')}
${chalk.cyan.bold('├─────────────────────────────────────────────────────────────┤')}
${chalk.cyan.bold('│')}                                                             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}  Existing installation detected. Updating panel only.       ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}                                                             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}  The following changes will be made:                         ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}                                                             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}    ${chalk.yellow('•')} Stop panel service                                    ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}    ${chalk.yellow('•')} Update panel-server and panel-client files             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}    ${chalk.yellow('•')} Install updated dependencies                           ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}    ${chalk.yellow('•')} Restart panel service                                  ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}                                                             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}  ${chalk.dim('OS, nginx, mTLS certs, and firewall are untouched.')}        ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}  ${chalk.dim('Use --force-full to run the complete installer.')}           ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}                                                             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('└─────────────────────────────────────────────────────────────┘')}`;
  } else {
    banner = `
${chalk.cyan.bold('┌─────────────────────────────────────────────────────────────┐')}
${chalk.cyan.bold('│')}  ${chalk.white.bold('Portlama Installer')}                                          ${chalk.cyan.bold('│')}
${chalk.cyan.bold('├─────────────────────────────────────────────────────────────┤')}
${chalk.cyan.bold('│')}                                                             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}  This will install Portlama on this machine.                ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}                                                             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}  The following changes will be made:                         ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}                                                             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}    ${chalk.yellow('•')} Reset UFW firewall (allow ports 22, 80, 443, 9292)     ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}    ${chalk.yellow('•')} Harden SSH (disable password authentication)           ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}    ${chalk.yellow('•')} Install fail2ban, Node.js 20, nginx, certbot           ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}    ${chalk.yellow('•')} Generate mTLS certificates for browser access          ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}    ${chalk.yellow('•')} Create portlama user and systemd service               ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}    ${chalk.yellow('•')} Deploy panel to /opt/portlama/                         ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}                                                             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}  ${chalk.dim('Designed for a fresh Ubuntu 24.04 droplet.')}                  ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}                                                             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('└─────────────────────────────────────────────────────────────┘')}`;
  }

  console.log(banner);

  // Display detection warnings below the banner (only for full install)
  if (!isRedeploy) {
    const warnings = [];

    if (existingState.portlamaExists) {
      const status = existingState.onboardingStatus || 'UNKNOWN';
      warnings.push(
        `An existing Portlama installation was detected (onboarding: ${status}). Re-running will update the installation but preserve your configuration.`,
      );
    }

    if (existingState.existingNginxSites.length > 0) {
      warnings.push(
        `Existing nginx sites will be affected: ${existingState.existingNginxSites.join(', ')}`,
      );
    }

    if (existingState.port3100InUse) {
      warnings.push('Port 3100 is currently in use. The panel may fail to start.');
    }

    if (existingState.ufwActive && existingState.ufwRuleCount > 0) {
      warnings.push(
        `Existing UFW firewall rules (${existingState.ufwRuleCount} rules) will be reset.`,
      );
    }

    if (warnings.length > 0) {
      console.log('');
      for (const warning of warnings) {
        console.log(`  ${chalk.yellow('!')} ${chalk.yellow(warning)}`);
      }
    }
  }

  if (flags.yes) {
    console.log(`\n  ${chalk.dim('Skipping confirmation (--yes)')}\n`);
    return;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  await new Promise((resolve) => {
    rl.question(
      `\n  ${chalk.white.bold('Press Enter to continue or Ctrl+C to abort...')} `,
      () => {
        rl.close();
        resolve();
      },
    );
  });
}

/**
 * Main installer orchestrator. Creates a shared context, runs all installation
 * tasks through Listr2, and prints a summary on completion.
 */
export async function main() {
  const flags = parseFlags();

  if (flags.help) {
    printHelp();
  }

  if (flags.uninstall) {
    printUninstallGuide();
  }

  const ctx = {
    ip: null,
    osRelease: null,
    skipHarden: flags.skipHarden,
    nodeAlreadyInstalled: false,
    nodeVersion: null,
    npmVersion: null,
    p12Password: null,
    pkiDir: '/etc/portlama/pki',
    configDir: '/etc/portlama',
    installDir: '/opt/portlama',
  };

  // Phase 1: Environment checks
  const envTasks = new Listr(
    [
      {
        title: 'Checking environment',
        task: async (_ctx, task) => {
          return task.newListr([
            {
              title: 'Verifying root access',
              task: async () => {
                checkRoot();
              },
            },
            {
              title: 'Detecting operating system',
              task: async (_ctx, subtask) => {
                ctx.osRelease = await detectOS();
                subtask.output = ctx.osRelease.prettyName;
              },
              rendererOptions: { persistentOutput: true },
            },
            {
              title: 'Detecting IP address',
              task: async (_ctx, subtask) => {
                ctx.ip = await detectIP({ allowPrivate: flags.dev });
                if (flags.dev) {
                  subtask.output = `${ctx.ip} (dev mode — private IP accepted)`;
                } else {
                  subtask.output = ctx.ip;
                }
              },
              rendererOptions: { persistentOutput: true },
            },
          ]);
        },
      },
    ],
    {
      renderer: 'default',
      rendererOptions: { collapseSubtasks: false },
      exitOnError: true,
    },
  );

  // Phase 2: Installation tasks
  const installTasks = new Listr(
    [
      {
        title: 'Hardening operating system',
        task: (_ctx, task) => hardenTasks(ctx, task),
      },
      {
        title: 'Installing Node.js 20',
        task: (_ctx, task) => nodeTasks(ctx, task),
      },
      {
        title: 'Generating mTLS certificates',
        task: (_ctx, task) => mtlsTasks(ctx, task),
      },
      {
        title: 'Configuring nginx',
        task: (_ctx, task) => nginxTasks(ctx, task),
      },
      {
        title: 'Deploying Portlama panel',
        task: (_ctx, task) => panelTasks(ctx, task),
      },
      {
        title: 'Installation complete',
        task: async () => {
          // Summary will be printed after Listr finishes
        },
      },
    ],
    {
      renderer: 'default',
      rendererOptions: { collapseSubtasks: false },
      exitOnError: true,
    },
  );

  try {
    // Run environment checks first
    await envTasks.run();

    // Detect existing system state for the confirmation banner
    const existingState = await detectExistingState();

    // Determine mode: redeploy (fast update) or full install
    const isRedeploy = existingState.portlamaExists && !flags.forceFull;

    // Show confirmation banner and wait for user input
    await confirmInstallation(flags, isRedeploy, existingState);

    if (isRedeploy) {
      // Fast path: only update panel files and restart
      const redeployTaskList = new Listr(
        [
          {
            title: 'Redeploying Portlama panel',
            task: (_ctx, task) => redeployTasks(ctx, task),
          },
        ],
        {
          renderer: 'default',
          rendererOptions: { collapseSubtasks: false },
          exitOnError: true,
        },
      );
      await redeployTaskList.run();
    } else {
      // Full install path
      await installTasks.run();
    }
  } catch (error) {
    console.error('\n');
    console.error('  ┌─────────────────────────────────────────────┐');
    console.error('  │  Portlama installation failed.              │');
    console.error(`  │  ${(error.message || 'Unknown error').slice(0, 43).padEnd(43)} │`);
    console.error('  │                                             │');
    console.error('  │  You can safely re-run this installer       │');
    console.error('  │  to retry.                                  │');
    console.error('  └─────────────────────────────────────────────┘');
    console.error('\n');
    process.exit(1);
  }

  // Print summary after Listr2 finishes rendering
  await printSummary(ctx);
}
