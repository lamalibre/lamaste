/**
 * Slice 6, a plugin's user surface end to end on the relay: what nginx does
 * for `/api/<route>/app/*` on the bound host — Gatekeeper's real
 * `/authz/user-surface/<fqdn>` (Authelia a stand-in), its assertion passed
 * to the panel — then the panel's own user-surface context, wired as
 * `index.js` wires it beside the protected (mTLS) context on one router,
 * forwarding to a fake agent half that verifies like a real one (core's
 * caller-assertion verifier, identity projection and handlers).
 *
 * Covered: the half sees `{ type: 'user', userId, username, roles }` on
 * `/app/<rest>`, never a credential, and the browser never a `Set-Cookie`;
 * 401 without an assertion, or with a replayed, expired, path- or
 * method-mismatched one, and Gatekeeper's JSON 401 without a session; 403
 * for a disabled, removed or unentitled user and one whose username's
 * earlier holder still has grants to clear; 503 before the half answered
 * protocol 1, for a disabled plugin and before onboarding; 404 for a plugin
 * without identity and an unbound route; the Origin rule; the restricted
 * tunnel's grant; the user surface's own rate limit; and that `/api/<route>/app`
 * is never the admin forwarder's, while its other routes still are.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

import {
  RELAY_ASSERTION_HEADER,
  RELAY_PANEL_AUDIENCE,
  RELAY_PANEL_PORT,
  createRelaySigner,
  signRelayAssertion,
} from '@lamalibre/lamaste';
import {
  createCallerAssertionVerifier,
  createIdentityHandlers,
  createIdentityProjection,
  responderHeaderFor,
} from '@lamalibre/lamaste/agent';

import { installFakeGatekeeper } from './fake-gatekeeper.js';
import { installFakeNpm } from './fake-npm.js';
import { installFakeSudo } from './fake-sudo.js';

const IP = '127.0.0.1';
const HOST = 'piyasa.relay.test';
const ORIGIN = `https://${HOST}`;
const CLIENT = '198.51.100.7';
const HASH = '$2b$12$abcdefghijklmnopqrstuuJ2s4L6rjpDLHi3qL7Nn5D0o3M6a1g2a';
const IDENTITY = { roles: [{ id: 'viewer', label: 'Viewer' }], attributes: ['displayName'] };
const GATEKEEPER_DIST = new URL('../../../sdks/gatekeeper/dist/', import.meta.url);

const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  trace() {},
  fatal() {},
  child() {
    return logger;
  },
};

let dir;
let npm;
let stateDir;
let usersFile;
let users;
let lib;
let gatekeeper;
let gk;
let panel;
let relayKey;
let previousDispatcher;
let piyasa;
const halves = {};

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
  );
}

/**
 * A fake agent half: core's identity projection and handlers on
 * `/admin/identity/*`, and on every other path core's caller-assertion
 * verifier, as a real half — echoing who it got, what, and which headers,
 * with a `Set-Cookie` the browser must never see, and its answer signed.
 */
async function startFakeHalf(route) {
  const half = {
    route,
    configPath: path.join(dir, `${route}-half.json`),
    requests: [],
    handlers: null,
    verifier: null,
  };
  const projection = createIdentityProjection({ db: new DatabaseSync(':memory:') });
  half.writeConfig = async (secret) => {
    await writeFile(
      half.configPath,
      JSON.stringify({
        plugin: route,
        port: half.port,
        secret,
        issuedAt: new Date().toISOString(),
        fetchedAt: new Date().toISOString(),
        acknowledged: true,
      }),
      { mode: 0o600 },
    );
    half.verifier = createCallerAssertionVerifier({ configPath: half.configPath, plugin: route });
    half.handlers = createIdentityHandlers({ verifier: half.verifier, projection });
  };
  half.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      if (req.url.startsWith('/admin/identity') && half.handlers) {
        const out = await half.handlers.handle({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        });
        res.writeHead(out.status, out.headers);
        res.end(out.bodyText);
        return;
      }
      const verified = half.verifier
        ? await half.verifier.verify(req.headers, req.method, req.url)
        : { ok: false, reason: 'no config' };
      if (!verified.ok) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'caller assertion refused', reason: verified.reason }));
        return;
      }
      const seen = {
        method: req.method,
        url: req.url,
        caller: verified.payload.caller,
        body: body.toString('utf-8'),
        cookie: req.headers.cookie ?? null,
        authorization: req.headers.authorization ?? null,
        relayAssertion: req.headers[RELAY_ASSERTION_HEADER] ?? null,
        clientCert: req.headers['x-ssl-client-verify'] ?? null,
        remoteUser: req.headers['remote-user'] ?? null,
      };
      half.requests.push(seen);
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': 'half=1; Path=/',
        ...responderHeaderFor(verified, 200),
      });
      res.end(JSON.stringify(seen));
    });
  });
  half.port = await listen(half.server);
  halves[route] = half;
  return half;
}

async function saveUsers() {
  await writeFile(usersFile, yaml.dump({ users }, { lineWidth: -1 }), { mode: 0o660 });
  await lib.reconcileDirectory({ confirmDelayMs: 0 });
}

const person = (displayname) => ({
  displayname,
  email: `${displayname.toLowerCase().replace(/[^a-z]/g, '')}@relay.test`,
  password: HASH,
  groups: [],
});

function entitle(username, resourceId = 'ux') {
  return gatekeeper.addGrant({
    principalType: 'user',
    principalId: username,
    resourceType: 'plugin',
    resourceId,
    context: { roles: ['viewer'] },
  });
}

async function enroll(label) {
  const registry = await lib.loadAgentRegistry();
  registry.agents.push({
    label,
    serial: crypto.randomBytes(8).toString('hex'),
    capabilities: ['tunnels:read'],
    allowedSites: [],
    enrollmentMethod: 'p12',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    revoked: false,
  });
  await lib.saveAgentRegistry(registry);
}

async function install(name, manifest) {
  await npm.publish(`@lamalibre/${name}-server`, '1.0.0', {
    'lamaste-plugin.json': JSON.stringify({ name, version: '1.0.0', ...manifest }),
  });
  await lib.installPlugin(`@lamalibre/${name}-server`, logger);
  await lib.enablePlugin(name, logger);
  const plugin = await lib.findPlugin(name);
  const approval = lib.installedApproval(plugin);
  if (approval.required) {
    await lib.approveHookSet(plugin, approval.digest, {
      actor: 'admin',
      certSerial: null,
      logger,
    });
  }
  await lib.hostPlugin(name, 'vm1', { actor: 'admin', logger, sourceIp: IP });
  const done = await lib.waitForPluginOperation(name);
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  await lib.identityIdle();
}

/**
 * A request as nginx handles it on the bound host: the user-surface
 * location asks Gatekeeper, then passes the request — with Gatekeeper's
 * assertion and none of the browser's credentials — to the panel; a 401
 * from Gatekeeper is answered with its unauthenticated endpoint's JSON, a
 * 403 as is.
 */
async function viaNginx(method, target, { cookie = 'authelia_session=ayse', origin, body } = {}) {
  const authz = await gk.inject({
    method: 'GET',
    url: `/authz/user-surface/${HOST}`,
    headers: {
      host: HOST,
      'x-original-url': `https://${HOST}${target}`,
      'x-original-method': method,
      ...(cookie ? { cookie } : {}),
    },
  });
  if (authz.statusCode === 401) {
    return gk.inject({ method: 'GET', url: '/authz/user-surface-unauthenticated' });
  }
  if (authz.statusCode !== 200) return authz;
  return panel.inject({
    method,
    url: target,
    headers: {
      host: HOST,
      'x-forwarded-for': CLIENT,
      'x-forwarded-proto': 'https',
      [RELAY_ASSERTION_HEADER]: authz.headers[RELAY_ASSERTION_HEADER],
      ...(origin ? { origin } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { payload: body }),
  });
}

/** An assertion for the panel signed with the relay key — as Gatekeeper would sign one. */
function vouch(method, target, { username = 'ayse', route = 'ux', iat } = {}) {
  return signRelayAssertion(
    {
      aud: RELAY_PANEL_AUDIENCE,
      port: RELAY_PANEL_PORT,
      caller: { type: 'user', username },
      method,
      target: { route, path: target },
      ...(iat === undefined ? {} : { iat }),
    },
    relayKey,
  );
}

/** A request straight to the panel with `headers` (no Gatekeeper). */
function direct(method, target, headers = {}) {
  return panel.inject({
    method,
    url: target,
    headers: { host: HOST, 'x-forwarded-for': CLIENT, ...headers },
  });
}

/** The panel-vhost headers of an mTLS administrator (what nginx sets on panel.<domain>). */
const ADMIN_CERT = {
  'x-ssl-client-verify': 'SUCCESS',
  'x-ssl-client-dn': 'CN=admin,O=Lamaste',
  'x-ssl-client-serial': '0A1B',
};

before(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'lamaste-s6-panel-')));
  stateDir = path.join(dir, 'state');
  await mkdir(stateDir);
  usersFile = path.join(dir, 'users.yml');
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_PKI_DIR = path.join(stateDir, 'pki');
  process.env.LAMALIBRE_LAMASTE_CONFIG = path.join(stateDir, 'panel.json');
  await writeFile(
    process.env.LAMALIBRE_LAMASTE_CONFIG,
    JSON.stringify({
      ip: '203.0.113.10',
      domain: 'relay.test',
      email: 'ops@relay.test',
      dataDir: stateDir,
      onboarding: { status: 'COMPLETED' },
    }),
  );
  npm = await installFakeNpm(path.join(dir, 'npm'));
  const sudo = await installFakeSudo(path.join(dir, 'nginx'));

  lib = {
    ...(await import('../src/lib/state-db.js')),
    ...(await import('../src/lib/config.js')),
    ...(await import('../src/lib/state.js')),
    ...(await import('../src/lib/mtls.js')),
    ...(await import('../src/lib/authelia.js')),
    ...(await import('../src/lib/gatekeeper-client.js')),
    ...(await import('../src/lib/directory.js')),
    ...(await import('../src/lib/audience.js')),
    ...(await import('../src/lib/nginx.js')),
    ...(await import('../src/lib/plugins.js')),
    ...(await import('../src/lib/plugin-hooks.js')),
    ...(await import('../src/lib/plugin-hosting.js')),
    ...(await import('../src/lib/plugin-lifecycle.js')),
    ...(await import('../src/lib/plugin-operations.js')),
    ...(await import('../src/lib/hook-pipelines.js')),
    ...(await import('../src/lib/identity-sync.js')),
    ...(await import('../src/lib/relay-signing.js')),
    ...(await import('../src/lib/user-surface.js')),
  };
  await lib.loadConfig();
  lib.setOidcSyncForTests(async () => null);
  lib.setAutheliaForTests({ usersFile, restart: async () => {}, writeTotp: async () => {} });
  lib.setUserSurfaceReconcileDepsForTests(sudo.reconcileDeps(lib));
  gatekeeper = installFakeGatekeeper(lib);
  lib.setTunnelOpsForTests({
    async create(ctx) {
      return { id: `tunnel-${ctx.route}`, port: halves[ctx.route].port };
    },
    async enable() {},
    async remove() {},
    async waitForAgentHalf(record) {
      await halves[record.plugin].writeConfig(record.current.secret);
    },
  });
  // The relay key: the panel creates it, Gatekeeper and this test sign with it.
  relayKey = await lib.relaySigner.current();

  users = {
    admin: { ...person('Admin'), groups: ['admins'] },
    ayse: person('Ayşe Yılmaz'),
    mehmet: person('Mehmet Kaya'),
    deniz: person('Deniz Ak'),
    zeynep: person('Zeynep Ak'),
  };
  await saveUsers();
  await enroll('vm1');
  await startFakeHalf('ux');
  await startFakeHalf('nx');
  for (const username of ['ayse', 'mehmet', 'zeynep']) entitle(username);
  // ux declares identity; nx is hosted without it.
  await install('ux', { hosting: 'agent', agent: {}, identity: IDENTITY });
  await install('nx', { hosting: 'agent', agent: {} });
  assert.equal((await lib.identityReadiness('ux')).ready, true);

  piyasa = {
    id: crypto.randomUUID(),
    subdomain: 'piyasa',
    fqdn: HOST,
    port: 20010,
    description: null,
    type: 'app',
    accessMode: 'authenticated',
    enabled: true,
    createdAt: new Date().toISOString(),
    agentLabel: 'vm1',
    maxBodySizeMb: 10,
  };
  await lib.writeTunnels([...(await lib.readTunnels()), piyasa]);
  for (const route of ['ux', 'nx']) {
    await lib.bindTunnelUserSurface(piyasa.id, route, { actor: 'admin', logger });
  }

  // Authelia's verify endpoint, for Gatekeeper: one user per session cookie.
  const mock = new MockAgent();
  previousDispatcher = getGlobalDispatcher();
  setGlobalDispatcher(mock);
  const authelia = mock.get('http://127.0.0.1:9091');
  for (const username of ['ayse', 'mehmet', 'deniz', 'zeynep']) {
    authelia
      .intercept({
        path: '/api/authz/auth-request',
        method: 'GET',
        headers: { cookie: `authelia_session=${username}` },
      })
      .reply(200, '', { headers: { 'remote-user': username, 'remote-groups': '' } })
      .persist();
  }
  authelia.intercept({ path: '/api/authz/auth-request', method: 'GET' }).reply(401, '').persist();

  // Gatekeeper's authorization routes, reading tunnels.json as it does.
  const { default: Fastify } = await import('fastify');
  const { authzRoutes } = await import(new URL('server/routes/authz.js', GATEKEEPER_DIST).href);
  const { tunnelInfoFromState } = await import(new URL('lib/tunnels.js', GATEKEEPER_DIST).href);
  gk = Fastify({ logger: false });
  const sessions = new Map();
  const gkSigner = createRelaySigner(path.join(stateDir, 'relay-signing-key.json'), {
    create: false,
  });
  gk.decorate('getTunnels', () =>
    tunnelInfoFromState(JSON.parse(readFileSync(path.join(stateDir, 'tunnels.json'), 'utf-8'))),
  );
  gk.decorate('getSessionCache', () => sessions);
  gk.decorate('getCacheVersion', () => 1);
  gk.decorate('getSettings', () => ({}));
  gk.decorate('getRelaySigner', () => gkSigner);
  await gk.register(authzRoutes);
  await gk.ready();

  // The panel: its root rate limit, the protected context (real mTLS
  // middleware, role guard and admin forwarder) and the user-surface
  // context — on one router, as index.js registers them.
  const { default: rateLimit } = await import('@fastify/rate-limit');
  const { trustLocalNginxHop } = await import('../src/lib/trust-proxy.js');
  const { default: mtls } = await import('../src/middleware/mtls.js');
  const { default: roleGuard } = await import('../src/middleware/role-guard.js');
  const { default: errorHandler } = await import('../src/middleware/errors.js');
  const { default: agentForwarderRoutes } = await import('../src/routes/agent-forwarder.js');
  const { default: userSurfaceContext } = await import('../src/routes/user-surface.js');
  panel = Fastify({ logger: false, trustProxy: trustLocalNginxHop });
  await panel.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1', '::1'],
  });
  panel.register(async function protectedContext(scope) {
    scope.register(mtls);
    scope.register(roleGuard);
    scope.register(errorHandler);
    scope.register(agentForwarderRoutes, { prefix: '/api' });
  });
  panel.register(userSurfaceContext);
  await panel.ready();
});

after(async () => {
  await panel?.close();
  await gk?.close();
  if (previousDispatcher) setGlobalDispatcher(previousDispatcher);
  await lib.identityIdle();
  lib.setTunnelOpsForTests(null);
  lib.setOidcSyncForTests(null);
  lib.setAutheliaForTests(null);
  lib.setGatekeeperClientForTests(null);
  lib.setUserSurfaceReconcileDepsForTests(null);
  for (const half of Object.values(halves)) half.server.close();
  await rm(dir, { recursive: true, force: true });
});

test('end to end: the half sees the directory’s user on /app/<rest>, and nothing of the browser’s credentials', async () => {
  const ayse = await lib.findDirectoryUser('ayse');
  const res = await viaNginx('GET', '/api/ux/app/me?days=7');
  assert.equal(res.statusCode, 200, res.body);
  const seen = res.json();
  assert.deepEqual(seen.caller, {
    type: 'user',
    userId: ayse.userId,
    username: 'ayse',
    roles: ['viewer'],
  });
  assert.equal(seen.url, '/app/me?days=7');
  for (const field of ['cookie', 'authorization', 'relayAssertion', 'clientCert', 'remoteUser']) {
    assert.equal(seen[field], null, field);
  }
  assert.equal(res.headers['set-cookie'], undefined, 'Set-Cookie never reaches the browser');
  assert.equal(res.headers['x-lamalibre-responder'], undefined);

  for (const [target, expected] of [
    ['/api/ux/app', '/app'],
    ['/api/ux/app/', '/app/'],
  ]) {
    const bare = await viaNginx('GET', target);
    assert.equal(bare.statusCode, 200, target);
    assert.equal(bare.json().url, expected);
  }
});

test('401 JSON without a valid assertion: none, replayed, expired, or bound to another path or method', async () => {
  const target = '/api/ux/app/me';
  const before = halves.ux.requests.length;
  const once = vouch('GET', target);
  assert.equal((await direct('GET', target, { [RELAY_ASSERTION_HEADER]: once })).statusCode, 200);
  for (const [label, headers] of [
    ['none', {}],
    ['garbage', { [RELAY_ASSERTION_HEADER]: 'x.y' }],
    ['replayed', { [RELAY_ASSERTION_HEADER]: once }],
    ['expired', { [RELAY_ASSERTION_HEADER]: vouch('GET', target, { iat: Date.now() - 120_000 }) }],
    ['another path', { [RELAY_ASSERTION_HEADER]: vouch('GET', '/api/ux/app/other') }],
    ['another method', { [RELAY_ASSERTION_HEADER]: vouch('DELETE', target) }],
    [
      'another route',
      { [RELAY_ASSERTION_HEADER]: vouch('GET', '/api/nx/app/me', { route: 'nx' }) },
    ],
  ]) {
    const res = await direct('GET', target, headers);
    assert.equal(res.statusCode, 401, label);
    assert.deepEqual(res.json(), { error: 'unauthenticated' }, label);
    assert.match(res.headers['content-type'], /application\/json/, label);
  }
  assert.equal(halves.ux.requests.length, before + 1, 'only the first reached the half');

  // Its own rate limit, keyed by the client nginx saw — not the panel's
  // 100/min, which would have refused a page's worth of requests by now.
  for (let i = 0; i < 110; i += 1) {
    const res = await direct('GET', target);
    assert.equal(res.statusCode, 401, `request ${i}`);
    assert.equal(res.headers['x-ratelimit-limit'], '1200');
  }

  // No session at Gatekeeper: nginx answers with its JSON, never a redirect.
  const anonymous = await viaNginx('GET', target, { cookie: null });
  assert.equal(anonymous.statusCode, 401);
  assert.deepEqual(anonymous.json(), { error: 'unauthenticated' });
  assert.equal(anonymous.headers.location, undefined);
});

test('403 for a disabled, removed or unentitled user, and while a username’s earlier holder has grants to clear', async () => {
  const target = '/api/ux/app/me';
  assert.equal(
    (await viaNginx('GET', target, { cookie: 'authelia_session=mehmet' })).statusCode,
    200,
  );

  users.mehmet.disabled = true;
  await saveUsers();
  const disabled = await viaNginx('GET', target, { cookie: 'authelia_session=mehmet' });
  assert.equal(disabled.statusCode, 403, 'at once — the Authelia session is still cached');
  assert.deepEqual(disabled.json(), { error: 'This user is disabled' });

  const unentitled = await viaNginx('GET', target, { cookie: 'authelia_session=deniz' });
  assert.equal(unentitled.statusCode, 403);
  assert.deepEqual(unentitled.json(), { error: 'This user may not use this plugin' });

  // zeynep leaves users.yml (outside Lamaste) — and comes back as someone
  // else while Gatekeeper still holds the first zeynep's grant.
  gatekeeper.state.unreachable = true;
  delete users.zeynep;
  await saveUsers();
  const removed = await viaNginx('GET', target, { cookie: 'authelia_session=zeynep' });
  assert.equal(removed.statusCode, 403);
  users.zeynep = person('Zeynep Başka');
  await saveUsers();
  assert.ok(await lib.principalCleanupPending('zeynep'));
  const pending = await viaNginx('GET', target, { cookie: 'authelia_session=zeynep' });
  assert.equal(pending.statusCode, 403);
  assert.deepEqual(pending.json(), { error: 'This user may not use this plugin' });
  gatekeeper.state.unreachable = false;

  const reached = halves.ux.requests.filter((r) => r.caller.username !== 'ayse');
  assert.deepEqual(
    reached.map((r) => r.caller.username),
    ['mehmet'],
    'nothing refused reached the half',
  );
});

test('503 before the half answered protocol 1, for a disabled plugin, and before onboarding', async () => {
  const target = '/api/ux/app/me';
  await lib.forgetIdentityHalf('ux');
  const notReady = await viaNginx('GET', target);
  assert.equal(notReady.statusCode, 503);
  assert.deepEqual(notReady.json(), { error: 'The plugin is not ready for its users yet' });
  await lib.syncPluginIdentity('ux', { logger });
  assert.equal((await viaNginx('GET', target)).statusCode, 200, 'ready again once it answered');

  await lib.disablePlugin('ux', logger);
  try {
    const disabled = await viaNginx('GET', target);
    assert.equal(disabled.statusCode, 503);
    assert.deepEqual(disabled.json(), { error: 'The plugin is not available right now' });
  } finally {
    await lib.enablePlugin('ux', logger);
  }

  await lib.updateConfig({ onboarding: { status: 'PROVISIONING' } });
  try {
    const onboarding = await direct('GET', target, {
      [RELAY_ASSERTION_HEADER]: vouch('GET', target),
    });
    assert.equal(onboarding.statusCode, 503);
    assert.equal(onboarding.json().error, 'Onboarding not complete');
  } finally {
    await lib.updateConfig({ onboarding: { status: 'COMPLETED' } });
  }
});

test('404 for a plugin without identity, and for a route no host is bound to', async () => {
  const noIdentity = await viaNginx('GET', '/api/nx/app/me');
  assert.equal(noIdentity.statusCode, 404);
  assert.equal(halves.nx.requests.length, 0);

  // Gatekeeper would not vouch for an unbound route; the panel does not serve one either.
  const unbound = await direct('GET', '/api/wx/app/me', {
    [RELAY_ASSERTION_HEADER]: vouch('GET', '/api/wx/app/me', { route: 'wx' }),
  });
  assert.equal(unbound.statusCode, 404);
  assert.equal((await viaNginx('GET', '/api/wx/app/me')).statusCode, 403);
});

test('a request that may change something needs the bound host’s Origin', async () => {
  const target = '/api/ux/app/notes';
  for (const origin of [
    undefined,
    'https://evil.example.com',
    'https://panel.relay.test',
    'null',
  ]) {
    const res = await viaNginx('POST', target, { origin, body: '{"note":"x"}' });
    assert.equal(res.statusCode, 403, String(origin));
    assert.deepEqual(res.json(), { error: 'cross-origin request refused' });
  }
  const ok = await viaNginx('POST', target, { origin: ORIGIN, body: '{"note":"hello"}' });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().method, 'POST');
  assert.equal(ok.json().body, '{"note":"hello"}');
});

test('a restricted tunnel lets through only users with its grant', async () => {
  const tunnels = await lib.readTunnels();
  await lib.writeTunnels(
    tunnels.map((t) => (t.id === piyasa.id ? { ...t, accessMode: 'restricted' } : t)),
  );
  try {
    // Gatekeeper's own grants of the tunnel: ayse has none yet.
    const refused = await viaNginx('GET', '/api/ux/app/me');
    assert.equal(refused.statusCode, 403);
    const { createGrant } = await import(new URL('lib/grants.js', GATEKEEPER_DIST).href);
    await createGrant({
      principalType: 'user',
      principalId: 'ayse',
      resourceType: 'tunnel',
      resourceId: piyasa.id,
    });
    assert.equal((await viaNginx('GET', '/api/ux/app/me')).statusCode, 200);
  } finally {
    await lib.writeTunnels(tunnels);
  }
});

test('/api/<route>/app is the user surface’s, never the admin forwarder’s — which keeps the rest', async () => {
  // An administrator through the panel vhost: nginx clears any relay
  // assertion the client sent, so none arrives.
  const before = halves.ux.requests.length;
  for (const target of ['/api/ux/app', '/api/ux/app/settings', '/api/ux/app?x=1']) {
    const res = await direct('GET', target, ADMIN_CERT);
    assert.equal(res.statusCode, 401, target);
    assert.deepEqual(res.json(), { error: 'unauthenticated' });
  }
  assert.equal(halves.ux.requests.length, before, 'the half saw none of them');

  // Its other routes still go to the half's /admin/* as the administrator.
  for (const [target, expected] of [
    ['/api/ux/status', '/admin/status'],
    ['/api/ux/apps', '/admin/apps'],
    ['/api/ux/App/x', '/admin/App/x'],
  ]) {
    const res = await direct('GET', target, ADMIN_CERT);
    assert.equal(res.statusCode, 200, `${target}: ${res.body}`);
    assert.equal(res.json().url, expected);
    assert.deepEqual(res.json().caller, { type: 'admin' });
  }
  assert.ok(
    !halves.ux.requests.some((r) => /^\/admin\/app(?:[/?]|$)/.test(r.url)),
    'the half’s /admin/app is out of reach',
  );
  // Without a certificate the forwarder answers nothing at all; an agent
  // without the plugin's capability is refused — under the panel's own limit.
  assert.equal((await direct('GET', '/api/ux/status')).statusCode, 403);
  const agent = await direct('GET', '/api/ux/status', {
    ...ADMIN_CERT,
    'x-ssl-client-dn': 'CN=agent:vm1,O=Lamaste',
  });
  assert.equal(agent.statusCode, 403);
  assert.equal(agent.json().error, 'Insufficient scope for plugin route');
  assert.equal(agent.headers['x-ratelimit-limit'], '100');
});
