/**
 * A domain's page language (packages/core/docs/page-language-design.md;
 * lib/domains.js `setDomainLanguage`, lib/auth-branding.js): migration
 * 0021's column; `PUT /api/domains/:name/language` refused for anything
 * but a page language or null, audited `domain.language.updated` with the
 * old and new value; the domain rendered — Authelia's locale files forced
 * into its language, Lamaste's pages in it — with or without a brand, its
 * auth vhost rewritten, Gatekeeper's projection carrying it, Authelia never
 * restarted; cleared back to no rendering; the reconcile rendering what is
 * stale (another language, another running Authelia) and keeping a
 * language-only rendering; a running Authelia that is not the pin audited
 * and notified once per version; a removed domain taking its rendering.
 *
 * Authelia's locale files are 4.39.28's own (core's verbatim fixtures).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { AUTHELIA_RELEASE, parseDomainsProjection } from '@lamalibre/lamaste';
import { authPagesDigest } from '@lamalibre/lamaste/server';

import { renderAuthVhost } from '../src/lib/nginx.js';

import { createFakeAutheliaStorage } from './fake-authelia-storage.js';
import { installFakeGatekeeper } from './fake-gatekeeper.js';

const HASH = '$2b$12$abcdefghijklmnopqrstuuJ2s4L6rjpDLHi3qL7Nn5D0o3M6a1g2a';
const PRIMARY = 'alpha.example';
const OTHER = 'beta.example';
const PINNED = AUTHELIA_RELEASE.version;
const LOCALES = new URL(
  '../../../core/lib/test/fixtures/authelia-4.39.28/internal/server/locales/',
  import.meta.url,
);

let dir;
let stateDir;
let webRoot;
let lib;
let app;
let restarts = 0;
let accessRenders = 0;
let autheliaVersion = PINNED;
let localeFiles;

const installedVhosts = new Map();
const vhostWrites = [];
const certOf = (domain) => `/etc/letsencrypt/live/auth.${domain}`;
const fakeVhost = {
  readInstalled: async (domain) => installedVhosts.get(domain) ?? null,
  isEnabled: async () => true,
  write: async (domain, opts) => {
    vhostWrites.push({ domain, ...opts });
    installedVhosts.set(domain, renderAuthVhost(domain, certOf(domain), opts).config);
  },
};
const overrides = () => ({
  webRoot,
  autheliaVersion: async () => autheliaVersion,
  fetchLocales: async () => ({
    languages: [
      { locale: 'en', namespaces: ['consent', 'portal', 'settings'] },
      { locale: 'tr-TR', namespaces: ['consent', 'portal', 'settings'] },
    ],
    files: localeFiles,
  }),
  ensureBase: async () => ({ logoWritten: false, restarted: false }),
  vhost: fakeVhost,
});

async function call(method, url, payload) {
  return app.inject({
    method,
    url,
    headers: {
      'x-test-role': 'admin',
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

const setLanguage = (domain, language) =>
  call('PUT', `/api/domains/${domain}/language`, { language });
const audits = (action) => lib.listAudit({ action, limit: 200 });
const renderedDir = (domain) => path.join(webRoot, domain);
const readRendered = (domain, file) => readFile(path.join(renderedDir(domain), file), 'utf-8');
const readJson = async (domain, file) => JSON.parse(await readRendered(domain, file));
const exists = (p) =>
  lstat(p)
    .then(() => true)
    .catch(() => false);
const projection = async () =>
  parseDomainsProjection(JSON.parse(await readFile(path.join(stateDir, 'domains.json'), 'utf-8')));

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-domain-language-'));
  stateDir = path.join(dir, 'state');
  webRoot = path.join(dir, 'www', 'auth');
  await mkdir(stateDir);
  localeFiles = [];
  for (const locale of ['en', 'tr-TR']) {
    for (const namespace of ['consent', 'portal', 'settings']) {
      localeFiles.push({
        locale,
        namespace,
        messages: JSON.parse(await readFile(new URL(`${locale}/${namespace}.json`, LOCALES))),
      });
    }
  }
  const usersFile = path.join(dir, 'users.yml');
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_PKI_DIR = path.join(stateDir, 'pki');
  process.env.LAMALIBRE_LAMASTE_CONFIG = path.join(stateDir, 'panel.json');
  await writeFile(
    process.env.LAMALIBRE_LAMASTE_CONFIG,
    JSON.stringify({
      ip: '203.0.113.10',
      domain: PRIMARY,
      email: 'ops@alpha.example',
      dataDir: stateDir,
      onboarding: { status: 'COMPLETED' },
    }),
  );
  await writeFile(
    usersFile,
    yaml.dump({
      users: {
        admin: {
          displayname: 'Admin',
          email: 'admin@alpha.example',
          password: HASH,
          groups: ['admins'],
        },
      },
    }),
    { mode: 0o660 },
  );

  lib = {
    ...(await import('../src/lib/state-db.js')),
    ...(await import('../src/lib/config.js')),
    ...(await import('../src/lib/authelia.js')),
    ...(await import('../src/lib/gatekeeper-client.js')),
    ...(await import('../src/lib/directory.js')),
    ...(await import('../src/lib/domains.js')),
    ...(await import('../src/lib/auth-branding.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/notifications.js')),
  };
  await lib.loadConfig();
  lib.setAutheliaForTests({
    usersFile,
    restart: async () => {
      restarts += 1;
    },
    writeTotp: async () => {},
    userStorage: createFakeAutheliaStorage().storage,
    domainAccess: async () => {
      accessRenders += 1;
      return { changed: false };
    },
    oidcProvider: async (domains, clients) => ({ changed: false, clients: clients.length }),
  });
  lib.setDomainActivationForTests({
    issueCert: async () => {},
    writeAuthVhost: async (domain, opts) => fakeVhost.write(domain, { enabled: true, ...opts }),
    removeAuthVhost: async (domain) => installedVhosts.delete(domain),
  });
  lib.setAuthBrandingForTests(overrides());
  installFakeGatekeeper(lib);
  await lib.reconcileDirectory({ confirmDelayMs: 0 });
  await lib.ensurePrimaryDomain();
  await lib.syncDomainAccess();
  installedVhosts.set(PRIMARY, renderAuthVhost(PRIMARY, certOf(PRIMARY), { primary: true }).config);
  await lib.ensureBrandingBase();

  const { default: Fastify } = await import('fastify');
  const { default: errors } = await import('../src/middleware/errors.js');
  const { default: domainRoutes } = await import('../src/routes/management/domains.js');
  app = Fastify({ logger: false });
  await app.register(errors);
  app.decorateRequest('certRole', null);
  app.addHook('onRequest', async (request) => {
    request.certRole = request.headers['x-test-role'] ?? 'unknown';
  });
  app.decorate('requireRole', (roles) => async (request, reply) => {
    if (request.certRole === 'admin' || roles.includes(request.certRole)) return;
    return reply.code(403).send({ error: 'forbidden' });
  });
  await app.register(domainRoutes, { prefix: '/api' });
  await app.ready();
});

after(async () => {
  lib.setAutheliaForTests(null);
  lib.setGatekeeperClientForTests(null);
  lib.setDomainActivationForTests(null);
  lib.setAuthBrandingForTests(null);
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

test('migration 0021: every domain without a language, as before languages', async () => {
  const db = await lib.getStateDb();
  assert.deepEqual(
    db
      .prepare('SELECT name, language FROM domains')
      .all()
      .map((r) => ({ ...r })),
    [{ name: PRIMARY, language: null }],
  );
  const listed = (await call('GET', '/api/domains')).json();
  assert.equal(listed.domains[0].language, null);
  // No rendering, none wanted: current.
  assert.deepEqual(listed.domains[0].rendering, {
    rendered: null,
    current: true,
    renderFailing: false,
    vhostPending: false,
  });
  assert.deepEqual(listed.authelia, { running: PINNED, pinned: PINNED });
  assert.equal(await exists(renderedDir(PRIMARY)), false);
  assert.equal((await projection()).domains[0].language, null);
});

test('refused: anything but a page language or null, an unknown domain, a non-admin', async () => {
  for (const body of [
    { language: 'de' },
    { language: 'TR' },
    { language: 'tr-TR' },
    { language: '' },
    { language: 1 },
    { language: ['tr'] },
    {},
    { language: 'tr', extra: true },
  ]) {
    const refused = await call('PUT', `/api/domains/${PRIMARY}/language`, body);
    assert.equal(refused.statusCode, 400, JSON.stringify(body));
    assert.equal(refused.json().code, 'invalid_language');
    // Never the value back.
    assert.doesNotMatch(refused.body, /tr-TR|"de"/);
  }
  const unknown = await setLanguage('nobody.example', 'tr');
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().code, 'domain_not_found');
  const agent = await app.inject({
    method: 'PUT',
    url: `/api/domains/${PRIMARY}/language`,
    headers: { 'x-test-role': 'agent', 'content-type': 'application/json' },
    payload: JSON.stringify({ language: 'tr' }),
  });
  assert.equal(agent.statusCode, 403);
  assert.equal((await audits('domain.language.updated')).length, 0);
});

test('Turkish on an unbranded domain: rendered, its vhost, the projection, audited — Authelia untouched', async () => {
  const restartsBefore = restarts;
  const accessBefore = accessRenders;
  const set = await setLanguage(PRIMARY, 'tr');
  assert.equal(set.statusCode, 200, set.body);
  assert.equal(set.json().changed, true);
  assert.equal(set.json().domain.language, 'tr');
  assert.equal(set.json().warnings, undefined);

  // Audited with the old and the new value.
  const [audit] = await audits('domain.language.updated');
  assert.deepEqual(audit.details, { domain: PRIMARY, from: null, to: 'tr' });

  // The rendering: revision 0 (no brand), the language, the running Authelia.
  const rendered = await readJson(PRIMARY, 'rendered.json');
  assert.equal(rendered.revision, 0);
  assert.equal(rendered.language, 'tr');
  assert.equal(rendered.autheliaVersion, PINNED);
  assert.equal(rendered.autheliaPinned, PINNED);
  assert.equal(rendered.pagesDigest, authPagesDigest());
  // Authelia's portal forced: one file per namespace, Turkish, complete.
  const portal = await readJson(PRIMARY, 'locales/forced/portal.json');
  assert.equal(portal['Sign in'], 'Giriş yap');
  assert.equal(portal.Loading, 'Yükleniyor');
  assert.equal(portal['Powered by {{authelia}}'], 'Altyapı: {{authelia}}');
  for (const namespace of ['consent', 'portal', 'settings']) {
    const english = localeFiles.find((f) => f.locale === 'en' && f.namespace === namespace);
    const forced = await readJson(PRIMARY, `locales/forced/${namespace}.json`);
    assert.deepEqual(Object.keys(forced).sort(), Object.keys(english.messages).sort(), namespace);
  }
  // The 4.8 per-locale files are a brand's alone; no brand.json.
  assert.equal(await exists(path.join(renderedDir(PRIMARY), 'locales', 'en')), false);
  assert.equal(await exists(path.join(renderedDir(PRIMARY), 'brand.json')), false);
  // The stylesheet hides Authelia's language menu.
  assert.match(await readRendered(PRIMARY, 'brand.css'), /#language-button/);
  // Lamaste's pages in the language.
  for (const page of ['invite/index.html', 'invitations/index.html', 'unavailable/index.html']) {
    assert.match(await readRendered(PRIMARY, page), /<html lang="tr">/, page);
  }

  // The auth vhost rewritten with the language, its link state kept.
  assert.deepEqual(vhostWrites.at(-1), {
    domain: PRIMARY,
    primary: true,
    enabled: true,
    branding: null,
    language: 'tr',
  });
  assert.match(installedVhosts.get(PRIMARY), /try_files \/locales\/forced\/\$1\.json @authelia;/);
  assert.match(installedVhosts.get(PRIMARY), /<html lang="tr" data-authelia-lang="/);

  // Gatekeeper's projection: the language, the members unchanged.
  const index = await projection();
  assert.equal(index.domains[0].language, 'tr');
  assert.deepEqual(index.domains[0].members, ['admin']);

  // Authelia: neither its configuration rendered again nor restarted.
  assert.equal(restarts, restartsBefore);
  assert.equal(accessRenders, accessBefore);

  // The Domains page: the language and a current rendering.
  const listed = (await call('GET', '/api/domains')).json().domains[0];
  assert.equal(listed.language, 'tr');
  assert.equal(listed.rendering.current, true);
  assert.equal(listed.rendering.rendered.language, 'tr');

  // The same again: nothing changes, nothing audited.
  const writes = vhostWrites.length;
  const again = await setLanguage(PRIMARY, 'tr');
  assert.equal(again.json().changed, false);
  assert.equal(vhostWrites.length, writes);
  assert.equal((await audits('domain.language.updated')).length, 1);
});

test('the reconcile keeps a language-only rendering, renders a stale one again', async () => {
  assert.deepEqual(await lib.reconcileAuthBranding(), { rendered: [], removed: [], failed: [] });
  // Another language on disk (a restored backup).
  const file = path.join(renderedDir(PRIMARY), 'rendered.json');
  const current = JSON.parse(await readFile(file, 'utf-8'));
  await writeFile(file, JSON.stringify({ ...current, language: 'en' }));
  assert.deepEqual(await lib.reconcileAuthBranding(), {
    rendered: [PRIMARY],
    removed: [],
    failed: [],
  });
  assert.equal((await readJson(PRIMARY, 'rendered.json')).language, 'tr');
  // A rendering gone: rendered again.
  await rm(renderedDir(PRIMARY));
  assert.deepEqual((await lib.reconcileAuthBranding()).rendered, [PRIMARY]);
  assert.equal((await readJson(PRIMARY, 'locales/forced/portal.json'))['Sign in'], 'Giriş yap');
});

test('a brand on a Turkish domain: brand-spliced forced files; removing the brand keeps the language', async () => {
  const branded = await call('PUT', `/api/domains/${PRIMARY}/branding`, {
    name: 'Alpha Works',
    theme: 'dark',
  });
  assert.equal(branded.statusCode, 200, branded.body);
  const rendered = await readJson(PRIMARY, 'rendered.json');
  assert.equal(rendered.revision, 1);
  assert.equal(rendered.language, 'tr');
  assert.equal(
    (await readJson(PRIMARY, 'locales/forced/portal.json'))['Powered by {{authelia}}'],
    'Altyapı: Alpha Works',
  );
  assert.match(await readRendered(PRIMARY, 'brand.css'), /#language-button/);
  assert.deepEqual(vhostWrites.at(-1), {
    domain: PRIMARY,
    primary: true,
    enabled: true,
    branding: { theme: 'dark', logo: false },
    language: 'tr',
  });

  const removed = await call('DELETE', `/api/domains/${PRIMARY}/branding`);
  assert.equal(removed.statusCode, 200);
  assert.equal(removed.json().warnings, undefined);
  // An unbranded rendering of the language stays.
  const after = await readJson(PRIMARY, 'rendered.json');
  assert.equal(after.revision, 0);
  assert.equal(after.language, 'tr');
  assert.equal(await exists(path.join(renderedDir(PRIMARY), 'brand.json')), false);
  assert.equal(
    (await readJson(PRIMARY, 'locales/forced/portal.json'))['Powered by {{authelia}}'],
    'Altyapı: {{authelia}}',
  );
  assert.deepEqual(vhostWrites.at(-1), {
    domain: PRIMARY,
    primary: true,
    enabled: true,
    branding: null,
    language: 'tr',
  });
});

test('a running Authelia that is not the pin: rendered from it, audited and notified once per version', async () => {
  autheliaVersion = '4.40.1';
  lib.setAuthBrandingForTests(overrides()); // forgets the version read
  const result = await lib.reconcileAuthBranding();
  assert.deepEqual(result.rendered, [PRIMARY]);
  const rendered = await readJson(PRIMARY, 'rendered.json');
  assert.equal(rendered.autheliaVersion, '4.40.1');
  assert.equal(rendered.autheliaPinned, PINNED);
  const flagged = await audits('authelia.version.unpinned');
  assert.equal(flagged.length, 1);
  assert.deepEqual(flagged[0].details, { running: '4.40.1', pinned: PINNED });
  const notes = (await lib.listNotifications({ limit: 50 })).notifications.filter((n) =>
    n.message.includes('Authelia 4.40.1'),
  );
  assert.equal(notes.length, 1);
  assert.deepEqual((await call('GET', '/api/domains')).json().authelia, {
    running: '4.40.1',
    pinned: PINNED,
  });

  // A restart (a fresh process reads the version again): not flagged twice.
  lib.setAuthBrandingForTests(overrides());
  assert.deepEqual((await lib.reconcileAuthBranding()).rendered, []);
  assert.equal((await audits('authelia.version.unpinned')).length, 1);

  // Back on the pin: rendered from it, nothing flagged.
  autheliaVersion = PINNED;
  lib.setAuthBrandingForTests(overrides());
  assert.deepEqual((await lib.reconcileAuthBranding()).rendered, [PRIMARY]);
  assert.equal((await audits('authelia.version.unpinned')).length, 1);
});

test('a pending domain: rendered at once, its vhost written at activation with the language', async () => {
  assert.equal((await call('POST', '/api/domains', { name: OTHER })).statusCode, 201);
  const writes = vhostWrites.length;
  const set = await setLanguage(OTHER, 'tr');
  assert.equal(set.statusCode, 200, set.body);
  assert.equal((await readJson(OTHER, 'rendered.json')).language, 'tr');
  // Not active: no vhost yet, and not in Gatekeeper's projection.
  assert.equal(vhostWrites.length, writes);
  assert.equal(
    (await projection()).domains.some((d) => d.name === OTHER),
    false,
  );

  const active = await call('POST', `/api/domains/${OTHER}/activate`);
  assert.equal(active.statusCode, 200, active.body);
  assert.deepEqual(vhostWrites.at(-1), {
    domain: OTHER,
    primary: false,
    enabled: true,
    branding: null,
    language: 'tr',
  });
  assert.equal((await projection()).domains.find((d) => d.name === OTHER).language, 'tr');
});

test('English forced, then cleared: the rendering goes with the last input, the vhost and projection follow', async () => {
  const en = await setLanguage(OTHER, 'en');
  assert.equal(en.statusCode, 200);
  assert.equal((await readJson(OTHER, 'locales/forced/portal.json'))['Sign in'], 'Sign in');
  assert.match(await readRendered(OTHER, 'invite/index.html'), /<html lang="en">/);
  assert.equal(vhostWrites.at(-1).language, 'en');

  const cleared = await setLanguage(OTHER, null);
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.json().domain.language, null);
  assert.equal(await exists(renderedDir(OTHER)), false);
  assert.deepEqual(vhostWrites.at(-1), {
    domain: OTHER,
    primary: false,
    enabled: true,
    branding: null,
    language: null,
  });
  assert.equal(
    installedVhosts.get(OTHER),
    renderAuthVhost(OTHER, certOf(OTHER), { primary: false }).config,
  );
  const entry = JSON.parse(
    await readFile(path.join(stateDir, 'domains.json'), 'utf-8'),
  ).domains.find((d) => d.name === OTHER);
  assert.equal('language' in entry, false);
  const audited = (await audits('domain.language.updated'))
    .filter((e) => e.details.domain === OTHER)
    .map((e) => [e.details.from, e.details.to]);
  assert.deepEqual(audited, [
    ['en', null],
    ['tr', 'en'],
    [null, 'tr'],
  ]);
});

test('a removed domain takes its language-only rendering with it', async () => {
  assert.equal((await setLanguage(OTHER, 'tr')).statusCode, 200);
  assert.equal(await exists(renderedDir(OTHER)), true);
  const removed = await call('DELETE', `/api/domains/${OTHER}`);
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(await exists(renderedDir(OTHER)), false);
  assert.deepEqual(await lib.reconcileAuthBranding(), { rendered: [], removed: [], failed: [] });
});
