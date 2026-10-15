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
 *   (see `originalUrl` in nginx.js).
 *
 * Each installed vhost is rendered again from state, on the certificate
 * directory the installed file names (a wildcard certificate stays a wildcard
 * certificate), and rewritten only when the text differs — through the same
 * backup / test / rollback path as any vhost write. A rewrite never links a
 * vhost that is not linked now.
 * A rewrite never adds or removes authentication: a vhost that disagrees with
 * its state on that is reported and left alone. The one exception is the
 * agent-panel vhost, whose mTLS check gains the panel's `auth_request`.
 */

import { withTunnelLock } from '@lamalibre/lamaste/server';
import {
  installVhost,
  isSiteEnabled,
  readInstalledVhost,
  renderAgentPanelVhost,
  renderAuthVhost,
  renderStaticSiteVhost,
  renderTunnelVhost,
  vhostCertDir,
} from './nginx.js';
import { readSites, readTunnels } from './state.js';

/** A subdomain or site id as it may appear in a site name. */
const SITE_NAME_PART_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/;

const AUTH_VHOST = 'lamalibre-lamaste-auth';

/**
 * The vhost a tunnel should have, rendered on `certDir`; null for tunnels
 * without one (internal plugin tunnels) or whose state cannot be rendered.
 *
 * @param {object} tunnel
 * @param {string} certDir
 * @returns {{ name: string, fqdn: string, config: string } | null}
 */
export function expectedTunnelVhost(tunnel, certDir) {
  if (!managedTunnelVhostName(tunnel) || typeof tunnel.fqdn !== 'string') return null;
  if (!tunnel.fqdn.startsWith(`${tunnel.subdomain}.`)) return null;
  const domain = tunnel.fqdn.slice(tunnel.subdomain.length + 1);
  if (tunnel.type === 'panel') {
    return renderAgentPanelVhost(tunnel.subdomain, domain, tunnel.port, certDir);
  }
  // As createTunnel and updateTunnel write it: the stored access mode
  // (restricted when absent, as Gatekeeper reads it), the plugin route of a
  // plugin tunnel, and a body limit only when the tunnel has one.
  return renderTunnelVhost(
    tunnel.accessMode ?? 'restricted',
    tunnel.subdomain,
    domain,
    tunnel.port,
    certDir,
    {
      ...(tunnel.type === 'plugin' && tunnel.pluginRoute ? { pathPrefix: tunnel.pluginRoute } : {}),
      ...(tunnel.maxBodySizeMb !== undefined ? { maxBodySizeMb: tunnel.maxBodySizeMb } : {}),
    },
  );
}

/** Site name of a tunnel's vhost, or null for a tunnel without one. */
function managedTunnelVhostName(tunnel) {
  if (tunnel.exposure === 'internal' || typeof tunnel.subdomain !== 'string') return null;
  if (!SITE_NAME_PART_RE.test(tunnel.subdomain)) return null;
  if (tunnel.type === 'panel') return `lamalibre-lamaste-agent-panel-${tunnel.subdomain}`;
  // Tunnels persisted before `type` existed are app tunnels.
  if (tunnel.type === 'app' || tunnel.type === 'plugin' || tunnel.type === undefined) {
    return `lamalibre-lamaste-app-${tunnel.subdomain}`;
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

const defaultTunnelDeps = { readTunnels, readInstalledVhost, installVhost, isSiteEnabled };

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
      const name = managedTunnelVhostName(tunnel);
      if (!name) continue;
      await reconcileOne(
        {
          name,
          label: tunnel.fqdn ?? tunnel.subdomain,
          render: (certDir) => expectedTunnelVhost(tunnel, certDir),
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
    logResult(log, 'tunnel', result);
    return result;
  });
}

const defaultSiteDeps = { readSites, readInstalledVhost, installVhost, isSiteEnabled };

/**
 * Reconcile the vhosts that ask Authelia directly: the auth portal
 * (`auth.<domain>`) and every static site. Site changes take no lock, so call
 * it before the panel listens — then nothing can change a site meanwhile.
 *
 * @param {Parameters<typeof logResult>[0]} log
 * @param {string} domain
 * @param {typeof defaultSiteDeps} [deps]
 * @returns {Promise<ReturnType<typeof newResult>>}
 */
export async function reconcileSiteVhosts(log, domain, deps = defaultSiteDeps) {
  const result = newResult();

  await reconcileOne(
    {
      name: AUTH_VHOST,
      label: `auth.${domain}`,
      render: (certDir) => renderAuthVhost(domain, certDir),
      enabled: () => deps.isSiteEnabled(AUTH_VHOST),
    },
    result,
    deps,
  );

  let sites = [];
  try {
    sites = await deps.readSites();
  } catch (err) {
    result.failed.push({ vhost: 'sites', error: err instanceof Error ? err.message : String(err) });
  }
  for (const site of sites) {
    if (typeof site.id !== 'string' || !SITE_NAME_PART_RE.test(site.id)) continue;
    const name = `lamalibre-lamaste-site-${site.id}`;
    await reconcileOne(
      {
        name,
        label: site.fqdn ?? site.id,
        render: (certDir) => renderStaticSiteVhost(site, certDir, domain),
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
