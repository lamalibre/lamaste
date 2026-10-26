/**
 * External members of a domain in the panel (packages/core/docs/external-members-design.md):
 * a membership's kind through the members, users and invitations APIs,
 * audited and projected; Authelia groups and external memberships exclude
 * each other; the groups Lamaste owns in users.yml — membership by kind,
 * host groups of restricted tunnels and static sites, OIDC client grants —
 * rendered from state.db and Gatekeeper's grants, kept by every edit,
 * hidden from every answer, and never restarting Authelia; only a
 * structural change rewrites its configuration. Authelia is a users file
 * and a recorder, Gatekeeper a fake (`fake-gatekeeper.js`), Feria a
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
const MEMBER = `lamaste:member@${D}`;
const EXTERNAL = `lamaste:external@${D}`;
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
        renderSessionCookies(access.domains),
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
  assert.equal(restarts, 0, 'no membership change restarts Authelia');
  assert.equal(configChanges, 1, 'the configuration was written once, at the first rendering');
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
  assert.equal(restarts, 0);
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
  stale.users.onur.groups = [MEMBER, 'stray.samplepark.tr', 'lamaste:external@samplepark.tr'];
  await lib.writeUsers(stale);
  assert.deepEqual(await groupsOf('onur'), [MEMBER]);
  // Planted outside the panel: the next rendering removes it.
  await writeFile(
    usersFile,
    yaml.dump({ users: { ...stale.users, onur: { ...stale.users.onur } } }),
  );
  await lib.syncDomainAccess();
  assert.deepEqual(await groupsOf('onur'), [MEMBER]);
  assert.equal(restarts, 0);
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

  // Gatekeeper unreachable: what external members hold now is kept.
  gatekeeper.state.unreachable = true;
  const kept = await lib.syncDomainAccess({ logger: quietLog });
  gatekeeper.state.unreachable = false;
  assert.match(kept.warnings[0], /could not be read/);
  assert.deepEqual(await groupsOf('ext'), ['corral.samplepark.tr', EXTERNAL]);

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
  assert.equal(restarts, 0, 'no grant or tunnel change restarts Authelia');
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
  assert.ok((await groupsOf('ext')).includes('docs.samplepark.tr'));
  assert.ok((await groupsOf('onur')).includes('docs.samplepark.tr'));
  assert.deepEqual(
    rendered.sites.map((s) => s.fqdn),
    ['docs.samplepark.tr'],
  );

  await lib.syncDomainAccess({ sites: [site(['onur'])] });
  assert.equal(configChanges, changesBefore + 1, 'the rules name the group, not the people');
  assert.ok(!(await groupsOf('ext')).includes('docs.samplepark.tr'));
  assert.ok((await groupsOf('onur')).includes('docs.samplepark.tr'));

  await lib.syncDomainAccess({ sites: [] });
  assert.ok(!(await groupsOf('onur')).includes('docs.samplepark.tr'));
  assert.equal(restarts, 0);
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
  await call('DELETE', `/api/gatekeeper/grants/${granted.grantId}`);
  assert.ok(!(await groupsOf('ext')).includes('lamaste:oidc@e2e-external-fixture-cli'));
  assert.equal(restarts, 0);
});

test('registry tokens: a member made external, or an external member losing the client grant, is revoked', async () => {
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
  try {
    await registry.writeRegistryCredentialConfig({
      provider: 'feria',
      registryUrl: `http://127.0.0.1:${feria.address().port}/`,
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

    // An external member granted the user-facing client keeps theirs …
    await call('POST', '/api/gatekeeper/grants', {
      principalType: 'user',
      principalId: 'onur',
      resourceType: 'oidc-client',
      resourceId: 'e2e-external-fixture-cli',
    });
    revoked.length = 0;
    await call('PUT', `/api/domains/${D}/members/onur`, { kind: 'member' });
    await call('PUT', `/api/domains/${D}/members/onur`, { kind: 'external' });
    assert.deepEqual(revoked, [], 'granted the client: still reaches the registry');
    // … until the grant goes.
    const granted = gatekeeper.grants.find(
      (g) => g.principalId === 'onur' && g.resourceType === 'oidc-client',
    );
    await call('DELETE', `/api/gatekeeper/grants/${granted.grantId}`);
    assert.deepEqual(revoked, ['user:onur']);
  } finally {
    await registry.clearRegistryCredentialConfig();
    await new Promise((resolve) => feria.close(resolve));
    await call('PUT', `/api/domains/${D}/members/onur`, { kind: 'member' });
  }
});

test('every write of users.yml is written again once Authelia’s reload cooldown has passed', async () => {
  lib.setAutheliaForTests({
    usersFile,
    touchDelayMs: 20,
    restart: async () => {
      restarts += 1;
    },
    domainAccess: async () => ({ changed: false }),
  });
  try {
    const { ino: first } = await stat(usersFile);
    await lib.writeUsers({ users: await usersNow() });
    const { ino: written } = await stat(usersFile);
    assert.notEqual(written, first, 'written by a rename');
    await settle(80);
    const { ino: touched } = await stat(usersFile);
    assert.notEqual(touched, written, 'written again: Authelia reloads after its cooldown');
    // Changed by someone else meanwhile (Authelia's own password reset): not touched.
    await lib.writeUsers({ users: await usersNow() });
    const changed = { users: await usersNow() };
    changed.users.onur.displayname = 'Onur V';
    await writeFile(usersFile, yaml.dump(changed));
    const { ino: theirs } = await stat(usersFile);
    await settle(80);
    assert.equal((await stat(usersFile)).ino, theirs);
    assert.equal((await usersNow()).onur.displayname, 'Onur V');
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
