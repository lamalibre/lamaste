import chalk from 'chalk';

/**
 * Print help message and exit.
 */
function printHelp() {
  const b = chalk.bold;
  const c = chalk.cyan;
  const d = chalk.dim;

  console.log(`
${b('portlama-agent')} — Mac tunnel agent for Portlama

${b('USAGE')}

  ${c('portlama-agent')} ${d('<command>')}

${b('COMMANDS')}

  ${c('setup')}       Interactive setup: install Chisel, fetch tunnel config, start agent
  ${c('update')}      Re-fetch plist from panel after tunnel changes
  ${c('uninstall')}   Stop agent and remove all files
  ${c('status')}      Show agent health, tunnel list, connection status
  ${c('logs')}        Stream Chisel log output (tail -f)
  ${c('sites')}       List, create, or delete static sites
  ${c('deploy')}      Deploy a local directory to a static site

${b('EXAMPLES')}

  ${d('# First-time setup')}
  ${c('npx @lamalibre/portlama-agent setup')}

  ${d('# After adding a tunnel on the panel')}
  ${c('portlama-agent update')}

  ${d('# Check if the agent is running')}
  ${c('portlama-agent status')}

  ${d('# List static sites')}
  ${c('portlama-agent sites')}

  ${d('# Create a managed static site')}
  ${c('portlama-agent sites create blog')}

  ${d('# Deploy local build to a site')}
  ${c('portlama-agent deploy blog ./dist')}

${b('PREREQUISITES')}

  ${d('•')} macOS (arm64 or x64)
  ${d('•')} Agent certificate (.p12) generated from your Portlama panel
    (Panel → Certificates → Agent Certificates → Generate)
  ${d('•')} Panel URL (e.g. https://1.2.3.4:9292)
`);
  process.exit(0);
}

/**
 * Parse command from argv and dispatch to the appropriate module.
 */
export async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
  }

  switch (command) {
    case 'setup': {
      const { runSetup } = await import('./commands/setup.js');
      await runSetup();
      break;
    }
    case 'update': {
      const { runUpdate } = await import('./commands/update.js');
      await runUpdate();
      break;
    }
    case 'uninstall': {
      const { runUninstall } = await import('./commands/uninstall.js');
      await runUninstall();
      break;
    }
    case 'status': {
      const { runStatus } = await import('./commands/status.js');
      await runStatus();
      break;
    }
    case 'logs': {
      const { runLogs } = await import('./commands/logs.js');
      await runLogs();
      break;
    }
    case 'sites': {
      const { runSites } = await import('./commands/sites.js');
      await runSites(args.slice(1));
      break;
    }
    case 'deploy': {
      const { runDeploy } = await import('./commands/deploy.js');
      await runDeploy(args.slice(1));
      break;
    }
    default:
      console.error(`\n  Unknown command: ${chalk.red(command)}`);
      console.error(`  Run ${chalk.cyan('portlama-agent --help')} for usage.\n`);
      process.exit(1);
  }
}
