import { readSites, readTunnels } from './state.js';
import { listGrants } from './user-access.js';
import { updateAccessControl } from './authelia.js';

/**
 * Synchronise Authelia access control rules by merging site rules
 * with plugin tunnel grant rules.
 *
 * This must be called whenever:
 * - A grant with target 'agent:*' is created or revoked
 * - A plugin tunnel is created, deleted, or toggled
 * - A site's Authelia settings change
 *
 * @param {import('pino').Logger} [logger]
 */
export async function syncAllAccessControl(logger) {
  let sites = [];
  try {
    sites = await readSites();
  } catch {
    // Sites state may not exist yet
  }

  let tunnels = [];
  try {
    tunnels = await readTunnels();
  } catch {
    // Tunnels state may not exist yet
  }

  const grants = await listGrants();

  // Build Authelia site entries for enabled plugin tunnels
  const pluginTunnels = tunnels.filter((t) => t.type === 'plugin' && t.enabled !== false);

  const pluginSiteRules = pluginTunnels.map((tunnel) => {
    const agentTarget = `agent:${tunnel.agentLabel}`;
    const allowedUsers = grants
      .filter((g) => g.pluginName === tunnel.pluginName && (g.target || 'local') === agentTarget)
      .map((g) => g.username);

    return {
      fqdn: tunnel.fqdn,
      autheliaProtected: true,
      // restrictAccess ensures deny rules are generated even with zero grants
      // (admins-only access until specific users are granted).
      restrictAccess: true,
      allowedUsers,
    };
  });

  // Merge: existing sites first, then plugin tunnel rules
  const allSites = [...sites, ...pluginSiteRules];
  await updateAccessControl(allSites);
  logger?.info({ pluginTunnelCount: pluginTunnels.length }, 'Synced access control rules');
}
