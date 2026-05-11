import { z } from 'zod';
import { getConfig } from '../lib/config.js';
import { ensureSessionSecret } from '../lib/session.js';
import { createUserSession } from '../lib/user-access-session.js';
import {
  createGrant,
  listGrants,
  revokeGrant,
  listGrantsForUser,
  consumeGrant,
  createOTP,
  validateAndConsumeOTP,
} from '../lib/user-access.js';
import { createEnrollmentToken } from '../lib/enrollment.js';
import { readPlugins } from '../lib/plugins.js';
import { readTunnels } from '../lib/state.js';

// --- Zod schemas ---

const CreateGrantSchema = z.object({
  username: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Invalid username format'),
  pluginName: z
    .string()
    .min(1)
    .max(200)
    .regex(/^@lamalibre\//, 'Plugin must be @lamalibre/ scoped'),
  target: z
    .string()
    .regex(
      /^(local|agent:[a-z0-9][a-z0-9-]*)$/,
      'Target must be "local" or "agent:<label>"',
    )
    .optional()
    .default('local'),
});

const GrantIdParamSchema = z.object({
  grantId: z.string().uuid('Invalid grant ID format'),
});

const ExchangeBodySchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid token format'),
  // PKCE verifier: 32–64 base64url chars (256–384 bits of entropy). The
  // panel hashes this and timing-safe-compares against the stored S256
  // challenge submitted at /authorize.
  verifier: z
    .string()
    .regex(/^[A-Za-z0-9_-]{32,64}$/, 'Invalid verifier format'),
});

// PKCE handshake parameters submitted by the desktop at /authorize.
const AuthorizeQuerySchema = z.object({
  // base64url SHA-256 → 43 chars, no padding (PKCE S256, RFC 7636).
  challenge: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid PKCE challenge'),
  // 16 random bytes hex-encoded → 32 chars.
  nonce: z.string().regex(/^[a-f0-9]{32}$/, 'Invalid nonce'),
});

const EnrollBodySchema = z.object({
  grantId: z.string().uuid('Invalid grant ID format'),
});

// In-memory failed-exchange counter (per-process, resets on restart).
// Defense-in-depth: log a warning every N failures so an operator notices a
// scripted attacker exhausting the OTP keyspace. Cap is intentionally tiny —
// the OTP itself is 256 bits of entropy + bound to a verifier.
const FAILURE_LOG_INTERVAL = 10;
let exchangeFailureCount = 0;

// --- Admin routes (mTLS + roleGuard) ---

/**
 * Admin grant management routes.
 * Registered inside the protectedContext (mTLS + roleGuard).
 */
export async function userAccessAdminRoutes(fastify, _opts) {
  // GET /api/user-access/grants — list all grants
  fastify.get(
    '/user-access/grants',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      try {
        const grants = await listGrants();
        return { grants };
      } catch (err) {
        request.log.error(err, 'Failed to list user access grants');
        return reply.code(500).send({ error: 'Failed to list grants' });
      }
    },
  );

  // POST /api/user-access/grants — create a grant
  fastify.post(
    '/user-access/grants',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      let body;
      try {
        body = CreateGrantSchema.parse(request.body);
      } catch (err) {
        return reply.code(400).send({ error: err.errors?.[0]?.message || 'Invalid request body' });
      }

      try {
        const grant = await createGrant(body.username, body.pluginName, request.log, {
          target: body.target,
        });

        return { ok: true, grant };
      } catch (err) {
        request.log.error(err, 'Failed to create user access grant');
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message || 'Failed to create grant' });
      }
    },
  );

  // DELETE /api/user-access/grants/:grantId — revoke a grant
  fastify.delete(
    '/user-access/grants/:grantId',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      let params;
      try {
        params = GrantIdParamSchema.parse(request.params);
      } catch (err) {
        return reply.code(400).send({ error: err.errors?.[0]?.message || 'Invalid grant ID' });
      }

      try {
        await revokeGrant(params.grantId, request.log);

        return { ok: true };
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message || 'Failed to revoke grant' });
      }
    },
  );
}

// --- Public routes (no mTLS) ---

/**
 * Public user-access routes for the OAuth-like auth flow.
 * Registered in the publicContext (no mTLS required).
 */
export async function userAccessPublicRoutes(fastify, _opts) {
  // GET /authorize — Authelia-protected, generates OTP bound to a PKCE
  // challenge, redirects to deep link with the OTP and nonce in the URL
  // FRAGMENT (#). Fragments are not sent to servers, not stored in most OS
  // URL handler logs, and stripped from third-party referrer chains — they
  // are the right transport for short-lived secrets in a redirect URL.
  fastify.get('/authorize', async (request, reply) => {
    const config = getConfig();

    // Remote-User header is set by nginx after Authelia forward auth succeeds
    const username = request.headers['remote-user'];
    if (!username) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    let query;
    try {
      query = AuthorizeQuerySchema.parse(request.query);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err.errors?.[0]?.message || 'Invalid authorize parameters' });
    }

    try {
      const domain = config.domain;
      if (!domain) {
        return reply.code(503).send({ error: 'Server domain not configured' });
      }

      const { token, nonce } = await createOTP(
        username,
        { challenge: query.challenge, nonce: query.nonce },
        request.log,
      );

      // Deep-link callback. The OS-registered scheme is `lamalibre://`
      // (ecosystem-level — shared across all Lamalibre products); the
      // `product=lamaste` query param tells the desktop's scheme dispatcher
      // which product the callback is for. Future products (herd, shell,
      // etc.) will reuse the single scheme with their own `product=` value.
      //
      // The OTP token, domain, and nonce stay in the URL fragment (after #)
      // so the auth proxy never sees them. Authelia and any HTTP server in
      // the chain only see path/query; fragments are kept by the user-agent.
      // Putting the token in the query string would leak it to nginx access
      // logs.
      const callbackUrl =
        `lamalibre://callback?product=lamaste` +
        `#token=${encodeURIComponent(token)}` +
        `&domain=${encodeURIComponent(domain)}` +
        `&nonce=${encodeURIComponent(nonce)}`;
      return reply.redirect(callbackUrl, 302);
    } catch (err) {
      const statusCode = err.statusCode || 500;
      const message = statusCode < 500 ? err.message : 'Authorization failed';
      request.log.error(err, 'Failed to create user access OTP');
      return reply.code(statusCode).send({ error: message });
    }
  });

  // POST /exchange — exchange OTP + PKCE verifier for a user session token.
  // The verifier proves possession of the desktop process that initiated
  // /authorize. A malicious local app that intercepts the deep link has the
  // OTP but NOT the verifier, so this call fails with the same generic error
  // as any other invalid-OTP path (no information leakage).
  fastify.post('/exchange', async (request, reply) => {
    let body;
    try {
      body = ExchangeBodySchema.parse(request.body);
    } catch {
      // Treat shape errors the same as auth failures — no leak about which
      // field was missing or malformed.
      exchangeFailureCount += 1;
      if (exchangeFailureCount % FAILURE_LOG_INTERVAL === 0) {
        request.log.warn(
          { count: exchangeFailureCount },
          'user-access /exchange repeated failures — possible brute force',
        );
      }
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    try {
      const { username } = await validateAndConsumeOTP(body.token, body.verifier);
      const sessionSecret = await ensureSessionSecret();
      const session = createUserSession(sessionSecret, username);

      return {
        ok: true,
        sessionToken: session.value,
        username,
        expiresAt: session.expiresAt,
      };
    } catch (err) {
      exchangeFailureCount += 1;
      if (exchangeFailureCount % FAILURE_LOG_INTERVAL === 0) {
        request.log.warn(
          { count: exchangeFailureCount },
          'user-access /exchange repeated failures — possible brute force',
        );
      }
      // Use generic error message (no information leakage)
      const statusCode = err.statusCode || 401;
      return reply.code(statusCode).send({ error: 'Invalid or expired token' });
    }
  });
}

// --- User-session-protected routes ---

/**
 * Routes accessible to authenticated Authelia users via Bearer session token.
 * Registered with user-access-session middleware.
 */
export async function userAccessProtectedRoutes(fastify, _opts) {
  // GET /plugins — list granted plugins for the authenticated user
  fastify.get('/plugins', async (request, reply) => {
    const username = request.userAccessUsername;

    try {
      const grants = await listGrantsForUser(username);

      // Enrich with plugin metadata where available
      let plugins = [];
      try {
        const registry = await readPlugins();
        plugins = registry.plugins || [];
      } catch {
        // Plugin registry may not exist — proceed with grants only
      }

      const pluginMap = new Map();
      for (const p of plugins) {
        pluginMap.set(p.packageName, p);
      }

      // Load tunnels for agent-side grant enrichment
      let tunnels = [];
      try {
        tunnels = await readTunnels();
      } catch {
        // Tunnel state may not exist — proceed without tunnel info
      }

      const enrichedGrants = grants.map((g) => {
        const plugin = pluginMap.get(g.pluginName);
        const pluginMeta = plugin
          ? {
              name: plugin.name,
              displayName: plugin.displayName || plugin.name,
              description: plugin.description,
              version: plugin.version,
            }
          : null;

        const target = g.target || 'local';

        if (target.startsWith('agent:')) {
          const agentLabel = target.slice('agent:'.length);
          const tunnel = tunnels.find(
            (t) =>
              t.type === 'plugin' &&
              t.agentLabel === agentLabel &&
              t.pluginName === g.pluginName,
          );
          return {
            ...g,
            target,
            agentLabel,
            tunnelUrl: tunnel ? `https://${tunnel.fqdn}` : null,
            tunnelEnabled: tunnel?.enabled ?? false,
            plugin: pluginMeta,
          };
        }

        return {
          ...g,
          target,
          plugin: pluginMeta,
        };
      });

      return { grants: enrichedGrants };
    } catch (err) {
      request.log.error(err, 'Failed to list user plugins');
      return reply.code(500).send({ error: 'Failed to list plugins' });
    }
  });

  // POST /enroll — consume a grant and generate an enrollment token
  fastify.post('/enroll', async (request, reply) => {
    const username = request.userAccessUsername;

    let body;
    try {
      body = EnrollBodySchema.parse(request.body);
    } catch {
      return reply.code(400).send({ error: 'Invalid request' });
    }

    try {
      // Agent-side grants do not require enrollment — they provide browser access
      const allGrants = await listGrantsForUser(username);
      const targetGrant = allGrants.find((g) => g.grantId === body.grantId);
      if (targetGrant && (targetGrant.target || 'local').startsWith('agent:')) {
        return reply.code(400).send({ error: 'Agent-side grants do not require enrollment' });
      }

      // Consume the grant (validates ownership and single-use)
      const grant = await consumeGrant(body.grantId, username, request.log);

      // Generate an enrollment token for a new agent
      // Label is auto-generated from username + plugin short name.
      // Underscores in usernames are replaced with hyphens to match agent label format
      // (signCSR validates labels against /^[a-z0-9][a-z0-9-]*$/).
      const pluginShortName = grant.pluginName.replace(/^@lamalibre\//, '').replace(/-server$/, '');
      const sanitizedUsername = username.replace(/_/g, '-');
      const label = `${sanitizedUsername}-${pluginShortName}`;

      // Default capabilities for user-enrolled agents
      const capabilities = ['tunnels:read', 'services:read', 'system:read'];

      const tokenData = await createEnrollmentToken(label, capabilities, [], request.log);

      return {
        ok: true,
        enrollmentToken: tokenData.token,
        label: tokenData.label,
        expiresAt: tokenData.expiresAt,
        pluginName: grant.pluginName,
      };
    } catch (err) {
      const statusCode = err.statusCode || 500;
      const message = statusCode < 500 ? err.message : 'Enrollment failed';
      return reply.code(statusCode).send({ error: message });
    }
  });
}
