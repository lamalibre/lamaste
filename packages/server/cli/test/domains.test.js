/**
 * `lamaste-server domains` in words: one row per domain and what uses it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { domainRows, memberRequest, membershipsText, usageText } from '../src/domains.js';

test('a row per domain: its state, members and what uses it', () => {
  assert.deepEqual(
    domainRows([
      { name: 'samplepark.tr', primary: true, status: 'active', members: 3, usedBy: {} },
      {
        name: 'codelama.com.tr',
        primary: false,
        status: 'active',
        members: 2,
        externalMembers: 4,
        usedBy: { tunnels: ['a', 'b'], sites: [], plugins: ['feria'], registry: true },
      },
      { name: 'new.example', primary: false, status: 'pending' },
    ]),
    [
      { name: 'samplepark.tr', state: 'primary', members: 3, externalMembers: 0, usedBy: '' },
      {
        name: 'codelama.com.tr',
        state: 'active',
        members: 2,
        externalMembers: 4,
        usedBy: '2 tunnel(s), 1 plugin(s), the registry credential',
      },
      { name: 'new.example', state: 'pending', members: 0, externalMembers: 0, usedBy: '' },
    ],
  );
  assert.equal(usageText(undefined), '');
});

test('a domain name a panel answer carries is terminal text', () => {
  const [row] = domainRows([{ name: 'evil\u001b[31m.example', status: 'active', members: 0 }]);
  assert.ok(!row.name.includes('\u001b'));
});

test('a membership command line: add (external with the flag), kind, remove', () => {
  const path = '/api/domains/codelama.com.tr/members/ali';
  assert.deepEqual(memberRequest('codelama.com.tr', ['add', 'ali']), {
    method: 'PUT',
    path,
    body: { kind: 'member' },
    user: 'ali',
    kind: 'member',
  });
  assert.deepEqual(memberRequest('codelama.com.tr', ['add', 'ali', '--external']).body, {
    kind: 'external',
  });
  assert.deepEqual(memberRequest('codelama.com.tr', ['kind', 'ali', 'external']).body, {
    kind: 'external',
  });
  assert.equal(memberRequest('codelama.com.tr', ['remove', 'ali']).method, 'DELETE');
  // Nothing the panel would be asked to guess at.
  assert.equal(memberRequest('codelama.com.tr', ['add']), null);
  assert.equal(memberRequest('codelama.com.tr', ['add', 'ali', '--admin']), null);
  assert.equal(memberRequest('codelama.com.tr', ['kind', 'ali']), null);
  assert.equal(memberRequest('codelama.com.tr', ['kind', 'ali', 'owner']), null);
  assert.equal(memberRequest('codelama.com.tr', ['remove', 'ali', '--external']), null);
  assert.equal(
    memberRequest('codelama.com.tr', ['add', '../x']).path,
    '/api/domains/codelama.com.tr/members/..%2Fx',
  );
});

test('memberships in one line, external ones marked, as terminal text', () => {
  assert.equal(
    membershipsText([{ name: 'a.example', kind: 'external' }, 'b.example']),
    'a.example (external), b.example',
  );
  assert.equal(membershipsText(undefined), '—');
  assert.ok(!membershipsText([{ name: 'x\u001b[31m.example', kind: 'member' }]).includes('\u001b'));
});
