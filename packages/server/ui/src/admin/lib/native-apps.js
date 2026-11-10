/**
 * The native apps page's pure helpers: the association form's text ↔ the
 * setting the panel stores, the words of a client's state and of a grant's
 * end, the URLs a host serves for the app stores, and the hosts a native
 * client can be registered for (native-apps-design.md D2, D6).
 */

import {
  APPLE_APP_SITE_ASSOCIATION_PATH,
  ASSET_LINKS_PATH,
  NATIVE_CLIENT_ID_PREFIX,
} from '@lamalibre/lamaste/native-apps';

/** Entries of a text field: split on commas, spaces and line breaks; empty ones dropped. */
export function splitList(text) {
  return String(text ?? '')
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * The association setting from the form's three fields: the Apple team id,
 * the iOS bundle ids, and one Android app per line — its package name, then
 * its signing-certificate SHA-256 fingerprints. A blank iOS or Android part
 * is left out (no file is served for it). Fingerprints are upper-cased, the
 * form the setting keeps; the panel validates the rest.
 *
 * @param {{ teamId?: string, bundleIds?: string, android?: string }} form
 */
export function associationsFromForm({ teamId = '', bundleIds = '', android = '' }) {
  const out = {};
  const team = teamId.trim();
  const bundles = splitList(bundleIds);
  if (team || bundles.length > 0) out.ios = { teamId: team, bundleIds: bundles };
  const apps = String(android)
    .split(/\r?\n/)
    .map((line) => splitList(line))
    .filter((parts) => parts.length > 0)
    .map(([packageName, ...prints]) => ({
      packageName,
      sha256CertFingerprints: prints.map((p) => p.toUpperCase()),
    }));
  if (apps.length > 0) out.android = apps;
  return out;
}

/** The form's fields for a stored association setting (the inverse of {@link associationsFromForm}). */
export function associationsToForm(associations) {
  const ios = associations?.ios;
  return {
    teamId: ios?.teamId ?? '',
    bundleIds: (ios?.bundleIds ?? []).join('\n'),
    android: (associations?.android ?? [])
      .map((app) => [app.packageName, ...(app.sha256CertFingerprints ?? [])].join(' '))
      .join('\n'),
  };
}

/** The URLs of the files the host serves for the app stores, for what is set. */
export function associationFileUrls(client) {
  if (!client?.fqdn) return [];
  const urls = [];
  if (client.associations?.ios)
    urls.push(`https://${client.fqdn}${APPLE_APP_SITE_ASSOCIATION_PATH}`);
  if (client.associations?.android?.length) urls.push(`https://${client.fqdn}${ASSET_LINKS_PATH}`);
  return urls;
}

const NOT_SERVED = {
  disabled: 'Disabled — no new sign-ins, every grant ended',
  host_missing: 'Its host is gone',
  domain_inactive: 'Its host lies under no active domain',
};

/** One line on whether Authelia signs people in with the client. */
export function nativeClientStatusText(client) {
  if (client.served) return 'Signs people in';
  return NOT_SERVED[client.reason] ?? 'Not served';
}

const END_REASONS = {
  idle_expired: 'not used within its idle lifetime',
  absolute_expired: 'reached its absolute lifetime',
  reuse: 'a spent refresh token was used again',
  issuer_refused: 'the issuer refused its refresh token',
  revoked_by_client: 'signed out in the app',
  revoked_by_admin: 'ended by an administrator',
  client_disabled: 'the client was disabled',
  client_deleted: 'the client was deleted',
  host_deleted: 'the host was deleted',
  'standing:disabled': 'the person was disabled',
  'standing:removed': 'the person was removed',
  'standing:erased': 'the person was erased',
  'standing:not_member': 'the person is no longer a member of the domain',
  'standing:no_role': 'the person holds no role on the host’s plugins',
  'standing:no_grant': 'the person lost the host’s grant',
  'standing:cleanup_pending': 'an earlier holder of the username is being cleaned up',
};

/** Why a grant ended, in words. */
export function grantEndText(reason) {
  return END_REASONS[reason] ?? reason ?? '';
}

/**
 * The application hosts a native client can be registered for — plugin-owned
 * sites and tunnels bound to plugin routes — less those that have one.
 *
 * @param {{ tunnels?: object[], sites?: object[], clients?: object[] }} input
 * @returns {Array<{ kind: 'site' | 'tunnel', id: string, fqdn: string, label: string }>}
 */
export function nativeHostChoices({ tunnels = [], sites = [], clients = [] }) {
  const taken = new Set(clients.map((c) => `${c.hostKind}:${c.hostId}`));
  const hosts = [];
  for (const site of sites) {
    if (!site?.owner || typeof site.fqdn !== 'string') continue;
    hosts.push({
      kind: 'site',
      id: site.id,
      fqdn: site.fqdn,
      label: `${site.fqdn} (site of ${site.owner.plugin})`,
    });
  }
  for (const tunnel of tunnels) {
    const routes = tunnel?.userSurface?.routes ?? [];
    if (routes.length === 0 || typeof tunnel.fqdn !== 'string') continue;
    hosts.push({
      kind: 'tunnel',
      id: tunnel.id,
      fqdn: tunnel.fqdn,
      label: `${tunnel.fqdn} (tunnel: ${routes.join(', ')})`,
    });
  }
  return hosts.filter((h) => !taken.has(`${h.kind}:${h.id}`));
}

/** The client id a slug makes. */
export function nativeClientIdOf(slug) {
  return `${NATIVE_CLIENT_ID_PREFIX}${slug}`;
}

/** Grants whose person's username contains `filter` (any case); all when it is blank. */
export function filterGrantsByPerson(grants, filter) {
  const wanted = String(filter ?? '')
    .trim()
    .toLowerCase();
  if (!wanted) return grants;
  return grants.filter((g) => (g.username ?? g.userId ?? '').toLowerCase().includes(wanted));
}
