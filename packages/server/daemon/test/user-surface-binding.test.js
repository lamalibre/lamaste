/**
 * Slice 6, a plugin's user surface bound to a tunnel's host
 * (`PUT /api/tunnels/:id/user-surface`, `DELETE …/user-surface/:route`):
 * only an enabled app tunnel an agent carries, authenticated or restricted,
 * for a route an installed agent-hosted plugin holds — before it declares
 * identity too; a route on one host at most; persisted in tunnels.json and
 * shown in the listing with how each route is served. The vhost carries a
 * route's locations only while its plugin's installed, approved version
 * declares identity — so approving it, the update that brings identity (the
 * pilot's switch-over) and the update that drops it each re-render the
 * vhost; reconfiguring, toggling and moving the tunnel keep the binding, a
 * bound tunnel cannot be made public, and deleting the tunnel or
 * uninstalling the plugin drops it (re-rendered, audited). Every vhost
 * written passes the lamaste-priv allow-list. nginx, certbot and chisel
 * are stand-ins (`fake-sudo.js`), npm too (`fake-npm.js`).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { installFakeNpm } from './fake-npm.js';
import { installFakeSudo } from './fake-sudo.js';

const require = createRequire(import.meta.url);
const { validateVhost } = require(
  fileURLToPath(new URL('../../../provisioners/server/scripts/lamaste-priv', import.meta.url)),
);

const IP = '127.0.0.1';
const VIEWER = { id: 'viewer', label: 'Viewer' };
const IDENTITY = { roles: [VIEWER], attributes: ['displayName'] };

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
const actor = { actor: 'admin', certSerial: '0A1B', logger };

let dir;
let npm;
let sudo;
let lib;
let core;
let app;

/** The tunnels of this test, by name. */
const T = {};

function tunnel(name, overrides = {}) {
  return {
    id: crypto.randomUUID(),
    subdomain: name,
    fqdn: `${name}.relay.test`,
    port: 20000 + Object.keys(T).length,
    description: null,
    type: 'app',
    accessMode: 'authenticated',
    enabled: true,
    createdAt: new Date().toISOString(),
    agentLabel: 'vm1',
    maxBodySizeMb: 10,
    ...overrides,
  };
}

async function publish(name, version, manifest) {
  await npm.publish(`@lamalibre/${name}-server`, version, {
    'lamaste-plugin.json': JSON.stringify({ name, version, ...manifest }),
  });
}

async function install(name, manifest) {
  await publish(name, '1.0.0', manifest);
  await lib.installPlugin(`@lamalibre/${name}-server`, logger);
}

async function approve(name) {
  const plugin = await lib.findPlugin(name);
  await lib.approveHookSet(plugin, lib.installedApproval(plugin).digest, actor);
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

/** A request to the tunnel routes, as an admin unless `role` says otherwise. */
function call(method, url, body, { role = 'admin', label = null } = {}) {
  return app.inject({
    method,
    url,
    headers: {
      'x-test-role': role,
      ...(label ? { 'x-test-label': label } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
}

const bind = (t, route, opts) => call('PUT', `/api/tunnels/${t.id}/user-surface`, { route }, opts);
const unbind = (t, route) => call('DELETE', `/api/tunnels/${t.id}/user-surface/${route}`);

/** The tunnel as stored now. */
async function stored(t) {
  return (await lib.readTunnels()).find((x) => x.id === t.id) ?? null;
}

/** The vhost of a tunnel as nginx would read it now. */
const vhostOf = (t) => sudo.read(`lamalibre-lamaste-app-${t.subdomain}`);

/** Whether a vhost serves `route`'s user surface. */
function serves(vhost, route) {
  return (
    vhost.includes(`location = /api/${route}/app {`) &&
    vhost.includes(`location /api/${route}/app/ {`)
  );
}

async function audits(action) {
  return lib.listAudit({ action });
}

before(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'lamaste-s6-binding-')));
  const stateDir = path.join(dir, 'state');
  await mkdir(stateDir);
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
  sudo = await installFakeSudo(path.join(dir, 'nginx'));

  lib = {
    ...(await import('../src/lib/config.js')),
    ...(await import('../src/lib/state.js')),
    ...(await import('../src/lib/mtls.js')),
    ...(await import('../src/lib/gatekeeper-client.js')),
    ...(await import('../src/lib/nginx.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/plugins.js')),
    ...(await import('../src/lib/plugin-hooks.js')),
    ...(await import('../src/lib/plugin-lifecycle.js')),
    ...(await import('../src/lib/plugin-operations.js')),
    ...(await import('../src/lib/identity-sync.js')),
    ...(await import('../src/lib/user-surface.js')),
  };
  core = await import('@lamalibre/lamaste/server');
  await lib.loadConfig();
  lib.setOidcSyncForTests(async () => null);
  lib.setGatekeeperClientForTests(async () => ({
    ok: false,
    statusCode: 503,
    error: 'gatekeeper unreachable',
    reason: 'unreachable',
  }));
  lib.setUserSurfaceReconcileDepsForTests(sudo.reconcileDeps(lib));

  await enroll('vm1');
  await enroll('vm2');
  // ux declares identity; nx is agent-hosted without it (yet); sx is a
  // server plugin; the others are for the conflict and the uninstall.
  await install('ux', { hosting: 'agent', agent: {}, identity: IDENTITY });
  await install('nx', { hosting: 'agent', agent: {} });
  await install('sx', {});
  await install('wx', { hosting: 'agent', agent: {}, identity: IDENTITY });
  await install('zx', { hosting: 'agent', agent: {}, identity: IDENTITY });
  await approve('wx');
  await approve('zx');

  T.piyasa = tunnel('piyasa');
  T.kamera = tunnel('kamera', { accessMode: 'restricted' });
  T.open = tunnel('open', { accessMode: 'public' });
  T.off = tunnel('off', { enabled: false });
  T.loose = tunnel('loose', { agentLabel: undefined });
  T.herd = tunnel('herd', {
    type: 'plugin',
    pluginName: '@lamalibre/herd-server',
    pluginRoute: 'herd',
  });
  T.internal = {
    ...tunnel('internal'),
    subdomain: null,
    fqdn: null,
    type: 'plugin',
    exposure: 'internal',
    port: 21000,
    pluginName: '@lamalibre/ux-server',
    pluginRoute: 'ux',
  };
  T.spare = tunnel('spare');
  await lib.writeTunnels(Object.values(T));
  for (const t of [T.piyasa, T.spare]) {
    await lib.writeAuthenticatedVhost(t.subdomain, 'relay.test', t.port, undefined, {
      maxBodySizeMb: 10,
    });
  }
  await lib.writeRestrictedVhost('kamera', 'relay.test', T.kamera.port, undefined, {
    maxBodySizeMb: 10,
  });

  // The tunnel routes behind stand-ins for the mTLS middleware: the role
  // and label come from two headers; the real role guard decides.
  const { default: Fastify } = await import('fastify');
  const { default: roleGuard } = await import('../src/middleware/role-guard.js');
  const { default: errorHandler } = await import('../src/middleware/errors.js');
  const { default: tunnelRoutes } = await import('../src/routes/management/tunnels.js');
  app = Fastify({ logger: false });
  app.decorateRequest('certRole', null);
  app.decorateRequest('certLabel', null);
  app.decorateRequest('certCapabilities', null);
  app.addHook('onRequest', async (request) => {
    request.certRole = request.headers['x-test-role'] ?? 'unknown';
    request.certLabel = request.headers['x-test-label'] ?? null;
    request.certCapabilities = ['tunnels:read', 'tunnels:write'];
  });
  await app.register(roleGuard);
  await app.register(errorHandler);
  await app.register(tunnelRoutes, { prefix: '/api' });
  await app.ready();
});

after(async () => {
  await app?.close();
  await lib.identityIdle();
  lib.setUserSurfaceReconcileDepsForTests(null);
  lib.setOidcSyncForTests(null);
  lib.setGatekeeperClientForTests(null);
  await rm(dir, { recursive: true, force: true });
});

test('a binding is accepted before the plugin declares identity, persisted, listed and audited — the vhost waits', async () => {
  const before = await vhostOf(T.piyasa);
  const res = await bind(T.piyasa, 'nx');
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.equal(body.changed, true);
  assert.deepEqual(body.tunnel.userSurface, { routes: ['nx'] });
  assert.deepEqual(body.tunnel.userSurfaceStatus, [
    { route: 'nx', served: false, reason: 'no_identity' },
  ]);
  assert.deepEqual((await stored(T.piyasa)).userSurface, { routes: ['nx'] });
  assert.equal(await vhostOf(T.piyasa), before, 'nothing served yet: the vhost is not rewritten');

  // Declared but not approved: still not served.
  const ux = await bind(T.piyasa, 'ux');
  assert.equal(ux.statusCode, 200, ux.body);
  assert.deepEqual(ux.json().tunnel.userSurfaceStatus, [
    { route: 'nx', served: false, reason: 'no_identity' },
    { route: 'ux', served: false, reason: 'not_approved' },
  ]);
  assert.equal(await vhostOf(T.piyasa), before);

  // Idempotent: a second bind changes and audits nothing.
  const again = await bind(T.piyasa, 'nx');
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().changed, false);
  const bound = await audits('tunnel.user-surface.bound');
  assert.deepEqual(
    bound.map((a) => [a.actor, a.plugin, a.details.route, a.details.tunnelId]).reverse(),
    [
      ['admin', 'nx', 'nx', T.piyasa.id],
      ['admin', 'ux', 'ux', T.piyasa.id],
    ],
  );

  // The listing carries the binding and how each route is served.
  const list = await call('GET', '/api/tunnels?limit=500');
  const listed = list.json().tunnels.find((t) => t.id === T.piyasa.id);
  assert.deepEqual(listed.userSurface, { routes: ['nx', 'ux'] });
  assert.deepEqual(
    listed.userSurfaceStatus.map((s) => [s.route, s.served]),
    [
      ['nx', false],
      ['ux', false],
    ],
  );
  assert.equal(
    list.json().tunnels.find((t) => t.id === T.spare.id).userSurfaceStatus,
    undefined,
    'an unbound tunnel has none',
  );
});

test('only an administrator binds; only a fitting tunnel, for an installed agent-hosted plugin’s route', async () => {
  const snapshot = JSON.stringify(await lib.readTunnels());
  const agent = await bind(T.spare, 'wx', { role: 'agent', label: 'vm1' });
  assert.equal(agent.statusCode, 403);

  for (const [label, res, status, pattern] of [
    ['not a route', await bind(T.spare, 'Bad_Route'), 400, /Validation failed/],
    [
      'extra field',
      await call('PUT', `/api/tunnels/${T.spare.id}/user-surface`, { route: 'wx', x: 1 }),
      400,
      /Validation failed/,
    ],
    [
      'unknown tunnel',
      await call('PUT', `/api/tunnels/${crypto.randomUUID()}/user-surface`, { route: 'wx' }),
      404,
      /Tunnel not found/,
    ],
    ['public', await bind(T.open, 'wx'), 400, /public tunnel/],
    ['disabled', await bind(T.off, 'wx'), 400, /Enable the tunnel/],
    ['no agent', await bind(T.loose, 'wx'), 400, /Assign the tunnel to an agent/],
    ['plugin tunnel', await bind(T.herd, 'wx'), 400, /Only an app tunnel/],
    ['internal tunnel', await bind(T.internal, 'wx'), 400, /Only an app tunnel/],
    ['not installed', await bind(T.spare, 'qx'), 400, /No installed plugin holds/],
    ['server plugin', await bind(T.spare, 'sx'), 400, /not agent-hosted/],
    ['a panel prefix', await bind(T.spare, 'tunnels'), 400, /Invalid plugin route/],
  ]) {
    assert.equal(res.statusCode, status, `${label}: ${res.body}`);
    assert.match(res.json().error, pattern, label);
  }

  // A route on one host at most.
  const conflict = await bind(T.spare, 'ux');
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, 'user_surface_conflict');
  assert.match(conflict.json().error, /already served on piyasa/);
  assert.equal(JSON.stringify(await lib.readTunnels()), snapshot, 'nothing changed');
});

test('approving the version that declares identity makes its host serve it — that route only', async () => {
  const before = await vhostOf(T.piyasa);
  assert.ok(!serves(before, 'ux'));
  await approve('ux');
  const after = await vhostOf(T.piyasa);
  assert.ok(serves(after, 'ux'), 'served from the approval');
  assert.ok(!serves(after, 'nx'), 'no identity, no location');
  assert.match(
    after,
    /proxy_pass http:\/\/127\.0\.0\.1:9294\/authz\/user-surface\/piyasa\.relay\.test;/,
  );
  assert.doesNotThrow(() => validateVhost(after));
  assert.ok(!(await vhostOf(T.kamera)).includes('user-surface'), 'another host untouched');

  const res = await call('GET', '/api/tunnels?limit=500');
  assert.deepEqual(res.json().tunnels.find((t) => t.id === T.piyasa.id).userSurfaceStatus, [
    { route: 'nx', served: false, reason: 'no_identity' },
    { route: 'ux', served: true, reason: null },
  ]);
});

test('the pilot’s switch-over: the update that brings identity starts serving it; one that drops it stops', async () => {
  await publish('nx', '1.1.0', { hosting: 'agent', agent: {}, identity: IDENTITY });
  const staged = await lib.updatePlugin('nx', '1.1.0', { ...actor, sourceIp: IP });
  assert.ok(staged.pendingUpdate, 'identity waits for an administrator');
  assert.ok(!serves(await vhostOf(T.piyasa), 'nx'), 'not before it is approved and in place');

  const approved = await lib.approveHookSet(
    await lib.findPlugin('nx'),
    staged.pendingUpdate.digest,
    { ...actor, version: '1.1.0' },
  );
  await lib.updatePlugin('nx', approved.version, {
    ...actor,
    sourceIp: IP,
    approvedUpdate: approved,
  });
  assert.equal((await lib.waitForPluginOperation('nx')).status, 'succeeded');
  const served = await vhostOf(T.piyasa);
  assert.ok(serves(served, 'nx'), 'served from the update');
  assert.ok(serves(served, 'ux'));
  assert.doesNotThrow(() => validateVhost(served));

  // Dropping identity removes its roles: approved too — and it stops serving it.
  await publish('nx', '1.2.0', { hosting: 'agent', agent: {} });
  const dropped = await lib.updatePlugin('nx', '1.2.0', { ...actor, sourceIp: IP });
  assert.ok(dropped.pendingUpdate);
  const approvedDrop = await lib.approveHookSet(
    await lib.findPlugin('nx'),
    dropped.pendingUpdate.digest,
    { ...actor, version: '1.2.0' },
  );
  await lib.updatePlugin('nx', approvedDrop.version, {
    ...actor,
    sourceIp: IP,
    approvedUpdate: approvedDrop,
  });
  assert.equal((await lib.waitForPluginOperation('nx')).status, 'succeeded');
  const after = await vhostOf(T.piyasa);
  assert.ok(!serves(after, 'nx'));
  assert.ok(serves(after, 'ux'));
  assert.deepEqual((await stored(T.piyasa)).userSurface, { routes: ['nx', 'ux'] }, 'still bound');
});

test('reconfiguring, toggling and moving the tunnel keep the binding; it cannot be made public', async () => {
  const publicRes = await call('PATCH', `/api/tunnels/${T.piyasa.id}`, { accessMode: 'public' });
  assert.equal(publicRes.statusCode, 409, publicRes.body);
  assert.match(publicRes.json().details, /cannot be made public — unbind it first/);
  assert.equal((await stored(T.piyasa)).accessMode, 'authenticated');

  const limit = await call('PATCH', `/api/tunnels/${T.piyasa.id}`, { maxBodySizeMb: 20 });
  assert.equal(limit.statusCode, 200, limit.body);
  let vhost = await vhostOf(T.piyasa);
  assert.match(vhost, /^ {4}client_max_body_size 20m;$/m, 'the tunnel’s own limit');
  assert.ok(serves(vhost, 'ux'), 'the user surface carried through the rewrite');
  assert.ok(vhost.includes('client_max_body_size 10m;'), 'its own limit: the plugin’s');

  const restricted = await call('PATCH', `/api/tunnels/${T.piyasa.id}`, {
    accessMode: 'restricted',
  });
  assert.equal(restricted.statusCode, 200, restricted.body);
  vhost = await vhostOf(T.piyasa);
  assert.match(vhost, /error_page 403 = \/internal\/lamaste\/authz;/);
  assert.ok(serves(vhost, 'ux'));
  assert.doesNotThrow(() => validateVhost(vhost));

  for (const change of [{ enabled: false }, { enabled: true }, { agentLabel: 'vm2' }]) {
    const res = await call('PATCH', `/api/tunnels/${T.piyasa.id}`, change);
    assert.equal(res.statusCode, 200, `${JSON.stringify(change)}: ${res.body}`);
    assert.deepEqual(res.json().tunnel.userSurface, { routes: ['nx', 'ux'] });
    assert.deepEqual((await stored(T.piyasa)).userSurface, { routes: ['nx', 'ux'] });
  }
  assert.equal((await stored(T.piyasa)).agentLabel, 'vm2');
  // Moved to another agent, it still serves its user surface (the plugin's
  // agent half is reached through its own hosting, not this tunnel).
  assert.ok(serves(await vhostOf(T.piyasa), 'ux'));
});

test('unbinding removes the location and is audited; a route not bound there is a 404', async () => {
  const missing = await unbind(T.kamera, 'ux');
  assert.equal(missing.statusCode, 404);

  const res = await unbind(T.piyasa, 'nx');
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().tunnel.userSurface, { routes: ['ux'] });
  assert.deepEqual((await stored(T.piyasa)).userSurface, { routes: ['ux'] });

  const ux = await unbind(T.piyasa, 'ux');
  assert.equal(ux.statusCode, 200, ux.body);
  assert.equal((await stored(T.piyasa)).userSurface, undefined, 'no empty binding left');
  assert.ok(!serves(await vhostOf(T.piyasa), 'ux'));
  const unbound = await audits('tunnel.user-surface.unbound');
  assert.deepEqual(unbound.map((a) => [a.details.route, a.details.reason]).reverse(), [
    ['nx', 'unbound'],
    ['ux', 'unbound'],
  ]);

  // Bound anew, on another host: the conflict was the binding, not the route.
  const rebound = await bind(T.kamera, 'ux');
  assert.equal(rebound.statusCode, 200, rebound.body);
  const kamera = await vhostOf(T.kamera);
  assert.ok(serves(kamera, 'ux'));
  assert.match(kamera, /error_page 403 = \/internal\/lamaste\/authz;/, 'restricted as it was');
});

test('deleting a tunnel drops its binding — audited', async () => {
  assert.equal((await bind(T.spare, 'wx')).statusCode, 200);
  assert.ok(serves(await vhostOf(T.spare), 'wx'));
  const res = await call('DELETE', `/api/tunnels/${T.spare.id}`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(await stored(T.spare), null);
  const [audit] = await audits('tunnel.user-surface.unbound');
  assert.deepEqual(
    [audit.plugin, audit.details.route, audit.details.reason, audit.details.tunnelId],
    ['wx', 'wx', 'tunnel-deleted', T.spare.id],
  );
  // The route is free again.
  assert.equal((await bind(T.piyasa, 'wx')).statusCode, 200);
});

test('uninstalling a plugin unbinds it everywhere and re-renders those hosts', async () => {
  assert.equal((await bind(T.piyasa, 'zx')).statusCode, 200);
  assert.ok(serves(await vhostOf(T.piyasa), 'zx'));
  assert.ok(serves(await vhostOf(T.piyasa), 'wx'));

  await lib.uninstallPlugin('zx', logger);
  assert.deepEqual((await stored(T.piyasa)).userSurface, { routes: ['wx'] });
  const vhost = await vhostOf(T.piyasa);
  assert.ok(!serves(vhost, 'zx'), 'its location went with it');
  assert.ok(serves(vhost, 'wx'), 'the others stay');
  const [audit] = await audits('tunnel.user-surface.unbound');
  assert.deepEqual(
    [audit.actor, audit.plugin, audit.details.route, audit.details.reason],
    ['lamaste', 'zx', 'zx', 'plugin-uninstalled'],
  );

  // Installed again, it starts unbound.
  await install('zx', { hosting: 'agent', agent: {}, identity: IDENTITY });
  assert.ok(!(await lib.readTunnels()).some((t) => t.userSurface?.routes.includes('zx')));
});

test('core: the per-host cap, and a failed save that restores the vhost', async () => {
  const state = { tunnels: [tunnel('cap', { userSurface: undefined })] };
  const writes = [];
  let failSave = false;
  const deps = {
    domain: 'relay.test',
    email: 'ops@relay.test',
    nginx: {
      writeAuthenticatedVhost: async (_s, _d, _p, _c, opts) => {
        writes.push((opts.userSurface ?? []).map((r) => r.route));
      },
    },
    certbot: { issueTunnelCert: async () => ({ skipped: true, certPath: '/x/' }) },
    state: {
      readTunnels: async () => structuredClone(state.tunnels),
      writeTunnels: async (tunnels) => {
        if (failSave) throw new Error('disk full');
        state.tunnels = structuredClone(tunnels);
      },
    },
    userSurface: {
      servedRoutes: async (routes) => routes.map((route) => ({ route, maxBodySizeMb: 10 })),
    },
    logger,
    assertRoute: async () => {},
  };
  const id = state.tunnels[0].id;
  for (let i = 0; i < 16; i += 1) {
    await core.bindUserSurface({ ...deps, id, route: `r${i}` });
  }
  await assert.rejects(
    core.bindUserSurface({ ...deps, id, route: 'r16' }),
    (err) => err.code === 'INVALID_SETTING' && /at most 16/.test(err.message),
  );

  failSave = true;
  writes.length = 0;
  await assert.rejects(
    core.unbindUserSurface({ ...deps, id, route: 'r0' }),
    (err) => err.code === 'STATE_FAILED',
  );
  assert.equal(writes.length, 2, 'rendered, then restored');
  assert.ok(!writes[0].includes('r0'));
  assert.ok(writes[1].includes('r0'), 'the previous vhost is back');
  assert.ok(state.tunnels[0].userSurface.routes.includes('r0'), 'the binding stays');

  // A route that is gone: releasing it touches the state only.
  failSave = false;
  writes.length = 0;
  const { released } = await core.releaseUserSurfaceRoute({
    route: 'r3',
    state: deps.state,
    logger,
  });
  assert.deepEqual(
    released.map((t) => t.id),
    [id],
  );
  assert.ok(!state.tunnels[0].userSurface.routes.includes('r3'));
  assert.equal(writes.length, 0);
});
