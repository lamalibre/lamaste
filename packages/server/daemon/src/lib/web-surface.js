/**
 * Plugins' web surfaces on the relay (slice 7): the static shell an
 * agent-hosted plugin ships in its server package (`userSurface.web`),
 * served on a site the plugin owns beside its user surface's
 * `/api/<route>/app/*` — one host, one Authelia session.
 *
 * **Trees.** The relay serves only the approved web tree of the installed
 * version: once that version is approved (and after every update, revert or
 * restart) its tree is copied out of the installed package into the store
 * (core `stageWebTree`, checked against the approved digest) and switched
 * to (core `switchWebTree`: `current` and `previous` replaced by a rename)
 * — {@link syncWebSurfaceTree}. Until then the store keeps serving what it
 * served.
 *
 * **The site.** A plugin owns at most one site (`owner: { plugin }` in
 * sites.json), created on its declared subdomain once an administrator
 * confirms ({@link createWebSurface}) or taken over from the tunnel bound
 * as its user surface ({@link moveWebSurfaceFromTunnel}), and deleted
 * ({@link deleteWebSurface}). Its files are never uploaded: the files API
 * and `lamaste-agent deploy` refuse it. Its vhost serves the shell and the
 * API while the surface is served ({@link webSurfaceServing}: the installed
 * version approved, declaring identity and a web surface, hosted, its tree
 * current) and answers 503 otherwise; {@link refreshWebSurface} brings it
 * in line whenever that may have changed.
 *
 * **Locks.** Giving a site a hostname takes core's tunnel lock, then the
 * sites lock (`withSitesLock`), as every such workflow does.
 *
 * Audit: `plugin.web-surface.created`, `.deleted`, `.moved`,
 * `plugin.web-tree.switched`.
 */

import crypto from 'node:crypto';
import {
  KeyedPromiseChainMutex,
  domainOfHost,
  isWebSurfaceSubdomain,
  siteUserSurfaceRoute,
  tunnelUserSurfaceRoutes,
  WebTreeError,
} from '@lamalibre/lamaste';
import {
  TUNNEL_MAX_BODY_MB,
  WEB_TREES_ROOT,
  readWebTreeStore,
  removeWebTreeStore,
  stageWebTree,
  switchWebTree,
  tunnelHost,
  webTreeStoreDir,
  withTunnelLock,
} from '@lamalibre/lamaste/server';
import { httpError } from './app-error.js';
import { recordAuditBestEffort } from './audit.js';
import { getCertPath, issueTunnelCert } from './certbot.js';
import { syncChisel } from './chisel.js';
import { getConfig } from './config.js';
import { activeDomainNames, pluginDomainName, primaryDomainName } from './domains.js';
import {
  createGatekeeperGrant,
  listResourceGrants,
  revokeGatekeeperGrant,
} from './gatekeeper-client.js';
import {
  appVhostName,
  installVhost,
  moveAppVhostToWebSurface,
  readInstalledVhost,
  reload as reloadNginx,
  removeStaticSiteVhost,
  renderWebSurfaceVhost,
  unlinkMovedAppVhost,
  vhostCertDir,
} from './nginx.js';
import { installedVersionApproved } from './plugin-hooks.js';
import { installedWebTreeDir } from './plugin-packages.js';
import { findPluginByRoute } from './plugins.js';
import { readSites, readTunnels, withSitesLock, writeSites, writeTunnels } from './state.js';
import { hostingAgentOf, internalTunnelBodyLimit } from './user-surface.js';

/** Where the web trees live (a test points it elsewhere). */
const TREES_ROOT = process.env.LAMALIBRE_LAMASTE_WEB_TREES_ROOT || WEB_TREES_ROOT;

/** The tree store of plugin `route`. */
export function webTreesDir(route) {
  return webTreeStoreDir(route, TREES_ROOT);
}

/** What the workflows below do to nginx, certificates and chisel (tests replace them). */
const defaultDeps = Object.freeze({
  getCertPath,
  issueTunnelCert,
  installVhost,
  moveAppVhostToWebSurface,
  readInstalledVhost,
  reloadNginx,
  removeStaticSiteVhost,
  syncChisel,
  unlinkMovedAppVhost,
});
let deps = defaultDeps;

/** @param {Partial<typeof defaultDeps> | null} override */
export function setWebSurfaceDepsForTests(override) {
  deps = override ? { ...defaultDeps, ...override } : defaultDeps;
}

const siteVhostName = (site) => `lamalibre-lamaste-site-${site.id}`;

/** One change of a plugin's tree store at a time (a copy, a switch, a removal). */
const treeMutex = new KeyedPromiseChainMutex();

/** The site plugin `route` owns among `sites`, or null. */
export function ownedSiteOf(route, sites) {
  return sites.find((site) => siteUserSurfaceRoute(site) === route) ?? null;
}

/**
 * Whether `site` was created for the installed plugin `plugin` — its route
 * and its package. A site outlives its plugin's uninstall; a different
 * package installed later under the same route does not inherit it (its
 * hostname, its grants, the old tree) — an administrator deletes it first.
 */
function siteOwnedBy(site, plugin) {
  return siteUserSurfaceRoute(site) === plugin.route && site.owner?.package === plugin.packageName;
}

function refuse(message, statusCode, code) {
  return httpError(message, statusCode, { code });
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

/**
 * Serve the approved web tree of the version of plugin `route` installed
 * now: copy it out of the installed package into the store when it is not
 * there (checked against the approved digest), then switch `current` to
 * it. The plugin is read inside the store's lock, so two refreshes never
 * switch to an older version's tree. Nothing happens while the version
 * declares no web surface or is not approved, or — unless `withoutSite`
 * (a site being created for it) — while the plugin owns no site: the
 * store keeps serving what it served, and a deleted store stays deleted.
 * Returns whether `current` moved. Throws.
 *
 * @param {string} route
 * @param {{ logger?: import('pino').Logger, withoutSite?: boolean }} [opts]
 */
export async function syncWebSurfaceTree(route, { logger, withoutSite = false } = {}) {
  const switched = await treeMutex.run(route, async () => {
    const plugin = await findPluginByRoute(route);
    if (!plugin?.userSurface?.web || !plugin.webTreeSha256) return null;
    if (!withoutSite) {
      const site = ownedSiteOf(route, await readSites());
      if (!site || !siteOwnedBy(site, plugin)) return null;
    }
    if (!(await installedVersionApproved(plugin).catch(() => false))) return null;
    const dir = webTreesDir(route);
    const source = await installedWebTreeDir(plugin.packageName, plugin);
    await stageWebTree(dir, source, plugin.webTreeSha256);
    return (await switchWebTree(dir, plugin.webTreeSha256)) ? plugin : null;
  });
  if (switched) {
    await recordAuditBestEffort(
      {
        actor: 'lamaste',
        action: 'plugin.web-tree.switched',
        plugin: switched.name,
        details: { version: switched.version, treeSha256: switched.webTreeSha256 },
      },
      logger,
    );
  }
  return switched !== null;
}

// ---------------------------------------------------------------------------
// Serving
// ---------------------------------------------------------------------------

/**
 * Whether plugin `route`'s web surface is served — its shell and API on the
 * site it owns — and why not: `not_installed`, `no_identity`,
 * `no_web_surface` (its installed version declares none), `not_owner` (its
 * route's site was created for another package), `not_approved`,
 * `not_hosted`, `tree_not_current` (the approved tree is not the one the
 * store serves yet).
 *
 * @param {string} route
 * @param {readonly object[]} tunnels the tunnel state
 * @returns {Promise<{ served: true, plugin: object } | { served: false, reason: string, plugin: object | null }>}
 */
export async function webSurfaceServing(route, tunnels) {
  const plugin = await findPluginByRoute(route);
  if (!plugin) return { served: false, reason: 'not_installed', plugin: null };
  if (!plugin.identity) return { served: false, reason: 'no_identity', plugin };
  if (!plugin.userSurface?.web) return { served: false, reason: 'no_web_surface', plugin };
  const site = ownedSiteOf(route, await readSites());
  if (site && !siteOwnedBy(site, plugin)) return { served: false, reason: 'not_owner', plugin };
  if (!(await installedVersionApproved(plugin).catch(() => false))) {
    return { served: false, reason: 'not_approved', plugin };
  }
  if ((await hostingAgentOf(plugin, tunnels)) === null) {
    return { served: false, reason: 'not_hosted', plugin };
  }
  const { current } = await readWebTreeStore(webTreesDir(route));
  if (current !== plugin.webTreeSha256) {
    return { served: false, reason: 'tree_not_current', plugin };
  }
  return { served: true, plugin };
}

/**
 * The domain the hostname `fqdn` is under — of the active domains, the
 * primary when it is under none (a site from before the multi-domain relay
 * is always under the primary).
 */
async function hostDomain(fqdn) {
  return domainOfHost(fqdn, await activeDomainNames()) ?? (await primaryDomainName());
}

/**
 * The vhost of the site `site` (owned by plugin `route`) as it should be
 * now, on certificate directory `certDir`.
 */
async function renderOwnedSite(site, route, certDir, tunnels) {
  const serving = await webSurfaceServing(route, tunnels);
  const maxBodySizeMb = serving.plugin
    ? await internalTunnelBodyLimit(serving.plugin, tunnels)
    : undefined;
  return renderWebSurfaceVhost(site, certDir, await hostDomain(site.fqdn), {
    route,
    served: serving.served,
    maxBodySizeMb: maxBodySizeMb ?? TUNNEL_MAX_BODY_MB.default,
    treesDir: webTreesDir(route),
    clearSiteData: !serving.served && serving.reason === 'not_installed',
  });
}

/**
 * Rewrite the vhost of the site plugin `route` owns when what it should be
 * differs from what is installed (rendered on the certificate the installed
 * vhost names). Returns whether it wrote.
 */
async function reconcileOwnedSiteVhost(site, route, tunnels) {
  // A move stopped between its state writes and the handover leaves the
  // tunnel's vhost linked beside the site's, on the same hostname.
  const moved = tunnels.find((t) => t.fqdn === site.fqdn && t.enabled === false && t.subdomain);
  const unlinked = moved ? await deps.unlinkMovedAppVhost(moved.fqdn) : false;
  const installed = await deps.readInstalledVhost(siteVhostName(site));
  const certDir =
    (installed && vhostCertDir(installed)) ||
    (await deps.getCertPath(site.fqdn, await hostDomain(site.fqdn)));
  const { name, fqdn, config } = await renderOwnedSite(site, route, certDir, tunnels);
  if (installed === config) {
    if (unlinked) await deps.reloadNginx();
    return unlinked;
  }
  await deps.installVhost(name, config, fqdn, { enabled: true });
  return true;
}

/**
 * Whether plugin `route`'s web surface is served may have changed — its
 * version was approved, updated or reverted, it was hosted, unhosted or
 * uninstalled: serve its approved tree, then bring its site's vhost in
 * line. Best effort — logged, never thrown; the panel's start reconciles
 * again.
 *
 * @param {string | null | undefined} route
 * @param {import('pino').Logger} [logger]
 */
export async function refreshWebSurface(route, logger) {
  if (!route) return;
  try {
    await syncWebSurfaceTree(route, { logger });
  } catch (err) {
    logger?.error?.(
      { route, err: err instanceof Error ? err.message : String(err) },
      'Could not serve the approved web tree of a plugin',
    );
  }
  try {
    // Under the sites lock: a site deleted meanwhile never gets its vhost back.
    await withSitesLock(async () => {
      const site = ownedSiteOf(route, await readSites());
      if (site) await reconcileOwnedSiteVhost(site, route, await readTunnels());
    });
  } catch (err) {
    logger?.warn?.(
      { route, err: err instanceof Error ? err.message : String(err) },
      'Could not bring the vhost of a web surface in line',
    );
  }
}

/**
 * Every web surface at the panel's start: each plugin's approved tree
 * served, each owned site's vhost in line. Logged, never thrown.
 *
 * @param {import('pino').Logger} logger
 */
export async function reconcileWebSurfaces(logger) {
  const sites = await readSites().catch(() => []);
  for (const site of sites) {
    const route = siteUserSurfaceRoute(site);
    if (route) await refreshWebSurface(route, logger);
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Plugin `route`'s web surface as the panel shows it: what its installed
 * version declares, the site it owns, whether it is served (and why not),
 * the trees the store holds, and — when it owns no site — the subdomain
 * Lamaste offers and whether it is free.
 *
 * @param {string} route
 */
export async function webSurfaceStatus(route) {
  const plugin = await findPluginByRoute(route);
  const [sites, tunnels] = await Promise.all([readSites(), readTunnels()]);
  const site = ownedSiteOf(route, sites);
  // A site outlives its plugin: its status stays readable, so that it can
  // be deleted.
  if (!plugin && !site) {
    throw refuse(`No installed plugin or web surface holds the route '${route}'`, 404, 'not_found');
  }
  const serving = await webSurfaceServing(route, tunnels);
  const store = await readWebTreeStore(webTreesDir(route));
  const declared = plugin?.userSurface?.web ?? null;
  // Bound, enabled or not: creating a site is refused either way (a
  // disabled one is unbound, or enabled and moved).
  const boundTunnel = tunnels.find((t) => tunnelUserSurfaceRoutes(t).includes(route)) ?? null;
  // While a tunnel is bound as its user surface, the way to a site is a
  // move (creating one is refused): nothing is offered.
  let offer = null;
  if (!site && declared && !boundTunnel) {
    const subdomain = declared.defaultSubdomain;
    const domain = await pluginDomainName(plugin);
    offer = {
      subdomain,
      domain,
      accessMode: declared.accessMode,
      available: (await hostnameTaken(subdomain, domain, sites, tunnels)) === null,
    };
  }
  return {
    declared,
    site: site
      ? {
          id: site.id,
          name: site.name,
          fqdn: site.fqdn,
          accessMode: site.accessMode ?? null,
          ownerPackage: site.owner?.package ?? null,
        }
      : null,
    served: serving.served,
    reason: serving.served ? null : serving.reason,
    tree: {
      approved: plugin?.webTreeSha256 ?? null,
      current: store.current,
      previous: store.previous,
    },
    boundTunnel: boundTunnel
      ? {
          id: boundTunnel.id,
          fqdn: boundTunnel.fqdn ?? null,
          enabled: boundTunnel.enabled !== false,
          routes: tunnelUserSurfaceRoutes(boundTunnel),
        }
      : null,
    offer,
  };
}

// ---------------------------------------------------------------------------
// Creating, deleting, moving
// ---------------------------------------------------------------------------

/**
 * Why `subdomain` of `domain` cannot be a new web surface's hostname, or
 * null when it can: reserved, held by a tunnel, or taken by a site (its
 * hostname or an alias — or its name: site names are unique relay-wide).
 */
async function hostnameTaken(subdomain, domain, sites, tunnels) {
  if (!isWebSurfaceSubdomain(subdomain))
    return `'${subdomain}' cannot be a web surface's subdomain`;
  const fqdn = `${subdomain}.${domain}`;
  if (tunnels.some((t) => t.fqdn === fqdn)) {
    return `a tunnel holds '${fqdn}'`;
  }
  if (sites.some((s) => s.fqdn === fqdn || (s.aliases ?? []).includes(fqdn))) {
    return `a site holds '${fqdn}'`;
  }
  if (sites.some((s) => s.name === subdomain)) {
    return `a site is named '${subdomain}'`;
  }
  return null;
}

/**
 * The installed plugin at `route` whose installed version declares a web
 * surface, checked for a workflow that gives it a site — or a refusal.
 */
async function webSurfacePlugin(route) {
  const plugin = await findPluginByRoute(route);
  if (!plugin) throw refuse(`No installed plugin holds the route '${route}'`, 404, 'not_found');
  if (!plugin.userSurface?.web) {
    throw refuse(
      `Plugin "${plugin.name}" ${plugin.version} declares no web surface`,
      400,
      'no_web_surface',
    );
  }
  if (!plugin.identity) {
    throw refuse(`Plugin "${plugin.name}" declares no identity`, 400, 'no_identity');
  }
  return plugin;
}

/** A plugin-owned site entry as sites.json stores it. */
function ownedSiteEntry({ id, subdomain, fqdn, plugin, accessMode }) {
  const route = plugin.route;
  return {
    id,
    name: subdomain,
    fqdn,
    type: 'managed',
    spaMode: true,
    autheliaProtected: false,
    allowedUsers: [],
    dnsVerified: true,
    certIssued: true,
    rootPath: `${webTreesDir(route)}/current`,
    createdAt: new Date().toISOString(),
    totalSize: 0,
    owner: { plugin: route, package: plugin.packageName },
    accessMode,
  };
}

/** Serve the approved tree when there is one; a tree that cannot be served is a refusal. */
async function serveApprovedTree(plugin, logger) {
  try {
    await syncWebSurfaceTree(plugin.route, { logger, withoutSite: true });
  } catch (err) {
    if (err instanceof WebTreeError) {
      throw refuse(
        `The web tree of "${plugin.name}" cannot be served: ${err.message}`,
        409,
        'web_tree',
      );
    }
    throw err;
  }
}

/**
 * Give plugin `route` its web surface on `subdomain` of the plugin's domain
 * (default: the one its manifest declares) with `accessMode` (default: the
 * declared one): a certificate, the site entry, the vhost. The plugin must
 * declare a web surface and own no site, and no tunnel may be bound as its
 * user surface (move that one instead). The site answers 503 until the
 * surface is served.
 *
 * @param {string} route
 * @param {{ subdomain?: string, accessMode?: 'authenticated' | 'restricted' }} input
 * @param {{ actor: string, logger: import('pino').Logger }} opts
 */
export function createWebSurface(route, input, { actor, logger }) {
  return withTunnelLock(() =>
    withSitesLock(async () => {
      const plugin = await webSurfacePlugin(route);
      const config = getConfig();
      if (!config.domain || !config.email) {
        throw refuse('Domain and email must be configured', 400, 'domain_not_configured');
      }
      const subdomain = input.subdomain ?? plugin.userSurface.web.defaultSubdomain;
      const accessMode = input.accessMode ?? plugin.userSurface.web.accessMode;
      const [sites, tunnels] = await Promise.all([readSites(), readTunnels()]);
      if (ownedSiteOf(route, sites)) {
        throw refuse(`Plugin "${plugin.name}" has a web surface already`, 409, 'exists');
      }
      const bound = tunnels.find((t) => tunnelUserSurfaceRoutes(t).includes(route));
      if (bound) {
        throw refuse(
          `Tunnel '${bound.fqdn ?? bound.id}' is bound as the user surface of "${plugin.name}" — move it to the web surface instead`,
          409,
          'bound_to_tunnel',
        );
      }
      const domain = await pluginDomainName(plugin);
      const taken = await hostnameTaken(subdomain, domain, sites, tunnels);
      if (taken) throw refuse(`Cannot use '${subdomain}': ${taken}`, 409, 'hostname_taken');

      await serveApprovedTree(plugin, logger);
      const fqdn = `${subdomain}.${domain}`;
      const cert = await deps.issueTunnelCert(fqdn, config.email);
      const site = ownedSiteEntry({ id: crypto.randomUUID(), subdomain, fqdn, plugin, accessMode });
      await writeSites([...sites, site]);
      try {
        const { name, config: vhost } = await renderOwnedSite(site, route, cert.certPath, tunnels);
        await deps.installVhost(name, vhost, fqdn, { enabled: true });
      } catch (err) {
        await writeSites(sites);
        throw err;
      }
      await recordAuditBestEffort(
        {
          actor,
          action: 'plugin.web-surface.created',
          plugin: plugin.name,
          details: { siteId: site.id, fqdn, accessMode },
        },
        logger,
      );
      return webSurfaceStatus(route);
    }),
  );
}

/**
 * Delete plugin `route`'s web surface: its vhost, its site entry, its
 * tree store and the grants on the site. The plugin stays installed.
 *
 * @param {string} route
 * @param {{ actor: string, logger: import('pino').Logger }} opts
 */
export function deleteWebSurface(route, { actor, logger }) {
  return withSitesLock(async () => {
    const sites = await readSites();
    const site = ownedSiteOf(route, sites);
    if (!site) throw refuse(`No web surface for the route '${route}'`, 404, 'not_found');
    await deps.removeStaticSiteVhost(site.id);
    await writeSites(sites.filter((s) => s.id !== site.id));
    await treeMutex.run(route, () => removeWebTreeStore(webTreesDir(route)));
    const revoked = await revokeSiteGrants(site.id, logger);
    // What is left on the deleted site: grants Gatekeeper kept, or none
    // known because it could not list them.
    const left = revoked.unlisted
      ? { grantsUnlisted: true }
      : revoked.notRevoked.length > 0
        ? { grantsNotRevoked: revoked.notRevoked }
        : {};
    await recordAuditBestEffort(
      {
        actor,
        action: 'plugin.web-surface.deleted',
        plugin: (await findPluginByRoute(route))?.name ?? null,
        details: { siteId: site.id, fqdn: site.fqdn, ...left },
      },
      logger,
    );
    return { ok: true, ...left };
  });
}

/**
 * Revoke grants `grantIds`; returns the ids Gatekeeper did not revoke
 * (logged), for the caller to report.
 */
async function revokeGrants(grantIds, logger) {
  const failed = [];
  for (const grantId of grantIds) {
    const result = await revokeGatekeeperGrant(grantId).catch((err) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }));
    if (!result.ok) failed.push(grantId);
  }
  if (failed.length > 0) {
    logger?.warn?.({ grantIds: failed }, 'Gatekeeper did not revoke grants of a web surface');
  }
  return failed;
}

/**
 * Revoke every grant on site `siteId`: `{ notRevoked }`, the ids
 * Gatekeeper kept — or `{ unlisted: true }` when it could not list them.
 */
async function revokeSiteGrants(siteId, logger) {
  const grants = await listResourceGrants('site', siteId);
  if (!grants.ok) {
    logger?.warn?.({ siteId, error: grants.error }, 'Could not list the grants of a web surface');
    return { unlisted: true };
  }
  return {
    notRevoked: await revokeGrants(
      grants.grants.map((g) => g.grantId),
      logger,
    ),
  };
}

/**
 * Copy the grants on tunnel `tunnelId` to the site `siteId` (a restricted
 * host keeps its users). Returns the grants created; on a failure revokes
 * them and throws.
 */
async function copyTunnelGrants(tunnelId, siteId, logger) {
  const listed = await listResourceGrants('tunnel', tunnelId);
  if (!listed.ok) {
    throw refuse(
      `Could not read the tunnel's grants from Gatekeeper: ${listed.error}`,
      503,
      'gatekeeper',
    );
  }
  const created = [];
  for (const grant of listed.grants) {
    const result = await createGatekeeperGrant({
      principalType: grant.principalType,
      principalId: grant.principalId,
      resourceType: 'site',
      resourceId: siteId,
      context: grant.context,
    });
    if (!result.ok) {
      await revokeGrants(
        created.map((g) => g.grantId),
        logger,
      );
      throw refuse(`Could not copy the tunnel's grants: ${result.error}`, 503, 'gatekeeper');
    }
    created.push(result.grant);
  }
  return created;
}

/**
 * Move plugin `route`'s user surface from tunnel `tunnelId` — bound to it,
 * and to nothing else — to the plugin's web surface on the same hostname,
 * in one nginx reload: the shell is then served from the plugin's approved
 * tree on the relay, and the API as before. The tunnel stays in the state,
 * disabled and unbound (its port grant withdrawn once nginx no longer
 * routes to it), for a rollback by hand. A restricted tunnel's grants are
 * copied to the site. The plugin must be served — approved, hosted by the
 * tunnel's agent — and its approved tree is served first.
 *
 * @param {string} route
 * @param {string} tunnelId
 * @param {{ actor: string, logger: import('pino').Logger }} opts
 */
export function moveWebSurfaceFromTunnel(route, tunnelId, { actor, logger }) {
  return withTunnelLock(() =>
    withSitesLock(async () => {
      const plugin = await webSurfacePlugin(route);
      const [sites, tunnels] = await Promise.all([readSites(), readTunnels()]);
      if (ownedSiteOf(route, sites)) {
        throw refuse(`Plugin "${plugin.name}" has a web surface already`, 409, 'exists');
      }
      const tunnel = tunnels.find((t) => t.id === tunnelId);
      if (!tunnel) throw refuse('Tunnel not found', 404, 'not_found');
      const routes = tunnelUserSurfaceRoutes(tunnel);
      if (!routes.includes(route)) {
        throw refuse(`Tunnel '${tunnel.fqdn}' is not bound to "${plugin.name}"`, 409, 'not_bound');
      }
      if (routes.length > 1) {
        throw refuse(
          `Tunnel '${tunnel.fqdn}' serves other user surfaces too (${routes.filter((r) => r !== route).join(', ')}) — unbind them first`,
          409,
          'shared_tunnel',
        );
      }
      if (tunnel.enabled === false || typeof tunnel.fqdn !== 'string') {
        throw refuse(`Tunnel '${tunnel.id}' is disabled`, 409, 'tunnel_disabled');
      }
      // As everywhere else, a tunnel without a known access mode is restricted.
      const accessMode = tunnel.accessMode === 'authenticated' ? 'authenticated' : 'restricted';
      if ((await hostingAgentOf(plugin, tunnels)) !== tunnel.agentLabel) {
        throw refuse(
          `Plugin "${plugin.name}" is not hosted by the agent carrying the tunnel`,
          409,
          'not_hosted',
        );
      }
      if (!(await installedVersionApproved(plugin).catch(() => false))) {
        throw refuse(
          `Plugin "${plugin.name}" ${plugin.version} is not approved`,
          409,
          'not_approved',
        );
      }
      if (sites.some((s) => s.fqdn === tunnel.fqdn || (s.aliases ?? []).includes(tunnel.fqdn))) {
        throw refuse(`A site answers on '${tunnel.fqdn}' already`, 409, 'hostname_taken');
      }

      await serveApprovedTree(plugin, logger);
      const site = ownedSiteEntry({
        id: crypto.randomUUID(),
        subdomain: tunnel.subdomain,
        fqdn: tunnel.fqdn,
        plugin,
        accessMode,
      });
      const movedTunnels = tunnels.map((t) => {
        if (t.id !== tunnel.id) return t;
        const moved = { ...t, enabled: false };
        delete moved.userSurface;
        return moved;
      });

      // Every step from the grants to the handover undoes in reverse order
      // whatever ran before a failure: no grant, site entry or tunnel change
      // outlives a move that did not happen.
      const grants =
        accessMode === 'restricted' ? await copyTunnelGrants(tunnel.id, site.id, logger) : [];
      let wroteSites = false;
      let wroteTunnels = false;
      try {
        const { domain } = tunnelHost(tunnel);
        const installed = await deps.readInstalledVhost(appVhostName(tunnel.fqdn));
        const certDir =
          (installed && vhostCertDir(installed)) || (await deps.getCertPath(tunnel.fqdn, domain));
        // The state first — Gatekeeper reads both files on a change of
        // either, so the old vhost's API requests already resolve to the
        // site — then one reload hands the hostname over, then the port
        // grant goes.
        await writeSites([...sites, site]);
        wroteSites = true;
        await writeTunnels(movedTunnels);
        wroteTunnels = true;
        await deps.moveAppVhostToWebSurface(tunnel.fqdn, site, certDir, domain, {
          route,
          served: (await webSurfaceServing(route, movedTunnels)).served,
          maxBodySizeMb: await internalTunnelBodyLimit(plugin, movedTunnels),
          treesDir: webTreesDir(route),
        });
      } catch (err) {
        const undo = async (what, step) => {
          try {
            await step();
          } catch (undoErr) {
            logger?.error?.(
              { err: undoErr instanceof Error ? undoErr.message : String(undoErr) },
              `Could not undo a failed move: ${what}`,
            );
          }
        };
        if (wroteTunnels) await undo('tunnels.json', () => writeTunnels(tunnels));
        if (wroteSites) await undo('sites.json', () => writeSites(sites));
        await revokeGrants(
          grants.map((g) => g.grantId),
          logger,
        );
        throw err;
      }
      // The port is withdrawn for new sessions only: nginx routes nothing to
      // it any more, and restarting chisel would drop every agent's session
      // — the plugin's internal tunnel too, its API answering 502 until the
      // agent reconnects — and fail the requests nginx's old workers still
      // send to the tunnel until they finish. The agent drops the binding
      // at its next sync.
      try {
        await deps.syncChisel({ keepLiveSessions: true });
      } catch (err) {
        logger?.warn?.(
          { err: err instanceof Error ? err.message : String(err) },
          'Could not withdraw the moved tunnel’s port grant — the next sync will',
        );
      }
      await recordAuditBestEffort(
        {
          actor,
          action: 'plugin.web-surface.moved',
          plugin: plugin.name,
          details: { siteId: site.id, fqdn: site.fqdn, tunnelId: tunnel.id, accessMode },
        },
        logger,
      );
      return webSurfaceStatus(route);
    }),
  );
}
