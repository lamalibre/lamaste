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
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { renderAccessControl, renderOidcAuthorizationPolicies } from '@lamalibre/lamaste/server';

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
/**
 * Authelia's OIDC authorization policies as its two writers leave them:
 * the domain rendering and the OIDC provider (each writes them whole).
 */
let policies = null;
/** Holds the OIDC provider's write until released (a test of the two writers). */
let oidcGate = null;
/** The client ids the OIDC provider was last written with. */
let oidcClientIds = [];
/** What activation and removal asked of certbot and nginx. */
const activation = [];
let failVhost = false;
/** Authelia refuses its domain access (a render failure). */
let failAccess = false;

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
      if (failAccess) throw new Error('Authelia did not restart');
      const changed = JSON.stringify(access) !== JSON.stringify(rendered);
      rendered = structuredClone(access);
      policies = renderOidcAuthorizationPolicies(access.domains);
      if (changed) renders += 1;
      return { changed };
    },
    oidcProvider: async (domains, clients) => {
      if (oidcGate) {
        oidcGate.entered();
        await oidcGate.released;
      }
      policies = renderOidcAuthorizationPolicies(domains);
      oidcClientIds = clients.map((c) => c.id);
      return { changed: true, clients: clients.length };
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
  assert.equal((await call('GET', '/api/domains')).json().newUsersNeedDomains, true);
  const missing = await call('POST', '/api/users', body);
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().code, 'domains_required');
  // A user who is a member of nothing reaches nothing: an empty list is no answer either.
  assert.equal(
    (await call('POST', '/api/users', { ...body, domains: [] })).json().code,
    'domains_required',
  );
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

  // An edit sets the memberships exactly, in one change, each audited.
  const ece = { ...body, username: 'ece', email: 'ece@codelama.com.tr' };
  assert.equal(
    (await call('POST', '/api/users', { ...ece, domains: ['codelama.com.tr'] })).statusCode,
    201,
  );
  const eceId = await idOf('ece');
  const edited = await call('PUT', '/api/users/ece', { domains: ['samplepark.tr'] });
  assert.equal(edited.statusCode, 200, edited.body);
  assert.deepEqual(edited.json().user.domains, ['samplepark.tr']);
  assert.ok(!renderedMembers()['codelama.com.tr'].includes('ece'));
  assert.ok(renderedMembers()['samplepark.tr'].includes('ece'));
  const changes = (await audits('directory.membership.added'))
    .concat(await audits('directory.membership.removed'))
    .filter((a) => a.details.userId === eceId)
    .map((a) => [a.action, a.details.domain]);
  assert.deepEqual(changes.sort(), [
    ['directory.membership.added', 'codelama.com.tr'],
    ['directory.membership.added', 'samplepark.tr'],
    ['directory.membership.removed', 'codelama.com.tr'],
  ]);
  assert.equal(
    (await call('PUT', '/api/users/ece', { domains: ['other.example'] })).json().code,
    'unknown_domain',
  );

  // A member is named by directory id or by username.
  const byName = await call('DELETE', '/api/domains/samplepark.tr/members/ece');
  assert.equal(byName.json().removed, true, byName.body);
  assert.equal((await call('PUT', '/api/domains/samplepark.tr/members/nobody')).statusCode, 404);
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
  // Shown with the name of its domain — clients never read NULL as the primary.
  assert.equal(
    (await lib.withPluginDomains([await lib.findPlugin('feria')]))[0].domain,
    'samplepark.tr',
  );
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

test('one writer of the members’ OIDC policies: a membership ended while the OIDC provider is written stays ended', async () => {
  const onur = await idOf('onur');
  await call('PUT', `/api/domains/codelama.com.tr/members/${onur}`);
  const policy = () => policies.lamaste_codelama_com_tr_two_factor.rules[0];
  assert.deepEqual(policy().subject, ['user:onur']);

  // The OIDC provider is being written (a plugin change) when the
  // membership ends: it read the members before, and writes after.
  let entered;
  let release;
  oidcGate = {
    entered: () => entered(),
    released: new Promise((resolve) => (release = resolve)),
  };
  const insideWrite = new Promise((resolve) => (entered = resolve));
  const { syncOidcClients } = await import('../src/lib/plugin-oidc.js');
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const oidc = syncOidcClients(logger);
  await insideWrite;
  const removal = call('DELETE', `/api/domains/codelama.com.tr/members/${onur}`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  release();
  oidcGate = null;
  await Promise.all([oidc, removal]);

  assert.deepEqual(policy(), { policy: 'deny', networks: ['0.0.0.0/0', '::/0'] });
  assert.deepEqual(renderedMembers()['codelama.com.tr'], []);
});

test('a sync that waited for the writer plans from what is true then: a registry credential being set is served', async () => {
  const { syncOidcClients, withRegistryCandidate } = await import('../src/lib/plugin-oidc.js');
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  // One sync holds the writer (a plugin change) …
  let entered;
  let release;
  const insideWrite = new Promise((resolve) => (entered = resolve));
  oidcGate = { entered: () => entered(), released: new Promise((resolve) => (release = resolve)) };
  const first = syncOidcClients(logger);
  await insideWrite;
  oidcGate = null;
  // … the identity tick's sync queues behind it, and then a registry
  // credential starts being set. The tick must not write a plan made before.
  const tick = syncOidcClients(logger);
  // Time enough for a sync that planned outside the writer to have planned.
  await new Promise((resolve) => setTimeout(resolve, 200));
  await withRegistryCandidate({ registryUrl: 'https://feria.relay.test' }, async () => {
    release();
    await Promise.all([first, tick]);
    assert.ok(oidcClientIds.includes('lamaste-server'), 'the candidate’s client is still served');
  });
});

// ---------------------------------------------------------------------------
// Security review fixes
// ---------------------------------------------------------------------------

const quietLog = { info() {}, warn() {}, error() {}, debug() {} };

test('domains under one registrable domain, and public suffixes, are refused', async () => {
  const first = await call('POST', '/api/domains', { name: 'cust1.example.net' });
  assert.equal(first.statusCode, 201, first.body);
  const sibling = await call('POST', '/api/domains', { name: 'cust2.example.net' });
  assert.equal(sibling.statusCode, 409);
  assert.equal(sibling.json().code, 'same_registrable_domain');
  const suffix = await call('POST', '/api/domains', { name: 'github.io' });
  assert.equal(suffix.statusCode, 400);
  assert.equal(suffix.json().code, 'public_suffix');
  assert.equal((await call('DELETE', '/api/domains/cust1.example.net')).statusCode, 200);
});

test('the relay hostnames of a domain must be free before it is added or activated', async () => {
  const site = (fqdn) => ({
    id: '22222222-3333-4444-8555-666666666666',
    name: 'early',
    fqdn,
    type: 'custom',
    spaMode: false,
    autheliaProtected: false,
    allowedUsers: [],
    dnsVerified: false,
    certIssued: false,
    rootPath: '/var/www/lamaste/22222222-3333-4444-8555-666666666666/',
    createdAt: new Date().toISOString(),
    totalSize: 0,
  });
  await lib.writeSites([site('auth.later.example')]);
  const refused = await call('POST', '/api/domains', { name: 'later.example' });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().code, 'relay_host_taken');

  await lib.writeSites([]);
  assert.equal((await call('POST', '/api/domains', { name: 'later.example' })).statusCode, 201);
  // Taken while it was pending (written past the API, as an older panel could).
  await lib.writeSites([site('panel.later.example')]);
  const activation = await call('POST', '/api/domains/later.example/activate');
  assert.equal(activation.statusCode, 409);
  assert.equal(activation.json().code, 'relay_host_taken');
  assert.equal((await lib.getDomain('later.example')).status, 'pending');
  await lib.writeSites([]);
  assert.equal((await call('DELETE', '/api/domains/later.example')).statusCode, 200);
});

test('an invitation grants only domains that existed when it was made; it signs in at its first active one', async () => {
  await call('POST', '/api/domains', { name: 'gone.example' });
  const invitation = {
    domains: ['gone.example', 'samplepark.tr'],
    createdAt: new Date().toISOString(),
  };
  assert.equal(
    await lib.invitationSignInDomain(invitation),
    'samplepark.tr',
    'a pending domain has no sign-in page yet',
  );
  assert.deepEqual(await lib.invitationDomainsNow(invitation), ['gone.example', 'samplepark.tr']);
  // Removed, then added again (for someone else): another domain — the
  // invitation grants it nothing.
  assert.equal((await call('DELETE', '/api/domains/gone.example')).statusCode, 200);
  assert.deepEqual(await lib.invitationDomainsNow(invitation), ['samplepark.tr']);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await call('POST', '/api/domains', { name: 'gone.example' });
  assert.deepEqual(await lib.invitationDomainsNow(invitation), ['samplepark.tr']);
  assert.deepEqual(await lib.invitationDomainsNow({ domains: ['samplepark.tr'] }), []);
  assert.equal((await call('DELETE', '/api/domains/gone.example')).statusCode, 200);
});

test('a domain is removed under the tunnel lock: a tunnel or site being put on it finishes first', async () => {
  await call('POST', '/api/domains', { name: 'racing.example' });
  const { withTunnelLock } = await import('@lamalibre/lamaste/server');
  let release;
  const held = withTunnelLock(() => new Promise((resolve) => (release = resolve)));
  let removed = false;
  const removal = lib
    .removeDomain('racing.example', { actor: 'admin', logger: quietLog })
    .then(() => {
      removed = true;
    });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(removed, false, 'the removal waits for the tunnel lock');
  release();
  await held;
  await removal;
  assert.equal(removed, true);
  // A write that names it afterwards is refused, not stored.
  await assert.rejects(
    lib.withActiveDomain('racing.example', async () => assert.fail('ran on a removed domain')),
    (err) => err.code === 'unknown_domain',
  );
  await lib.withActiveDomain('samplepark.tr', async () => {});
});

test('adding or activating a domain holds the hostname locks: a site taking a relay hostname is either before or after', async () => {
  const { withTunnelLock } = await import('@lamalibre/lamaste/server');
  let release;
  const held = withTunnelLock(() => new Promise((resolve) => (release = resolve)));
  let added = false;
  const adding = call('POST', '/api/domains', { name: 'held.example' }).then((res) => {
    added = res.statusCode === 201;
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(added, false, 'the add waits for the tunnel lock');
  release();
  await held;
  await adding;
  assert.equal(added, true);

  // Activation re-checks under the locks after the certificate: a relay
  // hostname taken while it was issued refuses it.
  activation.length = 0;
  const original = lib.writeSites;
  const site = {
    id: '33333333-4444-4555-8666-777777777777',
    name: 'sneaky',
    fqdn: 'auth.held.example',
    type: 'custom',
    spaMode: false,
    autheliaProtected: false,
    allowedUsers: [],
    dnsVerified: false,
    certIssued: false,
    rootPath: '/var/www/lamaste/33333333-4444-4555-8666-777777777777/',
    createdAt: new Date().toISOString(),
    totalSize: 0,
  };
  lib.setDomainActivationForTests({
    issueCert: async () => {
      await original([site]);
    },
    writeAuthVhost: async (domain) => activation.push(['vhost', domain]),
    removeAuthVhost: async (domain) => activation.push(['remove-vhost', domain]),
  });
  const refused = await call('POST', '/api/domains/held.example/activate');
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().code, 'relay_host_taken');
  assert.deepEqual(activation, [], 'no vhost written');
  await lib.writeSites([]);
  lib.setDomainActivationForTests({
    issueCert: async (fqdn, email) => activation.push(['cert', fqdn, email]),
    writeAuthVhost: async (domain, opts) => {
      if (failVhost) throw new Error('nginx -t failed');
      activation.push(['vhost', domain, opts]);
    },
    removeAuthVhost: async (domain) => activation.push(['remove-vhost', domain]),
  });
  assert.equal((await call('DELETE', '/api/domains/held.example')).statusCode, 200);
});

test('rendering: both steps are always tried; a failure streak is audited and notified once, its end once', async () => {
  const { listNotifications } = await import('../src/lib/notifications.js');
  const projectionPath = path.join(stateDir, 'domains.json');
  const before = (await audits('domain.render.failed')).length;

  // Gatekeeper's projection cannot be written: Authelia is rendered all the same.
  await rm(projectionPath, { force: true });
  await mkdir(projectionPath);
  const rendersBefore = renders;
  const onur = await idOf('onur');
  const answer = await call('PUT', `/api/domains/samplepark.tr/members/${onur}`);
  assert.equal(answer.statusCode, 200);
  await lib.syncDomainAccess({ logger: quietLog }).catch(() => {});
  failAccess = true;
  await assert.rejects(lib.syncDomainAccess({ logger: quietLog }), /gatekeeper: .*; authelia:/);
  assert.ok(renders >= rendersBefore);
  const failed = await audits('domain.render.failed');
  assert.equal(failed.length - before, 1, 'one audit for the streak');
  assert.deepEqual(failed.at(0).details, { steps: ['gatekeeper'] });
  const notices = await listNotifications({ limit: 10 });
  assert.ok(
    notices.notifications.some((n) => n.level === 'critical' && /rendered/.test(n.message)),
  );

  // Authelia alone failing: the projection is written anyway.
  await rm(projectionPath, { recursive: true });
  await assert.rejects(lib.syncDomainAccess({ logger: quietLog }), /^Error: authelia:|authelia:/);
  assert.ok((await projection()).domains.length > 0, 'the projection was written');

  failAccess = false;
  await lib.syncDomainAccess({ logger: quietLog });
  assert.equal((await audits('domain.render.recovered')).length, 1);
});

test('registry tokens follow the registry’s domains: revoked when a user is a member of none of them', async () => {
  const revoked = [];
  const feria = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'DELETE' && url.pathname === '/-/feria/tokens') {
      revoked.push(url.searchParams.get('owner'));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ revoked: [] }));
  });
  await new Promise((resolve) => feria.listen(0, '127.0.0.1', resolve));
  const registry = await import('../src/lib/registry-credential.js');
  const credential = (auth) => ({
    provider: 'feria',
    registryUrl: `http://127.0.0.1:${feria.address().port}/`,
    scope: '@lamalibre',
    auth,
    configuredAt: new Date().toISOString(),
  });
  try {
    // A pasted token: the registry's domain is the primary.
    await registry.writeRegistryCredentialConfig(
      credential({ kind: 'token', token: 'feria_test_service_token_000000' }),
    );
    assert.deepEqual(await lib.registryDomains(), ['samplepark.tr']);
    const onur = await idOf('onur');
    const cust = await idOf('cust');
    await call('PUT', `/api/domains/codelama.com.tr/members/${onur}`);
    await call('PUT', `/api/domains/samplepark.tr/members/${onur}`);
    revoked.length = 0;
    // Still a member of the registry's domain: nothing to revoke.
    await call('DELETE', `/api/domains/codelama.com.tr/members/${onur}`);
    assert.deepEqual(revoked, []);
    // A member of none of them any more: revoked.
    const ended = await call('DELETE', `/api/domains/samplepark.tr/members/${cust}`);
    assert.equal(ended.statusCode, 200, ended.body);
    assert.deepEqual(revoked, ['user:cust']);
    await call('PUT', `/api/domains/samplepark.tr/members/${cust}`);

    // Who is revoked when the registry's domains become codelama.com.tr:
    // everyone who is a member of none of them; onur keeps theirs.
    await call('PUT', `/api/domains/codelama.com.tr/members/${onur}`);
    revoked.length = 0;
    const tokenCredential = await registry.readRegistryCredentialConfig();
    await lib.revokeRegistryTokensOutside(['codelama.com.tr'], tokenCredential, quietLog);
    assert.ok(revoked.includes('user:cust'));
    assert.ok(!revoked.includes('user:onur'));

    // Storing a credential whose domains differ revokes them (here each
    // attempt reports a warning: the stand-in Authelia is absent, so the
    // panel's OIDC token cannot be had); unchanged domains revoke nothing.
    const changed = await registry.setRegistryCredential(
      credential({ kind: 'oidc', clientId: 'lamaste-server', issuerDomain: 'codelama.com.tr' }),
      { logger: quietLog },
    );
    assert.ok(changed.length > 0 && changed.every((w) => w.step === 'registry'));
    assert.deepEqual(await lib.registryDomains(), ['codelama.com.tr']);
    const unchanged = await registry.setRegistryCredential(
      credential({ kind: 'oidc', clientId: 'lamaste-server', issuerDomain: 'codelama.com.tr' }),
      { logger: quietLog },
    );
    assert.deepEqual(unchanged, []);
    // A domain that is no longer active is refused, nothing stored.
    await assert.rejects(
      registry.setRegistryCredential(
        credential({ kind: 'oidc', clientId: 'lamaste-server', issuerDomain: 'nowhere.example' }),
      ),
      (err) => err.code === 'unknown_domain',
    );
  } finally {
    await registry.clearRegistryCredentialConfig();
    await new Promise((resolve) => feria.close(resolve));
  }
});

test('the identity tick syncs the OIDC provider too — a plugin move whose sync failed is healed', async () => {
  const { identityTick } = await import('../src/lib/identity-sync.js');
  let writes = 0;
  const previous = oidcGate;
  oidcGate = { entered: () => (writes += 1), released: Promise.resolve() };
  try {
    await identityTick(quietLog);
  } finally {
    oidcGate = previous;
  }
  assert.ok(writes > 0, 'the tick wrote the OIDC provider');
});
