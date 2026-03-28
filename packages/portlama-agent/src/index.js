import chalk from 'chalk';

/**
 * Parse --label flag from argv, removing it from the args array.
 * @param {string[]} args
 * @returns {{ label: string | undefined, args: string[] }}
 */
function extractLabelFlag(args) {
  let label;
  const filtered = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--label' && args[i + 1]) {
      label = args[++i];
    } else {
      filtered.push(args[i]);
    }
  }
  return { label, args: filtered };
}

/**
 * Print help message and exit.
 */
function printHelp() {
  const b = chalk.bold;
  const c = chalk.cyan;
  const d = chalk.dim;

  console.log(`
${b('portlama-agent')} — tunnel agent for Portlama (macOS & Linux)

${b('USAGE')}

  ${c('portlama-agent')} ${d('[--label <name>] <command>')}

${b('COMMANDS')}

  ${c('setup')}           Interactive setup: install Chisel, fetch tunnel config, start agent
  ${c('update')}          Re-fetch config from panel after tunnel changes
  ${c('uninstall')}       Stop agent and remove all files
  ${c('status')}          Show agent health, tunnel list, connection status
  ${c('logs')}            Stream Chisel log output (tail -f)
  ${c('sites')}           List, create, or delete static sites
  ${c('deploy')}          Deploy a local directory to a static site
  ${c('plugin')}          Manage agent plugins (install, uninstall, update, status)
  ${c('list')}            List all configured agents
  ${c('switch')}          Set the default agent

${b('GLOBAL FLAGS')}

  ${c('--label <name>')}  Target a specific agent (overrides the current default)

${b('EXAMPLES')}

  ${d('# First-time setup (interactive)')}
  ${c('npx @lamalibre/portlama-agent setup')}

  ${d('# Setup with a specific label')}
  ${c('portlama-agent setup --label prod-server --panel-url https://1.2.3.4:9292')}

  ${d('# Token-based setup (non-interactive)')}
  ${c('PORTLAMA_ENROLLMENT_TOKEN=<token> portlama-agent setup --label my-server --panel-url https://1.2.3.4:9292')}

  ${d('# List all agents')}
  ${c('portlama-agent list')}

  ${d('# Switch default agent')}
  ${c('portlama-agent switch my-server')}

  ${d('# After adding a tunnel on the panel')}
  ${c('portlama-agent update')}

  ${d('# Check status of a specific agent')}
  ${c('portlama-agent status --label my-server')}

  ${d('# Uninstall a specific agent')}
  ${c('portlama-agent uninstall --label my-server')}

  ${d('# Uninstall all agents')}
  ${c('portlama-agent uninstall --all')}

${b('PREREQUISITES')}

  ${d('•')} macOS (arm64 or x64) or Ubuntu Linux (arm64 or x64)
  ${d('•')} Agent certificate (.p12) or enrollment token from your Portlama panel
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
  const { label, args } = extractLabelFlag(rawArgs);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
  }

  switch (command) {
    case 'setup': {
      const { runSetup } = await import('./commands/setup.js');
      await runSetup({ label });
      break;
    }
    case 'update': {
      const { runUpdate } = await import('./commands/update.js');
      const { resolveLabel } = await import('./lib/registry.js');
      const resolved = await resolveLabel(label);
      await runUpdate({ label: resolved });
      break;
    }
    case 'uninstall': {
      const { runUninstall } = await import('./commands/uninstall.js');
      await runUninstall({ label, all: args.includes('--all') });
      break;
    }
    case 'status': {
      const { runStatus } = await import('./commands/status.js');
      const { resolveLabel } = await import('./lib/registry.js');
      const resolved = await resolveLabel(label);
      await runStatus({ label: resolved });
      break;
    }
    case 'logs': {
      const { runLogs } = await import('./commands/logs.js');
      const { resolveLabel } = await import('./lib/registry.js');
      const resolved = await resolveLabel(label);
      await runLogs({ label: resolved });
      break;
    }
    case 'sites': {
      const { runSites } = await import('./commands/sites.js');
      const { resolveLabel } = await import('./lib/registry.js');
      const resolved = await resolveLabel(label);
      await runSites(args.slice(1), { label: resolved });
      break;
    }
    case 'deploy': {
      const { runDeploy } = await import('./commands/deploy.js');
      const { resolveLabel } = await import('./lib/registry.js');
      const resolved = await resolveLabel(label);
      await runDeploy(args.slice(1), { label: resolved });
      break;
    }
    case 'plugin': {
      const { runPlugin } = await import('./commands/plugin.js');
      const { resolveLabel } = await import('./lib/registry.js');
      const resolved = await resolveLabel(label);
      await runPlugin(args.slice(1), { label: resolved });
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
      console.error(`  Run ${chalk.cyan('portlama-agent --help')} for usage.\n`);
      process.exit(1);
  }
}
