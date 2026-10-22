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
 * without the relay key. Also: how Gatekeeper reads the bindings from
 * tunnels.json. Runs against the build (`npm run build`).
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
  RELAY_PANEL_AUDIENCE,
  RELAY_PANEL_PORT,
  createRelaySigner,
  parseRelayVerifyKey,
  relayVerifyKeyOf,
  verifyRelayAssertion,
} from '@lamalibre/lamaste';

let dir;
let app;
let key;
let signer;
let previousDispatcher;
let tunnelInfoFromState;
const sessions = new Map();
/** The X-Original-URL of every Authelia verification Gatekeeper made. */
const askedAuthelia = [];

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

  // alice holds the grant of the restricted tunnel; bob does not.
  const { createGrant } = await import('../dist/lib/grants.js');
  await createGrant({
    principalType: 'user',
    principalId: 'alice',
    resourceType: 'tunnel',
    resourceId: 'kamera-id',
  });

  ({ tunnelInfoFromState } = await import('../dist/lib/tunnels.js'));
  const tunnels = tunnelInfoFromState(STATE);
  const { authzRoutes } = await import('../dist/server/routes/authz.js');
  app = Fastify({ logger: false });
  app.decorate('getTunnels', () => tunnels);
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
  // Not the access-request page: the caller is an application's request.
  assert.equal(refused.body, '');
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

test('tunnels.json: bindings are read from app tunnels only, valid routes only', () => {
  const tunnels = tunnelInfoFromState([
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
    { id: 'internal-id', fqdn: null, exposure: 'internal', userSurface: { routes: ['fx'] } },
    { id: 'weird-id', fqdn: 'weird.example.com', accessMode: 'everyone' },
    { id: 'junk-id', fqdn: 'junk.example.com', userSurface: { routes: 'fx' } },
    'not a tunnel',
  ]);
  const byId = new Map(tunnels.map((t) => [t.id, t]));
  assert.deepEqual(byId.get('piyasa-id').userSurface, { routes: ['market-indicators', 'fx'] });
  assert.equal(byId.get('plain-id').userSurface, undefined);
  assert.deepEqual(byId.get('mixed-id').userSurface, { routes: ['ok'] });
  assert.deepEqual(byId.get('legacy-id').userSurface, { routes: ['legacy'] });
  assert.equal(byId.get('plugin-id').userSurface, undefined);
  assert.deepEqual(byId.get('plugin-id').plugin, { agentLabel: 'vm1', port: 9393, route: 'herd' });
  assert.equal(byId.has('internal-id'), false);
  assert.equal(byId.get('weird-id').accessMode, 'restricted');
  assert.equal(byId.get('junk-id').userSurface, undefined);
  assert.equal(tunnels.length, STATE.length + 5);
  assert.deepEqual(tunnelInfoFromState({ not: 'a list' }), []);
});
