/**
 * The multi-domain relay's core rules (packages/core/docs/multi-domain-relay-design.md):
 * domain names that never overlap, the domain of a hostname, the names the
 * relay keeps for itself on every domain, the Authelia rendering of
 * session cookies, membership and OIDC authorization policies, and
 * hostnames unique as a whole rather than by subdomain.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  DomainError,
  assertDomainAddable,
  assertDomainName,
  domainMembership,
  domainOfHost,
  domainsOverlap,
  isRelayHost,
  isReservedLabel,
  labelUnder,
  indexDomainsProjection,
  parseDomainsProjection,
} from '@lamalibre/lamaste';
import {
  assertDomainRegistrable,
  oidcSecretDigestsComputed,
  reconcileOidcClientSecrets,
  createSite,
  createTunnel,
  registrableDomain,
  updateSite,
  verifyDns,
  hostnameHolder,
  tunnelHost,
  oidcAuthorizationPolicyName,
  renderAccessControl,
  renderOidcAuthorizationPolicies,
  renderSessionCookies,
} from '@lamalibre/lamaste/server';

const logger = { info() {}, error() {}, warn() {} };

// --- domain names ---------------------------------------------------------

test('a domain is a lower-case hostname of two labels or more', () => {
  for (const ok of ['samplepark.tr', 'codelama.com.tr', 'a-b.example']) assertDomainName(ok);
  for (const bad of ['tr', 'Codelama.com.tr', '*.codelama.com.tr', 'codelama.com.tr.', '', 7]) {
    assert.throws(
      () => assertDomainName(bad),
      (err) => err instanceof DomainError,
    );
  }
});

test('domains never overlap: equal, parent or child are refused; siblings and lookalikes are not', () => {
  assert.equal(domainsOverlap('samplepark.tr', 'samplepark.tr'), true);
  assert.equal(domainsOverlap('a.samplepark.tr', 'samplepark.tr'), true);
  assert.equal(domainsOverlap('samplepark.tr', 'a.samplepark.tr'), true);
  assert.equal(domainsOverlap('codelama.com.tr', 'samplepark.tr'), false);
  // A suffix that is not a label boundary is another domain.
  assert.equal(domainsOverlap('xsamplepark.tr', 'samplepark.tr'), false);

  assertDomainAddable('codelama.com.tr', ['samplepark.tr']);
  assert.throws(
    () => assertDomainAddable('cust.samplepark.tr', ['samplepark.tr', 'codelama.com.tr']),
    (err) => err.code === 'DOMAIN_OVERLAP' && /overlaps 'samplepark.tr'/.test(err.message),
  );
  assert.throws(
    () => assertDomainAddable('samplepark.tr', ['samplepark.tr']),
    (err) => err.code === 'DOMAIN_OVERLAP' && /already a domain/.test(err.message),
  );
  assert.throws(
    () => assertDomainAddable('bad_name.tr', []),
    (err) => err.code === 'INVALID_DOMAIN',
  );
});

test('the domain of a hostname: the one it equals or is under, case-insensitively, else none', () => {
  const domains = ['samplepark.tr', 'codelama.com.tr'];
  assert.equal(domainOfHost('feria.codelama.com.tr', domains), 'codelama.com.tr');
  assert.equal(domainOfHost('A.B.SamplePark.tr', domains), 'samplepark.tr');
  assert.equal(domainOfHost('codelama.com.tr', domains), 'codelama.com.tr');
  assert.equal(domainOfHost('xsamplepark.tr', domains), null);
  assert.equal(domainOfHost('example.org', domains), null);
});

test('reserved labels on every domain, and the hosts the relay answers on itself', () => {
  for (const label of ['panel', 'auth', 'tunnel', 'www', 'mail', 'ftp', 'api', 'agent-x', 'AUTH']) {
    assert.equal(isReservedLabel(label), true, label);
  }
  assert.equal(isReservedLabel('feria'), false);

  const domains = ['samplepark.tr', 'codelama.com.tr'];
  for (const host of [
    'auth.codelama.com.tr',
    'panel.codelama.com.tr',
    'tunnel.samplepark.tr',
    'agent-r730.samplepark.tr',
  ]) {
    assert.equal(isRelayHost(host, domains), true, host);
  }
  for (const host of [
    'www.codelama.com.tr', // a custom site's alias may be www
    'codelama.com.tr', // the apex may be a custom site
    'x.auth.codelama.com.tr',
    'auth.example.org', // under no domain
    'feria.codelama.com.tr',
  ]) {
    assert.equal(isRelayHost(host, domains), false, host);
  }
});

// --- Authelia --------------------------------------------------------------

test('one session cookie per domain, each signing in at its own auth.<domain>', () => {
  assert.deepEqual(renderSessionCookies(['samplepark.tr', 'codelama.com.tr']), [
    {
      domain: 'samplepark.tr',
      authelia_url: 'https://auth.samplepark.tr',
      default_redirection_url: 'https://samplepark.tr',
    },
    {
      domain: 'codelama.com.tr',
      authelia_url: 'https://auth.codelama.com.tr',
      default_redirection_url: 'https://codelama.com.tr',
    },
  ]);
  assert.throws(() => renderSessionCookies(['*.samplepark.tr']), DomainError);
});

const DOMAINS = [
  { name: 'samplepark.tr', members: ['onur', 'ayse', 'cust'] },
  { name: 'codelama.com.tr', members: ['onur', 'ayse'] },
];

test('access_control: members of each domain on the domain and every host under it, then deny, default deny', () => {
  const ac = renderAccessControl(DOMAINS, []);
  assert.equal(ac.default_policy, 'deny');
  assert.deepEqual(ac.rules, [
    {
      domain: ['samplepark.tr', '*.samplepark.tr'],
      policy: 'two_factor',
      subject: ['user:ayse', 'user:cust', 'user:onur'],
    },
    { domain: ['samplepark.tr', '*.samplepark.tr'], policy: 'deny' },
    {
      domain: ['codelama.com.tr', '*.codelama.com.tr'],
      policy: 'two_factor',
      subject: ['user:ayse', 'user:onur'],
    },
    { domain: ['codelama.com.tr', '*.codelama.com.tr'], policy: 'deny' },
  ]);
});

test('access_control: a site rule names only members of its domain — allowed users and admins alike', () => {
  const ac = renderAccessControl(DOMAINS, [
    {
      fqdn: 'docs.codelama.com.tr',
      autheliaProtected: true,
      // cust is allowed on the site but is no member of codelama.com.tr.
      allowedUsers: ['onur', 'cust'],
    },
    { fqdn: 'wiki.samplepark.tr', autheliaProtected: true, restrictAccess: true },
    { fqdn: 'open.samplepark.tr', autheliaProtected: true }, // the domain rule decides
    { fqdn: 'plain.samplepark.tr', autheliaProtected: false, allowedUsers: ['onur'] },
  ]);
  assert.deepEqual(ac.rules.slice(0, 5), [
    { domain: 'docs.codelama.com.tr', policy: 'two_factor', subject: ['user:onur'] },
    {
      domain: 'docs.codelama.com.tr',
      policy: 'two_factor',
      subject: [
        ['group:admins', 'user:ayse'],
        ['group:admins', 'user:onur'],
      ],
    },
    { domain: 'docs.codelama.com.tr', policy: 'deny' },
    {
      domain: 'wiki.samplepark.tr',
      policy: 'two_factor',
      subject: [
        ['group:admins', 'user:ayse'],
        ['group:admins', 'user:cust'],
        ['group:admins', 'user:onur'],
      ],
    },
    { domain: 'wiki.samplepark.tr', policy: 'deny' },
  ]);
  assert.equal(ac.rules.length, 9, 'four domain rules follow; unprotected sites render none');
});

test('access_control: a domain without members and a site under no domain refuse everyone', () => {
  const ac = renderAccessControl(
    [{ name: 'new.example', members: [] }],
    [{ fqdn: 'blog.example.org', autheliaProtected: true, allowedUsers: ['onur'] }],
  );
  assert.deepEqual(ac.rules, [
    { domain: 'blog.example.org', policy: 'deny' },
    { domain: ['new.example', '*.new.example'], policy: 'deny' },
  ]);
});

test('access_control: the same members render the same rules, whatever their order or repeats', () => {
  const a = renderAccessControl([{ name: 'samplepark.tr', members: ['onur', 'ayse'] }], []);
  const b = renderAccessControl([{ name: 'samplepark.tr', members: ['ayse', 'onur', 'ayse'] }], []);
  assert.deepEqual(a, b);
});

test('access_control and OIDC policies refuse a member that is not a Lamaste username', () => {
  const bad = [{ name: 'samplepark.tr', members: ['onur', 'group:admins'] }];
  // The refusal never repeats the value (it reaches logs and warnings).
  for (const render of [
    () => renderAccessControl(bad, []),
    () => renderOidcAuthorizationPolicies(bad),
  ]) {
    assert.throws(
      render,
      (err) => /not a Lamaste username/.test(err.message) && !err.message.includes('group:admins'),
    );
  }
});

test('OIDC authorization policies: per domain and factor, its members admitted and everyone else refused', () => {
  assert.equal(
    oidcAuthorizationPolicyName('codelama.com.tr', 'two_factor'),
    'lamaste_codelama_com_tr_two_factor',
  );
  const policies = renderOidcAuthorizationPolicies([
    { name: 'codelama.com.tr', members: ['onur', 'ayse'] },
    { name: 'new.example', members: [] },
  ]);
  assert.deepEqual(policies, {
    lamaste_codelama_com_tr_one_factor: {
      default_policy: 'deny',
      rules: [{ policy: 'one_factor', subject: ['user:ayse', 'user:onur'] }],
    },
    lamaste_codelama_com_tr_two_factor: {
      default_policy: 'deny',
      rules: [{ policy: 'two_factor', subject: ['user:ayse', 'user:onur'] }],
    },
    // Authelia refuses a policy without rules, and a rule without subjects or networks.
    lamaste_new_example_one_factor: {
      default_policy: 'deny',
      rules: [{ policy: 'deny', networks: ['0.0.0.0/0', '::/0'] }],
    },
    lamaste_new_example_two_factor: {
      default_policy: 'deny',
      rules: [{ policy: 'deny', networks: ['0.0.0.0/0', '::/0'] }],
    },
  });
});

// --- hostnames unique as a whole ----------------------------------------------

function tunnelDeps(tunnels, domain) {
  return {
    domain,
    email: 'ops@relay.test',
    nginx: {
      writeGatekeeperVhost: async () => {},
      removeAppVhost: async () => {},
    },
    certbot: { issueTunnelCert: async () => ({ skipped: true, certPath: '/x/' }) },
    chisel: { syncChisel: async () => {} },
    state: {
      readTunnels: async () => structuredClone(tunnels),
      writeTunnels: async (next) => {
        tunnels.splice(0, tunnels.length, ...structuredClone(next));
      },
    },
    agents: { isActiveAgent: async () => true },
    logger,
  };
}

test('tunnels: the same subdomain may serve on two domains; one hostname is one tunnel', async () => {
  const tunnels = [];
  const first = tunnelDeps(tunnels, 'samplepark.tr');
  await createTunnel({ ...first, subdomain: 'feria', port: 20060, agentLabel: 'vm1' });
  const second = tunnelDeps(tunnels, 'codelama.com.tr');
  const moved = await createTunnel({
    ...second,
    subdomain: 'feria',
    port: 20061,
    agentLabel: 'vm1',
  });
  assert.equal(moved.fqdn, 'feria.codelama.com.tr');
  assert.deepEqual(
    tunnels.map((t) => t.fqdn),
    ['feria.samplepark.tr', 'feria.codelama.com.tr'],
  );

  await assert.rejects(
    createTunnel({ ...second, subdomain: 'feria', port: 20062, agentLabel: 'vm1' }),
    (err) => err.code === 'SUBDOMAIN_IN_USE' && /feria\.codelama\.com\.tr/.test(err.message),
  );
});

function siteDeps(sites, tunnels, domain, domains = ['samplepark.tr', 'codelama.com.tr']) {
  return {
    domain,
    domains,
    relayDomains: domains,
    email: 'ops@relay.test',
    nginx: { writeStaticSiteVhost: async () => {}, removeStaticSiteVhost: async () => {} },
    certbot: {
      issueTunnelCert: async () => ({ skipped: true, certPath: '/x/' }),
      getCertPath: async () => '/x/',
      issueSiteCert: async () => ({ skipped: true, certPath: '/x/' }),
    },
    files: {
      createSiteDirectory: async () => {},
      removeSiteDirectory: async () => {},
      getSiteRoot: (id) => `/var/www/lamaste/${id}`,
    },
    siteState: {
      readSites: async () => structuredClone(sites),
      writeSites: async (next) => {
        sites.splice(0, sites.length, ...structuredClone(next));
      },
    },
    tunnelState: { readTunnels: async () => structuredClone(tunnels) },
    logger,
  };
}

test('sites: a tunnel collides by its stored hostname, not by a subdomain on another domain', async () => {
  const sites = [];
  const tunnels = [
    { fqdn: 'blog.codelama.com.tr', subdomain: 'blog' },
    { fqdn: null, subdomain: null }, // an internal plugin tunnel has no hostname
  ];
  const { site } = await createSite({
    ...siteDeps(sites, tunnels, 'samplepark.tr'),
    name: 'blog',
    type: 'managed',
  });
  assert.equal(site.fqdn, 'blog.samplepark.tr');

  await assert.rejects(
    createSite({
      ...siteDeps(sites, tunnels, 'samplepark.tr'),
      name: 'blog2',
      type: 'custom',
      customDomain: 'blog.codelama.com.tr',
    }),
    (err) => err.code === 'FQDN_TUNNEL_COLLISION',
  );
  await assert.rejects(
    createSite({
      ...siteDeps(sites, tunnels, 'samplepark.tr'),
      name: 'apex',
      type: 'custom',
      customDomain: 'example.org',
      aliases: ['blog.codelama.com.tr'],
    }),
    (err) => err.code === 'ALIAS_IN_USE',
  );
});

test('sites: agent- names, the relay’s own hosts as custom sites and aliases are refused; www and the apex stay aliases', async () => {
  const sites = [];
  const deps = siteDeps(sites, [], 'samplepark.tr');
  await assert.rejects(
    createSite({ ...deps, name: 'agent-x', type: 'managed' }),
    (err) => err.code === 'RESERVED_NAME',
  );
  await assert.rejects(
    createSite({ ...deps, name: 'portal', type: 'custom', customDomain: 'auth.samplepark.tr' }),
    (err) => err.code === 'RESERVED_NAME',
  );
  await assert.rejects(
    createSite({
      ...deps,
      name: 'apex',
      type: 'custom',
      customDomain: 'samplepark.tr',
      aliases: ['panel.samplepark.tr'],
    }),
    (err) => err.code === 'INVALID_ALIAS',
  );
  const { site } = await createSite({
    ...deps,
    name: 'company',
    type: 'custom',
    customDomain: 'shop.samplepark.tr',
    // A domain's apex is no relay host: an alias as well as a custom site.
    aliases: ['www.samplepark.tr', 'samplepark.tr'],
  });
  assert.deepEqual(site.aliases, ['www.samplepark.tr', 'samplepark.tr']);
});

test('sites: sign-in on a hostname under none of the domains is refused — no session cookie reaches it', async () => {
  const sites = [];
  await assert.rejects(
    createSite({
      ...siteDeps(sites, [], 'samplepark.tr'),
      name: 'outside',
      type: 'custom',
      customDomain: 'blog.example.org',
      autheliaProtected: true,
    }),
    (err) => err.code === 'NOT_UNDER_DOMAIN',
  );
  const { site } = await createSite({
    ...siteDeps(sites, [], 'samplepark.tr'),
    name: 'inside',
    type: 'custom',
    customDomain: 'docs.codelama.com.tr',
    autheliaProtected: true,
  });
  assert.equal(site.autheliaProtected, true);
});

test('a tunnel’s host: its hostname and the domain under its subdomain; none for an internal tunnel', () => {
  assert.deepEqual(tunnelHost({ subdomain: 'feria', fqdn: 'feria.codelama.com.tr' }), {
    fqdn: 'feria.codelama.com.tr',
    domain: 'codelama.com.tr',
  });
  assert.equal(tunnelHost({ subdomain: null, fqdn: null }), null);
  assert.equal(tunnelHost({ subdomain: 'feria', fqdn: 'other.codelama.com.tr' }), null);
});

test('Gatekeeper’s projection: only a well-formed one is read; membership by the host’s domain', () => {
  const projection = parseDomainsProjection({
    v: 1,
    domains: [
      { name: 'samplepark.tr', members: ['onur', 'cust'] },
      { name: 'codelama.com.tr', members: ['onur'] },
    ],
  });
  assert.ok(projection);
  const index = indexDomainsProjection(projection);
  assert.deepEqual(domainMembership(index, 'workspace.codelama.com.tr', 'onur'), {
    domain: 'codelama.com.tr',
    member: true,
  });
  assert.deepEqual(domainMembership(index, 'workspace.codelama.com.tr', 'cust'), {
    domain: 'codelama.com.tr',
    member: false,
  });
  assert.deepEqual(domainMembership(index, 'SHOP.samplepark.tr', 'cust'), {
    domain: 'samplepark.tr',
    member: true,
  });
  assert.deepEqual(domainMembership(index, 'blog.example.org', 'onur'), {
    domain: null,
    member: false,
  });

  for (const bad of [
    null,
    { v: 2, domains: [] },
    { v: 1 },
    { v: 1, domains: [{ name: 'Bad Domain', members: [] }] },
    { v: 1, domains: [{ name: 'a.tr', members: ['user:onur'] }] },
    {
      v: 1,
      domains: [
        { name: 'samplepark.tr', members: [] },
        { name: 'x.samplepark.tr', members: [] },
      ],
    },
  ]) {
    assert.equal(parseDomainsProjection(bad), null, JSON.stringify(bad));
  }
});

test('the label of a hostname under a domain: lower case, more than one label too; none at or outside it', () => {
  assert.equal(labelUnder('Feria.CodeLama.com.tr', 'codelama.com.tr'), 'feria');
  assert.equal(labelUnder('a.b.codelama.com.tr', 'codelama.com.tr'), 'a.b');
  assert.equal(labelUnder('codelama.com.tr', 'codelama.com.tr'), null);
  assert.equal(labelUnder('xcodelama.com.tr', 'codelama.com.tr'), null);
});

test('who holds a hostname: a tunnel, a site or a site’s alias — leaving a site out of its own check', () => {
  const tunnels = [{ fqdn: 'feria.codelama.com.tr' }, { fqdn: null }];
  const sites = [
    { id: 's1', name: 'company', fqdn: 'codelama.com.tr', aliases: ['www.codelama.com.tr'] },
  ];
  assert.deepEqual(hostnameHolder('FERIA.codelama.com.tr', { tunnels, sites }), {
    kind: 'tunnel',
    name: 'feria.codelama.com.tr',
  });
  assert.deepEqual(hostnameHolder('codelama.com.tr', { tunnels, sites }), {
    kind: 'site',
    name: 'company',
  });
  assert.deepEqual(hostnameHolder('www.codelama.com.tr', { sites }), {
    kind: 'alias',
    name: 'company',
  });
  assert.equal(hostnameHolder('www.codelama.com.tr', { sites, selfSiteId: 's1' }), null);
  assert.equal(hostnameHolder('free.codelama.com.tr', { tunnels, sites }), null);
});

// --- security review fixes ----------------------------------------------------

test('domains with one registrable domain, and public suffixes, are refused side by side', () => {
  assert.equal(registrableDomain('feria.codelama.com.tr'), 'codelama.com.tr');
  assertDomainRegistrable('codelama.com.tr', ['samplepark.tr']);
  assertDomainRegistrable('a.github.io', ['b.github.io']); // two sites of the private section
  assert.throws(
    () => assertDomainRegistrable('cust2.example.net', ['samplepark.tr', 'cust1.example.net']),
    (err) => err.code === 'SAME_REGISTRABLE_DOMAIN' && /example\.net/.test(err.message),
  );
  for (const suffix of ['com.tr', 'github.io']) {
    assert.throws(
      () => assertDomainRegistrable(suffix, ['samplepark.tr']),
      (err) => err.code === 'PUBLIC_SUFFIX',
      suffix,
    );
  }
  assert.throws(
    () => assertDomainRegistrable('x.samplepark.tr', ['samplepark.tr']),
    (err) => err.code === 'DOMAIN_OVERLAP',
  );
});

test('tunnels: a domain removed after the caller resolved it is refused under the tunnel lock', async () => {
  const tunnels = [];
  await assert.rejects(
    createTunnel({
      ...tunnelDeps(tunnels, 'codelama.com.tr'),
      assertDomainActive: async (domain) => {
        throw Object.assign(new Error(`'${domain}' is not an active domain`), {
          code: 'unknown_domain',
        });
      },
      subdomain: 'late',
      port: 20090,
      agentLabel: 'vm1',
    }),
    (err) => err.code === 'unknown_domain' && /codelama\.com\.tr/.test(err.message),
  );
  assert.deepEqual(tunnels, []);
});

test('a protected site under none of the domains is never rewritten open: edits and DNS checks are refused', async () => {
  // As 4.6 could leave one: protected, outside every domain, live.
  const legacy = {
    id: '11111111-2222-4333-8444-555555555555',
    name: 'legacy',
    fqdn: 'docs.customer.example',
    type: 'custom',
    spaMode: false,
    autheliaProtected: true,
    allowedUsers: [],
    dnsVerified: true,
    certIssued: true,
    rootPath: '/var/www/lamaste/11111111-2222-4333-8444-555555555555/',
    createdAt: '2026-10-01T00:00:00.000Z',
    totalSize: 0,
  };
  const sites = [legacy];
  const writes = [];
  const deps = {
    ...siteDeps(sites, [], 'samplepark.tr'),
    nginx: {
      writeStaticSiteVhost: async (site, certDir, domain) => writes.push(domain),
      removeStaticSiteVhost: async () => {},
    },
    authelia: { renderAccess: async () => {} },
  };
  await assert.rejects(
    updateSite({ ...deps, id: legacy.id, spaMode: true }),
    (err) => err.code === 'NOT_UNDER_DOMAIN',
  );
  await assert.rejects(
    verifyDns({ ...deps, id: legacy.id, serverIp: '203.0.113.10' }),
    (err) => err.code === 'NOT_UNDER_DOMAIN',
  );
  assert.deepEqual(writes, [], 'no vhost written');
  // Turning protection off stays possible.
  await updateSite({ ...deps, id: legacy.id, autheliaProtected: false });
  assert.equal(sites[0].autheliaProtected, false);
});

test('sites: the relay hostnames of a pending domain are kept free too', async () => {
  const sites = [];
  const deps = {
    ...siteDeps(sites, [], 'samplepark.tr'),
    relayDomains: ['samplepark.tr', 'codelama.com.tr', 'next.example'],
  };
  await assert.rejects(
    createSite({ ...deps, name: 'phish', type: 'custom', customDomain: 'auth.next.example' }),
    (err) => err.code === 'RESERVED_NAME',
  );
  await assert.rejects(
    createSite({
      ...deps,
      name: 'shop',
      type: 'custom',
      customDomain: 'shop.next.example',
      aliases: ['panel.next.example'],
    }),
    (err) => err.code === 'INVALID_ALIAS',
  );
});

test('a steady relay computes no client-secret digest: PBKDF2 runs once per secret, off the event loop', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-oidc-digests-'));
  try {
    const desired = [{ id: 'feria-service', plugin: 'feria' }];
    const first = await reconcileOidcClientSecrets(dir, desired);
    const computed = oidcSecretDigestsComputed();
    // The identity tick renders every minute: the same secret, the same digest, no PBKDF2.
    for (let i = 0; i < 3; i += 1) {
      const again = await reconcileOidcClientSecrets(dir, desired);
      assert.deepEqual(again.digests, first.digests);
    }
    assert.equal(oidcSecretDigestsComputed(), computed);
    assert.match(first.digests['feria-service'], /^\$pbkdf2-sha512\$310000\$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
