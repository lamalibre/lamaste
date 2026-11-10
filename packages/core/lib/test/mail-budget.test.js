/**
 * Mail's sending budget (packages/core/docs/mail-design.md §3.7): the
 * thresholds of a daily limit, which class may still send, the reset cap,
 * a provider's refusal, and the PATCH body.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAIL_BUDGET,
  MAIL_DAILY_LIMIT,
  MAIL_SEND_STATUSES,
  MailTransportPatchSchema,
  SmtpTransportInputSchema,
  mailBudgetDecision,
  mailBudgetThresholds,
} from '../dist/index.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');

function decide(over) {
  return mailBudgetDecision({
    dailyLimit: 500,
    sent24h: 0,
    resetsLastHour: 0,
    sendClass: 'essential',
    kind: 'test',
    limitedUntil: null,
    now: NOW,
    ...over,
  });
}

test('thresholds: 90 % ceiling, public keeps a 20 % reserve, warning at 70 %', () => {
  assert.deepEqual(mailBudgetThresholds(500), { ceiling: 450, publicCap: 360, warningAt: 315 });
  assert.deepEqual(mailBudgetThresholds(2000), { ceiling: 1800, publicCap: 1440, warningAt: 1260 });
  // A tiny limit still sends something, and public never more than the rest.
  assert.deepEqual(mailBudgetThresholds(1), { ceiling: 1, publicCap: 0, warningAt: 1 });
  assert.throws(() => mailBudgetThresholds(0));
  assert.throws(() => mailBudgetThresholds(1.5));
  assert.equal(MAIL_DAILY_LIMIT.default, 500);
});

test('every class sends below the public cap', () => {
  for (const sendClass of ['essential', 'admin', 'public']) {
    assert.deepEqual(decide({ sendClass, sent24h: 359 }), { ok: true });
  }
});

test('public stops at its cap; essential and admin go on to the ceiling', () => {
  assert.deepEqual(decide({ sendClass: 'public', sent24h: 360 }), {
    ok: false,
    reason: 'public-cap',
  });
  assert.deepEqual(decide({ sendClass: 'admin', sent24h: 449 }), { ok: true });
  assert.deepEqual(decide({ sendClass: 'essential', sent24h: 450 }), {
    ok: false,
    reason: 'ceiling',
  });
});

test('reset mails stop at 30 an hour, other kinds do not', () => {
  const resets = MAIL_BUDGET.resetsPerHour;
  assert.deepEqual(decide({ sendClass: 'public', kind: 'reset', resetsLastHour: resets }), {
    ok: false,
    reason: 'reset-cap',
  });
  assert.deepEqual(decide({ sendClass: 'public', kind: 'reset', resetsLastHour: resets - 1 }), {
    ok: true,
  });
  assert.deepEqual(decide({ kind: 'invitation', resetsLastHour: resets }), { ok: true });
});

test("a provider's refusal stops everything until it ends", () => {
  const later = new Date(NOW.getTime() + 3_600_000).toISOString();
  const earlier = new Date(NOW.getTime() - 1).toISOString();
  assert.deepEqual(decide({ limitedUntil: later }), { ok: false, reason: 'limited' });
  assert.deepEqual(decide({ limitedUntil: earlier }), { ok: true });
});

test('deferred-budget is a send status', () => {
  assert.ok(MAIL_SEND_STATUSES.includes('deferred-budget'));
});

test('PATCH takes the sender, its name or the daily limit — at least one', () => {
  assert.deepEqual(MailTransportPatchSchema.parse({ dailyLimit: 2000 }), { dailyLimit: 2000 });
  assert.deepEqual(MailTransportPatchSchema.parse({ senderName: null }), { senderName: null });
  assert.equal(MailTransportPatchSchema.safeParse({}).success, false);
  assert.equal(MailTransportPatchSchema.safeParse({ dailyLimit: 0 }).success, false);
  assert.equal(MailTransportPatchSchema.safeParse({ dailyLimit: 100_001 }).success, false);
  assert.equal(MailTransportPatchSchema.safeParse({ password: 'x' }).success, false);
});

test('an smtp transport may carry its daily limit', () => {
  const parsed = SmtpTransportInputSchema.parse({
    host: 'mail.example.com',
    port: 465,
    security: 'tls',
    senderAddress: 'relay@example.com',
    dailyLimit: 1000,
  });
  assert.equal(parsed.dailyLimit, 1000);
});
