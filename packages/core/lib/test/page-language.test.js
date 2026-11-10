/**
 * The pages' language (docs/page-language-design.md): the catalogue and its
 * rules, the pages rendered in each language with one script and style for
 * every language and brand (the invariant their CSP rests on), the data
 * block, the "not available" page, Authelia's portal forced into a
 * language — pinned against verbatim fixtures of Authelia 4.39.28 — the
 * rendering of a domain with a language, and the projection's language.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  ACCESS_REQUEST_PAGE_KEYS,
  AUTHELIA_ACCOUNT_LINK_CSS,
  AUTHELIA_CORRECTIONS,
  AUTHELIA_FORCED_NAMESPACES,
  AUTHELIA_INDEX_LANG_LITERAL,
  AUTHELIA_LANGUAGE_DETECTION_ORDER,
  AUTHELIA_LANGUAGE_MENU_SELECTOR,
  AUTHELIA_NOSCRIPT_TEXT,
  AUTHELIA_NOSCRIPT_TRANSLATIONS,
  AUTHELIA_RELEASE,
  AUTHELIA_SUPPLEMENT,
  AUTH_BRANDING_FILES,
  BRAND_CSS_LANGUAGE_MENU_RULE,
  DOMAIN_REFUSAL_PAGE_KEYS,
  FORBIDDEN_PAGE_KEYS,
  INVITATIONS_PAGE_KEYS,
  INVITE_PAGE_KEYS,
  PAGE_LANGUAGES,
  PAGE_LANGUAGE_NAMES,
  PAGE_MESSAGES,
  PAGE_MESSAGE_DROPPED_PLACEHOLDERS,
  PAGE_MESSAGE_KEYS,
  UNAVAILABLE_PAGE_KEYS,
  autheliaIndexLanguageFilters,
  domainLanguageOfHost,
  formatMessage,
  formatMessageHtml,
  htmlAsciiReferences,
  indexDomainsProjection,
  isPageLanguage,
  messagePlaceholders,
  pageMessagesFor,
  pageMessagesJson,
  parseDomainsProjection,
  pluralKey,
  renderDomainCss,
  renderForcedAutheliaLocale,
} from '../dist/index.js';
import * as pageMessagesEntry from '../dist/page-messages.js';
import {
  AUTH_PAGE_STYLE,
  INVITATIONS_PAGE_HEADERS,
  INVITATIONS_PAGE_SCRIPT,
  INVITE_PAGE_HEADERS,
  INVITE_PAGE_SCRIPT,
  UNAVAILABLE_PAGE_STYLE,
  UNAVAILABLE_PAGE_STYLE_HASH,
  authPagesDigest,
  readRenderedBrand,
  renderAuthBranding,
  renderInvitationsPage,
  renderInvitePage,
  renderUnavailablePage,
  renderedBrandSha256,
  sha256Hex,
  unavailablePageHeaders,
} from '../dist/server/index.js';
import { authPageShell } from '../dist/server/auth-pages.js';

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const PINNED = AUTHELIA_RELEASE.version;
const upstream = (file) => readFile(fixture(`authelia-${PINNED}/${file}`), 'utf-8');
const upstreamLocale = async (locale, namespace) =>
  JSON.parse(await upstream(`internal/server/locales/${locale}/${namespace}.json`));

/** Every string of a locale file, by dotted path. */
function flatten(messages, prefix = '') {
  return Object.entries(messages).flatMap(([key, value]) =>
    value !== null && typeof value === 'object'
      ? flatten(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  );
}

const BRANDS = [
  null,
  { name: 'Alpha Works', tagline: 'Tools, "made"', theme: 'light', accent: '#1d4ed8', logo: true },
  { name: 'Beta & Co', tagline: null, theme: 'oled', accent: null, logo: false },
];

/** The text of every inline `<tag>` element (no attributes) of `html`. */
function inline(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
}

/** The data block of a page, parsed — and the number of data blocks. */
function dataBlock(html) {
  const blocks = [
    ...html.matchAll(
      /<script type="application\/json" id="lamaste-messages">([\s\S]*?)<\/script>/g,
    ),
  ];
  return { count: blocks.length, value: blocks[0] ? JSON.parse(blocks[0][1]) : null };
}

function sha256Source(text) {
  return `'sha256-${createHash('sha256').update(text, 'utf-8').digest('base64')}'`;
}

// --- the catalogue ----------------------------------------------------------

test('every language has every key, and nothing else; the names and the guard', () => {
  assert.deepEqual(PAGE_LANGUAGES, ['en', 'tr']);
  assert.deepEqual(PAGE_LANGUAGE_NAMES, { en: 'English', tr: 'Türkçe' });
  for (const language of PAGE_LANGUAGES) {
    assert.ok(isPageLanguage(language));
    assert.deepEqual(Object.keys(PAGE_MESSAGES[language]).sort(), [...PAGE_MESSAGE_KEYS].sort());
    for (const key of PAGE_MESSAGE_KEYS) {
      const text = PAGE_MESSAGES[language][key];
      assert.equal(typeof text, 'string', `${language} ${key}`);
      assert.ok(text.trim().length > 0 && text === text.trim(), `${language} ${key}`);
    }
  }
  for (const value of ['EN', 'de', '', null, 'tr-TR', '__proto__']) {
    assert.equal(isPageLanguage(value), false);
  }
  // The browser-safe subpath carries the catalogue.
  assert.equal(pageMessagesEntry.PAGE_MESSAGES, PAGE_MESSAGES);
});

test('every translation carries exactly the English placeholders, except the one listed', () => {
  for (const language of PAGE_LANGUAGES) {
    for (const key of PAGE_MESSAGE_KEYS) {
      const dropped = PAGE_MESSAGE_DROPPED_PLACEHOLDERS[language]?.[key] ?? [];
      const expected = messagePlaceholders(PAGE_MESSAGES.en[key]).filter(
        (name) => !dropped.includes(name),
      );
      assert.deepEqual(messagePlaceholders(PAGE_MESSAGES[language][key]), expected, key);
    }
  }
  assert.deepEqual(PAGE_MESSAGE_DROPPED_PLACEHOLDERS, { tr: { 'template.body': ['admin'] } });
  // The `[…]` link span is in every language's sign-out sentence, once.
  for (const language of PAGE_LANGUAGES) {
    assert.match(PAGE_MESSAGES[language]['refusal.signOut'], /^[^[\]]*\[[^[\]]+\][^[\]]*$/);
  }
});

test('no text carries a control, bidi or invisible character, a < or a >', () => {
  const forbidden =
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff<>]/u;
  for (const language of PAGE_LANGUAGES) {
    for (const key of PAGE_MESSAGE_KEYS) {
      assert.doesNotMatch(PAGE_MESSAGES[language][key], forbidden, `${language} ${key}`);
    }
    // Only the message templates hold a line break.
    for (const key of PAGE_MESSAGE_KEYS.filter((k) => !k.startsWith('template.'))) {
      assert.doesNotMatch(PAGE_MESSAGES[language][key], /\n/, `${language} ${key}`);
    }
  }
  for (const [path, value] of Object.values(AUTHELIA_SUPPLEMENT.tr).flatMap((m) => flatten(m))) {
    assert.doesNotMatch(value.replace(/<\/?policy>/g, ''), forbidden, path);
  }
});

test('the Turkish keeps the reviewed terms: siz, Authelia’s sign-in words, no suffix on a name', () => {
  const tr = PAGE_MESSAGES.tr;
  assert.equal(tr['invitations.signIn'], 'Giriş yap');
  assert.match(tr['refusal.signOut'], /oturumu kapatın/);
  assert.equal(tr['invite.password'], 'Şifre');
  for (const key of PAGE_MESSAGE_KEYS) {
    assert.doesNotMatch(tr[key], /parola/i, key);
    // A placeholder is followed by a space, punctuation or the end — never a suffix.
    assert.doesNotMatch(tr[key], /\{[A-Za-z]+\}['’]?[a-zçğıöşüA-ZÇĞİÖŞÜ]/u, key);
  }
  // The username rule names the letters it refuses (a Turkish a–z includes them).
  assert.match(tr['invite.usernameHint'], /ç, ğ, ı, ö, ş, ü/);
  assert.match(tr['invite.usernameRule'], /ç, ğ, ı, ö, ş, ü/);
});

test('each page carries its own keys; Gatekeeper’s pages have theirs', () => {
  for (const keys of [
    INVITE_PAGE_KEYS,
    INVITATIONS_PAGE_KEYS,
    UNAVAILABLE_PAGE_KEYS,
    FORBIDDEN_PAGE_KEYS,
    ACCESS_REQUEST_PAGE_KEYS,
    DOMAIN_REFUSAL_PAGE_KEYS,
  ]) {
    assert.ok(keys.length > 0);
    assert.equal(new Set(keys).size, keys.length, 'no key twice');
    for (const key of keys) assert.ok(PAGE_MESSAGE_KEYS.includes(key), key);
  }
  assert.ok(INVITE_PAGE_KEYS.includes('invite.usernameRule'));
  assert.ok(!INVITE_PAGE_KEYS.includes('invitations.title'));
  assert.ok(INVITATIONS_PAGE_KEYS.includes('status.revoked'));
  assert.ok(INVITATIONS_PAGE_KEYS.includes('invitations.bounds_one'));
  assert.ok(ACCESS_REQUEST_PAGE_KEYS.includes('template.body'));
  assert.ok(DOMAIN_REFUSAL_PAGE_KEYS.includes('refusal.askDefault'));
  assert.ok(DOMAIN_REFUSAL_PAGE_KEYS.includes('refusal.noDomainAskDefault'));
  assert.ok(ACCESS_REQUEST_PAGE_KEYS.includes('access.contactDefault'));
  assert.ok(INVITATIONS_PAGE_KEYS.includes('error.not_found.create'));
  assert.ok(INVITATIONS_PAGE_KEYS.includes('invitations.loadFailed'));
  // A text naming no one has no placeholder a suffix would have to follow.
  for (const key of PAGE_MESSAGE_KEYS.filter((k) => k.endsWith('Default'))) {
    assert.deepEqual(messagePlaceholders(PAGE_MESSAGES.en[key]), [], key);
  }
  assert.deepEqual(Object.keys(pageMessagesFor('tr', UNAVAILABLE_PAGE_KEYS)), [
    'unavailable.title',
    'unavailable.text',
  ]);
});

// --- formatting -------------------------------------------------------------

test('formatting is one pass: a value holding a placeholder stays text', () => {
  assert.equal(
    formatMessage('{inviter} invited you to {plugin}', { inviter: '{plugin}', plugin: 'P' }),
    '{plugin} invited you to P',
  );
  assert.equal(formatMessage('{a} {missing}', { a: 1 }), '1 {missing}');
  assert.equal(formatMessage('{constructor}', {}), '{constructor}', 'no inherited value');
  const html = formatMessageHtml(PAGE_MESSAGES.en['invite.delegatedBy'], {
    inviter: '<b>{role}</b>',
    plugin: { text: 'A & B', tag: 'strong', className: 'accent' },
    role: { text: '"R"', tag: 'strong' },
  });
  assert.equal(
    html,
    '&lt;b&gt;{role}&lt;/b&gt; invited you to <strong class="accent">A &amp; B</strong> as <strong>&quot;R&quot;</strong>.',
  );
  assert.equal(
    formatMessageHtml(
      PAGE_MESSAGES.tr['refusal.signOut'],
      {},
      { href: 'https://auth.alpha.test/logout?a=1&b="2"' },
    ),
    'Başka bir hesapla giriş yapmak için <a href="https://auth.alpha.test/logout?a=1&amp;b=&quot;2&quot;">oturumu kapatın</a>.',
  );
  assert.throws(() => formatMessageHtml('no link', {}, { href: 'https://x' }));
  assert.throws(() =>
    formatMessageHtml('{a}', { a: { text: 'x', tag: 'span', className: 'a"b' } }),
  );
});

test('plurals by Intl.PluralRules; a vhost text as ASCII character references', () => {
  assert.equal(pluralKey('en', 'invitations.bounds', 1), 'invitations.bounds_one');
  assert.equal(pluralKey('en', 'invitations.bounds', 7), 'invitations.bounds_other');
  assert.equal(pluralKey('tr', 'invitations.bounds', 1), 'invitations.bounds_one');
  assert.equal(pluralKey('tr', 'invitations.bounds', 3), 'invitations.bounds_other');
  assert.equal(htmlAsciiReferences('için ı'), 'i&#231;in &#305;');
  assert.equal(htmlAsciiReferences('plain'), 'plain');
  assert.throws(() => htmlAsciiReferences('a\nb'));
});

test('the data block: nothing a text holds can end the element or be read as markup', () => {
  const hostile = {
    a: '</script><script>alert(1)</script>',
    b: '<!-- & -->',
    c: 'line\u2028separator\u2029',
  };
  const json = pageMessagesJson('tr', hostile);
  assert.doesNotMatch(json, /[<>&\u2028\u2029]/);
  assert.deepEqual(JSON.parse(json), { lang: 'tr', messages: hostile });
  // Every catalogue text of every page, in every language, lands intact in
  // the one data block, and the element holds no `</`.
  for (const language of PAGE_LANGUAGES) {
    for (const [render, keys] of [
      [renderInvitePage, INVITE_PAGE_KEYS],
      [renderInvitationsPage, INVITATIONS_PAGE_KEYS],
    ]) {
      const html = render(null, language);
      const block = dataBlock(html);
      assert.equal(block.count, 1);
      assert.deepEqual(block.value, { lang: language, messages: pageMessagesFor(language, keys) });
    }
  }
});

// --- the pages ----------------------------------------------------------------

test('both pages, in every language and for every brand: one script and one style, named by hash', () => {
  for (const [render, headers, script, titleKey, loadingKey] of [
    [renderInvitePage, INVITE_PAGE_HEADERS, INVITE_PAGE_SCRIPT, 'invite.title', 'invite.loading'],
    [
      renderInvitationsPage,
      INVITATIONS_PAGE_HEADERS,
      INVITATIONS_PAGE_SCRIPT,
      'invitations.title',
      'invitations.loading',
    ],
  ]) {
    const csp = headers['Content-Security-Policy'];
    assert.ok(csp.includes(`script-src ${sha256Source(script)};`));
    assert.ok(csp.includes(`style-src 'self' ${sha256Source(AUTH_PAGE_STYLE)};`));
    for (const language of PAGE_LANGUAGES) {
      for (const brand of BRANDS) {
        const html = render(brand, language);
        assert.deepEqual(inline(html, 'script'), [script], 'the one script, whatever the language');
        assert.deepEqual(inline(html, 'style'), [AUTH_PAGE_STYLE]);
        assert.ok(html.includes(`<html lang="${language}">`));
        const name = brand === null ? 'Lamaste' : brand.name.replace('&', '&amp;');
        assert.ok(html.includes(`<title>${name} — ${PAGE_MESSAGES[language][titleKey]}</title>`));
        assert.ok(html.includes(`        ${PAGE_MESSAGES[language][loadingKey]}\n`));
        assert.equal(dataBlock(html).value.lang, language);
        assert.doesNotMatch(html, / style="| on[a-z]+="/);
      }
    }
    // The default is English.
    assert.equal(render(null), render(null, 'en'));
    assert.throws(() => render(null, 'de'));
  }
});

test('the scripts never show a refusal’s own text, and take their words from the data block', () => {
  for (const script of [INVITE_PAGE_SCRIPT, INVITATIONS_PAGE_SCRIPT]) {
    assert.doesNotMatch(script, /\.error\b/, 'no read of the server’s error text');
    assert.ok(
      script.includes("JSON.parse(document.getElementById('lamaste-messages').textContent)"),
    );
    assert.ok(script.includes('toLocaleString(LANG,'), 'dates in the page’s language');
    assert.doesNotMatch(script, /toLocaleString\(undefined/);
    assert.ok(script.includes("keys.push('error.' + body.code)"), 'a code picks the words');
    // No English word left in the markup the scripts build.
    for (const word of [
      'Invitation Unavailable',
      'Create Account',
      'Revoke',
      'Copied',
      'Sign in',
    ]) {
      assert.ok(!script.includes(`'${word}'`) && !script.includes(`>${word}<`), word);
    }
  }
  // Forms validate in the page's words, not the browser's.
  assert.ok(INVITE_PAGE_SCRIPT.includes('<form id="accept-form" novalidate>'));
  assert.ok(INVITATIONS_PAGE_SCRIPT.includes('<form id="invite-form" novalidate>'));
  assert.ok(INVITATIONS_PAGE_SCRIPT.includes("msg('invitations.emailInvalid')"));
  // Plurals by the page's language.
  assert.ok(INVITATIONS_PAGE_SCRIPT.includes('new Intl.PluralRules(LANG)'));
});

test('the inviter’s page words a refusal by its action, its code, its status, then its fallback', () => {
  // The script's own functions, run on the Turkish data block.
  const take = (re) => {
    const m = re.exec(INVITATIONS_PAGE_SCRIPT);
    assert.ok(m, String(re));
    return m[0];
  };
  const source = [
    take(/var STATUS_KEYS = [^\n]*\n/),
    take(/var LOAD_KEYS = [^\n]*\n/),
    take(/var CODE_RE = [^\n]*\n/),
    take(/var DETAIL_RE = [^\n]*\n/),
    take(/function has\(key\) [^\n]*\n/),
    take(/function msg\(key\) [^\n]*\n/),
    take(/function refusal\(status, body, statusKeys, action\) \{[\s\S]*?\n {6}\}\n/),
    'return { refusal, STATUS_KEYS, LOAD_KEYS };',
  ].join('');
  const M = pageMessagesFor('tr', INVITATIONS_PAGE_KEYS);
  const { refusal, STATUS_KEYS, LOAD_KEYS } = new Function('M', source)(M);
  const notFound = { code: 'not_found', error: 'Not found' };
  // `not_found` answering a new invitation: the application was not found …
  assert.equal(refusal(404, notFound, STATUS_KEYS, 'create'), 'Uygulama bulunamadı.');
  assert.equal(refusal(404, {}, STATUS_KEYS, 'create'), 'Uygulama bulunamadı.');
  // … answering a revocation: the invitation.
  assert.equal(refusal(404, notFound, STATUS_KEYS), 'Davet bulunamadı.');
  // A code without an action's own text keeps its words.
  assert.equal(
    refusal(400, { code: 'email_domain_not_allowed' }, STATUS_KEYS, 'create'),
    M['error.email_domain_not_allowed'],
  );
  // Loading: the page's own fallback, not the heading said twice.
  assert.equal(
    refusal(500, {}, LOAD_KEYS),
    'Sayfa yüklenemedi. Lütfen daha sonra yeniden deneyin.',
  );
  assert.equal(refusal(500, {}, STATUS_KEYS), M['error.generic']);
  assert.notEqual(M['invitations.loadFailed'], M['invitations.errorTitle']);
});

test('the invitation page: a taken username on an administrator’s invitation is not told to choose another', () => {
  const take = (re) => {
    const m = re.exec(INVITE_PAGE_SCRIPT);
    assert.ok(m, String(re));
    return m[0];
  };
  const source = [
    take(/var STATUS_KEYS = [^\n]*\n/),
    take(/var CODE_RE = [^\n]*\n/),
    take(/var DETAIL_RE = [^\n]*\n/),
    take(/function has\(key\) [^\n]*\n/),
    take(/function msg\(key\) [^\n]*\n/),
    take(/function refusal\(status, body, statusKeys, action\) \{[\s\S]*?\n {6}\}\n/),
    'return { refusal, STATUS_KEYS };',
  ].join('');
  // The administrator's form sends with its action; the delegated one without.
  assert.ok(INVITE_PAGE_SCRIPT.includes("bindForm(function () { return {}; }, 'admin');"));
  assert.ok(INVITE_PAGE_SCRIPT.includes("post('/api/invite/accept', body, action)"));
  const taken = { code: 'username_unavailable', error: 'This username already exists' };
  for (const language of PAGE_LANGUAGES) {
    const M = pageMessagesFor(language, INVITE_PAGE_KEYS);
    const { refusal, STATUS_KEYS } = new Function('M', source)(M);
    assert.equal(refusal(409, taken, STATUS_KEYS, 'admin'), M['error.username_unavailable.admin']);
    assert.equal(refusal(409, taken, STATUS_KEYS), M['error.username_unavailable']);
  }
  // English as 4.9 showed it.
  assert.equal(
    PAGE_MESSAGES.en['error.username_unavailable.admin'],
    'This username already exists.',
  );
});

test('the shell escapes its title and loading text', () => {
  const html = authPageShell({
    brand: null,
    language: 'en',
    title: 'A <b> & "c"',
    loading: '<img src=x>',
    messages: {},
    script: '',
  });
  assert.ok(html.includes('<title>Lamaste — A &lt;b&gt; &amp; &quot;c&quot;</title>'));
  assert.ok(html.includes('&lt;img src=x&gt;'));
  assert.doesNotMatch(html, /<img src=x>/);
  assert.throws(() =>
    authPageShell({
      brand: null,
      language: 'xx',
      title: '',
      loading: '',
      messages: {},
      script: '',
    }),
  );
});

/** A page with its scripts' contents and data block taken out: what 4.9.0's shell must still be. */
function shellOf(html) {
  return html
    .replace(/\n {2}<script type="application\/json" id="lamaste-messages">[\s\S]*?<\/script>/, '')
    .replace(/<script>[\s\S]*?<\/script>/, '<script>…</script>');
}

/**
 * The style's changes since 4.9.0, each on purpose: a detail row's value
 * breaks at a space when it can — `break-all` split "17:30" in two when a
 * longer label (Turkish "Davet iptal edilsin mi?") narrowed the column.
 */
const STYLE_CHANGES_SINCE_4_9 = [
  ['text-align: right; word-break: break-all; }', 'text-align: right; overflow-wrap: anywhere; }'],
  // 4.13: the "Change password" link under the card (mail-design.md §6.3).
  [
    'min-height: 100vh; display: flex; align-items: center; justify-content: center;',
    'min-height: 100vh; display: flex; flex-direction: column;\n      align-items: center; justify-content: center;',
  ],
  [
    'color: var(--lamaste-page-accent, #22d3ee); }\n  </style>',
    'color: var(--lamaste-page-accent, #22d3ee); }\n    .page-links { margin-top: 1rem; font-size: 0.75rem; }\n    .page-links a { color: var(--lamaste-page-muted, #71717a); }\n    .page-links a:hover { color: var(--lamaste-page-heading, #f4f4f5); }\n  </style>',
  ],
  [
    '\n  </div>\n  <script>',
    '\n  </div>\n  <nav class="page-links"><a href="/account/password">Change password</a></nav>\n  <script>',
  ],
];

test('an unset domain’s pages are 4.9.0’s but for the data block, the script and the listed style changes (regression pin)', async () => {
  for (const [render, name] of [
    [renderInvitePage, 'invite-page.html'],
    [renderInvitationsPage, 'invitations-page.html'],
  ]) {
    let before = await readFile(fixture(`lamaste-4.9.0/${name}`), 'utf-8');
    for (const [from, to] of STYLE_CHANGES_SINCE_4_9) {
      assert.ok(before.includes(from), `${name}: 4.9.0 had ${from}`);
      before = before.replace(from, to);
    }
    assert.equal(shellOf(render(null)), shellOf(before), name);
  }
});

test('a detail row’s value wraps at a space, never inside a word it could keep whole', () => {
  const rule = /\.detail-value \{([^}]*)\}/.exec(AUTH_PAGE_STYLE)?.[1] ?? '';
  assert.ok(rule.includes('overflow-wrap: anywhere'), rule);
  assert.ok(!rule.includes('word-break'), rule);
});

// --- the "not available" page ----------------------------------------------

test('the "not available" page: one style for every brand and language, no script, its CSP', () => {
  assert.equal(UNAVAILABLE_PAGE_STYLE_HASH, sha256Source(UNAVAILABLE_PAGE_STYLE));
  for (const language of PAGE_LANGUAGES) {
    for (const brand of BRANDS) {
      const html = renderUnavailablePage({ brand, language, domain: 'alpha.test' });
      assert.deepEqual(inline(html, 'style'), [UNAVAILABLE_PAGE_STYLE]);
      assert.doesNotMatch(html, /<script|<link| style="| on[a-z]+="/);
      assert.ok(html.includes(`<html lang="${language}">`));
      assert.ok(html.includes(`<h1>${PAGE_MESSAGES[language]['unavailable.title']}</h1>`));
      if (brand?.logo) {
        assert.ok(html.includes('src="https://auth.alpha.test/static/media/logo.png"'));
      } else {
        assert.doesNotMatch(html, /<img/);
      }
    }
  }
  const branded = renderUnavailablePage({ brand: BRANDS[2], language: 'tr', domain: 'beta.test' });
  assert.ok(branded.includes('<div class="brand-name">Beta &amp; Co</div>'));
  assert.ok(branded.includes('<title>Beta &amp; Co — Uygulama şu anda kullanılamıyor</title>'));
  assert.throws(() => renderUnavailablePage({ brand: BRANDS[1], language: 'en', domain: null }));
  assert.throws(() => renderUnavailablePage({ brand: null, language: 'en', domain: '../x' }));

  const headers = unavailablePageHeaders('alpha.test');
  assert.equal(
    headers['Content-Security-Policy'],
    `default-src 'none'; style-src ${UNAVAILABLE_PAGE_STYLE_HASH}; img-src https://auth.alpha.test; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
  );
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.match(unavailablePageHeaders(null)['Content-Security-Policy'], /img-src 'none'/);
  for (const value of Object.values(headers)) {
    assert.match(value, /^[\x20-\x7e]+$/, 'ASCII, as everything in a vhost');
    assert.doesNotMatch(value, /\$/);
  }
  assert.throws(() => unavailablePageHeaders('alpha.test; add_header x y'));
});

test('the pages’ digest covers every language and the "not available" page', () => {
  const digest = authPagesDigest();
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(authPagesDigest(), digest);
});

// --- Authelia's portal --------------------------------------------------------

test(`Authelia ${PINNED}’s portal contracts the forcing relies on`, async () => {
  const i18n = await upstream('web/src/i18n/index.ts');
  assert.ok(
    i18n.includes(`order: [${AUTHELIA_LANGUAGE_DETECTION_ORDER.map((o) => `"${o}"`).join(', ')}],`),
    'detection: the visitor’s choice, then the browser — no query, no cookie',
  );
  assert.ok(
    i18n.includes(`ns: [${AUTHELIA_FORCED_NAMESPACES.map((n) => `"${n}"`).join(', ')}],`),
    'the namespaces',
  );
  assert.ok(
    i18n.includes('loadPath: basePath + "/locales/{{lng}}/{{ns}}.json",'),
    'one path shape',
  );
  assert.ok(i18n.includes('load: "all",'));
  const menu = await upstream('web/src/components/AppBarItemLanguage.tsx');
  assert.ok(menu.includes(`id="${AUTHELIA_LANGUAGE_MENU_SELECTOR.slice(1)}"`), 'the menu’s id');
  const index = await upstream('web/index.html');
  assert.ok(index.includes(`${AUTHELIA_INDEX_LANG_LITERAL}{{ .Language }}">`), 'the lang literal');
  assert.ok(index.includes(`<noscript>${AUTHELIA_NOSCRIPT_TEXT}</noscript>`), 'the noscript text');
});

test('the index rewrites: lang always, the noscript text translated, every byte ASCII without $', () => {
  assert.deepEqual(autheliaIndexLanguageFilters('en'), [
    ['<html lang="', '<html lang="en" data-authelia-lang="'],
  ]);
  const tr = autheliaIndexLanguageFilters('tr');
  assert.deepEqual(tr, [
    ['<html lang="', '<html lang="tr" data-authelia-lang="'],
    [
      'You need to enable JavaScript to run this app.',
      'Bu uygulama i&#231;in taray&#305;c&#305;n&#305;zda JavaScript etkin olmal&#305;d&#305;r.',
    ],
  ]);
  const decoded = tr[1][1].replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  assert.equal(decoded, AUTHELIA_NOSCRIPT_TRANSLATIONS.tr);
});

test(`the supplement covers exactly what Authelia ${PINNED}’s tr-TR lacks; the corrections only what it has`, async () => {
  for (const namespace of AUTHELIA_FORCED_NAMESPACES) {
    const en = new Map(flatten(await upstreamLocale('en', namespace)));
    const tr = new Map(flatten(await upstreamLocale('tr-TR', namespace)));
    const missing = [...en.keys()].filter((key) => !tr.has(key)).sort();
    const supplement = new Map(flatten(AUTHELIA_SUPPLEMENT.tr[namespace] ?? {}));
    assert.deepEqual(
      [...supplement.keys()].sort(),
      missing,
      `${namespace}: none missing, none extra`,
    );
    for (const [key, value] of supplement) {
      // Authelia's interpolations and tags survive the translation.
      const marks = (text) =>
        [...text.matchAll(/\{\{[^}]+\}\}|<\/?[a-z0-9]+>/g)].map((m) => m[0]).sort();
      assert.deepEqual(marks(value), marks(en.get(key)), `${namespace} ${key}`);
    }
    for (const [key, value] of flatten(AUTHELIA_CORRECTIONS.tr[namespace] ?? {})) {
      assert.ok(tr.has(key), `${namespace} ${key}: a correction replaces Authelia’s own text`);
      assert.notEqual(value, tr.get(key));
      const marks = (text) => [...text.matchAll(/\{\{[^}]+\}\}/g)].map((m) => m[0]).sort();
      assert.deepEqual(marks(value), marks(en.get(key)));
    }
  }
  assert.equal(flatten(AUTHELIA_SUPPLEMENT.tr.portal).length, 16);
  assert.equal(flatten(AUTHELIA_SUPPLEMENT.tr.settings).length, 37);
  assert.equal(flatten(AUTHELIA_SUPPLEMENT.tr.consent).length, 31);
});

test('a forced file holds every English key in the domain’s language; English fills only what nothing covers', async () => {
  for (const namespace of AUTHELIA_FORCED_NAMESPACES) {
    const english = await upstreamLocale('en', namespace);
    const embedded = await upstreamLocale('tr-TR', namespace);
    const forced = renderForcedAutheliaLocale({ namespace, language: 'tr', english, embedded });
    assert.deepEqual(forced.fromEnglish, [], `${namespace}: nothing left in English`);
    const flat = new Map(flatten(forced.messages));
    assert.deepEqual(
      [...flat.keys()],
      flatten(english).map(([k]) => k),
      'English’s keys, in order',
    );
    const authelias = new Map(flatten(embedded));
    for (const [key, value] of flat) {
      const correction = new Map(flatten(AUTHELIA_CORRECTIONS.tr[namespace] ?? {})).get(key);
      const supplement = new Map(flatten(AUTHELIA_SUPPLEMENT.tr[namespace] ?? {})).get(key);
      assert.equal(value, correction ?? authelias.get(key) ?? supplement, key);
    }
    // English is Authelia's English, verbatim.
    const en = renderForcedAutheliaLocale({ namespace, language: 'en', english, embedded: null });
    assert.deepEqual(en.messages, english);
    assert.deepEqual(en.fromEnglish, []);
  }
  const portal = renderForcedAutheliaLocale({
    namespace: 'portal',
    language: 'tr',
    english: await upstreamLocale('en', 'portal'),
    embedded: await upstreamLocale('tr-TR', 'portal'),
  }).messages;
  assert.equal(portal.Loading, 'Yükleniyor', 'a supplemented key');
  assert.equal(portal['Powered by {{authelia}}'], 'Altyapı: {{authelia}}', 'a correction');
  assert.equal(portal['Sign in'], 'Giriş yap', 'Authelia’s own');
  assert.equal(
    portal['You must view and accept the Privacy Policy before using'],
    undefined,
    'a stale key Authelia’s English no longer has is dropped',
  );
  // A key a newer Authelia adds, and Authelia without a Turkish file: English, listed.
  const newer = renderForcedAutheliaLocale({
    namespace: 'portal',
    language: 'tr',
    english: { 'Sign in': 'Sign in', 'A new sentence': 'A new sentence', nested: { x: 'X' } },
    embedded: null,
  });
  assert.deepEqual(newer.messages, {
    'Sign in': 'Sign in',
    'A new sentence': 'A new sentence',
    nested: { x: 'X' },
  });
  assert.deepEqual(newer.fromEnglish, ['Sign in', 'A new sentence', 'nested.x']);
});

// --- the rendering ------------------------------------------------------------

async function pinnedLocales() {
  const files = [];
  for (const locale of ['en', 'tr-TR']) {
    for (const namespace of AUTHELIA_FORCED_NAMESPACES) {
      files.push({ locale, namespace, messages: await upstreamLocale(locale, namespace) });
    }
  }
  return {
    languages: [
      { locale: 'en', namespaces: [...AUTHELIA_FORCED_NAMESPACES] },
      { locale: 'tr-TR', namespaces: [...AUTHELIA_FORCED_NAMESPACES] },
    ],
    files,
    missing: [],
  };
}

const BRAND_FIELDS = {
  name: 'Alpha Works',
  tagline: null,
  theme: 'dark',
  accent: '#22d3ee',
  supportEmail: 'help@alpha.test',
  supportUrl: null,
};

test('a domain with a language and no brand: the forced locales, the menu hidden, the pages in its language, no brand.json', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lamaste-page-language-'));
  try {
    const locales = await pinnedLocales();
    const rendered = await renderAuthBranding({
      domain: 'alpha.test',
      brand: null,
      language: 'tr',
      revision: 0,
      logo: null,
      favicon: null,
      locales,
      autheliaVersion: '4.39.29',
      root,
      now: new Date('2026-11-03T10:00:00Z'),
    });
    const { fromEnglish, ...stored } = rendered;
    assert.deepEqual(fromEnglish, []);
    assert.deepEqual(stored, {
      v: 1,
      revision: 0,
      language: 'tr',
      autheliaVersion: '4.39.29',
      autheliaPinned: PINNED,
      pagesDigest: authPagesDigest(),
      brandSha256: null,
      renderedAt: '2026-11-03T10:00:00.000Z',
    });
    assert.deepEqual(await readRenderedBrand('alpha.test', root), stored);
    const link = path.join(root, 'alpha.test');
    assert.deepEqual((await readdir(link)).sort(), [
      'account',
      'brand.css',
      'invitations',
      'invite',
      'locales',
      'rendered.json',
      'reset',
      'unavailable',
    ]);
    assert.deepEqual(await readdir(path.join(link, 'locales')), ['forced']);
    assert.deepEqual((await readdir(path.join(link, 'locales/forced'))).sort(), [
      'consent.json',
      'portal.json',
      'settings.json',
    ]);
    for (const file of ['locales/forced/portal.json', AUTH_BRANDING_FILES.unavailable]) {
      assert.equal((await lstat(path.join(link, file))).mode & 0o777, 0o640, file);
    }
    const portal = JSON.parse(
      await readFile(path.join(link, 'locales/forced/portal.json'), 'utf-8'),
    );
    assert.equal(portal.Loading, 'Yükleniyor');
    assert.equal(portal['Powered by {{authelia}}'], 'Altyapı: {{authelia}}', 'no brand to splice');
    assert.equal(
      await readFile(path.join(link, AUTH_BRANDING_FILES.css), 'utf-8'),
      `/* Generated by Lamaste from the domain’s language. Not edited by hand. */\n${AUTHELIA_ACCOUNT_LINK_CSS}\n${BRAND_CSS_LANGUAGE_MENU_RULE}\n`,
    );
    assert.equal(
      await readFile(path.join(link, AUTH_BRANDING_FILES.invite), 'utf-8'),
      renderInvitePage(null, 'tr'),
    );
    assert.equal(
      await readFile(path.join(link, AUTH_BRANDING_FILES.invitations), 'utf-8'),
      renderInvitationsPage(null, 'tr'),
    );
    assert.equal(
      await readFile(path.join(link, AUTH_BRANDING_FILES.unavailable), 'utf-8'),
      renderUnavailablePage({ brand: null, language: 'tr', domain: 'alpha.test' }),
    );

    // Refused: neither a brand nor a language; a brandless rendering with a
    // revision or images; a language that is not one.
    const base = {
      domain: 'beta.test',
      logo: null,
      favicon: null,
      locales,
      autheliaVersion: PINNED,
      root,
    };
    await assert.rejects(renderAuthBranding({ ...base, brand: null, language: null, revision: 0 }));
    await assert.rejects(renderAuthBranding({ ...base, brand: null, language: 'tr', revision: 1 }));
    await assert.rejects(
      renderAuthBranding({
        ...base,
        brand: null,
        language: 'tr',
        revision: 0,
        logo: new Uint8Array(1),
      }),
    );
    await assert.rejects(
      renderAuthBranding({ ...base, brand: BRAND_FIELDS, language: 'de', revision: 1 }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a domain with a brand and a language: brand-spliced forced locales, branded pages in its language', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lamaste-page-language-'));
  try {
    const rendered = await renderAuthBranding({
      domain: 'alpha.test',
      brand: BRAND_FIELDS,
      language: 'tr',
      revision: 3,
      logo: null,
      favicon: null,
      locales: await pinnedLocales(),
      autheliaVersion: PINNED,
      root,
    });
    assert.equal(rendered.language, 'tr');
    const link = path.join(root, 'alpha.test');
    // The brand's own locale files too: a vhost not yet rewritten for the
    // language serves them, and the domain keeps its brand meanwhile.
    const localeDirs = await readdir(path.join(link, 'locales'));
    assert.ok(localeDirs.includes('forced'));
    assert.ok(localeDirs.includes('tr-TR') && localeDirs.includes('en'), 'per-locale files');
    const ownPortal = JSON.parse(
      await readFile(path.join(link, 'locales/en/portal.json'), 'utf-8'),
    );
    assert.equal(ownPortal['Powered by {{authelia}}'], 'Powered by Alpha Works');
    const portal = JSON.parse(
      await readFile(path.join(link, 'locales/forced/portal.json'), 'utf-8'),
    );
    assert.equal(portal['Powered by {{authelia}}'], 'Altyapı: Alpha Works');
    assert.equal(portal['Login - {{authelia}}'], 'Giriş - Alpha Works');
    const css = await readFile(path.join(link, AUTH_BRANDING_FILES.css), 'utf-8');
    assert.ok(css.includes('--primary: #22d3ee !important'), 'the brand’s rules');
    assert.ok(css.endsWith(`${BRAND_CSS_LANGUAGE_MENU_RULE}\n`), 'and the menu hidden');
    const page = {
      name: 'Alpha Works',
      tagline: null,
      theme: 'dark',
      accent: '#22d3ee',
      logo: false,
    };
    assert.equal(
      await readFile(path.join(link, AUTH_BRANDING_FILES.invite), 'utf-8'),
      renderInvitePage(page, 'tr'),
    );
    assert.ok(
      (await readFile(path.join(link, AUTH_BRANDING_FILES.unavailable), 'utf-8')).includes(
        '<div class="brand-name">Alpha Works</div>',
      ),
    );
    const brandJson = JSON.parse(
      await readFile(path.join(link, AUTH_BRANDING_FILES.brand), 'utf-8'),
    );
    assert.equal(brandJson.name, 'Alpha Works');
    assert.equal('language' in brandJson, false, 'brand.json stays the brand’s alone');
    // rendered.json names the brand it holds by brand.json's digest — what
    // the record's holder computes with renderedBrandSha256.
    const brandText = await readFile(path.join(link, AUTH_BRANDING_FILES.brand));
    assert.equal(rendered.brandSha256, sha256Hex(brandText));
    assert.equal(
      rendered.brandSha256,
      renderedBrandSha256('alpha.test', BRAND_FIELDS, 3, { logoSha256: null, faviconSha256: null }),
    );
    assert.equal((await readRenderedBrand('alpha.test', root)).brandSha256, rendered.brandSha256);
    assert.notEqual(
      rendered.brandSha256,
      renderedBrandSha256('alpha.test', { ...BRAND_FIELDS, name: 'Beta Works' }, 3, {
        logoSha256: null,
        faviconSha256: null,
      }),
      'another brand at the same revision',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the domain stylesheet: the brand’s, the menu rule with a language, one of the two required', () => {
  assert.equal(
    renderDomainCss({ accent: null }, null).includes(AUTHELIA_LANGUAGE_MENU_SELECTOR),
    false,
  );
  assert.ok(renderDomainCss({ accent: null }, 'en').endsWith(`${BRAND_CSS_LANGUAGE_MENU_RULE}\n`));
  assert.equal(BRAND_CSS_LANGUAGE_MENU_RULE, '#language-button { display: none !important; }');
  assert.throws(() => renderDomainCss(null, null));
});

// --- the projection -----------------------------------------------------------

test('the projection’s language is read leniently: absent or unknown is "not set", never a refusal', () => {
  const parsed = parseDomainsProjection({
    v: 2,
    domains: [
      { name: 'alpha.test', members: ['ana'], externals: [], language: 'tr' },
      { name: 'beta.test', members: [], externals: ['ext'], language: 'klingon' },
      { name: 'gamma.test', members: [], externals: [] },
      { name: 'delta.test', members: [], externals: [], language: { v: 'tr' } },
    ],
  });
  assert.deepEqual(
    parsed.domains.map((d) => [d.name, d.language]),
    [
      ['alpha.test', 'tr'],
      ['beta.test', null],
      ['gamma.test', null],
      ['delta.test', null],
    ],
  );
  const index = indexDomainsProjection(parsed);
  assert.deepEqual([...index.languages], [['alpha.test', 'tr']]);
  assert.equal(domainLanguageOfHost(index, 'shop.alpha.test'), 'tr');
  assert.equal(domainLanguageOfHost(index, 'auth.beta.test'), null);
  assert.equal(domainLanguageOfHost(index, 'elsewhere.example'), null);
  // Membership stays as strict as before: a bad member still refuses the file.
  assert.equal(
    parseDomainsProjection({
      v: 2,
      domains: [{ name: 'alpha.test', members: ['Not Valid'], externals: [], language: 'tr' }],
    }),
    null,
  );
});
