/**
 * The multi-domain relay in the panel (lib/domains.js, routes/management/
 * domains.js): an upgraded single-domain relay records its primary domain
 * with everyone as its member and lets in whom it let in before; a domain
 * is added, activated (its sign-in issued and served) and removed only
 * when nothing uses it; membership is explicit, by user id, audited by id,
 * kept while a user is disabled (who is rendered nowhere) and gone when
 * they are deleted; with one domain new users become its members, with two
 * they are created with theirs; every change renders Authelia's domain
 * access and Gatekeeper's projection. Authelia is a users file and a
 * recorder of what would be rendered, Gatekeeper a fake, nginx and certbot
 * recorders.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { renderAccessControl } from '@lamalibre/lamaste/server';

import { createFakeAutheliaStorage } from './fake-authelia-storage.js';
import { installFakeGatekeeper } from './fake-gatekeeper.js';

const HASH = '$2b$12$abcdefghijklmnopqrstuuJ2s4L6rjpDLHi3qL7Nn5D0o3M6a1g2a';

let dir;
let stateDir;
let usersFile;
let lib;
let app;
let gatekeeper;
/** What Authelia was last told: `{ domains, sites }`. */
let rendered = null;
let renders = 0;
/** What activation and removal asked of certbot and nginx. */
const activation = [];
let failVhost = false;

const person = (displayname, email, groups = [], extra = {}) => ({
  displayname,
  email,
  password: HASH,
  groups,
  ...extra,
});

async function writeUsersFile(users) {
  await writeFile(usersFile, yaml.dump({ users }, { lineWidth: -1 }), { mode: 0o660 });
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

const idOf = async (username) => (await lib.findDirectoryUser(username))?.userId;

async function projection() {
  return JSON.parse(await readFile(path.join(stateDir, 'domains.json'), 'utf-8'));
}

/** The members Authelia was last told of, by domain. */
const renderedMembers = () => Object.fromEntries(rendered.domains.map((d) => [d.name, d.members]));

/** Audit entries of `action`, newest first. */
function audits(action) {
  return lib.listAudit({ action, limit: 200 });
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-domains-'));
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
      domain: 'samplepark.tr',
      email: 'ops@samplepark.tr',
      dataDir: stateDir,
      onboarding: { status: 'COMPLETED' },
    }),
  );
  await writeUsersFile({
    admin: person('Admin', 'admin@samplepark.tr', ['admins']),
    onur: person('Onur', 'onur@codelama.com.tr'),
    cust: person('Customer', 'cust@samplepark.tr'),
  });

  lib = {
    ...(await import('../src/lib/state-db.js')),
    ...(await import('../src/lib/config.js')),
    ...(await import('../src/lib/authelia.js')),
    ...(await import('../src/lib/gatekeeper-client.js')),
    ...(await import('../src/lib/directory.js')),
    ...(await import('../src/lib/domains.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/state.js')),
    ...(await import('../src/lib/plugins.js')),
  };
  await lib.loadConfig();
  lib.setAutheliaForTests({
    usersFile,
    restart: async () => {},
    writeTotp: async () => {},
    userStorage: createFakeAutheliaStorage().storage,
    domainAccess: async (access) => {
      const changed = JSON.stringify(access) !== JSON.stringify(rendered);
      rendered = structuredClone(access);
      if (changed) renders += 1;
      return { changed };
    },
  });
  lib.setDomainActivationForTests({
    issueCert: async (fqdn, email) => activation.push(['cert', fqdn, email]),
    writeAuthVhost: async (domain, opts) => {
      if (failVhost) throw new Error('nginx -t failed');
      activation.push(['vhost', domain, opts]);
    },
    removeAuthVhost: async (domain) => activation.push(['remove-vhost', domain]),
  });
  gatekeeper = installFakeGatekeeper(lib);

  // The users as an older version's directory holds them.
  await lib.reconcileDirectory({ confirmDelayMs: 0 });

  const { default: Fastify } = await import('fastify');
  const { default: errors } = await import('../src/middleware/errors.js');
  const { default: domainRoutes } = await import('../src/routes/management/domains.js');
  const { default: usersRoutes } = await import('../src/routes/management/users.js');
  const { default: invitationRoutes } = await import('../src/routes/management/invitations.js');
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
  await app.register(domainRoutes, { prefix: '/api' });
  await app.register(usersRoutes, { prefix: '/api' });
  await app.register(invitationRoutes, { prefix: '/api' });
  await app.ready();
});

after(async () => {
  lib.setAutheliaForTests(null);
  lib.setGatekeeperClientForTests(null);
  lib.setDomainActivationForTests(null);
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

test('an upgraded single-domain relay: the primary recorded with everyone its member, letting in whom it did', async () => {
  assert.equal(await lib.ensurePrimaryDomain(), 'samplepark.tr');
  assert.equal(await lib.ensurePrimaryDomain(), 'samplepark.tr', 'idempotent');
  const members = await lib.listDomainMembers('samplepark.tr');
  assert.deepEqual(members.map((m) => [m.username, m.addedBy]).sort(), [
    ['admin', 'migration'],
    ['cust', 'migration'],
    ['onur', 'migration'],
  ]);
  const added = await audits('domain.added');
  assert.deepEqual(added.at(-1).details, { domain: 'samplepark.tr', primary: true, members: 3 });

  await lib.syncDomainAccess();
  assert.deepEqual(renderedMembers(), { 'samplepark.tr': ['admin', 'cust', 'onur'] });
  assert.deepEqual(await projection(), {
    v: 1,
    domains: [{ name: 'samplepark.tr', members: ['admin', 'cust', 'onur'] }],
  });
  assert.equal((await stat(path.join(stateDir, 'domains.json'))).mode & 0o777, 0o600);
  // Every host under the domain admits every user, as before: one allow
  // rule for all of them, then the deny the rest falls to.
  assert.deepEqual(renderAccessControl(rendered.domains, []).rules, [
    {
      domain: ['samplepark.tr', '*.samplepark.tr'],
      policy: 'two_factor',
      subject: ['user:admin', 'user:cust', 'user:onur'],
    },
    { domain: ['samplepark.tr', '*.samplepark.tr'], policy: 'deny' },
  ]);
  const before = renders;
  await lib.syncDomainAccess();
  assert.equal(renders, before, 'nothing changed: Authelia is not touched');
});

test('with one domain a new user becomes its member, whoever creates them', async () => {
  const res = await call('POST', '/api/users', {
    username: 'ayse',
    displayname: 'Ayşe',
    email: 'ayse@samplepark.tr',
    password: 'correct horse battery',
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.deepEqual(res.json().user.domains, ['samplepark.tr']);
  assert.ok(renderedMembers()['samplepark.tr'].includes('ayse'));
});

test('a domain: added pending, refused when it overlaps or is no domain, activated with rollback', async () => {
  assert.equal(
    (await call('POST', '/api/domains', { name: 'cust.samplepark.tr' })).json().code,
    'domain_overlap',
  );
  assert.equal((await call('POST', '/api/domains', { name: 'samplepark.tr' })).statusCode, 409);
  assert.equal((await call('POST', '/api/domains', { name: 'not_a.domain' })).statusCode, 400);

  const added = await call('POST', '/api/domains', { name: 'CodeLama.com.tr' });
  assert.equal(added.statusCode, 201, added.body);
  assert.deepEqual(
    { name: added.json().domain.name, status: added.json().domain.status },
    { name: 'codelama.com.tr', status: 'pending' },
  );
  // Pending: not rendered, nothing can be put on it.
  assert.deepEqual(Object.keys(renderedMembers()), ['samplepark.tr']);
  await assert.rejects(
    lib.resolveActiveDomain('codelama.com.tr'),
    (err) => err.code === 'unknown_domain',
  );

  failVhost = true;
  const failed = await call('POST', '/api/domains/codelama.com.tr/activate');
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.json().code, 'nginx_failed');
  assert.equal((await lib.getDomain('codelama.com.tr')).status, 'pending');
  failVhost = false;

  activation.length = 0;
  const active = await call('POST', '/api/domains/codelama.com.tr/activate');
  assert.equal(active.statusCode, 200, active.body);
  assert.equal(active.json().domain.status, 'active');
  assert.deepEqual(activation, [
    ['cert', 'auth.codelama.com.tr', 'ops@samplepark.tr'],
    ['vhost', 'codelama.com.tr', { primary: false }],
  ]);
  assert.deepEqual(renderedMembers(), {
    'samplepark.tr': ['admin', 'ayse', 'cust', 'onur'],
    'codelama.com.tr': [],
  });
  assert.equal(await lib.resolveActiveDomain('codelama.com.tr'), 'codelama.com.tr');
  // Activating again changes nothing.
  activation.length = 0;
  assert.equal((await call('POST', '/api/domains/codelama.com.tr/activate')).statusCode, 200);
  assert.deepEqual(activation, []);
});

test('membership: explicit, by id, audited by id; a developer on both domains, a customer on one', async () => {
  const onur = await idOf('onur');
  const res = await call('PUT', `/api/domains/codelama.com.tr/members/${onur}`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().added, true);
  assert.equal(
    (await call('PUT', `/api/domains/codelama.com.tr/members/${onur}`)).json().added,
    false,
  );
  assert.deepEqual(renderedMembers()['codelama.com.tr'], ['onur']);
  assert.deepEqual((await projection()).domains[1], { name: 'codelama.com.tr', members: ['onur'] });
  const audited = (await audits('directory.membership.added')).at(0);
  assert.deepEqual(audited.details, { domain: 'codelama.com.tr', userId: onur });
  assert.ok(!JSON.stringify(await audits('directory.membership.added')).includes('onur"'));
  assert.ok(gatekeeper.state.sessionBusts > 0, 'Gatekeeper’s cached sessions dropped');

  // A customer leaves samplepark.tr (and is on no other domain): rendered nowhere.
  const cust = await idOf('cust');
  const removed = await call('DELETE', `/api/domains/samplepark.tr/members/${cust}`);
  assert.equal(removed.json().removed, true);
  assert.ok(!renderedMembers()['samplepark.tr'].includes('cust'));
  assert.equal(
    (await call('DELETE', `/api/domains/samplepark.tr/members/${cust}`)).json().removed,
    false,
  );
  await call('PUT', `/api/domains/samplepark.tr/members/${cust}`);

  assert.equal((await call('PUT', '/api/domains/nope.tr/members/' + onur)).statusCode, 404);
  assert.equal(
    (await call('PUT', '/api/domains/codelama.com.tr/members/00000000-0000-4000-8000-000000000000'))
      .statusCode,
    404,
  );
  const listed = await call('GET', '/api/domains/codelama.com.tr/members');
  assert.deepEqual(
    listed.json().members.map((m) => [m.userId, m.username, m.status]),
    [[onur, 'onur', 'active']],
  );
});

test('with two domains a new user is created with theirs: required, checked, honoured — invitations too', async () => {
  const body = {
    username: 'mert',
    displayname: 'Mert',
    email: 'mert@codelama.com.tr',
    password: 'correct horse battery',
  };
  const missing = await call('POST', '/api/users', body);
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().code, 'domains_required');
  assert.equal(
    (await call('POST', '/api/users', { ...body, domains: ['other.example'] })).json().code,
    'unknown_domain',
  );
  const made = await call('POST', '/api/users', { ...body, domains: ['codelama.com.tr'] });
  assert.equal(made.statusCode, 201, made.body);
  assert.deepEqual(made.json().user.domains, ['codelama.com.tr']);
  assert.deepEqual(renderedMembers()['codelama.com.tr'], ['mert', 'onur']);
  assert.ok(!renderedMembers()['samplepark.tr'].includes('mert'));

  const invitation = { username: 'deniz', email: 'deniz@codelama.com.tr' };
  assert.equal(
    (await call('POST', '/api/invitations', invitation)).json().code,
    'domains_required',
  );
  const invited = await call('POST', '/api/invitations', {
    ...invitation,
    domains: ['codelama.com.tr', 'samplepark.tr'],
  });
  assert.equal(invited.statusCode, 201, invited.body);
  assert.match(invited.json().inviteUrl, /^https:\/\/auth\.codelama\.com\.tr\/invite\//);
  const stored = (await lib.readInvitations()).find((i) => i.username === 'deniz');
  assert.deepEqual(stored.domains, ['codelama.com.tr', 'samplepark.tr']);

  // Listed with each user's domains.
  const users = (await call('GET', '/api/users')).json().users;
  assert.deepEqual(users.find((u) => u.username === 'onur').domains, [
    'codelama.com.tr',
    'samplepark.tr',
  ]);
});

test('disable keeps memberships and renders the user nowhere; enable brings them back; delete ends them', async () => {
  const onur = await idOf('onur');
  assert.equal((await call('PUT', '/api/users/onur', { disabled: true })).statusCode, 200);
  assert.ok(!renderedMembers()['codelama.com.tr'].includes('onur'));
  assert.ok(!renderedMembers()['samplepark.tr'].includes('onur'));
  assert.equal((await lib.domainsByUser()).get(onur).length, 2, 'kept');

  assert.equal((await call('PUT', '/api/users/onur', { disabled: false })).statusCode, 200);
  assert.ok(renderedMembers()['codelama.com.tr'].includes('onur'));

  const mert = await idOf('mert');
  assert.equal((await call('DELETE', '/api/users/mert')).statusCode, 200);
  assert.equal((await lib.domainsByUser()).get(mert), undefined);
  assert.ok(!renderedMembers()['codelama.com.tr'].includes('mert'));
  const ended = (await audits('directory.membership.removed')).filter(
    (e) => e.details.userId === mert,
  );
  assert.deepEqual(
    ended.map((e) => e.details),
    [{ domain: 'codelama.com.tr', userId: mert, reason: 'deleted' }],
  );
});

test('a domain is removed only when nothing uses it, never the primary', async () => {
  assert.equal((await call('DELETE', '/api/domains/samplepark.tr')).json().code, 'primary_domain');

  await lib.writeTunnels([
    {
      id: 't1',
      subdomain: 'feria',
      fqdn: 'feria.codelama.com.tr',
      port: 20060,
      type: 'app',
      enabled: true,
    },
  ]);
  const inUse = await call('DELETE', '/api/domains/codelama.com.tr');
  assert.equal(inUse.statusCode, 409);
  assert.equal(inUse.json().code, 'domain_in_use');
  assert.deepEqual(inUse.json().usedBy.tunnels, ['feria.codelama.com.tr']);
  const listed = (await call('GET', '/api/domains')).json().domains;
  assert.deepEqual(
    listed.map((d) => [d.name, d.primary, d.status, d.members]),
    [
      ['samplepark.tr', true, 'active', 4],
      ['codelama.com.tr', false, 'active', 1],
    ],
  );
  await lib.writeTunnels([]);

  activation.length = 0;
  const removed = await call('DELETE', '/api/domains/codelama.com.tr');
  assert.equal(removed.statusCode, 200, removed.body);
  assert.deepEqual(activation, [['remove-vhost', 'codelama.com.tr']]);
  assert.equal(await lib.getDomain('codelama.com.tr'), null);
  assert.deepEqual(Object.keys(renderedMembers()), ['samplepark.tr']);
  const ended = (await audits('directory.membership.removed')).filter(
    (e) => e.details.reason === 'domain-removed',
  );
  assert.equal(ended.length, 1);
  assert.equal((await audits('domain.removed')).at(0).details.domain, 'codelama.com.tr');
});

test('a plugin belongs to the primary until moved to an active domain; moving it is audited', async () => {
  await call('POST', '/api/domains', { name: 'codelama.com.tr' });
  await call('POST', '/api/domains/codelama.com.tr/activate');
  await lib.writePlugins({
    plugins: [
      {
        name: 'feria',
        route: 'feria',
        packageName: '@lamalibre/feria-server',
        version: '0.4.0',
        capabilities: [],
        hosting: 'agent',
        status: 'enabled',
        installedAt: new Date().toISOString(),
      },
    ],
  });
  assert.equal((await lib.findPlugin('feria')).domain, null);
  const refused = await call('PUT', '/api/plugins/feria/domain', { domain: 'pending.example' });
  assert.equal(refused.json().code, 'unknown_domain');
  const moved = await call('PUT', '/api/plugins/feria/domain', { domain: 'codelama.com.tr' });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.deepEqual(moved.json(), { name: 'feria', domain: 'codelama.com.tr', changed: true });
  assert.equal((await lib.findPlugin('feria')).domain, 'codelama.com.tr');
  // writePlugins keeps it.
  await lib.writePlugins(await lib.readPlugins());
  assert.equal((await lib.findPlugin('feria')).domain, 'codelama.com.tr');
  assert.deepEqual((await audits('plugin.domain.changed')).at(0).details, {
    from: 'samplepark.tr',
    to: 'codelama.com.tr',
  });
  // Its domain cannot be removed while it belongs to it.
  assert.deepEqual((await call('DELETE', '/api/domains/codelama.com.tr')).json().usedBy.plugins, [
    'feria',
  ]);
  assert.equal(
    (await call('PUT', '/api/plugins/nope/domain', { domain: 'samplepark.tr' })).statusCode,
    404,
  );
});
