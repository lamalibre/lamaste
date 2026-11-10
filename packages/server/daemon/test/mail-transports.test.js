/**
 * The relay's mail transports (packages/core/docs/mail-design.md §3,
 * lib/mail.js): the routes under /api/settings/mail and
 * /api/domains/:name/mail — validation that never echoes a secret, an
 * `smtp` transport checked against an in-process SMTP sink that only a
 * private CA (`caPem`) makes trusted, a stored password kept only for the
 * same server and username; Google's consent through a fake Google (PKCE,
 * single-use state, the primary auth host only, the granted scope, the
 * `id_token`'s account), sending through the Gmail API, a cached access
 * token, revocation; the sending budget per sending account (the public
 * cap, the ceiling, the reset cap, the 70 % warning and the "exhausted"
 * notification once each, a provider's limit stopping the account for
 * 24 h until resumed); one retry for a transient failure; the health
 * check; decision D6 — a sending subdomain is no web hostname.
 *
 * fixtures/mail: a test CA and a server certificate for localhost /
 * 127.0.0.1 it signed (the CA's key was thrown away).
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Fastify from 'fastify';
import { SMTPServer } from 'smtp-server';

import { MAIL_BUDGET } from '@lamalibre/lamaste';
import { hostnameHolder } from '@lamalibre/lamaste/server';

const FIXTURES = new URL('./fixtures/mail/', import.meta.url);
const PRIMARY = 'relay.example';
const OTHER = 'other.example';
const CLIENT_ID = '123456789012-abcdefghijklmnop.apps.googleusercontent.com';
const CLIENT_SECRET = 'GOCSPX-test-client-secret';
const ACCOUNT = 'relay@codelama.example';
const SMTP_PASSWORD = 'smtp-password-never-echoed';
const GMAIL_SEND = 'https://www.googleapis.com/auth/gmail.send';

let dir;
let app;
let lib;
let caPem;
let smtp;
let googleServer;

// ---------------------------------------------------------------------------
// An SMTP sink: implicit TLS with a certificate only the test CA vouches for
// ---------------------------------------------------------------------------

const sink = {
  port: 0,
  messages: [],
  auths: [],
  /** Queue of answers for the next DATA commands: null = accept. */
  dataAnswers: [],
};

function startSink(key, cert) {
  const server = new SMTPServer({
    secure: true,
    key,
    cert,
    authMethods: ['PLAIN', 'LOGIN'],
    logger: false,
    onAuth(auth, _session, callback) {
      sink.auths.push(auth.username);
      if (auth.username === 'relay' && auth.password === SMTP_PASSWORD) {
        return callback(null, { user: auth.username });
      }
      return callback(Object.assign(new Error('Invalid credentials'), { responseCode: 535 }));
    },
    onData(stream, session, callback) {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        const answer = sink.dataAnswers.shift() ?? null;
        if (answer) return callback(Object.assign(new Error(answer.message), answer));
        sink.messages.push({
          from: session.envelope.mailFrom.address,
          to: session.envelope.rcptTo.map((r) => r.address),
          raw: Buffer.concat(chunks).toString('utf-8'),
        });
        return callback();
      });
    },
  });
  // A client that gives up mid-handshake (the untrusted-certificate test) is
  // the server's error event, not the test's.
  server.on('error', () => {});
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      sink.port = server.server.address().port;
      resolve(server);
    });
  });
}

// ---------------------------------------------------------------------------
// A fake Google: the token endpoint, revocation and messages.send
// ---------------------------------------------------------------------------

const google = {
  /** What a refresh answers: 'ok' | 'invalid_grant' | 'no_scope' | 'other_account'. */
  refresh: 'ok',
  /** What messages.send answers: 'ok' | 'limit' | '503'. */
  send: 'ok',
  /** What the code exchange grants. */
  scope: `openid ${GMAIL_SEND} https://www.googleapis.com/auth/userinfo.email`,
  challenge: null,
  refreshes: 0,
  sent: [],
  revoked: [],
};

function idToken(claims) {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${enc({ alg: 'RS256' })}.${enc({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: ACCOUNT,
    email_verified: true,
    ...claims,
  })}.c2ln`;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf-8');
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function startGoogle() {
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.url === '/token') {
      const form = new URLSearchParams(body);
      if (form.get('client_id') !== CLIENT_ID || form.get('client_secret') !== CLIENT_SECRET) {
        return json(res, 401, { error: 'invalid_client' });
      }
      if (form.get('grant_type') === 'authorization_code') {
        const challenge = crypto
          .createHash('sha256')
          .update(form.get('code_verifier') ?? '')
          .digest('base64url');
        if (form.get('code') !== 'good-code' || challenge !== google.challenge) {
          return json(res, 400, { error: 'invalid_grant' });
        }
        return json(res, 200, {
          access_token: 'access-from-code',
          expires_in: 3600,
          refresh_token: 'refresh-token-1',
          scope: google.scope,
          id_token: idToken({}),
        });
      }
      google.refreshes += 1;
      if (google.refresh === 'invalid_grant') return json(res, 400, { error: 'invalid_grant' });
      return json(res, 200, {
        access_token: `access-${google.refreshes}`,
        expires_in: 3600,
        scope: google.refresh === 'no_scope' ? 'openid email' : google.scope,
        id_token: idToken(
          google.refresh === 'other_account' ? { email: 'else@codelama.example' } : {},
        ),
      });
    }
    if (req.url === '/revoke') {
      google.revoked.push(new URLSearchParams(body).get('token'));
      return json(res, 200, {});
    }
    if (req.url === '/gmail/v1/users/me/messages/send') {
      if (!/^Bearer access-/.test(req.headers.authorization ?? '')) {
        return json(res, 401, { error: { code: 401 } });
      }
      if (google.send === 'limit') {
        return json(res, 403, {
          error: { code: 403, errors: [{ reason: 'dailyLimitExceeded' }], message: 'Limit' },
        });
      }
      if (google.send === '503') return json(res, 503, { error: { code: 503 } });
      google.sent.push(Buffer.from(JSON.parse(body).raw, 'base64url').toString('utf-8'));
      return json(res, 200, { id: 'm1', threadId: 't1' });
    }
    return json(res, 404, {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------------------
// The app
// ---------------------------------------------------------------------------

function call(method, url, payload, { role = 'admin', host } = {}) {
  return app.inject({
    method,
    url,
    headers: { 'x-test-role': role, ...(host ? { host } : {}) },
    ...(payload === undefined ? {} : { payload }),
  });
}

function smtpBody(over = {}) {
  return {
    host: '127.0.0.1',
    port: sink.port,
    security: 'tls',
    username: 'relay',
    password: SMTP_PASSWORD,
    caPem,
    senderAddress: 'no-reply@notify.relay.example',
    senderName: 'Code Lama',
    ...over,
  };
}

async function db() {
  return lib.getStateDb();
}

async function notifications(fragment) {
  const { notifications: rows } = await lib.listNotifications({ limit: 200 });
  return rows.filter((n) => n.message.includes(fragment));
}

async function resetMailState() {
  const d = await db();
  d.exec('DELETE FROM mail_transports; DELETE FROM mail_accounts; DELETE FROM mail_sends;');
  d.exec('DELETE FROM mail_oauth_pending; DELETE FROM notifications;');
  sink.messages.length = 0;
  sink.auths.length = 0;
  sink.dataAnswers.length = 0;
  Object.assign(google, {
    refresh: 'ok',
    send: 'ok',
    scope: `openid ${GMAIL_SEND} https://www.googleapis.com/auth/userinfo.email`,
    refreshes: 0,
    sent: [],
    revoked: [],
  });
  lib.forgetGmailAccessTokens();
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-mail-'));
  const stateDir = path.join(dir, 'state');
  await mkdir(stateDir);
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_PKI_DIR = path.join(stateDir, 'pki');
  process.env.LAMALIBRE_LAMASTE_CONFIG = path.join(stateDir, 'panel.json');
  await writeFile(
    process.env.LAMALIBRE_LAMASTE_CONFIG,
    JSON.stringify({
      ip: '203.0.113.10',
      domain: PRIMARY,
      email: `ops@${PRIMARY}`,
      dataDir: stateDir,
      onboarding: { status: 'COMPLETED' },
    }),
  );

  caPem = await readFile(new URL('ca.pem', FIXTURES), 'utf-8');
  smtp = await startSink(
    await readFile(new URL('server.key', FIXTURES)),
    await readFile(new URL('server.pem', FIXTURES)),
  );
  googleServer = await startGoogle();
  process.env.LAMALIBRE_LAMASTE_TEST_GOOGLE_BASE_URL = `http://127.0.0.1:${googleServer.address().port}`;

  lib = {
    ...(await import('../src/lib/state-db.js')),
    ...(await import('../src/lib/config.js')),
    ...(await import('../src/lib/state.js')),
    ...(await import('../src/lib/notifications.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/mail.js')),
    ...(await import('../src/lib/mail-gmail.js')),
    ...(await import('../src/lib/mail-store.js')),
  };
  await lib.loadConfig();
  // Authelia's mail: the listener's files under the test directory, on a
  // free port; Authelia's configuration and restart stand-ins (the sync
  // after every change is tested in mail-submission.test.js).
  const { setMailSubmissionForTests } = await import('../src/lib/mail-submission.js');
  await mkdir(path.join(dir, 'authelia', 'certs'), { recursive: true });
  await setMailSubmissionForTests({
    dir: path.join(stateDir, 'mail-submission'),
    certsDir: path.join(dir, 'authelia', 'certs'),
    passwordFile: path.join(dir, 'authelia', 'mail-submission-password'),
    port: 0,
  });
  (await import('../src/lib/authelia.js')).setAutheliaForTests({
    restart: async () => {},
    mail: async () => ({ changed: false }),
  });
  const d = await db();
  const at = new Date().toISOString();
  d.prepare(
    "INSERT INTO domains (name, is_primary, status, created_at, activated_at) VALUES (?, 1, 'active', ?, ?)",
  ).run(PRIMARY, at, at);
  d.prepare(
    "INSERT INTO domains (name, is_primary, status, created_at, activated_at) VALUES (?, 0, 'active', ?, ?)",
  ).run(OTHER, at, at);

  app = Fastify({ logger: false });
  app.decorateRequest('certRole', null);
  app.addHook('onRequest', async (request) => {
    request.certRole = request.headers['x-test-role'] ?? 'unknown';
  });
  app.decorate('requireRole', (roles) => async (request, reply) => {
    if (request.certRole === 'admin' || roles.includes(request.certRole)) return;
    return reply.code(403).send({ error: 'Forbidden' });
  });
  const { default: mailRoutes } = await import('../src/routes/management/mail.js');
  const { default: mailCallbackRoutes } = await import('../src/routes/mail-callback.js');
  await app.register(mailRoutes, { prefix: '/api' });
  await app.register(mailCallbackRoutes);
  await app.ready();
});

after(async () => {
  await (await import('../src/lib/mail-submission.js')).setMailSubmissionForTests(null);
  (await import('../src/lib/authelia.js')).setAutheliaForTests(null);
  await app?.close();
  await new Promise((resolve) => smtp?.close(resolve));
  await new Promise((resolve) => googleServer?.close(resolve));
  delete process.env.LAMALIBRE_LAMASTE_TEST_GOOGLE_BASE_URL;
  await rm(dir, { recursive: true, force: true });
});

beforeEach(resetMailState);

// ---------------------------------------------------------------------------
// smtp
// ---------------------------------------------------------------------------

test('a refused body names its fields and never what was sent', async () => {
  const res = await call('PUT', '/api/settings/mail', smtpBody({ security: 'plain' }));
  assert.equal(res.statusCode, 400);
  assert.ok(!res.body.includes(SMTP_PASSWORD));
  assert.deepEqual(
    res.json().details.issues.map((i) => i.path.join('.')),
    ['security'],
  );
  const agent = await call('GET', '/api/settings/mail', undefined, { role: 'agent' });
  assert.equal(agent.statusCode, 403);
});

test('an smtp server only the private CA vouches for is refused without caPem', async () => {
  const res = await call('PUT', '/api/settings/mail', smtpBody({ caPem: undefined }));
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().code, 'mail_check_failed');
  assert.equal(res.json().reason, 'tls');
  assert.equal((await call('GET', '/api/settings/mail')).json().transport, null);
});

test('a leaf certificate is no CA bundle', async () => {
  const leaf = await readFile(new URL('server.pem', FIXTURES), 'utf-8');
  const res = await call('PUT', '/api/settings/mail', smtpBody({ caPem: leaf }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, 'invalid_ca_pem');
});

test('a wrong password is refused at the check', async () => {
  const res = await call('PUT', '/api/settings/mail', smtpBody({ password: 'wrong-password' }));
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().reason, 'auth');
});

test('an smtp transport with caPem is checked, stored and shown without its secret', async () => {
  const res = await call('PUT', '/api/settings/mail', smtpBody());
  assert.equal(res.statusCode, 200, res.body);
  const { transport } = res.json();
  assert.equal(transport.scope, 'relay');
  assert.equal(transport.kind, 'smtp');
  assert.deepEqual(transport.settings, {
    host: '127.0.0.1',
    port: sink.port,
    security: 'tls',
    username: 'relay',
    hasCaPem: true,
  });
  assert.equal(transport.hasSecret, true);
  assert.equal(transport.health.status, 'up');
  assert.deepEqual(
    { dailyLimit: transport.budget.dailyLimit, ceiling: transport.budget.ceiling },
    { dailyLimit: 500, ceiling: 450 },
  );
  const get = await call('GET', '/api/settings/mail');
  assert.ok(!get.body.includes(SMTP_PASSWORD));
  assert.ok(!get.body.includes('BEGIN CERTIFICATE'));
  const [audit] = await lib.listAudit({ action: 'mail.transport.set' });
  assert.ok(!JSON.stringify(audit).includes(SMTP_PASSWORD));
});

test('a stored password is kept only for the same server and username', async () => {
  assert.equal((await call('PUT', '/api/settings/mail', smtpBody())).statusCode, 200);
  const same = await call('PUT', '/api/settings/mail', smtpBody({ password: undefined }));
  assert.equal(same.statusCode, 200, same.body);
  const moved = await call(
    'PUT',
    '/api/settings/mail',
    smtpBody({ password: undefined, username: 'someone-else' }),
  );
  assert.equal(moved.statusCode, 400);
  assert.equal(moved.json().code, 'password_required');
});

test('a test mail goes through the sink, From the sender, To one recipient', async () => {
  await call('PUT', '/api/settings/mail', smtpBody());
  const res = await call('POST', '/api/settings/mail/test', { to: 'onur@codelama.example' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { mail: { status: 'sent' } });
  assert.equal(sink.messages.length, 1);
  const [message] = sink.messages;
  assert.equal(message.from, 'no-reply@notify.relay.example');
  assert.deepEqual(message.to, ['onur@codelama.example']);
  assert.match(message.raw, /^From: "?Code Lama"? <no-reply@notify\.relay\.example>/m);
  assert.match(message.raw, /^Auto-Submitted: auto-generated/m);
  assert.match(message.raw, /multipart\/alternative/);
  const [sent] = await lib.listAudit({ action: 'mail.sent' });
  assert.equal(sent?.details.recipientDomain, 'codelama.example');
  assert.ok(!JSON.stringify(sent).includes('onur@'));
});

test('a transient failure is tried once more', async () => {
  await call('PUT', '/api/settings/mail', smtpBody());
  sink.dataAnswers.push({ message: 'Try again later', responseCode: 451 });
  const res = await call('POST', '/api/settings/mail/test', { to: 'a@codelama.example' });
  assert.deepEqual(res.json(), { mail: { status: 'sent' } });
  const rows = (await db()).prepare('SELECT outcome FROM mail_sends ORDER BY id').all();
  assert.deepEqual(
    rows.map((r) => r.outcome),
    ['failed', 'sent'],
  );
});

// ---------------------------------------------------------------------------
// The sending budget
// ---------------------------------------------------------------------------

function sendAs(kind, sendClass, domain = null) {
  return lib.sendMail({
    domain,
    to: 'person@codelama.example',
    kind,
    sendClass,
    render: () => ({ subject: 'S', text: 'T', html: '<p>T</p>' }),
  });
}

test('public mail stops at its cap, essential goes on to the ceiling — notified once each', async () => {
  await call('PUT', '/api/settings/mail', smtpBody());
  const patch = await call('PATCH', '/api/settings/mail', { dailyLimit: 10 });
  assert.equal(patch.statusCode, 200);
  assert.deepEqual(
    [patch.json().transport.budget.ceiling, patch.json().transport.budget.publicCap],
    [9, 7],
  );

  for (let i = 0; i < 7; i++) assert.equal((await sendAs('invitation', 'public')).status, 'sent');
  assert.deepEqual(await sendAs('invitation', 'public'), {
    status: 'deferred-budget',
    error: 'public-cap',
  });
  assert.deepEqual(await sendAs('invitation', 'public'), {
    status: 'deferred-budget',
    error: 'public-cap',
  });
  assert.equal((await sendAs('test', 'essential')).status, 'sent');
  assert.equal((await sendAs('invitation', 'admin')).status, 'sent');
  assert.deepEqual(await sendAs('test', 'essential'), {
    status: 'deferred-budget',
    error: 'ceiling',
  });
  assert.equal(sink.messages.length, 9);
  assert.equal((await notifications('may send in 24 hours are used')).length, 1);
  assert.equal((await notifications('reached its sending budget')).length, 1);

  const { budget } = (await call('GET', '/api/settings/mail')).json().transport;
  assert.equal(budget.sent24h, 9);
  assert.deepEqual(budget.byClass, { essential: 1, admin: 1, public: 7 });
  assert.ok(budget.resumesAt);
});

test('reset mails stop at 30 an hour per sending account', async () => {
  await call('PUT', '/api/settings/mail', smtpBody());
  const d = await db();
  const row = lib.transportRow(d, null);
  for (let i = 0; i < MAIL_BUDGET.resetsPerHour; i++) {
    lib.recordAttempt(d, {
      accountKey: row.account_key,
      sendClass: 'public',
      kind: 'reset',
      at: new Date(),
    });
  }
  assert.deepEqual(await sendAs('reset', 'public'), {
    status: 'deferred-budget',
    error: 'reset-cap',
  });
  assert.equal((await sendAs('invitation', 'public')).status, 'sent');
});

test("a provider's limit reply stops the account for 24 hours until resumed", async () => {
  await call('PUT', '/api/settings/mail', smtpBody());
  sink.dataAnswers.push({ message: '5.7.1 Daily sending quota exceeded', responseCode: 550 });
  assert.deepEqual(await sendAs('test', 'essential'), {
    status: 'deferred-budget',
    error: 'limited',
  });
  assert.deepEqual(await sendAs('test', 'essential'), {
    status: 'deferred-budget',
    error: 'limited',
  });
  assert.equal(sink.messages.length, 0);
  const { budget } = (await call('GET', '/api/settings/mail')).json().transport;
  const hours = (Date.parse(budget.limitedUntil) - Date.now()) / 3_600_000;
  assert.ok(hours > 23.9 && hours <= 24);
  assert.equal((await notifications('refused')).length, 1);

  const resumed = await call('POST', '/api/settings/mail/resume');
  assert.equal(resumed.statusCode, 200);
  assert.equal(resumed.json().transport.budget.limitedUntil, null);
  assert.equal((await sendAs('test', 'essential')).status, 'sent');
});

// ---------------------------------------------------------------------------
// gmail-api: consent, sending, health
// ---------------------------------------------------------------------------

async function consent({ code = 'good-code', host = `auth.${PRIMARY}`, domain = null } = {}) {
  const base = domain === null ? '/api/settings/mail' : `/api/domains/${domain}/mail`;
  const start = await call('POST', `${base}/google/start`, {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    senderAddress: 'no-reply@notify.relay.example',
    senderName: 'Code Lama',
  });
  assert.equal(start.statusCode, 200, start.body);
  const url = new URL(start.json().authorizeUrl);
  google.challenge = url.searchParams.get('code_challenge');
  const state = url.searchParams.get('state');
  const callback = await call(
    'GET',
    `/mail/google/callback?code=${code}&state=${state}`,
    undefined,
    { role: 'none', host },
  );
  return { url, state, callback };
}

test("Google's consent: offline, PKCE, the state single use and only on the primary auth host", async () => {
  const { url, state, callback } = await consent();
  assert.equal(url.pathname, '/o/oauth2/v2/auth');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    `https://auth.${PRIMARY}/mail/google/callback`,
  );
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.deepEqual(
    url.searchParams.get('scope').split(' ').sort(),
    ['email', GMAIL_SEND, 'openid'].sort(),
  );
  assert.equal(callback.statusCode, 200, callback.body);
  assert.match(callback.headers['content-security-policy'], /default-src 'none'/);
  assert.match(callback.body, /no-reply@notify\.relay\.example/);

  const { transport } = (await call('GET', '/api/settings/mail')).json();
  assert.equal(transport.kind, 'gmail-api');
  assert.deepEqual(transport.settings, { clientId: CLIENT_ID, account: ACCOUNT });
  const shown = JSON.stringify(transport);
  assert.ok(!shown.includes(CLIENT_SECRET) && !shown.includes('refresh-token-1'));

  const replay = await call(
    'GET',
    `/mail/google/callback?code=good-code&state=${state}`,
    undefined,
    {
      role: 'none',
      host: `auth.${PRIMARY}`,
    },
  );
  assert.equal(replay.statusCode, 400);
});

test('the callback answers 404 on any other host, and the state is not spent there', async () => {
  const start = await call('POST', '/api/settings/mail/google/start', {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    senderAddress: 'no-reply@notify.relay.example',
  });
  const url = new URL(start.json().authorizeUrl);
  google.challenge = url.searchParams.get('code_challenge');
  const state = url.searchParams.get('state');
  for (const host of [`panel.${PRIMARY}`, `auth.${OTHER}`, '127.0.0.1:3100']) {
    const res = await call(
      'GET',
      `/mail/google/callback?code=good-code&state=${state}`,
      undefined,
      {
        role: 'none',
        host,
      },
    );
    assert.equal(res.statusCode, 404, host);
  }
  const ok = await call('GET', `/mail/google/callback?code=good-code&state=${state}`, undefined, {
    role: 'none',
    host: `auth.${PRIMARY}`,
  });
  assert.equal(ok.statusCode, 200);
});

test('a consent without gmail.send, a denied one and a wrong code store nothing', async () => {
  google.scope = 'openid email';
  try {
    assert.equal((await consent()).callback.statusCode, 400);
  } finally {
    google.scope = `openid ${GMAIL_SEND}`;
  }
  assert.equal((await consent({ code: 'bad-code' })).callback.statusCode, 400);
  const start = await call('POST', '/api/settings/mail/google/start', {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    senderAddress: 'no-reply@notify.relay.example',
  });
  const state = new URL(start.json().authorizeUrl).searchParams.get('state');
  const denied = await call(
    'GET',
    `/mail/google/callback?error=access_denied&state=${state}`,
    undefined,
    { role: 'none', host: `auth.${PRIMARY}` },
  );
  assert.equal(denied.statusCode, 400);
  assert.equal((await call('GET', '/api/settings/mail')).json().transport, null);
});

test('mail goes through the Gmail API with one cached access token', async () => {
  await consent();
  const refreshesAfterConsent = google.refreshes;
  for (let i = 0; i < 2; i++) {
    const res = await call('POST', '/api/settings/mail/test', { to: 'onur@codelama.example' });
    assert.deepEqual(res.json(), { mail: { status: 'sent' } });
  }
  assert.equal(google.sent.length, 2);
  assert.match(google.sent[0], /^From: "?Code Lama"? <no-reply@notify\.relay\.example>/m);
  assert.match(google.sent[0], /^To: onur@codelama\.example/m);
  assert.ok(google.refreshes - refreshesAfterConsent <= 1);
});

test('a Gmail sender other than the account answers a warning to test the From', async () => {
  await consent();
  const res = await call('PATCH', '/api/settings/mail', {
    senderAddress: 'hello@notify.relay.example',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().warnings?.[0]?.step, 'sender');
  const same = await call('PATCH', '/api/settings/mail', { senderAddress: ACCOUNT });
  assert.equal(same.json().warnings, undefined);
  // A domain's sender over the relay's Gmail transport is unchecked too.
  const domain = await call('PUT', `/api/domains/${OTHER}/mail/sender`, {
    senderAddress: 'hi@other.example',
  });
  assert.equal(domain.json().warnings?.[0]?.step, 'sender');
});

test("Google's daily limit stops every row on the account", async () => {
  await consent();
  await call('PUT', `/api/domains/${OTHER}/mail/sender`, { senderAddress: 'hi@other.example' });
  google.send = 'limit';
  assert.deepEqual(await sendAs('test', 'essential'), {
    status: 'deferred-budget',
    error: 'limited',
  });
  google.send = 'ok';
  assert.deepEqual(await sendAs('test', 'essential', OTHER), {
    status: 'deferred-budget',
    error: 'limited',
  });
  assert.equal(google.sent.length, 0);
});

test('the health check: a revoked grant goes down (consent again), a working one comes back', async () => {
  await consent();
  google.refresh = 'invalid_grant';
  lib.forgetGmailAccessTokens();
  await lib.checkMailTransports();
  let { transport } = (await call('GET', '/api/settings/mail')).json();
  assert.deepEqual([transport.health.status, transport.health.reason], ['down', 'invalid_grant']);
  assert.equal((await notifications('connect it again')).length, 1);
  google.refresh = 'other_account';
  await lib.checkMailTransports();
  ({ transport } = (await call('GET', '/api/settings/mail')).json());
  assert.equal(transport.health.reason, 'account_changed');
  google.refresh = 'ok';
  await lib.checkMailTransports();
  ({ transport } = (await call('GET', '/api/settings/mail')).json());
  assert.equal(transport.health.status, 'up');
  assert.equal((await notifications('sends again')).length, 1);
});

test('clearing a Gmail transport revokes its grant and says which domains go quiet', async () => {
  await consent();
  await call('PUT', `/api/domains/${OTHER}/mail/sender`, { senderAddress: 'hi@other.example' });
  const res = await call('DELETE', '/api/settings/mail');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().removed, true);
  assert.deepEqual(google.revoked, ['refresh-token-1']);
  assert.match(res.json().warnings.find((w) => w.step === 'domains').message, /other\.example/);
  assert.deepEqual(await sendAs('test', 'essential', OTHER), { status: 'not-configured' });
});

test("the id_token: Google's issuer, this client, unexpired, a verified address", () => {
  const ok = idToken({});
  assert.equal(lib.accountOfIdToken(ok, CLIENT_ID), ACCOUNT);
  for (const claims of [
    { iss: 'https://evil.example' },
    { aud: 'another-client' },
    { exp: Math.floor(Date.now() / 1000) - 1 },
    { email_verified: false },
    { email: 'not an address' },
  ]) {
    assert.throws(() => lib.accountOfIdToken(idToken(claims), CLIENT_ID), /id_token/);
  }
  assert.throws(() => lib.accountOfIdToken('not.a', CLIENT_ID), /id_token/);
});

// ---------------------------------------------------------------------------
// Domains' overrides
// ---------------------------------------------------------------------------

test("a domain's sender rides the relay's transport; an unknown domain is a 404", async () => {
  await call('PUT', '/api/settings/mail', smtpBody());
  const set = await call('PUT', `/api/domains/${OTHER}/mail/sender`, {
    senderAddress: 'hello@other.example',
    senderName: 'Other',
  });
  assert.equal(set.statusCode, 200, set.body);
  assert.deepEqual([set.json().transport.kind, set.json().transport.budget], [null, null]);
  const limit = await call('PATCH', `/api/domains/${OTHER}/mail`, { dailyLimit: 5 });
  assert.equal(limit.json().code, 'no_own_transport');
  const res = await call('POST', `/api/domains/${OTHER}/mail/test`, { to: 'a@codelama.example' });
  assert.deepEqual(res.json(), { mail: { status: 'sent' } });
  assert.equal(sink.messages[0].from, 'hello@other.example');
  assert.equal((await call('GET', '/api/domains/nowhere.example/mail')).statusCode, 404);
  assert.equal((await call('GET', '/api/domains/Not_A_Domain/mail')).statusCode, 400);
});

test('without any transport a mail is not-configured', async () => {
  assert.deepEqual(await sendAs('test', 'essential'), { status: 'not-configured' });
  assert.equal((await call('PATCH', '/api/settings/mail', { dailyLimit: 5 })).statusCode, 404);
});

// ---------------------------------------------------------------------------
// D6: a sending subdomain is no web hostname
// ---------------------------------------------------------------------------

test('a sending subdomain under a relay domain is held; one elsewhere is not', async () => {
  await call('PUT', '/api/settings/mail', smtpBody());
  await call('PUT', `/api/domains/${OTHER}/mail/sender`, { senderAddress: 'hi@other.example' });
  assert.deepEqual(await lib.mailSenderHostnames(), ['notify.relay.example']);
  assert.deepEqual(
    hostnameHolder('notify.relay.example', { mailSenderDomains: await lib.mailSenderHostnames() }),
    { kind: 'mail-sender', name: 'notify.relay.example' },
  );
});

test('a sender on a hostname a tunnel or the relay itself serves is refused', async () => {
  await call('PUT', '/api/settings/mail', smtpBody());
  await lib.writeTunnels([
    {
      id: crypto.randomUUID(),
      fqdn: `busy.${PRIMARY}`,
      subdomain: 'busy',
      port: 8080,
      enabled: true,
      agentLabel: 'a1',
      createdAt: new Date().toISOString(),
    },
  ]);
  try {
    for (const address of [`x@busy.${PRIMARY}`, `x@auth.${PRIMARY}`]) {
      const res = await call('PATCH', '/api/settings/mail', { senderAddress: address });
      assert.equal(res.statusCode, 409, address);
      assert.equal(res.json().code, 'mail_sender_host_taken');
    }
    const apex = await call('PATCH', '/api/settings/mail', { senderAddress: `x@${PRIMARY}` });
    assert.equal(apex.statusCode, 200);
  } finally {
    await lib.writeTunnels([]);
  }
});
