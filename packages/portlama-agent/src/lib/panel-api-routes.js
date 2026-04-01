/**
 * REST API routes for the agent panel HTTP server.
 *
 * Implements the full AgentClient interface as HTTP endpoints.
 * Calls existing agent library functions for service management,
 * config, and proxies tunnel/cert operations to the panel server.
 */

import { isAgentLoaded, getAgentPid, loadAgent, unloadAgent } from './service.js';
import { loadAgentConfig, saveAgentConfig } from './config.js';
import { agentLogFile } from './platform.js';
import { execa } from 'execa';
import {
  fetchTunnels,
  fetchAgentConfig,
  exposePanelTunnel,
  retractPanelTunnel,
  fetchPanelTunnelStatus,
} from './panel-api.js';
import {
  readAgentPluginRegistry,
  installAgentPlugin,
  uninstallAgentPlugin,
  enableAgentPlugin,
  disableAgentPlugin,
  updateAgentPlugin,
  checkAgentPluginUpdate,
  readAgentPluginBundle,
} from './agent-plugins.js';
import { unloadPanelService, loadPanelService } from './panel-service.js';

// UUID regex for validating :id params before proxying to panel server
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ label: string }} opts
 */
export default async function panelApiRoutes(fastify, opts) {
  const { label } = opts;

  // Helper to load current agent config
  async function getConfig() {
    const config = await loadAgentConfig(label);
    if (!config) throw new Error('Agent not configured');
    return config;
  }

  // --- Status & Control ---

  fastify.get('/status', async () => {
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

  fastify.post('/start', async () => {
    await loadAgent(label);
    return { ok: true };
  });

  fastify.post('/stop', async () => {
    await unloadAgent(label);
    return { ok: true };
  });

  fastify.post('/restart', async () => {
    await unloadAgent(label);
    await loadAgent(label);
    return { ok: true };
  });

  fastify.post('/update', async (request) => {
    const config = await getConfig();
    const agentConfig = await fetchAgentConfig(config);

    // Update chisel config and restart
    const { generateServiceConfig, writeServiceConfigFile } = await import('./service-config.js');
    const content = generateServiceConfig(agentConfig.chiselArgs, label);
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

  // --- Tunnels (proxied to panel server) ---

  fastify.get('/tunnels', async () => {
    const config = await getConfig();
    return fetchTunnels(config);
  });

  fastify.post('/tunnels', async (request) => {
    const config = await getConfig();
    const { curlAuthenticatedJson } = await import('./panel-api.js');
    return curlAuthenticatedJson(config, [
      '-X',
      'POST',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify(request.body),
      `${config.panelUrl}/api/tunnels`,
    ]);
  });

  fastify.patch('/tunnels/:id', async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid tunnel ID' });
    const config = await getConfig();
    const { curlAuthenticatedJson } = await import('./panel-api.js');
    return curlAuthenticatedJson(config, [
      '-X',
      'PATCH',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify(request.body),
      `${config.panelUrl}/api/tunnels/${id}`,
    ]);
  });

  fastify.delete('/tunnels/:id', async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid tunnel ID' });
    const config = await getConfig();
    const { curlAuthenticatedJson } = await import('./panel-api.js');
    return curlAuthenticatedJson(config, ['-X', 'DELETE', `${config.panelUrl}/api/tunnels/${id}`]);
  });

  // --- Services ---

  fastify.get('/services', async () => {
    // Return empty services — service scanning is platform-specific
    // and handled by the desktop app's Rust backend.
    // The web panel provides a read-only view.
    return { services: [], dockerContainers: [] };
  });

  fastify.post('/services', async () => {
    return { ok: true };
  });

  fastify.delete('/services/:id', async () => {
    return { ok: true };
  });

  // --- Logs ---

  fastify.get('/logs', async () => {
    const logPath = agentLogFile(label);
    try {
      // Use tail to avoid loading large log files into memory (constant-memory)
      const { stdout } = await execa('tail', ['-n', '200', logPath]);
      return { logs: stdout };
    } catch (err) {
      // tail exits non-zero if file doesn't exist
      if (err.exitCode) return { logs: '' };
      throw err;
    }
  });

  // --- Config ---

  fastify.get('/config', async () => {
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

  fastify.get('/panel-url', async () => {
    const config = await getConfig();
    return { url: config.panelUrl };
  });

  // --- Certificate (proxied to panel server) ---

  fastify.post('/certificate/rotate', async () => {
    const config = await getConfig();
    const { curlAuthenticatedJson } = await import('./panel-api.js');
    return curlAuthenticatedJson(config, [
      '-X',
      'POST',
      `${config.panelUrl}/api/certs/mtls/rotate`,
    ]);
  });

  fastify.get('/certificate/download', async () => {
    const config = await getConfig();
    // Return only whether a cert exists, not the full path (avoids leaking filesystem layout)
    return { hasCertificate: !!config.p12Path, authMethod: config.authMethod || 'p12' };
  });

  // --- Web Panel ---

  fastify.get('/panel-expose-status', async (request, reply) => {
    try {
      const config = await getConfig();
      return await fetchPanelTunnelStatus(config);
    } catch (err) {
      request.log.error(
        { errMsg: String(err.message ?? '') },
        'Failed to fetch panel expose status',
      );
      const msg = String(err.message ?? '');
      const is403 = msg.includes('capability') || msg.includes('403');
      return reply.code(is403 ? 403 : 500).send({ error: 'Failed to fetch panel status' });
    }
  });

  fastify.post('/panel-expose', async (request, reply) => {
    try {
      const config = await getConfig();
      const rawPort = request.body?.port || 9393;
      const port = Number(rawPort);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        return reply.code(400).send({ error: 'Port must be an integer between 1024 and 65535' });
      }
      return await exposePanelTunnel(config, port);
    } catch (err) {
      request.log.error({ errMsg: String(err.message ?? '') }, 'Failed to expose panel');
      const msg = String(err.message ?? '');
      const is409 = msg.includes('already exists');
      return reply
        .code(is409 ? 409 : 500)
        .send({ error: is409 ? 'Panel tunnel already exists' : 'Failed to expose panel' });
    }
  });

  fastify.post('/panel-retract', async (request, reply) => {
    try {
      const config = await getConfig();
      return await retractPanelTunnel(config);
    } catch (err) {
      request.log.error({ errMsg: String(err.message ?? '') }, 'Failed to retract panel');
      return reply.code(500).send({ error: 'Failed to retract panel' });
    }
  });

  // --- Lifecycle ---

  fastify.post('/uninstall', async (request) => {
    request.log.warn({ label }, 'Uninstall requested via web panel');
    // This is a destructive operation — just stop the agent for now.
    // Full uninstall requires the CLI.
    await unloadAgent(label);
    return { ok: true, message: 'Agent stopped. Run portlama-agent uninstall for full removal.' };
  });

  // --- Plugins ---

  const PLUGIN_NAME_RE = /^[a-z0-9-]+$/;

  fastify.get('/plugins', async () => {
    return readAgentPluginRegistry(label);
  });

  fastify.post('/plugins/install', async (request, reply) => {
    const { packageName } = request.body || {};
    if (!packageName || typeof packageName !== 'string') {
      return reply.code(400).send({ error: 'packageName is required' });
    }
    try {
      const entry = await installAgentPlugin(label, packageName);
      return { ok: true, plugin: entry };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  fastify.post('/plugins/:name/enable', async (request, reply) => {
    const { name } = request.params;
    if (!PLUGIN_NAME_RE.test(name)) {
      return reply.code(400).send({ error: 'Invalid plugin name' });
    }
    try {
      await enableAgentPlugin(label, name);
      // Restart panel service to mount newly enabled plugin routes.
      // The response is sent before the process exits — launchd/systemd
      // will restart the process with the updated registry.
      setTimeout(async () => {
        try {
          await unloadPanelService(label);
          await loadPanelService(label);
        } catch (err) {
          fastify.log.error({ err: err.message }, 'Failed to restart panel service');
        }
      }, 500);
      return { ok: true, name, status: 'enabled', restarting: true };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  fastify.post('/plugins/:name/disable', async (request, reply) => {
    const { name } = request.params;
    if (!PLUGIN_NAME_RE.test(name)) {
      return reply.code(400).send({ error: 'Invalid plugin name' });
    }
    try {
      await disableAgentPlugin(label, name);
      // Restart panel service to unmount disabled plugin routes.
      // Use setTimeout to flush the response before the process exits.
      setTimeout(async () => {
        try {
          await unloadPanelService(label);
          await loadPanelService(label);
        } catch (err) {
          fastify.log.error({ err: err.message }, 'Failed to restart panel service after disable');
        }
      }, 500);
      return { ok: true, name, status: 'disabled', restarting: true };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  fastify.delete('/plugins/:name', async (request, reply) => {
    const { name } = request.params;
    if (!PLUGIN_NAME_RE.test(name)) {
      return reply.code(400).send({ error: 'Invalid plugin name' });
    }
    try {
      await uninstallAgentPlugin(label, name);
      return { ok: true, name };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  fastify.post('/plugins/:name/update', async (request, reply) => {
    const { name } = request.params;
    if (!PLUGIN_NAME_RE.test(name)) {
      return reply.code(400).send({ error: 'Invalid plugin name' });
    }
    try {
      const plugin = await updateAgentPlugin(label, name);
      return { ok: true, plugin };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  fastify.get('/plugins/:name/check-update', async (request, reply) => {
    const { name } = request.params;
    if (!PLUGIN_NAME_RE.test(name)) {
      return reply.code(400).send({ error: 'Invalid plugin name' });
    }
    try {
      return await checkAgentPluginUpdate(label, name);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  fastify.get('/plugins/:name/bundle', async (request, reply) => {
    const { name } = request.params;
    if (!PLUGIN_NAME_RE.test(name)) {
      return reply.code(400).send({ error: 'Invalid plugin name' });
    }
    try {
      const source = await readAgentPluginBundle(label, name);
      return { source };
    } catch (err) {
      return reply.code(404).send({ error: err.message });
    }
  });
}
