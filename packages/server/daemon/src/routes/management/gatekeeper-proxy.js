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
 * recomputes the audiences. A grant or a group membership is given to a
 * username holding the users lock (`withUsernamesForGrants`), so no
 * deletion races it: a username a removed user held and nobody holds now is
 * refused (409 `username_deleted`), and whatever a removed user who held it
 * left in Gatekeeper is cleared first (503 `gatekeeper_unavailable` when it
 * cannot be) — a reused username inherits nothing. The access log is purged
 * for one username by POST, its name in the body (never in a URL, which
 * logs keep).
 *
 * Grants and groups also decide what external members of a domain reach
 * (packages/core/docs/external-members-design.md): after every change that
 * went through, the domains are rendered (users.yml's owned groups — the
 * restricted hosts and OIDC clients that name each external member), and a
 * user whose OIDC client grant ended loses the registry tokens it no longer
 * reaches. A grant on an OIDC client (`resourceType: 'oidc-client'`) must
 * name a user-facing client an installed plugin declares.
 */

import { recomputeAudiences } from '../../lib/audience.js';
import { findDirectoryUser, withUsernamesForGrants } from '../../lib/directory.js';
import { revokeRegistryTokensFor, syncDomainAccess } from '../../lib/domains.js';
import { checkProxiedGrant } from '../../lib/entitlements.js';
import { actorFromRequest } from '../../lib/actor.js';
import { gatekeeperRequest } from '../../lib/gatekeeper-client.js';
import { OIDC_CLIENT_RESOURCE, checkOidcClientGrant } from '../../lib/owned-groups.js';

/** Gatekeeper's `path`, with the request's query string when it has one. */
function withQuery(path, request) {
  const qs = new URLSearchParams(request.query).toString();
  return qs ? `${path}?${qs}` : path;
}

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
   * When Gatekeeper took a grant or group change: the plugin audiences and
   * the domains' rendering follow it, and each of `narrowed` (usernames
   * whose grants may have shrunk) that no longer reaches the registry's
   * sign-in loses its registry tokens — all before the answer goes back.
   */
  const followChange = async (request, answer, narrowed = []) => {
    if (answer.statusCode >= 400) return answer;
    await recomputeAudiences({ logger: request.log });
    await syncDomainAccess({ logger: request.log }).catch((err) => {
      request.log.warn({ err: err.message }, 'Rendering domain access after a grant change failed');
    });
    for (const username of new Set(narrowed)) {
      const known = await findDirectoryUser(username);
      if (known) await revokeRegistryTokensFor(username, known.userId, request.log);
    }
    return answer;
  };

  /**
   * A grant or group change: forwarded, and when Gatekeeper took it, the
   * plugin audiences and the domains follow it before the answer goes back.
   */
  const proxyChange = async (request, method, gatekeeperPath, body, narrowed = []) =>
    followChange(request, await proxy(method, gatekeeperPath, body), narrowed);

  /** The usernames a grant reaches now: its user, or its Lamaste group's members. */
  const grantReach = async (grant) => {
    if (!grant) return [];
    if (grant.principalType === 'user') return [grant.principalId];
    return groupMembers(grant.principalId);
  };

  /** The members of Lamaste group `name` now ([] when Gatekeeper cannot say). */
  const groupMembers = async (name) => {
    const { statusCode, data } = await proxy('GET', `/api/groups/${encodeURIComponent(name)}`);
    const members = statusCode < 400 ? data?.group?.members : null;
    return Array.isArray(members) ? members.filter((m) => typeof m === 'string') : [];
  };

  /** The grant `grantId` names, or null. */
  const grantOf = async (grantId) => {
    const { statusCode, data } = await proxy('GET', `/api/grants/${encodeURIComponent(grantId)}`);
    return statusCode < 400 ? (data?.grant ?? null) : null;
  };

  /**
   * Give something to `usernames` in Gatekeeper: forwarded holding the
   * users lock, after the usernames' checks (`withUsernamesForGrants`); a
   * refusal of those checks is the answer. The audiences follow.
   */
  const proxyGive = async (request, usernames, method, gatekeeperPath, body) => {
    let answer;
    try {
      answer = await withUsernamesForGrants(
        usernames,
        { actor: actorFromRequest(request), logger: request.log },
        () => proxy(method, gatekeeperPath, body),
      );
    } catch (err) {
      if (!Number.isInteger(err.statusCode)) throw err;
      return { statusCode: err.statusCode, data: { error: err.message, code: err.code } };
    }
    return followChange(request, answer);
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
      undefined,
      await groupMembers(name),
    );
    return reply.code(statusCode).send(data);
  });

  fastify.post('/gatekeeper/groups/:name/members', async (request, reply) => {
    const { name } = request.params;
    const usernames = Array.isArray(request.body?.usernames)
      ? request.body.usernames.filter((u) => typeof u === 'string')
      : [];
    const { statusCode, data } = await proxyGive(
      request,
      usernames,
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
      undefined,
      [username],
    );
    return reply.code(statusCode).send(data);
  });

  // --- Grants ---

  fastify.get('/gatekeeper/grants', async (request, reply) => {
    const { statusCode, data } = await proxy('GET', withQuery('/api/grants', request));
    return reply.code(statusCode).send(data);
  });

  // A plugin grant with `context.roles` is an entitlement: its roles must be
  // the plugin's (400 otherwise), and go on sorted, without repeats.
  fastify.post('/gatekeeper/grants', async (request, reply) => {
    let body;
    try {
      body = await checkOidcClientGrant(await checkProxiedGrant(request.body));
    } catch (err) {
      if (!Number.isInteger(err.statusCode)) throw err;
      return reply.code(err.statusCode).send({
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
        ...(Array.isArray(err.unknown) ? { unknown: err.unknown } : {}),
      });
    }
    const usernames =
      body?.principalType === 'user' && typeof body.principalId === 'string'
        ? [body.principalId]
        : [];
    const { statusCode, data } = await proxyGive(request, usernames, 'POST', '/api/grants', body);
    return reply.code(statusCode).send(data);
  });

  fastify.get('/gatekeeper/grants/:grantId', async (request, reply) => {
    const { grantId } = request.params;
    const { statusCode, data } = await proxy('GET', `/api/grants/${encodeURIComponent(grantId)}`);
    return reply.code(statusCode).send(data);
  });

  fastify.delete('/gatekeeper/grants/:grantId', async (request, reply) => {
    const { grantId } = request.params;
    const grant = await grantOf(grantId);
    const { statusCode, data } = await proxyChange(
      request,
      'DELETE',
      `/api/grants/${encodeURIComponent(grantId)}`,
      undefined,
      grant?.resourceType === OIDC_CLIENT_RESOURCE ? await grantReach(grant) : [],
    );
    return reply.code(statusCode).send(data);
  });

  // Bulk-revoke every grant for a principal. Forwarded to gatekeeper as
  // DELETE /api/grants?principalType=...&principalId=...
  fastify.delete('/gatekeeper/grants', async (request, reply) => {
    const { principalType, principalId } = request.query ?? {};
    const narrowed =
      typeof principalId !== 'string'
        ? []
        : principalType === 'group'
          ? await groupMembers(principalId)
          : [principalId];
    const { statusCode, data } = await proxyChange(
      request,
      'DELETE',
      withQuery('/api/grants', request),
      undefined,
      narrowed,
    );
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
    const { statusCode, data } = await proxy('GET', withQuery('/api/access-log', request));
    return reply.code(statusCode).send(data);
  });

  // DELETE clears the whole log. One username's rows (before a time, when
  // given) are purged by POST with `{ username, before? }` in the body — a
  // username in a query string would be in every access log on the way.
  fastify.delete('/gatekeeper/access-log', async (_request, reply) => {
    const { statusCode, data } = await proxy('DELETE', '/api/access-log');
    return reply.code(statusCode).send(data);
  });

  fastify.post('/gatekeeper/access-log/purge', async (request, reply) => {
    const { statusCode, data } = await proxy('POST', '/api/access-log/purge', request.body);
    return reply.code(statusCode).send(data);
  });
}
