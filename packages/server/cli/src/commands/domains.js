/**
 * lamaste-server domains — the relay's base domains and their members
 * (the multi-domain relay).
 *
 * Subcommands:
 *   list                              Domains with their state, member count and what uses them
 *   add <domain>                      Add a domain (pending until activated)
 *   verify-dns <domain>               Does auth.<domain> resolve to this relay?
 *   activate <domain>                 Issue auth.<domain>, serve its sign-in, admit its members
 *   remove <domain>                   Remove an unused, non-primary domain (its memberships end)
 *   members <domain>                  Its members
 *   members <domain> add <user>       Make a user (id or username) a member
 *   members <domain> remove <user>    End a membership
 *
 * Also `plugins domain <name> [<domain>]` ({@link pluginDomainCmd}).
 *
 * Every subcommand goes through the running panel (`/api/domains`, admin
 * certificate). What the panel says is printed only as `terminalText`;
 * `--json` emits it as it came.
 */

import chalk from 'chalk';
import { panelRequest } from '../panel-api.js';
import { emit, emitComplete, emitError } from '../ndjson.js';
import { terminalText } from '../plugin-settings.js';
import { domainRows, resolveUserId } from '../domains.js';

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
export async function runDomains(args, { json }) {
  const [sub, name, ...rest] = args;
  switch (sub) {
    case 'list':
      return listDomains({ json });
    case 'add':
    case 'verify-dns':
    case 'activate':
    case 'remove':
      if (!name) return usage(1);
      return domainCmd(sub, name.toLowerCase(), { json });
    case 'members':
      if (!name) return usage(1);
      return membersCmd(name.toLowerCase(), rest, { json });
    default:
      return usage(sub ? 1 : 0);
  }
}

function usage(code) {
  const b = chalk.bold;
  const c = chalk.cyan;
  console.log(`
${b('Usage:')} lamaste-server domains <subcommand>

${b('Subcommands:')}
  ${c('list')}                              Domains: state, members, what uses each
  ${c('add <domain>')}                      Add a domain (pending until activated)
  ${c('verify-dns <domain>')}               Does auth.<domain> point at this relay?
  ${c('activate <domain>')}                 Issue auth.<domain> and serve its sign-in
  ${c('remove <domain>')}                   Remove an unused, non-primary domain
  ${c('members <domain>')}                  Its members
  ${c('members <domain> add <user>')}       Make a user (directory id or username) a member
  ${c('members <domain> remove <user>')}    End a membership

  Every domain has its own sign-in (auth.<domain>) and member list; a user reaches a
  domain's protected hosts only as its member. The panel and tunnel. stay on the primary.
`);
  process.exit(code);
}

/**
 * Exit with a refused request, as text or NDJSON (with the refusal's `code`).
 *
 * @param {string} message
 * @param {boolean} json
 * @param {{ code?: string }} [err]
 * @returns {never}
 */
function fail(message, json, err = {}) {
  if (json) emitError(message, false, typeof err.code === 'string' ? { code: err.code } : {});
  else console.error(`\n  ${chalk.red(terminalText(message))}\n`);
  process.exit(1);
}

async function listDomains({ json }) {
  let domains;
  try {
    ({ domains } = await panelRequest('GET', '/api/domains'));
  } catch (err) {
    fail(err.message, json, err);
  }
  if (json) {
    emit({ domains });
    return;
  }
  const d = chalk.dim;
  console.log('');
  console.log(chalk.bold('  Domains'));
  console.log(d('  ' + '─'.repeat(50)));
  for (const row of domainRows(domains)) {
    const state = row.state === 'pending' ? chalk.yellow(row.state) : chalk.green(row.state);
    const used = row.usedBy ? d(`  used by ${row.usedBy}`) : '';
    console.log(`  ${chalk.cyan(row.name)}  ${state}  ${row.members} member(s)${used}`);
  }
  console.log('');
}

const DOMAIN_CALLS = {
  add: (name) => ['POST', '/api/domains', { name }],
  'verify-dns': (name) => ['POST', `/api/domains/${encodeURIComponent(name)}/verify-dns`, null],
  activate: (name) => ['POST', `/api/domains/${encodeURIComponent(name)}/activate`, null],
  remove: (name) => ['DELETE', `/api/domains/${encodeURIComponent(name)}`, null],
};

async function domainCmd(sub, name, { json }) {
  const [method, path, body] = DOMAIN_CALLS[sub](name);
  let result;
  try {
    // Activation issues a certificate: give it time.
    result = await panelRequest(method, path, body, {
      timeoutMs: sub === 'activate' ? 180000 : 30000,
    });
  } catch (err) {
    fail(err.message, json, err);
  }
  if (json) {
    emitComplete(result);
    return;
  }
  const domain = terminalText(name);
  switch (sub) {
    case 'add':
      console.log(`\n  ${chalk.green('✓')} ${domain} added (pending).`);
      console.log(`  Point ${chalk.cyan(`auth.${domain}`)} at this relay, then run`);
      console.log(`  ${chalk.cyan(`lamaste-server domains activate ${domain}`)}\n`);
      break;
    case 'verify-dns':
      console.log(
        `\n  ${result.ok ? chalk.green('✓') : chalk.yellow('!')} auth.${domain} ${
          result.ok ? 'points at' : 'does not point at'
        } this relay (${terminalText(result.expectedIp ?? '')})`,
      );
      for (const r of result.records ?? []) {
        console.log(
          chalk.dim(
            `    ${terminalText(r.name)}: ${terminalText(r.resolvedIps.join(', ') || 'no A record')}`,
          ),
        );
      }
      console.log(
        chalk.dim(
          `    wildcard *.${domain}: ${result.wildcard ? 'points here' : 'not in place'}\n`,
        ),
      );
      break;
    case 'activate':
      console.log(`\n  ${chalk.green('✓')} ${domain} is active — its sign-in is auth.${domain}\n`);
      break;
    case 'remove':
      console.log(`\n  ${chalk.green('✓')} ${domain} removed; its memberships ended.\n`);
      break;
  }
}

async function membersCmd(name, rest, { json }) {
  const [action, ref] = rest;
  const base = `/api/domains/${encodeURIComponent(name)}/members`;
  if (action === undefined) {
    let members;
    try {
      ({ members } = await panelRequest('GET', base));
    } catch (err) {
      fail(err.message, json, err);
    }
    if (json) {
      emit({ members });
      return;
    }
    console.log('');
    for (const m of members) {
      const status = m.status === 'active' ? '' : chalk.yellow(` (${m.status})`);
      console.log(
        `  ${chalk.cyan(terminalText(m.username ?? m.userId))}${status}  ${chalk.dim(m.userId)}`,
      );
    }
    if (members.length === 0) console.log(chalk.dim('  No members.'));
    console.log('');
    return;
  }
  if ((action !== 'add' && action !== 'remove') || !ref) return usage(1);
  let users;
  try {
    ({ users } = await panelRequest('GET', '/api/users'));
  } catch (err) {
    fail(err.message, json, err);
  }
  const userId = resolveUserId(ref, users ?? []);
  if (!userId) fail(`No user '${ref}' the directory knows`, json, { code: 'user_not_found' });
  let result;
  try {
    result = await panelRequest(action === 'add' ? 'PUT' : 'DELETE', `${base}/${userId}`);
  } catch (err) {
    fail(err.message, json, err);
  }
  if (json) {
    emitComplete(result);
    return;
  }
  console.log(
    `\n  ${chalk.green('✓')} ${terminalText(ref)} ${action === 'add' ? 'is now a member of' : 'is no longer a member of'} ${terminalText(name)}\n`,
  );
}

/**
 * `plugins domain <name> [<domain>]`: the domain a plugin belongs to, or
 * move it to another active one.
 *
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
export async function pluginDomainCmd(args, { json }) {
  const [name, domain] = args;
  if (!name) {
    console.error('\n  Usage: lamaste-server plugins domain <name> [<domain>]\n');
    process.exit(1);
  }
  if (domain === undefined) {
    let plugins;
    try {
      ({ plugins } = await panelRequest('GET', '/api/plugins'));
    } catch (err) {
      fail(err.message, json, err);
    }
    const plugin = (plugins ?? []).find((p) => p.name === name);
    if (!plugin) fail(`Plugin "${name}" is not installed`, json, { code: 'not_found' });
    // null: the primary.
    if (json) {
      emit({ name, domain: plugin.domain ?? null });
      return;
    }
    console.log(
      `\n  ${terminalText(name)}: ${terminalText(plugin.domain ?? 'the primary domain')}\n`,
    );
    return;
  }
  let result;
  try {
    result = await panelRequest('PUT', `/api/plugins/${encodeURIComponent(name)}/domain`, {
      domain: domain.toLowerCase(),
    });
  } catch (err) {
    fail(err.message, json, err);
  }
  if (json) {
    emitComplete(result);
    return;
  }
  console.log(
    `\n  ${chalk.green('✓')} ${terminalText(name)} ${result.changed ? 'now belongs to' : 'already belongs to'} ${terminalText(result.domain)}\n`,
  );
}
