/**
 * Grants on the site a plugin owns — its web surface. A restricted surface
 * admits a member of the plugin's audience only with a `site` grant (to
 * them or to a Lamaste group they are in), so the web surface's status
 * lists the site's grants and the members no grant admits, and the
 * Gatekeeper proxy refuses a site grant on a site that does not exist or
 * that no plugin owns, and audits the ones it gives and revokes.
 * Gatekeeper is a fake (`fake-gatekeeper.js`), Authelia a users file.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { normalizeIdentityBlock } from '@lamalibre/lamaste';

import { createFakeAutheliaStorage } from './fake-authelia-storage.js';
import { installFakeGatekeeper } from './fake-gatekeeper.js';

const HASH = '$2b$12$abcdefghijklmnopqrstuuJ2s4L6rjpDLHi3qL7Nn5D0o3M6a1g2a';
const IDENTITY = normalizeIdentityBlock({ roles: [{ id: 'member', label: 'Member' }] });

let dir;
let usersFile;
let lib;
let app;
let gatekeeper;

const SITES = {
  corral: {
    id: 'site-corral',
    name: 'corral',
    fqdn: 'corral.relay.test',
    type: 'managed',
    owner: { plugin: 'corral', package: '@lamalibre/corral-server' },
    accessMode: 'restricted',
  },
  herd: {
    id: 'site-herd',
    name: 'herd',
    fqdn: 'herd.relay.test',
    type: 'managed',
    owner: { plugin: 'herd', package: '@lamalibre/herd-server' },
    accessMode: 'authenticated',
  },
  docs: {
    id: 'site-docs',
    name: 'docs',
    fqdn: 'docs.relay.test',
    type: 'managed',
    autheliaProtected: true,
    allowedUsers: ['ayse'],
  },
};

const registryEntry = (name) => ({
  name,
  route: name,
  packageName: `@lamalibre/${name}-server`,
  version: '1.0.0',
  capabilities: [],
  hosting: 'agent',
  agent: {},
  identity: IDENTITY,
  userSurface: { web: { defaultSubdomain: name, accessMode: 'restricted', root: 'web' } },
  status: 'enabled',
  installedAt: '2026-11-04T00:00:00.000Z',
});

const person = (displayname) => ({
  displayname,
  email: `${displayname.toLowerCase()}@relay.test`,
  password: HASH,
  groups: [],
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

const userId = async (username) => (await lib.findDirectoryUser(username))?.userId ?? null;
const status = async (name) =>
  (await call('GET', `/api/plugins/${name}/web-surface`)).json().webSurface;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-site-grants-'));
  const stateDir = path.join(dir, 'state');
  await mkdir(stateDir);
  usersFile = path.join(dir, 'users.yml');
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_PKI_DIR = path.join(stateDir, 'pki');
  process.env.LAMALIBRE_LAMASTE_CONFIG = path.join(stateDir, 'panel.json');
  process.env.LAMALIBRE_LAMASTE_WEB_TREES_ROOT = path.join(dir, 'apps');
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
    ...(await import('../src/lib/config.js')),
    ...(await import('../src/lib/authelia.js')),
    ...(await import('../src/lib/gatekeeper-client.js')),
    ...(await import('../src/lib/directory.js')),
    ...(await import('../src/lib/audience.js')),
    ...(await import('../src/lib/plugins.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/state.js')),
    ...(await import('../src/lib/site-grants.js')),
  };
  await lib.loadConfig();
  lib.setAutheliaForTests({
    domainAccess: async () => ({ changed: false }),
    usersFile,
    restart: async () => {},
    writeTotp: async () => {},
    userStorage: createFakeAutheliaStorage().storage,
  });
  await (await import('../src/lib/domains.js')).ensurePrimaryDomain();
  gatekeeper = installFakeGatekeeper(lib);

  await writeFile(
    usersFile,
    yaml.dump(
      {
        users: {
          admin: { ...person('Admin'), groups: ['admins'] },
          ayse: person('Ayse'),
          mehmet: person('Mehmet'),
          zeynep: person('Zeynep'),
          ali: person('Ali'),
        },
      },
      { lineWidth: -1 },
    ),
    { mode: 0o660 },
  );
  await lib.reconcileDirectory({ confirmDelayMs: 0 });
  await lib.writePlugins({ plugins: [registryEntry('corral'), registryEntry('herd')] });
  await lib.writeSites(Object.values(SITES));

  const { default: Fastify } = await import('fastify');
  const { default: errors } = await import('../src/middleware/errors.js');
  const { default: gatekeeperProxyRoutes } =
    await import('../src/routes/management/gatekeeper-proxy.js');
  const { default: webSurfaceRoutes } =
    await import('../src/routes/management/plugin-web-surface.js');
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
  await app.register(gatekeeperProxyRoutes, { prefix: '/api' });
  await app.register(webSurfaceRoutes, { prefix: '/api' });
  await app.ready();
});

after(async () => {
  lib.setAutheliaForTests(null);
  lib.setGatekeeperClientForTests(null);
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

test('membersWithoutSiteGrant: active members no user or group grant names, by username', () => {
  const member = (userId, username, status = 'active') => ({
    userId,
    change: { kind: 'upsert', member: { userId, username, roles: ['member'], status } },
  });
  const audience = [
    member('u-z', 'zeynep'),
    member('u-a', 'ayse'),
    member('u-m', 'mehmet'),
    member('u-d', 'dilek', 'disabled'),
    { userId: 'u-x', change: { kind: 'remove', reason: 'unentitled', last: {} } },
    member('u-b', 'burak'),
  ];
  const grants = [
    { principalType: 'user', principalId: 'ayse' },
    { principalType: 'group', principalId: 'ops' },
    { principalType: 'group', principalId: 'gone' },
  ];
  const groups = [{ name: 'ops', members: ['mehmet'] }];
  assert.deepEqual(lib.membersWithoutSiteGrant(audience, grants, groups), [
    { userId: 'u-b', username: 'burak' },
    { userId: 'u-z', username: 'zeynep' },
  ]);
  assert.deepEqual(lib.membersWithoutSiteGrant([], grants, groups), []);
});

test('siteGrantsCount: every access mode but authenticated, a missing one included', () => {
  assert.equal(lib.siteGrantsCount({ accessMode: 'restricted' }), true);
  assert.equal(lib.siteGrantsCount({}), true);
  assert.equal(lib.siteGrantsCount({ accessMode: 'authenticated' }), false);
});

test('the proxy refuses a site grant on no site, or on a site no plugin owns', async () => {
  const unknown = await call('POST', '/api/gatekeeper/grants', {
    principalType: 'user',
    principalId: 'ayse',
    resourceType: 'site',
    resourceId: 'site-nowhere',
  });
  assert.equal(unknown.statusCode, 400, unknown.body);
  assert.equal(unknown.json().code, 'unknown_site');

  const staticSite = await call('POST', '/api/gatekeeper/grants', {
    principalType: 'user',
    principalId: 'ayse',
    resourceType: 'site',
    resourceId: SITES.docs.id,
  });
  assert.equal(staticSite.statusCode, 400, staticSite.body);
  assert.equal(staticSite.json().code, 'site_not_grantable');
  assert.equal(gatekeeper.grants.length, 0, 'nothing reached Gatekeeper');
});

test('the status names the entitled members no site grant admits; a grant admits them', async () => {
  gatekeeper.setGroup('ops', ['zeynep', 'ali']);
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'ayse',
    resourceType: 'plugin',
    resourceId: 'corral',
    context: { roles: ['member'] },
  });
  gatekeeper.addGrant({
    principalType: 'group',
    principalId: 'ops',
    resourceType: 'plugin',
    resourceId: 'corral',
    context: { roles: ['member'] },
  });
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'mehmet',
    resourceType: 'plugin',
    resourceId: 'herd',
    context: { roles: ['member'] },
  });
  await lib.recomputeAudiences();

  let view = await status('corral');
  assert.deepEqual(view.site.grants, []);
  assert.deepEqual(
    view.site.membersWithoutGrant.map((m) => m.username),
    ['ali', 'ayse', 'zeynep'],
  );
  assert.equal(view.site.membersWithoutGrant[1].userId, await userId('ayse'));
  // An authenticated surface admits every member: nobody lacks a grant.
  assert.deepEqual((await status('herd')).site.membersWithoutGrant, []);

  const given = await call('POST', '/api/gatekeeper/grants', {
    principalType: 'user',
    principalId: 'ayse',
    resourceType: 'site',
    resourceId: SITES.corral.id,
  });
  assert.equal(given.statusCode, 201, given.body);
  const ops = await call('POST', '/api/gatekeeper/grants', {
    principalType: 'group',
    principalId: 'ops',
    resourceType: 'site',
    resourceId: SITES.corral.id,
  });
  assert.equal(ops.statusCode, 201, ops.body);

  view = await status('corral');
  assert.deepEqual(
    view.site.grants.map((g) => [g.principalType, g.principalId]),
    [
      ['group', 'ops'],
      ['user', 'ayse'],
    ],
  );
  assert.ok(view.site.grants.every((g) => typeof g.grantId === 'string' && g.createdAt));
  assert.deepEqual(view.site.membersWithoutGrant, []);

  const [created] = await lib.listAudit({
    plugin: 'corral',
    action: 'plugin.web-surface.grant.created',
  });
  assert.ok(created, 'audited');
  assert.equal(created.actor, 'admin');
  assert.deepEqual(
    { ...created.details, grantId: undefined },
    { siteId: SITES.corral.id, principalType: 'group', group: 'ops', grantId: undefined },
  );

  const revoked = await call(
    'DELETE',
    `/api/gatekeeper/grants/${encodeURIComponent(given.json().grant.grantId)}`,
  );
  assert.equal(revoked.statusCode, 200, revoked.body);
  view = await status('corral');
  assert.deepEqual(
    view.site.membersWithoutGrant.map((m) => m.username),
    ['ayse'],
  );
  const [removed] = await lib.listAudit({
    plugin: 'corral',
    action: 'plugin.web-surface.grant.revoked',
  });
  assert.deepEqual(removed.details, {
    siteId: SITES.corral.id,
    grantId: given.json().grant.grantId,
    principalType: 'user',
    userId: await userId('ayse'),
  });
});

test('a revoked grant on anything but a site is not audited as a site grant', async () => {
  const before = (await lib.listAudit({ action: 'plugin.web-surface.grant.revoked' })).length;
  const tunnelGrant = gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'ali',
    resourceType: 'tunnel',
    resourceId: 't-1',
    context: {},
  });
  const res = await call('DELETE', `/api/gatekeeper/grants/${tunnelGrant.grantId}`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(
    (await lib.listAudit({ action: 'plugin.web-surface.grant.revoked' })).length,
    before,
  );
});

test('revoking all of a principal’s grants audits each site grant among them', async () => {
  const before = (await lib.listAudit({ action: 'plugin.web-surface.grant.revoked' })).length;
  const site = gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'mehmet',
    resourceType: 'site',
    resourceId: SITES.corral.id,
  });
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'mehmet',
    resourceType: 'tunnel',
    resourceId: 't-2',
  });
  const res = await call('DELETE', '/api/gatekeeper/grants?principalType=user&principalId=mehmet');
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(
    gatekeeper.grants.some((g) => g.principalId === 'mehmet' && g.resourceType !== 'plugin'),
    false,
  );
  const audited = await lib.listAudit({ action: 'plugin.web-surface.grant.revoked' });
  assert.equal(audited.length, before + 1, 'the site grant only');
  assert.deepEqual(audited[0].details, {
    siteId: SITES.corral.id,
    grantId: site.grantId,
    principalType: 'user',
    userId: await userId('mehmet'),
  });
});

test('Gatekeeper unreadable: grants and the members without one are null, not empty', async () => {
  gatekeeper.state.unreachable = true;
  try {
    const view = await status('corral');
    assert.equal(view.site.grants, null);
    assert.equal(view.site.membersWithoutGrant, null);
  } finally {
    gatekeeper.state.unreachable = false;
  }
});
