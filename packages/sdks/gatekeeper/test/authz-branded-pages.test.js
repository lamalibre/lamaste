/**
 * The brand of a host's domain reaches every page the authorization routes
 * answer inline: the access-request page (a restricted tunnel without a
 * grant), the domain refusal page (a signed-in non-member) and the static
 * site's refusal page (`/authz/refusal/:fqdn`); a host under none of the
 * relay's domains gets the stock page, as does a domain without a brand.
 * The brand comes from `readDomainBrand` (decorated by the server from the
 * web root; here a reader over a temporary root). Runs against the build.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';

import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { renderBrandJson } from '@lamalibre/lamaste';

import { domainsIndex } from './domains-fixture.js';

let dir;
let webRoot;
let app;
let previousDispatcher;

const TUNNELS = [
  { id: 'ws', fqdn: 'workspace.codelama.com.tr', accessMode: 'restricted', enabled: true },
  { id: 'shop', fqdn: 'shop.samplepark.tr', accessMode: 'restricted', enabled: true },
  { id: 'stray', fqdn: 'app.example.org', accessMode: 'restricted', enabled: true },
];

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-gatekeeper-branded-'));
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = dir;
  webRoot = path.join(dir, 'auth');

  // codelama.com.tr is branded; samplepark.tr is not; example.org is under no domain.
  const domain = 'codelama.com.tr';
  const render = path.join(webRoot, '.renders', `${domain}-1-${'a'.repeat(16)}`);
  await mkdir(render, { recursive: true });
  await writeFile(
    path.join(render, 'brand.json'),
    JSON.stringify(
      renderBrandJson(
        domain,
        {
          name: 'Code Lama',
          tagline: 'Software, crafted',
          theme: 'light',
          accent: '#1d4ed8',
          supportEmail: 'help@codelama.com.tr',
          supportUrl: 'https://codelama.com.tr/help',
        },
        1,
        { logoSha256: 'f'.repeat(64), faviconSha256: null },
      ),
    ),
  );
  await symlink(`.renders/${path.basename(render)}`, path.join(webRoot, '.link-a'));
  await rename(path.join(webRoot, '.link-a'), path.join(webRoot, domain));

  // Authelia: `onur` is signed in everywhere and a member of both domains
  // (the projection below says so); `cust` is refused on codelama.com.tr.
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
  const { createBrandReader } = await import('../dist/index.js');
  const reader = createBrandReader({ root: webRoot, ttlMs: 0 });
  app = Fastify({ logger: false });
  app.decorate('getTunnels', () => TUNNELS);
  app.decorate('getUserSurfaceHosts', () => []);
  app.decorate('getDomains', () =>
    domainsIndex([
      { name: 'codelama.com.tr', members: ['onur'] },
      { name: 'samplepark.tr', members: ['onur', 'cust'] },
    ]),
  );
  app.decorate('getSessionCache', () => new Map());
  app.decorate('getCacheVersion', () => 1);
  app.decorate('getSettings', () => ({ adminName: 'Ops', adminEmail: 'ops@example.com' }));
  app.decorate('getRelaySigner', () => null);
  app.decorate('readDomainBrand', (name) => reader.readDomainBrand(name));
  await app.register(authzRoutes);
  await app.ready();
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

const BRANDED = [
  '<div class="brand-name">Code Lama</div>',
  '<div class="brand-tagline">Software, crafted</div>',
  'src="https://auth.codelama.com.tr/static/media/logo.png"',
  ':root { --accent: #1d4ed8; }',
  'mailto:help@codelama.com.tr',
  'href="https://codelama.com.tr/help" rel="noopener"',
];

function assertBranded(body) {
  for (const piece of BRANDED) assert.ok(body.includes(piece), piece);
  assert.doesNotMatch(body, /ops@example\.com/);
}

function assertStock(body) {
  assert.doesNotMatch(body, /class="brand|brand-logo|Code Lama|codelama/);
  assert.ok(body.includes('mailto:ops@example.com'));
}

test('the access-request page of a restricted tunnel carries its domain’s brand; an unbranded domain and a stray host get the stock page', async () => {
  const branded = await check('workspace.codelama.com.tr', 'onur');
  assert.equal(branded.statusCode, 403);
  assert.match(branded.headers['content-type'], /text\/html/);
  assert.match(branded.body, /<h1>Access Required<\/h1>/);
  assertBranded(branded.body);

  const unbranded = await check('shop.samplepark.tr', 'onur');
  assert.equal(unbranded.statusCode, 403);
  assert.match(unbranded.body, /<h1>Access Required<\/h1>/);
  assertStock(unbranded.body);
});

test('the domain refusal page of a signed-in non-member carries the domain’s brand', async () => {
  const res = await check('workspace.codelama.com.tr', 'cust');
  assert.equal(res.statusCode, 403);
  assert.match(res.body, /Not a member of <span class="fqdn">codelama\.com\.tr<\/span>/);
  assertBranded(res.body);
  assert.doesNotMatch(res.body, /cust/);
});

test('the static site’s refusal page carries the domain’s brand; a host under no domain gets the stock page', async () => {
  const refusal = (fqdn) =>
    app.inject({ method: 'GET', url: `/authz/refusal/${fqdn}`, headers: { host: fqdn } });
  const branded = await refusal('docs.codelama.com.tr');
  assert.equal(branded.statusCode, 403);
  assert.match(branded.body, /Not allowed on <span class="fqdn">docs\.codelama\.com\.tr<\/span>/);
  assertBranded(branded.body);

  const stray = await refusal('site.example.org');
  assert.equal(stray.statusCode, 403);
  assert.match(stray.body, /under none of this relay/);
  assertStock(stray.body);
  assert.doesNotMatch(stray.body, /logout/, 'no sign-in link for a host under no domain');
});
