/**
 * lamaste-server plugins — Manage server-side plugins.
 *
 * Subcommands:
 *   list                 List installed plugins with status and hosting
 *   install <package>    Install a plugin by npm package name
 *   enable <name>        Enable a plugin
 *   disable <name>       Disable a plugin
 *   uninstall <name> [--force] [--purge]
 *                        Remove a plugin (must be disabled first); a hosted one
 *                        through its uninstall pipeline (an operation); --purge also
 *                        deletes the data of the agent half Lamaste installed
 *   oidc-clients <name>  The OIDC clients a plugin declares on Authelia
 *   rotate-secret <name> <clientId>
 *                        New secret for a confidential OIDC client (shown once)
 *   hosting <name>       Which agent hosts an agent-hosted plugin's agent half
 *   eligibility <name>   Which enrolled agents can host the plugin, and why the others cannot
 *   host <name> --agent <label>
 *                        Host the plugin on an agent: the install pipeline (its hooks,
 *                        the agent half Lamaste installs, internal tunnel, secret,
 *                        capability), followed to its end
 *   unhost <name> [--force] [--purge]
 *                        Remove the hosting: the uninstall pipeline; --purge also deletes
 *                        the agent half's data directory and service account
 *   rotate-hosting-secret <name>
 *                        New installation secret; the agent picks it up on its next sync
 *   hooks <name>         The plugin's lifecycle hooks and what needs approval: the relay
 *                        hook set (stages, routes, fail-open hooks, effects), the agent
 *                        half Lamaste installs, the approval digest; agent hooks
 *   approve-hooks <name> --digest <sha256>
 *                        Approve with the approval digest `hooks` shows (or a pending update's)
 *   auto-approve <name> on|off
 *                        Approve what this plugin's later versions bring automatically (audited)
 *   update <name> [--version <v>]
 *                        Update an agent-hosted plugin in place (default: latest)
 *   discard-update <name>
 *                        Drop an update that waits for approval
 *   operations <name>    Recent hosting / update / uninstall operations and their steps
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
      return uninstallPluginCmd(args[1], args.slice(2), { json });
    case 'oidc-clients':
      return oidcClientsCmd(args[1], { json });
    case 'rotate-secret':
      return rotateSecretCmd(args[1], args[2], { json });
    case 'hosting':
      return hostingCmd(args[1], { json });
    case 'eligibility':
      return eligibilityCmd(args[1], { json });
    case 'host':
      return hostCmd(args[1], args.slice(2), { json });
    case 'unhost':
      return unhostCmd(args[1], args.slice(2), { json });
    case 'rotate-hosting-secret':
      return rotateHostingSecretCmd(args[1], { json });
    case 'hooks':
      return hooksCmd(args[1], { json });
    case 'approve-hooks':
      return approveHooksCmd(args[1], args.slice(2), { json });
    case 'auto-approve':
      return autoApproveCmd(args[1], args[2], { json });
    case 'update':
      return updateCmd(args[1], args.slice(2), { json });
    case 'discard-update':
      return discardUpdateCmd(args[1], { json });
    case 'operations':
      return operationsCmd(args[1], { json });
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
  ${c('uninstall <name> [--force] [--purge]')}
                       Remove a disabled plugin (a hosted one through its uninstall pipeline;
                       --purge deletes the data of the agent half Lamaste installed)
  ${c('oidc-clients <name>')}  OIDC clients the plugin declares on Authelia (no secrets)
  ${c('rotate-secret <name> <clientId>')}
                       Replace a confidential client's secret — printed once
  ${c('hosting <name>')}       Which agent hosts the plugin's agent half, port, health
  ${c('eligibility <name>')}   Which agents can host the plugin, and why the others cannot
  ${c('host <name> --agent <label>')}
                       Host an agent-hosted plugin on an agent (install pipeline)
  ${c('unhost <name> [--force] [--purge]')}
                       Remove the hosting (uninstall pipeline; --force passes failing hooks,
                       --purge deletes the agent half's data and service account)
  ${c('rotate-hosting-secret <name>')}
                       New installation secret (the agent fetches it on its next sync)
  ${c('hooks <name>')}         Lifecycle hooks and what needs approval: relay hooks, agent half
  ${c('approve-hooks <name> --digest <sha256>')}
                       Approve with the approval digest "hooks" showed (or a pending update's)
  ${c('auto-approve <name> on|off')}
                       Approve what this plugin's later versions bring automatically
  ${c('update <name> [--version <v>]')}
                       Update an agent-hosted plugin in place (default: latest)
  ${c('discard-update <name>')}
                       Drop an update that waits for approval
  ${c('operations <name>')}    Recent operations of the plugin and their steps
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
      ? `  ${d('on')} ${c(p.agentHosting.agentLabel)}:${p.agentHosting.port} ${healthWord(p.agentHosting.health)}` +
        (p.agentHosting.agentHalf ? d(` agent half ${p.agentHosting.agentHalf.version}`) : '')
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
  if (hosting.agentHalf) {
    console.log(
      `  agent half: ${hosting.agentHalf.version}  ${d(`installed by Lamaste ${hosting.agentHalf.installedAt}`)}`,
    );
  }
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
 * Which enrolled machine agents can host the plugin, and why the others
 * cannot: its `agent.requires` and, when Lamaste installs the agent half,
 * what installing it needs, against what each agent reported on its sync.
 *
 * @param {string | undefined} name
 * @param {{ json: boolean }} options
 */
async function eligibilityCmd(name, { json }) {
  if (!name) fail('Usage: lamaste-server plugins eligibility <name>', json);
  let result;
  try {
    result = await panelRequest(
      'GET',
      `/api/plugins/${encodeURIComponent(name)}/hosting/eligibility`,
    );
  } catch (err) {
    fail(err.message, json);
  }
  if (json) {
    emit(result);
    return;
  }
  const { agents } = result;
  if (agents.length === 0) {
    console.log(`\n  No enrolled machine agent — enroll one first.\n`);
    return;
  }
  const d = chalk.dim;
  const width = Math.max('AGENT'.length, ...agents.map((a) => a.label.length));
  const column = 'ELIGIBLE'.length;
  console.log('');
  console.log(chalk.bold(`  Agents that can host ${name}`));
  console.log(d('  ' + '\u2500'.repeat(40)));
  console.log(d(`  ${'AGENT'.padEnd(width)}  ${'ELIGIBLE'.padEnd(column)}  REASONS`));
  for (const agent of agents) {
    const word = agent.eligible
      ? chalk.green('yes'.padEnd(column))
      : chalk.red('no'.padEnd(column));
    const [first, ...more] = agent.reasons;
    console.log(`  ${chalk.cyan(agent.label.padEnd(width))}  ${word}  ${first ?? ''}`);
    for (const reason of more) console.log(`  ${' '.repeat(width + column + 2)}  ${reason}`);
  }
  console.log('');
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
  if (!json) console.log(`\n  Hosting ${chalk.cyan(name)} on ${chalk.cyan(agentLabel)}`);
  let result;
  try {
    result = await panelRequest('POST', `/api/plugins/${encodeURIComponent(name)}/hosting`, {
      agentLabel,
    });
  } catch (err) {
    failRefused(err, json, { step: 'host', name, agentLabel, action: 'install' });
  }
  const operation = await followOperation(name, result.operation, { json });
  if (operation.status !== 'succeeded') process.exit(1);
  const { hosting } = await panelRequest('GET', `/api/plugins/${encodeURIComponent(name)}/hosting`);
  if (json) {
    emitComplete({ operation, hosting });
    return;
  }
  printHosting(hosting);
}

/**
 * @param {string | undefined} name
 * @param {string[]} rest
 * @param {{ json: boolean }} options
 */
async function unhostCmd(name, rest, { json }) {
  if (!name) fail('Usage: lamaste-server plugins unhost <name> [--force] [--purge]', json);
  const force = rest.includes('--force');
  const purge = rest.includes('--purge');
  let result;
  try {
    result = await panelRequest(
      'DELETE',
      `/api/plugins/${encodeURIComponent(name)}/hosting${removalQuery({ force, purge })}`,
    );
  } catch (err) {
    failRefused(err, json, { name, action: 'uninstall' });
  }
  if (!json) {
    const how = [force ? 'forced' : null, purge ? `deleting ${await agentHalfDataDir(name)}` : null]
      .filter(Boolean)
      .join(', ');
    console.log(`\n  Removing the hosting of ${chalk.cyan(name)}${how ? ` (${how})` : ''}`);
  }
  await finishOperation(name, result.operation, { json });
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

const STEP_MARK = {
  done: chalk.green('✓'),
  failed: chalk.red('✗'),
  skipped: chalk.dim('–'),
  running: chalk.cyan('…'),
};

/** One finished step of an operation, with why it failed or what it did. */
function printStep(step) {
  const why = step.error ?? step.detail;
  console.log(
    `    ${STEP_MARK[step.status] ?? ' '} ${step.name}${why ? chalk.dim(` — ${why}`) : ''}`,
  );
}

/** An operation's warnings. */
function printWarnings(warnings) {
  for (const warning of warnings ?? []) console.log(`    ${chalk.yellow('!')} ${warning}`);
}

/**
 * Follow an operation until it ends, printing each step as it finishes
 * (NDJSON steps with --json). Hosting waits on the agent's sync, so this
 * can take a few minutes.
 *
 * @param {string} name
 * @param {{ id: string }} operation
 * @param {{ json: boolean }} options
 */
async function followOperation(name, operation, { json }) {
  const printed = new Set();
  let current = operation;
  for (;;) {
    for (const [i, step] of (current.steps ?? []).entries()) {
      if (step.status === 'running' || printed.has(i)) continue;
      printed.add(i);
      if (json) {
        emitStep(
          step.name,
          step.status === 'done' ? 'complete' : step.status,
          step.error ?? step.detail,
        );
      } else {
        printStep(step);
      }
    }
    if (current.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 2000));
    ({ operation: current } = await panelRequest(
      'GET',
      `/api/plugins/${encodeURIComponent(name)}/operations/${encodeURIComponent(operation.id)}`,
    ));
  }
  if (!json) {
    printWarnings(current.warnings);
    const word =
      current.status === 'succeeded'
        ? chalk.green('succeeded')
        : current.status === 'rolled-back'
          ? chalk.yellow('rolled back')
          : chalk.red(current.status);
    console.log(`\n  ${current.kind} ${word}${current.error ? `: ${current.error}` : ''}\n`);
    // An update that added a confidential OIDC client: its secret, shown once.
    printCreatedSecrets(current.oidcClients);
  }
  return current;
}

/**
 * Follow an operation the panel started to its end and exit non-zero
 * unless it succeeded (with --json, its outcome as the complete event).
 *
 * @param {string} name
 * @param {{ id: string }} operation
 * @param {{ json: boolean }} options
 */
async function finishOperation(name, operation, { json }) {
  const finished = await followOperation(name, operation, { json });
  if (json) emitComplete({ name, operation: finished });
  if (finished.status !== 'succeeded') process.exit(1);
}

/**
 * @param {string | undefined} name
 * @param {{ json: boolean }} options
 */
async function operationsCmd(name, { json }) {
  if (!name) fail('Usage: lamaste-server plugins operations <name>', json);
  const { operations } = await panelRequest(
    'GET',
    `/api/plugins/${encodeURIComponent(name)}/operations`,
  );
  if (json) {
    emit({ operations });
    return;
  }
  if (operations.length === 0) {
    console.log(`\n  No operations for ${chalk.cyan(name)}.\n`);
    return;
  }
  console.log('');
  for (const op of operations) {
    console.log(
      `  ${chalk.bold(op.kind)} ${chalk.dim(op.startedAt)} by ${op.actor} — ${op.status}${op.error ? chalk.dim(`: ${op.error}`) : ''}`,
    );
    for (const step of op.steps) printStep(step);
    printWarnings(op.warnings);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

/** Print a relay hook set preview — the relay half of what an approval covers. */
function printRelayHookSet(relay, title) {
  const d = chalk.dim;
  console.log(chalk.bold(`  ${title}`));
  console.log(
    `    module:   ${relay.entry ?? d('(none — shared hooks only)')}${relay.entrySha256 ? d(` sha256 ${relay.entrySha256}`) : ''}`,
  );
  for (const stage of relay.stages) {
    console.log(`    stage:    ${stage.stage} ${d(`(${stage.timeoutMs} ms)`)}`);
  }
  for (const hook of relay.request) {
    const who = hook.use ?? 'plugin module';
    const failOpen =
      hook.failOpen.length > 0 ? chalk.yellow(` FAIL-OPEN: ${hook.failOpen.join(', ')}`) : '';
    console.log(
      `    request:  ${hook.stage} ${who} on ${hook.routes.join(', ')}${failOpen}` +
        d(` (body ${hook.bodyMaxBytes ?? 0} B, ${hook.timeoutMs} ms, onError ${hook.onError})`),
    );
    if (hook.inactiveRoutes.length > 0) {
      console.log(
        d(`              not active until the user surface: ${hook.inactiveRoutes.join(', ')}`),
      );
    }
  }
  console.log(`    effects:  ${relay.effects.length > 0 ? relay.effects.join(', ') : d('none')}`);
  if (relay.packs.length > 0) console.log(`    packs:    ${relay.packs.join(', ')}`);
}

/**
 * Print an agent half preview — what Lamaste installs on the hosting agent
 * once approved: the package at the version and tarball integrity the relay
 * pinned, its service and the system packages installed for it.
 */
function printAgentHalf(agentHalf, title) {
  const d = chalk.dim;
  const line = (label, value) => console.log(`    ${`${label}:`.padEnd(11)}${value}`);
  console.log(chalk.bold(`  ${title}`));
  line('package', chalk.cyan(`${agentHalf.package}@${agentHalf.version}`));
  line('integrity', agentHalf.integrity);
  line('entry', `${agentHalf.entry}  ${d(`memory ${agentHalf.memoryMax ?? 'not limited'}`)}`);
  line('runs as', `${agentHalf.serviceUser}  ${d(`unit ${agentHalf.unitName}`)}`);
  line('data', `${agentHalf.dataDir}  ${d('(kept when it is removed, unless purged)')}`);
  line(
    'packages',
    agentHalf.systemPackages.length > 0
      ? `${agentHalf.systemPackages.join(', ')}  ${d('(system packages, apt-get once approved)')}`
      : d('none'),
  );
}

/**
 * Print what a version brings that needs approval — the approval digest
 * (the one value `approve-hooks` takes), its relay hook set and the agent
 * half Lamaste installs.
 */
function printApprovalContents({ digest, relay, agentHalf }) {
  console.log(`    approval digest: ${chalk.cyan(digest)}`);
  if (relay) {
    console.log('');
    printRelayHookSet(relay, 'Relay hooks — run in a sandbox on the relay');
  }
  if (agentHalf) {
    console.log('');
    printAgentHalf(agentHalf, 'Agent half — Lamaste installs it on the hosting agent');
  }
}

/** The command that approves `digest` for plugin `name`. */
function approveCommand(name, digest) {
  return chalk.cyan(`lamaste-server plugins approve-hooks ${name} --digest ${digest}`);
}

/**
 * @param {string | undefined} name
 * @param {{ json: boolean }} options
 */
async function hooksCmd(name, { json }) {
  if (!name) fail('Usage: lamaste-server plugins hooks <name>', json);
  let result;
  try {
    result = await panelRequest('GET', `/api/plugins/${encodeURIComponent(name)}/hooks`);
  } catch (err) {
    fail(err.message, json);
  }
  if (json) {
    emit(result);
    return;
  }
  const { hooks } = result;
  const { approval } = hooks;
  console.log('');
  if (!approval.required && !hooks.agent && !hooks.pendingUpdate) {
    console.log(
      `  Plugin ${chalk.cyan(name)} declares no lifecycle hooks and no agent half for Lamaste to install.\n`,
    );
    return;
  }
  if (approval.required) {
    const state =
      approval.state === 'approved'
        ? chalk.green(
            `approved by ${approval.approvedBy} at ${approval.approvedAt} (version ${approval.approvedVersion})`,
          )
        : chalk.yellow('waiting for approval');
    console.log(chalk.bold(`  What ${name} brings — `) + state);
    printApprovalContents({
      digest: approval.digest,
      relay: hooks.relay,
      agentHalf: hooks.agentHalf,
    });
    console.log(
      `\n    auto-approve for later versions: ${hooks.autoApprove ? chalk.yellow('on') : 'off'}`,
    );
    if (approval.state !== 'approved') {
      console.log(`\n    Approve with: ${approveCommand(name, approval.digest)}`);
    }
  }
  if (hooks.agent) {
    console.log(chalk.bold(`\n  Agent hooks (run by the agent half; no approval)`));
    for (const stage of hooks.agent.stages) {
      console.log(`    ${stage.stage} ${chalk.dim(`(${stage.timeoutMs} ms)`)}`);
    }
  }
  if (hooks.pendingUpdate) {
    const update = hooks.pendingUpdate;
    console.log('');
    console.log(chalk.bold(`  Update to ${update.version} — waits for approval`));
    printApprovalContents(update);
    console.log(`\n    Approve and update with: ${approveCommand(name, update.digest)}`);
  }
  console.log('');
}

/**
 * @param {string | undefined} name
 * @param {string[]} rest
 * @param {{ json: boolean }} options
 */
async function approveHooksCmd(name, rest, { json }) {
  const idx = rest.indexOf('--digest');
  const digest = idx !== -1 ? rest[idx + 1] : undefined;
  if (!name || !digest || !/^[a-f0-9]{64}$/.test(digest)) {
    fail(
      'Usage: lamaste-server plugins approve-hooks <name> --digest <sha256> (the approval digest `hooks <name>` shows)',
      json,
    );
  }
  let result;
  try {
    result = await panelRequest('POST', `/api/plugins/${encodeURIComponent(name)}/hooks/approve`, {
      digest,
    });
  } catch (err) {
    // Approving a pending update starts it: its agent half is a push.
    failRefused(err, json, { name, action: 'update' });
  }
  if (result.operation) {
    if (!json) console.log(`\n  Approved; updating ${chalk.cyan(name)}`);
    await finishOperation(name, result.operation, { json });
    return;
  }
  if (json) emitComplete({ name, approved: digest });
  else console.log(`\n  What ${chalk.cyan(name)} brings is ${chalk.green('approved')}.\n`);
}

/**
 * @param {string | undefined} name
 * @param {string | undefined} value
 * @param {{ json: boolean }} options
 */
async function autoApproveCmd(name, value, { json }) {
  if (!name || (value !== 'on' && value !== 'off')) {
    fail('Usage: lamaste-server plugins auto-approve <name> on|off', json);
  }
  try {
    await panelRequest('PUT', `/api/plugins/${encodeURIComponent(name)}/hooks/auto-approve`, {
      enabled: value === 'on',
    });
  } catch (err) {
    fail(err.message, json);
  }
  if (json) emitComplete({ name, autoApprove: value === 'on' });
  else
    console.log(
      `\n  Auto-approve of hook-set changes for ${chalk.cyan(name)}: ${value === 'on' ? chalk.yellow('on') : 'off'}\n`,
    );
}

/**
 * @param {string | undefined} name
 * @param {string[]} rest
 * @param {{ json: boolean }} options
 */
async function updateCmd(name, rest, { json }) {
  if (!name) fail('Usage: lamaste-server plugins update <name> [--version <v>]', json);
  const idx = rest.indexOf('--version');
  const version = idx !== -1 ? rest[idx + 1] : undefined;
  let result;
  try {
    result = await panelRequest(
      'POST',
      `/api/plugins/${encodeURIComponent(name)}/update`,
      version ? { version } : {},
      { timeoutMs: NPM_CALL_TIMEOUT_MS },
    );
  } catch (err) {
    failRefused(err, json, { name, action: 'update' });
  }
  if (result.upToDate) {
    if (json) emitComplete({ name, upToDate: true, version: result.version });
    else console.log(`\n  ${chalk.cyan(name)} is already at ${result.version}.\n`);
    return;
  }
  if (result.pendingUpdate) {
    if (json) {
      emitComplete({ name, pendingUpdate: result.pendingUpdate });
      return;
    }
    const update = result.pendingUpdate;
    console.log('');
    console.log(chalk.bold(`  ${name} ${update.version} waits for approval`));
    printApprovalContents(update);
    console.log(`\n    Approve and update with: ${approveCommand(name, update.digest)}\n`);
    return;
  }
  if (!json) console.log(`\n  Updating ${chalk.cyan(name)}`);
  await finishOperation(name, result.operation, { json });
}

/**
 * @param {string | undefined} name
 * @param {{ json: boolean }} options
 */
async function discardUpdateCmd(name, { json }) {
  if (!name) fail('Usage: lamaste-server plugins discard-update <name>', json);
  try {
    await panelRequest('DELETE', `/api/plugins/${encodeURIComponent(name)}/update`);
  } catch (err) {
    fail(err.message, json);
  }
  if (json) emitComplete({ name, pendingUpdate: null });
  else console.log(`\n  The pending update of ${chalk.cyan(name)} was discarded.\n`);
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

/** What Lamaste does with the agent half for each push-install action. */
const PUSH_VERB = { install: 'installs', update: 'updates', uninstall: 'removes' };

/**
 * Exit with a refused plugin operation (hosting, removing a hosting,
 * uninstalling, updating): the panel's message, the reasons an agent
 * cannot host the plugin, and what lifts a refusal the administrator can
 * lift. NDJSON carries the refusal's `code` and `reasons`.
 *
 * @param {Error & { code?: string, reasons?: string[] }} err  from panelRequest
 * @param {boolean} json
 * @param {{ step?: string, name: string, agentLabel?: string, action: 'install' | 'update' | 'uninstall' }} context
 * @returns {never}
 */
function failRefused(err, json, { step, name, agentLabel, action }) {
  const reasons = err.reasons ?? [];
  if (json) {
    if (step) emitStep(step, 'failed', err.message);
    emitError(err.message, false, {
      ...(err.code ? { code: err.code } : {}),
      ...(err.reasons ? { reasons } : {}),
    });
    process.exit(1);
  }
  const d = chalk.dim;
  console.error(`\n  ${chalk.red(err.message)}`);
  if (err.code === 'agent_not_eligible') {
    for (const reason of reasons) console.error(`    - ${reason}`);
    console.error(
      d(
        `\n  Every agent and why: lamaste-server plugins eligibility ${name}` +
          `\n  An agent reports its host on its sync (about every 30 seconds).`,
      ),
    );
  } else if (err.code === 'push_install_refused') {
    const agent = agentLabel ? `agent "${agentLabel}"` : 'the hosting agent';
    console.error(
      d(
        `\n  Lamaste ${PUSH_VERB[action]} the agent half by push install: push install must be on for` +
          `\n  this relay and enabled for ${agent} with its window open, and the agent's policy must` +
          `\n  allow "${action}" of the agent package from this address (the CLI calls the panel` +
          `\n  from 127.0.0.1).`,
      ),
    );
  } else if (err.code === 'hooks_not_approved') {
    console.error(
      d(`\n  Review what it brings with: lamaste-server plugins hooks ${name}, then approve it.`),
    );
  }
  console.error('');
  process.exit(1);
}

/**
 * The data directory of the agent half Lamaste installed for plugin `name`
 * (from its preview), or a description of it when the panel does not name
 * one — what a purge deletes, said before it runs.
 *
 * @param {string} name
 * @returns {Promise<string>}
 */
async function agentHalfDataDir(name) {
  const unnamed = "the agent half's data directory";
  try {
    const { hooks } = await panelRequest('GET', `/api/plugins/${encodeURIComponent(name)}/hooks`);
    return hooks.agentHalf?.dataDir ?? unnamed;
  } catch {
    return unnamed;
  }
}

/**
 * `?force=true&purge=true` for removing a plugin's hosting, with only the
 * flags that are set: `force` lets failing pre-teardown hooks pass, `purge`
 * deletes the data and service account of the agent half Lamaste installed.
 *
 * @param {{ force: boolean, purge: boolean }} flags
 */
function removalQuery({ force, purge }) {
  const params = new URLSearchParams();
  if (force) params.set('force', 'true');
  if (purge) params.set('purge', 'true');
  const text = params.toString();
  return text ? `?${text}` : '';
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
    emitComplete({ plugin, oidcClients, hooks: result.hooks });
    return;
  }
  const hosting = plugin.hosting === 'agent' ? ', agent-hosted' : '';
  console.log(` ${chalk.green('ok')}`);
  console.log(`  Plugin ${chalk.cyan(plugin.name)} installed (${chalk.dim(`disabled${hosting}`)})`);
  console.log(`  Run ${chalk.cyan(`lamaste-server plugins enable ${plugin.name}`)} to activate.`);
  console.log('');
  const approval = result.hooks?.approval;
  if (approval?.required) {
    console.log(chalk.bold(`  What it brings — review before hosting`));
    printApprovalContents({
      digest: approval.digest,
      relay: result.hooks.relay,
      agentHalf: result.hooks.agentHalf,
    });
    if (approval.state === 'pending') {
      console.log(`\n    Approve with: ${approveCommand(plugin.name, approval.digest)}`);
    }
    console.log('');
  }
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
async function uninstallPluginCmd(name, rest, { json }) {
  if (!name) fail('Usage: lamaste-server plugins uninstall <name> [--force] [--purge]', json);
  const force = rest.includes('--force');
  const purge = rest.includes('--purge');

  if (json) emitStep('uninstall', 'running', `Uninstalling ${name}`);
  else {
    const deleting = purge ? ` (deleting ${await agentHalfDataDir(name)})` : '';
    process.stderr.write(`  Uninstalling ${chalk.cyan(name)}${deleting}...`);
  }

  let result;
  try {
    // The panel refuses an enabled plugin (409): nothing of it is mounted
    // once it is disabled, so no restart follows.
    result = await panelRequest(
      'DELETE',
      `/api/plugins/${encodeURIComponent(name)}${removalQuery({ force, purge })}`,
      null,
      { timeoutMs: NPM_CALL_TIMEOUT_MS },
    );
  } catch (err) {
    if (!json) console.log(` ${chalk.red('failed')}`);
    failRefused(err, json, { step: 'uninstall', name, action: 'uninstall' });
  }

  if (result.operation) {
    // Hosted: its uninstall pipeline runs first.
    if (!json) console.log('');
    const operation = await followOperation(name, result.operation, { json });
    if (json) emitComplete({ name, removed: operation.status === 'succeeded', operation });
    if (operation.status !== 'succeeded') process.exit(1);
    return;
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
