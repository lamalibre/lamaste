/**
 * Agent panel HTTP server.
 *
 * Serves the lamaste-agent-ui SPA and a REST API implementing
 * the full AgentClient interface. Runs as a separate system service
 * from chisel, so the panel remains accessible even when tunnels are down.
 *
 * Authentication (lib/auth.js): the owner's Bearer token (agentd.token), or a
 * relay assertion the relay signs per request on the agent-panel vhost
 * (admin or this agent's certificate) and on plugin tunnels (an Authelia
 * user). Headers that only claim a caller (X-SSL-Client-*, Remote-*) are
 * never trusted: this port, and the tunnel's port on the relay, can be
 * reached without going through nginx.
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
import { agentdTokenPath, loadOrCreateAgentdToken } from './lib/agentd-token.js';
import { loadCapabilities } from './lib/capability-cache.js';
import { createAuthHook, PUBLIC_ROUTE } from './lib/auth.js';
import { createRelayVerifier } from './lib/relay-verifier.js';
import { loadAgentConfig } from '@lamalibre/lamaste/agent';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Start the agent panel HTTP server.
 *
 * @param {string} label - Agent label (the audience of relay assertions, and API routing)
 * @param {{ port?: number, panelApi?: ReturnType<typeof createPanelApiClient> }} [options]
 *        `panelApi` replaces the mTLS client of the panel (tests pass a stand-in).
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function startPanelServer(label, { port = 9393, panelApi: panelApiOverride } = {}) {
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
  // Constructed before the auth hook: it fetches the relay's verification
  // keys and, for this agent's own certificate, its capabilities.
  const panelApi = panelApiOverride ?? createPanelApiClient(label);

  // --- Authentication (see lib/auth.js) ---
  // Plugins are mounted once, at startup (enable/disable restart the daemon),
  // so the installed names read here are the prefixes plugin code may answer.
  const registryPath = agentPluginsFile(label);
  const pluginNames = new Set(
    (await readPluginRegistry(registryPath)).plugins.map((plugin) => plugin.name),
  );
  const relayVerifier = createRelayVerifier({
    port,
    logger: server.log,
    fetchKeys: async () => {
      const agentConfig = await loadAgentConfig(label);
      if (!agentConfig) throw new Error('Agent not configured');
      return panelApi.fetchRelayKeys(agentConfig);
    },
  });

  // Revocation: the relay's panel refuses a revoked certificate before it
  // signs an assertion for it, so a revoked admin or agent certificate no
  // longer reaches this daemon through the agent-panel vhost.
  server.addHook(
    'onRequest',
    createAuthHook({
      label,
      agentdToken,
      relayVerifier,
      pluginNames,
      loadAgentCapabilities: async (request) => {
        // Capabilities come from the panel (the canonical source), cached
        // for 60 seconds. Any failure denies (503); the cache helper logs
        // the underlying error and the response stays generic.
        let agentConfig;
        try {
          agentConfig = await loadAgentConfig(label);
        } catch (err) {
          request.log.warn(
            { errMsg: String(err?.message ?? '') },
            'Failed to load agent config for capability fetch',
          );
          return { ok: false, error: 'Capability check temporarily unavailable' };
        }
        if (!agentConfig) {
          // Not fully provisioned — block rather than silently allow.
          return { ok: false, error: 'Agent not configured' };
        }
        const result = await loadCapabilities(
          label,
          () => panelApi.fetchSelfCapabilities(agentConfig),
          request.log,
        );
        if (!result) return { ok: false, error: 'Capability check temporarily unavailable' };
        return { ok: true, capabilities: result.capabilities, allowedSites: result.allowedSites };
      },
    }),
  );

  // --- Health check (no label to avoid info leakage) ---
  // Empty `rateLimit: {}` opts the route into the globally-registered limiter
  // and satisfies the CodeQL js/missing-rate-limiting dataflow.
  server.get('/api/health', { config: { rateLimit: {}, [PUBLIC_ROUTE]: true } }, async () => ({
    status: 'ok',
  }));

  // --- REST API routes ---
  await server.register(routes, { prefix: '/api', label, panelApi });

  // --- Agent plugin routes (unified plugin host) ---
  // Mounts enabled plugin server routes at /<name>/... (root level),
  // matching the local plugin host pattern that plugins expect.
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
  server.get(
    '/plugin-bundles/:name/panel.js',
    { config: { rateLimit: {}, [PUBLIC_ROUTE]: true } },
    async (request, reply) => {
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
    },
  );

  // --- Static SPA files ---
  // Public, and nothing else is: the files are registered in a scope of
  // their own whose onRoute hook marks exactly its routes. The root
  // registration only gives the SPA fallback below `reply.sendFile`.
  const staticRoot = path.resolve(__dirname, '..', 'panel-dist');
  try {
    await server.register(fastifyStatic, { root: staticRoot, serve: false });
    await server.register(async function spaFiles(scope) {
      scope.addHook('onRoute', (routeOptions) => {
        routeOptions.config = { ...routeOptions.config, [PUBLIC_ROUTE]: true };
      });
      await scope.register(fastifyStatic, {
        root: staticRoot,
        prefix: '/',
        wildcard: false,
        decorateReply: false,
      });
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
