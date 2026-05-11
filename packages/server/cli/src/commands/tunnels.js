/**
 * lamaste-server tunnels — Manage server tunnels.
 *
 * Subcommands:
 *   list                              List active tunnels
 *   create --subdomain <s> --port <p> Create a tunnel
 *   delete <id>                       Delete a tunnel by ID
 *   toggle <id> --enable|--disable    Enable or disable a tunnel
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
  ${c('list')}                                        List active tunnels
  ${c('create')} --subdomain <s> --port <p> [opts]    Create a tunnel
  ${c('delete')} <id>                                 Delete a tunnel by ID
  ${c('toggle')} <id> --enable|--disable              Enable or disable a tunnel

${b('Create options:')}
  --subdomain <name>    Tunnel subdomain (required)
  --port <number>       Local port to tunnel (required)
  --description <text>  Optional description
  --access-mode <mode>  Access mode: public, authenticated, restricted (default: restricted)
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
    console.log(
      `  ${c(t.subdomain)} \u2192 :${t.port}  ${enabled} ${accessMode} ${type}`.trimEnd(),
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

  if (!subdomain || !portStr) {
    const msg = 'Error: --subdomain and --port are required';
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

  /** @type {Record<string, unknown>} */
  const body = { subdomain, port };
  if (description) body.description = description;
  if (accessMode) body.accessMode = accessMode;

  if (!json) process.stderr.write(`  Creating tunnel ${chalk.cyan(subdomain)} \u2192 :${port}...`);

  try {
    const result = await panelRequest('POST', '/api/tunnels', body);

    if (json) {
      emitComplete({ tunnel: result });
    } else {
      console.log(` ${chalk.green('ok')}`);
      console.log(`  FQDN: ${chalk.cyan(String(result.fqdn || `${subdomain}.?`))}`);
      console.log(`  ID:   ${chalk.dim(String(result.id || 'unknown'))}`);
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
    const result = await panelRequest('PATCH', `/api/tunnels/${id}`, { enabled });
    if (json) {
      emitComplete({ id, enabled, tunnel: result });
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
 * @param {string} name
 * @returns {string | null}
 */
function getArg(args, name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}
