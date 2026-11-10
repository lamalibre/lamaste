/**
 * lamaste-server peers — calls and events between app plugins: the shelves
 * applied to this relay, their edges and the consumers' peer channels.
 *
 * Subcommands:
 *   list                         Every applied shelf and its edges (effective, or
 *                                pending with the reason), the peer channels and
 *                                which agent halves answered the peers protocol
 *                                (the default subcommand)
 *   apply <shelfId> --file <f>   Apply a shelf's scope graph: the shelf manifest's
 *                                `scopes` block (or the whole manifest), replacing
 *                                that shelf's edges
 *   remove <shelfId>             Remove a shelf's edges
 *
 * Every subcommand goes through the running panel (`/api/peers*`, admin
 * certificate), which checks every edge against the installed plugins'
 * `peers` declarations.
 */

import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import { panelRequest } from '../panel-api.js';
import { emit, emitComplete, emitError } from '../ndjson.js';

/** A shelf id: a DNS label. */
const SHELF_ID_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The arguments of `apply <shelfId> --file <path>`. Pure, exported for tests.
 *
 * @param {string[]} args
 * @returns {{ ok: true, shelfId: string, file: string } | { ok: false, error: string }}
 */
export function parseApplyArgs(args) {
  const usage = 'Usage: lamaste-server peers apply <shelfId> --file <scopes.json>';
  let shelfId = null;
  let file = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--file') {
      file = args[i + 1] ?? null;
      i += 1;
    } else if (shelfId === null && !args[i].startsWith('--')) {
      shelfId = args[i];
    } else {
      return { ok: false, error: usage };
    }
  }
  if (!shelfId || !file) return { ok: false, error: usage };
  if (!SHELF_ID_RE.test(shelfId)) {
    return {
      ok: false,
      error: 'A shelf id is a DNS label: lower-case letters, digits and hyphens',
    };
  }
  return { ok: true, shelfId, file };
}

/**
 * A shelf's scope graph from a file's text: the shelf manifest's `scopes`
 * block, or a whole shelf manifest holding one. Pure, exported for tests.
 *
 * @param {string} text
 * @returns {{ ok: true, scopes: object } | { ok: false, error: string }}
 */
export function scopesFromText(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not JSON' };
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && value.scopes) {
    value = value.scopes;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      error: 'Expected a scopes block: { "<scope>": { "provider": "...", "consumers": [...] } }',
    };
  }
  return { ok: true, scopes: value };
}

/**
 * The lines `list` prints for one applied shelf. Pure, exported for tests.
 *
 * @param {{ shelfId: string, appliedAt: string, appliedBy?: string, edges: Array<{ consumer: string, scope: string, provider: string, state: string, reason?: string }> }} shelf
 * @returns {string[]}
 */
export function shelfLines(shelf) {
  const lines = [
    `${shelf.shelfId}  applied ${shelf.appliedAt}${shelf.appliedBy ? ` by ${shelf.appliedBy}` : ''}`,
  ];
  if (shelf.edges.length === 0) lines.push('    (no edges)');
  for (const edge of shelf.edges) {
    const state = edge.state === 'effective' ? 'effective' : `pending: ${edge.reason ?? '?'}`;
    lines.push(`    ${edge.consumer} → ${edge.scope} (${edge.provider})  ${state}`);
  }
  return lines;
}

/**
 * @param {string[]} args  [] | ['list'] | ['apply', '<shelfId>', '--file', '<f>'] | ['remove', '<shelfId>']
 * @param {{ json: boolean }} options
 */
export async function runPeers(args, { json }) {
  const sub = args[0] ?? 'list';
  switch (sub) {
    case 'list':
      return listCmd({ json });
    case 'apply':
      return applyCmd(args.slice(1), { json });
    case 'remove':
      return removeCmd(args[1], { json });
    default:
      printUsage();
      process.exit(1);
  }
}

function printUsage() {
  const b = chalk.bold;
  const c = chalk.cyan;
  console.log(`
${b('Usage:')} lamaste-server peers <subcommand>

${b('Subcommands:')}
  ${c('list')}                       Applied shelves and their edges, peer channels, readiness
  ${c('apply <shelfId> --file <f>')} Apply a shelf's scope graph (its manifest's "scopes" block)
  ${c('remove <shelfId>')}           Remove a shelf's edges
`);
}

/**
 * @param {string} message
 * @param {boolean} json
 * @param {{ code?: string }} [extra]
 * @returns {never}
 */
function fail(message, json, extra = {}) {
  if (json) emitError(message, false, extra.code ? { code: extra.code } : {});
  else console.error(`\n  ${chalk.red(message)}\n`);
  process.exit(1);
}

async function listCmd({ json }) {
  let view;
  try {
    view = await panelRequest('GET', '/api/peers');
  } catch (err) {
    fail(err.message, json, err);
  }
  if (json) {
    emit({ event: 'peers', ...view });
    return;
  }
  const d = chalk.dim;
  console.log('');
  if (view.shelves.length === 0)
    console.log(d('  No shelf is applied: no plugin may call another.'));
  for (const shelf of view.shelves) {
    const [head, ...rest] = shelfLines(shelf);
    console.log(`  ${chalk.cyan(head)}`);
    for (const line of rest) console.log(`  ${line}`);
  }
  const channels = Object.entries(view.channels ?? {});
  if (channels.length > 0) {
    console.log(`\n  ${chalk.bold('Peer channels')}`);
    for (const [consumer, channel] of channels) {
      console.log(
        `    ${consumer}  ${channel.state}${channel.lastError ? d(` — ${channel.lastError}`) : ''}`,
      );
    }
  }
  const ready = Object.entries(view.readiness ?? {});
  if (ready.length > 0) {
    console.log(`\n  ${chalk.bold('Ready agent halves')}`);
    for (const [route, answer] of ready) console.log(`    ${route}  ${answer.version}`);
  }
  console.log('');
}

async function applyCmd(args, { json }) {
  const parsed = parseApplyArgs(args);
  if (!parsed.ok) fail(parsed.error, json);
  let text;
  try {
    text = await readFile(parsed.file, 'utf-8');
  } catch (err) {
    fail(`Cannot read ${parsed.file}: ${err.code ?? err.message}`, json);
  }
  const scopes = scopesFromText(text);
  if (!scopes.ok) fail(scopes.error, json);
  let result;
  try {
    result = await panelRequest('PUT', `/api/peers/shelves/${encodeURIComponent(parsed.shelfId)}`, {
      scopes: scopes.scopes,
    });
  } catch (err) {
    fail(err.message, json, err);
  }
  if (json) {
    emitComplete(result);
    return;
  }
  console.log(`\n  Shelf ${chalk.cyan(parsed.shelfId)} applied.`);
  if (result?.shelf) for (const line of shelfLines(result.shelf).slice(1)) console.log(`  ${line}`);
  console.log('');
}

async function removeCmd(shelfId, { json }) {
  if (!shelfId) fail('Usage: lamaste-server peers remove <shelfId>', json);
  if (!SHELF_ID_RE.test(shelfId)) fail('A shelf id is a DNS label', json);
  let result;
  try {
    result = await panelRequest('DELETE', `/api/peers/shelves/${encodeURIComponent(shelfId)}`);
  } catch (err) {
    fail(err.message, json, err);
  }
  if (json) {
    emitComplete(result);
    return;
  }
  console.log(`\n  Shelf ${chalk.cyan(shelfId)} removed — its edges no longer grant anything.\n`);
}
