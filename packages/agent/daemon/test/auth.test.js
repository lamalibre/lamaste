/**
 * Who lamaste-agentd lets in — against the real server, its route table and
 * a stand-in plugin. The daemon's port can be reached by any OS user on the
 * agent machine and, through the tunnel, by any process on the relay, so:
 *
 *   - headers that only claim a caller (`X-SSL-Client-*`, `Remote-*`) prove
 *     nothing and never reach a route or plugin;
 *   - the owner gets in with the Bearer token of agentd.token;
 *   - the relay gets in with a relay assertion, valid for exactly one
 *     request of this agent on this port;
 *   - whether a request needs a caller follows the matched route, so a
 *     percent-escaped path (`/%61pi/...` is routed as `/api/...`) does not
 *     walk around the check.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The agent's local registry name, and the label the relay knows it by —
// they differ, as on an agent set up with `--label`.
const LABEL = 'auth-agent';
const RELAY_LABEL = 'auth-relay';

let home;
let core;
let server;
let port;
let token;
let relayKey;
let foreignKey;
const panel = {
  keyFetches: 0,
  async fetchRelayKeys() {
    panel.keyFetches += 1;
    return { keys: [core.relayVerifyKeyOf(relayKey)], agentLabel: RELAY_LABEL };
  },
  async fetchSelfCapabilities() {
    return { capabilities: ['tunnels:read'], allowedSites: [], role: 'agent' };
  },
};

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
}

/** A stand-in plugin that reports what it was told about the caller. */
const WHOAMI_PLUGIN = `export default async function whoami(app) {
  const report = async (request) => ({
    role: request.certRole ?? null,
    user: request.headers['remote-user'] ?? null,
    groups: request.headers['remote-groups'] ?? null,
    name: request.headers['remote-name'] ?? null,
    email: request.headers['remote-email'] ?? null,
    dn: request.headers['x-ssl-client-dn'] ?? null,
    assertion: request.headers['x-lamalibre-relay-assertion'] ?? null,
    rawClaims: request.raw.rawHeaders
      .filter((_, i) => i % 2 === 0)
      .map((name) => name.toLowerCase())
      .filter((name) => name.startsWith('remote-') || name.startsWith('x-ssl-client-')),
    rawUser: request.raw.rawHeaders[request.raw.rawHeaders.findIndex((n) => n.toLowerCase() === 'remote-user') + 1] ?? null,
  });
  app.get('/', report);
  app.get('/whoami', report);
  // Plugin code that answers paths no route matches: it must not run for
  // a request without a caller.
  app.setNotFoundHandler(async (request, reply) => reply.code(404).send({ pluginNotFound: true }));
}
`;

before(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'lamaste-agentd-auth-'));
  process.env.HOME = home;
  core = await import('@lamalibre/lamaste');
  const agent = await import('@lamalibre/lamaste/agent');

  const dataDir = agent.agentDataDir(LABEL);
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    agent.agentConfigPath(LABEL),
    JSON.stringify({ label: LABEL, panelUrl: 'https://panel.example.test', authMethod: 'p12' }),
  );
  const pkgDir = path.join(dataDir, 'node_modules', '@lamalibre', 'e2e-herd-server');
  await mkdir(pkgDir, { recursive: true });
  await writeFile(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({
      name: '@lamalibre/e2e-herd-server',
      version: '0.1.0',
      type: 'module',
      main: 'index.js',
    }),
  );
  await writeFile(path.join(pkgDir, 'index.js'), WHOAMI_PLUGIN);
  await writeFile(
    agent.agentPluginsFile(LABEL),
    JSON.stringify({
      plugins: [
        {
          name: 'herd',
          packageName: '@lamalibre/e2e-herd-server',
          version: '0.1.0',
          description: '',
          capabilities: [],
          packages: { server: '@lamalibre/e2e-herd-server' },
          panel: {},
          modes: ['agent'],
          config: {},
          status: 'enabled',
          installedAt: '2026-10-15T00:00:00.000Z',
        },
      ],
    }),
  );

  relayKey = await core
    .createRelaySigner(path.join(home, 'relay-signing-key.json'), { create: true })
    .current();
  foreignKey = await core
    .createRelaySigner(path.join(home, 'foreign-signing-key.json'), { create: true })
    .current();

  port = await freePort();
  const { startPanelServer } = await import('../src/server.js');
  server = await startPanelServer(LABEL, { port, panelApi: panel });
  const tokenFile = path.join(home, '.lamalibre', 'lamaste', 'agentd.token');
  token = JSON.parse(await readFile(tokenFile, 'utf-8')).token;
});

after(async () => {
  await server?.close();
  await rm(home, { recursive: true, force: true });
});

function call(url, headers = {}, method = 'GET') {
  return server.inject({ method, url, headers });
}

/** A relay assertion for this agent, admin calling GET /api/status, unless overridden. */
function assertion(overrides = {}, key = relayKey) {
  return core.signRelayAssertion(
    {
      aud: RELAY_LABEL,
      port,
      caller: { type: 'admin' },
      method: 'GET',
      target: { path: '/api/status' },
      ...overrides,
    },
    key,
  );
}

const relay = (value) => ({ 'x-lamalibre-relay-assertion': value });

test('no credential: the management API and plugin routes are refused, however the path is spelled', async () => {
  for (const url of [
    '/api/status',
    '/%61pi/status',
    '/api/config',
    '/%61pi/config',
    '/api/plugins',
    '/herd',
    '/herd?x=1',
    '/herd/',
    '/herd/whoami',
    '/%68erd/whoami',
    '/herd/%77hoami',
    // No route matches these, but the plugin's own not-found handler would answer
    '/herd/no-such-route',
    '/%68erd/no-such-route',
  ]) {
    const res = await call(url);
    assert.equal(res.statusCode, 401, url);
  }
  // A path that does not decode is refused by the router before any handler.
  assert.equal((await call('/herd/%zz')).statusCode, 400);
});

test('the health check and the plugin bundles answer without a caller', async () => {
  assert.equal((await call('/api/health')).statusCode, 200);
  const bundle = await call('/plugin-bundles/herd/panel.js');
  assert.notEqual(bundle.statusCode, 401);
});

test('forged certificate and Authelia headers prove nothing', async () => {
  const forgedAdmin = {
    'x-ssl-client-verify': 'SUCCESS',
    'x-ssl-client-dn': 'CN=admin',
    'x-ssl-client-serial': '01',
  };
  assert.equal((await call('/api/plugins', forgedAdmin)).statusCode, 401);
  assert.equal(
    (await call('/api/plugins/install', forgedAdmin, 'POST')).statusCode,
    401,
    'plugin install is code execution as the agent user',
  );
  const forgedUser = { 'remote-user': 'alice', 'remote-groups': 'admins' };
  assert.equal((await call('/herd/whoami', forgedUser)).statusCode, 401);
  assert.equal((await call('/%68erd/whoami', forgedUser)).statusCode, 401);
});

test('the owner token has full access, and a plugin never sees claimed identity headers', async () => {
  const owner = { authorization: `Bearer ${token}` };
  assert.equal((await call('/api/plugins', owner)).statusCode, 200);
  const res = await call('/herd/whoami', {
    ...owner,
    'remote-user': 'alice',
    'remote-groups': 'admins',
    'x-ssl-client-dn': 'CN=admin',
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.role, 'agent');
  assert.equal(body.user, null);
  assert.equal(body.groups, null);
  assert.equal(body.dn, null);
  assert.deepEqual(body.rawClaims, [], 'not in rawHeaders either');
  // The owner reaches the plugin's own not-found handler.
  const missing = await call('/herd/no-such-route', owner);
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { pluginNotFound: true });
  assert.equal((await call('/api/plugins', { authorization: 'Bearer nope' })).statusCode, 401);
});

test('an admin assertion is accepted for exactly its request, once', async () => {
  const header = assertion({ target: { path: '/api/plugins' } });
  const res = await call('/api/plugins', relay(header));
  assert.equal(res.statusCode, 200);
  assert.equal((await call('/api/plugins', relay(header))).statusCode, 401, 'replayed');

  const refused = [
    ['/api/plugins?x=1', assertion({ target: { path: '/api/plugins' } }), 'GET'],
    ['/api/plugins/install', assertion({ target: { path: '/api/plugins/install' } }), 'POST'],
    ['/api/plugins', assertion({ target: { path: '/api/plugins' }, aud: 'someone-else' }), 'GET'],
    // The audience is the relay's name for this agent, not the local one.
    ['/api/plugins', assertion({ target: { path: '/api/plugins' }, aud: LABEL }), 'GET'],
    ['/api/plugins', assertion({ target: { path: '/api/plugins' }, port: port + 1 }), 'GET'],
    [
      '/api/plugins',
      assertion({ target: { path: '/api/plugins' }, iat: Date.now() - 120_000 }),
      'GET',
    ],
    ['/api/plugins', `${header.slice(0, -4)}AAAA`, 'GET'],
    ['/api/plugins', 'not-an-assertion', 'GET'],
  ];
  for (const [url, value, method] of refused) {
    assert.equal((await call(url, relay(value), method)).statusCode, 401, `${method} ${url}`);
  }
});

test('an assertion the relay did not sign is refused; the keys are fetched again at most once per window', async () => {
  const before = panel.keyFetches;
  for (let i = 0; i < 3; i++) {
    const forged = assertion({ target: { path: '/api/plugins' } }, foreignKey);
    assert.equal((await call('/api/plugins', relay(forged))).statusCode, 401);
  }
  assert.ok(panel.keyFetches - before <= 1, `fetched ${panel.keyFetches - before} times`);
});

test("this agent's certificate gets the panel's capabilities; another agent's is refused", async () => {
  const own = { type: 'agent', label: RELAY_LABEL };
  assert.equal(
    (await call('/api/status', relay(assertion({ caller: own })))).statusCode,
    200,
    'no capability needed',
  );
  assert.equal(
    (
      await call(
        '/api/plugins',
        relay(assertion({ caller: own, target: { path: '/api/plugins' } })),
      )
    ).statusCode,
    403,
    'owner-only route',
  );
  for (const label of ['other-agent', LABEL]) {
    const other = { type: 'agent', label };
    assert.equal(
      (await call('/api/status', relay(assertion({ caller: other })))).statusCode,
      403,
      label,
    );
  }
});

test('an Authelia user on a plugin tunnel reaches that plugin only, with the asserted identity', async () => {
  const alice = {
    type: 'user',
    username: 'alice',
    groups: ['dev', 'ops'],
    name: 'Alice',
    email: 'alice@example.test',
  };
  const res = await call('/herd/whoami', {
    ...relay(assertion({ caller: alice, target: { route: 'herd' } })),
    'remote-user': 'mallory',
    'remote-groups': 'admins',
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    role: 'user',
    user: 'alice',
    groups: 'dev,ops',
    name: 'Alice',
    email: 'alice@example.test',
    dn: null,
    assertion: null,
    rawClaims: ['remote-user', 'remote-groups', 'remote-name', 'remote-email'],
    rawUser: 'alice',
  });
  assert.equal(
    (await call('/herd', relay(assertion({ caller: alice, target: { route: 'herd' } }))))
      .statusCode,
    200,
  );

  // Never the management API, never another plugin's routes.
  assert.equal(
    (await call('/api/status', relay(assertion({ caller: alice, target: { route: 'herd' } }))))
      .statusCode,
    401,
  );
  assert.equal(
    (await call('/herd/whoami', relay(assertion({ caller: alice, target: { route: 'other' } }))))
      .statusCode,
    401,
  );
});
