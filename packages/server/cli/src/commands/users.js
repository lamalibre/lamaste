/**
 * lamaste-server users — the panel's users and its user directory.
 *
 * Subcommands:
 *   list                       Users (Authelia's users file) with their status and
 *                              directory id
 *   disable <username>         The one offboarding action: they cannot sign in, every
 *                              plugin audience shows them disabled, plugins' user
 *                              surfaces refuse them, their desktop sessions and
 *                              registry tokens end (the last enabled administrator
 *                              cannot be disabled)
 *   enable <username>          Undo it
 *   delete <username> [--erase]
 *                              Delete: the directory keeps a tombstone (the id and
 *                              the name and address they last had) so plugins'
 *                              history stays readable; --erase scrubs it at once
 *   erase <userId>             Erase a deleted user: the tombstone is scrubbed to the
 *                              id, their invitations and Gatekeeper's access-request
 *                              log entries go, plugins are sent the erasure
 *   directory                  Every user the directory knows — deleted and erased
 *                              ones too — with Gatekeeper's cleanup of deleted
 *                              usernames and the erasures plugins have not
 *                              acknowledged
 *
 * Every subcommand goes through the running panel (`/api/users`,
 * `/api/identity/directory`, admin certificate): users.yml is Authelia's
 * credential file and the panel's one lock serializes every write of it.
 * What the panel says is printed only as `terminalText`; `--json` emits it
 * as it came.
 */

import chalk from 'chalk';
import { panelRequest } from '../panel-api.js';
import { emit, emitComplete, emitError } from '../ndjson.js';
import { parseUserArgs, warningLine } from '../plugin-identity.js';
import { formatMoment, terminalText } from '../plugin-settings.js';

/**
 * @param {string[]} args  Subcommand args: ['list'] | ['disable', '<u>'] | ...
 * @param {{ json: boolean }} options
 */
export async function runUsers(args, { json }) {
  const sub = args[0];
  switch (sub) {
    case 'list':
      return listUsers({ json });
    case 'disable':
    case 'enable':
      return setDisabledCmd(sub, args.slice(1), { json });
    case 'delete':
      return deleteUserCmd(args.slice(1), { json });
    case 'erase':
      return eraseUserCmd(args.slice(1), { json });
    case 'directory':
      return directoryCmd({ json });
    default:
      printUsersUsage();
      process.exit(sub ? 1 : 0);
  }
}

function printUsersUsage() {
  const b = chalk.bold;
  const c = chalk.cyan;
  console.log(`
${b('Usage:')} lamaste-server users <subcommand>

${b('Subcommands:')}
  ${c('list')}                         Users with their status (active, disabled) and directory id
  ${c('disable <username>')}           They cannot sign in; plugins see them disabled and refuse them;
                               desktop sessions and registry tokens end
  ${c('enable <username>')}            Enable them again
  ${c('delete <username> [--erase]')}  Delete; the directory keeps a tombstone (id, last name and
                               address) — --erase scrubs it at once (cannot be undone)
  ${c('erase <userId>')}               Erase a deleted user (an id from ${c('users directory')})
  ${c('directory')}                    Every user the directory knows: deleted and erased ones, the
                               Gatekeeper cleanup of their usernames, pending erasures
`);
}

/**
 * Exit with a usage error or a refused request, as text or NDJSON (with
 * the refusal's `code`, e.g. `last_admin`, `user_not_removed`).
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

/** Print a change's warnings: what the panel could not complete beside it. */
function printWarnings(warnings) {
  for (const warning of warnings ?? []) {
    console.log(`  ${chalk.yellow('!')} ${warningLine(warning)}`);
  }
}

/** A user's status in its column: disabled in yellow, anything else in green. */
function statusCell(status) {
  return (status === 'disabled' ? chalk.yellow : chalk.green)(status.padEnd(8));
}

/**
 * The rows `users list` prints: each user's username, status, directory id
 * (a dash until the directory has seen them) and groups, as terminal text.
 * Pure, exported for tests.
 *
 * @param {Array<Record<string, any>>} users  as `GET /api/users` lists them
 */
export function userRows(users) {
  return users.map((u) => ({
    username: terminalText(u.username),
    status: u.status === 'disabled' ? 'disabled' : 'active',
    userId: u.userId ? terminalText(u.userId) : '—',
    groups: terminalText((u.groups ?? []).join(', ')),
  }));
}

/** @param {{ json: boolean }} options */
async function listUsers({ json }) {
  let result;
  try {
    result = await panelRequest('GET', '/api/users');
  } catch (err) {
    fail(err.message, json, err);
  }
  if (json) {
    emit(result);
    return;
  }
  const rows = userRows(result.users ?? []);
  if (rows.length === 0) {
    console.log('\n  No users.\n');
    return;
  }
  const width = Math.max('USERNAME'.length, ...rows.map((r) => r.username.length));
  console.log('');
  console.log(chalk.bold('  Users'));
  console.log(
    chalk.dim(`  ${'USERNAME'.padEnd(width)}  STATUS    ${'USER ID'.padEnd(36)}  GROUPS`),
  );
  for (const r of rows) {
    console.log(
      `  ${chalk.cyan(r.username.padEnd(width))}  ${statusCell(r.status)}  ${r.userId.padEnd(36)}  ${chalk.dim(r.groups)}`,
    );
  }
  if (rows.some((r) => r.userId === '—')) {
    console.log(
      chalk.dim('\n  — : not in the user directory yet; it adopts new users within a minute.'),
    );
  }
  console.log('');
}

/**
 * `users disable|enable <username>`.
 *
 * @param {'disable' | 'enable'} sub
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
async function setDisabledCmd(sub, args, { json }) {
  const parsed = parseUserArgs(sub, args);
  if (!parsed.ok) fail(parsed.error, json);
  const { username } = parsed;
  const disabled = sub === 'disable';
  let result;
  try {
    result = await panelRequest('PUT', `/api/users/${encodeURIComponent(username)}`, {
      disabled,
    });
  } catch (err) {
    fail(err.message, json, err);
  }
  if (json) {
    emitComplete({ username, status: result.user.status, warnings: result.warnings ?? [] });
    return;
  }
  console.log(
    disabled
      ? `\n  ${chalk.green('✓')} ${chalk.cyan(username)} ${chalk.yellow('disabled')} — cannot sign in; plugins see them disabled and refuse them`
      : `\n  ${chalk.green('✓')} ${chalk.cyan(username)} ${chalk.green('enabled')}`,
  );
  printWarnings(result.warnings);
  console.log('');
}

/**
 * `users delete <username> [--erase]`.
 *
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
async function deleteUserCmd(args, { json }) {
  const parsed = parseUserArgs('delete', args);
  if (!parsed.ok) fail(parsed.error, json);
  const { username, erase } = parsed;
  let result;
  try {
    result = await panelRequest(
      'DELETE',
      `/api/users/${encodeURIComponent(username)}${erase ? '?erase=true' : ''}`,
    );
  } catch (err) {
    fail(err.message, json, err);
  }
  if (json) {
    emitComplete({ username, ...result });
    return;
  }
  console.log(`\n  ${chalk.green('✓')} ${chalk.cyan(username)} deleted`);
  if (result.userId) console.log(chalk.dim(`    user id ${terminalText(result.userId)}`));
  if (erase) {
    console.log(
      result.erased
        ? '    and erased — plugins that had them are being sent the erasure'
        : chalk.yellow(
            '    not erased (see below) — erase it later with lamaste-server users erase <userId>',
          ),
    );
  } else {
    console.log(
      chalk.dim(
        '    The directory keeps a tombstone (the id and the name they last had) until it is erased.',
      ),
    );
  }
  if (!result.principalCleared) {
    console.log(
      chalk.yellow(
        '    Gatekeeper has not dropped their grants and group memberships yet — retried every minute;\n' +
          '    nothing is given to the username again until it has.',
      ),
    );
  }
  printWarnings(result.warnings);
  console.log('');
}

/**
 * `users erase <userId>`.
 *
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
async function eraseUserCmd(args, { json }) {
  const parsed = parseUserArgs('erase', args);
  if (!parsed.ok) fail(parsed.error, json);
  const { userId } = parsed;
  let result;
  try {
    result = await panelRequest(
      'POST',
      `/api/identity/directory/${encodeURIComponent(userId)}/erase`,
    );
  } catch (err) {
    fail(err.message, json, err);
  }
  if (json) {
    emitComplete(result);
    return;
  }
  console.log(`\n  ${chalk.green('✓')} ${terminalText(userId)} erased`);
  console.log(
    chalk.dim(
      `    ${result.invitationsPurged} invitation(s) and ${result.accessLogPurged} access-request log entr${result.accessLogPurged === 1 ? 'y' : 'ies'} deleted;` +
        '\n    every plugin that had them is sent the erasure (lamaste-server users directory shows who has not acknowledged it).' +
        "\n    Authelia's own authentication log is outside Lamaste's reach.",
    ),
  );
  console.log('');
}

/**
 * What `users directory` says of a removed user: who they were (or that
 * they were erased), how they were removed, and what is still pending —
 * Gatekeeper's cleanup of their username, or the plugins that have not
 * acknowledged their erasure. Pure, exported for tests.
 *
 * @param {Record<string, any>} user  as `GET /api/identity/directory` lists them
 * @param {number} now  epoch ms
 * @returns {{ userId: string, who: string, removed: string, pending: string | null }}
 */
export function removedUserText(user, now) {
  const erased = user.erasedAt != null;
  const who = erased
    ? 'erased'
    : terminalText(
        user.displayName && user.username
          ? `${user.username} (${user.displayName})`
          : (user.username ?? '—'),
      );
  const how =
    user.removedReason === 'deleted-outside'
      ? 'gone from users.yml (not through Lamaste)'
      : 'deleted';
  const removed = user.removedAt ? `${how} ${formatMoment(user.removedAt, now)}` : how;
  let pending = null;
  if (erased) {
    const plugins = Array.isArray(user.pendingErasures) ? user.pendingErasures : [];
    pending =
      plugins.length > 0
        ? `erasure not yet acknowledged by ${terminalText(plugins.join(', '))}`
        : null;
  } else if (user.principalClearedAt === null) {
    pending = 'Gatekeeper cleanup of the username pending (retried every minute)';
  }
  return { userId: terminalText(user.userId), who, removed, pending };
}

/** @param {{ json: boolean }} options */
async function directoryCmd({ json }) {
  let result;
  try {
    result = await panelRequest('GET', '/api/identity/directory');
  } catch (err) {
    fail(err.message, json, err);
  }
  if (json) {
    emit(result);
    return;
  }
  const now = Date.now();
  const users = result.users ?? [];
  const holding = users.filter((u) => u.status !== 'removed');
  const removed = users.filter((u) => u.status === 'removed');
  console.log('');
  console.log(chalk.bold('  User directory') + chalk.dim(`  ${terminalText(result.directoryId)}`));
  console.log(chalk.dim('  ' + '─'.repeat(40)));
  for (const u of holding) {
    console.log(
      `  ${terminalText(u.userId)}  ${statusCell(u.status)}  ${chalk.cyan(terminalText(u.username))}`,
    );
  }
  if (holding.length === 0) console.log(chalk.dim('  No users.'));
  if (removed.length > 0) {
    console.log('');
    console.log(chalk.bold('  Deleted users') + chalk.dim(' — tombstones until they are erased'));
    for (const u of removed) {
      const text = removedUserText(u, now);
      console.log(`  ${text.userId}  ${text.who}  ${chalk.dim(text.removed)}`);
      if (text.pending) console.log(`    ${chalk.yellow(text.pending)}`);
    }
    if (removed.some((u) => u.erasedAt === null)) {
      console.log(chalk.dim('\n  Erase a tombstone: lamaste-server users erase <userId>'));
    }
  }
  console.log('');
}
