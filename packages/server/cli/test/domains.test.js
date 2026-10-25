/**
 * `lamaste-server domains` in words: one row per domain and what uses it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { domainRows, usageText } from '../src/domains.js';

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
