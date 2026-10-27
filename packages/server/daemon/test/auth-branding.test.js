/**
 * A domain's brand on its auth pages (lib/auth-branding.js, the branding
 * routes of routes/management/domains.js): the record set, read without
 * its blobs, refused by field name without a value, guarded by revision;
 * the logo and favicon checked, stored by digest, audited by digest; every
 * change rendered under a temporary web root from a stand-in Authelia's
 * locales; a rendering that fails kept as a record with a warning, audited
 * once per streak and healed by the reconcile; the reconcile re-rendering
 * what is stale and removing what has no record; a removed domain taking
 * its brand and directory with it; the Authelia base audited when it
 * restarts. The auth vhost: rewritten — once, its link state kept — when
 * the theme or the logo switch changed and the domain is active, never for
 * any other change; a refused rewrite warned, audited once per streak and
 * retried by the reconcile until it converges.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { AUTH_BRANDING_LOGO_MAX_BYTES } from '@lamalibre/lamaste';
import { renderAuthBranding } from '@lamalibre/lamaste/server';

import { renderAuthVhost } from '../src/lib/nginx.js';

import { createFakeAutheliaStorage } from './fake-authelia-storage.js';
import { installFakeGatekeeper } from './fake-gatekeeper.js';

const HASH = '$2b$12$abcdefghijklmnopqrstuuJ2s4L6rjpDLHi3qL7Nn5D0o3M6a1g2a';
const PRIMARY = 'samplepark.tr';
const OTHER = 'codelama.com.tr';

let dir;
let stateDir;
let webRoot;
let lib;
let app;
/** How often the stand-in Authelia's locales were asked for. */
let localeFetches = 0;
/** Whether the stand-in Authelia answers its locales. */
let autheliaDown = false;
let autheliaVersion = '4.39.28';
/** What the Authelia base check answers. */
let base = { logoWritten: false, restarted: false };

/** The stand-in nginx: the installed auth vhost of each domain, what was written, whether a write fails. */
const installedVhosts = new Map();
const vhostWrites = [];
let failVhost = false;
let vhostLinked = true;
const PRIMARY_CERT = `/etc/letsencrypt/live/auth.${PRIMARY}`;
const fakeVhost = {
  readInstalled: async (domain) => installedVhosts.get(domain) ?? null,
  isEnabled: async () => vhostLinked,
  write: async (domain, opts) => {
    if (failVhost) throw new Error('nginx site write failed: lamaste-priv: vhost line 7: refused');
    vhostWrites.push({ domain, ...opts });
    installedVhosts.set(domain, renderAuthVhost(domain, PRIMARY_CERT, opts).config);
  },
};
/** The overrides every test runs with. */
const overrides = () => ({
  webRoot,
  get autheliaVersion() {
    return autheliaVersion;
  },
  fetchLocales: fakeLocales,
  ensureBase: async () => base,
  vhost: fakeVhost,
});

function png(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]),
    Buffer.from('IHDR', 'latin1'),
    ihdr,
    Buffer.from([1, 2, 3, 4]),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('IEND', 'latin1'),
    Buffer.from([0xae, 0x42, 0x60, 0x82]),
  ]);
}

function ico() {
  const directory = Buffer.alloc(16);
  directory[0] = 16;
  directory[1] = 16;
  directory.writeUInt16LE(1, 4);
  directory.writeUInt16LE(32, 6);
  directory.writeUInt32LE(40, 8);
  directory.writeUInt32LE(22, 12);
  return Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0]), directory, Buffer.alloc(40, 9)]);
}

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

/** The stand-in Authelia's locales: two languages, the brand-bearing keys. */
async function fakeLocales() {
  localeFetches += 1;
  if (autheliaDown) throw new Error('connect ECONNREFUSED 127.0.0.1:9091');
  const ns = ['portal', 'settings'];
  return {
    languages: [
      { locale: 'en', namespaces: ns },
      { locale: 'tr-TR', namespaces: ['portal'] },
    ],
    files: [
      {
        locale: 'en',
        namespace: 'portal',
        messages: {
          'Login - {{authelia}}': 'Login - {{authelia}}',
          'Powered by {{authelia}}': 'Powered by {{authelia}}',
          'Sign in': 'Sign in',
        },
      },
      {
        locale: 'en',
        namespace: 'settings',
        messages: { 'Settings - {{authelia}}': 'Settings - {{authelia}}' },
      },
      {
        locale: 'tr-TR',
        namespace: 'portal',
        messages: { 'Login - {{authelia}}': 'Giriş - {{authelia}}', Password: 'Şifre' },
      },
    ],
  };
}

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

const audits = (action) => lib.listAudit({ action, limit: 200 });
const renderedDir = (domain) => path.join(webRoot, domain);
const readRendered = async (domain, file) => readFile(path.join(renderedDir(domain), file));
const exists = (p) =>
  lstat(p)
    .then(() => true)
    .catch(() => false);

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-auth-branding-'));
  stateDir = path.join(dir, 'state');
  webRoot = path.join(dir, 'www', 'auth');
  await mkdir(stateDir);
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
      email: 'ops@samplepark.tr',
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
          email: 'admin@samplepark.tr',
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
  };
  await lib.loadConfig();
  lib.setAutheliaForTests({
    usersFile,
    restart: async () => {},
    writeTotp: async () => {},
    userStorage: createFakeAutheliaStorage().storage,
    domainAccess: async () => ({ changed: false }),
    oidcProvider: async (domains, clients) => ({ changed: false, clients: clients.length }),
  });
  lib.setDomainActivationForTests({
    issueCert: async () => {},
    writeAuthVhost: async () => {},
    removeAuthVhost: async () => {},
  });
  lib.setAuthBrandingForTests(overrides());
  installFakeGatekeeper(lib);
  await lib.reconcileDirectory({ confirmDelayMs: 0 });
  await lib.ensurePrimaryDomain();
  // The primary's auth vhost as the relay wrote it before any brand.
  installedVhosts.set(
    PRIMARY,
    renderAuthVhost(PRIMARY, PRIMARY_CERT, { primary: true, branding: null }).config,
  );
  // As the panel's start does, before anything renders.
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

test('no brand: null for a domain, unknown_domain for a name the relay does not have', async () => {
  const none = await call('GET', `/api/domains/${PRIMARY}/branding`);
  assert.equal(none.statusCode, 200);
  assert.deepEqual(none.json(), { branding: null });
  const unknown = await call('GET', '/api/domains/nobody.example/branding');
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().code, 'unknown_domain');
  assert.equal(
    (await call('PUT', '/api/domains/nobody.example/branding', { name: 'X' })).statusCode,
    404,
  );
  assert.equal((await call('GET', '/api/domains/nobody.example/branding/preview')).statusCode, 404);
});

test('the fields: created at revision 1, rendered at once, read without blobs, refused by field name without a value', async () => {
  const created = await call('PUT', `/api/domains/${PRIMARY}/branding`, {
    name: 'samplepark',
    theme: 'dark',
    accent: '#22d3ee',
    supportEmail: 'help@samplepark.tr',
  });
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(created.json().created, true);
  const { branding } = created.json();
  assert.equal(branding.revision, 1);
  assert.equal(branding.name, 'samplepark');
  assert.equal(branding.tagline, null);
  assert.equal(branding.logo, null);
  assert.equal(branding.favicon, null);
  assert.equal(branding.rendered.revision, 1);
  assert.equal(branding.rendered.autheliaVersion, '4.39.28');
  assert.equal(branding.renderedCurrent, true);
  assert.equal(created.json().warnings, undefined);
  // The auth vhost rewritten once for the theme: the primary's, linked as it
  // is, no logo yet.
  assert.deepEqual(vhostWrites, [
    { domain: PRIMARY, primary: true, enabled: true, branding: { theme: 'dark', logo: false } },
  ]);
  assert.match(installedVhosts.get(PRIMARY), /data-theme="dark"/);
  assert.deepEqual(await lib.authVhostBranding(PRIMARY), { theme: 'dark', logo: false });

  // Rendered under the web root: the locales with the name spliced in, the stylesheet, brand.json.
  const tr = JSON.parse(await readRendered(PRIMARY, 'locales/tr-TR/portal.json'));
  assert.equal(tr['Login - {{authelia}}'], 'Giriş - samplepark');
  const settings = JSON.parse(await readRendered(PRIMARY, 'locales/en/settings.json'));
  assert.equal(settings['Settings - {{authelia}}'], 'Settings - samplepark');
  assert.ok((await readRendered(PRIMARY, 'brand.css')).includes('--primary: #22d3ee !important'));
  const brandJson = JSON.parse(await readRendered(PRIMARY, 'brand.json'));
  assert.equal(brandJson.name, 'samplepark');
  assert.equal(brandJson.theme, 'dark');
  assert.equal(brandJson.supportEmail, 'help@samplepark.tr');
  assert.equal(brandJson.logo, null);
  assert.equal(await exists(path.join(renderedDir(PRIMARY), 'static/media/logo.png')), false);
  // The entry is a link to the rendering directory (switched in one rename).
  assert.ok((await lstat(renderedDir(PRIMARY))).isSymbolicLink());
  assert.equal((await stat(renderedDir(PRIMARY))).mode & 0o777, 0o750);
  assert.equal((await lstat(path.join(renderedDir(PRIMARY), 'brand.json'))).mode & 0o777, 0o640);

  const audit = (await audits('domain.branding.updated')).at(0);
  assert.equal(audit.actor, 'admin');
  assert.deepEqual(audit.details, {
    domain: PRIMARY,
    fields: ['name', 'tagline', 'theme', 'accent', 'supportEmail', 'supportUrl'],
    revision: 1,
    created: true,
  });

  // Read: the same view.
  const read = (await call('GET', `/api/domains/${PRIMARY}/branding`)).json().branding;
  assert.equal(read.revision, 1);
  assert.equal(read.accent, '#22d3ee');

  // Refused: by field, never the value; nothing written.
  const bad = await call('PUT', `/api/domains/${PRIMARY}/branding`, {
    name: 'sample{{park}}',
    theme: 'solarized',
    accent: '#ABCDEF',
    supportUrl: 'http://samplepark.tr',
    css: 'body {}',
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().code, 'invalid_branding');
  assert.deepEqual(
    bad
      .json()
      .errors.map((e) => e.field)
      .sort(),
    ['accent', 'css', 'name', 'supportUrl', 'theme'],
  );
  assert.ok(!bad.body.includes('solarized') && !bad.body.includes('ABCDEF'));
  assert.equal((await call('GET', `/api/domains/${PRIMARY}/branding`)).json().branding.revision, 1);
  assert.equal((await call('PUT', `/api/domains/${PRIMARY}/branding`, ['x'])).statusCode, 400);

  // The same fields again: nothing changes, no revision, no audit.
  const same = await call('PUT', `/api/domains/${PRIMARY}/branding`, {
    name: 'samplepark',
    theme: 'dark',
    accent: '#22d3ee',
    supportEmail: 'help@samplepark.tr',
  });
  assert.equal(same.json().changed, false);
  assert.equal(same.json().branding.revision, 1);
  assert.equal((await audits('domain.branding.updated')).length, 1);

  // A stale revision is refused with the current one; the right one passes and bumps.
  const stale = await call('PUT', `/api/domains/${PRIMARY}/branding`, {
    name: 'Sample Park',
    theme: 'dark',
    ifRevision: 7,
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, 'revision_mismatch');
  assert.equal(stale.json().revision, 1);
  const renamed = await call('PUT', `/api/domains/${PRIMARY}/branding`, {
    name: 'Sample Park',
    theme: 'dark',
    ifRevision: 1,
  });
  assert.equal(renamed.statusCode, 200, renamed.body);
  assert.equal(renamed.json().branding.revision, 2);
  assert.equal(renamed.json().branding.accent, null);
  assert.deepEqual((await audits('domain.branding.updated')).at(0).details.fields, [
    'name',
    'accent',
    'supportEmail',
  ]);
  assert.equal(
    JSON.parse(await readRendered(PRIMARY, 'locales/en/portal.json'))['Login - {{authelia}}'],
    'Login - Sample Park',
  );
  assert.ok(!(await readRendered(PRIMARY, 'brand.css')).includes('[data-theme]'));
  // Authelia's locales were fetched once: they are cached.
  assert.equal(localeFetches, 1);
  // The name and the accent are files nginx serves; the vhost says the same.
  assert.equal(vhostWrites.length, 1);
});

test('the logo and the favicon: checked, stored and audited by digest, served from the rendering, removed', async () => {
  const logo = png(300, 100);
  const set = await call('PUT', `/api/domains/${PRIMARY}/branding/logo`, {
    data: logo.toString('base64'),
    ifRevision: 2,
  });
  assert.equal(set.statusCode, 200, set.body);
  const { branding } = set.json();
  assert.equal(branding.revision, 3);
  assert.equal(branding.logo.width, 300);
  assert.equal(branding.logo.height, 100);
  assert.equal(branding.logo.bytes, logo.length);
  assert.equal(branding.logo.format, 'png');
  assert.equal(branding.logo.sha256.length, 64);
  assert.equal(branding.logo.data, undefined);
  assert.ok((await readRendered(PRIMARY, 'static/media/logo.png')).equals(logo));
  // The first logo switches the page's logo on: the vhost rewritten once.
  assert.equal(vhostWrites.length, 2);
  assert.deepEqual(vhostWrites.at(-1).branding, { theme: 'dark', logo: true });
  assert.match(installedVhosts.get(PRIMARY), /data-logooverride="true"/);
  const audit = (await audits('domain.branding.updated')).at(0);
  assert.equal(audit.details.asset, 'logo');
  assert.equal(audit.details.sha256, branding.logo.sha256);
  assert.equal(audit.details.width, 300);
  assert.ok(!JSON.stringify(audit).includes(logo.toString('base64').slice(0, 40)));
  // The same bytes again: no change.
  const again = await call('PUT', `/api/domains/${PRIMARY}/branding/logo`, {
    data: logo.toString('base64'),
  });
  assert.equal(again.json().changed, false);
  assert.equal(again.json().branding.revision, 3);

  // Refusals: an SVG, a JPEG, a logo that is not base64, a stale revision, an oversized one.
  const svg = await call('PUT', `/api/domains/${PRIMARY}/branding/logo`, {
    data: SVG.toString('base64'),
  });
  assert.equal(svg.statusCode, 400);
  assert.deepEqual([svg.json().code, svg.json().reason], ['invalid_image', 'not_png']);
  const notBase64 = await call('PUT', `/api/domains/${PRIMARY}/branding/logo`, {
    data: 'not base64!',
  });
  assert.equal(notBase64.statusCode, 400);
  assert.equal(notBase64.json().reason, 'not_base64');
  const stale = await call('PUT', `/api/domains/${PRIMARY}/branding/logo`, {
    data: png(1, 1).toString('base64'),
    ifRevision: 1,
  });
  assert.equal(stale.statusCode, 409);
  const tooWide = await call('PUT', `/api/domains/${PRIMARY}/branding/logo`, {
    data: png(2000, 10).toString('base64'),
  });
  assert.equal(tooWide.statusCode, 400);
  assert.equal(tooWide.json().reason, 'bad_image');
  // Over the limit as base64 text: refused before decoding (413).
  const oversized = await call('PUT', `/api/domains/${PRIMARY}/branding/logo`, {
    data: 'A'.repeat(Math.ceil(AUTH_BRANDING_LOGO_MAX_BYTES / 3) * 4 + 4),
  });
  assert.equal(oversized.statusCode, 413);
  assert.equal(oversized.json().code, 'asset_too_large');
  // Far over the route's body limit: Fastify refuses the body itself.
  const huge = await call('PUT', `/api/domains/${PRIMARY}/branding/logo`, {
    data: 'A'.repeat(AUTH_BRANDING_LOGO_MAX_BYTES * 2),
  });
  assert.equal(huge.statusCode, 413);
  assert.equal((await call('GET', `/api/domains/${PRIMARY}/branding`)).json().branding.revision, 3);
  assert.equal(
    (await call('PUT', `/api/domains/${PRIMARY}/branding/banner`, { data: 'AAAA' })).statusCode,
    400,
  );

  // The favicon: an ICO; then removed.
  const favicon = await call('PUT', `/api/domains/${PRIMARY}/branding/favicon`, {
    data: ico().toString('base64'),
  });
  assert.equal(favicon.statusCode, 200, favicon.body);
  assert.equal(favicon.json().branding.revision, 4);
  assert.equal(favicon.json().branding.favicon.format, 'ico');
  assert.ok((await readRendered(PRIMARY, 'favicon.ico')).equals(ico()));
  assert.equal(JSON.parse(await readRendered(PRIMARY, 'brand.json')).favicon.sha256.length, 64);
  const bigFavicon = await call('PUT', `/api/domains/${PRIMARY}/branding/favicon`, {
    data: png(512, 512).toString('base64'),
  });
  assert.equal(bigFavicon.statusCode, 400);
  const removed = await call('DELETE', `/api/domains/${PRIMARY}/branding/favicon`);
  assert.equal(removed.statusCode, 200);
  assert.equal(removed.json().removed, true);
  assert.equal(removed.json().branding.revision, 5);
  assert.equal(removed.json().branding.favicon, null);
  assert.equal(await exists(path.join(renderedDir(PRIMARY), 'favicon.ico')), false);
  assert.equal((await audits('domain.branding.updated')).at(0).details.removed, true);
  assert.equal(
    (await call('DELETE', `/api/domains/${PRIMARY}/branding/favicon`)).json().removed,
    false,
  );
  // The logo stays through it all; the favicon is a file alone, the vhost untouched.
  assert.ok((await readRendered(PRIMARY, 'static/media/logo.png')).equals(logo));
  assert.equal(vhostWrites.length, 2);
});

test('the auth vhost: untouched by a change it does not say; a refused rewrite warned, audited once per streak, retried by the reconcile until it converges; its link state kept', async () => {
  const { listNotifications } = await import('../src/lib/notifications.js');
  assert.equal(await lib.authVhostBranding('nobody.example'), null);
  const writesBefore = vhostWrites.length;
  const revision = (await call('GET', `/api/domains/${PRIMARY}/branding`)).json().branding.revision;

  // The tagline, the support contact: files; nginx is not asked anything.
  const tagline = await call('PUT', `/api/domains/${PRIMARY}/branding`, {
    name: 'Sample Park',
    tagline: 'Parks of the sample',
    theme: 'dark',
    supportEmail: 'help@samplepark.tr',
  });
  assert.equal(tagline.statusCode, 200, tagline.body);
  assert.equal(tagline.json().branding.revision, revision + 1);
  assert.equal(vhostWrites.length, writesBefore);

  // nginx refuses the theme change: the record moves on, the answer warns,
  // the streak is audited and raised once, the rendering is current.
  failVhost = true;
  const grey = await call('PUT', `/api/domains/${PRIMARY}/branding`, {
    name: 'Sample Park',
    theme: 'grey',
  });
  assert.equal(grey.statusCode, 200, grey.body);
  assert.equal(grey.json().branding.revision, revision + 2);
  assert.equal(grey.json().branding.renderedCurrent, true);
  assert.deepEqual(
    grey.json().warnings.map((w) => w.step),
    ['vhost'],
  );
  assert.match(grey.json().warnings[0].message, /keeps its previous theme/);
  assert.equal(JSON.parse(await readRendered(PRIMARY, 'brand.json')).theme, 'grey');
  assert.match(installedVhosts.get(PRIMARY), /data-theme="dark"/, 'the previous vhost stays');
  const oled = await call('PUT', `/api/domains/${PRIMARY}/branding`, {
    name: 'Sample Park',
    theme: 'oled',
  });
  assert.equal(oled.json().warnings[0].step, 'vhost');
  const failed = (await audits('domain.branding.vhost.failed')).filter(
    (e) => e.details.domain === PRIMARY,
  );
  assert.equal(failed.length, 1);
  assert.match(failed[0].details.message, /lamaste-priv/);
  assert.ok(!JSON.stringify(failed).includes('Sample Park'));
  const notes = await listNotifications({ limit: 10 });
  assert.ok(
    notes.notifications.some(
      (n) => n.level === 'warning' && n.message.includes(PRIMARY) && /theme/.test(n.message),
    ),
  );

  // The tick: still refused, named as failing; then accepted, rewritten from
  // the record as it is now (oled, with the logo), recovered once, and
  // nothing to do afterwards.
  assert.deepEqual(await lib.reconcileAuthBranding(), {
    rendered: [],
    removed: [],
    failed: [],
    vhostsFailed: [PRIMARY],
  });
  assert.equal(vhostWrites.length, writesBefore);
  failVhost = false;
  assert.deepEqual(await lib.reconcileAuthBranding(), {
    rendered: [],
    removed: [],
    failed: [],
    vhostsRewritten: [PRIMARY],
  });
  assert.equal(vhostWrites.length, writesBefore + 1);
  assert.deepEqual(vhostWrites.at(-1), {
    domain: PRIMARY,
    primary: true,
    enabled: true,
    branding: { theme: 'oled', logo: true },
  });
  assert.equal(
    (await audits('domain.branding.vhost.recovered')).filter((e) => e.details.domain === PRIMARY)
      .length,
    1,
  );
  assert.deepEqual(await lib.reconcileAuthBranding(), { rendered: [], removed: [], failed: [] });
  assert.equal(vhostWrites.length, writesBefore + 1);

  // A vhost someone unlinked is rewritten unlinked.
  vhostLinked = false;
  const dark = await call('PUT', `/api/domains/${PRIMARY}/branding`, {
    name: 'Sample Park',
    theme: 'dark',
  });
  assert.equal(dark.json().warnings, undefined);
  assert.equal(vhostWrites.at(-1).enabled, false);
  vhostLinked = true;

  // The vhost of an active domain not installed at all: nothing written, no
  // retry — the start's vhost reconcile reports it.
  const installed = installedVhosts.get(PRIMARY);
  installedVhosts.delete(PRIMARY);
  const grey2 = await call('PUT', `/api/domains/${PRIMARY}/branding`, {
    name: 'Sample Park',
    theme: 'grey',
  });
  assert.equal(grey2.json().warnings, undefined);
  assert.equal(vhostWrites.length, writesBefore + 2);
  assert.deepEqual(await lib.reconcileAuthBranding(), { rendered: [], removed: [], failed: [] });
  installedVhosts.set(PRIMARY, installed);
  // Back to dark: the installed text already says so — nothing written.
  await call('PUT', `/api/domains/${PRIMARY}/branding`, { name: 'Sample Park', theme: 'dark' });
  assert.equal(vhostWrites.length, writesBefore + 2);
});

test('the preview: the rendered stylesheet and the English title and footer', async () => {
  const preview = await call('GET', `/api/domains/${PRIMARY}/branding/preview`);
  assert.equal(preview.statusCode, 200, preview.body);
  assert.deepEqual(preview.json(), {
    locale: 'en',
    css: await readRendered(PRIMARY, 'brand.css').then(String),
    title: 'Login - Sample Park',
    footer: 'Powered by Sample Park',
    theme: 'dark',
    logo: true,
    favicon: false,
  });
});

test('an asset before the fields: no_branding; the brand of a pending domain renders too', async () => {
  assert.equal((await call('POST', '/api/domains', { name: OTHER })).statusCode, 201);
  const early = await call('PUT', `/api/domains/${OTHER}/branding/logo`, {
    data: png(1, 1).toString('base64'),
  });
  assert.equal(early.statusCode, 404);
  assert.equal(early.json().code, 'no_branding');
  assert.equal((await call('DELETE', `/api/domains/${OTHER}/branding/logo`)).statusCode, 404);
  assert.equal(
    (await call('GET', `/api/domains/${OTHER}/branding/preview`)).json().code,
    'no_branding',
  );
  const set = await call('PUT', `/api/domains/${OTHER}/branding`, {
    name: 'Code Lama',
    accent: '#1d4ed8',
  });
  assert.equal(set.statusCode, 200, set.body);
  assert.equal(
    JSON.parse(await readRendered(OTHER, 'locales/en/portal.json'))['Login - {{authelia}}'],
    'Login - Code Lama',
  );
  // Pending: no auth vhost yet — activation writes it from the record.
  assert.ok(vhostWrites.every((w) => w.domain !== OTHER));
});

test('a rendering that fails keeps the record and warns; the streak is audited once and healed by the reconcile', async () => {
  autheliaDown = true;
  lib.setAuthBrandingForTests(overrides()); // forgets the locale cache
  const first = await call('PUT', `/api/domains/${OTHER}/branding`, {
    name: 'Code Lama',
    theme: 'oled',
  });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().branding.revision, 2);
  assert.equal(first.json().branding.renderedCurrent, false);
  assert.equal(first.json().branding.rendered.revision, 1);
  assert.equal(first.json().warnings[0].step, 'render');
  const second = await call('PUT', `/api/domains/${OTHER}/branding`, {
    name: 'Code Lama',
    theme: 'grey',
  });
  assert.equal(second.json().warnings[0].step, 'render');
  const failed = (await audits('domain.branding.render.failed')).filter(
    (e) => e.details.domain === OTHER,
  );
  assert.equal(failed.length, 1);
  assert.ok(failed[0].details.message.includes('ECONNREFUSED'));
  assert.ok(!JSON.stringify(failed[0]).includes('Code Lama'));
  const { listNotifications } = await import('../src/lib/notifications.js');
  const notes = await listNotifications({ limit: 10 });
  assert.ok(notes.notifications.some((n) => n.message.includes(OTHER) && n.level === 'warning'));
  // The directory nginx serves is the last good one.
  assert.equal(JSON.parse(await readRendered(OTHER, 'brand.json')).revision, 1);

  // Tick: still down, nothing new audited; then up, rendered and recovered once.
  assert.deepEqual(await lib.reconcileAuthBranding(), {
    rendered: [],
    removed: [],
    failed: [OTHER],
  });
  assert.equal(
    (await audits('domain.branding.render.failed')).filter((e) => e.details.domain === OTHER)
      .length,
    1,
  );
  autheliaDown = false;
  assert.deepEqual(await lib.reconcileAuthBranding(), {
    rendered: [OTHER],
    removed: [],
    failed: [],
  });
  assert.equal(JSON.parse(await readRendered(OTHER, 'brand.json')).revision, 3);
  assert.equal(JSON.parse(await readRendered(OTHER, 'brand.json')).theme, 'grey');
  assert.equal(
    (await audits('domain.branding.render.recovered')).filter((e) => e.details.domain === OTHER)
      .length,
    1,
  );
  assert.equal(
    (await call('GET', `/api/domains/${OTHER}/branding`)).json().branding.renderedCurrent,
    true,
  );
});

test('the reconcile: a stale revision or Authelia release re-rendered, a directory without a record removed, nothing else touched', async () => {
  assert.deepEqual(await lib.reconcileAuthBranding(), { rendered: [], removed: [], failed: [] });
  // Another revision on disk (a restored backup).
  const renderedFile = path.join(renderedDir(PRIMARY), 'rendered.json');
  const current = JSON.parse(await readFile(renderedFile, 'utf-8'));
  await writeFile(renderedFile, JSON.stringify({ ...current, revision: 99 }));
  // A rendering of a domain without a record (removed while the panel was down).
  await renderAuthBranding({
    domain: 'gone.example',
    brand: {
      name: 'Gone',
      tagline: null,
      theme: 'light',
      accent: null,
      supportEmail: null,
      supportUrl: null,
    },
    revision: 1,
    logo: null,
    favicon: null,
    locales: await fakeLocales(),
    autheliaVersion: '4.39.28',
    root: webRoot,
  });
  assert.deepEqual(await lib.reconcileAuthBranding(), {
    rendered: [PRIMARY],
    removed: ['gone.example'],
    failed: [],
  });
  assert.equal(JSON.parse(await readFile(renderedFile, 'utf-8')).revision, current.revision);
  assert.equal(await exists(path.join(webRoot, 'gone.example')), false);
  // A pin bump: every brand rendered again from the new release's locales.
  autheliaVersion = '4.39.29';
  const before = localeFetches;
  assert.deepEqual(await lib.reconcileAuthBranding(), {
    rendered: [OTHER, PRIMARY],
    removed: [],
    failed: [],
  });
  assert.equal(JSON.parse(await readFile(renderedFile, 'utf-8')).autheliaVersion, '4.39.29');
  assert.equal(localeFetches, before);
  assert.deepEqual(await lib.reconcileAuthBranding(), { rendered: [], removed: [], failed: [] });
});

test('removing the brand: the record and the directory go, audited; a removed domain takes its brand with it', async () => {
  const removed = await call('DELETE', `/api/domains/${PRIMARY}/branding`);
  assert.equal(removed.statusCode, 200);
  assert.equal(removed.json().removed, true);
  assert.equal(await exists(renderedDir(PRIMARY)), false);
  // The vhost back to the stock page.
  assert.deepEqual(vhostWrites.at(-1), {
    domain: PRIMARY,
    primary: true,
    enabled: true,
    branding: null,
  });
  assert.equal(
    installedVhosts.get(PRIMARY),
    renderAuthVhost(PRIMARY, PRIMARY_CERT, { primary: true, branding: null }).config,
  );
  assert.deepEqual(await call('GET', `/api/domains/${PRIMARY}/branding`).then((r) => r.json()), {
    branding: null,
  });
  assert.equal((await audits('domain.branding.removed')).at(0).details.domain, PRIMARY);
  assert.equal((await call('DELETE', `/api/domains/${PRIMARY}/branding`)).json().removed, false);

  assert.equal(await exists(renderedDir(OTHER)), true);
  const domainGone = await call('DELETE', `/api/domains/${OTHER}`);
  assert.equal(domainGone.statusCode, 200, domainGone.body);
  assert.equal(await exists(renderedDir(OTHER)), false);
  const db = await lib.getStateDb();
  assert.equal(db.prepare('SELECT 1 FROM domain_branding WHERE domain = ?').get(OTHER), undefined);
  const audit = (await audits('domain.branding.removed')).at(0);
  assert.deepEqual(audit.details, { domain: OTHER, reason: 'domain-removed' });
  // Nothing served, nothing kept: only the (empty) renders directory remains.
  assert.deepEqual(await readdir(webRoot), ['.renders']);
  assert.deepEqual(await readdir(path.join(webRoot, '.renders')), []);
});

test('the Authelia base: audited as a restart when the keys were added, silent otherwise; nothing rendered until it is in place', async () => {
  lib.setAuthBrandingForTests(null);
  let baseFails = true;
  lib.setAuthBrandingForTests({
    ...overrides(),
    ensureBase: async () => {
      if (baseFails) throw new Error('/etc/authelia is not writable');
      return base;
    },
  });
  // The start's attempt failed: the tick tries again, and renders nothing meanwhile.
  await assert.rejects(lib.ensureBrandingBase(), /not writable/);
  assert.deepEqual(await lib.reconcileAuthBranding(), {
    rendered: [],
    removed: [],
    failed: [],
    skipped: 'base',
  });
  baseFails = false;
  base = { logoWritten: true, restarted: true };
  assert.deepEqual(await lib.reconcileAuthBranding(), { rendered: [], removed: [], failed: [] });
  const restarted = (await audits('authelia.restarted')).filter(
    (e) => e.details.reason === 'branding-base',
  );
  assert.equal(restarted.length, 1);
  base = { logoWritten: false, restarted: false };
  await lib.ensureBrandingBase();
  assert.equal(
    (await audits('authelia.restarted')).filter((e) => e.details.reason === 'branding-base').length,
    1,
  );
});
