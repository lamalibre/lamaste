/**
 * Gatekeeper vouches for the Authelia user of a plugin tunnel to the
 * agent's lamaste-agentd: on such a tunnel an allowed request is answered
 * with a relay assertion for that request (the agent, its daemon's port,
 * the plugin route, the method), never cacheable. Other tunnels get the
 * identity headers alone, as before. Runs against the build (`npm run build`).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';

import { domainsIndex } from './domains-fixture.js';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import {
  createRelaySigner,
  NonceStore,
  parseRelayVerifyKey,
  relayVerifyKeyOf,
  verifyRelayAssertion,
} from '@lamalibre/lamaste';

let dir;
let app;
let key;
let signer;
let previousDispatcher;

const TUNNELS = [
  {
    id: 'plugin',
    fqdn: 'herd.example.com',
    accessMode: 'authenticated',
    enabled: true,
    plugin: { agentLabel: 'r730', port: 9393, route: 'herd' },
  },
  { id: 'app', fqdn: 'app.example.com', accessMode: 'authenticated', enabled: true },
];

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-gatekeeper-authz-'));
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = dir;
  const keyFile = path.join(dir, 'relay-signing-key.json');
  key = await createRelaySigner(keyFile, { create: true }).current();
  signer = createRelaySigner(keyFile, { create: false });

  // Authelia's verify endpoint: one user per session cookie.
  const mock = new MockAgent();
  mock.disableNetConnect();
  previousDispatcher = getGlobalDispatcher();
  setGlobalDispatcher(mock);
  const authelia = mock.get('http://127.0.0.1:9091');
  const user = (cookie, headers) =>
    authelia
      .intercept({ path: '/api/authz/auth-request', method: 'GET', headers: { cookie } })
      .reply(200, '', { headers })
      .persist();
  user('authelia_session=alice', {
    'remote-user': 'alice',
    'remote-groups': 'dev, ops',
    'remote-name': 'Alice',
    'remote-email': 'alice@example.test',
  });
  user('authelia_session=odd', { 'remote-user': 'not a username' });

  const { authzRoutes } = await import('../dist/server/routes/authz.js');
  app = Fastify({ logger: false });
  const sessions = new Map();
  app.decorate('getTunnels', () => TUNNELS);
  // The panel's projection: every user here a member of example.com.
  app.decorate('getDomains', () => domainsIndex());
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

const check = (host, cookie = 'authelia_session=alice', method = 'POST') =>
  app.inject({
    method: 'GET',
    url: `/authz/tunnel/${host}`,
    headers: {
      host,
      cookie,
      'x-original-url': `https://${host}/jobs?state=queued`,
      'x-original-method': method,
    },
  });

test('a plugin tunnel user gets a single-use relay assertion for the agent', async () => {
  const res = await check('herd.example.com');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['remote-user'], 'alice');
  assert.equal(res.headers['cache-control'], 'no-store');

  const header = res.headers['x-lamalibre-relay-assertion'];
  const keys = new Map([[key.kid, parseRelayVerifyKey(relayVerifyKeyOf(key)).publicKey]]);
  const verified = verifyRelayAssertion(header, {
    keys,
    aud: 'r730',
    port: 9393,
    method: 'POST',
    url: '/herd/jobs?state=queued',
    nonces: new NonceStore(),
  });
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.payload.caller, {
    type: 'user',
    username: 'alice',
    groups: ['dev', 'ops'],
    name: 'Alice',
    email: 'alice@example.test',
  });
  assert.deepEqual(verified.payload.target, { route: 'herd' });

  const again = await check('herd.example.com');
  assert.notEqual(again.headers['x-lamalibre-relay-assertion'], header, 'fresh per request');
});

test('an app tunnel gets the identity headers only, cacheable as before', async () => {
  const res = await check('app.example.com');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['remote-user'], 'alice');
  assert.equal(res.headers['x-lamalibre-relay-assertion'], undefined);
  assert.match(res.headers['cache-control'], /max-age=10/);
});

test('a user an assertion cannot carry is refused rather than passed on unasserted', async () => {
  const res = await check('herd.example.com', 'authelia_session=odd');
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers['x-lamalibre-relay-assertion'], undefined);
});

test('without the relay key a plugin tunnel request fails closed', async () => {
  const kept = signer;
  signer = createRelaySigner(path.join(dir, 'missing.json'), { create: false });
  try {
    const res = await check('herd.example.com');
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers['remote-user'], undefined);
  } finally {
    signer = kept;
  }
});
