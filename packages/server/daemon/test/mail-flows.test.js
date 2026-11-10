/**
 * The relay's mail flows (packages/core/docs/mail-design.md §4, §6):
 * invitation mails — the administrator's and delegated ones, their outcome
 * recorded and listed, a new link that kills the old one (reissue) under
 * the inviter's rate and caps; forgot password — one answer whatever was
 * found, the users a start names (by username or address, enabled,
 * members of the host's domain, a deliverable address), one mail per
 * address, the per-user and per-address counts, the link's lookup and its
 * finish with a TOTP code (none, wrong, five failures, a replayed step);
 * change password while signed in — the current password always checked,
 * five failures then 429, the page's own origin; the notices; the users
 * listing's deliverability flag; nothing mailed without a transport.
 *
 * Mail goes to an in-process SMTP sink a private CA vouches for (as in
 * mail-transports.test.js), Authelia is a users file with a fake per-user
 * storage (its TOTP check included), Gatekeeper a fake.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import bcrypt from 'bcryptjs';
import Fastify from 'fastify';
import yaml from 'js-yaml';
import { SMTPServer } from 'smtp-server';

import { SmtpTransportInputSchema, normalizeIdentityBlock } from '@lamalibre/lamaste';
import { verifyAutheliaTotp } from '@lamalibre/lamaste/server';

import { createFakeAutheliaStorage } from './fake-authelia-storage.js';
import { installFakeGatekeeper } from './fake-gatekeeper.js';

const FIXTURES = new URL('./fixtures/mail/', import.meta.url);
const D = 'codelama.example';
const OTHER = 'other.example';
const PORTAL = `auth.${D}`;
const ORIGIN = `https://${PORTAL}`;
const SMTP_PASSWORD = 'smtp-password-never-echoed';
const PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'a-brand-new-password';
const SITE = { id: 'site-corral', fqdn: `corral.${D}` };
const IDENTITY = normalizeIdentityBlock({
  roles: [
    { id: 'coordinator', label: 'Koordinatör', invites: ['viewer'] },
    { id: 'viewer', label: 'İzleyici' },
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
let usersFile;
let lib;
let app;
let inviterApp;
let smtp;
let caPem;
let storage;
let gatekeeper;
let hash;

// ---------------------------------------------------------------------------
// The SMTP sink
// ---------------------------------------------------------------------------

const sink = { port: 0, messages: [] };

function startSink(key, cert) {
  const server = new SMTPServer({
    secure: true,
    key,
    cert,
    authMethods: ['PLAIN'],
    logger: false,
    onAuth(auth, _session, callback) {
      if (auth.username === 'relay' && auth.password === SMTP_PASSWORD) {
        return callback(null, { user: auth.username });
      }
      return callback(Object.assign(new Error('Invalid credentials'), { responseCode: 535 }));
    },
    onData(stream, session, callback) {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        sink.messages.push({
          to: session.envelope.rcptTo.map((r) => r.address),
          text: decodeMime(Buffer.concat(chunks).toString('utf-8')),
        });
        callback();
      });
    },
  });
  server.on('error', () => {});
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      sink.port = server.server.address().port;
      resolve(server);
    });
  });
}

/** A message's parts as text: quoted-printable soft breaks and escapes undone, base64 parts decoded. */
function decodeMime(raw) {
  const decoded = raw
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const base64Parts = [...raw.matchAll(/base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/g)].map((m) =>
    Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf-8'),
  );
  return [decoded, ...base64Parts].join('\n');
}

const tokensIn = (text, kind) =>
  [...text.matchAll(new RegExp(`https://auth\\.[a-z.]+/${kind}#([a-f0-9]{64})`, 'g'))].map(
    (m) => m[1],
  );

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const person = (displayname, email, groups = []) => ({
  displayname,
  email,
  password: hash,
  groups,
});
const usersNow = async () => yaml.load(await readFile(usersFile, 'utf-8')).users;
const idOf = async (username) => (await lib.findDirectoryUser(username))?.userId;

function account(method, url, payload, { host = PORTAL, headers = {} } = {}) {
  return app.inject({
    method,
    url,
    headers: {
      host,
      'sec-fetch-site': 'same-origin',
      origin: `https://${host}`,
      'content-type': 'application/json',
      ...headers,
    },
    payload: JSON.stringify(payload),
  });
}

function admin(method, url, payload) {
  return app.inject({
    method,
    url,
    headers: {
      'x-test-role': 'admin',
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

function invite(method, url, payload, { as = 'coord' } = {}) {
  return inviterApp.inject({
    method,
    url,
    headers: {
      'x-test-inviter': as,
      host: PORTAL,
      'sec-fetch-site': 'same-origin',
      origin: ORIGIN,
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

async function startReset(identifier, opts) {
  const res = await account('POST', '/api/account/reset/start', { identifier }, opts);
  await lib.accountWorkIdle();
  return res;
}

async function setTransport() {
  await lib.setSmtpTransport(
    null,
    SmtpTransportInputSchema.parse({
      host: '127.0.0.1',
      port: sink.port,
      security: 'tls',
      username: 'relay',
      password: SMTP_PASSWORD,
      caPem,
      senderAddress: 'no-reply@notify.mail.example',
      senderName: 'Code Lama',
    }),
    { actor: 'admin', logger },
  );
}

async function clearTransport() {
  const d = await lib.getStateDb();
  d.exec('DELETE FROM mail_transports; DELETE FROM mail_accounts; DELETE FROM mail_sends;');
}

before(async () => {
  hash = await bcrypt.hash(PASSWORD, 4);
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-mail-flows-'));
  const stateDir = path.join(dir, 'state');
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
        admin: person('Admin', 'admin@lamaste.local', ['admins']),
        ayse: person('Ayşe Kaya', 'ayse@client.example.com'),
        // Two accounts at one address
        mehmet: person('Mehmet', 'shared@client.example.com'),
        mehmet2: person('Mehmet Two', 'Shared@Client.Example.com'),
        gone: { ...person('Disabled', 'gone@client.example.com'), disabled: true },
        farid: person('Farid', 'farid@client.example.com'),
        coord: person('Coordinator Kaya', 'coord@client.example.com'),
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
    ...(await import('../src/lib/plugins.js')),
    ...(await import('../src/lib/invitations.js')),
    ...(await import('../src/lib/delegated-invitations.js')),
    ...(await import('../src/lib/invitation-acceptance.js')),
    ...(await import('../src/lib/mail.js')),
    ...(await import('../src/lib/account.js')),
  };
  await lib.loadConfig();
  const fake = createFakeAutheliaStorage();
  storage = fake;
  lib.setAutheliaForTests({
    domainAccess: async () => ({ changed: false }),
    usersFile,
    restart: async () => {},
    writeTotp: async () => {},
    userStorage: fake.storage,
    mail: async () => ({ changed: false }),
  });
  lib.setAccountTimingForTests({ startAnswerDelayMs: 0 });
  lib.setInvitationSurfaceForTests(async () => ({ ok: true, site: SITE, domain: D }));
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
  // With one domain, everyone the directory first sees becomes its member.
  await lib.reconcileDirectory({ confirmDelayMs: 0 });
  const d = await lib.getStateDb();
  const at = new Date().toISOString();
  d.prepare(
    "INSERT INTO domains (name, is_primary, status, created_at, activated_at) VALUES (?, 0, 'active', ?, ?)",
  ).run(OTHER, at, at);
  // farid: a member of the other domain only.
  await lib.setUserDomains(await idOf('farid'), [{ name: OTHER, kind: 'member' }], {
    actor: 'admin',
    logger,
  });
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'coord',
    resourceType: 'plugin',
    resourceId: 'corral',
    context: { roles: ['coordinator'] },
  });
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'coord',
    resourceType: 'site',
    resourceId: SITE.id,
    context: {},
  });
  await lib.recomputeAudiences({ logger });

  const { setMailSubmissionForTests } = await import('../src/lib/mail-submission.js');
  await mkdir(path.join(dir, 'authelia', 'certs'), { recursive: true });
  await setMailSubmissionForTests({
    dir: path.join(stateDir, 'mail-submission'),
    certsDir: path.join(dir, 'authelia', 'certs'),
    passwordFile: path.join(dir, 'authelia', 'mail-submission-password'),
    port: 0,
  });
  caPem = await readFile(new URL('ca.pem', FIXTURES), 'utf-8');
  smtp = await startSink(
    await readFile(new URL('server.key', FIXTURES)),
    await readFile(new URL('server.pem', FIXTURES)),
  );

  const { default: errors } = await import('../src/middleware/errors.js');
  app = Fastify({ logger: false });
  await app.register(errors);
  app.decorateRequest('certRole', null);
  app.addHook('onRequest', async (request) => {
    request.certRole = request.headers['x-test-role'] ?? 'unknown';
  });
  app.decorate('requireRole', (roles) => async (request, reply) => {
    if (request.certRole === 'admin' || roles.includes(request.certRole)) return;
    return reply.code(403).send({ error: 'forbidden' });
  });
  const { default: accountRoutes } = await import('../src/routes/account.js');
  await app.register(accountRoutes, { prefix: '/api/account' });
  const { default: invitationRoutes } = await import('../src/routes/management/invitations.js');
  await app.register(invitationRoutes, { prefix: '/api' });
  const { default: usersRoutes } = await import('../src/routes/management/users.js');
  await app.register(usersRoutes, { prefix: '/api' });
  const { default: inviteRoutes } = await import('../src/routes/invite.js');
  await app.register(inviteRoutes, { prefix: '/api/invite' });
  await app.ready();

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
      const row = user ? await lib.readAudienceRow('corral', user.userId) : null;
      const member = row?.change?.kind === 'upsert' ? row.change.member : null;
      if (!member || member.status !== 'active') {
        return { ok: false, status: 403, error: 'This user may not use this plugin' };
      }
      return {
        ok: true,
        caller: { type: 'user', userId: user.userId, username, roles: member.roles },
      };
    },
  });
  await inviterApp.ready();
});

after(async () => {
  await lib.accountWorkIdle();
  await (await import('../src/lib/mail-submission.js')).setMailSubmissionForTests(null);
  await lib.invitationSweepsIdle();
  lib.setInvitationSurfaceForTests(null);
  lib.setAutheliaForTests(null);
  lib.setGatekeeperClientForTests(null);
  lib.setAccountTimingForTests();
  await app?.close();
  await inviterApp?.close();
  await new Promise((resolve) => smtp?.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  sink.messages.length = 0;
  storage.reset();
  lib.setAccountTimingForTests({ startAnswerDelayMs: 0 });
  const d = await lib.getStateDb();
  d.exec('DELETE FROM password_resets; DELETE FROM account_totp_steps;');
  d.exec('DELETE FROM account_password_failures; DELETE FROM mail_sends;');
  await setTransport();
});

// ---------------------------------------------------------------------------
// The TOTP check's verdicts (core)
// ---------------------------------------------------------------------------

test('verifyAutheliaTotp: ok with its step, a wrong code, no configuration — told apart', async () => {
  const answering = (stdout) => async () => ({ stdout, stderr: '', exitCode: 0 });
  assert.deepEqual(await verifyAutheliaTotp('ayse', '123456', answering('ok 42\n')), {
    ok: true,
    step: 42,
  });
  assert.deepEqual(await verifyAutheliaTotp('ayse', '123456', answering('no\n')), {
    ok: false,
    reason: 'wrong',
  });
  assert.deepEqual(await verifyAutheliaTotp('ayse', '123456', answering('none\n')), {
    ok: false,
    reason: 'none',
  });
  assert.deepEqual(await verifyAutheliaTotp('ayse', '12x456', answering('ok 1\n')), {
    ok: false,
    reason: 'wrong',
  });
  await assert.rejects(verifyAutheliaTotp('ayse', '123456', answering('maybe\n')), /neither/);
});

// ---------------------------------------------------------------------------
// Forgot password
// ---------------------------------------------------------------------------

test('reset start: one answer whatever it finds; a mail only for an enabled member with an address', async () => {
  for (const identifier of ['nobody', 'gone', 'admin', 'farid', 'ayse']) {
    const res = await startReset(identifier);
    assert.equal(res.statusCode, 202, identifier);
    assert.deepEqual(res.json(), { sent: true });
  }
  // Only ayse: gone is disabled, admin's address is under .local, farid is
  // no member of this domain, nobody does not exist.
  assert.equal(sink.messages.length, 1);
  assert.deepEqual(sink.messages[0].to, ['ayse@client.example.com']);
  const [token] = tokensIn(sink.messages[0].text, 'reset');
  assert.match(token, /^[a-f0-9]{64}$/);
  // The token is stored only as its hash.
  const d = await lib.getStateDb();
  const rows = d.prepare('SELECT token_sha256, domain FROM password_resets').all();
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_sha256, token);
  assert.equal(rows[0].domain, D);

  // farid on his own domain's sign-in host (this address's five starts are spent).
  lib.setAccountTimingForTests({ startAnswerDelayMs: 0 });
  await startReset('farid', { host: `auth.${OTHER}` });
  assert.equal(sink.messages.length, 2);
  assert.match(
    sink.messages[1].text,
    new RegExp(`https://auth\\.${OTHER.replace('.', '\\.')}/reset#`),
  );
});

test('reset start: by address, case-insensitive — one mail listing every account there', async () => {
  await startReset('SHARED@client.example.COM');
  assert.equal(sink.messages.length, 1);
  const text = sink.messages[0].text;
  assert.equal(tokensIn(text, 'reset').length >= 2, true);
  assert.match(text, /mehmet2/);
  assert.match(text, /mehmet\b/);
});

test('reset start: 404 where no mail is sent or on no sign-in host; a cross-origin start refused', async () => {
  assert.equal((await startReset('ayse', { host: 'panel.codelama.example' })).statusCode, 404);
  assert.equal((await startReset('ayse', { host: 'auth.unknown.example' })).statusCode, 404);
  await clearTransport();
  const none = await startReset('ayse');
  assert.equal(none.statusCode, 404);
  assert.equal(none.json().code, 'reset_unavailable');
  await setTransport();
  const cross = await account(
    'POST',
    '/api/account/reset/start',
    { identifier: 'ayse' },
    { headers: { 'sec-fetch-site': 'cross-site' } },
  );
  assert.equal(cross.statusCode, 403);
  const otherOrigin = await account(
    'POST',
    '/api/account/reset/start',
    { identifier: 'ayse' },
    { headers: { origin: 'https://corral.codelama.example' } },
  );
  assert.equal(otherOrigin.statusCode, 403);
  assert.equal(sink.messages.length, 0);
});

test('reset start: three links an hour per user, five starts per address — then the same answer, nothing sent', async () => {
  for (let i = 0; i < 4; i++) {
    assert.equal((await startReset('ayse')).statusCode, 202);
  }
  assert.equal(sink.messages.length, 3);
  // A new link voids the earlier ones: one live.
  const d = await lib.getStateDb();
  const live = d
    .prepare('SELECT COUNT(*) AS n FROM password_resets WHERE expires_at > ? AND used_at IS NULL')
    .get(new Date().toISOString()).n;
  assert.equal(Number(live), 1);

  sink.messages.length = 0;
  d.exec('DELETE FROM password_resets');
  // The address's fifth start is still within its count; the sixth does nothing.
  assert.equal((await startReset('ayse')).statusCode, 202);
  assert.equal(sink.messages.length, 1);
  assert.equal((await startReset('mehmet')).statusCode, 202);
  assert.equal(sink.messages.length, 1);
});

async function linkFor(username) {
  await startReset(username);
  const message = sink.messages.at(-1);
  return tokensIn(message.text, 'reset')[0];
}

test('reset lookup: whose link it is — on its own domain only; everything else one 410', async () => {
  const token = await linkFor('ayse');
  const ok = await account('POST', '/api/account/reset/lookup', { token });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json(), { username: 'ayse', displayName: 'Ayşe Kaya' });

  const elsewhere = await account(
    'POST',
    '/api/account/reset/lookup',
    { token },
    {
      host: `auth.${OTHER}`,
    },
  );
  assert.equal(elsewhere.statusCode, 410);
  const unknown = await account('POST', '/api/account/reset/lookup', { token: 'a'.repeat(64) });
  assert.equal(unknown.statusCode, 410);
  assert.equal(unknown.json().code, 'reset_invalid');
  const malformed = await account('POST', '/api/account/reset/lookup', { token: 'nope' });
  assert.equal(malformed.statusCode, 400);
});

test('reset finish: no authenticator is 409; a wrong code counts — the fifth voids the link', async () => {
  const token = await linkFor('ayse');
  const body = { token, password: NEW_PASSWORD, totp: '123456' };
  const none = await account('POST', '/api/account/reset/finish', body);
  assert.equal(none.statusCode, 409);
  assert.equal(none.json().code, 'no_totp');

  storage.state.totp.set('ayse', { code: '654321', step: 100 });
  for (let i = 1; i <= 4; i++) {
    const wrong = await account('POST', '/api/account/reset/finish', body);
    assert.equal(wrong.statusCode, 400, `attempt ${i}`);
    assert.equal(wrong.json().code, 'totp_invalid');
  }
  const fifth = await account('POST', '/api/account/reset/finish', body);
  assert.equal(fifth.statusCode, 410);
  const after = await account('POST', '/api/account/reset/finish', { ...body, totp: '654321' });
  assert.equal(after.statusCode, 410);
  assert.equal((await usersNow()).ayse.password, hash);
});

test('reset finish: the password set, the link used, the user told; a code is good once', async () => {
  storage.state.totp.set('ayse', { code: '654321', step: 200 });
  const token = await linkFor('ayse');
  sink.messages.length = 0;
  const done = await account('POST', '/api/account/reset/finish', {
    token,
    password: NEW_PASSWORD,
    totp: '654321',
  });
  assert.equal(done.statusCode, 200, done.body);
  await lib.accountWorkIdle();
  assert.equal(await lib.passwordMatches((await usersNow()).ayse.password, NEW_PASSWORD), true);
  // The notice.
  assert.equal(sink.messages.length, 1);
  assert.deepEqual(sink.messages[0].to, ['ayse@client.example.com']);
  assert.equal(tokensIn(sink.messages[0].text, 'reset').length, 0);
  // The link is used.
  assert.equal((await account('POST', '/api/account/reset/lookup', { token })).statusCode, 410);
  // Another link, the same code (step): refused as a replay.
  const again = await linkFor('ayse');
  const replay = await account('POST', '/api/account/reset/finish', {
    token: again,
    password: PASSWORD,
    totp: '654321',
  });
  assert.equal(replay.statusCode, 400);
  assert.equal(replay.json().code, 'totp_invalid');
  // The audit names the user by id, never the address.
  const events = await lib.listAudit({ limit: 50 });
  const reset = events.find((e) => e.action === 'account.password.reset');
  assert.equal(reset.details.userId, await idOf('ayse'));
  assert.equal(JSON.stringify(events).includes('ayse@'), false);
  // Back to the known password for the other tests.
  await lib.changeUsers(
    async () => {
      const data = await lib.readUsersRaw();
      data.users.ayse.password = hash;
      await lib.writeUsers(data);
    },
    { actor: 'admin', logger },
  );
});

test('reset finish: a user disabled after the link was mailed cannot use it', async () => {
  storage.state.totp.set('mehmet2', { code: '111111', step: 300 });
  await startReset('mehmet2');
  const token = tokensIn(sink.messages.at(-1).text, 'reset')[0];
  await lib.changeUsers(
    async () => {
      const data = await lib.readUsersRaw();
      data.users.mehmet2.disabled = true;
      await lib.writeUsers(data);
    },
    { actor: 'admin', logger },
  );
  const res = await account('POST', '/api/account/reset/finish', {
    token,
    password: NEW_PASSWORD,
    totp: '111111',
  });
  assert.equal(res.statusCode, 410);
  await lib.changeUsers(
    async () => {
      const data = await lib.readUsersRaw();
      delete data.users.mehmet2.disabled;
      await lib.writeUsers(data);
    },
    { actor: 'admin', logger },
  );
});

// ---------------------------------------------------------------------------
// Change password
// ---------------------------------------------------------------------------

function change(payload, { user = 'mehmet', headers = {}, host } = {}) {
  return account('POST', '/api/account/password', payload, {
    ...(host ? { host } : {}),
    headers: { ...(user ? { 'remote-user': user } : {}), ...headers },
  });
}

test('change password: the current one always checked, five wrong ones then 429', async () => {
  assert.equal(
    (await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { user: null }))
      .statusCode,
    401,
  );
  const noOrigin = await app.inject({
    method: 'POST',
    url: '/api/account/password',
    headers: { host: PORTAL, 'remote-user': 'mehmet', 'content-type': 'application/json' },
    payload: JSON.stringify({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
  });
  assert.equal(noOrigin.statusCode, 403);
  const same = await change({ currentPassword: PASSWORD, newPassword: PASSWORD });
  assert.equal(same.statusCode, 400);
  assert.equal(same.json().code, 'password_unchanged');
  for (let i = 0; i < 5; i++) {
    const wrong = await change({ currentPassword: 'not-the-password', newPassword: NEW_PASSWORD });
    assert.equal(wrong.statusCode, 400);
    assert.equal(wrong.json().code, 'current_password_invalid');
  }
  const locked = await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
  assert.equal(locked.statusCode, 429);
  assert.equal((await usersNow()).mehmet.password, hash);
});

test('change password: written through the users lock, the user told; a non-member and a disabled user refused', async () => {
  const done = await change(
    { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    { user: 'ayse' },
  );
  assert.equal(done.statusCode, 200, done.body);
  await lib.accountWorkIdle();
  assert.equal(await lib.passwordMatches((await usersNow()).ayse.password, NEW_PASSWORD), true);
  assert.equal(sink.messages.length, 1);
  assert.deepEqual(sink.messages[0].to, ['ayse@client.example.com']);
  // Back.
  const back = await change(
    { currentPassword: NEW_PASSWORD, newPassword: PASSWORD },
    { user: 'ayse' },
  );
  assert.equal(back.statusCode, 200);

  // farid is no member of this domain; gone is disabled.
  assert.equal(
    (await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { user: 'farid' }))
      .statusCode,
    403,
  );
  assert.equal(
    (await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { user: 'gone' }))
      .statusCode,
    403,
  );
  // On his own domain, farid may.
  const own = await change(
    { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    { user: 'farid', host: `auth.${OTHER}` },
  );
  assert.equal(own.statusCode, 200);
  await lib.accountWorkIdle();
});

test('change password: works without mail — no notice', async () => {
  await clearTransport();
  const done = await change(
    { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    { user: 'coord' },
  );
  assert.equal(done.statusCode, 200);
  await lib.accountWorkIdle();
  assert.equal(sink.messages.length, 0);
  const back = await change(
    { currentPassword: NEW_PASSWORD, newPassword: PASSWORD },
    { user: 'coord' },
  );
  assert.equal(back.statusCode, 200);
});

// ---------------------------------------------------------------------------
// Invitation mails
// ---------------------------------------------------------------------------

test("an administrator's invitation: mailed, its outcome recorded and listed", async () => {
  const res = await admin('POST', '/api/invitations', {
    username: 'newbie',
    email: 'newbie@client.example.com',
    domains: [D],
  });
  assert.equal(res.statusCode, 201, res.body);
  const made = res.json();
  assert.deepEqual(made.mail, { status: 'sent' });
  assert.equal(sink.messages.length, 1);
  assert.deepEqual(sink.messages[0].to, ['newbie@client.example.com']);
  const [mailed] = tokensIn(sink.messages[0].text, 'invite');
  assert.equal(mailed, made.token);

  const listed = (await admin('GET', '/api/invitations')).json().invitations;
  const row = listed.find((i) => i.id === made.invitation.id);
  assert.equal(row.mail.status, 'sent');
  assert.ok(row.mail.sentAt);
  assert.equal(row.reissuedAt, null);
});

test('reissue: a new link mailed, the old one dead; an expired invitation opens again', async () => {
  const made = (
    await admin('POST', '/api/invitations', {
      username: 'again',
      email: 'again@client.example.com',
      domains: [D],
    })
  ).json();
  sink.messages.length = 0;
  const d = await lib.getStateDb();
  // Made eight days ago for seven, expired yesterday.
  const day = 24 * 3600_000;
  d.prepare('UPDATE invitations SET created_at = ?, expires_at = ? WHERE id = ?').run(
    new Date(Date.now() - 8 * day).toISOString(),
    new Date(Date.now() - day).toISOString(),
    made.invitation.id,
  );
  const res = await admin('POST', `/api/invitations/${made.invitation.id}/reissue`);
  assert.equal(res.statusCode, 200, res.body);
  const again = res.json();
  assert.notEqual(again.token, made.token);
  assert.deepEqual(again.mail, { status: 'sent' });
  assert.ok(Date.parse(again.invitation.expiresAt) > Date.now() + 6 * 24 * 3600_000);
  assert.equal(tokensIn(sink.messages[0].text, 'invite')[0], again.token);

  const lookup = (token) =>
    app.inject({
      method: 'POST',
      url: '/api/invite/lookup',
      headers: { host: PORTAL, 'content-type': 'application/json' },
      payload: JSON.stringify({ token }),
    });
  assert.equal((await lookup(made.token)).statusCode, 404);
  assert.equal((await lookup(again.token)).statusCode, 200);

  // Revoked: no new link.
  await admin('DELETE', `/api/invitations/${made.invitation.id}`);
  const closed = await admin('POST', `/api/invitations/${made.invitation.id}/reissue`);
  assert.equal(closed.statusCode, 409);
  assert.equal(closed.json().code, 'invitation_not_pending');
  assert.equal((await admin('POST', '/api/invitations/no-such-id/reissue')).statusCode, 404);
});

test('an invitation with no transport: not-configured, the link answered as before', async () => {
  await clearTransport();
  const res = await admin('POST', '/api/invitations', {
    username: 'unmailed',
    email: 'unmailed@client.example.com',
    domains: [D],
  });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.json().mail, { status: 'not-configured' });
  assert.match(res.json().inviteUrl, /\/invite#[a-f0-9]{64}$/);
  assert.equal(sink.messages.length, 0);
});

test("a delegated invitation: mailed in the inviter's name; the inviter's reissue under the rate", async () => {
  const policy = await admin('PUT', '/api/plugins/corral/invitation-policy', {
    enabled: true,
    emailDomains: ['client.example.com'],
  });
  assert.equal(policy.statusCode, 200, policy.body);
  const res = await invite('POST', '/api/delegated-invitations/corral', {
    email: 'deniz@client.example.com',
    role: 'viewer',
  });
  assert.equal(res.statusCode, 201, res.body);
  const made = res.json();
  assert.deepEqual(made.mail, { status: 'sent' });
  assert.equal(made.invitation.mail.status, 'sent');
  assert.equal(sink.messages.length, 1);
  assert.match(sink.messages[0].text, /Coordinator Kaya/);
  assert.match(sink.messages[0].text, /Corral/);
  const first = tokensIn(sink.messages[0].text, 'invite')[0];

  const again = await invite(
    'POST',
    `/api/delegated-invitations/corral/${made.invitation.id}/reissue`,
  );
  assert.equal(again.statusCode, 200, again.body);
  const second = tokensIn(sink.messages[1].text, 'invite')[0];
  assert.notEqual(second, first);
  assert.equal(again.json().inviteUrl.endsWith(second), true);

  // Someone the plugin does not know cannot ask.
  const notMine = await invite(
    'POST',
    `/api/delegated-invitations/corral/${made.invitation.id}/reissue`,
    undefined,
    { as: 'ayse' },
  );
  assert.equal(notMine.statusCode, 403);

  // The rate counts new links: 30 in the last hour, and the next is refused.
  const d = await lib.getStateDb();
  const coordId = await idOf('coord');
  const insert = d.prepare(
    'INSERT INTO invitation_reissues (invitation_id, inviter_user_id, reissued_at) VALUES (?, ?, ?)',
  );
  for (let i = 0; i < 30; i++) insert.run(made.invitation.id, coordId, new Date().toISOString());
  const rated = await invite(
    'POST',
    `/api/delegated-invitations/corral/${made.invitation.id}/reissue`,
  );
  assert.equal(rated.statusCode, 429);
  assert.equal(rated.json().code, 'invitation_rate');
  d.prepare('DELETE FROM invitation_reissues').run();
});

// ---------------------------------------------------------------------------
// The users listing
// ---------------------------------------------------------------------------

test('the users listing says whose address can receive mail', async () => {
  const { users } = (await admin('GET', '/api/users')).json();
  const by = new Map(users.map((u) => [u.username, u.emailDeliverable]));
  assert.equal(by.get('admin'), false);
  assert.equal(by.get('ayse'), true);
});
