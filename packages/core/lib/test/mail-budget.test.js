/**
 * Mail's sending budget (packages/core/docs/mail-design.md §3.7): the
 * thresholds of a daily limit, each class's share, the reset cap per domain,
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
  adminInvitationMailDefault,
  mailBudgetDecision,
  mailBudgetThresholds,
} from '../dist/index.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');

function decide(over) {
  return mailBudgetDecision({
    dailyLimit: 500,
    sent24h: 0,
    byClass: { essential: 0, admin: 0, public: 0 },
    domainResetsLastHour: 0,
    sendClass: 'essential',
    kind: 'test',
    limitedUntil: null,
    now: NOW,
    ...over,
  });
}

test('thresholds: 90 % ceiling, 40 % shares for essential and public, the rest admin only', () => {
  assert.deepEqual(mailBudgetThresholds(500), {
    ceiling: 450,
    essentialCap: 180,
    publicCap: 180,
    adminReserve: 90,
    warningAt: 315,
  });
  assert.deepEqual(mailBudgetThresholds(2000), {
    ceiling: 1800,
    essentialCap: 720,
    publicCap: 720,
    adminReserve: 360,
    warningAt: 1260,
  });
  // A tiny limit still sends something — to an administrator's mail only.
  assert.deepEqual(mailBudgetThresholds(1), {
    ceiling: 1,
    essentialCap: 0,
    publicCap: 0,
    adminReserve: 1,
    warningAt: 1,
  });
  for (const limit of [1, 7, 33, 500, 2000, 99_999]) {
    const t = mailBudgetThresholds(limit);
    assert.equal(t.essentialCap + t.publicCap + t.adminReserve, t.ceiling);
    assert.ok(t.adminReserve >= Math.floor(t.ceiling * 0.2));
  }
  assert.throws(() => mailBudgetThresholds(0));
  assert.throws(() => mailBudgetThresholds(1.5));
  assert.equal(MAIL_DAILY_LIMIT.default, 500);
});

test('each share counts its own class: a public flood leaves essential and admin mail', () => {
  const flooded = { essential: 0, admin: 0, public: 180 };
  assert.deepEqual(decide({ sendClass: 'public', sent24h: 180, byClass: flooded }), {
    ok: false,
    reason: 'public-cap',
  });
  assert.deepEqual(decide({ sendClass: 'essential', sent24h: 180, byClass: flooded }), {
    ok: true,
  });
  assert.deepEqual(decide({ sendClass: 'admin', sent24h: 180, byClass: flooded }), { ok: true });
});

test("Authelia's share stops essential mail; the reserve stays the administrators'", () => {
  const byClass = { essential: 180, admin: 0, public: 180 };
  assert.deepEqual(decide({ sendClass: 'essential', sent24h: 360, byClass }), {
    ok: false,
    reason: 'essential-cap',
  });
  // Both shares used up: 90 left, for admin mail alone.
  assert.deepEqual(decide({ sendClass: 'admin', sent24h: 360, byClass }), { ok: true });
  assert.deepEqual(
    decide({ sendClass: 'admin', sent24h: 449, byClass: { ...byClass, admin: 89 } }),
    { ok: true },
  );
  assert.deepEqual(
    decide({ sendClass: 'admin', sent24h: 450, byClass: { ...byClass, admin: 90 } }),
    { ok: false, reason: 'ceiling' },
  );
});

test('the ceiling stops every class', () => {
  const byClass = { essential: 0, admin: 450, public: 0 };
  for (const sendClass of ['essential', 'admin', 'public']) {
    assert.deepEqual(decide({ sendClass, sent24h: 450, byClass }), {
      ok: false,
      reason: 'ceiling',
    });
  }
});

test('reset mails stop at 20 an hour per domain, other kinds do not', () => {
  const resets = MAIL_BUDGET.resetsPerDomainPerHour;
  assert.equal(resets, 20);
  assert.deepEqual(decide({ sendClass: 'public', kind: 'reset', domainResetsLastHour: resets }), {
    ok: false,
    reason: 'reset-cap',
  });
  assert.deepEqual(
    decide({ sendClass: 'public', kind: 'reset', domainResetsLastHour: resets - 1 }),
    { ok: true },
  );
  assert.deepEqual(decide({ kind: 'invitation', domainResetsLastHour: resets }), { ok: true });
});

test("a provider's refusal stops everything until it ends", () => {
  const later = new Date(NOW.getTime() + 3_600_000).toISOString();
  const earlier = new Date(NOW.getTime() - 1).toISOString();
  assert.deepEqual(decide({ limitedUntil: later }), { ok: false, reason: 'limited' });
  assert.deepEqual(decide({ sendClass: 'admin', limitedUntil: later }), {
    ok: false,
    reason: 'limited',
  });
  assert.deepEqual(decide({ limitedUntil: earlier }), { ok: true });
});

test("an administrator's invitation is mailed unless it makes an administrator or gives a registry group", () => {
  assert.equal(adminInvitationMailDefault([]), true);
  assert.equal(adminInvitationMailDefault(['internal']), true);
  assert.equal(adminInvitationMailDefault(['admins']), false);
  assert.equal(adminInvitationMailDefault(['internal', 'feria-publishers']), false);
  assert.equal(adminInvitationMailDefault(['feria']), true);
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
