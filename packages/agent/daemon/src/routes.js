/**
 * REST API routes for the agent panel HTTP daemon.
 *
 * Implements the full AgentClient interface as HTTP endpoints.
 * Each handler is a thin HTTP wrapper: validate input, call core lib
 * or panel API proxy, format response.
 *
 * Business logic lives in @lamalibre/lamaste/agent.
 * Panel server proxy calls live in ./panel-api.js.
 */

import { execa } from 'execa';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  agentDataDir,
  isAgentLoaded,
  getAgentPid,
  listLoadedAgentsCached,
  loadAgent,
  unloadAgent,
  loadAgentConfig,
  saveAgentConfig,
  agentLogFile,
  agentPluginConfig,
  readPluginRegistry,
  installPlugin,
  uninstallPlugin,
  enablePlugin,
  disablePlugin,
  updatePlugin,
  checkPluginUpdate,
  readPluginBundle,
  unloadPanelService,
  loadPanelService,
  // Multi-agent registry
  listAgents,
  getAgent,
  setCurrentAgent,
  removeAgent,
  getCurrentLabel,
  // Service discovery
  scanServices,
  loadServiceRegistry,
  addCustomService,
  removeCustomService,
  // Server registry
  getServers,
  setActiveServer,
  removeServer,
  updateServer,
  getStorageServers,
  // Mode management
  getServerMode,
  setServerMode,
  hasAdminCert,
  getActiveServerId,
} from '@lamalibre/lamaste/agent';

import {
  generateServiceConfig,
  writeServiceConfigFile,
  injectChiselFingerprint,
} from './service-config.js';

// UUID regex for validating :id params before proxying to panel server
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Plugin name validation
const PLUGIN_NAME_RE = /^[a-z0-9-]+$/;

// Agent label validation regex (same as registry.ts)
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

// Service ID validation
const SERVICE_ID_RE = /^[a-z0-9-]+$/;

// Valid modes for desktop mode switching
const VALID_MODES = new Set(['agent', 'admin']);

/**
 * Per-route capability guard.
 *
 * The auth hook in server.js populates `request.certCapabilities` per caller:
 *   - Bearer token (desktop owner) or admin mTLS cert: `null` => "all caps"
 *   - agent mTLS cert: array of capability strings fetched from the panel
 *   - Authelia user (plugin routes only): empty array (never reaches /api/*)
 *
 * `requireCap(cap)` returns a Fastify preHandler that allows the request
 * through if the caller has the required capability (or full access).
 *
 * @param {string} cap - Required capability (e.g. 'tunnels:read')
 * @returns {(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>}
 */
function requireCap(cap) {
  return async function capabilityGuard(request, reply) {
    // Admin cert is the master key — bypass all capability checks.
    if (request.certRole === 'admin') return;
    // null means "all capabilities" — set for Bearer token (desktop owner).
    if (request.certCapabilities === null) return;
    // Defense-in-depth: any unexpected shape is denied (never default-allow).
    if (!Array.isArray(request.certCapabilities)) {
      return reply.code(403).send({ error: 'Capability check failed' });
    }
    if (!request.certCapabilities.includes(cap)) {
      return reply.code(403).send({ error: `Missing capability: ${cap}` });
    }
  };
}

/**
 * Per-route guard for "owner-only" endpoints — admin cert and Bearer token
 * (desktop owner) only. Agent mTLS certs cannot reach these endpoints
 * regardless of capabilities. Use for endpoints that manage sibling agents,
 * install unsandboxed plugins, or touch the local plugin host.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
async function requireOwner(request, reply) {
  if (request.certRole === 'admin') return;
  if (request.certCapabilities === null) return; // Bearer token (owner)
  return reply.code(403).send({ error: 'This endpoint requires admin or owner access' });
}

/**
 * Register all REST API routes on the given Fastify instance.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ label: string, panelApi: import('./panel-api.js').PanelApiClient }} opts
 */
export default async function routes(fastify, opts) {
  const { label, panelApi } = opts;

  /** Load current agent config or throw. */
  async function getConfig() {
    const config = await loadAgentConfig(label);
    if (!config) throw new Error('Agent not configured');
    return config;
  }

  const pluginCfg = agentPluginConfig(label);

  // -----------------------------------------------------------------------
  // Status & Control
  // -----------------------------------------------------------------------

  // Status visibility — readable by any authenticated caller (no capability gate).
  // Empty `rateLimit: {}` opts the route into the globally-registered limiter
  // (100 req/min) and satisfies the CodeQL js/missing-rate-limiting dataflow.
  fastify.get('/status', { config: { rateLimit: {} } }, async () => {
    const config = await loadAgentConfig(label);
    const running = await isAgentLoaded(label);
    const pid = running ? await getAgentPid(label) : null;
    return {
      running,
      pid,
      chiselVersion: config?.chiselVersion || null,
      installed: !!config,
    };
  });

  // start/stop/restart/update manage the chisel tunnel daemon. We classify
  // them under tunnels:write because controlling chisel is equivalent to
  // controlling all tunnel state (a stopped agent breaks every tunnel).
  fastify.post('/start', { preHandler: requireCap('tunnels:write') }, async () => {
    await loadAgent(label);
    return { ok: true };
  });

  fastify.post('/stop', { preHandler: requireCap('tunnels:write') }, async () => {
    await unloadAgent(label);
    return { ok: true };
  });

  fastify.post('/restart', { preHandler: requireCap('tunnels:write') }, async () => {
    await unloadAgent(label);
    await loadAgent(label);
    return { ok: true };
  });

  fastify.post('/update', { preHandler: requireCap('tunnels:write') }, async (request) => {
    const config = await getConfig();
    const agentConfig = await panelApi.fetchAgentConfig(config);

    // Regenerate service config and restart. Re-inject the chisel TLS pin
    // (B10) if the agent has one on file — otherwise leave the args as
    // returned by the panel (which still has --tls-skip-verify).
    const chiselArgs = config.chiselServerCertSha256Hex
      ? injectChiselFingerprint(agentConfig.chiselArgs, config.chiselServerCertSha256Hex)
      : agentConfig.chiselArgs;
    const content = generateServiceConfig(chiselArgs, label);
    await writeServiceConfigFile(content, label);

    // Update stored config
    config.domain = agentConfig.domain;
    config.updatedAt = new Date().toISOString();
    await saveAgentConfig(label, config);

    // Restart chisel
    await unloadAgent(label);
    await loadAgent(label);

    request.log.info({ label }, 'Agent updated');
    return { ok: true };
  });

  // -----------------------------------------------------------------------
  // Tunnels (proxied to panel server)
  // -----------------------------------------------------------------------

  fastify.get(
    '/tunnels',
    { preHandler: requireCap('tunnels:read'), config: { rateLimit: {} } },
    async () => {
      const config = await getConfig();
      return panelApi.fetchTunnels(config);
    },
  );

  fastify.post(
    '/tunnels',
    {
      preHandler: requireCap('tunnels:write'),
      // Moderate tier — tunnel writes are management operations.
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request) => {
      const config = await getConfig();
      return panelApi.curlAuthenticatedJson(config, [
        '-X',
        'POST',
        '-H',
        'Content-Type: application/json',
        '-d',
        JSON.stringify(request.body),
        `${config.panelUrl}/api/tunnels`,
      ]);
    },
  );

  fastify.patch(
    '/tunnels/:id',
    {
      preHandler: requireCap('tunnels:write'),
      // Moderate tier — tunnel writes are management operations.
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid tunnel ID' });
      const config = await getConfig();
      return panelApi.curlAuthenticatedJson(config, [
        '-X',
        'PATCH',
        '-H',
        'Content-Type: application/json',
        '-d',
        JSON.stringify(request.body),
        `${config.panelUrl}/api/tunnels/${id}`,
      ]);
    },
  );

  fastify.delete(
    '/tunnels/:id',
    {
      preHandler: requireCap('tunnels:write'),
      // Moderate tier — tunnel writes are management operations.
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid tunnel ID' });
      const config = await getConfig();
      return panelApi.curlAuthenticatedJson(config, [
        '-X',
        'DELETE',
        `${config.panelUrl}/api/tunnels/${id}`,
      ]);
    },
  );

  // -----------------------------------------------------------------------
  // Services
  // -----------------------------------------------------------------------

  fastify.get('/services', { preHandler: requireCap('services:read') }, async () => {
    // Service scanning is platform-specific and handled by the desktop
    // app's Rust backend. The web panel provides a read-only view.
    return { services: [], dockerContainers: [] };
  });

  // Note: writes to the custom service registry go through /services/custom
  // (defined later in this file). The previous stubs at POST /services and
  // DELETE /services/:id silently returned ok without persisting anything,
  // which made the web client's "add custom service" appear to succeed while
  // doing nothing — they are removed deliberately.

  // -----------------------------------------------------------------------
  // Logs
  // -----------------------------------------------------------------------

  fastify.get(
    '/logs',
    { preHandler: requireCap('system:read'), config: { rateLimit: {} } },
    async () => {
      const logPath = agentLogFile(label);
      try {
        // Use tail to avoid loading large log files into memory
        const { stdout } = await execa('tail', ['-n', '200', logPath]);
        return { logs: stdout };
      } catch (err) {
        if (err.exitCode) return { logs: '' };
        throw err;
      }
    },
  );

  // -----------------------------------------------------------------------
  // Config
  // -----------------------------------------------------------------------

  // Config visibility — already strips sensitive fields. Open to any
  // authenticated caller (Bearer/admin/agent/Authelia would all be safe;
  // /api/* is closed to Authelia by the auth hook regardless).
  fastify.get('/config', { config: { rateLimit: {} } }, async () => {
    const config = await getConfig();
    // Strip sensitive fields
    return {
      panelUrl: config.panelUrl,
      domain: config.domain || null,
      authMethod: config.authMethod || 'p12',
      chiselVersion: config.chiselVersion || null,
      setupAt: config.setupAt || null,
      updatedAt: config.updatedAt || null,
    };
  });

  fastify.get('/panel-url', { config: { rateLimit: {} } }, async () => {
    const config = await getConfig();
    return { url: config.panelUrl };
  });

  // -----------------------------------------------------------------------
  // Certificate (proxied to panel server)
  // -----------------------------------------------------------------------

  // Certificate operations are owner-privileged: rotation invalidates the
  // current cert, and download exports the agent's private key material.
  // Neither maps cleanly onto a base capability — restrict to admin and
  // the desktop owner (Bearer token). Strict tier (5/min): credential-
  // bearing endpoints — brute-force surface that must not blend with the
  // 100/min global default.
  fastify.post(
    '/certificate/rotate',
    {
      preHandler: requireOwner,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async () => {
      const config = await getConfig();
      return panelApi.curlAuthenticatedJson(config, [
        '-X',
        'POST',
        `${config.panelUrl}/api/certs/mtls/rotate`,
      ]);
    },
  );

  fastify.get(
    '/certificate/download',
    {
      preHandler: requireOwner,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const config = await getConfig();
      const authMethod = config.authMethod || 'p12';

      // Hardware-bound (Keychain) certs are non-extractable by design.
      // Surface a 410 Gone so the desktop UI can show a helpful message
      // rather than offering a download that can never succeed.
      if (authMethod !== 'p12') {
        return reply.code(410).send({
          error: 'Certificate is hardware-bound and cannot be exported',
          authMethod,
        });
      }

      if (!config.p12Path) {
        return reply.code(404).send({ error: 'No P12 certificate configured' });
      }

      // Defense-in-depth: confine reads to the agent data directory so a
      // malicious config file cannot exfiltrate arbitrary files via this
      // endpoint. This also blocks symlinks that resolve outside the dir.
      let resolvedPath;
      try {
        resolvedPath = await realpath(config.p12Path);
      } catch (err) {
        if (err.code === 'ENOENT') {
          return reply.code(404).send({ error: 'P12 file does not exist' });
        }
        throw err;
      }

      const agentRoot = path.resolve(agentDataDir(label));
      const relative = path.relative(agentRoot, resolvedPath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return reply.code(403).send({ error: 'P12 path is outside the agent data directory' });
      }

      const bytes = await readFile(resolvedPath);
      const fileName = path.basename(resolvedPath) || 'client.p12';
      reply
        .header('Content-Type', 'application/x-pkcs12')
        .header('Content-Disposition', `attachment; filename="${fileName}"`)
        .header('Content-Length', String(bytes.length));
      return reply.send(bytes);
    },
  );

  // -----------------------------------------------------------------------
  // Web Panel Expose/Retract
  // -----------------------------------------------------------------------

  fastify.get(
    '/panel-expose-status',
    { preHandler: requireCap('panel:expose') },
    async (request, reply) => {
      try {
        const config = await getConfig();
        return await panelApi.fetchPanelTunnelStatus(config);
      } catch (err) {
        request.log.error(
          { errMsg: String(err.message ?? '') },
          'Failed to fetch panel expose status',
        );
        const msg = String(err.message ?? '');
        const is403 = msg.includes('capability') || msg.includes('403');
        return reply.code(is403 ? 403 : 500).send({ error: 'Failed to fetch panel status' });
      }
    },
  );

  fastify.post(
    '/panel-expose',
    { preHandler: requireCap('panel:expose') },
    async (request, reply) => {
      try {
        const config = await getConfig();
        const rawPort = request.body?.port || 9393;
        const port = Number(rawPort);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) {
          return reply.code(400).send({ error: 'Port must be an integer between 1024 and 65535' });
        }
        return await panelApi.exposePanelTunnel(config, port);
      } catch (err) {
        request.log.error({ errMsg: String(err.message ?? '') }, 'Failed to expose panel');
        const msg = String(err.message ?? '');
        const is409 = msg.includes('already exists');
        return reply
          .code(is409 ? 409 : 500)
          .send({ error: is409 ? 'Panel tunnel already exists' : 'Failed to expose panel' });
      }
    },
  );

  fastify.post(
    '/panel-retract',
    { preHandler: requireCap('panel:expose') },
    async (request, reply) => {
      try {
        const config = await getConfig();
        return await panelApi.retractPanelTunnel(config);
      } catch (err) {
        request.log.error({ errMsg: String(err.message ?? '') }, 'Failed to retract panel');
        return reply.code(500).send({ error: 'Failed to retract panel' });
      }
    },
  );

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  // Uninstall is a destructive lifecycle operation — owner/admin only.
  fastify.post('/uninstall', { preHandler: requireOwner }, async (request) => {
    request.log.warn({ label }, 'Uninstall requested via web panel');
    await unloadAgent(label);
    return { ok: true, message: 'Agent stopped. Run lamaste-agent uninstall for full removal.' };
  });

  // -----------------------------------------------------------------------
  // Plugins
  // -----------------------------------------------------------------------

  // Plugin management is owner/admin-only — plugin code runs unsandboxed
  // in the agent daemon process; agent capabilities never grant install
  // rights regardless of bits set on the cert.
  fastify.get('/plugins', { preHandler: requireOwner, config: { rateLimit: {} } }, async () => {
    return readPluginRegistry(pluginCfg.registryPath);
  });

  fastify.post('/plugins/install', { preHandler: requireOwner }, async (request, reply) => {
    const { packageName } = request.body || {};
    // Defense-in-depth at the route boundary: the core lib also validates
    // scope, but rejecting bad input here avoids spawning npm at all.
    if (
      !packageName ||
      typeof packageName !== 'string' ||
      packageName.length > 256 ||
      !/^@lamalibre\/[a-z0-9][a-z0-9._-]{0,213}(@[A-Za-z0-9._-]+)?$/.test(packageName) ||
      packageName.includes('@npm:')
    ) {
      return reply
        .code(400)
        .send({ error: 'Invalid packageName: must be @lamalibre/ scoped, no aliases' });
    }
    try {
      const entry = await installPlugin(pluginCfg, packageName);
      return { ok: true, plugin: entry };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  fastify.post('/plugins/:name/enable', { preHandler: requireOwner }, async (request, reply) => {
    const { name } = request.params;
    if (!PLUGIN_NAME_RE.test(name)) {
      return reply.code(400).send({ error: 'Invalid plugin name' });
    }
    try {
      await enablePlugin(pluginCfg, name);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
    try {
      await unloadPanelService(label);
      await loadPanelService(label);
    } catch (restartErr) {
      request.log.error(
        { err: restartErr.message, plugin: name },
        'Panel service restart failed after enable — rolling back',
      );
      try {
        await disablePlugin(pluginCfg, name);
      } catch (rollbackErr) {
        request.log.error(
          { err: rollbackErr.message, plugin: name },
          'Plugin rollback failed — registry state may be inconsistent',
        );
        return reply.code(500).send({
          error: 'panel_rollback_failed',
          message: `Panel restart failed (${restartErr.message}) and rollback also failed (${rollbackErr.message}). Reconcile manually via lamaste-agent.`,
          recoverable: false,
        });
      }
      return reply.code(500).send({
        error: 'panel_restart_failed',
        message: restartErr.message,
        recoverable: true,
      });
    }
    return { ok: true, name, status: 'enabled' };
  });

  fastify.post('/plugins/:name/disable', { preHandler: requireOwner }, async (request, reply) => {
    const { name } = request.params;
    if (!PLUGIN_NAME_RE.test(name)) {
      return reply.code(400).send({ error: 'Invalid plugin name' });
    }
    try {
      await disablePlugin(pluginCfg, name);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
    try {
      await unloadPanelService(label);
      await loadPanelService(label);
    } catch (restartErr) {
      request.log.error(
        { err: restartErr.message, plugin: name },
        'Panel service restart failed after disable — rolling back',
      );
      try {
        await enablePlugin(pluginCfg, name);
      } catch (rollbackErr) {
        request.log.error(
          { err: rollbackErr.message, plugin: name },
          'Plugin rollback failed — registry state may be inconsistent',
        );
        return reply.code(500).send({
          error: 'panel_rollback_failed',
          message: `Panel restart failed (${restartErr.message}) and rollback also failed (${rollbackErr.message}). Reconcile manually via lamaste-agent.`,
          recoverable: false,
        });
      }
      return reply.code(500).send({
        error: 'panel_restart_failed',
        message: restartErr.message,
        recoverable: true,
      });
    }
    return { ok: true, name, status: 'disabled' };
  });

  fastify.delete('/plugins/:name', { preHandler: requireOwner }, async (request, reply) => {
    const { name } = request.params;
    if (!PLUGIN_NAME_RE.test(name)) {
      return reply.code(400).send({ error: 'Invalid plugin name' });
    }
    try {
      await uninstallPlugin(pluginCfg, name);
      return { ok: true, name };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  fastify.post('/plugins/:name/update', { preHandler: requireOwner }, async (request, reply) => {
    const { name } = request.params;
    if (!PLUGIN_NAME_RE.test(name)) {
      return reply.code(400).send({ error: 'Invalid plugin name' });
    }
    try {
      const plugin = await updatePlugin(pluginCfg, name);
      return { ok: true, plugin };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  fastify.get(
    '/plugins/:name/check-update',
    { preHandler: requireOwner },
    async (request, reply) => {
      const { name } = request.params;
      if (!PLUGIN_NAME_RE.test(name)) {
        return reply.code(400).send({ error: 'Invalid plugin name' });
      }
      try {
        return await checkPluginUpdate(pluginCfg, name);
      } catch (err) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  fastify.get('/plugins/:name/bundle', { preHandler: requireOwner }, async (request, reply) => {
    const { name } = request.params;
    if (!PLUGIN_NAME_RE.test(name)) {
      return reply.code(400).send({ error: 'Invalid plugin name' });
    }
    try {
      const source = await readPluginBundle(pluginCfg, name);
      return { source };
    } catch (err) {
      return reply.code(404).send({ error: err.message });
    }
  });

  // -----------------------------------------------------------------------
  // Agent Management (multi-agent registry)
  // -----------------------------------------------------------------------

  // Multi-agent registry routes manage sibling agents owned by the same OS
  // user. They expose other agents' status/config — agent mTLS certs scoped
  // to a single label must not see them. Owner/admin only.
  fastify.get('/agents', { preHandler: requireOwner }, async (request) => {
    const agents = await listAgents();
    const currentLabel = await getCurrentLabel();

    // Single batched query (one launchctl/systemctl spawn) instead of 2N
    // per-label calls. Fall back to per-label probes only if the batch path
    // is unavailable (e.g. systemctl not present, launchctl missing).
    let loadedMap = null;
    try {
      loadedMap = await listLoadedAgentsCached();
    } catch (err) {
      request.log.warn(
        { err: err.message },
        'Batched service-state query failed, falling back to per-agent probes',
      );
    }

    const enriched = loadedMap
      ? agents.map((agent) => {
          const state = loadedMap.get(agent.label);
          return {
            label: agent.label,
            panelUrl: agent.panelUrl,
            authMethod: agent.authMethod,
            domain: agent.domain || null,
            chiselVersion: agent.chiselVersion || null,
            setupAt: agent.setupAt || null,
            updatedAt: agent.updatedAt || null,
            current: agent.label === currentLabel,
            running: !!state?.loaded,
            pid: state?.pid ?? null,
          };
        })
      : await Promise.all(
          agents.map(async (agent) => {
            const running = await isAgentLoaded(agent.label);
            const pid = running ? await getAgentPid(agent.label) : null;
            return {
              label: agent.label,
              panelUrl: agent.panelUrl,
              authMethod: agent.authMethod,
              domain: agent.domain || null,
              chiselVersion: agent.chiselVersion || null,
              setupAt: agent.setupAt || null,
              updatedAt: agent.updatedAt || null,
              current: agent.label === currentLabel,
              running,
              pid,
            };
          }),
        );

    return { agents: enriched, currentLabel };
  });

  fastify.get('/agents/:label', { preHandler: requireOwner }, async (request, reply) => {
    const { label: targetLabel } = request.params;
    if (!LABEL_RE.test(targetLabel)) {
      return reply.code(400).send({ error: 'Invalid agent label' });
    }

    const agent = await getAgent(targetLabel);
    if (!agent) {
      return reply.code(404).send({ error: `Agent "${targetLabel}" not found` });
    }

    const running = await isAgentLoaded(targetLabel);
    const pid = running ? await getAgentPid(targetLabel) : null;
    const currentLabel = await getCurrentLabel();

    return {
      label: agent.label,
      panelUrl: agent.panelUrl,
      authMethod: agent.authMethod,
      domain: agent.domain || null,
      chiselVersion: agent.chiselVersion || null,
      setupAt: agent.setupAt || null,
      updatedAt: agent.updatedAt || null,
      current: agent.label === currentLabel,
      running,
      pid,
    };
  });

  fastify.post('/agents/:label/start', { preHandler: requireOwner }, async (request, reply) => {
    const { label: targetLabel } = request.params;
    if (!LABEL_RE.test(targetLabel)) {
      return reply.code(400).send({ error: 'Invalid agent label' });
    }

    const agent = await getAgent(targetLabel);
    if (!agent) {
      return reply.code(404).send({ error: `Agent "${targetLabel}" not found` });
    }

    await loadAgent(targetLabel);
    request.log.info({ label: targetLabel }, 'Agent started');
    return { ok: true };
  });

  fastify.post('/agents/:label/stop', { preHandler: requireOwner }, async (request, reply) => {
    const { label: targetLabel } = request.params;
    if (!LABEL_RE.test(targetLabel)) {
      return reply.code(400).send({ error: 'Invalid agent label' });
    }

    const agent = await getAgent(targetLabel);
    if (!agent) {
      return reply.code(404).send({ error: `Agent "${targetLabel}" not found` });
    }

    await unloadAgent(targetLabel);
    request.log.info({ label: targetLabel }, 'Agent stopped');
    return { ok: true };
  });

  fastify.post('/agents/:label/restart', { preHandler: requireOwner }, async (request, reply) => {
    const { label: targetLabel } = request.params;
    if (!LABEL_RE.test(targetLabel)) {
      return reply.code(400).send({ error: 'Invalid agent label' });
    }

    const agent = await getAgent(targetLabel);
    if (!agent) {
      return reply.code(404).send({ error: `Agent "${targetLabel}" not found` });
    }

    await unloadAgent(targetLabel);
    await loadAgent(targetLabel);
    request.log.info({ label: targetLabel }, 'Agent restarted');
    return { ok: true };
  });

  fastify.patch('/agents/current', { preHandler: requireOwner }, async (request, reply) => {
    const { label: targetLabel } = request.body || {};
    if (!targetLabel || typeof targetLabel !== 'string') {
      return reply.code(400).send({ error: 'label is required' });
    }
    if (!LABEL_RE.test(targetLabel)) {
      return reply.code(400).send({ error: 'Invalid agent label' });
    }

    try {
      await setCurrentAgent(targetLabel);
      request.log.info({ label: targetLabel }, 'Current agent set');
      return { ok: true, currentLabel: targetLabel };
    } catch (err) {
      return reply.code(404).send({ error: err.message });
    }
  });

  fastify.delete('/agents/:label', { preHandler: requireOwner }, async (request, reply) => {
    const { label: targetLabel } = request.params;
    if (!LABEL_RE.test(targetLabel)) {
      return reply.code(400).send({ error: 'Invalid agent label' });
    }

    const agent = await getAgent(targetLabel);
    if (!agent) {
      return reply.code(404).send({ error: `Agent "${targetLabel}" not found` });
    }

    // Stop the agent service before removal
    try {
      await unloadAgent(targetLabel);
    } catch {
      // May not be running — continue with removal
    }

    await removeAgent(targetLabel);
    request.log.warn({ label: targetLabel }, 'Agent removed from registry');
    return { ok: true };
  });

  fastify.get(
    '/agents/:label/logs',
    { preHandler: requireOwner, config: { rateLimit: {} } },
    async (request, reply) => {
      const { label: targetLabel } = request.params;
      if (!LABEL_RE.test(targetLabel)) {
        return reply.code(400).send({ error: 'Invalid agent label' });
      }

      const agent = await getAgent(targetLabel);
      if (!agent) {
        return reply.code(404).send({ error: `Agent "${targetLabel}" not found` });
      }

      const logPath = agentLogFile(targetLabel);
      try {
        const { stdout } = await execa('tail', ['-n', '200', logPath]);
        return { logs: stdout };
      } catch (err) {
        if (err.exitCode) return { logs: '' };
        throw err;
      }
    },
  );

  fastify.get('/agents/:label/config', { preHandler: requireOwner }, async (request, reply) => {
    const { label: targetLabel } = request.params;
    if (!LABEL_RE.test(targetLabel)) {
      return reply.code(400).send({ error: 'Invalid agent label' });
    }

    const config = await loadAgentConfig(targetLabel);
    if (!config) {
      return reply.code(404).send({ error: `Agent "${targetLabel}" not configured` });
    }

    // Strip sensitive fields
    return {
      panelUrl: config.panelUrl,
      domain: config.domain || null,
      authMethod: config.authMethod || 'p12',
      chiselVersion: config.chiselVersion || null,
      setupAt: config.setupAt || null,
      updatedAt: config.updatedAt || null,
    };
  });

  // -----------------------------------------------------------------------
  // Service Discovery
  // -----------------------------------------------------------------------

  fastify.get('/services/scan', { preHandler: requireCap('services:read') }, async () => {
    return scanServices();
  });

  // Replace the stub services endpoints with real implementations
  // (the original stubs at /services, /services, /services/:id are above
  //  but these new paths use different semantics)

  fastify.get(
    '/services/registry',
    { preHandler: requireCap('services:read'), config: { rateLimit: {} } },
    async () => {
      return loadServiceRegistry();
    },
  );

  fastify.post(
    '/services/custom',
    { preHandler: requireCap('services:write') },
    async (request, reply) => {
      const { name, port, binary, processName, category, description } = request.body || {};
      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'name is required' });
      }
      if (
        !port ||
        typeof port !== 'number' ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535
      ) {
        return reply.code(400).send({ error: 'port must be an integer between 1 and 65535' });
      }
      if (!category || typeof category !== 'string') {
        return reply.code(400).send({ error: 'category is required' });
      }
      try {
        const service = await addCustomService({
          name,
          port,
          binary: binary || undefined,
          processName: processName || undefined,
          category,
          description: description || '',
        });
        request.log.info({ serviceId: service.id }, 'Custom service added');
        return { ok: true, service };
      } catch (err) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  fastify.delete(
    '/services/custom/:name',
    { preHandler: requireCap('services:write') },
    async (request, reply) => {
      const { name } = request.params;
      if (!SERVICE_ID_RE.test(name)) {
        return reply.code(400).send({ error: 'Invalid service ID' });
      }
      try {
        await removeCustomService(name);
        request.log.info({ serviceId: name }, 'Custom service removed');
        return { ok: true };
      } catch (err) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  // -----------------------------------------------------------------------
  // Server Registry
  // -----------------------------------------------------------------------

  // Server registry tracks connections to one or more panel servers — an
  // owner-side concept (which servers does this OS user know about?).
  // Agent mTLS callers are scoped to one panel and must not enumerate or
  // mutate this registry. Owner/admin only.
  fastify.get('/servers', { preHandler: requireOwner, config: { rateLimit: {} } }, async () => {
    return { servers: await getServers() };
  });

  fastify.patch('/servers/active', { preHandler: requireOwner }, async (request, reply) => {
    const { id } = request.body || {};
    if (!id || typeof id !== 'string') {
      return reply.code(400).send({ error: 'id is required' });
    }
    try {
      await setActiveServer(id);
      request.log.info({ serverId: id }, 'Active server set');
      return { ok: true };
    } catch (err) {
      return reply.code(404).send({ error: err.message });
    }
  });

  fastify.patch('/servers/:id', { preHandler: requireOwner }, async (request, reply) => {
    const { id } = request.params;
    if (!id || typeof id !== 'string') {
      return reply.code(400).send({ error: 'Invalid server ID' });
    }
    const updates = request.body || {};
    if (typeof updates !== 'object' || Array.isArray(updates)) {
      return reply.code(400).send({ error: 'Body must be an object' });
    }
    // Prevent changing the server ID via update
    delete updates.id;
    // Convert null values to undefined so the spread deletes them
    for (const key of Object.keys(updates)) {
      if (updates[key] === null) {
        updates[key] = undefined;
      }
    }
    try {
      const server = await updateServer(id, updates);
      request.log.info({ serverId: id }, 'Server updated');
      return { ok: true, server };
    } catch (err) {
      return reply.code(404).send({ error: err.message });
    }
  });

  fastify.delete('/servers/:id', { preHandler: requireOwner }, async (request, reply) => {
    const { id } = request.params;
    if (!id || typeof id !== 'string') {
      return reply.code(400).send({ error: 'Invalid server ID' });
    }
    try {
      await removeServer(id);
      request.log.info({ serverId: id }, 'Server removed');
      return { ok: true };
    } catch (err) {
      return reply.code(404).send({ error: err.message });
    }
  });

  fastify.get(
    '/storage-servers',
    { preHandler: requireOwner, config: { rateLimit: {} } },
    async () => {
      return { servers: await getStorageServers() };
    },
  );

  // -----------------------------------------------------------------------
  // Mode Management
  // -----------------------------------------------------------------------

  // Mode (agent vs admin) is a desktop-app concept tied to the active
  // server selection — owner/admin only.
  fastify.get('/mode', { preHandler: requireOwner, config: { rateLimit: {} } }, async () => {
    const mode = await getServerMode();
    return { mode };
  });

  fastify.patch('/mode', { preHandler: requireOwner }, async (request, reply) => {
    const { mode } = request.body || {};
    if (!mode || typeof mode !== 'string' || !VALID_MODES.has(mode)) {
      return reply.code(400).send({ error: "mode must be 'agent' or 'admin'" });
    }

    const serverId = await getActiveServerId();
    if (!serverId) {
      return reply.code(404).send({ error: 'No active server' });
    }

    await setServerMode(serverId, mode);
    request.log.info({ serverId, mode }, 'Server mode set');
    return { ok: true, mode };
  });

  fastify.get('/admin-cert', { preHandler: requireOwner, config: { rateLimit: {} } }, async () => {
    const hasCert = await hasAdminCert();
    return { hasAdminCert: hasCert };
  });
}
