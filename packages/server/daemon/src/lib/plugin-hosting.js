/**
 * Hosting an agent-hosted plugin's agent half on an agent — the daemon's
 * wiring of `@lamalibre/lamaste/server`'s plugin hosting store, the internal
 * tunnel workflow, the agent registry and the health monitor.
 *
 * Hosting a plugin on an agent is three things done together, and undone
 * together: an internal plugin tunnel carried by that agent (its port is
 * assigned from the internal range), a hosting record with a fresh
 * installation secret, and the `plugin:<route>:host` capability on the
 * agent's certificate — the only thing that lets the agent fetch the secret.
 */

import {
  AGENT_LABEL_REGEX,
  PLUGIN_AGENT_CN_PREFIX,
  derivePluginRoute,
  hasAgentHalf,
  pluginHostCapability,
} from '@lamalibre/lamaste';
import {
  TUNNEL_MAX_BODY_MB,
  createTunnel,
  deleteTunnel,
  createPluginHosting,
  removePluginHosting,
  getPluginHosting,
  readPluginHostings,
  rotatePluginHostingSecret,
  acknowledgePluginHostingSecret,
  updatePluginHostingHealth,
  signingSecretFor,
  pluginHostingView,
  agentPluginConfigFor,
  agentPluginAssignments,
  startPluginHealthMonitor,
  PluginHostingError,
  TunnelError,
} from '@lamalibre/lamaste/server';
import { getConfig } from './config.js';
import { readTunnels } from './state.js';
import { loadAgentRegistry, saveAgentRegistry, withRegistryLock } from './mtls.js';
import {
  tunnelNginxDeps,
  tunnelCertbotDeps,
  tunnelChiselDeps,
  tunnelStateDeps,
} from './tunnel-deps.js';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';

function httpError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

/**
 * The installed plugin `name` must be agent-hosted with an agent half.
 * @param {string} name
 */
async function requireHostablePlugin(name) {
  const { findPlugin } = await import('./plugins.js');
  const plugin = await findPlugin(name);
  if (!plugin) throw httpError(`Plugin "${name}" not found`, 404);
  if (!hasAgentHalf(plugin)) {
    throw httpError(
      plugin.hosting === 'agent'
        ? `Plugin "${name}" has no agent half (its manifest declares no "agent" block)`
        : `Plugin "${name}" is a server plugin and runs on the panel`,
      400,
    );
  }
  return plugin;
}

/** Add or remove one capability on an agent's certificate record, under the registry lock. */
function setAgentCapability(label, capability, present) {
  return withRegistryLock(async () => {
    const registry = await loadAgentRegistry();
    const agent = registry.agents.find((a) => a.label === label && !a.revoked);
    if (!agent) throw httpError(`Agent "${label}" is not enrolled or has been revoked`, 400);
    const current = Array.isArray(agent.capabilities) ? agent.capabilities : ['tunnels:read'];
    const has = current.includes(capability);
    if (present === has) return;
    agent.capabilities = present
      ? [...current, capability]
      : current.filter((c) => c !== capability);
    await saveAgentRegistry(registry);
  });
}

async function isActiveAgent(label) {
  const registry = await loadAgentRegistry();
  return registry.agents.some((a) => a.label === label && !a.revoked);
}

/**
 * Host plugin `name` on agent `agentLabel`.
 *
 * @param {string} name
 * @param {string} agentLabel
 * @param {import('pino').Logger} logger
 * @returns {Promise<import('@lamalibre/lamaste/server').PluginHostingView>}
 */
export async function hostPlugin(name, agentLabel, logger) {
  const plugin = await requireHostablePlugin(name);
  const route = derivePluginRoute(plugin.name);
  if (!AGENT_LABEL_REGEX.test(agentLabel) || agentLabel.startsWith(PLUGIN_AGENT_CN_PREFIX)) {
    throw httpError('agentLabel must name an enrolled machine agent', 400);
  }
  if (!(await isActiveAgent(agentLabel))) {
    throw httpError(`Agent "${agentLabel}" is not enrolled or has been revoked`, 400);
  }
  if (await getPluginHosting(STATE_DIR, route)) {
    throw httpError(`Plugin "${name}" is already hosted — clear its hosting first`, 409);
  }

  const config = getConfig();
  if (!config.domain || !config.email) {
    throw httpError('Domain and email must be configured before hosting a plugin', 400);
  }

  // 1. The internal tunnel: chisel grant + assigned port, nothing public.
  let tunnel;
  try {
    tunnel = await createTunnel({
      exposure: 'internal',
      type: 'plugin',
      pluginName: plugin.packageName,
      agentLabel,
      description: `Internal tunnel of plugin ${plugin.name}`,
      maxBodySizeMb: TUNNEL_MAX_BODY_MB.default,
      domain: config.domain,
      email: config.email,
      nginx: tunnelNginxDeps,
      certbot: tunnelCertbotDeps,
      chisel: tunnelChiselDeps,
      state: tunnelStateDeps,
      agents: { isActiveAgent },
      logger,
    });
  } catch (err) {
    if (err instanceof TunnelError) throw httpError(err.message, 400);
    throw err;
  }

  const rollbackTunnel = async () => {
    try {
      await deleteTunnel({
        id: tunnel.id,
        nginx: tunnelNginxDeps,
        chisel: tunnelChiselDeps,
        state: tunnelStateDeps,
        logger,
      });
    } catch (rollbackErr) {
      logger.error(
        { err: rollbackErr, tunnelId: tunnel.id },
        'Rollback: failed to remove the internal plugin tunnel',
      );
    }
  };

  // 2. The hosting record with its secret.
  let record;
  try {
    record = await createPluginHosting(STATE_DIR, {
      plugin: route,
      agentLabel,
      port: tunnel.port,
      tunnelId: tunnel.id,
    });
  } catch (err) {
    await rollbackTunnel();
    if (err instanceof PluginHostingError) throw httpError(err.message, 409);
    throw err;
  }

  // 3. The host capability on the agent's certificate.
  try {
    await setAgentCapability(agentLabel, pluginHostCapability(route), true);
  } catch (err) {
    await removePluginHosting(STATE_DIR, route).catch(() => undefined);
    await rollbackTunnel();
    throw err;
  }

  logger.info({ plugin: route, agentLabel, port: tunnel.port }, 'Plugin hosted on agent');
  return pluginHostingView(record);
}

/**
 * Undo `hostPlugin`: capability, record, tunnel. With `ifHosted` a plugin
 * that is not hosted is not an error.
 *
 * @param {string} name
 * @param {import('pino').Logger} logger
 * @param {{ ifHosted?: boolean }} [options]
 */
export async function unhostPlugin(name, logger, options = {}) {
  const route = derivePluginRoute(name);
  const record = await getPluginHosting(STATE_DIR, route);
  if (!record) {
    if (options.ifHosted) return { ok: true, removed: false };
    throw httpError(`Plugin "${name}" is not hosted on an agent`, 404);
  }

  try {
    await setAgentCapability(record.agentLabel, pluginHostCapability(route), false);
  } catch (err) {
    // A revoked agent has no record to edit; the capability went with it.
    if (err.statusCode !== 400) throw err;
  }
  await removePluginHosting(STATE_DIR, route);
  try {
    await deleteTunnel({
      id: record.tunnelId,
      nginx: tunnelNginxDeps,
      chisel: tunnelChiselDeps,
      state: tunnelStateDeps,
      logger,
    });
  } catch (err) {
    if (!(err instanceof TunnelError && err.code === 'NOT_FOUND')) throw err;
  }
  logger.info({ plugin: route, agentLabel: record.agentLabel }, 'Plugin hosting removed');
  return { ok: true, removed: true };
}

/**
 * @param {string} name
 * @returns {Promise<import('@lamalibre/lamaste/server').PluginHostingView | null>}
 */
export async function getHostingView(name) {
  const record = await getPluginHosting(STATE_DIR, derivePluginRoute(name));
  return record ? withLiveHealth(pluginHostingView(record)) : null;
}

/** `agentHosting` for every plugin of a list — null for plugins that are not hosted. */
export async function attachHostings(plugins) {
  const store = await readPluginHostings(STATE_DIR);
  return plugins.map((p) => {
    const record = store[derivePluginRoute(p.name)];
    return { ...p, agentHosting: record ? withLiveHealth(pluginHostingView(record)) : null };
  });
}

/**
 * @param {string} name
 * @param {import('pino').Logger} logger
 */
export async function rotateHostingSecret(name, logger) {
  const route = derivePluginRoute(name);
  try {
    const record = await rotatePluginHostingSecret(STATE_DIR, route);
    logger.info({ plugin: route }, 'Plugin installation secret rotated');
    return pluginHostingView(record);
  } catch (err) {
    if (err instanceof PluginHostingError) throw httpError(err.message, 404);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// The hosting agent's side
// ---------------------------------------------------------------------------

/** The `appPlugins` entries of the agent-config response for agent `label`. */
export async function listAgentPluginAssignments(label) {
  return agentPluginAssignments(await readPluginHostings(STATE_DIR), label);
}

/**
 * The plugin config for the hosting agent `label` — port and secrets. Null
 * when the plugin is not hosted on that agent.
 * @param {string} label
 * @param {string} route
 */
export async function agentPluginConfig(label, route) {
  const record = await getPluginHosting(STATE_DIR, route);
  if (!record || record.agentLabel !== label) return null;
  return agentPluginConfigFor(record);
}

/**
 * The hosting agent confirms it holds the secret issued at `issuedAt`.
 * @param {string} label
 * @param {string} route
 * @param {string} issuedAt
 */
export async function acknowledgeAgentPluginConfig(label, route, issuedAt) {
  const record = await getPluginHosting(STATE_DIR, route);
  if (!record || record.agentLabel !== label) return null;
  const { record: next, acknowledged } = await acknowledgePluginHostingSecret(
    STATE_DIR,
    route,
    issuedAt,
  );
  return { acknowledged, secretIssuedAt: next.current.issuedAt };
}

// ---------------------------------------------------------------------------
// The forwarder's side
// ---------------------------------------------------------------------------

/**
 * Resolve a route to a forward target (see `agentForwarderPlugin`).
 * @param {string} route
 */
export async function resolveForwardTarget(route) {
  const { findPlugin } = await import('./plugins.js');
  const plugin = await findPlugin(route);
  if (!plugin || !hasAgentHalf(plugin)) return { kind: 'not_found' };
  if (plugin.status !== 'enabled') return { kind: 'disabled' };
  const record = await getPluginHosting(STATE_DIR, route);
  if (!record) return { kind: 'not_hosted' };
  const tunnels = await readTunnels();
  const tunnel = tunnels.find((t) => t.id === record.tunnelId);
  const maxBodyMb = tunnel?.maxBodySizeMb ?? TUNNEL_MAX_BODY_MB.default;
  return {
    plugin: route,
    port: record.port,
    secret: signingSecretFor(record),
    maxBodyBytes: maxBodyMb * 1024 * 1024,
  };
}

/**
 * Who the panel admits on a hosted plugin's routes: an administrator, or an
 * agent holding one of the plugin's declared capabilities. The host
 * capability is not one of them — hosting the application is not using it.
 * @param {import('fastify').FastifyRequest} request
 * @param {string} plugin
 */
export async function authorizeForwardedCaller(request, plugin) {
  if (request.certRole === 'admin') return { type: 'admin' };
  if (request.certRole === 'agent' || request.certRole === 'plugin-agent') {
    const prefix = `plugin:${plugin}:`;
    const host = pluginHostCapability(plugin);
    const caps = request.certCapabilities || [];
    if (caps.some((c) => c.startsWith(prefix) && c !== host) && request.certLabel) {
      return { type: 'agent', label: request.certLabel };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Health monitor
// ---------------------------------------------------------------------------

let monitor = null;

/** Start probing every hosting; idempotent. */
export function startHostedPluginHealthMonitor(logger) {
  if (monitor) return monitor;
  monitor = startPluginHealthMonitor({
    listHostings: async () => {
      const { readPlugins } = await import('./plugins.js');
      const enabled = new Set(
        (await readPlugins()).plugins.filter((p) => p.status === 'enabled').map((p) => p.name),
      );
      return Object.values(await readPluginHostings(STATE_DIR))
        .filter((r) => enabled.has(r.plugin))
        .map((r) => ({
          plugin: r.plugin,
          port: r.port,
          secret: signingSecretFor(r),
          health: r.health,
        }));
    },
    onTransition: async (plugin, health) => {
      await updatePluginHostingHealth(STATE_DIR, plugin, health);
    },
    logger,
  });
  return monitor;
}

export function stopHostedPluginHealthMonitor() {
  monitor?.stop();
  monitor = null;
}

/** Merge the monitor's last probe time into a persisted view. */
function withLiveHealth(view) {
  const tracker = monitor?.snapshot().get(view.plugin);
  if (!tracker) return view;
  return {
    ...view,
    health: {
      ...view.health,
      ...(tracker.checkedAt ? { checkedAt: tracker.checkedAt } : {}),
      ...(tracker.lastError && view.health.state !== 'up' ? { lastError: tracker.lastError } : {}),
    },
  };
}
