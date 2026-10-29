/**
 * Delegated invitations in the panel (packages/core/docs/delegated-invitations-design.md):
 * the administrator's policy; the inviter's API (its guards, what an
 * inviter may give, the caps); acceptance by POST body — the sign-in host
 * rule, the username nothing may name, what an invitation grants (an
 * external membership, one role, the site grant, no Authelia group); the
 * claim and its recovery, a crash between the users file and the directory
 * never making a member; revocations and sweeps; the create-only repair;
 * disabling invitees; the import of invitations.json. Authelia is a users
 * file and a recorder, Gatekeeper a fake (`fake-gatekeeper.js`), the
 * plugin's web surface a stand-in (`setInvitationSurfaceForTests`), the
 * relay assertion a stand-in in the inviter route's tests (the assertion
 * itself: relay-invitations-assertion.test.js).
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { normalizeIdentityBlock } from '@lamalibre/lamaste';

import { createFakeAutheliaStorage } from './fake-authelia-storage.js';
import { installFakeGatekeeper } from './fake-gatekeeper.js';

const HASH = '$2b$12$abcdefghijklmnopqrstuuJ2s4L6rjpDLHi3qL7Nn5D0o3M6a1g2a';
const D = 'codelama.test';
const PORTAL = `auth.${D}`;
const SITE = { id: 'site-corral', fqdn: `corral.${D}` };
const PASSWORD = 'correct-horse-battery';
const IDENTITY = normalizeIdentityBlock({
  roles: [
    { id: 'coordinator', label: 'Koordinatör', invites: ['viewer'] },
    { id: 'viewer', label: 'İzleyici' },
    { id: 'editor', label: 'Editör' },
  ],
});

const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  trace() {},
  fatal() {},
  child() {
    return logger;
  },
};

let dir;
let stateDir;
let usersFile;
let lib;
let admin;
let inviterApp;
let gatekeeper;
let surface = { ok: true, site: SITE, domain: D };

const person = (displayname, email, groups = []) => ({
  displayname,
  email,
  password: HASH,
  groups,
});
const usersNow = async () => yaml.load(await readFile(usersFile, 'utf-8')).users;
const idOf = async (username) => (await lib.findDirectoryUser(username))?.userId;

function entitle(username, roles) {
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: username,
    resourceType: 'plugin',
    resourceId: 'corral',
    context: { roles },
  });
}

async function call(method, url, payload) {
  return admin.inject({
    method,
    url,
    headers: {
      'x-test-role': 'admin',
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

/** A request to the inviter's API as `username`, from the portal's own page unless told otherwise. */
function invite(method, url, payload, { as = 'coord', headers = {} } = {}) {
  return inviterApp.inject({
    method,
    url,
    headers: {
      'x-test-inviter': as,
      host: PORTAL,
      'sec-fetch-site': 'same-origin',
      ...(method !== 'GET' ? { origin: `https://${PORTAL}` } : {}),
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

/** Accept a link's token on `host`. */
function accept(body, host = PORTAL) {
  return admin.inject({
    method: 'POST',
    url: '/api/invite/accept',
    headers: { 'content-type': 'application/json', host },
    payload: JSON.stringify(body),
  });
}

function lookup(token, host = PORTAL) {
  return admin.inject({
    method: 'POST',
    url: '/api/invite/lookup',
    headers: { 'content-type': 'application/json', host },
    payload: JSON.stringify({ token }),
  });
}

const tokenOf = (url) => /#([a-f0-9]{64})$/.exec(url)?.[1];

async function enable(overrides = {}) {
  const res = await call('PUT', '/api/plugins/corral/invitation-policy', {
    enabled: true,
    emailDomains: ['client.test'],
    ...overrides,
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

async function makeInvitation(email = 'ayse@client.test', role = 'viewer', as = 'coord') {
  const res = await invite('POST', '/api/delegated-invitations/corral', { email, role }, { as });
  assert.equal(res.statusCode, 201, res.body);
  return { ...res.json(), token: tokenOf(res.json().inviteUrl) };
}

async function seedLegacy(rows) {
  await writeFile(path.join(stateDir, 'invitations.json'), JSON.stringify(rows));
  return lib.importLegacyInvitations();
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-delegated-'));
  stateDir = path.join(dir, 'state');
  await mkdir(stateDir);
  usersFile = path.join(dir, 'users.yml');
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_PKI_DIR = path.join(stateDir, 'pki');
  process.env.LAMALIBRE_LAMASTE_CONFIG = path.join(stateDir, 'panel.json');
  await writeFile(
    process.env.LAMALIBRE_LAMASTE_CONFIG,
    JSON.stringify({
      ip: '203.0.113.10',
      domain: D,
      email: `ops@${D}`,
      dataDir: stateDir,
      onboarding: { status: 'COMPLETED' },
    }),
  );
  await writeFile(
    usersFile,
    yaml.dump({
      users: {
        admin: person('Admin', `admin@${D}`, ['admins']),
        coord: person('Coordinator Kaya', 'coord@client.test'),
        viewer1: person('Viewer One', 'viewer1@client.test'),
      },
    }),
    { mode: 0o660 },
  );

  lib = {
    ...(await import('../src/lib/state-db.js')),
    ...(await import('../src/lib/config.js')),
    ...(await import('../src/lib/authelia.js')),
    ...(await import('../src/lib/gatekeeper-client.js')),
    ...(await import('../src/lib/directory.js')),
    ...(await import('../src/lib/domains.js')),
    ...(await import('../src/lib/audience.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/notifications.js')),
    ...(await import('../src/lib/plugins.js')),
    ...(await import('../src/lib/state.js')),
    ...(await import('../src/lib/invitations.js')),
    ...(await import('../src/lib/delegated-invitations.js')),
    ...(await import('../src/lib/invitation-acceptance.js')),
  };
  await lib.loadConfig();
  lib.setAutheliaForTests({
    domainAccess: async () => ({ changed: false }),
    usersFile,
    restart: async () => {},
    writeTotp: async () => {},
    userStorage: createFakeAutheliaStorage().storage,
  });
  lib.setInvitationSurfaceForTests(async () => surface);
  await lib.ensurePrimaryDomain();
  gatekeeper = installFakeGatekeeper(lib);
  await lib.writePlugins({
    plugins: [
      {
        name: 'corral',
        route: 'corral',
        displayName: 'Corral',
        packageName: '@lamalibre/corral-server',
        version: '0.2.0',
        capabilities: [],
        hosting: 'agent',
        agent: {},
        identity: IDENTITY,
        status: 'enabled',
        installedAt: '2026-10-28T00:00:00.000Z',
      },
    ],
  });
  await lib.reconcileDirectory({ confirmDelayMs: 0 });
  // The coordinator: a member of the domain, entitled with the inviting role.
  entitle('coord', ['coordinator']);
  entitle('viewer1', ['viewer']);
  await lib.recomputeAudiences({ logger });

  const { default: Fastify } = await import('fastify');
  const { default: errors } = await import('../src/middleware/errors.js');
  admin = Fastify({ logger: false });
  await admin.register(errors);
  admin.decorateRequest('certRole', null);
  admin.addHook('onRequest', async (request) => {
    request.certRole = request.headers['x-test-role'] ?? 'unknown';
  });
  admin.decorate('requireRole', (roles) => async (request, reply) => {
    if (request.certRole === 'admin' || roles.includes(request.certRole)) return;
    return reply.code(403).send({ error: 'forbidden' });
  });
  const { default: invitationRoutes } = await import('../src/routes/management/invitations.js');
  await admin.register(invitationRoutes, { prefix: '/api' });
  const { default: inviteRoutes } = await import('../src/routes/invite.js');
  await admin.register(inviteRoutes, { prefix: '/api/invite' });
  await admin.ready();

  const { resolveUserCaller } = await import('../src/lib/user-caller.js');
  const { default: delegatedInvitationsContext } =
    await import('../src/routes/delegated-invitations.js');
  inviterApp = Fastify({ logger: false });
  await inviterApp.register(delegatedInvitationsContext, {
    // Gatekeeper's assertion stood in for: the header names the user, the
    // URL the route; an absent header is no assertion at all.
    verifyRelay: async (request) => {
      const username = request.headers['x-test-inviter'];
      if (typeof username !== 'string' || username === '') return { ok: false, reason: 'missing' };
      const route = /^\/api\/delegated-invitations\/([a-z0-9-]+)/.exec(request.url)?.[1];
      return { ok: true, username, route, domain: request.headers['x-test-domain'] ?? D };
    },
    // The identity feed's readiness is not under test here: the directory
    // and the audience are, as resolveUserCaller reads them past it.
    resolveUserCaller: async (route, username) => {
      const user = await lib.findDirectoryUser(username);
      if (!user) return { ok: false, status: 403, error: 'This user may not use this plugin' };
      if (user.status !== 'active')
        return { ok: false, status: 403, error: 'This user is disabled' };
      const row = await lib.readAudienceRow('corral', user.userId);
      const member = row?.change?.kind === 'upsert' ? row.change.member : null;
      if (!member || member.status !== 'active') {
        return { ok: false, status: 403, error: 'This user may not use this plugin' };
      }
      void resolveUserCaller;
      return {
        ok: true,
        caller: { type: 'user', userId: user.userId, username, roles: member.roles },
      };
    },
  });
  await inviterApp.ready();
});

after(async () => {
  await lib.invitationSweepsIdle();
  await lib.identityIdle?.();
  lib.setInvitationSurfaceForTests(null);
  lib.setAutheliaForTests(null);
  lib.setGatekeeperClientForTests(null);
  await admin?.close();
  await inviterApp?.close();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  surface = { ok: true, site: SITE, domain: D };
});

// ---------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------

test('the policy: off by default; enabling needs an e-mail domain and a restricted web surface of its own', async () => {
  const off = (await call('GET', '/api/plugins/corral/invitation-policy')).json();
  assert.equal(off.enabled, false);
  assert.deepEqual(off.invitingRoles, [{ role: 'coordinator', invites: ['viewer'] }]);

  const noDomains = await call('PUT', '/api/plugins/corral/invitation-policy', {
    enabled: true,
    emailDomains: [],
  });
  assert.equal(noDomains.statusCode, 400);
  assert.equal(noDomains.json().code, 'invalid_policy');

  surface = { ok: false, reason: 'surface_not_restricted' };
  const unavailable = await call('PUT', '/api/plugins/corral/invitation-policy', {
    enabled: true,
    emailDomains: ['client.test'],
  });
  assert.equal(unavailable.statusCode, 409);
  assert.equal(unavailable.json().code, 'invitations_unavailable');
  assert.match(unavailable.json().error, /not restricted/);
  surface = { ok: true, site: SITE, domain: D };

  const on = await enable({ maxOpenPerInviter: 3, lifetimeDays: 5 });
  assert.equal(on.enabled, true);
  assert.deepEqual(on.emailDomains, ['client.test']);
  assert.equal(on.maxOpenPerInviter, 3);
  assert.equal(on.maxJoined, 50);
  assert.equal(on.available, true);
  const [audited] = await lib.listAudit({ action: 'invitation.policy.updated' });
  assert.equal(audited.plugin, 'corral');
  assert.equal(audited.details.enabled, true);
  assert.equal((await call('GET', '/api/plugins/nope/invitation-policy')).statusCode, 404);
});

// ---------------------------------------------------------------------------
// The inviter's API
// ---------------------------------------------------------------------------

test('the inviter API: only its own page, a vouched-for user of the plugin, on the plugin’s domain', async () => {
  await enable({ maxOpenPerInviter: 3 });
  const path_ = '/api/delegated-invitations/corral';
  assert.equal(
    (await invite('GET', path_, undefined, { headers: { 'sec-fetch-site': 'cross-site' } }))
      .statusCode,
    403,
  );
  // Another host under the domain — the plugin's own site — is same-site:
  // its requests are refused, whatever the cookie.
  const sameSite = await invite(
    'POST',
    path_,
    { email: 'x@client.test', role: 'viewer' },
    { headers: { 'sec-fetch-site': 'same-site' } },
  );
  assert.equal(sameSite.statusCode, 403);
  const fromPluginSite = await invite(
    'POST',
    path_,
    { email: 'x@client.test', role: 'viewer' },
    { headers: { origin: `https://${SITE.fqdn}` } },
  );
  assert.equal(fromPluginSite.statusCode, 403);
  assert.equal(fromPluginSite.json().error, 'cross-origin request refused');
  // A typed-in read is fine; a typed-in change is not.
  assert.equal(
    (await invite('GET', path_, undefined, { headers: { 'sec-fetch-site': 'none' } })).statusCode,
    200,
  );
  assert.equal(
    (
      await invite(
        'POST',
        path_,
        { email: 'x@client.test', role: 'viewer' },
        { headers: { 'sec-fetch-site': 'none' } },
      )
    ).statusCode,
    403,
  );
  assert.equal((await invite('GET', path_, undefined, { as: '' })).statusCode, 401);
  // An assertion for another domain's portal.
  assert.equal(
    (await invite('GET', path_, undefined, { headers: { 'x-test-domain': 'other.test' } }))
      .statusCode,
    404,
  );
  // Somebody the plugin does not know.
  assert.equal((await invite('GET', path_, undefined, { as: 'admin' })).statusCode, 403);

  const view = await invite('GET', path_);
  assert.equal(view.statusCode, 200, view.body);
  assert.equal(view.headers['cache-control'], 'no-store');
  assert.deepEqual(view.json().plugin, { displayName: 'Corral', siteUrl: `https://${SITE.fqdn}/` });
  assert.deepEqual(view.json().policy.grantableRoles, [{ id: 'viewer', label: 'İzleyici' }]);
  // A viewer may give nothing.
  assert.deepEqual(
    (await invite('GET', path_, undefined, { as: 'viewer1' })).json().policy.grantableRoles,
    [],
  );

  surface = { ok: false, reason: 'surface_not_served' };
  assert.equal((await invite('GET', path_)).json().code, 'invitations_unavailable');
});

test('an inviter gives only what their roles may, to the allowed domains, within the caps', async () => {
  await enable({ maxOpenPerInviter: 2, maxJoined: 4 });
  const p = '/api/delegated-invitations/corral';
  const editor = await invite('POST', p, { email: 'e@client.test', role: 'editor' });
  assert.equal(editor.statusCode, 403);
  assert.equal(editor.json().code, 'role_not_grantable');
  assert.equal(
    (await invite('POST', p, { email: 'e@client.test', role: 'coordinator' })).json().code,
    'role_not_grantable',
  );
  const elsewhere = await invite('POST', p, { email: 'e@elsewhere.test', role: 'viewer' });
  assert.equal(elsewhere.statusCode, 400);
  assert.equal(elsewhere.json().code, 'email_domain_not_allowed');
  // A request names nothing but an address, a name and a role.
  const extra = await invite('POST', p, {
    email: 'e@client.test',
    role: 'viewer',
    groups: ['admins'],
  });
  assert.equal(extra.statusCode, 400);
  assert.equal(
    (await invite('POST', p, { email: 'e@client.test', role: 'viewer' }, { as: 'viewer1' })).json()
      .code,
    'role_not_grantable',
  );

  const first = await makeInvitation('one@client.test');
  assert.match(
    first.inviteUrl,
    new RegExp(`^https://${PORTAL.replace(/\./g, '\\.')}/invite#[a-f0-9]{64}$`),
  );
  assert.equal(first.invitation.role, 'viewer');
  assert.equal(first.invitation.status, 'pending');
  const stored = await lib.getInvitation(first.invitation.id);
  assert.equal(stored.kind, 'delegated');
  assert.deepEqual(stored.domains, [{ name: D, kind: 'external' }]);
  assert.deepEqual(stored.groups, []);
  assert.equal(stored.siteId, SITE.id);
  // The token is nowhere at rest.
  const db = await lib.getStateDb();
  const dump = JSON.stringify(db.prepare('SELECT * FROM invitations').all());
  assert.equal(dump.includes(first.token), false);

  await makeInvitation('two@client.test');
  const capped = await invite('POST', p, { email: 'three@client.test', role: 'viewer' });
  assert.equal(capped.statusCode, 409);
  assert.deepEqual([capped.json().code, capped.json().cap], ['invitation_cap', 'inviter']);

  const [made] = await lib.listAudit({ action: 'invitation.created' });
  assert.equal(made.actor, `user:${await idOf('coord')}`);
  assert.equal(made.details.emailDomain, 'client.test');
  assert.equal(JSON.stringify(made).includes('two@client.test'), false, 'no address audited');

  // Revoking one's own; another's is not told apart from none.
  const own = (await invite('GET', p)).json().invitations;
  const target = own.find((i) => i.email === 'two@client.test');
  assert.equal(
    (await invite('DELETE', `${p}/${target.id}`, undefined, { as: 'viewer1' })).statusCode,
    404,
  );
  assert.equal((await invite('DELETE', `${p}/${target.id}`)).statusCode, 200);
  assert.equal((await lib.getInvitation(target.id)).revokedReason, 'inviter');
  assert.equal((await invite('DELETE', `${p}/${target.id}`)).statusCode, 404);

  // The plugin's whole intake: open ones count with those who joined (one
  // open now).
  await enable({ maxOpenPerInviter: 10, maxJoined: 1 });
  const pluginCap = await invite('POST', p, { email: 'four@client.test', role: 'viewer' });
  assert.deepEqual([pluginCap.json().code, pluginCap.json().cap], ['invitation_cap', 'plugin']);

  // Gatekeeper short of free grants: none made.
  await enable({ maxOpenPerInviter: 10, maxJoined: 50 });
  gatekeeper.state.maxGrants = gatekeeper.grants.length + 50;
  const reserve = await invite('POST', p, { email: 'five@client.test', role: 'viewer' });
  assert.equal(reserve.statusCode, 503);
  assert.equal(reserve.json().code, 'grant_reserve');
  gatekeeper.state.maxGrants = 1000;
});

// ---------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------

test('a link opens only on its own domain’s sign-in host, and tells its holder no sign-in name', async () => {
  await enable();
  const { token } = await makeInvitation('host@client.test');
  assert.equal((await lookup(token, 'auth.other.test')).statusCode, 404);
  assert.equal((await lookup(token, `panel.${D}`)).statusCode, 404);
  assert.equal((await lookup(token, `${PORTAL}:443`)).statusCode, 200);
  const shown = (await lookup(token)).json();
  assert.equal(shown.kind, 'delegated');
  assert.equal(shown.plugin, 'Corral');
  assert.equal(shown.role, 'İzleyici');
  assert.equal(shown.invitedBy, 'Coordinator Kaya');
  assert.equal(shown.suggestedUsername, 'host');
  assert.equal(JSON.stringify(shown).includes('coord"'), false);
  assert.equal((await lookup('0'.repeat(64))).statusCode, 404);
  assert.equal(
    (
      await accept(
        { token, username: 'host', displayName: 'H', password: PASSWORD },
        'auth.other.test',
      )
    ).statusCode,
    404,
  );
});

test('an invitee’s username may be nothing anything names — a grant for “a user still to come” included — and five refusals lock the link', async () => {
  await enable({ maxOpenPerInviter: 10 });
  const { token, invitation } = await makeInvitation('vet@client.test');
  // A grant made under a username nobody holds yet (Gatekeeper's CLI, the proxy).
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'futureuser',
    resourceType: 'tunnel',
    resourceId: 'secret-tunnel',
  });
  await writeFile(
    path.join(stateDir, 'sites.json'),
    JSON.stringify([{ id: 'docs', name: 'docs', fqdn: `docs.${D}`, allowedUsers: ['listed'] }]),
  );
  for (const username of ['futureuser', 'listed', 'coord', 'viewer1']) {
    const res = await accept({ token, username, displayName: 'V', password: PASSWORD });
    assert.equal(res.statusCode, 409, `${username}: ${res.body}`);
    assert.equal(res.json().code, 'username_unavailable', username);
  }
  assert.equal((await usersNow()).futureuser, undefined, 'nothing was created');
  assert.equal((await lib.getInvitation(invitation.id)).status, 'pending');
  assert.equal((await lib.getInvitation(invitation.id)).failedAttempts, 4);
  const fifth = await accept({
    token,
    username: 'futureuser',
    displayName: 'V',
    password: PASSWORD,
  });
  assert.equal(fifth.statusCode, 409);
  const locked = await lib.getInvitation(invitation.id);
  assert.equal(locked.status, 'revoked');
  assert.equal(locked.revokedReason, 'attempts_exhausted');
  assert.equal(
    (await accept({ token, username: 'fresh', displayName: 'V', password: PASSWORD })).statusCode,
    410,
  );
  await writeFile(path.join(stateDir, 'sites.json'), '[]');
});

test('accepted: an external member of the plugin’s domain, one role, the site grant, no Authelia group — audited and notified', async () => {
  await enable({ maxOpenPerInviter: 10 });
  const { token, invitation } = await makeInvitation('ayse@client.test');
  const res = await accept({
    token,
    username: 'ayse',
    displayName: 'Ayşe Yılmaz',
    password: PASSWORD,
  });
  assert.equal(res.statusCode, 200, res.body);
  const answer = res.json();
  assert.equal(answer.username, 'ayse');
  assert.equal(answer.loginUrl, `https://${SITE.fqdn}/`);
  assert.equal(answer.accessPending, false);
  assert.match(answer.totpQr, /^data:image\/svg\+xml;base64,/);

  const entry = (await usersNow()).ayse;
  assert.deepEqual(
    entry.groups.filter((g) => !g.startsWith('lamaste:')),
    [],
    'no Authelia group',
  );
  assert.equal(entry.displayname, 'Ayşe Yılmaz');
  const userId = await idOf('ayse');
  assert.deepEqual(await lib.domainsOfUser(userId), [{ name: D, kind: 'external' }]);
  const held = gatekeeper.grants.filter((g) => g.principalId === 'ayse');
  assert.deepEqual(
    held.map((g) => [g.resourceType, g.resourceId, JSON.stringify(g.context)]).sort(),
    [
      ['plugin', 'corral', '{"roles":["viewer"]}'],
      ['site', SITE.id, '{}'],
    ],
  );
  const recorded = await lib.getInvitation(invitation.id);
  assert.equal(recorded.status, 'accepted');
  assert.equal(recorded.acceptedUserId, userId);
  assert.equal(recorded.email, null, 'the directory holds the address now');
  assert.ok(recorded.roleGrantedAt && recorded.siteGrantedAt && recorded.renderedAt);
  await lib.recomputeAudiences({ logger });
  const row = await lib.readAudienceRow('corral', userId);
  assert.deepEqual(
    row.change.member.roles,
    ['viewer'],
    'the plugin learns of them through its feed',
  );

  const [audited] = await lib.listAudit({ action: 'invitation.accepted' });
  assert.equal(audited.plugin, 'corral');
  assert.equal(audited.details.userId, userId);
  assert.equal(audited.details.inviterUserId, await idOf('coord'));
  const { notifications: notes } = await lib.listNotifications({});
  assert.ok(notes.some((n) => /joined plugin "corral" by invitation/.test(n.message)));

  // The same link again.
  assert.equal(
    (await accept({ token, username: 'ayse2', displayName: 'A', password: PASSWORD })).statusCode,
    410,
  );
  // Listed for the administrator with its inviter.
  const listed = (
    await call('GET', `/api/invitations?plugin=corral&inviter=${await idOf('coord')}`)
  ).json().invitations;
  const shown = listed.find((i) => i.id === invitation.id);
  assert.deepEqual(shown.inviter, { userId: await idOf('coord'), username: 'coord' });
  assert.equal(shown.status, 'accepted');
  assert.equal(shown.fulfilled, true);
});

// ---------------------------------------------------------------------------
// Claims, recovery, races
// ---------------------------------------------------------------------------

test('a crash between the users file and the directory never makes the invitee a member — recovery finds them by their invitation', async () => {
  await enable({ maxOpenPerInviter: 10 });
  const { invitation } = await makeInvitation('crash@client.test');
  const claimId = await lib.claimInvitation(invitation.id, 'corral', 'crash');
  // The acceptance wrote users.yml, then the process died.
  const users = yaml.load(await readFile(usersFile, 'utf-8'));
  users.users.crash = person('Crash', 'crash@client.test');
  await writeFile(usersFile, yaml.dump(users));
  // The next reconcile adopts the user: as the invitation's external member,
  // never with the one-domain relay's default (member).
  await lib.reconcileDirectory({ confirmDelayMs: 0 });
  const userId = await idOf('crash');
  assert.deepEqual(await lib.domainsOfUser(userId), [{ name: D, kind: 'external' }]);
  assert.equal((await lib.directoryUserOfInvitation(invitation.id)).userId, userId);

  // Not stale yet: left alone.
  await lib.resolveStaleClaims({ logger });
  assert.equal((await lib.getInvitation(invitation.id)).claimId, claimId);
  const db = await lib.getStateDb();
  db.prepare('UPDATE invitations SET status_at = ? WHERE id = ?').run(
    new Date(Date.now() - 11 * 60_000).toISOString(),
    invitation.id,
  );
  await lib.resolveStaleClaims({ logger });
  const settled = await lib.getInvitation(invitation.id);
  assert.equal(settled.status, 'accepted');
  assert.equal(settled.acceptedUserId, userId);
  // Its grants come from the repair.
  await lib.repairAcceptances({ logger });
  assert.ok((await lib.getInvitation(invitation.id)).siteGrantedAt);
  assert.ok(gatekeeper.grants.some((g) => g.principalId === 'crash' && g.resourceType === 'site'));
});

test('a stale claim with no user goes back to pending; an acceptance queued behind the users lock finds its claim gone and makes nothing', async () => {
  await enable({ maxOpenPerInviter: 10 });
  const { token, invitation } = await makeInvitation('race@client.test');
  const { withUsersLock } = await import('../src/lib/users-lock.js');
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const holding = withUsersLock(() => held);
  const accepting = accept({ token, username: 'racer', displayName: 'R', password: PASSWORD });
  // Wait for its claim, then take it away as recovery would.
  let claim = null;
  for (let i = 0; i < 100 && !claim; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const now = await lib.getInvitation(invitation.id);
    if (now.status === 'accepting') claim = now.claimId;
  }
  assert.ok(claim, 'the acceptance claimed it');
  await lib.releaseClaim(invitation.id, 'corral', claim);
  release();
  await holding;
  const res = await accepting;
  assert.equal(res.statusCode, 410, res.body);
  assert.equal((await usersNow()).racer, undefined, 'no account');
  assert.equal((await lib.getInvitation(invitation.id)).status, 'pending');

  // And a stale claim nobody completed: pending again.
  await lib.claimInvitation(invitation.id, 'corral', 'nobody');
  const db = await lib.getStateDb();
  db.prepare('UPDATE invitations SET status_at = ? WHERE id = ?').run(
    new Date(Date.now() - 11 * 60_000).toISOString(),
    invitation.id,
  );
  await lib.resolveStaleClaims({ logger });
  const back = await lib.getInvitation(invitation.id);
  assert.equal(back.status, 'pending');
  assert.equal(back.username, null);
});

test('one username, one open invitation: two claims of a name never both hold, and an administrator cannot take a claimed one', async () => {
  await enable({ maxOpenPerInviter: 10 });
  const a = await makeInvitation('a@client.test');
  const b = await makeInvitation('b@client.test');
  await lib.claimInvitation(a.invitation.id, 'corral', 'samename');
  await assert.rejects(lib.claimInvitation(b.invitation.id, 'corral', 'samename'), (err) => {
    assert.equal(err.code, 'username_unavailable');
    return true;
  });
  // The users API (an administrator creating "samename") is refused too.
  await assert.rejects(
    lib.changeUsers(async () => {}, { actor: 'admin', creates: ['samename'], logger }),
    (err) => err.code === 'username_invited',
  );
  // An administrator's pending invitation names its username: a delegated invitee may not take it.
  await seedLegacy([
    {
      id: 'adm-1',
      token: 'a1'.repeat(32),
      username: 'reserved',
      email: 'r@x.test',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      used: false,
    },
  ]);
  const res = await accept({
    token: b.token,
    username: 'reserved',
    displayName: 'R',
    password: PASSWORD,
  });
  assert.equal(res.json().code, 'username_unavailable');
  const claim = (await lib.getInvitation(a.invitation.id)).claimId;
  await lib.releaseClaim(a.invitation.id, 'corral', claim);
});

// ---------------------------------------------------------------------------
// Revocations and sweeps
// ---------------------------------------------------------------------------

test('sweeps: an inviter who lost the role, a removed e-mail domain, the policy off, a shorter lifetime; one being accepted is marked, not revoked', async () => {
  await enable({ maxOpenPerInviter: 20, lifetimeDays: 10 });
  const lost = await makeInvitation('lost@client.test');
  const accepting = await makeInvitation('acc@client.test');
  await lib.claimInvitation(accepting.invitation.id, 'corral', 'accname');

  // The coordinator becomes a viewer: their open invitations end; their
  // invitees (accepted earlier) keep access.
  const coordGrant = gatekeeper.grants.find(
    (g) => g.principalId === 'coord' && g.resourceType === 'plugin',
  );
  coordGrant.context = { roles: ['viewer'] };
  await lib.recomputeAudiences({ logger });
  await lib.invitationSweepsIdle();
  assert.equal((await lib.getInvitation(lost.invitation.id)).revokedReason, 'inviter_unentitled');
  const marked = await lib.getInvitation(accepting.invitation.id);
  assert.equal(marked.status, 'accepting');
  assert.equal(marked.revokePendingReason, 'inviter_unentitled');
  assert.ok(
    gatekeeper.grants.some((g) => g.principalId === 'ayse'),
    'an earlier invitee keeps access',
  );
  coordGrant.context = { roles: ['coordinator'] };
  await lib.recomputeAudiences({ logger });
  await lib.invitationSweepsIdle();
  await lib.releaseClaim(accepting.invitation.id, 'corral', marked.claimId);

  // A shorter lifetime, then the domain gone from the policy, then the policy off.
  const domain = await makeInvitation('dom@client.test');
  const fresh = await makeInvitation('life@client.test');
  await enable({ maxOpenPerInviter: 20, lifetimeDays: 1 });
  const shortened = await lib.getInvitation(fresh.invitation.id);
  assert.ok(Date.parse(shortened.expiresAt) <= Date.parse(shortened.createdAt) + 86_400_000);
  await enable({ emailDomains: ['other.test'] });
  assert.equal(
    (await lib.getInvitation(domain.invitation.id)).revokedReason,
    'email_domain_removed',
  );
  await enable({ emailDomains: ['client.test'] });
  const last = await makeInvitation('off@client.test');
  await call('PUT', '/api/plugins/corral/invitation-policy', {
    enabled: false,
    emailDomains: ['client.test'],
  });
  assert.equal((await lib.getInvitation(last.invitation.id)).revokedReason, 'policy_disabled');
  // The web surface gone.
  await enable();
  const site = await makeInvitation('site@client.test');
  surface = { ok: false, reason: 'no_web_surface' };
  await lib.sweepPluginInvitations('corral', { logger });
  assert.equal((await lib.getInvitation(site.invitation.id)).revokedReason, 'surface_removed');
  const audited = await lib.listAudit({ action: 'invitation.revoked', limit: 50 });
  assert.ok(audited.some((a) => a.details.reason === 'policy_disabled' && a.actor === 'lamaste'));
});

test('an administrator revokes any pending invitation, marks one being accepted (202), deletes an ended one', async () => {
  await enable({ maxOpenPerInviter: 20 });
  const pending = await makeInvitation('adm1@client.test');
  const res = await call('DELETE', `/api/invitations/${pending.invitation.id}`);
  assert.deepEqual(res.json(), { ok: true, action: 'revoked' });
  assert.equal((await lib.getInvitation(pending.invitation.id)).revokedReason, 'admin');
  assert.deepEqual((await call('DELETE', `/api/invitations/${pending.invitation.id}`)).json(), {
    ok: true,
    action: 'deleted',
  });
  const busy = await makeInvitation('adm2@client.test');
  const claimId = await lib.claimInvitation(busy.invitation.id, 'corral', 'adm2name');
  const markedRes = await call('DELETE', `/api/invitations/${busy.invitation.id}`);
  assert.equal(markedRes.statusCode, 202);
  assert.equal((await lib.getInvitation(busy.invitation.id)).revokePendingReason, 'admin');
  // Its acceptance then ends revoked with that reason, the user reaching nothing.
  const ended = await lib.finishClaim(busy.invitation.id, 'corral', claimId, await idOf('viewer1'));
  assert.equal(ended.status, 'revoked');
  assert.equal(ended.revokedReason, 'admin');
});

test('a grant made after a revocation landed never lands: the precondition runs before each grant', async () => {
  await enable({ maxOpenPerInviter: 20 });
  const { token, invitation } = await makeInvitation('late@client.test');
  // The policy is turned off while the user is being written.
  const { withUsersLock } = await import('../src/lib/users-lock.js');
  void withUsersLock;
  const original = lib.setInvitationSurfaceForTests;
  let calls = 0;
  original(async () => {
    calls += 1;
    // The claim's check passes; from the first grant on, the surface is gone.
    return calls <= 1
      ? { ok: true, site: SITE, domain: D }
      : { ok: false, reason: 'no_web_surface' };
  });
  const res = await accept({ token, username: 'late', displayName: 'L', password: PASSWORD });
  original(async () => surface);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().accessPending, true);
  const recorded = await lib.getInvitation(invitation.id);
  assert.equal(recorded.status, 'revoked');
  assert.equal(recorded.revokedReason, 'surface_removed');
  assert.equal(
    gatekeeper.grants.some((g) => g.principalId === 'late'),
    false,
    'nothing granted',
  );
});

// ---------------------------------------------------------------------------
// Repair, disabling invitees, the import
// ---------------------------------------------------------------------------

test('the repair only creates what is missing: an administrator’s change stands, and a lost site attempt is not repeated', async () => {
  await enable({ maxOpenPerInviter: 20 });
  // Accepted, but its site grant's answer lost and an administrator since
  // revoked the role: the repair gives up rather than undo them.
  const a = await makeInvitation('rep1@client.test');
  const resA = await accept({
    token: a.token,
    username: 'rep1',
    displayName: 'R',
    password: PASSWORD,
  });
  assert.equal(resA.statusCode, 200, resA.body);
  const db = await lib.getStateDb();
  db.prepare('UPDATE invitations SET site_granted_at = NULL WHERE id = ?').run(a.invitation.id);
  const siteGrant = gatekeeper.grants.findIndex(
    (g) => g.principalId === 'rep1' && g.resourceType === 'site',
  );
  gatekeeper.grants.splice(siteGrant, 1);
  await lib.repairAcceptances({ logger });
  const abandoned = await lib.getInvitation(a.invitation.id);
  assert.equal(abandoned.revokedReason, 'repair_abandoned');
  assert.equal(
    gatekeeper.grants.some((g) => g.principalId === 'rep1' && g.resourceType === 'site'),
    false,
  );

  // Accepted, the role grant not recorded and an administrator gave them
  // another role meanwhile: the repair never replaces it.
  const b = await makeInvitation('rep2@client.test');
  await accept({ token: b.token, username: 'rep2', displayName: 'R', password: PASSWORD });
  db.prepare('UPDATE invitations SET role_granted_at = NULL WHERE id = ?').run(b.invitation.id);
  const roleGrant = gatekeeper.grants.find(
    (g) => g.principalId === 'rep2' && g.resourceType === 'plugin',
  );
  roleGrant.context = { roles: ['editor'] };
  await lib.repairAcceptances({ logger });
  assert.deepEqual(
    gatekeeper.grants
      .filter((g) => g.principalId === 'rep2' && g.resourceType === 'plugin')
      .map((g) => g.context),
    [{ roles: ['editor'] }],
  );
  assert.ok((await lib.getInvitation(b.invitation.id)).roleGrantedAt);
});

test('disabling everyone a person invited — transitively — through the usual offboarding', async () => {
  await enable({ maxOpenPerInviter: 20 });
  // coord → inv1 (a coordinator) → inv2.
  const plugin = await lib.findPlugin('corral');
  void plugin;
  const first = await invite('POST', '/api/delegated-invitations/corral', {
    email: 'inv1@client.test',
    role: 'viewer',
  });
  const t1 = tokenOf(first.json().inviteUrl);
  await accept({ token: t1, username: 'inv1', displayName: 'I1', password: PASSWORD });
  entitle('inv1', ['coordinator']);
  // Their own role grant, replaced by an administrator's coordinator grant.
  const plain = gatekeeper.grants.findIndex(
    (g) =>
      g.principalId === 'inv1' && g.resourceType === 'plugin' && g.context.roles?.[0] === 'viewer',
  );
  gatekeeper.grants.splice(plain, 1);
  await lib.recomputeAudiences({ logger });
  const second = await invite(
    'POST',
    '/api/delegated-invitations/corral',
    { email: 'inv2@client.test', role: 'viewer' },
    { as: 'inv1' },
  );
  assert.equal(second.statusCode, 201, second.body);
  await accept({
    token: tokenOf(second.json().inviteUrl),
    username: 'inv2',
    displayName: 'I2',
    password: PASSWORD,
  });

  const direct = await call('POST', '/api/invitations/disable-invitees', {
    inviterUserId: await idOf('inv1'),
  });
  assert.deepEqual(direct.json().disabled, [await idOf('inv2')]);
  assert.equal((await usersNow()).inv2.disabled, true);
  assert.equal((await usersNow()).inv1.disabled, undefined);
  await call('PUT', '/api/users/inv2', { disabled: false }).catch(() => {});
  const users = yaml.load(await readFile(usersFile, 'utf-8'));
  delete users.users.inv2.disabled;
  await writeFile(usersFile, yaml.dump(users));
  await lib.reconcileDirectory({ confirmDelayMs: 0 });

  const transitive = await call('POST', '/api/invitations/disable-invitees', {
    inviterUserId: await idOf('coord'),
    transitive: true,
  });
  const disabled = new Set(transitive.json().disabled);
  assert.ok(disabled.has(await idOf('inv1')));
  assert.ok(disabled.has(await idOf('inv2')));
  assert.equal(disabled.has(await idOf('coord')), false);
  assert.equal((await lib.getDirectoryUser(await idOf('inv1'))).status, 'disabled');
  const [audited] = await lib.listAudit({ action: 'invitation.invitees.disabled' });
  assert.equal(audited.details.transitive, true);
});

test('invitations.json: imported whenever it exists, by id, never over a row state.db holds; tokens hashed; the file deleted', async () => {
  const now = Date.now();
  const rows = [
    {
      id: 'old-1',
      token: 'c'.repeat(64),
      username: 'dup',
      email: 'd1@x.test',
      createdAt: new Date(now - 5000).toISOString(),
      expiresAt: new Date(now + 86_400_000).toISOString(),
      used: false,
    },
    {
      id: 'old-2',
      token: 'd'.repeat(64),
      username: 'dup',
      email: 'd2@x.test',
      createdAt: new Date(now - 9000).toISOString(),
      expiresAt: new Date(now + 86_400_000).toISOString(),
      used: false,
    },
    {
      id: 'old-3',
      token: 'e'.repeat(64),
      username: 'viewer1',
      email: 'v@x.test',
      createdAt: new Date(now - 9000).toISOString(),
      used: true,
      acceptedAt: new Date(now - 8000).toISOString(),
    },
    { id: 'bad', token: 'not-a-token', username: 'x', email: 'x@x.test' },
  ];
  assert.equal(await seedLegacy(rows), 3);
  await assert.rejects(readFile(path.join(stateDir, 'invitations.json')), { code: 'ENOENT' });
  const one = await lib.getInvitation('old-1');
  const two = await lib.getInvitation('old-2');
  assert.equal(one.status, 'pending', 'the newest of two for one username stays open');
  assert.equal(two.revokedReason, 'superseded');
  const accepted = await lib.getInvitation('old-3');
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.acceptedUserId, await idOf('viewer1'));
  // A restored backup brings the file back: nothing already held is touched.
  await lib.revokeOrDeleteInvitation('old-1');
  assert.equal(await seedLegacy(rows), 0);
  assert.equal((await lib.getInvitation('old-1')).status, 'revoked');
  // A 4.8 link still opens and accepts by its token in the body.
  const res = await admin.inject({
    method: 'POST',
    url: '/api/invite/lookup',
    headers: { 'content-type': 'application/json', host: `panel.${D}` },
    payload: JSON.stringify({ token: 'c'.repeat(64) }),
  });
  assert.equal(res.statusCode, 410, 'revoked now');
});
