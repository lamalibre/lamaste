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
 *   push-install  Push install: the switch, the default policy, agents' windows
 *   users         Users and the user directory: disable, delete, erase
 *   domains       The relay's base domains, their members and their brands
 *   tunnels       Manage tunnels
 *   sites         Manage static sites
 *   certs         Certificate status and renewal
 *   reset-admin   Emergency admin authentication reset
 *   panel-pin     The public-key pin of the panel's IP listener
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
  ${c('plugins')}         Manage plugins (list, install, enable, disable, uninstall, update, hosting, hooks, settings, …)
  ${c('push-install')}    Push install: on/off, default policy, open/close an agent's window
  ${c('audit')}           The panel's audit log (approvals, hostings, updates, hook events)
  ${c('users')}           Users and the user directory (list, disable, enable, delete, erase, directory)
  ${c('domains')}         The relay's base domains (list, add, verify-dns, activate, remove, members, branding)
  ${c('tunnels')}         Manage tunnels (list, create, delete, toggle, bind a plugin's user surface)
  ${c('sites')}           Manage static sites (list, create, delete)
  ${c('certs')}           Certificate status, renewal, and agent cert listing
  ${c('reset-admin')}     Emergency admin reset (reverts to P12, clears 2FA)
  ${c('panel-pin')}       The panel's TLS key pin, to compare with what agents and the desktop pinned
  ${c('chisel')}          Manage chisel tunnel-server credentials (rotate-credential)
  ${c('registry-credential')} Registry (Feria) service credential used to broker agent install tokens
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

  ${d("# Change an agent-hosted plugin's settings; secrets come on stdin, never as arguments")}
  ${c('lamaste-server plugins configure myplugin --set retries=5 --secrets-stdin < secrets.json')}

  ${d("# Let the panel install an app plugin's agent half on agent vm1 for the next hour")}
  ${c('lamaste-server push-install on')}
  ${c('lamaste-server push-install open vm1 --minutes 60')}

  ${d("# Broker agent install tokens from the registry as the panel's own Authelia client")}
  ${c('lamaste-server registry-credential set --url https://feria.example.com --oidc')}

  ${d('# Offboard a user: they cannot sign in, plugins see them disabled')}
  ${c('lamaste-server users disable alice')}

  ${d("# Give a user an agent-hosted plugin's role, and serve its user surface on a tunnel")}
  ${c('lamaste-server plugins entitlements market-indicators --user alice --roles viewer')}
  ${c('lamaste-server tunnels bind-user-surface piyasa market-indicators')}

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
    case 'push-install': {
      const { runPushInstall } = await import('../src/commands/push-install.js');
      await runPushInstall(args.slice(1), { json });
      break;
    }
    case 'audit': {
      const { runAudit } = await import('../src/commands/audit.js');
      await runAudit(args.slice(1), { json });
      break;
    }
    case 'users': {
      const { runUsers } = await import('../src/commands/users.js');
      await runUsers(args.slice(1), { json });
      break;
    }
    case 'domains': {
      const { runDomains } = await import('../src/commands/domains.js');
      await runDomains(args.slice(1), { json });
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
    case 'panel-pin': {
      const { runPanelPin } = await import('../src/commands/panel-pin.js');
      await runPanelPin({ json });
      break;
    }
    case 'registry-credential': {
      const { runRegistryCredential } = await import('../src/commands/registry-credential.js');
      await runRegistryCredential(args.slice(1), { json });
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
