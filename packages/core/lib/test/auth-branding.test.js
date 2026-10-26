/**
 * Per-domain branding of the auth pages (docs/auth-branding-design.md):
 * the brand record's rules, the image checks, the locale and stylesheet
 * rendering pinned against Authelia 4.39.28's theme contract, the rendered
 * directory under a temporary web root, Authelia's locale list, and the
 * configuration additions (`server.asset_path`, `theme`) with the one
 * restart they take.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import {
  AUTHELIA_RELEASE,
  AUTH_BRANDING_FAVICON_MAX_BYTES,
  AUTH_BRANDING_FILES,
  AUTH_BRANDING_LOGO_MAX_BYTES,
  AUTH_BRANDING_THEMES,
  BRAND_CSS_ACCENT_PROPERTIES,
  BRAND_CSS_FOOTER_SELECTOR,
  accentForeground,
  authBrandingLocaleFile,
  inspectBrandFavicon,
  inspectBrandLogo,
  renderBrandCss,
  renderBrandLocale,
  validateBrandFields,
} from '../dist/index.js';
import {
  AUTHELIA_ASSET_PATH,
  AUTHELIA_THEME_DEFAULT,
  autheliaBrandingConfigured,
  ensureAutheliaBrandingBase,
  ensureAutheliaBrandingConfig,
  fetchAutheliaLocales,
  listRenderedBrands,
  parseAutheliaLocalesList,
  readRenderedBrand,
  removeAuthBranding,
  renderAuthBranding,
  writeAutheliaConfig,
} from '../dist/server/index.js';

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const readFixtureJson = async (name) => JSON.parse(await readFile(fixture(name), 'utf-8'));
const PINNED = AUTHELIA_RELEASE.version;

/** A whole PNG as the inspectors read one: signature, IHDR (width, height), IEND. */
function png(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const chunk = (type, data) =>
    Buffer.concat([
      Buffer.from([0, 0, 0, data.length]),
      Buffer.from(type, 'latin1'),
      data,
      Buffer.from([0xde, 0xad, 0xbe, 0xef]),
    ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    Buffer.concat([
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('IEND', 'latin1'),
      Buffer.from([0xae, 0x42, 0x60, 0x82]),
    ]),
  ]);
}

/** An ICO with one 16×16 entry whose image bytes are inside the file (or not). */
function ico({ entries = 1, imageBytes = 40, overflow = false } = {}) {
  const header = Buffer.from([0, 0, 1, 0, entries & 0xff, entries >> 8]);
  const directory = Buffer.alloc(16 * entries);
  let offset = 6 + 16 * entries;
  for (let i = 0; i < entries; i += 1) {
    directory[16 * i] = 16;
    directory[16 * i + 1] = 16;
    directory.writeUInt16LE(1, 16 * i + 4);
    directory.writeUInt16LE(32, 16 * i + 6);
    directory.writeUInt32LE(imageBytes + (overflow ? 1 : 0), 16 * i + 8);
    directory.writeUInt32LE(offset, 16 * i + 12);
    offset += imageBytes;
  }
  return Buffer.concat([header, directory, Buffer.alloc(imageBytes * entries, 7)]);
}

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

// --- the fields -----------------------------------------------------------

test('a brand name: 1–64 printable characters, no control, bidi or invisible characters, no < > { }', () => {
  const ok = validateBrandFields({ name: 'Code Lama' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, {
    name: 'Code Lama',
    tagline: null,
    theme: 'light',
    accent: null,
    supportEmail: null,
    supportUrl: null,
  });
  assert.equal(validateBrandFields({ name: 'Çağrı Şirketi — İstanbul' }).ok, true);
  assert.equal(validateBrandFields({ name: 'サンプル' }).ok, true);
  for (const bad of [
    '',
    ' Code Lama',
    'Code Lama ',
    'x'.repeat(65),
    'Code\u0000Lama',
    'Code\tLama',
    'Code‮Lama', // right-to-left override
    'Code​Lama', // zero width space
    'Code⁦Lama', // isolate
    '{{authelia}}',
    'Code {Lama}',
    '<b>Code</b>',
    'a > b',
    42,
    null,
    undefined,
  ]) {
    const result = validateBrandFields({ name: bad });
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.ok(result.errors.some((e) => e.field === 'name'));
    // Never the value.
    if (typeof bad === 'string' && bad.length > 0) {
      assert.ok(result.errors.every((e) => !e.message.includes(bad)));
    }
  }
});

test('the other fields: tagline ≤ 160, theme one of Authelia’s, accent #rrggbb, support e-mail and https URL; unknown fields refused', () => {
  const full = validateBrandFields({
    name: 'Code Lama',
    tagline: 'Indie software, Istanbul',
    theme: 'dark',
    accent: '#22d3ee',
    supportEmail: 'support@codelama.com.tr',
    supportUrl: 'https://codelama.com.tr/support',
  });
  assert.equal(full.ok, true);
  assert.equal(full.value.theme, 'dark');
  assert.equal(full.value.accent, '#22d3ee');
  // null clears, as absent does.
  assert.equal(validateBrandFields({ name: 'x', tagline: null, accent: null }).ok, true);
  for (const theme of AUTH_BRANDING_THEMES) {
    assert.equal(validateBrandFields({ name: 'x', theme }).ok, true, theme);
  }
  const refused = (fields) => {
    const result = validateBrandFields({ name: 'Code Lama', ...fields });
    assert.equal(result.ok, false, JSON.stringify(fields));
    return result.errors;
  };
  assert.deepEqual(
    refused({ tagline: 'x'.repeat(161) }).map((e) => e.field),
    ['tagline'],
  );
  assert.deepEqual(
    refused({ tagline: 'a {{b}}' }).map((e) => e.field),
    ['tagline'],
  );
  const theme = refused({ theme: 'solarized' });
  assert.deepEqual(
    theme.map((e) => e.field),
    ['theme'],
  );
  assert.ok(!theme[0].message.includes('solarized'));
  for (const accent of ['#ABCDEF', '22d3ee', '#22d3e', 'red', '#22d3ee;', 'url(x)']) {
    assert.deepEqual(
      refused({ accent }).map((e) => e.field),
      ['accent'],
      accent,
    );
  }
  for (const supportEmail of ['nope', '-x@example.com', 'a@b', 'a b@example.com']) {
    assert.deepEqual(
      refused({ supportEmail }).map((e) => e.field),
      ['supportEmail'],
      supportEmail,
    );
  }
  for (const supportUrl of [
    'http://codelama.com.tr',
    'javascript:alert(1)',
    'https://user:pw@codelama.com.tr/',
    'https://',
    `https://codelama.com.tr/${'x'.repeat(600)}`,
    'https://codelama.com.tr/a b',
    'https://codelama.com.tr/<x>',
  ]) {
    assert.deepEqual(
      refused({ supportUrl }).map((e) => e.field),
      ['supportUrl'],
      supportUrl,
    );
  }
  assert.deepEqual(
    refused({ css: 'body{}' }).map((e) => e.field),
    ['css'],
  );
  assert.equal(validateBrandFields(['x']).ok, false);
  assert.equal(validateBrandFields('x').ok, false);
});

// --- the images ----------------------------------------------------------

test('a logo is a PNG of at most 512 KiB and 1024 pixels a side; SVG, JPEG, a truncated or oversized file are refused', () => {
  assert.deepEqual(inspectBrandLogo(png(400, 120)), {
    ok: true,
    format: 'png',
    width: 400,
    height: 120,
    bytes: png(400, 120).length,
  });
  assert.equal(inspectBrandLogo(png(1024, 1024)).ok, true);
  assert.equal(inspectBrandLogo(png(1025, 10)).reason, 'bad_image');
  assert.equal(inspectBrandLogo(png(10, 2000)).reason, 'bad_image');
  assert.equal(inspectBrandLogo(SVG).reason, 'not_png');
  assert.equal(
    inspectBrandLogo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])).reason,
    'not_png',
  );
  assert.equal(inspectBrandLogo(png(10, 10).subarray(0, 30)).reason, 'not_png');
  assert.equal(inspectBrandLogo(Buffer.alloc(0)).reason, 'empty');
  const big = Buffer.concat([png(10, 10), Buffer.alloc(AUTH_BRANDING_LOGO_MAX_BYTES)]);
  assert.equal(inspectBrandLogo(big).reason, 'too_large');
  // An ICO is not a logo.
  assert.equal(inspectBrandLogo(ico()).reason, 'not_png');
  // PNG bytes that could be read as something else are still a PNG: the
  // content type comes from the extension, never from the bytes.
  assert.ok(inspectBrandLogo(png(1, 1)).ok);
});

test('a favicon is an ICO with a valid directory, or a PNG of at most 256 pixels a side, of at most 64 KiB', () => {
  assert.deepEqual(inspectBrandFavicon(ico()), {
    ok: true,
    format: 'ico',
    width: 16,
    height: 16,
    bytes: ico().length,
  });
  assert.equal(inspectBrandFavicon(ico({ entries: 3 })).ok, true);
  assert.equal(inspectBrandFavicon(ico({ overflow: true })).reason, 'not_ico_or_png');
  assert.equal(inspectBrandFavicon(ico({ entries: 0 })).reason, 'not_ico_or_png');
  assert.equal(inspectBrandFavicon(ico().subarray(0, 20)).reason, 'not_ico_or_png');
  assert.equal(inspectBrandFavicon(png(32, 32)).format, 'png');
  assert.equal(inspectBrandFavicon(png(257, 32)).reason, 'bad_image');
  assert.equal(inspectBrandFavicon(SVG).reason, 'not_ico_or_png');
  assert.equal(inspectBrandFavicon(Buffer.alloc(0)).reason, 'empty');
  const big = Buffer.concat([ico(), Buffer.alloc(AUTH_BRANDING_FAVICON_MAX_BYTES)]);
  assert.equal(inspectBrandFavicon(big).reason, 'too_large');
});

// --- the locale and stylesheet rendering ---------------------------------

test('the brand name replaces {{authelia}} in every string value, keys and everything else verbatim', async () => {
  const en = await readFixtureJson(`authelia-${PINNED}-portal-en.json`);
  const branded = renderBrandLocale(en, 'Code Lama');
  assert.equal(branded['Login - {{authelia}}'], 'Login - Code Lama');
  assert.equal(branded['Powered by {{authelia}}'], 'Powered by Code Lama');
  assert.equal(
    branded['You must view and accept the Privacy Policy before using {{authelia}}.'],
    'You must view and accept the <policy>Privacy Policy</policy> before using Code Lama',
  );
  assert.equal(branded['Sign in'], 'Sign in');
  assert.deepEqual(Object.keys(branded), Object.keys(en));
  const tr = await readFixtureJson(`authelia-${PINNED}-portal-tr-TR.json`);
  assert.equal(renderBrandLocale(tr, 'Code Lama')['Login - {{authelia}}'], 'Giriş - Code Lama');
  assert.equal(renderBrandLocale(tr, 'Code Lama').Password, 'Şifre');
  const settings = await readFixtureJson(`authelia-${PINNED}-settings-en.json`);
  assert.equal(
    renderBrandLocale(settings, 'Code Lama')['Settings - {{authelia}}'],
    'Settings - Code Lama',
  );
  // Nested values are walked; non-strings are never touched; the input is not mutated.
  const nested = {
    a: { b: ['{{authelia}} x', 1, null, { c: '{{authelia}}{{authelia}}' }] },
    n: 2,
    t: true,
  };
  const out = renderBrandLocale(nested, 'Z');
  assert.deepEqual(out, { a: { b: ['Z x', 1, null, { c: 'ZZ' }] }, n: 2, t: true });
  assert.equal(nested.a.b[0], '{{authelia}} x');
  // A name is spliced as text: what it carries is what the validator let through.
  assert.equal(renderBrandLocale({ k: '{{authelia}}' }, 'A & B')['k'], 'A & B');
});

test(`brand.css sets the custom properties of Authelia ${PINNED}’s theme contract and hides the footer`, async () => {
  const themes = await readFile(fixture(`authelia-${PINNED}-tailwind-themes.css`), 'utf-8');
  assert.ok(themes.includes(`v${PINNED}`), 'the fixture names the pinned release');
  // Every theme Authelia renders as data-theme (auto resolves to light or dark).
  const blocks = AUTH_BRANDING_THEMES.filter((t) => t !== 'auto').map((t) => {
    const start = themes.indexOf(`[data-theme="${t}"]`);
    assert.ok(start >= 0, `the fixture defines [data-theme="${t}"]`);
    return themes.slice(start, themes.indexOf('}', start));
  });
  for (const property of BRAND_CSS_ACCENT_PROPERTIES) {
    for (const block of blocks) {
      assert.ok(
        new RegExp(`^\\s*${property}:`, 'm').test(block),
        `${property} is a theme property`,
      );
    }
  }
  assert.ok(
    blocks.every((b) => /^\s*--secondary:/m.test(b)),
    '--secondary is left to the theme',
  );

  const css = renderBrandCss({ accent: '#22d3ee' });
  assert.ok(css.includes('[data-theme] {'));
  for (const property of BRAND_CSS_ACCENT_PROPERTIES) {
    const value = property === '--primary-foreground' ? '#000000' : '#22d3ee';
    assert.ok(css.includes(`  ${property}: ${value} !important;`), `${property} in brand.css`);
  }
  assert.ok(css.includes(`${BRAND_CSS_FOOTER_SELECTOR} { display: none !important; }`));
  assert.equal(BRAND_CSS_FOOTER_SELECTOR, 'a[href^="https://www.authelia.com"]');
  // Nothing of the accent reaches the sheet unchecked.
  assert.throws(() => renderBrandCss({ accent: '#22d3ee; } body { x: url(a) }' }));
  // No accent: the footer rule alone.
  const plain = renderBrandCss({ accent: null });
  assert.ok(!plain.includes('[data-theme]'));
  assert.ok(plain.includes(BRAND_CSS_FOOTER_SELECTOR));
  assert.equal(accentForeground('#000000'), '#ffffff');
  assert.equal(accentForeground('#1d4ed8'), '#ffffff');
  assert.equal(accentForeground('#ffffff'), '#000000');
  assert.equal(accentForeground('#22d3ee'), '#000000');
});

test('a locale file lands where Authelia routes it; a name it would not route is refused', () => {
  assert.equal(authBrandingLocaleFile('tr-TR', 'portal'), 'locales/tr-TR/portal.json');
  assert.equal(authBrandingLocaleFile('en', 'settings'), 'locales/en/settings.json');
  assert.equal(authBrandingLocaleFile('srp', 'consent'), 'locales/srp/consent.json');
  for (const [locale, ns] of [
    ['../en', 'portal'],
    ['en/..', 'portal'],
    ['EN', 'portal'],
    ['e', 'Portal'],
    ['en', 'portal.json'],
    ['', 'portal'],
    ['en', ''],
  ]) {
    assert.throws(() => authBrandingLocaleFile(locale, ns), `${locale}/${ns}`);
  }
});

// --- Authelia's locale list ---------------------------------------------

test(`GET /locales as Authelia ${PINNED} answers it: every listed locale, parents included, with its namespaces`, async () => {
  const list = await readFixtureJson(`authelia-${PINNED}-locales.json`);
  assert.deepEqual(parseAutheliaLocalesList(list), [
    { locale: 'en', namespaces: ['consent', 'portal', 'settings'] },
    { locale: 'srp', namespaces: ['consent', 'portal', 'settings'] },
    { locale: 'tr', namespaces: ['consent', 'portal', 'settings'] },
    { locale: 'tr-TR', namespaces: ['consent', 'portal', 'settings'] },
  ]);
  // `namespaces` omitted (Go's omitempty): the defaults stand in.
  const bare = structuredClone(list);
  delete bare.data.languages[0].namespaces;
  assert.deepEqual(parseAutheliaLocalesList(bare)[0].namespaces, ['consent', 'portal', 'settings']);
  for (const broken of [
    { status: 'KO', data: list.data },
    { status: 'OK', data: { ...list.data, languages: [] } },
    { status: 'OK', data: { ...list.data, languages: [{ locale: '../etc' }] } },
    { status: 'OK', data: { ...list.data, languages: [{ locale: 'en', namespaces: ['x/y'] }] } },
    null,
    'OK',
  ]) {
    assert.throws(() => parseAutheliaLocalesList(broken));
  }

  const served = new Map([['/locales', list]]);
  for (const { locale, namespaces } of list.data.languages) {
    for (const ns of namespaces) {
      served.set(`/locales/${locale}/${ns}.json`, { [`${ns} - {{authelia}}`]: `${locale}` });
    }
  }
  const requested = [];
  const fetchImpl = async (url) => {
    const route = url.replace('http://authelia.test', '');
    requested.push(route);
    const body = served.get(route);
    return {
      ok: body !== undefined,
      status: body ? 200 : 404,
      text: async () => JSON.stringify(body),
    };
  };
  const locales = await fetchAutheliaLocales({ fetchImpl, baseUrl: 'http://authelia.test' });
  assert.equal(locales.files.length, 12);
  assert.equal(requested[0], '/locales');
  assert.ok(requested.includes('/locales/tr-TR/settings.json'));
  // A file Authelia does not serve fails the whole fetch: a partial language would lose its texts.
  served.delete('/locales/tr/consent.json');
  await assert.rejects(fetchAutheliaLocales({ fetchImpl, baseUrl: 'http://authelia.test' }), /404/);
});

// --- the rendered directory -----------------------------------------------

const BRAND = {
  name: 'Code Lama',
  tagline: null,
  theme: 'dark',
  accent: '#22d3ee',
  supportEmail: 'support@codelama.com.tr',
  supportUrl: null,
};

async function fixtureLocales() {
  const en = await readFixtureJson(`authelia-${PINNED}-portal-en.json`);
  const tr = await readFixtureJson(`authelia-${PINNED}-portal-tr-TR.json`);
  const settings = await readFixtureJson(`authelia-${PINNED}-settings-en.json`);
  return {
    languages: [
      { locale: 'en', namespaces: ['portal', 'settings'] },
      { locale: 'tr-TR', namespaces: ['portal'] },
    ],
    files: [
      { locale: 'en', namespace: 'portal', messages: en },
      { locale: 'en', namespace: 'settings', messages: settings },
      { locale: 'tr-TR', namespace: 'portal', messages: tr },
    ],
  };
}

test('a brand is rendered into its domain’s directory — 0750/0640, every file from validated fields — replaced as a whole, listed and removed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lamaste-auth-branding-'));
  try {
    const locales = await fixtureLocales();
    const domain = 'codelama.com.tr';
    const logo = png(300, 100);
    const favicon = ico();
    const rendered = await renderAuthBranding({
      domain,
      brand: BRAND,
      revision: 1,
      logo,
      favicon,
      locales,
      autheliaVersion: PINNED,
      root,
      now: new Date('2026-10-27T10:00:00Z'),
    });
    assert.deepEqual(rendered, {
      v: 1,
      revision: 1,
      autheliaVersion: PINNED,
      renderedAt: '2026-10-27T10:00:00.000Z',
    });
    const dir = path.join(root, domain);
    const mode = async (p) => (await lstat(p)).mode & 0o777;
    assert.equal(await mode(dir), 0o750);
    assert.equal(await mode(path.join(dir, 'locales', 'tr-TR')), 0o750);
    for (const file of [
      AUTH_BRANDING_FILES.favicon,
      AUTH_BRANDING_FILES.logo,
      AUTH_BRANDING_FILES.css,
      AUTH_BRANDING_FILES.brand,
      AUTH_BRANDING_FILES.rendered,
      'locales/en/portal.json',
      'locales/en/settings.json',
      'locales/tr-TR/portal.json',
    ]) {
      assert.equal(await mode(path.join(dir, file)), 0o640, file);
    }
    assert.ok((await readFile(path.join(dir, AUTH_BRANDING_FILES.logo))).equals(logo));
    assert.ok((await readFile(path.join(dir, AUTH_BRANDING_FILES.favicon))).equals(favicon));
    const tr = JSON.parse(await readFile(path.join(dir, 'locales/tr-TR/portal.json'), 'utf-8'));
    assert.equal(tr['Login - {{authelia}}'], 'Giriş - Code Lama');
    assert.equal(tr.Password, 'Şifre');
    const settings = JSON.parse(
      await readFile(path.join(dir, 'locales/en/settings.json'), 'utf-8'),
    );
    assert.equal(settings['Settings - {{authelia}}'], 'Settings - Code Lama');
    const css = await readFile(path.join(dir, AUTH_BRANDING_FILES.css), 'utf-8');
    assert.ok(css.includes('--primary: #22d3ee !important'));
    const brand = JSON.parse(await readFile(path.join(dir, AUTH_BRANDING_FILES.brand), 'utf-8'));
    assert.equal(brand.v, 1);
    assert.equal(brand.domain, domain);
    assert.equal(brand.name, 'Code Lama');
    assert.equal(brand.theme, 'dark');
    assert.equal(brand.logo.sha256.length, 64);
    assert.equal(brand.favicon.sha256.length, 64);
    assert.deepEqual(await readRenderedBrand(domain, root), rendered);

    // Re-rendered without the favicon at revision 2: the old directory is gone as a whole.
    await writeFile(path.join(dir, 'stray.txt'), 'x');
    await renderAuthBranding({
      domain,
      brand: { ...BRAND, accent: null },
      revision: 2,
      logo,
      favicon: null,
      locales,
      autheliaVersion: PINNED,
      root,
    });
    assert.equal((await readRenderedBrand(domain, root)).revision, 2);
    assert.deepEqual((await readdir(dir)).sort(), [
      'brand.css',
      'brand.json',
      'locales',
      'rendered.json',
      'static',
    ]);
    const brand2 = JSON.parse(await readFile(path.join(dir, AUTH_BRANDING_FILES.brand), 'utf-8'));
    assert.equal(brand2.favicon, null);
    assert.equal(brand2.accent, null);

    // Listing: domains only; staging and outgoing leftovers pruned, strays ignored.
    await mkdir(path.join(root, '.staging-deadbeef'));
    await mkdir(path.join(root, '.outgoing-deadbeef'));
    await writeFile(path.join(root, 'not-a-dir.tr'), 'x');
    await mkdir(path.join(root, 'Not A Domain'));
    assert.deepEqual(await listRenderedBrands(root), [domain]);
    assert.deepEqual((await readdir(root)).sort(), ['Not A Domain', domain, 'not-a-dir.tr']);

    // rendered.json behind a link is not ours.
    await rm(path.join(dir, AUTH_BRANDING_FILES.rendered));
    await writeFile(path.join(root, 'elsewhere.json'), JSON.stringify(rendered));
    await symlink(path.join(root, 'elsewhere.json'), path.join(dir, AUTH_BRANDING_FILES.rendered));
    assert.equal(await readRenderedBrand(domain, root), null);

    assert.equal(await removeAuthBranding(domain, root), true);
    assert.equal(await removeAuthBranding(domain, root), false);
    assert.equal(await lstat(dir).catch((err) => err.code), 'ENOENT');
    assert.equal(await readRenderedBrand(domain, root), null);
    assert.deepEqual(await listRenderedBrands(path.join(root, 'none')), []);
    await assert.rejects(
      renderAuthBranding({
        domain: '../x',
        brand: BRAND,
        revision: 1,
        logo: null,
        favicon: null,
        locales,
        autheliaVersion: PINNED,
        root,
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- Authelia's configuration ----------------------------------------------

test('the configuration holds server.asset_path and an explicit theme; a theme set by hand is kept', () => {
  const config = { server: { address: 'tcp://127.0.0.1:9091/' }, session: {} };
  assert.equal(autheliaBrandingConfigured(config), false);
  ensureAutheliaBrandingConfig(config);
  assert.deepEqual(config.server, {
    address: 'tcp://127.0.0.1:9091/',
    asset_path: AUTHELIA_ASSET_PATH,
  });
  assert.equal(config.theme, AUTHELIA_THEME_DEFAULT);
  assert.equal(autheliaBrandingConfigured(config), true);
  const dark = { server: { asset_path: AUTHELIA_ASSET_PATH }, theme: 'dark' };
  assert.equal(autheliaBrandingConfigured(dark), true);
  ensureAutheliaBrandingConfig(dark);
  assert.equal(dark.theme, 'dark');
  assert.equal(autheliaBrandingConfigured({ theme: 'light' }), false);
  assert.equal(
    autheliaBrandingConfigured({ server: { asset_path: '/tmp/x' }, theme: 'light' }),
    false,
  );
});

test('writeAutheliaConfig writes theme and asset_path, with the placeholder logo 0640 in the asset directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-authelia-'));
  try {
    const assetDir = path.join(dir, 'assets');
    const configPath = path.join(dir, 'configuration.yml');
    await writeAutheliaConfig(
      'samplepark.tr',
      { jwtSecret: 'j', sessionSecret: 's', storageEncryptionKey: 'k' },
      {
        groupKey: '0a0a0a0a0a0a0a0a',
        configPath,
        secretsPath: path.join(dir, '.secrets.json'),
        assetDir,
      },
    );
    const config = yaml.load(
      (await readFile(configPath, 'utf-8')).replaceAll('{{', '').replaceAll('}}', ''),
    );
    assert.equal(config.theme, 'light');
    assert.equal(config.server.asset_path, AUTHELIA_ASSET_PATH);
    assert.equal(config.server.address, 'tcp://127.0.0.1:9091/');
    const logo = path.join(assetDir, 'logo.png');
    assert.equal((await lstat(logo)).mode & 0o777, 0o640);
    assert.equal((await lstat(assetDir)).mode & 0o777, 0o750);
    assert.equal(inspectBrandLogo(await readFile(logo)).ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ensureAutheliaBrandingBase adds the missing keys with one restart, and restarts nothing when they are there', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-authelia-'));
  try {
    const configPath = path.join(dir, 'configuration.yml');
    const secretsPath = path.join(dir, '.secrets.json');
    const assetDir = path.join(dir, 'assets');
    // A 4.7 configuration: no theme, no asset_path, the session secret in .secrets.json.
    await writeFile(
      configPath,
      yaml.dump({
        server: { address: 'tcp://127.0.0.1:9091/' },
        authentication_backend: {
          file: { path: '/etc/authelia/users.yml', watch: true },
          refresh_interval: 'always',
          password_change: { disable: true },
          password_reset: { disable: true },
        },
        session: {
          secret: 'old',
          cookies: [
            {
              domain: 'samplepark.tr',
              authelia_url: 'https://auth.samplepark.tr',
              default_redirection_url: 'https://samplepark.tr',
            },
          ],
        },
        access_control: { default_policy: 'deny', rules: [] },
      }),
    );
    await writeFile(secretsPath, JSON.stringify({ sessionSecret: 'from-secrets' }));
    let restarts = 0;
    const exec = async () => {
      throw new Error('exec is not used when restart is given');
    };
    const restart = async () => {
      restarts += 1;
    };
    const first = await ensureAutheliaBrandingBase(exec, {
      configPath,
      secretsPath,
      assetDir,
      restart,
    });
    assert.deepEqual(first, { logoWritten: true, restarted: true });
    assert.equal(restarts, 1);
    const config = yaml.load(await readFile(configPath, 'utf-8'));
    assert.equal(config.theme, 'light');
    assert.equal(config.server.asset_path, AUTHELIA_ASSET_PATH);
    assert.equal(config.server.address, 'tcp://127.0.0.1:9091/');
    assert.equal(config.session.secret, 'from-secrets');
    assert.equal(config.access_control.default_policy, 'deny');
    assert.equal(await lstat(`${configPath}.bak`).catch((err) => err.code), 'ENOENT');

    const second = await ensureAutheliaBrandingBase(exec, {
      configPath,
      secretsPath,
      assetDir,
      restart,
    });
    assert.deepEqual(second, { logoWritten: false, restarted: false });
    assert.equal(restarts, 1);

    // A placeholder that is not ours is replaced, without a restart.
    await writeFile(path.join(assetDir, 'logo.png'), png(1, 1));
    const third = await ensureAutheliaBrandingBase(exec, {
      configPath,
      secretsPath,
      assetDir,
      restart,
    });
    assert.deepEqual(third, { logoWritten: true, restarted: false });
    assert.equal((await lstat(path.join(assetDir, 'logo.png'))).mode & 0o777, 0o640);

    // A failed restart rolls the file back.
    await writeFile(configPath, yaml.dump({ server: { address: 'tcp://127.0.0.1:9091/' } }));
    await assert.rejects(
      ensureAutheliaBrandingBase(exec, {
        configPath,
        secretsPath,
        assetDir,
        restart: async () => {
          throw new Error('Authelia did not come up');
        },
      }),
      /did not come up/,
    );
    assert.equal(yaml.load(await readFile(configPath, 'utf-8')).theme, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
