/**
 * Gatekeeper vouches for the Authelia user of a plugin's user surface to
 * the panel: `/authz/user-surface/<fqdn>`, the auth_request target of the
 * `/api/<route>/app` locations of a tunnel vhost bound to the plugin. It
 * checks what `/authz/tunnel` checks of the vhost (the tunnel named in the
 * path, X-Original-URL and Host agreeing), that the tunnel is enabled and
 * bound, that the raw request target — never re-encoded — lies on the user
 * surface of a route bound there (no dot segments, no encoded separators),
 * the session, and on a restricted tunnel the user's grant; then signs a
 * relay assertion for the panel naming the username alone, bound to the
 * method and that target. 401 without a session (nginx then serves the
 * JSON of `/authz/user-surface-unauthenticated`), 403 for the rest, 503
 * without the relay key. A bound route is served only while the agent
 * carrying the tunnel hosts the plugin — carries its internal tunnel — and
 * refused otherwise (`not_hosting_agent`). A site a plugin owns (its web
 * surface, `owner` in sites.json) serves the plugin's user surface the same
 * way, its route served while the plugin is hosted at all; its grant on a
 * restricted site is a `site` grant. The shell of such a site —
 * `/authz/user-surface-shell/<fqdn>`, every other path of the site — needs
 * the session, membership of the plugin's audience (an entitlement with
 * roles, to the user or a group of theirs) and, on a restricted site, the
 * site's grant. Also: how Gatekeeper reads the hosts from tunnels.json and
 * sites.json. Runs against the build (`npm run build`).
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';

import { domainsIndex } from './domains-fixture.js';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import {
  NonceStore,
  RELAY_PANEL_AUDIENCE,
  RELAY_PANEL_PORT,
  createRelaySigner,
  parseRelayVerifyKey,
  relayVerifyKeyOf,
  verifyRelayAssertion,
  userSurfaceHosts,
} from '@lamalibre/lamaste';

let dir;
let app;
let key;
let signer;
let previousDispatcher;
let tunnelInfoFromState;
const sessions = new Map();
/** The panel's projection: every user here a member of example.com (a test narrows it). */
const ALL_MEMBERS = domainsIndex();
let domainsProjection = ALL_MEMBERS;
/** The X-Original-URL of every Authelia verification Gatekeeper made. */
const askedAuthelia = [];

/** The internal tunnel of a plugin hosted on `agentLabel` (what hosting it creates). */
function internal(route, agentLabel, port) {
  return {
    id: `internal-${route}`,
    subdomain: null,
    fqdn: null,
    port,
    type: 'plugin',
    exposure: 'internal',
    enabled: true,
    pluginName: `@lamalibre/${route}`,
    pluginRoute: route,
    ...(agentLabel ? { agentLabel } : {}),
  };
}

/** tunnels.json as the panel writes it; Gatekeeper reads it with `tunnelInfoFromState`. */
const STATE = [
  {
    id: 'piyasa-id',
    subdomain: 'piyasa',
    fqdn: 'piyasa.example.com',
    port: 20010,
    type: 'app',
    accessMode: 'authenticated',
    enabled: true,
    agentLabel: 'vm1',
    userSurface: { routes: ['market-indicators', 'fx'] },
  },
  {
    id: 'kamera-id',
    subdomain: 'kamera',
    fqdn: 'kamera.example.com',
    port: 20011,
    type: 'app',
    accessMode: 'restricted',
    enabled: true,
    agentLabel: 'vm1',
    userSurface: { routes: ['camwatch'] },
  },
  {
    id: 'off-id',
    subdomain: 'off',
    fqdn: 'off.example.com',
    port: 20012,
    type: 'app',
    accessMode: 'authenticated',
    enabled: false,
    agentLabel: 'vm1',
    userSurface: { routes: ['offline'] },
  },
  {
    id: 'plain-id',
    subdomain: 'plain',
    fqdn: 'plain.example.com',
    port: 20013,
    type: 'app',
    accessMode: 'authenticated',
    enabled: true,
    agentLabel: 'vm1',
  },
  // Inconsistent state the panel never writes: Gatekeeper refuses it anyway.
  {
    id: 'open-id',
    subdomain: 'open',
    fqdn: 'open.example.com',
    port: 20014,
    type: 'app',
    accessMode: 'public',
    enabled: true,
    agentLabel: 'vm1',
    userSurface: { routes: ['opened'] },
  },
  // Bound to plugins another agent hosts, or none: kept, never served.
  {
    id: 'moved-id',
    subdomain: 'moved',
    fqdn: 'moved.example.com',
    port: 20015,
    type: 'app',
    accessMode: 'authenticated',
    enabled: true,
    agentLabel: 'vm2',
    userSurface: { routes: ['fx', 'elsewhere', 'unhosted', 'revoked', 'twice'] },
  },
  {
    id: 'orphan-id',
    subdomain: 'orphan',
    fqdn: 'orphan.example.com',
    port: 20016,
    type: 'app',
    accessMode: 'authenticated',
    enabled: true,
    userSurface: { routes: ['orphaned'] },
  },
  internal('market-indicators', 'vm1', 21000),
  internal('fx', 'vm1', 21001),
  internal('camwatch', 'vm1', 21002),
  internal('offline', 'vm1', 21003),
  internal('opened', 'vm1', 21004),
  internal('elsewhere', 'vm3', 21005),
  internal('revoked', null, 21006),
  internal('orphaned', 'vm1', 21007),
  internal('twice', 'vm2', 21008),
  { ...internal('twice', 'vm2', 21009), id: 'internal-twice-again' },
  internal('web-fx', 'vm1', 21010),
  internal('web-locked', 'vm3', 21011),
  internal('web-both', 'vm1', 21012),
  {
    id: 'both-id',
    subdomain: 'both',
    fqdn: 'both.example.com',
    port: 20017,
    type: 'app',
    accessMode: 'authenticated',
    enabled: true,
    agentLabel: 'vm1',
    userSurface: { routes: ['web-both'] },
  },
];

/** sites.json as the panel writes it: plugin-owned sites (web surfaces) beside a plain one. */
const SITES = [
  {
    id: 'site-fx',
    name: 'webfx',
    fqdn: 'webfx.example.com',
    type: 'managed',
    owner: { plugin: 'web-fx' },
    accessMode: 'authenticated',
  },
  {
    id: 'site-locked',
    name: 'locked',
    fqdn: 'locked.example.com',
    type: 'managed',
    owner: { plugin: 'web-locked' },
    accessMode: 'restricted',
  },
  {
    id: 'site-unhosted',
    name: 'unhosted',
    fqdn: 'unhosted.example.com',
    type: 'managed',
    owner: { plugin: 'web-nowhere' },
    accessMode: 'authenticated',
  },
  // Served by a bound tunnel too (state the panel never writes): neither serves it.
  {
    id: 'site-both',
    name: 'webboth',
    fqdn: 'webboth.example.com',
    type: 'managed',
    owner: { plugin: 'web-both' },
    accessMode: 'authenticated',
  },
  { id: 'site-blog', name: 'blog', fqdn: 'blog.example.com', type: 'managed' },
];

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-gatekeeper-user-surface-'));
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = dir;
  const keyFile = path.join(dir, 'relay-signing-key.json');
  key = await createRelaySigner(keyFile, { create: true }).current();
  signer = createRelaySigner(keyFile, { create: false });

  // Authelia's verify endpoint: one user per session cookie, anything else refused.
  const mock = new MockAgent();
  mock.disableNetConnect();
  previousDispatcher = getGlobalDispatcher();
  setGlobalDispatcher(mock);
  const authelia = mock.get('http://127.0.0.1:9091');
  for (const [cookie, user] of [
    ['authelia_session=alice', 'alice'],
    ['authelia_session=bob', 'bob'],
    ['authelia_session=odd', 'not a username'],
    ['authelia_session=carol', 'carol'],
  ]) {
    authelia
      .intercept({ path: '/api/authz/auth-request', method: 'GET', headers: { cookie } })
      .reply((opts) => {
        askedAuthelia.push(opts.headers['X-Original-URL']);
        return {
          statusCode: 200,
          data: '',
          responseOptions: {
            headers: { 'remote-user': user, 'remote-groups': 'dev', 'remote-name': user },
          },
        };
      })
      .persist();
  }
  authelia
    .intercept({ path: '/api/authz/auth-request', method: 'GET' })
    .reply(() => {
      askedAuthelia.push('refused');
      return { statusCode: 401, data: '' };
    })
    .persist();

  // alice holds the grant of the restricted tunnel and of the restricted
  // site; bob does not.
  const { createGrant } = await import('../dist/lib/grants.js');
  const grant = (principalType, principalId, resourceType, resourceId, context) =>
    createGrant({ principalType, principalId, resourceType, resourceId, context });
  await grant('user', 'alice', 'tunnel', 'kamera-id');
  await grant('user', 'alice', 'site', 'site-locked');
  // The web surfaces' audiences: alice by name, bob through a group; carol
  // holds a grant without roles, which is no entitlement.
  const { createGroup, addMembers } = await import('../dist/lib/groups.js');
  await createGroup('analysts');
  await addMembers('analysts', ['bob']);
  await grant('user', 'alice', 'plugin', 'web-fx', { roles: ['viewer'] });
  await grant('group', 'analysts', 'plugin', 'web-fx', { roles: ['viewer'] });
  await grant('user', 'carol', 'plugin', 'web-fx', { target: 'local' });
  await grant('user', 'alice', 'plugin', 'web-locked', { roles: ['viewer'] });
  await grant('user', 'bob', 'plugin', 'web-locked', { roles: ['viewer'] });

  ({ tunnelInfoFromState } = await import('../dist/lib/tunnels.js'));
  const tunnels = tunnelInfoFromState(STATE);
  const hosts = userSurfaceHosts(STATE, SITES);
  const { authzRoutes } = await import('../dist/server/routes/authz.js');
  app = Fastify({ logger: false });
  app.decorate('getTunnels', () => tunnels);
  app.decorate('getUserSurfaceHosts', () => hosts);
  // The panel's projection: every user here a member of example.com.
  app.decorate('getDomains', () => domainsProjection);
  app.decorate('getSessionCache', () => sessions);
  app.decorate('getCacheVersion', () => 1);
  app.decorate('getSettings', () => ({}));
  app.decorate('getRelaySigner', () => signer);
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
  askedAuthelia.length = 0;
});

/** The subrequest a user-surface location sends, for `target` on `fqdn`. */
function check(
  target,
  {
    fqdn = 'piyasa.example.com',
    host = fqdn,
    url = `https://${fqdn}${target}`,
    method = 'GET',
    cookie = 'authelia_session=alice',
  } = {},
) {
  const headers = { host, 'x-original-url': url, 'x-original-method': method };
  if (cookie !== null) headers.cookie = cookie;
  return app.inject({ method: 'GET', url: `/authz/user-surface/${fqdn}`, headers });
}

/** Verify an answer's assertion as the panel does. */
function verifyAsPanel(header, { method, url, nonces = new NonceStore() }) {
  const keys = new Map([[key.kid, parseRelayVerifyKey(relayVerifyKeyOf(key)).publicKey]]);
  return verifyRelayAssertion(header, {
    keys,
    aud: RELAY_PANEL_AUDIENCE,
    port: RELAY_PANEL_PORT,
    method,
    url,
    nonces,
  });
}

test('a signed-in user gets a single-use assertion for the panel, bound to the method and the raw target', async () => {
  const target = '/api/market-indicators/app/notes?from=2026-10-01&q=a%20b';
  const res = await check(target, { method: 'POST' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  for (const name of ['remote-user', 'remote-groups', 'remote-name', 'remote-email']) {
    assert.equal(res.headers[name], undefined, `${name}: attributes come from the directory`);
  }
  assert.deepEqual(askedAuthelia, [`https://piyasa.example.com${target}`]);

  const header = res.headers['x-lamalibre-relay-assertion'];
  const nonces = new NonceStore();
  const verified = verifyAsPanel(header, { method: 'POST', url: target, nonces });
  assert.equal(verified.ok, true);
  assert.equal(verified.payload.aud, RELAY_PANEL_AUDIENCE);
  assert.equal(verified.payload.port, RELAY_PANEL_PORT);
  assert.deepEqual(verified.payload.caller, { type: 'user', username: 'alice' });
  assert.deepEqual(verified.payload.target, { route: 'market-indicators', path: target });
  assert.equal(verifyAsPanel(header, { method: 'POST', url: target, nonces }).reason, 'replayed');

  // Bound to this request: another path, method or route is refused.
  for (const [method, url] of [
    ['GET', target],
    ['POST', '/api/market-indicators/app/notes'],
    ['POST', '/api/fx/app/notes?from=2026-10-01&q=a%20b'],
  ]) {
    assert.equal(
      verifyAsPanel(header, { method, url }).reason,
      'wrong_request',
      `${method} ${url}`,
    );
  }

  // Fresh per request, and the bare surface counts.
  for (const bare of ['/api/fx/app', '/api/fx/app/', '/api/fx/app?x=1']) {
    const again = await check(bare);
    assert.equal(again.statusCode, 200, bare);
    assert.notEqual(again.headers['x-lamalibre-relay-assertion'], header);
    const payload = verifyAsPanel(again.headers['x-lamalibre-relay-assertion'], {
      method: 'GET',
      url: bare,
    }).payload;
    assert.deepEqual(payload.target, { route: 'fx', path: bare });
  }
});

test('the target is the raw request URI — never normalised, never decoded', async () => {
  const target = '/api/fx/app/a%20b/%C3%A7?x=%2F';
  const res = await check(target);
  assert.equal(res.statusCode, 200);
  const verified = verifyAsPanel(res.headers['x-lamalibre-relay-assertion'], {
    method: 'GET',
    url: target,
  });
  assert.equal(verified.payload.target.path, target);
});

test('the vhost’s tunnel, X-Original-URL and Host must agree — as for a tunnel', async () => {
  const target = '/api/fx/app/me';
  for (const [label, res] of [
    ['host names another tunnel', await check(target, { host: 'plain.example.com' })],
    ['no host', await check(target, { host: '' })],
    ['URL names another host', await check(target, { url: `https://plain.example.com${target}` })],
    ['URL not https', await check(target, { url: `http://piyasa.example.com${target}` })],
    ['URL not a URL', await check(target, { url: 'piyasa.example.com/api/fx/app/me' })],
    ['invalid tunnel name', await check(target, { fqdn: 'piyasa.example.com$x' })],
    ['unknown tunnel', await check(target, { fqdn: 'nowhere.example.com' })],
  ]) {
    assert.equal(res.statusCode, 403, label);
    assert.equal(res.headers['x-lamalibre-relay-assertion'], undefined, label);
  }
  // Without X-Original-Method there is no method to bind.
  const noMethod = await app.inject({
    method: 'GET',
    url: '/authz/user-surface/piyasa.example.com',
    headers: {
      host: 'piyasa.example.com',
      cookie: 'authelia_session=alice',
      'x-original-url': `https://piyasa.example.com${target}`,
    },
  });
  assert.equal(noMethod.statusCode, 403);
  assert.deepEqual(askedAuthelia, [], 'refused before Authelia was asked');
});

test('only an enabled tunnel, bound to the route, serves its user surface', async () => {
  for (const [label, target, fqdn] of [
    ['route bound to another host', '/api/camwatch/app/me', 'piyasa.example.com'],
    ['route bound nowhere', '/api/other/app/me', 'piyasa.example.com'],
    ['tunnel bound to nothing', '/api/fx/app/me', 'plain.example.com'],
    ['tunnel disabled', '/api/offline/app/me', 'off.example.com'],
    ['public tunnel', '/api/opened/app/me', 'open.example.com'],
  ]) {
    const res = await check(target, { fqdn });
    assert.equal(res.statusCode, 403, label);
    assert.equal(res.headers['x-lamalibre-relay-assertion'], undefined, label);
  }
  assert.deepEqual(askedAuthelia, []);
});

test('a bound route is served only while the tunnel’s agent hosts its plugin', async () => {
  for (const [label, target, fqdn] of [
    ['the tunnel moved to another agent', '/api/fx/app/me', 'moved.example.com'],
    ['the plugin hosted on a third agent', '/api/elsewhere/app/me', 'moved.example.com'],
    ['the plugin not hosted at all', '/api/unhosted/app/me', 'moved.example.com'],
    ['the hosting agent revoked', '/api/revoked/app/me', 'moved.example.com'],
    ['two internal tunnels for one route', '/api/twice/app/me', 'moved.example.com'],
    ['the tunnel carried by no agent', '/api/orphaned/app/me', 'orphan.example.com'],
  ]) {
    const res = await check(target, { fqdn });
    assert.equal(res.statusCode, 403, label);
    assert.equal(res.headers['x-lamalibre-relay-assertion'], undefined, label);
  }
  assert.deepEqual(askedAuthelia, [], 'refused before the session is looked at');
  // The same route on the host its hosting agent carries is served.
  assert.equal((await check('/api/fx/app/me')).statusCode, 200);
});

test('a target off the user surface, or that a server could read otherwise, is refused — not redirected', async () => {
  for (const target of [
    '/',
    '/api/fx',
    '/api/fx/admin/settings',
    '/api/fx/apps',
    '/api/fx/App/me',
    '/api/fx/%61pp/me',
    '/api//fx/app/me',
    '/api/fx/app/../admin',
    '/api/fx/app/./me',
    '/api/fx/app/%2e%2e/admin',
    '/api/fx/app/%2E%2E/admin',
    '/api/fx/app/a%2Fb',
    '/api/fx/app/a%2fb',
    '/api/fx/app/a%5Cb',
    '/api/fx/app/a\\b',
    '/api/fx/app/%E0%A4%A',
    '?/api/fx/app',
    // An encoded `%`: a router decoding twice would read `..` or `/`.
    '/api/fx/app/%252e%252e/admin/x',
    '/api/fx/app/a%252Fb',
    '/api/fx/app/%25',
  ]) {
    const res = await check(target);
    assert.equal(res.statusCode, 403, target);
    assert.equal(res.headers['location'], undefined, target);
    assert.equal(res.headers['x-lamalibre-relay-assertion'], undefined, target);
  }
  // Refused before the session is looked at.
  assert.deepEqual(askedAuthelia, []);
});

test('no session: 401, which nginx answers with the JSON of the unauthenticated endpoint', async () => {
  for (const cookie of [null, 'csrf=1', 'authelia_session=expired']) {
    const res = await check('/api/fx/app/me', { cookie });
    assert.equal(res.statusCode, 401, String(cookie));
    assert.equal(res.headers['x-lamalibre-relay-assertion'], undefined);
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  const body = await app.inject({ method: 'GET', url: '/authz/user-surface-unauthenticated' });
  assert.equal(body.statusCode, 401);
  assert.match(body.headers['content-type'], /^application\/json/);
  assert.equal(body.headers['cache-control'], 'no-store');
  assert.deepEqual(body.json(), { error: 'unauthenticated' });
  assert.equal(body.headers['location'], undefined);
});

test('a restricted tunnel needs the user’s grant', async () => {
  const target = '/api/camwatch/app/notes';
  const granted = await check(target, { fqdn: 'kamera.example.com', method: 'PUT' });
  assert.equal(granted.statusCode, 200);
  assert.deepEqual(
    verifyAsPanel(granted.headers['x-lamalibre-relay-assertion'], { method: 'PUT', url: target })
      .payload.caller,
    { type: 'user', username: 'alice' },
  );

  const refused = await check(target, {
    fqdn: 'kamera.example.com',
    cookie: 'authelia_session=bob',
  });
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.headers['x-lamalibre-relay-assertion'], undefined);
  // Not the access-request page: the caller is an application's request —
  // the refusal is named for nginx to answer with as JSON.
  assert.equal(refused.body, '');
  assert.equal(refused.headers['x-lamalibre-refusal'], 'forbidden');
});

test('a user an assertion cannot carry is refused; without the relay key, 503', async () => {
  const odd = await check('/api/fx/app/me', { cookie: 'authelia_session=odd' });
  assert.equal(odd.statusCode, 403);
  assert.equal(odd.headers['x-lamalibre-relay-assertion'], undefined);

  const kept = signer;
  signer = createRelaySigner(path.join(dir, 'missing.json'), { create: false });
  try {
    const res = await check('/api/fx/app/me');
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers['x-lamalibre-relay-assertion'], undefined);
  } finally {
    signer = kept;
  }
});

test('a site a plugin owns serves its user surface; a restricted one needs the site grant', async () => {
  const target = '/api/web-fx/app/me';
  const res = await check(target, { fqdn: 'webfx.example.com' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    verifyAsPanel(res.headers['x-lamalibre-relay-assertion'], { method: 'GET', url: target })
      .payload.target,
    { route: 'web-fx', path: target },
  );
  // The panel decides membership on the API: Gatekeeper only vouches for the session.
  assert.equal(
    (await check(target, { fqdn: 'webfx.example.com', cookie: 'authelia_session=carol' }))
      .statusCode,
    200,
  );

  const locked = '/api/web-locked/app/me';
  assert.equal((await check(locked, { fqdn: 'locked.example.com' })).statusCode, 200);
  assert.equal(
    (await check(locked, { fqdn: 'locked.example.com', cookie: 'authelia_session=bob' }))
      .statusCode,
    403,
  );

  for (const [label, t, fqdn] of [
    ['another plugin on the site', '/api/fx/app/me', 'webfx.example.com'],
    ['the site’s plugin not hosted', '/api/web-nowhere/app/me', 'unhosted.example.com'],
    ['a route a tunnel serves too', '/api/web-both/app/me', 'webboth.example.com'],
    ['… on the tunnel as well', '/api/web-both/app/me', 'both.example.com'],
    ['a plain site', '/api/web-fx/app/me', 'blog.example.com'],
  ]) {
    const refused = await check(t, { fqdn });
    assert.equal(refused.statusCode, 403, label);
    assert.equal(refused.headers['x-lamalibre-relay-assertion'], undefined, label);
  }
});

/** The subrequest a plugin-owned site's shell locations send, for `target` on `fqdn`. */
function shell(
  target,
  { fqdn = 'webfx.example.com', host = fqdn, cookie = 'authelia_session=alice' } = {},
) {
  const headers = {
    host,
    'x-original-url': `https://${fqdn}${target}`,
    'x-original-method': 'GET',
  };
  if (cookie !== null) headers.cookie = cookie;
  return app.inject({ method: 'GET', url: `/authz/user-surface-shell/${fqdn}`, headers });
}

test('the shell of a web surface: a session in the plugin’s audience, never more than it needs', async () => {
  for (const cookie of ['authelia_session=alice', 'authelia_session=bob']) {
    const res = await shell('/dashboard?tab=1', { cookie });
    assert.equal(res.statusCode, 200, cookie);
    assert.equal(res.headers['cache-control'], 'no-store');
    for (const name of ['remote-user', 'remote-groups', 'x-lamalibre-relay-assertion']) {
      assert.equal(res.headers[name], undefined, `${cookie}: ${name}`);
    }
  }
  assert.ok(askedAuthelia.includes('https://webfx.example.com/dashboard?tab=1'));

  // A grant without roles is no entitlement: the access-request page.
  const carol = await shell('/', { cookie: 'authelia_session=carol' });
  assert.equal(carol.statusCode, 403);
  assert.match(carol.headers['content-type'], /^text\/html/);
  assert.match(carol.body, /carol/);

  // No session: 401 (nginx sends a page to the login).
  for (const cookie of [
    null,
    'authelia_session=expired',
    'authelia_session=alice; authelia_session=bob',
  ]) {
    assert.equal((await shell('/', { cookie })).statusCode, 401, String(cookie));
  }

  // A restricted site needs its grant beside the entitlement.
  assert.equal((await shell('/', { fqdn: 'locked.example.com' })).statusCode, 200);
  const bob = await shell('/', { fqdn: 'locked.example.com', cookie: 'authelia_session=bob' });
  assert.equal(bob.statusCode, 403);
  assert.match(bob.body, /bob/);
});

test('the shell answers only for a plugin-owned site it serves, named the way the vhost names it', async () => {
  askedAuthelia.length = 0;
  for (const [label, res] of [
    ['a tunnel', await shell('/', { fqdn: 'piyasa.example.com' })],
    ['a plain site', await shell('/', { fqdn: 'blog.example.com' })],
    ['an unknown host', await shell('/', { fqdn: 'nowhere.example.com' })],
    ['the plugin not hosted', await shell('/', { fqdn: 'unhosted.example.com' })],
    ['served by two hosts', await shell('/', { fqdn: 'webboth.example.com' })],
    ['Host names another site', await shell('/', { host: 'locked.example.com' })],
    ['invalid name', await shell('/', { fqdn: 'webfx.example.com$x' })],
  ]) {
    assert.equal(res.statusCode, 403, label);
    assert.equal(res.body, '', label);
  }
  assert.deepEqual(askedAuthelia, [], 'refused before Authelia was asked');
});

test('state: tunnels from tunnels.json; user-surface hosts from it and sites.json', () => {
  const tunnels = tunnelInfoFromState([...STATE, 'not a tunnel']);
  const byId = new Map(tunnels.map((t) => [t.id, t]));
  assert.equal(byId.get('piyasa-id').userSurface, undefined, 'bindings are the hosts’ business');
  assert.equal(byId.has('internal-fx'), false, 'internal tunnels have no host to authorize');
  assert.deepEqual(tunnelInfoFromState({ not: 'a list' }), []);

  const hosts = userSurfaceHosts(
    [
      ...STATE,
      {
        id: 'mixed-id',
        fqdn: 'mixed.example.com',
        type: 'app',
        enabled: true,
        userSurface: { routes: ['ok', 'Bad', 'tunnels', '../x', 7, 'ok', 'a'.repeat(65)] },
      },
      // Tunnels persisted before `type` existed are app tunnels.
      { id: 'legacy-id', fqdn: 'legacy.example.com', userSurface: { routes: ['legacy'] } },
      {
        id: 'plugin-id',
        fqdn: 'herd.example.com',
        type: 'plugin',
        agentLabel: 'vm1',
        port: 9393,
        pluginRoute: 'herd',
        userSurface: { routes: ['herd'] },
      },
      {
        id: 'weird-id',
        fqdn: 'weird.example.com',
        accessMode: 'everyone',
        userSurface: { routes: ['w'] },
      },
      { id: 'junk-id', fqdn: 'junk.example.com', userSurface: { routes: 'fx' } },
    ],
    [...SITES, { id: 'bad-owner', fqdn: 'bad.example.com', owner: { plugin: '../x' } }],
  );
  const byHost = new Map(hosts.map((h) => [h.id, h]));
  assert.deepEqual(
    [byHost.get('piyasa-id').routes, byHost.get('piyasa-id').served],
    [
      ['market-indicators', 'fx'],
      ['market-indicators', 'fx'],
    ],
  );
  // A binding on a tunnel whose agent does not host the plugin claims nothing.
  assert.deepEqual(byHost.get('moved-id').served, []);
  assert.deepEqual(byHost.get('mixed-id').routes, ['ok']);
  assert.deepEqual(byHost.get('legacy-id').served, []);
  assert.equal(byHost.has('plugin-id'), false, 'a plugin tunnel is no app tunnel');
  assert.equal(byHost.has('open-id'), false, 'a public host serves no user surface');
  assert.equal(byHost.get('weird-id').accessMode, 'restricted');
  assert.equal(byHost.has('junk-id'), false);
  assert.deepEqual(
    [byHost.get('site-fx').kind, byHost.get('site-fx').routes, byHost.get('site-fx').served],
    ['site', ['web-fx'], ['web-fx']],
  );
  assert.deepEqual(byHost.get('site-unhosted').served, []);
  assert.deepEqual(byHost.get('site-both').served, []);
  assert.deepEqual(byHost.get('both-id').served, []);
  assert.equal(byHost.has('site-blog'), false);
  assert.equal(byHost.has('bad-owner'), false);
});

test('a user who is not a member of the host’s domain is refused with JSON, never a page', async () => {
  domainsProjection = domainsIndex([{ name: 'example.com', members: ['bob', 'carol'] }]);
  try {
    const res = await check('/api/market-indicators/app/notes');
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers['x-lamalibre-refusal'], 'not_a_member');
    assert.equal(res.headers['x-lamalibre-relay-assertion'], undefined);
  } finally {
    domainsProjection = ALL_MEMBERS;
  }
});

test('a refusal is named in X-Lamalibre-Refusal for nginx; an allowed request and a 401 carry none', async () => {
  const off = await check('/api/market-indicators/admin/x');
  assert.equal(off.statusCode, 403);
  assert.equal(off.headers['x-lamalibre-refusal'], 'forbidden');

  const anonymous = await check('/api/market-indicators/app/notes', { cookie: null });
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.headers['x-lamalibre-refusal'], undefined);

  const allowed = await check('/api/market-indicators/app/notes');
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers['x-lamalibre-refusal'], undefined);
});
