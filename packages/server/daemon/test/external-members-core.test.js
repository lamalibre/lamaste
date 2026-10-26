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
  foldGroupName,
  isAssignableGroupName,
  isLamasteOwnedGroup,
  memberGroup,
  mergeOwnedGroups,
  oidcClientGroup,
  reachedOidcClients,
  renderOwnedGroups,
  siteGroup,
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
  usersFileWatched,
} from '@lamalibre/lamaste/server';

const A = 'samplepark.tr';
const B = 'codelama.com.tr';
/** The domains' group keys (random on a relay: the names say nothing of the domain). */
const KA = '0a0a0a0a0a0a0a0a';
const KB = '0b0b0b0b0b0b0b0b';
const MA = `lamaste:m:${KA}`;
const MB = `lamaste:m:${KB}`;
const XA = `lamaste:x:${KA}`;
const XB = `lamaste:x:${KB}`;
const DOMAINS = [
  { name: A, groupKey: KA },
  { name: B, groupKey: KB },
];

/** Authelia's RE2 named group as JavaScript writes it. */
function asJsRegex(pattern) {
  return new RegExp(pattern.replace('(?P<', '(?<'), 'i');
}

test('group names: opaque for domains and sites, no hostname, no domain named', () => {
  assert.equal(memberGroup(KB), MB);
  assert.equal(externalGroup(KB), XB);
  assert.equal(
    siteGroup('5f0c1a2b-0000-4000-8000-000000000001'),
    'lamaste:s:5f0c1a2b-0000-4000-8000-000000000001',
  );
  assert.equal(oidcClientGroup('feria-cli'), 'lamaste:oidc@feria-cli');
  for (const name of [memberGroup(KB), externalGroup(KB)]) {
    assert.equal(name.includes('codelama'), false, 'a domain group names no domain');
  }
  assert.throws(() => memberGroup(B), 'a group key, never a domain name');
  assert.throws(() => memberGroup('0B0B0B0B0B0B0B0B'));
  assert.throws(() => siteGroup('../x'));
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
    'lamaste:m:0b0b0b0b0b0b0b0b',
    'a@b',
    'with space',
    42,
    null,
  ]) {
    assert.equal(isAssignableGroupName(bad), false, String(bad));
  }
  assert.equal(ADMIN_GROUP_NAME_RE.source, '^[A-Za-z0-9_-]{1,64}$');
});

test('owned groups: the lamaste: prefix and any hostname at or under a relay domain, folded as Authelia compares', () => {
  const domains = [A, B];
  for (const owned of [
    MA,
    'LAMASTE:anything',
    'corral.codelama.com.tr',
    'CORRAL.codelama.com.tr',
    'codelama.com.tr',
    'a.b.samplepark.tr',
    // Go's EqualFold takes ſ (U+017F) for s and the Kelvin sign (U+212A)
    // for k: Authelia would match these to an owned name, so they are owned.
    'ſhop.samplepark.tr',
    'lamaſte:m:x',
    '\u212Aiosk.codelama.com.tr',
    // NFKC compatibility forms: fullwidth letters.
    'ｌａｍａｓｔｅ:x:y',
  ]) {
    assert.ok(isLamasteOwnedGroup(owned, domains), owned);
  }
  for (const other of ['admins', 'feria-admins', 'team.example.org', 'xcodelama.com.tr']) {
    assert.equal(isLamasteOwnedGroup(other, domains), false, other);
  }
  assert.equal(foldGroupName('ſhop.\u212A'), 'shop.k');
});

test('renderOwnedGroups: domain groups by kind; site groups name the listed people; host and client groups external members only', () => {
  const groups = renderOwnedGroups({
    domains: [
      { name: A, groupKey: KA, members: ['onur', 'cust'], externals: [] },
      { name: B, groupKey: KB, members: ['onur'], externals: ['client', 'other'] },
    ],
    sites: [
      // Members and external members it lists; a stranger and a member of
      // another domain are named nowhere.
      { id: 'docs', fqdn: 'Docs.codelama.com.tr', users: ['onur', 'client', 'cust', 'stranger'] },
      // A site under no active domain names nobody.
      { id: 'blog', fqdn: 'blog.example.org', users: ['onur'] },
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
    onur: [MA, MB, 'lamaste:s:docs'].sort(),
    cust: [MA],
    client: ['corral.codelama.com.tr', 'lamaste:oidc@feria-cli', 'lamaste:s:docs', XB].sort(),
    other: [XB],
  });
});

test('renderOwnedGroups refuses a user both member and external of one domain, and a non-username member', () => {
  const base = { sites: [], hostGrants: [], clientGrants: [] };
  assert.throws(
    () =>
      renderOwnedGroups({
        ...base,
        domains: [{ name: B, groupKey: KB, members: ['xavier'], externals: ['xavier'] }],
      }),
    /both a member and an external member/,
  );
  for (const input of [
    { ...base, domains: [{ name: B, groupKey: KB, members: ['user:x'], externals: [] }] },
    { ...base, domains: [{ name: B, groupKey: KB, members: [], externals: ['x,y'] }] },
    { ...base, domains: [{ name: B, groupKey: B, members: ['onur'], externals: [] }] },
  ]) {
    assert.throws(
      () => renderOwnedGroups(input),
      (err) => {
        assert.equal(err.message.includes('user:x') || err.message.includes('x,y'), false);
        return true;
      },
    );
  }
  // A listed name or a grant's principal that is none of the domain's
  // people names nobody: it never fails the whole rendering.
  assert.deepEqual(
    renderOwnedGroups({
      domains: [{ name: B, groupKey: KB, members: ['onur'], externals: ['ext'] }],
      sites: [{ id: 'a', fqdn: `a.${B}`, users: ['a b', 'onur'] }],
      hostGrants: [{ fqdn: `c.${B}`, users: ['x,y', 'ext'] }],
      clientGrants: [{ clientId: 'c', domain: B, users: ['user:x', 'ext'] }],
    }),
    new Map([
      ['onur', [MB, 'lamaste:s:a']],
      ['ext', [`c.${B}`, 'lamaste:oidc@c', XB]],
    ]),
  );
});

test('mergeOwnedGroups: replaces exactly the owned groups, keeps the administrator’s in order', () => {
  const admin = { displayname: 'Admin', groups: ['admins', 'feria-admins'] };
  const users = {
    admin,
    onur: {
      displayname: 'Onur',
      // A stray host group (under a pending domain too) and a stale owned
      // group go; a dotted group outside every domain is not Lamaste's.
      groups: [XA, 'feria-admins', 'Old.samplepark.tr', 'x.pending.tr', 'team.example.org'],
    },
    client: { displayname: 'Client' },
    nobody: { displayname: 'Nobody', groups: [] },
  };
  const desired = new Map([
    ['onur', [MA]],
    ['client', ['corral.codelama.com.tr', XB]],
    ['ghost', [MA]],
  ]);
  const { users: merged, changed } = mergeOwnedGroups(users, desired, [A, B, 'pending.tr']);
  assert.equal(changed, true);
  assert.equal(merged.admin, admin, 'an unchanged entry is the same object');
  assert.deepEqual(merged.onur, {
    displayname: 'Onur',
    groups: ['feria-admins', 'team.example.org', MA],
  });
  assert.deepEqual(merged.client.groups, ['corral.codelama.com.tr', XB]);
  assert.equal(merged.nobody, users.nobody);
  assert.equal('ghost' in merged, false, 'a user the file does not hold is not added');
  assert.deepEqual(users.onur.groups.length, 5, 'the input is not modified');

  const again = mergeOwnedGroups(merged, desired, [A, B, 'pending.tr']);
  assert.equal(again.changed, false);
});

test('mergeOwnedGroups: a user the rendering did not know gets none; narrow-only keeps the held ∩ desired and adds nothing', () => {
  const users = {
    // Created since the rendering, under a username a deleted user held:
    // the deleted user's desired groups must not land on them.
    bob: { groups: ['staff', MB, 'corral.codelama.com.tr'] },
    onur: { groups: ['admins', MA] },
  };
  const desired = new Map([
    ['bob', [MB, 'lamaste:s:docs']],
    ['onur', [MA, MB]],
  ]);
  const known = new Set(['onur']);
  assert.deepEqual(mergeOwnedGroups(users, desired, [A, B], { known }).users, {
    bob: { groups: ['staff'] },
    onur: { groups: ['admins', MA, MB] },
  });
  // Narrow only (a rendering failed since): onur keeps MA (held and
  // desired), gains no MB; bob, known now, keeps MB, gains nothing, loses
  // the host group the desired set does not hold.
  assert.deepEqual(
    mergeOwnedGroups(users, desired, [A, B], { narrowOnly: true, known: new Set(['bob', 'onur']) })
      .users,
    { bob: { groups: ['staff', MB] }, onur: users.onur },
  );
});

test('access_control on groups: site rules, then the portal, members, external members by host group, deny — no people in it', () => {
  const ac = renderGroupAccessControl(DOMAINS, [
    { id: 'docs', fqdn: 'Docs.codelama.com.tr', autheliaProtected: true, allowedUsers: ['client'] },
    { fqdn: 'admin.samplepark.tr', autheliaProtected: true, restrictAccess: true },
    { fqdn: 'open.samplepark.tr', autheliaProtected: true },
    { id: 'pub', fqdn: 'public.samplepark.tr', autheliaProtected: false, allowedUsers: ['onur'] },
    { id: 'blog', fqdn: 'blog.example.org', autheliaProtected: true, allowedUsers: ['onur'] },
    // Listing users without an id: no group to name them by — admins only.
    { fqdn: 'noid.samplepark.tr', autheliaProtected: true, allowedUsers: ['onur'] },
  ]);
  assert.equal(ac.default_policy, 'deny');
  const domainRules = (name, key) => [
    {
      domain: [`auth.${name}`],
      policy: 'two_factor',
      subject: [`group:lamaste:m:${key}`, `group:lamaste:x:${key}`],
    },
    { domain: [name, `*.${name}`], policy: 'two_factor', subject: [`group:lamaste:m:${key}`] },
    {
      domain_regex: [externalHostRegex(name)],
      policy: 'two_factor',
      subject: [`group:lamaste:x:${key}`],
    },
    { domain: [name, `*.${name}`], policy: 'deny' },
  ];
  assert.deepEqual(ac.rules, [
    { domain: 'docs.codelama.com.tr', policy: 'two_factor', subject: ['group:lamaste:s:docs'] },
    {
      domain: 'docs.codelama.com.tr',
      policy: 'two_factor',
      subject: [['group:admins', `group:${MB}`]],
    },
    { domain: 'docs.codelama.com.tr', policy: 'deny' },
    {
      domain: 'admin.samplepark.tr',
      policy: 'two_factor',
      subject: [['group:admins', `group:${MA}`]],
    },
    { domain: 'admin.samplepark.tr', policy: 'deny' },
    { domain: 'blog.example.org', policy: 'deny' },
    {
      domain: 'noid.samplepark.tr',
      policy: 'two_factor',
      subject: [['group:admins', `group:${MA}`]],
    },
    { domain: 'noid.samplepark.tr', policy: 'deny' },
    ...domainRules(A, KA),
    ...domainRules(B, KB),
  ]);
  const subjects = JSON.stringify(ac.rules.map((r) => r.subject ?? null));
  assert.doesNotMatch(subjects, /codelama|samplepark/, 'no group names a domain');
  assert.throws(() => renderGroupAccessControl([{ name: 'Bad Domain', groupKey: KA }], []));
  assert.throws(() => renderGroupAccessControl([{ name: A, groupKey: 'nope' }], []));
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
    XB,
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
  const policies = renderOidcClientPolicies(
    [
      client({}),
      client({ id: 'shop-login', domain: A, authorizationPolicy: 'one_factor' }),
      SERVICE,
    ],
    DOMAINS,
  );
  assert.deepEqual(policies, {
    'lamaste_client_feria-cli': {
      default_policy: 'deny',
      rules: [
        { policy: 'two_factor', subject: [`group:${MB}`] },
        { policy: 'two_factor', subject: [[`group:${XB}`, 'group:lamaste:oidc@feria-cli']] },
      ],
    },
    'lamaste_client_shop-login': {
      default_policy: 'deny',
      rules: [
        { policy: 'one_factor', subject: [`group:${MA}`] },
        { policy: 'one_factor', subject: [[`group:${XA}`, 'group:lamaste:oidc@shop-login']] },
      ],
    },
  });
  assert.throws(() => renderOidcClientPolicies([client({ domain: 'other.tr' })], DOMAINS));
  assert.equal(oidcClientPolicyName('feria-cli'), 'lamaste_client_feria-cli');
  assert.throws(() => oidcClientPolicyName('a.b'));
});

test('device-code reach: a member of the client’s domain, or an external member granted it', () => {
  const clients = [
    { id: 'feria-cli', groupKey: KB },
    { id: 'shop-cli', groupKey: KA },
  ];
  assert.deepEqual(reachedOidcClients([MB], clients), ['feria-cli']);
  assert.deepEqual(reachedOidcClients([XB], clients), [], 'external without the grant');
  assert.deepEqual(reachedOidcClients([XB, 'lamaste:oidc@feria-cli'], clients), ['feria-cli']);
  assert.deepEqual(reachedOidcClients([MA, MB], clients), ['feria-cli', 'shop-cli']);
  assert.deepEqual(reachedOidcClients(['admins'], clients), []);
});

test('OIDC: user-facing clients name a 15-minute lifespan; a service client does not', () => {
  assert.equal(renderOidcClient(client({})).lifespan, OIDC_USER_LIFESPAN);
  assert.equal('lifespan' in renderOidcClient(SERVICE, '$pbkdf2-sha512$310000$x$y'), false);

  const domains = [{ name: B, groupKey: KB }];
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

test('the users file is held as Lamaste needs: watched, refreshed always, Authelia’s own password writes off', () => {
  const config = {
    authentication_backend: {
      file: { path: '/etc/authelia/users.yml', password: { algorithm: 'bcrypt' } },
      password_reset: { custom_url: '' },
    },
  };
  assert.equal(usersFileWatched(config), false);
  ensureUsersFileWatched(config);
  assert.deepEqual(config.authentication_backend, {
    file: { path: '/etc/authelia/users.yml', password: { algorithm: 'bcrypt' }, watch: true },
    refresh_interval: 'always',
    password_change: { disable: true },
    password_reset: { custom_url: '', disable: true },
  });
  assert.equal(usersFileWatched(config), true);
  // Each setting on its own is not enough.
  for (const undo of [
    (c) => (c.authentication_backend.file.watch = false),
    (c) => (c.authentication_backend.refresh_interval = '5m'),
    (c) => delete c.authentication_backend.password_change,
    (c) => (c.authentication_backend.password_reset.disable = false),
  ]) {
    const copy = structuredClone(config);
    undo(copy);
    assert.equal(usersFileWatched(copy), false);
  }
  // No file backend (never Lamaste's): left alone.
  const ldap = { authentication_backend: { ldap: {} } };
  ensureUsersFileWatched(ldap);
  assert.deepEqual(ldap, { authentication_backend: { ldap: {} } });
});
