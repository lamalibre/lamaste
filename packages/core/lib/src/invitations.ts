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
import {
  INVITATION_POLICY_LIMITS,
  INVITATION_POLICY_MAX_EMAIL_DOMAINS,
} from './invitation-limits.js';
import type {
  InvitationKind,
  InvitationRevokeReason,
  InvitationStatus,
} from './invitation-limits.js';
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

// The policy's bounds, the statuses and the reasons: invitation-limits.ts,
// which the panel's UI imports on its own.
export {
  INVITATION_KINDS,
  INVITATION_POLICY_LIMITS,
  INVITATION_POLICY_MAX_EMAIL_DOMAINS,
  INVITATION_REVOKE_REASONS,
  INVITATION_REVOKE_REASON_TEXT,
  INVITATION_STATUSES,
} from './invitation-limits.js';
export type {
  InvitationKind,
  InvitationRevokeReason,
  InvitationStatus,
} from './invitation-limits.js';

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

const TokenSchema = z.string().regex(INVITATION_TOKEN_RE);

/**
 * `POST /api/invite/lookup` — the token travels in the body, never in a
 * URL a log keeps (the link carries it in its fragment).
 */
export const InvitationLookupSchema = z.object({ token: TokenSchema }).strict();

/** `POST /api/invite/accept` for an administrator's invitation: the username was chosen for them. */
export const AdminAcceptanceSchema = z
  .object({ token: TokenSchema, password: z.string().min(8).max(128) })
  .strict();

export type AdminAcceptance = z.output<typeof AdminAcceptanceSchema>;

/** `POST /api/invite/accept` for a delegated invitation: the invitee picks their username. */
export const DelegatedAcceptanceSchema = z
  .object({
    token: TokenSchema,
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

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** What `POST /api/invite/lookup` tells whoever holds a link. */
export type InvitationLookup =
  | {
      readonly kind: 'admin';
      readonly username: string;
      readonly email: string;
      readonly expiresAt: string;
    }
  | {
      readonly kind: 'delegated';
      readonly email: string;
      readonly displayName: string | null;
      /** The plugin's display name. */
      readonly plugin: string;
      /** The role's label. */
      readonly role: string;
      /** The inviter's display name, or null — never their username. */
      readonly invitedBy: string | null;
      readonly expiresAt: string;
      readonly suggestedUsername: string | null;
    };

/** An invitation as the administrator lists it (`GET /api/invitations`). */
export interface InvitationAdminView {
  readonly id: string;
  readonly kind: InvitationKind;
  /** An admin invitation's; a delegated one's once its invitee claimed one. */
  readonly username: string | null;
  /** Null once accepted (the directory holds it). */
  readonly email: string | null;
  readonly displayName: string | null;
  readonly emailDomain: string;
  readonly groups: readonly string[];
  readonly domains: readonly { readonly name: string; readonly kind: 'member' | 'external' }[];
  /** Delegated: the plugin, the role, the inviter. */
  readonly plugin: string | null;
  readonly role: string | null;
  readonly inviter: { readonly userId: string; readonly username: string | null } | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: InvitationStatus;
  readonly revokedReason: InvitationRevokeReason | null;
  readonly acceptedAt: string | null;
  readonly acceptedUserId: string | null;
  /** Accepted, and (delegated) every grant made. */
  readonly fulfilled: boolean;
  /** 4.8's field: accepted. */
  readonly used: boolean;
}

/** Filters of `GET /api/invitations`. */
export interface InvitationListFilter {
  readonly plugin?: string;
  /** The inviter's user id. */
  readonly inviter?: string;
  readonly kind?: InvitationKind;
  /** At most this many, newest first (default 500, at most 2000). */
  readonly limit?: number;
}

/** An invitation as its inviter sees it on the inviter's page. */
export interface InvitationInviterView {
  readonly id: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly role: string;
  readonly roleLabel: string;
  readonly status: InvitationStatus;
  readonly revokedReason: InvitationRevokeReason | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly acceptedAt: string | null;
}

/** `GET /api/delegated-invitations/<route>` — what the inviter's page shows. */
export interface InviterOverview {
  readonly plugin: { readonly displayName: string; readonly siteUrl: string };
  readonly policy: {
    readonly grantableRoles: readonly { readonly id: string; readonly label: string }[];
    readonly emailDomains: readonly string[];
    readonly lifetimeDays: number;
    readonly maxOpen: number;
    readonly open: number;
  };
  readonly invitations: readonly InvitationInviterView[];
}

/** A plugin's policy as the administrator reads it (`GET /api/plugins/:name/invitation-policy`). */
export interface InvitationPolicyView extends InvitationPolicy {
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
  /** Whether the plugin can be invited into now, and why not. */
  readonly available: boolean;
  readonly unavailableReason: string | null;
  /** Its roles that may invite, with the roles each may give. */
  readonly invitingRoles: readonly { readonly role: string; readonly invites: readonly string[] }[];
  /** On a change: what the administrator should know (the grant table's room). */
  readonly warnings?: readonly { readonly step: string; readonly message: string }[];
}
