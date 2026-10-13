/**
 * GET /api/agents/me/registry-credential answers by certificate role: the
 * admin master role, which every requireRole guard lets through, has no
 * agent identity to broker for and gets 403; a plugin-agent certificate
 * gets 400; an agent with no credential configured on the panel gets 404.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let app;
let stateDir;

before(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), 'lamaste-agents-route-'));
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_PKI_DIR = path.join(stateDir, 'pki');
  const { default: Fastify } = await import('fastify');
  const { default: agentsRoutes } = await import('../src/routes/management/agents.js');
  app = Fastify({ logger: false });
  // Stand-ins for the mTLS middleware and the role guard: identity comes
  // from two request headers; the guard admits admin plus the listed roles,
  // as the real one does.
  app.decorateRequest('certRole', null);
  app.decorateRequest('certLabel', null);
  app.addHook('onRequest', async (request) => {
    request.certRole = request.headers['x-test-role'] ?? 'unknown';
    request.certLabel = request.headers['x-test-label'] ?? null;
  });
  app.decorate('requireRole', (roles) => async (request, reply) => {
    // plugin-agent is a subset of agent, as in the real guard
    const role =
      request.certRole === 'plugin-agent' && roles.includes('agent') ? 'agent' : request.certRole;
    if (role === 'admin' || roles.includes(role)) return;
    return reply.code(403).send({ error: 'forbidden' });
  });
  await app.register(agentsRoutes, { prefix: '/api' });
  await app.ready();
});

after(async () => {
  await app.close();
  await rm(stateDir, { recursive: true, force: true });
});

const get = (headers) =>
  app.inject({ method: 'GET', url: '/api/agents/me/registry-credential', headers });

test('an admin certificate is refused with 403 — it has no agent identity', async () => {
  const res = await get({ 'x-test-role': 'admin' });
  assert.equal(res.statusCode, 403);
  assert.match(res.json().error, /Only an agent certificate/);
});

test('a plugin-agent certificate is refused with 400', async () => {
  const res = await get({ 'x-test-role': 'plugin-agent', 'x-test-label': 'plugin-agent:x:y' });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /Plugin-agents/);
});

test('an agent gets 404 while the panel has no registry credential', async () => {
  const res = await get({ 'x-test-role': 'agent', 'x-test-label': 'r730' });
  assert.equal(res.statusCode, 404);
  assert.match(res.json().error, /No registry credential/);
});

test('no certificate role at all is refused by the guard', async () => {
  const res = await get({});
  assert.equal(res.statusCode, 403);
});
