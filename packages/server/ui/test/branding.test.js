/**
 * A domain's brand in the panel's words: the form from the brand the panel
 * holds, the request a form makes, what is refused before it is sent, the
 * pre-checks of a chosen file, the sign-in preview's model, and refusals
 * in words — never a value.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTH_BRANDING_FAVICON_MAX_BYTES,
  AUTH_BRANDING_LOGO_MAX_BYTES,
} from '@lamalibre/lamaste/branding';

import {
  assetProblem,
  assetText,
  base64OfDataUrl,
  brandFieldsOf,
  brandFormFrom,
  brandLogoUrl,
  brandRequest,
  explainBrandingRefusal,
  fieldErrorsOf,
  formProblems,
  imageReasonText,
  previewModel,
  sizeText,
  warningLines,
} from '../src/admin/lib/branding.js';
import { fieldErrorsIn } from '../src/admin/lib/errorMessage.js';

const VIEW = {
  domain: 'codelama.com.tr',
  name: 'Code Lama',
  tagline: null,
  theme: 'dark',
  accent: '#1f6feb',
  supportEmail: 'help@codelama.com.tr',
  supportUrl: null,
  logo: { sha256: 'a'.repeat(64), bytes: 12600, format: 'png', width: 512, height: 512 },
  favicon: null,
  revision: 3,
  updatedAt: '2026-10-27T10:00:00.000Z',
  rendered: { v: 1, revision: 3, autheliaVersion: '4.39.28', renderedAt: '…' },
  renderedCurrent: true,
};

const ACTIVE = { name: 'codelama.com.tr', status: 'active', primary: false };
const PENDING = { name: 'new.example', status: 'pending', primary: false };

test('the form from the brand the panel holds: every field a string, an unset one empty', () => {
  assert.deepEqual(brandFormFrom(VIEW), {
    name: 'Code Lama',
    tagline: '',
    theme: 'dark',
    accent: '#1f6feb',
    supportEmail: 'help@codelama.com.tr',
    supportUrl: '',
  });
  assert.deepEqual(brandFormFrom(null), {
    name: '',
    tagline: '',
    theme: 'light',
    accent: '',
    supportEmail: '',
    supportUrl: '',
  });
  // A theme the panel does not know (an answer of a later panel) previews as light.
  assert.equal(brandFormFrom({ ...VIEW, theme: 'neon' }).theme, 'light');
});

test('the request from a form: trimmed, empty optional fields null, the accent lower-cased, ifRevision from the read', () => {
  const form = {
    name: '  Code Lama ',
    tagline: ' ',
    theme: 'oled',
    accent: '#1F6FEB',
    supportEmail: '',
    supportUrl: ' https://codelama.com.tr/help ',
  };
  assert.deepEqual(brandFieldsOf(form), {
    name: 'Code Lama',
    tagline: null,
    theme: 'oled',
    accent: '#1f6feb',
    supportEmail: null,
    supportUrl: 'https://codelama.com.tr/help',
  });
  assert.deepEqual(brandRequest(form, 3), { ...brandFieldsOf(form), ifRevision: 3 });
  // A new brand was read at no revision: no ifRevision.
  assert.equal('ifRevision' in brandRequest(form, undefined), false);
  assert.equal('ifRevision' in brandRequest(form, 0), false);
});

test('what core refuses is shown beside the field before anything is sent, and never carries the value', () => {
  const problems = formProblems({
    name: '',
    tagline: 'x'.repeat(161),
    theme: 'dark',
    accent: 'blue',
    supportEmail: 'not-an-address',
    supportUrl: 'http://insecure.example',
  });
  assert.deepEqual(Object.keys(problems).sort(), [
    'accent',
    'name',
    'supportEmail',
    'supportUrl',
    'tagline',
  ]);
  assert.equal(problems.name, 'must not be empty');
  assert.equal(problems.accent, 'must be a colour as #rrggbb (lower case)');
  assert.equal(problems.supportUrl, 'must be an https:// URL');
  for (const message of Object.values(problems)) {
    assert.ok(!message.includes('insecure') && !message.includes('blue'), message);
  }
  assert.deepEqual(formProblems(brandFormFrom(VIEW)), {});
});

test('a refused brand’s field errors: a list of { field, message } kept by both clients, mapped by field', () => {
  const raw = [
    { field: 'name', message: 'must not be empty' },
    { field: 'name', message: 'second message dropped: the first per field is shown' },
    { field: '', message: 'must be an object' },
    { field: 7, message: 'dropped: not a field name' },
    'dropped: not an entry',
  ];
  assert.deepEqual(fieldErrorsIn(raw), [
    { field: 'name', message: 'must not be empty' },
    { field: 'name', message: 'second message dropped: the first per field is shown' },
    { field: '', message: 'must be an object' },
  ]);
  assert.equal(fieldErrorsIn({ retries: 'the settings map is not a list' }), null);
  assert.equal(fieldErrorsIn([]), null);
  const err = Object.assign(new Error('The brand fields are not valid'), {
    code: 'invalid_branding',
    errors: fieldErrorsIn(raw),
  });
  assert.deepEqual(fieldErrorsOf(err), { name: 'must not be empty', _: 'must be an object' });
  assert.deepEqual(fieldErrorsOf(new Error('x')), {});
  assert.deepEqual(fieldErrorsOf(null), {});
});

test('a chosen file is refused before it is sent when empty or over the limit, with the limit named', () => {
  assert.equal(assetProblem('logo', { size: 1000 }), null);
  assert.equal(assetProblem('logo', { size: AUTH_BRANDING_LOGO_MAX_BYTES }), null);
  assert.equal(
    assetProblem('logo', { size: AUTH_BRANDING_LOGO_MAX_BYTES + 1 }),
    'The logo is larger than 512 KiB (the file is 512.0 KiB)',
  );
  assert.equal(
    assetProblem('favicon', { size: AUTH_BRANDING_FAVICON_MAX_BYTES * 2 }),
    'The favicon is larger than 64 KiB (the file is 128 KiB)',
  );
  assert.equal(assetProblem('favicon', { size: 0 }), 'The favicon file is empty');
  assert.equal(assetProblem('logo', null), 'Choose a file');
  assert.equal(assetProblem('banner', { size: 1 }), 'Not a brand asset');
  assert.equal(sizeText(512), '512 B');
  assert.equal(sizeText(12600), '12.3 KiB');
  assert.equal(sizeText(2 * 1024 * 1024), '2.0 MiB');
});

test('the base64 of a data URL, and nothing of anything else', () => {
  assert.equal(base64OfDataUrl('data:image/png;base64,iVBORw0KGgo='), 'iVBORw0KGgo=');
  assert.equal(base64OfDataUrl('data:text/plain,hello'), null);
  assert.equal(base64OfDataUrl('iVBORw0KGgo='), null);
  assert.equal(base64OfDataUrl(undefined), null);
});

test('an asset as the view shows it, in one line', () => {
  assert.equal(assetText(VIEW.logo), 'PNG 512×512, 12.3 KiB');
  assert.equal(
    assetText({ sha256: 'b'.repeat(64), bytes: 4286, format: 'ico', width: 32, height: 32 }),
    'ICO 32×32, 4.2 KiB',
  );
  assert.equal(assetText({ sha256: 'c'.repeat(64), bytes: 10 }), '10 B');
  assert.equal(assetText(null), 'not set');
});

test('the preview: the theme’s look, the accent on the button with a readable text, the panel’s texts', () => {
  const form = brandFormFrom(VIEW);
  const preview = { locale: 'en', title: 'Login - Code Lama', footer: 'Powered by Code Lama' };
  const model = previewModel(form, preview, VIEW, ACTIVE);
  assert.equal(model.theme, 'dark');
  assert.equal(model.page, 'bg-zinc-900');
  assert.equal(model.accent, '#1f6feb');
  assert.equal(model.accentText, '#ffffff');
  assert.equal(model.title, 'Login - Code Lama');
  assert.equal(model.footer, 'Powered by Code Lama');
  assert.equal(model.footerHidden, true);
  assert.equal(model.logoUrl, 'https://auth.codelama.com.tr/static/media/logo.png?r=3');
  assert.equal(model.logoNote, null);
  // A light accent gets black text.
  assert.equal(
    previewModel({ ...form, accent: '#ffee88' }, null, VIEW, ACTIVE).accentText,
    '#000000',
  );
  // An accent the form has not finished typing is no colour yet.
  assert.equal(previewModel({ ...form, accent: '#1f6' }, null, VIEW, ACTIVE).accent, null);
});

test('the preview without the panel’s texts, and the logo only where the page would show it', () => {
  const form = { ...brandFormFrom(VIEW), name: '', theme: 'auto' };
  const fresh = previewModel(form, null, null, PENDING);
  assert.equal(fresh.theme, 'light');
  assert.equal(fresh.themeNote, 'auto — previewed as light');
  assert.equal(fresh.title, 'Login - Your brand');
  assert.equal(fresh.footer, 'Powered by Your brand');
  assert.equal(fresh.logoUrl, null);
  assert.match(fresh.logoNote, /No logo/);
  // A logo on a pending domain: the preview without the image, and why.
  const pending = previewModel(brandFormFrom(VIEW), null, VIEW, PENDING);
  assert.equal(pending.logoUrl, null);
  assert.match(pending.logoNote, /once the domain is active/);
  // A logo whose rendering is not this revision yet.
  const stale = previewModel(
    brandFormFrom(VIEW),
    null,
    { ...VIEW, renderedCurrent: false },
    ACTIVE,
  );
  assert.equal(stale.logoUrl, null);
  assert.match(stale.logoNote, /rendered/);
  assert.equal(brandLogoUrl('a.example', 12), 'https://auth.a.example/static/media/logo.png?r=12');
});

test('refusals in words: fields by name, an image’s reason, the limit, a stale revision — never a value', () => {
  const invalid = Object.assign(new Error('The brand fields are not valid'), {
    code: 'invalid_branding',
    errors: [
      { field: 'accent', message: 'must be a colour as #rrggbb (lower case)' },
      { field: '', message: 'must be an object' },
    ],
  });
  assert.equal(
    explainBrandingRefusal(invalid),
    'The brand fields are not valid: accent must be a colour as #rrggbb (lower case); must be an object',
  );
  const image = Object.assign(new Error('The logo must be a PNG (no SVG, no JPEG)'), {
    code: 'invalid_image',
    reason: 'not_png',
  });
  assert.equal(explainBrandingRefusal(image, 'logo'), 'The logo must be a PNG — no SVG, no JPEG');
  assert.equal(
    explainBrandingRefusal(
      Object.assign(new Error('x'), { code: 'invalid_image', reason: 'later_reason' }),
      'favicon',
    ),
    'x',
  );
  assert.equal(
    explainBrandingRefusal(
      Object.assign(new Error('too big'), { code: 'asset_too_large' }),
      'favicon',
    ),
    'The favicon is larger than 64 KiB',
  );
  assert.equal(
    imageReasonText('favicon', 'not_ico_or_png'),
    'The favicon must be an ICO or a PNG — no SVG',
  );
  assert.match(
    explainBrandingRefusal(
      Object.assign(new Error('changed'), { code: 'revision_mismatch', revision: 5 }),
    ),
    /changed elsewhere.*revision 5.*make your change again/,
  );
  assert.match(
    explainBrandingRefusal(Object.assign(new Error('changed'), { code: 'revision_mismatch' })),
    /changed elsewhere since it was read — the form/,
  );
  assert.match(
    explainBrandingRefusal(
      Object.assign(new Error("Domain 'x' has no brand yet"), { code: 'no_branding' }),
    ),
    /save its name first/,
  );
  assert.match(
    explainBrandingRefusal(
      Object.assign(new Error("Authelia's texts could not be read"), {
        code: 'authelia_unavailable',
      }),
    ),
    /the brand itself is saved/,
  );
  // Anything else is a domain refusal, with what still uses the domain.
  const inUse = Object.assign(new Error('in use'), {
    code: 'domain_in_use',
    usedBy: { tunnels: ['a.x'], sites: [], plugins: [], registry: false },
  });
  assert.equal(explainBrandingRefusal(inUse), 'in use — Tunnels: a.x');
  assert.equal(explainBrandingRefusal(new Error('plain')), 'plain');
});

test('a change’s warnings, one line each', () => {
  assert.deepEqual(
    warningLines([
      { step: 'render', message: 'Authelia did not answer' },
      'nginx refused the vhost',
    ]),
    ['render: Authelia did not answer', 'nginx refused the vhost'],
  );
  assert.deepEqual(warningLines(undefined), []);
});
