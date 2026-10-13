/**
 * Plugin-declared OIDC clients → Authelia.
 *
 * Every enabled server plugin may declare public OIDC clients in its
 * manifest (`oidcClients`, see the core `ManifestSchema`). After any plugin
 * lifecycle change the set of clients is recomputed from the installed
 * manifests and written to Authelia's `identity_providers.oidc` section;
 * Authelia is restarted only when the section actually changed.
 *
 * Best effort by design: a failure here must not fail the plugin operation
 * — the caller logs it and the next lifecycle change retries.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { validateManifest } from '@lamalibre/lamaste';

import { getConfig } from './config.js';
import { updateOidcProvider } from './authelia.js';
import { getEnabledPlugins } from './plugins.js';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';

/**
 * Collect the OIDC clients every enabled plugin declares, tagged with the
 * plugin name. Manifests are re-read from the installed packages — the
 * plugin registry does not store them.
 * @returns {Promise<import('@lamalibre/lamaste/server').AutheliaOidcClient[]>}
 */
export async function collectPluginOidcClients() {
  const require = createRequire(`${STATE_DIR}/`);
  const clients = [];
  for (const plugin of await getEnabledPlugins()) {
    let manifest;
    try {
      const manifestPath = require.resolve(`${plugin.packageName}/lamaste-plugin.json`);
      manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf-8')));
    } catch {
      continue; // an unreadable manifest contributes no clients
    }
    for (const client of manifest.oidcClients) {
      clients.push({ ...client, plugin: manifest.name });
    }
  }
  return clients;
}

/**
 * Sync Authelia's OIDC clients with the enabled plugins. Returns what was
 * done, or `null` when the panel has no domain yet (onboarding).
 * @param {import('pino').Logger} logger
 */
export async function syncPluginOidcClients(logger) {
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
  const clients = await collectPluginOidcClients();
  const result = await updateOidcProvider(domain, clients);
  if (result.changed) {
    logger.info(
      { clients: clients.map((c) => c.id) },
      'Authelia OIDC provider updated from plugin manifests',
    );
  }
  return result;
}
