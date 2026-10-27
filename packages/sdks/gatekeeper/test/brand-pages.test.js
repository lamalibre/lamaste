/**
 * The pages Gatekeeper serves inline, branded (lib/templates.ts): the
 * brand's name and tagline escaped in a header and the title, the logo
 * only when the brand has one and only from the domain's sign-in host, the
 * accent only when it is a colour, the support e-mail before the settings'
 * administrator e-mail, the support URL only when it is `https:`; the
 * stock page carries none of it. Runs against the build.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PAGE_DEFAULT_ACCENT,
  buildAccessRequestPage,
  buildDomainRefusalPage,
  getAccessRequestTemplates,
} from '../dist/index.js';

const BRAND = {
  name: "Code Lama & Co's",
  tagline: 'Software, "crafted"',
  accent: '#1d4ed8',
  logoUrl: 'https://auth.codelama.com.tr/static/media/logo.png',
  supportEmail: 'help@codelama.com.tr',
  supportUrl: 'https://codelama.com.tr/help?x=1&y=2',
};
const SETTINGS = { adminContact: 'ops@example.com', adminName: 'Ops' };

const pages = (options) => [
  buildAccessRequestPage('alice', 'app.codelama.com.tr', options),
  buildDomainRefusalPage('codelama.com.tr', options, { host: 'app.codelama.com.tr' }),
  buildDomainRefusalPage('codelama.com.tr', options, { host: 'site.codelama.com.tr', site: true }),
];

test('the stock pages carry no brand markup: the settings’ contact, the pages’ own accent', () => {
  for (const html of [
    ...pages(SETTINGS),
    ...pages(undefined),
    ...pages({ ...SETTINGS, brand: null }),
  ]) {
    assert.doesNotMatch(html, /class="brand|brand-logo|Help:|rel="noopener"/);
    assert.ok(html.includes(`:root { --accent: ${PAGE_DEFAULT_ACCENT}; }`));
    assert.doesNotMatch(html, /<title>[^<]*—[^<]*—/, 'no brand in the title');
  }
  const [request] = pages(SETTINGS);
  assert.ok(request.includes('Admin: <a href="mailto:ops@example.com">ops@example.com</a>'));
  assert.ok(request.includes('Contact Ops to request access'));
});

test('a branded page: name and tagline escaped in the header and the title, the logo, the accent, the brand’s contacts', () => {
  for (const html of pages({ ...SETTINGS, brand: BRAND })) {
    assert.ok(html.includes('<div class="brand-name">Code Lama &amp; Co&#039;s</div>'), 'name');
    assert.ok(html.includes('<div class="brand-tagline">Software, &quot;crafted&quot;</div>'));
    assert.match(html, /<title>[^<]* — Code Lama &amp; Co&#039;s<\/title>/);
    assert.ok(
      html.includes(
        '<img class="brand-logo" src="https://auth.codelama.com.tr/static/media/logo.png" alt="">',
      ),
    );
    assert.ok(html.includes(':root { --accent: #1d4ed8; }'));
    assert.doesNotMatch(html, /#22d3ee/, 'the accent replaces the pages’ own everywhere');
    // The brand's support e-mail instead of the settings' administrator; the URL as a link.
    assert.ok(
      html.includes('Admin: <a href="mailto:help@codelama.com.tr">help@codelama.com.tr</a>'),
    );
    assert.doesNotMatch(html, /ops@example\.com/);
    assert.ok(
      html.includes(
        'Help: <a href="https://codelama.com.tr/help?x=1&amp;y=2" rel="noopener">https://codelama.com.tr/help?x=1&amp;y=2</a>',
      ),
    );
    // No other operator text: the raw name never appears unescaped.
    assert.doesNotMatch(html, /Co's/);
  }
  // The message templates stay addressed to the administrator by name; the
  // contact line names the brand's support e-mail.
  const [request] = pages({ ...SETTINGS, brand: BRAND });
  assert.ok(request.includes('Contact Ops to request access'));
  assert.ok(request.includes('Hi Ops,'));
  const templates = getAccessRequestTemplates('alice', 'app.codelama.com.tr', {
    ...SETTINGS,
    brand: BRAND,
  });
  assert.ok(templates.generic.endsWith('Admin contact: help@codelama.com.tr'));
  assert.ok(
    getAccessRequestTemplates('alice', 'app.codelama.com.tr', SETTINGS).generic.endsWith(
      'Admin contact: ops@example.com',
    ),
  );
});

test('what the brand lacks or what is not valid is left out: no logo, no tagline, the default accent, the settings’ contact, no link', () => {
  const sparse = {
    name: 'Sample Park',
    tagline: null,
    accent: null,
    logoUrl: null,
    supportEmail: null,
    supportUrl: null,
  };
  for (const html of pages({ ...SETTINGS, brand: sparse })) {
    assert.ok(html.includes('<div class="brand-name">Sample Park</div>'));
    assert.doesNotMatch(html, /<img class="brand-logo"|<div class="brand-tagline">|Help:/);
    assert.ok(html.includes(`:root { --accent: ${PAGE_DEFAULT_ACCENT}; }`));
    assert.ok(html.includes('Admin: <a href="mailto:ops@example.com">ops@example.com</a>'));
  }
  // Neither contact: no contact line at all.
  for (const html of pages({ adminName: 'Ops', brand: sparse })) {
    assert.doesNotMatch(html, /class="contact"/);
  }
  // Values the record could never hold (the file is parsed with the same
  // rules, but the page checks again): an accent that is not a colour, a
  // logo elsewhere than a sign-in host's logo path, a non-https URL. (That
  // the host is one of this relay's domains is the reader's to know: it
  // builds the URL from the projection's domain, never from the file.)
  const hostile = {
    ...sparse,
    accent: 'red; } body { background: url(https://evil.example/x) ',
    logoUrl: 'https://evil.example/logo.png',
    supportUrl: 'javascript:alert(1)',
  };
  for (const html of pages({ ...SETTINGS, brand: hostile })) {
    assert.doesNotMatch(html, /evil|javascript|<img class="brand-logo"|Help:/);
    assert.ok(html.includes(`:root { --accent: ${PAGE_DEFAULT_ACCENT}; }`));
  }
  for (const url of [
    'https://auth.codelama.com.tr/static/media/logo.png?x',
    'https://auth.codelama.com.tr/favicon.ico',
    'http://auth.codelama.com.tr/static/media/logo.png',
    'https://codelama.com.tr/static/media/logo.png',
  ]) {
    for (const html of pages({ ...SETTINGS, brand: { ...sparse, logoUrl: url } })) {
      assert.doesNotMatch(html, /<img class="brand-logo"/, url);
    }
  }
});
