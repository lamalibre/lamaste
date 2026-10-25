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
 *
 * And the wave-A hardening, end to end: a host whose tunnel is carried by
 * another agent than the plugin's hosting agent serves nothing of it
 * (Gatekeeper refuses, and so does the panel for an assertion it got
 * anyway); nothing reaches the half while its hosting is down (503); two
 * session cookies are a 401; an encoded `%` never passes; every answer
 * carries the user surface's headers; and an open response — a stream — is
 * ended by the panel's sweep once its user is disabled or loses the
 * entitlement.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

import {
  RELAY_ASSERTION_HEADER,
  RELAY_PANEL_AUDIENCE,
  RELAY_PANEL_PORT,
  createRelaySigner,
  parseDomainsProjection,
  signRelayAssertion,
} from '@lamalibre/lamaste';
import {
  createCallerAssertionVerifier,
  createIdentityHandlers,
  createIdentityProjection,
  responderHeaderFor,
} from '@lamalibre/lamaste/agent';

import { createFakeAutheliaStorage } from './fake-authelia-storage.js';
import { updatePluginHostingHealth, withTunnelLock } from '@lamalibre/lamaste/server';

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
let autheliaStorage;
let gk;
let panel;
let relayKey;
let previousDispatcher;
let piyasa;
const halves = {};
/** The open `/app/stream` responses of the fake halves: closed when the relay ends them. */
const streams = [];

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
      if (req.url === '/app/stream') {
        // Server-sent events that never end on their own.
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          ...responderHeaderFor(verified, 200),
        });
        res.write('data: hello\n\n');
        const stream = { route, caller: verified.payload.caller, closed: false };
        streams.push(stream);
        res.on('close', () => {
          stream.closed = true;
        });
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
  // The mTLS middleware treats every request as the administrator under
  // NODE_ENV=development; these tests exercise the checks a relay runs.
  process.env.NODE_ENV = 'production';
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
  autheliaStorage = createFakeAutheliaStorage();
  lib.setAutheliaForTests({
    // No Authelia configuration to render the domains into.
    domainAccess: async () => ({ changed: false }),
    usersFile,
    restart: async () => {},
    writeTotp: async () => {},
    userStorage: autheliaStorage.storage,
  });
  // What the panel's start does: the primary domain, everyone its member.
  await (await import('../src/lib/domains.js')).ensurePrimaryDomain();
  lib.setUserSurfaceReconcileDepsForTests(sudo.reconcileDeps(lib));
  gatekeeper = installFakeGatekeeper(lib);
  // Hosting's internal tunnel, written to tunnels.json as createTunnel
  // writes it — on the fake half's port (no chisel here to grant it).
  lib.setTunnelOpsForTests({
    async create(ctx) {
      const entry = {
        id: `tunnel-${ctx.route}`,
        subdomain: null,
        fqdn: null,
        port: halves[ctx.route].port,
        description: `Internal tunnel of plugin ${ctx.plugin.name}`,
        type: 'plugin',
        exposure: 'internal',
        enabled: false,
        createdAt: new Date().toISOString(),
        pluginName: ctx.plugin.packageName,
        pluginRoute: ctx.route,
        agentLabel: ctx.agentLabel,
        maxBodySizeMb: 10,
      };
      await withTunnelLock(async () => {
        await lib.writeTunnels([...(await lib.readTunnels()), entry]);
      });
      return entry;
    },
    async enable(ctx) {
      await withTunnelLock(async () => {
        const tunnels = await lib.readTunnels();
        await lib.writeTunnels(
          tunnels.map((t) => (t.id === ctx.tunnelId ? { ...t, enabled: true } : t)),
        );
      });
    },
    async remove(ctx) {
      await withTunnelLock(async () => {
        await lib.writeTunnels((await lib.readTunnels()).filter((t) => t.id !== ctx.tunnelId));
      });
    },
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

  // Gatekeeper's authorization routes, reading tunnels.json and sites.json as it does.
  const { default: Fastify } = await import('fastify');
  const { authzRoutes } = await import(new URL('server/routes/authz.js', GATEKEEPER_DIST).href);
  const { tunnelInfoFromState } = await import(new URL('lib/tunnels.js', GATEKEEPER_DIST).href);
  const { userSurfaceHosts } = await import('@lamalibre/lamaste');
  const readState = (file) => {
    try {
      return JSON.parse(readFileSync(path.join(stateDir, file), 'utf-8'));
    } catch {
      return [];
    }
  };
  // Who may reach the domain, rendered as the panel's identity tick does.
  await (await import('../src/lib/domains.js')).syncDomainAccess();
  gk = Fastify({ logger: false });
  const sessions = new Map();
  const gkSigner = createRelaySigner(path.join(stateDir, 'relay-signing-key.json'), {
    create: false,
  });
  gk.decorate('getTunnels', () => tunnelInfoFromState(readState('tunnels.json')));
  gk.decorate('getUserSurfaceHosts', () =>
    userSurfaceHosts(readState('tunnels.json'), readState('sites.json')),
  );
  // The projection the panel writes (lib/domains.js), as Gatekeeper reads it.
  gk.decorate('getDomains', () => parseDomainsProjection(readState('domains.json')));
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

// ---------------------------------------------------------------------------
// Wave A: the hosting agent, a hosting that is down, cookies, paths, headers
// and open responses
// ---------------------------------------------------------------------------

/** Rewrite one tunnel in tunnels.json under the tunnel lock. */
async function patchTunnel(id, patch) {
  await withTunnelLock(async () => {
    const tunnels = await lib.readTunnels();
    await lib.writeTunnels(tunnels.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  });
}

test('a host whose tunnel another agent carries serves nothing of the plugin — Gatekeeper and the panel refuse', async () => {
  await enroll('vm9');
  await patchTunnel(piyasa.id, { agentLabel: 'vm9' });
  try {
    const before = halves.ux.requests.length;
    // Gatekeeper reads the same tunnels.json: the route is bound, not served.
    const refused = await viaNginx('GET', '/api/ux/app/me');
    assert.equal(refused.statusCode, 403);
    assert.equal(refused.headers[RELAY_ASSERTION_HEADER], undefined);
    // An assertion it got anyway (a vhost not yet re-rendered): the panel refuses.
    const target = '/api/ux/app/me';
    const direct404 = await direct('GET', target, {
      [RELAY_ASSERTION_HEADER]: vouch('GET', target),
    });
    assert.equal(direct404.statusCode, 404);
    assert.equal(halves.ux.requests.length, before, 'nothing reached the half');
    const tunnel = await lib.withUserSurfaceStatus(
      (await lib.readTunnels()).find((t) => t.id === piyasa.id),
    );
    assert.deepEqual(
      tunnel.userSurfaceStatus.find((st) => st.route === 'ux'),
      { route: 'ux', served: false, reason: 'not_hosting_agent' },
    );
  } finally {
    await patchTunnel(piyasa.id, { agentLabel: 'vm1' });
  }
  assert.equal((await viaNginx('GET', '/api/ux/app/me')).statusCode, 200);
});

test('nothing reaches the agent half while its hosting is down — not a user’s request, not an administrator’s', async () => {
  const stateDir = process.env.LAMALIBRE_LAMASTE_STATE_DIR;
  const before = halves.ux.requests.length;
  for (const reason of ['app', 'tunnel']) {
    await updatePluginHostingHealth(stateDir, 'ux', {
      state: 'down',
      since: new Date().toISOString(),
      reason,
    });
    try {
      // The user surface: 503.
      const res = await viaNginx('GET', '/api/ux/app/me');
      assert.equal(res.statusCode, 503, reason);
      assert.deepEqual(res.json(), { error: 'The plugin is not available right now' });
      // The admin API: what a request into a dead tunnel gets, with the reason.
      const admin = await direct('GET', '/api/ux/status', ADMIN_CERT);
      assert.equal(admin.statusCode, 502, reason);
      assert.equal(admin.json().reason, reason);
      // Without a certificate it still learns nothing.
      assert.equal((await direct('GET', '/api/ux/status')).statusCode, 403);
      assert.equal(halves.ux.requests.length, before, `${reason}: nothing reached the port`);
    } finally {
      await updatePluginHostingHealth(stateDir, 'ux', {
        state: 'up',
        since: new Date().toISOString(),
      });
    }
  }
  assert.equal((await viaNginx('GET', '/api/ux/app/me')).statusCode, 200);
  assert.equal((await direct('GET', '/api/ux/status', ADMIN_CERT)).statusCode, 200);
});

test('two session cookies are a 401; an encoded % never passes; every answer carries the user-surface headers', async () => {
  const twice = await viaNginx('GET', '/api/ux/app/me', {
    cookie: 'authelia_session=ayse; authelia_session=mehmet',
  });
  assert.equal(twice.statusCode, 401);
  assert.deepEqual(twice.json(), { error: 'unauthenticated' });

  for (const target of ['/api/ux/app/%252e%252e/admin/x', '/api/ux/app/%25']) {
    const res = await viaNginx('GET', target);
    assert.equal(res.statusCode, 403, target);
    // No relay assertion can even be signed for it.
    assert.throws(() => vouch('GET', target), /not on the route's user surface/, target);
  }

  for (const [label, res] of [
    ['forwarded', await viaNginx('GET', '/api/ux/app/me')],
    ['401', await direct('GET', '/api/ux/app/me')],
    ['403', await viaNginx('GET', '/api/ux/app/me', { cookie: 'authelia_session=deniz' })],
    ['404', await viaNginx('GET', '/api/nx/app/me')],
  ]) {
    assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin', label);
    assert.equal(res.headers['x-content-type-options'], 'nosniff', label);
    assert.equal(res.headers['content-security-policy'], "sandbox; default-src 'none'", label);
    for (const name of Object.keys(res.headers)) {
      assert.ok(!name.startsWith('access-control-'), `${label}: ${name}`);
    }
  }
  // The panel's CORS never answers for a user surface — not even its own origin.
  const preflight = await direct('OPTIONS', '/api/ux/app/me', {
    origin: 'https://panel.relay.test',
    'access-control-request-method': 'POST',
  });
  assert.equal(preflight.headers['access-control-allow-origin'], undefined);
});

/**
 * Open a stream on `/api/<route>/app/stream` as `username`, the way nginx
 * passes it: Gatekeeper's assertion, then the panel over a real connection.
 */
async function openStream(port, route, username) {
  const target = `/api/${route}/app/stream`;
  const authz = await gk.inject({
    method: 'GET',
    url: `/authz/user-surface/${HOST}`,
    headers: {
      host: HOST,
      'x-original-url': `https://${HOST}${target}`,
      'x-original-method': 'GET',
      cookie: `authelia_session=${username}`,
    },
  });
  assert.equal(authz.statusCode, 200, authz.body);
  const res = await new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: target,
        headers: {
          host: HOST,
          'x-forwarded-for': CLIENT,
          [RELAY_ASSERTION_HEADER]: authz.headers[RELAY_ASSERTION_HEADER],
        },
      },
      resolve,
    );
    req.on('error', reject);
  });
  assert.equal(res.statusCode, 200);
  let data = '';
  const ended = new Promise((resolve) => {
    res.on('data', (chunk) => {
      data += chunk.toString('utf-8');
    });
    res.on('end', () => resolve(data));
    res.on('close', () => resolve(data));
  });
  return { res, ended, data: () => data };
}

async function waitFor(check, label) {
  for (let i = 0; i < 400; i += 1) {
    if (await check()) return;
    await sleep(10);
  }
  assert.fail(`timed out waiting for ${label}`);
}

test('an open response is ended once its user is disabled, loses the entitlement or other roles, or the host stops serving it — and the half’s request with it', async () => {
  await panel.listen({ port: 0, host: '127.0.0.1' });
  const port = panel.server.address().port;
  const ayse = await lib.findDirectoryUser('ayse');
  const ended = [];
  /** A response tracked as the user surface tracks one, to see what the sweep makes of it. */
  const track = (caller) => {
    const response = {
      route: 'ux',
      plugin: 'ux',
      caller,
      startedAt: Date.now(),
      end: (reason) => ended.push({ caller, reason }),
    };
    return lib.trackUserSurfaceResponse(response);
  };
  try {
    // Two streams of ayse's; nothing changed — the sweep ends nothing.
    const first = streams.length;
    const one = await openStream(port, 'ux', 'ayse');
    const two = await openStream(port, 'ux', 'ayse');
    await waitFor(() => streams.length >= first + 2, 'both streams at the half');
    assert.equal(lib.openUserSurfaceResponseCount(), 2);
    assert.equal(await lib.sweepOpenUserSurfaceResponses(logger), 0);
    assert.equal(streams[first].closed, false);

    // Disabled: every response of hers ends at the next sweep, the half's too.
    users.ayse.disabled = true;
    await saveUsers();
    assert.equal(await lib.sweepOpenUserSurfaceResponses(logger), 2);
    assert.match(await one.ended, /data: hello/);
    await two.ended;
    await waitFor(
      () => streams[first].closed && streams[first + 1].closed,
      'the half’s side closed',
    );
    await waitFor(() => lib.openUserSurfaceResponseCount() === 0, 'no response tracked');
    users.ayse.disabled = false;
    await saveUsers();

    // Her entitlement withdrawn (Gatekeeper's grant gone, the audience recomputed).
    const third = streams.length;
    const three = await openStream(port, 'ux', 'ayse');
    await waitFor(() => streams.length > third, 'the stream at the half');
    const index = gatekeeper.grants.findIndex(
      (g) => g.principalId === 'ayse' && g.resourceType === 'plugin',
    );
    const [grant] = gatekeeper.grants.splice(index, 1);
    await lib.recomputeAudiences({ logger });
    assert.equal(await lib.sweepOpenUserSurfaceResponses(logger), 1);
    await three.ended;
    await waitFor(() => streams[third].closed, 'the half’s side closed');
    gatekeeper.grants.push(grant);
    await lib.recomputeAudiences({ logger });

    // Other roles than the response started with; and a host that stopped
    // serving the route (its tunnel moved to another agent).
    const caller = { type: 'user', userId: ayse.userId, username: 'ayse', roles: ['viewer'] };
    const untrackOther = track({ ...caller, roles: ['viewer', 'editor'] });
    const untrackSame = track(caller);
    assert.equal(await lib.sweepOpenUserSurfaceResponses(logger), 1);
    assert.deepEqual(
      ended.map((e) => [e.caller.roles.join(','), e.reason]),
      [['viewer,editor', 'roles_changed']],
    );
    untrackOther();
    await enroll('vm8');
    await patchTunnel(piyasa.id, { agentLabel: 'vm8' });
    try {
      assert.equal(await lib.sweepOpenUserSurfaceResponses(logger), 1);
      assert.deepEqual(ended.at(-1), { caller, reason: 'surface_withdrawn' });
    } finally {
      await patchTunnel(piyasa.id, { agentLabel: 'vm1' });
    }
    untrackSame();
    assert.equal(lib.openUserSurfaceResponseCount(), 0);
  } finally {
    users.ayse.disabled = false;
    await saveUsers();
  }
});
