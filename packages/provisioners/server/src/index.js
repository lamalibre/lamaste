// TODO(v3): A handful of server-side identifiers (sudoers user, the `lamaste`
// system user) remain under the "lamaste" name. The VPS-side rebrand from
// "lamaste" → "lamaste" is its own migration. As of the 2.0 brand-split, FS
// paths live under `/etc/lamalibre/lamaste/` and `/opt/lamalibre/lamaste/`,
// nginx vhosts are named `lamalibre-lamaste-panel-*`, and the systemd unit
// is `lamalibre-lamaste-serverd`. The remaining "lamaste-*" surfaces (user
// account, sudoers prefix) are touched by the v3 migration on each server.

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
import { gatekeeperTasks } from './tasks/gatekeeper.js';
import { redeployTasks } from './tasks/redeploy.js';

/**
 * Parse minimal CLI flags from process.argv.
 * @returns {{ skipHarden: boolean, uninstall: boolean, dev: boolean, help: boolean, yes: boolean, json: boolean, forceFull: boolean }}
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
    json: args.includes('--json'),
  };
}

/**
 * Emit a single NDJSON line to stdout. Used when --json mode is active
 * so that callers (e.g. Tauri desktop app) can parse structured progress.
 * @param {Record<string, unknown>} obj
 */
function emitJson(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

/**
 * Print help message describing Lamaste and what the installer does,
 * then exit with code 0.
 */
function printHelp() {
  const b = chalk.bold;
  const c = chalk.cyan;
  const y = chalk.yellow;
  const d = chalk.dim;

  console.log(`
${b('Lamaste')} — A self-hosted secure tunneling platform

${b('DESCRIPTION')}

  Lamaste exposes web apps running behind a firewall through a VPS
  via WebSocket-over-HTTPS tunnels. This installer provisions a fresh
  Ubuntu 24.04 droplet with nginx, mTLS client certificates, and a
  browser-based management panel — all in a single command.

${b('USAGE')}

  ${c('npx @lamalibre/create-lamaste')} ${d('[flags]')}

${b('SYSTEM MODIFICATIONS')}

  This installer makes the following changes to the machine:

  ${y('Swap & Memory')}
    • Creates a 1GB swap file

  ${y('Firewall & Security')}
    • Resets UFW firewall (allows only ports 22, 80, 443, 9292)
    • Installs fail2ban with SSH and nginx jails
    • Hardens SSH (disables password authentication)

  ${y('Packages')}
    • Installs Node.js 20, nginx, certbot

  ${y('Certificates')}
    • Generates mTLS CA, server, and client certificates
    • Creates a PKCS12 (.p12) bundle for browser-based access

  ${y('Users & Services')}
    • Creates ${c('lamaste')} system user
    • Creates systemd service ${c('lamalibre-lamaste-serverd')}
    • Deploys panel server + client to ${c('/opt/lamalibre/lamaste/')}

  ${y('Directories')}
    • ${c('/etc/lamalibre/lamaste/')}   — configuration and PKI certificates
    • ${c('/opt/lamalibre/lamaste/')}   — panel server and client files
    • ${c('/var/www/lamaste/')} — static web assets

${b('REQUIREMENTS')}

  • Ubuntu 24.04
  • Root access
  • Public IP address (unless --dev is used)

${b('FLAGS')}

  ${c('--help')}, ${c('-h')}         Show this help message and exit
  ${c('--yes')}, ${c('-y')}          Skip the confirmation prompt
  ${c('--skip-harden')}       Skip OS hardening (swap, UFW, fail2ban, SSH)
  ${c('--dev')}               Allow private/non-routable IP addresses
  ${c('--json')}              Output NDJSON progress lines instead of terminal UI
  ${c('--force-full')}        Run full installation even on existing installs
  ${c('--uninstall')}         Show manual removal guide for Lamaste
`);
  process.exit(0);
}

/**
 * Print detailed uninstall guide listing all components installed by Lamaste,
 * then exit with code 0.
 */
function printUninstallGuide() {
  const b = chalk.bold;
  const c = chalk.cyan;
  const y = chalk.yellow;
  const d = chalk.dim;

  console.log(`
${b('Lamaste — Manual Removal Guide')}

${y('⚠  Automated uninstall is not yet implemented.')}
${y('   Follow the steps below to fully remove Lamaste from this machine.')}

${b('1. Stop and disable services')}

  ${c('sudo systemctl stop lamalibre-lamaste-serverd')}
  ${c('sudo systemctl disable lamalibre-lamaste-serverd')}
  ${c('sudo rm /etc/systemd/system/lamalibre-lamaste-serverd.service')}
  ${c('sudo systemctl daemon-reload')}

${b('2. Remove nginx configuration')}

  ${c('sudo rm /etc/nginx/sites-enabled/lamalibre-lamaste-*')}
  ${c('sudo rm /etc/nginx/sites-available/lamalibre-lamaste-*')}
  ${c('sudo rm /etc/nginx/snippets/lamalibre-lamaste-*')}
  ${c('sudo nginx -t && sudo systemctl reload nginx')}

${b('3. Remove Lamaste directories')}

  ${c('sudo rm -rf /etc/lamalibre/lamaste/')}       ${d('# Configuration, PKI certificates, state')}
  ${c('sudo rm -rf /opt/lamalibre/lamaste/')}       ${d('# Panel server and client files')}
  ${c('sudo rm -rf /var/www/lamaste/')}   ${d('# Static site files')}

${b('4. Remove lamaste user')}

  ${c('sudo userdel -r lamaste')}

${b('5. Remove sudoers rules')}

  ${c('sudo rm /etc/sudoers.d/lamaste')}

${b('6. Remove fail2ban config (optional)')}

  ${c('sudo rm /etc/fail2ban/jail.d/lamaste.conf')}
  ${c('sudo systemctl restart fail2ban')}

${b('7. Revert SSH hardening (optional)')}

  ${d('If a backup was created during install:')}
  ${c('sudo cp /etc/ssh/sshd_config.pre-lamaste /etc/ssh/sshd_config')}
  ${c('sudo sshd -t && sudo systemctl restart ssh')}

${b('8. Revert firewall changes (optional)')}

  ${d('Remove Lamaste-specific UFW rules:')}
  ${c('sudo ufw delete allow 9292/tcp')}

${b('9. Remove swap file (optional)')}

  ${d('Only if Lamaste created it:')}
  ${c('sudo swapoff /swapfile')}
  ${c('sudo rm /swapfile')}
  ${d('Remove the /swapfile line from /etc/fstab')}

${b("10. Remove Let's Encrypt certificates (optional)")}

  ${d('List Lamaste-issued certs:')}
  ${c('sudo certbot certificates')}
  ${d('Delete specific ones:')}
  ${c('sudo certbot delete --cert-name <domain>')}

${d('Note: Steps 6-10 are optional. They revert OS hardening changes that')}
${d('may be useful to keep even after removing Lamaste.')}
`);
  process.exit(0);
}

/**
 * Detect existing system state to surface warnings before installation.
 * All checks are wrapped in try/catch — detection failures never block the installer.
 * @returns {Promise<{
 *   lamasteExists: boolean,
 *   onboardingStatus: string | null,
 *   existingNginxSites: string[],
 *   port3100InUse: boolean,
 *   ufwActive: boolean,
 *   ufwRuleCount: number,
 * }>}
 */
async function detectExistingState() {
  const state = {
    lamasteExists: false,
    onboardingStatus: null,
    existingNginxSites: [],
    port3100InUse: false,
    ufwActive: false,
    ufwRuleCount: 0,
  };

  // 1. Check for existing Lamaste installation
  try {
    if (existsSync('/etc/lamalibre/lamaste/panel.json')) {
      state.lamasteExists = true;
      const raw = await readFile('/etc/lamalibre/lamaste/panel.json', 'utf8');
      const config = JSON.parse(raw);
      state.onboardingStatus = config.onboardingStatus || 'FRESH';
    }
  } catch {
    // If panel.json exists but is unreadable/invalid, still flag it
    if (existsSync('/etc/lamalibre/lamaste/panel.json')) {
      state.lamasteExists = true;
      state.onboardingStatus = 'UNKNOWN';
    }
  }

  // 2. Check for existing nginx sites (non-lamaste, non-default)
  try {
    const entries = await readdir('/etc/nginx/sites-enabled');
    state.existingNginxSites = entries.filter(
      (name) => !name.startsWith('lamalibre-lamaste-') && name !== 'default',
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
 * @param {{ lamasteExists: boolean, onboardingStatus: string | null, existingNginxSites: string[], port3100InUse: boolean, ufwActive: boolean, ufwRuleCount: number }} existingState - Detection results.
 */
async function confirmInstallation(flags, isRedeploy, existingState) {
  let banner;

  if (isRedeploy) {
    banner = `
${chalk.cyan.bold('┌─────────────────────────────────────────────────────────────┐')}
${chalk.cyan.bold('│')}  ${chalk.white.bold('Lamaste Panel Update')}                                       ${chalk.cyan.bold('│')}
${chalk.cyan.bold('├─────────────────────────────────────────────────────────────┤')}
${chalk.cyan.bold('│')}                                                             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}  Existing installation detected. Updating panel only.       ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}                                                             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}  The following changes will be made:                         ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}                                                             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}    ${chalk.yellow('•')} Stop panel service                                    ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}    ${chalk.yellow('•')} Update serverd and server-ui files             ${chalk.cyan.bold('│')}
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
${chalk.cyan.bold('│')}  ${chalk.white.bold('Lamaste Installer')}                                          ${chalk.cyan.bold('│')}
${chalk.cyan.bold('├─────────────────────────────────────────────────────────────┤')}
${chalk.cyan.bold('│')}                                                             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}  This will install Lamaste on this machine.                ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}                                                             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}  The following changes will be made:                         ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}                                                             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}    ${chalk.yellow('•')} Reset UFW firewall (allow ports 22, 80, 443, 9292)     ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}    ${chalk.yellow('•')} Harden SSH (disable password authentication)           ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}    ${chalk.yellow('•')} Install fail2ban, Node.js 20, nginx, certbot           ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}    ${chalk.yellow('•')} Generate mTLS certificates for browser access          ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}    ${chalk.yellow('•')} Create lamaste user and systemd service               ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}    ${chalk.yellow('•')} Deploy panel to /opt/lamalibre/lamaste/               ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}                                                             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}  ${chalk.dim('Designed for a fresh Ubuntu 24.04 droplet.')}                  ${chalk.cyan.bold('│')}
${chalk.cyan.bold('│')}                                                             ${chalk.cyan.bold('│')}
${chalk.cyan.bold('└─────────────────────────────────────────────────────────────┘')}`;
  }

  console.log(banner);

  // Display detection warnings below the banner (only for full install)
  if (!isRedeploy) {
    const warnings = [];

    if (existingState.lamasteExists) {
      const status = existingState.onboardingStatus || 'UNKNOWN';
      warnings.push(
        `An existing Lamaste installation was detected (onboarding: ${status}). Re-running will update the installation but preserve your configuration.`,
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
    rl.question(`\n  ${chalk.white.bold('Press Enter to continue or Ctrl+C to abort...')} `, () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Run a single Listr task step in JSON mode: emit running/complete/skipped
 * NDJSON events around each step so the caller gets per-step progress.
 * @param {Record<string, unknown>} ctx - Shared installer context.
 * @param {{ key: string, title: string, fn: Function, skip?: () => boolean }} step
 */
async function runJsonStep(ctx, step) {
  if (step.skip && step.skip()) {
    emitJson({ event: 'step', step: step.key, status: 'skipped' });
    return;
  }
  emitJson({ event: 'step', step: step.key, status: 'running' });
  const taskList = new Listr(
    [{ title: step.title, task: (_c, t) => step.fn(ctx, t) }],
    { renderer: 'silent', exitOnError: true },
  );
  try {
    await taskList.run();
  } catch (error) {
    emitJson({ event: 'step', step: step.key, status: 'failed' });
    throw error;
  }
  emitJson({ event: 'step', step: step.key, status: 'complete' });
}

/**
 * Main installer orchestrator. Creates a shared context, runs all installation
 * tasks through Listr2, and prints a summary on completion.
 *
 * When --json is active, outputs NDJSON progress lines instead of the
 * interactive Listr2 terminal UI. The --json flag implies --yes and --dev.
 */
export async function main() {
  const flags = parseFlags();

  if (flags.help) {
    printHelp();
  }

  if (flags.uninstall) {
    printUninstallGuide();
  }

  // --json implies --yes (no interactive prompts) and --dev (accept private IPs)
  if (flags.json) {
    flags.yes = true;
    flags.dev = true;
  }

  const renderer = flags.json ? 'silent' : 'default';

  const ctx = {
    ip: null,
    osRelease: null,
    skipHarden: flags.skipHarden,
    nodeAlreadyInstalled: false,
    nodeVersion: null,
    npmVersion: null,
    p12Password: null,
    pkiDir: '/etc/lamalibre/lamaste/pki',
    configDir: '/etc/lamalibre/lamaste',
    installDir: '/opt/lamalibre/lamaste',
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
      renderer,
      rendererOptions: { collapseSubtasks: false },
      exitOnError: true,
    },
  );

  try {
    // Run environment checks first
    if (flags.json) {
      emitJson({ event: 'step', step: 'check_environment', status: 'running' });
    }
    await envTasks.run();
    if (flags.json) {
      emitJson({ event: 'step', step: 'check_environment', status: 'complete' });
    }

    // Detect existing system state for the confirmation banner
    const existingState = await detectExistingState();

    // Determine mode: redeploy (fast update) or full install
    const isRedeploy = existingState.lamasteExists && !flags.forceFull;

    // Show confirmation banner and wait for user input (skipped in JSON mode)
    if (!flags.json) {
      await confirmInstallation(flags, isRedeploy, existingState);
    }

    if (isRedeploy) {
      if (flags.json) {
        // JSON mode: emit step-level progress for redeploy
        await runJsonStep(ctx, {
          key: 'redeploy_panel',
          title: 'Redeploying Lamaste panel',
          fn: redeployTasks,
        });
      } else {
        // Fast path: only update panel files and restart
        const redeployTaskList = new Listr(
          [
            {
              title: 'Redeploying Lamaste panel',
              task: (_ctx, task) => redeployTasks(ctx, task),
            },
          ],
          {
            renderer,
            rendererOptions: { collapseSubtasks: false },
            exitOnError: true,
          },
        );
        await redeployTaskList.run();
      }
    } else if (flags.json) {
      // JSON mode: run each install step individually with NDJSON progress
      const installSteps = [
        { key: 'harden_system', title: 'Hardening operating system', fn: hardenTasks, skip: () => ctx.skipHarden },
        { key: 'install_node', title: 'Installing Node.js 20', fn: nodeTasks },
        { key: 'generate_certs', title: 'Generating mTLS certificates', fn: mtlsTasks },
        { key: 'configure_nginx', title: 'Configuring nginx', fn: nginxTasks },
        { key: 'deploy_panel', title: 'Deploying Lamaste panel', fn: panelTasks },
        { key: 'deploy_gatekeeper', title: 'Deploying Gatekeeper', fn: gatekeeperTasks },
      ];
      for (const step of installSteps) {
        await runJsonStep(ctx, step);
      }
    } else {
      // Full install path with interactive Listr2 rendering
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
            title: 'Deploying Lamaste panel',
            task: (_ctx, task) => panelTasks(ctx, task),
          },
          {
            title: 'Deploying Gatekeeper',
            task: (_ctx, task) => gatekeeperTasks(ctx, task),
          },
          {
            title: 'Installation complete',
            task: async () => {
              // Summary will be printed after Listr finishes
            },
          },
        ],
        {
          renderer,
          rendererOptions: { collapseSubtasks: false },
          exitOnError: true,
        },
      );
      await installTasks.run();
    }
  } catch (error) {
    if (flags.json) {
      emitJson({
        event: 'error',
        message: error.message || 'Unknown error',
        recoverable: false,
      });
      process.exit(1);
    }
    console.error('\n');
    console.error('  ┌─────────────────────────────────────────────┐');
    console.error('  │  Lamaste installation failed.              │');
    console.error(`  │  ${(error.message || 'Unknown error').slice(0, 43).padEnd(43)} │`);
    console.error('  │                                             │');
    console.error('  │  You can safely re-run this installer       │');
    console.error('  │  to retry.                                  │');
    console.error('  └─────────────────────────────────────────────┘');
    console.error('\n');
    process.exit(1);
  }

  if (flags.json) {
    emitJson({
      event: 'complete',
      server: {
        ip: ctx.ip,
        panelUrl: `https://${ctx.ip}:9292`,
        p12Path: `${ctx.pkiDir}/client.p12`,
        p12PasswordPath: `${ctx.pkiDir}/.p12-password`,
      },
    });
  } else {
    // Print summary after Listr2 finishes rendering
    await printSummary(ctx);
  }
}
