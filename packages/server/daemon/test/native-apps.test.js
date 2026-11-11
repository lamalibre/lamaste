/**
 * Native apps on the user surface, the panel's side (native-apps-design.md
 * D2, D4; review R1, R5, R7–R10, R12–R16): native clients registered on
 * application hosts and rendered into Authelia and Gatekeeper's projection;
 * the token broker in front of Authelia — pass-through for every other
 * client, grants made at the code exchange, rotation with compare-and-swap,
 * the grace window, reuse, Authelia's 5xx, revocation; the allow-list of the
 * bearer path; and every way a grant ends with the person's standing.
 * Authelia is a users file, a recorder and an in-memory issuer
 * (`fakeIssuer`); Gatekeeper a fake (`fake-gatekeeper.js`).
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import http from 'node:http';
import { readdir } from 'node:fs/promises';

import { normalizeIdentityBlock } from '@lamalibre/lamaste';
import { createCallerAssertionVerifier, createSignInEventsHandler } from '@lamalibre/lamaste/agent';

import { createFakeAutheliaStorage } from './fake-authelia-storage.js';
import { installFakeGatekeeper } from './fake-gatekeeper.js';

const D = 'relay.test';
const OTHER = 'other.test';
const HASH = '$2b$12$abcdefghijklmnopqrstuuJ2s4L6rjpDLHi3qL7Nn5D0o3M6a1g2a';
const IDENTITY = normalizeIdentityBlock({ roles: [{ id: 'viewer', label: 'Viewer' }] });
const SITE = { id: 'site-mx', kind: 'site', fqdn: `app.${D}` };
const TUNNEL = { id: 'tunnel-nx', kind: 'tunnel', fqdn: `api.${D}` };
const CLIENT = 'lamaste-native-mobile';
const TUNNEL_CLIENT = 'lamaste-native-ops';

let dir;
let stateDir;
let usersFile;
let users;
let lib;
let app;
let gatekeeper;
/** What the OIDC provider writer was last given: `{ clients, options }`. */
let provider = null;

const quiet = { info() {}, warn() {}, error() {}, debug() {}, child: () => quiet };
const person = (displayname, email, groups = []) => ({
  displayname,
  email,
  password: HASH,
  groups,
});

const registryEntry = (name) => ({
  name,
  route: name,
  packageName: `@lamalibre/${name}-server`,
  version: '1.0.0',
  capabilities: [],
  hosting: 'agent',
  agent: {},
  identity: IDENTITY,
  status: 'enabled',
  installedAt: '2026-11-10T00:00:00.000Z',
});

async function saveUsers() {
  await writeFile(usersFile, yaml.dump({ users }, { lineWidth: -1 }), { mode: 0o660 });
  await lib.reconcileDirectory({ confirmDelayMs: 0 });
}

const idOf = async (username) => (await lib.findDirectoryUser(username))?.userId ?? null;

async function call(method, url, payload) {
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

// ---------------------------------------------------------------------------
// An in-memory Authelia issuer behind the broker
// ---------------------------------------------------------------------------

const issuer = {
  /** code → username (one use) */
  codes: new Map(),
  /** refresh token → { username, clientId } (live) */
  refresh: new Map(),
  /** refresh tokens revoked through /api/oidc/revocation */
  revoked: [],
  /** every request: { path, headers, body } */
  calls: [],
  /** 'normal' | '500' | 'down' | 'invalid' */
  mode: 'normal',
  /** answers 500 to refreshes while the discovery stays up */
  failRefresh: false,
  /** run before Authelia answers a refresh (to race a revocation) */
  beforeRefresh: null,
  /** run before Authelia answers a code exchange (to race a client's deletion) */
  beforeCode: null,
};

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function accessToken(username, clientId, fqdn, domain = D) {
  const now = Math.floor(Date.now() / 1000);
  return [
    b64({ alg: 'RS256', typ: 'at+jwt', kid: 'lamaste-oidc' }),
    b64({
      iss: `https://auth.${domain}`,
      aud: [`https://${fqdn}`],
      client_id: clientId,
      preferred_username: username,
      exp: now + 900,
      iat: now,
      nbf: now,
      jti: crypto.randomUUID(),
      scp: ['openid', 'offline_access', 'profile'],
    }),
    crypto.randomBytes(32).toString('base64url'),
  ].join('.');
}

const json = (status, body, headers = {}) => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  body: Buffer.from(JSON.stringify(body)),
});

function hostOf(clientId) {
  return clientId === TUNNEL_CLIENT ? TUNNEL.fqdn : SITE.fqdn;
}

async function fakeIssuer({ method, path: urlPath, headers, body }) {
  issuer.calls.push({ path: urlPath, headers, body: body?.toString('utf-8') ?? '' });
  if (issuer.mode === 'down') throw new Error('connect ECONNREFUSED 127.0.0.1:9091');
  if (method === 'GET') return json(200, { issuer: `https://${headers['x-forwarded-host']}` });
  const form = new URLSearchParams(body.toString('utf-8'));
  const clientId = form.get('client_id');
  if (urlPath === '/api/oidc/revocation') {
    issuer.revoked.push(form.get('token'));
    issuer.refresh.delete(form.get('token'));
    return { status: 200, headers: {}, body: Buffer.alloc(0) };
  }
  if (!clientId?.startsWith('lamaste-native-')) {
    // Another client: echo what arrived, with a header of Authelia's own.
    return json(
      201,
      { echo: body.toString('utf-8'), authorization: headers.authorization ?? null },
      { 'x-authelia': 'yes', 'set-cookie': 'a=b' },
    );
  }
  if (issuer.mode === '500') return json(500, { error: 'server_error' });
  if (form.get('grant_type') === 'authorization_code') {
    if (issuer.beforeCode) await issuer.beforeCode();
    const username = issuer.codes.get(form.get('code'));
    if (!username) return json(400, { error: 'invalid_grant' });
    issuer.codes.delete(form.get('code'));
    const refresh = crypto.randomBytes(32).toString('base64url');
    issuer.refresh.set(refresh, { username, clientId });
    return json(200, {
      access_token: accessToken(username, clientId, hostOf(clientId)),
      refresh_token: form.get('scope') === 'no-offline' ? undefined : refresh,
      token_type: 'bearer',
      expires_in: 899,
    });
  }
  if (form.get('grant_type') === 'refresh_token') {
    if (issuer.beforeRefresh) await issuer.beforeRefresh();
    if (issuer.failRefresh) return json(500, { error: 'server_error' });
    const held = issuer.refresh.get(form.get('refresh_token'));
    if (!held) return json(400, { error: 'invalid_grant' });
    issuer.refresh.delete(form.get('refresh_token'));
    const next = crypto.randomBytes(32).toString('base64url');
    issuer.refresh.set(next, held);
    return json(200, {
      access_token:
        issuer.mode === 'invalid'
          ? accessToken(held.username, 'lamaste-native-elsewhere', hostOf(clientId))
          : accessToken(held.username, clientId, hostOf(clientId)),
      refresh_token: next,
      token_type: 'bearer',
      expires_in: 899,
    });
  }
  return json(400, { error: 'unsupported_grant_type' });
}

/** A request to the broker as nginx sends it. */
function broker(endpoint, form, { host = `auth.${D}`, authorization, userAgent } = {}) {
  return app.inject({
    method: 'POST',
    url: `/api/native-apps/oauth/${endpoint}`,
    headers: {
      host,
      'content-type': 'application/x-www-form-urlencoded',
      ...(authorization ? { authorization } : {}),
      ...(userAgent ? { 'user-agent': userAgent } : {}),
    },
    payload: typeof form === 'string' ? form : new URLSearchParams(form).toString(),
  });
}

/** A native sign-in for `username` through the broker: Authelia's answer. */
async function signIn(username, { clientId = CLIENT, deviceName, scope } = {}) {
  const code = `code-${crypto.randomUUID()}`;
  issuer.codes.set(code, username);
  const res = await broker(
    'token',
    {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: `https://${hostOf(clientId)}/oauth/callback`,
      code_verifier: 'v'.repeat(43),
      ...(deviceName ? { device_name: deviceName } : {}),
      ...(scope ? { scope } : {}),
    },
    { userAgent: 'TestApp/1.0 (iOS 18)' },
  );
  return res;
}

const refreshWith = (token, clientId = CLIENT) =>
  broker('token', { grant_type: 'refresh_token', refresh_token: token, client_id: clientId });

const sha = (token) => crypto.createHash('sha256').update(token).digest('hex');
const audits = (action) => lib.listAudit({ action, limit: 200 });
const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-native-'));
  stateDir = path.join(dir, 'state');
  await mkdir(stateDir);
  usersFile = path.join(dir, 'users.yml');
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_PKI_DIR = path.join(stateDir, 'pki');
  process.env.LAMALIBRE_LAMASTE_CONFIG = path.join(stateDir, 'panel.json');
  // The hosts' association files and redirect pages (native-files.js).
  process.env.LAMALIBRE_LAMASTE_NATIVE_FILES_ROOT = path.join(dir, 'native');
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

  lib = {
    ...(await import('../src/lib/state-db.js')),
    ...(await import('../src/lib/config.js')),
    ...(await import('../src/lib/authelia.js')),
    ...(await import('../src/lib/gatekeeper-client.js')),
    ...(await import('../src/lib/directory.js')),
    ...(await import('../src/lib/domains.js')),
    ...(await import('../src/lib/audience.js')),
    ...(await import('../src/lib/plugins.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/state.js')),
    ...(await import('../src/lib/native-apps.js')),
    ...(await import('../src/lib/native-grants.js')),
    ...(await import('../src/lib/native-broker.js')),
    ...(await import('../src/lib/notifications.js')),
    ...(await import('../src/lib/native-files.js')),
    ...(await import('../src/lib/sign-in-events.js')),
    ...(await import('../src/lib/plugin-hooks.js')),
  };
  await lib.loadConfig();
  lib.setAutheliaForTests({
    domainAccess: async () => ({ changed: false }),
    usersFile,
    restart: async () => {},
    writeTotp: async () => {},
    userStorage: createFakeAutheliaStorage().storage,
    oidcProvider: async (_domains, clients, options) => {
      provider = { clients, options };
      return { changed: true, clients: clients.length + (options.nativeClients ?? []).length };
    },
  });
  await lib.ensurePrimaryDomain();
  gatekeeper = installFakeGatekeeper(lib);
  lib.setNativeBrokerForTests(fakeIssuer);

  users = {
    admin: person('Admin', `admin@${D}`, ['admins']),
    ayse: person('Ayşe', `ayse@${D}`),
    mehmet: person('Mehmet', `mehmet@${D}`),
    zeynep: person('Zeynep', `zeynep@${D}`),
    ali: person('Ali', `ali@${D}`),
    selin: person('Selin', `selin@${D}`),
  };
  await saveUsers();
  await lib.writePlugins({ plugins: [registryEntry('mx'), registryEntry('nx')] });

  // The application hosts: mx's own site; a restricted tunnel bound to nx.
  // Both plugins hosted (their internal tunnels on agent-a).
  await lib.writeSites([
    {
      id: SITE.id,
      name: 'app',
      fqdn: SITE.fqdn,
      owner: { plugin: 'mx' },
      accessMode: 'authenticated',
    },
  ]);
  await lib.writeTunnels([
    {
      id: TUNNEL.id,
      type: 'app',
      subdomain: 'api',
      fqdn: TUNNEL.fqdn,
      port: 8080,
      agentLabel: 'agent-a',
      accessMode: 'restricted',
      enabled: true,
      userSurface: { routes: ['nx'] },
    },
    ...['mx', 'nx'].map((route, i) => ({
      id: `internal-${route}`,
      type: 'plugin',
      exposure: 'internal',
      pluginRoute: route,
      port: 21000 + i,
      agentLabel: 'agent-a',
      enabled: true,
    })),
  ]);

  // Roles: everyone but zeynep on mx; ayse and mehmet on nx; ayse holds
  // the restricted tunnel's grant, mehmet does not.
  for (const username of ['ayse', 'mehmet', 'ali', 'selin']) {
    gatekeeper.addGrant({
      principalType: 'user',
      principalId: username,
      resourceType: 'plugin',
      resourceId: 'mx',
      context: { roles: ['viewer'] },
    });
  }
  for (const username of ['ayse', 'mehmet']) {
    gatekeeper.addGrant({
      principalType: 'user',
      principalId: username,
      resourceType: 'plugin',
      resourceId: 'nx',
      context: { roles: ['viewer'] },
    });
  }
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'ayse',
    resourceType: 'tunnel',
    resourceId: TUNNEL.id,
    context: {},
  });
  await lib.recomputeAudiences({ logger: quiet });

  const { default: Fastify } = await import('fastify');
  const { default: errors } = await import('../src/middleware/errors.js');
  const { default: nativeAppsRoutes } = await import('../src/routes/management/native-apps.js');
  const { default: gatekeeperProxyRoutes } =
    await import('../src/routes/management/gatekeeper-proxy.js');
  const { default: nativeOauthContext } = await import('../src/routes/native-oauth.js');
  app = Fastify({ logger: false });
  app.register(async function protectedContext(scope) {
    await scope.register(errors);
    scope.decorateRequest('certRole', null);
    scope.addHook('onRequest', async (request) => {
      request.certRole = request.headers['x-test-role'] ?? 'unknown';
    });
    scope.decorate('requireRole', (roles) => async (request, reply) => {
      if (request.certRole === 'admin' || roles.includes(request.certRole)) return;
      return reply.code(403).send({ error: 'forbidden' });
    });
    await scope.register(nativeAppsRoutes, { prefix: '/api' });
    await scope.register(gatekeeperProxyRoutes, { prefix: '/api' });
  });
  app.register(nativeOauthContext);
  await app.ready();
});

after(async () => {
  lib.setAutheliaForTests(null);
  lib.setGatekeeperClientForTests(null);
  lib.setNativeBrokerForTests(null);
  lib.stopNativeServices();
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  issuer.mode = 'normal';
  issuer.failRefresh = false;
  issuer.beforeRefresh = null;
  issuer.beforeCode = null;
});

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

test('a native client is registered on an application host, rendered into Authelia and projected for Gatekeeper', async () => {
  const res = await call('POST', '/api/native-apps', {
    slug: 'mobile',
    hostKind: 'site',
    hostId: SITE.id,
    name: 'Mobile',
    redirectPaths: ['/oauth/callback'],
    idleDays: 30,
    absoluteDays: 90,
    associations: { ios: { teamId: 'ABCDE12345', bundleIds: ['com.example.app'] } },
  });
  assert.equal(res.statusCode, 201, res.body);
  const { client } = res.json();
  assert.equal(client.clientId, CLIENT);
  assert.equal(client.fqdn, SITE.fqdn);
  assert.equal(client.domain, D);
  assert.equal(client.served, true);
  assert.equal(client.audience, `https://${SITE.fqdn}`);
  assert.deepEqual(client.redirectUris, [`https://${SITE.fqdn}/oauth/callback`]);
  assert.deepEqual(client.routes, ['mx']);

  assert.deepEqual(
    provider.options.nativeClients.map((c) => [c.clientId, c.fqdn, c.domain, c.idleDays]),
    [[CLIENT, SITE.fqdn, D, 30]],
  );
  const projection = JSON.parse(await readFile(path.join(stateDir, 'native-apps.json'), 'utf-8'));
  assert.deepEqual(projection, {
    v: 1,
    clients: [{ clientId: CLIENT, fqdn: SITE.fqdn, domain: D, enabled: true }],
  });
  assert.equal((await audits('native-app.created')).length, 1);

  const tunnelClient = await call('POST', '/api/native-apps', {
    slug: 'ops',
    hostKind: 'tunnel',
    hostId: TUNNEL.id,
    name: 'Ops',
    redirectPaths: ['/cb'],
  });
  assert.equal(tunnelClient.statusCode, 201, tunnelClient.body);
  assert.equal(tunnelClient.json().client.accessMode, 'restricted');
});

test('registration refusals: no application host, a taken id, a host with a client, a bad schema', async () => {
  const refused = async (body, status, code) => {
    const res = await call('POST', '/api/native-apps', body);
    assert.equal(res.statusCode, status, res.body);
    assert.equal(res.json().code, code);
  };
  const base = { name: 'X', redirectPaths: ['/cb'] };
  await refused(
    { ...base, slug: 'nohost', hostKind: 'tunnel', hostId: 'internal-mx' },
    400,
    'not_an_application_host',
  );
  await refused(
    { ...base, slug: 'nohost', hostKind: 'site', hostId: 'missing' },
    400,
    'not_an_application_host',
  );
  await refused(
    { ...base, slug: 'mobile', hostKind: 'site', hostId: SITE.id },
    409,
    'client_exists',
  );
  await refused(
    { ...base, slug: 'second', hostKind: 'site', hostId: SITE.id },
    409,
    'host_has_client',
  );
  await refused(
    { ...base, slug: 'bad', hostKind: 'site', hostId: SITE.id, redirectPaths: ['/api/x'] },
    400,
    'invalid_request',
  );
  await refused(
    { ...base, slug: 'bad', hostKind: 'site', hostId: SITE.id, idleDays: 100, absoluteDays: 90 },
    400,
    'invalid_request',
  );
});

// ---------------------------------------------------------------------------
// The broker
// ---------------------------------------------------------------------------

test('another client’s request reaches Authelia byte for byte, and its answer comes back as it came', async () => {
  const body =
    'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code&client_id=mx-cli&device_code=x';
  const before = issuer.calls.length;
  const res = await broker('token', body, { authorization: 'Basic bXgtY2xpOnNlY3JldA==' });
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers['x-authelia'], 'yes');
  assert.deepEqual(res.json(), { echo: body, authorization: 'Basic bXgtY2xpOnNlY3JldA==' });
  const sent = issuer.calls[before];
  assert.equal(sent.path, '/api/oidc/token');
  assert.equal(sent.headers['x-forwarded-host'], `auth.${D}`);
  assert.equal(sent.headers['x-forwarded-proto'], 'https');
  // Not a portal of an active domain: nothing reaches Authelia.
  const elsewhere = await broker('token', body, { host: `panel.${D}` });
  assert.equal(elsewhere.statusCode, 404);
  assert.equal(issuer.calls.length, before + 1);
});

test('a native sign-in makes a grant: hashes only, the device named, the sign-in announced', async () => {
  const seen = [];
  const listener = (event) => seen.push(event);
  lib.nativeSignIns.on('sign-in', listener);
  const res = await signIn('ayse', { deviceName: 'Ayşe’s phone' });
  lib.nativeSignIns.off('sign-in', listener);
  assert.equal(res.statusCode, 200, res.body);
  const issued = res.json();
  assert.ok(issued.refresh_token && issued.access_token);
  // device_name is Lamaste's: Authelia never saw it.
  assert.doesNotMatch(issuer.calls.at(-1).body, /device_name/);

  const found = await lib.findRefreshToken(sha(issued.refresh_token));
  assert.equal(found.token.state, 'current');
  assert.equal(found.grant.deviceName, 'Ayşe’s phone');
  assert.equal(found.grant.userAgent, 'TestApp/1.0 (iOS 18)');
  const ayse = await idOf('ayse');
  assert.deepEqual(await lib.liveAccessToken(sha(issued.access_token), CLIENT, 'ayse'), {
    ok: true,
    grantId: found.grant.grantId,
    userId: ayse,
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].userId, ayse);
  // Nothing stored holds a token.
  const db = await lib.getStateDb();
  const dump = JSON.stringify([
    db.prepare('SELECT * FROM native_grants').all(),
    db.prepare('SELECT * FROM native_refresh_tokens').all(),
    db.prepare('SELECT * FROM native_access_tokens').all(),
  ]);
  assert.ok(!dump.includes(issued.refresh_token) && !dump.includes(issued.access_token));
});

test('a sign-in without offline_access, or by someone without standing, makes no grant and revokes what Authelia issued', async () => {
  const noOffline = await signIn('ayse', { scope: 'no-offline' });
  assert.equal(noOffline.statusCode, 400);
  assert.equal(noOffline.json().error, 'invalid_scope');

  // zeynep holds no role on mx.
  const revokedBefore = issuer.revoked.length;
  const refused = await signIn('zeynep');
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.json().error, 'invalid_grant');
  assert.equal(issuer.revoked.length, revokedBefore + 1, 'the refresh token revoked at Authelia');
  assert.deepEqual(await lib.listNativeGrants({ userId: await idOf('zeynep') }), []);

  // mehmet has a role on nx but not the restricted tunnel's grant.
  const noGrant = await signIn('mehmet', { clientId: TUNNEL_CLIENT });
  assert.equal(noGrant.statusCode, 400);
  // ayse holds it.
  assert.equal((await signIn('ayse', { clientId: TUNNEL_CLIENT })).statusCode, 200);
});

test('client classification (R1, R5): Basic auth, a known token without client_id, another domain, an unknown native id', async () => {
  const { refresh_token: token } = (await signIn('ali')).json();
  const basic = `Basic ${Buffer.from(`${CLIENT}:`).toString('base64')}`;
  const before = issuer.calls.length;
  // A native client named over Basic, no client_id: native, and refused.
  const viaBasic = await broker(
    'token',
    { grant_type: 'refresh_token', refresh_token: token },
    { authorization: basic },
  );
  assert.equal(viaBasic.statusCode, 401);
  assert.equal(viaBasic.json().error, 'invalid_client');
  // The known token under another client's Basic: native still.
  const disguised = await broker(
    'token',
    { grant_type: 'refresh_token', refresh_token: token },
    { authorization: `Basic ${Buffer.from('mx-cli:').toString('base64')}` },
  );
  assert.equal(disguised.statusCode, 401);
  assert.equal(issuer.calls.length, before, 'nothing reached Authelia');
  // An unknown lamaste-native id is never passed through.
  const unknown = await broker('token', {
    grant_type: 'authorization_code',
    code: 'x',
    client_id: 'lamaste-native-nobody',
  });
  assert.equal(unknown.statusCode, 401);
  assert.equal(issuer.calls.length, before);
  // A token still good afterwards: nothing was spent.
  assert.equal((await refreshWith(token)).statusCode, 200);
});

test('a native client of one domain is refused at another domain’s portal (R5)', async () => {
  await lib.addDomain(OTHER, { actor: 'test', logger: quiet }).catch(() => {});
  const db = await lib.getStateDb();
  db.prepare("UPDATE domains SET status = 'active', activated_at = ? WHERE name = ?").run(
    new Date().toISOString(),
    OTHER,
  );
  const code = 'code-cross';
  issuer.codes.set(code, 'ali');
  const res = await broker(
    'token',
    { grant_type: 'authorization_code', code, client_id: CLIENT, code_verifier: 'v'.repeat(43) },
    { host: `auth.${OTHER}` },
  );
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, 'invalid_client');
  assert.ok(issuer.codes.has(code), 'the code never reached Authelia');
  // One domain again: a new user joins it (the later tests make one).
  await lib.removeDomain(OTHER, { actor: 'test', logger: quiet });
});

test('refresh: rotation, the grace window (R8), then reuse ends the grant (audited, notified)', async () => {
  const first = (await signIn('selin')).json();
  const second = await refreshWith(first.refresh_token);
  assert.equal(second.statusCode, 200);
  const rotated = second.json();
  assert.notEqual(rotated.refresh_token, first.refresh_token);
  const grantId = (await lib.findRefreshToken(sha(rotated.refresh_token))).grant.grantId;
  assert.equal((await lib.findRefreshToken(sha(first.refresh_token))).token.state, 'spent');
  assert.equal((await lib.liveAccessToken(sha(rotated.access_token), CLIENT, 'selin')).ok, true);

  // A lost answer: the spent token within 30 s gets the same answer.
  const again = await refreshWith(first.refresh_token);
  assert.equal(again.statusCode, 200);
  assert.deepEqual(again.json(), rotated);

  // After the window it is a reuse.
  const db = await lib.getStateDb();
  db.prepare('UPDATE native_refresh_tokens SET grace_until = ? WHERE sha256 = ?').run(
    Date.now() - 1,
    sha(first.refresh_token),
  );
  const reuse = await refreshWith(first.refresh_token);
  assert.equal(reuse.statusCode, 400);
  assert.equal(reuse.json().error, 'invalid_grant');
  const grant = await lib.getNativeGrant(grantId);
  assert.equal(grant.revokedReason, 'reuse');
  assert.equal((await lib.liveAccessToken(sha(rotated.access_token), CLIENT, 'selin')).ok, false);
  assert.equal((await refreshWith(rotated.refresh_token)).statusCode, 400, 'its current token too');
  assert.equal((await audits('native-app.grant.reuse-detected')).length, 1);
  assert.ok((await lib.listNotifications()).notifications.some((n) => n.source === 'native-apps'));
});

test('two refreshes at once with one token: one rotation, the second gets its answer', async () => {
  const { refresh_token: token } = (await signIn('ali')).json();
  const [a, b] = await Promise.all([refreshWith(token), refreshWith(token)]);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.deepEqual(a.json(), b.json());
  const found = await lib.findRefreshToken(sha(a.json().refresh_token));
  assert.equal(found.grant.revokedAt, null);
});

test('a revocation racing a refresh wins: the new token is revoked at Authelia (R7)', async () => {
  const { refresh_token: token } = (await signIn('ali')).json();
  const grantId = (await lib.findRefreshToken(sha(token))).grant.grantId;
  issuer.beforeRefresh = async () => {
    issuer.beforeRefresh = null;
    await lib.revokeNativeGrants({ grantId }, 'revoked_by_admin');
  };
  const revokedBefore = issuer.revoked.length;
  const res = await refreshWith(token);
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, 'invalid_grant');
  assert.equal(issuer.revoked.length, revokedBefore + 1);
  assert.equal((await lib.getNativeGrant(grantId)).revokedReason, 'revoked_by_admin');
});

test('Authelia’s 5xx (R9): down keeps the grant; up three times ends it', async () => {
  const { refresh_token: token } = (await signIn('ali')).json();
  const grantId = (await lib.findRefreshToken(sha(token))).grant.grantId;
  issuer.mode = 'down';
  for (let i = 0; i < 4; i += 1) assert.equal((await refreshWith(token)).statusCode, 503);
  assert.equal((await lib.getNativeGrant(grantId)).revokedAt, null);
  issuer.mode = 'normal';
  issuer.failRefresh = true;
  assert.equal((await refreshWith(token)).statusCode, 503);
  assert.equal((await refreshWith(token)).statusCode, 503);
  assert.equal((await refreshWith(token)).statusCode, 400);
  assert.equal((await lib.getNativeGrant(grantId)).revokedReason, 'issuer_refused');
});

test('Authelia refusing the current token ends the grant; an unknown token never reaches it', async () => {
  const { refresh_token: token } = (await signIn('ali')).json();
  const grantId = (await lib.findRefreshToken(sha(token))).grant.grantId;
  issuer.refresh.delete(token);
  assert.equal((await refreshWith(token)).statusCode, 400);
  assert.equal((await lib.getNativeGrant(grantId)).revokedReason, 'issuer_refused');
  const before = issuer.calls.length;
  assert.equal((await refreshWith('never-issued')).statusCode, 400);
  assert.equal(issuer.calls.length, before);
});

test('an access token Authelia gives another client never makes a rotation', async () => {
  const { refresh_token: token } = (await signIn('ali')).json();
  issuer.mode = 'invalid';
  const res = await refreshWith(token);
  assert.equal(res.statusCode, 400);
  const grant = (await lib.findRefreshToken(sha(token))).grant;
  assert.equal(grant.revokedReason, 'issuer_refused');
});

test('lifetimes: idle and absolute end a grant at refresh and on the bearer path (R10)', async () => {
  const idle = (await signIn('ali')).json();
  const idleGrant = (await lib.findRefreshToken(sha(idle.refresh_token))).grant;
  const abs = (await signIn('ali')).json();
  const absGrant = (await lib.findRefreshToken(sha(abs.refresh_token))).grant;
  const db = await lib.getStateDb();
  db.prepare('UPDATE native_grants SET last_used_at = ? WHERE grant_id = ?').run(
    Date.now() - 31 * 86_400_000,
    idleGrant.grantId,
  );
  db.prepare('UPDATE native_grants SET absolute_expires_at = ? WHERE grant_id = ?').run(
    Date.now() - 1,
    absGrant.grantId,
  );
  assert.deepEqual(await lib.liveAccessToken(sha(idle.access_token), CLIENT, 'ali'), {
    ok: false,
    reason: 'grant_expired',
  });
  assert.equal((await refreshWith(idle.refresh_token)).statusCode, 400);
  assert.equal((await refreshWith(abs.refresh_token)).statusCode, 400);
  assert.equal((await lib.getNativeGrant(idleGrant.grantId)).revokedReason, 'idle_expired');
  assert.equal((await lib.getNativeGrant(absGrant.grantId)).revokedReason, 'absolute_expired');
});

test('the allow-list: another client, another user, an unknown token', async () => {
  const { access_token: at } = (await signIn('ali')).json();
  assert.deepEqual(await lib.liveAccessToken(sha(at), TUNNEL_CLIENT, 'ali'), {
    ok: false,
    reason: 'wrong_client',
  });
  assert.deepEqual(await lib.liveAccessToken(sha(at), CLIENT, 'ayse'), {
    ok: false,
    reason: 'wrong_user',
  });
  assert.deepEqual(await lib.liveAccessToken(sha('x'), CLIENT, 'ali'), {
    ok: false,
    reason: 'unknown',
  });
});

test('the revocation endpoint ends the app’s grant, answers 200, and tells Authelia', async () => {
  const issued = (await signIn('ali')).json();
  const grantId = (await lib.findRefreshToken(sha(issued.refresh_token))).grant.grantId;
  const res = await broker('revocation', {
    token: issued.refresh_token,
    token_type_hint: 'refresh_token',
    client_id: CLIENT,
  });
  assert.equal(res.statusCode, 200);
  assert.equal((await lib.getNativeGrant(grantId)).revokedReason, 'revoked_by_client');
  assert.ok(issuer.revoked.includes(issued.refresh_token));
  // Another client's id on a known token revokes nothing (RFC 7009).
  const other = (await signIn('ali')).json();
  const otherGrant = (await lib.findRefreshToken(sha(other.refresh_token))).grant.grantId;
  await broker('revocation', { token: other.refresh_token, client_id: TUNNEL_CLIENT });
  assert.equal((await lib.getNativeGrant(otherGrant)).revokedAt, null);
});

test('native rate limits apply to native requests only (R16)', async () => {
  lib.setNativeBrokerForTests(fakeIssuer);
  const passBody = 'grant_type=x&client_id=mx-cli';
  for (let i = 0; i < 130; i += 1) {
    assert.equal((await broker('token', passBody)).statusCode, 201);
  }
  let limited = 0;
  for (let i = 0; i < 125; i += 1) {
    const res = await refreshWith('never-issued');
    if (res.statusCode === 429) limited += 1;
  }
  assert.ok(limited > 0, 'native requests from one address are limited');
  lib.setNativeBrokerForTests(fakeIssuer);
});

// ---------------------------------------------------------------------------
// Standing
// ---------------------------------------------------------------------------

test('disabling or removing a person ends their grants at once (offboarding)', async () => {
  const issued = (await signIn('ali')).json();
  const grantId = (await lib.findRefreshToken(sha(issued.refresh_token))).grant.grantId;
  users.ali = { ...users.ali, disabled: true };
  await saveUsers();
  assert.equal((await lib.getNativeGrant(grantId)).revokedReason, 'standing:disabled');
  assert.equal((await lib.liveAccessToken(sha(issued.access_token), CLIENT, 'ali')).ok, false);
  delete users.ali.disabled;
  await saveUsers();
});

test('losing the last role ends the grant after the recompute; a host grant revoked through the proxy ends it too', async () => {
  const mx = (await signIn('selin')).json();
  const mxGrant = (await lib.findRefreshToken(sha(mx.refresh_token))).grant.grantId;
  const role = gatekeeper.grants.find((g) => g.principalId === 'selin' && g.resourceId === 'mx');
  gatekeeper.grants.splice(gatekeeper.grants.indexOf(role), 1);
  await lib.recomputeAudiences({ logger: quiet });
  await lib.scheduleNativeStandingCheck({});
  assert.equal((await lib.getNativeGrant(mxGrant)).revokedReason, 'standing:no_role');

  const nx = (await signIn('ayse', { clientId: TUNNEL_CLIENT })).json();
  const nxGrant = (await lib.findRefreshToken(sha(nx.refresh_token))).grant.grantId;
  const hostGrant = gatekeeper.grants.find(
    (g) => g.principalId === 'ayse' && g.resourceType === 'tunnel',
  );
  const res = await call('DELETE', `/api/gatekeeper/grants/${hostGrant.grantId}`);
  assert.ok(res.statusCode < 400, res.body);
  await settle();
  await lib.scheduleNativeStandingCheck({ checkHostGrant: true });
  assert.equal((await lib.getNativeGrant(nxGrant)).revokedReason, 'standing:no_grant');
});

test('Gatekeeper unreachable never ends a grant, and a refresh then answers 503', async () => {
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'ayse',
    resourceType: 'tunnel',
    resourceId: TUNNEL.id,
    context: {},
  });
  const nx = (await signIn('ayse', { clientId: TUNNEL_CLIENT })).json();
  const grantId = (await lib.findRefreshToken(sha(nx.refresh_token))).grant.grantId;
  gatekeeper.state.unreachable = true;
  try {
    assert.equal(await lib.runNativeStandingCheck({ checkHostGrant: true }), 0);
    assert.equal((await refreshWith(nx.refresh_token, TUNNEL_CLIENT)).statusCode, 503);
    assert.equal((await lib.getNativeGrant(grantId)).revokedAt, null);
  } finally {
    gatekeeper.state.unreachable = false;
  }
});

test('leaving the domain ends the grant (the recompute after a membership change)', async () => {
  const issued = (await signIn('ayse')).json();
  const grantId = (await lib.findRefreshToken(sha(issued.refresh_token))).grant.grantId;
  await lib.removeDomainMember(D, 'ayse', { actor: 'test', logger: quiet });
  await settle();
  await lib.scheduleNativeStandingCheck({});
  assert.equal((await lib.getNativeGrant(grantId)).revokedReason, 'standing:not_member');
  await lib.addDomainMember(D, 'ayse', { actor: 'test', logger: quiet });
});

test('erasing a removed person forgets their grants and queued events', async () => {
  users.erasable = person('E', `e@${D}`);
  await saveUsers();
  gatekeeper.addGrant({
    principalType: 'user',
    principalId: 'erasable',
    resourceType: 'plugin',
    resourceId: 'mx',
    context: { roles: ['viewer'] },
  });
  await lib.recomputeAudiences({ logger: quiet });
  const issued = (await signIn('erasable')).json();
  const userId = await idOf('erasable');
  const db = await lib.getStateDb();
  db.prepare(
    "INSERT INTO native_sign_in_events (plugin, user_id, at, client_id) VALUES ('mx', ?, ?, ?)",
  ).run(userId, Date.now(), CLIENT);
  delete users.erasable;
  await saveUsers();
  const ended = (await lib.listNativeGrants({ userId, status: 'all' }))[0];
  assert.equal(ended.endedReason, 'standing:removed');
  await lib.eraseDirectoryUser(userId, { actor: 'test', logger: quiet });
  assert.deepEqual(await lib.listNativeGrants({ userId, status: 'all' }), []);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM native_sign_in_events WHERE user_id = ?').get(userId).n,
    0,
  );
  assert.equal(await lib.findRefreshToken(sha(issued.refresh_token)), null);
});

// ---------------------------------------------------------------------------
// The API, disabling and deleting
// ---------------------------------------------------------------------------

test('grants are listed per client and per person, and an administrator ends one or all of a person’s', async () => {
  const one = (await signIn('mehmet', { deviceName: 'Phone' })).json();
  await signIn('mehmet', { deviceName: 'Tablet' });
  const mehmet = await idOf('mehmet');
  const listed = await call('GET', `/api/native-apps/${CLIENT}/grants?userId=${mehmet}`);
  assert.equal(listed.statusCode, 200);
  const grants = listed.json().grants;
  assert.deepEqual(grants.map((g) => g.deviceName).sort(), ['Phone', 'Tablet']);
  assert.ok(grants.every((g) => g.username === 'mehmet' && g.status === 'live'));
  const byUser = await call('GET', '/api/users/mehmet/native-grants');
  assert.equal(byUser.json().grants.length, 2);

  const phone = grants.find((g) => g.deviceName === 'Phone');
  const del = await call('DELETE', `/api/native-apps/${CLIENT}/grants/${phone.grantId}`);
  assert.deepEqual(del.json(), { ok: true, ended: 1 });
  assert.equal((await lib.getNativeGrant(phone.grantId)).revokedReason, 'revoked_by_admin');
  assert.equal((await refreshWith(one.refresh_token)).statusCode, 400);
  const all = await call('POST', `/api/native-apps/${CLIENT}/grants/revoke`, { userId: mehmet });
  assert.deepEqual(all.json(), { ok: true, ended: 1 });
  assert.equal(
    (await call('GET', `/api/native-apps/${CLIENT}/grants?status=ended&userId=${mehmet}`)).json()
      .grants.length,
    2,
  );
  assert.equal(
    (await call('GET', `/api/native-apps/${CLIENT}/grants?status=nope`)).statusCode,
    400,
  );
});

test('disabling a client ends its grants and takes it out of Authelia and the projection', async () => {
  const issued = (await signIn('ali')).json();
  const grantId = (await lib.findRefreshToken(sha(issued.refresh_token))).grant.grantId;
  const res = await call('PATCH', `/api/native-apps/${CLIENT}`, { enabled: false });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().client.served, false);
  assert.equal((await lib.getNativeGrant(grantId)).revokedReason, 'client_disabled');
  assert.ok(!provider.options.nativeClients.some((c) => c.clientId === CLIENT));
  const projection = JSON.parse(await readFile(path.join(stateDir, 'native-apps.json'), 'utf-8'));
  assert.ok(!projection.clients.some((c) => c.clientId === CLIENT));
  // A disabled client signs no one in.
  assert.equal((await signIn('ali')).statusCode, 401);
  assert.equal(
    (await call('PATCH', `/api/native-apps/${CLIENT}`, { enabled: true })).json().client.served,
    true,
  );
  const bad = await call('PATCH', `/api/native-apps/${CLIENT}`, { idleDays: 200 });
  assert.equal(bad.statusCode, 400);
});

test('a deleted host takes its client with it (host_deleted)', async () => {
  const issued = (await signIn('ayse', { clientId: TUNNEL_CLIENT })).json();
  const grantId = (await lib.findRefreshToken(sha(issued.refresh_token))).grant.grantId;
  await lib.writeTunnels((await lib.readTunnels()).filter((t) => t.id !== TUNNEL.id));
  assert.deepEqual(await lib.reconcileNativeClientHosts(quiet), [TUNNEL_CLIENT]);
  assert.equal((await call('GET', `/api/native-apps/${TUNNEL_CLIENT}`)).statusCode, 404);
  assert.equal(await lib.getNativeGrant(grantId), null);
  const deleted = await audits('native-app.deleted');
  assert.equal(deleted[0].details.reason, 'host_deleted');
});

test('deleting a client ends and forgets its grants', async () => {
  const issued = (await signIn('ali')).json();
  const res = await call('DELETE', `/api/native-apps/${CLIENT}`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(await lib.findRefreshToken(sha(issued.refresh_token)), null);
  assert.deepEqual((await call('GET', '/api/native-apps')).json().clients, []);
  assert.deepEqual(provider.options.nativeClients, []);
});

// ---------------------------------------------------------------------------
// The host's files (D6) and sign-in events (D7)
// ---------------------------------------------------------------------------

/** A native client on the site again (the tests above deleted theirs). */
async function siteClient(extra = {}) {
  const res = await call('POST', '/api/native-apps', {
    slug: 'mobile',
    hostKind: 'site',
    hostId: SITE.id,
    name: 'Mobile',
    redirectPaths: ['/oauth/callback', '/auth/done'],
    ...extra,
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json().client;
}

test('a served client’s host gets its association files and redirect page — only the redirect paths claimed', async () => {
  await siteClient({
    associations: {
      ios: { teamId: 'ABCDE12345', bundleIds: ['com.example.app'] },
      android: [
        {
          packageName: 'com.example.app',
          sha256CertFingerprints: [Array.from({ length: 32 }, () => 'AB').join(':')],
        },
      ],
    },
  });
  const dirOf = path.join(dir, 'native', SITE.fqdn);
  assert.deepEqual((await readdir(dirOf)).sort(), [
    'apple-app-site-association',
    'assetlinks.json',
    'redirect.html',
  ]);
  const aasa = JSON.parse(await readFile(path.join(dirOf, 'apple-app-site-association'), 'utf-8'));
  assert.deepEqual(aasa.applinks.details, [
    {
      appIDs: ['ABCDE12345.com.example.app'],
      components: [{ '/': '/oauth/callback' }, { '/': '/auth/done' }],
    },
  ]);
  assert.deepEqual(aasa.webcredentials.apps, ['ABCDE12345.com.example.app']);
  const links = JSON.parse(await readFile(path.join(dirOf, 'assetlinks.json'), 'utf-8'));
  assert.equal(links[0].target.package_name, 'com.example.app');
  const page = await readFile(path.join(dirOf, 'redirect.html'), 'utf-8');
  assert.doesNotMatch(page, /<script/i);

  assert.deepEqual(await lib.nativeHostOf(SITE.fqdn), {
    dir: dirOf,
    redirectPaths: ['/oauth/callback', '/auth/done'],
    appleAppSiteAssociation: true,
    assetLinks: true,
  });
  assert.equal(await lib.nativeHostOf(TUNNEL.fqdn), null);

  // iOS only now: the Android file goes; nothing rewritten that did not change.
  await call('PATCH', `/api/native-apps/${CLIENT}`, {
    associations: { ios: { teamId: 'ABCDE12345', bundleIds: ['com.example.app'] } },
  });
  assert.deepEqual((await readdir(dirOf)).sort(), ['apple-app-site-association', 'redirect.html']);
  assert.deepEqual(await lib.syncNativeAppFiles({ logger: quiet }), [], 'nothing changed');

  // Disabled: the host serves none of it.
  await call('PATCH', `/api/native-apps/${CLIENT}`, { enabled: false });
  assert.deepEqual(await readdir(path.join(dir, 'native')), []);
  assert.equal(await lib.nativeHostOf(SITE.fqdn), null);
  assert.equal((await call('DELETE', `/api/native-apps/${CLIENT}`)).statusCode, 200);
});

test('a sign-in reaches the plugins of the host that declare signInEvents — sealed, acknowledged, at least once', async () => {
  // mx declares sign-in events; its version approved.
  const identity = normalizeIdentityBlock({
    roles: [{ id: 'viewer', label: 'Viewer' }],
    signInEvents: true,
  });
  const plugins = await lib.readPlugins();
  await lib.writePlugins({
    plugins: plugins.plugins.map((p) => (p.name === 'mx' ? { ...p, identity } : p)),
  });
  const mx = await lib.findPlugin('mx');
  await lib.recordApprovedSet(mx, lib.installedApproval(mx).digest, mx.version, 'admin');
  assert.equal(await lib.installedVersionApproved(mx), true);

  // The agent half: core's verifier and sign-in handler on loopback.
  const secret = crypto.randomBytes(32).toString('hex');
  const received = [];
  let failing = false;
  const configPath = path.join(dir, 'mx-half.json');
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const out = await handler.handle({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      res.writeHead(out.status, out.headers);
      res.end(out.bodyText);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await writeFile(
    configPath,
    JSON.stringify({
      plugin: 'mx',
      port,
      secret,
      issuedAt: '2026-11-10T00:00:00.000Z',
      fetchedAt: '2026-11-10T00:00:00.000Z',
      acknowledged: true,
    }),
    { mode: 0o600 },
  );
  const handler = createSignInEventsHandler({
    verifier: createCallerAssertionVerifier({ configPath, plugin: 'mx' }),
    onEvents: (events) => {
      if (failing) throw new Error('kept nowhere');
      received.push(...events);
    },
  });
  let clock = Date.now();
  lib.setSignInEventsDepsForTests({
    now: () => clock,
    hostingOf: async () => ({
      plugin: 'mx',
      port,
      current: { secret, issuedAt: '2026-11-10T00:00:00.000Z' },
      acknowledgedIssuedAt: '2026-11-10T00:00:00.000Z',
    }),
  });
  try {
    await siteClient();
    const ayse = await idOf('ayse');
    const zeynep = await idOf('zeynep');
    // ayse is in mx's audience; zeynep holds no role there.
    assert.deepEqual(await lib.queueSignInEvent({ clientId: CLIENT, userId: ayse, at: clock }), [
      'mx',
    ]);
    assert.deepEqual(
      await lib.queueSignInEvent({ clientId: CLIENT, userId: zeynep, at: clock }),
      [],
    );
    // A client of no served host tells no one.
    assert.deepEqual(
      await lib.queueSignInEvent({ clientId: 'lamaste-native-none', userId: ayse, at: clock }),
      [],
    );
    // Queuing starts the delivery; this one waits behind it (one per plugin).
    const after = await lib.deliverSignInEvents('mx', { logger: quiet, force: true });
    assert.equal(after.status, 'idle', JSON.stringify(after));
    assert.equal(received.length, 1);
    assert.equal(received[0].userId, ayse);
    assert.deepEqual(received[0].client, { kind: 'native', clientId: CLIENT });
    assert.equal(received[0].at, new Date(clock).toISOString());
    const db = await lib.getStateDb();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM native_sign_in_events').get().n, 0);

    // The half fails: the event stays queued, and the next try waits.
    failing = true;
    await lib.queueSignInEvent({ clientId: CLIENT, userId: ayse, at: clock });
    assert.equal(
      (await lib.deliverSignInEvents('mx', { logger: quiet, force: true })).status,
      'failed',
    );
    assert.equal((await lib.deliverSignInEvents('mx', { logger: quiet })).status, 'waiting');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM native_sign_in_events').get().n, 1);

    // Seven days later it is dropped undelivered, counted in the audit.
    clock += 8 * 86_400_000;
    assert.equal(
      (await lib.deliverSignInEvents('mx', { logger: quiet, force: true })).status,
      'idle',
    );
    const [dropped] = await audits('plugin.sign-in-events.dropped');
    assert.equal(dropped.details.count, 1);
    assert.equal(received.length, 1);
  } finally {
    lib.setSignInEventsDepsForTests(null);
    server.close();
    await call('DELETE', `/api/native-apps/${CLIENT}`);
  }
});

// ---------------------------------------------------------------------------
// Security review (2026-11-10): H1, M1, L1, L2, L5
// ---------------------------------------------------------------------------

/** A request to the broker with a body and headers of the test's choosing. */
function rawBroker(endpoint, payload, headers) {
  return app.inject({
    method: 'POST',
    url: `/api/native-apps/oauth/${endpoint}`,
    headers: { host: `auth.${D}`, ...headers },
    payload,
  });
}

test('H1: anything but a form is refused for every client before it is classified', async () => {
  await siteClient();
  const { refresh_token: token } = (await signIn('ali')).json();
  const before = issuer.calls.length;
  const nativeForm = `grant_type=refresh_token&refresh_token=${token}&client_id=${CLIENT}`;
  const boundary = 'x-boundary';
  const multipart =
    `--${boundary}\r\nContent-Disposition: form-data; name="grant_type"\r\n\r\nrefresh_token\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="refresh_token"\r\n\r\n${token}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="client_id"\r\n\r\n${CLIENT}\r\n` +
    `--${boundary}--\r\n`;
  const cases = [
    ['multipart', multipart, { 'content-type': `multipart/form-data; boundary=${boundary}` }],
    ['no type', nativeForm, {}],
    ['text/plain', nativeForm, { 'content-type': 'text/plain' }],
    [
      'json',
      JSON.stringify({ grant_type: 'refresh_token' }),
      { 'content-type': 'application/json' },
    ],
    [
      'a form, gzip-encoded',
      nativeForm,
      { 'content-type': 'application/x-www-form-urlencoded', 'content-encoding': 'gzip' },
    ],
    // A plugin client's request in another type is refused too: no body
    // the broker cannot read reaches Authelia.
    [
      'another client, multipart',
      multipart.replaceAll(CLIENT, 'mx-cli'),
      { 'content-type': `multipart/form-data; boundary=${boundary}` },
    ],
  ];
  for (const [label, payload, headers] of cases) {
    for (const endpoint of ['token', 'revocation']) {
      const res = await rawBroker(endpoint, payload, headers);
      assert.equal(res.statusCode, 400, `${label} (${endpoint}): ${res.body}`);
      assert.equal(res.json().error, 'invalid_request', label);
    }
  }
  assert.equal(issuer.calls.length, before, 'nothing reached Authelia');

  // The form type in another case, with parameters: a form.
  const mixed = await rawBroker('token', nativeForm, {
    'content-type': 'Application/X-WWW-Form-Urlencoded; charset=UTF-8',
  });
  assert.equal(mixed.statusCode, 200, mixed.body);
  const next = mixed.json().refresh_token;

  // A native refresh token under another client's id: native (the token is
  // known), never passed on.
  const disguised = await broker('token', {
    grant_type: 'refresh_token',
    refresh_token: next,
    client_id: 'mx-cli',
  });
  assert.equal(disguised.statusCode, 400);
  assert.equal(disguised.json().error, 'invalid_grant');
  // A client assertion naming the native client: native, and refused (public client).
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const assertion = `${enc({ alg: 'RS256' })}.${enc({ iss: CLIENT, sub: CLIENT })}.sig`;
  const asserted = await broker('token', {
    grant_type: 'refresh_token',
    refresh_token: 'unknown',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
  });
  assert.equal(asserted.statusCode, 401);
  assert.equal(asserted.json().error, 'invalid_client');
  // A Basic header the broker cannot read: refused, not passed on.
  const unreadable = await broker(
    'token',
    { grant_type: 'refresh_token', refresh_token: 'x' },
    { authorization: 'Basic not*base64' },
  );
  assert.equal(unreadable.statusCode, 401);
  assert.equal(issuer.calls.length, before + 1, 'only the form reached Authelia');
  assert.equal((await refreshWith(next)).statusCode, 200, 'the grant lived through it all');
});

test('L1: a client deleted while Authelia answered a code exchange: its tokens revoked there, invalid_client', async () => {
  const code = `code-${crypto.randomUUID()}`;
  issuer.codes.set(code, 'ali');
  const revokedBefore = issuer.revoked.length;
  issuer.beforeCode = async () => {
    const db = await lib.getStateDb();
    db.prepare('UPDATE native_clients SET enabled = 0 WHERE client_id = ?').run(CLIENT);
  };
  try {
    const res = await broker('token', {
      grant_type: 'authorization_code',
      code,
      client_id: CLIENT,
      redirect_uri: `https://${SITE.fqdn}/oauth/callback`,
      code_verifier: 'v'.repeat(43),
    });
    assert.equal(res.statusCode, 401, res.body);
    assert.equal(res.json().error, 'invalid_client');
    assert.equal(issuer.revoked.length, revokedBefore + 1, 'the issued refresh token revoked');
  } finally {
    const db = await lib.getStateDb();
    db.prepare('UPDATE native_clients SET enabled = 1 WHERE client_id = ?').run(CLIENT);
  }
});

test('L2: a grace answer is given only on the client’s portal, within the grant’s lifetimes', async () => {
  const first = (await signIn('ali')).json();
  const rotated = await refreshWith(first.refresh_token);
  assert.equal(rotated.statusCode, 200);
  assert.equal((await refreshWith(first.refresh_token)).statusCode, 200, 'the grace answer');

  // At another domain's portal: refused, the grant untouched.
  await lib.addDomain(OTHER, { actor: 'test', logger: quiet }).catch(() => {});
  const db = await lib.getStateDb();
  db.prepare("UPDATE domains SET status = 'active', activated_at = ? WHERE name = ?").run(
    new Date().toISOString(),
    OTHER,
  );
  try {
    const elsewhere = await broker(
      'token',
      { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: CLIENT },
      { host: `auth.${OTHER}` },
    );
    assert.equal(elsewhere.statusCode, 401, elsewhere.body);
    assert.equal(elsewhere.json().error, 'invalid_client');
  } finally {
    await lib.removeDomain(OTHER, { actor: 'test', logger: quiet });
  }
  const { grant } = await lib.findRefreshToken(sha(first.refresh_token));
  assert.equal(grant.revokedAt, null);

  // Past its absolute lifetime: no grace answer, and the grant ends.
  db.prepare('UPDATE native_grants SET absolute_expires_at = ? WHERE grant_id = ?').run(
    Date.now() - 1000,
    grant.grantId,
  );
  const expired = await refreshWith(first.refresh_token);
  assert.equal(expired.statusCode, 400);
  assert.equal((await lib.getNativeGrant(grant.grantId)).revokedReason, 'absolute_expired');
});

test('M1: a client on a public or disabled host is not served; the guard keeps Authorization from its backend', async () => {
  const client = {
    clientId: 'lamaste-native-x',
    hostKind: 'tunnel',
    hostId: 't-x',
    enabled: true,
    redirectPaths: ['/cb'],
  };
  const tunnel = {
    id: 't-x',
    type: 'app',
    fqdn: `x.${D}`,
    agentLabel: 'agent-a',
    accessMode: 'authenticated',
    enabled: true,
  };
  const resolve = (entry) =>
    lib.resolveNativeClient(client, { tunnels: [entry], sites: [], domains: [D] });
  assert.equal(resolve(tunnel).served, true);
  assert.equal(resolve({ ...tunnel, accessMode: 'public' }).reason, 'host_public');
  assert.equal(resolve({ ...tunnel, enabled: false }).reason, 'host_disabled');

  const { renderTunnelVhost } = await import('../src/lib/nginx.js');
  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const { validateVhost } = createRequire(import.meta.url)(
    fileURLToPath(new URL('../../../provisioners/server/scripts/lamaste-priv', import.meta.url)),
  );
  const guard = /proxy_set_header Authorization "";\s+proxy_hide_header WWW-Authenticate;/;
  for (const mode of ['public', 'authenticated', 'restricted']) {
    const plain = renderTunnelVhost(mode, `x.${D}`, D, 8080).config;
    assert.doesNotMatch(plain, guard, `${mode}: no client, no guard`);
    const guarded = renderTunnelVhost(mode, `x.${D}`, D, 8080, undefined, {
      nativeGuard: true,
    }).config;
    assert.match(guarded, guard, `${mode}: a client, served or not — the guard`);
    assert.doesNotThrow(() => validateVhost(guarded), mode);
  }
});

test('L5: sign-in events of a person who left the plugin’s audience are dropped at delivery, never sent', async () => {
  const sent = [];
  lib.setSignInEventsDepsForTests({
    hostingOf: async () => ({
      plugin: 'mx',
      port: 1,
      current: { secret: 'a'.repeat(64), issuedAt: '2026-11-10T00:00:00.000Z' },
      acknowledgedIssuedAt: '2026-11-10T00:00:00.000Z',
    }),
    call: async ({ body }) => {
      const out = body('n'.repeat(32));
      sent.push(out);
      return { ok: true, status: 200, body: { acknowledged: out.to } };
    },
  });
  try {
    const ali = await idOf('ali');
    // Queued while ali holds a role; a delivery that cannot run yet.
    const db = await lib.getStateDb();
    db.prepare(
      'INSERT INTO native_sign_in_events (plugin, user_id, at, client_id) VALUES (?, ?, ?, ?)',
    ).run('mx', ali, Date.now(), CLIENT);
    // ali loses the role: no longer in mx's audience.
    const role = gatekeeper.grants.find((g) => g.principalId === 'ali' && g.resourceId === 'mx');
    gatekeeper.grants.splice(gatekeeper.grants.indexOf(role), 1);
    await lib.recomputeAudiences({ logger: quiet });
    const result = await lib.deliverSignInEvents('mx', { logger: quiet, force: true });
    assert.equal(result.status, 'delivered', JSON.stringify(result));
    assert.equal(result.dropped, 1);
    assert.equal(sent.length, 0, 'nothing sent of a person the plugin no longer knows');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM native_sign_in_events').get().n, 0);
  } finally {
    lib.setSignInEventsDepsForTests(null);
  }
});
