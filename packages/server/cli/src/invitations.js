/**
 * Invitations as `lamaste-server invitations` and `plugins invitations`
 * take and print them — pure helpers, exported for tests (the commands are
 * src/commands/invitations.js).
 */

import {
  INVITATION_POLICY_LIMITS,
  INVITATION_REVOKE_REASON_TEXT,
} from '@lamalibre/lamaste/invitation-limits';

import { terminalText } from './plugin-settings.js';

/** A directory id. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether `value` is a directory id (an inviter may be named by username too). */
export function isUserId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * `--plugin <n>` and `--inviter <u>` of `invitations list`, or null when
 * the arguments are anything else.
 *
 * @param {string[]} args
 * @returns {{ plugin?: string, inviter?: string } | null}
 */
export function parseListArgs(args) {
  const filter = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = { '--plugin': 'plugin', '--inviter': 'inviter' }[args[i]];
    const value = args[i + 1];
    if (!key || !value || value.startsWith('--') || key in filter) return null;
    filter[key] = value;
  }
  return filter;
}

/**
 * The directory id of `user` — an id as it is, a username by the directory
 * (`GET /api/identity/directory`'s users, a username in use before any
 * removed holder), or null.
 *
 * @param {string} user
 * @param {ReadonlyArray<{ userId: string, username: string | null, status?: string }>} users
 * @returns {string | null}
 */
export function resolveUserId(user, users) {
  if (isUserId(user)) return user;
  const holders = users.filter((u) => u.username === user);
  return (holders.find((u) => u.status !== 'removed') ?? holders[0])?.userId ?? null;
}

/** `/api/invitations`, with the filter's query. */
export function invitationsPath({ plugin, inviter } = {}) {
  const query = new URLSearchParams();
  if (plugin) query.set('plugin', plugin);
  if (inviter) query.set('inviter', inviter);
  const text = query.toString();
  return text ? `/api/invitations?${text}` : '/api/invitations';
}

/** Why an invitation was revoked, in words. */
function reasonText(reason) {
  return INVITATION_REVOKE_REASON_TEXT[reason] ?? reason;
}

/**
 * One row per invitation, as terminal text.
 *
 * @param {ReadonlyArray<Record<string, any>>} invitations  as `GET /api/invitations` lists them
 */
export function invitationRows(invitations) {
  return invitations.map((inv) => ({
    id: terminalText(inv.id),
    invitee: terminalText(inv.username ?? inv.email ?? '—'),
    invitedBy:
      inv.kind === 'delegated'
        ? terminalText(
            `${inv.inviter?.username ?? inv.inviter?.userId ?? 'unknown'} · ${inv.plugin ?? '—'}`,
          )
        : 'administrator',
    role: terminalText(inv.role ?? '—'),
    status: terminalText(
      inv.status === 'accepted' && inv.fulfilled === false
        ? 'accepted (access pending)'
        : inv.status,
    ),
    reason: inv.revokedReason ? terminalText(reasonText(inv.revokedReason)) : '',
    expiresAt: terminalText(String(inv.expiresAt ?? '')).slice(0, 10),
    mail: inv.status === 'pending' || inv.status === 'expired' ? mailText(inv.mail) : '',
  }));
}

/**
 * What became of an invitation's mail (mail-design.md §6.1), in words; ''
 * when there is nothing to say (no mail state, an invitation made before
 * mail).
 *
 * @param {{ status?: string | null } | null | undefined} mail
 * @param {string | null} [email]
 */
export function mailText(mail, email = null) {
  switch (mail?.status) {
    case 'sent':
      return email ? `e-mailed to ${terminalText(email)}` : 'e-mailed';
    case 'failed':
      return 'could not be e-mailed — share the link yourself';
    case 'deferred-budget':
      return 'not e-mailed: the mail budget is used up — share the link yourself';
    case 'not-configured':
      return 'not e-mailed: no mail is set up for its domain — share the link yourself';
    default:
      return '';
  }
}

/** What the panel did with a revocation, in words. */
export function revokeText(id, action) {
  const who = terminalText(id);
  if (action === 'marked') {
    return `${who} is being accepted: it will end revoked, and an account made by then disabled`;
  }
  return action === 'deleted' ? `${who} deleted` : `${who} revoked`;
}

/**
 * `plugins invitations <name> set` over the policy read: each flag changes
 * its field, the rest keep their values (the panel takes the whole
 * policy). Null for unknown or repeated flags, a flag without its value, or
 * a value that is no whole number; the panel checks the bounds.
 *
 * @param {string[]} args
 * @param {Record<string, any>} current  `GET /api/plugins/:name/invitation-policy`
 * @returns {{ enabled: boolean, emailDomains: string[], maxOpenPerInviter: number, maxJoined: number, lifetimeDays: number } | null}
 */
export function policySetBody(args, current) {
  const policy = {
    enabled: current.enabled === true,
    emailDomains: [...(current.emailDomains ?? [])],
    maxOpenPerInviter:
      current.maxOpenPerInviter ?? INVITATION_POLICY_LIMITS.maxOpenPerInviter.default,
    maxJoined: current.maxJoined ?? INVITATION_POLICY_LIMITS.maxJoined.default,
    lifetimeDays: current.lifetimeDays ?? INVITATION_POLICY_LIMITS.lifetimeDays.default,
  };
  const numbers = {
    '--max-open': 'maxOpenPerInviter',
    '--max-joined': 'maxJoined',
    '--lifetime-days': 'lifetimeDays',
  };
  const seen = new Set();
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    const group = flag === '--enable' || flag === '--disable' ? 'enabled' : flag;
    if (seen.has(group)) return null;
    seen.add(group);
    if (group === 'enabled') {
      policy.enabled = flag === '--enable';
      continue;
    }
    i += 1;
    const value = args[i];
    if (value === undefined || value.startsWith('--')) return null;
    if (flag === '--email-domains') {
      policy.emailDomains = value
        .split(',')
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean);
    } else if (flag in numbers) {
      if (!/^\d+$/.test(value)) return null;
      policy[numbers[flag]] = Number(value);
    } else {
      return null;
    }
  }
  return seen.size > 0 ? policy : null;
}

/**
 * A plugin's policy as labelled lines, as terminal text.
 *
 * @param {Record<string, any>} view  `GET /api/plugins/:name/invitation-policy`
 * @returns {string[]}
 */
export function policyLines(view) {
  const inviting = (view.invitingRoles ?? []).map(
    ({ role, invites }) => `${role} → ${(invites ?? []).join(', ')}`,
  );
  const lines = [
    `enabled:        ${view.enabled ? 'yes' : 'no'}`,
    `e-mail domains: ${(view.emailDomains ?? []).join(', ') || 'none'}`,
    `open per inviter: at most ${view.maxOpenPerInviter}`,
    `by invitation:  at most ${view.maxJoined} people`,
    `lifetime:       ${view.lifetimeDays} day(s)`,
    `inviting roles: ${inviting.join('; ') || 'none'}`,
  ];
  if (view.available === false && view.unavailableReason) {
    lines.push(`cannot work now: ${view.unavailableReason}`);
  }
  return lines.map(terminalText);
}
