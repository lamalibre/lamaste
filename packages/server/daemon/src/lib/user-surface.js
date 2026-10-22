/**
 * Plugins' user surfaces on the relay (slice 6): which host serves an
 * agent-hosted plugin's `/api/<route>/app/*`, and the panel's side of every
 * such request.
 *
 * **Binding.** A tunnel is bound as a plugin's user surface (core
 * `bindUserSurface`; `TunnelEntry.userSurface` in `tunnels.json`, read with
 * core `tunnelUserSurfaceRoutes`): an enabled app tunnel an agent carries,
 * `authenticated` or `restricted`, its route held by an installed
 * agent-hosted plugin; a route on one host at most. A plugin may be bound
 * before it declares `identity`: its host *serves* the route — locations
 * that ask Gatekeeper and pass the request to the panel — only while the
 * plugin's installed, approved version declares it
 * ({@link servedUserSurfaceRoutes}). Before that requests go down the
 * tunnel as before, so a plugin's switch-over is a plain update. Whether a
 * route is served changes with the plugin's approval, update, reversal,
 * hosting and uninstall: each re-renders the vhosts it is bound to
 * ({@link refreshUserSurfaceVhosts}); an uninstall also releases the
 * binding everywhere ({@link releasePluginUserSurface}).
 *
 * **Requests.** The panel's user-surface context (`routes/user-surface.js`,
 * core `userSurfacePlugin`) admits a request only with a relay assertion
 * Gatekeeper signed for the panel ({@link verifyUserSurfaceRelay}),
 * forwards it to the plugin's agent half on the internal tunnel of the
 * route's hosting ({@link resolveUserSurfaceTarget}) as the directory's
 * user (`lib/user-caller.js`), and checks `Origin` against the bound host
 * ({@link userSurfaceOrigin}) — never the request's `Host`.
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
  tunnelUserSurfaceRoutes,
  verifyRelayAssertion,
} from '@lamalibre/lamaste';
import {
  TUNNEL_MAX_BODY_MB,
  TunnelError,
  bindUserSurface,
  releaseUserSurfaceRoute,
  unbindUserSurface,
} from '@lamalibre/lamaste/server';
import { httpError } from './app-error.js';
import { recordAuditBestEffort } from './audit.js';
import { getConfig } from './config.js';
import { installedVersionApproved } from './plugin-hooks.js';
import { findPluginByRoute } from './plugins.js';
import { relaySigner } from './relay-signing.js';
import { readTunnels } from './state.js';
import { tunnelCertbotDeps, tunnelNginxDeps, tunnelStateDeps } from './tunnel-deps.js';

/**
 * The user surface's own rate limit (Fastify route config): per client
 * address — nginx sets `X-Forwarded-For` to it and the panel trusts that
 * one loopback hop — and plugin route. An application's page makes many
 * requests; the panel's root limit (100/min) is for its administrators.
 */
export const USER_SURFACE_RATE_LIMIT = Object.freeze({
  max: 1200,
  timeWindow: '1 minute',
  keyGenerator: (request) => `${request.ip} ${request.params?.route ?? ''}`,
});

// ---------------------------------------------------------------------------
// Which bound routes a host serves
// ---------------------------------------------------------------------------

/**
 * Whether plugin `route`'s user surface is served on a host it is bound to,
 * and why not: `not_installed` (no installed plugin holds the route),
 * `no_identity` (its installed version declares none), `not_approved` (that
 * version is not approved). Not the agent half's protocol answer: the panel
 * checks that per request (503 until it answered).
 *
 * @param {string} route
 * @returns {Promise<{ served: true, plugin: object } | { served: false, reason: 'not_installed' | 'no_identity' | 'not_approved' }>}
 */
async function routeServing(route) {
  const plugin = await findPluginByRoute(route);
  if (!plugin) return { served: false, reason: 'not_installed' };
  if (!plugin.identity) return { served: false, reason: 'no_identity' };
  // A version whose approval cannot even be judged is not approved.
  if (!(await installedVersionApproved(plugin).catch(() => false))) {
    return { served: false, reason: 'not_approved' };
  }
  return { served: true, plugin };
}

/** The body limit of the plugin's internal tunnel, in MiB — the default while it is not hosted. */
async function internalTunnelBodyLimit(plugin) {
  const { ownHosting } = await import('./plugin-hosting.js');
  const record = await ownHosting(plugin);
  if (!record) return TUNNEL_MAX_BODY_MB.default;
  const tunnel = (await readTunnels()).find((t) => t.id === record.tunnelId);
  return tunnel?.maxBodySizeMb ?? TUNNEL_MAX_BODY_MB.default;
}

/**
 * Of `routes` (bound to one tunnel), the ones its vhost serves, in order,
 * each with the body limit of its locations (the plugin's internal
 * tunnel's). Core's `UserSurfaceDeps.servedRoutes` — called under the
 * tunnel lock, so it reads the tunnel state without taking it.
 *
 * @param {readonly string[]} routes
 * @returns {Promise<Array<{ route: string, maxBodySizeMb: number }>>}
 */
export async function servedUserSurfaceRoutes(routes) {
  const served = [];
  for (const route of routes) {
    const serving = await routeServing(route);
    if (!serving.served) continue;
    served.push({ route, maxBodySizeMb: await internalTunnelBodyLimit(serving.plugin) });
  }
  return served;
}

/** What core's tunnel workflows ask the panel about user surfaces. */
export const userSurfaceDeps = Object.freeze({ servedRoutes: servedUserSurfaceRoutes });

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
  const status = [];
  for (const route of routes) {
    const serving = await routeServing(route);
    status.push({ route, served: serving.served, reason: serving.served ? null : serving.reason });
  }
  return { ...tunnel, userSurfaceStatus: status };
}

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

/**
 * What core's binding workflows need from the panel — among them its domain
 * and Let's Encrypt email, which a vhost rewrite needs.
 */
function bindingOptions(id, route, logger) {
  const config = getConfig();
  if (!config.domain || !config.email) {
    throw httpError('Domain and email must be configured', 400);
  }
  return {
    id,
    route,
    domain: config.domain,
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
 * Bind plugin `route` as a user surface of tunnel `id`. The route must be
 * held by an installed agent-hosted plugin — whether its installed version
 * declares `identity` yet or not. Idempotent. Throws a core `TunnelError`
 * (or an `httpError`) to refuse.
 *
 * @param {string} id
 * @param {string} route
 * @param {{ actor: string, logger: import('pino').Logger }} opts
 * @returns {Promise<{ changed: boolean, tunnel: object }>} the tunnel with its `userSurfaceStatus`
 */
export async function bindTunnelUserSurface(id, route, { actor, logger }) {
  const result = await bindUserSurface({
    ...bindingOptions(id, route, logger),
    assertRoute: async (r) => {
      const plugin = await findPluginByRoute(r);
      if (!plugin) {
        throw new TunnelError(`No installed plugin holds the route '${r}'`, 'INVALID_SETTING');
      }
      if (!isAgentHostedPlugin(plugin)) {
        throw new TunnelError(
          `Plugin "${plugin.name}" is not agent-hosted — only an agent-hosted plugin has a user surface`,
          'INVALID_SETTING',
        );
      }
    },
  });
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
 * Whether plugin `route`'s user surface is served may have changed — its
 * version was approved, updated or reverted, it was hosted or unhosted (the
 * body limit is its internal tunnel's): bring the vhosts of the tunnels it
 * is bound to in line. Best effort — logged, never thrown; the panel's
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
}

/**
 * Plugin `plugin`, which held `route`, is uninstalled: the route's binding
 * goes from every tunnel — the state first, so Gatekeeper and the panel
 * refuse the route at once — then those tunnels' vhosts lose its
 * locations. Best effort — logged, never thrown: the uninstall happened.
 *
 * @param {string | null | undefined} route
 * @param {{ plugin: string, logger: import('pino').Logger }} opts
 */
export async function releasePluginUserSurface(route, { plugin, logger }) {
  if (!route) return;
  try {
    const { released } = await releaseUserSurfaceRoute({ route, state: tunnelStateDeps, logger });
    if (released.length === 0) return;
    for (const tunnel of released) {
      await auditBinding('tunnel.user-surface.unbound', tunnel, route, {
        actor: 'lamaste',
        logger,
        plugin,
        reason: 'plugin-uninstalled',
      });
    }
    await reconcileVhostsOf(
      route,
      released.map((t) => t.id),
      logger,
    );
  } catch (err) {
    logger?.error?.(
      { route, err: err instanceof Error ? err.message : String(err) },
      'Could not release the user surface of an uninstalled plugin',
    );
  }
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

/** The enabled tunnel whose host serves `route`'s user surface, or null. */
async function userSurfaceTunnel(route) {
  const tunnels = await readTunnels();
  return (
    tunnels.find(
      (t) =>
        t.enabled !== false &&
        typeof t.fqdn === 'string' &&
        tunnelUserSurfaceRoutes(t).includes(route),
    ) ?? null
  );
}

/**
 * The forward target of `route`'s user surface (core `userSurfacePlugin`'s
 * `resolveTarget`): null when no enabled tunnel is bound to it, else what
 * the admin forwarder resolves — the hosting's internal tunnel, or why not
 * (not found, disabled, not hosted).
 *
 * @param {string} route
 */
export async function resolveUserSurfaceTarget(route) {
  if (!(await userSurfaceTunnel(route))) return null;
  const { resolveForwardTarget } = await import('./plugin-hosting.js');
  return resolveForwardTarget(route);
}

/**
 * The origin a request that may change something on `route`'s user surface
 * must come from (core `userSurfacePlugin`'s `originFor`): the bound host,
 * as the tunnel state names it — never the request's `Host`. Null when no
 * enabled tunnel is bound to the route.
 *
 * @param {string} route
 * @returns {Promise<string | null>}
 */
export async function userSurfaceOrigin(route) {
  const tunnel = await userSurfaceTunnel(route);
  return tunnel ? `https://${tunnel.fqdn.toLowerCase()}` : null;
}
