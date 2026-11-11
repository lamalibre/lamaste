/**
 * A person's name as an invitation and its acceptance carry it
 * (mail-design.md §6.1): never one that reads as a link or a host name —
 * Lamaste's mails show the inviter's name to the person invited.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DISPLAY_NAME_LINK_PATTERN,
  DelegatedAcceptanceSchema,
  DelegatedInvitationRequestSchema,
  looksLikeLinkOrHostname,
} from '../dist/index.js';

test('links and host names are refused', () => {
  for (const name of [
    'https://pay.example',
    'hxxp://x',
    'www.example',
    'Visit WWW.Example now',
    'evil.com',
    'Ayşe — billing-update.co',
    'mail.example.co.uk team',
    'ayse@corp.example',
    'evil。com',
    'evil．com',
    'payments.ödeme',
    'Dr.Who',
  ]) {
    assert.equal(looksLikeLinkOrHostname(name), true, name);
  }
});

test('names stay names', () => {
  for (const name of [
    'Ayşe Yılmaz',
    'J. R. R. Tolkien',
    'J.R.R. Tolkien',
    'Acme Ltd. Şti.',
    'Dr. Who',
    'U.S.A',
    'Ali-Veli 2',
    'O’Brien',
  ]) {
    assert.equal(looksLikeLinkOrHostname(name), false, name);
  }
});

test('the pattern the pages embed is the rule', () => {
  const re = new RegExp(DISPLAY_NAME_LINK_PATTERN, 'iu');
  assert.equal(re.test('evil.com'), true);
  assert.equal(re.test('Ayşe Yılmaz'), false);
});

test('an invitation and its acceptance refuse such a name', () => {
  const request = DelegatedInvitationRequestSchema.safeParse({
    email: 'b@corp.example',
    displayName: 'login.corp-help.example',
    role: 'member',
  });
  assert.equal(request.success, false);
  assert.equal(request.error.issues[0].path[0], 'displayName');
  const accepted = DelegatedAcceptanceSchema.safeParse({
    token: 'a'.repeat(64),
    username: 'ayse',
    displayName: 'see https://x.example',
    password: 'long enough',
  });
  assert.equal(accepted.success, false);
  assert.equal(
    DelegatedAcceptanceSchema.safeParse({
      token: 'a'.repeat(64),
      username: 'ayse',
      displayName: 'Ayşe Yılmaz',
      password: 'long enough',
    }).success,
    true,
  );
});
