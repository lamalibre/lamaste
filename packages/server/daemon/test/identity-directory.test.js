/**
 * Slice 6, the user directory on the relay: migration 0013 and its seq
 * triggers; the directory reconciled against users.yml — read only, a
 * user taken for deleted outside Lamaste only after two reads — and every
 * users.yml write going through the users lock (`changeUsers`); the users
 * API's ids, status, disable / enable, delete with its tombstone and erase;
 * erasure of a tombstone with the invitations and Gatekeeper's
 * access-request log of the username; invitation acceptance through the
 * lock. Authelia is a users file in a temporary directory (its restart
 * counted), Gatekeeper a fake (`fake-gatekeeper.js`). Audit entries never
 * name a user but by id.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { isIdentityUuid } from '@lamalibre/lamaste';

import { createFakeAutheliaStorage } from './fake-authelia-storage.js';
import { installFakeGatekeeper } from './fake-gatekeeper.js';

const MIGRATIONS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'lib',
  'migrations',
  'state',
);
const HASH = '$2b$12$abcdefghijklmnopqrstuuJ2s4L6rjpDLHi3qL7Nn5D0o3M6a1g2a';

let dir;
let stateDir;
let usersFile;
let lib;
let app;
let gatekeeper;
let autheliaStorage;
let restarts = 0;
/** What "Authelia" does when it restarts (a test's stand-in for its own rewrite of users.yml). */
let onRestart = null;
/** Every log line the routes wrote. */
const logLines = [];

/** The users file Authelia would read, written as Authelia's YAML. */
async function writeUsersFile(users) {
  await writeFile(usersFile, yaml.dump({ users }, { lineWidth: -1 }), { mode: 0o660 });
}

async function readUsersFile() {
  return yaml.load(await readFile(usersFile, 'utf-8')).users;
}

const person = (displayname, email, groups = [], extra = {}) => ({
  displayname,
  email,
  password: HASH,
  groups,
  ...extra,
});

async function directoryRow(username) {
  const db = await lib.getStateDb();
  return (
    db
      .prepare(
        "SELECT * FROM directory_users WHERE username = ? ORDER BY status = 'removed', created_at DESC",
      )
      .get(username) ?? null
  );
}

async function call(method, url, payload) {
  return app.inject({
    method,
    url,
    headers: {
      'x-test-role': 'admin',
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-s6-directory-'));
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
  await writeUsersFile({
    admin: person('Admin', 'admin@relay.test', ['admins']),
    ayse: person('Ayşe Yılmaz', 'ayse@relay.test', ['staff']),
  });

  lib = {
    ...(await import('../src/lib/state-db.js')),
    ...(await import('../src/lib/config.js')),
    ...(await import('../src/lib/authelia.js')),
    ...(await import('../src/lib/gatekeeper-client.js')),
    ...(await import('../src/lib/directory.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/state.js')),
    ...(await import('../src/lib/user-access.js')),
  };
  await lib.loadConfig();
  autheliaStorage = createFakeAutheliaStorage();
  lib.setAutheliaForTests({
    // No Authelia configuration to render the domains into.
    domainAccess: async () => ({ changed: false }),
    usersFile,
    restart: async () => {
      restarts += 1;
      if (onRestart) await onRestart();
    },
    writeTotp: async () => {},
    userStorage: autheliaStorage.storage,
  });
  // What the panel's start does: the primary domain, everyone its member.
  await (await import('../src/lib/domains.js')).ensurePrimaryDomain();
  gatekeeper = installFakeGatekeeper(lib);

  const { default: Fastify } = await import('fastify');
  const { default: errors } = await import('../src/middleware/errors.js');
  const { default: usersRoutes } = await import('../src/routes/management/users.js');
  const { default: directoryRoutes } =
    await import('../src/routes/management/identity-directory.js');
  const { default: inviteRoutes } = await import('../src/routes/invite.js');
  app = Fastify({
    logger: { level: 'trace', stream: { write: (line) => logLines.push(line) } },
  });
  await app.register(errors);
  app.decorateRequest('certRole', null);
  app.addHook('onRequest', async (request) => {
    request.certRole = request.headers['x-test-role'] ?? 'unknown';
  });
  app.decorate('requireRole', (roles) => async (request, reply) => {
    if (request.certRole === 'admin' || roles.includes(request.certRole)) return;
    return reply.code(403).send({ error: 'forbidden' });
  });
  await app.register(usersRoutes, { prefix: '/api' });
  await app.register(directoryRoutes, { prefix: '/api' });
  await app.register(inviteRoutes, { prefix: '/api/invite' });
  await app.ready();
});

after(async () => {
  lib.setAutheliaForTests(null);
  lib.setGatekeeperClientForTests(null);
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

test('migration 0013 applies over a 0012 store: its tables and a UUID v4 directory id; plugin rows stay', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const migrations = path.join(dir, 'migrations-0012');
  await mkdir(migrations);
  for (const file of (await readdir(MIGRATIONS)).filter((f) => f < '0013')) {
    await copyFile(path.join(MIGRATIONS, file), path.join(migrations, file));
  }
  const db = new DatabaseSync(path.join(dir, 'upgrade.db'));
  db.exec('PRAGMA foreign_keys = ON');
  await lib.ensureMigrations(db, migrations);
  db.prepare(
    `INSERT INTO plugins (name, route, package_name, version, capabilities, hosting, status, installed_at)
     VALUES ('mx', 'mx', '@lamalibre/mx-server', '1.0.0', '[]', 'agent', 'enabled', '2026-10-01T00:00:00.000Z')`,
  ).run();

  await copyFile(
    path.join(MIGRATIONS, '0013_identity_directory.sql'),
    path.join(migrations, '0013_identity_directory.sql'),
  );
  await lib.ensureMigrations(db, migrations);
  const plugin = db.prepare('SELECT name, version, identity FROM plugins').get();
  assert.deepEqual({ ...plugin }, { name: 'mx', version: '1.0.0', identity: null });
  const meta = db.prepare('SELECT directory_id FROM directory_meta').get();
  assert.ok(isIdentityUuid(meta.directory_id), meta.directory_id);
  assert.equal(db.prepare('SELECT seq FROM directory_counter').get().seq, 0);
  for (const table of [
    'directory_users',
    'plugin_audience',
    'plugin_identity_sync',
    'directory_erasures',
  ]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  }
  // Applied once: the runner records it, and running again is a no-op.
  await lib.ensureMigrations(db, migrations);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE name LIKE '0013%'").get().n,
    1,
  );
  db.close();
});

test('the triggers stamp the store-wide seq on an insert and on a change of `change` only', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of (await readdir(MIGRATIONS)).sort()) {
    db.exec(await readFile(path.join(MIGRATIONS, file), 'utf-8'));
  }
  const user = (id, username) =>
    db
      .prepare(
        `INSERT INTO directory_users (user_id, username, status, version, created_at, updated_at)
         VALUES (?, ?, 'active', 1, 't', 't')`,
      )
      .run(id, username);
  user('u1', 'ayse');
  user('u2', 'mehmet');
  const insert = db.prepare(
    "INSERT INTO plugin_audience (plugin, user_id, change, version, updated_at) VALUES (?, ?, ?, 1, 't')",
  );
  const seqOf = (plugin, userId) =>
    db
      .prepare('SELECT seq FROM plugin_audience WHERE plugin = ? AND user_id = ?')
      .get(plugin, userId).seq;
  insert.run('mx', 'u1', '{"a":1}');
  insert.run('mx', 'u2', '{"a":2}');
  insert.run('nx', 'u1', '{"a":3}');
  assert.deepEqual([seqOf('mx', 'u1'), seqOf('mx', 'u2'), seqOf('nx', 'u1')], [1, 2, 3]);

  // Only `updated_at`, or `version`: nothing visible changed, no stamp.
  db.prepare(
    "UPDATE plugin_audience SET updated_at = 'later', version = 2 WHERE user_id = 'u1'",
  ).run();
  assert.deepEqual([seqOf('mx', 'u1'), seqOf('nx', 'u1')], [1, 3]);
  // The change rewritten: the next seq of the whole store, one row only.
  db.prepare(
    "UPDATE plugin_audience SET change = '{\"a\":9}' WHERE plugin = 'mx' AND user_id = 'u1'",
  ).run();
  assert.deepEqual([seqOf('mx', 'u1'), seqOf('mx', 'u2'), seqOf('nx', 'u1')], [4, 2, 3]);
  assert.equal(db.prepare('SELECT seq FROM directory_counter').get().seq, 4);
  // A foreign key holds every audience row to a directory user.
  assert.throws(() => insert.run('mx', 'nobody', '{}'), /FOREIGN KEY/);
  db.close();
});

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

test('reconcile: unknown usernames get ids, `disabled` is adopted, drift bumps the version — users.yml is never written', async () => {
  const beforeText = await readFile(usersFile, 'utf-8');
  const beforeMtime = (await stat(usersFile)).mtimeMs;
  const first = await lib.reconcileDirectory({ confirmDelayMs: 0 });
  assert.equal(first.created, 2);
  const admin = await directoryRow('admin');
  const ayse = await directoryRow('ayse');
  assert.ok(isIdentityUuid(admin.user_id) && isIdentityUuid(ayse.user_id));
  assert.notEqual(admin.user_id, ayse.user_id);
  assert.equal(ayse.display_name, 'Ayşe Yılmaz');
  assert.equal(ayse.email, 'ayse@relay.test');
  assert.equal(ayse.status, 'active');
  assert.equal(ayse.version, 1);

  // Nothing changed: nothing written.
  const again = await lib.reconcileDirectory({ confirmDelayMs: 0 });
  assert.deepEqual(
    { ...again, removed: again.removed.length, disabled: again.disabled.length },
    { created: 0, updated: 0, removed: 0, disabled: 0 },
  );
  assert.equal((await directoryRow('ayse')).version, 1);

  // Authelia's own rewrite (a display name, `disabled`) and a user added by
  // hand: adopted, the file untouched.
  const users = await readUsersFile();
  users.ayse.displayname = 'Ayşe Demir';
  users.ayse.disabled = true;
  users.mehmet = person('Mehmet', 'mehmet@relay.test');
  await writeUsersFile(users);
  const written = await readFile(usersFile, 'utf-8');
  const writtenMtime = (await stat(usersFile)).mtimeMs;
  const drift = await lib.reconcileDirectory({ confirmDelayMs: 0 });
  assert.equal(drift.created, 1);
  assert.equal(drift.updated, 1);
  const changed = await directoryRow('ayse');
  assert.equal(changed.user_id, ayse.user_id, 'the same user');
  assert.equal(changed.display_name, 'Ayşe Demir');
  assert.equal(changed.status, 'disabled');
  assert.equal(changed.version, 2);
  assert.equal(await readFile(usersFile, 'utf-8'), written);
  assert.equal((await stat(usersFile)).mtimeMs, writtenMtime);
  assert.notEqual(beforeText, written);
  assert.ok(beforeMtime <= writtenMtime);
  assert.equal(restarts, 0, 'a reconcile never restarts Authelia');

  const audits = await lib.listAudit({ action: 'directory.' });
  const updated = audits.find((a) => a.action === 'directory.user.updated');
  assert.deepEqual(updated.details, {
    userId: ayse.user_id,
    changed: ['displayName', 'status'],
    status: 'disabled',
  });

  // Back as it was for the tests below.
  delete users.ayse.disabled;
  users.ayse.displayname = 'Ayşe Yılmaz';
  delete users.mehmet;
  await writeUsersFile(users);
  await lib.reconcileDirectory({ confirmDelayMs: 0 });
});

test('reconcile: a user gone from users.yml is removed as deleted outside — only when two reads agree; an empty file changes nothing', async () => {
  const users = await readUsersFile();
  users.zeynep = person('Zeynep', 'zeynep@relay.test');
  await writeUsersFile(users);
  await lib.reconcileDirectory({ confirmDelayMs: 0 });
  const zeynep = await directoryRow('zeynep');

  // A read that met a file being rewritten: zeynep is back by the second read.
  const without = Object.fromEntries(Object.entries(users).filter(([name]) => name !== 'zeynep'));
  await writeUsersFile(without);
  const reconciling = lib.reconcileDirectory({ confirmDelayMs: 200 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await writeUsersFile(users);
  const transient = await reconciling;
  assert.equal(transient.removed.length, 0);
  assert.equal((await directoryRow('zeynep')).status, 'active');

  // Gone in both reads: removed, deleted outside Lamaste, the name kept.
  await writeUsersFile(without);
  const gone = await lib.reconcileDirectory({ confirmDelayMs: 20 });
  assert.deepEqual(
    gone.removed.map((r) => [r.userId, r.reason]),
    [[zeynep.user_id, 'deleted-outside']],
  );
  const tomb = await lib.getDirectoryUser(zeynep.user_id);
  assert.equal(tomb.status, 'removed');
  assert.equal(tomb.removedReason, 'deleted-outside');
  assert.equal(tomb.username, 'zeynep');
  assert.equal(tomb.displayName, 'Zeynep');
  assert.equal(tomb.version, zeynep.version + 1);

  // An empty users file is never a real state: nothing is removed.
  await writeUsersFile({});
  await assert.rejects(lib.reconcileDirectory({ confirmDelayMs: 0 }), /lists no users/);
  await writeFile(usersFile, 'users: [not, a, map]\n');
  await assert.rejects(lib.reconcileDirectory({ confirmDelayMs: 0 }), /not a users file/);
  assert.equal((await directoryRow('admin')).status, 'active');
  await writeUsersFile(without);
  await lib.reconcileDirectory({ confirmDelayMs: 0 });
});

// ---------------------------------------------------------------------------
// The users API
// ---------------------------------------------------------------------------

test('users API: ids and status; disable and enable; the last enabled administrator cannot be disabled', async () => {
  const list = await call('GET', '/api/users');
  assert.equal(list.statusCode, 200);
  const ayse = list.json().users.find((u) => u.username === 'ayse');
  assert.ok(isIdentityUuid(ayse.userId));
  assert.equal(ayse.status, 'active');
  assert.equal(ayse.disabled, false);

  const restartsBefore = restarts;
  const bustsBefore = gatekeeper.state.sessionBusts;
  const disabled = await call('PUT', '/api/users/ayse', { disabled: true });
  assert.equal(disabled.statusCode, 200, disabled.body);
  assert.equal(
    gatekeeper.state.sessionBusts,
    bustsBefore + 1,
    'Gatekeeper dropped its cached sessions with Authelia’s',
  );
  assert.equal(disabled.json().user.disabled, true);
  assert.equal(disabled.json().user.status, 'disabled');
  assert.equal(disabled.json().user.userId, ayse.userId);
  assert.equal((await readUsersFile()).ayse.disabled, true);
  assert.equal((await directoryRow('ayse')).status, 'disabled');
  assert.equal(restarts, restartsBefore + 1, 'Authelia restarted once, after the directory');
  // Disabling ends the user's desktop sessions: an epoch keyed by the user's id.
  assert.ok(lib.getConfig().userEpochs?.[ayse.userId] > 0);
  assert.equal('ayse' in lib.getConfig().userEpochs, false, 'panel.json names nobody');

  const enabled = await call('PUT', '/api/users/ayse', { disabled: false });
  assert.equal(enabled.json().user.status, 'active');
  assert.equal('disabled' in (await readUsersFile()).ayse, false, 'the key goes, not false');
  assert.equal((await directoryRow('ayse')).status, 'active');

  // admin is the only enabled member of `admins`.
  const refused = await call('PUT', '/api/users/admin', { disabled: true });
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.json().code, 'last_admin');
  assert.equal((await readUsersFile()).admin.disabled, undefined);
  // With another enabled administrator it can be.
  await call('PUT', '/api/users/ayse', { groups: ['staff', 'admins'] });
  const allowed = await call('PUT', '/api/users/admin', { disabled: true });
  assert.equal(allowed.statusCode, 200, allowed.body);
  const notAyse = await call('PUT', '/api/users/ayse', { disabled: true });
  assert.equal(notAyse.statusCode, 400, 'ayse is now the last enabled administrator');
  await call('PUT', '/api/users/admin', { disabled: false });
  await call('PUT', '/api/users/ayse', { groups: ['staff'] });

  const missing = await call('PUT', '/api/users/nobody', { disabled: true });
  assert.equal(missing.statusCode, 404);
});

test('users API: delete leaves a tombstone; the username back is a new user', async () => {
  const created = await call('POST', '/api/users', {
    username: 'mehmet',
    displayname: 'Mehmet Kaya',
    email: 'mehmet@relay.test',
    password: 'correct-horse-battery',
  });
  assert.equal(created.statusCode, 201, created.body);
  const firstId = created.json().user.userId;
  assert.ok(isIdentityUuid(firstId));
  const duplicate = await call('POST', '/api/users', {
    username: 'mehmet',
    displayname: 'Mehmet Kaya',
    email: 'mehmet@relay.test',
    password: 'correct-horse-battery',
  });
  assert.equal(duplicate.statusCode, 409);

  const deleted = await call('DELETE', '/api/users/mehmet');
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.equal(deleted.json().userId, firstId);
  assert.equal('erased' in deleted.json(), false);
  const tomb = await lib.getDirectoryUser(firstId);
  assert.equal(tomb.status, 'removed');
  assert.equal(tomb.removedReason, 'deleted');
  assert.equal(tomb.username, 'mehmet', 'the name stays, for history');
  assert.equal(tomb.email, 'mehmet@relay.test');
  assert.equal((await readUsersFile()).mehmet, undefined);

  const again = await call('POST', '/api/users', {
    username: 'mehmet',
    displayname: 'Mehmet Öz',
    email: 'mehmet.oz@relay.test',
    password: 'correct-horse-battery',
  });
  assert.equal(again.statusCode, 201);
  assert.notEqual(again.json().user.userId, firstId, 'a username that comes back is a new user');
  assert.equal((await lib.getDirectoryUser(firstId)).status, 'removed');

  const last = await call('DELETE', '/api/users/nobody');
  assert.equal(last.statusCode, 404);
  await call('DELETE', '/api/users/mehmet');
});

test('erase: a live user is refused; a tombstone is scrubbed with its invitations and access-request log', async () => {
  const live = await directoryRow('ayse');
  const refused = await call('POST', `/api/identity/directory/${live.user_id}/erase`);
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().code, 'user_not_removed');
  const unknown = await call(
    'POST',
    '/api/identity/directory/00000000-0000-4000-8000-000000000000/erase',
  );
  assert.equal(unknown.statusCode, 404);
  const malformed = await call('POST', '/api/identity/directory/not-an-id/erase');
  assert.equal(malformed.statusCode, 400);

  // ali: invited, accepted, deleted. A later invitation for the same
  // username is someone else's and stays.
  await call('POST', '/api/users', {
    username: 'ali',
    displayname: 'Ali Veli',
    email: 'ali@relay.test',
    password: 'correct-horse-battery',
  });
  const ali = await directoryRow('ali');
  await call('DELETE', '/api/users/ali');
  const removedAt = (await lib.getDirectoryUser(ali.user_id)).removedAt;
  const earlier = new Date(Date.parse(removedAt) - 60_000).toISOString();
  const later = new Date(Date.parse(removedAt) + 60_000).toISOString();
  await lib.writeInvitations([
    {
      id: 'i1',
      token: 'a'.repeat(64),
      username: 'ali',
      email: 'ali@relay.test',
      createdAt: earlier,
      used: true,
    },
    {
      id: 'i2',
      token: 'b'.repeat(64),
      username: 'ali',
      email: 'new@relay.test',
      createdAt: later,
      used: false,
    },
    {
      id: 'i3',
      token: 'c'.repeat(64),
      username: 'ayse',
      email: 'ayse@relay.test',
      createdAt: earlier,
      used: true,
    },
  ]);
  gatekeeper.accessLog.push(
    { username: 'ali', timestamp: earlier },
    { username: 'ali', timestamp: later },
    { username: 'ayse', timestamp: earlier },
  );

  // Gatekeeper down: nothing is scrubbed, the tombstone still names the user.
  gatekeeper.state.unreachable = true;
  const unavailable = await call('POST', `/api/identity/directory/${ali.user_id}/erase`);
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.json().code, 'gatekeeper_unavailable');
  assert.equal((await lib.getDirectoryUser(ali.user_id)).username, 'ali');
  gatekeeper.state.unreachable = false;

  const erased = await call('POST', `/api/identity/directory/${ali.user_id}/erase`);
  assert.equal(erased.statusCode, 200, erased.body);
  assert.equal(erased.json().invitationsPurged, 1);
  assert.equal(erased.json().accessLogPurged, 1);
  const purge = gatekeeper.calls.filter((c) => c.path.startsWith('/api/access-log'));
  // The username in the body, never in a URL.
  assert.deepEqual(purge.at(-1), {
    method: 'POST',
    path: '/api/access-log/purge',
    body: { username: 'ali', before: removedAt },
  });
  assert.deepEqual(
    (await lib.readInvitations()).map((inv) => inv.id),
    ['i2', 'i3'],
  );
  assert.deepEqual(gatekeeper.accessLog, [
    { username: 'ali', timestamp: later },
    { username: 'ayse', timestamp: earlier },
  ]);
  const scrubbed = await lib.getDirectoryUser(ali.user_id);
  assert.equal(scrubbed.username, null);
  assert.equal(scrubbed.displayName, null);
  assert.equal(scrubbed.email, null);
  assert.ok(scrubbed.erasedAt);
  assert.equal(scrubbed.status, 'removed');

  const twice = await call('POST', `/api/identity/directory/${ali.user_id}/erase`);
  assert.equal(twice.statusCode, 409);
  assert.equal(twice.json().code, 'already_erased');

  const listing = await call('GET', '/api/identity/directory');
  assert.equal(listing.statusCode, 200);
  const row = listing.json().users.find((u) => u.userId === ali.user_id);
  assert.equal(row.erasure.requestedBy, 'admin');
  assert.deepEqual(row.pendingErasures, []);
  assert.ok(isIdentityUuid(listing.json().directoryId));
});

test('delete with erase=true scrubs the tombstone at once', async () => {
  await call('POST', '/api/users', {
    username: 'deniz',
    displayname: 'Deniz',
    email: 'deniz@relay.test',
    password: 'correct-horse-battery',
  });
  const deniz = await directoryRow('deniz');
  const res = await call('DELETE', '/api/users/deniz?erase=true');
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(
    { userId: res.json().userId, erased: res.json().erased },
    { userId: deniz.user_id, erased: true },
  );
  const erased = await lib.getDirectoryUser(deniz.user_id);
  assert.equal(erased.username, null);
  assert.ok(erased.erasedAt);
  assert.equal((await call('DELETE', '/api/users/ayse?erase=maybe')).statusCode, 400);
});

test('an accepted invitation creates the user through the lock: an id at once, the invitation used', async () => {
  const token = 'd'.repeat(64);
  const invitations = await lib.readInvitations();
  await lib.writeInvitations([
    ...invitations,
    {
      id: 'i4',
      token,
      username: 'can',
      email: 'can@relay.test',
      groups: ['staff'],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      used: false,
      acceptedAt: null,
    },
  ]);
  const restartsBefore = restarts;
  const res = await app.inject({
    method: 'POST',
    url: `/api/invite/${token}/accept`,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ password: 'correct-horse-battery' }),
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(restarts, restartsBefore + 1);
  const can = await directoryRow('can');
  assert.ok(isIdentityUuid(can.user_id));
  assert.equal(can.email, 'can@relay.test');
  const accepted = (await lib.readInvitations()).find((inv) => inv.id === 'i4');
  assert.equal(accepted.used, true);
  assert.ok(accepted.acceptedAt);
  const [created] = await lib.listAudit({ action: 'directory.user.created' });
  assert.equal(created.actor, 'invitation');
  assert.deepEqual(created.details, { userId: can.user_id, status: 'active' });
});

const newUser = (username, extra = {}) =>
  call('POST', '/api/users', {
    username,
    displayname: username.toUpperCase(),
    email: `${username}@relay.test`,
    password: 'correct-horse-battery',
    ...extra,
  });

test('a reused username never inherits: Gatekeeper and Authelia’s second factors cleared at every creation over a tombstone; an OIDC identity refuses it', async () => {
  assert.equal((await newUser('gul')).statusCode, 201);
  autheliaStorage.state.purged.length = 0;
  const deleted = await call('DELETE', '/api/users/gul');
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.deepEqual(autheliaStorage.state.purged, ['gul'], 'second factors go with the user');
  const first = deleted.json().userId;
  assert.ok((await lib.getDirectoryUser(first)).principalClearedAt);

  // A restored gatekeeper.db brings a grant and a membership back: no
  // cleanup is pending, and the next creation clears them all the same.
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'gul',
    resourceType: 'tunnel',
    resourceId: 'wiki',
  });
  gatekeeper.setGroup('ops', ['gul']);
  assert.equal(await lib.principalCleanupPending('gul'), false);
  autheliaStorage.state.purged.length = 0;
  gatekeeper.calls.length = 0;
  const again = await newUser('gul');
  assert.equal(again.statusCode, 201, again.body);
  assert.deepEqual(
    gatekeeper.calls.filter((c) => c.path === '/api/principals/user/remove').map((c) => c.body),
    [{ username: 'gul' }],
  );
  assert.equal(
    gatekeeper.grants.some((g) => g.principalId === 'gul'),
    false,
  );
  assert.deepEqual(gatekeeper.groups.get('ops').members, []);
  assert.deepEqual(autheliaStorage.state.purged, ['gul'], 'and Authelia’s, before the new user');
  assert.notEqual(again.json().user.userId, first);

  // Authelia's second factors that could not be deleted at removal keep
  // the username from anyone until they can be.
  autheliaStorage.state.failPurge = true;
  const failed = await call('DELETE', '/api/users/gul');
  assert.equal(failed.statusCode, 200);
  assert.ok(failed.json().warnings.some((w) => w.step === 'authelia-storage'));
  const blocked = await newUser('gul');
  assert.equal(blocked.statusCode, 503);
  assert.equal(blocked.json().code, 'authelia_storage_unavailable');
  assert.equal((await readUsersFile()).gul, undefined, 'users.yml untouched');
  autheliaStorage.state.failPurge = false;

  // A username Authelia holds an OpenID Connect identity for is never given.
  autheliaStorage.state.identifiers.add('hakan');
  const refused = await newUser('hakan');
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().code, 'username_has_oidc_identity');
  assert.equal((await readUsersFile()).hakan, undefined);
  // Nor one that cannot be checked.
  autheliaStorage.state.failCheck = true;
  const unchecked = await newUser('irem');
  assert.equal(unchecked.statusCode, 503);
  assert.equal(unchecked.json().code, 'authelia_storage_unavailable');
  assert.equal((await readUsersFile()).irem, undefined);
  autheliaStorage.state.failCheck = false;
  assert.equal(
    JSON.stringify(unchecked.json()).includes('irem'),
    false,
    'the refusal names nobody',
  );
});

test('offboarding is one function: a disable or deletion made outside Lamaste is adopted and offboarded like one made through it', async () => {
  assert.equal((await newUser('kaan')).statusCode, 201);
  const kaan = (await lib.findDirectoryUser('kaan')).userId;
  await lib.createGrant('kaan', '@lamalibre/herd-server', { info() {}, warn() {} });
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'kaan',
    resourceType: 'tunnel',
    resourceId: 'wiki',
  });

  // Disabled by hand in users.yml: the reconcile adopts it and offboards.
  const busts = gatekeeper.state.sessionBusts;
  const file = await readUsersFile();
  file.kaan.disabled = true;
  await writeUsersFile(file);
  await lib.reconcileDirectory({ confirmDelayMs: 0 });
  assert.equal((await directoryRow('kaan')).status, 'disabled');
  assert.ok(lib.getConfig().userEpochs[kaan] > 0, 'desktop sessions end');
  assert.equal(gatekeeper.state.sessionBusts, busts + 1, 'cached session verdicts go');
  assert.equal((await lib.listGrantsForUser('kaan')).length, 1, 'a disabled user keeps grants');
  assert.ok(gatekeeper.grants.some((g) => g.principalId === 'kaan'));

  // Gone from users.yml by hand: tombstoned, and offboarded as a deletion.
  autheliaStorage.state.purged.length = 0;
  delete file.kaan;
  await writeUsersFile(file);
  const warned = [];
  const quiet = { info() {}, warn: (obj, msg) => warned.push(msg), error() {} };
  await lib.reconcileDirectory({ confirmDelayMs: 0, logger: quiet });
  assert.deepEqual(warned, [], 'every offboarding step went through');
  const tomb = await lib.getDirectoryUser(kaan);
  assert.equal(tomb.removedReason, 'deleted-outside');
  assert.ok(tomb.principalClearedAt, 'Gatekeeper cleared at once, not at the next tick');
  assert.equal(
    gatekeeper.grants.some((g) => g.principalId === 'kaan'),
    false,
  );
  assert.deepEqual(autheliaStorage.state.purged, ['kaan']);
  assert.deepEqual(await lib.listGrantsForUser('kaan'), [], 'legacy grants go');
  assert.equal(
    (await lib.getDirectoryUser(kaan)).username,
    'kaan',
    'the tombstone keeps the name until an erasure',
  );
});

test('a change Authelia rewrites away is made again; one that never sticks is not reported as done', async () => {
  // Authelia's password reset rewrites users.yml from what it read at
  // start — here once, just before its restart.
  let rewrites = 1;
  onRestart = async () => {
    if (rewrites <= 0) return;
    rewrites -= 1;
    const current = await readUsersFile();
    delete current.ayse.disabled;
    await writeUsersFile(current);
  };
  const before = restarts;
  const made = await call('PUT', '/api/users/ayse', { disabled: true });
  assert.equal(made.statusCode, 200, made.body);
  assert.equal(made.json().ok, true);
  assert.equal(made.json().warnings, undefined);
  assert.equal((await readUsersFile()).ayse.disabled, true);
  assert.equal(restarts, before + 2, 'made again, and Authelia restarted again');
  onRestart = null;
  await call('PUT', '/api/users/ayse', { disabled: false });

  // Rewritten every time: not done, and the answer says so.
  onRestart = async () => {
    const current = await readUsersFile();
    delete current.ayse.disabled;
    await writeUsersFile(current);
  };
  const lost = await call('PUT', '/api/users/ayse', { disabled: true });
  onRestart = null;
  assert.equal(lost.statusCode, 200);
  assert.equal(lost.json().ok, false);
  assert.equal(lost.json().persisted, false);
  assert.ok(lost.json().warnings.some((w) => w.step === 'persist'));
  // The directory follows the file as it is.
  await lib.reconcileDirectory({ confirmDelayMs: 0 });
  assert.equal((await directoryRow('ayse')).status, 'active');
});

test('the users API audits a password set, a TOTP reset and a groups change by user id only', async () => {
  const ayse = (await lib.findDirectoryUser('ayse')).userId;
  assert.equal(
    (await call('PUT', '/api/users/ayse', { password: 'another-long-one' })).statusCode,
    200,
  );
  assert.equal(
    (await call('PUT', '/api/users/ayse', { groups: ['staff', 'ops'] })).statusCode,
    200,
  );
  // The same groups again change nothing, and are not audited.
  await call('PUT', '/api/users/ayse', { groups: ['ops', 'staff'] });
  assert.equal((await call('POST', '/api/users/ayse/reset-totp')).statusCode, 200);
  await call('PUT', '/api/users/ayse', { groups: ['staff'] });
  // The newest four (earlier tests changed groups too).
  const entries = (await lib.listAudit({ action: 'user.', limit: 4 })).reverse();
  assert.deepEqual(
    entries.map((e) => [e.action, e.details]),
    [
      ['user.password.set', { userId: ayse }],
      ['user.groups.changed', { userId: ayse, added: ['ops'], removed: [] }],
      ['user.totp.reset', { userId: ayse }],
      ['user.groups.changed', { userId: ayse, added: [], removed: ['ops'] }],
    ],
  );
  assert.equal(JSON.stringify(entries).includes('ayse'), false);
});

test('desktop sessions are bound to the user id: a disabled, deleted or reused username’s sessions end', async () => {
  const secret = crypto.randomBytes(32).toString('hex');
  await lib.updateConfig({ sessionSecret: secret });
  const { default: Fastify } = await import('fastify');
  const { default: sessionPlugin } = await import('../src/middleware/user-access-session.js');
  const desk = Fastify({ logger: false });
  await desk.register(async (scope) => {
    await scope.register(sessionPlugin);
    scope.get('/me', async (request) => ({ username: request.userAccessUsername }));
  });
  await desk.ready();
  /** A session token as the panel signs one, issued `age` seconds ago. */
  const token = (fields, age = 10) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        iat: now - age,
        exp: now - age + 12 * 3600,
        lastActivity: now - age,
        type: 'user-access',
        ...fields,
      }),
    ).toString('base64url');
    const sig = crypto
      .createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(payload)
      .digest('base64url');
    return `${payload}.${sig}`;
  };
  const me = async (t) =>
    (await desk.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${t}` } }))
      .statusCode;
  try {
    assert.equal((await newUser('leyla')).statusCode, 201);
    const leyla = (await lib.findDirectoryUser('leyla')).userId;
    const session = token({ username: 'leyla', userId: leyla });
    assert.equal(await me(session), 200);
    assert.equal(await me(token({ username: 'leyla' })), 401, 'no user id: issued before 4.5');
    assert.equal(await me(token({ username: 'leyla', userId: crypto.randomUUID() })), 401);

    await call('PUT', '/api/users/leyla', { disabled: true });
    assert.equal(await me(session), 401, 'disabled');
    await call('PUT', '/api/users/leyla', { disabled: false });
    assert.equal(await me(session), 401, 'its epoch outlives the disable');
    const fresh = token({ username: 'leyla', userId: leyla }, -1);
    assert.equal(await me(fresh), 200, 'a session issued after it is fine');

    await call('DELETE', '/api/users/leyla');
    assert.equal(await me(fresh), 401, 'deleted');
    assert.equal((await newUser('leyla')).statusCode, 201);
    assert.equal(await me(fresh), 401, 'the username given to someone else');
    await call('DELETE', '/api/users/leyla');
    assert.equal(
      Object.keys(lib.getConfig().userEpochs).every(isIdentityUuid),
      true,
      'panel.json keys epochs by user id',
    );
  } finally {
    await desk.close();
  }
});

test('session epochs: usernames (keys before 4.5) and epochs too old to reject anything are dropped', () => {
  const now = 1_800_000_000;
  const kept = crypto.randomUUID();
  const old = crypto.randomUUID();
  assert.deepEqual(
    lib.pruneUserEpochs({ ayse: now, [kept]: now - 60, [old]: now - 12 * 3600 - 1 }, now),
    { [kept]: now - 60 },
  );
});

test('an unreadable users file is never written over, and its content never logged', async () => {
  const corrupt = `users:\n  admin:\n    password: "${HASH}"\n   email: [broken\n`;
  await writeFile(usersFile, corrupt);
  logLines.length = 0;
  const created = await call('POST', '/api/users', {
    username: 'emre',
    displayname: 'Emre',
    email: 'emre@relay.test',
    password: 'correct-horse-battery',
  });
  assert.equal(created.statusCode, 500);
  const disabled = await call('PUT', '/api/users/admin', { disabled: true });
  assert.equal(disabled.statusCode, 500);
  const token = 'e'.repeat(64);
  await lib.writeInvitations([
    ...(await lib.readInvitations()),
    {
      id: 'i5',
      token,
      username: 'emre',
      email: 'emre@relay.test',
      groups: [],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      used: false,
      acceptedAt: null,
    },
  ]);
  const accepted = await app.inject({
    method: 'POST',
    url: `/api/invite/${token}/accept`,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ password: 'correct-horse-battery' }),
  });
  assert.equal(accepted.statusCode, 500);
  await assert.rejects(lib.reconcileDirectory({ confirmDelayMs: 0 }), /not valid YAML at line/);
  assert.equal(await readFile(usersFile, 'utf-8'), corrupt, 'nothing was written over it');
  const logged = logLines.join('');
  assert.equal(logged.includes(HASH), false, 'no password hash in a log line');
  assert.equal(logged.includes('broken'), false, 'no line of the file in a log line');
  assert.equal(await directoryRow('emre'), null);
});

test('audit entries of the directory name users by id only', async () => {
  const entries = await lib.listAudit({ action: 'directory.', limit: 200 });
  assert.ok(entries.length >= 8);
  const text = JSON.stringify(entries);
  for (const personal of [
    'ayse',
    'Ayşe',
    'mehmet',
    'Mehmet',
    'zeynep',
    'ali@relay.test',
    'Ali Veli',
    'deniz',
    'can@relay.test',
  ]) {
    assert.equal(text.includes(personal), false, `the audit names ${personal}`);
  }
  for (const entry of entries) {
    const ids = entry.details.userIds ?? [entry.details.userId];
    assert.ok(ids.length > 0 && ids.every(isIdentityUuid), entry.action);
  }
  // Every Lamaste deletion cleared the user's Gatekeeper principal.
  assert.ok(entries.some((e) => e.action === 'directory.user.principal-cleared'));
});
