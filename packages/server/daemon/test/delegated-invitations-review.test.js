/**
 * What the code review of delegated invitations found (the design's "Code
 * review" table): a revocation during an acceptance is never undone and
 * leaves nothing that works, one audit entry per transition, the inviter
 * must still reach the site, what makes a user stays on record, the repair
 * never undoes anyone, the import happens once. Each test here fails
 * without its fix. Authelia is a users file and a recorder, Gatekeeper a
 * fake, the web surface a stand-in, as in delegated-invitations.test.js.
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
  ],
});
const PLUGIN_ROW = {
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
};

const logged = [];
const logger = {
  info() {},
  warn(...args) {
    logged.push(args);
  },
  error(...args) {
    logged.push(args);
  },
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
let surface;
/** Runs inside each rendering of the domains (`syncDomainAccess`). */
let onRender = null;
let onSurface = null;
let writeTotp = async () => {};
let serial = 0;

const person = (displayname, email, groups = []) => ({
  displayname,
  email,
  password: HASH,
  groups,
});
const usersNow = async () => yaml.load(await readFile(usersFile, 'utf-8')).users;
const idOf = async (username) => (await lib.findDirectoryUser(username))?.userId;
const audited = async (action, id) =>
  (await lib.listAudit({ action, limit: 200 })).filter((a) => a.details.invitationId === id);

function grantRole(username, roles) {
  return gatekeeper.addGrant({
    principalType: 'user',
    principalId: username,
    resourceType: 'plugin',
    resourceId: 'corral',
    context: { roles },
  });
}
const grantSite = (principalId, principalType = 'user') =>
  gatekeeper.addGrant({
    principalType,
    principalId,
    resourceType: 'site',
    resourceId: SITE.id,
    context: {},
  });

function call(method, url, payload) {
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

function invite(method, url, payload, as = 'coord') {
  return inviterApp.inject({
    method,
    url,
    headers: {
      'x-test-inviter': as,
      host: PORTAL,
      'sec-fetch-site': 'same-origin',
      ...(method !== 'GET' ? { origin: `https://${PORTAL}` } : {}),
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

function accept(body, host = PORTAL) {
  return admin.inject({
    method: 'POST',
    url: '/api/invite/accept',
    headers: { 'content-type': 'application/json', host },
    payload: JSON.stringify(body),
  });
}

const tokenOf = (url) => /#([a-f0-9]{64})$/.exec(url)?.[1];

/** A fresh invitation: its id, token and a free username. */
async function made(role = 'viewer', as = 'coord') {
  serial += 1;
  const username = `inv${serial}`;
  const res = await invite(
    'POST',
    '/api/delegated-invitations/corral',
    { email: `${username}@client.test`, role },
    as,
  );
  assert.equal(res.statusCode, 201, res.body);
  return { id: res.json().invitation.id, token: tokenOf(res.json().inviteUrl), username };
}

const acceptAs = ({ token, username }) =>
  accept({ token, username, displayName: 'Davetli Kişi', password: PASSWORD });

async function age(id, ms = 11 * 60 * 1000) {
  const db = await lib.getStateDb();
  db.prepare('UPDATE invitations SET status_at = ? WHERE id = ?').run(
    new Date(Date.now() - ms).toISOString(),
    id,
  );
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-delegated-review-'));
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
        second: person('Second Coordinator', 'second@client.test'),
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
    ...(await import('../src/lib/plugin-operations.js')),
    ...(await import('../src/lib/state.js')),
    ...(await import('../src/lib/invitations.js')),
    ...(await import('../src/lib/delegated-invitations.js')),
    ...(await import('../src/lib/invitation-acceptance.js')),
  };
  await lib.loadConfig();
  lib.setAutheliaForTests({
    domainAccess: async () => {
      await onRender?.();
      return { changed: false };
    },
    usersFile,
    restart: async () => {},
    writeTotp: (...args) => writeTotp(...args),
    userStorage: createFakeAutheliaStorage().storage,
  });
  lib.setInvitationSurfaceForTests(async () => {
    await onSurface?.();
    return surface;
  });
  await lib.ensurePrimaryDomain();
  gatekeeper = installFakeGatekeeper(lib);
  await lib.writePlugins({ plugins: [PLUGIN_ROW] });
  await lib.reconcileDirectory({ confirmDelayMs: 0 });
  grantRole('coord', ['coordinator']);
  grantRole('second', ['coordinator']);
  grantSite('coord');
  grantSite('second');
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
  await admin.register(inviteRoutes, { prefix: '/api/invite', logger });
  await admin.ready();

  const { default: delegatedInvitationsContext } =
    await import('../src/routes/delegated-invitations.js');
  inviterApp = Fastify({ logger: false });
  await inviterApp.register(delegatedInvitationsContext, {
    verifyRelay: async (request) => {
      const username = request.headers['x-test-inviter'];
      if (typeof username !== 'string' || username === '') return { ok: false, reason: 'missing' };
      const route = /^\/api\/delegated-invitations\/([a-z0-9-]+)/.exec(request.url)?.[1];
      return { ok: true, username, route, domain: D };
    },
    resolveUserCaller: async (_route, username) => {
      const user = await lib.findDirectoryUser(username);
      if (!user) return { ok: false, status: 403, error: 'no' };
      return { ok: true, caller: { type: 'user', userId: user.userId, username, roles: [] } };
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

beforeEach(async () => {
  surface = { ok: true, site: SITE, domain: D };
  onRender = null;
  onSurface = null;
  writeTotp = async () => {};
  logged.length = 0;
  lib.setGatekeeperClientForTests(gatekeeper.request);
  gatekeeper.state.unreachable = false;
  // The hourly rate is not under test here, and neither are the caps.
  const db = await lib.getStateDb();
  db.prepare('UPDATE invitations SET created_at = ? WHERE created_at > ?').run(
    new Date(Date.now() - 2 * 3_600_000).toISOString(),
    new Date(Date.now() - 2 * 3_600_000).toISOString(),
  );
  await call('PUT', '/api/plugins/corral/invitation-policy', {
    enabled: true,
    emailDomains: ['client.test'],
    maxOpenPerInviter: 100,
    maxJoined: 500,
    lifetimeDays: 7,
  });
});

// ---------------------------------------------------------------------------
// A revocation during an acceptance
// ---------------------------------------------------------------------------

test('1 — a revocation that landed during an acceptance is never undone: giving the claim up ends the invitation revoked, and the link is dead', async () => {
  const inv = await made();
  const claimId = await lib.claimInvitation(inv.id, 'corral', inv.username);
  assert.equal((await call('DELETE', `/api/invitations/${inv.id}`)).statusCode, 202);
  const released = await lib.releaseClaim(inv.id, 'corral', claimId);
  assert.equal(released.status, 'revoked');
  assert.equal(released.revokedReason, 'admin');
  assert.equal(released.revokedBy, 'admin', 'its author, not Lamaste');
  assert.equal((await acceptAs(inv)).statusCode, 410);
  assert.equal((await usersNow())[inv.username], undefined);
});

test('1 — the same through a stale claim: recovery ends it revoked, audited once, with no account', async () => {
  const inv = await made();
  await lib.claimInvitation(inv.id, 'corral', inv.username);
  await invite('DELETE', `/api/delegated-invitations/corral/${inv.id}`);
  await age(inv.id);
  await lib.resolveStaleClaims({ logger });
  const row = await lib.getInvitation(inv.id);
  assert.equal(row.status, 'revoked');
  assert.equal(row.revokedReason, 'inviter');
  assert.equal(row.revokedBy, `user:${await idOf('coord')}`);
  assert.equal((await acceptAs(inv)).statusCode, 410);
  const revoked = await audited('invitation.revoked', inv.id);
  assert.equal(revoked.length, 1);
  assert.equal(revoked[0].actor, `user:${await idOf('coord')}`);
});

test('1 — a claim that fails after a mark, through the whole acceptance: the answer is a refusal and the link does not come back', async () => {
  const inv = await made();
  // The mark lands while the username is being vetted: Gatekeeper's answer
  // refuses the acceptance after the claim.
  const transport = gatekeeper.request;
  lib.setGatekeeperClientForTests(async (method, apiPath, body) => {
    if (apiPath === '/api/principals/user/inspect') {
      await call('DELETE', `/api/invitations/${inv.id}`);
      return { ok: true, statusCode: 200, data: { ok: true, grants: 1, groups: 0 } };
    }
    return transport(method, apiPath, body);
  });
  const res = await acceptAs(inv);
  lib.setGatekeeperClientForTests(transport);
  assert.equal(res.statusCode, 409, res.body);
  const row = await lib.getInvitation(inv.id);
  assert.equal(row.status, 'revoked');
  assert.equal(row.revokedBy, 'admin');
  assert.equal((await acceptAs(inv)).statusCode, 410);
});

test('2 — a mark that lands after the last grant’s check: the account is disabled, and everyone is told so', async () => {
  const inv = await made();
  onRender = async () => {
    if (
      gatekeeper.grants.some((g) => g.resourceType === 'site' && g.principalId === inv.username)
    ) {
      onRender = null;
      await call('DELETE', `/api/invitations/${inv.id}`);
    }
  };
  const res = await acceptAs(inv);
  assert.equal(res.statusCode, 410, res.body);
  assert.equal(res.json().code, 'invitation_revoked');
  assert.equal(res.json().totpUri, undefined, 'no secret for an account that reaches nothing');
  const row = await lib.getInvitation(inv.id);
  assert.equal(row.status, 'revoked');
  assert.equal(row.revokedBy, 'admin');
  assert.ok(row.acceptedUserId);
  assert.ok(row.accountDisabledAt);
  assert.equal((await usersNow())[inv.username].disabled, true);
  assert.equal((await lib.getDirectoryUser(row.acceptedUserId)).status, 'disabled');
  assert.equal((await audited('invitation.accepted', inv.id)).length, 0);
  const [entry, ...more] = await audited('invitation.revoked', inv.id);
  assert.equal(more.length, 0);
  assert.equal(entry.actor, 'admin');
  assert.equal(entry.details.accountDisabled, true);
  assert.equal((await audited('invitation.account.disabled', inv.id)).length, 1);
  const { notifications } = await lib.listNotifications({ limit: 20 });
  const told = notifications.find((n) => n.message.includes(row.acceptedUserId));
  assert.match(told.message, /was disabled/);
  assert.doesNotMatch(told.message, /reaches nothing/);
});

test('2 — a stop between the role and the site: the role stays on a disabled account', async () => {
  const inv = await made();
  onSurface = async () => {
    if (
      gatekeeper.grants.some((g) => g.resourceType === 'plugin' && g.principalId === inv.username)
    ) {
      onSurface = null;
      surface = { ok: false, reason: 'no_web_surface' };
    }
  };
  const res = await acceptAs(inv);
  assert.equal(res.statusCode, 410, res.body);
  const row = await lib.getInvitation(inv.id);
  assert.equal(row.revokedReason, 'surface_removed');
  assert.ok(row.roleGrantedAt);
  assert.equal(row.siteGrantedAt, null);
  assert.equal((await usersNow())[inv.username].disabled, true);
});

test('2 — an administrator’s invitation with `admins`: revoked after the account exists, the account is disabled, and it was never accepted', async () => {
  const username = 'adminvite';
  const made = await call('POST', '/api/invitations', {
    username,
    email: 'adm@relay.test',
    groups: ['admins'],
    domains: [D],
  });
  assert.equal(made.statusCode, 201, made.body);
  const { id } = made.json().invitation;
  onRender = async () => {
    if ((await usersNow())[username]) {
      onRender = null;
      assert.equal((await call('DELETE', `/api/invitations/${id}`)).statusCode, 202);
    }
  };
  const res = await accept({ token: made.json().token, password: PASSWORD });
  assert.equal(res.statusCode, 410, res.body);
  const row = await lib.getInvitation(id);
  assert.equal(row.status, 'revoked');
  assert.equal(row.revokedBy, 'admin');
  assert.equal((await usersNow())[username].disabled, true);
  assert.equal((await audited('invitation.accepted', id)).length, 0);
  assert.equal((await audited('invitation.revoked', id)).length, 1);
});

test('2 — a disable that failed is retried by the tick, once', async () => {
  const inv = await made();
  await lib.claimInvitation(inv.id, 'corral', inv.username);
  const coord = await idOf('second');
  await call('DELETE', `/api/invitations/${inv.id}`);
  const claim = (await lib.getInvitation(inv.id)).claimId;
  const finished = await lib.finishClaim(inv.id, 'corral', claim, coord);
  assert.equal(finished.status, 'revoked');
  assert.equal(finished.accountDisabledAt, null);
  await lib.invitationsTick({ logger });
  assert.equal((await usersNow()).second.disabled, true);
  assert.ok((await lib.getInvitation(inv.id)).accountDisabledAt);
  // Re-enabled by an administrator: nothing disables them again.
  const users = await usersNow();
  delete users.second.disabled;
  await lib.changeUsers(() => lib.writeUsers({ users }), { actor: 'admin', logger });
  await lib.invitationsTick({ logger });
  assert.equal((await usersNow()).second.disabled, undefined);
});

// ---------------------------------------------------------------------------
// One audit entry per transition
// ---------------------------------------------------------------------------

test('3 — a revocation found at the claim is audited', async () => {
  const inv = await made();
  surface = { ok: false, reason: 'no_web_surface' };
  assert.equal((await acceptAs(inv)).statusCode, 410);
  const [entry, ...more] = await audited('invitation.revoked', inv.id);
  assert.equal(more.length, 0);
  assert.equal(entry.details.reason, 'surface_removed');
  assert.equal(entry.actor, 'lamaste');
});

test('3 — the fifth refused username locks the link, audited', async () => {
  const inv = await made();
  for (let i = 0; i < 5; i += 1) {
    const res = await accept({
      token: inv.token,
      username: 'coord',
      displayName: 'X',
      password: PASSWORD,
    });
    assert.equal(res.statusCode, 409);
  }
  assert.equal((await lib.getInvitation(inv.id)).revokedReason, 'attempts_exhausted');
  const [entry] = await audited('invitation.revoked', inv.id);
  assert.equal(entry.details.reason, 'attempts_exhausted');
});

test('3 — a mark is audited as a mark, by whoever made it; the revocation once, when it ends', async () => {
  const byAdmin = await made();
  await lib.claimInvitation(byAdmin.id, 'corral', byAdmin.username);
  await call('DELETE', `/api/invitations/${byAdmin.id}`);
  await call('DELETE', `/api/invitations/${byAdmin.id}`);
  assert.equal((await audited('invitation.revoke.marked', byAdmin.id)).length, 1);
  assert.equal((await audited('invitation.revoked', byAdmin.id)).length, 0);

  const byInviter = await made();
  const claim = await lib.claimInvitation(byInviter.id, 'corral', byInviter.username);
  await invite('DELETE', `/api/delegated-invitations/corral/${byInviter.id}`);
  const [mark] = await audited('invitation.revoke.marked', byInviter.id);
  assert.equal(mark.actor, `user:${await idOf('coord')}`);
  assert.equal((await audited('invitation.revoked', byInviter.id)).length, 0);
  await lib.releaseClaim(byInviter.id, 'corral', claim);
  await lib.releaseClaim(byAdmin.id, 'corral', (await lib.getInvitation(byAdmin.id)).claimId);
});

test('3 — a sweep’s mark is audited once, however many sweeps see it', async () => {
  const inv = await made();
  const claim = await lib.claimInvitation(inv.id, 'corral', inv.username);
  await call('PUT', '/api/plugins/corral/invitation-policy', {
    enabled: true,
    emailDomains: ['other.test'],
  });
  await lib.sweepPluginInvitations('corral', { logger });
  await lib.sweepPluginInvitations('corral', { logger });
  assert.equal((await audited('invitation.revoke.marked', inv.id)).length, 1);
  await lib.releaseClaim(inv.id, 'corral', claim);
});

test('3 — an ended invitation’s deletion is audited', async () => {
  const inv = await made();
  await call('DELETE', `/api/invitations/${inv.id}`);
  const res = await call('DELETE', `/api/invitations/${inv.id}`);
  assert.equal(res.json().action, 'deleted');
  assert.equal((await audited('invitation.deleted', inv.id)).length, 1);
});

test('3 — an acceptance whose claim recovery took audits nothing of its own', async () => {
  const inv = await made();
  onRender = async () => {
    if (
      gatekeeper.grants.some((g) => g.resourceType === 'site' && g.principalId === inv.username)
    ) {
      onRender = null;
      await age(inv.id);
      await lib.resolveStaleClaims({ logger });
    }
  };
  const res = await acceptAs(inv);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((await lib.getInvitation(inv.id)).status, 'accepted');
  const accepted = await audited('invitation.accepted', inv.id);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].details.recovered, true);
  assert.equal((await audited('invitation.revoked', inv.id)).length, 0);
});

// ---------------------------------------------------------------------------
// The inviter must reach the site
// ---------------------------------------------------------------------------

test('5 — an inviter who lost the site’s grant: their link ends at acceptance, whatever role is left', async () => {
  const inv = await made('viewer', 'second');
  const grant = gatekeeper.grants.find(
    (g) => g.principalId === 'second' && g.resourceType === 'site',
  );
  gatekeeper.grants.splice(gatekeeper.grants.indexOf(grant), 1);
  const res = await acceptAs(inv);
  assert.equal(res.statusCode, 410, res.body);
  assert.equal((await lib.getInvitation(inv.id)).revokedReason, 'inviter_unentitled');
  assert.equal((await usersNow())[inv.username], undefined);

  // Through a Lamaste group it counts as Gatekeeper counts it.
  gatekeeper.setGroup('team', ['second']);
  grantSite('team', 'group');
  const next = await made('viewer', 'second');
  assert.equal((await acceptAs(next)).statusCode, 200);
  gatekeeper.grants.push(grant);
});

test('5 — Gatekeeper not answering stops an acceptance without ending the invitation', async () => {
  const inv = await made();
  const transport = gatekeeper.request;
  lib.setGatekeeperClientForTests(async (method, apiPath, body) =>
    apiPath.startsWith('/api/grants?')
      ? { ok: false, statusCode: 503, error: 'refused', reason: 'unreachable' }
      : transport(method, apiPath, body),
  );
  const res = await acceptAs(inv);
  lib.setGatekeeperClientForTests(transport);
  assert.equal(res.statusCode, 503, res.body);
  assert.equal((await lib.getInvitation(inv.id)).status, 'pending');
});

// ---------------------------------------------------------------------------
// The site repair
// ---------------------------------------------------------------------------

test('6 — a definite refusal of the site grant is retried; an answer lost is not', async () => {
  const refused = await made();
  const transport = gatekeeper.request;
  const failing = (answer) => async (method, apiPath, body) =>
    method === 'POST' && apiPath === '/api/grants' && body.resourceType === 'site'
      ? answer
      : transport(method, apiPath, body);
  lib.setGatekeeperClientForTests(
    failing({
      ok: false,
      statusCode: 503,
      error: 'connect ECONNREFUSED',
      reason: 'unreachable',
    }),
  );
  assert.equal((await acceptAs(refused)).json().accessPending, true);
  lib.setGatekeeperClientForTests(transport);
  assert.equal((await lib.getInvitation(refused.id)).siteAttemptedAt, null);
  await lib.repairAcceptances({ logger });
  const repaired = await lib.getInvitation(refused.id);
  assert.equal(repaired.status, 'accepted');
  assert.ok(repaired.siteGrantedAt, 'a Gatekeeper outage is not terminal');

  const lost = await made();
  lib.setGatekeeperClientForTests(
    failing({
      ok: false,
      statusCode: 503,
      error: 'socket hang up',
      reason: 'unreachable',
      outcomeUnknown: true,
    }),
  );
  await acceptAs(lost);
  lib.setGatekeeperClientForTests(transport);
  assert.ok((await lib.getInvitation(lost.id)).siteAttemptedAt);
  await lib.repairAcceptances({ logger });
  assert.equal((await lib.getInvitation(lost.id)).revokedReason, 'repair_abandoned');
});

test('6 — the client tells a refused connection from a lost answer', async () => {
  const { gatekeeperRequest } = lib;
  lib.setGatekeeperClientForTests(null);
  await writeFile(path.join(stateDir, 'gatekeeper-secret'), 'test-secret');
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    };
    assert.equal((await gatekeeperRequest('GET', '/x')).outcomeUnknown, undefined);
    globalThis.fetch = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    };
    assert.equal((await gatekeeperRequest('GET', '/x')).outcomeUnknown, true);
  } finally {
    globalThis.fetch = original;
    lib.setGatekeeperClientForTests(gatekeeper.request);
  }
});

// ---------------------------------------------------------------------------
// What made a user stays on record
// ---------------------------------------------------------------------------

test('7 — a revoked row that made a user: never pruned, never deleted, counted, and disable-invitees reaches them', async () => {
  const inviterId = await idOf('coord');
  const inv = await made();
  onRender = async () => {
    if (
      gatekeeper.grants.some((g) => g.resourceType === 'site' && g.principalId === inv.username)
    ) {
      onRender = null;
      await call('DELETE', `/api/invitations/${inv.id}`);
    }
  };
  assert.equal((await acceptAs(inv)).statusCode, 410);
  const row = await lib.getInvitation(inv.id);

  await lib.pruneEndedInvitations(Date.now() + 200 * 86_400_000);
  assert.ok(await lib.getInvitation(inv.id), 'kept past the retention');
  const del = await call('DELETE', `/api/invitations/${inv.id}`);
  assert.equal(del.statusCode, 409);
  assert.equal(del.json().code, 'invitation_has_user');
  assert.ok((await lib.inviteesOf(inviterId)).includes(row.acceptedUserId));

  // It counts toward the plugin's cap, though it ended revoked.
  const db = await lib.getStateDb();
  const open = Number(
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM invitations i JOIN directory_users u
           ON u.user_id = i.accepted_user_id
         WHERE i.plugin = 'corral' AND u.status <> 'removed'`,
      )
      .get().n,
  );
  await call('PUT', '/api/plugins/corral/invitation-policy', {
    enabled: true,
    emailDomains: ['client.test'],
    maxJoined: open,
  });
  const res = await invite('POST', '/api/delegated-invitations/corral', {
    email: 'over@client.test',
    role: 'viewer',
  });
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(res.json().cap, 'plugin');
});

// ---------------------------------------------------------------------------
// TOTP, logs
// ---------------------------------------------------------------------------

test('8, 19 — a failed TOTP write: the invitee has a way on, the administrators are told, the log names nobody', async () => {
  const inv = await made();
  writeTotp = async (username) => {
    throw Object.assign(new Error(`Command failed: sudo lamaste-priv authelia-totp ${username}`), {
      exitCode: 3,
    });
  };
  // Called directly: its logger is what is under test.
  const answer = await lib.acceptInvitation(
    { token: inv.token, username: inv.username, displayName: 'Davetli', password: PASSWORD },
    { host: PORTAL, logger },
  );
  assert.equal(answer.totpUri, null);
  const row = await lib.getInvitation(inv.id);
  assert.equal(row.totpIssuedAt, null);
  const { notifications } = await lib.listNotifications({ limit: 20 });
  assert.ok(
    notifications.some(
      (n) => n.message.includes(row.acceptedUserId) && /reset their TOTP/.test(n.message),
    ),
  );
  const lines = JSON.stringify(logged);
  assert.match(lines, /Failed to set up TOTP/);
  assert.match(lines, /"exitCode":3/);
  assert.doesNotMatch(lines, new RegExp(inv.username));
});

test('8 — an acceptance recovered after a crash before its TOTP: the administrators are told', async () => {
  const crashed = await made();
  await lib.claimInvitation(crashed.id, 'corral', crashed.username);
  await lib.changeUsers(
    () => lib.createUserFromInvitation(crashed.username, 'x@client.test', [], HASH, 'X'),
    {
      actor: 'invitation',
      logger,
      invitationId: crashed.id,
      creates: [crashed.username],
      domains: { [crashed.username]: [{ name: D, kind: 'external' }] },
    },
  );
  await age(crashed.id);
  await lib.resolveStaleClaims({ logger });
  const row = await lib.getInvitation(crashed.id);
  assert.equal(row.status, 'accepted');
  const { notifications } = await lib.listNotifications({ limit: 20 });
  assert.ok(
    notifications.some(
      (n) => n.message.includes(row.acceptedUserId) && /reset their TOTP/.test(n.message),
    ),
  );
});

// ---------------------------------------------------------------------------
// Erasure
// ---------------------------------------------------------------------------

test('9 — erasing a user: their other invitations go by address, and by the invitation that made them', async () => {
  const accepted = await made();
  assert.equal((await acceptAs(accepted)).statusCode, 200);
  const row = await lib.getInvitation(accepted.id);
  const address = `${accepted.username}@client.test`;
  // An earlier invitation to the same address, revoked: it keeps the address.
  const earlier = await invite('POST', '/api/delegated-invitations/corral', {
    email: address,
    role: 'viewer',
  });
  await call('DELETE', `/api/invitations/${earlier.json().invitation.id}`);
  // A stranger's invitation stays.
  const other = await made();

  const users = await usersNow();
  delete users[accepted.username];
  await lib.changeUsers(() => lib.writeUsers({ users }, { deleting: [accepted.username] }), {
    actor: 'admin',
    logger,
    deleted: [accepted.username],
  });
  await lib.eraseDirectoryUser(row.acceptedUserId, { actor: 'admin', logger });
  assert.equal(await lib.getInvitation(accepted.id), null);
  assert.equal(await lib.getInvitation(earlier.json().invitation.id), null);
  assert.ok(await lib.getInvitation(other.id));
});

test('9 — the invitation an erased user was made by is gone even if it never finished; recovery skips an erased user', async () => {
  const inv = await made();
  await lib.claimInvitation(inv.id, 'corral', inv.username);
  await lib.changeUsers(
    () => lib.createUserFromInvitation(inv.username, 'y@client.test', [], HASH, 'Y'),
    {
      actor: 'invitation',
      logger,
      invitationId: inv.id,
      creates: [inv.username],
      domains: { [inv.username]: [{ name: D, kind: 'external' }] },
    },
  );
  const userId = await idOf(inv.username);
  assert.equal((await lib.directoryUserOfInvitation(inv.id)).userId, userId);
  const users = await usersNow();
  delete users[inv.username];
  await lib.changeUsers(() => lib.writeUsers({ users }, { deleting: [inv.username] }), {
    actor: 'admin',
    logger,
    deleted: [inv.username],
  });
  await lib.eraseDirectoryUser(userId, { actor: 'admin', logger });
  assert.equal(await lib.getInvitation(inv.id), null);
  assert.equal(await lib.directoryUserOfInvitation(inv.id), null);
});

// ---------------------------------------------------------------------------
// A plugin disabled, an update under way
// ---------------------------------------------------------------------------

test('10 — a disabled plugin takes no invitation and accepts none, and revokes nothing: it may be enabled again', async () => {
  const inv = await made();
  await lib.writePlugins({ plugins: [{ ...PLUGIN_ROW, status: 'disabled' }] });
  try {
    const refused = await invite('POST', '/api/delegated-invitations/corral', {
      email: 'dis@client.test',
      role: 'viewer',
    });
    assert.equal(refused.statusCode, 403);
    assert.equal(refused.json().code, 'invitations_unavailable');
    await lib.sweepPluginInvitations('corral', { logger });
    assert.equal((await lib.getInvitation(inv.id)).status, 'pending');
    assert.equal((await acceptAs(inv)).statusCode, 503);
    assert.equal((await lib.getInvitation(inv.id)).status, 'pending');
  } finally {
    await lib.writePlugins({ plugins: [PLUGIN_ROW] });
  }
  assert.equal((await acceptAs(inv)).statusCode, 200);
});

test('11 — an update that drops a role and reverts revokes nothing: a sweep waits for its outcome', async () => {
  const inv = await made();
  let finish;
  const held = new Promise((resolve) => {
    finish = resolve;
  });
  const { done } = await lib.startPluginOperation({
    plugin: 'corral',
    kind: 'update',
    actor: 'admin',
    logger,
    run: async () => {
      await held;
    },
  });
  await lib.writePlugins({
    plugins: [
      {
        ...PLUGIN_ROW,
        identity: normalizeIdentityBlock({
          roles: [{ id: 'coordinator', label: 'K', invites: ['coordinator'] }],
        }),
      },
    ],
  });
  await lib.sweepPluginInvitations('corral', { logger });
  assert.equal((await lib.getInvitation(inv.id)).status, 'pending', 'the outcome is not known');
  await lib.writePlugins({ plugins: [PLUGIN_ROW] });
  finish();
  await done;
  await lib.sweepPluginInvitations('corral', { logger });
  assert.equal((await lib.getInvitation(inv.id)).status, 'pending');
});

// ---------------------------------------------------------------------------
// The import
// ---------------------------------------------------------------------------

test('12 — invitations.json is imported once: a file that comes back is deleted unread, and revives nothing', async () => {
  await lib.forgetInvitationsImportForTests();
  const file = path.join(stateDir, 'invitations.json');
  const row = (id, token, username, extra = {}) => ({
    id,
    token: token.repeat(64),
    username,
    email: `${username}@x.test`,
    createdAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    used: false,
    ...extra,
  });
  await writeFile(file, JSON.stringify([row('imp-1', 'a', 'imported')]));
  assert.equal(await lib.importLegacyInvitations({ logger }), 1);
  assert.ok(await lib.getInvitation('imp-1'));
  // The administrator deletes it; a restored backup brings the file back.
  await lib.revokeOrDeleteInvitation('imp-1');
  await lib.revokeOrDeleteInvitation('imp-1');
  await writeFile(file, JSON.stringify([row('imp-1', 'a', 'imported')]));
  assert.equal(await lib.importLegacyInvitations({ logger }), null);
  assert.equal(await lib.getInvitation('imp-1'), null, 'not brought back');
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  assert.ok((await lib.listAudit({ action: 'invitation.import.refused' })).length >= 1);
  assert.match(JSON.stringify(logged), /deleted unread/);
});

test('12 — no file at all closes the import too; an accepted row never names a later holder of the username', async () => {
  await lib.forgetInvitationsImportForTests();
  assert.equal(await lib.importLegacyInvitations({ logger }), null);
  const file = path.join(stateDir, 'invitations.json');
  await writeFile(file, '[]');
  assert.equal(await lib.importLegacyInvitations({ logger }), null);
  await assert.rejects(readFile(file), { code: 'ENOENT' });

  await lib.forgetInvitationsImportForTests();
  await writeFile(
    file,
    JSON.stringify([
      {
        id: 'imp-2',
        token: 'b'.repeat(64),
        username: 'coord',
        email: 'c@x.test',
        createdAt: '2020-01-01T00:00:00.000Z',
        expiresAt: '2020-01-02T00:00:00.000Z',
        used: true,
        acceptedAt: '2020-01-01T01:00:00.000Z',
      },
    ]),
  );
  assert.equal(await lib.importLegacyInvitations({ logger }), 1);
  assert.equal((await lib.getInvitation('imp-2')).acceptedUserId, null);
});

// ---------------------------------------------------------------------------
// Preconditions
// ---------------------------------------------------------------------------

test('13 — a role removed mid-acceptance ends it as that, not accepted with nothing', async () => {
  const inv = await made();
  // The claim's check is the first surface read; the login address the next.
  let reads = 0;
  onSurface = async () => {
    reads += 1;
    if (reads === 2) {
      await lib.writePlugins({
        plugins: [
          {
            ...PLUGIN_ROW,
            identity: normalizeIdentityBlock({
              roles: [{ id: 'coordinator', label: 'K', invites: ['coordinator'] }],
            }),
          },
        ],
      });
    }
  };
  const res = await acceptAs(inv);
  await lib.writePlugins({ plugins: [PLUGIN_ROW] });
  assert.equal(res.statusCode, 410, res.body);
  const row = await lib.getInvitation(inv.id);
  assert.equal(row.status, 'revoked');
  assert.equal(row.revokedReason, 'role_undeclared');
});

test('14 — an inviter’s standing counts until the invitation is accepted, and not after', async () => {
  const inv = await made('viewer', 'second');
  // Their role goes while the user is being written.
  const grant = gatekeeper.grants.find(
    (g) => g.principalId === 'second' && g.resourceType === 'plugin',
  );
  let moved = false;
  onSurface = async () => {
    if ((await usersNow())[inv.username] && !moved) {
      moved = true;
      grant.context = { roles: ['viewer'] };
      await lib.recomputeAudiences({ logger });
    }
  };
  const res = await acceptAs(inv);
  assert.equal(res.statusCode, 410, res.body);
  assert.equal((await lib.getInvitation(inv.id)).revokedReason, 'inviter_unentitled');

  // Accepted, with its site grant still to make: the repair ignores them.
  grant.context = { roles: ['coordinator'] };
  await lib.recomputeAudiences({ logger });
  const later = await made('viewer', 'second');
  const transport = gatekeeper.request;
  lib.setGatekeeperClientForTests(async (method, apiPath, body) =>
    method === 'POST' && apiPath === '/api/grants' && body.resourceType === 'site'
      ? { ok: false, statusCode: 503, error: 'refused', reason: 'http-error' }
      : transport(method, apiPath, body),
  );
  assert.equal((await acceptAs(later)).statusCode, 200);
  lib.setGatekeeperClientForTests(transport);
  grant.context = { roles: ['viewer'] };
  await lib.recomputeAudiences({ logger });
  await lib.repairAcceptances({ logger });
  assert.ok((await lib.getInvitation(later.id)).siteGrantedAt, 'D1');
  grant.context = { roles: ['coordinator'] };
  await lib.recomputeAudiences({ logger });
});

test('15 — a username taken by someone else is never given what an invitation made for another', async () => {
  const inv = await made();
  assert.equal((await acceptAs(inv)).statusCode, 200);
  const db = await lib.getStateDb();
  db.prepare(
    'UPDATE invitations SET role_granted_at = NULL, site_granted_at = NULL WHERE id = ?',
  ).run(inv.id);
  const before = gatekeeper.grants.length;
  const row = await lib.getInvitation(inv.id);
  // `coord` is not the user this invitation made.
  const result = await lib.completeGrants(inv.id, {
    username: 'coord',
    userId: row.acceptedUserId,
    repair: true,
    logger,
  });
  assert.equal(result.complete, false);
  assert.equal(result.stopped, 'repair_abandoned');
  assert.equal(gatekeeper.grants.length, before);
});

// ---------------------------------------------------------------------------
// Lists, the repair's check, the grant table
// ---------------------------------------------------------------------------

test('17 — the inviter’s list and the administrator’s are bounded, and the administrator is told', async () => {
  const db = await lib.getStateDb();
  const coord = await idOf('coord');
  const insert = db.prepare(
    `INSERT INTO invitations (id, token_sha256, kind, email_domain, domains_json, plugin, role,
       site_id, inviter_user_id, created_by, created_at, expires_at, status, status_at,
       revoked_by, revoked_reason)
     VALUES (?, ?, 'delegated', 'client.test', '[]', 'corral', 'viewer', 'site-corral', ?, ?, ?, ?,
       'revoked', ?, 'admin', 'admin')`,
  );
  const old = '2026-01-01T00:00:00.000Z';
  for (let i = 0; i < 205; i += 1) {
    insert.run(`bulk-${i}`, String(i).padStart(64, '0'), coord, `user:${coord}`, old, old, old);
  }
  const view = await invite('GET', '/api/delegated-invitations/corral');
  assert.equal(view.statusCode, 200);
  assert.equal(view.json().invitations.length, 200);
  const page = await call('GET', '/api/invitations?limit=2');
  assert.equal(page.json().invitations.length, 2);
  assert.equal(page.json().truncated, true);
  const all = await call('GET', '/api/invitations?limit=2000');
  assert.equal(all.json().truncated, false);
  assert.equal((await call('GET', '/api/invitations?limit=2001')).statusCode, 400);
  db.prepare(`DELETE FROM invitations WHERE id LIKE 'bulk-%'`).run();
});

test('18 — the repair reads the whole log: an administrator’s change is not lost behind others, nor a site grant they took away', async () => {
  const buried = await made();
  const transport = gatekeeper.request;
  const refuseSite = async (method, apiPath, body) =>
    method === 'POST' && apiPath === '/api/grants' && body.resourceType === 'site'
      ? { ok: false, statusCode: 503, error: 'refused', reason: 'http-error' }
      : transport(method, apiPath, body);
  lib.setGatekeeperClientForTests(refuseSite);
  await acceptAs(buried);
  lib.setGatekeeperClientForTests(transport);
  const buriedRow = await lib.getInvitation(buried.id);
  await lib.recordAudit({
    actor: 'admin',
    action: 'plugin.entitlement.removed',
    plugin: 'corral',
    details: { userId: buriedRow.acceptedUserId },
  });
  for (let i = 0; i < 210; i += 1) {
    await lib.recordAudit({
      actor: 'admin',
      action: 'plugin.entitlement.set',
      plugin: 'corral',
      details: { userId: `someone-${i}` },
    });
  }
  await lib.repairAcceptances({ logger });
  assert.equal((await lib.getInvitation(buried.id)).revokedReason, 'repair_abandoned');

  // The site grant made, the rendering still to do, and an administrator
  // revoked it past every audited route.
  const site = await made();
  const failing = onRender;
  onRender = async () => {
    if (
      gatekeeper.grants.some((g) => g.resourceType === 'site' && g.principalId === site.username)
    ) {
      onRender = failing;
      throw new Error('rendering failed');
    }
  };
  await acceptAs(site);
  onRender = null;
  const row = await lib.getInvitation(site.id);
  assert.ok(row.siteGrantedAt);
  assert.equal(row.renderedAt, null);
  const grant = gatekeeper.grants.find(
    (g) => g.resourceType === 'site' && g.principalId === site.username,
  );
  gatekeeper.grants.splice(gatekeeper.grants.indexOf(grant), 1);
  await lib.repairAcceptances({ logger });
  assert.equal((await lib.getInvitation(site.id)).revokedReason, 'repair_abandoned');
  assert.equal(
    gatekeeper.grants.some((g) => g.resourceType === 'site' && g.principalId === site.username),
    false,
  );
});

test('20 — a policy that could outgrow the grant table says so', async () => {
  const quiet = await call('PUT', '/api/plugins/corral/invitation-policy', {
    enabled: true,
    emailDomains: ['client.test'],
    maxJoined: 10,
  });
  assert.equal(quiet.json().warnings, undefined);
  gatekeeper.state.maxGrants = gatekeeper.grants.length + 150;
  const res = await call('PUT', '/api/plugins/corral/invitation-policy', {
    enabled: true,
    emailDomains: ['client.test'],
    maxJoined: 500,
  });
  gatekeeper.state.maxGrants = 1000;
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().warnings.length, 1);
  assert.match(res.json().warnings[0].message, /1000 grants/);
});
