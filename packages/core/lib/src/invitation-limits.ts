/**
 * Delegated invitations: the policy's bounds, the statuses an invitation can
 * show and why one was revoked — on their own, without node's modules, so
 * the panel's UI can import them (`@lamalibre/lamaste/invitation-limits`)
 * instead of copying them. The rest of the contract is `invitations.ts`.
 */

/** At most this many e-mail domains in one plugin's policy. */
export const INVITATION_POLICY_MAX_EMAIL_DOMAINS = 20;

/** The policy's bounds and defaults. */
export const INVITATION_POLICY_LIMITS = {
  maxOpenPerInviter: { min: 1, max: 100, default: 10 },
  maxJoined: { min: 1, max: 500, default: 50 },
  lifetimeDays: { min: 1, max: 30, default: 7 },
} as const;

export const INVITATION_KINDS = ['admin', 'delegated'] as const;
export type InvitationKind = (typeof INVITATION_KINDS)[number];

/** What an invitation shows: `expired` is a pending one past its expiry. */
export const INVITATION_STATUSES = [
  'pending',
  'expired',
  'accepting',
  'accepted',
  'revoked',
] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** Why an invitation was revoked. */
export const INVITATION_REVOKE_REASONS = [
  'inviter',
  'admin',
  'inviter_disabled',
  'inviter_removed',
  'inviter_unentitled',
  'policy_disabled',
  'email_domain_removed',
  'plugin_removed',
  'role_undeclared',
  'surface_removed',
  'surface_not_restricted',
  'attempts_exhausted',
  'repair_abandoned',
  'superseded',
] as const;
export type InvitationRevokeReason = (typeof INVITATION_REVOKE_REASONS)[number];

/** Why an invitation was revoked, in words — what the panel and the CLI show. */
export const INVITATION_REVOKE_REASON_TEXT: Readonly<Record<InvitationRevokeReason, string>> = {
  inviter: 'revoked by the inviter',
  admin: 'revoked by an administrator',
  inviter_disabled: 'the inviter was disabled',
  inviter_removed: 'the inviter was removed',
  inviter_unentitled: 'the inviter lost the role that could give it',
  policy_disabled: "the plugin's invitations were turned off",
  email_domain_removed: 'its e-mail domain is no longer allowed',
  plugin_removed: 'the plugin was uninstalled',
  role_undeclared: 'the plugin no longer has this role',
  surface_removed: "the plugin's web surface was removed",
  surface_not_restricted: "the plugin's web surface is no longer restricted",
  attempts_exhausted: 'too many failed attempts locked the link',
  repair_abandoned: 'access could not be completed',
  superseded: 'replaced by a newer invitation',
};
