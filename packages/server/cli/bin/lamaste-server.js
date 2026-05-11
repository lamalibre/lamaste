#!/usr/bin/env node

/**
 * lamaste-server — Server operations CLI for Lamaste.
 *
 * Provides administrative commands for managing a Lamaste server installation.
 * All commands operate on /etc/lamalibre/lamaste/ and require root access on the server.
 *
 * Global flags:
 *   --json    Output NDJSON for automation / desktop app integration
 *
 * Commands:
 *   status        Server health, uptime, resource usage
 *   logs          View server log output (journalctl)
 *   restart       Restart panel server (and optionally gatekeeper)
 *   plugins       Manage server-side plugins
 *   tunnels       Manage tunnels
 *   sites         Manage static sites
 *   certs         Certificate status and renewal
 *   reset-admin   Emergency admin authentication reset
 *   uninstall     Full server teardown
 */

import chalk from 'chalk';

/**
 * Extract the --json global flag from argv.
 * @param {string[]} rawArgs
 * @returns {{ json: boolean, args: string[] }}
 */
function extractGlobalFlags(rawArgs) {
  let json = false;
  const filtered = [];
  for (const arg of rawArgs) {
    if (arg === '--json') {
      json = true;
    } else {
      filtered.push(arg);
    }
  }
  return { json, args: filtered };
}

function printHelp() {
  const b = chalk.bold;
  const c = chalk.cyan;
  const d = chalk.dim;

  console.log(`
${b('lamaste-server')} — server operations CLI for Lamaste

${b('USAGE')}

  ${c('lamaste-server')} ${d('[--json] <command> [args]')}

${b('COMMANDS')}

  ${c('status')}          Server health, uptime, services, certificate status
  ${c('logs')}            View server log output (journalctl wrapper)
  ${c('restart')}         Restart panel server and optionally gatekeeper
  ${c('plugins')}         Manage server-side plugins (list, install, enable, disable, uninstall)
  ${c('tunnels')}         Manage tunnels (list, create, delete, toggle)
  ${c('sites')}           Manage static sites (list, create, delete)
  ${c('certs')}           Certificate status, renewal, and agent cert listing
  ${c('reset-admin')}     Emergency admin reset (reverts to P12, clears 2FA)
  ${c('chisel')}          Manage chisel tunnel-server credentials (rotate-credential)
  ${c('uninstall')}       Full server teardown (requires confirmation)

${b('GLOBAL FLAGS')}

  ${c('--json')}          Output NDJSON for automation and desktop app integration

${b('EXAMPLES')}

  ${d('# Check server status')}
  ${c('lamaste-server status')}

  ${d('# View recent panel logs')}
  ${c('lamaste-server logs --lines 100')}

  ${d('# Follow logs in real time')}
  ${c('lamaste-server logs --follow')}

  ${d('# Restart the panel server')}
  ${c('lamaste-server restart')}

  ${d('# Restart both panel and gatekeeper')}
  ${c('lamaste-server restart --all')}

  ${d('# List installed plugins')}
  ${c('lamaste-server plugins list')}

  ${d('# Install a plugin')}
  ${c('lamaste-server plugins install @lamalibre/herd-server')}

  ${d('# List tunnels')}
  ${c('lamaste-server tunnels list')}

  ${d('# Create a tunnel')}
  ${c('lamaste-server tunnels create --subdomain myapp --port 3000')}

  ${d('# Check certificate status')}
  ${c('lamaste-server certs status')}

  ${d('# Emergency admin reset (run as root on server)')}
  ${d('# The new P12 password is written to /etc/lamalibre/lamaste/pki/.p12-password (mode 0600).')}
  ${d('# In TTY mode the password also prints to STDERR so you can redirect stdout safely.')}
  ${d('# Optional: --password-file <path> writes the password to a custom location too.')}
  ${c('sudo lamaste-server reset-admin')}

  ${d('# Full server removal')}
  ${c('sudo lamaste-server uninstall')}
`);
  process.exit(0);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const { json, args } = extractGlobalFlags(rawArgs);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
  }

  switch (command) {
    case 'status': {
      const { runStatus } = await import('../src/commands/status.js');
      await runStatus({ json });
      break;
    }
    case 'logs': {
      const { runLogs } = await import('../src/commands/logs.js');
      await runLogs(args.slice(1), { json });
      break;
    }
    case 'restart': {
      const { runRestart } = await import('../src/commands/restart.js');
      await runRestart(args.slice(1), { json });
      break;
    }
    case 'plugins': {
      const { runPlugins } = await import('../src/commands/plugins.js');
      await runPlugins(args.slice(1), { json });
      break;
    }
    case 'tunnels': {
      const { runTunnels } = await import('../src/commands/tunnels.js');
      await runTunnels(args.slice(1), { json });
      break;
    }
    case 'sites': {
      const { runSites } = await import('../src/commands/sites.js');
      await runSites(args.slice(1), { json });
      break;
    }
    case 'certs': {
      const { runCerts } = await import('../src/commands/certs.js');
      await runCerts(args.slice(1), { json });
      break;
    }
    case 'reset-admin': {
      const { runResetAdmin } = await import('../src/commands/reset-admin.js');
      const subArgs = args.slice(1);
      const pwIdx = subArgs.indexOf('--password-file');
      let passwordFile;
      if (pwIdx !== -1) {
        passwordFile = subArgs[pwIdx + 1];
        if (!passwordFile) {
          console.error(`\n  Error: --password-file requires a path argument.\n`);
          process.exit(1);
        }
      }
      await runResetAdmin({ json, passwordFile });
      break;
    }
    case 'chisel': {
      const { runChisel } = await import('../src/commands/chisel.js');
      await runChisel(args.slice(1), { json });
      break;
    }
    case 'uninstall': {
      const { runUninstall } = await import('../src/commands/uninstall.js');
      await runUninstall(args.slice(1), { json });
      break;
    }
    default:
      if (json) {
        process.stdout.write(
          JSON.stringify({ event: 'error', message: `Unknown command: ${command}` }) + '\n',
        );
      } else {
        console.error(`\n  Unknown command: ${chalk.red(command)}`);
        console.error(`  Run ${chalk.cyan('lamaste-server --help')} for usage.\n`);
      }
      process.exit(1);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\n  Fatal error: ${msg}\n\n`);
  process.exit(1);
});
