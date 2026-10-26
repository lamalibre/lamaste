/**
 * Slice 6, the identity feed end to end: the panel pushes each plugin's
 * audience to its agent half through the internal tunnel — a notification,
 * then batches — and the half applies them with core's own projection and
 * handlers (`createIdentityProjection`, `createIdentityHandlers`) behind
 * the caller-assertion verifier a real half uses, answering with the
 * responder signature. Covered: the first sync replays from 0; incremental
 * batches from the half's cursor; at most 500 changes a batch; another
 * directory or a cursor ahead means a reset; the daily reconcile finds no
 * mismatch on a healthy half and counts (and audits) a tampered one; a 409
 * restarts from the cursor the half reports; erasures stay pending until
 * the half's cursor passes them; a half that applied everything up to the
 * head after a complete replay since the installed version came — not one
 * that merely answered the notification — is what makes the plugin ready
 * for user callers (`resolveUserCaller`); a batch's changes cross the
 * tunnel sealed (nothing of a member in clear); and a plugin that does not
 * declare identity never receives an identity call.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { DatabaseSync } from 'node:sqlite';
import {
  IDENTITY_BATCH_MAX_BYTES,
  IDENTITY_BATCH_MAX_CHANGES,
  openIdentityChanges,
} from '@lamalibre/lamaste';
import {
  createCallerAssertionVerifier,
  createIdentityHandlers,
  createIdentityProjection,
} from '@lamalibre/lamaste/agent';

import { createFakeAutheliaStorage } from './fake-authelia-storage.js';
import { installFakeGatekeeper } from './fake-gatekeeper.js';
import { installFakeNpm } from './fake-npm.js';

const IP = '127.0.0.1';
const HASH = '$2b$12$abcdefghijklmnopqrstuuJ2s4L6rjpDLHi3qL7Nn5D0o3M6a1g2a';
const OTHER_DIRECTORY = '6c0d3e1f-8a2b-4c5d-9e6f-7a8b9c0d1e2f';
const IDENTITY = {
  roles: [
    { id: 'viewer', label: 'Viewer' },
    { id: 'editor', label: 'Editor' },
  ],
  attributes: ['displayName'],
};
const manifests = {
  ix: (version) => ({ name: 'ix', version, hosting: 'agent', agent: {}, identity: IDENTITY }),
  ox: (version) => ({ name: 'ox', version, hosting: 'agent', agent: {} }),
};

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
let autheliaStorage;
const halves = {};

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
  );
}

/**
 * A fake agent half: core's identity projection over its own SQLite
 * database and core's identity handlers, verifying Lamaste's caller
 * assertions with the hosting's secret as a real half does. Every request
 * is recorded (path, the parsed body as it travelled, its size, the status
 * answered); a batch also opened (`batch`: the envelope with its changes
 * unsealed, null when they do not open), as the test's eyes. `failing` answers
 * identity calls with an unsigned 500 (`batchesBeforeFailing` lets that
 * many batches through first); `afterNotify` runs once, right after a
 * notification is answered.
 */
async function startFakeHalf(route) {
  const half = {
    route,
    configPath: path.join(dir, `${route}-half.json`),
    db: new DatabaseSync(':memory:'),
    requests: [],
    erased: [],
    failing: false,
    batchesBeforeFailing: Infinity,
    afterNotify: null,
    handlers: null,
    server: null,
    port: null,
  };
  half.projection = createIdentityProjection({
    db: half.db,
    onErase: (userId) => half.erased.push(userId),
  });
  half.writeConfig = async (secret) => {
    half.secret = secret;
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
    const verifier = createCallerAssertionVerifier({ configPath: half.configPath, plugin: route });
    half.handlers = createIdentityHandlers({ verifier, projection: half.projection });
  };
  half.wire = () => half.requests.filter((r) => r.path === '/admin/identity/changes');
  half.batches = () => half.wire().map((r) => r.batch);
  half.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      let parsed = null;
      try {
        parsed = body.length > 0 ? JSON.parse(body.toString('utf-8')) : null;
      } catch {
        parsed = null;
      }
      const entry = {
        method: req.method,
        path: req.url,
        body: parsed,
        bytes: body.length,
        raw: body.toString('utf-8'),
        batch: null,
        status: null,
      };
      if (req.url === '/admin/identity/changes' && parsed) {
        const { protocol, changes, ...envelope } = parsed;
        const assertion = String(req.headers['x-lamalibre-caller'] ?? '');
        try {
          const { nonce } = JSON.parse(
            Buffer.from(assertion.split('.')[0], 'base64url').toString('utf-8'),
          );
          entry.batch = {
            protocol,
            ...envelope,
            changes: openIdentityChanges({
              secret: half.secret,
              plugin: route,
              nonce,
              envelope,
              sealed: changes,
            }),
          };
        } catch {
          entry.batch = null;
        }
      }
      half.requests.push(entry);
      if (req.url === '/admin/identity/changes') {
        if (half.batchesBeforeFailing <= 0) half.failing = true;
        else half.batchesBeforeFailing -= 1;
      }
      if (req.url.startsWith('/admin/identity') && half.handlers && !half.failing) {
        const out = await half.handlers.handle({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        });
        entry.status = out.status;
        res.writeHead(out.status, out.headers);
        res.end(out.bodyText);
        if (req.url === '/admin/identity/notify' && half.afterNotify) {
          const run = half.afterNotify;
          half.afterNotify = null;
          run();
        }
        return;
      }
      entry.status = req.url.startsWith('/admin/identity') ? 500 : 404;
      res.writeHead(entry.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'no' }));
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

async function userId(username) {
  return (await lib.findDirectoryUser(username))?.userId ?? null;
}

function grant(principalType, principalId, roles, resourceId = 'ix') {
  return gatekeeper.addGrant({
    principalType,
    principalId,
    resourceType: 'plugin',
    resourceId,
    context: { roles },
  });
}

/** Persist a health transition of `route` as the monitor does, and react to it. */
async function setHealth(route, state, reason) {
  const before = (await core.getPluginHosting(stateDir, route)).health;
  const after = { state, ...(reason ? { reason } : {}), since: new Date().toISOString() };
  await core.updatePluginHostingHealth(stateDir, route, after);
  await lib.onHealthTransition(route, before, after, logger);
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

async function host(name) {
  await lib.hostPlugin(name, 'vm1', { actor: 'admin', logger, sourceIp: IP });
  const done = await lib.waitForPluginOperation(name);
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  await lib.identityIdle();
}

before(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'lamaste-s6-sync-')));
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
    ...(await import('../src/lib/user-caller.js')),
  };
  core = await import('@lamalibre/lamaste/server');
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

  users = {
    admin: { ...person('Admin'), groups: ['admins'] },
    ayse: person('Ayşe Yılmaz'),
    mehmet: person('Mehmet Kaya'),
    zeynep: person('Zeynep Ak'),
    ali: person('Ali Veli'),
  };
  await saveUsers();
  await enroll('vm1');
  await startFakeHalf('ix');
  await startFakeHalf('ox');
  for (const name of ['ix', 'ox']) {
    await npm.publish(`@lamalibre/${name}-server`, '1.0.0', {
      'lamaste-plugin.json': JSON.stringify(manifests[name]('1.0.0')),
    });
    await lib.installPlugin(`@lamalibre/${name}-server`, logger);
    await lib.enablePlugin(name, logger);
  }
  await lib.identityIdle();
});

after(async () => {
  lib.setTunnelOpsForTests(null);
  lib.setOidcSyncForTests(null);
  lib.setAutheliaForTests(null);
  lib.setGatekeeperClientForTests(null);
  for (const half of Object.values(halves)) half.server.close();
  await rm(dir, { recursive: true, force: true });
});

test('the identity block is approved before anything happens; the first sync after hosting replays from 0', async () => {
  const plugin = await lib.findPlugin('ix');
  const status = await lib.hookStatus(plugin);
  assert.equal(status.approval.required, true, 'an identity block alone needs approval');
  assert.equal(status.approval.state, 'pending');
  assert.deepEqual(status.identity, { declared: true, approved: false, block: plugin.identity });
  await assert.rejects(
    lib.hostPlugin('ix', 'vm1', { actor: 'admin', logger, sourceIp: IP }),
    (err) => err.code === 'hooks_not_approved',
  );

  grant('user', 'ayse', ['viewer']);
  grant('user', 'mehmet', ['editor', 'viewer']);
  await lib.approveHookSet(plugin, status.approval.digest, {
    actor: 'admin',
    certSerial: null,
    logger,
  });
  assert.equal((await lib.hookStatus(plugin)).identity.approved, true);
  // Approved but not hosted: the audience is computed, nothing is sent.
  assert.equal((await lib.listAudience('ix')).length, 2);
  assert.equal(halves.ix.requests.length, 0);
  assert.deepEqual(await lib.resolveUserCaller('ix', 'ayse'), {
    ok: false,
    status: 503,
    error: 'The plugin is not ready for its users yet',
  });

  await host('ix');
  const [notify, ...rest] = halves.ix.requests;
  const directoryId = await lib.getDirectoryId();
  const head = await lib.audienceHead('ix');
  assert.equal(notify.path, '/admin/identity/notify');
  assert.deepEqual(notify.body, { protocol: 1, directoryId, seq: head });
  assert.equal(notify.status, 200);
  assert.equal(rest.length, 1);
  const [batch] = halves.ix.batches();
  assert.equal(batch.reset, true);
  assert.equal(batch.from, 0);
  assert.equal(batch.to, head);
  assert.equal(batch.final, true);
  assert.equal(batch.reconcile, false);
  assert.equal(batch.changes.length, 2);
  // On the wire the changes are sealed: no member in clear.
  const [wire] = halves.ix.wire();
  assert.deepEqual(Object.keys(wire.body.changes).sort(), ['ct', 'iv', 'v']);
  for (const personal of ['ayse', 'mehmet', 'Ayşe', 'Mehmet', await userId('ayse')]) {
    assert.ok(!wire.raw.includes(personal), `${personal} is not on the wire in clear`);
  }
  assert.deepEqual(halves.ix.projection.state(), { directoryId, cursor: head });
  assert.deepEqual(
    halves.ix.projection.listUsers().map((u) => [u.username, u.displayName, u.email, u.roles]),
    [
      ['ayse', 'Ayşe Yılmaz', null, ['viewer']],
      ['mehmet', 'Mehmet Kaya', null, ['editor', 'viewer']],
    ],
    'only the declared attributes',
  );

  const state = await lib.readIdentitySyncState('ix');
  assert.equal(state.readyVersion, '1.0.0');
  assert.equal(state.cursor, head);
  assert.equal(state.lastError, null);
  assert.ok(state.lastReconcileAt);
  assert.equal(state.lastMismatches, null, 'a reset is not a reconcile');
  assert.equal((await lib.identityReadiness('ix')).ready, true);
});

test('user callers: the directory’s id, the audience’s roles; refused when disabled, unknown or not entitled', async () => {
  const ayse = await userId('ayse');
  assert.deepEqual(await lib.resolveUserCaller('ix', 'ayse'), {
    ok: true,
    caller: { type: 'user', userId: ayse, username: 'ayse', roles: ['viewer'] },
  });
  assert.deepEqual((await lib.resolveUserCaller('ix', 'mehmet')).caller.roles, [
    'editor',
    'viewer',
  ]);
  for (const username of ['zeynep', 'nobody', 'Not-A-Username']) {
    const refused = await lib.resolveUserCaller('ix', username);
    assert.equal(refused.ok, false);
    assert.equal(refused.status, 403, username);
  }
  assert.equal(
    (await lib.resolveUserCaller('ox', 'ayse')).status,
    404,
    'no identity, no user surface',
  );
  assert.equal((await lib.resolveUserCaller('qx', 'ayse')).status, 404);

  users.ayse.disabled = true;
  await saveUsers();
  assert.deepEqual(await lib.resolveUserCaller('ix', 'ayse'), {
    ok: false,
    status: 403,
    error: 'This user is disabled',
  });
  delete users.ayse.disabled;
  await saveUsers();
  await lib.recomputeAudiences({ logger });
  await lib.identityIdle();
  assert.equal((await lib.resolveUserCaller('ix', 'ayse')).ok, true);
});

test('incremental: a change goes out alone, from the half’s cursor', async () => {
  const cursor = halves.ix.projection.state().cursor;
  halves.ix.requests.length = 0;
  grant('user', 'zeynep', ['viewer']);
  await lib.recomputeAudiences({ logger });
  await lib.identityIdle();
  const [batch] = halves.ix.batches();
  assert.equal(halves.ix.batches().length, 1);
  assert.equal(batch.reset, false);
  assert.equal(batch.reconcile, false);
  assert.equal(batch.final, false);
  assert.equal(batch.from, cursor);
  assert.deepEqual(
    batch.changes.map((c) => [c.kind, c.member.username]),
    [['upsert', 'zeynep']],
  );
  assert.equal(batch.to, batch.changes[0].seq);
  assert.equal(halves.ix.projection.state().cursor, batch.to);

  // Up to date: the notification alone.
  halves.ix.requests.length = 0;
  const result = await lib.syncPluginIdentity('ix', { logger });
  assert.equal(result.status, 'up-to-date');
  assert.deepEqual(
    halves.ix.requests.map((r) => r.path),
    ['/admin/identity/notify'],
  );
});

test('batches: at most 500 changes and 1 MiB each, chained from cursor to cursor', async () => {
  for (let i = 1; i <= 620; i += 1) {
    users[`crowd${String(i).padStart(3, '0')}`] = person(`Crowd Member ${i}`);
  }
  await saveUsers();
  gatekeeper.setGroup(
    'crowd',
    Object.keys(users).filter((u) => u.startsWith('crowd')),
  );
  const cursor = halves.ix.projection.state().cursor;
  halves.ix.requests.length = 0;
  grant('group', 'crowd', ['viewer']);
  await lib.recomputeAudiences({ logger });
  await lib.identityIdle();
  const batches = halves.ix.batches();
  assert.deepEqual(
    batches.map((b) => b.changes.length),
    [IDENTITY_BATCH_MAX_CHANGES, 120],
  );
  assert.equal(batches[0].from, cursor);
  assert.equal(batches[1].from, batches[0].to);
  for (const b of batches) assert.equal(b.reset, false);
  for (const w of halves.ix.wire()) assert.ok(w.bytes <= IDENTITY_BATCH_MAX_BYTES);
  assert.equal(halves.ix.projection.state().cursor, await lib.audienceHead('ix'));
  assert.equal(halves.ix.projection.listUsers().length, 623);
});

test('another directory, or a cursor ahead of the head: everything again, from a reset', async () => {
  const directoryId = await lib.getDirectoryId();
  const head = await lib.audienceHead('ix');
  // The half was restored from another relay's feed.
  halves.ix.projection.applyBatch({
    protocol: 1,
    directoryId: OTHER_DIRECTORY,
    from: 0,
    to: 7,
    reset: true,
    reconcile: false,
    pass: crypto.randomUUID(),
    final: false,
    changes: [],
  });
  halves.ix.requests.length = 0;
  const result = await lib.syncPluginIdentity('ix', { logger });
  assert.equal(result.status, 'synced');
  assert.equal(result.replay, true);
  const batches = halves.ix.batches();
  assert.equal(batches.length, 2);
  assert.deepEqual(
    batches.map((b) => [b.reset, b.reconcile, b.final, b.from]),
    [
      [true, false, false, 0],
      [false, true, true, batches[0].to],
    ],
  );
  assert.equal(new Set(batches.map((b) => b.pass)).size, 1, 'one pass');
  assert.equal(batches[1].to, head);
  assert.deepEqual(halves.ix.projection.state(), { directoryId, cursor: head });

  // A cursor ahead of the head means nothing either.
  halves.ix.db.prepare('UPDATE lamaste_identity_cursor SET cursor = ?').run(head + 1000);
  halves.ix.requests.length = 0;
  const ahead = await lib.syncPluginIdentity('ix', { logger });
  assert.equal(ahead.replay, true);
  assert.equal(halves.ix.batches()[0].reset, true);
  assert.deepEqual(halves.ix.projection.state(), { directoryId, cursor: head });
});

test('the daily reconcile: a healthy half has no mismatch; a tampered one is counted, fixed and audited', async () => {
  halves.ix.requests.length = 0;
  const clean = await lib.syncPluginIdentity('ix', { reconcile: true, logger });
  assert.equal(clean.status, 'synced');
  assert.equal(clean.mismatches, 0);
  const batches = halves.ix.batches();
  assert.ok(batches.every((b) => b.reconcile));
  assert.equal(batches[0].reset, true);
  assert.equal(batches.at(-1).final, true);
  assert.equal((await lib.readIdentitySyncState('ix')).lastMismatches, 0);
  assert.equal((await lib.listAudit({ action: 'identity.reconcile.mismatches' })).length, 0);

  // Drift the feed never caused: a renamed row, and a member nobody sent.
  halves.ix.db
    .prepare("UPDATE lamaste_users SET display_name = 'Tampered' WHERE username = 'ayse'")
    .run();
  halves.ix.db
    .prepare(
      `INSERT INTO lamaste_users (user_id, username, display_name, email, roles, status,
         removed_reason, removed_at, erased_at, version, seen_pass, updated_at)
       VALUES (?, 'ghost', NULL, NULL, '["viewer"]', 'active', NULL, NULL, NULL, 1, NULL, 't')`,
    )
    .run(crypto.randomUUID());
  const found = await lib.syncPluginIdentity('ix', { reconcile: true, logger });
  assert.equal(found.mismatches, 2);
  assert.equal((await lib.readIdentitySyncState('ix')).lastMismatches, 2);
  const [audit] = await lib.listAudit({ action: 'identity.reconcile.mismatches' });
  assert.equal(audit.plugin, 'ix');
  assert.equal(audit.details.mismatches, 2);
  assert.equal(
    halves.ix.projection.listUsers().find((u) => u.username === 'ayse').displayName,
    'Ayşe Yılmaz',
  );
  assert.equal(
    halves.ix.projection.listUsers().some((u) => u.username === 'ghost'),
    false,
    'the member nobody sent is removed',
  );
});

test('a replay cut short is owed: the next sync replays again, whatever triggered it', async () => {
  halves.ix.batchesBeforeFailing = 1;
  halves.ix.requests.length = 0;
  const cut = await lib.syncPluginIdentity('ix', { reconcile: true, logger });
  assert.equal(cut.status, 'failed');
  assert.match(cut.error, /unauthenticated/, 'an unsigned answer is not the half’s');
  assert.deepEqual(
    halves.ix.batches().map((b) => b.reset),
    [true, false],
  );
  const state = await lib.readIdentitySyncState('ix');
  assert.equal(state.lastReconcileAt, null);
  assert.ok(state.lastError);

  halves.ix.failing = false;
  halves.ix.batchesBeforeFailing = Infinity;
  halves.ix.requests.length = 0;
  const again = await lib.syncPluginIdentity('ix', { logger });
  assert.equal(again.status, 'synced');
  assert.equal(again.replay, true);
  assert.equal(halves.ix.batches()[0].reset, true);
  assert.equal(halves.ix.batches().at(-1).final, true);
  assert.ok((await lib.readIdentitySyncState('ix')).lastReconcileAt);
});

test('a 409: the sync continues from the cursor the half reports', async () => {
  const cursor = halves.ix.projection.state().cursor;
  // Between the notification and the batch, the half went back one change
  // (a restore, say).
  halves.ix.afterNotify = () => {
    halves.ix.db.prepare('UPDATE lamaste_identity_cursor SET cursor = ?').run(cursor - 1);
  };
  halves.ix.requests.length = 0;
  grant('user', 'ali', ['viewer']);
  await lib.recomputeAudiences({ logger });
  await lib.identityIdle();
  const changes = halves.ix.requests.filter((r) => r.path === '/admin/identity/changes');
  assert.deepEqual(
    changes.map((r) => [r.status, r.body.from]),
    [
      [409, cursor],
      [200, cursor - 1],
    ],
  );
  assert.equal(halves.ix.projection.state().cursor, await lib.audienceHead('ix'));
  assert.equal((await lib.readIdentitySyncState('ix')).lastError, null);
});

test('erasures wait for the half: pending until its cursor passes them, and the half scrubs the row', async () => {
  await setHealth('ix', 'down', 'tunnel');
  const ali = await userId('ali');
  await lib.changeUsers(
    async () => {
      const data = await lib.readUsersRaw();
      delete data.users.ali;
      await lib.writeUsers(data, { deleting: ['ali'] });
      delete users.ali;
    },
    { actor: 'admin', logger, deleted: ['ali'], confirmDelayMs: 0 },
  );
  await lib.eraseDirectoryUser(ali, { actor: 'admin', logger });
  await lib.identityIdle();
  assert.deepEqual(await lib.pendingErasures('ix'), [ali]);
  assert.deepEqual((await lib.pendingErasuresByUser()).get(ali), [
    { plugin: 'ix', inactive: false },
  ]);
  assert.match((await lib.readIdentitySyncState('ix')).lastError, /down/);
  assert.equal(halves.ix.projection.getUser(ali).username, 'ali', 'not told yet');

  await setHealth('ix', 'up');
  await lib.identityIdle();
  assert.deepEqual(await lib.pendingErasures('ix'), []);
  const scrubbed = halves.ix.projection.getUser(ali);
  assert.equal(scrubbed.username, null);
  assert.equal(scrubbed.displayName, null);
  assert.ok(scrubbed.erasedAt);
  assert.ok(halves.ix.erased.includes(ali), 'the plugin anonymised its own data');
});

test('an update: user callers wait until the new version’s half has applied up to the head', async () => {
  await npm.publish('@lamalibre/ix-server', '1.0.1', {
    'lamaste-plugin.json': JSON.stringify(manifests.ix('1.0.1')),
  });
  halves.ix.failing = true;
  const { operation } = await lib.updatePlugin('ix', '1.0.1', {
    actor: 'admin',
    certSerial: null,
    logger,
    sourceIp: IP,
  });
  assert.ok(operation, 'the same identity block: no approval needed');
  assert.equal((await lib.waitForPluginOperation('ix')).status, 'succeeded');
  await lib.identityIdle();
  const readiness = await lib.identityReadiness('ix');
  assert.equal(readiness.reason, 'not_answered');
  assert.equal(readiness.readyVersion, '1.0.0');
  assert.equal((await lib.resolveUserCaller('ix', 'ayse')).status, 503);

  halves.ix.failing = false;
  await lib.syncPluginIdentity('ix', { logger });
  assert.equal((await lib.identityReadiness('ix')).ready, true);
  assert.equal((await lib.readIdentitySyncState('ix')).readyVersion, '1.0.1');
  assert.equal((await lib.resolveUserCaller('ix', 'ayse')).ok, true);
});

test('the hosting removed: the half is forgotten; the next hosting’s half answers and replays first', async () => {
  await lib.unhostPlugin('ix', { actor: 'admin', logger, sourceIp: IP });
  assert.equal((await lib.waitForPluginOperation('ix')).status, 'succeeded');
  assert.equal(await lib.readIdentitySyncState('ix'), null);
  assert.equal((await lib.identityReadiness('ix')).reason, 'not_hosted');
  assert.ok((await lib.listAudience('ix')).length > 0, 'the audience is the plugin’s');

  // The next hosting's half answers the notification but takes no batch:
  // answering is not enough — users wait until it holds the whole audience.
  halves.ix.requests.length = 0;
  halves.ix.batchesBeforeFailing = 0;
  await host('ix');
  assert.equal(halves.ix.requests[0].path, '/admin/identity/notify');
  assert.equal(halves.ix.requests[0].status, 200);
  const behind = await lib.identityReadiness('ix');
  assert.deepEqual(
    [behind.ready, behind.reason, behind.readyVersion],
    [false, 'not_answered', null],
  );
  assert.equal((await lib.resolveUserCaller('ix', 'ayse')).status, 503);

  halves.ix.failing = false;
  halves.ix.batchesBeforeFailing = Infinity;
  halves.ix.requests.length = 0;
  await lib.syncPluginIdentity('ix', { logger });
  assert.equal(halves.ix.batches()[0].reset, true);
  assert.equal(halves.ix.batches().at(-1).final, true);
  // The replay carries every erasure the plugin's ledger holds: a half that
  // comes back with data from before an erasure scrubs it.
  const erased = (await lib.listAudience('ix'))
    .filter((row) => row.change.reason === 'erased')
    .map((row) => row.userId);
  assert.ok(erased.length > 0);
  const replayed = halves.ix
    .batches()
    .flatMap((b) => b.changes)
    .filter((c) => c.kind === 'remove' && c.reason === 'erased')
    .map((c) => c.userId);
  assert.deepEqual(replayed.sort(), erased.sort());
  assert.equal(halves.ix.projection.state().cursor, await lib.audienceHead('ix'));
  assert.equal((await lib.identityReadiness('ix')).ready, true);
});

test('a plugin that does not declare identity never receives an identity call', async () => {
  await host('ox');
  await lib.identityTick(logger);
  await lib.syncPluginIdentity('ox', { logger });
  await setHealth('ox', 'down', 'app');
  await setHealth('ox', 'up');
  await lib.identityIdle();
  assert.deepEqual(
    halves.ox.requests.filter((r) => r.path.startsWith('/admin/identity')),
    [],
  );
  assert.equal(await lib.readIdentitySyncState('ox'), null);
  const readiness = await lib.identityReadiness('ox');
  assert.deepEqual([readiness.ready, readiness.reason], [false, 'no_identity']);
});
