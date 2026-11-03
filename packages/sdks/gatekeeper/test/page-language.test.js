/**
 * Gatekeeper's pages in a domain's page language
 * (packages/core/docs/page-language-design.md §7): the access-request page
 * (P6), the domain refusal page (P7) and the "not allowed" page (P9) speak
 * the language `options.language` names — the panel's projection's, read
 * by `pageOptions` — and English otherwise, where they read as 4.9.0's did
 * but for the copy buttons' markup; the JSON templates stay English. Runs
 * against the build.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PAGE_MESSAGES_TR } from '@lamalibre/lamaste';
import {
  buildAccessRequestPage,
  buildDomainRefusalPage,
  buildForbiddenPage,
  getAccessRequestTemplates,
} from '../dist/index.js';

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'lamaste-4.9.0',
);
const SETTINGS = { adminContact: 'ops@alpha.example', adminName: 'Ops' };
const BRAND = {
  name: 'Beta Works',
  tagline: 'Tools, made well',
  accent: '#1d4ed8',
  logoUrl: 'https://auth.beta.example/static/media/logo.png',
  supportEmail: 'help@beta.example',
  supportUrl: 'https://beta.example/help',
};

/** What 4.10 renders for each 4.9.0 fixture, with no language set. */
const ENGLISH = {
  'access-request-stock.html': () => buildAccessRequestPage('alice', 'app.alpha.example', SETTINGS),
  'access-request-default-admin.html': () =>
    buildAccessRequestPage('alice', 'app.alpha.example', {}),
  'access-request-branded.html': () =>
    buildAccessRequestPage('alice', 'app.beta.example', { ...SETTINGS, brand: BRAND }),
  'refusal-domain.html': () =>
    buildDomainRefusalPage('alpha.example', SETTINGS, { host: 'app.alpha.example' }),
  'refusal-site-branded.html': () =>
    buildDomainRefusalPage(
      'beta.example',
      { ...SETTINGS, brand: BRAND },
      { host: 'site.beta.example', site: true },
    ),
  'refusal-no-domain.html': () => buildDomainRefusalPage(null, {}, { host: 'stray.example' }),
};

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'" };

/** What a reader sees: the text without tags and the script, entities read, whitespace collapsed. */
function readText(html) {
  return html
    .replace(/<script>[\s\S]*?<\/script>/g, '')
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<button[^>]*>[^<]*<\/button>/g, ' [button] ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#039);/g, (e) => ENTITIES[e])
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The style's changes since 4.9.0, each on purpose: a message box keeps a
 * band at its top for the copy button, which covered the end of a message's
 * first line (more so "Kopyala" than "Copy"); a heading breaks into lines
 * of even length, never leaving one word alone on the last.
 */
const STYLE_CHANGES_SINCE_4_9 = [
  {
    only: '.template-box',
    from: 'padding: 0.75rem 1rem; margin-bottom: 0.5rem; position: relative;',
    to: 'padding: 2.25rem 1rem 0.75rem; margin-bottom: 0.5rem; position: relative;',
  },
  {
    from: 'h1 { font-size: 1.25rem; color: #f4f4f5; margin-bottom: 0.5rem; }',
    to: 'h1 { font-size: 1.25rem; color: #f4f4f5; margin-bottom: 0.5rem; text-wrap: balance; }',
  },
];

/** 4.9.0's style with the listed changes made, each of which it must have had. */
function styleSince49(style) {
  return STYLE_CHANGES_SINCE_4_9.reduce((s, { only, from, to }) => {
    if (only && !s.includes(only)) return s;
    assert.ok(s.includes(from), `4.9.0 had ${from}`);
    return s.replace(from, to);
  }, style);
}

/**
 * The English text changed since 4.9.0, each on purpose (the reading of the
 * rendered pages): a host under none of the relay's domains is nobody's to
 * open — not a permission of the user's, nothing to be added to — and a
 * static site's refusal names the site in its title, as its heading does.
 */
const TEXT_CHANGES_SINCE_4_9 = {
  'refusal-no-domain.html': [
    ['Not allowed — stray.example', 'stray.example is not available'],
    ['Not allowed on stray.example', 'stray.example is not available'],
    [
      'Ask your administrator to add you if you should have access.',
      'Tell your administrator if this address should work.',
    ],
  ],
  'refusal-site-branded.html': [['Not allowed — beta.example', 'Not allowed — site.beta.example']],
};

/** 4.9.0's text with the listed changes made, each of which it must have had. */
function textSince49(name, text) {
  return (TEXT_CHANGES_SINCE_4_9[name] ?? []).reduce((t, [from, to]) => {
    assert.ok(t.includes(from), `${name}: 4.9.0 had ${from}`);
    return t.replace(from, to);
  }, text);
}

/** The page's style, links, classes and images — everything but the copy buttons' markup. */
function shape(html) {
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  const attrs = [...html.matchAll(/\s(href|src|class|lang)="([^"]*)"/g)]
    .map((m) => `${m[1]}=${m[2]}`)
    .filter((a) => a !== 'class=template-box' && a !== 'class=copy-btn');
  return { style, attrs };
}

/** The labels of the copy buttons, in order. */
function buttonLabels(html) {
  return [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
}

test('English, no language set: each page reads as 4.9.0’s, in the same shape, but for the copy buttons', () => {
  for (const [name, render] of Object.entries(ENGLISH)) {
    const before = fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
    const html = render();
    assert.equal(readText(html), textSince49(name, readText(before)), `${name}: the text`);
    const old = shape(before);
    assert.deepEqual(
      shape(html),
      { ...old, style: styleSince49(old.style) },
      `${name}: style, links, classes`,
    );
    assert.deepEqual(buttonLabels(html), buttonLabels(before), `${name}: the labels`);
  }
  // `language: null` is English too (the projection reads an unknown value as null).
  assert.equal(
    buildAccessRequestPage('alice', 'app.alpha.example', { ...SETTINGS, language: null }),
    buildAccessRequestPage('alice', 'app.alpha.example', SETTINGS),
  );
});

test('the copy buttons carry their words in attributes; the script copies the template’s own element and holds no word', () => {
  for (const language of ['en', 'tr']) {
    const html = buildAccessRequestPage('alice', 'app.alpha.example', { ...SETTINGS, language });
    const copy = language === 'en' ? 'Copy' : 'Kopyala';
    const copied = language === 'en' ? 'Copied' : 'Kopyalandı';
    for (const id of ['tpl-email', 'tpl-slack', 'tpl-whatsapp']) {
      assert.ok(html.includes(`<div id="${id}">`), `${id}: the template in an element of its own`);
      assert.ok(
        html.includes(
          `<button class="copy-btn" data-label="${copy}" data-copied="${copied}" onclick="copyTemplate('${id}', this)">${copy}</button>`,
        ),
      );
    }
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    assert.doesNotMatch(script, /Copy|Kopyala/, 'no label in the script');
    assert.match(script, /writeText\(el\.textContent\)/);
  }
  // One script for every language: nothing in it depends on the words.
  const scriptOf = (language) =>
    /<script>([\s\S]*?)<\/script>/.exec(
      buildAccessRequestPage('alice', 'app.alpha.example', { language }),
    )?.[1];
  assert.equal(scriptOf('tr'), scriptOf('en'));
});

test('a Turkish domain: the access-request page in Turkish — lang, title, sentences, labels, templates', () => {
  const html = buildAccessRequestPage('alice', 'app.alpha.example', {
    ...SETTINGS,
    language: 'tr',
  });
  assert.match(html, /<html lang="tr">/);
  assert.match(html, /<title>Erişim izni gerekiyor — app\.alpha\.example<\/title>/);
  assert.ok(html.includes('<h1>Erişim izni gerekiyor</h1>'));
  assert.ok(html.includes('<span class="fqdn">app.alpha.example</span> adresine erişiminiz yok'));
  assert.ok(html.includes('Giriş yapılan hesap: <span class="user-badge">alice</span>'));
  assert.ok(html.includes('Erişim istemek için Ops ile iletişime geçin.'));
  assert.ok(html.includes('<div class="section-label">E-posta</div>'));
  // The e-mail: the subject label, the subject and the body, with no name after "Merhaba".
  assert.ok(
    html.includes(
      '<div id="tpl-email">Konu: app.alpha.example için erişim talebi\n\nMerhaba,\n\napp.alpha.example adresine erişim talep ediyorum.\nKullanıcı adım: alice\n\nTeşekkürler.</div>',
    ),
  );
  assert.ok(
    html.includes(
      'Merhaba, app.alpha.example adresine erişim izni verebilir misiniz? Kullanıcı adım: alice.',
    ),
  );
  assert.ok(html.includes('Merhaba, app.alpha.example adresine erişmem gerekiyor'));
  assert.ok(html.includes('<p class="contact">Yönetici: <a href="mailto:ops@alpha.example">'));
  // No English sentence left (product names and the user's own words aside).
  for (const english of [
    'Access Required',
    'Signed in as',
    'Contact ',
    'Subject:',
    'Hi ',
    'Admin:',
  ]) {
    assert.ok(!html.includes(english), `no "${english}"`);
  }
  // The default administrator in a sentence, when the settings name none.
  const unnamed = buildAccessRequestPage('alice', 'app.alpha.example', { language: 'tr' });
  assert.ok(unnamed.includes('Erişim istemek için yöneticinizle iletişime geçin.'));
  // The brand's support link label.
  const branded = buildAccessRequestPage('alice', 'app.beta.example', {
    ...SETTINGS,
    brand: BRAND,
    language: 'tr',
  });
  assert.ok(branded.includes('<p class="contact">Yardım: <a href="https://beta.example/help"'));
  assert.match(branded, /<title>Erişim izni gerekiyor — app\.beta\.example — Beta Works<\/title>/);
});

test('the JSON templates stay English whatever the page language', () => {
  const english = getAccessRequestTemplates('alice', 'app.alpha.example', SETTINGS);
  assert.deepEqual(
    getAccessRequestTemplates('alice', 'app.alpha.example', { ...SETTINGS, language: 'tr' }),
    english,
  );
  assert.deepEqual(english, {
    email: {
      subject: 'Access request for app.alpha.example',
      body: "Hi Ops,\n\nI'd like to request access to app.alpha.example.\nMy username is: alice\n\nThank you.",
    },
    slack: 'Hi, could I get access to `app.alpha.example`? My username is `alice`.',
    teams: 'Hi, could I get access to **app.alpha.example**? My username is **alice**.',
    whatsapp: 'Hi, I need access to app.alpha.example (username: alice). Thanks!',
    generic:
      'Access request for app.alpha.example\nUsername: alice\nAdmin contact: ops@alpha.example',
  });
  // No contact: the generic template ends with the username, as in 4.9.0.
  assert.equal(
    getAccessRequestTemplates('alice', 'app.alpha.example', {}).generic,
    'Access request for app.alpha.example\nUsername: alice',
  );
  assert.ok(
    getAccessRequestTemplates('alice', 'x.example', {}).email.body.startsWith('Hi Administrator,'),
  );
});

test('a Turkish domain: the refusal pages in Turkish, the sign-out link built around the escaped words', () => {
  const member = buildDomainRefusalPage(
    'alpha.example',
    { ...SETTINGS, language: 'tr' },
    { host: 'app.alpha.example' },
  );
  assert.match(member, /<html lang="tr">/);
  assert.match(member, /<title>İzin verilmiyor — alpha\.example<\/title>/);
  assert.ok(member.includes('<h1><span class="fqdn">alpha.example</span> üyesi değilsiniz</h1>'));
  assert.ok(member.includes(PAGE_MESSAGES_TR['refusal.domain']));
  assert.ok(
    member.includes(
      'Erişiminiz olması gerekiyorsa Ops ile iletişime geçip sizi eklemesini isteyin.',
    ),
  );
  assert.ok(
    member.includes(
      'Başka bir hesapla giriş yapmak için <a href="https://auth.alpha.example/logout">oturumu kapatın</a>.',
    ),
  );

  const site = buildDomainRefusalPage(
    'alpha.example',
    { language: 'tr' },
    {
      host: 'site.alpha.example',
      site: true,
    },
  );
  assert.ok(
    site.includes(
      '<h1><span class="fqdn">site.alpha.example</span> adresine erişim izniniz yok</h1>',
    ),
  );
  assert.ok(
    site.includes(
      'Giriş yaptınız, ancak bu siteyi açma izniniz yok: alpha.example üyesi değilsiniz',
    ),
  );
  assert.ok(site.includes('yöneticinizle iletişime geçip'));
  assert.match(site, /<title>İzin verilmiyor — site\.alpha\.example<\/title>/);

  const none = buildDomainRefusalPage(null, { language: 'tr' }, { host: 'stray.example' });
  assert.ok(none.includes(PAGE_MESSAGES_TR['refusal.noDomain']));
  // Nobody's to open: no personal permission, no request to be added.
  assert.match(none, /<title>stray\.example adresi kullanılamıyor<\/title>/);
  assert.ok(
    none.includes('<h1><span class="fqdn">stray.example</span> adresi kullanılamıyor</h1>'),
  );
  assert.ok(none.includes('Bu adresin çalışması gerekiyorsa yöneticinize bildirin.'));
  assert.doesNotMatch(none, /eklemesini isteyin/);
  const named = buildDomainRefusalPage(
    null,
    { ...SETTINGS, language: 'tr' },
    { host: 'stray.example' },
  );
  assert.ok(named.includes('Bu adresin çalışması gerekiyorsa Ops ile iletişime geçin.'));
  assert.doesNotMatch(none, /logout/, 'no sign-in link for a host under no domain');
});

test('what a page names is escaped, and never read as a template, in every language', () => {
  for (const language of ['en', 'tr']) {
    const html = buildAccessRequestPage('a{host}<b>', 'x.example', {
      adminName: '{username} & <i>',
      language,
    });
    assert.ok(!html.includes('<b>') && !html.includes('<i>'));
    assert.ok(html.includes('a{host}&lt;b&gt;'), 'the username as text, its braces kept');
    assert.ok(html.includes('{username} &amp; &lt;i&gt;'), 'the administrator’s name as text');
    const refusal = buildDomainRefusalPage(
      'alpha.example',
      { adminName: '<script>{domain}', language },
      { host: 'app.alpha.example' },
    );
    assert.ok(refusal.includes('&lt;script&gt;{domain}'));
    assert.ok(!refusal.includes('<script>'));
  }
});

test('the "not allowed" page (P9): in the domain’s language and brand, naming nothing of the request', () => {
  const english = buildForbiddenPage(SETTINGS);
  assert.match(english, /<html lang="en">/);
  assert.match(english, /<title>Not Allowed<\/title>/);
  assert.ok(english.includes('<h1>Not Allowed</h1>'));
  assert.ok(english.includes('<p class="subtitle">You cannot open this page.</p>'));
  assert.ok(english.includes('Admin: <a href="mailto:ops@alpha.example">'));
  assert.doesNotMatch(english, /<script/);

  const turkish = buildForbiddenPage({ ...SETTINGS, brand: BRAND, language: 'tr' });
  assert.match(turkish, /<html lang="tr">/);
  assert.match(turkish, /<title>İzin verilmiyor — Beta Works<\/title>/);
  assert.ok(turkish.includes('<p class="subtitle">Bu sayfayı açma izniniz yok.</p>'));
  assert.ok(turkish.includes('<div class="brand-name">Beta Works</div>'));
  assert.ok(turkish.includes('Yardım: <a href="https://beta.example/help"'));
});

test('a message box keeps the copy button off its text, in both languages', () => {
  for (const language of ['en', 'tr']) {
    const html = buildAccessRequestPage('alice', 'app.alpha.example', { ...SETTINGS, language });
    const box = /\.template-box \{([^}]*)\}/.exec(html)?.[1] ?? '';
    const top = Number(/padding: ([\d.]+)rem/.exec(box)?.[1]);
    const button = /\.copy-btn \{([^}]*)\}/.exec(html)?.[1] ?? '';
    const offset = Number(/top: ([\d.]+)rem/.exec(button)?.[1]);
    // The button: its offset, one line of 0.6875rem text and its padding and border.
    assert.ok(top >= offset + 0.6875 * 1.5 + 0.5 + 0.125, `${language}: padding-top ${top}rem`);
  }
});
