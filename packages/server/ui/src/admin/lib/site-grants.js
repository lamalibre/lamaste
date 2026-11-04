/**
 * Grants on the site of a plugin's web surface, in the panel's words — for
 * its Web surface panel, its People (who is entitled but cannot reach the
 * site) and the Gatekeeper Grants page. Pure: nothing here calls the panel.
 *
 * A restricted web surface admits a member of the plugin's audience only
 * when a Gatekeeper `site` grant on its site names them or a Lamaste group
 * they are in: a role alone lets nobody in. A missing access mode reads as
 * restricted, as Gatekeeper reads it.
 */

import { errorMessage, refusalOf } from './errorMessage.js';
import { siteOwnerRoute } from './web-surface.js';

/** The Gatekeeper resource type of a grant on a site. */
export const SITE_RESOURCE = 'site';

/** Whether grants decide who reaches `site`: every access mode but `authenticated`. */
export function siteGrantsDecide(site) {
  return Boolean(site) && site.accessMode !== 'authenticated';
}

/** `user:ayse`, `group:ops` — a principal as one key. */
export function principalKey({ principalType, principalId }) {
  return `${principalType}:${principalId}`;
}

/**
 * The body of `POST /api/gatekeeper/grants` giving `principal` the site
 * `siteId`.
 *
 * @param {{ principalType: 'user' | 'group', principalId: string }} principal
 * @param {string} siteId
 */
export function siteGrantBody({ principalType, principalId }, siteId) {
  return {
    principalType,
    principalId,
    resourceType: SITE_RESOURCE,
    resourceId: siteId,
    context: {},
  };
}

/**
 * Whether `principal` reaches a site through `grants` (the site's) — a user
 * by a grant naming them or a Lamaste group they are in; a group by a grant
 * naming it — and, when not, `without`: who it leaves out (a user: them; a
 * group: its members no other grant admits, by username).
 *
 * @param {{ principalType: 'user' | 'group', principalId: string }} principal
 * @param {ReadonlyArray<{ principalType: string, principalId: string }>} grants
 * @param {ReadonlyArray<{ name: string, members: readonly string[] }>} groups the Lamaste groups
 * @returns {{ granted: boolean, without: string[] }}
 */
export function siteAccessOf(principal, grants, groups) {
  const members = new Map(groups.map((g) => [g.name, g.members ?? []]));
  const admitted = new Set();
  for (const grant of grants) {
    if (grant.principalType === 'user') admitted.add(grant.principalId);
    else if (grant.principalType === 'group') {
      for (const member of members.get(grant.principalId) ?? []) admitted.add(member);
    }
  }
  if (principal.principalType === 'user') {
    const granted = admitted.has(principal.principalId);
    return { granted, without: granted ? [] : [principal.principalId] };
  }
  if (grants.some((g) => g.principalType === 'group' && g.principalId === principal.principalId)) {
    return { granted: true, without: [] };
  }
  const without = (members.get(principal.principalId) ?? []).filter((m) => !admitted.has(m));
  return { granted: false, without: [...without].sort() };
}

/**
 * What a principal's missing site grant means, in words, or null when
 * nothing is missing: a user cannot reach the site; a group leaves out the
 * members no other grant admits (a group with no such member reaches it
 * through its members' own grants).
 *
 * @param {{ principalType: 'user' | 'group' }} principal
 * @param {{ granted: boolean, without: string[] }} access
 * @param {string} fqdn the site's hostname
 */
export function missingSiteAccessText(principal, access, fqdn) {
  if (access.granted || access.without.length === 0) return null;
  if (principal.principalType === 'user') {
    return `No site access — holds no grant on ${fqdn}, so the role lets them in nowhere`;
  }
  const n = access.without.length;
  return `${n} member${n === 1 ? '' : 's'} without site access (${access.without.join(', ')}) — the group holds no grant on ${fqdn}`;
}

/** What lifts a refused site grant, by its `code`. */
const CODE_HINT = {
  unknown_site: 'The site is gone — refresh the page.',
  site_not_grantable:
    'Only a plugin’s web surface takes grants; a static site’s access is its allowed users (Sites → Settings).',
  username_deleted:
    'That username belonged to a deleted user — create a user under it before giving it anything.',
  gatekeeper_unavailable: 'Gatekeeper is not reachable now — try again in a moment.',
};

/**
 * A refused grant on a site explained: the panel's message and what lifts
 * the refusal.
 *
 * @param {unknown} err what the admin client rejected with
 * @returns {{ message: string, hint: string | null }}
 */
export function explainSiteGrantRefusal(err) {
  const { code } = refusalOf(err);
  const hint = typeof code === 'string' && Object.hasOwn(CODE_HINT, code) ? CODE_HINT[code] : null;
  return { message: errorMessage(err), hint };
}

/**
 * The sites a grant can name — those a plugin owns (its web surface) —
 * each with a label: its hostname, the plugin and its access mode, sorted
 * by hostname. A static site takes no grant.
 *
 * @param {ReadonlyArray<object>} sites the sites listing
 * @param {ReadonlyArray<{ name: string, route?: string, displayName?: string }>} plugins
 * @returns {Array<{ id: string, fqdn: string, route: string, label: string, restricted: boolean }>}
 */
export function grantableSites(sites, plugins) {
  const out = [];
  for (const site of Array.isArray(sites) ? sites : []) {
    const route = siteOwnerRoute(site);
    if (!route || typeof site.id !== 'string') continue;
    const plugin = (plugins ?? []).find((p) => p.route === route);
    const restricted = siteGrantsDecide(site);
    out.push({
      id: site.id,
      fqdn: site.fqdn,
      route,
      restricted,
      label: `${site.fqdn} — web surface of ${plugin?.displayName ?? plugin?.name ?? route}${restricted ? '' : ' (authenticated: grants count for nothing)'}`,
    });
  }
  return out.sort((a, b) => a.fqdn.localeCompare(b.fqdn));
}

/** The site plugin `route` owns among `sites`, or null. */
export function siteOfRoute(sites, route) {
  return (Array.isArray(sites) ? sites : []).find((s) => siteOwnerRoute(s) === route) ?? null;
}
