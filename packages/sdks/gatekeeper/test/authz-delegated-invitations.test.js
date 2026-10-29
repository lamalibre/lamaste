/**
 * Gatekeeper vouches for an inviter on a domain's sign-in host (delegated
 * invitations): `/authz/delegated-invitations/<domain>`, the auth_request
 * target of `auth.<domain>/api/delegated-invitations/<route>[/<id>]`. It
 * checks the portal named in the path, X-Original-URL and Host agreeing,
 * the raw target being a route's inviter API (nothing longer, no unsafe
 * segment), the Authelia session for that very URL — never from the session
 * cache, two session cookies a 401 — and the domain's projection (a member
 * or an external member, fail closed); then signs an inviter's assertion for
 * the panel bound to the method and target, which a user-surface
 * verification never accepts. Runs against the build (`npm run build`).
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
  isRelayInvitationsTarget,
  parseRelayVerifyKey,
  relayVerifyKeyOf,
  verifyRelayAssertion,
} from '@lamalibre/lamaste';

import { domainsIndex } from './domains-fixture.js';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

let dir;
let app;
let key;
let previousDispatcher;
const sessions = new Map();
let domainsProjection;
const askedAuthelia = [];

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-gatekeeper-inviter-'));
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = dir;
  const keyFile = path.join(dir, 'relay-signing-key.json');
  key = await createRelaySigner(keyFile, { create: true }).current();
  const signer = createRelaySigner(keyFile, { create: false });

  // Authelia: alice and ext have sessions; anyone else's is refused, and
  // `blocked` is a session Authelia forbids on this portal.
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
      headers: { cookie: 'authelia_session=blocked' },
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

/** The subrequest the auth vhost of `domain` sends for `target`. */
function check(
  target,
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
  return app.inject({ method: 'GET', url: `/authz/delegated-invitations/${domain}`, headers });
}

function verifyAsPanel(header, { method, url }) {
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

test('a member or an external member of the domain gets an inviter’s assertion for exactly this request', async () => {
  for (const [cookie, user] of [
    ['authelia_session=alice', 'alice'],
    ['authelia_session=ext', 'ext'],
  ]) {
    for (const [target, method] of [
      ['/api/delegated-invitations/corral', 'GET'],
      ['/api/delegated-invitations/corral', 'POST'],
      [`/api/delegated-invitations/corral/${ID}`, 'DELETE'],
    ]) {
      const res = await check(target, { cookie, method });
      assert.equal(res.statusCode, 200, `${user} ${method} ${target}`);
      assert.equal(res.headers['cache-control'], 'no-store');
      const verified = verifyAsPanel(res.headers['x-lamalibre-relay-assertion'], {
        method,
        url: target,
      });
      assert.equal(verified.ok, true, JSON.stringify(verified));
      assert.deepEqual(verified.payload.caller, { type: 'user', username: user });
      assert.ok(isRelayInvitationsTarget(verified.payload.target));
      assert.deepEqual(verified.payload.target, {
        invitations: 'corral',
        domain: 'example.com',
        path: target,
      });
      // Bound to the method: another one does not verify.
      assert.equal(
        verifyAsPanel(res.headers['x-lamalibre-relay-assertion'], {
          method: method === 'GET' ? 'POST' : 'GET',
          url: target,
        }).ok,
        false,
      );
    }
  }
  // Authelia was asked about the portal URL itself, every time (never cached).
  assert.ok(
    askedAuthelia.every((u) =>
      u.startsWith('https://auth.example.com/api/delegated-invitations/corral'),
    ),
  );
  assert.equal(askedAuthelia.length, 6);
  assert.equal(sessions.size, 0, 'nothing cached');
});

test('refused: not a member of this domain, a session Authelia forbids, no session, two sessions', async () => {
  const target = '/api/delegated-invitations/corral';
  const other = await check(target, { cookie: 'authelia_session=stranger' });
  assert.equal(other.statusCode, 403);
  assert.equal(other.headers['x-lamalibre-refusal'], 'forbidden');
  assert.equal(other.headers['x-lamalibre-relay-assertion'], undefined);
  assert.equal((await check(target, { cookie: 'authelia_session=blocked' })).statusCode, 403);
  assert.equal((await check(target, { cookie: null })).statusCode, 401);
  assert.equal((await check(target, { cookie: 'authelia_session=nobody' })).statusCode, 401);
  const tossed = await check(target, {
    cookie: 'authelia_session=alice; authelia_session=attacker',
  });
  assert.equal(tossed.statusCode, 401, 'a second session cookie is a sign-in again, never a guess');
  // The projection gone: everyone refused (fail closed).
  domainsProjection = null;
  assert.equal((await check(target)).statusCode, 403);
});

test('refused: anything but this portal and a route’s inviter API', async () => {
  for (const target of [
    '/api/delegated-invitations/corral/',
    '/api/delegated-invitations/corral/not-an-id',
    `/api/delegated-invitations/corral/${ID}/more`,
    '/api/delegated-invitations/corral/..%2fadmin',
    '/api/delegated-invitations/Corral',
    '/api/delegated-invitations/',
    '/api/corral/app',
    '/api/invite/accept',
  ]) {
    const res = await check(target);
    assert.equal(res.statusCode, 403, target);
    assert.equal(res.headers['x-lamalibre-relay-assertion'], undefined, target);
  }
  const target = '/api/delegated-invitations/corral';
  // A domain the relay does not hold, a Host or URL of another host.
  assert.equal((await check(target, { domain: 'nowhere.test' })).statusCode, 403);
  assert.equal((await check(target, { host: 'corral.example.com' })).statusCode, 403);
  assert.equal(
    (await check(target, { url: `https://corral.example.com${target}` })).statusCode,
    403,
  );
  assert.equal((await check(target, { url: `https://auth.other.test${target}` })).statusCode, 403);
});
