/**
 * Slice 6: a reused username inherits nothing. Gatekeeper keys grants and
 * group members by username, so deleting a user removes everything
 * Gatekeeper holds under it — every grant to the user and every group
 * membership — and the tombstone records it (`principal_cleared_at`). When
 * Gatekeeper cannot, the cleanup stays pending: the minute's tick retries
 * it; no user is created under the username (503), and no grant or
 * membership is given to it, until it succeeds; erasure clears it before it
 * scrubs the username; and while it is pending the username holds no role
 * in any plugin — also for a user re-created outside Lamaste. Gatekeeper is
 * a fake (`fake-gatekeeper.js`), Authelia a users file.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { isIdentityUuid, normalizeIdentityBlock } from '@lamalibre/lamaste';

import { createFakeAutheliaStorage } from './fake-authelia-storage.js';
import { installFakeGatekeeper } from './fake-gatekeeper.js';

const HASH = '$2b$12$abcdefghijklmnopqrstuuJ2s4L6rjpDLHi3qL7Nn5D0o3M6a1g2a';
const MX_IDENTITY = normalizeIdentityBlock({
  roles: [
    { id: 'viewer', label: 'Viewer' },
    { id: 'editor', label: 'Editor' },
  ],
});
const PASSWORD = 'correct-horse-battery';

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
let usersFile;
let lib;
let app;
let gatekeeper;
let autheliaStorage;

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

const createUser = (username) =>
  call('POST', '/api/users', {
    username,
    displayname: username,
    email: `${username}@relay.test`,
    password: PASSWORD,
  });

async function readUsersFile() {
  return yaml.load(await readFile(usersFile, 'utf-8')).users;
}

/** Add a user to users.yml the way an operator would: by hand, outside Lamaste. */
async function addByHand(username) {
  const users = await readUsersFile();
  users[username] = { displayname: username, email: `${username}@relay.test`, password: HASH };
  await writeFile(usersFile, yaml.dump({ users }, { lineWidth: -1 }), { mode: 0o660 });
  await lib.reconcileDirectory({ confirmDelayMs: 0 });
}

/** What Gatekeeper holds under `username`: its grants and its groups. */
function heldBy(username) {
  return {
    grants: gatekeeper.grants
      .filter((g) => g.principalType === 'user' && g.principalId === username)
      .map((g) => `${g.resourceType}:${g.resourceId}:${JSON.stringify(g.context)}`)
      .sort(),
    groups: [...gatekeeper.groups.values()]
      .filter((g) => g.members.includes(username))
      .map((g) => g.name)
      .sort(),
  };
}

function entitle(username, roles, resourceId = 'mx') {
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: username,
    resourceType: 'plugin',
    resourceId,
    context: { roles },
  });
}

async function tombstone(username) {
  const users = await lib.listDirectoryUsers();
  return users.filter((u) => u.status === 'removed' && u.username === username).at(-1) ?? null;
}

async function memberRoles(username) {
  const user = await lib.findDirectoryUser(username);
  const row = user ? await lib.readAudienceRow('mx', user.userId) : null;
  return row?.change.kind === 'upsert' ? row.change.member.roles : null;
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-s6-principals-'));
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
  await writeFile(
    usersFile,
    yaml.dump(
      {
        users: {
          admin: {
            displayname: 'Admin',
            email: 'admin@relay.test',
            password: HASH,
            groups: ['admins'],
          },
          mehmet: { displayname: 'Mehmet', email: 'mehmet@relay.test', password: HASH },
        },
      },
      { lineWidth: -1 },
    ),
  );

  lib = {
    ...(await import('../src/lib/state-db.js')),
    ...(await import('../src/lib/config.js')),
    ...(await import('../src/lib/authelia.js')),
    ...(await import('../src/lib/gatekeeper-client.js')),
    ...(await import('../src/lib/directory.js')),
    ...(await import('../src/lib/audience.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/plugins.js')),
    ...(await import('../src/lib/state.js')),
    ...(await import('../src/lib/identity-sync.js')),
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
  await lib.writePlugins({
    plugins: [
      {
        name: 'mx',
        route: 'mx',
        packageName: '@lamalibre/mx-server',
        version: '1.0.0',
        capabilities: [],
        hosting: 'agent',
        agent: {},
        identity: MX_IDENTITY,
        status: 'enabled',
        installedAt: '2026-10-22T00:00:00.000Z',
      },
    ],
  });
  await lib.reconcileDirectory({ confirmDelayMs: 0 });

  const { default: Fastify } = await import('fastify');
  const { default: errors } = await import('../src/middleware/errors.js');
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
  for (const [route, prefix] of [
    ['../src/routes/management/users.js', '/api'],
    ['../src/routes/management/identity-directory.js', '/api'],
    ['../src/routes/management/plugin-identity.js', '/api'],
    ['../src/routes/management/gatekeeper-proxy.js', '/api'],
    ['../src/routes/invite.js', '/api/invite'],
  ]) {
    const { default: routes } = await import(route);
    await app.register(routes, { prefix });
  }
  await app.ready();
});

after(async () => {
  await lib.identityIdle();
  lib.setAutheliaForTests(null);
  lib.setGatekeeperClientForTests(null);
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

test('deleting a user removes every grant and group membership Gatekeeper holds under the username', async () => {
  assert.equal((await createUser('ayse')).statusCode, 201);
  entitle('ayse', ['viewer']);
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'ayse',
    resourceType: 'tunnel',
    resourceId: 'reports-id',
  });
  gatekeeper.setGroup('ops', ['ayse', 'mehmet']);
  gatekeeper.setGroup('devs', ['ayse']);
  gatekeeper.addGrant({
    principalType: 'group',
    principalId: 'ops',
    resourceType: 'plugin',
    resourceId: 'mx',
    context: { roles: ['editor'] },
  });
  await lib.recomputeAudiences({ logger });
  assert.deepEqual(await memberRoles('ayse'), ['editor', 'viewer']);
  const ayse = (await lib.findDirectoryUser('ayse')).userId;

  const deleted = await call('DELETE', '/api/users/ayse');
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.equal(deleted.json().principalCleared, true);
  assert.equal(deleted.json().warnings, undefined);
  assert.deepEqual(heldBy('ayse'), { grants: [], groups: [] });
  assert.deepEqual(heldBy('mehmet').groups, ['ops'], 'others keep theirs');
  assert.equal(gatekeeper.grants.filter((g) => g.principalType === 'group').length, 1);
  const tomb = await lib.getDirectoryUser(ayse);
  assert.ok(tomb.principalClearedAt);
  const [audit] = await lib.listAudit({ action: 'directory.user.principal-cleared' });
  assert.deepEqual(audit.details, { userIds: [ayse], grantsRemoved: 2, groupsLeft: 2 });
  assert.equal((await lib.readAudienceRow('mx', ayse)).change.reason, 'deleted');

  // Back under the same username: a new user, holding nothing.
  assert.equal((await createUser('ayse')).statusCode, 201);
  await lib.recomputeAudiences({ logger });
  assert.equal(await memberRoles('ayse'), null);
  assert.notEqual((await lib.findDirectoryUser('ayse')).userId, ayse);
});

test('Gatekeeper down at a deletion: pending, nothing created under the username, erasure refused; the tick clears it', async () => {
  assert.equal((await createUser('zeynep')).statusCode, 201);
  entitle('zeynep', ['viewer']);
  gatekeeper.setGroup('ops', [...gatekeeper.groups.get('ops').members, 'zeynep']);

  gatekeeper.state.unreachable = true;
  const deleted = await call('DELETE', '/api/users/zeynep');
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.json().principalCleared, false);
  const warning = deleted.json().warnings.find((w) => w.step === 'gatekeeper');
  assert.match(warning.message, /retried every minute/);
  const tomb = await tombstone('zeynep');
  assert.equal(tomb.principalClearedAt, null);
  assert.ok(await lib.principalCleanupPending('zeynep'));

  // No user under the username while its cleanup cannot run.
  const recreated = await createUser('zeynep');
  assert.equal(recreated.statusCode, 503);
  assert.equal(recreated.json().code, 'gatekeeper_unavailable');
  assert.equal((await readUsersFile()).zeynep, undefined, 'users.yml untouched');
  const token = 'f'.repeat(64);
  await lib.writeInvitations([
    {
      id: 'z1',
      token,
      username: 'zeynep',
      email: 'zeynep@relay.test',
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
    payload: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(accepted.statusCode, 503);
  assert.equal(accepted.json().code, 'gatekeeper_unavailable');
  assert.equal((await lib.readInvitations())[0].used, false);
  // Nor a grant or a membership through the proxy: nobody holds the
  // username, and whatever it was given would pass to its next holder.
  const proxied = await call('POST', '/api/gatekeeper/grants', {
    principalType: 'user',
    principalId: 'zeynep',
    resourceType: 'tunnel',
    resourceId: 'reports-id',
  });
  assert.equal(proxied.statusCode, 409);
  assert.equal(proxied.json().code, 'username_deleted');
  const member = await call('POST', '/api/gatekeeper/groups/ops/members', {
    usernames: ['zeynep'],
  });
  assert.equal(member.statusCode, 409);
  assert.equal(member.json().code, 'username_deleted');
  // Nor an erasure, which would lose the username the cleanup needs.
  const erase = await call('POST', `/api/identity/directory/${tomb.userId}/erase`);
  assert.equal(erase.statusCode, 503);
  assert.equal(erase.json().code, 'gatekeeper_unavailable');
  assert.equal((await lib.getDirectoryUser(tomb.userId)).username, 'zeynep');

  // Gatekeeper back: the minute's tick clears it.
  gatekeeper.state.unreachable = false;
  assert.deepEqual(heldBy('zeynep'), {
    grants: ['plugin:mx:{"roles":["viewer"]}'],
    groups: ['ops'],
  });
  await lib.identityTick(logger);
  assert.deepEqual(heldBy('zeynep'), { grants: [], groups: [] });
  assert.ok((await lib.getDirectoryUser(tomb.userId)).principalClearedAt);
  assert.equal(await lib.principalCleanupPending('zeynep'), false);
  assert.deepEqual(await lib.clearPendingPrincipals({ logger }), { cleared: 0, pending: 0 });

  // Now the username can be given again — to a user holding nothing.
  const fresh = await createUser('zeynep');
  assert.equal(fresh.statusCode, 201);
  assert.notEqual(fresh.json().user.userId, tomb.userId);
  await lib.recomputeAudiences({ logger });
  assert.equal(await memberRoles('zeynep'), null);
});

test('re-created outside Lamaste while a cleanup is pending: no role until it is cleared; an entitlement clears first', async () => {
  assert.equal((await createUser('deniz')).statusCode, 201);
  entitle('deniz', ['editor']);
  gatekeeper.setGroup('ops', [...gatekeeper.groups.get('ops').members, 'deniz']);
  gatekeeper.state.unreachable = true;
  await call('DELETE', '/api/users/deniz');
  gatekeeper.state.unreachable = false;
  assert.ok(await lib.principalCleanupPending('deniz'));

  // An operator puts deniz back into users.yml by hand: a new user, and the
  // old deniz's grant and membership still in Gatekeeper.
  await addByHand('deniz');
  const newDeniz = await lib.findDirectoryUser('deniz');
  assert.ok(isIdentityUuid(newDeniz.userId));
  assert.equal(heldBy('deniz').grants.length, 1);
  await lib.recomputeAudiences({ logger });
  assert.equal(await memberRoles('deniz'), null, 'the old deniz’s roles are not the new one’s');
  assert.equal(await lib.readAudienceRow('mx', newDeniz.userId), null);

  // Giving the new deniz a role clears the old one's first.
  const set = await call('PUT', '/api/plugins/mx/entitlements', {
    principalType: 'user',
    principalId: 'deniz',
    roles: ['viewer'],
  });
  assert.equal(set.statusCode, 200, set.body);
  assert.deepEqual(heldBy('deniz'), {
    grants: ['plugin:mx:{"roles":["viewer"]}'],
    groups: [],
  });
  assert.equal(await lib.principalCleanupPending('deniz'), false);
  assert.deepEqual(await memberRoles('deniz'), ['viewer']);
});

test('the proxy clears a pending username before it gives it a membership', async () => {
  assert.equal((await createUser('eda')).statusCode, 201);
  gatekeeper.setGroup('ops', [...gatekeeper.groups.get('ops').members, 'eda']);
  gatekeeper.state.unreachable = true;
  await call('DELETE', '/api/users/eda');
  gatekeeper.state.unreachable = false;
  await addByHand('eda');
  assert.ok(await lib.principalCleanupPending('eda'));
  const member = await call('POST', '/api/gatekeeper/groups/devs/members', { usernames: ['eda'] });
  assert.equal(member.statusCode, 200, member.body);
  assert.deepEqual(heldBy('eda').groups, ['devs'], 'the old membership of ops went first');
  assert.equal(await lib.principalCleanupPending('eda'), false);
});

test('erasure clears a pending principal before it scrubs the username', async () => {
  assert.equal((await createUser('can')).statusCode, 201);
  entitle('can', ['viewer']);
  gatekeeper.state.unreachable = true;
  await call('DELETE', '/api/users/can');
  gatekeeper.state.unreachable = false;
  const tomb = await tombstone('can');
  assert.equal(tomb.principalClearedAt, null);

  gatekeeper.calls.length = 0;
  const erased = await call('POST', `/api/identity/directory/${tomb.userId}/erase`);
  assert.equal(erased.statusCode, 200, erased.body);
  // The username travels in the bodies, never in a URL.
  assert.deepEqual(
    gatekeeper.calls.slice(0, 2).map((c) => [c.method, c.path, c.body?.username]),
    [
      ['POST', '/api/principals/user/remove', 'can'],
      ['POST', '/api/access-log/purge', 'can'],
    ],
  );
  assert.deepEqual(heldBy('can'), { grants: [], groups: [] });
  const scrubbed = await lib.getDirectoryUser(tomb.userId);
  assert.equal(scrubbed.username, null);
  assert.ok(scrubbed.erasedAt);
  assert.ok(scrubbed.principalClearedAt, 'an erased user was always cleared first');

  // The store refuses an erased row that was never cleared.
  const db = await lib.getStateDb();
  assert.throws(
    () =>
      db
        .prepare('UPDATE directory_users SET principal_cleared_at = NULL WHERE user_id = ?')
        .run(tomb.userId),
    /CHECK constraint/,
  );
});
