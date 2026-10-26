/**
 * The Authelia groups Lamaste owns, as the relay's state says they should
 * be (packages/core/docs/external-members-design.md; core owned-groups.ts) —
 * what lib/domains.js `syncDomainAccess` writes into users.yml:
 *
 * - each domain's members and external members (`lamaste:member@<d>`,
 *   `lamaste:external@<d>`);
 * - a protected static site's listed users (its host group);
 * - the external members granted a Gatekeeper-gated `restricted` host — a
 *   restricted tunnel (a user surface's too) or a restricted web surface —
 *   by a grant in Gatekeeper, direct or through a Lamaste group (the host's
 *   group);
 * - the external members granted a user-facing OIDC client
 *   (`lamaste:oidc@<id>`, a Gatekeeper grant `resourceType: 'oidc-client'`).
 *
 * Grants are read from Gatekeeper only while some domain has external
 * members (members reach those hosts and clients through their domain's
 * group). When Gatekeeper cannot be read, the hosts and clients each
 * external member holds now are kept — narrowing nothing a revocation could
 * have asked for (a revocation is a Gatekeeper write, and Gatekeeper is
 * what cannot be reached), widening nothing either: a membership's own
 * group still decides, and it comes from state.db.
 */

import { isLamasteOwnedGroup, oidcClientGroup, renderOwnedGroups } from '@lamalibre/lamaste';
import { httpError } from './app-error.js';
import { readUsersRaw } from './authelia.js';
import { listGatekeeperGroups, listGrantsOfType } from './gatekeeper-client.js';
import { readTunnels } from './state.js';

/** The Gatekeeper resource type of a grant on an OIDC client (`resourceId`: the client id). */
export const OIDC_CLIENT_RESOURCE = 'oidc-client';

/**
 * Whether an OIDC client signs users in — a grant can name it — rather than
 * a service (`client_credentials`, never mixed with a user grant).
 *
 * @param {{ grantTypes: readonly string[] }} client
 */
export function isUserFacingOidcClient(client) {
  return !client.grantTypes.includes('client_credentials');
}

/**
 * The Gatekeeper-gated restricted hosts: restricted tunnels with a
 * hostname (an internal plugin tunnel has none) and restricted web
 * surfaces (plugin-owned sites), each with the resource its grants name.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} tunnels
 * @param {ReadonlyArray<Record<string, unknown>>} sites
 * @returns {Array<{ fqdn: string, resourceType: 'tunnel' | 'site', resourceId: string }>}
 */
export function restrictedHosts(tunnels, sites) {
  const hosts = [];
  for (const t of tunnels) {
    if (typeof t?.fqdn === 'string' && t.accessMode === 'restricted' && typeof t.id === 'string') {
      hosts.push({ fqdn: t.fqdn.toLowerCase(), resourceType: 'tunnel', resourceId: t.id });
    }
  }
  for (const s of sites) {
    if (s?.owner && s.accessMode === 'restricted' && typeof s.fqdn === 'string') {
      hosts.push({ fqdn: s.fqdn.toLowerCase(), resourceType: 'site', resourceId: s.id });
    }
  }
  return hosts;
}

/**
 * The usernames each grant of `grants` reaches — a user grant its user, a
 * group grant the members of the Lamaste group — keyed by resource id.
 *
 * @param {ReadonlyArray<{ principalType: 'user' | 'group', principalId: string, resourceId: string }>} grants
 * @param {ReadonlyMap<string, { members: readonly string[] }>} groups by name
 * @returns {Map<string, Set<string>>}
 */
export function grantedUsernames(grants, groups) {
  const out = new Map();
  for (const grant of grants) {
    let set = out.get(grant.resourceId);
    if (!set) out.set(grant.resourceId, (set = new Set()));
    if (grant.principalType === 'user') set.add(grant.principalId);
    else for (const member of groups.get(grant.principalId)?.members ?? []) set.add(member);
  }
  return out;
}

/**
 * Every grant on tunnels, sites and OIDC clients, with the Lamaste groups
 * expanded — the usernames granted each resource, by type and id — or the
 * reason Gatekeeper could not say.
 *
 * @returns {Promise<{ ok: true, granted: Record<'tunnel' | 'site' | 'oidc-client', Map<string, Set<string>>> } | { ok: false, error: string }>}
 */
export async function readGrantedResources() {
  const [tunnel, site, client, groups] = await Promise.all([
    listGrantsOfType('tunnel'),
    listGrantsOfType('site'),
    listGrantsOfType(OIDC_CLIENT_RESOURCE),
    listGatekeeperGroups(),
  ]);
  const failed = [tunnel, site, client, groups].find((r) => !r.ok);
  if (failed) return { ok: false, error: failed.error };
  const byName = new Map(groups.groups.map((g) => [g.name, g]));
  return {
    ok: true,
    granted: {
      tunnel: grantedUsernames(tunnel.grants, byName),
      site: grantedUsernames(site.grants, byName),
      [OIDC_CLIENT_RESOURCE]: grantedUsernames(client.grants, byName),
    },
  };
}

/**
 * The user-facing OIDC clients Authelia serves, each with its domain — the
 * clients a grant can name (a `client_credentials` client signs in no one).
 *
 * @returns {Promise<Array<{ id: string, domain: string }>>}
 */
export async function userFacingOidcClients() {
  const { planOidcClients } = await import('./plugin-oidc.js');
  const { served } = await planOidcClients();
  return served.filter(isUserFacingOidcClient).map((c) => ({ id: c.id, domain: c.domain }));
}

/**
 * The owned groups every user should hold (core `renderOwnedGroups`), and a
 * warning when Gatekeeper could not be read (the grants each external
 * member holds now are then kept).
 *
 * @param {{
 *   domains: ReadonlyArray<{ name: string, members: readonly string[], externals: readonly string[] }>,
 *   allDomains: readonly string[],
 *   sites: ReadonlyArray<Record<string, unknown>>,
 * }} input `domains` the active ones with their people, `allDomains` every
 *   domain record, `sites` sites.json (or the sites being saved)
 * @returns {Promise<{ desired: Map<string, string[]>, warning?: string }>}
 */
export async function desiredOwnedGroups({ domains, allDomains, sites }) {
  const siteGroups = sites
    .filter(
      (s) =>
        s?.autheliaProtected === true &&
        typeof s.fqdn === 'string' &&
        Array.isArray(s.allowedUsers) &&
        s.allowedUsers.length > 0,
    )
    .map((s) => ({ fqdn: s.fqdn.toLowerCase(), users: s.allowedUsers }));

  let hostGrants = [];
  let clientGrants = [];
  let warning;
  if (domains.some((d) => d.externals.length > 0)) {
    const [hosts, clients, read] = await Promise.all([
      readTunnels().then((tunnels) => restrictedHosts(tunnels, sites)),
      userFacingOidcClients(),
      readGrantedResources(),
    ]);
    const granted = read.ok ? read.granted : await grantsHeldNow(hosts, clients, allDomains);
    if (!read.ok) {
      warning = `Gatekeeper's grants could not be read (${read.error}); the hosts and OIDC clients external members hold now are kept`;
    }
    hostGrants = hosts.map((h) => ({
      fqdn: h.fqdn,
      users: [...(granted[h.resourceType].get(h.resourceId) ?? [])],
    }));
    clientGrants = clients.map((c) => ({
      clientId: c.id,
      domain: c.domain,
      users: [...(granted[OIDC_CLIENT_RESOURCE].get(c.id) ?? [])],
    }));
  }

  return {
    desired: renderOwnedGroups({ domains, sites: siteGroups, hostGrants, clientGrants }),
    ...(warning ? { warning } : {}),
  };
}

/**
 * The grants users.yml says its users hold now — who holds each host's
 * group and each client's group — as {@link readGrantedResources} would
 * answer them: what a rendering keeps while Gatekeeper cannot be read.
 */
async function grantsHeldNow(hosts, clients, allDomains) {
  const users = (await readUsersRaw()).users ?? {};
  const holders = new Map();
  for (const [username, entry] of Object.entries(users)) {
    for (const group of Array.isArray(entry?.groups) ? entry.groups : []) {
      if (typeof group !== 'string' || !isLamasteOwnedGroup(group, allDomains)) continue;
      const key = group.toLowerCase();
      if (!holders.has(key)) holders.set(key, new Set());
      holders.get(key).add(username);
    }
  }
  const granted = { tunnel: new Map(), site: new Map(), [OIDC_CLIENT_RESOURCE]: new Map() };
  for (const h of hosts)
    granted[h.resourceType].set(h.resourceId, holders.get(h.fqdn) ?? new Set());
  for (const c of clients) {
    granted[OIDC_CLIENT_RESOURCE].set(c.id, holders.get(oidcClientGroup(c.id)) ?? new Set());
  }
  return granted;
}

/**
 * A grant the Gatekeeper proxy is about to create, checked when it names an
 * OIDC client: the client must be one an installed plugin declares (or the
 * panel's own) and sign users in — a `client_credentials` client has no
 * user to grant (400 `unknown_oidc_client` / `service_oidc_client`). Any
 * other body goes on as it came.
 *
 * @param {unknown} body
 * @returns {Promise<unknown>}
 */
export async function checkOidcClientGrant(body) {
  if (typeof body !== 'object' || body === null || body.resourceType !== OIDC_CLIENT_RESOURCE) {
    return body;
  }
  const { collectPluginOidcClients } = await import('./plugin-oidc.js');
  const client = (await collectPluginOidcClients()).find((c) => c.id === body.resourceId);
  if (!client) {
    throw httpError('No installed plugin declares this OIDC client', 400, {
      code: 'unknown_oidc_client',
    });
  }
  if (!isUserFacingOidcClient(client)) {
    throw httpError('This OIDC client signs in no user: there is nothing to grant', 400, {
      code: 'service_oidc_client',
    });
  }
  return body;
}
