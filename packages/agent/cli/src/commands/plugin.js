import chalk from 'chalk';
import { assertSupportedPlatform, validateLabel } from '@lamalibre/lamaste/agent';
import {
  readPluginRegistry,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
  agentPluginConfig,
} from '@lamalibre/lamaste/agent';

/**
 * Install a plugin locally on the agent.
 * @param {string} label - Agent label
 * @param {string} packageName
 */
async function installLocal(label, packageName) {
  console.log(chalk.cyan(`  Installing ${packageName}...`));
  try {
    const pluginConfig = agentPluginConfig(label);
    const entry = await installPlugin(pluginConfig, packageName);
    console.log(chalk.green(`  Plugin "${entry.name}" installed`));
  } catch (err) {
    console.error(chalk.red(`  ${err.message}`));
    process.exit(1);
  }
}

/**
 * Uninstall a plugin locally.
 * @param {string} label - Agent label
 * @param {string} nameOrPackage
 */
async function uninstallLocal(label, nameOrPackage) {
  // Resolve name from registry if a package name was given
  const pluginConfig = agentPluginConfig(label);
  const registry = await readPluginRegistry(pluginConfig.registryPath);
  const plugin = registry.plugins.find(
    (p) => p.name === nameOrPackage || p.packageName === nameOrPackage,
  );
  if (!plugin) {
    console.error(chalk.red(`  Plugin "${nameOrPackage}" not found`));
    process.exit(1);
  }

  console.log(chalk.cyan(`  Uninstalling ${plugin.packageName}...`));
  try {
    await uninstallPlugin(pluginConfig, plugin.name);
    console.log(chalk.green(`  Plugin "${plugin.name}" uninstalled`));
  } catch (err) {
    console.error(chalk.red(`  ${err.message}`));
    process.exit(1);
  }
}

/**
 * Update a plugin locally.
 * @param {string} label - Agent label
 * @param {string} nameOrPackage
 */
async function updateLocal(label, nameOrPackage) {
  console.log(chalk.cyan(`  Updating ${nameOrPackage}...`));
  try {
    const pluginConfig = agentPluginConfig(label);
    const plugin = await updatePlugin(pluginConfig, nameOrPackage);
    console.log(chalk.green(`  Plugin "${plugin.name}" updated to v${plugin.version}`));
  } catch (err) {
    console.error(chalk.red(`  ${err.message}`));
    process.exit(1);
  }
}

/**
 * Show status of all locally installed plugins.
 * @param {string} label - Agent label
 */
async function showStatus(label) {
  const pluginConfig = agentPluginConfig(label);
  const registry = await readPluginRegistry(pluginConfig.registryPath);
  const b = chalk.bold;
  const c = chalk.cyan;
  const d = chalk.dim;
  const g = chalk.green;

  console.log('');
  console.log(b('  Lamaste Agent Plugins'));
  console.log(d('  ─'.repeat(28)));

  if (registry.plugins.length === 0) {
    console.log(`  ${d('No plugins installed.')}`);
  } else {
    for (const p of registry.plugins) {
      console.log(`  ${c('•')} ${b(p.name)} ${d(`v${p.version}`)} ${g(p.status || 'installed')}`);
      console.log(`    ${d(p.packageName)}`);
      if (p.installedAt) {
        console.log(`    ${d(`Installed: ${p.installedAt}`)}`);
      }
    }
  }
  console.log('');
}

/**
 * Entry point for the plugin subcommand.
 */
export async function runPlugin(args, { label } = {}) {
  assertSupportedPlatform();
  if (label) validateLabel(label);

  const subcommand = args[0];
  const target = args[1];

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    const b = chalk.bold;
    const c = chalk.cyan;
    const d = chalk.dim;

    console.log(`
${b('lamaste-agent plugin')} — manage agent plugins

${b('USAGE')}

  ${c('lamaste-agent plugin')} ${d('<command> [args]')}

${b('COMMANDS')}

  ${c('install')} ${d('<package>')}   Install a plugin (e.g. @lamalibre/shell-agent)
  ${c('uninstall')} ${d('<name>')}    Uninstall a plugin
  ${c('update')} ${d('<name>')}       Update a plugin to the latest version
  ${c('status')}                Show installed plugins
`);
    return;
  }

  switch (subcommand) {
    case 'install':
      if (!target) {
        console.error(
          chalk.red('  Missing package name. Usage: lamaste-agent plugin install <package>'),
        );
        process.exit(1);
      }
      await installLocal(label, target);
      break;
    case 'uninstall':
      if (!target) {
        console.error(
          chalk.red('  Missing plugin name. Usage: lamaste-agent plugin uninstall <name>'),
        );
        process.exit(1);
      }
      await uninstallLocal(label, target);
      break;
    case 'update':
      if (!target) {
        console.error(
          chalk.red('  Missing plugin name. Usage: lamaste-agent plugin update <name>'),
        );
        process.exit(1);
      }
      await updateLocal(label, target);
      break;
    case 'status':
      await showStatus(label);
      break;
    default:
      console.error(chalk.red(`  Unknown plugin command: ${subcommand}`));
      console.error(`  Run ${chalk.cyan('lamaste-agent plugin --help')} for usage.`);
      process.exit(1);
  }
}
