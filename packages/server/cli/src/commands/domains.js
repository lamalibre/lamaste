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
 *   members <domain>                  Its members, each with the kind of the membership
 *   members <domain> add <user> [--external]
 *                                     Make a user (directory id or username) a member —
 *                                     an external one with --external
 *   members <domain> kind <user> member|external
 *                                     Change the kind of a membership
 *   members <domain> remove <user>    End a membership
 *   branding <domain>                 The brand of its auth pages ({@link brandingCmd})
 *   branding <domain> set …           Set its fields (merged over the brand read; --name for a new one)
 *   branding <domain> logo <file.png> | --remove
 *   branding <domain> favicon <file.ico|.png> | --remove
 *   branding <domain> remove          Back to the stock pages
 *   branding <domain> preview         The title, footer, theme and the generated stylesheet
 *
 * Also `plugins domain <name> [<domain>]` ({@link pluginDomainCmd}).
 *
 * Every subcommand goes through the running panel (`/api/domains`, admin
 * certificate), which decides every rule. What the panel says is printed
 * only as `terminalText`; `--json` emits it as it came.
 */

import { readFile, stat } from 'node:fs/promises';
import chalk from 'chalk';
import { panelRequest } from '../panel-api.js';
import { emit, emitComplete, emitError } from '../ndjson.js';
import { fail } from '../fail.js';
import { terminalText } from '../plugin-settings.js';
import { domainPath, domainRows, memberRequest } from '../domains.js';
import {
  assetFileProblem,
  assetLine,
  brandingLines,
  brandingSetArgs,
  brandingSetBody,
  explainBrandingRefusal,
  parseRevision,
  previewLines,
  warningLine,
} from '../branding.js';

/** A panel request, or exit with its refusal. */
const call = (json, ...args) => panelRequest(...args).catch((err) => fail(err.message, json, err));

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
export async function runDomains(args, { json }) {
  const [sub, name, ...rest] = args;
  if (sub === 'list') return listDomains({ json });
  if (sub === 'members' && name) return membersCmd(name.toLowerCase(), rest, { json });
  if (sub === 'branding' && name) return brandingCmd(name.toLowerCase(), rest, { json });
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
  ${c('members <domain>')}                  Its members and external members
  ${c('members <domain> add <user> [--external]')}
                                    Make a user (directory id or username) a member
  ${c('members <domain> kind <user> member|external')}
                                    Change the kind of a membership
  ${c('members <domain> remove <user>')}    End a membership
  ${c('branding <domain>')}                 The brand of its auth pages (sign-in, invitation, refusal pages)
  ${c('branding <domain> set [--name <n>] [--tagline <t>] [--theme <light|dark|grey|oled|auto>]')}
  ${c('                       [--accent <#rrggbb>] [--support-email <e>] [--support-url <https://…>]')}
  ${c('                       [--clear <tagline|accent|support-email|support-url>]... [--if-revision <n>]')}
                                    Set its fields — a new brand needs --name; the rest keep their values
  ${c('branding <domain> logo <file.png> [--if-revision <n>] | --remove')}
                                    The logo: a PNG of at most 512 KiB and 1024 pixels a side
  ${c('branding <domain> favicon <file.ico|.png> [--if-revision <n>] | --remove')}
                                    The favicon: an ICO, or a PNG of at most 256 pixels a side; at most 64 KiB
  ${c('branding <domain> remove')}          Back to the stock pages
  ${c('branding <domain> preview')}         The title, footer, theme and the generated stylesheet

  Every domain has its own sign-in (auth.<domain>) and member list; a user reaches a
  domain's protected hosts only as its member. An external member reaches only what
  names them — restricted hosts that grant them, sites that list them, OIDC clients
  granted to them — and holds no Authelia groups. The panel and tunnel. stay on the primary.
  A domain's brand reaches its sign-in (title, logo, favicon, theme, accent; the
  "Powered by Authelia" footer hidden), its invitation page and the access-request and
  refusal pages on its hosts; until one is set, the pages are the stock ones.
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
    const external = row.externalMembers > 0 ? `, ${row.externalMembers} external` : '';
    console.log(`  ${chalk.cyan(row.name)}  ${state}  ${row.members} member(s)${external}${used}`);
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
  if (rest.length === 0) {
    const { members } = await call(json, 'GET', domainPath(name, '/members'));
    if (json) {
      emit({ members });
      return;
    }
    console.log('');
    for (const m of members) {
      const status = m.status === 'active' ? '' : chalk.yellow(` (${m.status})`);
      const kind = m.kind === 'external' ? chalk.magenta(' external') : '';
      console.log(
        `  ${chalk.cyan(terminalText(m.username ?? m.userId))}${kind}${status}  ${chalk.dim(m.userId)}`,
      );
    }
    if (members.length === 0) console.log(chalk.dim('  No members.'));
    console.log('');
    return;
  }
  const request = memberRequest(name, rest);
  if (!request) return usage(1);
  // The panel takes a directory id or a username.
  const result = await call(json, request.method, request.path, request.body);
  if (json) {
    emitComplete(result);
    return;
  }
  const who = terminalText(request.user);
  const where = terminalText(name);
  console.log(
    request.kind === null
      ? `\n  ${chalk.green('✓')} ${who} is no longer a member of ${where}\n`
      : `\n  ${chalk.green('✓')} ${who} is now ${request.kind === 'external' ? 'an external member' : 'a member'} of ${where}\n`,
  );
}

/** Exit with a brand refusal: the headline and what to do, as terminal text; `--json` an error event with its code. */
function failBranding(err, domain, json, kind) {
  const { message, details } = explainBrandingRefusal(err, domain, kind);
  if (json) {
    emitError(message, false, {
      ...(typeof err.code === 'string' ? { code: err.code } : {}),
      ...(details.length > 0 ? { details } : {}),
    });
  } else {
    console.error(`\n  ${chalk.red(message)}`);
    for (const line of details) console.error(`  ${chalk.dim(line)}`);
    console.error('');
  }
  process.exit(1);
}

/** A brand request, or exit with its refusal explained. */
const brandCall = (json, domain, kind, ...args) =>
  panelRequest(...args).catch((err) => failBranding(err, domain, json, kind));

/** Print a change's warnings: what the panel could not complete beside it. */
function printWarnings(warnings) {
  for (const warning of warnings ?? [])
    console.log(`  ${chalk.yellow('!')} ${warningLine(warning)}`);
}

/** `label:` padded, then the value. */
function row(label, value) {
  console.log(`  ${chalk.dim(`${label}:`.padEnd(16))}${value}`);
}

/**
 * `domains branding <domain> …`: the brand of a domain's auth pages. Every
 * subcommand goes through the panel; `set` reads the brand first and sends
 * every field, with `ifRevision` the revision read, so a change made
 * elsewhere in between is refused rather than overwritten. A file is
 * checked against its limit before the request and sent as base64 in
 * the JSON body (on curl's stdin); its bytes are never printed.
 *
 * @param {string} domain
 * @param {string[]} rest  what follows `branding <domain>`
 * @param {{ json: boolean }} options
 */
async function brandingCmd(domain, rest, { json }) {
  const [action, ...args] = rest;
  const path = (suffix = '') => domainPath(domain, `/branding${suffix}`);
  const where = terminalText(domain);

  if (action === undefined) {
    const { branding } = await brandCall(json, domain, 'logo', 'GET', path());
    if (json) {
      emit({ branding });
      return;
    }
    console.log('');
    if (!branding) {
      console.log(`  ${where} has no brand: its sign-in is Authelia's stock page.`);
      console.log(
        chalk.dim(`  Set one with: lamaste-server domains branding ${where} set --name <name>`),
      );
    } else {
      console.log(chalk.bold(`  Brand of ${where}`));
      for (const [label, value] of brandingLines(branding)) row(label, value);
    }
    console.log('');
    return;
  }

  if (action === 'set') {
    const parsed = brandingSetArgs(args);
    if (parsed.error) return fail(parsed.error, json);
    const { branding: current } = await brandCall(json, domain, 'logo', 'GET', path());
    const merged = brandingSetBody(current, parsed);
    if (merged.error) return fail(merged.error, json);
    const result = await brandCall(json, domain, 'logo', 'PUT', path(), merged.body);
    if (json) {
      emitComplete(result);
      return;
    }
    console.log(
      `\n  ${chalk.green('✓')} ${result.created ? `${where} has a brand: ` : result.changed ? `Brand of ${where} saved: ` : `Brand of ${where} unchanged: `}${terminalText(result.branding.name)} (revision ${result.branding.revision})`,
    );
    printWarnings(result.warnings);
    console.log('');
    return;
  }

  if (action === 'logo' || action === 'favicon') {
    const kind = action;
    const [file, ...flags] = args;
    if (file === '--remove' && flags.length === 0) {
      const result = await brandCall(json, domain, kind, 'DELETE', path(`/${kind}`));
      if (json) {
        emitComplete(result);
        return;
      }
      console.log(`\n  ${chalk.green('✓')} ${kind} of ${where} removed`);
      printWarnings(result.warnings);
      console.log('');
      return;
    }
    if (!file || file.startsWith('--')) return usage(1);
    let ifRevision;
    if (flags.length === 2 && flags[0] === '--if-revision') {
      ifRevision = parseRevision(flags[1]);
      if (ifRevision === null) return fail('--if-revision takes a positive integer', json);
    } else if (flags.length > 0) {
      return usage(1);
    }
    let bytes;
    try {
      const info = await stat(file);
      const problem = assetFileProblem(kind, info.size);
      if (problem) return fail(problem, json);
      bytes = await readFile(file);
    } catch (err) {
      return fail(`Cannot read ${terminalText(file)}: ${err.message}`, json);
    }
    const body = {
      data: bytes.toString('base64'),
      ...(ifRevision === undefined ? {} : { ifRevision }),
    };
    const result = await brandCall(json, domain, kind, 'PUT', path(`/${kind}`), body, {
      timeoutMs: 60000,
    });
    if (json) {
      emitComplete(result);
      return;
    }
    const asset = result.branding?.[kind];
    console.log(
      `\n  ${chalk.green('✓')} ${kind} of ${where} ${result.changed ? 'set' : 'unchanged (the same file)'}${asset ? `: ${terminalText(assetLine(asset))}` : ''}`,
    );
    printWarnings(result.warnings);
    console.log('');
    return;
  }

  if (action === 'remove' && args.length === 0) {
    const result = await brandCall(json, domain, 'logo', 'DELETE', path());
    if (json) {
      emitComplete(result);
      return;
    }
    console.log(
      `\n  ${chalk.green('✓')} Brand of ${where} removed: its sign-in, invitation and refusal pages are the stock ones again`,
    );
    printWarnings(result.warnings);
    console.log('');
    return;
  }

  if (action === 'preview' && args.length === 0) {
    const preview = await brandCall(json, domain, 'logo', 'GET', path('/preview'));
    if (json) {
      emit(preview);
      return;
    }
    console.log('');
    console.log(chalk.bold(`  Sign-in of ${where} (en)`));
    for (const [label, value] of previewLines(preview)) row(label, value);
    console.log('');
    console.log(chalk.dim('  brand.css:'));
    for (const line of String(preview.css ?? '').split('\n')) {
      if (line) console.log(`    ${terminalText(line)}`);
    }
    console.log('');
    return;
  }

  return usage(1);
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
