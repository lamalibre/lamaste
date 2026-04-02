/**
 * Agent panel HTTP server.
 *
 * Serves the portlama-agent-panel SPA and a REST API implementing
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
import panelApiRoutes from './panel-api-routes.js';
import agentPluginRouter from './agent-plugin-router.js';
import { readAgentPluginBundle } from './agent-plugins.js';

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
    const needsAuth = request.url.startsWith('/api') ||
      /^\/[a-z0-9-]+\//.test(request.url);
    if (!needsAuth) return;

    const verify = request.headers['x-ssl-client-verify'];
    if (verify !== 'SUCCESS') {
      // Allow localhost browser requests (desktop app plugin microfrontends).
      // The server binds 127.0.0.1 only, so only local processes can reach it.
      // The Origin header is browser-enforced and cannot be forged by web pages.
      const origin = request.headers.origin || '';
      const isLocalOrigin =
        /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin) ||
        origin === 'tauri://localhost' ||
        origin === 'https://tauri.localhost';
      if (isLocalOrigin) {
        request.certCN = `agent:${label}`;
        request.certRole = 'agent';
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
      // mTLS (admin/agent cert) or localhost origin (desktop app).
      const remoteUser = request.headers['remote-user'];
      if (remoteUser) {
        // Validate username format (defense-in-depth against header injection)
        if (!/^[a-z0-9_.-]+$/i.test(remoteUser)) {
          return reply.code(403).send({ error: 'Invalid user identity' });
        }

        // Block access to /api/* management endpoints — Authelia users
        // may only access plugin routes (/{pluginName}/api/...)
        if (request.url.startsWith('/api')) {
          return reply.code(403).send({ error: 'Management API requires certificate authentication' });
        }

        request.certCN = `user:${remoteUser}`;
        request.certRole = 'user';
        request.autheliaUser = remoteUser;
        return;
      }

      return reply.code(403).send({ error: 'Valid mTLS certificate required' });
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
  });

  // --- Health check (no label to avoid info leakage) ---
  server.get('/api/health', async () => ({ status: 'ok' }));

  // --- REST API routes ---
  await server.register(panelApiRoutes, { prefix: '/api', label });

  // --- Agent plugin routes ---
  // Mounts enabled plugin server routes at /<name>/... (root level),
  // matching the local plugin host pattern that plugins expect.
  // Plugins construct URLs as ${panelUrl}/${pluginName}/api/${pluginName}/...
  await server.register(agentPluginRouter, { label });

  // --- Public plugin bundle endpoint (outside /api — no mTLS required) ---
  // Desktop app loads bundles via <script> tag to bypass Tauri IPC JSON size limits.
  // Script tags are not subject to CORS, so cross-origin loading works.
  const PLUGIN_NAME_RE = /^[a-z0-9-]+$/;
  server.get('/plugin-bundles/:name/panel.js', async (request, reply) => {
    const { name } = request.params;
    if (!PLUGIN_NAME_RE.test(name)) {
      reply.type('application/javascript');
      return reply.code(400).send('// invalid plugin name');
    }
    try {
      const source = await readAgentPluginBundle(label, name);
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
