/**
 * What Authelia keeps per user outside users.yml — in its own storage
 * database, under the username — and what Lamaste does about it.
 *
 * Authelia's storage keys a user's second factors (TOTP configuration,
 * WebAuthn credentials) and the opaque identifiers it gives OpenID Connect
 * relying parties (the `sub` claim) by username. A user created later under
 * the same username would inherit the second factors — and every relying
 * party would take them for the earlier user, since their `sub` is the
 * same. So:
 *
 * - when a user is deleted (and again before a user is created under a
 *   username a removed user held), their TOTP configuration and WebAuthn
 *   credentials are deleted ({@link purgeAutheliaSecondFactors});
 * - a username Authelia holds an opaque identifier for is never given to a
 *   new user ({@link autheliaHoldsOpaqueIdentifier}): Authelia 4.39 has no
 *   way to delete one (`authelia storage user identifiers` offers add,
 *   export, generate and import only), so it stays, and with it the
 *   username's identity at every relying party.
 *
 * And a password reset by mail asks for a current TOTP code
 * (packages/core/docs/mail-design.md §6.2), checked against the user's
 * configuration without the secret ever leaving the helper
 * ({@link verifyAutheliaTotp}).
 *
 * All run through the root helper (`sudo lamaste-priv authelia-user …`),
 * which runs Authelia's own CLI as the Authelia service account with its
 * configuration and storage encryption key — the panel never reads the
 * database. Neither ever logs or returns more than the outcome.
 */

import type { ExecFn } from './authelia.js';

const PRIV = '/usr/local/sbin/lamaste-priv';

/** The helper's verbs; must match `scripts/lamaste-priv` in create-lamaste. */
const AUTHELIA_USER_PRIV_VERB = 'authelia-user';
const AUTHELIA_PURGE_FACTORS_ACTION = 'purge-second-factors';
const AUTHELIA_OIDC_IDENTIFIER_ACTION = 'has-oidc-identifier';
const AUTHELIA_VERIFY_TOTP_ACTION = 'verify-totp';

/** A TOTP code as the helper takes it: 6 to 8 digits. */
export const TOTP_CODE_RE = /^[0-9]{6,8}$/;

/**
 * Delete `username`'s TOTP configuration and every WebAuthn credential from
 * Authelia's storage. Idempotent: a user with neither is fine. Throws when
 * the helper fails (its message, which never carries a secret).
 */
export async function purgeAutheliaSecondFactors(username: string, exec: ExecFn): Promise<void> {
  await exec('sudo', [PRIV, AUTHELIA_USER_PRIV_VERB, AUTHELIA_PURGE_FACTORS_ACTION, username], {
    timeout: 150_000,
  });
}

/**
 * Whether Authelia's storage holds an OpenID Connect opaque identifier for
 * `username` — whether any relying party knows a user by that username's
 * subject. Throws when the helper fails or answers anything but `yes` or
 * `no`.
 */
export async function autheliaHoldsOpaqueIdentifier(
  username: string,
  exec: ExecFn,
): Promise<boolean> {
  const result = await exec(
    'sudo',
    [PRIV, AUTHELIA_USER_PRIV_VERB, AUTHELIA_OIDC_IDENTIFIER_ACTION, username],
    { timeout: 90_000 },
  );
  const answer = (result.stdout ?? '').trim();
  if (answer === 'yes') return true;
  if (answer === 'no') return false;
  throw new Error('lamaste-priv answered the opaque identifier check with neither yes nor no');
}

/**
 * What {@link verifyAutheliaTotp} found: `ok` with the time step the code
 * matched (the caller refuses a step it already accepted — Authelia's own
 * replay history is not consulted), or `no` — a wrong code, or no TOTP
 * configuration for the user at all (the two are not told apart).
 */
export type AutheliaTotpVerdict =
  | { readonly ok: true; readonly step: number }
  | { readonly ok: false };

/**
 * Check a TOTP `code` against `username`'s configuration in Authelia's
 * storage (one step either side of now, the configuration's own
 * algorithm, digits and period). The root helper reads the configuration
 * with Authelia's CLI as the Authelia account and answers `ok <step>` or
 * `no`; the secret never leaves it and the code travels on stdin. Throws
 * when the helper fails or answers anything else.
 */
export async function verifyAutheliaTotp(
  username: string,
  code: string,
  exec: ExecFn,
): Promise<AutheliaTotpVerdict> {
  if (!TOTP_CODE_RE.test(code)) return { ok: false };
  const result = await exec(
    'sudo',
    [PRIV, AUTHELIA_USER_PRIV_VERB, AUTHELIA_VERIFY_TOTP_ACTION, username],
    { timeout: 60_000, input: code },
  );
  const answer = (result.stdout ?? '').trim();
  if (answer === 'no') return { ok: false };
  const match = /^ok ([0-9]{1,15})$/.exec(answer);
  if (match?.[1] === undefined) {
    throw new Error('lamaste-priv answered the TOTP check with neither ok nor no');
  }
  return { ok: true, step: Number(match[1]) };
}
