/**
 * Slice 6, plugin audiences on the relay: who is a member of an
 * agent-hosted plugin — Gatekeeper plugin grants with roles, to a user or a
 * Lamaste group, restricted to the roles the plugin declares; grants
 * without roles never count — and what each user's row in the audience
 * says: the member in full with only the declared attributes, or why they
 * left (`unentitled`, `deleted` with the attributes they had then,
 * `erased` with none). Rows are written only when they change, each change
 * with a new store-wide seq. Entitlements are set and removed through the
 * panel (roles checked against the manifest, one grant per principal) and
 * through the Gatekeeper proxy; both recompute the audience. Gatekeeper is
 * a fake (`fake-gatekeeper.js`), Authelia a users file.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { AudienceChangeSchema, normalizeIdentityBlock } from '@lamalibre/lamaste';

import { createFakeAutheliaStorage } from './fake-authelia-storage.js';
import { installFakeGatekeeper } from './fake-gatekeeper.js';

const HASH = '$2b$12$abcdefghijklmnopqrstuuJ2s4L6rjpDLHi3qL7Nn5D0o3M6a1g2a';
const MX_IDENTITY = normalizeIdentityBlock({
  roles: [
    { id: 'viewer', label: 'Viewer' },
    { id: 'editor', label: 'Editor', description: 'Changes the figures' },
  ],
  attributes: ['email', 'displayName'],
});
const NX_IDENTITY = normalizeIdentityBlock({ roles: [{ id: 'viewer', label: 'Viewer' }] });

let dir;
let usersFile;
let users;
let lib;
let app;
let gatekeeper;
let autheliaStorage;

const registryEntry = (name, identity) => ({
  name,
  route: name,
  packageName: `@lamalibre/${name}-server`,
  version: '1.0.0',
  capabilities: [],
  hosting: 'agent',
  agent: {},
  ...(identity ? { identity } : {}),
  status: 'enabled',
  installedAt: '2026-10-22T00:00:00.000Z',
});

async function saveUsers() {
  await writeFile(usersFile, yaml.dump({ users }, { lineWidth: -1 }), { mode: 0o660 });
  await lib.reconcileDirectory({ confirmDelayMs: 0 });
}

const person = (displayname, email, groups = []) => ({
  displayname,
  email,
  password: HASH,
  groups,
});

async function userId(username) {
  return (await lib.findDirectoryUser(username))?.userId ?? null;
}

async function rows(plugin) {
  return Object.fromEntries((await lib.listAudience(plugin)).map((row) => [row.userId, row]));
}

async function counter() {
  const db = await lib.getStateDb();
  return db.prepare('SELECT seq FROM directory_counter').get().seq;
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
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-s6-audience-'));
  const stateDir = path.join(dir, 'state');
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

  lib = {
    ...(await import('../src/lib/state-db.js')),
    ...(await import('../src/lib/config.js')),
    ...(await import('../src/lib/authelia.js')),
    ...(await import('../src/lib/gatekeeper-client.js')),
    ...(await import('../src/lib/directory.js')),
    ...(await import('../src/lib/audience.js')),
    ...(await import('../src/lib/entitlements.js')),
    ...(await import('../src/lib/plugins.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/identity-sync.js')),
    ...(await import('../src/lib/retained-data.js')),
  };
  await lib.loadConfig();
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

  users = {
    admin: person('Admin', 'admin@relay.test', ['admins']),
    ayse: person('Ayşe Yılmaz', 'ayse@relay.test'),
    mehmet: person('Mehmet Kaya', 'mehmet@relay.test'),
    zeynep: person('Zeynep Ak', 'zeynep@relay.test'),
    ali: person('Ali Veli', 'ali@relay.test'),
    selin: person('Selin Kar', 'selin@relay.test'),
  };
  await saveUsers();
  await lib.writePlugins({
    plugins: [
      registryEntry('mx', MX_IDENTITY),
      registryEntry('nx', NX_IDENTITY),
      registryEntry('px', null),
    ],
  });

  const { default: Fastify } = await import('fastify');
  const { default: errors } = await import('../src/middleware/errors.js');
  const { default: pluginIdentityRoutes } =
    await import('../src/routes/management/plugin-identity.js');
  const { default: gatekeeperProxyRoutes } =
    await import('../src/routes/management/gatekeeper-proxy.js');
  app = Fastify({ logger: false });
  await app.register(errors);
  app.decorateRequest('certRole', null);
  app.addHook('onRequest', async (request) => {
    request.certRole = request.headers['x-test-role'] ?? 'unknown';
  });
  app.decorate('requireRole', (roles) => async (request, reply) => {
    if (request.certRole === 'admin' || roles.includes(request.certRole)) return;
    return reply.code(403).send({ error: 'forbidden' });
  });
  await app.register(pluginIdentityRoutes, { prefix: '/api' });
  await app.register(gatekeeperProxyRoutes, { prefix: '/api' });
  await app.ready();
});

after(async () => {
  lib.setAutheliaForTests(null);
  lib.setGatekeeperClientForTests(null);
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

test('grants without roles never count; direct and group roles do, restricted to the declared ones', async () => {
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'ayse',
    resourceType: 'plugin',
    resourceId: 'mx',
    context: { roles: ['viewer'] },
  });
  // Legacy and desktop grants: no roles, no membership.
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'mehmet',
    resourceType: 'plugin',
    resourceId: 'mx',
    context: { target: 'local' },
  });
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'mehmet',
    resourceType: 'plugin',
    resourceId: 'mx',
    context: { roles: [] },
  });
  gatekeeper.setGroup('ops', ['zeynep', 'ali']);
  gatekeeper.addGrant({
    principalType: 'group',
    principalId: 'ops',
    resourceType: 'plugin',
    resourceId: 'mx',
    context: { roles: ['editor', 'owner'] },
  });
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'ali',
    resourceType: 'plugin',
    resourceId: 'mx',
    context: { roles: ['viewer'] },
  });
  // Nobody the directory knows, and a role nx does not declare.
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'stranger',
    resourceType: 'plugin',
    resourceId: 'mx',
    context: { roles: ['viewer'] },
  });
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'ayse',
    resourceType: 'plugin',
    resourceId: 'nx',
    context: { roles: ['owner'] },
  });
  // A tunnel grant with roles is not a plugin's.
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'mehmet',
    resourceType: 'tunnel',
    resourceId: 'mx',
    context: { roles: ['viewer'] },
  });

  const result = await lib.recomputeAudiences();
  assert.deepEqual(result.plugins, [
    { plugin: 'mx', written: 3 },
    { plugin: 'nx', written: 0 },
  ]);
  const mx = await rows('mx');
  const [ayse, ali, zeynep, mehmet] = await Promise.all(
    ['ayse', 'ali', 'zeynep', 'mehmet'].map(userId),
  );
  assert.deepEqual(Object.keys(mx).sort(), [ayse, ali, zeynep].sort());
  assert.equal(mx[mehmet], undefined);
  assert.deepEqual(mx[ayse].change, {
    kind: 'upsert',
    member: {
      userId: ayse,
      username: 'ayse',
      displayName: 'Ayşe Yılmaz',
      email: 'ayse@relay.test',
      roles: ['viewer'],
      status: 'active',
      version: 1,
    },
  });
  assert.deepEqual(mx[ali].change.member.roles, ['editor', 'viewer']);
  assert.deepEqual(mx[zeynep].change.member.roles, ['editor']);
  for (const row of Object.values(mx)) {
    assert.ok(AudienceChangeSchema.safeParse({ seq: row.seq, ...row.change }).success);
    assert.equal(row.version, 1);
  }
  assert.equal(new Set(Object.values(mx).map((r) => r.seq)).size, 3, 'one seq per row');
  assert.deepEqual(await lib.listAudience('nx'), []);
  assert.deepEqual(await lib.listAudience('px'), []);

  // nx declares displayName only (the default): no email.
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'ayse',
    resourceType: 'plugin',
    resourceId: 'nx',
    context: { roles: ['viewer'] },
  });
  await lib.recomputeAudiences();
  const [nxAyse] = await lib.listAudience('nx');
  assert.deepEqual(nxAyse.change.member, {
    userId: ayse,
    username: 'ayse',
    displayName: 'Ayşe Yılmaz',
    roles: ['viewer'],
    status: 'active',
    version: 1,
  });
});

test('a recompute that changes nothing writes nothing; a disabled user stays a member, status disabled', async () => {
  const before = await rows('mx');
  const seq = await counter();
  const again = await lib.recomputeAudiences();
  assert.deepEqual(
    again.plugins.map((p) => p.written),
    [0, 0],
  );
  assert.equal(await counter(), seq);
  assert.deepEqual(await rows('mx'), before);

  users.ayse.disabled = true;
  await saveUsers();
  await lib.recomputeAudiences();
  const ayse = await userId('ayse');
  const after = await rows('mx');
  assert.equal(after[ayse].change.member.status, 'disabled');
  assert.equal(after[ayse].version, 2);
  assert.equal(after[ayse].change.member.version, 2, "the member's version is the row's");
  assert.ok(after[ayse].seq > seq);
  delete users.ayse.disabled;
  await saveUsers();
  await lib.recomputeAudiences();
  assert.equal((await rows('mx'))[ayse].change.member.status, 'active');
});

test('a plugin’s audience is its domain’s members: leaving the domain is leaving the audience (unentitled), coming back is coming back', async () => {
  const domains = await import('../src/lib/domains.js');
  const ayse = await userId('ayse');
  assert.equal((await rows('mx'))[ayse].change.kind, 'upsert');
  await domains.removeDomainMember('relay.test', ayse, { actor: 'admin' });
  assert.deepEqual((await rows('mx'))[ayse].change, {
    kind: 'remove',
    userId: ayse,
    reason: 'unentitled',
    last: { username: 'ayse', displayName: 'Ayşe Yılmaz', email: 'ayse@relay.test' },
  });
  await domains.addDomainMember('relay.test', ayse, { actor: 'admin' });
  assert.equal((await rows('mx'))[ayse].change.kind, 'upsert');
});

test('a user who loses every role leaves as unentitled, keeping the attributes they had then', async () => {
  const ali = await userId('ali');
  const direct = gatekeeper.grants.find(
    (g) => g.principalId === 'ali' && g.resourceType === 'plugin',
  );
  gatekeeper.grants.splice(gatekeeper.grants.indexOf(direct), 1);
  gatekeeper.setGroup('ops', ['zeynep']);
  await lib.recomputeAudiences();
  const row = (await rows('mx'))[ali];
  assert.deepEqual(row.change, {
    kind: 'remove',
    userId: ali,
    reason: 'unentitled',
    last: { username: 'ali', displayName: 'Ali Veli', email: 'ali@relay.test' },
  });
  assert.equal(row.version, 2);

  // What the directory learns about them afterwards is not the plugin's.
  users.ali.displayname = 'Ali Yeni';
  await saveUsers();
  const seq = (await rows('mx'))[ali].seq;
  await lib.recomputeAudiences();
  assert.equal((await rows('mx'))[ali].seq, seq);
  assert.equal((await rows('mx'))[ali].change.last.displayName, 'Ali Veli');
});

test('deleted: a remove with the last known attributes; erased: none, rewritten with a new seq', async () => {
  const zeynep = await userId('zeynep');
  await lib.changeUsers(
    async () => {
      const data = await lib.readUsersRaw();
      delete data.users.zeynep;
      await lib.writeUsers(data, { deleting: ['zeynep'] });
      delete users.zeynep;
    },
    { actor: 'admin', deleted: ['zeynep'], confirmDelayMs: 0 },
  );
  const deleted = (await rows('mx'))[zeynep];
  assert.deepEqual(deleted.change, {
    kind: 'remove',
    userId: zeynep,
    reason: 'deleted',
    last: { username: 'zeynep', displayName: 'Zeynep Ak', email: 'zeynep@relay.test' },
  });

  // The group grant still names zeynep; a removed user is never a member.
  gatekeeper.setGroup('ops', ['zeynep']);
  await lib.recomputeAudiences();
  assert.equal((await rows('mx'))[zeynep].seq, deleted.seq);

  await lib.eraseDirectoryUser(zeynep, { actor: 'admin' });
  const erased = (await rows('mx'))[zeynep];
  assert.deepEqual(erased.change, { kind: 'remove', userId: zeynep, reason: 'erased' });
  assert.ok(erased.seq > deleted.seq, 'an erasure after the deletion is a new change');
  assert.equal(erased.version, deleted.version + 1);
  assert.equal(JSON.stringify(erased).includes('zeynep@'), false);
  // Mehmet never was a member: no row, whatever happens to him.
  assert.equal((await rows('mx'))[await userId('mehmet')], undefined);
});

test('Gatekeeper unreachable: every audience stays as it was', async () => {
  const before = await rows('mx');
  gatekeeper.state.unreachable = true;
  gatekeeper.grants.length = 0;
  const result = await lib.recomputeAudiences();
  assert.match(result.error, /unreachable/);
  assert.deepEqual(await rows('mx'), before);
  gatekeeper.state.unreachable = false;
});

test('entitlements through the panel: roles checked, one grant per principal, audited by id, the audience follows', async () => {
  gatekeeper.reset();
  gatekeeper.setGroup('ops', ['ali']);
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'mehmet',
    resourceType: 'plugin',
    resourceId: 'mx',
    context: { target: 'local' },
  });

  const unknown = await call('PUT', '/api/plugins/mx/entitlements', {
    principalType: 'user',
    principalId: 'mehmet',
    roles: ['viewer', 'owner'],
  });
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.json().code, 'unknown_roles');
  assert.deepEqual(unknown.json().unknown, ['owner']);
  const noIdentity = await call('PUT', '/api/plugins/px/entitlements', {
    principalType: 'user',
    principalId: 'mehmet',
    roles: ['viewer'],
  });
  assert.equal(noIdentity.statusCode, 400);
  assert.equal(noIdentity.json().code, 'no_identity');
  const notInstalled = await call('GET', '/api/plugins/qx/entitlements');
  assert.equal(notInstalled.statusCode, 404);
  const noUser = await call('PUT', '/api/plugins/mx/entitlements', {
    principalType: 'user',
    principalId: 'zeynep',
    roles: ['viewer'],
  });
  assert.equal(noUser.statusCode, 404, 'zeynep was erased: the username names nobody now');
  assert.equal(noUser.json().code, 'user_not_found');
  // A deleted user's username, which nobody holds now: refused as such.
  await lib.changeUsers(
    async () => {
      const data = await lib.readUsersRaw();
      delete data.users.selin;
      await lib.writeUsers(data, { deleting: ['selin'] });
      delete users.selin;
    },
    { actor: 'admin', deleted: ['selin'], confirmDelayMs: 0 },
  );
  const deletedUser = await call('PUT', '/api/plugins/mx/entitlements', {
    principalType: 'user',
    principalId: 'selin',
    roles: ['viewer'],
  });
  assert.equal(deletedUser.statusCode, 409);
  assert.equal(deletedUser.json().code, 'username_deleted');
  const noGroup = await call('PUT', '/api/plugins/mx/entitlements', {
    principalType: 'group',
    principalId: 'nobody',
    roles: ['viewer'],
  });
  assert.equal(noGroup.statusCode, 404);
  assert.equal(noGroup.json().code, 'group_not_found');

  const set = await call('PUT', '/api/plugins/mx/entitlements', {
    principalType: 'user',
    principalId: 'mehmet',
    roles: ['viewer', 'editor', 'viewer'],
  });
  assert.equal(set.statusCode, 200, set.body);
  assert.deepEqual(set.json().entitlement.roles, ['editor', 'viewer']);
  const mehmet = await userId('mehmet');
  assert.equal(set.json().entitlement.userId, mehmet);
  assert.deepEqual((await rows('mx'))[mehmet].change.member.roles, ['editor', 'viewer']);

  // Again with other roles: the grant is replaced, not added to.
  const replaced = await call('PUT', '/api/plugins/mx/entitlements', {
    principalType: 'user',
    principalId: 'mehmet',
    roles: ['viewer'],
  });
  assert.equal(replaced.json().changed, true);
  const roleGrants = gatekeeper.grants.filter(
    (g) => g.principalId === 'mehmet' && Array.isArray(g.context.roles),
  );
  assert.deepEqual(
    roleGrants.map((g) => g.context),
    [{ roles: ['viewer'] }],
  );
  const same = await call('PUT', '/api/plugins/mx/entitlements', {
    principalType: 'user',
    principalId: 'mehmet',
    roles: ['viewer'],
  });
  assert.equal(same.json().changed, false);
  assert.deepEqual((await rows('mx'))[mehmet].change.member.roles, ['viewer']);

  const group = await call('PUT', '/api/plugins/mx/entitlements', {
    principalType: 'group',
    principalId: 'ops',
    roles: ['editor'],
  });
  assert.equal(group.statusCode, 200, group.body);
  assert.deepEqual((await rows('mx'))[await userId('ali')].change.member.roles, ['editor']);

  const listed = await call('GET', '/api/plugins/mx/entitlements');
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().roleless, 1);
  assert.deepEqual(
    listed.json().entitlements.map((e) => [e.principalType, e.principalId, e.roles, e.userId]),
    [
      ['group', 'ops', ['editor'], null],
      ['user', 'mehmet', ['viewer'], mehmet],
    ],
  );

  const removed = await call(
    'DELETE',
    '/api/plugins/mx/entitlements?principalType=user&principalId=mehmet',
  );
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(removed.json().revoked, 1);
  assert.equal((await rows('mx'))[mehmet].change.reason, 'unentitled');
  assert.ok(
    gatekeeper.grants.some((g) => g.principalId === 'mehmet' && g.context.target === 'local'),
    'a grant without roles stays',
  );
  const none = await call(
    'DELETE',
    '/api/plugins/mx/entitlements?principalType=user&principalId=mehmet',
  );
  assert.equal(none.statusCode, 404);

  const audits = await lib.listAudit({ plugin: 'mx', action: 'plugin.entitlement.' });
  assert.ok(audits.length >= 4);
  assert.equal(JSON.stringify(audits).includes('mehmet'), false, 'users by id only');
  assert.ok(audits.some((a) => a.details.userId === mehmet));
  assert.ok(audits.some((a) => a.details.group === 'ops'));

  // Gatekeeper's grant limit comes back as it is.
  gatekeeper.state.maxGrants = gatekeeper.grants.length;
  const full = await call('PUT', '/api/plugins/mx/entitlements', {
    principalType: 'user',
    principalId: 'ayse',
    roles: ['viewer'],
  });
  assert.equal(full.statusCode, 503);
  assert.match(full.json().error, /Maximum number of grants/);
  gatekeeper.state.maxGrants = 1000;
  gatekeeper.state.unreachable = true;
  const down = await call('GET', '/api/plugins/mx/entitlements');
  assert.equal(down.statusCode, 503);
  assert.equal(down.json().code, 'gatekeeper_unavailable');
  gatekeeper.state.unreachable = false;
});

test('the Gatekeeper proxy: plugin roles checked and sorted; grant and group changes recompute the audience', async () => {
  const unknown = await call('POST', '/api/gatekeeper/grants', {
    principalType: 'user',
    principalId: 'ayse',
    resourceType: 'plugin',
    resourceId: 'mx',
    context: { roles: ['root'] },
  });
  assert.equal(unknown.statusCode, 400);
  assert.deepEqual(unknown.json().unknown, ['root']);
  for (const roles of ['viewer', [], [1]]) {
    const bad = await call('POST', '/api/gatekeeper/grants', {
      principalType: 'user',
      principalId: 'ayse',
      resourceType: 'plugin',
      resourceId: 'mx',
      context: { roles },
    });
    assert.equal(bad.statusCode, 400, JSON.stringify(roles));
  }
  const noPlugin = await call('POST', '/api/gatekeeper/grants', {
    principalType: 'user',
    principalId: 'ayse',
    resourceType: 'plugin',
    resourceId: 'px',
    context: { roles: ['viewer'] },
  });
  assert.equal(noPlugin.statusCode, 400);
  assert.equal(noPlugin.json().code, 'no_identity');

  const created = await call('POST', '/api/gatekeeper/grants', {
    principalType: 'user',
    principalId: 'ayse',
    resourceType: 'plugin',
    resourceId: 'mx',
    context: { roles: ['viewer', 'editor', 'viewer'] },
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.deepEqual(created.json().grant.context, { roles: ['editor', 'viewer'] });
  const ayse = await userId('ayse');
  assert.deepEqual((await rows('mx'))[ayse].change.member.roles, ['editor', 'viewer']);

  // Grants without roles go through untouched.
  const plain = await call('POST', '/api/gatekeeper/grants', {
    principalType: 'user',
    principalId: 'ayse',
    resourceType: 'tunnel',
    resourceId: 't1',
  });
  assert.equal(plain.statusCode, 201);

  const ali = await userId('ali');
  const out = await call('DELETE', '/api/gatekeeper/groups/ops/members/ali');
  assert.equal(out.statusCode, 200);
  assert.equal((await rows('mx'))[ali].change.reason, 'unentitled');
  const back = await call('POST', '/api/gatekeeper/groups/ops/members', { usernames: ['ali'] });
  assert.equal(back.statusCode, 200);
  assert.equal((await rows('mx'))[ali].change.kind, 'upsert');

  const grant = created.json().grant;
  const revoked = await call('DELETE', `/api/gatekeeper/grants/${grant.grantId}`);
  assert.equal(revoked.statusCode, 200);
  assert.equal((await rows('mx'))[ayse].change.reason, 'unentitled');

  // One user's access-log rows are purged by POST, the username in the
  // body (never in a URL); DELETE clears the whole log and passes no query on.
  gatekeeper.accessLog.push(
    { username: 'ayse', timestamp: '2026-10-01T00:00:00.000Z' },
    { username: 'ali', timestamp: '2026-10-01T00:00:00.000Z' },
  );
  const purged = await call('POST', '/api/gatekeeper/access-log/purge', { username: 'ayse' });
  assert.equal(purged.statusCode, 200, purged.body);
  assert.deepEqual(purged.json(), { ok: true, removed: 1 });
  assert.deepEqual(
    gatekeeper.accessLog.map((row) => row.username),
    ['ali'],
  );
  assert.deepEqual(gatekeeper.calls.at(-1), {
    method: 'POST',
    path: '/api/access-log/purge',
    body: { username: 'ayse' },
  });
  gatekeeper.calls.length = 0;
  await call('DELETE', '/api/gatekeeper/access-log?username=ali');
  assert.deepEqual(
    gatekeeper.calls.map((c) => `${c.method} ${c.path}`),
    ['DELETE /api/access-log'],
  );

  // A username a removed user held, which nobody holds now, takes no grant
  // and no group membership: it would pass to whoever is given it next.
  for (const [url, body] of [
    [
      '/api/gatekeeper/grants',
      {
        principalType: 'user',
        principalId: 'selin',
        resourceType: 'tunnel',
        resourceId: 't1',
      },
    ],
    ['/api/gatekeeper/groups/ops/members', { usernames: ['ali', 'selin'] }],
  ]) {
    const refused = await call('POST', url, body);
    assert.equal(refused.statusCode, 409, url);
    assert.equal(refused.json().code, 'username_deleted');
  }
  assert.equal(
    gatekeeper.grants.some((g) => g.principalId === 'selin'),
    false,
  );
  assert.equal(gatekeeper.groups.get('ops').members.includes('selin'), false);
  // A username the directory never saw goes through: a user still to come.
  const future = await call('POST', '/api/gatekeeper/grants', {
    principalType: 'user',
    principalId: 'newcomer',
    resourceType: 'tunnel',
    resourceId: 't1',
  });
  assert.equal(future.statusCode, 201, future.body);
});

test('the audience and identity views', async () => {
  const audience = await call('GET', '/api/plugins/mx/audience');
  assert.equal(audience.statusCode, 200);
  const body = audience.json();
  assert.equal(body.head, Math.max(...body.audience.map((r) => r.seq)));
  assert.ok(body.audience.some((r) => r.change.reason === 'erased'));
  const view = await call('GET', '/api/plugins/mx/identity');
  assert.equal(view.statusCode, 200);
  const identity = view.json().identity;
  assert.deepEqual(identity.declared, MX_IDENTITY);
  assert.equal(identity.readiness.ready, false);
  assert.equal(identity.readiness.reason, 'not_approved');
  assert.equal(identity.audience.erased, 1);
  assert.ok(identity.pendingErasures.length === 1, 'the erasure waits for the half');
  assert.equal(identity.sync.head, body.head);
  const none = await call('GET', '/api/plugins/px/identity');
  assert.equal(none.json().identity.declared, null);
  assert.equal((await call('GET', '/api/plugins/px/audience')).statusCode, 400);
});

test('roles a manifest no longer declares stay removed: grants rewritten or revoked, audited; the preview counts them', async () => {
  const qx = {
    name: 'qx',
    route: 'qx',
    identity: normalizeIdentityBlock({
      roles: [
        { id: 'viewer', label: 'Viewer' },
        { id: 'editor', label: 'Editor' },
      ],
    }),
  };
  const roleGrant = (principalType, principalId, roles, extra = {}) =>
    gatekeeper.addGrant({
      principalType,
      principalId,
      resourceType: 'plugin',
      resourceId: 'qx',
      context: { roles, ...extra },
    });
  roleGrant('user', 'ayse', ['editor', 'viewer'], { note: 'kept' });
  roleGrant('group', 'ops', ['editor']);
  roleGrant('user', 'ali', ['viewer']);
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'mehmet',
    resourceType: 'plugin',
    resourceId: 'qx',
    context: { target: 'local' },
  });

  // The approval preview of a version without `editor`: one grant narrowed, one revoked.
  const narrowed = normalizeIdentityBlock({ roles: [{ id: 'viewer', label: 'Viewer' }] });
  const view = {
    version: '2.0.0',
    identity: {
      before: qx.identity,
      after: narrowed,
      rolesAdded: [],
      rolesRemoved: ['editor'],
      attributesAdded: [],
      attributesRemoved: [],
      labelsChanged: [],
    },
  };
  assert.deepEqual((await lib.withIdentityGrantImpact(view, 'qx')).identity.grantsAffected, {
    rewritten: 1,
    revoked: 1,
  });
  const unchanged = { ...view, identity: { ...view.identity, rolesRemoved: [] } };
  assert.equal(await lib.withIdentityGrantImpact(unchanged, 'qx'), unchanged);
  gatekeeper.state.unreachable = true;
  assert.equal((await lib.withIdentityGrantImpact(view, 'qx')).identity.grantsAffected, null);
  gatekeeper.state.unreachable = false;

  // That version installed and approved: `editor` goes from every grant.
  const pruned = await lib.pruneUndeclaredRoles(
    { ...qx, identity: narrowed },
    { actor: 'lamaste' },
  );
  assert.deepEqual(pruned, { ok: true, rewritten: 1, revoked: 1, roles: ['editor'] });
  const onQx = gatekeeper.grants.filter((g) => g.resourceId === 'qx');
  assert.deepEqual(
    onQx.map((g) => [g.principalId, g.context]).sort(),
    [
      ['ali', { roles: ['viewer'] }],
      ['ayse', { roles: ['viewer'], note: 'kept' }],
      ['mehmet', { target: 'local' }],
    ].sort(),
    'a roleless grant is no entitlement and stays',
  );
  const [audit] = await lib.listAudit({ action: 'plugin.entitlement.roles-removed' });
  assert.equal(audit.plugin, 'qx');
  assert.deepEqual(audit.details, { roles: ['editor'], grantsRewritten: 1, grantsRevoked: 1 });
  // Nothing left to do: nothing done, nothing audited.
  assert.deepEqual(
    await lib.pruneUndeclaredRoles({ ...qx, identity: narrowed }, { actor: 'lamaste' }),
    { ok: true, rewritten: 0, revoked: 0, roles: [] },
  );
  assert.equal((await lib.listAudit({ action: 'plugin.entitlement.roles-removed' })).length, 1);

  // Uninstalled with purge: every role grant goes; the roleless one stays.
  assert.deepEqual(await lib.revokePluginRoleGrants(qx, { actor: 'admin' }), {
    ok: true,
    revoked: 2,
  });
  assert.deepEqual(
    gatekeeper.grants.filter((g) => g.resourceId === 'qx').map((g) => g.principalId),
    ['mehmet'],
  );
  gatekeeper.state.unreachable = true;
  assert.equal((await lib.revokePluginRoleGrants(qx, { actor: 'admin' })).ok, false);
  gatekeeper.state.unreachable = false;
});

test('attributes a plugin stops declaring leave its members and its tombstones', async () => {
  const narrowed = normalizeIdentityBlock({ ...MX_IDENTITY, attributes: ['displayName'] });
  await lib.writePlugins({
    plugins: [
      registryEntry('mx', narrowed),
      registryEntry('nx', NX_IDENTITY),
      registryEntry('px', null),
    ],
  });
  await lib.recomputeAudiences();
  const mx = await rows('mx');
  const ali = mx[await userId('ali')];
  assert.equal(ali.change.kind, 'upsert');
  assert.equal('email' in ali.change.member, false);
  const mehmet = mx[await userId('mehmet')];
  assert.deepEqual(mehmet.change.last, { username: 'mehmet', displayName: 'Mehmet Kaya' });
  for (const row of Object.values(mx))
    assert.equal(JSON.stringify(row).includes('@relay.test'), false);
});

test('a plugin that stops declaring identity keeps its ledger: erasures alone reach it, pending and marked inactive', async () => {
  const before = await rows('mx');
  const erasedBefore = Object.values(before).find((r) => r.change.reason === 'erased');
  const member = Object.values(before).find((r) => r.change.kind === 'upsert');
  assert.ok(erasedBefore && member, 'a member and an erasure to start from');
  const { userId: memberId, username } = member.change.member;
  // Where its half stood: past the earlier erasure.
  const db = await lib.getStateDb();
  db.prepare(
    `INSERT INTO plugin_identity_sync (plugin, directory_id, cursor, updated_at) VALUES ('mx', ?, ?, ?)
     ON CONFLICT (plugin) DO UPDATE SET
       directory_id = excluded.directory_id, cursor = excluded.cursor`,
  ).run(await lib.getDirectoryId(), erasedBefore.seq, new Date().toISOString());
  await lib.writePlugins({
    plugins: [
      registryEntry('mx', null),
      registryEntry('nx', NX_IDENTITY),
      registryEntry('px', null),
    ],
  });
  // Every grant goes: nothing reaches its rows — it takes no feed now.
  gatekeeper.reset();
  const quiet = await lib.recomputeAudiences();
  assert.equal(
    quiet.plugins.some((p) => p.plugin === 'mx'),
    false,
  );
  assert.deepEqual(await rows('mx'), before, 'the ledger stays as it was');
  assert.ok(await lib.readIdentitySyncState('mx'), 'and so does its feed state');

  // Erasing a former member rewrites their row there too (a new seq): a
  // plugin that comes back replays it.
  await lib.changeUsers(
    async () => {
      const data = await lib.readUsersRaw();
      delete data.users[username];
      await lib.writeUsers(data, { deleting: [username] });
      delete users[username];
    },
    { actor: 'admin', deleted: [username], confirmDelayMs: 0 },
  );
  assert.equal((await rows('mx'))[memberId].change.kind, 'upsert', 'a deletion does not reach it');
  await lib.eraseDirectoryUser(memberId, { actor: 'admin' });
  const erased = (await rows('mx'))[memberId];
  assert.deepEqual(erased.change, { kind: 'remove', userId: memberId, reason: 'erased' });
  assert.ok(erased.seq > member.seq);
  assert.equal(erased.version, member.version + 1);
  assert.deepEqual(
    await lib.pendingErasures('mx'),
    [memberId],
    'the earlier erasure was acknowledged',
  );
  assert.deepEqual((await lib.pendingErasuresByUser()).get(memberId), [
    { plugin: 'mx', inactive: true },
  ]);

  // Uninstalled while an agent keeps its data: the ledger stays, the erasure
  // pending on that agent from where its projection stood.
  await lib.recordRetainedData({
    agentLabel: 'vm1',
    route: 'mx',
    plugin: 'mx',
    package: '@lamalibre/mx-agent',
    operation: null,
  });
  await lib.writePlugins({
    plugins: [registryEntry('nx', NX_IDENTITY), registryEntry('px', null)],
  });
  assert.equal(await lib.dropIdentityLedgerIfNoData('mx'), false);
  await lib.recomputeAudiences();
  assert.ok((await lib.listAudience('mx')).length > 0);
  assert.deepEqual(await lib.pendingErasures('mx'), [memberId]);
  assert.deepEqual((await lib.pendingErasuresByUser()).get(memberId), [
    { plugin: 'mx', inactive: true },
  ]);

  // Its data purged (or forgotten): nothing of it is left, nor owed.
  await lib.forgetRetainedData('vm1', 'mx');
  assert.equal(await lib.dropIdentityLedgerIfNoData('mx'), true);
  assert.deepEqual(await lib.listAudience('mx'), []);
  assert.equal(await lib.readIdentitySyncState('mx'), null);
  assert.deepEqual(await lib.pendingErasures('mx'), []);
  assert.equal((await lib.pendingErasuresByUser()).get(memberId), undefined);
});
