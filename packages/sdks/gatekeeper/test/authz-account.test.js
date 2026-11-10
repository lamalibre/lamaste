/**
 * Gatekeeper vouches for a person changing their own password on a domain's
 * sign-in host (mail-design.md §6.3): `/authz/account/<domain>`, the
 * auth_request target of `auth.<domain>/api/account/password`. The portal
 * named in the path, X-Original-URL and Host agreeing, the raw target that
 * API exactly, the Authelia session for that very URL (never cached, two
 * session cookies a 401), the domain's projection (member or external
 * member, fail closed) — then an assertion of the password change's kind
 * for the panel, which no other verification accepts. The panel never reads
 * `Remote-User` there any more. Runs against the build.
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
  isRelayAccountTarget,
  isRelayInvitationsTarget,
  isRelayUserSurfaceTarget,
  parseRelayVerifyKey,
  relayVerifyKeyOf,
  verifyRelayAssertion,
} from '@lamalibre/lamaste';

import { domainsIndex } from './domains-fixture.js';

const TARGET = '/api/account/password';

let dir;
let app;
let key;
let previousDispatcher;
const sessions = new Map();
let domainsProjection;
const askedAuthelia = [];

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-gatekeeper-account-'));
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = dir;
  const keyFile = path.join(dir, 'relay-signing-key.json');
  key = await createRelaySigner(keyFile, { create: true }).current();
  const signer = createRelaySigner(keyFile, { create: false });

  const mock = new MockAgent();
  mock.disableNetConnect();
  previousDispatcher = getGlobalDispatcher();
  setGlobalDispatcher(mock);
  const authelia = mock.get('http://127.0.0.1:9091');
  for (const [cookie, user] of [
    ['authelia_session=alice', 'alice'],
    ['authelia_session=ext', 'ext'],
    ['authelia_session=stranger', 'stranger'],
  ]) {
    authelia
      .intercept({ path: '/api/authz/auth-request', method: 'GET', headers: { cookie } })
      .reply((opts) => {
        askedAuthelia.push(opts.headers['X-Original-URL']);
        return {
          statusCode: 200,
          data: '',
          responseOptions: { headers: { 'remote-user': user, 'remote-name': user } },
        };
      })
      .persist();
  }
  authelia
    .intercept({
      path: '/api/authz/auth-request',
      method: 'GET',
      headers: { cookie: 'authelia_session=one-factor' },
    })
    .reply(() => ({ statusCode: 403, data: '' }))
    .persist();
  authelia
    .intercept({ path: '/api/authz/auth-request', method: 'GET' })
    .reply(() => ({ statusCode: 401, data: '' }))
    .persist();

  const { authzRoutes } = await import('../dist/server/routes/authz.js');
  app = Fastify({ logger: false });
  app.decorate('getTunnels', () => []);
  app.decorate('getUserSurfaceHosts', () => []);
  app.decorate('getDomains', () => domainsProjection);
  app.decorate('getSessionCache', () => sessions);
  app.decorate('getCacheVersion', () => 1);
  app.decorate('getSettings', () => ({}));
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
  askedAuthelia.length = 0;
  domainsProjection = domainsIndex([
    { name: 'example.com', members: ['alice'], externals: ['ext'] },
    { name: 'other.test', members: ['stranger'] },
  ]);
});

function check(
  target = TARGET,
  {
    domain = 'example.com',
    host = `auth.${domain}`,
    url = `https://auth.${domain}${target}`,
    method = 'POST',
    cookie = 'authelia_session=alice',
  } = {},
) {
  const headers = { host, 'x-original-url': url, 'x-original-method': method };
  if (cookie !== null) headers.cookie = cookie;
  return app.inject({ method: 'GET', url: `/authz/account/${domain}`, headers });
}

function verifyAsPanel(header, { method = 'POST', url = TARGET } = {}) {
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

test('a member or an external member gets an assertion of the password change for exactly this request', async () => {
  for (const [cookie, user] of [
    ['authelia_session=alice', 'alice'],
    ['authelia_session=ext', 'ext'],
  ]) {
    const res = await check(TARGET, { cookie });
    assert.equal(res.statusCode, 200, user);
    assert.equal(res.headers['cache-control'], 'no-store');
    const verified = verifyAsPanel(res.headers['x-lamalibre-relay-assertion']);
    assert.equal(verified.ok, true, JSON.stringify(verified));
    assert.deepEqual(verified.payload.caller, { type: 'user', username: user });
    assert.ok(isRelayAccountTarget(verified.payload.target));
    assert.equal(isRelayInvitationsTarget(verified.payload.target), false);
    assert.equal(isRelayUserSurfaceTarget(verified.payload.target), false);
    assert.deepEqual(verified.payload.target, {
      account: 'password',
      domain: 'example.com',
      path: TARGET,
    });
    // Bound to the method and the path.
    assert.equal(
      verifyAsPanel(res.headers['x-lamalibre-relay-assertion'], { method: 'GET' }).ok,
      false,
    );
    assert.equal(
      verifyAsPanel(res.headers['x-lamalibre-relay-assertion'], {
        url: '/api/delegated-invitations/corral',
      }).ok,
      false,
    );
  }
  assert.deepEqual(askedAuthelia, [
    'https://auth.example.com/api/account/password',
    'https://auth.example.com/api/account/password',
  ]);
  assert.equal(sessions.size, 0, 'nothing cached');
});

test('refused: not a member, a session Authelia forbids (one factor), no session, two sessions', async () => {
  const other = await check(TARGET, { cookie: 'authelia_session=stranger' });
  assert.equal(other.statusCode, 403);
  assert.equal(other.headers['x-lamalibre-relay-assertion'], undefined);
  assert.equal((await check(TARGET, { cookie: 'authelia_session=one-factor' })).statusCode, 403);
  assert.equal((await check(TARGET, { cookie: null })).statusCode, 401);
  assert.equal((await check(TARGET, { cookie: 'authelia_session=nobody' })).statusCode, 401);
  assert.equal(
    (await check(TARGET, { cookie: 'authelia_session=alice; authelia_session=x' })).statusCode,
    401,
  );
  domainsProjection = null;
  assert.equal((await check()).statusCode, 403, 'fail closed without the projection');
});

test('refused: any other path, host or domain', async () => {
  for (const target of [
    '/api/account/password/',
    '/api/account/password?x=1',
    '/api/account/reset/start',
    '/api/account/Password',
    '/api/delegated-invitations/corral',
  ]) {
    const res = await check(target);
    assert.equal(res.statusCode, 403, target);
    assert.equal(res.headers['x-lamalibre-relay-assertion'], undefined, target);
  }
  assert.equal((await check(TARGET, { domain: 'nowhere.test' })).statusCode, 403);
  assert.equal((await check(TARGET, { host: 'panel.example.com' })).statusCode, 403);
  assert.equal((await check(TARGET, { url: `https://auth.other.test${TARGET}` })).statusCode, 403);
  assert.equal(askedAuthelia.length, 0, 'Authelia asked about nothing refused before it');
});
