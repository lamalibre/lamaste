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
 * Best effort by design where a plugin lifecycle calls it: a failure here
 * must not fail the plugin operation — the caller logs it and the next
 * lifecycle change retries.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { validateManifest } from '@lamalibre/lamaste';
import {
  LAMASTE_REGISTRY_OIDC_SCOPES,
  lamasteServerOidcClient,
  listOidcClientSecrets,
  reconcileOidcClientSecrets,
  readOidcClientSecretDigests,
  rotateOidcClientSecret,
} from '@lamalibre/lamaste/server';

import { getConfig } from './config.js';
import { updateOidcProvider } from './authelia.js';
import { readPlugins } from './plugins.js';
import { readRegistryCredentialConfig } from './registry-credential.js';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';

/**
 * The OIDC clients every installed plugin declares, tagged with the plugin
 * name and whether the plugin is enabled. Manifests are re-read from the
 * installed packages — the plugin registry does not store them.
 * @returns {Promise<Array<import('@lamalibre/lamaste/server').AutheliaOidcClient & { enabled: boolean }>>}
 */
export async function collectPluginOidcClients() {
  const require = createRequire(`${STATE_DIR}/`);
  const clients = [];
  for (const plugin of (await readPlugins()).plugins) {
    let manifest;
    try {
      const manifestPath = require.resolve(`${plugin.packageName}/lamaste-plugin.json`);
      manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf-8')));
    } catch {
      continue; // an unreadable manifest contributes no clients
    }
    for (const client of manifest.oidcClients) {
      clients.push({ ...client, plugin: manifest.name, enabled: plugin.status === 'enabled' });
    }
  }
  return clients;
}

/**
 * The panel's own client, when the registry credential (stored, or the
 * candidate being verified) uses it.
 * @param {{ registryUrl: string } | null | undefined} registryAuth
 */
function lamasteOwnClient(registryAuth) {
  if (!registryAuth) return [];
  return [{ ...lamasteServerOidcClient(registryAuth.registryUrl), enabled: true }];
}

/**
 * Everything Authelia should know, from the stored state.
 * @param {{ registryAuth?: { registryUrl: string } | null }} [overrides]
 *   `registryAuth` replaces the stored registry credential's say in the
 *   matter: `{ registryUrl }` while a candidate oidc credential is being
 *   verified, `null` to leave the panel's client out.
 */
async function collectAllClients(overrides = {}) {
  let registryAuth;
  if (overrides.registryAuth !== undefined) {
    registryAuth = overrides.registryAuth;
  } else {
    const stored = await readRegistryCredentialConfig().catch(() => null);
    registryAuth =
      stored && stored.auth.kind === 'oidc' ? { registryUrl: stored.registryUrl } : null;
  }
  return [...(await collectPluginOidcClients()), ...lamasteOwnClient(registryAuth)];
}

/**
 * What Authelia should serve and which secrets the store should hold, from
 * the stored state: every installed plugin's clients (an installed plugin
 * keeps its confidential-client secret while disabled), the clients of
 * enabled plugins served, and the panel's own scopes when its client is.
 * Pure with respect to Authelia — nothing is written.
 *
 * @param {{ registryAuth?: { registryUrl: string } | null }} [overrides] see collectAllClients
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
 * has no domain yet (onboarding).
 *
 * @param {import('pino').Logger} logger
 * @param {{ registryAuth?: { registryUrl: string } | null }} [overrides] see collectAllClients
 * @returns {Promise<{ changed: boolean, clients: string[], createdSecrets: Array<{ id: string, plugin: string, secret: string }> } | null>}
 */
export async function syncOidcClients(logger, overrides = {}) {
  let domain = null;
  try {
    domain = getConfig().domain;
  } catch {
    domain = null;
  }
  if (!domain) {
    logger.debug('OIDC client sync skipped — no domain configured yet');
    return null;
  }

  const { confidential, served, scopes } = await planOidcClients(overrides);
  const reconciled = await reconcileOidcClientSecrets(STATE_DIR, confidential);
  if (reconciled.created.length > 0 || reconciled.removed.length > 0) {
    logger.info(
      { created: reconciled.created.map((c) => c.id), removed: reconciled.removed },
      'OIDC client secrets reconciled',
    );
  }

  const result = await updateOidcProvider(domain, served, {
    secretDigests: reconciled.digests,
    scopes,
  });
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
 * it is served, and — for confidential clients — when the secret was
 * created and last rotated. Never the secret.
 * @param {string} pluginName
 */
export async function listPluginOidcClients(pluginName) {
  const declared = (await collectPluginOidcClients()).filter((c) => c.plugin === pluginName);
  const secrets = new Map((await listOidcClientSecrets(STATE_DIR)).map((m) => [m.id, m]));
  return declared.map((client) => {
    const secret = client.confidential ? (secrets.get(client.id) ?? null) : null;
    return {
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
  const rotated = await rotateOidcClientSecret(STATE_DIR, clientId);
  const digests = await readOidcClientSecretDigests(STATE_DIR);
  if (client.enabled) {
    const domain = getConfig().domain;
    const { served, scopes } = await planOidcClients();
    await updateOidcProvider(domain, served, { secretDigests: digests, scopes });
  }
  logger.info({ plugin: pluginName, clientId }, 'OIDC client secret rotated');
  return {
    id: rotated.id,
    plugin: rotated.plugin,
    secret: rotated.secret,
    rotatedAt: rotated.rotatedAt,
  };
}
