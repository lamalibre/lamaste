/**
 * The agent-panel vhost's auth_request target, GET /api/agent-panel/authz/:label,
 * and the key agents verify its answer with, GET /api/agents/me/relay-keys.
 *
 * The panel admits the administrator and the agent the panel belongs to —
 * no other agent, no plugin-agent, no agent without an enabled panel tunnel
 * — and answers with a relay assertion for exactly the request nginx is
 * authorizing, which verifies against the published key.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let app;
let stateDir;
let core;

const TUNNELS = [
  {
    id: 't1',
    subdomain: 'agent-r730',
    fqdn: 'agent-r730.example.com',
    port: 9393,
    description: null,
    type: 'panel',
    enabled: true,
    createdAt: '2026-10-15T00:00:00.000Z',
    agentLabel: 'r730',
  },
  {
    id: 't2',
    subdomain: 'agent-off',
    fqdn: 'agent-off.example.com',
    port: 9394,
    description: null,
    type: 'panel',
    enabled: false,
    createdAt: '2026-10-15T00:00:00.000Z',
    agentLabel: 'off',
  },
  {
    id: 't3',
    subdomain: 'herd',
    fqdn: 'herd.example.com',
    port: 9395,
    description: null,
    type: 'plugin',
    accessMode: 'authenticated',
    enabled: true,
    createdAt: '2026-10-15T00:00:00.000Z',
    agentLabel: 'nopanel',
    pluginName: '@lamalibre/herd-server',
    pluginRoute: 'herd',
  },
];

before(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), 'lamaste-agent-panel-authz-'));
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_PKI_DIR = path.join(stateDir, 'pki');
  await writeFile(path.join(stateDir, 'tunnels.json'), JSON.stringify(TUNNELS));

  core = await import('@lamalibre/lamaste');
  const { default: Fastify } = await import('fastify');
  const { default: agentPanelAuthzRoutes } =
    await import('../src/routes/management/agent-panel-authz.js');
  const { default: agentsRoutes } = await import('../src/routes/management/agents.js');
  const { ensureRelaySigningKey } = await import('../src/lib/relay-signing.js');
  await ensureRelaySigningKey({ info() {}, error() {} });

  app = Fastify({ logger: false });
  // Stand-ins for the mTLS middleware and the role guard, as in
  // agents-route.test.js: identity from two request headers.
  app.decorateRequest('certRole', null);
  app.decorateRequest('certLabel', null);
  app.addHook('onRequest', async (request) => {
    request.certRole = request.headers['x-test-role'] ?? 'unknown';
    request.certLabel = request.headers['x-test-label'] ?? null;
  });
  app.decorate('requireRole', (roles) => async (request, reply) => {
    const role =
      request.certRole === 'plugin-agent' && roles.includes('agent') ? 'agent' : request.certRole;
    if (role === 'admin' || roles.includes(role)) return;
    return reply.code(403).send({ error: 'forbidden' });
  });
  await app.register(agentPanelAuthzRoutes, { prefix: '/api' });
  await app.register(agentsRoutes, { prefix: '/api' });
  await app.ready();
});

after(async () => {
  await app.close();
  await rm(stateDir, { recursive: true, force: true });
});

const authz = (label, headers) =>
  app.inject({
    method: 'GET',
    url: `/api/agent-panel/authz/${label}`,
    headers: { 'x-original-method': 'POST', 'x-original-uri': '/api/plugins/install', ...headers },
  });

async function verifyKeys() {
  const res = await app.inject({
    method: 'GET',
    url: '/api/agents/me/relay-keys',
    headers: { 'x-test-role': 'agent', 'x-test-label': 'r730' },
  });
  assert.equal(res.statusCode, 200);
  const { keys, agentLabel } = res.json();
  assert.equal(agentLabel, 'r730', 'the label the relay knows the calling agent by');
  return new Map(keys.map((k) => [k.kid, core.parseRelayVerifyKey(k).publicKey]));
}

test('the signing key is created 0600 in the state directory', async () => {
  const info = await stat(path.join(stateDir, core.RELAY_SIGNING_KEY_FILE));
  assert.equal((info.mode & 0o777).toString(8), '600');
});

test('admin: an assertion for exactly the request nginx is authorizing', async () => {
  const res = await authz('r730', { 'x-test-role': 'admin' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  const header = res.headers['x-lamalibre-relay-assertion'];
  const keys = await verifyKeys();
  const verified = core.verifyRelayAssertion(header, {
    keys,
    aud: 'r730',
    port: 9393,
    method: 'POST',
    url: '/api/plugins/install',
    nonces: new core.NonceStore(),
  });
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.payload.caller, { type: 'admin' });
  assert.deepEqual(verified.payload.target, { path: '/api/plugins/install' });
});

test('the agent the panel belongs to is admitted as itself', async () => {
  const res = await authz('r730', { 'x-test-role': 'agent', 'x-test-label': 'r730' });
  assert.equal(res.statusCode, 200);
  const [encoded] = res.headers['x-lamalibre-relay-assertion'].split('.');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
  assert.deepEqual(payload.caller, { type: 'agent', label: 'r730' });
});

test('refused: another agent, a plugin-agent, no role, and agents without an enabled panel', async () => {
  const cases = [
    ['r730', { 'x-test-role': 'agent', 'x-test-label': 'other' }, 403],
    ['r730', { 'x-test-role': 'plugin-agent', 'x-test-label': 'plugin-agent:r730:x' }, 403],
    ['r730', {}, 403],
    ['off', { 'x-test-role': 'admin' }, 403],
    ['nopanel', { 'x-test-role': 'admin' }, 403],
    ['missing', { 'x-test-role': 'admin' }, 403],
  ];
  for (const [label, headers, status] of cases) {
    const res = await authz(label, headers);
    assert.equal(res.statusCode, status, `${label} ${JSON.stringify(headers)}`);
    assert.equal(res.headers['x-lamalibre-relay-assertion'], undefined);
  }
});

test('a request nginx could not have sent is refused with 400', async () => {
  for (const headers of [
    { 'x-original-uri': 'api/no-slash' },
    { 'x-original-uri': '/with space' },
    { 'x-original-method': 'get' },
    { 'x-original-method': '' },
  ]) {
    const res = await authz('r730', { 'x-test-role': 'admin', ...headers });
    assert.equal(res.statusCode, 400, JSON.stringify(headers));
  }
  const noUri = await app.inject({
    method: 'GET',
    url: '/api/agent-panel/authz/r730',
    headers: { 'x-test-role': 'admin', 'x-original-method': 'GET' },
  });
  assert.equal(noUri.statusCode, 400);
});

test('decisions: authorizeAgentPanelRequest', async () => {
  const { authorizeAgentPanelRequest } = await import('@lamalibre/lamaste/server');
  const req = { label: 'r730', method: 'GET', uri: '/api/status' };
  assert.deepEqual(authorizeAgentPanelRequest({ ...req, certRole: 'admin' }, TUNNELS), {
    ok: true,
    aud: 'r730',
    port: 9393,
    caller: { type: 'admin' },
    method: 'GET',
    path: '/api/status',
  });
  assert.equal(
    authorizeAgentPanelRequest({ ...req, certRole: 'agent', certLabel: 'r730' }, [
      { ...TUNNELS[0], agentLabel: 'someone-else' },
    ]).reason,
    'no_panel_tunnel',
    'the tunnel must belong to the agent it is named after',
  );
});
