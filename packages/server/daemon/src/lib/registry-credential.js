/**
 * Registry credential (Feria) — daemon shim over `@lamalibre/lamaste/server`.
 *
 * Binds the core module to this daemon's state directory and holds the
 * per-process state the core keeps pure:
 *
 * - the panel's own registry token (`RegistryServiceTokenCache`): a pasted
 *   token as is, or — with `auth.kind: 'oidc'` — a Feria token obtained
 *   through Authelia's client-credentials grant and reused until five
 *   minutes before it expires;
 * - one brokered token per agent (`AgentTokenBroker`), reused for every
 *   install within the hour and limited to ten new tokens per agent per
 *   hour.
 *
 * The panel's own npm calls — installing a plugin, staging an update with
 * `npm pack`, pinning an agent half with `npm view` — go through
 * {@link withRegistryUserconfig}: with a credential configured, npm is
 * routed to its registry for its scope and authenticated with the service
 * token through a throw-away userconfig; without one, npm runs as it is
 * configured on the machine (the public registry by default).
 *
 * Also the one piece of policy that belongs here: when a user loses a
 * `feria-*` group or is deleted, their registry tokens are revoked (best
 * effort, never blocks the user operation).
 */

import {
  readRegistryCredentialConfig as readCore,
  writeRegistryCredentialConfig as writeCore,
  clearRegistryCredentialConfig as clearCore,
  verifyRegistryCredential as verifyCore,
  brokerAgentRegistryToken,
  revokeRegistryTokensForOwner,
  lostFeriaGroups,
  readOidcClientSecret,
  withRegistryUserconfig as withRegistryUserconfigCore,
  RegistryServiceTokenCache,
  AgentTokenBroker,
  RegistryCredentialError,
  LAMASTE_SERVER_OIDC_CLIENT_ID,
} from '@lamalibre/lamaste/server';

import { getConfig } from './config.js';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';

const serviceTokens = new RegistryServiceTokenCache();
const agentTokens = new AgentTokenBroker();

export function readRegistryCredentialConfig() {
  return readCore(STATE_DIR);
}

/** Store a credential and forget every token obtained with the previous one. */
export async function writeRegistryCredentialConfig(config) {
  await writeCore(STATE_DIR, config);
  resetRegistryTokenState();
}

/**
 * Store `config` as the registry credential: written while its issuer
 * domain is still an active domain (a domain's removal checks the
 * credential under the same lock — 400 `unknown_domain` otherwise). When the
 * registry's domains change (its issuer domain, the domain its host is
 * under), the tokens of every user who is a member of none of the new ones
 * are revoked: who may hold a token follows them. Returns the warnings.
 *
 * @param {object} config
 * @param {{ logger?: import('pino').Logger }} [opts]
 * @returns {Promise<Array<{ step: string, message: string }>>}
 */
export async function setRegistryCredential(config, { logger } = {}) {
  const { registryDomainsOf, revokeRegistryTokensOutside, withActiveDomain } =
    await import('./domains.js');
  const issuerDomain = config.auth?.kind === 'oidc' ? config.auth.issuerDomain : undefined;
  const change = await withActiveDomain(issuerDomain, async () => {
    const before = await registryDomainsOf(await readRegistryCredentialConfig().catch(() => null));
    await writeRegistryCredentialConfig(config);
    const after = await registryDomainsOf(config);
    const same = after.length === before.length && after.every((d) => before.includes(d));
    return { changed: !same, after };
  });
  if (!change.changed) return [];
  return revokeRegistryTokensOutside(change.after, config, logger);
}

export async function clearRegistryCredentialConfig() {
  const removed = await clearCore(STATE_DIR);
  resetRegistryTokenState();
  return removed;
}

/** Drop the cached service token and every agent's cached token and issuance record. */
export function resetRegistryTokenState() {
  serviceTokens.invalidate();
  agentTokens.reset();
}

/**
 * What the core needs to run the OIDC chain for a credential: the primary
 * domain (the issuer when the credential names no `issuerDomain`) and the
 * `lamaste-server` client secret. Pasted-token credentials need nothing.
 * @param {{ auth: { kind: string } }} config
 */
async function oidcDeps(config) {
  if (config.auth.kind !== 'oidc') return {};
  const domain = getConfig().domain;
  if (!domain) {
    throw new RegistryCredentialError(
      'the panel has no domain yet — complete onboarding first',
      503,
    );
  }
  const clientSecret = await readOidcClientSecret(STATE_DIR, LAMASTE_SERVER_OIDC_CLIENT_ID);
  if (!clientSecret) {
    throw new RegistryCredentialError(
      `the ${LAMASTE_SERVER_OIDC_CLIENT_ID} OIDC client has no secret yet — set the registry credential again`,
      500,
    );
  }
  return { oidc: { domain, clientSecret } };
}

/**
 * Verify a candidate credential end to end (for `oidc`: Authelia token
 * endpoint → Feria login → whoami with the read and admin scopes). The
 * `lamaste-server` client must already be in Authelia — the route syncs it
 * first.
 * @param {{ registryUrl: string, auth: { kind: 'token', token: string } | { kind: 'oidc', clientId: string } }} candidate
 */
export async function verifyRegistryCredential(candidate) {
  return verifyCore(candidate, await oidcDeps(candidate));
}

/** The panel's registry token for the stored credential (cached per process). */
async function serviceToken(config) {
  return (await serviceTokens.resolve(config, await oidcDeps(config))).token;
}

/**
 * Run `fn(env)` — one npm call of the panel's own — against the configured
 * registry: with a credential, `env` names an isolated userconfig (0600,
 * removed afterwards) routing the credential's scope to its registry with
 * the panel's service token; a `401` refreshes the token once and retries.
 * Without a credential `fn({})` runs npm as the machine configures it.
 * A credential file that cannot be read fails the call rather than
 * silently installing from the public registry.
 *
 * @template T
 * @param {(env: Record<string, string>) => Promise<T>} fn
 * @param {{ log?: import('pino').Logger | undefined }} [options]
 * @returns {Promise<T>}
 */
export async function withRegistryUserconfig(fn, options = {}) {
  const config = await readRegistryCredentialConfig();
  if (!config) return fn({});
  const deps = await oidcDeps(config);
  return withRegistryUserconfigCore(
    config,
    async ({ refresh }) => {
      if (refresh) serviceTokens.invalidate();
      return (await serviceTokens.resolve(config, deps)).token;
    },
    fn,
    { log: options.log },
  );
}

/**
 * The calling agent's registry token: the cached one when it is still good
 * for an install, otherwise a freshly brokered one-hour token — unless the
 * agent already had ten new tokens this hour. `null` when no credential is
 * configured. Throws RegistryCredentialError (with `statusCode`) when the
 * registry refuses.
 * @param {string} agentLabel
 * @returns {Promise<import('@lamalibre/lamaste/server').AgentTokenAcquisition | null>}
 */
export async function acquireAgentToken(agentLabel) {
  const config = await readRegistryCredentialConfig();
  if (!config) return null;
  return agentTokens.acquire(agentLabel, async () =>
    brokerAgentRegistryToken(config, agentLabel, { serviceToken: await serviceToken(config) }),
  );
}

/**
 * Revoke a user's registry tokens after their `feria-*` groups changed or
 * they were offboarded (`{ deleted: true }`: disabled or removed). Returns
 * the number revoked, or `null` when nothing needed doing (no credential
 * configured, or no feria group lost). The registry knows the user by
 * username (`user:<username>`); the log line names them by `userId` alone.
 *
 * @param {string} username
 * @param {{ before: string[], after: string[] } | { deleted: true }} change
 * @param {import('pino').Logger | undefined} log
 * @param {{ userId?: string | null, config?: object }} [who] `config`: the credential
 *   already read (a batch of revocations reads it once)
 */
export async function revokeUserRegistryTokens(
  username,
  change,
  log,
  { userId = null, config: given } = {},
) {
  const config = given ?? (await readRegistryCredentialConfig());
  if (!config) return null;

  const lost =
    'deleted' in change ? ['(deleted)'] : lostFeriaGroups(change.before ?? [], change.after ?? []);
  if (lost.length === 0) return null;

  const owner = `user:${username}`;
  const revoked = await revokeRegistryTokensForOwner(config, owner, {
    serviceToken: await serviceToken(config),
  });
  log?.info({ userId, lost, revoked }, 'Revoked a user’s registry tokens');
  return revoked;
}
