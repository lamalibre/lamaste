/**
 * Startup: bring installed vhosts in line with what the generators in
 * nginx.js produce today.
 *
 * A vhost is written when its tunnel or site is created or reconfigured, so a
 * generator change never reached the ones that already existed. Two changes
 * must:
 *
 * - from 4.3 lamaste-agentd accepts a request from the relay only with a
 *   relay assertion, which only the current agent-panel vhost (signed by the
 *   panel) and plugin vhosts (signed by Gatekeeper) forward;
 * - the authorization subrequest of a Gatekeeper tunnel, of an
 *   Authelia-protected static site and of the auth portal named the client's
 *   `Host` header rather than the vhost's own hostname, so a request line for
 *   one hostname sent with the `Host` of another was authorized for the other
 *   (see `originalUrl` in nginx.js);
 * - from 4.5 the panel serves plugins' user surfaces to a relay assertion
 *   Gatekeeper signs, so every vhost that proxies a browser to the panel —
 *   the panel's own and the auth portal — clears one a client sent, and so
 *   does every tunnel vhost that does not set Gatekeeper's.
 *
 * Each installed vhost is rendered again from state, on the certificate
 * directory the installed file names (a wildcard certificate stays a wildcard
 * certificate), and rewritten only when the text differs — through the same
 * backup / test / rollback path as any vhost write. A rewrite never links a
 * vhost that is not linked now.
 * A rewrite never adds or removes authentication: a vhost that disagrees with
 * its state on that is reported and left alone. The one exception is the
 * agent-panel vhost, whose mTLS check gains the panel's `auth_request`.
 *
 * A tunnel bound as plugins' user surface is rendered with the locations of
 * the routes it serves now (`servedUserSurfaceRoutes`: identity declared and
 * approved, and the tunnel's agent hosting the plugin); the same reconcile,
 * limited to the tunnels a route is bound to, follows the plugin's identity
 * through approval, update and uninstall, its hosting, and the tunnels'
 * agents ({@link reconcileUserSurfaceVhosts}). Every location proxying to a
 * tunnel or agent backend keeps Authelia's session cookie from it
 * (`$lamaste_backend_cookie`), so an installed vhost from before that is
 * rewritten too.
 *
 * From the multi-domain relay, tunnel vhosts are named by their full
 * hostname and every domain has its own auth portal
 * (`lamalibre-lamaste-auth-<domain>`): {@link renameLegacyVhosts} renames
 * the ones an older version named by subdomain, in one reload, before the
 * reconcile renders them.
 */

import { domainOfHost, tunnelUserSurfaceRoutes } from '@lamalibre/lamaste';
import { tunnelHost, withTunnelLock } from '@lamalibre/lamaste/server';
import {
  LEGACY_AUTH_VHOST,
  PANEL_DOMAIN_VHOST,
  agentPanelVhostName,
  appVhostName,
  authVhostName,
  installVhost,
  isSiteEnabled,
  legacyTunnelVhostName,
  readInstalledVhost,
  renameVhosts,
  renderAgentPanelVhost,
  renderAuthVhost,
  renderPanelVhost,
  renderStaticSiteVhost,
  renderTunnelVhost,
  vhostCertDir,
} from './nginx.js';
import { readSites, readTunnels } from './state.js';

/** A subdomain or site id as it may appear in a site name. */
const SITE_NAME_PART_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/;

/**
 * Which of a tunnel's bound routes its vhost serves now — the panel's
 * plugins and their hostings decide (`lib/user-surface.js`), loaded when
 * first needed so this module stays free of the plugin registry.
 *
 * @param {readonly string[]} routes
 * @param {{ agentLabel?: string }} tunnel
 */
async function servedUserSurface(routes, tunnel) {
  const { servedUserSurfaceRoutes } = await import('./user-surface.js');
  return servedUserSurfaceRoutes(routes, tunnel);
}

/**
 * The vhost a tunnel should have, rendered on `certDir`; null for tunnels
 * without one (internal plugin tunnels) or whose state cannot be rendered.
 *
 * @param {object} tunnel
 * @param {string} certDir
 * @param {ReadonlyArray<{ route: string, maxBodySizeMb: number }>} [userSurface] - the user
 *   surfaces its vhost serves (`servedUserSurfaceRoutes` of its bound routes)
 * @returns {{ name: string, fqdn: string, config: string } | null}
 */
export function expectedTunnelVhost(tunnel, certDir, userSurface = []) {
  if (!managedTunnelVhostName(tunnel)) return null;
  const { fqdn, domain } = tunnelHost(tunnel);
  if (tunnel.type === 'panel') {
    return renderAgentPanelVhost(fqdn, domain, tunnel.port, certDir);
  }
  // As createTunnel and updateTunnel write it: the stored access mode
  // (restricted when absent, as Gatekeeper reads it), the plugin route of a
  // plugin tunnel, a body limit only when the tunnel has one, and the user
  // surfaces it serves (never on a public vhost: such state cannot be
  // rendered, and a bound tunnel cannot be made public).
  const accessMode = tunnel.accessMode ?? 'restricted';
  if (accessMode === 'public' && userSurface.length > 0) return null;
  return renderTunnelVhost(accessMode, fqdn, domain, tunnel.port, certDir, {
    ...(tunnel.type === 'plugin' && tunnel.pluginRoute ? { pathPrefix: tunnel.pluginRoute } : {}),
    ...(tunnel.maxBodySizeMb !== undefined ? { maxBodySizeMb: tunnel.maxBodySizeMb } : {}),
    ...(userSurface.length > 0 ? { userSurface } : {}),
  });
}

/**
 * Site name of a tunnel's vhost — by its hostname — or null for a tunnel
 * without one (internal, or whose state names no `<subdomain>.<domain>`).
 */
function managedTunnelVhostName(tunnel) {
  if (tunnel.exposure === 'internal' || typeof tunnel.subdomain !== 'string') return null;
  if (!SITE_NAME_PART_RE.test(tunnel.subdomain)) return null;
  const host = tunnelHost(tunnel);
  if (host === null) return null;
  if (tunnel.type === 'panel') return agentPanelVhostName(host.fqdn);
  // Tunnels persisted before `type` existed are app tunnels.
  if (tunnel.type === 'app' || tunnel.type === 'plugin' || tunnel.type === undefined) {
    return appVhostName(host.fqdn);
  }
  return null;
}

/** True when a vhost asks for authorization before proxying or serving. */
function authenticates(config) {
  return /^\s*auth_request\s/m.test(config);
}

function newResult() {
  return { rewritten: [], unchanged: 0, skipped: [], failed: [] };
}

/**
 * Compare one installed vhost with what it should be and rewrite it when it
 * differs; record the outcome in `result` under `label`.
 *
 * @param {object} p
 * @param {string} p.name - site name in sites-available
 * @param {string} p.label - how the result names it: the vhost's hostname
 * @param {(certDir: string) => ({ name: string, fqdn: string, config: string } | null)} p.render
 * @param {() => Promise<boolean>} p.enabled - whether the rewritten site is linked
 * @param {boolean} [p.keepAuthentication] - refuse a rewrite that adds or removes `auth_request` (default true)
 * @param {boolean} [p.reportMissing] - report a vhost that is not installed (default true)
 * @param {ReturnType<typeof newResult>} result
 * @param {{ readInstalledVhost: typeof readInstalledVhost, installVhost: typeof installVhost }} deps
 */
async function reconcileOne(
  { name, label, render, enabled, keepAuthentication = true, reportMissing = true },
  result,
  deps,
) {
  try {
    const installed = await deps.readInstalledVhost(name);
    if (installed === null) {
      if (reportMissing) result.skipped.push({ vhost: label, reason: 'no vhost installed' });
      return;
    }
    const certDir = vhostCertDir(installed);
    if (!certDir) {
      result.skipped.push({ vhost: label, reason: 'installed vhost names no certificate' });
      return;
    }
    const expected = render(certDir);
    if (!expected) {
      result.skipped.push({ vhost: label, reason: 'state cannot be rendered' });
      return;
    }
    if (expected.config === installed) {
      result.unchanged += 1;
      return;
    }
    if (keepAuthentication && authenticates(expected.config) !== authenticates(installed)) {
      result.skipped.push({
        vhost: label,
        reason:
          'installed vhost and state disagree on whether it authenticates; reconfigure it to rewrite the vhost',
      });
      return;
    }
    await deps.installVhost(expected.name, expected.config, expected.fqdn, {
      enabled: await enabled(),
    });
    result.rewritten.push(label);
  } catch (err) {
    result.failed.push({ vhost: label, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * @param {{ info(o: object, m?: string): void, warn(o: object, m?: string): void, error(o: object, m?: string): void }} log
 * @param {'tunnel' | 'site'} what - the vhosts the result is about, for the log messages
 * @param {ReturnType<typeof newResult>} result
 */
function logResult(log, what, result) {
  if (result.rewritten.length > 0) {
    log.info({ rewritten: result.rewritten }, `Rewrote ${what} vhosts`);
  }
  if (result.skipped.length > 0) {
    log.warn({ skipped: result.skipped }, `Left ${what} vhosts as they are`);
  }
  for (const failure of result.failed) {
    log.error(failure, `Failed to rewrite ${what} vhost; the previous vhost was restored`);
  }
}

const defaultTunnelDeps = {
  readTunnels,
  readInstalledVhost,
  installVhost,
  isSiteEnabled,
  servedUserSurface,
};

/**
 * Reconcile one tunnel's vhost (see {@link reconcileOne}), with the user
 * surfaces it serves now. The caller holds the tunnel lock.
 */
async function reconcileTunnel(tunnel, result, deps) {
  const name = managedTunnelVhostName(tunnel);
  if (!name) return;
  const label = tunnel.fqdn ?? tunnel.subdomain;
  const bound = tunnelUserSurfaceRoutes(tunnel);
  let served;
  try {
    served = bound.length > 0 ? await deps.servedUserSurface(bound, tunnel) : [];
  } catch (err) {
    result.failed.push({ vhost: label, error: err instanceof Error ? err.message : String(err) });
    return;
  }
  await reconcileOne(
    {
      name,
      label,
      render: (certDir) => expectedTunnelVhost(tunnel, certDir, served),
      // Linked only when it is now and the tunnel is enabled: a rewrite of
      // the text never publishes a vhost someone unlinked, and unlinks a
      // disabled tunnel's.
      enabled: async () => tunnel.enabled !== false && (await deps.isSiteEnabled(name)),
      keepAuthentication: tunnel.type !== 'panel',
    },
    result,
    deps,
  );
}

/**
 * Reconcile the vhost of every tunnel that has one: agent-panel, app and
 * plugin tunnels. Runs under the tunnel lock, so no tunnel change
 * interleaves. Call it once the panel listens: a rewritten agent-panel vhost
 * asks the panel about every request.
 *
 * @param {Parameters<typeof logResult>[0]} log
 * @param {typeof defaultTunnelDeps} [deps]
 * @returns {Promise<ReturnType<typeof newResult>>}
 */
export async function reconcileTunnelVhosts(log, deps = defaultTunnelDeps) {
  return withTunnelLock(async () => {
    const result = newResult();
    for (const tunnel of await deps.readTunnels()) {
      await reconcileTunnel(tunnel, result, deps);
    }
    logResult(log, 'tunnel', result);
    return result;
  });
}

/**
 * Reconcile the vhosts of the tunnels `route` is bound to as a user
 * surface — after a change that decides whether they serve it: the
 * plugin's installation, the approval of its version, an update or its
 * reversal, its hosting. `ids` names tunnels to reconcile besides (the
 * route's binding was just released from them, or their agent was
 * revoked — `route` null then). Under the tunnel lock.
 *
 * @param {Parameters<typeof logResult>[0]} log
 * @param {string | null} route
 * @param {{ ids?: readonly string[] }} [opts]
 * @param {typeof defaultTunnelDeps} [deps]
 * @returns {Promise<ReturnType<typeof newResult>>}
 */
export async function reconcileUserSurfaceVhosts(
  log,
  route,
  { ids = [] } = {},
  deps = defaultTunnelDeps,
) {
  return withTunnelLock(async () => {
    const result = newResult();
    for (const tunnel of await deps.readTunnels()) {
      if (
        !ids.includes(tunnel.id) &&
        (route === null || !tunnelUserSurfaceRoutes(tunnel).includes(route))
      ) {
        continue;
      }
      await reconcileTunnel(tunnel, result, deps);
    }
    logResult(log, 'user-surface tunnel', result);
    return result;
  });
}

const defaultSiteDeps = { readSites, readInstalledVhost, installVhost, isSiteEnabled };

/**
 * Reconcile the vhosts that proxy a browser to the panel or ask Authelia
 * directly: the panel's own (`panel.<primary>`), every active domain's auth
 * portal (`auth.<domain>`) and every static site but a plugin's web surface.
 * Call it before the panel listens — then nothing can change a site
 * meanwhile.
 *
 * @param {Parameters<typeof logResult>[0]} log
 * @param {ReadonlyArray<{ name: string, primary: boolean }>} domains the active domains
 * @param {typeof defaultSiteDeps} [deps]
 * @returns {Promise<ReturnType<typeof newResult>>}
 */
export async function reconcileSiteVhosts(log, domains, deps = defaultSiteDeps) {
  const result = newResult();
  const primary = domains.find((d) => d.primary)?.name;

  if (primary) {
    await reconcileOne(
      {
        name: PANEL_DOMAIN_VHOST,
        label: `panel.${primary}`,
        render: (certDir) => renderPanelVhost(primary, certDir),
        enabled: () => deps.isSiteEnabled(PANEL_DOMAIN_VHOST),
      },
      result,
      deps,
    );
  }

  for (const domain of domains) {
    const name = authVhostName(domain.name);
    await reconcileOne(
      {
        name,
        label: `auth.${domain.name}`,
        render: (certDir) => renderAuthVhost(domain.name, certDir, { primary: domain.primary }),
        enabled: () => deps.isSiteEnabled(name),
      },
      result,
      deps,
    );
  }

  const names = domains.map((d) => d.name);

  let sites = [];
  try {
    sites = await deps.readSites();
  } catch (err) {
    result.failed.push({ vhost: 'sites', error: err instanceof Error ? err.message : String(err) });
  }
  for (const site of sites) {
    if (typeof site.id !== 'string' || !SITE_NAME_PART_RE.test(site.id)) continue;
    // A plugin's web surface is its plugin's to render (lib/web-surface.js
    // `reconcileWebSurfaces`, once plugins and hostings can be read).
    if (site.owner) continue;
    const name = `lamalibre-lamaste-site-${site.id}`;
    await reconcileOne(
      {
        name,
        label: site.fqdn ?? site.id,
        render: (certDir) =>
          renderStaticSiteVhost(
            site,
            certDir,
            typeof site.fqdn === 'string' ? domainOfHost(site.fqdn, names) : null,
          ),
        enabled: () => deps.isSiteEnabled(name),
        // A site still waiting for its DNS or certificate has no vhost yet.
        reportMissing: site.certIssued === true,
      },
      result,
      deps,
    );
  }

  logResult(log, 'site', result);
  return result;
}

const defaultRenameDeps = { readTunnels, renameVhosts };

/**
 * Rename the vhosts an older version named by subdomain — every tunnel's
 * (`lamalibre-lamaste-app-<subdomain>`, `-agent-panel-<subdomain>`) and the
 * auth portal (`lamalibre-lamaste-auth`, the primary's) — to their names by
 * hostname, in one reload ({@link renameVhosts} in nginx.js: same text, same
 * link state; all of it undone when nginx refuses). Idempotent: a vhost
 * already renamed, or never installed, is left alone. Before the panel
 * listens, under the tunnel lock; a failure is logged and the old names keep
 * serving (the next start tries again).
 *
 * @param {Parameters<typeof logResult>[0]} log
 * @param {string} primary the primary domain
 * @param {typeof defaultRenameDeps} [deps]
 * @returns {Promise<string[]>} the names written
 */
export async function renameLegacyVhosts(log, primary, deps = defaultRenameDeps) {
  return withTunnelLock(async () => {
    const renames = [{ from: LEGACY_AUTH_VHOST, to: authVhostName(primary) }];
    for (const tunnel of await deps.readTunnels()) {
      const to = managedTunnelVhostName(tunnel);
      if (to === null) continue;
      renames.push({ from: legacyTunnelVhostName(tunnel.type, tunnel.subdomain), to });
    }
    try {
      const renamed = await deps.renameVhosts(renames);
      if (renamed.length > 0) log.info({ renamed }, 'Renamed vhosts to their hostnames');
      return renamed;
    } catch (err) {
      log.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Renaming vhosts to their hostnames failed; the old names keep serving',
      );
      return [];
    }
  });
}
