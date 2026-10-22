/**
 * Entitlements — who may use an agent-hosted plugin, with which of its
 * roles.
 *
 * An entitlement is a Gatekeeper grant on the plugin (`resourceType:
 * 'plugin'`, `resourceId: <route>`) to a user or a Lamaste group whose
 * `context.roles` is a non-empty list of the plugin's role ids. Nothing else
 * makes anyone a member of the plugin's audience: a grant without roles —
 * the desktop's local-install grants, ones migrated from
 * `user-plugin-access.json` — never counts. The panel keeps roles in the
 * manifest's terms: it refuses a role the installed version does not
 * declare, here and in the Gatekeeper proxy, and writes them sorted and
 * without repeats (Gatekeeper tells duplicates apart by their context's
 * JSON).
 *
 * Every change recomputes the audiences (`lib/audience.js`). Audit entries
 * name a user principal by their directory id, never by username.
 */

import { KeyedPromiseChainMutex } from '@lamalibre/lamaste';
import { httpError } from './app-error.js';
import { recordAuditBestEffort } from './audit.js';
import { findDirectoryUser, withUsernamesForGrants } from './directory.js';
import {
  createGatekeeperGrant,
  gatekeeperRequest,
  listPluginGrants,
  revokeGatekeeperGrant,
} from './gatekeeper-client.js';
import { findPluginByRoute } from './plugins.js';

/** One entitlement write per plugin at a time: a replacement creates, then revokes. */
const pluginMutex = new KeyedPromiseChainMutex();

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The roles a grant carries — its `context.roles` when that is a non-empty
 * list of strings — or null: the grant is not an entitlement.
 *
 * @param {{ context?: Record<string, unknown> }} grant
 * @returns {string[] | null}
 */
export function grantRoles(grant) {
  const roles = grant?.context?.roles;
  if (!Array.isArray(roles) || roles.length === 0) return null;
  if (!roles.every((role) => typeof role === 'string')) return null;
  return [...new Set(roles)].sort();
}

/** The role ids a normalized identity block declares. */
export function declaredRoleIds(identity) {
  return new Set((identity?.roles ?? []).map((role) => role.id));
}

/**
 * Check roles against a plugin's identity block: a non-empty list of role
 * ids it declares. Returns them sorted, each once; throws 400 — `code`
 * `unknown_roles` with the `unknown` ones — otherwise.
 *
 * @param {{ roles: Array<{ id: string }> }} identity normalized
 * @param {unknown} roles
 * @returns {string[]}
 */
function checkedRoles(identity, roles) {
  if (
    !Array.isArray(roles) ||
    roles.length === 0 ||
    !roles.every((role) => typeof role === 'string')
  ) {
    throw httpError('roles is a non-empty list of the plugin’s role ids', 400, {
      code: 'invalid_roles',
    });
  }
  const declared = declaredRoleIds(identity);
  const unique = [...new Set(roles)].sort();
  const unknown = unique.filter((role) => !declared.has(role));
  if (unknown.length > 0) {
    throw httpError(`The plugin declares no role ${unknown.join(', ')}`, 400, {
      code: 'unknown_roles',
      unknown,
    });
  }
  return unique;
}

/** A Gatekeeper failure as the error a route answers with. */
function gatekeeperError(result, what) {
  if (result.reason === 'unreachable' || result.reason === 'no-secret') {
    return httpError(`Gatekeeper is not reachable — ${what} cannot be read or changed now`, 503, {
      code: 'gatekeeper_unavailable',
    });
  }
  const status = result.statusCode >= 400 && result.statusCode < 600 ? result.statusCode : 502;
  return httpError(`Gatekeeper refused: ${result.error}`, status, { code: 'gatekeeper_refused' });
}

/** The role grants `principalId` holds on `plugin` (Gatekeeper failures thrown as route errors). */
async function roleGrantsOf(plugin, principalType, principalId) {
  const listed = await listPluginGrants(plugin.route);
  if (!listed.ok) throw gatekeeperError(listed, 'the entitlements');
  return listed.grants.filter(
    (g) =>
      g.principalType === principalType && g.principalId === principalId && grantRoles(g) !== null,
  );
}

/** How an audit entry names a principal: a user by directory id, a group by name. */
async function auditedPrincipal(principalType, principalId) {
  if (principalType === 'group') return { principalType, group: principalId };
  const user = await findDirectoryUser(principalId);
  return { principalType, userId: user?.userId ?? null };
}

async function recompute(logger) {
  const { recomputeAudiences } = await import('./audience.js');
  await recomputeAudiences({ logger });
}

/**
 * @typedef {object} Entitlement
 * @property {string} grantId
 * @property {'user' | 'group'} principalType
 * @property {string} principalId a username or a group name
 * @property {string | null} userId the directory id of a user principal holding the username now
 * @property {string[]} roles as granted, sorted
 * @property {string[]} unknownRoles granted roles the installed version does not declare
 * @property {string} createdAt
 */

/**
 * The entitlements on installed plugin `plugin` (registry entry, with an
 * identity block), and how many of its grants carry no roles.
 *
 * @param {{ route: string, identity: { roles: Array<{ id: string }> } }} plugin
 * @returns {Promise<{ entitlements: Entitlement[], roleless: number }>}
 */
export async function listEntitlements(plugin) {
  const listed = await listPluginGrants(plugin.route);
  if (!listed.ok) throw gatekeeperError(listed, 'the entitlements');
  const declared = declaredRoleIds(plugin.identity);
  const entitlements = [];
  let roleless = 0;
  for (const grant of listed.grants) {
    const roles = grantRoles(grant);
    if (!roles) {
      roleless += 1;
      continue;
    }
    const user = grant.principalType === 'user' ? await findDirectoryUser(grant.principalId) : null;
    entitlements.push({
      grantId: grant.grantId,
      principalType: grant.principalType,
      principalId: grant.principalId,
      userId: user?.userId ?? null,
      roles,
      unknownRoles: roles.filter((role) => !declared.has(role)),
      createdAt: grant.createdAt,
    });
  }
  entitlements.sort(
    (a, b) =>
      a.principalType.localeCompare(b.principalType) || a.principalId.localeCompare(b.principalId),
  );
  return { entitlements, roleless };
}

/**
 * Give `principal` exactly `roles` on installed plugin `plugin`: one grant
 * with those roles replaces every role grant the principal had on it
 * (created first, the others revoked after — a failure leaves the old
 * grants as they were). A user must hold the username now (404
 * `user_not_found`; 409 `username_deleted` when a removed user held it and
 * nobody holds it now), an earlier holder's pending Gatekeeper cleanup
 * under it is completed first (503 `gatekeeper_unavailable` when it cannot
 * be), and the grant is made holding the users lock — no deletion of the
 * user runs between the check and the grant; a group must exist in
 * Gatekeeper. Gatekeeper's refusals come back with its
 * status — 503 at its grant limit. Audited, then the audiences recomputed.
 *
 * @param {{ name: string, route: string, identity: { roles: Array<{ id: string }> } }} plugin
 * @param {{ principalType: 'user' | 'group', principalId: string, roles: string[] }} entitlement
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 * @returns {Promise<{ entitlement: Entitlement, changed: boolean, warnings: Array<{ step: string, message: string }> }>}
 */
export async function setEntitlement(plugin, { principalType, principalId, roles }, opts) {
  const wanted = checkedRoles(plugin.identity, roles);
  if (principalType === 'group') {
    const group = await gatekeeperRequest('GET', `/api/groups/${encodeURIComponent(principalId)}`);
    if (!group.ok) {
      if (group.statusCode === 404) {
        throw httpError(`No group "${principalId}"`, 404, { code: 'group_not_found' });
      }
      throw gatekeeperError(group, 'the group');
    }
  }

  const replace = () =>
    pluginMutex.run(plugin.name, async () => {
      const current = await roleGrantsOf(plugin, principalType, principalId);
      const same = current.find(
        (g) => JSON.stringify(g.context) === JSON.stringify({ roles: wanted }),
      );
      let kept = same ?? null;
      if (!kept) {
        const created = await createGatekeeperGrant({
          principalType,
          principalId,
          resourceType: 'plugin',
          resourceId: plugin.route,
          context: { roles: wanted },
        });
        if (!created.ok) throw gatekeeperError(created, 'the entitlement');
        kept = created.grant;
      }
      const warnings = [];
      for (const grant of current) {
        if (grant.grantId === kept.grantId) continue;
        const revoked = await revokeGatekeeperGrant(grant.grantId);
        if (!revoked.ok && revoked.statusCode !== 404) {
          warnings.push({
            step: 'gatekeeper',
            message: `An earlier grant (${grant.grantId}) was not revoked: ${revoked.error}`,
          });
        }
      }
      return { grant: kept, changed: !same || current.length > 1, warnings };
    });
  const outcome =
    principalType === 'user'
      ? await withUsernamesForGrants(
          [principalId],
          { actor: opts.actor, logger: opts.logger, requireUser: true },
          replace,
        )
      : await replace();

  const principal = await auditedPrincipal(principalType, principalId);
  if (outcome.changed) {
    await recordAuditBestEffort(
      {
        actor: opts.actor,
        action: 'plugin.entitlement.set',
        plugin: plugin.name,
        details: { ...principal, roles: wanted },
      },
      opts.logger,
    );
    await recompute(opts.logger);
  }
  return {
    entitlement: {
      grantId: outcome.grant.grantId,
      principalType,
      principalId,
      userId: principal.userId ?? null,
      roles: wanted,
      unknownRoles: [],
      createdAt: outcome.grant.createdAt,
    },
    changed: outcome.changed,
    warnings: outcome.warnings,
  };
}

/**
 * Revoke every role grant `principal` has on installed plugin `plugin`
 * (grants without roles stay). 404 `entitlement_not_found` when there is
 * none. Audited, then the audiences recomputed.
 *
 * @param {{ name: string, route: string }} plugin
 * @param {{ principalType: 'user' | 'group', principalId: string }} principal
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 * @returns {Promise<{ revoked: number, warnings: Array<{ step: string, message: string }> }>}
 */
export async function removeEntitlement(plugin, { principalType, principalId }, opts) {
  const outcome = await pluginMutex.run(plugin.name, async () => {
    const current = await roleGrantsOf(plugin, principalType, principalId);
    if (current.length === 0) {
      throw httpError(`"${principalId}" has no roles on plugin "${plugin.name}"`, 404, {
        code: 'entitlement_not_found',
      });
    }
    let revoked = 0;
    const warnings = [];
    for (const grant of current) {
      const result = await revokeGatekeeperGrant(grant.grantId);
      if (result.ok || result.statusCode === 404) revoked += 1;
      else {
        warnings.push({
          step: 'gatekeeper',
          message: `Grant ${grant.grantId} was not revoked: ${result.error}`,
        });
      }
    }
    if (revoked === 0) {
      throw httpError(`Gatekeeper revoked none of the grants: ${warnings[0]?.message}`, 502, {
        code: 'gatekeeper_refused',
      });
    }
    return { revoked, warnings };
  });

  await recordAuditBestEffort(
    {
      actor: opts.actor,
      action: 'plugin.entitlement.removed',
      plugin: plugin.name,
      details: await auditedPrincipal(principalType, principalId),
    },
    opts.logger,
  );
  await recompute(opts.logger);
  return outcome;
}

/**
 * A grant the Gatekeeper proxy is about to create, checked as an
 * entitlement when it is one: a plugin grant whose context names `roles`
 * must carry a non-empty list of role ids the plugin on that route
 * declares (400 otherwise), and goes on with them sorted and without
 * repeats. Any other body goes on as it came — Gatekeeper validates it.
 *
 * @param {unknown} body
 * @returns {Promise<unknown>}
 */
export async function checkProxiedGrant(body) {
  if (!isRecord(body) || body.resourceType !== 'plugin' || !isRecord(body.context)) return body;
  if (!Object.hasOwn(body.context, 'roles')) return body;
  const plugin =
    typeof body.resourceId === 'string' ? await findPluginByRoute(body.resourceId) : null;
  if (!plugin?.identity) {
    throw httpError(
      'Roles are granted on an installed plugin that declares them (resourceId is its route)',
      400,
      { code: 'no_identity' },
    );
  }
  return {
    ...body,
    context: { ...body.context, roles: checkedRoles(plugin.identity, body.context.roles) },
  };
}

// ---------------------------------------------------------------------------
// Roles a manifest no longer declares
// ---------------------------------------------------------------------------

/**
 * What bringing role grants in line with `declared` takes: a grant whose
 * roles all stay is left alone, one that keeps some is rewritten to those
 * (`rewrite`), one that keeps none is revoked (`revoke`). Grants without
 * roles are no entitlements and are never touched.
 *
 * @param {Array<{ grantId: string, context: Record<string, unknown> }>} grants
 * @param {Set<string>} declared
 */
function planRoleChanges(grants, declared) {
  const rewrite = [];
  const revoke = [];
  for (const grant of grants) {
    const roles = grantRoles(grant);
    if (!roles) continue;
    const kept = roles.filter((role) => declared.has(role));
    if (kept.length === roles.length) continue;
    if (kept.length === 0) revoke.push(grant);
    else rewrite.push({ grant, kept });
  }
  return { rewrite, revoke };
}

/**
 * Drop from the role grants on installed plugin `plugin` every role its
 * installed version does not declare — none at all when it declares no
 * identity — so a role a manifest removed stays removed: a later version
 * that declares it again finds nobody holding it. A grant left with no role
 * is revoked; one with some is replaced by a grant with those (created
 * first, then the old one revoked — Gatekeeper's duplicate refusal means the
 * principal holds that grant already). Call it once the installed version
 * is approved (an approval, an update that took). Audited
 * (`plugin.entitlement.roles-removed`: the roles, how many grants were
 * rewritten and revoked), then the audiences recomputed. Gatekeeper's
 * failures are returned, never thrown: what was not done is done at the
 * next refresh.
 *
 * @param {{ name: string, route: string | null, identity?: { roles: Array<{ id: string }> } | null }} plugin
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 * @returns {Promise<{ ok: true, rewritten: number, revoked: number, roles: string[] } | { ok: false, error: string }>}
 */
export async function pruneUndeclaredRoles(plugin, { actor, logger }) {
  if (!plugin.route) return { ok: true, rewritten: 0, revoked: 0, roles: [] };
  const declared = declaredRoleIds(plugin.identity);
  const outcome = await pluginMutex.run(plugin.name, async () => {
    const listed = await listPluginGrants(plugin.route);
    if (!listed.ok) return { ok: false, error: listed.error };
    const { rewrite, revoke } = planRoleChanges(listed.grants, declared);
    const removed = new Set();
    const errors = [];
    /** Revoke `grant` (gone already is fine), noting the roles it loses; false when it stays. */
    const revokeNoting = async (grant) => {
      const gone = await revokeGatekeeperGrant(grant.grantId);
      if (!gone.ok && gone.statusCode !== 404) {
        errors.push(gone.error);
        return false;
      }
      for (const role of grantRoles(grant) ?? []) if (!declared.has(role)) removed.add(role);
      return true;
    };
    let rewritten = 0;
    let revoked = 0;
    for (const { grant, kept } of rewrite) {
      const created = await createGatekeeperGrant({
        principalType: grant.principalType,
        principalId: grant.principalId,
        resourceType: 'plugin',
        resourceId: plugin.route,
        context: { ...grant.context, roles: kept },
      });
      if (!created.ok && created.statusCode !== 409) {
        errors.push(created.error);
        continue;
      }
      if (await revokeNoting(grant)) rewritten += 1;
    }
    for (const grant of revoke) {
      if (await revokeNoting(grant)) revoked += 1;
    }
    return { ok: true, rewritten, revoked, roles: [...removed].sort(), errors };
  });
  if (!outcome.ok) {
    logger?.warn(
      { plugin: plugin.name, err: outcome.error },
      'Gatekeeper could not be read — undeclared roles are dropped at the next refresh',
    );
    return outcome;
  }
  const { errors, ...done } = outcome;
  if (errors.length > 0) {
    logger?.warn(
      { plugin: plugin.name, failed: errors.length, err: errors[0] },
      'Some grants still hold roles the plugin no longer declares — retried at the next refresh',
    );
  }
  if (done.rewritten + done.revoked > 0) {
    await recordAuditBestEffort(
      {
        actor,
        action: 'plugin.entitlement.roles-removed',
        plugin: plugin.name,
        details: {
          roles: done.roles,
          grantsRewritten: done.rewritten,
          grantsRevoked: done.revoked,
        },
      },
      logger,
    );
    logger?.info(
      { plugin: plugin.name, rewritten: done.rewritten, revoked: done.revoked },
      'Dropped roles the plugin no longer declares from its grants',
    );
    await recompute(logger);
  }
  return done;
}

/**
 * Revoke every role grant on plugin `plugin`'s route — an uninstall with
 * purge: nothing of who held which role is kept for a later install.
 * Grants without roles stay. Audited as {@link pruneUndeclaredRoles} does
 * (every role removed); Gatekeeper's failures are returned, never thrown.
 *
 * @param {{ name: string, route: string | null }} plugin
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 * @returns {Promise<{ ok: true, revoked: number } | { ok: false, error: string }>}
 */
export async function revokePluginRoleGrants(plugin, opts) {
  const outcome = await pruneUndeclaredRoles({ ...plugin, identity: null }, opts);
  return outcome.ok ? { ok: true, revoked: outcome.revoked } : outcome;
}

/**
 * How many role grants on `route` a staged identity block (`after`, null:
 * none) would change — `{ rewritten, revoked }` — for the approval preview;
 * null when Gatekeeper cannot be read.
 *
 * @param {string | null} route
 * @param {{ roles: Array<{ id: string }> } | null} after
 * @returns {Promise<{ rewritten: number, revoked: number } | null>}
 */
export async function identityGrantImpact(route, after) {
  if (!route) return { rewritten: 0, revoked: 0 };
  const listed = await listPluginGrants(route);
  if (!listed.ok) return null;
  const { rewrite, revoke } = planRoleChanges(listed.grants, declaredRoleIds(after));
  return { rewritten: rewrite.length, revoked: revoke.length };
}

/**
 * A pending update's view with `identity.grantsAffected` — how many role
 * grants approving it would rewrite or revoke — when it removes roles (or
 * the whole block); the view as it was otherwise.
 *
 * @param {object | null} view as `pendingUpdateView` builds it
 * @param {string | null} route
 */
export async function withIdentityGrantImpact(view, route) {
  const identity = view?.identity;
  // A block dropped altogether removes every role it had (`identityDiff`).
  if (!identity || identity.rolesRemoved.length === 0) return view;
  return {
    ...view,
    identity: { ...identity, grantsAffected: await identityGrantImpact(route, identity.after) },
  };
}
