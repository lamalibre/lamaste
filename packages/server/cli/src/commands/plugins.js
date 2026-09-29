/**
 * lamaste-server plugins — Manage server-side plugins.
 *
 * Subcommands:
 *   list                 List installed plugins with status
 *   install <package>    Install a plugin by npm package name
 *   enable <name>        Enable a plugin
 *   disable <name>       Disable a plugin
 *   uninstall <name>     Remove a plugin (must be disabled first)
 */

import chalk from 'chalk';
import { execa } from 'execa';
import {
  readPlugins,
  installPlugin,
  enablePlugin,
  disablePlugin,
  uninstallPlugin,
} from '@lamalibre/lamaste/server';
import { STATE_DIR, PANEL_SERVICE } from '../config.js';
import { exec } from '../exec.js';
import { createLogger } from '../logger.js';
import { emit, emitStep, emitError, emitComplete, emitLog } from '../ndjson.js';

/**
 * @param {string[]} args  Subcommand args: ['list'] | ['install', '<pkg>'] | ...
 * @param {{ json: boolean }} options
 */
export async function runPlugins(args, { json }) {
  const sub = args[0];

  if (MUTATING.has(sub) && process.getuid?.() === 0) {
    await runAsLamaste(args, { json });
    await restartPanel(json);
    return;
  }

  switch (sub) {
    case 'list':
      return listPlugins({ json });
    case 'install':
      return installPluginCmd(args[1], { json });
    case 'enable':
      return enablePluginCmd(args[1], { json });
    case 'disable':
      return disablePluginCmd(args[1], { json });
    case 'uninstall':
      return uninstallPluginCmd(args[1], { json });
    default:
      printPluginUsage();
      process.exit(sub ? 1 : 0);
  }
}

function printPluginUsage() {
  const b = chalk.bold;
  const c = chalk.cyan;
  console.log(`
${b('Usage:')} lamaste-server plugins <subcommand>

${b('Subcommands:')}
  ${c('list')}                 List installed plugins with status
  ${c('install <package>')}    Install a plugin (e.g. @lamalibre/herd-server)
  ${c('enable <name>')}        Enable a plugin
  ${c('disable <name>')}       Disable a plugin
  ${c('uninstall <name>')}     Remove a disabled plugin
`);
}

/**
 * @param {{ json: boolean }} options
 */
async function listPlugins({ json }) {
  const registry = await readPlugins(STATE_DIR);
  const plugins = registry.plugins;

  if (json) {
    emit({ plugins });
    return;
  }

  if (plugins.length === 0) {
    console.log('\n  No plugins installed.\n');
    return;
  }

  const b = chalk.bold;
  const c = chalk.cyan;
  const g = chalk.green;
  const r = chalk.red;
  const d = chalk.dim;

  console.log('');
  console.log(b('  Installed Plugins'));
  console.log(d('  ' + '\u2500'.repeat(40)));

  for (const p of plugins) {
    const status = p.status === 'enabled' ? g('enabled') : r('disabled');
    console.log(`  ${c(p.name)}  ${d(p.version)}  ${status}  ${d(p.packageName)}`);
  }
  console.log('');
}

/**
 * @param {string | undefined} packageName
 * @param {{ json: boolean }} options
 */
async function installPluginCmd(packageName, { json }) {
  if (!packageName) {
    const msg = 'Usage: lamaste-server plugins install <package>';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }

  const logger = createLogger({ json });

  if (json) {
    emitStep('install', 'running', `Installing ${packageName}`);
    emitLog('info', `Fetching ${packageName} from the npm registry — this may take a moment.`);
  } else {
    process.stderr.write(`  Installing ${chalk.cyan(packageName)}...`);
  }

  try {
    const entry = await installPlugin({
      packageName,
      stateDir: STATE_DIR,
      exec,
      logger,
    });

    if (json) {
      emitStep('install', 'complete');
      emitComplete({ plugin: entry });
    } else {
      console.log(` ${chalk.green('ok')}`);
      console.log(`  Plugin ${chalk.cyan(entry.name)} installed (${chalk.dim('disabled')})`);
      console.log(
        `  Run ${chalk.cyan(`lamaste-server plugins enable ${entry.name}`)} to activate.`,
      );
      console.log('');
    }

    await restartPanel(json);
  } catch (err) {
    if (json) {
      emitStep('install', 'failed', err.message);
      emitError(err.message);
    } else {
      console.log(` ${chalk.red('failed')}`);
      console.error(`  ${chalk.red(err.message)}`);
    }
    process.exit(1);
  }
}

/**
 * @param {string | undefined} name
 * @param {{ json: boolean }} options
 */
async function enablePluginCmd(name, { json }) {
  if (!name) {
    const msg = 'Usage: lamaste-server plugins enable <name>';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }

  const logger = createLogger({ json });

  try {
    await enablePlugin({ name, stateDir: STATE_DIR, logger });
    if (json) {
      emitComplete({ name, status: 'enabled' });
    } else {
      console.log(`\n  Plugin ${chalk.cyan(name)} ${chalk.green('enabled')}.`);
    }
    await restartPanel(json);
  } catch (err) {
    if (json) emitError(err.message);
    else console.error(`\n  ${chalk.red(err.message)}\n`);
    process.exit(1);
  }
}

/**
 * @param {string | undefined} name
 * @param {{ json: boolean }} options
 */
async function disablePluginCmd(name, { json }) {
  if (!name) {
    const msg = 'Usage: lamaste-server plugins disable <name>';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }

  const logger = createLogger({ json });

  try {
    await disablePlugin({ name, stateDir: STATE_DIR, logger });
    if (json) {
      emitComplete({ name, status: 'disabled' });
    } else {
      console.log(`\n  Plugin ${chalk.cyan(name)} ${chalk.red('disabled')}.`);
    }
    await restartPanel(json);
  } catch (err) {
    if (json) emitError(err.message);
    else console.error(`\n  ${chalk.red(err.message)}\n`);
    process.exit(1);
  }
}

/**
 * @param {string | undefined} name
 * @param {{ json: boolean }} options
 */
async function uninstallPluginCmd(name, { json }) {
  if (!name) {
    const msg = 'Usage: lamaste-server plugins uninstall <name>';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }

  const logger = createLogger({ json });

  if (json) emitStep('uninstall', 'running', `Uninstalling ${name}`);
  else process.stderr.write(`  Uninstalling ${chalk.cyan(name)}...`);

  try {
    await uninstallPlugin({ name, stateDir: STATE_DIR, exec, logger });
    if (json) {
      emitStep('uninstall', 'complete');
      emitComplete({ name, removed: true });
    } else {
      console.log(` ${chalk.green('ok')}`);
    }
    await restartPanel(json);
  } catch (err) {
    if (json) {
      emitStep('uninstall', 'failed', err.message);
      emitError(err.message);
    } else {
      console.log(` ${chalk.red('failed')}`);
      console.error(`  ${chalk.red(err.message)}`);
    }
    process.exit(1);
  }
}

const MUTATING = new Set(['install', 'enable', 'disable', 'uninstall']);

/** Set on the child run as lamaste: the root parent restarts the panel. */
const CHILD_ENV = 'LAMALIBRE_LAMASTE_CLI_PLUGINS_CHILD';

/**
 * Run a plugin subcommand as the lamaste user and wait for it.
 *
 * Plugin state (the npm tree, plugins.json, plugin data) lives in the
 * lamaste-owned state directory. Running npm or writing files there as root
 * would let whatever the panel left in that directory — a `.npmrc`, a
 * symlink — steer root. As lamaste, it can only reach what the panel could
 * already reach. Stays usable while the panel is down (disabling a plugin
 * that keeps it from starting).
 *
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
async function runAsLamaste(args, { json }) {
  const uid = Number.parseInt((await execa('id', ['-u', 'lamaste'])).stdout.trim(), 10);
  const gid = Number.parseInt((await execa('id', ['-g', 'lamaste'])).stdout.trim(), 10);
  const { exitCode } = await execa(
    process.execPath,
    [process.argv[1], 'plugins', ...args, ...(json ? ['--json'] : [])],
    {
      uid,
      gid,
      cwd: STATE_DIR,
      stdio: 'inherit',
      reject: false,
      env: {
        ...process.env,
        [CHILD_ENV]: '1',
        HOME: STATE_DIR,
        USER: 'lamaste',
        LOGNAME: 'lamaste',
        npm_config_cache: `${STATE_DIR}/.npm`,
      },
      extendEnv: false,
    },
  );
  if (exitCode !== 0) process.exit(exitCode ?? 1);
}

/**
 * Restart the panel service after plugin changes.
 * Plugin enable/disable/install/uninstall requires a panel restart to take effect.
 * @param {boolean} json
 */
async function restartPanel(json) {
  // The child run as lamaste cannot; its root parent does.
  if (process.env[CHILD_ENV] === '1') return;
  try {
    await execa('systemctl', ['restart', PANEL_SERVICE]);
    if (!json) {
      console.log(`  Panel service restarted.`);
      console.log('');
    }
  } catch (err) {
    const msg = `Warning: panel restart failed: ${err.stderr || err.message}`;
    if (!json) {
      console.error(`  ${chalk.yellow(msg)}`);
      console.error(`  You may need to restart manually: systemctl restart ${PANEL_SERVICE}`);
      console.log('');
    }
  }
}
