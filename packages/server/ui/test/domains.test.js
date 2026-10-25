/**
 * The relay's domains in the panel's words: which domains a form offers,
 * when it asks at all, what keeps a domain from being removed, who can be
 * added as a member, and whether two lists of domains are the same.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  activeDomainNames,
  domainStatusText,
  domainUsageLines,
  explainDomainRefusal,
  memberCandidates,
  needsDomainChoice,
  sameDomains,
} from '../src/admin/lib/domains.js';

const DOMAINS = [
  { name: 'samplepark.tr', primary: true, status: 'active' },
  { name: 'zeta.example', primary: false, status: 'active' },
  { name: 'codelama.com.tr', primary: false, status: 'active' },
  { name: 'new.example', primary: false, status: 'pending' },
];

test('active domains offered primary first, then by name; pending ones never', () => {
  assert.deepEqual(activeDomainNames(DOMAINS), [
    'samplepark.tr',
    'codelama.com.tr',
    'zeta.example',
  ]);
});

test('a hostname form asks which domain only once two are active', () => {
  assert.equal(needsDomainChoice([DOMAINS[0]]), false);
  // A pending second domain takes no hostname yet.
  assert.equal(needsDomainChoice([DOMAINS[0], DOMAINS[3]]), false);
  assert.equal(needsDomainChoice(DOMAINS), true);
});

test('a domain’s state and what uses it, in words', () => {
  assert.equal(domainStatusText(DOMAINS[0]), 'active — primary');
  assert.equal(domainStatusText(DOMAINS[3]), 'pending — sign-in not served yet');
  assert.deepEqual(
    domainUsageLines({
      tunnels: ['feria.codelama.com.tr'],
      sites: [],
      plugins: ['feria'],
      registry: true,
    }),
    [
      'Tunnels: feria.codelama.com.tr',
      'Plugins: feria',
      'The registry credential trusts its issuer',
    ],
  );
  assert.deepEqual(domainUsageLines(undefined), []);
});

test('a refused removal names what still uses the domain', () => {
  const err = Object.assign(new Error("Domain 'codelama.com.tr' is in use"), {
    code: 'domain_in_use',
    usedBy: { tunnels: ['feria.codelama.com.tr'], sites: [], plugins: [], registry: false },
  });
  assert.equal(
    explainDomainRefusal(err),
    "Domain 'codelama.com.tr' is in use — Tunnels: feria.codelama.com.tr",
  );
  assert.equal(explainDomainRefusal(new Error('nope')), 'nope');
});

test('member candidates: users the directory knows who are not members yet, by name', () => {
  const users = [
    { username: 'onur', userId: 'u1' },
    { username: 'cust', userId: 'u3' },
    { username: 'ayse', userId: 'u2' },
    { username: 'fresh', userId: null }, // not seen by the directory yet
  ];
  assert.deepEqual(
    memberCandidates(users, [{ userId: 'u1' }]).map((u) => u.username),
    ['ayse', 'cust'],
  );
});

test('two domain lists are the same whatever their order', () => {
  assert.equal(sameDomains(['b.example', 'a.example'], ['a.example', 'b.example']), true);
  assert.equal(sameDomains(['a.example'], ['a.example', 'b.example']), false);
  assert.equal(sameDomains([], undefined), true);
});
