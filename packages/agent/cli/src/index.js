import chalk from 'chalk';

/**
 * Parse global flags (--label, --json) from argv, removing them from the args array.
 * @param {string[]} args
 * @returns {{ label: string | undefined, json: boolean, args: string[] }}
 */
function extractGlobalFlags(args) {
  let label;
  let json = false;
  const filtered = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--label' && args[i + 1]) {
      label = args[++i];
    } else if (args[i] === '--json') {
      json = true;
    } else {
      filtered.push(args[i]);
    }
  }
  return { label, json, args: filtered };
}

/**
 * Print help message and exit.
 */
function printHelp() {
  const b = chalk.bold;
  const c = chalk.cyan;
  const d = chalk.dim;

  console.log(`
${b('lamaste-agent')} — tunnel agent for Lamaste (macOS & Linux)

${b('USAGE')}

  ${c('lamaste-agent')} ${d('[--label <name>] <command>')}

${b('COMMANDS')}

  ${c('setup')}           Interactive setup: install Chisel, fetch tunnel config, start agent
  ${c('update')}          Re-fetch config from panel after tunnel changes
  ${c('uninstall')}       Stop agent and remove all files
  ${c('status')}          Show agent health, tunnel list, connection status
  ${c('logs')}            Stream Chisel log output (tail -f)
  ${c('sites')}           List, create, or delete static sites
  ${c('deploy')}          Deploy a local directory to a static site
  ${c('plugin')}          Manage agent plugins (install, uninstall, update, status)
  ${c('panel')}           Manage agent web panel (--enable, --disable, --status, reset-pin)
  ${c('chisel')}          Manage chisel tunnel credential (refresh-credential)
  ${c('list')}            List all configured agents
  ${c('switch')}          Set the default agent

${b('GLOBAL FLAGS')}

  ${c('--label <name>')}  Target a specific agent (overrides the current default)
  ${c('--json')}           Output NDJSON progress (for desktop app integration)

${b('EXAMPLES')}

  ${d('# First-time setup (interactive)')}
  ${c('npx @lamalibre/lamaste-agent setup')}

  ${d('# Setup with a specific label')}
  ${c('lamaste-agent setup --label prod-server --panel-url https://1.2.3.4:9292')}

  ${d('# Token-based setup (non-interactive)')}
  ${c('LAMALIBRE_LAMASTE_ENROLLMENT_TOKEN=<token> lamaste-agent setup --label my-server --panel-url https://1.2.3.4:9292')}

  ${d('# List all agents')}
  ${c('lamaste-agent list')}

  ${d('# Switch default agent')}
  ${c('lamaste-agent switch my-server')}

  ${d('# After adding a tunnel on the panel')}
  ${c('lamaste-agent update')}

  ${d('# Check status of a specific agent')}
  ${c('lamaste-agent status --label my-server')}

  ${d('# Uninstall a specific agent')}
  ${c('lamaste-agent uninstall --label my-server')}

  ${d('# Uninstall all agents')}
  ${c('lamaste-agent uninstall --all')}

${b('PREREQUISITES')}

  ${d('•')} macOS (arm64 or x64) or Ubuntu Linux (arm64 or x64)
  ${d('•')} Agent certificate (.p12) or enrollment token from your Lamaste panel
    (Panel → Certificates → Agent Certificates → Generate / Enroll)
  ${d('•')} Panel URL (e.g. https://1.2.3.4:9292)
`);
  process.exit(0);
}

/**
 * Parse command from argv and dispatch to the appropriate module.
 */
export async function main() {
  const rawArgs = process.argv.slice(2);
  const { label, json, args } = extractGlobalFlags(rawArgs);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
  }

  switch (command) {
    case 'setup': {
      const { runSetup } = await import('./commands/setup.js');
      await runSetup({ label, json });
      break;
    }
    case 'update': {
      const { resolveLabel } = await import('@lamalibre/lamaste/agent');
      const resolved = await resolveLabel(label);
      const { runUpdate } = await import('./commands/update.js');
      await runUpdate({ label: resolved });
      break;
    }
    case 'uninstall': {
      const { runUninstall } = await import('./commands/uninstall.js');
      await runUninstall({ label, all: args.includes('--all') });
      break;
    }
    case 'status': {
      const { resolveLabel } = await import('@lamalibre/lamaste/agent');
      const resolved = await resolveLabel(label);
      const { runStatus } = await import('./commands/status.js');
      await runStatus({ label: resolved });
      break;
    }
    case 'logs': {
      const { resolveLabel } = await import('@lamalibre/lamaste/agent');
      const resolved = await resolveLabel(label);
      const { runLogs } = await import('./commands/logs.js');
      await runLogs({ label: resolved });
      break;
    }
    case 'sites': {
      const { resolveLabel } = await import('@lamalibre/lamaste/agent');
      const resolved = await resolveLabel(label);
      const { runSites } = await import('./commands/sites.js');
      await runSites(args.slice(1), { label: resolved });
      break;
    }
    case 'deploy': {
      const { resolveLabel } = await import('@lamalibre/lamaste/agent');
      const resolved = await resolveLabel(label);
      const { runDeploy } = await import('./commands/deploy.js');
      await runDeploy(args.slice(1), { label: resolved });
      break;
    }
    case 'plugin': {
      const { resolveLabel } = await import('@lamalibre/lamaste/agent');
      const resolved = await resolveLabel(label);
      const { runPlugin } = await import('./commands/plugin.js');
      await runPlugin(args.slice(1), { label: resolved });
      break;
    }
    case 'panel': {
      const { resolveLabel } = await import('@lamalibre/lamaste/agent');
      const resolved = await resolveLabel(label);
      const { runPanel } = await import('./commands/panel.js');
      await runPanel(args.slice(1), { label: resolved, json });
      break;
    }
    case 'chisel': {
      const { resolveLabel } = await import('@lamalibre/lamaste/agent');
      const resolved = await resolveLabel(label);
      const { runChisel } = await import('./commands/chisel.js');
      await runChisel(args.slice(1), { label: resolved });
      break;
    }
    case 'list': {
      const { runList } = await import('./commands/list.js');
      await runList();
      break;
    }
    case 'switch': {
      const { runSwitch } = await import('./commands/switch.js');
      await runSwitch(args[1]);
      break;
    }
    default:
      console.error(`\n  Unknown command: ${chalk.red(command)}`);
      console.error(`  Run ${chalk.cyan('lamaste-agent --help')} for usage.\n`);
      process.exit(1);
  }
}
