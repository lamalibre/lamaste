/**
 * Mail in the panel's words: which client methods a scope uses, a
 * transport and its budget as lines, the forms' bodies (secrets only as
 * typed, a CA bundle only when chosen), and invitations' mail states.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAIL_DAILY_LIMIT, mailBudgetThresholds } from '@lamalibre/lamaste/mail';
import {
  budgetLevel,
  budgetLines,
  googleBody,
  googleForm,
  healthText,
  isLimited,
  isReissuable,
  mailApi,
  mailQueryKey,
  mailStatusText,
  parseDailyLimit,
  senderBody,
  senderForm,
  senderText,
  smtpBody,
  smtpForm,
  transportSummary,
} from '../src/admin/lib/mail.js';

const CLIENT_ID = '123456789012-abcdefgh12345678.apps.googleusercontent.com';

function budget(overrides = {}) {
  const { ceiling, publicCap } = mailBudgetThresholds(500);
  return {
    dailyLimit: 500,
    ceiling,
    publicCap,
    sent24h: 0,
    byClass: { essential: 0, admin: 0, public: 0 },
    resetsLastHour: 0,
    limitedUntil: null,
    resumesAt: null,
    ...overrides,
  };
}

function recordingClient() {
  const calls = [];
  const handler = {
    get:
      (_target, name) =>
      (...args) => {
        calls.push([name, ...args]);
        return Promise.resolve({});
      },
  };
  return { client: new Proxy({}, handler), calls };
}

test('mailApi: the relay uses the settings methods, a domain its own', async () => {
  const relay = recordingClient();
  const r = mailApi(relay.client, null);
  await r.get();
  await r.setSender({ senderAddress: 'a@b.example.com' });
  await r.test('x@y.example.com');
  assert.deepEqual(relay.calls, [
    ['getMailSettings'],
    ['setMailSender', { senderAddress: 'a@b.example.com' }],
    ['sendTestMail', 'x@y.example.com'],
  ]);

  const dom = recordingClient();
  const d = mailApi(dom.client, 'beta.example');
  await d.update({ dailyLimit: 2000 });
  await d.setSender({ senderAddress: 'a@b.example.com' });
  await d.resume();
  await d.clear();
  assert.deepEqual(dom.calls, [
    ['updateDomainMail', 'beta.example', { dailyLimit: 2000 }],
    ['setDomainMailSender', 'beta.example', { senderAddress: 'a@b.example.com' }],
    ['resumeDomainMail', 'beta.example'],
    ['clearDomainMail', 'beta.example'],
  ]);
  assert.deepEqual(mailQueryKey(null), ['mail']);
  assert.deepEqual(mailQueryKey('beta.example'), ['mail', 'beta.example']);
});

test('a transport in one line, and its sender', () => {
  assert.equal(
    transportSummary({
      kind: 'gmail-api',
      settings: { clientId: CLIENT_ID, account: 'relay@x.example' },
    }),
    'Gmail API as relay@x.example',
  );
  assert.equal(
    transportSummary({
      kind: 'smtp',
      settings: {
        host: 'smtp.x.example',
        port: 465,
        security: 'tls',
        username: 'u',
        hasCaPem: true,
      },
    }),
    'SMTP smtp.x.example:465 (TLS, signing in as u, a private CA trusted)',
  );
  assert.match(transportSummary({ kind: null, settings: null }), /relay’s transport/);
  assert.equal(
    senderText({ address: 'no-reply@notify.example.com', name: 'Code Lama' }),
    'Code Lama <no-reply@notify.example.com>',
  );
  assert.equal(
    senderText({ address: 'no-reply@notify.example.com', name: null }),
    'no-reply@notify.example.com',
  );
});

test('health: a lost Google grant says to connect again', () => {
  assert.equal(healthText(null), null);
  assert.equal(healthText({ status: 'up', checkedAt: null, reason: null }).tone, 'ok');
  const lost = healthText({ status: 'down', checkedAt: null, reason: 'invalid_grant' });
  assert.equal(lost.tone, 'failing');
  assert.match(lost.text, /connect Google again/);
  assert.equal(healthText({ status: 'unknown', checkedAt: null, reason: null }).tone, 'unknown');
});

test('budget: levels at the warning share and the ceiling; a provider refusal', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const b = budget();
  assert.equal(budgetLevel(b, now).level, 'ok');
  assert.equal(budgetLevel({ ...b, sent24h: Math.ceil(b.ceiling * 0.7) }, now).level, 'warning');
  assert.equal(budgetLevel({ ...b, sent24h: b.ceiling }, now).level, 'full');
  assert.equal(budgetLevel({ ...b, sent24h: b.ceiling }, now).percent, 100);

  const limited = { ...b, limitedUntil: '2026-11-11T12:00:00Z' };
  assert.equal(isLimited(limited, now), true);
  assert.equal(isLimited({ ...b, limitedUntil: '2026-11-09T12:00:00Z' }, now), false);
  assert.equal(budgetLevel(limited, now).level, 'full');
  assert.ok(budgetLines(limited, now).some((line) => /refused for reaching its limit/.test(line)));
  assert.ok(budgetLines(b, now)[0].startsWith(`0 of ${b.ceiling} mails`));
  assert.ok(
    budgetLines({ ...b, resumesAt: '2026-11-10T20:00:00Z' }, now).some((l) => /resumes at/.test(l)),
  );
});

test('a daily limit: whole numbers within the bounds', () => {
  assert.deepEqual(parseDailyLimit('2000'), { value: 2000 });
  assert.ok(parseDailyLimit('0').error);
  assert.ok(parseDailyLimit('1.5').error);
  assert.ok(parseDailyLimit(String(MAIL_DAILY_LIMIT.max + 1)).error);
});

test('SMTP body: the password only as typed, a CA bundle only when chosen', () => {
  const form = {
    ...smtpForm(null),
    host: ' smtp.x.example ',
    username: 'relay',
    senderAddress: 'no-reply@notify.example.com',
  };
  assert.deepEqual(smtpBody(form, 'pw').body, {
    host: 'smtp.x.example',
    port: 587,
    security: 'starttls',
    username: 'relay',
    password: 'pw',
    senderAddress: 'no-reply@notify.example.com',
    senderName: null,
  });
  // Empty password: kept by the panel (same host and username).
  assert.equal('password' in smtpBody(form, '').body, false);
  assert.equal(
    smtpBody({ ...form, username: '' }, 'pw').errors.password,
    'A password needs a username',
  );
  assert.ok(smtpBody({ ...form, useCaPem: true }, '').errors.caPem);
  assert.equal(
    smtpBody({ ...form, useCaPem: true, caPem: '-----BEGIN CERTIFICATE-----x' }, '').body.caPem,
    '-----BEGIN CERTIFICATE-----x',
  );
  assert.ok(smtpBody({ ...form, senderAddress: 'admin@lamaste.local' }, '').errors.senderAddress);
  assert.equal(smtpBody({ ...form, dailyLimit: '2000' }, '').body.dailyLimit, 2000);

  // A stored transport prefills the form, never a secret or the CA bundle.
  const stored = smtpForm({
    kind: 'smtp',
    settings: { host: 'h.example', port: 465, security: 'tls', username: 'u', hasCaPem: true },
    sender: { address: 's@n.example.com', name: 'N' },
    budget: budget(),
  });
  assert.equal(stored.useCaPem, true);
  assert.equal(stored.caPem, '');
  assert.equal(stored.dailyLimit, '500');
});

test('Google body: the client id by core’s rule, the secret as typed', () => {
  const form = {
    ...googleForm(null),
    clientId: CLIENT_ID,
    senderAddress: 'no-reply@notify.example.com',
  };
  assert.deepEqual(googleBody(form, ' s3cret ').body, {
    clientId: CLIENT_ID,
    clientSecret: 's3cret',
    senderAddress: 'no-reply@notify.example.com',
    senderName: null,
  });
  const bad = googleBody({ ...form, clientId: 'nope' }, '');
  assert.ok(bad.errors.clientId);
  assert.ok(bad.errors.clientSecret);
});

test('sender body: only what changed; a domain’s sender-only override sends the sender', () => {
  const transport = {
    kind: 'gmail-api',
    sender: { address: 'no-reply@notify.example.com', name: 'Code Lama' },
    budget: budget(),
  };
  assert.equal(senderBody(senderForm(transport), transport), null);
  assert.deepEqual(senderBody({ ...senderForm(transport), dailyLimit: '2000' }, transport).body, {
    dailyLimit: 2000,
  });
  assert.deepEqual(senderBody({ ...senderForm(transport), senderName: '' }, transport).body, {
    senderName: null,
  });
  assert.deepEqual(
    senderBody({ senderAddress: 'a@notify.example.net', senderName: 'Y', dailyLimit: '' }, null, {
      senderOnly: true,
    }).body,
    { senderAddress: 'a@notify.example.net', senderName: 'Y' },
  );
  assert.ok(senderBody({ ...senderForm(transport), senderAddress: 'x' }, transport).errors);
});

test('an invitation’s mail, in words; which invitations get a new link', () => {
  assert.equal(mailStatusText({ status: 'sent' }, 'a@x.example'), 'E-mailed to a@x.example');
  assert.match(mailStatusText({ status: 'deferred-budget' }), /budget/);
  assert.match(mailStatusText({ status: 'not-configured' }), /no mail is set up/);
  assert.match(mailStatusText({ status: 'failed' }), /share the link yourself/);
  assert.equal(mailStatusText({ status: null, sentAt: null }), null);
  assert.equal(mailStatusText(undefined), null);
  assert.equal(isReissuable({ status: 'pending' }), true);
  assert.equal(isReissuable({ status: 'expired' }), true);
  assert.equal(isReissuable({ status: 'accepted' }), false);
  assert.equal(isReissuable({ status: 'revoked' }), false);
});
