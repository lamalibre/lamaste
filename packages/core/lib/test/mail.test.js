/**
 * Mail (packages/core/docs/mail-design.md), the core contract: the reserved
 * port and prefix, addresses and senders, transports and which one a mail
 * takes, the CA bundle of an `smtp` transport, Authelia's notifier and
 * reset link (template lines round-tripped, Authelia's own reset never
 * registered), the auth index's filters against Authelia 4.39.28's index,
 * a sending subdomain holding its hostname, the account pages (one script
 * and style for every brand and language), the mails and the consent page.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import {
  ACCOUNT_PASSWORD_PAGE_KEYS,
  AUTHELIA_ACCOUNT_LINK_CSS,
  AUTHELIA_ACCOUNT_LINK_ID,
  AUTHELIA_RELEASE,
  AUTH_STOCK_CSS,
  GmailApiTransportSettingsSchema,
  MAIL_SUBMISSION_PORT,
  MailGoogleStartInputSchema,
  MailSenderInputSchema,
  MailTestInputSchema,
  PAGE_LANGUAGES,
  PAGE_MESSAGES,
  PAGE_MESSAGE_KEYS,
  PasswordChangeSchema,
  PasswordResetFinishSchema,
  PasswordResetStartSchema,
  RESERVED_API_PREFIXES,
  RESERVED_TUNNEL_PORTS,
  RESET_PAGE_KEYS,
  SmtpTransportInputSchema,
  SmtpTransportSettingsSchema,
  authResetUrl,
  autheliaIndexMailFilters,
  canSendMail,
  formatMailbox,
  isDeliverableAddress,
  isMailSenderName,
  isTunnelPortAllowed,
  mailGoogleRedirectUri,
  mailSenderDomains,
  parseMailAddress,
  renderDomainCss,
  resolveMailTransport,
  splitPemCertificates,
} from '../dist/index.js';
import * as mailEntry from '../dist/mail.js';
import {
  ACCOUNT_PASSWORD_PAGE_HEADERS,
  ACCOUNT_PASSWORD_PAGE_SCRIPT,
  AUTHELIA_CERTS_DIR,
  AUTHELIA_MAIL_PASSWORD_FILE,
  AUTH_PAGE_STYLE,
  MAIL_PASSWORD_TEMPLATE_SENTINEL,
  MAIL_SUBMISSION_SERVER_NAME,
  MailCaPemError,
  OIDC_KEY_TEMPLATE_SENTINEL,
  RESET_PAGE_HEADERS,
  RESET_PAGE_SCRIPT,
  applyAutheliaMail,
  authPageStaticHeaders,
  autheliaMailMatches,
  ensureUsersFileWatched,
  hostnameHolder,
  parseMailCaPem,
  relayResetUrls,
  renderAccountPasswordPage,
  renderAutheliaConfigTemplate,
  renderAutheliaNotifier,
  renderInvitationMail,
  renderMailConsentPage,
  renderPasswordChangedMail,
  renderPasswordResetMail,
  renderResetPage,
  renderTestMail,
  sentinelizeAutheliaConfig,
  updateAutheliaMail,
  usersFileWatched,
} from '../dist/server/index.js';

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const CA_PEM = await readFile(fixture('mail/ca.pem'), 'utf-8');
const LEAF_PEM = await readFile(fixture('mail/leaf.pem'), 'utf-8');

const sha256Source = (text) =>
  `'sha256-${createHash('sha256').update(text, 'utf-8').digest('base64')}'`;

const BRANDS = [
  null,
  { name: 'Alpha Works', tagline: 'Tools, "made"', theme: 'light', accent: '#1d4ed8', logo: true },
  { name: 'Beta & Co', tagline: null, theme: 'oled', accent: null, logo: false },
];

/** The text of every inline `<tag>` element (no attributes) of `html`. */
function inline(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
}

// --- reserved -----------------------------------------------------------------

test('9295 is the submission listener’s and no tunnel’s; `account` is a reserved API prefix', () => {
  assert.equal(MAIL_SUBMISSION_PORT, 9295);
  assert.ok(RESERVED_TUNNEL_PORTS.includes(9295));
  assert.equal(isTunnelPortAllowed(9295), false);
  assert.equal(isTunnelPortAllowed(9296), true);
  assert.ok(RESERVED_API_PREFIXES.includes('account'));
});

// --- addresses and senders ------------------------------------------------------

test('addresses: dot-atom local parts, hostnames of two labels, the domain lower-cased', () => {
  assert.deepEqual(parseMailAddress('No-Reply@Notify.CodeLama.com.tr'), {
    local: 'No-Reply',
    domain: 'notify.codelama.com.tr',
  });
  for (const bad of [
    'a@localhost',
    '"quoted"@example.com',
    'a..b@example.com',
    '.a@example.com',
    'a@-x.com',
    'a b@example.com',
    'a@b@example.com',
    'a$b@example.com',
    '@example.com',
    `${'a'.repeat(65)}@example.com`,
    42,
    null,
  ]) {
    assert.equal(parseMailAddress(bad), null, String(bad));
  }
  assert.equal(MailTestInputSchema.parse({ to: ' A@Example.ORG ' }).to, 'A@example.org');
  assert.throws(() => MailTestInputSchema.parse({ to: 'a@example.org', extra: 1 }));
});

test('deliverable addresses: none under .local, .invalid, .test, .example or .localhost', () => {
  assert.equal(isDeliverableAddress('ada@codelama.com.tr'), true);
  for (const placeholder of [
    'admin@lamaste.local',
    'x@foo.invalid',
    'x@foo.test',
    'x@foo.example',
    'x@foo.localhost',
    'not an address',
  ]) {
    assert.equal(isDeliverableAddress(placeholder), false, placeholder);
  }
});

test('a sender: a name without quotes, angle brackets or template braces, written as a quoted mailbox', () => {
  assert.equal(
    formatMailbox({ address: 'no-reply@notify.codelama.com.tr', name: 'Code Lama' }),
    '"Code Lama" <no-reply@notify.codelama.com.tr>',
  );
  assert.equal(formatMailbox({ address: 'a@b.co', name: null }), 'a@b.co');
  assert.equal(isMailSenderName('Kod Lama Yazılım'), true);
  for (const bad of [
    '',
    ' x',
    'a"b',
    'a\\b',
    'a<b',
    'x>y',
    'a{{b',
    'a}}b',
    'a\nb',
    'a‮b',
    'x'.repeat(65),
  ]) {
    assert.equal(isMailSenderName(bad), false, JSON.stringify(bad));
  }
  assert.throws(() => formatMailbox({ address: 'nope', name: null }));
  assert.throws(() => formatMailbox({ address: 'a@b.co', name: 'a"b' }));
  assert.deepEqual(MailSenderInputSchema.parse({ senderAddress: 'X@Y.co', senderName: null }), {
    senderAddress: 'X@y.co',
    senderName: null,
  });
});

// --- transports -----------------------------------------------------------------

test('an smtp transport: a hostname or IPv4, a port, implicit TLS or STARTTLS, its own CA bundle', () => {
  const ok = SmtpTransportSettingsSchema.parse({
    host: 'SMTP-Relay.Gmail.com',
    port: 587,
    security: 'starttls',
    username: 'relay@codelama.com.tr',
  });
  assert.equal(ok.host, 'smtp-relay.gmail.com');
  assert.equal(
    SmtpTransportSettingsSchema.parse({
      host: '127.0.0.1',
      port: 465,
      security: 'tls',
      caPem: CA_PEM,
    }).caPem,
    CA_PEM,
  );
  for (const bad of [
    { host: 'localhost', port: 25, security: 'tls' },
    { host: 'a.b', port: 0, security: 'tls' },
    { host: 'a.b', port: 25, security: 'none' },
    { host: 'a.b', port: 25, security: 'tls', username: 'a b' },
    { host: 'a.b', port: 25, security: 'tls', caPem: 'not pem' },
    { host: 'a.b', port: 25, security: 'tls', skipVerify: true },
  ]) {
    assert.equal(SmtpTransportSettingsSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
  const input = SmtpTransportInputSchema.parse({
    host: 'mail.example.org',
    port: 465,
    security: 'tls',
    username: 'u',
    password: 'p',
    senderAddress: 'no-reply@example.org',
  });
  assert.equal(input.password, 'p');
  assert.equal(
    SmtpTransportInputSchema.safeParse({ ...input, password: 'a\u0000b' }).success,
    false,
  );
});

test('a gmail-api transport: Google’s client id shape; the consent’s start body', () => {
  const clientId = '123456789012-abcdefghij0123456789klmnopqrstuv.apps.googleusercontent.com';
  assert.equal(
    GmailApiTransportSettingsSchema.parse({ clientId, account: 'relay@codelama.com.tr' }).clientId,
    clientId,
  );
  assert.equal(
    GmailApiTransportSettingsSchema.safeParse({
      clientId: 'x.apps.googleusercontent.com',
      account: 'a@b.co',
    }).success,
    false,
  );
  const start = MailGoogleStartInputSchema.parse({
    clientId,
    clientSecret: 'GOCSPX-abcdefghijklmnop',
    senderAddress: 'no-reply@notify.codelama.com.tr',
    senderName: 'Code Lama',
  });
  assert.equal(start.senderName, 'Code Lama');
  assert.equal(
    MailGoogleStartInputSchema.safeParse({ ...start, clientSecret: 'has space x' }).success,
    false,
  );
});

test('the CA bundle: PEM certificate blocks only, each a CA certificate, normalised', () => {
  assert.deepEqual(
    parseMailCaPem(CA_PEM),
    [CA_PEM.replace(/\r\n/g, '\n')].map((p) => p.trim() + '\n'),
  );
  assert.equal(parseMailCaPem(`${CA_PEM}\n\n${CA_PEM.replace(/\n/g, '\r\n')}`).length, 2);
  assert.throws(
    () => parseMailCaPem(LEAF_PEM),
    (err) => err instanceof MailCaPemError && err.code === 'not_ca',
  );
  assert.throws(
    () => parseMailCaPem('junk'),
    (err) => err.code === 'not_pem',
  );
  assert.throws(
    () =>
      parseMailCaPem(`${CA_PEM}\n-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n`),
    (err) => err.code === 'not_pem',
  );
  const broken = CA_PEM.replace(/^([A-Za-z0-9+/]{8})/m, 'AAAAAAAA');
  assert.throws(
    () => parseMailCaPem(broken),
    (err) => err.code === 'not_certificate',
  );
  assert.equal(splitPemCertificates('x'.repeat(16 * 1024 + 1)), null);
  assert.equal(splitPemCertificates(Array(11).fill(CA_PEM).join('')), null);
});

const RELAY = {
  domain: null,
  transport: {
    kind: 'gmail-api',
    settings: { clientId: 'c', account: 'relay@codelama.com.tr' },
  },
  sender: { address: 'no-reply@notify.codelama.com.tr', name: 'Code Lama' },
};

test('which transport a mail takes: the domain’s own, the relay’s with the domain’s sender, the relay’s', () => {
  const senderOnly = {
    domain: 'b.test',
    transport: null,
    sender: { address: 'hi@b.test', name: null },
  };
  const own = {
    domain: 'c.test',
    transport: { kind: 'smtp', settings: { host: 'smtp.c.test', port: 465, security: 'tls' } },
    sender: { address: 'x@c.test', name: 'C' },
  };
  const records = [RELAY, senderOnly, own];
  assert.deepEqual(resolveMailTransport(null, records), {
    transportOf: null,
    transport: RELAY.transport,
    sender: RELAY.sender,
  });
  assert.deepEqual(resolveMailTransport('a.test', records).sender, RELAY.sender);
  assert.deepEqual(resolveMailTransport('B.test', records), {
    transportOf: null,
    transport: RELAY.transport,
    sender: senderOnly.sender,
  });
  assert.deepEqual(resolveMailTransport('c.test', records), {
    transportOf: 'c.test',
    transport: own.transport,
    sender: own.sender,
  });
  // No relay transport: only a domain with its own sends.
  assert.equal(resolveMailTransport(null, [senderOnly, own]), null);
  assert.equal(canSendMail('b.test', [senderOnly, own]), false);
  assert.equal(canSendMail('c.test', [senderOnly, own]), true);
  assert.equal(canSendMail(null, []), false);
  assert.deepEqual(mailSenderDomains(records), ['b.test', 'c.test', 'notify.codelama.com.tr']);
});

test('the ./mail subpath carries the browser-safe contract', () => {
  for (const name of [
    'resolveMailTransport',
    'isDeliverableAddress',
    'SmtpTransportInputSchema',
    'splitPemCertificates',
  ]) {
    assert.notEqual(mailEntry[name], undefined, name);
  }
});

// --- account --------------------------------------------------------------------

test('the account contract: reset URLs per auth host, the consent’s redirect, the bodies', () => {
  assert.equal(authResetUrl('codelama.com.tr'), 'https://auth.codelama.com.tr/reset');
  assert.equal(
    mailGoogleRedirectUri('codelama.com.tr'),
    'https://auth.codelama.com.tr/mail/google/callback',
  );
  assert.throws(() => authResetUrl('../x'));
  assert.equal(PasswordResetStartSchema.parse({ identifier: '  ada ' }).identifier, 'ada');
  assert.equal(PasswordResetStartSchema.safeParse({ identifier: 'a\u0007' }).success, false);
  const token = 'a'.repeat(64);
  assert.equal(
    PasswordResetFinishSchema.safeParse({ token, password: 'x'.repeat(8), totp: '123456' }).success,
    true,
  );
  for (const bad of [
    { token, password: 'short', totp: '123456' },
    { token, password: 'x'.repeat(129), totp: '123456' },
    { token, password: 'x'.repeat(8), totp: '12345' },
    { token: 'A'.repeat(64), password: 'x'.repeat(8), totp: '123456' },
  ]) {
    assert.equal(PasswordResetFinishSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
  assert.equal(
    PasswordChangeSchema.safeParse({ currentPassword: 'a', newPassword: 'x'.repeat(8) }).success,
    true,
  );
});

// --- Authelia ---------------------------------------------------------------------

function baseConfig(domains = ['codelama.com.tr', 'b.test']) {
  return {
    authentication_backend: {
      file: { path: '/etc/authelia/users.yml', watch: true },
      refresh_interval: 'always',
      password_change: { disable: true },
      password_reset: { disable: true },
    },
    session: {
      secret: 's',
      cookies: domains.map((domain) => ({
        domain,
        authelia_url: `https://auth.${domain}`,
        default_redirection_url: `https://${domain}`,
      })),
    },
    notifier: renderAutheliaNotifier(null),
    access_control: { default_policy: 'deny', rules: [] },
  };
}

const SENDER = { address: 'no-reply@notify.codelama.com.tr', name: 'Code Lama' };
const PRIMARY_RESET = 'https://auth.codelama.com.tr/reset';

test('the notifier: SMTP to the loopback listener with a templated password, else the file', () => {
  assert.deepEqual(renderAutheliaNotifier(null), {
    filesystem: { filename: '/etc/authelia/notifications.txt' },
  });
  assert.deepEqual(renderAutheliaNotifier(SENDER), {
    disable_startup_check: true,
    smtp: {
      address: 'submissions://127.0.0.1:9295',
      tls: { server_name: MAIL_SUBMISSION_SERVER_NAME },
      username: 'authelia',
      password: MAIL_PASSWORD_TEMPLATE_SENTINEL,
      sender: '"Code Lama" <no-reply@notify.codelama.com.tr>',
      subject: '{title}',
    },
  });
});

test('Authelia links to this relay’s reset page only; its own reset and change stay unregistered', () => {
  const config = baseConfig();
  assert.deepEqual(relayResetUrls(config), [PRIMARY_RESET, 'https://auth.b.test/reset']);
  applyAutheliaMail(config, { sender: SENDER, resetUrl: PRIMARY_RESET });
  assert.deepEqual(config.authentication_backend.password_reset, { custom_url: PRIMARY_RESET });
  assert.equal(config.certificates_directory, AUTHELIA_CERTS_DIR);
  assert.equal(usersFileWatched(config), true);
  assert.equal(autheliaMailMatches(config, { sender: SENDER, resetUrl: PRIMARY_RESET }), true);
  assert.equal(autheliaMailMatches(config, { sender: null, resetUrl: null }), false);

  // Every rewrite keeps a link of this relay …
  ensureUsersFileWatched(config);
  assert.deepEqual(config.authentication_backend.password_reset, { custom_url: PRIMARY_RESET });

  // … and turns anything else back into "disabled".
  for (const reset of [
    { custom_url: 'https://evil.example/reset' },
    { custom_url: 'https://auth.codelama.com.tr/reset-password' },
    { disable: false },
    { custom_url: '' },
    {},
  ]) {
    const other = baseConfig();
    other.authentication_backend.password_reset = reset;
    assert.equal(usersFileWatched(other), false, JSON.stringify(reset));
    ensureUsersFileWatched(other);
    assert.deepEqual(other.authentication_backend.password_reset, { disable: true });
    assert.equal(usersFileWatched(other), true);
  }
  const change = baseConfig();
  change.authentication_backend.password_change = { disable: false };
  assert.equal(usersFileWatched(change), false);

  assert.throws(
    () =>
      applyAutheliaMail(baseConfig(), {
        sender: SENDER,
        resetUrl: 'https://auth.other.test/reset',
      }),
    /no reset page of this relay/,
  );
  const off = baseConfig();
  applyAutheliaMail(off, { sender: SENDER, resetUrl: PRIMARY_RESET });
  applyAutheliaMail(off, { sender: null, resetUrl: null });
  assert.deepEqual(off.notifier, renderAutheliaNotifier(null));
  assert.equal('certificates_directory' in off, false);
  assert.deepEqual(off.authentication_backend.password_reset, { disable: true });
});

test('both template lines round-trip; nothing else may hold a template', () => {
  const config = baseConfig();
  applyAutheliaMail(config, { sender: SENDER, resetUrl: PRIMARY_RESET });
  config.identity_providers = {
    oidc: { jwks: [{ key_id: 'k', key: OIDC_KEY_TEMPLATE_SENTINEL }] },
  };
  const text = renderAutheliaConfigTemplate(yaml.dump(config, { lineWidth: -1 }));
  assert.ok(
    text.includes(`    password: {{ secret "${AUTHELIA_MAIL_PASSWORD_FILE}" | msquote }}\n`),
    text,
  );
  assert.match(
    text,
    /^ {8}key: \{\{ secret "\/etc\/authelia\/oidc-issuer\.pem" \| mindent 10 "\|" \| msquote \}\}$/m,
  );
  assert.equal(text.includes(MAIL_PASSWORD_TEMPLATE_SENTINEL), false);
  const back = yaml.load(sentinelizeAutheliaConfig(text));
  assert.deepEqual(back, config);
  // The users file's password section is a mapping, never a sentinel.
  assert.equal(typeof back.authentication_backend.file.password, 'undefined');
  assert.throws(() =>
    renderAutheliaConfigTemplate(
      yaml.dump({ notifier: { smtp: { sender: '"{{ x }}" <a@b.co>' } } }),
    ),
  );
});

test('updateAutheliaMail rewrites and restarts only on a change, and never loses a secret', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-mail-'));
  try {
    const configPath = path.join(dir, 'configuration.yml');
    const secretsPath = path.join(dir, '.secrets.json');
    await writeFile(configPath, yaml.dump(baseConfig()));
    await writeFile(secretsPath, JSON.stringify({ sessionSecret: 'kept' }));
    let restarts = 0;
    const exec = async () => {
      throw new Error('exec is not used when restart is given');
    };
    const options = { configPath, secretsPath, restart: async () => (restarts += 1) };
    const on = { sender: SENDER, resetUrl: PRIMARY_RESET };
    assert.deepEqual(await updateAutheliaMail(on, exec, options), { changed: true });
    const text = await readFile(configPath, 'utf-8');
    assert.ok(text.includes(`password: {{ secret "${AUTHELIA_MAIL_PASSWORD_FILE}" | msquote }}`));
    const parsed = yaml.load(sentinelizeAutheliaConfig(text));
    assert.equal(parsed.session.secret, 'kept');
    assert.equal(parsed.notifier.smtp.address, 'submissions://127.0.0.1:9295');
    assert.deepEqual(await updateAutheliaMail(on, exec, options), { changed: false });
    assert.equal(restarts, 1);
    assert.deepEqual(await updateAutheliaMail({ sender: null, resetUrl: null }, exec, options), {
      changed: true,
    });
    assert.equal(restarts, 2);
    const off = yaml.load(sentinelizeAutheliaConfig(await readFile(configPath, 'utf-8')));
    assert.deepEqual(off.notifier, renderAutheliaNotifier(null));
    assert.deepEqual(off.authentication_backend.password_reset, { disable: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- the portal's index -------------------------------------------------------------

/** Authelia's index as it serves it: the fixture's placeholders filled. */
async function servedIndex(resetUrl) {
  const source = await readFile(
    fixture(`authelia-${AUTHELIA_RELEASE.version}/web/index.html`),
    'utf-8',
  );
  return source
    .replace('%VITE_RESET_PASSWORD_CUSTOM_URL%', resetUrl ?? '')
    .replace('%VITE_RESET_PASSWORD%', resetUrl === null ? 'false' : 'true');
}

/** nginx's sub_filter: every literal occurrence, ignoring case. */
function subFilter(html, filters) {
  let out = html;
  for (const [from, to] of filters) {
    out = out.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), to);
  }
  return out;
}

test(`Authelia ${AUTHELIA_RELEASE.version}’s index carries the reset switch and link the filters rewrite`, async () => {
  const source = await readFile(
    fixture(`authelia-${AUTHELIA_RELEASE.version}/web/index.html`),
    'utf-8',
  );
  assert.ok(source.includes('data-resetpassword="%VITE_RESET_PASSWORD%"'));
  assert.ok(source.includes('data-resetpasswordcustomurl="%VITE_RESET_PASSWORD_CUSTOM_URL%"'));
  assert.equal(source.match(/<\/body>/g).length, 1);
});

test('the index filters: each portal its own reset page, none where nothing sends, a change link everywhere', async () => {
  const primary = await servedIndex(PRIMARY_RESET);
  const link = (label) =>
    `<a id="${AUTHELIA_ACCOUNT_LINK_ID}" href="/account/password">${label}</a></body>`;

  // The primary: its own URL already; only the link.
  const own = subFilter(
    primary,
    autheliaIndexMailFilters({
      primaryResetUrl: PRIMARY_RESET,
      domainResetUrl: PRIMARY_RESET,
      language: null,
    }),
  );
  assert.ok(own.includes(`data-resetpasswordcustomurl="${PRIMARY_RESET}"`));
  assert.ok(own.includes(link('Change password')));

  // Another domain that sends: its own page.
  const other = subFilter(
    primary,
    autheliaIndexMailFilters({
      primaryResetUrl: PRIMARY_RESET,
      domainResetUrl: 'https://auth.b.test/reset',
      language: 'tr',
    }),
  );
  assert.ok(other.includes('data-resetpasswordcustomurl="https://auth.b.test/reset"'));
  assert.ok(other.includes('data-resetpassword="true"'));
  assert.ok(other.includes(link('&#350;ifre de&#287;i&#351;tir')));

  // A domain that cannot send: no link to any reset, Authelia's own never offered.
  const none = subFilter(
    primary,
    autheliaIndexMailFilters({
      primaryResetUrl: PRIMARY_RESET,
      domainResetUrl: null,
      language: 'en',
    }),
  );
  assert.ok(none.includes('data-resetpassword="false"'));
  assert.ok(none.includes('data-resetpasswordcustomurl=""'));
  assert.ok(!none.includes(PRIMARY_RESET));

  // Nothing sends at all: Authelia's reset is off already; only the link.
  assert.deepEqual(
    autheliaIndexMailFilters({ primaryResetUrl: null, domainResetUrl: null, language: null }),
    [['</body>', link('Change password')]],
  );

  for (const language of [null, ...PAGE_LANGUAGES]) {
    for (const filters of [
      autheliaIndexMailFilters({ primaryResetUrl: PRIMARY_RESET, domainResetUrl: null, language }),
      autheliaIndexMailFilters({
        primaryResetUrl: PRIMARY_RESET,
        domainResetUrl: 'https://auth.b.test/reset',
        language,
      }),
    ]) {
      for (const text of filters.flat()) {
        assert.match(text, /^[\x20-\x7e]{1,512}$/);
        assert.doesNotMatch(text, /[$\\']/);
      }
    }
  }
});

test('the change link is styled from every domain’s stylesheet, the stock one included', () => {
  assert.ok(AUTHELIA_ACCOUNT_LINK_CSS.startsWith(`#${AUTHELIA_ACCOUNT_LINK_ID} {`));
  assert.ok(renderDomainCss({ accent: '#1d4ed8' }, null).includes(AUTHELIA_ACCOUNT_LINK_CSS));
  assert.ok(renderDomainCss(null, 'tr').includes(AUTHELIA_ACCOUNT_LINK_CSS));
  assert.ok(AUTH_STOCK_CSS.includes(AUTHELIA_ACCOUNT_LINK_CSS));
});

// --- a sending subdomain --------------------------------------------------------------

test('a mail sender’s domain holds its hostname: no tunnel, site or alias there', () => {
  const mail = ['notify.codelama.com.tr'];
  assert.deepEqual(hostnameHolder('Notify.CodeLama.com.tr', { mailSenderDomains: mail }), {
    kind: 'mail-sender',
    name: 'notify.codelama.com.tr',
  });
  assert.equal(hostnameHolder('app.codelama.com.tr', { mailSenderDomains: mail }), null);
  assert.equal(hostnameHolder('notify.codelama.com.tr', {}), null);
});

// --- the account pages -----------------------------------------------------------------

test('the account pages, in every language and for every brand: one script and one style, named by hash', () => {
  for (const [render, script, headers] of [
    [renderResetPage, RESET_PAGE_SCRIPT, RESET_PAGE_HEADERS],
    [renderAccountPasswordPage, ACCOUNT_PASSWORD_PAGE_SCRIPT, ACCOUNT_PASSWORD_PAGE_HEADERS],
  ]) {
    const csp = headers['Content-Security-Policy'];
    assert.ok(csp.includes(`script-src ${sha256Source(script)}`));
    assert.ok(csp.includes(`style-src 'self' ${sha256Source(AUTH_PAGE_STYLE)}`));
    for (const language of PAGE_LANGUAGES) {
      for (const brand of BRANDS) {
        const html = render(brand, language);
        assert.deepEqual(inline(html, 'script'), [script]);
        assert.deepEqual(inline(html, 'style'), [AUTH_PAGE_STYLE]);
        assert.ok(html.includes(`<html lang="${language}">`));
      }
    }
  }
  assert.throws(() => renderResetPage({ ...BRANDS[1], theme: 'neon' }));
});

test('each account page carries its own keys; its script never shows the server’s text', () => {
  for (const keys of [RESET_PAGE_KEYS, ACCOUNT_PASSWORD_PAGE_KEYS]) {
    assert.equal(new Set(keys).size, keys.length);
    for (const key of keys) assert.ok(PAGE_MESSAGE_KEYS.includes(key), key);
  }
  assert.ok(RESET_PAGE_KEYS.includes('error.totp_invalid'));
  assert.ok(RESET_PAGE_KEYS.includes('reset.sent_one'));
  assert.ok(!RESET_PAGE_KEYS.includes('password.current'));
  assert.ok(ACCOUNT_PASSWORD_PAGE_KEYS.includes('error.current_password_invalid'));
  for (const script of [RESET_PAGE_SCRIPT, ACCOUNT_PASSWORD_PAGE_SCRIPT]) {
    // A refusal's own text (`error`, `message`) is never read.
    assert.doesNotMatch(script, /(data|body)\.(error|message)\b/);
  }
  // The reset token: from the fragment only, out of the address bar at once.
  assert.ok(RESET_PAGE_SCRIPT.includes('window.location.hash.slice(1)'));
  assert.ok(RESET_PAGE_SCRIPT.includes("window.history.replaceState(null, '', '/reset')"));
  assert.doesNotMatch(RESET_PAGE_SCRIPT, /location\.(search|pathname)/);
});

// --- the mails ----------------------------------------------------------------------------

test('the mails: text and HTML in the domain’s language, values escaped, links https only', () => {
  const brand = { name: 'Beta <&> {brand}', accent: '#1d4ed8' };
  const invite = renderInvitationMail({
    language: 'en',
    brand,
    link: `https://auth.b.test/invite#${'a'.repeat(64)}`,
    expiresAt: new Date('2026-11-17T10:00:00Z'),
  });
  assert.equal(invite.subject, 'Your invitation to Beta <&> {brand}');
  assert.ok(invite.text.includes(`https://auth.b.test/invite#${'a'.repeat(64)}`));
  assert.ok(invite.text.includes('17 November 2026'));
  assert.ok(invite.html.includes('Beta &lt;&amp;&gt; {brand}'));
  assert.doesNotMatch(invite.html, /Beta <&>/);
  assert.ok(invite.html.includes('background:#1d4ed8'));

  const delegated = renderInvitationMail({
    language: 'tr',
    brand: null,
    link: 'https://auth.b.test/invite#x',
    expiresAt: new Date('2026-11-17T10:00:00Z'),
    delegated: { inviter: 'Ada {plugin}', plugin: 'Corral', role: 'Viewer' },
  });
  assert.equal(delegated.subject, 'Davetiniz: Corral');
  assert.ok(
    delegated.text.includes('Ada {plugin} sizi Corral uygulamasına Viewer olarak davet etti.'),
  );
  assert.ok(delegated.html.includes('<html lang="tr">'));

  for (const link of [
    'javascript:alert(1)',
    'http://auth.b.test/x',
    'https://a b',
    'https://x/"y',
  ]) {
    assert.throws(
      () => renderInvitationMail({ language: 'en', brand: null, link, expiresAt: new Date() }),
      link,
    );
  }
  assert.throws(() =>
    renderInvitationMail({
      language: 'en',
      brand: { name: 'x', accent: 'red' },
      link: 'https://a.b/c',
      expiresAt: new Date(),
    }),
  );

  const reset = renderPasswordResetMail({
    language: 'en',
    brand: null,
    accounts: [
      { username: 'ada', link: 'https://auth.b.test/reset#1' },
      { username: 'ada2', link: 'https://auth.b.test/reset#2' },
    ],
  });
  assert.equal(reset.subject, 'Reset your password');
  assert.ok(reset.text.includes('Each account has its own link.'));
  assert.ok(reset.text.includes('Account: ada2'));
  assert.ok(reset.text.includes('for 30 minutes'));
  assert.throws(() => renderPasswordResetMail({ language: 'en', brand: null, accounts: [] }));

  const changed = renderPasswordChangedMail({
    language: 'tr',
    brand: null,
    username: 'ada',
    changedAt: new Date('2026-11-10T08:05:00Z'),
  });
  assert.ok(changed.text.includes('Hesap: ada (Lamaste), tarih: 10 Kasım 2026'));
  const sample = renderTestMail({ language: 'en', brand: null, sender: SENDER });
  assert.ok(sample.text.includes('"Code Lama" <no-reply@notify.codelama.com.tr>'));
  assert.ok(sample.html.includes('&quot;Code Lama&quot; &lt;no-reply@notify.codelama.com.tr&gt;'));
});

test('the consent page: no script, the sender or the reason in the domain’s language, its CSP', () => {
  for (const language of PAGE_LANGUAGES) {
    for (const brand of BRANDS) {
      const ok = renderMailConsentPage({
        brand,
        language,
        domain: 'codelama.com.tr',
        result: { ok: true, sender: SENDER },
      });
      assert.doesNotMatch(ok, /<script/);
      assert.deepEqual(inline(ok, 'style'), [AUTH_PAGE_STYLE]);
      assert.ok(ok.includes('&quot;Code Lama&quot; &lt;no-reply@notify.codelama.com.tr&gt;'));
      for (const reason of ['expired', 'denied', 'sender', 'token', 'generic']) {
        const failed = renderMailConsentPage({
          brand,
          language,
          domain: 'codelama.com.tr',
          result: { ok: false, reason },
        });
        assert.ok(failed.includes(PAGE_MESSAGES[language][`mailConsent.reason.${reason}`]));
      }
    }
  }
  const csp = authPageStaticHeaders()['Content-Security-Policy'];
  assert.ok(csp.includes(`style-src 'self' ${sha256Source(AUTH_PAGE_STYLE)}`));
  assert.doesNotMatch(csp, /script-src/);
  assert.match(csp, /default-src 'none'/);
});
