/**
 * lamaste-server plugins — Manage server-side plugins.
 *
 * Subcommands:
 *   list                 List installed plugins with status and hosting
 *   install <package>    Install a plugin by npm package name
 *   enable <name>        Enable a plugin
 *   disable <name>       Disable a plugin
 *   uninstall <name>     Remove a plugin (must be disabled first)
 *   oidc-clients <name>  The OIDC clients a plugin declares on Authelia
 *   rotate-secret <name> <clientId>
 *                        New secret for a confidential OIDC client (shown once)
 *   hosting <name>       Which agent hosts an agent-hosted plugin's agent half
 *   host <name> --agent <label>
 *                        Host the plugin on an agent: internal tunnel, secret, capability
 *   unhost <name>        Remove the hosting (tunnel, secret, capability)
 *   rotate-hosting-secret <name>
 *                        New installation secret; the agent picks it up on its next sync
 *
 * Every subcommand goes through the running panel (`/api/plugins/*`, admin
 * certificate): the panel owns the plugin registry (SQLite `state.db`), runs
 * npm as the `lamaste` account, and writes the plugins' OIDC clients to
 * Authelia. The CLI keeps no plugin state of its own, so a plugin it installs
 * is the plugin the panel serves. The panel must be running — a plugin that
 * fails to load is logged and skipped by the plugin host, so the panel stays
 * reachable to disable it.
 */

import chalk from 'chalk';
import { execa } from 'execa';
import { PANEL_SERVICE } from '../config.js';
import { panelRequest } from '../panel-api.js';
import { emit, emitStep, emitError, emitComplete, emitLog } from '../ndjson.js';

/** npm runs inside the panel for install and uninstall (its own limit is 120 s). */
const NPM_CALL_TIMEOUT_MS = 180_000;

/**
 * @param {string[]} args  Subcommand args: ['list'] | ['install', '<pkg>'] | ...
 * @param {{ json: boolean }} options
 */
export async function runPlugins(args, { json }) {
  const sub = args[0];

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
    case 'oidc-clients':
      return oidcClientsCmd(args[1], { json });
    case 'rotate-secret':
      return rotateSecretCmd(args[1], args[2], { json });
    case 'hosting':
      return hostingCmd(args[1], { json });
    case 'host':
      return hostCmd(args[1], args.slice(2), { json });
    case 'unhost':
      return unhostCmd(args[1], { json });
    case 'rotate-hosting-secret':
      return rotateHostingSecretCmd(args[1], { json });
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
  ${c('list')}                 Installed plugins: status, hosting (server or agent)
  ${c('install <package>')}    Install a plugin (e.g. @lamalibre/herd-server)
  ${c('enable <name>')}        Enable a plugin
  ${c('disable <name>')}       Disable a plugin
  ${c('uninstall <name>')}     Remove a disabled plugin
  ${c('oidc-clients <name>')}  OIDC clients the plugin declares on Authelia (no secrets)
  ${c('rotate-secret <name> <clientId>')}
                       Replace a confidential client's secret — printed once
  ${c('hosting <name>')}       Which agent hosts the plugin's agent half, port, health
  ${c('host <name> --agent <label>')}
                       Host an agent-hosted plugin on an agent
  ${c('unhost <name>')}        Remove the hosting
  ${c('rotate-hosting-secret <name>')}
                       New installation secret (the agent fetches it on its next sync)
`);
}

/**
 * The plugins the running panel serves, from the panel itself: its registry
 * (SQLite `state.db`) is the one the plugin host and the OIDC sync read.
 *
 * @param {{ json: boolean }} options
 */
async function listPlugins({ json }) {
  const { plugins = [] } = await panelRequest('GET', '/api/plugins');

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
    const hosting = p.hosting === 'agent' ? chalk.yellow('agent-hosted') : d('server-hosted');
    const hostedOn = p.agentHosting
      ? `  ${d('on')} ${c(p.agentHosting.agentLabel)}:${p.agentHosting.port} ${healthWord(p.agentHosting.health)}`
      : '';
    console.log(
      `  ${c(p.name)}  ${d(p.version)}  ${status}  ${hosting}${hostedOn}  ${d(p.packageName)}`,
    );
  }
  console.log('');
}

/** One coloured word for a hosting's health. */
function healthWord(health) {
  if (!health || health.state === 'unknown') return chalk.dim('(health unknown)');
  if (health.state === 'up') return chalk.green('up');
  return chalk.red(`down (${health.reason ?? 'unknown'})`);
}

/**
 * Print a hosting record.
 * @param {Record<string, unknown>} hosting
 */
function printHosting(hosting) {
  const d = chalk.dim;
  console.log('');
  console.log(chalk.bold(`  Hosting of ${hosting.plugin}`));
  console.log(d('  ' + '\u2500'.repeat(40)));
  console.log(`  agent:    ${chalk.cyan(hosting.agentLabel)}`);
  console.log(
    `  port:     ${hosting.port}  ${d('(relay loopback, internal tunnel ' + hosting.tunnelId + ')')}`,
  );
  console.log(
    `  secret:   issued ${hosting.secretIssuedAt}${hosting.secretAcknowledged ? '' : d(' — not yet fetched by the agent')}${hosting.rotationPending ? chalk.yellow(' (rotation pending: previous secret still accepted)') : ''}`,
  );
  const h = hosting.health ?? {};
  console.log(
    `  health:   ${healthWord(h)}${h.since ? d(` since ${h.since}`) : ''}${h.lastError && h.state !== 'up' ? d(` — ${h.lastError}`) : ''}`,
  );
  console.log('');
}

/**
 * @param {string | undefined} name
 * @param {{ json: boolean }} options
 */
async function hostingCmd(name, { json }) {
  if (!name) fail('Usage: lamaste-server plugins hosting <name>', json);
  let result;
  try {
    result = await panelRequest('GET', `/api/plugins/${encodeURIComponent(name)}/hosting`);
  } catch (err) {
    fail(err.message, json);
  }
  if (json) emit(result);
  else printHosting(result.hosting);
}

/**
 * @param {string | undefined} name
 * @param {string[]} rest
 * @param {{ json: boolean }} options
 */
async function hostCmd(name, rest, { json }) {
  const agentIdx = rest.indexOf('--agent');
  const agentLabel = agentIdx !== -1 ? rest[agentIdx + 1] : undefined;
  if (!name || !agentLabel) fail('Usage: lamaste-server plugins host <name> --agent <label>', json);
  if (json) emitStep('host', 'running', `Hosting ${name} on ${agentLabel}`);
  else process.stderr.write(`  Hosting ${chalk.cyan(name)} on ${chalk.cyan(agentLabel)}...`);
  let result;
  try {
    result = await panelRequest('POST', `/api/plugins/${encodeURIComponent(name)}/hosting`, {
      agentLabel,
    });
  } catch (err) {
    if (!json) console.log(` ${chalk.red('failed')}`);
    fail(err.message, json, 'host');
  }
  if (json) {
    emitStep('host', 'complete');
    emitComplete({ hosting: result.hosting });
    return;
  }
  console.log(` ${chalk.green('ok')}`);
  printHosting(result.hosting);
  console.log(
    `  The agent fetches the plugin config on its next sync (within about 30 s); the agent half\n` +
      `  must listen on 127.0.0.1:${result.hosting.port} and verify callers with that config.\n`,
  );
}

/**
 * @param {string | undefined} name
 * @param {{ json: boolean }} options
 */
async function unhostCmd(name, { json }) {
  if (!name) fail('Usage: lamaste-server plugins unhost <name>', json);
  try {
    await panelRequest('DELETE', `/api/plugins/${encodeURIComponent(name)}/hosting`);
  } catch (err) {
    fail(err.message, json);
  }
  if (json) emitComplete({ name, hosted: false });
  else
    console.log(
      `\n  Hosting of ${chalk.cyan(name)} ${chalk.red('removed')} (tunnel, secret, capability).\n`,
    );
}

/**
 * @param {string | undefined} name
 * @param {{ json: boolean }} options
 */
async function rotateHostingSecretCmd(name, { json }) {
  if (!name) fail('Usage: lamaste-server plugins rotate-hosting-secret <name>', json);
  let result;
  try {
    result = await panelRequest(
      'POST',
      `/api/plugins/${encodeURIComponent(name)}/hosting/rotate-secret`,
    );
  } catch (err) {
    fail(err.message, json);
  }
  if (json) emitComplete({ hosting: result.hosting });
  else {
    console.log(`\n  New installation secret issued for ${chalk.cyan(name)}.`);
    console.log(`  The previous secret stays accepted until the agent acknowledges the new one.`);
    printHosting(result.hosting);
  }
}

/**
 * Print the secrets of confidential OIDC clients an install or enable created.
 * They are shown once — the panel stores only their digests.
 *
 * @param {Array<{ id: string, secret: string }> | undefined} clients
 */
function printCreatedSecrets(clients) {
  if (!clients || clients.length === 0) return;
  console.log(`  ${chalk.bold('Confidential OIDC client secrets (shown once):')}`);
  for (const c of clients) console.log(`    ${chalk.cyan(c.id)}  ${c.secret}`);
  console.log('');
}

/**
 * Exit with a usage or panel error, as text or NDJSON.
 *
 * @param {string} message
 * @param {boolean} json
 * @param {string} [step]  NDJSON step that failed
 * @returns {never}
 */
function fail(message, json, step) {
  if (json) {
    if (step) emitStep(step, 'failed', message);
    emitError(message);
  } else {
    console.error(`\n  ${chalk.red(message)}\n`);
  }
  process.exit(1);
}

/**
 * @param {string | undefined} packageName
 * @param {{ json: boolean }} options
 */
async function installPluginCmd(packageName, { json }) {
  if (!packageName) fail('Usage: lamaste-server plugins install <package>', json);

  if (json) {
    emitStep('install', 'running', `Installing ${packageName}`);
    emitLog('info', `The panel is fetching ${packageName} from the npm registry.`);
  } else {
    process.stderr.write(`  Installing ${chalk.cyan(packageName)}...`);
  }

  let result;
  try {
    result = await panelRequest(
      'POST',
      '/api/plugins/install',
      { packageName },
      { timeoutMs: NPM_CALL_TIMEOUT_MS },
    );
  } catch (err) {
    if (!json) console.log(` ${chalk.red('failed')}`);
    fail(err.message, json, 'install');
  }

  const { plugin, oidcClients } = result;
  if (json) {
    emitStep('install', 'complete');
    emitComplete({ plugin, oidcClients });
    return;
  }
  const hosting = plugin.hosting === 'agent' ? ', agent-hosted' : '';
  console.log(` ${chalk.green('ok')}`);
  console.log(`  Plugin ${chalk.cyan(plugin.name)} installed (${chalk.dim(`disabled${hosting}`)})`);
  console.log(`  Run ${chalk.cyan(`lamaste-server plugins enable ${plugin.name}`)} to activate.`);
  console.log('');
  printCreatedSecrets(oidcClients);
}

/**
 * The panel mounts a server-hosted plugin's routes at startup, so enabling or
 * disabling one takes effect after a restart; an agent-hosted plugin has
 * nothing mounted and its OIDC clients are already applied.
 *
 * @param {string} name
 * @returns {Promise<boolean>}
 */
async function needsRestart(name) {
  const { plugin } = await panelRequest('GET', `/api/plugins/${encodeURIComponent(name)}`);
  return plugin.hosting !== 'agent';
}

/**
 * @param {string | undefined} name
 * @param {{ json: boolean }} options
 */
async function enablePluginCmd(name, { json }) {
  if (!name) fail('Usage: lamaste-server plugins enable <name>', json);

  let result;
  try {
    result = await panelRequest('POST', `/api/plugins/${encodeURIComponent(name)}/enable`);
  } catch (err) {
    fail(err.message, json);
  }

  if (json) emitComplete({ name, status: 'enabled', oidcClients: result.oidcClients });
  else {
    console.log(`\n  Plugin ${chalk.cyan(name)} ${chalk.green('enabled')}.`);
    printCreatedSecrets(result.oidcClients);
  }
  if (await needsRestart(name)) await restartPanel(json);
}

/**
 * @param {string | undefined} name
 * @param {{ json: boolean }} options
 */
async function disablePluginCmd(name, { json }) {
  if (!name) fail('Usage: lamaste-server plugins disable <name>', json);

  try {
    await panelRequest('POST', `/api/plugins/${encodeURIComponent(name)}/disable`);
  } catch (err) {
    fail(err.message, json);
  }

  if (json) emitComplete({ name, status: 'disabled' });
  else console.log(`\n  Plugin ${chalk.cyan(name)} ${chalk.red('disabled')}.`);
  if (await needsRestart(name)) await restartPanel(json);
}

/**
 * @param {string | undefined} name
 * @param {{ json: boolean }} options
 */
async function uninstallPluginCmd(name, { json }) {
  if (!name) fail('Usage: lamaste-server plugins uninstall <name>', json);

  if (json) emitStep('uninstall', 'running', `Uninstalling ${name}`);
  else process.stderr.write(`  Uninstalling ${chalk.cyan(name)}...`);

  try {
    // The panel refuses an enabled plugin (409): nothing of it is mounted
    // once it is disabled, so no restart follows.
    await panelRequest('DELETE', `/api/plugins/${encodeURIComponent(name)}`, null, {
      timeoutMs: NPM_CALL_TIMEOUT_MS,
    });
  } catch (err) {
    if (!json) console.log(` ${chalk.red('failed')}`);
    fail(err.message, json, 'uninstall');
  }

  if (json) {
    emitStep('uninstall', 'complete');
    emitComplete({ name, removed: true });
  } else {
    console.log(` ${chalk.green('ok')}`);
  }
}

/**
 * @param {string | undefined} name
 * @param {{ json: boolean }} options
 */
async function oidcClientsCmd(name, { json }) {
  if (!name) {
    const msg = 'Usage: lamaste-server plugins oidc-clients <name>';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }
  const result = await panelRequest('GET', `/api/plugins/${encodeURIComponent(name)}/oidc-clients`);
  if (json) {
    emit(result);
    return;
  }
  const clients = result.clients ?? [];
  if (clients.length === 0) {
    console.log(`\n  Plugin ${chalk.cyan(name)} declares no OIDC clients.\n`);
    return;
  }
  const b = chalk.bold;
  const d = chalk.dim;
  console.log('');
  console.log(b(`  OIDC clients of ${name}`));
  console.log(d('  ' + '\u2500'.repeat(40)));
  for (const c of clients) {
    const kind = c.confidential ? chalk.yellow('confidential') : chalk.green('public');
    const served = c.enabled ? '' : d(' (plugin disabled — not served)');
    console.log(`  ${chalk.cyan(c.id)}  ${kind}${served}`);
    console.log(`    grants:   ${c.grantTypes.join(', ')}`);
    console.log(`    scopes:   ${c.scopes.join(', ')}`);
    if (c.audience.length > 0) console.log(`    audience: ${c.audience.join(', ')}`);
    if (c.accessTokenClaims.length > 0) {
      console.log(`    claims:   ${c.accessTokenClaims.join(', ')} (in access tokens)`);
    }
    if (c.confidential) {
      console.log(
        `    secret:   created ${c.secretCreatedAt ?? d('(not yet)')}${
          c.secretRotatedAt ? `, rotated ${c.secretRotatedAt}` : ''
        }`,
      );
    }
  }
  console.log('');
}

/**
 * @param {string | undefined} name
 * @param {string | undefined} clientId
 * @param {{ json: boolean }} options
 */
async function rotateSecretCmd(name, clientId, { json }) {
  if (!name || !clientId) {
    const msg = 'Usage: lamaste-server plugins rotate-secret <name> <clientId>';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }
  const result = await panelRequest(
    'POST',
    `/api/plugins/${encodeURIComponent(name)}/oidc-clients/${encodeURIComponent(clientId)}/rotate-secret`,
  );
  if (json) {
    emit(result);
    return;
  }
  console.log(
    `\n  ${chalk.green('✓')} Secret of ${chalk.cyan(clientId)} rotated at ${result.rotatedAt}`,
  );
  console.log(`  ${chalk.bold('New secret (shown once):')} ${result.secret}\n`);
}

/**
 * Restart the panel so it mounts (or unmounts) a server-hosted plugin's
 * routes. Needs root, like every `lamaste-server` command that reads the
 * admin certificate.
 * @param {boolean} json
 */
async function restartPanel(json) {
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
