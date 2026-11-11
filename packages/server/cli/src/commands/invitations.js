/**
 * lamaste-server invitations — invitations, the administrator's and
 * delegated ones (a plugin user holding an inviting role invites colleagues
 * into that plugin; packages/core/docs/delegated-invitations-design.md).
 *
 * Subcommands:
 *   list [--plugin <n>] [--inviter <user>]
 *                                 Every invitation: who for, who invited, role, status
 *   create <username> <email> [--groups a,b] [--domains a,b] [--external-domains c,d]
 *          [--expires-days n] [--mail|--no-mail]
 *                                 An administrator's invitation; its link printed once
 *   revoke <id>                   Revoke a pending one (delete one that ended with no account)
 *   reissue <id> [--mail|--no-mail]
 *                                 A new link for a pending (or expired) one: the old link stops
 *                                 working; the new one is mailed as chosen (at most 3 a day)
 *   disable-invitees <user> [--transitive]
 *                                 Disable everyone a person invited (and those they invited)
 *
 * Also `plugins invitations <name> [set …]` ({@link pluginInvitationsCmd}).
 *
 * Every subcommand goes through the running panel (`/api/invitations`,
 * admin certificate). What the panel says is printed only as `terminalText`;
 * `--json` emits it as it came.
 */

import chalk from 'chalk';
import { panelRequest } from '../panel-api.js';
import { emit, emitComplete } from '../ndjson.js';
import { fail } from '../fail.js';
import { terminalText } from '../plugin-settings.js';
import { warningLine } from '../branding.js';
import {
  invitationRows,
  invitationsPath,
  isUserId,
  madeMailText,
  parseCreateArgs,
  parseListArgs,
  parseReissueArgs,
  policyLines,
  policySetBody,
  resolveUserId,
  revokeText,
} from '../invitations.js';

/** A panel request, or exit with its refusal. */
const call = (json, ...args) => panelRequest(...args).catch((err) => fail(err.message, json, err));

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
export async function runInvitations(args, { json }) {
  const [sub, ...rest] = args;
  if (sub === 'list') return listCmd(rest, { json });
  if (sub === 'create') return createCmd(rest, { json });
  if (sub === 'revoke' && rest.length === 1) return revokeCmd(rest[0], { json });
  if (sub === 'reissue') return reissueCmd(rest, { json });
  if (sub === 'disable-invitees') return disableInviteesCmd(rest, { json });
  return usage(sub ? 1 : 0);
}

function usage(code) {
  const b = chalk.bold;
  const c = chalk.cyan;
  console.log(`
${b('Usage:')} lamaste-server invitations <subcommand>

${b('Subcommands:')}
  ${c('list [--plugin <name>] [--inviter <user>]')}
                                    Every invitation: who for, who invited, role, status
  ${c('create <username> <email> [--groups a,b] [--domains a,b] [--external-domains c,d]')}
         ${c('[--expires-days n] [--mail|--no-mail]')}
                                    An administrator's invitation, its link printed once. Mailed
                                    unless it grants admins or a feria-* group (--mail to mail
                                    it all the same, --no-mail to never)
  ${c('revoke <id>')}                       Revoke a pending invitation; delete one that ended
                                    without making an account (one that made one stays on record)
  ${c('reissue <id> [--mail|--no-mail]')}   A new link for a pending (or expired) invitation: the old
                                    link stops working; the new one is printed once and mailed
                                    as on creation unless a flag says (at most 3 a day)
  ${c('disable-invitees <user> [--transitive]')}
                                    Disable everyone a person invited — with --transitive,
                                    everyone those people invited too

  A person holding a plugin's inviting role invites colleagues into that plugin once
  its policy allows it (${c('lamaste-server plugins invitations <name>')}). Everyone they
  invited keeps their access when the inviter goes; disable-invitees is how to end it.
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

async function listCmd(rest, { json }) {
  const filter = parseListArgs(rest);
  if (!filter) return usage(1);
  const query = {
    ...(filter.plugin ? { plugin: filter.plugin } : {}),
    ...(filter.inviter ? { inviter: await userIdOf(filter.inviter, { json }) } : {}),
  };
  const { invitations, truncated } = await call(json, 'GET', invitationsPath(query));
  if (json) {
    emit({ invitations, truncated });
    return;
  }
  printInvitations(invitations);
  if (truncated) console.log(chalk.yellow('  Only the newest invitations are shown.\n'));
}

function printInvitations(invitations) {
  const d = chalk.dim;
  console.log('');
  for (const row of invitationRows(invitations)) {
    const reason = row.reason ? d(` — ${row.reason}`) : '';
    console.log(`  ${chalk.cyan(row.invitee)}  ${row.status}${reason}`);
    console.log(d(`    ${row.invitedBy}, role ${row.role}, until ${row.expiresAt}, ${row.id}`));
    if (row.mail) console.log(d(`    ${row.mail}`));
  }
  if (invitations.length === 0) console.log(d('  No invitations.'));
  console.log('');
}

async function revokeCmd(id, { json }) {
  const result = await call(json, 'DELETE', `/api/invitations/${encodeURIComponent(id)}`);
  if (json) emitComplete(result);
  else console.log(`\n  ${chalk.green('✓')} ${revokeText(id, result.action)}\n`);
}

async function createCmd(rest, { json }) {
  const body = parseCreateArgs(rest);
  if (!body) return usage(1);
  const result = await call(json, 'POST', '/api/invitations', body);
  if (json) {
    emitComplete(result);
    return;
  }
  const mailed = madeMailText(result.mail, result.invitation?.email ?? null);
  console.log(
    `\n  ${chalk.green('✓')} Invitation ${terminalText(result.invitation?.id ?? '')} for ${terminalText(body.username)}`,
  );
  if (mailed) console.log(`  ${mailed}`);
  console.log(`\n  ${chalk.cyan(terminalText(result.inviteUrl ?? result.token))}`);
  console.log(
    chalk.dim(
      `  Shown only now; it expires ${terminalText(result.invitation?.expiresAt ?? '')}.\n`,
    ),
  );
}

async function reissueCmd(rest, { json }) {
  const parsed = parseReissueArgs(rest);
  if (!parsed) return usage(1);
  const { id, body } = parsed;
  const result = await call(
    json,
    'POST',
    `/api/invitations/${encodeURIComponent(id)}/reissue`,
    body,
  );
  if (json) {
    emitComplete(result);
    return;
  }
  const mailed = madeMailText(result.mail, result.invitation?.email ?? null);
  console.log(
    `\n  ${chalk.green('✓')} New link for ${terminalText(id)} — the old one no longer works`,
  );
  if (mailed) console.log(`  ${mailed}`);
  console.log(`\n  ${chalk.cyan(terminalText(result.inviteUrl ?? result.token))}`);
  console.log(
    chalk.dim(
      `  Shown only now; it expires ${terminalText(result.invitation?.expiresAt ?? '')}.\n`,
    ),
  );
}

async function disableInviteesCmd(rest, { json }) {
  const transitive = rest.includes('--transitive');
  const named = rest.filter((arg) => arg !== '--transitive');
  if (named.length !== 1 || named[0].startsWith('--')) return usage(1);
  const inviterUserId = await userIdOf(named[0], { json });
  const result = await call(json, 'POST', '/api/invitations/disable-invitees', {
    inviterUserId,
    transitive,
  });
  if (json) {
    emitComplete(result);
    return;
  }
  console.log(`\n  ${chalk.green('✓')} ${result.disabled.length} user(s) disabled`);
  for (const warning of result.warnings ?? []) {
    console.log(`  ${chalk.yellow('!')} ${warningLine(warning)}`);
  }
  console.log('');
}

/**
 * `plugins invitations <name>` — its policy and invitations;
 * `plugins invitations <name> set …` — change the policy.
 *
 * @param {string | undefined} name
 * @param {string[]} rest
 * @param {{ json: boolean }} options
 */
export async function pluginInvitationsCmd(name, rest, { json }) {
  const usageText =
    'Usage: lamaste-server plugins invitations <name> [set [--enable|--disable] [--email-domains a,b] [--max-open n] [--max-joined n] [--lifetime-days d]]';
  if (!name) fail(usageText, json);
  const path = `/api/plugins/${encodeURIComponent(name)}/invitation-policy`;
  const [action, ...flags] = rest;
  if (action === 'set') {
    const current = await call(json, 'GET', path);
    const body = policySetBody(flags, current);
    if (!body) fail(usageText, json);
    const saved = await call(json, 'PUT', path, body);
    if (json) {
      emitComplete(saved);
      return;
    }
    console.log(`\n  ${chalk.green('✓')} Invitation policy saved`);
    for (const line of policyLines(saved)) console.log(`    ${line}`);
    for (const warning of saved.warnings ?? []) {
      console.log(`  ${chalk.yellow('!')} ${warningLine(warning)}`);
    }
    console.log('');
    return;
  }
  if (action !== undefined) fail(usageText, json);
  const [policy, { invitations, truncated }] = await Promise.all([
    call(json, 'GET', path),
    call(json, 'GET', invitationsPath({ plugin: name })),
  ]);
  if (json) {
    emit({ policy, invitations, truncated });
    return;
  }
  console.log('');
  console.log(chalk.bold(`  Invitations of ${terminalText(name)}`));
  for (const line of policyLines(policy)) console.log(`    ${line}`);
  printInvitations(invitations);
  if (truncated) console.log(chalk.yellow('  Only the newest invitations are shown.\n'));
}
