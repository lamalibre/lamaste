/**
 * The relay's domains in the panel's words: which domains a form offers,
 * when it asks at all, what keeps a domain from being removed, the DNS
 * records a domain needs, who can be added as a member, and the membership
 * changes an edit makes — plus the reserved-name copy kept equal to the
 * core library's.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_PANEL_SUBDOMAIN_PREFIX as CORE_PREFIX,
  RESERVED_SUBDOMAINS as CORE,
} from '@lamalibre/lamaste';
import {
  activeDomainNames,
  dnsRecordsFor,
  domainStatusText,
  domainUsageLines,
  explainDomainRefusal,
  memberCandidates,
  membershipChanges,
  needsDomainChoice,
  newUsersNeedDomains,
  primaryDomainName,
} from '../src/admin/lib/domains.js';
import { AGENT_PANEL_SUBDOMAIN_PREFIX, RESERVED_SUBDOMAINS } from '../src/admin/lib/web-surface.js';

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
  assert.equal(primaryDomainName(DOMAINS), 'samplepark.tr');
  assert.equal(primaryDomainName(undefined), null);
});

test('a single-domain relay asks nothing; two domains ask', () => {
  const one = [DOMAINS[0]];
  assert.equal(needsDomainChoice(one), false);
  assert.equal(newUsersNeedDomains(one), false);
  // A pending second domain: users must be given domains, hostnames cannot go there yet.
  const pending = [DOMAINS[0], DOMAINS[3]];
  assert.equal(needsDomainChoice(pending), false);
  assert.equal(newUsersNeedDomains(pending), true);
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

test('the DNS records a domain needs: its sign-in, and a wildcard or a record per hostname', () => {
  const records = dnsRecordsFor('codelama.com.tr', '138.68.65.228');
  assert.deepEqual(
    records.map((r) => [r.type, r.name, r.value]),
    [
      ['A', 'auth.codelama.com.tr', '138.68.65.228'],
      ['A', '*.codelama.com.tr', '138.68.65.228'],
    ],
  );
  assert.equal(dnsRecordsFor('x.example', null)[0].value, '<relay IP>');
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

test('the membership changes an edit makes', () => {
  assert.deepEqual(membershipChanges(['samplepark.tr'], ['codelama.com.tr', 'samplepark.tr']), {
    add: ['codelama.com.tr'],
    remove: [],
  });
  assert.deepEqual(membershipChanges(['a.example', 'b.example'], ['b.example']), {
    add: [],
    remove: ['a.example'],
  });
});

test('the reserved-name copy equals the core library’s', () => {
  assert.deepEqual([...RESERVED_SUBDOMAINS], [...CORE]);
  assert.equal(AGENT_PANEL_SUBDOMAIN_PREFIX, CORE_PREFIX);
});
