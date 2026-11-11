/**
 * A person's own account on a domain's sign-in host
 * (packages/core/docs/mail-design.md §6): forgetting a password and
 * changing it while signed in. Lamaste's, never Authelia's — the panel is
 * the only writer of users.yml (decision D4).
 *
 * Browser-safe: the paths, the token's shape and the request bodies.
 */

import { z } from 'zod';

import { assertDomainName } from './domains.js';
import { hasControlCharacters } from './text-rules.js';

/** The forgot-password page on every auth host: `https://auth.<domain>/reset`. */
export const AUTH_RESET_PATH = '/reset';

/** The change-password page on every auth host (behind Authelia's forward auth). */
export const AUTH_ACCOUNT_PASSWORD_PATH = '/account/password';

/** The forgot-password API on every auth host (no mTLS, like `/api/invite/`). */
export const PASSWORD_RESET_API = Object.freeze({
  start: '/api/account/reset/start',
  lookup: '/api/account/reset/lookup',
  finish: '/api/account/reset/finish',
} as const);

/** The change-password API (behind Authelia's forward auth, as its page). */
export const ACCOUNT_PASSWORD_API_PATH = '/api/account/password';

/** Where Google sends the relay's consent back to, on the primary auth host only. */
export const MAIL_GOOGLE_CALLBACK_PATH = '/mail/google/callback';

/** `https://auth.<domain>/reset`. */
export function authResetUrl(domain: string): string {
  assertDomainName(domain);
  return `https://auth.${domain}${AUTH_RESET_PATH}`;
}

/** The redirect URI registered in the Google OAuth client: `https://auth.<primary>/mail/google/callback`. */
export function mailGoogleRedirectUri(primaryDomain: string): string {
  assertDomainName(primaryDomain);
  return `https://auth.${primaryDomain}${MAIL_GOOGLE_CALLBACK_PATH}`;
}

/** A reset link is good for this long. */
export const PASSWORD_RESET_TTL_MINUTES = 30;

/** Wrong codes or passwords that void a reset token. */
export const PASSWORD_RESET_MAX_FAILURES = 5;

/** A reset token as its link carries it: 32 random bytes, hex. */
export const PASSWORD_RESET_TOKEN_RE = /^[a-f0-9]{64}$/;

/** A password Lamaste writes: as an invitation's (8–128 characters). */
export const ACCOUNT_PASSWORD_MIN_LENGTH = 8;
export const ACCOUNT_PASSWORD_MAX_LENGTH = 128;

const NewPasswordSchema = z
  .string()
  .min(ACCOUNT_PASSWORD_MIN_LENGTH)
  .max(ACCOUNT_PASSWORD_MAX_LENGTH);

const TokenSchema = z.string().regex(PASSWORD_RESET_TOKEN_RE);

/** `POST /api/account/reset/start` — a username or an address, as typed. */
export const PasswordResetStartSchema = z
  .object({
    identifier: z
      .string()
      .trim()
      .min(1)
      .max(254)
      .refine((s) => !hasControlCharacters(s), 'Contains control characters'),
  })
  .strict();
export type PasswordResetStart = z.output<typeof PasswordResetStartSchema>;

/** `POST /api/account/reset/lookup` — the token in the body, never in a URL. */
export const PasswordResetLookupSchema = z.object({ token: TokenSchema }).strict();

/** `POST /api/account/reset/finish` — a current TOTP code required (Q2). */
export const PasswordResetFinishSchema = z
  .object({
    token: TokenSchema,
    password: NewPasswordSchema,
    totp: z.string().regex(/^\d{6}$/),
  })
  .strict();
export type PasswordResetFinish = z.output<typeof PasswordResetFinishSchema>;

/** `POST /api/account/password` — signed in, two-factor. */
export const PasswordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(ACCOUNT_PASSWORD_MAX_LENGTH),
    newPassword: NewPasswordSchema,
  })
  .strict();
export type PasswordChange = z.output<typeof PasswordChangeSchema>;
