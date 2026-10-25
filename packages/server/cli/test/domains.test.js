/**
 * `lamaste-server domains` in words: one row per domain, what uses it, and a
 * member named by id or username.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { domainRows, resolveUserId, usageText } from '../src/domains.js';

const ID = '3f1c2b9e-8a4d-4c1e-9b2a-1d2e3f4a5b6c';

test('a row per domain: its state, members and what uses it', () => {
  assert.deepEqual(
    domainRows([
      { name: 'samplepark.tr', primary: true, status: 'active', members: 3, usedBy: {} },
      {
        name: 'codelama.com.tr',
        primary: false,
        status: 'active',
        members: 2,
        usedBy: { tunnels: ['a', 'b'], sites: [], plugins: ['feria'], registry: true },
      },
      { name: 'new.example', primary: false, status: 'pending' },
    ]),
    [
      { name: 'samplepark.tr', state: 'primary', members: 3, usedBy: '' },
      {
        name: 'codelama.com.tr',
        state: 'active',
        members: 2,
        usedBy: '2 tunnel(s), 1 plugin(s), the registry credential',
      },
      { name: 'new.example', state: 'pending', members: 0, usedBy: '' },
    ],
  );
  assert.equal(usageText(undefined), '');
});

test('a domain name a panel answer carries is terminal text', () => {
  const [row] = domainRows([{ name: 'evil\u001b[31m.example', status: 'active', members: 0 }]);
  assert.ok(!row.name.includes('\u001b'));
});

test('a member is named by directory id or by username', () => {
  const users = [
    { username: 'onur', userId: ID },
    { username: 'fresh', userId: null },
  ];
  assert.equal(resolveUserId(ID, []), ID);
  assert.equal(resolveUserId('onur', users), ID);
  assert.equal(resolveUserId('fresh', users), null);
  assert.equal(resolveUserId('nobody', users), null);
});
