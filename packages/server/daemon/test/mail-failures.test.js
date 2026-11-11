/**
 * What a provider's refusal means (packages/core/docs/mail-design.md §3.7):
 * Google's daily sending limit stops the sending account, its per-second
 * rate limits never do; an SMTP limit reply stops the account only when it
 * answers the session, `MAIL FROM` or `DATA` — a refused recipient concerns
 * that message alone. Google's answers are read up to a cap.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { gmailSendFailure, readCappedBody } from '../src/lib/mail-gmail.js';
import { smtpFailure } from '../src/lib/mail-smtp.js';

const NOW = Date.parse('2026-11-10T12:00:00.000Z');

function googleError(code, reason, message) {
  return { error: { code, message, errors: [{ domain: 'usageLimits', reason, message }] } };
}

test("Gmail: the daily limit stops the account until Google's time, at most 24 h", () => {
  const daily = gmailSendFailure(
    403,
    googleError(403, 'dailyLimitExceeded', 'Daily Limit Exceeded'),
    { now: NOW },
  );
  assert.equal(daily.failure, 'limited');
  assert.equal(daily.until, new Date(NOW + 24 * 3_600_000).toISOString());

  const quota = gmailSendFailure(
    400,
    { error: { code: 400, message: 'Daily user sending limit exceeded.' } },
    { now: NOW },
  );
  assert.equal(quota.failure, 'limited');

  const mailSending = gmailSendFailure(
    429,
    googleError(
      429,
      'rateLimitExceeded',
      'User-rate limit exceeded.  Retry after 2026-11-10T18:30:00.000Z (Mail sending)',
    ),
    { now: NOW },
  );
  assert.equal(mailSending.failure, 'limited');
  assert.equal(mailSending.until, '2026-11-10T18:30:00.000Z');

  const far = gmailSendFailure(
    429,
    googleError(429, 'rateLimitExceeded', 'Retry after 2026-11-20T00:00:00.000Z (Mail sending)'),
    { now: NOW },
  );
  assert.equal(far.until, new Date(NOW + 24 * 3_600_000).toISOString(), 'never past 24 h');
});

test('Gmail: per-second and per-user rate limits are transient, with when to try again', () => {
  const user = gmailSendFailure(
    403,
    googleError(403, 'userRateLimitExceeded', 'User Rate Limit Exceeded'),
    { now: NOW },
  );
  assert.equal(user.failure, 'transient');
  assert.equal(user.reason, 'rate_limited');
  assert.equal(user.retryAfterMs, null);

  const rate = gmailSendFailure(
    429,
    googleError(
      429,
      'rateLimitExceeded',
      'User-rate limit exceeded.  Retry after 2026-11-10T12:00:03.000Z',
    ),
    { now: NOW },
  );
  assert.equal(rate.failure, 'transient');
  assert.equal(rate.reason, 'rate_limited');
  assert.equal(rate.retryAfterMs, 3_000);

  const header = gmailSendFailure(429, null, { retryAfterHeader: '2', now: NOW });
  assert.equal(header.reason, 'rate_limited');
  assert.equal(header.retryAfterMs, 2_000);

  const project = gmailSendFailure(
    403,
    googleError(403, 'rateLimitExceeded', 'Rate Limit Exceeded'),
    { now: NOW },
  );
  assert.equal(project.reason, 'rate_limited');
});

test('Gmail: other refusals keep their meaning', () => {
  assert.equal(gmailSendFailure(503, null, { now: NOW }).reason, 'http_503');
  assert.equal(gmailSendFailure(401, null, { now: NOW }).reason, 'token_expired');
  const scope = gmailSendFailure(
    403,
    googleError(403, 'insufficientPermissions', 'Insufficient Permission'),
    { now: NOW },
  );
  assert.deepEqual([scope.failure, scope.reason], ['down', 'scope']);
  assert.equal(gmailSendFailure(400, null, { now: NOW }).failure, 'refused');
});

function smtpError(command, response) {
  const responseCode = Number(response.slice(0, 3));
  return Object.assign(new Error(`failed: ${response}`), {
    code: command === 'RCPT TO' || command === 'MAIL FROM' ? 'EENVELOPE' : 'EMESSAGE',
    command,
    response,
    responseCode,
  });
}

test('SMTP: limit replies to the session, MAIL FROM or DATA stop the account', () => {
  for (const [command, response] of [
    ['MAIL FROM', '550 5.4.5 Daily user sending quota exceeded. - gsmtp'],
    ['MAIL FROM', '452 4.5.3 Your message has too many recipients'],
    ['DATA', '550 5.7.1 Daily sending quota exceeded'],
    ['DATA', '554 5.7.0 Too many messages sent in a short time'],
    ['CONN', '421 4.7.0 Rate limit exceeded, closing connection'],
    ['MAIL FROM', '451 4.7.1 Sending limit reached, try later'],
  ]) {
    const failure = smtpFailure(smtpError(command, response));
    assert.deepEqual([failure.failure, failure.reason], ['limited', 'provider_limit'], response);
  }
});

test('SMTP: a refused recipient is that message alone, whatever it says', () => {
  for (const [response, failure] of [
    ['550 5.1.1 The email account that you tried to reach does not exist', 'refused'],
    ['550 5.4.5 Daily user sending quota exceeded', 'refused'],
    ['452 4.5.3 Too many recipients', 'transient'],
    ['450 4.2.1 The user you are trying to contact is receiving mail too quickly', 'transient'],
  ]) {
    const result = smtpFailure(smtpError('RCPT TO', response));
    assert.equal(result.failure, failure, response);
    assert.match(result.reason, /^smtp_rcpt_\d{3}$/);
  }
});

test('SMTP: a policy reply to MAIL FROM flags the account, other replies keep their meaning', () => {
  const policy = smtpFailure(
    smtpError('MAIL FROM', '553 5.7.1 Sender address rejected: not owned by user'),
  );
  assert.deepEqual([policy.failure, policy.reason], ['down', 'policy']);
  assert.equal(smtpFailure(smtpError('DATA', '451 4.3.0 Try again later')).failure, 'transient');
  assert.equal(smtpFailure(smtpError('DATA', '554 5.6.0 Message refused')).failure, 'refused');
  assert.equal(
    smtpFailure(smtpError('CONN', '421 4.3.2 Service shutting down')).failure,
    'transient',
  );
  const auth = smtpFailure(
    Object.assign(new Error('Invalid login'), {
      code: 'EAUTH',
      command: 'AUTH PLAIN',
      responseCode: 535,
      response: '535 5.7.8 Username and Password not accepted',
    }),
  );
  assert.deepEqual([auth.failure, auth.reason], ['down', 'auth']);
  const dropped = smtpFailure(
    Object.assign(new Error('Connection closed'), { code: 'ECONNECTION', command: 'CONN' }),
  );
  assert.deepEqual([dropped.failure, dropped.reason], ['transient', 'connection']);
});

test("Google's answers are read up to 256 KiB, a declared or a streamed overflow refused", async () => {
  const small = new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });
  assert.deepEqual(JSON.parse((await readCappedBody(small)).toString()), { ok: true });

  let pulled = 0;
  const endless = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(64 * 1024));
    },
  });
  assert.equal(await readCappedBody(new Response(endless)), null);
  assert.ok(pulled <= 6, `read ${pulled} chunks`);

  let declaredPulled = 0;
  const declared = new Response(
    new ReadableStream({
      pull(controller) {
        declaredPulled += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    }),
    { headers: { 'content-length': String(10 * 1024 * 1024) } },
  );
  assert.equal(await readCappedBody(declared), null);
  assert.ok(declaredPulled <= 1);
});
