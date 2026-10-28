/**
 * Delegated invitations — a user holding an inviting role of an
 * agent-hosted app plugin (`identity.roles[].invites`) invites colleagues
 * into that plugin, with one of its roles, without the relay's
 * administrator. See `packages/core/docs/delegated-invitations-design.md`.
 *
 * What lives here is the contract the panel, its UI and the CLI share: the
 * limits, the administrator's policy for one plugin, an inviter's request,
 * an invitee's acceptance, and the statuses and revocation reasons an
 * invitation can show. Parsers say nothing about why a value failed beyond
 * the field: the values are addresses and names.
 */

import { z } from 'zod';

import { DomainNameSchema } from './domains.js';
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_REGEX } from './constants.js';
import {
  IDENTITY_DISPLAY_NAME_MAX_LENGTH,
  IDENTITY_EMAIL_MAX_LENGTH,
  IDENTITY_ROLE_ID_REGEX,
} from './identity.js';
import { displayText } from './plugin-settings.js';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** An invitation token's length in bytes (hex in the link: twice as many characters). */
export const INVITATION_TOKEN_BYTES = 32;

/** An invitation token as a link carries it: 64 lower-case hex characters. */
export const INVITATION_TOKEN_RE = /^[a-f0-9]{64}$/;

/** At most this many e-mail domains in one plugin's policy. */
export const INVITATION_POLICY_MAX_EMAIL_DOMAINS = 20;

/** The policy's bounds and defaults. */
export const INVITATION_POLICY_LIMITS = {
  maxOpenPerInviter: { min: 1, max: 100, default: 10 },
  maxJoined: { min: 1, max: 500, default: 50 },
  lifetimeDays: { min: 1, max: 30, default: 7 },
} as const;

/** Delegated invitations one inviter may make in an hour, revoked ones included. */
export const INVITATIONS_PER_INVITER_PER_HOUR = 30;

/** No delegated invitation is made or accepted while Gatekeeper has fewer free grants. */
export const INVITATION_GRANT_RESERVE = 100;

/** Refused acceptances that lock a link. */
export const INVITATION_MAX_FAILED_ATTEMPTS = 5;

/** An acceptance claimed this long ago and not finished is resolved by the panel. */
export const INVITATION_ACCEPTING_STALE_MS = 10 * 60 * 1000;

/** How long the panel keeps completing an acceptance's grants. */
export const INVITATION_REPAIR_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Invitations that ended without acceptance are deleted this long after they ended. */
export const INVITATION_RETENTION_DAYS = 90;

/** The largest request body of the inviter's API. */
export const DELEGATED_INVITATIONS_BODY_LIMIT = 8 * 1024;

// ---------------------------------------------------------------------------
// Statuses and reasons
// ---------------------------------------------------------------------------

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
] as const;
export type InvitationRevokeReason = (typeof INVITATION_REVOKE_REASONS)[number];

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const EmailSchema = z.string().trim().max(IDENTITY_EMAIL_MAX_LENGTH).email();

const DisplayNameSchema = displayText(
  z.string().trim().min(1).max(IDENTITY_DISPLAY_NAME_MAX_LENGTH),
);

const UsernameSchema = z
  .string()
  .min(USERNAME_MIN_LENGTH)
  .max(USERNAME_MAX_LENGTH)
  .regex(USERNAME_REGEX);

/**
 * The domain of an e-mail address, lower case — what a policy's
 * `emailDomains` is compared with. Null for anything without one.
 */
export function emailDomainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/**
 * A username suggested from an address's local part: lower case, every run
 * of other characters made one `-`, trimmed to the username rule — or null
 * when nothing valid is left.
 */
export function suggestedUsername(email: string): string | null {
  const local = email.slice(0, Math.max(0, email.lastIndexOf('@'))).toLowerCase();
  const cleaned = local
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+/, '')
    .slice(0, USERNAME_MAX_LENGTH)
    .replace(/[-_]+$/, '');
  return UsernameSchema.safeParse(cleaned).success ? cleaned : null;
}

// ---------------------------------------------------------------------------
// The administrator's policy
// ---------------------------------------------------------------------------

const { maxOpenPerInviter, maxJoined, lifetimeDays } = INVITATION_POLICY_LIMITS;

/**
 * `PUT /api/plugins/:name/invitation-policy` — the whole policy; omitted
 * bounds take their defaults. Enabling needs at least one e-mail domain.
 */
export const InvitationPolicyInputSchema = z
  .object({
    enabled: z.boolean(),
    emailDomains: z
      .array(DomainNameSchema)
      .max(INVITATION_POLICY_MAX_EMAIL_DOMAINS)
      .transform((domains) => [...new Set(domains)].sort()),
    maxOpenPerInviter: z
      .number()
      .int()
      .min(maxOpenPerInviter.min)
      .max(maxOpenPerInviter.max)
      .default(maxOpenPerInviter.default),
    maxJoined: z.number().int().min(maxJoined.min).max(maxJoined.max).default(maxJoined.default),
    lifetimeDays: z
      .number()
      .int()
      .min(lifetimeDays.min)
      .max(lifetimeDays.max)
      .default(lifetimeDays.default),
  })
  .strict()
  .refine((policy) => !policy.enabled || policy.emailDomains.length > 0, {
    message: 'Invitations can be enabled only with at least one e-mail domain',
    path: ['emailDomains'],
  });

export type InvitationPolicyInput = z.input<typeof InvitationPolicyInputSchema>;
export type InvitationPolicy = z.output<typeof InvitationPolicyInputSchema>;

/** The policy of a plugin nobody has set: off. */
export const DEFAULT_INVITATION_POLICY: InvitationPolicy = Object.freeze({
  enabled: false,
  emailDomains: [],
  maxOpenPerInviter: maxOpenPerInviter.default,
  maxJoined: maxJoined.default,
  lifetimeDays: lifetimeDays.default,
}) as InvitationPolicy;

// ---------------------------------------------------------------------------
// The inviter's request and the invitee's acceptance
// ---------------------------------------------------------------------------

/** `POST /api/delegated-invitations/<route>` — one address, a name for them, one role. */
export const DelegatedInvitationRequestSchema = z
  .object({
    email: EmailSchema,
    displayName: DisplayNameSchema.optional(),
    role: z.string().regex(IDENTITY_ROLE_ID_REGEX),
  })
  .strict();

export type DelegatedInvitationRequest = z.output<typeof DelegatedInvitationRequestSchema>;

/** `POST /api/invite/:token/accept` for a delegated invitation. */
export const DelegatedAcceptanceSchema = z
  .object({
    username: UsernameSchema,
    displayName: DisplayNameSchema,
    password: z.string().min(8).max(128),
  })
  .strict();

export type DelegatedAcceptance = z.output<typeof DelegatedAcceptanceSchema>;

/**
 * The field a schema of this module refused — never its message (zod's
 * may repeat the value): `email`, `role`, … or null.
 */
export function refusedField(error: z.ZodError): string | null {
  const first = error.issues[0];
  const key = first?.path[0];
  return typeof key === 'string' ? key : null;
}
