/**
 * The relay's side of calls and events between app plugins at run time
 * (4.13, slice 8): which agent halves speak the peers protocol, the peer
 * channels to consumers, and the gateway that decides and forwards what
 * comes over them. Grants and effective edges are `lib/peers.js`'s; the
 * channel, the gateway and the wire are core's (`peer-channel.ts`,
 * `peer-gateway.ts`).
 *
 * **Peer readiness.** The relay attaches to, forwards to and pulls from only
 * an agent half that answered `GET /admin/peers` with protocol 1 for its
 * installed version — asked after hosting, an update, an approval, every
 * health transition to up, at start, and on a tick for a hosting that is up
 * but has not answered. So an older half never meets a caller kind it would
 * refuse. Held in memory: a restart asks again.
 *
 * **Channels.** One per consumer — an installed, enabled plugin whose
 * approved version consumes at least one scope, hosted, active, up and
 * peer-ready as a consumer. The manager attaches, reattaches with backoff,
 * and stops keeping one whose consumer no longer qualifies; a secret
 * rotation its agent acknowledged replaces it ({@link peerSecretAcknowledged}).
 * Everything that can change who qualifies calls {@link syncPeerChannels};
 * a tick catches the rest.
 *
 * **The gateway's state** comes from here: effective edges and
 * subscriptions, the provider's forward target (the admin forwarder's
 * resolution: hosting, health, body limit, signing secret) and its
 * readiness, delegations (checked against the directory, the root plugin's
 * audience and the provider's), one outstanding events pull per consumer
 * and scope, and the audit of refusals — at most one `peer.call.denied` per
 * consumer, scope and code a minute.
 *
 * **Delegations** are issued to a plugin's agent half with each request a
 * person makes through its user surface, when the plugin has an effective
 * outgoing edge ({@link delegationForUserRequest}), and onward to a
 * provider that itself has one.
 */

import {
  AGENT_HALF_PEERS_PATH,
  KeyedPromiseChainMutex,
  PEER_DELEGATION_MAX_DEPTH,
  PEER_PROTOCOL_VERSION,
  callAgentHalf,
  onwardPeerDelegation,
  signPeerDelegation,
  verifyPeerDelegation,
} from '@lamalibre/lamaste';
import {
  createPeerChannelManager,
  createPeerChannelServer,
  createPeerGateway,
  pluginHostingPhase,
  signingSecretFor,
} from '@lamalibre/lamaste/server';
import { recordAuditBestEffort } from './audit.js';
import { getDirectoryUser, principalCleanupPending } from './directory.js';
import { identityReadiness } from './identity-sync.js';
import {
  effectivePeerEdge,
  effectiveSubscription,
  hasEffectiveOutgoingEdge,
  invalidatePeers,
  onPeersChanged,
} from './peers.js';
import { delegationSigningKey, delegationVerifyKeys } from './peer-delegation.js';
import { installedVersionApproved } from './plugin-hooks.js';
import { ownHosting, resolveForwardTarget } from './plugin-hosting.js';
import { findPlugin, findPluginByRoute, readPlugins } from './plugins.js';
import { requestHookRuntime } from './request-hooks.js';
import { audienceRolesOf } from './user-caller.js';

/** How long the readiness question may take. */
const READINESS_TIMEOUT_MS = 5_000;
const READINESS_MAX_RESPONSE_BYTES = 64 * 1024;
/** The tick: readiness of hostings that are up but have not answered, and the channels. */
const PEER_TICK_MS = 15_000;
/** At most one `peer.call.denied` per consumer, scope and code in this window. */
const DENIAL_AUDIT_WINDOW_MS = 60_000;

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/** route → { version, consumer, inbox, answeredAt } */
const readiness = new Map();
const readinessLocks = new KeyedPromiseChainMutex();

/**
 * Whether installed plugin `plugin`'s agent half answered the peers protocol
 * for its installed version.
 *
 * @param {{ route: string | null, version: string }} plugin
 */
export function peerReady(plugin) {
  return !!plugin?.route && readiness.get(plugin.route)?.version === plugin.version;
}

/** What the relay knows of every agent half's answer (for `GET /api/peers`). */
export function peerReadinessView() {
  return Object.fromEntries(readiness);
}

/**
 * Ask the agent half of the plugin at `route` whether it speaks the peers
 * protocol (`GET /admin/peers`, Lamaste's own call), and remember the answer
 * for its installed version. A plugin that declares no `peers`, is not
 * approved, not hosted, not active or down is forgotten instead. Never
 * throws.
 *
 * @param {string} route
 * @param {object} [logger]
 */
export function refreshPeerReadiness(route, logger) {
  return readinessLocks.run(route, async () => {
    try {
      const plugin = await findPluginByRoute(route);
      if (!plugin?.peers || !(await installedVersionApproved(plugin).catch(() => false))) {
        readiness.delete(route);
        return;
      }
      const record = await ownHosting(plugin);
      if (!record || pluginHostingPhase(record) !== 'active' || record.health?.state === 'down') {
        readiness.delete(route);
        return;
      }
      const result = await callAgentHalf({
        plugin: route,
        port: record.port,
        secret: signingSecretFor(record),
        method: 'GET',
        path: AGENT_HALF_PEERS_PATH,
        timeoutMs: READINESS_TIMEOUT_MS,
        maxResponseBytes: READINESS_MAX_RESPONSE_BYTES,
      });
      const body = result.ok && result.status === 200 ? result.body : null;
      if (body && body.protocol === PEER_PROTOCOL_VERSION) {
        readiness.set(route, {
          version: plugin.version,
          consumer: body.consumer === true,
          inbox: body.inbox === true,
          answeredAt: new Date().toISOString(),
        });
        return;
      }
      readiness.delete(route);
      logger?.warn(
        {
          plugin: route,
          ...(result.ok ? { status: result.status } : { failure: result.code }),
        },
        'The agent half did not answer the peers protocol',
      );
    } catch (err) {
      readiness.delete(route);
      logger?.warn({ plugin: route, err: err?.message }, 'Peer readiness check failed');
    }
  });
}

// ---------------------------------------------------------------------------
// The gateway's state
// ---------------------------------------------------------------------------

/**
 * Where a call to `provider` goes and its declaration of `scope` now — or
 * why it cannot go there (`not_hosted`, `down_tunnel`, `down_app`,
 * `not_ready`).
 */
async function providerTarget(provider, scope) {
  const target = await resolveForwardTarget(provider);
  if ('kind' in target) {
    if (target.kind === 'down') {
      return { kind: 'unavailable', reason: target.reason === 'app' ? 'down_app' : 'down_tunnel' };
    }
    return { kind: 'unavailable', reason: 'not_hosted' };
  }
  const plugin = await findPluginByRoute(provider);
  if (!plugin || !peerReady(plugin)) return { kind: 'unavailable', reason: 'not_ready' };
  const approved = await installedVersionApproved(plugin).catch(() => false);
  return {
    kind: 'ok',
    target,
    provided: approved ? (plugin.peers?.provides?.[scope] ?? null) : null,
  };
}

/**
 * Check a delegation a call carries: its signature and holder (the calling
 * consumer), the user active in the directory with no principal cleanup
 * pending, still an active member of the root plugin's audience, and held
 * by the provider's audience — which declares identity and is ready for its
 * users. The user is named with their roles in the provider; an onward
 * delegation goes with the call when the provider itself has an effective
 * outgoing edge.
 */
async function resolveDelegation({ consumer, provider, token }) {
  const verified = verifyPeerDelegation(token, {
    keys: await delegationVerifyKeys(),
    holder: consumer,
  });
  if (!verified.ok) return { ok: false, code: 'delegation_invalid' };
  const payload = verified.payload;
  const notEntitled = { ok: false, code: 'user_not_entitled' };
  const user = await getDirectoryUser(payload.userId);
  if (!user || user.status !== 'active') return notEntitled;
  if (await principalCleanupPending(user.username)) return notEntitled;
  const root = await findPluginByRoute(payload.root);
  if (!root || (await audienceRolesOf(root, user.userId)) === null) return notEntitled;
  const providing = await findPluginByRoute(provider);
  if (!providing?.identity || !(await identityReadiness(provider)).ready) return notEntitled;
  const roles = await audienceRolesOf(providing, user.userId);
  if (roles === null) return notEntitled;
  let onward = null;
  if (payload.depth < PEER_DELEGATION_MAX_DEPTH && (await hasEffectiveOutgoingEdge(provider))) {
    onward = onwardPeerDelegation(payload, provider, await delegationSigningKey());
  }
  return { ok: true, user: { userId: user.userId, username: user.username, roles }, onward };
}

/**
 * The delegation a plugin's agent half receives with a request a person
 * makes through its user surface: only for a plugin with an effective
 * outgoing edge (it can use it nowhere else), fresh with every request.
 *
 * @param {string} route
 * @param {{ userId: string }} caller the user caller the request carries
 * @returns {Promise<string | null>}
 */
export async function delegationForUserRequest(route, caller) {
  if (!(await hasEffectiveOutgoingEdge(route))) return null;
  return signPeerDelegation(
    { holder: route, root: route, userId: caller.userId },
    await delegationSigningKey(),
  );
}

const openPulls = new Set();

/** The one slot of `consumer` for an open events pull of `scope`, or null while it is taken. */
function acquireEventsPull(consumer, scope) {
  const key = `${consumer} ${scope}`;
  if (openPulls.has(key)) return null;
  openPulls.add(key);
  return () => openPulls.delete(key);
}

const deniedAt = new Map();

/** Audit a refused call — at most once per consumer, scope and code a minute. */
function auditDenial({ consumer, scope, code }, logger) {
  const now = Date.now();
  const key = `${consumer} ${scope ?? '-'} ${code}`;
  const last = deniedAt.get(key);
  if (last !== undefined && now - last < DENIAL_AUDIT_WINDOW_MS) return;
  deniedAt.set(key, now);
  if (deniedAt.size > 10_000) {
    for (const [k, at] of deniedAt) if (now - at >= DENIAL_AUDIT_WINDOW_MS) deniedAt.delete(k);
  }
  void recordAuditBestEffort(
    {
      actor: 'lamaste',
      action: 'peer.call.denied',
      plugin: consumer,
      details: { scope, code },
    },
    logger,
  );
}

/** The gateway's options — exported for the tests, which drive it without channels. */
export function peerGatewayOptions(logger) {
  return {
    edge: async (consumer, scope) => {
      const edge = await effectivePeerEdge(consumer, scope);
      return edge ? { provider: edge.provider, major: edge.major, provided: edge.provided } : null;
    },
    providerTarget,
    resolveDelegation,
    subscription: effectiveSubscription,
    acquireEventsPull,
    hooks: requestHookRuntime,
    onDenied: (denial) => auditDenial(denial, logger),
    logger,
  };
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

let manager = null;
let channelServer = null;
let tick = null;
let unsubscribe = null;

/** Whether plugin `plugin`'s approved version consumes any scope (it may want a channel). */
async function consumesAny(plugin) {
  if (Object.keys(plugin?.peers?.consumes ?? {}).length === 0) return false;
  return installedVersionApproved(plugin).catch(() => false);
}

/** Where and as whom to attach to `consumer` now, or null when it should have no channel. */
async function channelTarget(consumer) {
  const plugin = await findPluginByRoute(consumer);
  if (!plugin || plugin.status !== 'enabled' || !(await consumesAny(plugin))) return null;
  if (!peerReady(plugin) || readiness.get(consumer)?.consumer !== true) return null;
  const record = await ownHosting(plugin);
  if (!record || pluginHostingPhase(record) !== 'active' || record.health?.state === 'down') {
    return null;
  }
  return { consumer, port: record.port, secret: signingSecretFor(record) };
}

/**
 * Bring the channels in line: every plugin that may want one is ensured
 * (the manager attaches it or, finding no target, stops keeping it), and so
 * is every consumer it keeps. Never throws.
 */
export async function syncPeerChannels(logger) {
  if (!manager) return;
  try {
    const { plugins } = await readPlugins();
    const wanted = new Set(manager.consumers());
    for (const plugin of plugins) {
      if (plugin.route && Object.keys(plugin.peers?.consumes ?? {}).length > 0) {
        wanted.add(plugin.route);
      }
    }
    for (const consumer of wanted) manager.ensure(consumer);
  } catch (err) {
    logger?.warn({ err: err?.message }, 'Peer channel sync failed');
  }
}

/** The state of every channel kept (for `GET /api/peers`). */
export function peerChannelStatuses() {
  if (!manager) return {};
  return Object.fromEntries(manager.consumers().map((c) => [c, manager.status(c)]));
}

/**
 * The agent of the plugin at `route` acknowledged a new installation
 * secret: its channel, attached under the old one, is replaced — the old one
 * drains.
 */
export function peerSecretAcknowledged(route) {
  if (manager && manager.consumers().includes(route)) manager.replace(route);
}

/**
 * After an install, update, revert, approval, hosting or health change of
 * plugin `name`: the effective edges are recomputed, its half asked again
 * whether it speaks the peers protocol, and the channels brought in line.
 * Never throws.
 */
export async function refreshPluginPeers(name, logger) {
  invalidatePeers(logger);
  try {
    const plugin = await findPlugin(name);
    if (plugin?.route) await refreshPeerReadiness(plugin.route, logger);
  } catch (err) {
    logger?.warn({ plugin: name, err: err?.message }, 'Peer refresh failed');
  }
  await syncPeerChannels(logger);
}

/** A health transition of the hosting on `route`: up asks for readiness again; either way the channels follow. */
export async function onPeerHealthTransition(route, after, logger) {
  if (after.state === 'up') await refreshPeerReadiness(route, logger);
  else readiness.delete(route);
  await syncPeerChannels(logger);
}

async function peerTick(logger) {
  const { plugins } = await readPlugins();
  for (const plugin of plugins) {
    if (!plugin.route || !plugin.peers || peerReady(plugin)) continue;
    const record = await ownHosting(plugin).catch(() => null);
    if (record && pluginHostingPhase(record) === 'active' && record.health?.state === 'up') {
      await refreshPeerReadiness(plugin.route, logger);
    }
  }
  await syncPeerChannels(logger);
}

/**
 * Start the peer channels and the gateway behind them; idempotent. Asks
 * every hosting that is up whether it speaks the peers protocol, then keeps
 * the channels in line every {@link PEER_TICK_MS}.
 */
export function startPeerServices(logger) {
  if (manager) return;
  const gateway = createPeerGateway(peerGatewayOptions(logger));
  channelServer = createPeerChannelServer({ handle: gateway, logger });
  manager = createPeerChannelManager({ resolve: channelTarget, server: channelServer, logger });
  unsubscribe = onPeersChanged(() => void syncPeerChannels(logger));
  const run = () =>
    peerTick(logger).catch((err) => logger?.warn({ err: err?.message }, 'Peer tick failed'));
  void run();
  tick = setInterval(run, PEER_TICK_MS);
  tick.unref();
}

export function stopPeerServices() {
  if (tick) clearInterval(tick);
  tick = null;
  unsubscribe?.();
  unsubscribe = null;
  manager?.close();
  manager = null;
  channelServer?.close();
  channelServer = null;
}
