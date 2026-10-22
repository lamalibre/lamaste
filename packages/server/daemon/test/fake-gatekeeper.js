/**
 * A stand-in for Gatekeeper's admin API, for tests of what the panel asks
 * it: grants (with its duplicate rule — same principal, resource and
 * context JSON — and its grant limit), groups and their members, a user
 * principal's removal (its grants and memberships), and the access-request
 * log purge. It answers the way `lib/gatekeeper-client.js`
 * reports Gatekeeper's answers (`{ ok, statusCode, data }` or `{ ok: false,
 * statusCode, error, reason }`) and records every call; `unreachable`
 * plays a Gatekeeper that does not answer.
 *
 * `installFakeGatekeeper(lib)` puts it behind the client
 * (`setGatekeeperClientForTests`) and returns the controls.
 */

import crypto from 'node:crypto';

function createFakeGatekeeper({ maxGrants = 1000 } = {}) {
  const grants = [];
  const groups = new Map();
  const calls = [];
  /** Access-request log rows: { username, timestamp }. */
  const accessLog = [];
  const state = { unreachable: false, maxGrants };

  const ok = (statusCode, data) => ({ ok: true, statusCode, data });
  const refuse = (statusCode, error) => ({ ok: false, statusCode, error, reason: 'http-error' });

  async function request(method, apiPath, body) {
    calls.push({
      method,
      path: apiPath,
      body: body === undefined ? undefined : structuredClone(body),
    });
    if (state.unreachable) {
      return {
        ok: false,
        statusCode: 503,
        error: 'gatekeeper unreachable: connect ECONNREFUSED',
        reason: 'unreachable',
      };
    }
    const url = new URL(apiPath, 'http://gatekeeper');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const q = Object.fromEntries(url.searchParams);

    if (parts[1] === 'grants') {
      if (method === 'GET' && parts.length === 2) {
        return ok(200, {
          grants: grants.filter(
            (g) =>
              (q.principalType === undefined || g.principalType === q.principalType) &&
              (q.principalId === undefined || g.principalId === q.principalId) &&
              (q.resourceType === undefined || g.resourceType === q.resourceType) &&
              (q.resourceId === undefined || g.resourceId === q.resourceId),
          ),
        });
      }
      if (method === 'POST') {
        if (grants.length >= state.maxGrants) {
          return refuse(503, `Maximum number of grants (${state.maxGrants}) reached`);
        }
        const duplicate = grants.some(
          (g) =>
            g.principalType === body.principalType &&
            g.principalId === body.principalId &&
            g.resourceType === body.resourceType &&
            g.resourceId === body.resourceId &&
            JSON.stringify(g.context) === JSON.stringify(body.context ?? {}),
        );
        if (duplicate) {
          return refuse(
            409,
            'Duplicate grant: a grant with the same principal, resource, and context already exists',
          );
        }
        const grant = {
          grantId: crypto.randomUUID(),
          principalType: body.principalType,
          principalId: body.principalId,
          resourceType: body.resourceType,
          resourceId: body.resourceId,
          context: structuredClone(body.context ?? {}),
          used: false,
          createdAt: new Date().toISOString(),
          usedAt: null,
        };
        grants.push(grant);
        return ok(201, { ok: true, grant });
      }
      if (method === 'DELETE' && parts.length === 3) {
        const index = grants.findIndex((g) => g.grantId === parts[2]);
        if (index === -1) return refuse(404, 'Grant not found');
        const [grant] = grants.splice(index, 1);
        return ok(200, { ok: true, grant });
      }
      if (method === 'DELETE' && parts.length === 2) {
        let removed = 0;
        for (let i = grants.length - 1; i >= 0; i -= 1) {
          if (
            grants[i].principalType === q.principalType &&
            grants[i].principalId === q.principalId
          ) {
            grants.splice(i, 1);
            removed += 1;
          }
        }
        return ok(200, { ok: true, removed });
      }
    }

    if (parts[1] === 'groups') {
      if (method === 'GET' && parts.length === 2) {
        return ok(200, { groups: [...groups.values()].map((g) => structuredClone(g)) });
      }
      const group = groups.get(parts[2]);
      if (method === 'GET' && parts.length === 3) {
        return group ? ok(200, { group: structuredClone(group) }) : refuse(404, 'Group not found');
      }
      if (method === 'POST' && parts.length === 2) {
        groups.set(body.name, { name: body.name, description: '', members: [] });
        return ok(201, { ok: true, group: groups.get(body.name) });
      }
      if (method === 'POST' && parts[3] === 'members') {
        if (!group) return refuse(404, 'Group not found');
        for (const username of body.usernames) {
          if (!group.members.includes(username)) group.members.push(username);
        }
        return ok(200, { ok: true, group });
      }
      if (method === 'DELETE' && parts[3] === 'members') {
        if (!group) return refuse(404, 'Group not found');
        group.members = group.members.filter((m) => m !== parts[4]);
        return ok(200, { ok: true, group });
      }
    }

    if (parts[1] === 'principals' && parts[2] === 'user' && method === 'DELETE') {
      const username = parts[3];
      let grantsRemoved = 0;
      for (let i = grants.length - 1; i >= 0; i -= 1) {
        if (grants[i].principalType === 'user' && grants[i].principalId === username) {
          grants.splice(i, 1);
          grantsRemoved += 1;
        }
      }
      let groupsLeft = 0;
      for (const group of groups.values()) {
        if (group.members.includes(username)) {
          group.members = group.members.filter((m) => m !== username);
          groupsLeft += 1;
        }
      }
      return ok(200, { ok: true, grantsRemoved, groupsLeft });
    }

    if (parts[1] === 'access-log' && method === 'DELETE') {
      let removed = 0;
      for (let i = accessLog.length - 1; i >= 0; i -= 1) {
        const row = accessLog[i];
        if (row.username === q.username && (q.before === undefined || row.timestamp < q.before)) {
          accessLog.splice(i, 1);
          removed += 1;
        }
      }
      return ok(200, { ok: true, removed });
    }

    return refuse(404, `No fake route for ${method} ${apiPath}`);
  }

  return {
    request,
    grants,
    groups,
    calls,
    accessLog,
    state,
    /** A grant made directly in Gatekeeper (its CLI, say) — not through the panel. */
    addGrant(grant) {
      const created = {
        grantId: crypto.randomUUID(),
        context: {},
        used: false,
        createdAt: new Date().toISOString(),
        usedAt: null,
        ...structuredClone(grant),
      };
      grants.push(created);
      return created;
    },
    /** A group made directly in Gatekeeper. */
    setGroup(name, members) {
      groups.set(name, { name, description: '', members: [...members] });
    },
    reset() {
      grants.length = 0;
      groups.clear();
      calls.length = 0;
      accessLog.length = 0;
      state.unreachable = false;
      state.maxGrants = maxGrants;
    },
  };
}

/**
 * Put a fake Gatekeeper behind the panel's Gatekeeper client.
 *
 * @param {{ setGatekeeperClientForTests: (fn: unknown) => void }} lib
 */
export function installFakeGatekeeper(lib, opts) {
  const gatekeeper = createFakeGatekeeper(opts);
  lib.setGatekeeperClientForTests(gatekeeper.request);
  return gatekeeper;
}
