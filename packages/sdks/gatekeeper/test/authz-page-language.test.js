/**
 * The authorization routes answer in the page language of the host's
 * domain (packages/core/docs/page-language-design.md §7): `pageOptions`
 * reads it from the panel's projection (`domains.json`, parsed leniently —
 * a value that is not a page language is "not set", never a refusal), for
 * the access-request page, the domain refusal page and the "not allowed"
 * page of a plugin's site; a domain without one, and a host under none,
 * get English. Runs against the build.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

import {
  indexDomainsProjection,
  parseDomainsProjection,
  userSurfaceHosts,
} from '@lamalibre/lamaste';

let dir;
let app;
let previousDispatcher;

/** alpha.example speaks Turkish; beta.example names a language no catalogue has. */
const PROJECTION = {
  v: 2,
  domains: [
    { name: 'alpha.example', members: ['alice'], externals: [], language: 'tr' },
    { name: 'beta.example', members: ['alice'], externals: [], language: 'xx' },
  ],
};

const TUNNELS = [
  { id: 'a', fqdn: 'app.alpha.example', accessMode: 'restricted', enabled: true },
  { id: 'b', fqdn: 'app.beta.example', accessMode: 'restricted', enabled: true },
  { id: 's', fqdn: 'app.stray.example', accessMode: 'restricted', enabled: true },
];

/** A plugin's site on each domain whose plugin nobody hosts: never served. */
const SITES = [
  {
    id: 'site-a',
    name: 'web-a',
    fqdn: 'web.alpha.example',
    type: 'managed',
    owner: { plugin: 'web-a' },
    accessMode: 'authenticated',
  },
  {
    id: 'site-b',
    name: 'web-b',
    fqdn: 'web.beta.example',
    type: 'managed',
    owner: { plugin: 'web-b' },
    accessMode: 'authenticated',
  },
];

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-gatekeeper-page-language-'));
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = dir;

  // Authelia: `alice` is signed in everywhere; `zed` is refused everywhere.
  const mock = new MockAgent();
  mock.disableNetConnect();
  previousDispatcher = getGlobalDispatcher();
  setGlobalDispatcher(mock);
  const authelia = mock.get('http://127.0.0.1:9091');
  authelia
    .intercept({
      path: '/api/authz/auth-request',
      method: 'GET',
      headers: { cookie: 'authelia_session=alice' },
    })
    .reply(() => ({
      statusCode: 200,
      data: '',
      responseOptions: { headers: { 'remote-user': 'alice', 'remote-groups': '' } },
    }))
    .persist();
  authelia
    .intercept({
      path: '/api/authz/auth-request',
      method: 'GET',
      headers: { cookie: 'authelia_session=zed' },
    })
    .reply(() => ({ statusCode: 403, data: '' }))
    .persist();

  const projection = parseDomainsProjection(PROJECTION);
  assert.ok(projection, 'an unknown language never invalidates the projection');
  const { authzRoutes } = await import('../dist/server/routes/authz.js');
  app = Fastify({ logger: false });
  app.decorate('getTunnels', () => TUNNELS);
  app.decorate('getUserSurfaceHosts', () => userSurfaceHosts([], SITES));
  app.decorate('getDomains', () => indexDomainsProjection(projection));
  app.decorate('getSessionCache', () => new Map());
  app.decorate('getCacheVersion', () => 1);
  app.decorate('getSettings', () => ({ adminName: 'Ops', adminEmail: 'ops@alpha.example' }));
  app.decorate('getRelaySigner', () => null);
  app.decorate('readDomainBrand', async () => null);
  await app.register(authzRoutes);
  await app.ready();
});

after(async () => {
  await app?.close();
  setGlobalDispatcher(previousDispatcher);
  await rm(dir, { recursive: true, force: true });
});

const ask = (check, fqdn, user) =>
  app.inject({
    method: 'GET',
    url: `/authz/${check}/${fqdn}`,
    headers: {
      host: fqdn,
      cookie: `authelia_session=${user}`,
      'x-original-url': `https://${fqdn}/`,
      'x-original-method': 'GET',
    },
  });

test('the access-request page: Turkish on a Turkish domain, English on one with an unknown language and on a stray host', async () => {
  const turkish = await ask('tunnel', 'app.alpha.example', 'alice');
  assert.equal(turkish.statusCode, 403);
  assert.match(turkish.body, /<html lang="tr">/);
  assert.ok(turkish.body.includes('<h1>Erişim gerekli</h1>'));
  assert.ok(turkish.body.includes('Konu: app.alpha.example için erişim talebi'));

  for (const fqdn of ['app.beta.example', 'app.stray.example']) {
    const english = await ask('tunnel', fqdn, 'alice');
    assert.equal(english.statusCode, 403, fqdn);
    if (fqdn === 'app.stray.example') {
      // Under no domain: the domain refusal page, in English.
      assert.match(english.body, /<html lang="en">/, fqdn);
      continue;
    }
    assert.match(english.body, /<html lang="en">/, fqdn);
    assert.ok(english.body.includes('<h1>Access Required</h1>'), fqdn);
  }
});

test('the domain refusal page follows the language of the host’s domain', async () => {
  const turkish = await ask('tunnel', 'app.alpha.example', 'zed');
  assert.equal(turkish.statusCode, 403);
  assert.match(turkish.body, /<html lang="tr">/);
  assert.ok(
    turkish.body.includes('<span class="fqdn">alpha.example</span> üyeleri arasında değilsiniz'),
  );
  assert.ok(
    turkish.body.includes('<a href="https://auth.alpha.example/logout">oturumu kapatın</a>'),
  );

  const english = await ask('tunnel', 'app.beta.example', 'zed');
  assert.match(english.body, /<html lang="en">/);
  assert.ok(english.body.includes('Not a member of <span class="fqdn">beta.example</span>'));
});

test('a plugin’s site not served: the "not allowed" page in its domain’s language, never cached', async () => {
  const turkish = await ask('user-surface-shell', 'web.alpha.example', 'alice');
  assert.equal(turkish.statusCode, 403);
  assert.equal(turkish.headers['cache-control'], 'no-store');
  assert.match(turkish.headers['content-type'], /^text\/html/);
  assert.match(turkish.body, /<html lang="tr">/);
  assert.ok(turkish.body.includes('<h1>İzin verilmiyor</h1>'));

  const english = await ask('user-surface-shell', 'web.beta.example', 'alice');
  assert.match(english.body, /<html lang="en">/);
  assert.ok(english.body.includes('<h1>Not Allowed</h1>'));
});
