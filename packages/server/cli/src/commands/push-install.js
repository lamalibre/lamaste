/**
 * lamaste-server push-install — Push install: what lets the panel install,
 * update and remove what Lamaste installs on an agent (the agent half of an
 * app plugin) while that agent's window is open, within its policy.
 *
 * Subcommands:
 *   status                     The switch, the default policy, the policies, every
 *                              machine agent's window (the default subcommand)
 *   on | off                   Turn push install on or off for this relay
 *   default-policy <id>        The policy a window gets when none is named
 *   open <agent> [--minutes <n>] [--policy <id>]
 *                              Open an agent's window for n minutes (default 30,
 *                              within the bounds the panel reports)
 *   close <agent>              Close an agent's window
 *
 * Every subcommand goes through the running panel (`/api/plugins/push-install/*`
 * and `/api/certs/agent`, admin certificate). The panel checks a push's
 * source address against the agent's policy: pushes this CLI starts come
 * from 127.0.0.1.
 */

import chalk from 'chalk';
import { panelRequest } from '../panel-api.js';
import { emit, emitComplete, emitError } from '../ndjson.js';

/** How long a window opens for when `--minutes` is not given. */
export const DEFAULT_WINDOW_MINUTES = 30;

/**
 * The arguments of `open <agent> [--minutes <n>] [--policy <id>]`, checked
 * against the window bounds the panel reports. Pure, exported for tests.
 *
 * @param {string[]} args  what follows `open`
 * @param {{ min: number, max: number }} bounds
 * @returns {{ ok: true, label: string, minutes: number, policyId: string | null } | { ok: false, error: string }}
 */
export function parseOpenArgs(args, bounds) {
  const usage = 'Usage: lamaste-server push-install open <agent> [--minutes <n>] [--policy <id>]';
  let label = null;
  let minutesText = null;
  let policyId = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--minutes' || arg === '--policy') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        return { ok: false, error: `${arg} needs a value — ${usage}` };
      }
      if (arg === '--minutes') minutesText = value;
      else policyId = value;
      i++;
    } else if (arg.startsWith('--')) {
      return { ok: false, error: `Unknown option ${arg} — ${usage}` };
    } else if (label === null) {
      label = arg;
    } else {
      return { ok: false, error: `Unexpected argument "${arg}" — ${usage}` };
    }
  }
  if (label === null) return { ok: false, error: usage };
  const minutes = minutesText === null ? DEFAULT_WINDOW_MINUTES : Number(minutesText);
  if (
    (minutesText !== null && !/^\d+$/.test(minutesText)) ||
    minutes < bounds.min ||
    minutes > bounds.max
  ) {
    return {
      ok: false,
      error: `A push-install window is open ${bounds.min} to ${bounds.max} minutes (whole minutes)`,
    };
  }
  return { ok: true, label, minutes, policyId };
}

/**
 * Each machine agent's push-install window, as `status` lists it: open
 * until a time under a policy, or closed. Revoked agents and plugin-agent
 * certificates have none. Pure, exported for tests.
 *
 * @param {Array<Record<string, unknown>>} agents  GET /api/certs/agent
 * @param {number} now
 */
export function agentWindows(agents, now) {
  return agents
    .filter(
      (a) => !a.revoked && typeof a.label === 'string' && !a.label.startsWith('plugin-agent:'),
    )
    .map((a) => {
      const until =
        typeof a.pushInstallEnabledUntil === 'string' ? a.pushInstallEnabledUntil : null;
      const open = until !== null && Date.parse(until) > now;
      return {
        label: a.label,
        open,
        until: open ? until : null,
        policy: open ? (a.pushInstallPolicy ?? null) : null,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * @param {string[]} args  Subcommand args: [] | ['status'] | ['on'] | ['open', '<agent>', …] | …
 * @param {{ json: boolean }} options
 */
export async function runPushInstall(args, { json }) {
  const sub = args[0] ?? 'status';
  switch (sub) {
    case 'status':
      return statusCmd({ json });
    case 'on':
    case 'off':
      return switchCmd(sub === 'on', { json });
    case 'default-policy':
      return defaultPolicyCmd(args[1], { json });
    case 'open':
      return openCmd(args.slice(1), { json });
    case 'close':
      return closeCmd(args[1], { json });
    default:
      printUsage();
      process.exit(1);
  }
}

function printUsage() {
  const b = chalk.bold;
  const c = chalk.cyan;
  console.log(`
${b('Usage:')} lamaste-server push-install <subcommand>

${b('Subcommands:')}
  ${c('status')}               The switch, default policy, policies and every agent's window
  ${c('on')} | ${c('off')}             Turn push install on or off for this relay
  ${c('default-policy <id>')}  The policy a window gets when none is named
  ${c('open <agent> [--minutes <n>] [--policy <id>]')}
                       Open an agent's window (default ${DEFAULT_WINDOW_MINUTES} minutes)
  ${c('close <agent>')}        Close an agent's window
`);
}

/**
 * Exit with a usage or panel error, as text or NDJSON.
 *
 * @param {string} message
 * @param {boolean} json
 * @returns {never}
 */
function fail(message, json) {
  if (json) emitError(message);
  else console.error(`\n  ${chalk.red(message)}\n`);
  process.exit(1);
}

/** The panel's push-install config, or exit with its error. */
async function readConfig(json) {
  try {
    return await panelRequest('GET', '/api/plugins/push-install/config');
  } catch (err) {
    fail(err.message, json);
  }
}

/**
 * @param {{ json: boolean }} options
 */
async function statusCmd({ json }) {
  const config = await readConfig(json);
  let agents;
  try {
    ({ agents = [] } = await panelRequest('GET', '/api/certs/agent'));
  } catch (err) {
    fail(err.message, json);
  }
  const windows = agentWindows(agents, Date.now());
  if (json) {
    emit({
      enabled: config.enabled,
      defaultPolicy: config.defaultPolicy,
      windowMinutes: config.windowMinutes,
      policies: config.policies,
      agents: windows,
    });
    return;
  }

  const b = chalk.bold;
  const c = chalk.cyan;
  const d = chalk.dim;
  console.log('');
  console.log(b('  Push install'));
  console.log(d('  ' + '─'.repeat(40)));
  console.log(
    `  switch:          ${config.enabled ? chalk.green('on') : chalk.red('off')}${config.enabled ? '' : d(' — every push is refused')}`,
  );
  console.log(`  default policy:  ${c(config.defaultPolicy)}`);
  console.log(
    `  window:          ${config.windowMinutes.min} to ${config.windowMinutes.max} minutes`,
  );

  console.log(b('\n  Policies'));
  for (const p of config.policies) {
    const all = d('(any)');
    console.log(`  ${c(p.id)}  ${p.name}${p.id === config.defaultPolicy ? d('  (default)') : ''}`);
    console.log(`    actions:   ${p.allowedActions?.length ? p.allowedActions.join(', ') : all}`);
    console.log(`    packages:  ${p.allowedPlugins?.length ? p.allowedPlugins.join(', ') : all}`);
    console.log(`    from:      ${p.allowedIps?.length ? p.allowedIps.join(', ') : all}`);
    if (p.deniedIps?.length) console.log(`    not from:  ${p.deniedIps.join(', ')}`);
  }

  console.log(b('\n  Agent windows'));
  if (windows.length === 0) console.log(d('  No enrolled machine agent.'));
  const width = Math.max(5, ...windows.map((w) => w.label.length));
  for (const w of windows) {
    console.log(
      `  ${c(w.label.padEnd(width))}  ${w.open ? chalk.green(`open until ${w.until}`) + d(` (policy ${w.policy})`) : d('closed')}`,
    );
  }
  console.log('');
}

/**
 * @param {boolean} enabled
 * @param {{ json: boolean }} options
 */
async function switchCmd(enabled, { json }) {
  let config;
  try {
    config = await panelRequest('PATCH', '/api/plugins/push-install/config', { enabled });
  } catch (err) {
    fail(err.message, json);
  }
  if (json) {
    emitComplete({ enabled: config.enabled });
    return;
  }
  console.log(
    `\n  Push install is ${config.enabled ? chalk.green('on') : chalk.red('off')}${
      config.enabled
        ? ` — open an agent's window with ${chalk.cyan('lamaste-server push-install open <agent>')}`
        : ': every push is refused (open windows stay recorded but let nothing through)'
    }.\n`,
  );
}

/**
 * @param {string | undefined} policyId
 * @param {{ json: boolean }} options
 */
async function defaultPolicyCmd(policyId, { json }) {
  if (!policyId) fail('Usage: lamaste-server push-install default-policy <id>', json);
  let config;
  try {
    config = await panelRequest('PATCH', '/api/plugins/push-install/config', {
      defaultPolicy: policyId,
    });
  } catch (err) {
    fail(err.message, json);
  }
  if (json) emitComplete({ defaultPolicy: config.defaultPolicy });
  else console.log(`\n  Default push-install policy: ${chalk.cyan(config.defaultPolicy)}\n`);
}

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
async function openCmd(args, { json }) {
  const config = await readConfig(json);
  const parsed = parseOpenArgs(args, config.windowMinutes);
  if (!parsed.ok) fail(parsed.error, json);
  if (!config.enabled) {
    fail(
      'Push install is off for this relay — turn it on first: lamaste-server push-install on',
      json,
    );
  }
  let result;
  try {
    result = await panelRequest(
      'POST',
      `/api/plugins/push-install/enable/${encodeURIComponent(parsed.label)}`,
      {
        durationMinutes: parsed.minutes,
        ...(parsed.policyId ? { policyId: parsed.policyId } : {}),
      },
    );
  } catch (err) {
    fail(err.message, json);
  }
  if (json) {
    emitComplete({
      label: result.label,
      pushInstallEnabledUntil: result.pushInstallEnabledUntil,
      pushInstallPolicy: result.pushInstallPolicy,
    });
    return;
  }
  console.log(
    `\n  Push install open for ${chalk.cyan(result.label)} until ${result.pushInstallEnabledUntil} (policy ${chalk.cyan(result.pushInstallPolicy)}).\n`,
  );
}

/**
 * @param {string | undefined} label
 * @param {{ json: boolean }} options
 */
async function closeCmd(label, { json }) {
  if (!label) fail('Usage: lamaste-server push-install close <agent>', json);
  try {
    await panelRequest('DELETE', `/api/plugins/push-install/enable/${encodeURIComponent(label)}`);
  } catch (err) {
    fail(err.message, json);
  }
  if (json) emitComplete({ label, closed: true });
  else console.log(`\n  Push install closed for ${chalk.cyan(label)}.\n`);
}
