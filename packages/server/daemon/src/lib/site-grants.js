/**
 * Grants on the site a plugin owns — its web surface (slice 7).
 *
 * A `restricted` web surface admits a member of the plugin's audience only
 * when a Gatekeeper `site` grant on the site names them or a Lamaste group
 * they are in (Gatekeeper `checkAccess`); being entitled — holding one of
 * the plugin's roles — is not enough on its own. A site with no access mode
 * reads as `restricted`, as Gatekeeper reads it. An `authenticated` surface
 * admits every member: its grants count for nothing until the site is
 * restricted.
 *
 * Administrators give and revoke them through the Gatekeeper proxy
 * (`POST /api/gatekeeper/grants` with `resourceType: 'site'`,
 * `DELETE /api/gatekeeper/grants/:grantId`): {@link checkSiteGrant} refuses
 * a grant on a site that does not exist, or on a static site — its access
 * is its allowed users, never a grant — and {@link auditSiteGrantChange}
 * records each one. The web surface's view lists the grants and the
 * members of the audience no grant admits ({@link siteGrantsView}), so
 * that an entitlement can never look sufficient on its own. A delegated
 * invitation's acceptance and a move from a tunnel create site grants
 * themselves (`lib/invitation-acceptance.js`, `lib/web-surface.js`).
 *
 * Audit: `plugin.web-surface.grant.created`, `.grant.revoked` — a user
 * principal by directory id, never by username.
 */

import { siteUserSurfaceRoute } from '@lamalibre/lamaste';
import { httpError } from './app-error.js';
import { recordAuditBestEffort } from './audit.js';
import { listAudience } from './audience.js';
import { auditedPrincipal } from './entitlements.js';
import { listGatekeeperGroups, listResourceGrants } from './gatekeeper-client.js';
import { findPluginByRoute } from './plugins.js';
import { readSites } from './state.js';

/** The Gatekeeper resource type of a grant on a site. */
export const SITE_RESOURCE = 'site';

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a site's grants decide who reaches it: every access mode but
 * `authenticated` — a missing or unknown one reads as `restricted`.
 *
 * @param {{ accessMode?: unknown }} site
 */
export function siteGrantsCount(site) {
  return site.accessMode !== 'authenticated';
}

/**
 * The active members of a plugin's audience no grant of `grants` admits —
 * a user grant naming them, or a group grant on a Lamaste group they are
 * in — sorted by username. A disabled member reaches nothing, granted or
 * not, and a user who left the audience is not a member.
 *
 * @param {ReadonlyArray<{ userId: string, change: unknown }>} audience the plugin's rows
 * @param {ReadonlyArray<{ principalType: 'user' | 'group', principalId: string }>} grants the site's
 * @param {ReadonlyArray<{ name: string, members: readonly string[] }>} groups the Lamaste groups
 * @returns {Array<{ userId: string, username: string }>}
 */
export function membersWithoutSiteGrant(audience, grants, groups) {
  const granted = new Set();
  const members = new Map(groups.map((g) => [g.name, g.members]));
  for (const grant of grants) {
    if (grant.principalType === 'user') granted.add(grant.principalId);
    else for (const member of members.get(grant.principalId) ?? []) granted.add(member);
  }
  const out = [];
  for (const row of audience) {
    const change = row.change;
    if (!isRecord(change) || change.kind !== 'upsert' || !isRecord(change.member)) continue;
    const { username, status } = change.member;
    if (typeof username !== 'string' || status !== 'active') continue;
    if (!granted.has(username)) out.push({ userId: row.userId, username });
  }
  return out.sort((a, b) => a.username.localeCompare(b.username));
}

/**
 * @typedef {object} SiteGrantView
 * @property {string} grantId
 * @property {'user' | 'group'} principalType
 * @property {string} principalId a username or a Lamaste group's name
 * @property {string} createdAt
 */

/**
 * The grants on `site` and, while they decide who reaches it, the members
 * of plugin `pluginName`'s audience none of them admits (`[]` when they do
 * not decide, or when the site serves no installed plugin) — both `null`
 * when Gatekeeper could not be read.
 *
 * @param {{ id: string, accessMode?: unknown }} site
 * @param {string | null} pluginName the installed plugin the site was created for
 * @returns {Promise<{ grants: SiteGrantView[] | null, membersWithoutGrant: Array<{ userId: string, username: string }> | null }>}
 */
export async function siteGrantsView(site, pluginName) {
  const listed = await listResourceGrants(SITE_RESOURCE, site.id);
  if (!listed.ok) return { grants: null, membersWithoutGrant: null };
  const grants = listed.grants
    .map((g) => ({
      grantId: g.grantId,
      principalType: g.principalType,
      principalId: g.principalId,
      createdAt: g.createdAt,
    }))
    .sort(
      (a, b) =>
        a.principalType.localeCompare(b.principalType) ||
        a.principalId.localeCompare(b.principalId),
    );
  if (!pluginName || !siteGrantsCount(site)) return { grants, membersWithoutGrant: [] };
  let groups = [];
  if (grants.some((g) => g.principalType === 'group')) {
    const listedGroups = await listGatekeeperGroups();
    if (!listedGroups.ok) return { grants, membersWithoutGrant: null };
    groups = listedGroups.groups;
  }
  return {
    grants,
    membersWithoutGrant: membersWithoutSiteGrant(await listAudience(pluginName), grants, groups),
  };
}

/**
 * A grant the Gatekeeper proxy is about to create, checked when it names a
 * site: the site must exist (400 `unknown_site`) and be a plugin's (400
 * `site_not_grantable` — a static site's access is its allowed users).
 * Any other body goes on as it came.
 *
 * @param {unknown} body
 * @returns {Promise<unknown>}
 */
export async function checkSiteGrant(body) {
  if (!isRecord(body) || body.resourceType !== SITE_RESOURCE) return body;
  const site = (await readSites()).find((s) => s.id === body.resourceId);
  if (!site) {
    throw httpError('No site has this id', 400, { code: 'unknown_site' });
  }
  if (siteUserSurfaceRoute(site) === null) {
    throw httpError(
      `Site "${site.name}" is no plugin's web surface: who reaches it is set by its allowed users, not by grants`,
      400,
      { code: 'site_not_grantable' },
    );
  }
  return body;
}

/**
 * Record a site grant the proxy created or revoked — `grant` as Gatekeeper
 * answered with it — under the plugin that owns the site (the route when
 * no installed plugin holds it). Nothing for any other grant.
 *
 * @param {'created' | 'revoked'} change
 * @param {unknown} grant
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export async function auditSiteGrantChange(change, grant, { actor, logger }) {
  if (!isRecord(grant) || grant.resourceType !== SITE_RESOURCE) return;
  if (grant.principalType !== 'user' && grant.principalType !== 'group') return;
  if (typeof grant.principalId !== 'string' || typeof grant.resourceId !== 'string') return;
  const site = (await readSites()).find((s) => s.id === grant.resourceId);
  const route = site ? siteUserSurfaceRoute(site) : null;
  const plugin = route ? await findPluginByRoute(route) : null;
  await recordAuditBestEffort(
    {
      actor,
      action: `plugin.web-surface.grant.${change}`,
      plugin: plugin?.name ?? route,
      details: {
        siteId: grant.resourceId,
        ...(typeof grant.grantId === 'string' ? { grantId: grant.grantId } : {}),
        ...(await auditedPrincipal(grant.principalType, grant.principalId)),
      },
    },
    logger,
  );
}
