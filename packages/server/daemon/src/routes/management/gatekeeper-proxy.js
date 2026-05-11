/**
 * Proxy routes for Gatekeeper API.
 *
 * These routes forward requests from lamaste-serverd's mTLS-protected
 * /api/gatekeeper/* path to the Gatekeeper service on 127.0.0.1:9294.
 * This allows the desktop app (and web panel) to reach Gatekeeper on
 * remote servers through the existing mTLS tunnel — no additional port
 * forwarding needed.
 *
 * Admin-only (lamaste-serverd's mTLS + roleGuard protect these routes).
 */

import { gatekeeperRequest } from '../../lib/gatekeeper-client.js';

export default async function gatekeeperProxyRoutes(fastify, _opts) {
  // All gatekeeper management routes are admin-only
  fastify.addHook('preHandler', fastify.requireRole(['admin']));

  /**
   * Forward to gatekeeper via the shared client (which reads the secret
   * from either `gatekeeper-secret.json` or the legacy plain-text file).
   * Normalises the response to the proxy's historical shape.
   */
  const proxy = async (method, gatekeeperPath, body) => {
    const result = await gatekeeperRequest(method, gatekeeperPath, body);
    if (result.ok) {
      return { statusCode: result.statusCode, data: result.data };
    }
    return {
      statusCode: result.statusCode,
      data: { error: result.error },
    };
  };

  // --- Groups ---

  fastify.get('/gatekeeper/groups', async (_request, reply) => {
    const { statusCode, data } = await proxy('GET', '/api/groups');
    return reply.code(statusCode).send(data);
  });

  fastify.post('/gatekeeper/groups', async (request, reply) => {
    const { statusCode, data } = await proxy('POST', '/api/groups', request.body);
    return reply.code(statusCode).send(data);
  });

  fastify.get('/gatekeeper/groups/:name', async (request, reply) => {
    const { name } = request.params;
    const { statusCode, data } = await proxy('GET', `/api/groups/${encodeURIComponent(name)}`);
    return reply.code(statusCode).send(data);
  });

  fastify.patch('/gatekeeper/groups/:name', async (request, reply) => {
    const { name } = request.params;
    const { statusCode, data } = await proxy('PATCH', `/api/groups/${encodeURIComponent(name)}`, request.body);
    return reply.code(statusCode).send(data);
  });

  fastify.delete('/gatekeeper/groups/:name', async (request, reply) => {
    const { name } = request.params;
    const { statusCode, data } = await proxy('DELETE', `/api/groups/${encodeURIComponent(name)}`);
    return reply.code(statusCode).send(data);
  });

  fastify.post('/gatekeeper/groups/:name/members', async (request, reply) => {
    const { name } = request.params;
    const { statusCode, data } = await proxy('POST', `/api/groups/${encodeURIComponent(name)}/members`, request.body);
    return reply.code(statusCode).send(data);
  });

  fastify.delete('/gatekeeper/groups/:name/members/:username', async (request, reply) => {
    const { name, username } = request.params;
    const { statusCode, data } = await proxy('DELETE', `/api/groups/${encodeURIComponent(name)}/members/${encodeURIComponent(username)}`);
    return reply.code(statusCode).send(data);
  });

  // --- Grants ---

  fastify.get('/gatekeeper/grants', async (request, reply) => {
    const qs = new URLSearchParams(request.query).toString();
    const grantPath = qs ? `/api/grants?${qs}` : '/api/grants';
    const { statusCode, data } = await proxy('GET', grantPath);
    return reply.code(statusCode).send(data);
  });

  fastify.post('/gatekeeper/grants', async (request, reply) => {
    const { statusCode, data } = await proxy('POST', '/api/grants', request.body);
    return reply.code(statusCode).send(data);
  });

  fastify.get('/gatekeeper/grants/:grantId', async (request, reply) => {
    const { grantId } = request.params;
    const { statusCode, data } = await proxy('GET', `/api/grants/${encodeURIComponent(grantId)}`);
    return reply.code(statusCode).send(data);
  });

  fastify.delete('/gatekeeper/grants/:grantId', async (request, reply) => {
    const { grantId } = request.params;
    const { statusCode, data } = await proxy('DELETE', `/api/grants/${encodeURIComponent(grantId)}`);
    return reply.code(statusCode).send(data);
  });

  // Bulk-revoke every grant for a principal. Forwarded to gatekeeper as
  // DELETE /api/grants?principalType=...&principalId=...
  fastify.delete('/gatekeeper/grants', async (request, reply) => {
    const qs = new URLSearchParams(request.query).toString();
    const grantPath = qs ? `/api/grants?${qs}` : '/api/grants';
    const { statusCode, data } = await proxy('DELETE', grantPath);
    return reply.code(statusCode).send(data);
  });

  // --- Diagnostics / Settings / Cache ---

  fastify.get('/gatekeeper/access/check', async (request, reply) => {
    const qs = new URLSearchParams(request.query).toString();
    const { statusCode, data } = await proxy('GET', `/api/access/check?${qs}`);
    return reply.code(statusCode).send(data);
  });

  fastify.post('/gatekeeper/cache/bust', async (_request, reply) => {
    const { statusCode, data } = await proxy('POST', '/api/cache/bust');
    return reply.code(statusCode).send(data);
  });

  fastify.get('/gatekeeper/settings', async (_request, reply) => {
    const { statusCode, data } = await proxy('GET', '/api/settings');
    return reply.code(statusCode).send(data);
  });

  fastify.patch('/gatekeeper/settings', async (request, reply) => {
    const { statusCode, data } = await proxy('PATCH', '/api/settings', request.body);
    return reply.code(statusCode).send(data);
  });

  fastify.get('/gatekeeper/access-log', async (request, reply) => {
    const qs = new URLSearchParams(request.query).toString();
    const logPath = qs ? `/api/access-log?${qs}` : '/api/access-log';
    const { statusCode, data } = await proxy('GET', logPath);
    return reply.code(statusCode).send(data);
  });

  fastify.delete('/gatekeeper/access-log', async (_request, reply) => {
    const { statusCode, data } = await proxy('DELETE', '/api/access-log');
    return reply.code(statusCode).send(data);
  });
}
