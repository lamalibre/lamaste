/**
 * A native app's bearer access token on a plugin's user surface
 * (native-apps-design.md D3, R6, R11): `/authz/user-surface/<fqdn>` takes
 * `Authorization: Bearer <JWS>` instead of the session — a cookie beside it
 * is ignored — verified against the issuer's key set (Authelia's
 * `/jwks.json`, fetched again on an unknown key or a bad signature, at most
 * every 30 s), issued by the portal of the host's domain to the host's
 * native client (the panel's projection) for the host's audience. Then the
 * session path's checks: domain membership, externals, the restricted
 * host's grant, the route served. The assertion for the panel carries the
 * credential `{ kind: 'bearer', clientId, tokenSha256, exp }`. A refused
 * token: 401 with `X-Lamalibre-Refusal: invalid_token`; no key set ever
 * read: 503. Runs against the build (`npm run build`).
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
  nativeTokenSha256,
  parseRelayVerifyKey,
  relayVerifyKeyOf,
  userSurfaceHosts,
  verifyRelayAssertion,
} from '@lamalibre/lamaste';

import { domainsIndex } from './domains-fixture.js';

const CLIENT = 'lamaste-native-app';
const HOST = 'app.example.com';
const RESTRICTED = 'locked.example.com';

let dir;
let key;
let signer;
let previousDispatcher;
let issuer = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
let jwksAnswers = 0;
let jwksUp = true;
let nativeClients;
let createIssuerKeyCache;
let domains = domainsIndex();

const STATE = [
  {
    id: 'app-id',
    subdomain: 'app',
    fqdn: HOST,
    port: 20010,
    type: 'app',
    accessMode: 'authenticated',
    enabled: true,
    agentLabel: 'vm1',
    userSurface: { routes: ['notes'] },
  },
  {
    id: 'locked-id',
    subdomain: 'locked',
    fqdn: RESTRICTED,
    port: 20011,
    type: 'app',
    accessMode: 'restricted',
    enabled: true,
    agentLabel: 'vm1',
    userSurface: { routes: ['vault'] },
  },
  {
    id: 'internal-notes',
    fqdn: null,
    port: 21000,
    type: 'plugin',
    exposure: 'internal',
    enabled: true,
    pluginRoute: 'notes',
    agentLabel: 'vm1',
  },
  {
    id: 'internal-vault',
    fqdn: null,
    port: 21001,
    type: 'plugin',
    exposure: 'internal',
    enabled: true,
    pluginRoute: 'vault',
    agentLabel: 'vm1',
  },
  {
    id: 'internal-own',
    fqdn: null,
    port: 21002,
    type: 'plugin',
    exposure: 'internal',
    enabled: true,
    pluginRoute: 'own',
    agentLabel: 'vm1',
  },
  {
    id: 'internal-other',
    fqdn: null,
    port: 21003,
    type: 'plugin',
    exposure: 'internal',
    enabled: true,
    pluginRoute: 'other',
    agentLabel: 'vm2',
  },
];

/** A plugin-owned site with a route joined to it (D1). */
const SITES = [
  {
    id: 'site-own',
    name: 'shell',
    fqdn: 'shell.example.com',
    owner: { plugin: 'own' },
    accessMode: 'authenticated',
    userSurface: { routes: ['other'] },
  },
];

function jwk(publicKey, kid = 'lamaste-oidc') {
  return { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' };
}

/** An access token as Authelia issues it for the native client. */
function token(claims = {}, { privateKey = issuer.privateKey, header = {} } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = { alg: 'RS256', kid: 'lamaste-oidc', typ: 'at+jwt', ...header };
  const c = {
    iss: 'https://auth.example.com',
    aud: [`https://${HOST}`],
    client_id: CLIENT,
    exp: now + 900,
    iat: now,
    nbf: now,
    jti: crypto.randomUUID(),
    preferred_username: 'alice',
    scp: ['openid', 'offline_access', 'profile'],
    sub: crypto.randomUUID(),
    ...claims,
  };
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signed = `${enc(h)}.${enc(c)}`;
  const sig = crypto.sign('sha256', Buffer.from(signed), privateKey).toString('base64url');
  return `${signed}.${sig}`;
}

let app;
async function makeApp() {
  const { authzRoutes } = await import('../dist/server/routes/authz.js');
  const { tunnelInfoFromState } = await import('../dist/lib/tunnels.js');
  const a = Fastify({ logger: false });
  let t = 0;
  const keyCache = createIssuerKeyCache({ now: () => (t += 31_000) });
  a.decorate('getTunnels', () => tunnelInfoFromState(STATE));
  a.decorate('getUserSurfaceHosts', () => userSurfaceHosts(STATE, SITES));
  a.decorate('getDomains', () => domains);
  a.decorate('getNativeClients', () => nativeClients);
  a.decorate('getIssuerKeys', () => keyCache);
  a.decorate('getSessionCache', () => new Map());
  a.decorate('getCacheVersion', () => 1);
  a.decorate('getSettings', () => ({}));
  a.decorate('getRelaySigner', () => signer);
  a.decorate('readDomainBrand', async () => null);
  await a.register(authzRoutes);
  await a.ready();
  return a;
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-gatekeeper-native-'));
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = dir;
  const keyFile = path.join(dir, 'relay-signing-key.json');
  key = await createRelaySigner(keyFile, { create: true }).current();
  signer = createRelaySigner(keyFile, { create: false });
  ({ createIssuerKeyCache } = await import('../dist/lib/issuer-keys.js'));

  const mock = new MockAgent();
  mock.disableNetConnect();
  previousDispatcher = getGlobalDispatcher();
  setGlobalDispatcher(mock);
  const authelia = mock.get('http://127.0.0.1:9091');
  authelia
    .intercept({ path: '/jwks.json', method: 'GET' })
    .reply((opts) => {
      jwksAnswers += 1;
      assert.equal(opts.headers['X-Forwarded-Proto'], 'https');
      assert.match(opts.headers['X-Forwarded-Host'], /^auth\./);
      if (!jwksUp) return { statusCode: 502, data: '' };
      return { statusCode: 200, data: JSON.stringify({ keys: [jwk(issuer.publicKey)] }) };
    })
    .persist();
  // A session: alice. Only used to prove a cookie beside a bearer is ignored.
  authelia
    .intercept({ path: '/api/authz/auth-request', method: 'GET' })
    .reply(() => ({
      statusCode: 200,
      data: '',
      responseOptions: { headers: { 'remote-user': 'bob' } },
    }))
    .persist();

  const { createGrant } = await import('../dist/lib/grants.js');
  await createGrant({
    principalType: 'user',
    principalId: 'alice',
    resourceType: 'tunnel',
    resourceId: 'locked-id',
  });
  // bob (the session the Authelia stand-in answers) holds a role on the
  // joined plugin only.
  await createGrant({
    principalType: 'user',
    principalId: 'bob',
    resourceType: 'plugin',
    resourceId: 'other',
    context: { roles: ['viewer'] },
  });
});

after(async () => {
  await app?.close();
  setGlobalDispatcher(previousDispatcher);
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await app?.close();
  jwksUp = true;
  jwksAnswers = 0;
  domains = domainsIndex();
  nativeClients = [
    { clientId: CLIENT, fqdn: HOST, domain: 'example.com' },
    { clientId: 'lamaste-native-locked', fqdn: RESTRICTED, domain: 'example.com' },
  ];
  app = await makeApp();
});

function check(target, { fqdn = HOST, method = 'GET', authorization, cookie } = {}) {
  const headers = {
    host: fqdn,
    'x-original-url': `https://${fqdn}${target}`,
    'x-original-method': method,
  };
  if (authorization !== undefined) headers.authorization = authorization;
  if (cookie !== undefined) headers.cookie = cookie;
  return app.inject({ method: 'GET', url: `/authz/user-surface/${fqdn}`, headers });
}

function verifyAsPanel(header, method, url) {
  const keys = new Map([[key.kid, parseRelayVerifyKey(relayVerifyKeyOf(key)).publicKey]]);
  return verifyRelayAssertion(header, {
    keys,
    aud: RELAY_PANEL_AUDIENCE,
    port: RELAY_PANEL_PORT,
    method,
    url,
    nonces: new NonceStore(),
  });
}

test('a valid bearer token is vouched for with its credential — the cookie beside it ignored', async () => {
  const jwt = token();
  const target = '/api/notes/app/items';
  const res = await check(target, {
    method: 'POST',
    authorization: `Bearer ${jwt}`,
    cookie: 'authelia_session=bob',
  });
  assert.equal(res.statusCode, 200);
  const verified = verifyAsPanel(res.headers['x-lamalibre-relay-assertion'], 'POST', target);
  assert.equal(verified.ok, true);
  const { caller } = verified.payload;
  assert.equal(caller.username, 'alice', 'the token’s user, never the session’s');
  assert.deepEqual(caller.credential, {
    kind: 'bearer',
    clientId: CLIENT,
    tokenSha256: nativeTokenSha256(jwt),
    exp: JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url')).exp,
  });
  assert.equal(JSON.stringify(verified.payload).includes(jwt), false, 'never the token itself');
  assert.equal(jwksAnswers, 1);
});

test('a refused token is a 401 naming invalid_token', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const cases = [
    ['not a bearer', 'Basic YWxpY2U6'],
    ['empty bearer', 'Bearer '],
    ['wrong issuer', `Bearer ${token({ iss: 'https://auth.other.com' })}`],
    ['wrong audience', `Bearer ${token({ aud: ['https://elsewhere.example.com'] })}`],
    ['another client', `Bearer ${token({ client_id: 'lamaste-native-locked' })}`],
    ['a plugin client', `Bearer ${token({ client_id: 'notes' })}`],
    ['expired', `Bearer ${token({ exp: Math.floor(Date.now() / 1000) - 5 })}`],
    ['too long-lived', `Bearer ${token({ exp: Math.floor(Date.now() / 1000) + 3600 })}`],
    ['bad signature', `Bearer ${token({}, { privateKey: other.privateKey })}`],
    ['wrong type', `Bearer ${token({}, { header: { typ: 'JWT' } })}`],
    ['no username', `Bearer ${token({ preferred_username: undefined })}`],
  ];
  for (const [label, authorization] of cases) {
    const res = await check('/api/notes/app/items', { authorization });
    assert.equal(res.statusCode, 401, label);
    assert.equal(res.headers['x-lamalibre-refusal'], 'invalid_token', label);
    assert.equal(res.headers['x-lamalibre-relay-assertion'], undefined, label);
  }
});

test('a host without a served native client, or no projection, refuses every bearer', async () => {
  nativeClients = [];
  let res = await check('/api/notes/app/x', { authorization: `Bearer ${token()}` });
  assert.equal(res.statusCode, 401);
  nativeClients = null;
  res = await check('/api/notes/app/x', { authorization: `Bearer ${token()}` });
  assert.equal(res.statusCode, 401);
});

test('the session path’s checks apply: membership, the restricted host’s grant', async () => {
  domains = domainsIndex([{ name: 'example.com', members: ['bob'] }]);
  let res = await check('/api/notes/app/x', { authorization: `Bearer ${token()}` });
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers['x-lamalibre-refusal'], 'not_a_member');

  domains = domainsIndex();
  const locked = (user) =>
    token({
      aud: [`https://${RESTRICTED}`],
      client_id: 'lamaste-native-locked',
      preferred_username: user,
    });
  res = await check('/api/vault/app/x', {
    fqdn: RESTRICTED,
    authorization: `Bearer ${locked('alice')}`,
  });
  assert.equal(res.statusCode, 200, 'alice holds the tunnel grant');
  res = await check('/api/vault/app/x', {
    fqdn: RESTRICTED,
    authorization: `Bearer ${locked('bob')}`,
  });
  assert.equal(res.statusCode, 403, 'bob does not');
});

test('a rotated issuer key is fetched again; no key set at all is a 503', async () => {
  let res = await check('/api/notes/app/x', { authorization: `Bearer ${token()}` });
  assert.equal(res.statusCode, 200);
  // The key is regenerated under the same kid: a bad signature refetches.
  issuer = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  res = await check('/api/notes/app/x', { authorization: `Bearer ${token()}` });
  assert.equal(res.statusCode, 200);
  assert.equal(jwksAnswers, 2);

  await app.close();
  jwksUp = false;
  app = await makeApp();
  res = await check('/api/notes/app/x', { authorization: `Bearer ${token()}` });
  assert.equal(res.statusCode, 503, 'never 401 while the issuer cannot be read');
});

test('a site’s shell admits a user of any route it serves — a joined plugin’s too (D1)', async () => {
  const shell = (fqdn) =>
    app.inject({
      method: 'GET',
      url: `/authz/user-surface-shell/${fqdn}`,
      headers: {
        host: fqdn,
        'x-original-url': `https://${fqdn}/`,
        'x-original-method': 'GET',
        cookie: 'authelia_session=bob',
      },
    });
  const res = await shell('shell.example.com');
  assert.equal(res.statusCode, 200, res.body);
  // The joined route is served on the site, whichever agent hosts it.
  const hosts = userSurfaceHosts(STATE, SITES);
  assert.deepEqual(hosts.find((h) => h.fqdn === 'shell.example.com').served, ['own', 'other']);
});
