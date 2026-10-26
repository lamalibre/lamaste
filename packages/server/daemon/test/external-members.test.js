/**
 * External members of a domain in the panel (packages/core/docs/external-members-design.md):
 * a membership's kind through the members, users and invitations APIs,
 * audited and projected; Authelia groups and external memberships exclude
 * each other; the groups Lamaste owns in users.yml — membership by kind,
 * host groups of restricted tunnels and static sites, OIDC client grants —
 * rendered from state.db and Gatekeeper's grants, kept by every edit,
 * hidden from every answer, and never restarting Authelia — but for a
 * narrowing that reaches a device-code OIDC client, whose sessions must end;
 * only a structural change rewrites its configuration. Authelia is a users
 * file and a recorder, Gatekeeper a fake (`fake-gatekeeper.js`), Feria a
 * stand-in for registry revocations.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { validateManifest } from '@lamalibre/lamaste';
import { renderGroupAccessControl, renderSessionCookies } from '@lamalibre/lamaste/server';

import { createFakeAutheliaStorage } from './fake-authelia-storage.js';
import { installFakeGatekeeper } from './fake-gatekeeper.js';

const HASH = '$2b$12$abcdefghijklmnopqrstuuJ2s4L6rjpDLHi3qL7Nn5D0o3M6a1g2a';
const D = 'samplepark.tr';
/** The domain's member and external groups, named by its random group key (set in `before`). */
let MEMBER;
let EXTERNAL;
const PLUGIN_PACKAGE = '@lamalibre/e2e-external-fixture-server';

/** A plugin with a user-facing OIDC client and a service client. */
const fixtureManifest = {
  name: 'e2e-external-fixture',
  version: '0.1.0',
  hosting: 'agent',
  oidcClients: [
    {
      id: 'e2e-external-fixture-cli',
      grantTypes: ['urn:ietf:params:oauth:grant-type:device_code'],
      scopes: ['openid', 'profile'],
      audience: ['https://fixture.{domain}'],
    },
    {
      // A user-facing client that signs in with the authorization code
      // flow — not the registry's, not a device-code client.
      id: 'e2e-external-fixture-web',
      grantTypes: ['authorization_code'],
      scopes: ['openid', 'profile'],
      redirectUris: ['https://fixture.example.org/callback'],
      audience: ['https://fixture.{domain}/web'],
    },
    {
      id: 'e2e-external-fixture-service',
      confidential: true,
      grantTypes: ['client_credentials'],
      scopes: ['registry_read'],
      audience: ['https://fixture.{domain}'],
    },
  ],
};

let dir;
let stateDir;
let usersFile;
let lib;
let app;
let gatekeeper;
/** Authelia's configuration as last rendered: `{ domains, sites }`. */
let rendered = null;
/** How many times the configuration changed (each would restart Authelia). */
let configChanges = 0;
/** The rendered configuration sections, as JSON. */
let configNow = null;
let restarts = 0;
/** Authelia restarts audited by the rendering, with their reason. */
const restartReasons = async () =>
  (await audits('authelia.restarted')).map((a) => a.details.reason).reverse();
const quietLog = { info() {}, warn() {}, error() {}, debug() {} };

const person = (displayname, email, groups = []) => ({
  displayname,
  email,
  password: HASH,
  groups,
});

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

const usersNow = async () => yaml.load(await readFile(usersFile, 'utf-8')).users;
const groupsOf = async (username) => (await usersNow())[username]?.groups ?? [];
const idOf = async (username) => (await lib.findDirectoryUser(username))?.userId;
const projection = async () =>
  JSON.parse(await readFile(path.join(stateDir, 'domains.json'), 'utf-8'));
const audits = (action) => lib.listAudit({ action, limit: 200 });
const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-external-'));
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
      domain: D,
      email: 'ops@samplepark.tr',
      dataDir: stateDir,
      onboarding: { status: 'COMPLETED' },
    }),
  );
  await writeFile(
    usersFile,
    yaml.dump({
      users: {
        admin: person('Admin', 'admin@samplepark.tr', ['admins']),
        onur: person('Onur', 'onur@codelama.com.tr'),
        ext: person('Client', 'client@example.com'),
        mert: person('Mert', 'mert@codelama.com.tr', ['feria-admins']),
      },
    }),
    { mode: 0o660 },
  );

  // The fixture plugin, installed: its manifest is all the OIDC sync reads.
  const pkg = path.join(stateDir, 'node_modules', ...PLUGIN_PACKAGE.split('/'));
  await mkdir(pkg, { recursive: true });
  await writeFile(
    path.join(pkg, 'package.json'),
    JSON.stringify({ name: PLUGIN_PACKAGE, version: '0.1.0', type: 'module' }),
  );
  await writeFile(
    path.join(pkg, 'lamaste-plugin.json'),
    JSON.stringify({ ...fixtureManifest, packages: { server: PLUGIN_PACKAGE } }),
  );

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
    ...(await import('../src/lib/plugin-oidc.js')),
  };
  await lib.loadConfig();
  lib.setAutheliaForTests({
    usersFile,
    restart: async () => {
      restarts += 1;
    },
    writeTotp: async () => {},
    userStorage: createFakeAutheliaStorage().storage,
    // What core's updateDomainAccess compares: the rendered sections.
    domainAccess: async (access) => {
      const sections = JSON.stringify([
        renderSessionCookies(access.domains.map((d) => d.name)),
        renderGroupAccessControl(access.domains, access.sites),
      ]);
      const changed = sections !== configNow;
      configNow = sections;
      rendered = structuredClone(access);
      if (changed) configChanges += 1;
      return { changed };
    },
    oidcProvider: async (_domains, clients) => ({ changed: false, clients: clients.length }),
  });
  gatekeeper = installFakeGatekeeper(lib);

  const parsed = validateManifest(fixtureManifest);
  await lib.writePlugins({
    plugins: [
      {
        name: parsed.name,
        packageName: PLUGIN_PACKAGE,
        version: parsed.version,
        description: parsed.description,
        capabilities: parsed.capabilities,
        packages: parsed.packages,
        panel: parsed.panel,
        config: parsed.config,
        modes: parsed.modes,
        hosting: parsed.hosting,
        status: 'enabled',
        installedAt: '2026-10-26T00:00:00.000Z',
      },
    ],
  });

  await lib.reconcileDirectory({ confirmDelayMs: 0 });
  await lib.ensurePrimaryDomain();
  const key = await lib.domainGroupKey(D);
  MEMBER = `lamaste:m:${key}`;
  EXTERNAL = `lamaste:x:${key}`;
  await lib.syncDomainAccess();

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
  for (const route of ['domains', 'users', 'invitations', 'gatekeeper-proxy', 'identity']) {
    const { default: routes } = await import(`../src/routes/management/${route}.js`);
    await app.register(routes, { prefix: '/api' });
  }
  await app.ready();
});

after(async () => {
  lib.setAutheliaForTests(null);
  lib.setGatekeeperClientForTests(null);
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

test('a membership’s kind: made external through the members API, audited, projected and rendered — no restart', async () => {
  const ext = await idOf('ext');
  assert.deepEqual(await groupsOf('ext'), [MEMBER], 'every member of the one domain, as before');
  const seq = () =>
    lib
      .getStateDb()
      .then((db) => db.prepare('SELECT seq FROM domain_members WHERE user_id = ?').get(ext).seq);
  const seqBefore = await seq();

  const res = await call('PUT', `/api/domains/${D}/members/ext`, { kind: 'external' });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json(), { added: false, changed: true });
  assert.deepEqual(
    (await call('PUT', `/api/domains/${D}/members/ext`, { kind: 'external' })).json(),
    { added: false, changed: false },
    'idempotent',
  );
  assert.ok((await seq()) > seqBefore, 'a change of kind takes the directory’s sequence');

  assert.deepEqual((await audits('directory.membership.changed')).at(0).details, {
    domain: D,
    userId: ext,
    from: 'member',
    to: 'external',
  });
  const members = (await call('GET', `/api/domains/${D}/members`)).json().members;
  assert.equal(members.find((m) => m.username === 'ext').kind, 'external');
  assert.equal(members.find((m) => m.username === 'onur').kind, 'member');
  const overview = (await call('GET', '/api/domains')).json().domains[0];
  assert.deepEqual([overview.members, overview.externalMembers], [3, 1]);

  assert.deepEqual(await projection(), {
    v: 2,
    domains: [{ name: D, members: ['admin', 'mert', 'onur'], externals: ['ext'] }],
  });
  assert.deepEqual(await groupsOf('ext'), [EXTERNAL]);
  assert.deepEqual(await groupsOf('admin'), ['admins', MEMBER]);
  assert.equal(configChanges, 1, 'the configuration was written once, at the first rendering');
  // ext was a member of a domain serving a device-code client
  // (e2e-external-fixture-cli): Authelia's device flow checks the groups a
  // session last refreshed, so the narrowing ends sessions — once.
  assert.equal(restarts, 1);
  assert.deepEqual(await restartReasons(), ['device-code']);
  assert.deepEqual(
    (await audits('directory.access.narrowed')).map((a) => a.details),
    [{ userId: ext, groups: 1 }],
    'audited by id and a count, never a username or a group',
  );
  assert.equal(
    (await call('PUT', `/api/domains/${D}/members/ext`, { kind: 'guest' })).statusCode,
    400,
  );
});

test('Authelia groups and external memberships exclude each other', async () => {
  // mert holds feria-admins: never external.
  const refused = await call('PUT', `/api/domains/${D}/members/mert`, { kind: 'external' });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().code, 'external_member_groups');
  assert.equal(
    (await call('PUT', '/api/users/mert', { domains: [{ name: D, kind: 'external' }] })).json()
      .code,
    'external_member_groups',
  );
  // An external member is given no group …
  const given = await call('PUT', '/api/users/ext', { groups: ['staff'] });
  assert.equal(given.statusCode, 409);
  assert.equal(given.json().code, 'external_member_groups');
  assert.deepEqual(await groupsOf('ext'), [EXTERNAL], 'nothing written');
  // … unless the same edit makes them a member: the memberships go first.
  const promoted = await call('PUT', '/api/users/ext', {
    groups: ['staff'],
    domains: [{ name: D, kind: 'member' }],
  });
  assert.equal(promoted.statusCode, 200, promoted.body);
  assert.deepEqual(promoted.json().user.groups, ['staff']);
  assert.deepEqual(promoted.json().user.domains, [{ name: D, kind: 'member' }]);
  assert.deepEqual(await groupsOf('ext'), ['staff', MEMBER]);
  // And back: the groups go first.
  const demoted = await call('PUT', '/api/users/ext', {
    groups: [],
    domains: [{ name: D, kind: 'external' }],
  });
  assert.equal(demoted.statusCode, 200, demoted.body);
  assert.deepEqual(await groupsOf('ext'), [EXTERNAL]);

  // A name that could be a host or one of Lamaste's own groups is reserved.
  for (const name of ['wiki.samplepark.tr', 'lamaste:member@samplepark.tr', 'a@b']) {
    const res = await call('PUT', '/api/users/onur', { groups: [name] });
    assert.equal(res.statusCode, 400, name);
    assert.equal(res.json().code, 'reserved_group');
  }

  // Invitations name the kind; groups with an external membership are refused.
  const invitation = { username: 'client2', email: 'client2@example.com' };
  const both = await call('POST', '/api/invitations', {
    ...invitation,
    groups: ['staff'],
    domains: [{ name: D, kind: 'external' }],
  });
  assert.equal(both.statusCode, 400);
  assert.equal(both.json().code, 'external_member_groups');
  assert.equal(
    (
      await call('POST', '/api/invitations', {
        ...invitation,
        domains: [D, { name: D, kind: 'external' }],
      })
    ).json().code,
    'conflicting_membership',
  );
  const invited = await call('POST', '/api/invitations', {
    ...invitation,
    domains: [{ name: D, kind: 'external' }],
  });
  assert.equal(invited.statusCode, 201, invited.body);
  const listed = (await call('GET', '/api/invitations')).json().invitations;
  assert.deepEqual(listed.find((i) => i.username === 'client2').domains, [
    { name: D, kind: 'external' },
  ]);
  assert.deepEqual(await lib.invitationDomainsNow((await lib.readInvitations()).at(-1)), [
    { name: D, kind: 'external' },
  ]);
  // Made a member and back: only narrowing restarts — ext turned external
  // again lost the member group, which reached the device-code client.
  assert.equal(restarts, 2);
});

test('the groups Lamaste owns: hidden from every answer, kept by every edit, a stray one removed', async () => {
  const users = (await call('GET', '/api/users')).json().users;
  assert.deepEqual(users.find((u) => u.username === 'admin').groups, ['admins']);
  assert.deepEqual(users.find((u) => u.username === 'ext').groups, []);
  assert.deepEqual(users.find((u) => u.username === 'ext').domains, [
    { name: D, kind: 'external' },
  ]);
  const identity = (await call('GET', '/api/identity/users')).json().users;
  assert.deepEqual(identity.find((u) => u.username === 'admin').groups, ['admins']);
  assert.deepEqual(
    (await call('GET', '/api/identity/groups')).json().groups,
    ['admins', 'feria-admins'],
    'no group of Lamaste’s listed',
  );

  // An edit of the administrator's groups keeps their membership.
  const edited = await call('PUT', '/api/users/admin', { groups: ['admins', 'ops'] });
  assert.equal(edited.statusCode, 200, edited.body);
  assert.deepEqual(edited.json().user.groups, ['admins', 'ops']);
  assert.deepEqual(await groupsOf('admin'), ['admins', 'ops', MEMBER]);
  await call('PUT', '/api/users/admin', { displayname: 'The Admin' });
  assert.deepEqual(await groupsOf('admin'), ['admins', 'ops', MEMBER]);

  // A write from before a rendering never brings back what it removed: the
  // users file keeps the groups the rendering last decided.
  const stale = { users: await usersNow() };
  stale.users.onur.groups = [MEMBER, 'stray.samplepark.tr', EXTERNAL];
  await lib.writeUsers(stale);
  assert.deepEqual(await groupsOf('onur'), [MEMBER]);
  // Planted outside the panel: the next rendering removes it.
  await writeFile(
    usersFile,
    yaml.dump({ users: { ...stale.users, onur: { ...stale.users.onur } } }),
  );
  await lib.syncDomainAccess();
  assert.deepEqual(await groupsOf('onur'), [MEMBER]);
  assert.equal(restarts, 2, 'nothing narrowed: no restart');
});

test('host groups: an external member granted a restricted tunnel holds its group — directly or through a Lamaste group', async () => {
  const tunnel = (id, fqdn, accessMode) => ({
    id,
    subdomain: fqdn.split('.')[0],
    fqdn,
    port: 20090,
    type: 'app',
    accessMode,
    enabled: true,
    agentLabel: 'corral',
    createdAt: '2026-10-26T00:00:00.000Z',
  });
  await lib.writeTunnels([
    tunnel('t-corral', 'corral.samplepark.tr', 'restricted'),
    tunnel('t-wiki', 'wiki.samplepark.tr', 'authenticated'),
  ]);
  const grant = (principalType, principalId, resourceId) =>
    call('POST', '/api/gatekeeper/grants', {
      principalType,
      principalId,
      resourceType: 'tunnel',
      resourceId,
    });

  const direct = await grant('user', 'ext', 't-corral');
  assert.equal(direct.statusCode, 201, direct.body);
  assert.deepEqual(await groupsOf('ext'), ['corral.samplepark.tr', EXTERNAL]);
  // An authenticated tunnel names no external member, granted or not.
  assert.equal((await grant('user', 'ext', 't-wiki')).statusCode, 201);
  assert.ok(!(await groupsOf('ext')).includes('wiki.samplepark.tr'));
  // A member granted it needs no host group: their domain's group admits them.
  assert.equal((await grant('user', 'onur', 't-corral')).statusCode, 201);
  assert.deepEqual(await groupsOf('onur'), [MEMBER]);

  // Through a Lamaste group: the user grant revoked, the group's kept.
  await call('POST', '/api/gatekeeper/groups', { name: 'clients' });
  await call('POST', '/api/gatekeeper/groups/clients/members', { usernames: ['ext'] });
  await grant('group', 'clients', 't-corral');
  const userGrant = gatekeeper.grants.find(
    (g) => g.principalId === 'ext' && g.resourceId === 't-corral',
  );
  await call('DELETE', `/api/gatekeeper/grants/${userGrant.grantId}`);
  assert.deepEqual(await groupsOf('ext'), ['corral.samplepark.tr', EXTERNAL]);
  await call('DELETE', '/api/gatekeeper/groups/clients/members/ext');
  assert.deepEqual(await groupsOf('ext'), [EXTERNAL], 'the group grant no longer reaches them');
  await call('POST', '/api/gatekeeper/groups/clients/members', { usernames: ['ext'] });
  assert.deepEqual(await groupsOf('ext'), ['corral.samplepark.tr', EXTERNAL]);

  // Gatekeeper unreachable: external members hold no granted host until it
  // answers again (fail closed) — the membership groups are rendered all
  // the same, and the failure is audited.
  gatekeeper.state.unreachable = true;
  await assert.rejects(lib.syncDomainAccess({ logger: quietLog }), /grants: .*could not be read/);
  gatekeeper.state.unreachable = false;
  assert.deepEqual(await groupsOf('ext'), [EXTERNAL]);
  assert.deepEqual(await groupsOf('onur'), [MEMBER]);
  assert.deepEqual((await audits('domain.render.failed')).at(0).details, { steps: ['grants'] });
  await lib.syncDomainAccess({ logger: quietLog });
  assert.deepEqual(
    await groupsOf('ext'),
    ['corral.samplepark.tr', EXTERNAL],
    'back once it answers',
  );

  // The tunnel no longer restricted: its group goes, without being asked.
  await lib.writeTunnels([
    tunnel('t-corral', 'corral.samplepark.tr', 'authenticated'),
    tunnel('t-wiki', 'wiki.samplepark.tr', 'authenticated'),
  ]);
  await settle();
  assert.deepEqual(await groupsOf('ext'), [EXTERNAL]);
  await lib.writeTunnels([tunnel('t-corral', 'corral.samplepark.tr', 'restricted')]);
  await settle();
  assert.deepEqual(await groupsOf('ext'), ['corral.samplepark.tr', EXTERNAL]);
  // A disabled tunnel serves nobody: its grants name no one (a web surface
  // moved off a tunnel leaves it disabled on the same hostname).
  await lib.writeTunnels([
    { ...tunnel('t-corral', 'corral.samplepark.tr', 'restricted'), enabled: false },
  ]);
  await settle();
  assert.deepEqual(await groupsOf('ext'), [EXTERNAL]);
  // A tunnel without an access mode is restricted, as Gatekeeper reads it.
  const legacy = tunnel('t-corral', 'corral.samplepark.tr', 'restricted');
  delete legacy.accessMode;
  await lib.writeTunnels([legacy]);
  await settle();
  assert.deepEqual(await groupsOf('ext'), ['corral.samplepark.tr', EXTERNAL]);
  assert.equal(restarts, 2, 'no host grant or tunnel change restarts Authelia');
});

test('a static site’s listed users are its host group: editing the list rewrites no configuration, protecting a site does', async () => {
  const site = (allowedUsers) => ({
    id: 's-docs',
    name: 'docs',
    fqdn: 'docs.samplepark.tr',
    autheliaProtected: true,
    allowedUsers,
  });
  const changesBefore = configChanges;
  await lib.syncDomainAccess({ sites: [site(['ext', 'onur', 'nobody'])] });
  assert.equal(configChanges, changesBefore + 1, 'a newly protected site is a structural change');
  // The site's group is named by its id, never its hostname.
  assert.ok((await groupsOf('ext')).includes('lamaste:s:s-docs'));
  assert.ok((await groupsOf('onur')).includes('lamaste:s:s-docs'));
  assert.ok(!(await groupsOf('onur')).includes('docs.samplepark.tr'));
  assert.deepEqual(
    rendered.sites.map((s) => [s.id, s.fqdn]),
    [['s-docs', 'docs.samplepark.tr']],
  );

  await lib.syncDomainAccess({ sites: [site(['onur'])] });
  assert.equal(configChanges, changesBefore + 1, 'the rules name the group, not the people');
  assert.ok(!(await groupsOf('ext')).includes('lamaste:s:s-docs'));
  assert.ok((await groupsOf('onur')).includes('lamaste:s:s-docs'));

  await lib.syncDomainAccess({ sites: [] });
  assert.ok(!(await groupsOf('onur')).includes('lamaste:s:s-docs'));
  assert.equal(restarts, 2, 'a site list reaches no OIDC client: no restart');
});

test('OIDC client grants: a user-facing client of an installed plugin only; an external member granted holds its group', async () => {
  const grant = (resourceId, principalId = 'ext') =>
    call('POST', '/api/gatekeeper/grants', {
      principalType: 'user',
      principalId,
      resourceType: 'oidc-client',
      resourceId,
    });
  const unknown = await grant('no-such-client');
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.json().code, 'unknown_oidc_client');
  const service = await grant('e2e-external-fixture-service');
  assert.equal(service.statusCode, 400);
  assert.equal(service.json().code, 'service_oidc_client');

  assert.equal((await grant('e2e-external-fixture-cli')).statusCode, 201);
  assert.ok((await groupsOf('ext')).includes('lamaste:oidc@e2e-external-fixture-cli'));
  // A member needs none: their domain's group is in the client's policy.
  assert.equal((await grant('e2e-external-fixture-cli', 'onur')).statusCode, 201);
  assert.ok(!(await groupsOf('onur')).includes('lamaste:oidc@e2e-external-fixture-cli'));

  const clients = await lib.listPluginOidcClients('e2e-external-fixture');
  const cli = clients.find((c) => c.id === 'e2e-external-fixture-cli');
  assert.equal(cli.userFacing, true);
  assert.deepEqual(cli.grants.map((g) => g.principalId).sort(), ['ext', 'onur']);
  const svc = clients.find((c) => c.id === 'e2e-external-fixture-service');
  assert.equal(svc.userFacing, false);
  assert.equal('grants' in svc, false);

  const granted = gatekeeper.grants.find(
    (g) => g.principalId === 'ext' && g.resourceType === 'oidc-client',
  );
  // Revoked: the group goes — and, the client signing in with the device
  // code, Authelia restarts so no session keeps the group it last read.
  await call('DELETE', `/api/gatekeeper/grants/${granted.grantId}`);
  assert.ok(!(await groupsOf('ext')).includes('lamaste:oidc@e2e-external-fixture-cli'));
  assert.equal(restarts, 3);
  // The same for a client without the device flow: no restart.
  assert.equal((await grant('e2e-external-fixture-web')).statusCode, 201);
  assert.ok((await groupsOf('ext')).includes('lamaste:oidc@e2e-external-fixture-web'));
  const web = gatekeeper.grants.find(
    (g) => g.principalId === 'ext' && g.resourceId === 'e2e-external-fixture-web',
  );
  await call('DELETE', `/api/gatekeeper/grants/${web.grantId}`);
  assert.ok(!(await groupsOf('ext')).includes('lamaste:oidc@e2e-external-fixture-web'));
  assert.equal(restarts, 3);
});

test('registry tokens: revoked when no sign-in client of the registry admits them any more — the registry’s own clients only', async () => {
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
  const registryUrl = `http://127.0.0.1:${feria.address().port}`;
  // The registry's sign-in is the client whose audience is the registry:
  // e2e-external-fixture-cli here. The web client is any other client.
  const manifestFile = path.join(
    stateDir,
    'node_modules',
    ...PLUGIN_PACKAGE.split('/'),
    'lamaste-plugin.json',
  );
  const original = await readFile(manifestFile, 'utf-8');
  const manifest = JSON.parse(original);
  manifest.oidcClients[0].audience = [registryUrl];
  await writeFile(manifestFile, JSON.stringify(manifest));
  const registry = await import('../src/lib/registry-credential.js');
  try {
    await registry.writeRegistryCredentialConfig({
      provider: 'feria',
      registryUrl: `${registryUrl}/`,
      scope: '@lamalibre',
      auth: { kind: 'token', token: 'feria_test_service_token_000000' },
      configuredAt: new Date().toISOString(),
    });
    // No client grant left over from before.
    for (const g of gatekeeper.grants.filter((x) => x.resourceType === 'oidc-client')) {
      await call('DELETE', `/api/gatekeeper/grants/${g.grantId}`);
    }
    // onur, a member, made external: their sign-in no longer reaches the registry.
    revoked.length = 0;
    const made = await call('PUT', `/api/domains/${D}/members/onur`, { kind: 'external' });
    assert.equal(made.statusCode, 200, made.body);
    assert.deepEqual(revoked, ['user:onur']);

    const give = (resourceId) =>
      call('POST', '/api/gatekeeper/grants', {
        principalType: 'user',
        principalId: 'onur',
        resourceType: 'oidc-client',
        resourceId,
      });
    // Another client granted is not the registry's sign-in: revoked on the
    // next narrowing all the same.
    await give('e2e-external-fixture-web');
    await call('PUT', `/api/domains/${D}/members/onur`, { kind: 'member' });
    revoked.length = 0;
    await call('PUT', `/api/domains/${D}/members/onur`, { kind: 'external' });
    assert.deepEqual(revoked, ['user:onur'], 'a grant on another client does not reach Feria');

    // Granted the registry's own client: kept …
    await give('e2e-external-fixture-cli');
    revoked.length = 0;
    await call('PUT', `/api/domains/${D}/members/onur`, { kind: 'member' });
    await call('PUT', `/api/domains/${D}/members/onur`, { kind: 'external' });
    assert.deepEqual(revoked, [], 'granted the registry’s client: still reaches the registry');
    // … until the grant goes — revoked with Gatekeeper's own CLI, past the
    // panel: the next rendering (the identity tick's) finds the narrowing.
    const granted = gatekeeper.grants.find(
      (g) => g.principalId === 'onur' && g.resourceId === 'e2e-external-fixture-cli',
    );
    gatekeeper.grants.splice(gatekeeper.grants.indexOf(granted), 1);
    await lib.syncDomainAccess({ logger: quietLog });
    assert.deepEqual(revoked, ['user:onur']);
  } finally {
    await registry.clearRegistryCredentialConfig();
    await new Promise((resolve) => feria.close(resolve));
    await writeFile(manifestFile, original);
    for (const g of gatekeeper.grants.filter((x) => x.principalId === 'onur')) {
      gatekeeper.grants.splice(gatekeeper.grants.indexOf(g), 1);
    }
    await call('PUT', `/api/domains/${D}/members/onur`, { kind: 'member' });
  }
});

test('every write of users.yml is touched once Authelia’s reload cooldown has passed — a hand edit gets the owned groups back', async () => {
  lib.setAutheliaForTests({
    usersFile,
    touchDelayMs: 20,
    restart: async () => {
      restarts += 1;
    },
    domainAccess: async () => ({ changed: false }),
  });
  try {
    await lib.syncDomainAccess({ logger: quietLog });
    const { ino: first } = await stat(usersFile);
    await lib.writeUsers({ users: await usersNow() });
    const { ino: written } = await stat(usersFile);
    assert.notEqual(written, first, 'written by a rename');
    await settle(80);
    const { ino: touched } = await stat(usersFile);
    assert.notEqual(touched, written, 'written again: Authelia reloads after its cooldown');
    // Changed by something else meanwhile (a hand edit dropping a group of
    // Lamaste's): touched all the same, the edit kept, the group back.
    await lib.writeUsers({ users: await usersNow() });
    const changed = { users: await usersNow() };
    changed.users.onur.displayname = 'Onur V';
    changed.users.onur.groups = [];
    await writeFile(usersFile, yaml.dump(changed));
    const { ino: theirs } = await stat(usersFile);
    await settle(80);
    assert.notEqual((await stat(usersFile)).ino, theirs);
    assert.equal((await usersNow()).onur.displayname, 'Onur V');
    assert.deepEqual(await groupsOf('onur'), [MEMBER]);
    // The touch the identity tick and the start do: the same, at once.
    await writeFile(usersFile, yaml.dump(changed));
    await lib.touchUsersFile();
    assert.deepEqual(await groupsOf('onur'), [MEMBER]);
  } finally {
    lib.setAutheliaForTests({
      usersFile,
      restart: async () => {
        restarts += 1;
      },
      domainAccess: async () => ({ changed: false }),
    });
  }
});

test('a write never drops a user it was not told to delete; a deleted username’s groups never reach whoever takes it next', async () => {
  await lib.syncDomainAccess({ logger: quietLog });
  // A write built from a read that missed a user (a partial file) is refused.
  const partial = { users: await usersNow() };
  delete partial.users.mert;
  await assert.rejects(lib.writeUsers(partial), /would remove users this change does not delete/);
  assert.ok((await usersNow()).mert, 'nothing written');

  // Deleted, declared: the rendering's groups for the username are forgotten.
  assert.deepEqual(await groupsOf('mert'), ['feria-admins', MEMBER]);
  await lib.writeUsers(partial, { deleting: ['mert'] });
  // Someone else given the username before any rendering ran: the deleted
  // user's membership is not theirs.
  const reused = { users: await usersNow() };
  reused.users.mert = person('Another Mert', 'other@example.com', [MEMBER]);
  await lib.writeUsers(reused);
  assert.deepEqual(await groupsOf('mert'), [], 'not the earlier holder’s, nor one planted');
  // The next rendering decides theirs (the directory knows them as a new user).
  await lib.reconcileDirectory({ confirmDelayMs: 0 });
  await lib.syncDomainAccess({ logger: quietLog });
  assert.deepEqual(await groupsOf('mert'), [MEMBER], 'one domain: every new user its member');
});

test('after a rendering failed, a write only narrows the owned groups', async () => {
  await lib.syncDomainAccess({ logger: quietLog });
  assert.deepEqual(await groupsOf('onur'), [MEMBER]);
  const extBefore = await groupsOf('ext');
  assert.ok(extBefore.includes(EXTERNAL));
  lib.narrowOwnedGroupsOnly();
  try {
    const planted = { users: await usersNow() };
    planted.users.onur.groups = [MEMBER, EXTERNAL, 'lamaste:oidc@e2e-external-fixture-cli'];
    planted.users.ext.groups = [];
    await lib.writeUsers(planted);
    assert.deepEqual(
      await groupsOf('onur'),
      [MEMBER],
      'kept what is held and decided, nothing new',
    );
    assert.deepEqual(await groupsOf('ext'), [], 'nothing added back while narrowing only');
  } finally {
    await lib.syncDomainAccess({ logger: quietLog });
  }
  assert.deepEqual(await groupsOf('ext'), extBefore, 'a rendering that succeeds decides again');
});

test('Authelia not watching users.yml (a configuration it could not be brought to): a change restarts it, as before', async () => {
  let watched = false;
  const counted = restarts;
  lib.setAutheliaForTests({
    usersFile,
    watchesUsersFile: async () => watched,
    restart: async () => {
      restarts += 1;
    },
    domainAccess: async () => ({ changed: false }),
  });
  try {
    await lib.syncDomainAccess({ logger: quietLog });
    const before = restarts;
    // Nothing changed: no restart.
    await lib.syncDomainAccess({ logger: quietLog });
    assert.equal(restarts, before);
    // users.yml changed: restarted so Authelia reads it.
    const data = { users: await usersNow() };
    data.users.onur.displayname = 'Onur Changed';
    await lib.writeUsers(data);
    await lib.syncDomainAccess({ logger: quietLog });
    assert.equal(restarts, before + 1);
    assert.equal((await restartReasons()).at(-1), 'unwatched');
    // Watched again: a change needs none.
    watched = true;
    data.users.onur.displayname = 'Onur';
    await lib.writeUsers(data);
    await lib.syncDomainAccess({ logger: quietLog });
    assert.equal(restarts, before + 1);
    assert.ok(restarts > counted);
  } finally {
    lib.setAutheliaForTests({
      usersFile,
      restart: async () => {
        restarts += 1;
      },
      domainAccess: async () => ({ changed: false }),
    });
    await lib.syncDomainAccess({ logger: quietLog });
  }
});

test('a domain removed: hostnames under it stay Lamaste’s groups, so one left on a user is stripped', async () => {
  const db = await lib.getStateDb();
  db.prepare("INSERT INTO retired_domains (name, removed_at) VALUES ('gone.example', ?)").run(
    new Date().toISOString(),
  );
  const planted = { users: await usersNow() };
  planted.users.ext.groups = [...(planted.users.ext.groups ?? []), 'corral.gone.example'];
  await writeFile(usersFile, yaml.dump(planted));
  await lib.syncDomainAccess({ logger: quietLog });
  assert.equal((await groupsOf('ext')).includes('corral.gone.example'), false);
  assert.equal((await lib.ownedGroupDomains()).includes('gone.example'), true);
});

test('desktop user access is for members of the primary domain: an external member gets no session', async () => {
  const crypto = await import('node:crypto');
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
  const token = (username, userId) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        iat: now,
        exp: now + 3600,
        lastActivity: now,
        type: 'user-access',
        username,
        userId,
      }),
    ).toString('base64url');
    const sig = crypto
      .createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(payload)
      .digest('base64url');
    return `${payload}.${sig}`;
  };
  const me = async (username) =>
    (
      await desk.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${token(username, await idOf(username))}` },
      })
    ).statusCode;
  try {
    assert.equal(await me('onur'), 200, 'a member');
    assert.equal(await me('ext'), 401, 'an external member');
    await call('PUT', `/api/domains/${D}/members/onur`, { kind: 'external' });
    assert.equal(await me('onur'), 401, 'made external: out at once');
    await call('PUT', `/api/domains/${D}/members/onur`, { kind: 'member' });
    assert.equal(await me('onur'), 200);
  } finally {
    await desk.close();
  }
});

test('uninstalling a plugin revokes the grants on its OIDC clients — a later install admits no one by them', async () => {
  const res = await call('POST', '/api/gatekeeper/grants', {
    principalType: 'user',
    principalId: 'ext',
    resourceType: 'oidc-client',
    resourceId: 'e2e-external-fixture-web',
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.ok((await groupsOf('ext')).includes('lamaste:oidc@e2e-external-fixture-web'));
  const plugins = await lib.readPlugins();
  plugins.plugins[0].status = 'disabled';
  await lib.writePlugins(plugins);
  await lib.uninstallPlugin('e2e-external-fixture', quietLog);
  assert.deepEqual(
    gatekeeper.grants.filter((g) => g.resourceType === 'oidc-client'),
    [],
    'no grant on its clients left',
  );
  assert.equal((await groupsOf('ext')).includes('lamaste:oidc@e2e-external-fixture-web'), false);
});

test('a users file read empty mid-write is read again before a write believes it', async () => {
  const full = await readFile(usersFile, 'utf-8');
  const partial = { users: yaml.load(full).users };
  delete partial.users.mert;
  // Truncated by another writer for a moment: the write reads again, sees
  // every user, and refuses to drop one it was not told to delete.
  await writeFile(usersFile, '');
  setTimeout(() => void writeFile(usersFile, full), 30);
  await assert.rejects(lib.writeUsers(partial), /would remove users/);
  assert.ok((await usersNow()).mert);
});

test('a grant change Gatekeeper took whose rendering failed: answered with warnings, rendered again within seconds', async () => {
  const created = await call('POST', '/api/gatekeeper/grants', {
    principalType: 'user',
    principalId: 'ext',
    resourceType: 'tunnel',
    resourceId: 't-somewhere',
  });
  assert.equal(created.statusCode, 201, created.body);
  lib.setAutheliaForTests({
    usersFile,
    restart: async () => {
      restarts += 1;
    },
    domainAccess: async () => {
      throw new Error('Authelia did not restart');
    },
  });
  try {
    const revoked = await call('DELETE', `/api/gatekeeper/grants/${created.json().grant.grantId}`);
    assert.equal(revoked.statusCode, 200, revoked.body);
    const { warnings } = revoked.json();
    assert.ok(
      warnings.some((w) => w.step === 'render' && /tries again within seconds/.test(w.message)),
    );
  } finally {
    lib.setAutheliaForTests({
      usersFile,
      restart: async () => {
        restarts += 1;
      },
      domainAccess: async () => ({ changed: false }),
    });
  }
});
