/**
 * The domains' brands for the pages (lib/brand.ts): `brand.json` read
 * through the domain's link under the web root, capped, parsed with core's
 * schema, named for the domain — a brand when it is one of ours, the stock
 * page (null) for a missing, oversized, unreadable or invalid file, never a
 * throw; answers kept for the TTL so a switched link shows within it;
 * transitions logged once, without the file's content. Runs against the
 * build (`npm run build`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { renderBrandJson } from '@lamalibre/lamaste';

import {
  BRAND_FILE_MAX_BYTES,
  brandLogoUrl,
  createBrandReader,
  readBrandFile,
} from '../dist/index.js';

const FIELDS = {
  name: 'Code Lama',
  tagline: 'Software, crafted',
  theme: 'light',
  accent: '#1d4ed8',
  supportEmail: 'help@codelama.com.tr',
  supportUrl: 'https://codelama.com.tr/help',
};
const SHA = 'f'.repeat(64);

/** A rendering of `domain` under `root`, linked as the panel links one. */
async function render(root, domain, brandJson, { revision = 1, tag = 'a' } = {}) {
  const dir = path.join(root, '.renders', `${domain}-${revision}-${tag.repeat(16)}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'brand.json'), brandJson);
  const temp = path.join(root, `.link-${tag}`);
  await symlink(`.renders/${path.basename(dir)}`, temp);
  await rename(temp, path.join(root, domain));
  return dir;
}

test('brand.json of a domain is read through its link and turned into the pages’ brand; anything else is the stock page', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lamaste-gatekeeper-brand-'));
  try {
    const domain = 'codelama.com.tr';
    const json = JSON.stringify(
      renderBrandJson(domain, FIELDS, 1, { logoSha256: SHA, faviconSha256: null }),
    );
    await render(root, domain, json);
    assert.deepEqual(await readBrandFile(domain, root), {
      state: 'branded',
      brand: {
        name: 'Code Lama',
        tagline: 'Software, crafted',
        accent: '#1d4ed8',
        logoUrl: 'https://auth.codelama.com.tr/static/media/logo.png',
        supportEmail: 'help@codelama.com.tr',
        supportUrl: 'https://codelama.com.tr/help',
      },
    });
    assert.equal(brandLogoUrl('samplepark.tr'), 'https://auth.samplepark.tr/static/media/logo.png');
    // No logo: no URL. Nullable fields through.
    await render(
      root,
      'samplepark.tr',
      JSON.stringify(
        renderBrandJson(
          'samplepark.tr',
          { ...FIELDS, tagline: null, accent: null, supportEmail: null, supportUrl: null },
          4,
          { logoSha256: null, faviconSha256: SHA },
        ),
      ),
      { tag: 'b' },
    );
    assert.deepEqual((await readBrandFile('samplepark.tr', root)).brand, {
      name: 'Code Lama',
      tagline: null,
      accent: null,
      logoUrl: null,
      supportEmail: null,
      supportUrl: null,
    });

    // Missing: a domain without a rendering, a rendering without the file.
    assert.deepEqual(await readBrandFile('other.example', root), {
      state: 'unbranded',
      brand: null,
    });
    await mkdir(path.join(root, 'bare.example'));
    assert.equal((await readBrandFile('bare.example', root)).state, 'unbranded');
    // Oversized, not JSON, not a brand, another domain's: invalid, with a reason and no content.
    const cases = [
      ['big.example', `{"pad":"${'x'.repeat(BRAND_FILE_MAX_BYTES)}"}`, 'too_large'],
      ['json.example', '{not json', 'not_json'],
      ['schema.example', JSON.stringify({ ...JSON.parse(json), name: '<b>' }), 'not_a_brand'],
      ['stranger.example', json, 'another_domain'],
    ];
    let tag = 'c';
    for (const [name, content, reason] of cases) {
      await render(root, name, content, { tag });
      tag = String.fromCharCode(tag.charCodeAt(0) + 1);
      assert.deepEqual(await readBrandFile(name, root), { state: 'invalid', brand: null, reason });
    }
    // A directory at the file's name.
    await mkdir(path.join(root, 'dir.example', 'brand.json'), { recursive: true });
    assert.equal((await readBrandFile('dir.example', root)).reason, 'not_a_file');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the reader caches each answer for the TTL, sees a switched link after it, refuses a non-domain, and logs transitions once without content', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lamaste-gatekeeper-brand-'));
  try {
    const domain = 'codelama.com.tr';
    let clock = 1_000_000;
    const logged = [];
    const logger = {
      debug: (obj, msg) => logged.push({ level: 'debug', ...obj, msg }),
      info: (obj, msg) => logged.push({ level: 'info', ...obj, msg }),
      warn: (obj, msg) => logged.push({ level: 'warn', ...obj, msg }),
    };
    const reader = createBrandReader({ root, ttlMs: 5_000, logger, now: () => clock });

    // Nothing rendered yet: the stock page, and an unbranded domain is not news.
    assert.equal(await reader.readDomainBrand(domain), null);
    assert.deepEqual(logged, []);

    // Rendered within the TTL: still the cached answer; after it: the brand.
    await render(
      root,
      domain,
      JSON.stringify(renderBrandJson(domain, FIELDS, 1, { logoSha256: null, faviconSha256: null })),
    );
    clock += 4_999;
    assert.equal(await reader.readDomainBrand(domain), null);
    clock += 1;
    assert.equal((await reader.readDomainBrand(domain)).name, 'Code Lama');
    assert.deepEqual(logged, [
      { level: 'info', domain, msg: 'Domain brand read: the pages carry it' },
    ]);

    // The link switched to a new rendering (revision 2, another name):
    // within the TTL the old answer, then the new one; one more log line.
    await render(
      root,
      domain,
      JSON.stringify(
        renderBrandJson(domain, { ...FIELDS, name: 'Code Lama Software' }, 2, {
          logoSha256: SHA,
          faviconSha256: null,
        }),
      ),
      { revision: 2, tag: 'b' },
    );
    assert.equal((await reader.readDomainBrand(domain)).name, 'Code Lama');
    clock += 5_000;
    const switched = await reader.readDomainBrand(domain);
    assert.equal(switched.name, 'Code Lama Software');
    assert.equal(switched.logoUrl, 'https://auth.codelama.com.tr/static/media/logo.png');
    assert.equal(logged.length, 1, 'branded to branded is no transition');

    // The file turned invalid: the stock page, warned once with the reason
    // — never the content — and not again while it stays so.
    const dir = path.join(root, '.renders', `${domain}-2-${'b'.repeat(16)}`);
    await writeFile(path.join(dir, 'brand.json'), '{"name":"<script>alert(1)</script>"');
    clock += 5_000;
    assert.equal(await reader.readDomainBrand(domain), null);
    clock += 5_000;
    assert.equal(await reader.readDomainBrand(domain), null);
    assert.equal(logged.length, 2);
    assert.deepEqual(logged[1], {
      level: 'warn',
      domain,
      reason: 'not_json',
      msg: 'Domain brand unreadable: the stock pages are served',
    });
    assert.doesNotMatch(JSON.stringify(logged), /script|alert/);

    // The brand removed (the panel removes the link): gone, said once at debug.
    await rm(path.join(root, domain));
    clock += 5_000;
    assert.equal(await reader.readDomainBrand(domain), null);
    assert.deepEqual(logged[2], {
      level: 'debug',
      domain,
      msg: 'Domain brand gone: the stock pages are served',
    });
    assert.equal(logged.length, 3);

    // Not a domain name: never a path component.
    for (const bad of ['../etc', 'Code Lama', '', 'a/b', '.renders']) {
      assert.equal(await reader.readDomainBrand(bad), null, bad);
    }
    assert.equal(logged.length, 3);

    // Forgotten: read again at once.
    reader.reset();
    await render(
      root,
      domain,
      JSON.stringify(renderBrandJson(domain, FIELDS, 3, { logoSha256: null, faviconSha256: null })),
      { revision: 3, tag: 'd' },
    );
    assert.equal((await reader.readDomainBrand(domain)).name, 'Code Lama');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
