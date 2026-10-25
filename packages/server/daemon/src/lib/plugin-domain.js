/**
 * The domain a plugin belongs to (the multi-domain relay): its OIDC
 * clients' `{domain}` and sign-in, the tunnels that may be bound as its user
 * surface, its web surface's hostname and its audience — the members of the
 * domain. `plugins.domain` (state.db 0016); NULL is the primary.
 */

import { withTunnelLock } from '@lamalibre/lamaste/server';
import { tunnelUserSurfaceRoutes } from '@lamalibre/lamaste';
import { httpError } from './app-error.js';
import { recordAuditBestEffort } from './audit.js';
import { pluginDomainName, resolveActiveDomain } from './domains.js';
import { findPlugin } from './plugins.js';
import { getStateDb } from './state-db.js';
import { readSites, readTunnels, withSitesLock } from './state.js';

/**
 * Move plugin `name` to the active domain `domain`. Refused (409
 * `surface_bound`) while a tunnel is bound as its user surface or it owns a
 * web surface — both are hostnames of its present domain: unbind or delete
 * them first. Under the tunnel and sites locks, which every binding and web
 * surface change holds too. Then its OIDC clients are written again and the
 * audiences recomputed.
 *
 * @param {string} name
 * @param {string} domain
 * @param {{ actor: string, logger: import('pino').Logger }} opts
 * @returns {Promise<{ name: string, domain: string, changed: boolean }>}
 */
export async function setPluginDomain(name, domain, { actor, logger }) {
  const result = await withTunnelLock(() =>
    withSitesLock(async () => {
      const plugin = await findPlugin(name);
      if (!plugin) throw httpError(`Plugin "${name}" is not installed`, 404, { code: 'not_found' });
      const target = await resolveActiveDomain(domain);
      const current = await pluginDomainName(plugin);
      if (current === target) return { name, domain: target, changed: false };
      if (plugin.route) {
        const [tunnels, sites] = await Promise.all([readTunnels(), readSites()]);
        const bound = tunnels.find((t) => tunnelUserSurfaceRoutes(t).includes(plugin.route));
        const owned = sites.find((s) => s.owner?.plugin === plugin.route);
        if (bound || owned) {
          throw httpError(
            `Plugin "${name}" is served on ${(bound ?? owned).fqdn ?? 'a host'} of ${current} — unbind its user surface and delete its web surface first`,
            409,
            { code: 'surface_bound' },
          );
        }
      }
      const db = await getStateDb();
      db.prepare('UPDATE plugins SET domain = ? WHERE name = ?').run(target, name);
      await recordAuditBestEffort(
        {
          actor,
          action: 'plugin.domain.changed',
          plugin: name,
          details: { from: current, to: target },
        },
        logger,
      );
      return { name, domain: target, changed: true };
    }),
  );
  if (result.changed) {
    const { syncOidcClients } = await import('./plugin-oidc.js');
    try {
      await syncOidcClients(logger);
    } catch (err) {
      logger.warn(
        { plugin: name, err: err.message },
        'OIDC clients not rewritten for a new domain',
      );
      // The identity tick syncs them again within a minute; until then the
      // old domain's members still sign in to its clients — say so.
      result.warnings = [
        {
          step: 'oidc',
          message: `The plugin's OIDC clients still admit the previous domain's members (${err.message}); the panel retries within a minute`,
        },
      ];
    }
    const { recomputeAudiences } = await import('./audience.js');
    await recomputeAudiences({ logger });
  }
  return result;
}
