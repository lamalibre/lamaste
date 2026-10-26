/**
 * OIDC clients → Authelia.
 *
 * Two sources declare clients on the relay's Authelia:
 *
 * - every installed plugin may declare them in its manifest (`oidcClients`,
 *   see the core `ManifestSchema`); only the clients of enabled plugins are
 *   served. Hosting does not matter: an agent-hosted plugin (`hosting:
 *   "agent"`, never imported by the panel) registers its clients exactly as
 *   a server plugin does — the manifest is all this reads;
 * - the panel itself declares the confidential `lamaste-server` client
 *   when the registry credential uses `auth.kind: 'oidc'`.
 *
 * After any plugin lifecycle change, or a registry-credential change, the
 * set is recomputed, the secrets of confidential clients are reconciled
 * (`oidc-clients.json`: minted on first appearance, deleted when a client is
 * gone — a secret belongs to an installed plugin, enabled or not, so
 * disabling a plugin does not rotate it) and Authelia's
 * `identity_providers.oidc` section is written; Authelia is restarted only
 * when the section actually changed.
 *
 * Every client belongs to a domain — its plugin's (the panel's own: the
 * registry credential's issuer domain): `{domain}` in its audience and
 * redirect URIs is that domain, and a user-facing client has its own
 * authorization policy (core `renderOidcClientPolicies`): that domain's
 * members, and its external members granted the client (a Gatekeeper grant
 * `resourceType: 'oidc-client'`, rendered by lib/domains.js into users.yml's
 * owned groups). The provider is written under lib/domains.js
 * `withDomainRendering` — the one writer of what members may do — with the
 * domains read under it.
 *
 * Best effort by design where a plugin lifecycle calls it: a failure here
 * must not fail the plugin operation — the caller logs it and the next
 * lifecycle change retries.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PromiseChainMutex, validateInstalledManifest } from '@lamalibre/lamaste';
import {
  LAMASTE_REGISTRY_OIDC_SCOPES,
  LAMASTE_SERVER_OIDC_CLIENT_ID,
  registryIssuerDomain,
  lamasteServerOidcClient,
  listOidcClientSecrets,
  reconcileOidcClientSecrets,
  readOidcClientSecretDigests,
  rotateOidcClientSecret,
} from '@lamalibre/lamaste/server';

import { updateOidcProvider } from './authelia.js';
import { listGrantsOfType } from './gatekeeper-client.js';
import { OIDC_CLIENT_RESOURCE, isUserFacingOidcClient } from './owned-groups.js';
import { pluginDomainOr, primaryDomainName, withDomainRendering } from './domains.js';
import { readPlugins } from './plugins.js';
import { readRegistryCredentialConfig } from './registry-credential.js';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';

/** The domains a rendering read, as the OIDC provider's policies name them: name and group key. */
const keyed = (domains) => domains.map(({ name, groupKey }) => ({ name, groupKey }));

/**
 * The OIDC clients every installed plugin declares, tagged with the plugin
 * name, its domain and whether the plugin is enabled. Manifests are re-read
 * from the installed packages — the plugin registry does not store them.
 * @returns {Promise<Array<import('@lamalibre/lamaste/server').AutheliaOidcClient & { enabled: boolean }>>}
 */
export async function collectPluginOidcClients() {
  const require = createRequire(`${STATE_DIR}/`);
  const primary = await primaryDomainName();
  const clients = [];
  for (const plugin of (await readPlugins()).plugins) {
    let manifest;
    try {
      const manifestPath = require.resolve(`${plugin.packageName}/lamaste-plugin.json`);
      manifest = validateInstalledManifest(JSON.parse(await readFile(manifestPath, 'utf-8')));
    } catch {
      continue; // an unreadable manifest contributes no clients
    }
    for (const client of manifest.oidcClients) {
      clients.push({
        ...client,
        plugin: manifest.name,
        domain: pluginDomainOr(plugin, primary),
        enabled: plugin.status === 'enabled',
      });
    }
  }
  return clients;
}

/**
 * The panel's own client, when the registry credential (stored, or the
 * candidate being verified) uses it — of the credential's issuer domain.
 * @param {{ registryUrl: string, issuerDomain?: string } | null | undefined} registryAuth
 */
async function lamasteOwnClient(registryAuth) {
  if (!registryAuth) return [];
  const domain = registryIssuerDomain(
    { kind: 'oidc', clientId: LAMASTE_SERVER_OIDC_CLIENT_ID, ...registryAuth },
    await primaryDomainName(),
  );
  return [{ ...lamasteServerOidcClient(registryAuth.registryUrl, domain), enabled: true }];
}

/**
 * A registry credential being set (`PUT /api/registry-credential`): its
 * `registryAuth` while the panel's client is synced, the chain verified and
 * the credential stored. Every sync that names no override serves it — the
 * identity tick's every-minute sync included, which otherwise reads the
 * stored credential, removes the client the candidate needs and restarts
 * Authelia under the verification's token request. Every sync reads it under
 * the one writer ({@link syncOidcClients}), so none can write a plan made
 * before it was set.
 * @type {{ registryUrl: string, issuerDomain?: string } | undefined}
 */
let registryCandidate;
const registryCandidateMutex = new PromiseChainMutex();

/**
 * Run `fn` with `registryAuth` as the candidate registry credential
 * (see {@link registryCandidate}); one candidate at a time. Without one
 * (a pasted token), `fn` just runs.
 * @template T
 * @param {{ registryUrl: string, issuerDomain?: string } | undefined} registryAuth
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withRegistryCandidate(registryAuth, fn) {
  if (registryAuth === undefined) return fn();
  return registryCandidateMutex.run(async () => {
    registryCandidate = registryAuth;
    try {
      return await fn();
    } finally {
      registryCandidate = undefined;
    }
  });
}

/**
 * Everything Authelia should know, from the stored state.
 * @param {{ registryAuth?: { registryUrl: string, issuerDomain?: string } | null }} [overrides]
 *   `registryAuth` replaces the stored registry credential's say in the
 *   matter: `{ registryUrl, issuerDomain }` while a candidate oidc
 *   credential is being verified, `null` to leave the panel's client out.
 */
async function collectAllClients(overrides = {}) {
  let registryAuth;
  if (overrides.registryAuth !== undefined) {
    registryAuth = overrides.registryAuth;
  } else if (registryCandidate !== undefined) {
    registryAuth = registryCandidate;
  } else {
    const stored = await readRegistryCredentialConfig().catch(() => null);
    registryAuth =
      stored && stored.auth.kind === 'oidc'
        ? {
            registryUrl: stored.registryUrl,
            ...(stored.auth.issuerDomain ? { issuerDomain: stored.auth.issuerDomain } : {}),
          }
        : null;
  }
  return [...(await collectPluginOidcClients()), ...(await lamasteOwnClient(registryAuth))];
}

/**
 * What Authelia should serve and which secrets the store should hold, from
 * the stored state: every installed plugin's clients (an installed plugin
 * keeps its confidential-client secret while disabled), the clients of
 * enabled plugins served, and the panel's own scopes when its client is.
 * Pure with respect to Authelia — nothing is written.
 *
 * @param {{ registryAuth?: { registryUrl: string, issuerDomain?: string } | null }} [overrides] see collectAllClients
 * @returns {Promise<{
 *   confidential: Array<{ id: string, plugin: string }>,
 *   served: Array<import('@lamalibre/lamaste/server').AutheliaOidcClient>,
 *   scopes: Record<string, { claims: readonly string[] }>,
 * }>}
 */
export async function planOidcClients(overrides = {}) {
  const all = await collectAllClients(overrides);
  const served = all.filter((c) => c.enabled).map(({ enabled: _enabled, ...client }) => client);
  return {
    confidential: all.filter((c) => c.confidential).map((c) => ({ id: c.id, plugin: c.plugin })),
    served,
    scopes: served.some((c) => c.plugin === 'lamaste') ? LAMASTE_REGISTRY_OIDC_SCOPES : {},
  };
}

/**
 * Sync Authelia's OIDC clients and the secret store with the plugins and
 * the registry credential. Returns what was done, or `null` when the panel
 * has no domain yet (onboarding). Plan, secrets and write all happen under
 * the one writer: a sync that waited for it plans from what is true then,
 * never from before another sync's change (a registry credential being
 * set, a plugin moved).
 *
 * @param {import('pino').Logger} logger
 * @returns {Promise<{ changed: boolean, clients: string[], createdSecrets: Array<{ id: string, plugin: string, secret: string }> } | null>}
 */
export async function syncOidcClients(logger) {
  if (!(await primaryDomainName())) {
    logger.debug('OIDC client sync skipped — no domain configured yet');
    return null;
  }

  const { served, reconciled, result } = await withDomainRendering(
    async (domains) => {
      const plan = await planOidcClients();
      const secrets = await reconcileOidcClientSecrets(STATE_DIR, plan.confidential);
      return {
        served: plan.served,
        reconciled: secrets,
        result: await updateOidcProvider(keyed(domains), plan.served, {
          secretDigests: secrets.digests,
          scopes: plan.scopes,
        }),
      };
    },
    { logger },
  );
  if (reconciled.created.length > 0 || reconciled.removed.length > 0) {
    logger.info(
      { created: reconciled.created.map((c) => c.id), removed: reconciled.removed },
      'OIDC client secrets reconciled',
    );
  }
  if (result.changed) {
    logger.info({ clients: served.map((c) => c.id) }, 'Authelia OIDC provider updated');
  }
  return {
    changed: result.changed,
    clients: served.map((c) => c.id),
    createdSecrets: reconciled.created,
  };
}

/**
 * Metadata of a plugin's OIDC clients: what the manifest declares, whether
 * it is served, whether it signs users in (`userFacing`) and — for those —
 * the Gatekeeper grants on it (`grants`: who among the external members of
 * its domain may sign in with it; members of the domain always may; null
 * when Gatekeeper cannot be read), and — for confidential clients — when
 * the secret was created and last rotated. Never the secret.
 * @param {string} pluginName
 */
export async function listPluginOidcClients(pluginName) {
  const declared = (await collectPluginOidcClients()).filter((c) => c.plugin === pluginName);
  const secrets = new Map((await listOidcClientSecrets(STATE_DIR)).map((m) => [m.id, m]));
  const grants = declared.some(isUserFacingOidcClient)
    ? await listGrantsOfType(OIDC_CLIENT_RESOURCE)
    : null;
  return declared.map((client) => {
    const secret = client.confidential ? (secrets.get(client.id) ?? null) : null;
    return {
      userFacing: isUserFacingOidcClient(client),
      ...(isUserFacingOidcClient(client)
        ? {
            grants: grants?.ok
              ? grants.grants
                  .filter((g) => g.resourceId === client.id)
                  .map((g) => ({
                    grantId: g.grantId,
                    principalType: g.principalType,
                    principalId: g.principalId,
                    createdAt: g.createdAt,
                  }))
              : null,
          }
        : {}),
      id: client.id,
      name: client.name ?? null,
      confidential: client.confidential,
      grantTypes: client.grantTypes,
      scopes: client.scopes,
      audience: client.audience,
      accessTokenClaims: client.accessTokenClaims,
      enabled: client.enabled,
      secretCreatedAt: secret?.createdAt ?? null,
      secretRotatedAt: secret?.rotatedAt ?? null,
    };
  });
}

/**
 * Replace the secret of one of a plugin's confidential clients and write
 * the new digest to Authelia. Returns the new secret — the only time it is
 * shown. Throws with `statusCode` 404 for an unknown client and 400 for a
 * public one.
 * @param {string} pluginName
 * @param {string} clientId
 * @param {import('pino').Logger} logger
 */
export async function rotatePluginOidcClientSecret(pluginName, clientId, logger) {
  const client = (await collectPluginOidcClients()).find(
    (c) => c.plugin === pluginName && c.id === clientId,
  );
  if (!client) {
    throw Object.assign(new Error(`Plugin "${pluginName}" declares no OIDC client "${clientId}"`), {
      statusCode: 404,
    });
  }
  if (!client.confidential) {
    throw Object.assign(new Error(`OIDC client "${clientId}" is public and has no secret`), {
      statusCode: 400,
    });
  }
  // The store is reconciled first so a client that was never synced (an
  // earlier Authelia failure) gets its record now.
  await syncOidcClients(logger);
  // Rotate, plan and write under the one writer (see syncOidcClients).
  const rotated = await withDomainRendering(
    async (domains) => {
      const secret = await rotateOidcClientSecret(STATE_DIR, clientId);
      if (client.enabled) {
        const { served, scopes } = await planOidcClients();
        await updateOidcProvider(keyed(domains), served, {
          secretDigests: await readOidcClientSecretDigests(STATE_DIR),
          scopes,
        });
      }
      return secret;
    },
    { logger },
  );
  logger.info({ plugin: pluginName, clientId }, 'OIDC client secret rotated');
  return {
    id: rotated.id,
    plugin: rotated.plugin,
    secret: rotated.secret,
    rotatedAt: rotated.rotatedAt,
  };
}
