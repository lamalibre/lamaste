import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.js';
import mtlsMiddleware from './middleware/mtls.js';
import twofaSession from './middleware/twofa-session.js';
import roleGuard from './middleware/role-guard.js';
import errorHandler from './middleware/errors.js';
import healthRoutes from './routes/health.js';
import onboardingRoutes from './routes/onboarding/index.js';
import managementRoutes from './routes/management.js';
import pluginRouter from './routes/plugin-router.js';
import inviteRoutes from './routes/invite.js';
import enrollmentRoutes from './routes/enrollment.js';
import { getPluginCapabilities } from './lib/plugins.js';
import { setPluginCapabilities } from './lib/mtls.js';
import {
  loadTicketScopeCapabilities,
  checkInstanceLiveness,
  clearRateLimitInterval,
} from './lib/tickets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';

async function start() {
  const config = await loadConfig();

  // Load plugin capabilities at startup so agent cert validation includes them
  try {
    const pluginCaps = await getPluginCapabilities();
    setPluginCapabilities(pluginCaps);
  } catch {
    // Plugin registry may not exist yet — ignore on first boot
  }

  // Load ticket scope capabilities so they are included in valid capabilities
  try {
    await loadTicketScopeCapabilities();
  } catch {
    // Ticket scope registry may not exist yet — ignore on first boot
  }

  const server = Fastify({
    logger: true,
    // Behind nginx: trust exactly one proxy hop so request.ip reflects the real client IP
    // from nginx's $remote_addr, not a spoofed X-Forwarded-For value from upstream.
    trustProxy: 1,
  });

  // --- Plugins ---
  const ipOrigin = `https://${config.ip}:9292`;
  await server.register(cors, {
    origin: config.domain ? [ipOrigin, `https://panel.${config.domain}`] : ipOrigin,
  });
  await server.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB per file
    },
  });
  await server.register(cookie);
  await server.register(websocket);
  await server.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // Resolve static file root for the panel client SPA
  let staticRoot;
  if (config.staticDir) {
    staticRoot = config.staticDir;
  } else if (isDev) {
    staticRoot = path.resolve(__dirname, '..', '..', 'panel-client', 'dist');
  } else {
    staticRoot = path.join(config.dataDir, 'panel-client', 'dist');
  }

  await server.register(fastifyStatic, {
    root: staticRoot,
    prefix: '/',
    wildcard: false,
    decorateReply: true,
  });

  // --- Public API routes (no mTLS) ---
  server.register(async function publicContext(app) {
    app.register(errorHandler);
    app.register(inviteRoutes, { prefix: '/api/invite' });
    app.register(enrollmentRoutes, { prefix: '/api/enroll' });
  });

  // --- Protected routes (mTLS + onboarding guard) ---
  server.register(async function protectedContext(app) {
    app.register(mtlsMiddleware);
    app.register(twofaSession);
    app.register(roleGuard);
    app.register(errorHandler);
    app.register(healthRoutes, { prefix: '/api' });
    app.register(onboardingRoutes, { prefix: '/api/onboarding' });
    app.register(managementRoutes, { prefix: '/api' });
    app.register(pluginRouter, { prefix: '/api' });
  });

  // --- SPA fallback ---
  server.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });

  // --- Start ---
  await server.listen({ host: '127.0.0.1', port: 3100 });

  // --- Periodic ticket instance liveness check (every 60s) ---
  const livenessInterval = setInterval(() => {
    checkInstanceLiveness(server.log).catch((err) => {
      server.log.warn({ err }, 'Instance liveness check failed');
    });
  }, 60_000);
  livenessInterval.unref();

  // --- Graceful shutdown ---
  const shutdown = async (signal) => {
    server.log.info({ signal }, 'Received signal, shutting down gracefully');
    clearInterval(livenessInterval);
    clearRateLimitInterval();
    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
