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
 *
 * Grants and groups decide who is in an agent-hosted plugin's audience
 * (slice 6): a plugin grant whose context names `roles` is an entitlement,
 * checked against the roles the plugin declares and passed on sorted
 * (`checkProxiedGrant`), and every grant or group change that went through
 * recomputes the audiences. Before a grant or a group membership is given
 * to a username, whatever a removed user who held it left in Gatekeeper is
 * cleared (503 `gatekeeper_unavailable` when it cannot be): a reused
 * username inherits nothing.
 */

import { recomputeAudiences } from '../../lib/audience.js';
import { ensurePrincipalCleared } from '../../lib/directory.js';
import { checkProxiedGrant } from '../../lib/entitlements.js';
import { actorFromRequest } from '../../lib/actor.js';
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

  /**
   * Clear what removed users left in Gatekeeper under `usernames` before
   * something is given to those usernames; the refusal to answer, or null.
   */
  const clearBeforeGiving = async (request, usernames) => {
    for (const username of usernames) {
      try {
        await ensurePrincipalCleared(username, {
          actor: actorFromRequest(request),
          logger: request.log,
        });
      } catch (err) {
        if (!Number.isInteger(err.statusCode)) throw err;
        return { statusCode: err.statusCode, data: { error: err.message, code: err.code } };
      }
    }
    return null;
  };

  /**
   * A grant or group change: forwarded, and when Gatekeeper took it, the
   * plugin audiences follow it before the answer goes back.
   */
  const proxyChange = async (request, method, gatekeeperPath, body) => {
    const answer = await proxy(method, gatekeeperPath, body);
    if (answer.statusCode < 400) await recomputeAudiences({ logger: request.log });
    return answer;
  };

  // --- Groups ---

  fastify.get('/gatekeeper/groups', async (_request, reply) => {
    const { statusCode, data } = await proxy('GET', '/api/groups');
    return reply.code(statusCode).send(data);
  });

  fastify.post('/gatekeeper/groups', async (request, reply) => {
    const { statusCode, data } = await proxyChange(request, 'POST', '/api/groups', request.body);
    return reply.code(statusCode).send(data);
  });

  fastify.get('/gatekeeper/groups/:name', async (request, reply) => {
    const { name } = request.params;
    const { statusCode, data } = await proxy('GET', `/api/groups/${encodeURIComponent(name)}`);
    return reply.code(statusCode).send(data);
  });

  fastify.patch('/gatekeeper/groups/:name', async (request, reply) => {
    const { name } = request.params;
    const { statusCode, data } = await proxyChange(
      request,
      'PATCH',
      `/api/groups/${encodeURIComponent(name)}`,
      request.body,
    );
    return reply.code(statusCode).send(data);
  });

  fastify.delete('/gatekeeper/groups/:name', async (request, reply) => {
    const { name } = request.params;
    const { statusCode, data } = await proxyChange(
      request,
      'DELETE',
      `/api/groups/${encodeURIComponent(name)}`,
    );
    return reply.code(statusCode).send(data);
  });

  fastify.post('/gatekeeper/groups/:name/members', async (request, reply) => {
    const { name } = request.params;
    const usernames = Array.isArray(request.body?.usernames)
      ? request.body.usernames.filter((u) => typeof u === 'string')
      : [];
    const refused = await clearBeforeGiving(request, usernames);
    if (refused) return reply.code(refused.statusCode).send(refused.data);
    const { statusCode, data } = await proxyChange(
      request,
      'POST',
      `/api/groups/${encodeURIComponent(name)}/members`,
      request.body,
    );
    return reply.code(statusCode).send(data);
  });

  fastify.delete('/gatekeeper/groups/:name/members/:username', async (request, reply) => {
    const { name, username } = request.params;
    const { statusCode, data } = await proxyChange(
      request,
      'DELETE',
      `/api/groups/${encodeURIComponent(name)}/members/${encodeURIComponent(username)}`,
    );
    return reply.code(statusCode).send(data);
  });

  // --- Grants ---

  fastify.get('/gatekeeper/grants', async (request, reply) => {
    const qs = new URLSearchParams(request.query).toString();
    const grantPath = qs ? `/api/grants?${qs}` : '/api/grants';
    const { statusCode, data } = await proxy('GET', grantPath);
    return reply.code(statusCode).send(data);
  });

  // A plugin grant with `context.roles` is an entitlement: its roles must be
  // the plugin's (400 otherwise), and go on sorted, without repeats.
  fastify.post('/gatekeeper/grants', async (request, reply) => {
    let body;
    try {
      body = await checkProxiedGrant(request.body);
    } catch (err) {
      if (!Number.isInteger(err.statusCode)) throw err;
      return reply.code(err.statusCode).send({
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
        ...(Array.isArray(err.unknown) ? { unknown: err.unknown } : {}),
      });
    }
    if (body?.principalType === 'user' && typeof body.principalId === 'string') {
      const refused = await clearBeforeGiving(request, [body.principalId]);
      if (refused) return reply.code(refused.statusCode).send(refused.data);
    }
    const { statusCode, data } = await proxyChange(request, 'POST', '/api/grants', body);
    return reply.code(statusCode).send(data);
  });

  fastify.get('/gatekeeper/grants/:grantId', async (request, reply) => {
    const { grantId } = request.params;
    const { statusCode, data } = await proxy('GET', `/api/grants/${encodeURIComponent(grantId)}`);
    return reply.code(statusCode).send(data);
  });

  fastify.delete('/gatekeeper/grants/:grantId', async (request, reply) => {
    const { grantId } = request.params;
    const { statusCode, data } = await proxyChange(
      request,
      'DELETE',
      `/api/grants/${encodeURIComponent(grantId)}`,
    );
    return reply.code(statusCode).send(data);
  });

  // Bulk-revoke every grant for a principal. Forwarded to gatekeeper as
  // DELETE /api/grants?principalType=...&principalId=...
  fastify.delete('/gatekeeper/grants', async (request, reply) => {
    const qs = new URLSearchParams(request.query).toString();
    const grantPath = qs ? `/api/grants?${qs}` : '/api/grants';
    const { statusCode, data } = await proxyChange(request, 'DELETE', grantPath);
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
