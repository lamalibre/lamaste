/**
 * Slice 8 on the relay: calls and events between app plugins, end to end
 * through serverd — applied shelves and their validation, grant sequences
 * and epochs, approval of `peers` blocks, peer readiness, the channels the
 * relay attaches to consumers, the gateway with the panel's own state
 * (effective edges, the provider's hosting and health, delegations checked
 * against the directory and both audiences), events with their gaps, the
 * dependents guard and an update's `breaks`.
 *
 * The agent halves are real ones built on `@lamalibre/lamaste/agent`
 * (`createPeers`, `peerSurface`, `peerRoute`, `createPeerOutbox`, the
 * identity projection and handlers) behind Fastify on loopback ports: the
 * hosting's internal tunnel is the half's own port.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import Fastify from 'fastify';
import { DatabaseSync } from 'node:sqlite';

import {
  approvalDigest,
  normalizePeersBlock,
  peerSubscriptionEpoch,
  verifyPeerDelegation,
} from '@lamalibre/lamaste';
import { userSurfacePlugin } from '@lamalibre/lamaste/server';
import {
  createCallerAssertionVerifier,
  createIdentityHandlers,
  createIdentityProjection,
  createPeerOutbox,
  createPeers,
  PeerCallError,
  peerRoute,
  peerSurface,
  responderHeaderFor,
} from '@lamalibre/lamaste/agent';

import { createFakeAutheliaStorage } from './fake-authelia-storage.js';
import { installFakeGatekeeper } from './fake-gatekeeper.js';
import { installFakeNpm } from './fake-npm.js';

const IP = '127.0.0.1';
const HASH = '$2b$12$abcdefghijklmnopqrstuuJ2s4L6rjpDLHi3qL7Nn5D0o3M6a1g2a';
const IDENTITY = { roles: [{ id: 'viewer', label: 'Viewer' }], attributes: ['displayName'] };

const PEERS = {
  // The platform plugin: provides the directory, consumes notes optionally.
  dir: {
    provides: {
      'dir:read': {
        description: 'Read units',
        endpoints: [
          { method: 'GET', path: '/units/:unitId' },
          { method: 'GET', path: '/me' },
        ],
        events: ['unit.renamed'],
      },
    },
    consumes: { 'notes:send': { required: false, reason: 'Tell people' } },
  },
  // A domain plugin that needs the directory.
  leave: {
    consumes: {
      'dir:read': { required: true, reason: 'Approvers', events: ['unit.renamed'] },
    },
  },
  // Provides notes, consumes the directory optionally — an optional cycle with dir.
  notes: {
    provides: {
      'notes:send': { description: 'Send a note', endpoints: [{ method: 'POST', path: '/send' }] },
    },
    consumes: { 'dir:read': { required: false, reason: 'Recipients' } },
  },
  // Never hosted: speaks a major the directory does not serve.
  old: { consumes: { 'dir:read': { required: false, reason: 'Legacy', major: 3 } } },
};
const manifest = (name, version, peers = PEERS[name]) => ({
  name,
  version,
  hosting: 'agent',
  agent: {},
  ...(name === 'dir' || name === 'leave' ? { identity: IDENTITY } : {}),
  peers,
});

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
let stateDir;
let usersFile;
let users;
let npm;
let lib;
let core;
let gatekeeper;
const halves = {};

async function freePort() {
  const probe = Fastify();
  await probe.listen({ port: 0, host: '127.0.0.1' });
  const { port } = probe.server.address();
  await probe.close();
  return port;
}

/**
 * A real agent half: identity handlers (when it declares identity), the peer
 * surface with its readiness answer, the consumer side when it consumes,
 * an outbox when it provides events, and its `/peer` routes.
 */
async function startHalf(route) {
  const half = { route, configPath: path.join(dir, `${route}.json`), received: [], gaps: [] };
  half.port = await freePort();
  const verifier = createCallerAssertionVerifier({ configPath: half.configPath, plugin: route });
  const db = new DatabaseSync(path.join(dir, `${route}.db`));
  half.db = db;
  const block = PEERS[route];
  if (Object.keys(block.consumes ?? {}).length > 0) {
    half.peers = createPeers({
      configPath: half.configPath,
      plugin: route,
      db,
      eventsWaitMs: 300,
      attachWaitMs: 5000,
      onGap: async (notice) => {
        half.gaps.push(notice);
      },
    });
    half.peers.on('dir:read', 'unit.renamed', (event) => {
      half.received.push(event);
    });
  }
  if (block.provides && Object.values(block.provides).some((s) => s.events?.length)) {
    half.outbox = await createPeerOutbox({
      db,
      dbPath: path.join(dir, `${route}.db`),
      peers: block,
    });
  }
  const app = Fastify();
  if (manifest(route, '1.0.0').identity) {
    const projection = createIdentityProjection({ db: new DatabaseSync(':memory:') });
    const identity = createIdentityHandlers({ verifier, projection });
    await app.register(async (child) => {
      child.removeContentTypeParser('application/json');
      child.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_r, body, done) =>
        done(null, body),
      );
      const handle = async (request, reply) => {
        const out = await identity.handle({
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: request.body ?? null,
        });
        reply.code(out.status).headers(out.headers).send(out.bodyText);
      };
      child.post('/admin/identity/notify', handle);
      child.post('/admin/identity/changes', handle);
    });
  }
  await app.register(
    peerSurface({ verifier, outbox: half.outbox ?? null, peers: half.peers ?? null }),
  );
  if (route === 'dir') {
    app.get(
      '/peer/units/:unitId',
      peerRoute(async (request, caller) => ({ unit: request.params.unitId, caller })),
    );
    app.get(
      '/peer/me',
      peerRoute(async (_request, caller) => ({ user: caller.user ?? null })),
    );
  }
  if (route === 'leave' || route === 'dir') {
    // What a person's request through the user surface brings the half.
    app.get('/app/whoami', async (request, reply) => {
      const verified = await verifier.verify(request.headers, request.method, request.url);
      if (!verified.ok) return reply.code(401).send({ error: verified.reason });
      reply.headers(responderHeaderFor(verified, 200));
      return {
        caller: verified.payload.caller,
        delegation: request.headers['x-lamalibre-delegation'] ?? null,
      };
    });
  }
  if (route === 'notes') {
    app.post(
      '/peer/send',
      peerRoute(async (_request, caller) => ({ sent: true, by: caller.peer })),
    );
  }
  await app.listen({ port: half.port, host: '127.0.0.1' });
  half.peers?.attach(app.server);
  half.app = app;
  halves[route] = half;
  return half;
}

async function saveUsers() {
  await writeFile(usersFile, yaml.dump({ users }, { lineWidth: -1 }), { mode: 0o660 });
  await lib.reconcileDirectory({ confirmDelayMs: 0 });
}

const person = (displayname) => ({ displayname, email: null, password: HASH, groups: [] });

async function userId(username) {
  return (await lib.findDirectoryUser(username))?.userId ?? null;
}

async function setHealth(route, state, reason) {
  const before = (await core.getPluginHosting(stateDir, route)).health;
  const after = { state, ...(reason ? { reason } : {}), since: new Date().toISOString() };
  await core.updatePluginHostingHealth(stateDir, route, after);
  await lib.onHealthTransition(route, before, after, logger);
}

async function approve(name) {
  const plugin = await lib.findPlugin(name);
  const status = await lib.hookStatus(plugin);
  await lib.approveHookSet(plugin, status.approval.digest, {
    actor: 'admin',
    certSerial: null,
    logger,
  });
}

async function host(name) {
  await lib.hostPlugin(name, 'vm1', { actor: 'admin', logger, sourceIp: IP });
  const done = await lib.waitForPluginOperation(name);
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  await lib.identityIdle();
  await setHealth(name, 'up');
}

async function waitFor(check, what, ms = 8000) {
  const until = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const SHELF = {
  'dir:read': { provider: 'dir', consumers: ['leave'] },
  'notes:send': { provider: 'notes', consumers: [] },
};

before(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'lamaste-s8-peers-')));
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
  lib = {
    ...(await import('../src/lib/state-db.js')),
    ...(await import('../src/lib/config.js')),
    ...(await import('../src/lib/mtls.js')),
    ...(await import('../src/lib/authelia.js')),
    ...(await import('../src/lib/gatekeeper-client.js')),
    ...(await import('../src/lib/directory.js')),
    ...(await import('../src/lib/audience.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/plugins.js')),
    ...(await import('../src/lib/plugin-hooks.js')),
    ...(await import('../src/lib/plugin-hosting.js')),
    ...(await import('../src/lib/plugin-lifecycle.js')),
    ...(await import('../src/lib/plugin-operations.js')),
    ...(await import('../src/lib/hook-pipelines.js')),
    ...(await import('../src/lib/tunnel-hooks.js')),
    ...(await import('../src/lib/identity-sync.js')),
    ...(await import('../src/lib/peers.js')),
    ...(await import('../src/lib/peer-runtime.js')),
    ...(await import('../src/lib/peer-delegation.js')),
    ...(await import('../src/lib/user-caller.js')),
  };
  core = await import('@lamalibre/lamaste/server');
  await lib.loadConfig();
  lib.setOidcSyncForTests(async () => null);
  lib.setAutheliaForTests({
    domainAccess: async () => ({ changed: false }),
    usersFile,
    restart: async () => {},
    writeTotp: async () => {},
    userStorage: createFakeAutheliaStorage().storage,
  });
  await (await import('../src/lib/domains.js')).ensurePrimaryDomain();
  gatekeeper = installFakeGatekeeper(lib);
  lib.setTunnelOpsForTests({
    async create(ctx) {
      return { id: `tunnel-${ctx.route}`, port: halves[ctx.route].port };
    },
    async enable() {},
    async remove() {},
    async waitForAgentHalf(record) {
      await writeFile(
        halves[record.plugin].configPath,
        JSON.stringify({
          plugin: record.plugin,
          port: halves[record.plugin].port,
          secret: record.current.secret,
          issuedAt: new Date().toISOString(),
          fetchedAt: new Date().toISOString(),
          acknowledged: true,
        }),
        { mode: 0o600 },
      );
    },
  });
  users = {
    admin: { ...person('Admin'), groups: ['admins'] },
    ayse: person('Ayşe'),
    zeynep: person('Zeynep'),
  };
  await saveUsers();
  const registry = await lib.loadAgentRegistry();
  registry.agents.push({
    label: 'vm1',
    serial: crypto.randomBytes(8).toString('hex'),
    capabilities: ['tunnels:read'],
    allowedSites: [],
    enrollmentMethod: 'p12',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    revoked: false,
  });
  await lib.saveAgentRegistry(registry);
  for (const name of ['dir', 'leave', 'notes', 'old']) {
    if (name !== 'old') await startHalf(name);
    await npm.publish(`@lamalibre/${name}-server`, '1.0.0', {
      'lamaste-plugin.json': JSON.stringify(manifest(name, '1.0.0')),
    });
    await lib.installPlugin(`@lamalibre/${name}-server`, logger);
    await lib.enablePlugin(name, logger);
  }
  lib.startPeerServices(logger);
});

after(async () => {
  lib.stopPeerServices();
  lib.setTunnelOpsForTests(null);
  lib.setOidcSyncForTests(null);
  lib.setAutheliaForTests(null);
  lib.setGatekeeperClientForTests(null);
  for (const half of Object.values(halves)) {
    half.peers?.close?.();
    await half.app.close();
  }
  await rm(dir, { recursive: true, force: true });
});

test('a peers block is stored normalized and approved with the rest; the digest covers it', async () => {
  const plugin = await lib.findPlugin('dir');
  assert.deepEqual(plugin.peers, normalizePeersBlock(PEERS.dir));
  const status = await lib.hookStatus(plugin);
  assert.equal(status.approval.required, true, 'a peers block alone needs approval');
  assert.deepEqual(status.peers, {
    declared: true,
    approved: false,
    block: plugin.peers,
    appliedEdges: { in: [], out: [] },
  });
  assert.equal(
    status.approval.digest,
    approvalDigest({
      relay: null,
      agentHalf: null,
      identity: plugin.identity,
      peers: plugin.peers,
    }),
  );
  await assert.rejects(
    lib.hostPlugin('dir', 'vm1', { actor: 'admin', logger, sourceIp: IP }),
    (err) => err.code === 'hooks_not_approved',
  );
});

test('applying a shelf: shape, declarations, majors; pending edges; required cycles only', async () => {
  const apply = (id, scopes) => lib.applyPeerShelf(id, scopes, { actor: 'admin', logger });
  await assert.rejects(apply('Bad_Id', SHELF), (err) => err.statusCode === 400);
  await assert.rejects(
    apply('s', { 'dir:read': { provider: 'notes', consumers: ['leave'] } }),
    (err) => err.code === 'namespace',
  );
  await assert.rejects(
    apply('s', { 'dir:read': { provider: 'dir', consumers: ['dir'] } }),
    (err) => err.statusCode === 400,
  );
  await assert.rejects(
    apply('s', { 'notes:send': { provider: 'notes', consumers: ['leave'] } }),
    (err) => err.code === 'not_declared' && err.plugin === 'leave',
  );
  await assert.rejects(
    apply('s', { 'dir:read': { provider: 'dir', consumers: ['old'] } }),
    (err) => err.code === 'major_mismatch',
  );
  // An optional cycle (dir ↔ notes) is the platform's normal shape.
  const both = await apply('cycle', {
    'dir:read': { provider: 'dir', consumers: ['notes'] },
    'notes:send': { provider: 'notes', consumers: ['dir'] },
  });
  assert.equal(both.edges.length, 2);
  await lib.removePeerShelf('cycle', { actor: 'admin', logger });
  // A required cycle is refused (core of the check, with installed declarations).
  const byRoute = new Map([
    ['a', { peers: { consumes: { 'b:x': { required: true } } } }],
    ['b', { peers: { consumes: { 'a:y': { required: true } } } }],
  ]);
  assert.deepEqual(
    lib.requiredCycle(
      [
        { scope: 'b:x', provider: 'b', consumer: 'a' },
        { scope: 'a:y', provider: 'a', consumer: 'b' },
      ],
      byRoute,
    ),
    ['a', 'b', 'a'],
  );
  byRoute.get('b').peers.consumes['a:y'].required = false;
  assert.equal(
    lib.requiredCycle(
      [
        { scope: 'b:x', provider: 'b', consumer: 'a' },
        { scope: 'a:y', provider: 'a', consumer: 'b' },
      ],
      byRoute,
    ),
    null,
  );

  // A consumer not installed yet: kept, pending.
  const shelf = await apply('ops', {
    ...SHELF,
    'dir:read': { provider: 'dir', consumers: ['leave', 'ghost'] },
  });
  const states = Object.fromEntries(
    shelf.edges.map((e) => [`${e.consumer} ${e.scope}`, e.reason ?? e.state]),
  );
  assert.equal(states['ghost dir:read'], 'consumer_not_installed');
  assert.equal(states['leave dir:read'], 'consumer_not_approved', 'nothing approved yet');
  assert.ok(shelf.edges.every((e) => typeof e.grantedSeq === 'number' && e.grantedSeq > 0));
  const audit = await lib.listAudit({ action: 'peer.shelf.applied' });
  assert.ok(audit.some((a) => a.details.shelfId === 'ops'));
});

test('grant sequence: kept while any shelf grants a pair, renewed after a gap', async () => {
  const seqOf = async (consumer, scope) =>
    (await lib.peersView()).shelves
      .flatMap((s) => s.edges)
      .find((e) => e.consumer === consumer && e.scope === scope)?.grantedSeq;
  const first = await seqOf('leave', 'dir:read');
  await lib.applyPeerShelf('ops', SHELF, { actor: 'admin', logger });
  assert.equal(await seqOf('leave', 'dir:read'), first, 're-applying keeps it');
  await lib.applyPeerShelf(
    'second',
    { 'dir:read': { provider: 'dir', consumers: ['leave'] } },
    {
      actor: 'admin',
      logger,
    },
  );
  await lib.removePeerShelf('ops', { actor: 'admin', logger });
  assert.equal(await seqOf('leave', 'dir:read'), first, 'another shelf still grants it');
  await lib.removePeerShelf('second', { actor: 'admin', logger });
  await lib.applyPeerShelf('ops', SHELF, { actor: 'admin', logger });
  assert.ok((await seqOf('leave', 'dir:read')) > first, 'granted again after a gap: a new one');
});

test('approved and hosted: readiness, a channel to the consumer, a granted call', async () => {
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'ayse',
    resourceType: 'plugin',
    resourceId: 'leave',
    context: { roles: ['viewer'] },
  });
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'ayse',
    resourceType: 'plugin',
    resourceId: 'dir',
    context: { roles: ['viewer'] },
  });
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'zeynep',
    resourceType: 'plugin',
    resourceId: 'leave',
    context: { roles: ['viewer'] },
  });
  for (const name of ['dir', 'leave', 'notes']) await approve(name);
  const view = await lib.peersView();
  assert.ok(view.edges.some((e) => e.consumer === 'leave' && e.scope === 'dir:read'));
  for (const name of ['dir', 'leave', 'notes']) await host(name);
  for (const name of ['dir', 'leave', 'notes']) {
    assert.ok(lib.peerReady(await lib.findPlugin(name)), `${name} answered the peers protocol`);
  }
  await waitFor(() => lib.peerChannelStatuses().leave?.state === 'attached', 'the channel');

  const answer = await halves.leave.peers.json('dir:read', 'GET', '/units/7');
  assert.equal(answer.unit, '7');
  assert.equal(answer.caller.peer, 'leave');
  assert.equal(answer.caller.scope, 'dir:read');
  assert.equal(answer.caller.endpoint, 'GET /units/:unitId');
  assert.equal(answer.caller.user, undefined, 'as the plugin itself');
});

test('refusals: no grant, an endpoint outside the allowlist, audited once a minute', async () => {
  // notes consumes dir:read, but the applied shelf does not grant it.
  await waitFor(() => lib.peerChannelStatuses().notes?.state === 'attached', 'notes channel');
  for (let i = 0; i < 2; i += 1) {
    await assert.rejects(
      halves.notes.peers.json('dir:read', 'GET', '/units/7'),
      (err) => err instanceof PeerCallError && err.code === 'not_granted' && err.status === 403,
    );
  }
  await assert.rejects(
    halves.leave.peers.json('dir:read', 'GET', '/units'),
    (err) => err.code === 'endpoint_not_allowed' && err.status === 403,
  );
  const denied = await lib.listAudit({ action: 'peer.call.denied' });
  const notGranted = denied.filter((a) => a.plugin === 'notes' && a.details.code === 'not_granted');
  assert.equal(notGranted.length, 1, 'once a minute per consumer, scope and code');
});

test('on behalf of a user: a delegation, both audiences, roles in the provider', async () => {
  const ayse = await userId('ayse');
  const token = await lib.delegationForUserRequest('leave', { userId: ayse });
  assert.ok(token, 'leave calls others: it gets a delegation');
  assert.equal(
    await lib.delegationForUserRequest('dir', { userId: ayse }),
    null,
    'dir has no granted outgoing edge',
  );
  const asAyse = { headers: { 'x-lamalibre-delegation': token } };
  const me = await halves.leave.peers.json('dir:read', 'GET', '/me', { onBehalfOf: asAyse });
  assert.deepEqual(me.user, { userId: ayse, username: 'ayse', roles: ['viewer'] });

  // Zeynep may use leave, but dir does not hold her: refused.
  const zeynep = await lib.delegationForUserRequest('leave', { userId: await userId('zeynep') });
  await assert.rejects(
    halves.leave.peers.json('dir:read', 'GET', '/me', {
      onBehalfOf: { headers: { 'x-lamalibre-delegation': zeynep } },
    }),
    (err) => err.code === 'user_not_entitled',
  );
  // A token given to another plugin is not leave's.
  const signed = (await import('@lamalibre/lamaste')).signPeerDelegation(
    { holder: 'notes', root: 'leave', userId: ayse },
    await lib.delegationSigningKey(),
  );
  await assert.rejects(
    halves.leave.peers.json('dir:read', 'GET', '/me', {
      onBehalfOf: { headers: { 'x-lamalibre-delegation': signed } },
    }),
    (err) => err.code === 'delegation_invalid',
  );
});

test('the user surface: a person’s request to a plugin that calls others carries a fresh delegation; one to a plugin that calls none, nothing', async () => {
  const app = Fastify();
  const hostings = {};
  for (const route of ['leave', 'dir']) {
    hostings[route] = (await core.getPluginHosting(stateDir, route)).current.secret;
  }
  await app.register(
    async (api) => {
      await api.register(userSurfacePlugin, {
        // The relay attests the session's username (Gatekeeper, in production).
        verifyRelay: async (request) => ({
          ok: true,
          route: request.params.route ?? request.url.split('/')[2],
          username: 'ayse',
        }),
        resolveTarget: async (route) => ({
          plugin: route,
          port: halves[route].port,
          secret: hostings[route],
          maxBodyBytes: 1024 * 1024,
        }),
        resolveUserCaller: lib.resolveUserCaller,
        delegationFor: lib.delegationForUserRequest,
        originFor: async () => null,
        logger,
      });
    },
    { prefix: '/api' },
  );
  await app.ready();
  try {
    const ayse = await userId('ayse');
    const before = Date.now();
    const leave = await app.inject({ method: 'GET', url: '/api/leave/app/whoami' });
    assert.equal(leave.statusCode, 200, leave.body);
    const seen = leave.json();
    assert.equal(seen.caller.userId, ayse);
    assert.ok(seen.delegation, 'leave has an outgoing edge: the half gets a delegation');
    const verified = verifyPeerDelegation(seen.delegation, {
      keys: await lib.delegationVerifyKeys(),
      holder: 'leave',
    });
    assert.ok(verified.ok, JSON.stringify(verified));
    assert.equal(verified.payload.holder, 'leave');
    assert.equal(verified.payload.root, 'leave');
    assert.equal(verified.payload.userId, ayse);
    assert.equal(verified.payload.depth, 0);
    assert.ok(verified.payload.iat >= before - 1000, 'issued for this request');
    assert.ok(verified.payload.exp - verified.payload.iat <= 5 * 60_000, 'five minutes at most');

    const dirSeen = await app.inject({ method: 'GET', url: '/api/dir/app/whoami' });
    assert.equal(dirSeen.statusCode, 200, dirSeen.body);
    assert.equal(dirSeen.json().delegation, null, 'dir calls no one: no delegation');
  } finally {
    await app.close();
  }
});

test('events: a gap at first contact, then delivery; a renewed grant starts with a gap again', async () => {
  await waitFor(
    () => halves.leave.gaps.some((g) => g.scope === 'dir:read' && g.reason === 'initial'),
    'the initial gap',
  );
  // Let the gap settle into a cursor before publishing.
  await new Promise((r) => setTimeout(r, 400));
  const publish = (key) => {
    halves.dir.db.exec('BEGIN');
    halves.dir.outbox.publish({
      scope: 'dir:read',
      type: 'unit.renamed',
      key,
      data: { unitId: key },
    });
    halves.dir.db.exec('COMMIT');
  };
  publish('u1');
  publish('u2');
  await waitFor(() => halves.leave.received.length >= 2, 'two events');
  assert.deepEqual(
    halves.leave.received.map((e) => e.key),
    ['u1', 'u2'],
  );
  const sub = await lib.effectiveSubscription('leave', 'dir:read');
  const edge = await lib.effectivePeerEdge('leave', 'dir:read');
  assert.equal(sub.epoch, peerSubscriptionEpoch(edge.grantedSeq, ['unit.renamed']));

  // Removed and granted again: the epoch changes, the consumer reconciles.
  await lib.removePeerShelf('ops', { actor: 'admin', logger });
  await lib.applyPeerShelf('ops', SHELF, { actor: 'admin', logger });
  await waitFor(
    () => halves.leave.gaps.some((g) => g.reason === 'granted'),
    'the gap of a renewed grant',
  );
});

test('the provider offline: 503 with the reason, at once', async () => {
  await setHealth('dir', 'down', 'app');
  await assert.rejects(
    halves.leave.peers.json('dir:read', 'GET', '/units/1'),
    (err) => err.code === 'peer_unavailable' && err.status === 503 && err.retryAfter > 0,
  );
  await setHealth('dir', 'up');
  await waitFor(async () => {
    try {
      return (await halves.leave.peers.json('dir:read', 'GET', '/units/1')).unit === '1';
    } catch {
      return false;
    }
  }, 'the provider back');
});

test('a disabled consumer: its edges go pending, its channel closes, nothing crosses', async () => {
  const opts = lib.peerGatewayOptions(logger);
  await lib.disablePlugin('leave', logger);
  try {
    await waitFor(async () => !(await lib.effectivePeerEdge('leave', 'dir:read')), 'pending edges');
    const view = await lib.peersView();
    const edge = view.shelves
      .flatMap((shelf) => shelf.edges)
      .find((e) => e.consumer === 'leave' && e.scope === 'dir:read');
    assert.equal(edge.state, 'pending');
    assert.equal(edge.reason, 'consumer_disabled');
    assert.equal(await opts.consumerAllowed('leave'), false);
    await waitFor(
      () => lib.peerChannelStatuses().leave === undefined,
      'the channel no longer kept',
    );
    await assert.rejects(halves.leave.peers.json('dir:read', 'GET', '/units/1'));
  } finally {
    await lib.enablePlugin('leave', logger);
  }
  await waitFor(() => lib.peerChannelStatuses().leave?.state === 'attached', 'the channel again');
  await waitFor(async () => {
    try {
      return (await halves.leave.peers.json('dir:read', 'GET', '/units/3')).unit === '3';
    } catch {
      return false;
    }
  }, 'calls again');
});

test("refusals past a consumer's allowance are answered, not audited; a scope it made up is kept as none", async () => {
  const opts = lib.peerGatewayOptions(logger);
  let noted = 0;
  for (let i = 0; i < 100; i += 1) {
    const scope = `x${crypto.randomBytes(4).toString('hex')}:y`;
    if (opts.onDenied({ consumer: 'flood', scope, code: 'not_granted' }) !== false) noted += 1;
  }
  assert.ok(noted <= 20, `at most the allowance noted (${noted})`);
  await new Promise((r) => setTimeout(r, 200));
  const rows = (await lib.listAudit({ action: 'peer.call.denied' })).filter(
    (a) => a.plugin === 'flood',
  );
  assert.equal(rows.length, 1, 'one row for every made-up scope together');
  assert.equal(rows[0].details.scope, null);
});

test('the events floor is kept in the state store and only rises for one epoch and stream', async () => {
  const stream = crypto.randomUUID();
  await lib.recordEventFloor('ghost', 'dir:read', '1:aa', stream, 5);
  assert.equal(await lib.eventFloor('ghost', 'dir:read', '1:aa', stream), 5);
  await lib.recordEventFloor('ghost', 'dir:read', '1:aa', stream, 3);
  assert.equal(await lib.eventFloor('ghost', 'dir:read', '1:aa', stream), 5, 'never lowered');
  assert.equal(await lib.eventFloor('ghost', 'dir:read', '2:aa', stream), null, 'another epoch');
  await lib.recordEventFloor('ghost', 'dir:read', '2:aa', stream, 1);
  assert.equal(await lib.eventFloor('ghost', 'dir:read', '2:aa', stream), 1, 'replaced');
  assert.equal(await lib.eventFloor('ghost', 'dir:read', '1:aa', stream), null);
  // A subscription no longer effective loses its floor; leave keeps its own.
  assert.ok((await lib.pruneEventFloors()) >= 1);
  assert.equal(await lib.eventFloor('ghost', 'dir:read', '2:aa', stream), null);
  const db = await lib.getStateDb();
  assert.ok(
    db.prepare("SELECT 1 FROM peer_event_floors WHERE consumer = 'leave'").get(),
    'the effective subscription keeps its floor',
  );
});

test('the approval preview names the applied edges a plugin inherits, pending ones included', async () => {
  await lib.applyPeerShelf(
    'preview',
    { 'dir:read': { provider: 'dir', consumers: ['notes', 'ghost'] } },
    { actor: 'admin', logger },
  );
  try {
    const notes = await lib.hookStatus(await lib.findPlugin('notes'));
    assert.ok(
      notes.peers.appliedEdges.out.some((e) => e.shelfId === 'preview' && e.scope === 'dir:read'),
    );
    const dirStatus = await lib.hookStatus(await lib.findPlugin('dir'));
    const into = dirStatus.peers.appliedEdges.in.map((e) => e.consumer).sort();
    assert.deepEqual([...new Set(into)], ['ghost', 'leave', 'notes']);
    // A route nobody installed yet: what an installation under it would inherit.
    const ghost = await lib.appliedEdgesNaming('ghost');
    assert.deepEqual(ghost.out, [
      {
        shelfId: 'preview',
        scope: 'dir:read',
        provider: 'dir',
        consumer: 'ghost',
        state: 'pending',
        reason: 'consumer_not_installed',
      },
    ]);
  } finally {
    await lib.removePeerShelf('preview', { actor: 'admin', logger });
  }
});

test('dependents: unhosting or uninstalling a provider others rely on needs breakPeers, never force', async () => {
  const dependents = await lib.peerDependents('dir');
  assert.deepEqual(dependents, [{ consumer: 'leave', scopes: ['dir:read'], required: true }]);
  await assert.rejects(
    lib.unhostPlugin('dir', { actor: 'admin', logger, sourceIp: IP }),
    (err) => err.code === 'peer_dependents' && err.consumers[0].consumer === 'leave',
  );
  // force lets failing pre-teardown stages pass; it does not break peers.
  await assert.rejects(
    lib.unhostPlugin('dir', { actor: 'admin', logger, force: true, sourceIp: IP }),
    (err) => err.code === 'peer_dependents',
  );
  await lib.disablePlugin('dir', logger);
  await assert.rejects(
    lib.uninstallPluginWithHosting('dir', { actor: 'admin', logger, force: true, sourceIp: IP }),
    (err) => err.code === 'peer_dependents',
  );
  await lib.enablePlugin('dir', logger);
  const dir = await lib.findPlugin('dir');
  await assert.rejects(lib.assertNoPeerDependents(dir, false), (err) => err.statusCode === 409);
  await lib.assertNoPeerDependents(dir, true);
});

test('an update that narrows what a consumer relies on waits, whatever auto-approve says', async () => {
  await lib.setAutoApprove('dir', true, { actor: 'admin', certSerial: null });
  const narrowed = {
    ...PEERS.dir,
    provides: {
      'dir:read': {
        description: 'Read units',
        endpoints: [{ method: 'GET', path: '/me' }],
        events: ['unit.renamed', 'unit.closed'],
      },
    },
  };
  await npm.publish('@lamalibre/dir-server', '1.1.0', {
    'lamaste-plugin.json': JSON.stringify(manifest('dir', '1.1.0', narrowed)),
  });
  const staged = await lib.updatePlugin('dir', '1.1.0', {
    actor: 'admin',
    certSerial: null,
    logger,
    sourceIp: IP,
  });
  assert.ok(staged.pendingUpdate, 'it waits');
  const codes = staged.pendingUpdate.approvalRequired.map((r) => r.code);
  assert.ok(codes.includes('peers.changed'), 'an event added widens it');
  assert.ok(codes.includes('peers.breaks'), 'an endpoint leave relies on goes');
  assert.deepEqual(staged.pendingUpdate.peers.breaks, [
    {
      consumer: 'leave',
      scope: 'dir:read',
      reason: 'endpoints_removed',
      major: 1,
      endpoints: ['GET /units/:unitId'],
    },
  ]);
  assert.equal((await lib.findPlugin('dir')).version, '1.0.0');
});

test('GET /api/peers: the shape Shelf reads', async () => {
  const view = await lib.peersView();
  const ops = view.shelves.find((s) => s.shelfId === 'ops');
  assert.ok(ops.appliedAt);
  for (const edge of ops.edges) {
    assert.ok(['effective', 'pending'].includes(edge.state));
    assert.ok(edge.scope && edge.provider && edge.consumer !== undefined);
  }
  assert.ok(view.plugins.some((p) => p.route === 'dir' && p.approved));
});

test('delegation keys: one file, 0600, rotated keeping the previous one', async () => {
  const { stat, readFile } = await import('node:fs/promises');
  const file = path.join(stateDir, lib.PEER_DELEGATION_KEYS_FILE);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const stored = JSON.parse(await readFile(file, 'utf-8'));
  stored.current.createdAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
  await writeFile(file, JSON.stringify(stored), { mode: 0o600 });
  lib.resetDelegationKeysForTests();
  const keys = await lib.delegationVerifyKeys();
  assert.equal(keys.length, 2);
  assert.equal(keys[1].kid, stored.current.kid, 'the old one verifies for a while');
  assert.notEqual(keys[0].kid, stored.current.kid);
});

test('one open events pull per consumer and scope; readiness only for an answering, hosted half', async () => {
  const opts = lib.peerGatewayOptions(logger);
  const release = opts.acquireEventsPull('leave', 'x:y');
  assert.equal(typeof release, 'function');
  assert.equal(opts.acquireEventsPull('leave', 'x:y'), null, 'the slot is taken');
  assert.equal(typeof opts.acquireEventsPull('leave', 'x:z'), 'function', 'another scope is free');
  release();
  assert.equal(typeof opts.acquireEventsPull('leave', 'x:y'), 'function', 'released');

  assert.equal(lib.peerReady(await lib.findPlugin('old')), false, 'never hosted');
  // A provider whose half has not answered is not called: not_ready.
  await setHealth('dir', 'down', 'tunnel');
  assert.equal(lib.peerReady(await lib.findPlugin('dir')), false, 'forgotten while down');
  const target = await opts.providerTarget('dir', 'dir:read');
  assert.deepEqual(target, { kind: 'unavailable', reason: 'down_tunnel' });
  await setHealth('dir', 'up');
  assert.equal(lib.peerReady(await lib.findPlugin('dir')), true, 'asked again when it came up');
});

test('routes: admin only, the body checked at the route, refusals with their code', async () => {
  const { default: peersRoutes } = await import('../src/routes/management/peers.js');
  const app = Fastify({ logger: false });
  app.decorateRequest('certRole', null);
  app.addHook('onRequest', async (request) => {
    request.certRole = request.headers['x-test-role'] ?? 'unknown';
  });
  app.decorate('requireRole', (roles) => async (request, reply) => {
    if (request.certRole === 'admin' || roles.includes(request.certRole)) return;
    return reply.code(403).send({ error: 'forbidden' });
  });
  await app.register(peersRoutes, { prefix: '/api' });
  await app.ready();
  const admin = { 'x-test-role': 'admin' };
  try {
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/peers', headers: { 'x-test-role': 'agent' } }))
        .statusCode,
      403,
    );
    const view = await app.inject({ method: 'GET', url: '/api/peers', headers: admin });
    assert.equal(view.statusCode, 200);
    const body = view.json();
    assert.ok(Array.isArray(body.shelves) && body.channels && body.readiness);
    assert.equal(body.channels.leave.state, 'attached');

    const bad = await app.inject({
      method: 'PUT',
      url: '/api/peers/shelves/web',
      headers: admin,
      payload: { scopes: { 'not a scope': { provider: 'dir', consumers: [] } } },
    });
    assert.equal(bad.statusCode, 400);
    const undeclared = await app.inject({
      method: 'PUT',
      url: '/api/peers/shelves/web',
      headers: admin,
      payload: { scopes: { 'notes:send': { provider: 'notes', consumers: ['leave'] } } },
    });
    assert.equal(undeclared.statusCode, 409);
    assert.deepEqual(
      { code: undeclared.json().code, plugin: undeclared.json().plugin },
      { code: 'not_declared', plugin: 'leave' },
    );
    const applied = await app.inject({
      method: 'PUT',
      url: '/api/peers/shelves/web',
      headers: admin,
      payload: { scopes: { 'notes:send': { provider: 'notes', consumers: [] } } },
    });
    assert.equal(applied.statusCode, 200);
    assert.equal(applied.json().shelf.shelfId, 'web');
    assert.equal(
      (await app.inject({ method: 'DELETE', url: '/api/peers/shelves/web', headers: admin }))
        .statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ method: 'DELETE', url: '/api/peers/shelves/web', headers: admin }))
        .statusCode,
      404,
    );
  } finally {
    await app.close();
  }
});
