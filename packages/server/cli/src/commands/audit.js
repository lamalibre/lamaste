/**
 * lamaste-server audit — the panel's audit log: hook approvals, auto-approve
 * changes, hostings, plugin installs, updates and uninstalls, and what
 * plugins' lifecycle hooks report through the `audit` effect. Read from the
 * running panel (`GET /api/audit`, admin certificate).
 *
 *   lamaste-server audit [--plugin <name>] [--action <action|prefix.>] [--limit <n>]
 */

import chalk from 'chalk';
import { panelRequest } from '../panel-api.js';
import { emit, emitError } from '../ndjson.js';

function flag(args, name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
export async function runAudit(args, { json }) {
  const params = new URLSearchParams();
  const plugin = flag(args, '--plugin');
  const action = flag(args, '--action');
  const limit = flag(args, '--limit');
  if (plugin) params.set('plugin', plugin);
  if (action) params.set('action', action);
  if (limit) params.set('limit', limit);
  const query = params.toString();

  let result;
  try {
    result = await panelRequest('GET', `/api/audit${query ? `?${query}` : ''}`);
  } catch (err) {
    if (json) emitError(err.message);
    else console.error(`\n  ${chalk.red(err.message)}\n`);
    process.exit(1);
  }
  if (json) {
    emit(result);
    return;
  }
  const entries = result.entries ?? [];
  if (entries.length === 0) {
    console.log('\n  No audit entries.\n');
    return;
  }
  console.log('');
  for (const e of entries) {
    const details = Object.entries(e.details ?? {})
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ');
    console.log(
      `  ${chalk.dim(e.at)}  ${chalk.cyan(e.action)}  ${e.actor}${e.plugin ? ` ${chalk.bold(e.plugin)}` : ''}${details ? chalk.dim(`  ${details}`) : ''}`,
    );
  }
  console.log('');
}
