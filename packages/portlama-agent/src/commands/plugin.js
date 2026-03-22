import chalk from 'chalk';
import { execa } from 'execa';
import { readFile, writeFile, rename, open, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { assertMacOS, AGENT_DIR } from '../lib/platform.js';

const PLUGINS_FILE = path.join(AGENT_DIR, 'plugins.json');

/**
 * Read the local plugin registry.
 */
async function readLocalPlugins() {
  try {
    const raw = await readFile(PLUGINS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.plugins) ? parsed : { plugins: [] };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { plugins: [] };
    }
    throw new Error(`Failed to read local plugin registry: ${err.message}`);
  }
}

/**
 * Write the local plugin registry atomically.
 */
async function writeLocalPlugins(data) {
  const tmpPath = `${PLUGINS_FILE}.tmp`;

  const content = JSON.stringify(data, null, 2) + '\n';
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });

  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();

  await rename(tmpPath, PLUGINS_FILE);
}

/**
 * Install a plugin locally on the agent.
 */
async function installLocal(packageName) {
  if (!packageName.startsWith('@lamalibre/')) {
    console.error(chalk.red('  Only @lamalibre/ scoped packages are allowed'));
    process.exit(1);
  }

  const registry = await readLocalPlugins();
  const existing = registry.plugins.find((p) => p.packageName === packageName);
  if (existing) {
    console.log(chalk.yellow(`  Plugin "${packageName}" is already installed`));
    return;
  }

  console.log(chalk.cyan(`  Installing ${packageName}...`));

  // Ensure AGENT_DIR has a package.json so npm installs locally
  await mkdir(AGENT_DIR, { recursive: true, mode: 0o700 });
  const agentPkgJson = path.join(AGENT_DIR, 'package.json');
  try {
    await readFile(agentPkgJson, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      await writeFile(agentPkgJson, '{"private":true}\n', { encoding: 'utf-8', mode: 0o600 });
    }
  }

  try {
    await execa('npm', ['install', '--ignore-scripts', packageName], { cwd: AGENT_DIR, stdio: 'inherit' });
  } catch (err) {
    console.error(chalk.red(`  Failed to install: ${err.message}`));
    process.exit(1);
  }

  // Read the plugin manifest
  let manifest;
  try {
    const require = createRequire(path.join(AGENT_DIR, '/'));
    const manifestPath = require.resolve(`${packageName}/portlama-plugin.json`);
    const manifestRaw = await readFile(manifestPath, 'utf-8');
    manifest = JSON.parse(manifestRaw);
  } catch {
    console.log(chalk.yellow('  Warning: No portlama-plugin.json found — registering with package name only'));
    manifest = { name: packageName.replace('@lamalibre/', ''), version: 'unknown' };
  }

  // Validate manifest name to prevent path traversal
  if (!/^[a-z0-9-]+$/.test(manifest.name)) {
    console.error(chalk.red(`  Invalid plugin name: "${manifest.name}"`));
    process.exit(1);
  }

  // Create local plugin directory
  const pluginDir = path.join(AGENT_DIR, 'plugins', manifest.name);
  await mkdir(pluginDir, { recursive: true, mode: 0o700 });

  registry.plugins.push({
    name: manifest.name,
    packageName,
    version: manifest.version,
    installedAt: new Date().toISOString(),
    status: 'installed',
  });

  await writeLocalPlugins(registry);
  console.log(chalk.green(`  Plugin "${manifest.name}" installed`));
}

/**
 * Uninstall a plugin locally.
 */
async function uninstallLocal(nameOrPackage) {
  const registry = await readLocalPlugins();
  const index = registry.plugins.findIndex(
    (p) => p.name === nameOrPackage || p.packageName === nameOrPackage,
  );

  if (index === -1) {
    console.error(chalk.red(`  Plugin "${nameOrPackage}" not found`));
    process.exit(1);
  }

  const plugin = registry.plugins[index];

  if (!plugin.packageName.startsWith('@lamalibre/')) {
    console.error(chalk.red('  Registry corruption: invalid package scope'));
    process.exit(1);
  }

  console.log(chalk.cyan(`  Uninstalling ${plugin.packageName}...`));

  try {
    await execa('npm', ['uninstall', plugin.packageName], { cwd: AGENT_DIR, stdio: 'inherit' });
  } catch (err) {
    console.log(chalk.yellow(`  npm uninstall warning: ${err.message}`));
  }

  // Remove local plugin directory
  const pluginDir = path.join(AGENT_DIR, 'plugins', plugin.name);
  await rm(pluginDir, { recursive: true, force: true }).catch(() => {});

  registry.plugins.splice(index, 1);
  await writeLocalPlugins(registry);
  console.log(chalk.green(`  Plugin "${plugin.name}" uninstalled`));
}

/**
 * Update a plugin locally.
 */
async function updateLocal(nameOrPackage) {
  const registry = await readLocalPlugins();
  const plugin = registry.plugins.find(
    (p) => p.name === nameOrPackage || p.packageName === nameOrPackage,
  );

  if (!plugin) {
    console.error(chalk.red(`  Plugin "${nameOrPackage}" not found`));
    process.exit(1);
  }

  if (!plugin.packageName.startsWith('@lamalibre/')) {
    console.error(chalk.red('  Registry corruption: invalid package scope'));
    process.exit(1);
  }

  console.log(chalk.cyan(`  Updating ${plugin.packageName}...`));

  try {
    await execa('npm', ['install', '--ignore-scripts', plugin.packageName], { cwd: AGENT_DIR, stdio: 'inherit' });
  } catch (err) {
    console.error(chalk.red(`  Failed to update: ${err.message}`));
    process.exit(1);
  }

  // Re-read manifest to capture the updated version
  try {
    const require = createRequire(path.join(AGENT_DIR, '/'));
    const manifestPath = require.resolve(`${plugin.packageName}/portlama-plugin.json`);
    const manifestRaw = await readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestRaw);
    plugin.version = manifest.version || plugin.version;
  } catch {
    // Manifest may not exist — keep existing version
  }

  plugin.updatedAt = new Date().toISOString();
  await writeLocalPlugins(registry);
  console.log(chalk.green(`  Plugin "${plugin.name}" updated`));
}

/**
 * Show status of all locally installed plugins.
 */
async function showStatus() {
  const registry = await readLocalPlugins();
  const b = chalk.bold;
  const c = chalk.cyan;
  const d = chalk.dim;
  const g = chalk.green;

  console.log('');
  console.log(b('  Portlama Agent Plugins'));
  console.log(d('  ─'.repeat(28)));

  if (registry.plugins.length === 0) {
    console.log(`  ${d('No plugins installed.')}`);
  } else {
    for (const p of registry.plugins) {
      console.log(
        `  ${c('•')} ${b(p.name)} ${d(`v${p.version}`)} ${g(p.status || 'installed')}`,
      );
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
export async function runPlugin(args) {
  assertMacOS();

  const subcommand = args[0];
  const target = args[1];

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    const b = chalk.bold;
    const c = chalk.cyan;
    const d = chalk.dim;

    console.log(`
${b('portlama-agent plugin')} — manage agent plugins

${b('USAGE')}

  ${c('portlama-agent plugin')} ${d('<command> [args]')}

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
        console.error(chalk.red('  Missing package name. Usage: portlama-agent plugin install <package>'));
        process.exit(1);
      }
      await installLocal(target);
      break;
    case 'uninstall':
      if (!target) {
        console.error(chalk.red('  Missing plugin name. Usage: portlama-agent plugin uninstall <name>'));
        process.exit(1);
      }
      await uninstallLocal(target);
      break;
    case 'update':
      if (!target) {
        console.error(chalk.red('  Missing plugin name. Usage: portlama-agent plugin update <name>'));
        process.exit(1);
      }
      await updateLocal(target);
      break;
    case 'status':
      await showStatus();
      break;
    default:
      console.error(chalk.red(`  Unknown plugin command: ${subcommand}`));
      console.error(`  Run ${chalk.cyan('portlama-agent plugin --help')} for usage.`);
      process.exit(1);
  }
}
