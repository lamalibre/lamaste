/**
 * lamaste-server tunnels — Manage server tunnels.
 *
 * Subcommands:
 *   list                                          List active tunnels
 *   create --subdomain <s> --port <p> --agent <l> Create a tunnel carried by an agent
 *   delete <id>                                   Delete a tunnel by ID
 *   toggle <id> --enable|--disable                Enable or disable a tunnel
 *   assign <id> --agent <label>                   Move a tunnel to another agent
 *   configure <id> [--access-mode <m>] [--max-body-mb <n>]
 *                                                 Change access mode / body limit
 *
 * List reads directly from the state file.
 * Create/delete/toggle use the panel REST API (which has the full
 * nginx/certbot/chisel dependency stack).
 */

import chalk from 'chalk';
import { readTunnels } from '../state.js';
import { panelRequest } from '../panel-api.js';
import { emit, emitError, emitComplete } from '../ndjson.js';

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
export async function runTunnels(args, { json }) {
  const sub = args[0];

  switch (sub) {
    case 'list':
      return listTunnels({ json });
    case 'create':
      return createTunnel(args.slice(1), { json });
    case 'delete':
      return deleteTunnel(args[1], { json });
    case 'toggle':
      return toggleTunnel(args.slice(1), { json });
    case 'assign':
      return assignTunnel(args.slice(1), { json });
    case 'configure':
      return configureTunnel(args.slice(1), { json });
    default:
      printTunnelUsage();
      process.exit(sub ? 1 : 0);
  }
}

function printTunnelUsage() {
  const b = chalk.bold;
  const c = chalk.cyan;
  console.log(`
${b('Usage:')} lamaste-server tunnels <subcommand>

${b('Subcommands:')}
  ${c('list')}                                                List active tunnels
  ${c('create')} --subdomain <s> --port <p> --agent <l> [opts] Create a tunnel
  ${c('delete')} <id>                                         Delete a tunnel by ID
  ${c('toggle')} <id> --enable|--disable                      Enable or disable a tunnel
  ${c('assign')} <id> --agent <label>                         Move a tunnel to another agent
  ${c('configure')} <id> [--access-mode <m>] [--max-body-mb <n>] Change access mode / body limit

${b('Create options:')}
  --subdomain <name>    Tunnel subdomain (required)
  --port <number>       Local port to tunnel (required)
  --agent <label>       Agent that carries the tunnel (required)
  --description <text>  Optional description
  --access-mode <mode>  Access mode: public, authenticated, restricted (default: restricted)
  --max-body-mb <n>     Largest request body in MiB, 1-10240 (default: 10)
`);
}

/**
 * @param {{ json: boolean }} options
 */
async function listTunnels({ json }) {
  const tunnels = await readTunnels();

  if (json) {
    emit({ tunnels });
    return;
  }

  if (tunnels.length === 0) {
    console.log('\n  No tunnels configured.\n');
    return;
  }

  const b = chalk.bold;
  const c = chalk.cyan;
  const g = chalk.green;
  const r = chalk.red;
  const d = chalk.dim;

  console.log('');
  console.log(b('  Tunnels'));
  console.log(d('  ' + '\u2500'.repeat(50)));

  for (const t of tunnels) {
    const enabled = t.enabled !== false ? g('enabled') : r('disabled');
    const accessMode = t.accessMode ? d(`[${t.accessMode}]`) : '';
    const type = t.type !== 'app' ? d(`(${t.type})`) : '';
    const carrier = t.agentLabel ? d(`via ${t.agentLabel}`) : r('no agent');
    const bodyLimit = t.type !== 'panel' ? d(`${t.maxBodySizeMb ?? 1} MiB`) : '';
    console.log(
      `  ${c(t.subdomain)} \u2192 :${t.port}  ${enabled} ${carrier} ${accessMode} ${bodyLimit} ${type}`.trimEnd(),
    );
    if (t.description) {
      console.log(`    ${d(t.description)}`);
    }
    console.log(`    ${d(`id: ${t.id}  fqdn: ${t.fqdn}`)}`);
  }
  console.log('');
}

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
async function createTunnel(args, { json }) {
  const subdomain = getArg(args, 'subdomain');
  const portStr = getArg(args, 'port');
  const description = getArg(args, 'description') || undefined;
  const accessMode = getArg(args, 'access-mode') || undefined;
  const agentLabel = getArg(args, 'agent');
  const maxBodyStr = getArg(args, 'max-body-mb');

  if (!subdomain || !portStr || !agentLabel) {
    const msg = 'Error: --subdomain, --port and --agent are required';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }

  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    const msg = 'Error: --port must be a valid port number (1-65535)';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }

  if (accessMode && !['public', 'authenticated', 'restricted'].includes(accessMode)) {
    const msg = 'Error: --access-mode must be public, authenticated, or restricted';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }

  const maxBodySizeMb = maxBodyStr === null ? undefined : parseMaxBody(maxBodyStr, json);

  /** @type {Record<string, unknown>} */
  const body = { subdomain, port, agentLabel };
  if (description) body.description = description;
  if (accessMode) body.accessMode = accessMode;
  if (maxBodySizeMb !== undefined) body.maxBodySizeMb = maxBodySizeMb;

  if (!json) process.stderr.write(`  Creating tunnel ${chalk.cyan(subdomain)} \u2192 :${port}...`);

  try {
    const { tunnel } = await panelRequest('POST', '/api/tunnels', body);

    if (json) {
      emitComplete({ tunnel });
    } else {
      console.log(` ${chalk.green('ok')}`);
      console.log(`  FQDN:  ${chalk.cyan(tunnel.fqdn)}`);
      console.log(`  ID:    ${chalk.dim(tunnel.id)}`);
      console.log(`  Agent: ${tunnel.agentLabel}`);
      console.log(chalk.dim(`  ${tunnel.agentLabel} starts carrying it within 30 seconds.`));
      console.log('');
    }
  } catch (err) {
    if (json) emitError(err.message);
    else {
      console.log(` ${chalk.red('failed')}`);
      console.error(`  ${chalk.red(err.message)}\n`);
    }
    process.exit(1);
  }
}

/**
 * @param {string | undefined} id
 * @param {{ json: boolean }} options
 */
async function deleteTunnel(id, { json }) {
  if (!id) {
    const msg = 'Usage: lamaste-server tunnels delete <id>';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }

  if (!json) process.stderr.write(`  Deleting tunnel ${chalk.dim(id)}...`);

  try {
    await panelRequest('DELETE', `/api/tunnels/${id}`);
    if (json) {
      emitComplete({ id, deleted: true });
    } else {
      console.log(` ${chalk.green('ok')}\n`);
    }
  } catch (err) {
    if (json) emitError(err.message);
    else {
      console.log(` ${chalk.red('failed')}`);
      console.error(`  ${chalk.red(err.message)}\n`);
    }
    process.exit(1);
  }
}

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
async function toggleTunnel(args, { json }) {
  const id = args[0];
  const enable = args.includes('--enable');
  const disable = args.includes('--disable');

  if (!id || (!enable && !disable)) {
    const msg = 'Usage: lamaste-server tunnels toggle <id> --enable|--disable';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }

  const enabled = enable;

  if (!json) {
    const action = enabled ? 'Enabling' : 'Disabling';
    process.stderr.write(`  ${action} tunnel ${chalk.dim(id)}...`);
  }

  try {
    const { tunnel } = await panelRequest('PATCH', `/api/tunnels/${id}`, { enabled });
    if (json) {
      emitComplete({ id, enabled, tunnel });
    } else {
      console.log(` ${chalk.green('ok')}\n`);
    }
  } catch (err) {
    if (json) emitError(err.message);
    else {
      console.log(` ${chalk.red('failed')}`);
      console.error(`  ${chalk.red(err.message)}\n`);
    }
    process.exit(1);
  }
}

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
async function assignTunnel(args, { json }) {
  const id = args[0];
  const agentLabel = getArg(args, 'agent');

  if (!id || !agentLabel) {
    const msg = 'Usage: lamaste-server tunnels assign <id> --agent <label>';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }

  if (!json) process.stderr.write(`  Assigning tunnel ${chalk.dim(id)} to ${agentLabel}...`);

  try {
    const { tunnel } = await panelRequest('PATCH', `/api/tunnels/${id}`, { agentLabel });
    if (json) {
      emitComplete({ id, tunnel });
    } else {
      console.log(` ${chalk.green('ok')}`);
      console.log(
        chalk.dim(`  ${agentLabel} and the previous agent pick up the change within 30 seconds.\n`),
      );
    }
  } catch (err) {
    if (json) emitError(err.message);
    else {
      console.log(` ${chalk.red('failed')}`);
      console.error(`  ${chalk.red(err.message)}\n`);
    }
    process.exit(1);
  }
}

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
async function configureTunnel(args, { json }) {
  const id = args[0];
  const accessMode = getArg(args, 'access-mode');
  const maxBodyStr = getArg(args, 'max-body-mb');

  if (!id || (accessMode === null && maxBodyStr === null)) {
    const msg =
      'Usage: lamaste-server tunnels configure <id> [--access-mode <mode>] [--max-body-mb <n>]';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }
  if (accessMode !== null && !['public', 'authenticated', 'restricted'].includes(accessMode)) {
    const msg = 'Error: --access-mode must be public, authenticated, or restricted';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }

  /** @type {Record<string, unknown>} */
  const body = {};
  if (accessMode !== null) body.accessMode = accessMode;
  if (maxBodyStr !== null) body.maxBodySizeMb = parseMaxBody(maxBodyStr, json);

  if (!json) process.stderr.write(`  Reconfiguring tunnel ${chalk.dim(id)}...`);

  try {
    const { tunnel } = await panelRequest('PATCH', `/api/tunnels/${id}`, body);
    if (json) {
      emitComplete({ id, tunnel });
    } else {
      console.log(` ${chalk.green('ok')}`);
      console.log(`  Access:     ${tunnel.accessMode}`);
      console.log(`  Body limit: ${tunnel.maxBodySizeMb} MiB\n`);
    }
  } catch (err) {
    if (json) emitError(err.message);
    else {
      console.log(` ${chalk.red('failed')}`);
      console.error(`  ${chalk.red(err.message)}\n`);
    }
    process.exit(1);
  }
}

/**
 * @param {string} value
 * @param {boolean} json
 * @returns {number}
 */
function parseMaxBody(value, json) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 10240) {
    const msg = 'Error: --max-body-mb must be an integer from 1 to 10240';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }
  return n;
}

/**
 * @param {string[]} args
 * @param {string} name
 * @returns {string | null}
 */
function getArg(args, name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}
