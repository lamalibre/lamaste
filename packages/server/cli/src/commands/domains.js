/**
 * lamaste-server domains — the relay's base domains and their members
 * (the multi-domain relay).
 *
 * Subcommands:
 *   list                              Domains with their state, member count and what uses them
 *   add <domain>                      Add a domain (pending until activated)
 *   verify-dns <domain>               The records it needs, and whether they point here
 *   activate <domain>                 Issue auth.<domain>, serve its sign-in, admit its members
 *   remove <domain>                   Remove an unused, non-primary domain (its memberships end)
 *   members <domain>                  Its members
 *   members <domain> add <user>       Make a user (directory id or username) a member
 *   members <domain> remove <user>    End a membership
 *
 * Also `plugins domain <name> [<domain>]` ({@link pluginDomainCmd}).
 *
 * Every subcommand goes through the running panel (`/api/domains`, admin
 * certificate), which decides every rule. What the panel says is printed
 * only as `terminalText`; `--json` emits it as it came.
 */

import chalk from 'chalk';
import { panelRequest } from '../panel-api.js';
import { emit, emitComplete } from '../ndjson.js';
import { fail } from '../fail.js';
import { terminalText } from '../plugin-settings.js';
import { domainRows } from '../domains.js';

/** A panel request, or exit with its refusal. */
const call = (json, ...args) => panelRequest(...args).catch((err) => fail(err.message, json, err));

const domainPath = (name, rest = '') => `/api/domains/${encodeURIComponent(name)}${rest}`;

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
export async function runDomains(args, { json }) {
  const [sub, name, ...rest] = args;
  if (sub === 'list') return listDomains({ json });
  if (sub === 'members' && name) return membersCmd(name.toLowerCase(), rest, { json });
  const command = DOMAIN_COMMANDS[sub];
  if (!command || !name) return usage(sub ? 1 : 0);
  const domain = name.toLowerCase();
  const result = await call(json, ...command.request(domain), { timeoutMs: command.timeoutMs });
  if (json) emitComplete(result);
  else command.print(terminalText(domain), result);
}

function usage(code) {
  const b = chalk.bold;
  const c = chalk.cyan;
  console.log(`
${b('Usage:')} lamaste-server domains <subcommand>

${b('Subcommands:')}
  ${c('list')}                              Domains: state, members, what uses each
  ${c('add <domain>')}                      Add a domain (pending until activated)
  ${c('verify-dns <domain>')}               The DNS records it needs, and whether they point here
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

async function listDomains({ json }) {
  const { domains } = await call(json, 'GET', '/api/domains');
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

/** One entry per domain subcommand: its request, its time budget, how it is printed. */
const DOMAIN_COMMANDS = {
  add: {
    request: (name) => ['POST', '/api/domains', { name }],
    timeoutMs: 30000,
    print: (domain) => {
      console.log(`\n  ${chalk.green('✓')} ${domain} added (pending).`);
      console.log(
        `  Create its DNS records (${chalk.cyan(`lamaste-server domains verify-dns ${domain}`)}),`,
      );
      console.log(`  then ${chalk.cyan(`lamaste-server domains activate ${domain}`)}\n`);
    },
  },
  'verify-dns': {
    request: (name) => ['POST', domainPath(name, '/verify-dns'), null],
    timeoutMs: 30000,
    print: (domain, result) => {
      const mark = result.ok ? chalk.green('✓') : chalk.yellow('!');
      console.log(
        `\n  ${mark} ${domain}: ${result.ok ? 'its sign-in points at this relay' : 'records still missing'}`,
      );
      for (const r of result.records ?? []) {
        const state = r.ok
          ? chalk.green('in place')
          : chalk.yellow(r.required ? 'missing' : 'optional, absent');
        console.log(
          `    ${terminalText(r.type)} ${chalk.cyan(terminalText(r.name))} → ${terminalText(r.value)}  ${state}`,
        );
        console.log(chalk.dim(`      ${terminalText(r.purpose)}`));
      }
      console.log('');
    },
  },
  activate: {
    request: (name) => ['POST', domainPath(name, '/activate'), null],
    // Activation issues a certificate: give it time.
    timeoutMs: 180000,
    print: (domain) =>
      console.log(`\n  ${chalk.green('✓')} ${domain} is active — its sign-in is auth.${domain}\n`),
  },
  remove: {
    request: (name) => ['DELETE', domainPath(name), null],
    timeoutMs: 30000,
    print: (domain) =>
      console.log(`\n  ${chalk.green('✓')} ${domain} removed; its memberships ended.\n`),
  },
};

async function membersCmd(name, rest, { json }) {
  const [action, user] = rest;
  if (action === undefined) {
    const { members } = await call(json, 'GET', domainPath(name, '/members'));
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
  if ((action !== 'add' && action !== 'remove') || !user) return usage(1);
  // The panel takes a directory id or a username.
  const result = await call(
    json,
    action === 'add' ? 'PUT' : 'DELETE',
    domainPath(name, `/members/${encodeURIComponent(user)}`),
  );
  if (json) {
    emitComplete(result);
    return;
  }
  console.log(
    `\n  ${chalk.green('✓')} ${terminalText(user)} ${action === 'add' ? 'is now a member of' : 'is no longer a member of'} ${terminalText(name)}\n`,
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
    const { plugin } = await call(json, 'GET', `/api/plugins/${encodeURIComponent(name)}`);
    if (json) {
      emit({ name, domain: plugin.domain });
      return;
    }
    console.log(`\n  ${terminalText(name)}: ${terminalText(plugin.domain)}\n`);
    return;
  }
  const result = await call(json, 'PUT', `/api/plugins/${encodeURIComponent(name)}/domain`, {
    domain: domain.toLowerCase(),
  });
  if (json) {
    emitComplete(result);
    return;
  }
  console.log(
    `\n  ${chalk.green('✓')} ${terminalText(name)} ${result.changed ? 'now belongs to' : 'already belongs to'} ${terminalText(result.domain)}\n`,
  );
}
