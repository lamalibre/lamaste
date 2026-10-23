/**
 * Plugins' web surfaces (slice 7), in words — for a plugin's Web surface
 * panel, its Lifecycle hooks (the web tree an approval covers) and the
 * Sites page (sites a plugin owns). Pure: nothing here reads the clock or
 * calls the panel.
 */

import { errorMessage, refusalOf } from './errorMessage.js';

/** The access modes a web surface's site may have. */
export const WEB_SURFACE_ACCESS_MODES = Object.freeze(['authenticated', 'restricted']);

/**
 * Subdomains no web surface may take — mirrors `RESERVED_SUBDOMAINS` and
 * `AGENT_PANEL_SUBDOMAIN_PREFIX` in @lamalibre/lamaste (the panel decides;
 * this only spares the administrator a round trip).
 */
const RESERVED_SUBDOMAINS = Object.freeze(['panel', 'auth', 'tunnel', 'www', 'mail', 'ftp', 'api']);
const AGENT_PANEL_SUBDOMAIN_PREFIX = 'agent-';

/** A DNS label: what the panel accepts as a subdomain. */
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** An access mode in words. */
export function accessModeText(accessMode) {
  switch (accessMode) {
    case 'authenticated':
      return 'authenticated — any signed-in member of its audience';
    case 'restricted':
      return 'restricted — members of its audience granted the site';
    default:
      return accessMode ? String(accessMode) : 'unknown';
  }
}

/**
 * Why `subdomain` cannot be a web surface's subdomain, or null when it can
 * (as far as the panel's rule goes — whether something holds it already is
 * the panel's to say).
 *
 * @param {string} subdomain
 * @returns {string | null}
 */
export function subdomainProblem(subdomain) {
  if (typeof subdomain !== 'string' || subdomain.length === 0) return 'Enter a subdomain';
  if (!DNS_LABEL.test(subdomain)) {
    return 'A subdomain is a DNS label: lowercase letters, digits and hyphens, not starting or ending with a hyphen, at most 63 characters';
  }
  if (RESERVED_SUBDOMAINS.includes(subdomain)) return `'${subdomain}' is reserved for the relay`;
  if (subdomain.startsWith(AGENT_PANEL_SUBDOMAIN_PREFIX)) {
    return `'${AGENT_PANEL_SUBDOMAIN_PREFIX}*' is kept for agent panels`;
  }
  return null;
}

/** `0123abcd…89cdef` — enough of a tree digest to compare by eye; the full one on hover and to copy. */
export function shortDigest(digest) {
  return typeof digest === 'string' && digest.length > 16
    ? `${digest.slice(0, 8)}…${digest.slice(-6)}`
    : (digest ?? '');
}

/** A tree's size: `512 B`, `12.4 KB`, `3.1 MB`. */
export function formatTreeSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** `12 files, 340.2 KB`. */
export function treeSummary({ files, totalBytes }) {
  const count = typeof files === 'number' ? `${files} file${files === 1 ? '' : 's'}` : null;
  return [count, formatTreeSize(totalBytes)].filter(Boolean).join(', ');
}

/**
 * Whether the site serves the shell and the API, and why not, in words.
 * `reason` is the web surface view's (`WebSurfaceNotServedReason`).
 *
 * @param {{ served: boolean, reason: string | null, site: object | null }} view
 * @returns {{ served: boolean, text: string }}
 */
export function servedText(view) {
  if (!view) return { served: false, text: 'Unknown' };
  if (view.served) {
    return {
      served: true,
      text: view.site
        ? 'Served — its site serves the approved shell and its user-surface API'
        : 'Ready to be served — give it a site',
    };
  }
  const site = view.site ? 'Its site answers 503: ' : 'Not served: ';
  return { served: false, text: `${site}${notServedReasonText(view.reason)}` };
}

/** Why a web surface is not served, as the end of a sentence. */
export function notServedReasonText(reason) {
  switch (reason) {
    case 'not_installed':
      return 'no installed plugin holds its route';
    case 'no_identity':
      return 'the installed version declares no identity — a web surface serves its users, so it needs one';
    case 'no_web_surface':
      return 'the installed version declares no web surface (userSurface.web)';
    case 'not_approved':
      return 'the installed version waits for approval — approve it under Lifecycle hooks';
    case 'not_hosted':
      return 'the plugin is not hosted on an agent, or its hosting is not active yet';
    case 'tree_not_current':
      return 'the approved web tree is not the one served yet — it is switched to once the agent half runs the approved version';
    default:
      return reason ? String(reason) : 'not served';
  }
}

/** What lifts a refused web-surface request, by its `code`; null when there is nothing to add. */
const CODE_HINT = {
  no_web_surface:
    'The installed version declares no web surface — update to a version that declares userSurface.web.',
  no_identity:
    'A web surface serves the plugin’s users: its installed version must declare identity.',
  exists: 'The plugin owns a site already — delete it first to start over.',
  bound_to_tunnel:
    'A tunnel is bound as its user surface — move that tunnel’s hostname to the web surface instead.',
  hostname_taken: 'Pick another subdomain: a tunnel or a site holds this one.',
  not_bound: 'That tunnel is not bound as this plugin’s user surface any more — refresh the page.',
  shared_tunnel:
    'The tunnel serves other plugins’ user surfaces too — unbind them on the Tunnels page first.',
  tunnel_disabled: 'Enable the tunnel first: only a live hostname can be handed over.',
  not_hosted:
    'The plugin must be hosted by the agent carrying the tunnel, with its hosting active.',
  not_approved: 'Approve what the installed version brings under Lifecycle hooks first.',
  web_tree:
    'The installed package’s web tree cannot be served — reinstall or update the plugin, then try again.',
  gatekeeper:
    'Gatekeeper could not be reached to copy the tunnel’s grants — nothing was moved; try again.',
  not_found: 'It is gone already — refresh the page.',
  domain_not_configured: 'Configure the relay’s domain and email under Settings first.',
};

/**
 * A refused web-surface request explained: the panel's message, its `code`
 * and what lifts the refusal.
 *
 * @param {unknown} err what the admin client rejected with
 * @returns {{ message: string, code: string | null, hint: string | null }}
 */
export function explainWebSurfaceRefusal(err) {
  const { code } = refusalOf(err);
  const hint = typeof code === 'string' && Object.hasOwn(CODE_HINT, code) ? CODE_HINT[code] : null;
  return { message: errorMessage(err), code, hint };
}

/**
 * Why "Create web surface" cannot be used now, or null when it can: the
 * plugin owns a site, declares no web surface, has a tunnel bound as its
 * user surface (move it instead), or the offered subdomain is taken (an
 * edited one may still be free — `edited`).
 *
 * @param {object | null} view the web surface view
 * @param {{ edited?: boolean }} [options]
 * @returns {string | null}
 */
export function createBlock(view, { edited = false } = {}) {
  if (!view) return 'Loading';
  if (view.site) return 'The plugin owns a site already';
  if (!view.declared) return 'The installed version declares no web surface';
  if (view.boundTunnel) {
    return `Tunnel ${view.boundTunnel.fqdn ?? view.boundTunnel.id} is bound as its user surface — move it instead`;
  }
  if (view.offer && !view.offer.available && !edited) {
    return `'${view.offer.subdomain}' is held by a tunnel or a site — pick another subdomain`;
  }
  return null;
}

/**
 * Why "Move from tunnel" cannot be used now, or null when it can: the
 * plugin owns a site already, no tunnel is bound, or the tunnel serves
 * other plugins too.
 *
 * @param {object | null} view
 * @param {string} route the plugin's route
 */
export function moveBlock(view, route) {
  if (!view?.boundTunnel) return 'No tunnel is bound as its user surface';
  if (view.site) return 'The plugin owns a site already';
  if (!view.declared) return 'The installed version declares no web surface';
  const others = (view.boundTunnel.routes ?? []).filter((r) => r !== route);
  if (others.length > 0) {
    return `The tunnel serves other user surfaces too (${others.join(', ')}) — unbind them first`;
  }
  return null;
}

/**
 * The plugin route a site belongs to (`owner: { plugin }` in the sites
 * listing), or null for a site of the administrator's.
 */
export function siteOwnerRoute(site) {
  const owner = site?.owner;
  return owner && typeof owner === 'object' && typeof owner.plugin === 'string'
    ? owner.plugin
    : null;
}

/** The routes of the plugins that own a site among `sites`. */
export function ownedSiteRoutes(sites) {
  const routes = new Set();
  for (const site of Array.isArray(sites) ? sites : []) {
    const route = siteOwnerRoute(site);
    if (route) routes.add(route);
  }
  return routes;
}

/**
 * Whether a plugin's page shows its Web surface panel: an agent-hosted
 * plugin whose installed version declares a web surface, or that owns a
 * site (an older version's, kept until it is deleted).
 *
 * @param {{ hosting?: string, route?: string, userSurface?: { web?: object | null } | null }} plugin
 * @param {Set<string>} ownedRoutes
 */
export function showsWebSurface(plugin, ownedRoutes) {
  if (plugin?.hosting !== 'agent') return false;
  if (plugin.userSurface?.web) return true;
  return typeof plugin.route === 'string' && ownedRoutes.has(plugin.route);
}

/**
 * What an update changes in a plugin's web tree (`pendingUpdate.web`:
 * `{ before, after }` — the installed version's tree digest and the staged
 * one's `{ sha256, files, totalBytes }`), as one view: `added` (it declares
 * a web surface for the first time), `removed` (it no longer does — its
 * site answers 503), `changed` or `unchanged`. Null when neither declares
 * one.
 *
 * @param {{ before: string | null, after: { sha256: string, files: number, totalBytes: number } | null } | null | undefined} web
 * @returns {{ kind: 'added' | 'removed' | 'changed' | 'unchanged', before: string | null, after: { sha256: string, files: number, totalBytes: number } | null } | null}
 */
export function webTreeChange(web) {
  if (!web || typeof web !== 'object') return null;
  const before = typeof web.before === 'string' ? web.before : null;
  const after =
    web.after && typeof web.after === 'object' && typeof web.after.sha256 === 'string'
      ? web.after
      : null;
  if (before === null && after === null) return null;
  const kind =
    before === null
      ? 'added'
      : after === null
        ? 'removed'
        : before === after.sha256
          ? 'unchanged'
          : 'changed';
  return { kind, before, after };
}

/** The id of a plugin's card on the Plugins page — what `#plugin-<name>` opens. */
export function pluginAnchorId(name) {
  return `plugin-${name}`;
}

/**
 * Who owns site `site` among the installed `plugins` (as `GET /api/plugins`
 * lists them): `{ route, name, label }` — `name` null when no installed
 * plugin holds the route any more — or null for a site of the
 * administrator's.
 *
 * @param {{ owner?: { plugin?: string } | null }} site
 * @param {Array<{ name: string, route?: string, displayName?: string }>} plugins
 * @returns {{ route: string, name: string | null, label: string } | null}
 */
export function siteOwner(site, plugins) {
  const route = siteOwnerRoute(site);
  if (route === null) return null;
  const plugin = (Array.isArray(plugins) ? plugins : []).find((p) => p.route === route) ?? null;
  return {
    route,
    name: plugin?.name ?? null,
    label: plugin?.displayName || plugin?.name || route,
  };
}
