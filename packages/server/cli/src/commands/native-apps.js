/**
 * lamaste-server native-apps — native (mobile) apps on the user surface
 * (packages/core/docs/native-apps-design.md): one OIDC client per
 * application host, signing people in with PKCE and calling every plugin of
 * the host with one bearer token; each person's sign-in on a device is a
 * grant that ends with their standing.
 *
 * Subcommands:
 *   list                                Every native client, its host and state
 *   create <slug> --host <fqdn | id> --name <name> --redirect <path,…> [settings] [--disabled]
 *                                       Register lamaste-native-<slug> for an application
 *                                       host (a plugin-owned site, or a tunnel bound to
 *                                       plugin routes)
 *   update <client> [settings]          Change its settings
 *   enable|disable <client>             Disabling ends every grant and stops sign-ins
 *   delete <client> [--yes]             Delete it; every grant ends
 *   grants <client> [--user <u>] [--status live|ended|all]
 *                                       Its grants: one per person and device
 *   revoke <client> --grant <id> | --user <u>
 *                                       End one grant, or every grant of a person
 *
 * Settings: --name, --redirect <path,…>, --access-minutes <5–15>,
 * --idle-days <n>, --absolute-days <n>, --ios-team <team> --ios-bundle <id,…>,
 * --android <package>=<fingerprint>[,…] (repeatable).
 *
 * Also `users native-grants <username>` ({@link userNativeGrantsCmd}).
 *
 * Every subcommand goes through the running panel (`/api/native-apps`,
 * admin certificate). What the panel says is printed only as `terminalText`;
 * `--json` emits it as it came.
 */

import chalk from 'chalk';
import * as prompts from '@clack/prompts';
import { panelRequest } from '../panel-api.js';
import { emit, emitComplete } from '../ndjson.js';
import { fail } from '../fail.js';
import { readSites, readTunnels } from '../state.js';
import { warningLine } from '../branding.js';
import { terminalText } from '../plugin-settings.js';
import { isUserId, resolveUserId } from '../invitations.js';
import {
  NATIVE_APPS_USAGE,
  clientIdOf,
  findApplicationHost,
  grantLine,
  nativeClientRows,
  nativeSettingsBody,
  parseNativeAppsArgs,
} from '../native-apps.js';

/** A panel request, or exit with its refusal. */
const call = (json, ...args) => panelRequest(...args).catch((err) => fail(err.message, json, err));

/** `/api/native-apps[/<client>[<rest>]]`. */
function clientPath(clientId, rest = '') {
  return `/api/native-apps/${encodeURIComponent(clientId)}${rest}`;
}

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
export async function runNativeApps(args, { json }) {
  if (args.length === 0) return usage(0);
  const parsed = parseNativeAppsArgs(args);
  if (!parsed.ok) fail(parsed.error, json);
  const { sub } = parsed;
  if (sub === 'list') return listCmd({ json });
  if (sub === 'create') return createCmd(parsed, { json });
  const clientId = clientIdOf(parsed.target);
  if (!clientId) fail(`"${parsed.target}" is no native client id`, json);
  switch (sub) {
    case 'update':
      return updateCmd(clientId, parsed, { json });
    case 'enable':
    case 'disable':
      return setEnabledCmd(clientId, sub === 'enable', { json });
    case 'delete':
      return deleteCmd(clientId, parsed.flags.has('--yes'), { json });
    case 'grants':
      return grantsCmd(clientId, parsed.flags, { json });
    default:
      return revokeCmd(clientId, parsed.flags, { json });
  }
}

function usage(code) {
  const b = chalk.bold;
  const c = chalk.cyan;
  console.log(`
${b('Usage:')} lamaste-server native-apps <subcommand>

${b('Subcommands:')}
  ${c('list')}                              Every native client, its host and whether it signs people in
  ${c('create <slug> --host <fqdn | id> --name <name> --redirect <path,…> [settings] [--disabled]')}
                                    Register lamaste-native-<slug> for an application host
  ${c('update <client> [settings]')}        Change its settings
  ${c('enable|disable <client>')}           Disabling stops sign-ins and ends every grant
  ${c('delete <client> [--yes]')}           Delete it; every grant ends
  ${c('grants <client> [--user <u>] [--status live|ended|all]')}
                                    Its grants: one per person and device
  ${c('revoke <client> --grant <id> | --user <u>')}
                                    End one grant, or every grant of a person

${b('Settings:')}
  --name <name>                     Shown on the sign-in consent screen
  --redirect <path,…>               1–4 redirect paths on the host (claimed by the app)
  --access-minutes <5–15>           Access token lifetime (default 15)
  --idle-days <n> --absolute-days <n>
                                    Grant lifetimes (defaults 30 and 90)
  --ios-team <team> --ios-bundle <id,…>
                                    apple-app-site-association on the host
  --android <package>=<fp>[,<fp>]   assetlinks.json on the host (repeat per app)

  A client is named by its id or its slug. A person's devices across clients:
  ${c('lamaste-server users native-grants <username>')}
`);
  process.exit(code);
}

/** The directory id of `user` (an id, or a username), or exit. */
async function userIdOf(user, { json }) {
  if (isUserId(user)) return user;
  const { users } = await call(json, 'GET', '/api/identity/directory');
  const userId = resolveUserId(user, users);
  if (!userId) fail(`No user "${user}" in the directory`, json);
  return userId;
}

function printWarnings(result) {
  for (const warning of result?.warnings ?? []) {
    console.log(`  ${chalk.yellow('!')} ${warningLine(warning)}`);
  }
}

function printClient(client) {
  console.log(`  ${chalk.cyan(terminalText(client.clientId))}`);
  for (const [label, value] of nativeClientRows(client)) {
    console.log(`    ${chalk.dim(`${label}:`.padEnd(16))}${value}`);
  }
}

async function listCmd({ json }) {
  const { clients } = await call(json, 'GET', '/api/native-apps');
  if (json) {
    emit({ clients });
    return;
  }
  console.log('');
  if (clients.length === 0) console.log(chalk.dim('  No native app is registered.'));
  for (const client of clients) {
    printClient(client);
    console.log('');
  }
}

async function createCmd(parsed, { json }) {
  const { flags, android } = parsed;
  for (const flag of ['--host', '--name', '--redirect']) {
    if (!flags.has(flag)) fail(`create needs ${flag} — ${NATIVE_APPS_USAGE}`, json);
  }
  const host = findApplicationHost(
    { sites: await readSites(), tunnels: await readTunnels() },
    String(flags.get('--host')),
  );
  if (host.error) fail(host.error, json);
  const settings = nativeSettingsBody(flags, android);
  if (!settings.ok) fail(settings.error, json);
  const result = await call(json, 'POST', '/api/native-apps', {
    slug: parsed.target,
    hostKind: host.hostKind,
    hostId: host.hostId,
    ...settings.body,
    ...(flags.has('--disabled') ? { enabled: false } : {}),
  });
  if (json) {
    emitComplete(result);
    return;
  }
  console.log(`\n  ${chalk.green('✓')} Registered on ${chalk.cyan(terminalText(host.fqdn))}`);
  printClient(result.client);
  printWarnings(result);
  console.log('');
}

async function updateCmd(clientId, parsed, { json }) {
  const current = (await call(json, 'GET', clientPath(clientId))).client;
  const settings = nativeSettingsBody(parsed.flags, parsed.android, current);
  if (!settings.ok) fail(settings.error, json);
  if (Object.keys(settings.body).length === 0) fail('Nothing to change', json);
  const result = await call(json, 'PATCH', clientPath(clientId), settings.body);
  if (json) {
    emitComplete(result);
    return;
  }
  console.log(`\n  ${chalk.green('✓')} Changed`);
  printClient(result.client);
  printWarnings(result);
  console.log('');
}

async function setEnabledCmd(clientId, enabled, { json }) {
  const result = await call(json, 'PATCH', clientPath(clientId), { enabled });
  if (json) {
    emitComplete(result);
    return;
  }
  console.log(
    enabled
      ? `\n  ${chalk.green('✓')} ${terminalText(clientId)} enabled — it signs people in again`
      : `\n  ${chalk.green('✓')} ${terminalText(clientId)} disabled — no sign-ins, every grant ended`,
  );
  printWarnings(result);
  console.log('');
}

async function deleteCmd(clientId, yes, { json }) {
  if (!yes && !json) {
    const answer = await prompts.confirm({
      message: `Delete ${clientId}? The app can no longer sign anyone in and every grant ends.`,
      initialValue: false,
    });
    if (prompts.isCancel(answer) || answer !== true) {
      console.log(chalk.dim('\n  Nothing deleted.\n'));
      return;
    }
  }
  const result = await call(json, 'DELETE', clientPath(clientId));
  if (json) {
    emitComplete(result);
    return;
  }
  console.log(`\n  ${chalk.green('✓')} ${terminalText(clientId)} deleted — its grants ended`);
  printWarnings(result);
  console.log('');
}

function printGrants(grants, options) {
  console.log('');
  if (grants.length === 0) console.log(chalk.dim('  No grants.'));
  for (const grant of grants) {
    const line = grantLine(grant, options);
    console.log(`  ${grant.status === 'live' ? line : chalk.dim(line)}`);
  }
  console.log('');
}

async function grantsCmd(clientId, flags, { json }) {
  const status = flags.get('--status') ?? 'live';
  if (!['live', 'ended', 'all'].includes(status)) {
    fail('--status is live, ended or all', json);
  }
  const query = new URLSearchParams({ status });
  if (flags.has('--user'))
    query.set('userId', await userIdOf(String(flags.get('--user')), { json }));
  const { grants } = await call(json, 'GET', `${clientPath(clientId, '/grants')}?${query}`);
  if (json) {
    emit({ grants });
    return;
  }
  printGrants(grants);
}

async function revokeCmd(clientId, flags, { json }) {
  if (flags.has('--grant') === flags.has('--user')) {
    fail('revoke names exactly one of --grant <id> and --user <u>', json);
  }
  const result = flags.has('--grant')
    ? await call(
        json,
        'DELETE',
        clientPath(clientId, `/grants/${encodeURIComponent(String(flags.get('--grant')))}`),
      )
    : await call(json, 'POST', clientPath(clientId, '/grants/revoke'), {
        userId: await userIdOf(String(flags.get('--user')), { json }),
      });
  if (json) {
    emitComplete(result);
    return;
  }
  console.log(`\n  ${chalk.green('✓')} ${result.ended} grant(s) ended — signed out at once\n`);
}

/**
 * `users native-grants <username> [--status live|ended|all]` — a person's
 * devices: their grants with every native client.
 *
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
export async function userNativeGrantsCmd(args, { json }) {
  const usageText =
    'Usage: lamaste-server users native-grants <username> [--status live|ended|all]';
  let status = 'live';
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--status') {
      status = args[i + 1];
      i++;
    } else if (args[i].startsWith('--')) {
      fail(`Unknown option ${args[i]} — ${usageText}`, json);
    } else {
      positional.push(args[i]);
    }
  }
  if (positional.length !== 1 || !['live', 'ended', 'all'].includes(status)) fail(usageText, json);
  const { grants } = await call(
    json,
    'GET',
    `/api/users/${encodeURIComponent(positional[0])}/native-grants?status=${status}`,
  );
  if (json) {
    emit({ grants });
    return;
  }
  printGrants(grants, { withClient: true });
}
