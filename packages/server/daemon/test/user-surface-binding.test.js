/**
 * Slice 6, a plugin's user surface bound to a tunnel's host
 * (`PUT /api/tunnels/:id/user-surface`, `DELETE …/user-surface/:route`):
 * only an enabled app tunnel, authenticated or restricted, carried by the
 * agent that hosts the plugin, for a route an installed agent-hosted plugin
 * holds — before it declares identity too; a route on one host at most;
 * persisted in tunnels.json and shown in the listing with how each route is
 * served. The vhost carries a route's locations only while its plugin's
 * installed, approved version declares identity and the tunnel's agent
 * hosts it — so the update that brings identity (the pilot's switch-over)
 * and the one that drops it, unhosting and hosting again, and moving the
 * tunnel to another agent and back each re-render the vhost;
 * reconfiguring, toggling and moving the tunnel keep the binding, a bound
 * tunnel cannot be made public, and deleting the tunnel or uninstalling the
 * plugin drops it (re-rendered, audited) — as does a bind that raced the
 * uninstall. Every vhost written passes the lamaste-priv allow-list. nginx,
 * certbot and chisel are stand-ins (`fake-sudo.js`), npm too
 * (`fake-npm.js`); hosting runs its pipeline with the internal tunnel
 * written to tunnels.json as `createTunnel` writes it.
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

/** Host plugin `name` on agent `label` and wait for the pipeline. */
async function host(name, label) {
  await lib.hostPlugin(name, label, { actor: 'admin', logger, sourceIp: IP });
  const done = await lib.waitForPluginOperation(name);
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  await lib.identityIdle();
}

/** Remove plugin `name`'s hosting and wait for the pipeline. */
async function unhost(name) {
  await lib.unhostPlugin(name, { actor: 'admin', logger, sourceIp: IP });
  const done = await lib.waitForPluginOperation(name);
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  await lib.identityIdle();
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
const vhostOf = (t) => sudo.read(`lamalibre-lamaste-app-${t.fqdn}`);

/** Whether a vhost serves `route`'s user surface. */
function serves(vhost, route) {
  return (
    vhost.includes(`location = /api/${route}/app {`) &&
    vhost.includes(`location ^~ /api/${route}/app/ {`)
  );
}

/** How the listing says `route` is served on tunnel `t`. */
async function statusOf(t, route) {
  const res = await call('GET', '/api/tunnels?limit=500');
  const listed = res.json().tunnels.find((x) => x.id === t.id);
  return (listed.userSurfaceStatus ?? []).find((st) => st.route === route) ?? null;
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
    ...(await import('../src/lib/plugin-hosting.js')),
    ...(await import('../src/lib/plugin-lifecycle.js')),
    ...(await import('../src/lib/plugin-operations.js')),
    ...(await import('../src/lib/hook-pipelines.js')),
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
  // Hosting's internal tunnel, written to tunnels.json as createTunnel
  // writes it (no chisel here to grant it), and no agent half to wait for.
  let internalPort = 21000;
  lib.setTunnelOpsForTests({
    async create(ctx) {
      const entry = {
        id: crypto.randomUUID(),
        subdomain: null,
        fqdn: null,
        port: internalPort++,
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
      await core.withTunnelLock(async () => {
        await lib.writeTunnels([...(await lib.readTunnels()), entry]);
      });
      return entry;
    },
    async enable(ctx) {
      await core.withTunnelLock(async () => {
        const tunnels = await lib.readTunnels();
        await lib.writeTunnels(
          tunnels.map((t) => (t.id === ctx.tunnelId ? { ...t, enabled: true } : t)),
        );
      });
    },
    async remove(ctx) {
      await core.withTunnelLock(async () => {
        await lib.writeTunnels((await lib.readTunnels()).filter((t) => t.id !== ctx.tunnelId));
      });
    },
    async waitForAgentHalf() {},
  });

  await enroll('vm1');
  await enroll('vm2');
  // ux, wx, zx, ex and hx declare identity (approved: hosting waits for
  // it); nx is agent-hosted without it (yet); sx is a server plugin. All
  // but hx are hosted — on vm1, the agent carrying the tunnels, but ex on vm2.
  await install('ux', { hosting: 'agent', agent: {}, identity: IDENTITY });
  await install('nx', { hosting: 'agent', agent: {} });
  await install('sx', {});
  await install('wx', { hosting: 'agent', agent: {}, identity: IDENTITY });
  await install('zx', { hosting: 'agent', agent: {}, identity: IDENTITY });
  await install('ex', { hosting: 'agent', agent: {}, identity: IDENTITY });
  await install('hx', { hosting: 'agent', agent: {}, identity: IDENTITY });
  for (const name of ['ux', 'wx', 'zx', 'ex', 'hx']) await approve(name);

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
    port: 21900,
    pluginName: '@lamalibre/kx-server',
    pluginRoute: 'kx',
  };
  T.spare = tunnel('spare');
  T.away = tunnel('away', { agentLabel: 'vm2' });
  await lib.writeTunnels(Object.values(T));
  for (const t of [T.piyasa, T.spare, T.away]) {
    await lib.writeGatekeeperVhost(t.fqdn, 'relay.test', t.port, undefined, {
      maxBodySizeMb: 10,
    });
  }
  await lib.writeGatekeeperVhost(T.kamera.fqdn, 'relay.test', T.kamera.port, undefined, {
    maxBodySizeMb: 10,
  });

  for (const name of ['ux', 'nx', 'wx', 'zx']) await host(name, 'vm1');
  await host('ex', 'vm2');

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
  lib.setTunnelOpsForTests(null);
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

  // Idempotent: a second bind changes and audits nothing.
  const again = await bind(T.piyasa, 'nx');
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().changed, false);
  const bound = await audits('tunnel.user-surface.bound');
  assert.deepEqual(
    bound.map((a) => [a.actor, a.plugin, a.details.route, a.details.tunnelId]),
    [['admin', 'nx', 'nx', T.piyasa.id]],
  );

  // The listing carries the binding and how each route is served.
  const list = await call('GET', '/api/tunnels?limit=500');
  const listed = list.json().tunnels.find((t) => t.id === T.piyasa.id);
  assert.deepEqual(listed.userSurface, { routes: ['nx'] });
  assert.deepEqual(
    listed.userSurfaceStatus.map((st) => [st.route, st.served]),
    [['nx', false]],
  );
  assert.equal(
    list.json().tunnels.find((t) => t.id === T.spare.id).userSurfaceStatus,
    undefined,
    'an unbound tunnel has none',
  );
});

test('only an administrator binds; only a fitting tunnel its hosting agent carries, for an installed agent-hosted plugin’s route', async () => {
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
    // The host whose sessions reach the plugin's users is its hosting agent's only.
    ['not hosted', await bind(T.spare, 'hx'), 400, /'hx' is not hosted on an agent/],
    [
      'hosted on another agent',
      await bind(T.spare, 'ex'),
      400,
      /hosted on agent 'vm2', but this tunnel is carried by 'vm1'/,
    ],
    [
      'carried by another agent',
      await bind(T.away, 'wx'),
      400,
      /hosted on agent 'vm1', but this tunnel is carried by 'vm2'/,
    ],
  ]) {
    assert.equal(res.statusCode, status, `${label}: ${res.body}`);
    assert.match(res.json().error, pattern, label);
  }

  // A route on one host at most.
  assert.equal((await bind(T.piyasa, 'ux')).statusCode, 200);
  const conflict = await bind(T.spare, 'ux');
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, 'user_surface_conflict');
  assert.match(conflict.json().error, /already served on piyasa/);
  // The tunnels of other hosts are as they were.
  const now = JSON.parse(JSON.stringify(await lib.readTunnels()));
  const then = JSON.parse(snapshot);
  assert.deepEqual(
    now.filter((t) => t.id !== T.piyasa.id),
    then.filter((t) => t.id !== T.piyasa.id),
  );
});

test('a route its hosting agent’s tunnel binds, declared and approved, is served — that route only', async () => {
  const after = await vhostOf(T.piyasa);
  assert.ok(serves(after, 'ux'), 'served from the binding');
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

test('served only while the tunnel’s agent hosts the plugin: unhosting stops it, hosting again restores it', async () => {
  await unhost('ux');
  assert.ok(!serves(await vhostOf(T.piyasa), 'ux'), 'its locations went with the hosting');
  assert.deepEqual(await statusOf(T.piyasa, 'ux'), {
    route: 'ux',
    served: false,
    reason: 'not_hosting_agent',
  });
  assert.deepEqual((await stored(T.piyasa)).userSurface, { routes: ['nx', 'ux'] }, 'still bound');

  // Hosted on another agent than the one carrying the tunnel: still not served.
  await host('ux', 'vm2');
  assert.ok(!serves(await vhostOf(T.piyasa), 'ux'));
  assert.equal((await statusOf(T.piyasa, 'ux')).reason, 'not_hosting_agent');
  await unhost('ux');

  await host('ux', 'vm1');
  assert.ok(serves(await vhostOf(T.piyasa), 'ux'), 'served again from its hosting');
  assert.deepEqual(await statusOf(T.piyasa, 'ux'), { route: 'ux', served: true, reason: null });
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

test('reconfiguring, toggling and moving the tunnel keep the binding; moved away it serves nothing; it cannot be made public', async () => {
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

  for (const change of [{ enabled: false }, { enabled: true }]) {
    const res = await call('PATCH', `/api/tunnels/${T.piyasa.id}`, change);
    assert.equal(res.statusCode, 200, `${JSON.stringify(change)}: ${res.body}`);
    assert.deepEqual(res.json().tunnel.userSurface, { routes: ['nx', 'ux'] });
    assert.ok(serves(await vhostOf(T.piyasa), 'ux'));
  }

  // Moved to an agent that does not host the plugin: the binding stays,
  // nothing of it is served — the vhost is rewritten without its locations.
  const moved = await call('PATCH', `/api/tunnels/${T.piyasa.id}`, { agentLabel: 'vm2' });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.deepEqual(moved.json().tunnel.userSurface, { routes: ['nx', 'ux'] });
  assert.equal((await stored(T.piyasa)).agentLabel, 'vm2');
  vhost = await vhostOf(T.piyasa);
  assert.ok(!serves(vhost, 'ux'), 'another agent’s tunnel serves none of it');
  assert.match(vhost, /error_page 403 = \/internal\/lamaste\/authz;/, 'restricted as it was');
  assert.doesNotThrow(() => validateVhost(vhost));
  assert.equal((await statusOf(T.piyasa, 'ux')).reason, 'not_hosting_agent');

  // Back on the hosting agent: served again.
  const back = await call('PATCH', `/api/tunnels/${T.piyasa.id}`, { agentLabel: 'vm1' });
  assert.equal(back.statusCode, 200, back.body);
  assert.ok(serves(await vhostOf(T.piyasa), 'ux'));
  assert.deepEqual(await statusOf(T.piyasa, 'ux'), { route: 'ux', served: true, reason: null });
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

  await unhost('zx');
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

test('a binding left for a route no installed plugin holds is released with the next uninstall', async () => {
  // As if a bind had raced an uninstall: the binding written after the
  // plugin's registry entry was gone, its own release already run.
  await core.withTunnelLock(async () => {
    const tunnels = await lib.readTunnels();
    await lib.writeTunnels(
      tunnels.map((t) =>
        t.id === T.kamera.id ? { ...t, userSurface: { routes: ['ux', 'gone'] } } : t,
      ),
    );
  });
  await install('dx', { hosting: 'agent', agent: {} });
  await lib.uninstallPlugin('dx', logger);
  assert.deepEqual((await stored(T.kamera)).userSurface, { routes: ['ux'] }, 'the orphan went');
  const orphan = (await audits('tunnel.user-surface.unbound')).find(
    (a) => a.details.route === 'gone',
  );
  assert.deepEqual(
    [orphan.actor, orphan.details.reason, orphan.details.tunnelId],
    ['lamaste', 'plugin-uninstalled', T.kamera.id],
  );
});

test('core: the per-host cap, and a failed save that restores the vhost', async () => {
  const state = { tunnels: [tunnel('cap', { userSurface: undefined })] };
  const writes = [];
  let failSave = false;
  const deps = {
    domain: 'relay.test',
    email: 'ops@relay.test',
    nginx: {
      writeGatekeeperVhost: async (_s, _d, _p, _c, opts) => {
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
      hostingAgent: async () => 'vm1',
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

test('core: moving a bound tunnel re-renders what it serves first; a failed save restores it; revoking its agent releases it', async () => {
  const bound = tunnel('mover', { userSurface: { routes: ['r1', 'r2'] } });
  const state = { tunnels: [bound] };
  const writes = [];
  let failSave = false;
  let synced = 0;
  const deps = {
    domain: 'relay.test',
    email: 'ops@relay.test',
    nginx: {
      writeGatekeeperVhost: async (_s, _d, _p, _c, opts) => {
        writes.push((opts.userSurface ?? []).map((r) => r.route));
      },
    },
    certbot: { issueTunnelCert: async () => ({ skipped: true, certPath: '/x/' }) },
    chisel: {
      syncChisel: async () => {
        synced += 1;
      },
    },
    agents: { isActiveAgent: async () => true },
    state: {
      readTunnels: async () => structuredClone(state.tunnels),
      writeTunnels: async (tunnels) => {
        if (failSave) throw new Error('disk full');
        state.tunnels = structuredClone(tunnels);
      },
    },
    // vm1 hosts r1 and r2; nobody else hosts anything.
    userSurface: {
      servedRoutes: async (routes, t) =>
        t.agentLabel === 'vm1' ? routes.map((route) => ({ route, maxBodySizeMb: 10 })) : [],
      hostingAgent: async () => 'vm1',
    },
    logger,
  };

  failSave = true;
  await assert.rejects(
    core.assignTunnel({ ...deps, id: bound.id, agentLabel: 'vm2' }),
    (err) => err.code === 'STATE_FAILED',
  );
  assert.deepEqual(writes, [[], ['r1', 'r2']], 'rendered for vm2, then restored');
  assert.equal(state.tunnels[0].agentLabel, 'vm1');
  assert.equal(synced, 0);

  failSave = false;
  writes.length = 0;
  await core.assignTunnel({ ...deps, id: bound.id, agentLabel: 'vm2' });
  assert.deepEqual(writes, [[]], 'the vhost serves none of it under vm2');
  assert.equal(state.tunnels[0].agentLabel, 'vm2');
  assert.deepEqual(state.tunnels[0].userSurface, { routes: ['r1', 'r2'] }, 'the binding stays');
  assert.equal(synced, 1);

  // What it serves does not change: nothing is rewritten.
  writes.length = 0;
  await core.assignTunnel({ ...deps, id: bound.id, agentLabel: 'vm3' });
  assert.deepEqual(writes, []);

  // Revoking its agent: the binding stays, the tunnel is reported for a re-render.
  const result = await core.releaseAgentTunnels({ ...deps, agentLabel: 'vm3' });
  assert.deepEqual(result.releasedIds, [bound.id]);
  assert.equal(state.tunnels[0].agentLabel, undefined);
  assert.deepEqual(state.tunnels[0].userSurface, { routes: ['r1', 'r2'] });
});
