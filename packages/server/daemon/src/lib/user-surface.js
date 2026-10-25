/**
 * Plugins' user surfaces on the relay (slice 6): which host serves an
 * agent-hosted plugin's `/api/<route>/app/*`, and the panel's side of every
 * such request.
 *
 * **Binding.** A tunnel is bound as a plugin's user surface (core
 * `bindUserSurface`; `TunnelEntry.userSurface` in `tunnels.json`, read with
 * core `tunnelUserSurfaceRoutes`): an enabled app tunnel, `authenticated` or
 * `restricted`, carried by the agent that hosts the plugin, its route held
 * by an installed agent-hosted plugin; a route on one host at most. A
 * plugin may be bound before it declares `identity`: its host *serves* the
 * route — locations that ask Gatekeeper and pass the request to the panel —
 * only while the plugin's installed, approved version declares it and the
 * tunnel's agent is the plugin's hosting agent ({@link servedUserSurfaceRoutes}).
 * Before that requests go down the tunnel as before, so a plugin's
 * switch-over is a plain update. Whether a route is served changes with the
 * plugin's approval, update, reversal, hosting and uninstall, and with the
 * tunnel's agent: each re-renders the vhosts it is bound to
 * ({@link refreshUserSurfaceVhosts}, {@link refreshTunnelUserSurfaceVhosts}
 * after a revocation; a move re-renders in core); an uninstall also
 * releases the binding everywhere — and any binding left for a route no
 * installed plugin holds ({@link releasePluginUserSurface}).
 *
 * **Requests.** The panel's user-surface context (`routes/user-surface.js`,
 * core `userSurfacePlugin`) admits a request only with a relay assertion
 * Gatekeeper signed for the panel ({@link verifyUserSurfaceRelay}),
 * forwards it to the plugin's agent half on the internal tunnel of the
 * route's hosting ({@link resolveUserSurfaceTarget} — only from a host its
 * hosting agent carries, never while the hosting is down) as the
 * directory's user (`lib/user-caller.js`), and checks `Origin` against the
 * bound host ({@link userSurfaceOrigin}) — never the request's `Host`.
 * Every response still being sent is re-checked every few seconds
 * ({@link sweepOpenUserSurfaceResponses}) and ended as soon as its user may
 * no longer use the plugin, holds other roles, or the host no longer serves
 * the route.
 *
 * Audit: `tunnel.user-surface.bound` and `tunnel.user-surface.unbound`
 * (with the reason: `unbound`, `tunnel-deleted`, `plugin-uninstalled`).
 */

import crypto from 'node:crypto';
import {
  NonceStore,
  RELAY_ASSERTION_HEADER,
  RELAY_PANEL_AUDIENCE,
  RELAY_PANEL_PORT,
  isAgentHostedPlugin,
  siteUserSurfaceRoute,
  tunnelUserSurfaceRoutes,
  userSurfaceHostServing,
  userSurfaceHostingAgent,
  userSurfaceHosts,
  verifyRelayAssertion,
} from '@lamalibre/lamaste';
import {
  TUNNEL_MAX_BODY_MB,
  TunnelError,
  bindUserSurface,
  releaseUserSurfaceRoute,
  tunnelHost,
  unbindUserSurface,
} from '@lamalibre/lamaste/server';
import { httpError } from './app-error.js';
import { recordAuditBestEffort } from './audit.js';
import { getConfig } from './config.js';
import { pluginDomainName } from './domains.js';
import { installedVersionApproved } from './plugin-hooks.js';
import { findPluginByRoute } from './plugins.js';
import { relaySigner } from './relay-signing.js';
import { readSites, readTunnels } from './state.js';
import { tunnelCertbotDeps, tunnelNginxDeps, tunnelStateDeps } from './tunnel-deps.js';

/**
 * The user surface's own rate limit (Fastify route config): per client
 * address — nginx sets `X-Forwarded-For` to it and the panel trusts that
 * one loopback hop — and plugin route. An application's page makes many
 * requests; the panel's root limit (100/min) is for its administrators.
 */
const USER_SURFACE_RATE_LIMIT = Object.freeze({
  max: 1200,
  timeWindow: '1 minute',
  keyGenerator: (request) => `${request.ip} ${request.params?.route ?? ''}`,
});

/**
 * The user surface's route config: its rate limit, and no CORS — the
 * panel's CORS (for its own origins) never answers for a user surface, so
 * no other origin reads a user's answers or gets a preflight through.
 */
export const USER_SURFACE_ROUTE_CONFIG = Object.freeze({
  rateLimit: USER_SURFACE_RATE_LIMIT,
  cors: false,
});

// ---------------------------------------------------------------------------
// Which bound routes a host serves
// ---------------------------------------------------------------------------

/**
 * The agent hosting installed plugin `plugin`, or null: its own hosting
 * record names the agent, and `tunnels.json` agrees — that agent carries
 * the route's internal tunnel (core `userSurfaceHostingAgent`, what
 * Gatekeeper reads). A hosting whose agent was revoked (its internal
 * tunnel then has no agent) hosts nothing here.
 *
 * @param {{ name: string, route: string | null }} plugin
 * @param {readonly object[]} tunnels
 * @returns {Promise<string | null>}
 */
export async function hostingAgentOf(plugin, tunnels) {
  if (!plugin.route) return null;
  const { ownHosting } = await import('./plugin-hosting.js');
  const record = await ownHosting(plugin);
  if (!record) return null;
  const agent = userSurfaceHostingAgent(tunnels, plugin.route);
  return agent !== null && agent === record.agentLabel ? agent : null;
}

/**
 * The agent hosting the plugin that holds `route`, or null (core
 * `UserSurfaceDeps.hostingAgent`: binding refuses a tunnel any other agent
 * carries). Called under the tunnel lock: reads the state without taking it.
 *
 * @param {string} route
 * @returns {Promise<string | null>}
 */
async function userSurfaceHostingAgentOf(route) {
  const plugin = await findPluginByRoute(route);
  return plugin ? hostingAgentOf(plugin, await readTunnels()) : null;
}

/**
 * Whether plugin `route`'s user surface is served on a host it is bound to
 * — the tunnel carried by `agentLabel` — and why not: `not_installed` (no
 * installed plugin holds the route), `no_identity` (its installed version
 * declares none), `not_approved` (that version is not approved),
 * `not_hosting_agent` (the tunnel's agent is not the plugin's hosting
 * agent: the tunnel was moved or its agent revoked, or the plugin is hosted
 * elsewhere or not at all). Not the agent half's protocol answer: the panel
 * checks that per request (503 until it answered).
 *
 * @param {string} route
 * @param {string | undefined} agentLabel the agent carrying the bound tunnel
 * @param {readonly object[]} tunnels the tunnel state
 * @returns {Promise<{ served: true, plugin: object } | { served: false, reason: 'not_installed' | 'no_identity' | 'not_approved' | 'not_hosting_agent' }>}
 */
async function routeServing(route, agentLabel, tunnels) {
  const plugin = await findPluginByRoute(route);
  if (!plugin) return { served: false, reason: 'not_installed' };
  if (!plugin.identity) return { served: false, reason: 'no_identity' };
  // A version whose approval cannot even be judged is not approved.
  if (!(await installedVersionApproved(plugin).catch(() => false))) {
    return { served: false, reason: 'not_approved' };
  }
  const hosting = await hostingAgentOf(plugin, tunnels);
  if (hosting === null || agentLabel !== hosting) {
    return { served: false, reason: 'not_hosting_agent' };
  }
  return { served: true, plugin };
}

/**
 * The body limit of the plugin's internal tunnel, in MiB — the default while it is not hosted.
 *
 * @param {object} plugin
 * @param {readonly object[]} tunnels the tunnel state
 */
export async function internalTunnelBodyLimit(plugin, tunnels) {
  const { ownHosting } = await import('./plugin-hosting.js');
  const record = await ownHosting(plugin);
  if (!record) return TUNNEL_MAX_BODY_MB.default;
  const tunnel = tunnels.find((t) => t.id === record.tunnelId);
  return tunnel?.maxBodySizeMb ?? TUNNEL_MAX_BODY_MB.default;
}

/**
 * Of `routes` (bound to `tunnel`), the ones its vhost serves, in order,
 * each with the body limit of its locations (the plugin's internal
 * tunnel's). Core's `UserSurfaceDeps.servedRoutes` — called under the
 * tunnel lock, so it reads the tunnel state without taking it.
 *
 * @param {readonly string[]} routes
 * @param {{ agentLabel?: string }} tunnel the bound tunnel (its agent, as it is or is about to be)
 * @returns {Promise<Array<{ route: string, maxBodySizeMb: number }>>}
 */
export async function servedUserSurfaceRoutes(routes, tunnel) {
  if (routes.length === 0) return [];
  const tunnels = await readTunnels();
  const served = [];
  for (const route of routes) {
    const serving = await routeServing(route, tunnel?.agentLabel, tunnels);
    if (!serving.served) continue;
    served.push({ route, maxBodySizeMb: await internalTunnelBodyLimit(serving.plugin, tunnels) });
  }
  return served;
}

/** What core's tunnel workflows ask the panel about user surfaces. */
export const userSurfaceDeps = Object.freeze({
  servedRoutes: servedUserSurfaceRoutes,
  hostingAgent: userSurfaceHostingAgentOf,
});

/**
 * A tunnel as the panel lists it: with `userSurfaceStatus`, how each route
 * bound to it is served — `{ route, served, reason }`, `reason` null when
 * served — on a tunnel that has a binding.
 *
 * @template {object} T
 * @param {T} tunnel
 * @returns {Promise<T>}
 */
export async function withUserSurfaceStatus(tunnel) {
  const routes = tunnelUserSurfaceRoutes(tunnel);
  if (routes.length === 0) return tunnel;
  const tunnels = await readTunnels();
  const status = [];
  for (const route of routes) {
    const serving = await routeServing(route, tunnel.agentLabel, tunnels);
    status.push({ route, served: serving.served, reason: serving.served ? null : serving.reason });
  }
  return { ...tunnel, userSurfaceStatus: status };
}

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

/**
 * What core's binding workflows need from the panel — among them its Let's
 * Encrypt email, which a vhost rewrite needs.
 */
function bindingOptions(id, route, logger) {
  const config = getConfig();
  if (!config.domain || !config.email) {
    throw httpError('Domain and email must be configured', 400);
  }
  return {
    id,
    route,
    email: config.email,
    nginx: tunnelNginxDeps,
    certbot: tunnelCertbotDeps,
    state: tunnelStateDeps,
    userSurface: userSurfaceDeps,
    logger,
  };
}

/**
 * Audit a change of `route`'s binding on `tunnel`. `plugin` defaults to the
 * installed plugin that holds the route.
 *
 * @param {'tunnel.user-surface.bound' | 'tunnel.user-surface.unbound'} action
 * @param {object} tunnel
 * @param {string} route
 * @param {{ actor: string, logger: import('pino').Logger, plugin?: string, reason?: string }} opts
 */
async function auditBinding(action, tunnel, route, { actor, logger, plugin, reason }) {
  await recordAuditBestEffort(
    {
      actor,
      action,
      plugin: plugin ?? (await findPluginByRoute(route))?.name ?? null,
      details: {
        tunnelId: tunnel.id,
        fqdn: tunnel.fqdn ?? null,
        route,
        ...(reason === undefined ? {} : { reason }),
      },
    },
    logger,
  );
}

/**
 * Throw (a core `TunnelError`) unless an installed agent-hosted plugin holds
 * `route` — what binding requires, and what a binding is checked against
 * again once it is written.
 *
 * @param {string} route
 */
async function assertBindableRoute(route) {
  const plugin = await findPluginByRoute(route);
  if (!plugin) {
    throw new TunnelError(`No installed plugin holds the route '${route}'`, 'INVALID_SETTING');
  }
  if (!isAgentHostedPlugin(plugin)) {
    throw new TunnelError(
      `Plugin "${plugin.name}" is not agent-hosted — only an agent-hosted plugin has a user surface`,
      'INVALID_SETTING',
    );
  }
  // A route is served on one host at most: the plugin's own site, when it
  // has one, is that host.
  if ((await readSites()).some((site) => siteUserSurfaceRoute(site) === route)) {
    throw new TunnelError(
      `Plugin "${plugin.name}" has a web surface — its user surface is served there`,
      'INVALID_SETTING',
    );
  }
}

/**
 * Refuse binding tunnel `id` as the user surface of the plugin at `route`
 * when the tunnel's hostname is not on the plugin's domain (400
 * `not_plugin_domain`): a plugin's users are its domain's members.
 */
async function assertOnPluginDomain(id, route) {
  const tunnel = (await readTunnels()).find((t) => t.id === id);
  const host = tunnel ? tunnelHost(tunnel) : null;
  if (!host) return; // core refuses a tunnel without a hostname
  const plugin = await findPluginByRoute(route);
  const domain = await pluginDomainName(plugin);
  if (host.domain !== domain) {
    throw httpError(
      `The tunnel is on ${host.domain}; the plugin holding '${route}' belongs to ${domain}`,
      400,
      { code: 'not_plugin_domain' },
    );
  }
}

/** Whether an installed agent-hosted plugin holds `route`. */
async function isBindableRoute(route) {
  return assertBindableRoute(route).then(
    () => true,
    () => false,
  );
}

/**
 * Bind plugin `route` as a user surface of tunnel `id`. The route must be
 * held by an installed agent-hosted plugin — whether its installed version
 * declares `identity` yet or not — hosted by the agent that carries the
 * tunnel (core refuses with 400 otherwise). Idempotent. Throws a core
 * `TunnelError` (or an `httpError`) to refuse.
 *
 * The plugin is checked under the tunnel lock, but its uninstall does not
 * take that lock: should it be uninstalled while the binding is written,
 * the binding is released again here (and by the uninstall's own release,
 * which runs after its registry entry is gone) and the bind refused with
 * 409 — no binding outlives the plugin it was made for.
 *
 * @param {string} id
 * @param {string} route
 * @param {{ actor: string, logger: import('pino').Logger }} opts
 * @returns {Promise<{ changed: boolean, tunnel: object }>} the tunnel with its `userSurfaceStatus`
 */
export async function bindTunnelUserSurface(id, route, { actor, logger }) {
  const result = await bindUserSurface({
    ...bindingOptions(id, route, logger),
    // Under the tunnel lock, as the plugin's domain changes (lib/domains.js).
    assertRoute: async (r) => {
      await assertBindableRoute(r);
      await assertOnPluginDomain(id, r);
    },
  });
  if (result.changed && !(await isBindableRoute(route))) {
    await pruneUserSurfaceBindings(route, { plugin: null, logger });
    throw httpError(
      `The plugin holding the route '${route}' was uninstalled while it was being bound — nothing is bound`,
      409,
      { code: 'user_surface_conflict' },
    );
  }
  if (result.changed) {
    await auditBinding('tunnel.user-surface.bound', result.tunnel, route, { actor, logger });
  }
  return { changed: result.changed, tunnel: await withUserSurfaceStatus(result.tunnel) };
}

/**
 * Unbind plugin `route` from tunnel `id`: requests for the route go down
 * the tunnel again. Throws a core `TunnelError` (`NOT_FOUND` when it is not
 * bound there) or an `httpError`.
 *
 * @param {string} id
 * @param {string} route
 * @param {{ actor: string, logger: import('pino').Logger }} opts
 * @returns {Promise<{ tunnel: object }>} the tunnel with its `userSurfaceStatus`
 */
export async function unbindTunnelUserSurface(id, route, { actor, logger }) {
  const result = await unbindUserSurface(bindingOptions(id, route, logger));
  await auditBinding('tunnel.user-surface.unbound', result.tunnel, route, {
    actor,
    logger,
    reason: 'unbound',
  });
  return { tunnel: await withUserSurfaceStatus(result.tunnel) };
}

/**
 * A deleted tunnel's bindings went with it: audit each.
 *
 * @param {object} tunnel the removed entry
 * @param {{ actor: string, logger: import('pino').Logger }} opts
 */
export async function auditDeletedTunnelUserSurface(tunnel, opts) {
  for (const route of tunnelUserSurfaceRoutes(tunnel)) {
    await auditBinding('tunnel.user-surface.unbound', tunnel, route, {
      ...opts,
      reason: 'tunnel-deleted',
    });
  }
}

// ---------------------------------------------------------------------------
// Following the plugins
// ---------------------------------------------------------------------------

/** Replaces the reconcile's nginx and state access (tests: no nginx to read or write). */
let reconcileDepsOverride = null;

/** @param {object | null} deps the deps of `reconcileUserSurfaceVhosts` */
export function setUserSurfaceReconcileDepsForTests(deps) {
  reconcileDepsOverride = deps;
}

async function reconcileVhostsOf(route, ids, logger) {
  const { reconcileUserSurfaceVhosts } = await import('./vhost-reconcile.js');
  // `undefined` leaves the reconcile its own deps.
  return reconcileUserSurfaceVhosts(logger, route, { ids }, reconcileDepsOverride ?? undefined);
}

/**
 * Tunnels `ids` lost their agent (its certificate was revoked: core
 * `releaseAgentTunnels`): those bound as a user surface keep the binding
 * but serve none of it — Gatekeeper and the panel refuse from the state
 * already — and their vhosts lose its locations here. Best effort —
 * logged, never thrown; the panel's start reconciles every vhost again.
 *
 * @param {readonly string[]} ids
 * @param {import('pino').Logger} logger
 */
export async function refreshTunnelUserSurfaceVhosts(ids, logger) {
  if (!ids || ids.length === 0) return;
  try {
    await reconcileVhostsOf(null, ids, logger);
  } catch (err) {
    logger?.warn?.(
      { err: err instanceof Error ? err.message : String(err) },
      'Could not bring the vhosts of released tunnels in line',
    );
  }
}

/**
 * Whether plugin `route`'s user surface is served may have changed — its
 * version was approved, updated or reverted, it was hosted or unhosted (the
 * body limit is its internal tunnel's): bring the vhosts of the tunnels it
 * is bound to in line, and its web surface — the approved tree served, the
 * vhost of the site it owns (`lib/web-surface.js`). Best effort — logged, never thrown; the panel's
 * start reconciles every vhost again.
 *
 * @param {string | null | undefined} route
 * @param {import('pino').Logger} logger
 */
export async function refreshUserSurfaceVhosts(route, logger) {
  if (!route) return;
  try {
    await reconcileVhostsOf(route, [], logger);
  } catch (err) {
    logger?.warn?.(
      { route, err: err instanceof Error ? err.message : String(err) },
      'Could not bring the user-surface vhosts of a plugin in line',
    );
  }
  // Its web surface too: the approved tree served, the site's vhost in line.
  const { refreshWebSurface } = await import('./web-surface.js');
  await refreshWebSurface(route, logger);
}

/**
 * Release `route`'s binding from every tunnel — and, as a second check, the
 * binding of every other route no installed agent-hosted plugin holds any
 * more — the state first, so Gatekeeper and the panel refuse at once, then
 * those tunnels' vhosts lose the locations. Audited per route and tunnel
 * (`plugin-uninstalled`). Throws.
 *
 * @param {string} route
 * @param {{ plugin: string | null, logger: import('pino').Logger }} opts
 */
async function pruneUserSurfaceBindings(route, { plugin, logger }) {
  const ids = new Set();
  const release = async (r, owner) => {
    const { released } = await releaseUserSurfaceRoute({
      route: r,
      state: tunnelStateDeps,
      logger,
    });
    for (const tunnel of released) {
      ids.add(tunnel.id);
      await auditBinding('tunnel.user-surface.unbound', tunnel, r, {
        actor: 'lamaste',
        logger,
        ...(owner ? { plugin: owner } : {}),
        reason: 'plugin-uninstalled',
      });
    }
  };
  await release(route, plugin);
  const orphans = new Set();
  for (const tunnel of await readTunnels()) {
    for (const r of tunnelUserSurfaceRoutes(tunnel)) {
      if (r !== route && !(await isBindableRoute(r))) orphans.add(r);
    }
  }
  for (const r of orphans) await release(r, null);
  if (ids.size > 0) await reconcileVhostsOf(route, [...ids], logger);
}

/**
 * Plugin `plugin`, which held `route`, is uninstalled — its registry entry
 * is gone: the route's binding goes from every tunnel, and so does any
 * binding left for a route no installed plugin holds (a bind that raced an
 * uninstall) — the state first, so Gatekeeper and the panel refuse the
 * route at once — then those tunnels' vhosts lose its locations. Best
 * effort — logged, never thrown: the uninstall happened.
 *
 * @param {string | null | undefined} route
 * @param {{ plugin: string, logger: import('pino').Logger }} opts
 */
export async function releasePluginUserSurface(route, { plugin, logger }) {
  if (!route) return;
  try {
    await pruneUserSurfaceBindings(route, { plugin, logger });
  } catch (err) {
    logger?.error?.(
      { route, err: err instanceof Error ? err.message : String(err) },
      'Could not release the user surface of an uninstalled plugin',
    );
  }
  // The site it owns stays, answering 503 until the plugin is back (or an
  // administrator deletes it): its vhost goes in line.
  const { refreshWebSurface } = await import('./web-surface.js');
  await refreshWebSurface(route, logger);
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** One per process: a relay assertion is accepted once. */
const relayNonces = new NonceStore();

/** The verification key of the relay signing key, by key id (the current key only). */
const verifyKeys = new Map();

/**
 * The keys a relay assertion for the panel verifies with: the public half of
 * the relay signing key — the file Gatekeeper signs with — re-read when it
 * changes. Null when there is none; throws when it is unusable.
 */
async function panelVerifyKeys() {
  const key = await relaySigner.current();
  if (!key) return null;
  if (!verifyKeys.has(key.kid)) {
    verifyKeys.clear();
    verifyKeys.set(key.kid, crypto.createPublicKey(key.privateKey));
  }
  return verifyKeys;
}

/**
 * The relay check of a user-surface request (core `userSurfacePlugin`'s
 * `verifyRelay`): an assertion Gatekeeper signed for the panel
 * (`RELAY_PANEL_AUDIENCE`, the panel's port), bound to this request's
 * method and raw request target, not expired, never seen before. Returns
 * the username Gatekeeper attested and the route the assertion is for.
 *
 * @param {import('fastify').FastifyRequest} request
 * @returns {Promise<{ ok: true, username: string, route: string } | { ok: false, reason: string }>}
 */
export async function verifyUserSurfaceRelay(request) {
  let keys;
  try {
    keys = await panelVerifyKeys();
  } catch (err) {
    request.log.error(
      { err: err instanceof Error ? err.message : String(err) },
      'Relay signing key unusable — user-surface requests are refused',
    );
    return { ok: false, reason: 'relay_key_unusable' };
  }
  if (!keys) return { ok: false, reason: 'relay_key_missing' };
  const header = request.headers[RELAY_ASSERTION_HEADER];
  const result = verifyRelayAssertion(typeof header === 'string' ? header : undefined, {
    keys,
    aud: RELAY_PANEL_AUDIENCE,
    port: RELAY_PANEL_PORT,
    method: request.method,
    url: request.raw.url ?? '',
    nonces: relayNonces,
  });
  if (!result.ok) {
    request.log.info({ reason: result.reason }, 'User-surface request without a valid assertion');
    return { ok: false, reason: result.reason };
  }
  const { caller, target } = result.payload;
  // A panel-audience payload is a username and a route with its path.
  if (caller.type !== 'user' || !('route' in target)) return { ok: false, reason: 'malformed' };
  return { ok: true, username: caller.username, route: target.route };
}

/**
 * The enabled host that serves `route`'s user surface, or null — the check
 * of every request, whatever a vhost not yet re-rendered still routes here:
 * a tunnel bound to the route and carried by the agent hosting its plugin,
 * or the site the plugin owns while its web surface is served
 * (`lib/web-surface.js`). Read with core `userSurfaceHosts`, as Gatekeeper
 * reads it, so a route two hosts would serve is served by neither.
 *
 * @param {string} route
 * @returns {Promise<import('@lamalibre/lamaste').UserSurfaceHost | null>}
 */
async function servedUserSurfaceHost(route) {
  const [tunnels, sites] = await Promise.all([readTunnels(), readSites()]);
  const host = userSurfaceHostServing(userSurfaceHosts(tunnels, sites), route);
  if (!host) return null;
  if (host.kind === 'site') {
    const { webSurfaceServing } = await import('./web-surface.js');
    return (await webSurfaceServing(route, tunnels)).served ? host : null;
  }
  const plugin = await findPluginByRoute(route);
  if (!plugin) return null;
  const tunnel = tunnels.find((t) => t.id === host.id);
  const hosting = await hostingAgentOf(plugin, tunnels);
  return hosting !== null && tunnel?.agentLabel === hosting ? host : null;
}

/**
 * The forward target of `route`'s user surface (core `userSurfacePlugin`'s
 * `resolveTarget`): null when no host serves it (see
 * {@link servedUserSurfaceHost}), else what the admin forwarder resolves — the hosting's
 * internal tunnel, or why not (not found, disabled, not hosted) — and
 * `down` while the hosting's health is down: nothing of a user's request
 * reaches the relay-loopback port then (503).
 *
 * @param {string} route
 */
export async function resolveUserSurfaceTarget(route) {
  if (!(await servedUserSurfaceHost(route))) return null;
  const { resolveForwardTarget } = await import('./plugin-hosting.js');
  return resolveForwardTarget(route);
}

/**
 * The origin a request that may change something on `route`'s user surface
 * must come from (core `userSurfacePlugin`'s `originFor`): the bound host,
 * as the state names it — never the request's `Host`. Null when no host
 * serves the route.
 *
 * @param {string} route
 * @returns {Promise<string | null>}
 */
export async function userSurfaceOrigin(route) {
  const host = await servedUserSurfaceHost(route);
  return host ? `https://${host.fqdn}` : null;
}

// ---------------------------------------------------------------------------
// Open responses: none outlives its user's access
// ---------------------------------------------------------------------------

/** How often every open user-surface response is re-checked. */
const OPEN_RESPONSE_SWEEP_INTERVAL_MS = 5_000;

/** The responses being sent now (core `OpenUserSurfaceResponse`). */
const openResponses = new Set();

let sweepTimer = null;
let sweeping = null;
let sweepLogger = null;

/**
 * Core `userSurfacePlugin`'s `trackResponse`, logging with `logger`: keep
 * each response until it is over (the function it returns), and re-check it
 * every {@link OPEN_RESPONSE_SWEEP_INTERVAL_MS} meanwhile. The timer runs
 * only while a response is open, and never keeps the process alive.
 *
 * @param {import('pino').Logger} logger
 * @returns {(response: import('@lamalibre/lamaste/server').OpenUserSurfaceResponse) => () => void}
 */
export function userSurfaceResponseTracker(logger) {
  sweepLogger = logger;
  return trackUserSurfaceResponse;
}

/**
 * Keep `response` until it is over (the returned function) — see
 * {@link userSurfaceResponseTracker}.
 *
 * @param {import('@lamalibre/lamaste/server').OpenUserSurfaceResponse} response
 * @returns {() => void}
 */
export function trackUserSurfaceResponse(response) {
  openResponses.add(response);
  if (!sweepTimer) {
    sweepTimer = setInterval(() => {
      void sweepOpenUserSurfaceResponses(sweepLogger ?? undefined);
    }, OPEN_RESPONSE_SWEEP_INTERVAL_MS);
    sweepTimer.unref();
  }
  return () => {
    openResponses.delete(response);
    if (openResponses.size === 0 && sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  };
}

/** How many user-surface responses are open now (tests, diagnostics). */
export function openUserSurfaceResponseCount() {
  return openResponses.size;
}

function sameRoles(a, b) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((role) => set.has(role));
}

/**
 * Re-check every open user-surface response and end those that may not go
 * on: its user is no longer allowed on the plugin (`lib/user-caller.js`:
 * disabled, removed, no longer entitled, the plugin not ready — or another
 * user now holds the username) — `access_revoked`; holds other roles than
 * the response was started with — `roles_changed`; or the route is no
 * longer served on its host (unbound, the tunnel disabled or moved, the
 * plugin unhosted) — `surface_withdrawn`. Each user and route is
 * resolved once per sweep. One sweep at a time; a failed check keeps the
 * response (the next sweep tries again) and is logged by the request's own
 * line when it ends. Returns how many it ended.
 *
 * @param {import('pino').Logger} [logger]
 * @returns {Promise<number>}
 */
export async function sweepOpenUserSurfaceResponses(logger) {
  if (sweeping) return sweeping;
  sweeping = (async () => {
    const { resolveUserCaller } = await import('./user-caller.js');
    const callers = new Map();
    const served = new Map();
    let ended = 0;
    for (const response of [...openResponses]) {
      const { route, caller } = response;
      let verdict;
      try {
        if (!served.has(route)) served.set(route, (await servedUserSurfaceHost(route)) !== null);
        const key = `${route}\n${caller.username}`;
        if (!callers.has(key)) callers.set(key, await resolveUserCaller(route, caller.username));
        const resolution = callers.get(key);
        if (!resolution.ok || resolution.caller.userId !== caller.userId) {
          verdict = 'access_revoked';
        } else if (!sameRoles(resolution.caller.roles, caller.roles)) {
          verdict = 'roles_changed';
        } else if (!served.get(route)) verdict = 'surface_withdrawn';
      } catch (err) {
        logger?.warn?.(
          { route, err: err instanceof Error ? err.message : String(err) },
          'Could not re-check an open user-surface response',
        );
        continue;
      }
      if (verdict) {
        response.end(verdict);
        ended += 1;
      }
    }
    return ended;
  })();
  try {
    return await sweeping;
  } finally {
    sweeping = null;
  }
}
