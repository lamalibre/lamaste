/**
 * lamaste-server plugins web-surface — the web surface of an agent-hosted
 * plugin that declares one (its manifest's `userSurface.web`): the site it
 * owns, where the relay serves the static shell its server package ships
 * beside its user surface's API.
 *
 *   web-surface <name>    What its installed version declares, its site,
 *                         whether the site serves (and why not), the trees
 *                         the relay holds, the tunnel still bound as its user
 *                         surface, and — while it owns no site — the offer
 *   web-surface <name> create [--subdomain <label>] [--access-mode authenticated|restricted]
 *                         Give it its site (default: the subdomain and access
 *                         mode it declares)
 *   web-surface <name> move --tunnel <id | subdomain | fqdn>
 *                         Hand the host of the tunnel bound as its user
 *                         surface to its site, in one reload; the tunnel
 *                         stays, disabled and unbound
 *   web-surface <name> delete [--yes]
 *                         Delete its site, its trees and the grants on it,
 *                         after typing the site's FQDN (--yes skips it)
 *
 * The plugin is named by its name or its route (as `sites list` shows a
 * site's owner). Every action goes through the running panel
 * (`/api/plugins/:name/web-surface[/move]`, admin certificate). What the
 * panel says is printed only as `terminalText`; `--json` emits it as it
 * came.
 */

import chalk from 'chalk';
import * as prompts from '@clack/prompts';
import { panelRequest } from '../panel-api.js';
import { readTunnels } from '../state.js';
import { emit, emitComplete, emitError } from '../ndjson.js';
import { findHostTunnel, findPluginByNameOrRoute } from '../plugin-identity.js';
import { terminalText } from '../plugin-settings.js';
import {
  createBody,
  parseWebSurfaceArgs,
  webSurfaceRefusalHint,
  webSurfaceServedText,
  webTreeRows,
} from '../plugin-web-surface.js';

/** `/api/plugins/<name>/web-surface[/<rest>]`. */
function webSurfacePath(name, rest = '') {
  return `/api/plugins/${encodeURIComponent(name)}/web-surface${rest ? `/${rest}` : ''}`;
}

/**
 * Exit with a usage error or a refused request, as text (with what the
 * refusal asks next) or NDJSON (with the refusal's `code`).
 *
 * @param {string} message
 * @param {boolean} json
 * @param {{ code?: string }} [err]
 * @param {string} [name]  the plugin, for the hint
 * @returns {never}
 */
function fail(message, json, err = {}, name = '<name>') {
  const code = typeof err.code === 'string' ? err.code : null;
  if (json) {
    emitError(message, false, code ? { code } : {});
  } else {
    console.error(`\n  ${chalk.red(terminalText(message))}`);
    const hint = webSurfaceRefusalHint(code, name);
    if (hint) console.error(`  ${chalk.dim(hint)}`);
    console.error('');
  }
  process.exit(1);
}

/**
 * A panel request; a refusal exits through `fail`, with what it asks next
 * of plugin `name`.
 */
async function request(json, name, method, path, body) {
  try {
    return await panelRequest(method, path, body);
  } catch (err) {
    fail(err.message, json, err, name);
  }
}

/** `label:` padded, then the value. */
function row(label, value) {
  console.log(`  ${chalk.dim(`${label}:`.padEnd(16))}${value}`);
}

/**
 * Print a web surface's status (`webSurface`) for plugin `name`: what it
 * declares, its site, whether it is served, its trees, the bound tunnel and
 * the offer.
 */
function printWebSurface(name, view) {
  const plugin = terminalText(name);
  console.log('');
  if (!view.declared && !view.site) {
    console.log(`  Plugin ${chalk.cyan(plugin)} declares no web surface and owns no site.`);
    console.log('');
    return;
  }
  console.log(chalk.bold(`  Web surface of ${plugin}`));
  console.log(chalk.dim('  ' + '─'.repeat(40)));
  row(
    'declares',
    view.declared
      ? terminalText(
          `${view.declared.defaultSubdomain} (${view.declared.accessMode}), the shell from ${view.declared.root}/`,
        )
      : chalk.yellow('nothing — its installed version declares no web surface'),
  );
  row(
    'site',
    view.site
      ? `${chalk.cyan(`https://${terminalText(view.site.fqdn)}/`)}${chalk.dim(` ${terminalText(view.site.accessMode ?? 'access mode unknown')} · id ${terminalText(view.site.id)}`)}`
      : chalk.dim('none'),
  );
  const served = webSurfaceServedText(view, name);
  row('served', served.served ? chalk.green(served.text) : chalk.yellow(served.text));
  for (const [label, value] of webTreeRows(view.tree)) row(label, value);
  if (view.boundTunnel) {
    const host = terminalText(view.boundTunnel.fqdn ?? view.boundTunnel.id);
    const others = (view.boundTunnel.routes ?? []).length > 1;
    row(
      'bound tunnel',
      `${chalk.cyan(host)}${chalk.dim(` id ${terminalText(view.boundTunnel.id)}${others ? ` · also serves ${terminalText(view.boundTunnel.routes.join(', '))}` : ''}`)}`,
    );
  }
  if (view.offer) {
    const offer = `${terminalText(view.offer.subdomain)} (${terminalText(view.offer.accessMode)})`;
    row(
      'offer',
      view.offer.available
        ? `${offer} ${chalk.green('— free')}`
        : `${offer} ${chalk.yellow('— taken; create with --subdomain <label>')}`,
    );
  }
  if (!view.site && view.declared) {
    console.log('');
    if (view.boundTunnel) {
      console.log(
        chalk.dim(
          `  Move the bound tunnel's host to it: lamaste-server plugins web-surface ${plugin} move --tunnel ${terminalText(view.boundTunnel.fqdn ?? view.boundTunnel.id)}`,
        ),
      );
    } else {
      console.log(
        chalk.dim(
          `  Give it its site: lamaste-server plugins web-surface ${plugin} create [--subdomain <label>] [--access-mode authenticated|restricted]`,
        ),
      );
    }
  }
  console.log('');
}

/**
 * Ask for the site's FQDN before deleting it — or refuse where nobody can
 * answer (no terminal, `--json`) without `--yes`.
 *
 * @param {string} name
 * @param {{ fqdn: string }} site
 * @param {{ yes: boolean, json: boolean }} options
 */
async function confirmDelete(name, site, { yes, json }) {
  if (yes) return;
  if (json || !process.stdin.isTTY || !process.stdout.isTTY) {
    fail(
      `Deleting the web surface of "${name}" (${site.fqdn}) asks for confirmation — pass --yes`,
      json,
    );
  }
  const fqdn = terminalText(site.fqdn);
  console.log('');
  console.log(chalk.bold.red(`  Delete the web surface of ${terminalText(name)}?`));
  console.log(`    - ${chalk.cyan(fqdn)} stops answering: its vhost is removed`);
  console.log('    - the web trees the relay holds for it are deleted');
  console.log('    - the grants on the site are revoked (a restricted site loses its users)');
  console.log('    - the plugin stays installed and hosted; create the site again at any time');
  console.log('');
  const answer = await prompts.text({ message: `Type ${fqdn} to delete it` });
  if (prompts.isCancel(answer) || String(answer ?? '').trim() !== site.fqdn) {
    console.log('\n  Aborted — nothing was deleted.\n');
    process.exit(0);
  }
}

/**
 * `plugins web-surface <name> [create|move|delete]`.
 *
 * @param {string[]} args  what follows the subcommand
 * @param {{ json: boolean }} options
 */
export async function webSurfaceCmd(args, { json }) {
  const parsed = parseWebSurfaceArgs(args);
  if (!parsed.ok) fail(parsed.error, json);

  const { plugins = [] } = await request(json, parsed.name, 'GET', '/api/plugins');
  const named = findPluginByNameOrRoute(plugins, parsed.name);
  if (named.error) fail(named.error, json, { code: 'not_found' }, parsed.name);
  const { name } = named.plugin;
  const plugin = terminalText(name);

  if (parsed.action === 'status') {
    const result = await request(json, name, 'GET', webSurfacePath(name));
    if (json) emit(result);
    else printWebSurface(name, result.webSurface);
    return;
  }

  if (parsed.action === 'create') {
    const result = await request(json, name, 'POST', webSurfacePath(name), createBody(parsed));
    if (json) {
      emitComplete({ name, ...result });
      return;
    }
    const fqdn = terminalText(result.webSurface?.site?.fqdn ?? '');
    console.log(
      `\n  ${chalk.green('✓')} ${plugin} has its site: ${chalk.cyan(`https://${fqdn}/`)}`,
    );
    printWebSurface(name, result.webSurface);
    return;
  }

  if (parsed.action === 'move') {
    const found = findHostTunnel(await readTunnels(), parsed.tunnel);
    if (found.error) fail(found.error, json);
    const { tunnel } = found;
    const result = await request(json, name, 'POST', webSurfacePath(name, 'move'), {
      tunnelId: tunnel.id,
    });
    if (json) {
      emitComplete({ name, tunnelId: tunnel.id, ...result });
      return;
    }
    const host = terminalText(tunnel.fqdn ?? tunnel.id);
    console.log(
      `\n  ${chalk.green('✓')} ${chalk.cyan(host)} is the web surface of ${plugin} now — the shell from its approved tree, the API as before`,
    );
    console.log(
      chalk.dim(
        `  The tunnel ${terminalText(tunnel.id)} stays, disabled and unbound, its vhost unlinked: delete the web surface, then enable the tunnel, to roll back by hand.`,
      ),
    );
    printWebSurface(name, result.webSurface);
    return;
  }

  // delete
  const current = await request(json, name, 'GET', webSurfacePath(name));
  const site = current.webSurface?.site ?? null;
  if (!site) fail(`Plugin "${name}" owns no site — there is no web surface to delete`, json);
  await confirmDelete(name, site, { yes: parsed.yes, json });
  const result = await request(json, name, 'DELETE', webSurfacePath(name));
  if (json) {
    emitComplete({ name, siteId: site.id, fqdn: site.fqdn, ...result });
    return;
  }
  console.log(
    `\n  ${chalk.green('✓')} The web surface of ${plugin} is deleted: ${chalk.cyan(terminalText(site.fqdn))} no longer answers\n`,
  );
  if (Array.isArray(result.grantsNotRevoked) && result.grantsNotRevoked.length > 0) {
    console.log(
      chalk.yellow(
        `  Gatekeeper kept ${result.grantsNotRevoked.length} grant(s) on the deleted site — they name a site that no longer exists; their ids are in the audit log\n`,
      ),
    );
  }
}
