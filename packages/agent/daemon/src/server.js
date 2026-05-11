/**
 * Agent panel HTTP server.
 *
 * Serves the lamaste-agent-ui SPA and a REST API implementing
 * the full AgentClient interface. Runs as a separate system service
 * from chisel, so the panel remains accessible even when tunnels are down.
 *
 * Authentication: nginx terminates mTLS upstream and passes client cert
 * headers (X-SSL-Client-Verify, X-SSL-Client-DN). This server validates
 * that the cert belongs to the owning agent or an admin.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pluginHostPlugin } from '@lamalibre/lamaste';
import {
  agentDataDir,
  agentPluginsDir,
  agentPluginsFile,
  readPluginRegistry,
  readPluginBundle,
} from '@lamalibre/lamaste/agent';

import routes from './routes.js';
import { createPanelApiClient } from './panel-api.js';
import {
  agentdTokenPath,
  loadOrCreateAgentdToken,
  verifyAgentdToken,
  extractBearerToken,
} from './lib/agentd-token.js';
import { loadCapabilities } from './lib/capability-cache.js';
import { loadAgentConfig } from '@lamalibre/lamaste/agent';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Start the agent panel HTTP server.
 *
 * @param {string} label - Agent label (used for cert CN validation and API routing)
 * @param {{ port?: number }} [options]
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function startPanelServer(label, { port = 9393 } = {}) {
  const server = Fastify({
    logger: {
      level: 'info',
    },
  });

  // --- Load (or generate) the per-user filesystem auth token ---
  // The token gates loopback callers — local processes that present a valid
  // Bearer token are treated as the agent's owning user. The file is
  // mode 0600 in ~/.lamalibre/lamaste/, so only the user can read it. The token value
  // is never logged; we surface only the path for operator diagnostics.
  const agentdToken = await loadOrCreateAgentdToken();
  server.log.info({ tokenPath: agentdTokenPath() }, 'Loaded agentd auth token');

  // Allow Tauri webview and localhost origins to call plugin APIs.
  // credentials: true is required because plugin microfrontends use
  // fetch(..., { credentials: 'include' }) for session cookies.
  await server.register(cors, {
    origin: [
      'tauri://localhost',
      'https://tauri.localhost',
      /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/,
    ],
    credentials: true,
  });

  await server.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // --- Panel API client (mTLS proxy to panel server) ---
  // Constructed before the auth hook so the hook can use it to fetch
  // capabilities from the panel for non-Bearer mTLS callers.
  const panelApi = createPanelApiClient(label);

  // --- mTLS validation middleware ---
  // nginx sets X-SSL-Client-Verify, X-SSL-Client-DN, and X-SSL-Client-Serial
  // after TLS handshake. We validate the CN and check revocation.
  //
  // Revocation note: The agent panel runs on the agent machine, not the server.
  // It cannot directly read the server-side revoked.json. A compromised cert
  // that has been revoked server-side will still be accepted here until the
  // panel tunnel is retracted. The primary defense is revoking the cert on the
  // panel server (which blocks API calls the agent panel proxies) and retracting
  // the panel tunnel (which removes the nginx vhost).
  server.addHook('onRequest', async (request, reply) => {
    // Allow health check without auth
    if (request.url === '/api/health') return;

    // Plugin bundles are intentionally public (loaded via <script> tag)
    if (request.url.startsWith('/plugin-bundles/')) return;

    // Auth is required for /api/* management routes AND all plugin routes
    // (/<pluginName>/..., including non-/api/ sub-paths). Static assets (SPA
    // files served by fastify-static from root) don't need auth.
    const needsAuth = request.url.startsWith('/api') || /^\/[a-z0-9-]+\//.test(request.url);
    if (!needsAuth) return;

    const verify = request.headers['x-ssl-client-verify'];
    if (verify !== 'SUCCESS') {
      // Loopback caller authentication — Bearer token from ~/.lamalibre/lamaste/agentd.token.
      //
      // The previous implementation accepted any localhost-like Origin header
      // as proof of being the agent owner. That trusts a header that any local
      // OS user can forge with curl, allowing privilege escalation on shared
      // hosts. The Bearer token replaces it: only processes that can read the
      // mode-0600 token file (the agent's owning user) can authenticate.
      const presented = extractBearerToken(request.headers.authorization);
      if (presented && verifyAgentdToken(presented, agentdToken)) {
        // Token authenticates "you are this user". The daemon serves a single
        // label, so attribute the call to that label. The owning OS user has
        // full access by definition (they own the agent's filesystem) — null
        // means "all capabilities" to requireCap.
        request.certCN = `agent:${label}`;
        request.certRole = 'agent';
        request.certLabel = label;
        request.certCapabilities = null;
        request.certAllowedSites = null;
        return;
      }

      // Authelia-authenticated user (plugin tunnel access).
      // When nginx routes through an Authelia-protected plugin vhost,
      // Remote-User is set after successful Authelia forward auth. The header
      // is cleared then re-injected by nginx — cannot be forged from outside.
      // Port 9393 binds 127.0.0.1, so external traffic only arrives via nginx.
      //
      // Authelia users are restricted to plugin routes only (/{pluginName}/...).
      // They must NOT access agent management API (/api/*) — those require
      // mTLS (admin/agent cert) or a valid Bearer token (desktop app).
      const remoteUser = request.headers['remote-user'];
      if (remoteUser) {
        // Validate username format (defense-in-depth against header injection)
        if (!/^[a-z0-9_.-]+$/i.test(remoteUser)) {
          return reply.code(403).send({ error: 'Invalid user identity' });
        }

        // Block access to /api/* management endpoints — Authelia users
        // may only access plugin routes (/{pluginName}/api/...)
        if (request.url.startsWith('/api')) {
          return reply
            .code(403)
            .send({ error: 'Management API requires certificate authentication' });
        }

        request.certCN = `user:${remoteUser}`;
        request.certRole = 'user';
        request.autheliaUser = remoteUser;
        // Authelia users only reach plugin routes (the management /api/*
        // path is rejected above). Plugin authorization is gated upstream
        // by gatekeeper grants — no agent-side capability check applies.
        request.certCapabilities = [];
        request.certAllowedSites = null;
        return;
      }

      // No usable credential. Return 401 with a generic message — do not
      // disclose which auth paths exist.
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const dn = request.headers['x-ssl-client-dn'] || '';
    const cnMatch = dn.match(/CN=([^,/]+)/);
    const cn = cnMatch ? cnMatch[1] : '';

    // Allow: this agent's cert or admin cert only
    const isOwner = cn === `agent:${label}`;
    const isAdmin = cn === 'admin';

    if (!isOwner && !isAdmin) {
      return reply.code(403).send({ error: 'Certificate not authorized for this agent panel' });
    }

    request.certCN = cn;
    request.certRole = isAdmin ? 'admin' : 'agent';
    request.certLabel = isOwner ? label : null;

    if (isAdmin) {
      // Admin cert is the master key — full access, no capability check.
      request.certCapabilities = null;
      request.certAllowedSites = null;
      return;
    }

    // Agent cert: fetch capabilities from the panel server (the canonical
    // source) and cache for 60 seconds. On panel-fetch failure we deny
    // (return 503) — never default to allow. The cache helper logs the
    // underlying error; the response stays generic.
    let agentConfig;
    try {
      agentConfig = await loadAgentConfig(label);
    } catch (err) {
      request.log.warn(
        { errMsg: String(err?.message ?? '') },
        'Failed to load agent config for capability fetch',
      );
      return reply.code(503).send({ error: 'Capability check temporarily unavailable' });
    }
    if (!agentConfig) {
      // No config means the agent isn't fully provisioned — block access
      // rather than silently allow.
      return reply.code(503).send({ error: 'Agent not configured' });
    }

    const result = await loadCapabilities(
      label,
      () => panelApi.fetchSelfCapabilities(agentConfig),
      request.log,
    );
    if (!result) {
      return reply.code(503).send({ error: 'Capability check temporarily unavailable' });
    }
    request.certCapabilities = result.capabilities;
    request.certAllowedSites = result.allowedSites;
  });

  // --- Health check (no label to avoid info leakage) ---
  server.get('/api/health', async () => ({ status: 'ok' }));

  // --- REST API routes ---
  await server.register(routes, { prefix: '/api', label, panelApi });

  // --- Agent plugin routes (unified plugin host) ---
  // Mounts enabled plugin server routes at /<name>/... (root level),
  // matching the local plugin host pattern that plugins expect.
  const registryPath = agentPluginsFile(label);
  await server.register(pluginHostPlugin, {
    baseDir: agentDataDir(label),
    pluginsDataDir: agentPluginsDir(label),
    readRegistry: () => readPluginRegistry(registryPath),
    auth: 'inherit',
    reservedPrefixes: new Set(['install']),

    /**
     * Forward the owning agent's identity and outbound mTLS material to
     * each hosted plugin. Plugins whose server side lives inside
     * lamaste-serverd (e.g. rodeo-serverd) need this to call back to
     * their own server plugin over lamaste's mTLS gate while presenting
     * the agent's `plugin-agent:<label>` cert.
     *
     * Forwarded fields:
     *   - `runnerLabel`              — this daemon's agent label
     *   - `serverUrl`                — panel URL from the agent config
     *   - `caCertPath`               — ~/.lamalibre/lamaste/agents/<label>/ca.crt
     *   - `clientP12Path`            — ~/.lamalibre/lamaste/agents/<label>/client.p12
     *   - `clientP12PasswordEnvVar`  — env var name holding the P12 password;
     *                                  we set it here before returning so the
     *                                  hosted plugin can read it at mount time.
     *
     * Only P12-auth agents (the default enrollment path) can host plugins
     * today. Agents enrolled via the macOS Keychain path (`authMethod:
     * 'keychain'`) do not expose a file-backed P12 + password pair; their
     * plugins will surface a clear error at mount time until the keychain
     * flow is wired up in a follow-up wave.
     */
    resolvePluginOptions: async (plugin, logger) => {
      const agentConfig = await loadAgentConfig(label);
      if (!agentConfig) {
        logger.warn(
          { plugin: plugin.name, label },
          'Agent config missing — hosting plugin without runner context',
        );
        return {};
      }

      const base = {
        runnerLabel: label,
        serverUrl: agentConfig.panelUrl,
        caCertPath: path.join(agentDataDir(label), 'ca.crt'),
      };

      if (agentConfig.authMethod === 'keychain') {
        // Surface the gap to operator logs, but still forward the
        // non-credential fields so the plugin can boot and emit its own
        // detailed error when it reaches the mTLS-require code path.
        logger.warn(
          { plugin: plugin.name, label },
          'Agent uses keychain auth — plugin mTLS not yet forwardable; plugin may fail to authenticate',
        );
        return base;
      }

      // Default enrollment path: P12 on disk + password in agent config.
      if (!agentConfig.p12Path || !agentConfig.p12Password) {
        logger.warn(
          { plugin: plugin.name, label, hasP12: Boolean(agentConfig.p12Path) },
          'Agent config missing P12 material — plugin mTLS context incomplete',
        );
        return base;
      }

      // Env var name is derived from the plugin name (lowercase a-z0-9-
      // per the plugin-host's own name pattern). Scope the variable to
      // this plugin so one hosted plugin cannot read another plugin's
      // password from the shared process env.
      const normalized = plugin.name.replace(/-/g, '_').toUpperCase();
      const envVarName = `LAMALIBRE_LAMASTE_AGENT_PLUGIN_P12_PASSWORD_${normalized}`;
      process.env[envVarName] = agentConfig.p12Password;

      return {
        ...base,
        clientP12Path: agentConfig.p12Path,
        clientP12PasswordEnvVar: envVarName,
      };
    },
  });

  // --- Public plugin bundle endpoint (outside /api — no mTLS required) ---
  // Desktop app loads bundles via <script> tag to bypass Tauri IPC JSON size limits.
  const PLUGIN_NAME_RE = /^[a-z0-9-]+$/;
  const pluginCfg = {
    dataDir: agentDataDir(label),
    registryPath,
    pluginsDir: agentPluginsDir(label),
    requiredMode: 'agent',
    maxPlugins: 20,
  };
  server.get('/plugin-bundles/:name/panel.js', async (request, reply) => {
    const { name } = request.params;
    if (!PLUGIN_NAME_RE.test(name)) {
      reply.type('application/javascript');
      return reply.code(400).send('// invalid plugin name');
    }
    try {
      const source = await readPluginBundle(pluginCfg, name);
      reply.type('application/javascript');
      reply.header('Cache-Control', 'public, max-age=3600');
      return source;
    } catch {
      reply.type('application/javascript');
      return reply.code(404).send(`// plugin bundle not found: ${name}`);
    }
  });

  // --- Static SPA files ---
  const staticRoot = path.resolve(__dirname, '..', 'panel-dist');
  try {
    await server.register(fastifyStatic, {
      root: staticRoot,
      prefix: '/',
      wildcard: false,
    });
  } catch (err) {
    server.log.warn(
      { err, staticRoot },
      'Failed to register static file serving — SPA may not be built',
    );
  }

  // --- SPA fallback for client-side routing ---
  server.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });

  await server.listen({ host: '127.0.0.1', port });
  server.log.info({ label, port }, 'Agent panel server started');

  return server;
}
