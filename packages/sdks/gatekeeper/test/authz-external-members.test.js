/**
 * External members of a domain (packages/core/docs/external-members-design.md):
 * the panel's projection (`domains.json` v2) names each domain's members
 * and external members, and Gatekeeper checks the kind on every route after
 * Authelia admitted the session. An external member reaches only what
 * names them: a `restricted` tunnel, user surface or web-surface shell with
 * a grant (to them or a Lamaste group of theirs) — never an `authenticated`
 * one (the access-request page; a user surface answers 403). A member is
 * unchanged. The groups Lamaste owns (`lamaste:…`, host groups) never reach
 * a backend: they are stripped from `Remote-Groups` and from a plugin
 * tunnel's relay assertion. Runs against the build (`npm run build`).
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';

import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import {
  NonceStore,
  createRelaySigner,
  parseRelayVerifyKey,
  relayVerifyKeyOf,
  userSurfaceHosts,
  verifyRelayAssertion,
} from '@lamalibre/lamaste';
import { domainsIndex } from './domains-fixture.js';

let dir;
let app;
let key;
let previousDispatcher;
const sessions = new Map();
/** What Authelia was asked about `xr` and `stranger`: [user, X-Original-URL]. */
const askedFor = [];

const TUNNELS = [
  { id: 'wiki', fqdn: 'wiki.example.com', accessMode: 'authenticated', enabled: true },
  { id: 'corral', fqdn: 'corral.example.com', accessMode: 'restricted', enabled: true },
  { id: 'vault', fqdn: 'vault.example.com', accessMode: 'restricted', enabled: true },
  {
    id: 'herd',
    fqdn: 'herd.example.com',
    accessMode: 'restricted',
    enabled: true,
    plugin: { agentLabel: 'r730', port: 9393, route: 'herd' },
  },
];

/** tunnels.json and sites.json for the user surfaces: one bound tunnel per mode, and two web surfaces. */
const STATE = [
  {
    id: 'open-surface',
    subdomain: 'open',
    fqdn: 'open.example.com',
    port: 20010,
    type: 'app',
    accessMode: 'authenticated',
    enabled: true,
    agentLabel: 'vm1',
    userSurface: { routes: ['opened'] },
  },
  {
    id: 'shut-surface',
    subdomain: 'shut',
    fqdn: 'shut.example.com',
    port: 20011,
    type: 'app',
    accessMode: 'restricted',
    enabled: true,
    agentLabel: 'vm1',
    userSurface: { routes: ['shut'] },
  },
  ...['opened', 'shut', 'web-open', 'web-shut'].map((route, i) => ({
    id: `internal-${route}`,
    subdomain: null,
    fqdn: null,
    port: 21000 + i,
    type: 'plugin',
    exposure: 'internal',
    enabled: true,
    pluginName: `@lamalibre/${route}`,
    pluginRoute: route,
    agentLabel: 'vm1',
  })),
];
const SITES = [
  {
    id: 'site-open',
    name: 'webopen',
    fqdn: 'webopen.example.com',
    type: 'managed',
    owner: { plugin: 'web-open' },
    accessMode: 'authenticated',
  },
  {
    id: 'site-shut',
    name: 'webshut',
    fqdn: 'webshut.example.com',
    type: 'managed',
    owner: { plugin: 'web-shut' },
    accessMode: 'restricted',
  },
];

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-gatekeeper-external-'));
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = dir;
  const keyFile = path.join(dir, 'relay-signing-key.json');
  key = await createRelaySigner(keyFile, { create: true }).current();
  const signer = createRelaySigner(keyFile, { create: false });

  // Authelia admits both (its own rules are not what is tested here) and
  // names their groups — Lamaste's own among them.
  const mock = new MockAgent();
  mock.disableNetConnect();
  previousDispatcher = getGlobalDispatcher();
  setGlobalDispatcher(mock);
  const authelia = mock.get('http://127.0.0.1:9091');
  for (const [user, groups] of [
    ['ext', 'lamaste:x:0123456789abcdef,corral.example.com,herd.example.com'],
    ['mem', 'admins,lamaste:m:0123456789abcdef,staff,lamaste:s:site-docs,LAMASTE:oidc@x'],
  ]) {
    authelia
      .intercept({
        path: '/api/authz/auth-request',
        method: 'GET',
        headers: { cookie: `authelia_session=${user}` },
      })
      .reply(200, '', { headers: { 'remote-user': user, 'remote-groups': groups } })
      .persist();
  }
  // Authelia refuses `xr` (an external member without a host group) on
  // every host but the domain's portal, where it admits them — what
  // Gatekeeper asks to learn who a refusal was for. `stranger` (a member of
  // no domain) is refused on the portal too.
  for (const user of ['xr', 'stranger']) {
    authelia
      .intercept({
        path: '/api/authz/auth-request',
        method: 'GET',
        headers: { cookie: `authelia_session=${user}` },
      })
      .reply((opts) => {
        const url = opts.headers['X-Original-URL'];
        askedFor.push([user, url]);
        if (user === 'xr' && url === 'https://auth.example.com/') {
          return {
            statusCode: 200,
            data: '',
            responseOptions: { headers: { 'remote-user': user, 'remote-groups': '' } },
          };
        }
        return { statusCode: 403, data: '' };
      })
      .persist();
  }

  // ext holds the corral tunnel by name and the herd tunnel through a
  // Lamaste group; the restricted user surface and web surface by name, and
  // a role on both web surfaces (their audiences). mem holds what members
  // need on restricted hosts.
  const { createGrant } = await import('../dist/lib/grants.js');
  const { createGroup, addMembers } = await import('../dist/lib/groups.js');
  const grant = (principalType, principalId, resourceType, resourceId, context) =>
    createGrant({ principalType, principalId, resourceType, resourceId, context });
  await createGroup('clients');
  await addMembers('clients', ['ext']);
  await grant('user', 'ext', 'tunnel', 'corral');
  await grant('group', 'clients', 'tunnel', 'herd');
  await grant('user', 'ext', 'tunnel', 'shut-surface');
  await grant('user', 'ext', 'site', 'site-shut');
  // Granted an authenticated host too: the access mode still decides.
  await grant('user', 'ext', 'tunnel', 'wiki');
  await grant('user', 'ext', 'site', 'site-open');
  for (const route of ['web-open', 'web-shut']) {
    await grant('user', 'ext', 'plugin', route, { roles: ['client'] });
    await grant('user', 'mem', 'plugin', route, { roles: ['client'] });
  }
  await grant('user', 'mem', 'tunnel', 'corral');
  await grant('user', 'mem', 'site', 'site-shut');

  const hosts = userSurfaceHosts(STATE, SITES);
  const { authzRoutes } = await import('../dist/server/routes/authz.js');
  app = Fastify({ logger: false });
  app.decorate('getTunnels', () => TUNNELS);
  app.decorate('getUserSurfaceHosts', () => hosts);
  app.decorate('getDomains', () =>
    domainsIndex([{ name: 'example.com', members: ['mem'], externals: ['ext', 'xr'] }]),
  );
  app.decorate('getSessionCache', () => sessions);
  app.decorate('getCacheVersion', () => 1);
  app.decorate('getSettings', () => ({ adminName: 'Ops', adminEmail: 'ops@example.com' }));
  app.decorate('getRelaySigner', () => signer);
  app.decorate('readDomainBrand', async () => null);
  await app.register(authzRoutes);
  await app.ready();
});

after(async () => {
  await app?.close();
  setGlobalDispatcher(previousDispatcher);
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  sessions.clear();
  askedFor.length = 0;
});

const headers = (fqdn, user, url = `https://${fqdn}/`) => ({
  host: fqdn,
  cookie: `authelia_session=${user}`,
  'x-original-url': url,
  'x-original-method': 'GET',
});
const tunnel = (fqdn, user) =>
  app.inject({ method: 'GET', url: `/authz/tunnel/${fqdn}`, headers: headers(fqdn, user) });
const surface = (fqdn, route, user) =>
  app.inject({
    method: 'GET',
    url: `/authz/user-surface/${fqdn}`,
    headers: headers(fqdn, user, `https://${fqdn}/api/${route}/app/items`),
  });
const shell = (fqdn, user) =>
  app.inject({
    method: 'GET',
    url: `/authz/user-surface-shell/${fqdn}`,
    headers: headers(fqdn, user),
  });

test('tunnels: an external member reaches a restricted tunnel granted to them, never an authenticated one', async () => {
  const refused = await tunnel('wiki.example.com', 'ext');
  assert.equal(refused.statusCode, 403, 'granted, but the tunnel names every member');
  assert.match(refused.headers['content-type'], /text\/html/);
  assert.equal(refused.headers['cache-control'], 'no-store');
  assert.match(refused.body, /ops@example\.com/, 'the access-request page');

  assert.equal((await tunnel('corral.example.com', 'ext')).statusCode, 200, 'their grant');
  assert.equal((await tunnel('herd.example.com', 'ext')).statusCode, 200, 'their group’s grant');
  assert.equal((await tunnel('vault.example.com', 'ext')).statusCode, 403, 'no grant');

  // A member is unchanged: every authenticated tunnel, restricted ones by grant.
  assert.equal((await tunnel('wiki.example.com', 'mem')).statusCode, 200);
  assert.equal((await tunnel('corral.example.com', 'mem')).statusCode, 200);
  assert.equal((await tunnel('vault.example.com', 'mem')).statusCode, 403);
});

test('user surfaces and web-surface shells: an external member only on restricted ones that grant them', async () => {
  const open = await surface('open.example.com', 'opened', 'ext');
  assert.equal(open.statusCode, 403);
  assert.equal(open.headers['x-lamalibre-refusal'], 'forbidden');
  assert.equal((await surface('shut.example.com', 'shut', 'ext')).statusCode, 200);
  assert.equal((await surface('open.example.com', 'opened', 'mem')).statusCode, 200);

  const openShell = await shell('webopen.example.com', 'ext');
  assert.equal(openShell.statusCode, 403, 'in the audience and granted, but not restricted');
  assert.match(openShell.body, /ops@example\.com/, 'the access-request page');
  assert.equal((await shell('webshut.example.com', 'ext')).statusCode, 200);
  assert.equal((await shell('webopen.example.com', 'mem')).statusCode, 200);
  assert.equal((await shell('webshut.example.com', 'mem')).statusCode, 200);
});

test('the groups Lamaste owns never reach a backend: Remote-Groups and the relay assertion leave them out', async () => {
  const app_ = await tunnel('wiki.example.com', 'mem');
  assert.equal(app_.statusCode, 200);
  assert.equal(app_.headers['remote-groups'], 'admins,staff');

  const plugin = await tunnel('herd.example.com', 'ext');
  assert.equal(plugin.headers['remote-groups'], '');
  const keys = new Map([[key.kid, parseRelayVerifyKey(relayVerifyKeyOf(key)).publicKey]]);
  const verified = verifyRelayAssertion(plugin.headers['x-lamalibre-relay-assertion'], {
    keys,
    aud: 'r730',
    port: 9393,
    method: 'GET',
    url: '/herd/',
    nonces: new NonceStore(),
  });
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.payload.caller.groups, []);
});

test('an external member Authelia refused gets the access-request page, not the domain refusal — asked for the portal, never cached', async () => {
  const refused = await tunnel('wiki.example.com', 'xr');
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.headers['cache-control'], 'no-store');
  assert.match(refused.body, /ops@example\.com/);
  assert.doesNotMatch(refused.body, /Not a member of/, 'they are on the domain');
  assert.deepEqual(askedFor, [
    ['xr', 'https://wiki.example.com/'],
    ['xr', 'https://auth.example.com/'],
  ]);
  // Never admitted on the strength of the probe, whatever Gatekeeper's grants say.
  assert.equal((await tunnel('corral.example.com', 'xr')).statusCode, 403);

  const surfaced = await surface('shut.example.com', 'shut', 'xr');
  assert.equal(surfaced.statusCode, 403);
  assert.equal(surfaced.headers['x-lamalibre-refusal'], 'forbidden');
  const shellRefused = await shell('webshut.example.com', 'xr');
  assert.equal(shellRefused.statusCode, 403);
  assert.doesNotMatch(shellRefused.body, /Not a member of/);

  // Someone the portal refuses too is no member: the domain refusal, as before.
  const stranger = await tunnel('wiki.example.com', 'stranger');
  assert.equal(stranger.statusCode, 403);
  assert.match(stranger.body, /Not a member of/);
  const strangerSurface = await surface('shut.example.com', 'shut', 'stranger');
  assert.equal(strangerSurface.headers['x-lamalibre-refusal'], 'not_a_member');
});
