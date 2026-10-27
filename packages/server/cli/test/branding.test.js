/**
 * `lamaste-server domains branding` in words: the flags of `set` and the
 * merged body they make, the pre-check of a file, the brand in lines, and
 * refusals explained — never a value.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTH_BRANDING_FAVICON_MAX_BYTES,
  AUTH_BRANDING_LOGO_MAX_BYTES,
} from '@lamalibre/lamaste/branding';

import {
  assetFileProblem,
  assetLine,
  brandingLines,
  brandingSetArgs,
  brandingSetBody,
  explainBrandingRefusal,
  parseRevision,
  previewLines,
  warningLine,
} from '../src/branding.js';

const CURRENT = {
  domain: 'codelama.com.tr',
  name: 'Code Lama',
  tagline: 'Software',
  theme: 'dark',
  accent: '#1f6feb',
  supportEmail: null,
  supportUrl: null,
  logo: { sha256: 'a'.repeat(64), bytes: 12600, format: 'png', width: 512, height: 512 },
  favicon: null,
  revision: 3,
  updatedAt: '2026-10-27T10:00:00.000Z',
  rendered: { v: 1, revision: 3, autheliaVersion: '4.39.28', renderedAt: '…' },
  renderedCurrent: true,
};

test('the flags of set: fields, clears, the revision; a usage error for anything else', () => {
  assert.deepEqual(
    brandingSetArgs([
      '--name',
      'Code Lama',
      '--theme',
      'oled',
      '--accent',
      '#1f6feb',
      '--clear',
      'tagline',
      '--clear',
      'support-url',
      '--clear',
      'tagline',
      '--if-revision',
      '7',
    ]),
    {
      fields: { name: 'Code Lama', theme: 'oled', accent: '#1f6feb' },
      clears: ['tagline', 'supportUrl'],
      ifRevision: 7,
    },
  );
  assert.deepEqual(brandingSetArgs(['--support-email', 'help@codelama.com.tr']), {
    fields: { supportEmail: 'help@codelama.com.tr' },
    clears: [],
  });
  // A value is passed as given: the panel applies the rule and names the field.
  assert.deepEqual(brandingSetArgs(['--accent', 'blue']).fields, { accent: 'blue' });
  assert.deepEqual(brandingSetArgs([]), { error: 'set needs at least one field to set or clear' });
  assert.deepEqual(brandingSetArgs(['--name']), { error: '--name needs a value' });
  assert.deepEqual(brandingSetArgs(['--theme', 'neon']), {
    error: '--theme takes one of light, dark, grey, oled, auto',
  });
  assert.deepEqual(brandingSetArgs(['--clear', 'name']), {
    error: '--clear takes one of tagline, accent, support-email, support-url',
  });
  assert.deepEqual(brandingSetArgs(['--tagline', 'x', '--clear', 'tagline']), {
    error: 'tagline is both set and cleared',
  });
  assert.deepEqual(brandingSetArgs(['--if-revision', '0']), {
    error: '--if-revision takes a positive integer',
  });
  assert.deepEqual(brandingSetArgs(['--if-revision', 'latest']), {
    error: '--if-revision takes a positive integer',
  });
  assert.deepEqual(brandingSetArgs(['--logo', 'x.png']), { error: 'Unknown option: --logo' });
  assert.equal(parseRevision('12'), 12);
  assert.equal(parseRevision('0'), null);
  assert.equal(parseRevision('1e3'), null);
  assert.equal(parseRevision(undefined), null);
  assert.ok(!brandingSetArgs(['--\u001b[31mx']).error.includes('\u001b'));
});

test('the body of set merges over the brand read: unnamed fields kept, cleared ones null, ifRevision the read one', () => {
  assert.deepEqual(brandingSetBody(CURRENT, { fields: { theme: 'light' }, clears: ['accent'] }), {
    body: {
      name: 'Code Lama',
      tagline: 'Software',
      theme: 'light',
      accent: null,
      supportEmail: null,
      supportUrl: null,
      ifRevision: 3,
    },
  });
  // --if-revision wins over the revision read.
  assert.equal(
    brandingSetBody(CURRENT, { fields: { name: 'X' }, clears: [], ifRevision: 2 }).body.ifRevision,
    2,
  );
  // A new brand: every unnamed field unset, the theme light, no ifRevision.
  assert.deepEqual(brandingSetBody(null, { fields: { name: 'Fresh' }, clears: [] }), {
    body: {
      name: 'Fresh',
      tagline: null,
      theme: 'light',
      accent: null,
      supportEmail: null,
      supportUrl: null,
    },
  });
  assert.deepEqual(brandingSetBody(null, { fields: { theme: 'dark' }, clears: [] }), {
    error: 'The domain has no brand yet: give it a name with --name',
  });
});

test('a file is refused before the request when empty or over the limit, with the limit named', () => {
  assert.equal(assetFileProblem('logo', AUTH_BRANDING_LOGO_MAX_BYTES), null);
  assert.equal(
    assetFileProblem('logo', AUTH_BRANDING_LOGO_MAX_BYTES + 1),
    'The logo is larger than 512 KiB (the file is 512.0 KiB; a PNG of at most 512 KiB)',
  );
  assert.equal(
    assetFileProblem('favicon', AUTH_BRANDING_FAVICON_MAX_BYTES * 4),
    'The favicon is larger than 64 KiB (the file is 256 KiB; an ICO or a PNG of at most 64 KiB)',
  );
  assert.equal(assetFileProblem('favicon', 0), 'The favicon file is empty');
  assert.equal(assetFileProblem('banner', 10), 'Not a brand asset');
});

test('the brand in lines: fields, assets with their digests, revision and the rendering', () => {
  const now = Date.parse('2026-10-27T10:12:00.000Z');
  const lines = Object.fromEntries(brandingLines(CURRENT, now));
  assert.equal(lines.name, 'Code Lama');
  assert.equal(lines.tagline, 'Software');
  assert.equal(lines['support e-mail'], '—');
  assert.equal(lines.logo, `PNG 512×512, 12.3 KiB, sha256 ${'a'.repeat(16)}…`);
  assert.equal(lines.favicon, 'not set');
  assert.equal(lines.revision, '3 (updated 2026-10-27T10:00:00.000Z (12m ago))');
  assert.equal(lines.rendered, 'current');
  const stale = Object.fromEntries(
    brandingLines({ ...CURRENT, revision: 4, renderedCurrent: false }, now),
  );
  assert.equal(
    stale.rendered,
    'revision 3 from Authelia 4.39.28 (this revision is rendered within a minute)',
  );
  const none = Object.fromEntries(
    brandingLines({ ...CURRENT, rendered: null, renderedCurrent: false }, now),
  );
  assert.equal(none.rendered, 'not yet (rendered within a minute)');
  // A name the panel answers is terminal text.
  const odd = Object.fromEntries(brandingLines({ ...CURRENT, name: 'x\u001b[31m' }, now));
  assert.ok(!odd.name.includes('\u001b'));
  assert.equal(assetLine({ sha256: 'b'.repeat(64), bytes: 10 }), `10 B, sha256 ${'b'.repeat(16)}…`);
});

test('the preview in lines', () => {
  const lines = Object.fromEntries(
    previewLines({
      locale: 'en',
      css: '',
      title: 'Login - Code Lama',
      footer: 'Powered by Code Lama',
      theme: 'dark',
      logo: true,
      favicon: false,
    }),
  );
  assert.equal(lines.title, 'Login - Code Lama');
  assert.match(lines.footer, /^Powered by Code Lama \(hidden/);
  assert.equal(lines.logo, 'served at /static/media/logo.png');
  assert.equal(lines.favicon, "none (Authelia's)");
});

test('refusals in words: fields by name, an image’s reason, the limit, a stale revision — never a value', () => {
  const fields = explainBrandingRefusal(
    Object.assign(new Error('PUT … failed (HTTP 400): The brand fields are not valid'), {
      code: 'invalid_branding',
      errors: [
        { field: 'accent', message: 'must be a colour as #rrggbb (lower case)' },
        { field: '', message: 'must be an object' },
      ],
    }),
    'codelama.com.tr',
  );
  assert.equal(fields.message, 'The brand fields are not valid');
  assert.deepEqual(fields.details, [
    'accent: must be a colour as #rrggbb (lower case)',
    'must be an object',
  ]);
  const image = explainBrandingRefusal(
    Object.assign(new Error('x'), { code: 'invalid_image', reason: 'not_ico_or_png' }),
    'codelama.com.tr',
    'favicon',
  );
  assert.equal(image.message, 'The favicon must be an ICO or a PNG — no SVG');
  assert.equal(
    explainBrandingRefusal(
      Object.assign(new Error('the panel said this'), { code: 'invalid_image', reason: 'later' }),
      'd',
    ).message,
    'the panel said this',
  );
  assert.equal(
    explainBrandingRefusal(Object.assign(new Error('x'), { code: 'asset_too_large' }), 'd', 'logo')
      .message,
    'The logo is larger than 512 KiB',
  );
  const none = explainBrandingRefusal(
    Object.assign(new Error('x'), { code: 'no_branding' }),
    'codelama.com.tr',
  );
  assert.equal(none.message, "Domain 'codelama.com.tr' has no brand yet");
  assert.match(none.details[0], /set --name <name>/);
  const stale = explainBrandingRefusal(
    Object.assign(new Error('x'), { code: 'revision_mismatch', revision: 5 }),
    'codelama.com.tr',
  );
  assert.match(stale.message, /changed since it was read \(it is at revision 5\)/);
  assert.match(stale.details[0], /--if-revision/);
  const authelia = explainBrandingRefusal(
    Object.assign(new Error('x'), { code: 'authelia_unavailable' }),
    'd',
  );
  assert.match(authelia.message, /no preview/);
  assert.match(authelia.details[0], /saved/);
  const unknown = explainBrandingRefusal(
    Object.assign(new Error('x'), { code: 'unknown_domain' }),
    'nope.example',
  );
  assert.equal(unknown.message, "'nope.example' is not a domain of this relay");
  // Anything else: the panel's message as it came.
  const other = explainBrandingRefusal(new Error('GET /x failed (HTTP 502)'), 'd');
  assert.deepEqual(other, { message: 'GET /x failed (HTTP 502)', details: [] });
  const odd = explainBrandingRefusal(new Error('x\u001b[31m'), 'd');
  assert.ok(!odd.message.includes('\u001b'));
});

test('a warning as one line of terminal text', () => {
  assert.equal(
    warningLine({ step: 'vhost', message: 'nginx refused it' }),
    'vhost: nginx refused it',
  );
  assert.equal(warningLine('plain'), 'plain');
  assert.ok(!warningLine({ step: 'x', message: 'y\u001b[31m' }).includes('\u001b'));
});
