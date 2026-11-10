/**
 * Mail as `lamaste-server mail` and `domains mail <name>` take and print
 * it: the paths, the flags (a secret is never one), the bodies, a
 * transport's lines, and an invitation's mail.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GOOGLE_FLAGS,
  SENDER_FLAGS,
  SMTP_FLAGS,
  consentStored,
  googleFields,
  googleRequest,
  mailPath,
  parseDailyLimitFlag,
  parseMailFlags,
  senderRequest,
  smtpRequest,
  transportLines,
} from '../src/mail.js';
import { invitationRows, mailText } from '../src/invitations.js';

const CLIENT_ID = '123456789012-abcdefgh12345678.apps.googleusercontent.com';

test('the paths of the relay and of a domain', () => {
  assert.equal(mailPath(null), '/api/settings/mail');
  assert.equal(mailPath(null, '/test'), '/api/settings/mail/test');
  assert.equal(mailPath('beta.example', '/sender'), '/api/domains/beta.example/mail/sender');
});

test('flags: values both ways, switches, and never a secret', () => {
  assert.deepEqual(
    parseMailFlags(['--host', 'smtp.x.example.com', '--port=465', '--password-stdin'], SMTP_FLAGS),
    { host: 'smtp.x.example.com', port: '465', 'password-stdin': true },
  );
  assert.throws(
    () => parseMailFlags(['--password', 'hunter2'], SMTP_FLAGS),
    /never accepted on the command line/,
  );
  assert.throws(() => parseMailFlags(['--password=hunter2'], SMTP_FLAGS), /never accepted/);
  assert.throws(() => parseMailFlags(['--client-secret=x'], GOOGLE_FLAGS), /never accepted/);
  // The refusal never repeats the secret.
  assert.throws(
    () => parseMailFlags(['--password=hunter2'], SMTP_FLAGS),
    (err) => !err.message.includes('hunter2'),
  );
  assert.throws(() => parseMailFlags(['--host'], SMTP_FLAGS), /needs a value/);
  assert.throws(() => parseMailFlags(['--bogus'], SMTP_FLAGS), /Unknown argument/);
  assert.throws(() => parseMailFlags(['--no-wait=1'], GOOGLE_FLAGS), /Unknown argument/);
});

test('set-smtp body: the security from the port, the password only when read', () => {
  const flags = parseMailFlags(
    [
      '--host',
      'smtp.x.example.com',
      '--port',
      '465',
      '--username',
      'relay',
      '--sender',
      'no-reply@notify.example.com',
    ],
    SMTP_FLAGS,
  );
  assert.deepEqual(smtpRequest(flags, { password: 'pw' }), {
    host: 'smtp.x.example.com',
    port: 465,
    security: 'tls',
    username: 'relay',
    password: 'pw',
    senderAddress: 'no-reply@notify.example.com',
  });
  // No password: the panel keeps the stored one.
  assert.equal('password' in smtpRequest(flags), false);
  assert.equal(smtpRequest({ ...flags, port: undefined }).security, 'starttls');
  assert.equal(smtpRequest(flags, { caPem: 'PEM' }).caPem, 'PEM');
  // No --ca-file: the panel keeps the stored bundle; --no-ca removes it.
  assert.equal('caPem' in smtpRequest(flags), false);
  assert.equal(smtpRequest({ ...flags, 'no-ca': true }).caPem, null);
  assert.throws(() => smtpRequest({ ...flags, 'no-ca': true, 'ca-file': 'ca.pem' }), /exclusive/);
  assert.throws(
    () => smtpRequest({ ...flags, username: undefined }, { password: 'pw' }),
    /needs --username/,
  );
  assert.throws(() => smtpRequest({ ...flags, sender: undefined }), /--sender/);
  assert.throws(() => smtpRequest({ ...flags, security: 'ssl' }), /--security/);
  assert.equal(smtpRequest({ ...flags, 'daily-limit': '2000' }).dailyLimit, 2000);
});

test('google body: the fields first, the secret after', () => {
  const flags = parseMailFlags(
    [
      '--client-id',
      CLIENT_ID,
      '--sender',
      'no-reply@notify.example.com',
      '--sender-name',
      'Code Lama',
    ],
    GOOGLE_FLAGS,
  );
  assert.deepEqual(googleFields(flags), {
    clientId: CLIENT_ID,
    senderAddress: 'no-reply@notify.example.com',
    senderName: 'Code Lama',
  });
  assert.equal(googleRequest(flags, 's3cret').clientSecret, 's3cret');
  assert.throws(() => googleRequest(flags, null), /client secret is required/);
  assert.throws(() => googleFields({}), /--client-id/);
});

test('sender body: the relay changes what is given, a domain names its address', () => {
  assert.deepEqual(
    senderRequest(parseMailFlags(['--no-name'], SENDER_FLAGS), { senderOnly: false }),
    {
      senderName: null,
    },
  );
  assert.throws(() => senderRequest({}, { senderOnly: false }), /Nothing to change/);
  assert.throws(() => senderRequest({ name: 'x' }, { senderOnly: true }), /--address/);
  assert.throws(
    () => senderRequest({ name: 'x', 'no-name': true }, { senderOnly: false }),
    /not both/,
  );
  assert.deepEqual(senderRequest({ address: 'a@notify.example.net' }, { senderOnly: true }), {
    senderAddress: 'a@notify.example.net',
  });
});

test('a daily limit flag is a whole number within the bounds', () => {
  assert.equal(parseDailyLimitFlag('2000'), 2000);
  assert.throws(() => parseDailyLimitFlag('0'));
  assert.throws(() => parseDailyLimitFlag('x'));
});

test('a transport as lines: the check, the budget, a provider refusal', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const lines = Object.fromEntries(
    transportLines(
      {
        scope: 'relay',
        domain: null,
        kind: 'gmail-api',
        settings: { clientId: CLIENT_ID, account: 'relay@example.com' },
        sender: { address: 'no-reply@notify.example.com', name: 'Code Lama' },
        hasSecret: true,
        verifiedAt: '2026-11-10T10:00:00Z',
        updatedAt: '2026-11-10T10:00:00Z',
        health: { status: 'down', checkedAt: '2026-11-10T11:00:00Z', reason: 'invalid_grant' },
        budget: {
          dailyLimit: 500,
          ceiling: 450,
          publicCap: 360,
          sent24h: 12,
          byClass: { essential: 2, admin: 4, public: 6 },
          resetsLastHour: 1,
          limitedUntil: '2026-11-11T00:00:00Z',
          resumesAt: null,
        },
      },
      now,
    ),
  );
  assert.equal(lines.Transport, 'Gmail API as relay@example.com');
  assert.equal(lines.Sender, 'Code Lama <no-reply@notify.example.com>');
  assert.match(lines.Check, /run `google` again/);
  assert.match(lines.Budget, /^12 of 450 in 24 h/);
  assert.match(lines.Limited, /until 2026-11-11/);
});

test('consent: stored once a newer Google grant shows', () => {
  assert.equal(consentStored(null, null), false);
  assert.equal(consentStored({ kind: 'gmail-api', updatedAt: 'b' }, 'a'), true);
  assert.equal(consentStored({ kind: 'gmail-api', updatedAt: 'a' }, 'a'), false);
  assert.equal(consentStored({ kind: 'smtp', updatedAt: 'b' }, 'a'), false);
});

test('an invitation’s mail, in words, on open rows only', () => {
  assert.equal(mailText({ status: 'sent' }, 'a@x.example.com'), 'e-mailed to a@x.example.com');
  assert.match(mailText({ status: 'deferred-budget' }), /budget/);
  assert.equal(mailText(null), '');
  const [open, accepted] = invitationRows([
    {
      id: 'i1',
      status: 'pending',
      mail: { status: 'failed', sentAt: null },
      expiresAt: '2026-11-17',
    },
    {
      id: 'i2',
      status: 'accepted',
      mail: { status: 'sent', sentAt: '2026-11-10' },
      expiresAt: '2026-11-17',
    },
  ]);
  assert.match(open.mail, /could not be e-mailed/);
  assert.equal(accepted.mail, '');
});
