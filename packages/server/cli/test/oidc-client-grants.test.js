/**
 * Grants on a plugin's OIDC clients as `lamaste-server plugins oidc-clients`
 * takes and prints them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findClientGrant, parsePrincipal, principalText } from '../src/oidc-client-grants.js';

test('one principal: --user or --group with a name, nothing else', () => {
  assert.deepEqual(parsePrincipal(['--user', 'ali']), {
    principalType: 'user',
    principalId: 'ali',
  });
  assert.deepEqual(parsePrincipal(['--group', 'client-x']), {
    principalType: 'group',
    principalId: 'client-x',
  });
  assert.equal(parsePrincipal([]), null);
  assert.equal(parsePrincipal(['--user']), null);
  assert.equal(parsePrincipal(['--user', '--group']), null);
  assert.equal(parsePrincipal(['--user', 'a', '--group', 'b']), null);
  assert.equal(parsePrincipal(['--role', 'a']), null);
});

test('a principal in words, as terminal text', () => {
  assert.equal(principalText({ principalType: 'user', principalId: 'ali' }), 'ali');
  assert.equal(principalText({ principalType: 'group', principalId: 'g' }), 'group:g');
  assert.ok(
    !principalText({ principalType: 'user', principalId: 'a\u001b[31m' }).includes('\u001b'),
  );
});

test('the grant to revoke, or why there is none', () => {
  const clients = [
    {
      id: 'corral-web',
      userFacing: true,
      grants: [
        { grantId: 'g1', principalType: 'user', principalId: 'ali' },
        { grantId: 'g2', principalType: 'group', principalId: 'ali' },
      ],
    },
    { id: 'corral-svc', userFacing: false },
    { id: 'corral-cli', userFacing: true, grants: null },
  ];
  const ali = { principalType: 'user', principalId: 'ali' };
  assert.deepEqual(findClientGrant(clients, 'corral-web', ali), { grantId: 'g1' });
  assert.deepEqual(
    findClientGrant(clients, 'corral-web', { principalType: 'group', principalId: 'ali' }),
    { grantId: 'g2' },
  );
  assert.deepEqual(findClientGrant(clients, 'corral-web', { ...ali, principalId: 'bob' }), {
    error: 'no_grant',
  });
  assert.deepEqual(findClientGrant(clients, 'corral-svc', ali), { error: 'no_client' });
  assert.deepEqual(findClientGrant(clients, 'nope', ali), { error: 'no_client' });
  assert.deepEqual(findClientGrant(clients, 'corral-cli', ali), { error: 'unreadable' });
});
