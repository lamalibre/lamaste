/**
 * External members' core rules (packages/core/docs/external-members-design.md):
 * the Authelia groups Lamaste owns — who holds which, how they are merged
 * into users.yml beside an administrator's groups, which names an
 * administrator may assign — and the rules on those groups: access_control,
 * per-client OIDC authorization policies, the user-facing token lifespan and
 * the users-file watch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_GROUP_NAME_RE,
  externalGroup,
  isAssignableGroupName,
  isLamasteOwnedGroup,
  memberGroup,
  mergeOwnedGroups,
  oidcClientGroup,
  renderOwnedGroups,
} from '@lamalibre/lamaste';
import {
  OIDC_USER_LIFESPAN,
  buildOidcProviderSection,
  ensureUsersFileWatched,
  externalHostRegex,
  oidcClientPolicyName,
  renderGroupAccessControl,
  renderOidcClient,
  renderOidcClientPolicies,
} from '@lamalibre/lamaste/server';

const A = 'samplepark.tr';
const B = 'codelama.com.tr';

/** Authelia's RE2 named group as JavaScript writes it. */
function asJsRegex(pattern) {
  return new RegExp(pattern.replace('(?P<', '(?<'), 'i');
}

test('group names: member, external and OIDC client groups carry what no hostname can', () => {
  assert.equal(memberGroup(B), 'lamaste:member@codelama.com.tr');
  assert.equal(externalGroup(B), 'lamaste:external@codelama.com.tr');
  assert.equal(oidcClientGroup('feria-cli'), 'lamaste:oidc@feria-cli');
  assert.throws(() => memberGroup('Not A Domain'));
  assert.throws(() => oidcClientGroup('Feria.cli'));
});

test('an administrator assigns only plain group names; anything Lamaste could own is refused', () => {
  for (const ok of ['admins', 'feria-admins', 'team_1', 'A'.repeat(64)]) {
    assert.ok(isAssignableGroupName(ok), ok);
  }
  for (const bad of [
    '',
    'A'.repeat(65),
    'corral.codelama.com.tr',
    'lamaste:member@codelama.com.tr',
    'a@b',
    'with space',
    42,
    null,
  ]) {
    assert.equal(isAssignableGroupName(bad), false, String(bad));
  }
  assert.equal(ADMIN_GROUP_NAME_RE.source, '^[A-Za-z0-9_-]{1,64}$');
});

test('owned groups: the lamaste: prefix and any hostname at or under a relay domain, case-insensitively', () => {
  const domains = [A, B];
  for (const owned of [
    'lamaste:member@samplepark.tr',
    'LAMASTE:anything',
    'corral.codelama.com.tr',
    'CORRAL.codelama.com.tr',
    'codelama.com.tr',
    'a.b.samplepark.tr',
  ]) {
    assert.ok(isLamasteOwnedGroup(owned, domains), owned);
  }
  for (const other of ['admins', 'feria-admins', 'team.example.org', 'xcodelama.com.tr']) {
    assert.equal(isLamasteOwnedGroup(other, domains), false, other);
  }
});

test('renderOwnedGroups: domain groups by kind; host and client groups name external members only', () => {
  const groups = renderOwnedGroups({
    domains: [
      { name: A, members: ['onur', 'cust'], externals: [] },
      { name: B, members: ['onur'], externals: ['client', 'other'] },
    ],
    sites: [
      // Members and external members it lists; a stranger and a member of
      // another domain are named nowhere.
      { fqdn: 'Docs.codelama.com.tr', users: ['onur', 'client', 'cust', 'stranger'] },
      // A site under no active domain names nobody.
      { fqdn: 'blog.example.org', users: ['onur'] },
    ],
    hostGrants: [
      // Members reach a restricted host by their domain's group; only the
      // granted external members get its host group.
      { fqdn: 'corral.codelama.com.tr', users: ['onur', 'client', 'cust'] },
      { fqdn: 'shop.samplepark.tr', users: ['client', 'cust'] },
    ],
    clientGrants: [
      { clientId: 'feria-cli', domain: B, users: ['client', 'onur', 'cust'] },
      { clientId: 'shop-login', domain: A, users: ['client'] },
    ],
  });
  assert.deepEqual(Object.fromEntries(groups), {
    onur: [
      'docs.codelama.com.tr',
      'lamaste:member@codelama.com.tr',
      'lamaste:member@samplepark.tr',
    ],
    cust: ['lamaste:member@samplepark.tr'],
    client: [
      'corral.codelama.com.tr',
      'docs.codelama.com.tr',
      'lamaste:external@codelama.com.tr',
      'lamaste:oidc@feria-cli',
    ],
    other: ['lamaste:external@codelama.com.tr'],
  });
});

test('renderOwnedGroups refuses a user both member and external of one domain, and a non-username', () => {
  const base = { sites: [], hostGrants: [], clientGrants: [] };
  assert.throws(
    () =>
      renderOwnedGroups({
        ...base,
        domains: [{ name: B, members: ['xavier'], externals: ['xavier'] }],
      }),
    /both a member and an external member/,
  );
  for (const input of [
    { ...base, domains: [{ name: B, members: ['user:x'], externals: [] }] },
    {
      ...base,
      domains: [{ name: B, members: [], externals: [] }],
      sites: [{ fqdn: `a.${B}`, users: ['a b'] }],
    },
    {
      ...base,
      domains: [{ name: B, members: [], externals: [] }],
      clientGrants: [{ clientId: 'c', domain: B, users: ['x,y'] }],
    },
  ]) {
    assert.throws(
      () => renderOwnedGroups(input),
      (err) => {
        assert.equal(err.message.includes('user:x') || err.message.includes('x,y'), false);
        return true;
      },
    );
  }
});

test('mergeOwnedGroups: replaces exactly the owned groups, keeps the administrator’s in order', () => {
  const admin = { displayname: 'Admin', groups: ['admins', 'feria-admins'] };
  const users = {
    admin,
    onur: {
      displayname: 'Onur',
      // A stray host group (under a pending domain too) and a stale owned
      // group go; a dotted group outside every domain is not Lamaste's.
      groups: [
        'lamaste:external@samplepark.tr',
        'feria-admins',
        'Old.samplepark.tr',
        'x.pending.tr',
        'team.example.org',
      ],
    },
    client: { displayname: 'Client' },
    nobody: { displayname: 'Nobody', groups: [] },
  };
  const desired = new Map([
    ['onur', ['lamaste:member@samplepark.tr']],
    ['client', ['corral.codelama.com.tr', 'lamaste:external@codelama.com.tr']],
    ['ghost', ['lamaste:member@samplepark.tr']],
  ]);
  const { users: merged, changed } = mergeOwnedGroups(users, desired, [A, B, 'pending.tr']);
  assert.equal(changed, true);
  assert.equal(merged.admin, admin, 'an unchanged entry is the same object');
  assert.deepEqual(merged.onur, {
    displayname: 'Onur',
    groups: ['feria-admins', 'team.example.org', 'lamaste:member@samplepark.tr'],
  });
  assert.deepEqual(merged.client.groups, [
    'corral.codelama.com.tr',
    'lamaste:external@codelama.com.tr',
  ]);
  assert.equal(merged.nobody, users.nobody);
  assert.equal('ghost' in merged, false, 'a user the file does not hold is not added');
  assert.deepEqual(users.onur.groups.length, 5, 'the input is not modified');

  const again = mergeOwnedGroups(merged, desired, [A, B, 'pending.tr']);
  assert.equal(again.changed, false);
});

test('access_control on groups: site rules, then members, external members by host group, deny — no people in it', () => {
  const ac = renderGroupAccessControl(
    [A, B],
    [
      { fqdn: 'Docs.codelama.com.tr', autheliaProtected: true, allowedUsers: ['client'] },
      { fqdn: 'admin.samplepark.tr', autheliaProtected: true, restrictAccess: true },
      { fqdn: 'open.samplepark.tr', autheliaProtected: true },
      { fqdn: 'public.samplepark.tr', autheliaProtected: false, allowedUsers: ['onur'] },
      { fqdn: 'blog.example.org', autheliaProtected: true, allowedUsers: ['onur'] },
    ],
  );
  assert.equal(ac.default_policy, 'deny');
  assert.deepEqual(ac.rules, [
    {
      domain: 'docs.codelama.com.tr',
      policy: 'two_factor',
      subject: ['group:docs.codelama.com.tr'],
    },
    {
      domain: 'docs.codelama.com.tr',
      policy: 'two_factor',
      subject: [['group:admins', 'group:lamaste:member@codelama.com.tr']],
    },
    { domain: 'docs.codelama.com.tr', policy: 'deny' },
    {
      domain: 'admin.samplepark.tr',
      policy: 'two_factor',
      subject: [['group:admins', 'group:lamaste:member@samplepark.tr']],
    },
    { domain: 'admin.samplepark.tr', policy: 'deny' },
    { domain: 'blog.example.org', policy: 'deny' },
    {
      domain: [A, `*.${A}`],
      policy: 'two_factor',
      subject: ['group:lamaste:member@samplepark.tr'],
    },
    {
      domain_regex: [externalHostRegex(A)],
      policy: 'two_factor',
      subject: ['group:lamaste:external@samplepark.tr'],
    },
    { domain: [A, `*.${A}`], policy: 'deny' },
    {
      domain: [B, `*.${B}`],
      policy: 'two_factor',
      subject: ['group:lamaste:member@codelama.com.tr'],
    },
    {
      domain_regex: [externalHostRegex(B)],
      policy: 'two_factor',
      subject: ['group:lamaste:external@codelama.com.tr'],
    },
    { domain: [B, `*.${B}`], policy: 'deny' },
  ]);
  assert.throws(() => renderGroupAccessControl(['Bad Domain'], []));
});

test('the external host regex captures a whole hostname under the domain, never the apex or a lookalike', () => {
  const re = asJsRegex(externalHostRegex(B));
  assert.equal(externalHostRegex(B), '^(?P<Group>(?:[a-z0-9-]+\\.)+codelama\\.com\\.tr)$');
  assert.equal(re.exec('corral.codelama.com.tr')?.groups?.Group, 'corral.codelama.com.tr');
  assert.equal(re.exec('a.b.codelama.com.tr')?.groups?.Group, 'a.b.codelama.com.tr');
  for (const no of [
    'codelama.com.tr',
    'evilcodelama.com.tr',
    'corral.codelamaxcom.tr',
    'corral.codelama.com.tr.evil.org',
    'lamaste:external@codelama.com.tr',
  ]) {
    assert.equal(re.test(no), false, no);
  }
});

/** A manifest client as the OIDC sync passes it. */
function client(overrides) {
  return {
    plugin: '@lamalibre/feria-server',
    domain: B,
    id: 'feria-cli',
    grantTypes: ['urn:ietf:params:oauth:grant-type:device_code'],
    scopes: ['openid', 'groups'],
    redirectUris: [],
    audience: [],
    accessTokenClaims: [],
    accessTokenSignedResponseAlg: 'RS256',
    authorizationPolicy: 'two_factor',
    requirePkce: false,
    confidential: false,
    ...overrides,
  };
}

const SERVICE = client({
  id: 'lamaste-server',
  grantTypes: ['client_credentials'],
  scopes: ['lamaste.registry'],
  authorizationPolicy: 'one_factor',
  confidential: true,
});

test('OIDC: one policy per user-facing client — its domain’s members, external members only when granted', () => {
  const policies = renderOidcClientPolicies([
    client({}),
    client({ id: 'shop-login', domain: A, authorizationPolicy: 'one_factor' }),
    SERVICE,
  ]);
  assert.deepEqual(policies, {
    'lamaste_client_feria-cli': {
      default_policy: 'deny',
      rules: [
        { policy: 'two_factor', subject: ['group:lamaste:member@codelama.com.tr'] },
        {
          policy: 'two_factor',
          subject: [['group:lamaste:external@codelama.com.tr', 'group:lamaste:oidc@feria-cli']],
        },
      ],
    },
    'lamaste_client_shop-login': {
      default_policy: 'deny',
      rules: [
        { policy: 'one_factor', subject: ['group:lamaste:member@samplepark.tr'] },
        {
          policy: 'one_factor',
          subject: [['group:lamaste:external@samplepark.tr', 'group:lamaste:oidc@shop-login']],
        },
      ],
    },
  });
  assert.equal(oidcClientPolicyName('feria-cli'), 'lamaste_client_feria-cli');
  assert.throws(() => oidcClientPolicyName('a.b'));
});

test('OIDC: user-facing clients name a 15-minute lifespan; a service client does not', () => {
  assert.equal(renderOidcClient(client({})).lifespan, OIDC_USER_LIFESPAN);
  assert.equal('lifespan' in renderOidcClient(SERVICE, '$pbkdf2-sha512$310000$x$y'), false);

  const domains = [{ name: B, members: ['onur'] }];
  const withUser = buildOidcProviderSection(domains, 'h'.repeat(64), [client({})]);
  assert.deepEqual(withUser.lifespans, {
    device_code: '10 minutes',
    custom: { [OIDC_USER_LIFESPAN]: { access_token: '15 minutes', id_token: '15 minutes' } },
  });
  const serviceOnly = buildOidcProviderSection(domains, 'h'.repeat(64), [SERVICE], {
    secretDigests: { 'lamaste-server': '$pbkdf2-sha512$310000$x$y' },
  });
  assert.deepEqual(serviceOnly.lifespans, { device_code: '10 minutes' });
});

test('the users file is watched: a configuration from before is given watch: true, nothing else changes', () => {
  const config = {
    authentication_backend: {
      file: { path: '/etc/authelia/users.yml', password: { algorithm: 'bcrypt' } },
    },
  };
  ensureUsersFileWatched(config);
  assert.deepEqual(config.authentication_backend.file, {
    path: '/etc/authelia/users.yml',
    password: { algorithm: 'bcrypt' },
    watch: true,
  });
  // No file backend (never Lamaste's): left alone.
  const ldap = { authentication_backend: { ldap: {} } };
  ensureUsersFileWatched(ldap);
  assert.deepEqual(ldap, { authentication_backend: { ldap: {} } });
});
