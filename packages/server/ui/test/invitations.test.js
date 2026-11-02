/**
 * Invitations in the panel's words: reasons, who invited whom, the filters
 * of the list, a plugin's policy as a form, the people who joined by
 * invitation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { INVITATION_REVOKE_REASONS } from '@lamalibre/lamaste/invitation-limits';

import {
  declaresInvitingRole,
  filterInvitations,
  invitationFilters,
  invitedByText,
  inviteeText,
  inviteesByInviter,
  invitingRoleLines,
  isRevocable,
  parseEmailDomains,
  policyForm,
  policyInput,
  revokeReasonText,
  revokeResultText,
} from '../src/admin/lib/invitations.js';

const ayse = { userId: '11111111-1111-4111-8111-111111111111', username: 'ayse' };
const gone = { userId: '22222222-2222-4222-8222-222222222222', username: null };

test('every revocation reason has words; an unknown one shows as itself, none as null', () => {
  for (const reason of INVITATION_REVOKE_REASONS) {
    assert.notEqual(revokeReasonText(reason), reason, reason);
  }
  assert.equal(revokeReasonText('something_new'), 'something_new');
  assert.equal(revokeReasonText(null), null);
});

test('only an open invitation can be stopped; one being accepted is marked', () => {
  assert.equal(isRevocable({ status: 'pending' }), true);
  assert.equal(isRevocable({ status: 'accepting' }), true);
  for (const status of ['expired', 'accepted', 'revoked']) {
    assert.equal(isRevocable({ status }), false);
  }
  assert.match(revokeResultText('marked'), /end revoked/);
  assert.equal(revokeResultText('revoked'), 'Invitation revoked');
  assert.equal(revokeResultText('deleted'), 'Invitation deleted');
});

test('who an invitation is for, and who made it', () => {
  assert.equal(inviteeText({ username: 'deniz', email: 'd@x.test' }), 'deniz');
  assert.equal(inviteeText({ username: null, email: 'd@x.test' }), 'd@x.test');
  assert.equal(inviteeText({ username: null, email: null }), '—');
  assert.equal(invitedByText({ kind: 'admin' }), 'administrator');
  assert.equal(
    invitedByText({ kind: 'delegated', plugin: 'corral', inviter: ayse }),
    'ayse · corral',
  );
  assert.equal(
    invitedByText({ kind: 'delegated', plugin: 'corral', inviter: gone }),
    '22222222 · corral',
  );
});

test('the filters offer what the list names, and select by plugin and inviter', () => {
  const list = [
    { id: 'a', kind: 'admin', plugin: null, inviter: null },
    { id: 'b', kind: 'delegated', plugin: 'corral', inviter: ayse },
    { id: 'c', kind: 'delegated', plugin: 'alpha', inviter: gone },
    { id: 'd', kind: 'delegated', plugin: 'corral', inviter: gone },
  ];
  assert.deepEqual(invitationFilters(list), {
    plugins: ['alpha', 'corral'],
    inviters: [
      { userId: gone.userId, label: '22222222' },
      { userId: ayse.userId, label: 'ayse' },
    ],
  });
  assert.deepEqual(invitationFilters(undefined), { plugins: [], inviters: [] });
  const ids = (filter) => filterInvitations(list, filter).map((i) => i.id);
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids({ plugin: 'corral' }), ['b', 'd']);
  assert.deepEqual(ids({ inviter: gone.userId }), ['c', 'd']);
  assert.deepEqual(ids({ plugin: 'corral', inviter: gone.userId }), ['d']);
});

test('a plugin that declares an inviting role, in the labels of its block', () => {
  const identity = {
    roles: [
      { id: 'coordinator', label: 'Koordinatör', invites: ['stakeholder', 'coordinator'] },
      { id: 'founder', label: 'Kurucu' },
      { id: 'stakeholder', label: 'Paydaş' },
    ],
  };
  assert.equal(declaresInvitingRole({ identity }), true);
  assert.equal(declaresInvitingRole({ identity: { roles: [identity.roles[1]] } }), false);
  assert.equal(declaresInvitingRole({}), false);
  assert.deepEqual(invitingRoleLines(identity), ['Koordinatör may invite Paydaş, Koordinatör']);
  assert.deepEqual(invitingRoleLines(null), []);
});

test('e-mail domains: any separator, lower case, each once', () => {
  assert.deepEqual(parseEmailDomains('Example.test, b.test\nexample.test  c.test'), [
    'example.test',
    'b.test',
    'c.test',
  ]);
  assert.deepEqual(parseEmailDomains(''), []);
});

test('the policy as a form and back; what the form refuses before asking', () => {
  const form = policyForm(null);
  assert.deepEqual(form, {
    enabled: false,
    emailDomains: '',
    maxOpenPerInviter: '10',
    maxJoined: '50',
    lifetimeDays: '7',
  });
  assert.deepEqual(policyInput(form), {
    policy: {
      enabled: false,
      emailDomains: [],
      maxOpenPerInviter: 10,
      maxJoined: 50,
      lifetimeDays: 7,
    },
  });
  assert.equal(
    policyForm({ enabled: true, emailDomains: ['a.test', 'b.test'] }).emailDomains,
    'a.test\nb.test',
  );
  assert.match(policyInput({ ...form, enabled: true }).error, /at least one e-mail domain/);
  assert.match(policyInput({ ...form, maxJoined: '501' }).error, /from 1 to 500/);
  assert.match(policyInput({ ...form, lifetimeDays: '1.5' }).error, /from 1 to 30/);
  assert.match(policyInput({ ...form, maxOpenPerInviter: '0' }).error, /from 1 to 100/);
  const many = Array.from({ length: 21 }, (_, i) => `d${i}.test`).join(' ');
  assert.match(policyInput({ ...form, emailDomains: many }).error, /At most 20/);
});

test('the people who joined, by inviter; only accepted delegated invitations count', () => {
  const accepted = (username, inviter, extra = {}) => ({
    kind: 'delegated',
    status: 'accepted',
    username,
    role: 'stakeholder',
    inviter,
    acceptedUserId: `id-${username}`,
    fulfilled: true,
    ...extra,
  });
  const groups = inviteesByInviter([
    accepted('zeki', ayse),
    accepted('ali', ayse, { fulfilled: false }),
    accepted('can', gone),
    { kind: 'delegated', status: 'pending', username: null, inviter: ayse },
    { kind: 'admin', status: 'accepted', username: 'root', inviter: null },
  ]);
  assert.deepEqual(
    groups.map((g) => [g.label, g.invitees.map((i) => i.username)]),
    [
      ['22222222', ['can']],
      ['ayse', ['ali', 'zeki']],
    ],
  );
  assert.equal(groups[1].userId, ayse.userId);
  assert.equal(groups[1].invitees[0].fulfilled, false);
  assert.deepEqual(inviteesByInviter(undefined), []);
});
