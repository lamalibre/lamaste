/**
 * The Authelia groups Lamaste owns, as the relay's state says they should
 * be (packages/core/docs/external-members-design.md; core owned-groups.ts) —
 * what lib/domains.js `syncDomainAccess` writes into users.yml:
 *
 * - each domain's members and external members (`lamaste:m:<key>`,
 *   `lamaste:x:<key>`, the key a random one of the domain's record);
 * - a protected static site's listed users (`lamaste:s:<site id>`);
 * - the external members granted a Gatekeeper-gated `restricted` host — a
 *   restricted tunnel (a user surface's too) or a restricted web surface —
 *   by a grant in Gatekeeper, direct or through a Lamaste group (the host's
 *   group, named by its hostname);
 * - the external members granted a user-facing OIDC client
 *   (`lamaste:oidc@<id>`, a Gatekeeper grant `resourceType: 'oidc-client'`).
 *
 * Grants are read from Gatekeeper only while some domain has external
 * members (members reach those hosts and clients through their domain's
 * group). When they cannot be read — Gatekeeper, the tunnels or the plugin
 * manifests — external members hold no host or client group until they
 * can (fail closed): the memberships, from state.db, are rendered all the
 * same.
 */

import { OWNED_GROUP_PREFIX, renderOwnedGroups } from '@lamalibre/lamaste';
import { httpError } from './app-error.js';
import {
  listGatekeeperGroups,
  listGrantsOfType,
  revokeGatekeeperGrant,
} from './gatekeeper-client.js';
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

/** An access mode as Gatekeeper reads it: restricted when absent or unknown. */
function accessModeOf(value) {
  return value === 'public' || value === 'authenticated' ? value : 'restricted';
}

/**
 * The Gatekeeper-gated restricted hosts: enabled restricted tunnels with a
 * hostname (an internal plugin tunnel has none; an agent panel is mTLS,
 * not Gatekeeper's; a tunnel without an access mode is restricted, as
 * Gatekeeper reads it) and restricted web surfaces (plugin-owned sites),
 * each with the resource its grants name. A disabled tunnel serves nobody —
 * a web surface moved off a tunnel leaves it disabled on the same hostname,
 * and its grants must not name anyone there.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} tunnels
 * @param {ReadonlyArray<Record<string, unknown>>} sites
 * @returns {Array<{ fqdn: string, resourceType: 'tunnel' | 'site', resourceId: string }>}
 */
export function restrictedHosts(tunnels, sites) {
  const hosts = [];
  for (const t of tunnels) {
    if (
      typeof t?.fqdn === 'string' &&
      typeof t.id === 'string' &&
      t.enabled !== false &&
      t.type !== 'panel' &&
      t.exposure !== 'internal' &&
      accessModeOf(t.accessMode) === 'restricted'
    ) {
      hosts.push({ fqdn: t.fqdn.toLowerCase(), resourceType: 'tunnel', resourceId: t.id });
    }
  }
  for (const s of sites) {
    if (s?.owner && accessModeOf(s.accessMode) === 'restricted' && typeof s.fqdn === 'string') {
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
 * The owned groups every user should hold (core `renderOwnedGroups`):
 * `complete` false — with a `warning` — when the grants could not be read,
 * and the hosts and OIDC clients external members are granted were then
 * left out (fail closed).
 *
 * @param {{
 *   domains: ReadonlyArray<{ name: string, groupKey: string, members: readonly string[], externals: readonly string[] }>,
 *   sites: ReadonlyArray<Record<string, unknown>>,
 * }} input `domains` the active ones with their people, `sites` sites.json
 *   (or the sites being saved)
 * @returns {Promise<{ desired: Map<string, string[]>, complete: boolean, warning?: string }>}
 */
export async function desiredOwnedGroups({ domains, sites }) {
  const siteGroups = sites
    .filter(
      (s) =>
        s?.autheliaProtected === true &&
        typeof s.id === 'string' &&
        typeof s.fqdn === 'string' &&
        Array.isArray(s.allowedUsers) &&
        s.allowedUsers.length > 0,
    )
    .map((s) => ({ id: s.id, fqdn: s.fqdn.toLowerCase(), users: s.allowedUsers }));

  let hostGrants = [];
  let clientGrants = [];
  let warning;
  if (domains.some((d) => d.externals.length > 0)) {
    try {
      const [hosts, clients, read] = await Promise.all([
        readTunnels().then((tunnels) => restrictedHosts(tunnels, sites)),
        userFacingOidcClients(),
        readGrantedResources(),
      ]);
      if (!read.ok) throw new Error(`Gatekeeper: ${read.error}`);
      hostGrants = hosts.map((h) => ({
        fqdn: h.fqdn,
        users: [...(read.granted[h.resourceType].get(h.resourceId) ?? [])],
      }));
      clientGrants = clients.map((c) => ({
        clientId: c.id,
        domain: c.domain,
        users: [...(read.granted[OIDC_CLIENT_RESOURCE].get(c.id) ?? [])],
      }));
    } catch (err) {
      hostGrants = [];
      clientGrants = [];
      warning = `What external members are granted could not be read (${err.message}): they hold no granted host or OIDC client until it can — the panel renders again within a minute`;
    }
  }

  return {
    desired: renderOwnedGroups({ domains, sites: siteGroups, hostGrants, clientGrants }),
    complete: warning === undefined,
    ...(warning ? { warning } : {}),
  };
}

/** Whether an owned group names a grant (a host group, an OIDC client group) rather than a membership or a site's list. */
function isGrantGroup(group) {
  return !group.startsWith(OWNED_GROUP_PREFIX) || group.startsWith(`${OWNED_GROUP_PREFIX}oidc@`);
}

/**
 * The owned groups each user held as the last rendering from complete
 * inputs decided (membership groups as the last rendering of any kind
 * did) — what a narrowing is measured against. Null until the first
 * rendering, which takes what users.yml holds then.
 *
 * @type {Map<string, readonly string[]> | null}
 */
let baseline = null;

/** Forget the baseline (tests). */
export function resetOwnedGroupsBaselineForTests() {
  baseline = null;
}

/**
 * Who lost owned groups since the baseline, as `desired` decides — each
 * enabled user of `held` (users.yml now) with the groups they lose — and
 * the baseline moved on. When `complete` is false the grants were not read
 * and `desired` holds none: grant groups are then neither counted as lost
 * nor forgotten — a grant revoked meanwhile is found lost by the next
 * complete rendering. A user who is gone or disabled is no narrowing to
 * follow (Authelia refuses them; offboarding revokes their tokens).
 *
 * @param {ReadonlyMap<string, readonly string[]>} desired
 * @param {boolean} complete
 * @param {ReadonlyMap<string, { groups: readonly string[], active: boolean }>} held
 * @returns {Array<{ username: string, lost: string[], before: readonly string[], after: string[] }>}
 */
export function narrowingSince(desired, complete, held) {
  if (baseline === null) {
    baseline = new Map([...held].map(([u, h]) => [u, [...h.groups]]));
  }
  const previous = baseline;
  const next = new Map();
  const narrowed = [];
  for (const username of new Set([...previous.keys(), ...desired.keys()])) {
    const before = previous.get(username) ?? [];
    const kept = complete ? [] : before.filter(isGrantGroup);
    const after = [...new Set([...(desired.get(username) ?? []), ...kept])];
    if (after.length > 0) next.set(username, after);
    const lost = before.filter((g) => !after.includes(g));
    if (lost.length > 0 && held.get(username)?.active) {
      narrowed.push({ username, lost, before, after });
    }
  }
  baseline = next;
  return narrowed;
}

/**
 * The user-facing OIDC clients that sign users in with the device-code
 * flow, each with its domain's group key (core `reachedOidcClients`) —
 * those Authelia checks against the groups a session last refreshed.
 *
 * @param {ReadonlyArray<{ name: string, groupKey: string }>} domains the active domains
 * @returns {Promise<Array<{ id: string, groupKey: string }>>}
 */
export async function deviceCodeClients(domains) {
  const keys = new Map(domains.map((d) => [d.name, d.groupKey]));
  const { planOidcClients } = await import('./plugin-oidc.js');
  const { served } = await planOidcClients();
  return served
    .filter((c) => isUserFacingOidcClient(c) && c.grantTypes.includes(DEVICE_CODE_GRANT))
    .filter((c) => keys.has(c.domain))
    .map((c) => ({ id: c.id, groupKey: keys.get(c.domain) }));
}

/** The OAuth grant type of the device-code flow. */
export const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/**
 * Revoke every Gatekeeper grant on the OIDC clients `clientIds` — a plugin
 * uninstalled takes the grants on its clients with it.
 *
 * @param {readonly string[]} clientIds
 * @returns {Promise<{ ok: true, revoked: number } | { ok: false, error: string }>}
 */
export async function revokeOidcClientGrants(clientIds) {
  if (clientIds.length === 0) return { ok: true, revoked: 0 };
  const list = await listGrantsOfType(OIDC_CLIENT_RESOURCE);
  if (!list.ok) return { ok: false, error: list.error };
  let revoked = 0;
  for (const grant of list.grants.filter((g) => clientIds.includes(g.resourceId))) {
    const result = await revokeGatekeeperGrant(grant.grantId);
    if (!result.ok) return { ok: false, error: result.error };
    revoked += 1;
  }
  return { ok: true, revoked };
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
