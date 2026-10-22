/**
 * Who a person on a plugin's user surface is to the plugin — what the
 * panel's user-surface context (core `userSurfacePlugin`,
 * `resolveUserCaller`) signs into the caller assertion it forwards to the
 * agent half's `/app/*`: `{ type: 'user', userId, username, roles }`.
 *
 * Gatekeeper attests only the username; everything else comes from here:
 * the directory's user holding that username now, and their roles from the
 * plugin's audience as last computed (`lib/audience.js`) — restricted to
 * the roles the installed version declares. A disabled user is refused at
 * once (the directory is written before Authelia restarts); a user the
 * audience does not hold as an active member is not entitled, and neither
 * is one whose username's earlier holder still has a principal in
 * Gatekeeper to clear.
 */

import { isLamasteUsername } from '@lamalibre/lamaste';
import { readAudienceRow } from './audience.js';
import { findDirectoryUser, principalCleanupPending } from './directory.js';
import { declaredRoleIds } from './entitlements.js';
import { identityReadiness } from './identity-sync.js';
import { findPluginByRoute } from './plugins.js';

const NOT_ENTITLED = 'This user may not use this plugin';

/**
 * The user caller for `username` on the plugin at `route`, or why there is
 * none: 404 when no installed plugin holds the route or it declares no
 * identity; 503 when its identity is not ready (not approved, not hosted,
 * or its agent half has not answered protocol 1 for the installed
 * version); 403 when the user is disabled, removed, unknown or not
 * entitled.
 *
 * @param {string} route
 * @param {string} username the Authelia username Gatekeeper attested
 * @returns {Promise<{ ok: true, caller: { type: 'user', userId: string, username: string, roles: string[] } } | { ok: false, status: 403 | 404 | 503, error: string }>}
 */
export async function resolveUserCaller(route, username) {
  const plugin = await findPluginByRoute(route);
  if (!plugin || !plugin.identity) return { ok: false, status: 404, error: 'Not found' };
  const readiness = await identityReadiness(route);
  if (!readiness.ready) {
    return { ok: false, status: 503, error: 'The plugin is not ready for its users yet' };
  }
  if (!isLamasteUsername(username)) return { ok: false, status: 403, error: NOT_ENTITLED };
  const user = await findDirectoryUser(username);
  if (!user) return { ok: false, status: 403, error: NOT_ENTITLED };
  // An earlier holder's grants may still be in Gatekeeper under this name.
  if (await principalCleanupPending(username)) {
    return { ok: false, status: 403, error: NOT_ENTITLED };
  }
  if (user.status !== 'active') return { ok: false, status: 403, error: 'This user is disabled' };
  const row = await readAudienceRow(plugin.name, user.userId);
  const member = row?.change?.kind === 'upsert' ? row.change.member : null;
  if (!member || member.status !== 'active' || member.userId !== user.userId) {
    return { ok: false, status: 403, error: NOT_ENTITLED };
  }
  const declared = declaredRoleIds(plugin.identity);
  const roles = (Array.isArray(member.roles) ? member.roles : []).filter((role) =>
    declared.has(role),
  );
  if (roles.length === 0) return { ok: false, status: 403, error: NOT_ENTITLED };
  return {
    ok: true,
    caller: { type: 'user', userId: user.userId, username: user.username, roles },
  };
}
