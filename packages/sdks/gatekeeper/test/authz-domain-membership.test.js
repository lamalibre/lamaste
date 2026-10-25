/**
 * The multi-domain relay: a person reaches a domain only as its member.
 * Authelia renders the membership into its access control and refuses a
 * signed-in non-member (403); Gatekeeper answers that with a refusal page,
 * never a 401 that would send the browser through the sign-in again, and
 * checks the membership itself after Authelia admitted a session — from the
 * panel's projection (`domains.json`), which it fails closed without. A
 * static site, which asks Authelia itself, gets the page from
 * `/authz/refusal/:fqdn`. Runs against the build (`npm run build`).
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

let dir;
let app;
let previousDispatcher;
const sessions = new Map();
/** The URLs Authelia was asked about. */
const askedAuthelia = [];

const TUNNELS = [
  { id: 'ws', fqdn: 'workspace.codelama.com.tr', accessMode: 'authenticated', enabled: true },
  { id: 'shop', fqdn: 'shop.samplepark.tr', accessMode: 'authenticated', enabled: true },
  { id: 'stray', fqdn: 'app.example.org', accessMode: 'authenticated', enabled: true },
];

/** The panel's projection the test changes; null: no `domains.json`. */
let projection;
const BOTH = () => ({
  v: 1,
  domains: [
    { name: 'samplepark.tr', members: ['onur', 'cust'] },
    { name: 'codelama.com.tr', members: ['onur'] },
  ],
});

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-gatekeeper-domains-'));
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = dir;

  // Authelia: `onur` is signed in everywhere; `cust` is refused on
  // codelama.com.tr (not a member, as Authelia's rendered rules say), and
  // signed in elsewhere.
  const mock = new MockAgent();
  mock.disableNetConnect();
  previousDispatcher = getGlobalDispatcher();
  setGlobalDispatcher(mock);
  const authelia = mock.get('http://127.0.0.1:9091');
  for (const user of ['onur', 'cust']) {
    authelia
      .intercept({
        path: '/api/authz/auth-request',
        method: 'GET',
        headers: { cookie: `authelia_session=${user}` },
      })
      .reply((opts) => {
        const url = opts.headers['X-Original-URL'];
        askedAuthelia.push(url);
        if (user === 'cust' && new URL(url).hostname.endsWith('.codelama.com.tr')) {
          return { statusCode: 403, data: '' };
        }
        return {
          statusCode: 200,
          data: '',
          responseOptions: { headers: { 'remote-user': user, 'remote-groups': '' } },
        };
      })
      .persist();
  }

  const { authzRoutes } = await import('../dist/server/routes/authz.js');
  app = Fastify({ logger: false });
  app.decorate('getTunnels', () => TUNNELS);
  app.decorate('getUserSurfaceHosts', () => []);
  app.decorate('getDomains', () => projection);
  app.decorate('getSessionCache', () => sessions);
  app.decorate('getCacheVersion', () => 1);
  app.decorate('getSettings', () => ({
    adminName: 'Code Lama',
    adminEmail: 'ops@codelama.com.tr',
  }));
  app.decorate('getRelaySigner', () => null);
  await app.register(authzRoutes);
  await app.ready();
});

beforeEach(() => {
  sessions.clear();
  askedAuthelia.length = 0;
  projection = BOTH();
});

after(async () => {
  await app?.close();
  setGlobalDispatcher(previousDispatcher);
  await rm(dir, { recursive: true, force: true });
});

const check = (fqdn, user) =>
  app.inject({
    method: 'GET',
    url: `/authz/tunnel/${fqdn}`,
    headers: {
      host: fqdn,
      cookie: `authelia_session=${user}`,
      'x-original-url': `https://${fqdn}/`,
      'x-original-method': 'GET',
    },
  });

test('a developer reaches both domains; a customer only their own', async () => {
  assert.equal((await check('workspace.codelama.com.tr', 'onur')).statusCode, 200);
  assert.equal((await check('shop.samplepark.tr', 'onur')).statusCode, 200);
  assert.equal((await check('shop.samplepark.tr', 'cust')).statusCode, 200);
});

test('Authelia’s refusal of a signed-in non-member is a refusal page, never a 401 back to the sign-in', async () => {
  const res = await check('workspace.codelama.com.tr', 'cust');
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Not a member of <span class="fqdn">codelama\.com\.tr<\/span>/);
  assert.match(res.body, /href="https:\/\/auth\.codelama\.com\.tr\/logout"/);
  assert.match(res.body, /ops@codelama\.com\.tr/);
  assert.doesNotMatch(res.body, /cust/, 'the page names no user');
  // Not cached: asked again next time.
  await check('workspace.codelama.com.tr', 'cust');
  assert.equal(askedAuthelia.length, 2);
});

test('Gatekeeper checks the membership itself, after Authelia — cached sessions too', async () => {
  // Authelia (still rendering an older membership) admits onur on codelama;
  // the projection no longer lists them.
  assert.equal((await check('workspace.codelama.com.tr', 'onur')).statusCode, 200);
  projection = {
    v: 1,
    domains: [
      { name: 'samplepark.tr', members: ['onur', 'cust'] },
      { name: 'codelama.com.tr', members: [] },
    ],
  };
  const refused = await check('workspace.codelama.com.tr', 'onur');
  assert.equal(refused.statusCode, 403);
  assert.match(refused.body, /Not a member of/);
  assert.equal(askedAuthelia.length, 1, 'the session came from the cache');
});

test('fail closed: no projection, or a host under none of its domains', async () => {
  projection = null;
  assert.equal((await check('shop.samplepark.tr', 'onur')).statusCode, 403);
  projection = BOTH();
  const stray = await check('app.example.org', 'onur');
  assert.equal(stray.statusCode, 403);
  assert.match(stray.body, /app\.example\.org/);
});

test('a static site’s refusal page names the site and its domain, and decides nothing', async () => {
  const res = await app.inject({ method: 'GET', url: '/authz/refusal/docs.codelama.com.tr' });
  assert.equal(res.statusCode, 403);
  assert.match(res.body, /Not allowed on <span class="fqdn">docs\.codelama\.com\.tr<\/span>/);
  assert.match(res.body, /not a member of\s+codelama\.com\.tr, or not one of the site's users/);
  assert.equal(askedAuthelia.length, 0);
  const bad = await app.inject({ method: 'GET', url: '/authz/refusal/x$host' });
  assert.equal(bad.statusCode, 403);
  assert.equal(bad.body, '');
});
