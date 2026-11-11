/**
 * Invitations as `lamaste-server invitations` and `plugins invitations`
 * take and print them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  invitationRows,
  invitationsPath,
  madeMailText,
  parseCreateArgs,
  parseListArgs,
  parseReissueArgs,
  policyLines,
  policySetBody,
  resolveUserId,
  revokeText,
} from '../src/invitations.js';

const ID = '11111111-1111-4111-8111-111111111111';

test('the list takes --plugin and --inviter, each once, each with a value', () => {
  assert.deepEqual(parseListArgs([]), {});
  assert.deepEqual(parseListArgs(['--plugin', 'corral', '--inviter', 'ayse']), {
    plugin: 'corral',
    inviter: 'ayse',
  });
  assert.equal(parseListArgs(['--plugin']), null);
  assert.equal(parseListArgs(['--plugin', '--inviter']), null);
  assert.equal(parseListArgs(['--plugin', 'a', '--plugin', 'b']), null);
  assert.equal(parseListArgs(['--role', 'x']), null);
  assert.equal(invitationsPath(), '/api/invitations');
  assert.equal(
    invitationsPath({ plugin: 'corral', inviter: ID }),
    `/api/invitations?plugin=corral&inviter=${ID}`,
  );
});

test('a user by id as it is, a username by the directory — who holds it now first', () => {
  const users = [
    { userId: 'old', username: 'ayse', status: 'removed' },
    { userId: 'new', username: 'ayse', status: 'active' },
    { userId: 'gone', username: 'can', status: 'removed' },
    { userId: 'erased', username: null, status: 'removed' },
  ];
  assert.equal(resolveUserId(ID, []), ID);
  assert.equal(resolveUserId('ayse', users), 'new');
  assert.equal(resolveUserId('can', users), 'gone');
  assert.equal(resolveUserId('nobody', users), null);
});

test('one row per invitation: who for, who invited, why revoked', () => {
  const [delegated, admin] = invitationRows([
    {
      id: 'a',
      kind: 'delegated',
      username: null,
      email: 'd@client.test',
      inviter: { userId: ID, username: 'ayse' },
      plugin: 'corral',
      role: 'stakeholder',
      status: 'revoked',
      revokedReason: 'inviter_unentitled',
      expiresAt: '2026-11-09T10:00:00.000Z',
    },
    {
      id: 'b',
      kind: 'admin',
      username: 'root',
      email: 'r@x.test',
      status: 'accepted',
      fulfilled: true,
      revokedReason: null,
      expiresAt: '2026-11-09T10:00:00.000Z',
    },
  ]);
  assert.deepEqual(delegated, {
    id: 'a',
    invitee: 'd@client.test',
    invitedBy: 'ayse · corral',
    role: 'stakeholder',
    status: 'revoked',
    reason: 'the inviter lost the role that could give it',
    expiresAt: '2026-11-09',
    // A revoked invitation's mail is past saying.
    mail: '',
  });
  assert.equal(admin.invitedBy, 'administrator');
  assert.equal(admin.status, 'accepted');
  const [pending] = invitationRows([
    { id: 'c', kind: 'delegated', status: 'accepted', fulfilled: false, username: 'can' },
  ]);
  assert.equal(pending.status, 'accepted (access pending)');
});

test('what a revocation did, in words', () => {
  assert.equal(revokeText('a', 'revoked'), 'a revoked');
  assert.equal(revokeText('a', 'deleted'), 'a deleted');
  assert.match(revokeText('a', 'marked'), /being accepted.*end revoked/);
});

test('set changes what its flags name; the rest keep their values', () => {
  const current = {
    enabled: false,
    emailDomains: ['client.test'],
    maxOpenPerInviter: 5,
    maxJoined: 20,
    lifetimeDays: 3,
    available: true,
  };
  assert.deepEqual(policySetBody(['--enable'], current), {
    enabled: true,
    emailDomains: ['client.test'],
    maxOpenPerInviter: 5,
    maxJoined: 20,
    lifetimeDays: 3,
  });
  assert.deepEqual(
    policySetBody(
      [
        '--disable',
        '--email-domains',
        'A.test, b.test',
        '--max-open',
        '7',
        '--max-joined',
        '9',
        '--lifetime-days',
        '14',
      ],
      current,
    ),
    {
      enabled: false,
      emailDomains: ['a.test', 'b.test'],
      maxOpenPerInviter: 7,
      maxJoined: 9,
      lifetimeDays: 14,
    },
  );
  assert.equal(policySetBody([], current), null);
  assert.equal(policySetBody(['--enable', '--disable'], current), null);
  assert.equal(policySetBody(['--max-open'], current), null);
  assert.equal(policySetBody(['--max-open', '--enable'], current), null);
  assert.equal(policySetBody(['--max-open', '1.5'], current), null);
  assert.equal(policySetBody(['--max-open', '1', '--max-open', '2'], current), null);
  assert.equal(policySetBody(['--nope', 'x'], current), null);
});

test('the policy as lines; why it cannot work, when it cannot', () => {
  const lines = policyLines({
    enabled: true,
    emailDomains: ['client.test'],
    maxOpenPerInviter: 10,
    maxJoined: 50,
    lifetimeDays: 7,
    invitingRoles: [{ role: 'coordinator', invites: ['stakeholder'] }],
    available: false,
    unavailableReason: 'the plugin has no web surface of its own',
  });
  assert.ok(lines.includes('enabled:        yes'));
  assert.ok(lines.includes('inviting roles: coordinator → stakeholder'));
  assert.equal(lines.at(-1), 'cannot work now: the plugin has no web surface of its own');
  assert.equal(
    policyLines({ emailDomains: [], invitingRoles: [], available: true }).at(-1),
    'inviting roles: none',
  );
});

test('create: a username, an address, and the flags — mail only when a flag says', () => {
  assert.deepEqual(parseCreateArgs(['ayse', 'ayse@corp.example']), {
    username: 'ayse',
    email: 'ayse@corp.example',
  });
  assert.deepEqual(
    parseCreateArgs([
      'boss',
      'boss@corp.example',
      '--groups',
      'admins, feria-admins',
      '--domains',
      'a.example,b.example',
      '--external-domains',
      'c.example',
      '--expires-days',
      '3',
      '--mail',
    ]),
    {
      username: 'boss',
      email: 'boss@corp.example',
      groups: ['admins', 'feria-admins'],
      domains: ['a.example', 'b.example', { name: 'c.example', kind: 'external' }],
      expiresInDays: 3,
      mail: true,
    },
  );
  assert.equal(parseCreateArgs(['ayse', 'a@b.example', '--no-mail']).mail, false);
  for (const args of [
    [],
    ['ayse'],
    ['--mail', 'a@b.example'],
    ['ayse', 'a@b.example', '--mail', '--no-mail'],
    ['ayse', 'a@b.example', '--groups'],
    ['ayse', 'a@b.example', '--expires-days', '31'],
    ['ayse', 'a@b.example', '--whatever', 'x'],
  ]) {
    assert.equal(parseCreateArgs(args), null, args.join(' '));
  }
});

test('reissue: an id, and --mail or --no-mail at most', () => {
  assert.deepEqual(parseReissueArgs(['abc']), { id: 'abc', body: {} });
  assert.deepEqual(parseReissueArgs(['abc', '--mail']), { id: 'abc', body: { mail: true } });
  assert.deepEqual(parseReissueArgs(['abc', '--no-mail']), { id: 'abc', body: { mail: false } });
  assert.equal(parseReissueArgs(['abc', '--mail', '--no-mail']), null);
  assert.equal(parseReissueArgs(['--mail']), null);
  assert.equal(parseReissueArgs([]), null);
});

test('a mail the administrator chose not to send is said so', () => {
  assert.match(madeMailText(null), /as chosen/);
  assert.match(madeMailText({ status: 'sent' }, 'a@b.example'), /e-mailed to a@b\.example/);
});
