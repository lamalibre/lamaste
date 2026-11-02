/**
 * Invitations in the panel's words: why one was revoked, who invited whom,
 * the filters of the list, a plugin's policy as a form, and the people who
 * joined by invitation. The bounds and the reasons' words are core's
 * (`@lamalibre/lamaste/invitation-limits`), never copied here. Nothing here
 * calls the panel.
 */

import {
  INVITATION_POLICY_LIMITS,
  INVITATION_POLICY_MAX_EMAIL_DOMAINS,
  INVITATION_REVOKE_REASON_TEXT,
} from '@lamalibre/lamaste/invitation-limits';

/**
 * Why an invitation was revoked, in words; the reason itself when it is
 * not one this panel knows, null without one.
 *
 * @param {string | null | undefined} reason
 * @returns {string | null}
 */
export function revokeReasonText(reason) {
  if (!reason) return null;
  return INVITATION_REVOKE_REASON_TEXT[reason] ?? reason;
}

/** The Tailwind classes of a status badge. */
export function statusClasses(status) {
  switch (status) {
    case 'accepted':
      return 'text-green-400 bg-green-500/10 border-green-500/20';
    case 'revoked':
      return 'text-red-400 bg-red-500/10 border-red-500/20';
    case 'expired':
      return 'text-zinc-500 bg-zinc-800 border-zinc-700';
    default:
      return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
  }
}

/** Whether an administrator can still stop this invitation (`accepting`: it is marked). */
export function isRevocable(invitation) {
  return invitation?.status === 'pending' || invitation?.status === 'accepting';
}

/** Who an invitation is for: the username once there is one, else the address. */
export function inviteeText(invitation) {
  return invitation?.username ?? invitation?.email ?? invitation?.displayName ?? '—';
}

/**
 * Who invited: `administrator`, or the inviter's username (their id's start
 * when the directory no longer names them) with the plugin.
 *
 * @param {{ kind?: string, plugin?: string | null, inviter?: { userId: string, username: string | null } | null }} invitation
 * @returns {string}
 */
export function invitedByText(invitation) {
  if (invitation?.kind !== 'delegated') return 'administrator';
  const who = invitation.inviter?.username ?? invitation.inviter?.userId?.slice(0, 8) ?? 'unknown';
  return invitation.plugin ? `${who} · ${invitation.plugin}` : who;
}

/** What the toast says after a revocation, by the panel's `action`. */
export function revokeResultText(action) {
  if (action === 'marked') {
    return 'It is being accepted — it will end revoked, and an account made by then disabled';
  }
  return action === 'deleted' ? 'Invitation deleted' : 'Invitation revoked';
}

/**
 * The choices of the list's filters: the plugins and the inviters its
 * delegated invitations name, each once, sorted.
 *
 * @param {ReadonlyArray<object> | undefined} invitations
 * @returns {{ plugins: string[], inviters: Array<{ userId: string, label: string }> }}
 */
export function invitationFilters(invitations) {
  const plugins = new Set();
  const inviters = new Map();
  for (const inv of invitations ?? []) {
    if (inv.kind !== 'delegated') continue;
    if (inv.plugin) plugins.add(inv.plugin);
    if (inv.inviter?.userId) {
      inviters.set(inv.inviter.userId, inv.inviter.username ?? inv.inviter.userId.slice(0, 8));
    }
  }
  return {
    plugins: [...plugins].sort(),
    inviters: [...inviters]
      .map(([userId, label]) => ({ userId, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/**
 * The invitations a plugin and an inviter (user id; empty: any) select.
 *
 * @param {ReadonlyArray<object> | undefined} invitations
 * @param {{ plugin?: string, inviter?: string }} filter
 * @returns {object[]}
 */
export function filterInvitations(invitations, { plugin = '', inviter = '' } = {}) {
  return (invitations ?? []).filter(
    (inv) => (!plugin || inv.plugin === plugin) && (!inviter || inv.inviter?.userId === inviter),
  );
}

/** Whether a plugin's identity block has a role that may invite. */
export function declaresInvitingRole(plugin) {
  const roles = plugin?.identity?.roles;
  return Array.isArray(roles) && roles.some((role) => (role?.invites?.length ?? 0) > 0);
}

/**
 * Who may give what, in words — `Coordinator may invite Stakeholder,
 * Viewer` — one line per inviting role, by the labels of `identity`.
 *
 * @param {{ roles?: Array<{ id: string, label?: string, invites?: string[] }> } | null | undefined} identity
 * @returns {string[]}
 */
export function invitingRoleLines(identity) {
  const roles = Array.isArray(identity?.roles) ? identity.roles : [];
  const label = (id) => roles.find((role) => role.id === id)?.label ?? id;
  return roles
    .filter((role) => (role.invites?.length ?? 0) > 0)
    .map((role) => `${label(role.id)} may invite ${role.invites.map(label).join(', ')}`);
}

/** A policy view as the form holds it: numbers as text, domains one per line. */
export function policyForm(policy) {
  return {
    enabled: policy?.enabled === true,
    emailDomains: (policy?.emailDomains ?? []).join('\n'),
    maxOpenPerInviter: String(
      policy?.maxOpenPerInviter ?? INVITATION_POLICY_LIMITS.maxOpenPerInviter.default,
    ),
    maxJoined: String(policy?.maxJoined ?? INVITATION_POLICY_LIMITS.maxJoined.default),
    lifetimeDays: String(policy?.lifetimeDays ?? INVITATION_POLICY_LIMITS.lifetimeDays.default),
  };
}

/** Lines, commas or spaces between domains: lower case, each once. */
export function parseEmailDomains(text) {
  const domains = String(text ?? '')
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  return [...new Set(domains)];
}

const FIELD_LABELS = {
  maxOpenPerInviter: 'Open invitations per inviter',
  maxJoined: 'People by invitation',
  lifetimeDays: 'Lifetime in days',
};

/** The label and bounds of a numeric policy field. */
export function policyFieldLimits(field) {
  const { min, max } = INVITATION_POLICY_LIMITS[field];
  return { label: FIELD_LABELS[field], min, max };
}

/**
 * The form as the panel takes it, or why not. The panel checks everything
 * again; this only spares a round trip.
 *
 * @param {ReturnType<typeof policyForm>} form
 * @returns {{ policy: object } | { error: string }}
 */
export function policyInput(form) {
  const emailDomains = parseEmailDomains(form.emailDomains);
  if (form.enabled && emailDomains.length === 0) {
    return { error: 'Invitations can be enabled only with at least one e-mail domain' };
  }
  if (emailDomains.length > INVITATION_POLICY_MAX_EMAIL_DOMAINS) {
    return { error: `At most ${INVITATION_POLICY_MAX_EMAIL_DOMAINS} e-mail domains` };
  }
  const policy = { enabled: form.enabled, emailDomains };
  for (const field of Object.keys(INVITATION_POLICY_LIMITS)) {
    const { label, min, max } = policyFieldLimits(field);
    const value = Number(form[field]);
    if (!Number.isInteger(value) || value < min || value > max) {
      return { error: `${label}: a whole number from ${min} to ${max}` };
    }
    policy[field] = value;
  }
  return { policy };
}

/**
 * The people who joined a plugin by invitation, by inviter: each inviter
 * (their user id, their username when the directory names them) with the
 * invitees' usernames and roles. Only accepted delegated invitations with
 * an inviter count; inviters by name, invitees by username.
 *
 * @param {ReadonlyArray<object> | undefined} invitations
 * @returns {Array<{ userId: string, label: string, invitees: Array<{ userId: string | null, username: string, role: string | null, fulfilled: boolean }> }>}
 */
export function inviteesByInviter(invitations) {
  const groups = new Map();
  for (const inv of invitations ?? []) {
    if (inv.kind !== 'delegated' || inv.status !== 'accepted' || !inv.inviter?.userId) continue;
    const { userId, username } = inv.inviter;
    if (!groups.has(userId)) {
      groups.set(userId, { userId, label: username ?? userId.slice(0, 8), invitees: [] });
    }
    groups.get(userId).invitees.push({
      userId: inv.acceptedUserId ?? null,
      username: inv.username ?? '—',
      role: inv.role ?? null,
      fulfilled: inv.fulfilled === true,
    });
  }
  const shown = [...groups.values()];
  for (const group of shown) {
    group.invitees.sort((a, b) => a.username.localeCompare(b.username));
  }
  return shown.sort((a, b) => a.label.localeCompare(b.label));
}
