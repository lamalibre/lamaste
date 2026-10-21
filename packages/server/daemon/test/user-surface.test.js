/**
 * Slice 6, the user surface on the relay: `/api/<route>/app/*`, admitted by
 * a relay assertion for the panel, forwarded to the agent half's `/app/*`
 * with a `user` caller the half verifies — through the admin forwarder's
 * pipeline (header strips, signing, responder check, streaming, hooks) —
 * and `/admin/identity*` reserved on the admin forwarder. End to end
 * against a fake agent half that verifies like a real one.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  NonceStore,
  RELAY_ASSERTION_HEADER,
  RELAY_PANEL_AUDIENCE,
  createRelaySigner,
  generateHostingSecret,
  parseRelayVerifyKey,
  relayVerifyKeyOf,
  signRelayAssertion,
  verifyRelayAssertion,
} from '@lamalibre/lamaste';
import { createCallerAssertionVerifier, responderHeaderFor } from '@lamalibre/lamaste/agent';
import {
  agentForwarderPlugin,
  buildRequestHookPlan,
  isAgentHalfReservedPath,
  userSurfaceHalfPath,
  userSurfacePlugin,
} from '@lamalibre/lamaste/server';

const PLUGIN = 'fx';
const PANEL_PORT = 3100;
const ORIGIN = 'https://piyasa.example.com';
const AYSE = {
  type: 'user',
  userId: '4f0b8c9e-2d1a-4c3b-9a8e-7f6d5c4b3a21',
  username: 'ayse',
  roles: ['viewer'],
};

let dir;
let secret;
let halfConfigPath;
let half;
let halfPort;
let halfSeen;
let squatter;
let squatterPort;
let relayKey;
let relayKeys;

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
  );
}

/** A fake agent half: every request verified as a real one is; `/app/*` echoes who and what it got. */
function startFakeHalf() {
  const verifier = createCallerAssertionVerifier({ configPath: halfConfigPath, plugin: PLUGIN });
  return http.createServer(async (req, res) => {
    const result = await verifier.verify(req.headers, req.method, req.url);
    if (!result.ok) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'caller assertion refused', reason: result.reason }));
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      halfSeen = { method: req.method, url: req.url, caller: result.payload.caller };
      const head = (status, headers = {}) =>
        res.writeHead(status, { ...headers, ...responderHeaderFor(result, status) });
      if (req.url === '/app/forged') {
        res.writeHead(200, responderHeaderFor(result, 201));
        res.end('forged');
        return;
      }
      head(200, { 'content-type': 'application/json', 'set-cookie': 'app=1; Path=/' });
      res.end(
        JSON.stringify({
          caller: result.payload.caller,
          path: req.url,
          body: Buffer.concat(chunks).toString('utf-8'),
          cookie: req.headers.cookie ?? null,
          authorization: req.headers.authorization ?? null,
          relayAssertion: req.headers[RELAY_ASSERTION_HEADER] ?? null,
          remoteUser: req.headers['remote-user'] ?? null,
        }),
      );
    });
  });
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-s6-user-surface-'));
  secret = generateHostingSecret();
  halfConfigPath = path.join(dir, 'half.json');
  await writeFile(
    halfConfigPath,
    JSON.stringify({
      plugin: PLUGIN,
      port: 0,
      secret,
      issuedAt: '2026-10-22T00:00:00.000Z',
      fetchedAt: '2026-10-22T00:00:01.000Z',
      acknowledged: true,
    }),
    { mode: 0o600 },
  );
  half = startFakeHalf();
  halfPort = await listen(half);
  squatter = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end('alert(1)');
  });
  squatterPort = await listen(squatter);
  relayKey = await createRelaySigner(path.join(dir, 'relay-signing-key.json'), {
    create: true,
  }).current();
  relayKeys = new Map([[relayKey.kid, parseRelayVerifyKey(relayVerifyKeyOf(relayKey)).publicKey]]);
});

after(async () => {
  half?.close();
  squatter?.close();
  await rm(dir, { recursive: true, force: true });
});

/** What Gatekeeper sends with a user-surface request. */
function vouch(method, url, username = 'ayse', route = PLUGIN) {
  return signRelayAssertion(
    {
      aud: RELAY_PANEL_AUDIENCE,
      port: PANEL_PORT,
      caller: { type: 'user', username },
      method,
      target: { route, path: url },
    },
    relayKey,
  );
}

/** The panel's user-surface context, as wave 2 will wire it — with stubs for the directory. */
async function userSurfaceApp(overrides = {}) {
  const { default: Fastify } = await import('fastify');
  const app = Fastify({ logger: false });
  const nonces = new NonceStore();
  const lines = [];
  const calls = { resolveTarget: 0, resolveUserCaller: 0 };
  await app.register(
    async (scope) => {
      await scope.register(userSurfacePlugin, {
        verifyRelay: (request) => {
          const result = verifyRelayAssertion(request.headers[RELAY_ASSERTION_HEADER], {
            keys: relayKeys,
            aud: RELAY_PANEL_AUDIENCE,
            port: PANEL_PORT,
            method: request.method,
            url: request.raw.url ?? '',
            nonces,
          });
          return result.ok
            ? {
                ok: true,
                username: result.payload.caller.username,
                route: result.payload.target.route,
              }
            : { ok: false, reason: result.reason };
        },
        resolveTarget: (route) => {
          calls.resolveTarget += 1;
          if (route === PLUGIN)
            return { plugin: PLUGIN, port: halfPort, secret, maxBodyBytes: 64 * 1024 };
          if (route === 'squat')
            return { plugin: PLUGIN, port: squatterPort, secret, maxBodyBytes: 1024 };
          if (route === 'dead') return { plugin: PLUGIN, port: 1, secret, maxBodyBytes: 1024 };
          return null;
        },
        resolveUserCaller: async (_route, username) => {
          calls.resolveUserCaller += 1;
          if (username === 'ayse') return { ok: true, caller: AYSE };
          if (username === 'mehmet') return { ok: false, status: 403, error: 'User is disabled' };
          if (username === 'ghost') return { ok: false, status: 404, error: 'No such user' };
          if (username === 'impostor') return { ok: true, caller: AYSE };
          return { ok: true, caller: { ...AYSE, username, userId: 'not-a-uuid' } };
        },
        originFor: (route) =>
          route === 'squat' || route === 'dead' || route === PLUGIN ? ORIGIN : null,
        headersTimeoutMs: 1_000,
        logger: {
          info: (obj, msg) => lines.push({ obj, msg }),
          warn: (obj, msg) => lines.push({ obj, msg }),
        },
        ...overrides,
      });
    },
    { prefix: '/api' },
  );
  await app.ready();
  return { app, lines, calls };
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

test('paths: the user surface maps to /app on the agent half, and nowhere else', () => {
  assert.equal(userSurfaceHalfPath('/api/fx/app', 'fx'), '/app');
  assert.equal(userSurfaceHalfPath('/api/fx/app/', 'fx'), '/app/');
  assert.equal(userSurfaceHalfPath('/api/fx/app/me?x=1', 'fx'), '/app/me?x=1');
  assert.equal(userSurfaceHalfPath('/api/fx/app?x=%2F', 'fx'), '/app?x=%2F', 'a query is opaque');
  assert.equal(userSurfaceHalfPath('/api/fx/app/a%20b', 'fx'), '/app/a%20b');
  for (const refused of [
    '/api/fx',
    '/api/fx/admin',
    '/api/fx/apps',
    '/api/fxx/app',
    '/api/other/app',
    '/api/fx/app/../settings',
    '/api/fx/app/%2e%2e/x',
    '/api/fx/app/./x',
    '/api/fx/app/a%2Fb',
    '/api/fx/app/a%5Cb',
    '/api/fx/app/a\\b',
    '/api/fx/app/x%2Ey',
    '/api/fx/app/%E0%A4%A',
  ]) {
    assert.equal(userSurfaceHalfPath(refused, 'fx'), null, refused);
  }
  assert.equal(userSurfaceHalfPath('/api/-fx/app', '-fx'), null, 'not a plugin route');
});

test('paths: /admin/identity is reserved like hooks and settings, however it is spelled', () => {
  for (const reserved of [
    '/admin/identity',
    '/admin/identity/notify',
    '/admin/identity/changes?x=1',
    '/admin/IDENTITY/changes',
    '/admin/%69dentity/notify',
    '/admin//identity',
    '/admin/identity.json',
    '/admin/identity-v2',
  ]) {
    assert.equal(isAgentHalfReservedPath(reserved), true, reserved);
  }
  for (const open of ['/admin/ident-report', '/admin/x/identity']) {
    assert.equal(isAgentHalfReservedPath(open), false, open);
  }
});

test('admin forwarder: /api/<route>/identity/* never reaches the agent half', async () => {
  const { default: Fastify } = await import('fastify');
  const app = Fastify({ logger: false });
  await app.register(
    async (scope) => {
      await scope.register(agentForwarderPlugin, {
        resolveTarget: async () => ({ plugin: PLUGIN, port: halfPort, secret, maxBodyBytes: 1024 }),
        authorize: async () => ({ type: 'admin' }),
      });
    },
    { prefix: '/api' },
  );
  await app.ready();
  try {
    for (const url of [
      '/api/fx/identity/notify',
      '/api/fx/Identity/changes',
      '/api/fx/%69dentity',
    ]) {
      halfSeen = null;
      const res = await app.inject({ method: 'POST', url, payload: '{}' });
      assert.equal(res.statusCode, 404, url);
      assert.equal(halfSeen, null, url);
    }
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// The user surface, end to end
// ---------------------------------------------------------------------------

test('user surface: forwarded to /app/<rest> as the directory’s user; credentials stay behind', async () => {
  const { app, lines } = await userSurfaceApp();
  try {
    const url = '/api/fx/app/me?x=1';
    const res = await app.inject({
      method: 'GET',
      url,
      headers: {
        [RELAY_ASSERTION_HEADER]: vouch('GET', url),
        cookie: 'authelia_session=s',
        authorization: 'Bearer leak',
        'remote-user': 'eve',
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.deepEqual(body.caller, AYSE, 'the half verified a user caller for /app/me');
    assert.equal(body.path, '/app/me?x=1');
    assert.equal(body.cookie, null);
    assert.equal(body.authorization, null);
    assert.equal(body.relayAssertion, null, 'the relay assertion is the panel’s, not the half’s');
    assert.equal(body.remoteUser, null);
    assert.equal(res.headers['set-cookie'], undefined, 'Set-Cookie never reaches the browser');
    assert.equal(res.headers['x-lamalibre-responder'], undefined);

    // The bare surface and a trailing slash.
    for (const [u, expected] of [
      ['/api/fx/app', '/app'],
      ['/api/fx/app/', '/app/'],
    ]) {
      const r = await app.inject({
        method: 'GET',
        url: u,
        headers: { [RELAY_ASSERTION_HEADER]: vouch('GET', u) },
      });
      assert.equal(r.statusCode, 200, u);
      assert.equal(r.json().path, expected);
    }

    // One line per request: the user by id, never by name; no query string.
    // A line is written once the response stream has ended, which may be
    // just after inject() resolved.
    const forwarded = () => lines.filter((l) => l.msg === 'Forwarded user request');
    for (let i = 0; i < 100 && forwarded().length < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(forwarded().length, 3);
    assert.equal(forwarded()[0].obj.caller, `user:${AYSE.userId}`);
    assert.equal(forwarded()[0].obj.path, '/app/me');
    assert.ok(!JSON.stringify(lines).includes('ayse'));
  } finally {
    await app.close();
  }
});

test('user surface: 401 JSON without a valid assertion — before anything is looked up', async () => {
  const { app, calls } = await userSurfaceApp();
  try {
    const url = '/api/fx/app/me';
    const cases = [
      { headers: {} },
      { headers: { [RELAY_ASSERTION_HEADER]: 'garbage' } },
      // Bound to another path, method or route.
      { headers: { [RELAY_ASSERTION_HEADER]: vouch('GET', '/api/fx/app/other') } },
      { headers: { [RELAY_ASSERTION_HEADER]: vouch('POST', url) } },
      { headers: { [RELAY_ASSERTION_HEADER]: vouch('GET', '/api/other/app/me', 'ayse', 'other') } },
    ];
    for (const { headers } of cases) {
      const res = await app.inject({ method: 'GET', url, headers });
      assert.equal(res.statusCode, 401);
      assert.deepEqual(res.json(), { error: 'unauthenticated' });
      assert.match(res.headers['content-type'], /application\/json/);
    }
    // Used once already: a replay.
    const header = vouch('GET', url);
    assert.equal(
      (await app.inject({ method: 'GET', url, headers: { [RELAY_ASSERTION_HEADER]: header } }))
        .statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ method: 'GET', url, headers: { [RELAY_ASSERTION_HEADER]: header } }))
        .statusCode,
      401,
    );
    assert.equal(calls.resolveTarget, 1, 'only the authenticated request was resolved');
    assert.equal(calls.resolveUserCaller, 1);
  } finally {
    await app.close();
  }
  // A verifier that vouches for another route than the URL's is refused too.
  const { app: other } = await userSurfaceApp({
    verifyRelay: () => ({ ok: true, username: 'ayse', route: 'other' }),
  });
  try {
    const res = await other.inject({ method: 'GET', url: '/api/fx/app/me' });
    assert.equal(res.statusCode, 401);
  } finally {
    await other.close();
  }
});

test('user surface: a request that may change something needs the bound host’s Origin', async () => {
  const { app } = await userSurfaceApp();
  try {
    const url = '/api/fx/app/notes';
    const post = (headers) =>
      app.inject({
        method: 'POST',
        url,
        payload: '{"note":"ok"}',
        headers: {
          'content-type': 'application/json',
          [RELAY_ASSERTION_HEADER]: vouch('POST', url),
          ...headers,
        },
      });
    for (const origin of [undefined, 'https://evil.example.com', `${ORIGIN}:443`, 'null']) {
      const res = await post(origin === undefined ? {} : { origin });
      assert.equal(res.statusCode, 403, String(origin));
      assert.deepEqual(res.json(), { error: 'cross-origin request refused' });
    }
    const ok = await post({ origin: ORIGIN });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().body, '{"note":"ok"}');
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const res = await app.inject({
        method,
        url,
        headers: { [RELAY_ASSERTION_HEADER]: vouch(method, url) },
      });
      assert.equal(res.statusCode, 403, method);
    }
    // Reading needs no Origin.
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const res = await app.inject({
        method,
        url,
        headers: { [RELAY_ASSERTION_HEADER]: vouch(method, url) },
      });
      assert.equal(res.statusCode, 200, method);
    }
  } finally {
    await app.close();
  }
});

test('user surface: the directory decides — its 403, 404 or 503; a caller not the attested user is a 500', async () => {
  const { app, lines } = await userSurfaceApp();
  try {
    const url = '/api/fx/app/me';
    const as = (username) =>
      app.inject({
        method: 'GET',
        url,
        headers: { [RELAY_ASSERTION_HEADER]: vouch('GET', url, username) },
      });
    const disabled = await as('mehmet');
    assert.equal(disabled.statusCode, 403);
    assert.deepEqual(disabled.json(), { error: 'User is disabled' });
    assert.equal((await as('ghost')).statusCode, 404);
    halfSeen = null;
    // The directory answered with another user than the one Gatekeeper attested.
    const impostor = await as('impostor');
    assert.equal(impostor.statusCode, 500);
    // The directory answered with a caller no assertion may carry.
    assert.equal((await as('broken-user')).statusCode, 500);
    assert.equal(halfSeen, null, 'nothing reached the agent half');
    assert.ok(!JSON.stringify(lines).includes('impostor'));
    // No user surface on the route: 404, also for a route that is no plugin's.
    const unbound = '/api/nope/app/me';
    const res = await app.inject({
      method: 'GET',
      url: unbound,
      headers: { [RELAY_ASSERTION_HEADER]: vouch('GET', unbound, 'ayse', 'nope') },
    });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
  const { app: notReady } = await userSurfaceApp({
    resolveUserCaller: () => ({ ok: false, status: 503, error: 'The directory is not ready' }),
  });
  try {
    const url = '/api/fx/app/me';
    const res = await notReady.inject({
      method: 'GET',
      url,
      headers: { [RELAY_ASSERTION_HEADER]: vouch('GET', url) },
    });
    assert.equal(res.statusCode, 503);
  } finally {
    await notReady.close();
  }
});

test('user surface: only an authenticated answer passes — a squatter or a dead port is a 502', async () => {
  const { app } = await userSurfaceApp();
  try {
    for (const route of ['squat', 'dead']) {
      const url = `/api/${route}/app/main.js`;
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { [RELAY_ASSERTION_HEADER]: vouch('GET', url, 'ayse', route) },
      });
      assert.equal(res.statusCode, 502, route);
      assert.ok(!res.body.includes('alert(1)'), route);
    }
    const forgedUrl = '/api/fx/app/forged';
    const forged = await app.inject({
      method: 'GET',
      url: forgedUrl,
      headers: { [RELAY_ASSERTION_HEADER]: vouch('GET', forgedUrl) },
    });
    assert.equal(forged.statusCode, 502);
    assert.ok(!forged.body.includes('forged'));
  } finally {
    await app.close();
  }
});

test('user surface: request hooks see the user by id and roles — never the username', async () => {
  const inputs = [];
  const preHook = {
    index: 0,
    stage: 'pre-forward',
    routes: ['POST /app/*'],
    bodyMaxBytes: 1024,
    timeoutMs: 100,
    onError: 'reject',
    onOversize: 'reject',
    use: null,
    settings: null,
  };
  const postHook = {
    ...preHook,
    index: 1,
    stage: 'post-forward',
    routes: ['/app/*'],
    bodyMaxBytes: null,
    onError: 'block',
    onOversize: 'block',
  };
  const adminHook = { ...preHook, index: 2, routes: ['/admin/*'] };
  let refuse = null;
  const runtime = {
    hooksFor: async () => (refuse ? { refuse } : { hooks: [preHook, postHook, adminHook] }),
    run: async (_plugin, hook, input) => {
      inputs.push({ stage: hook.stage, input });
      return hook.stage === 'pre-forward'
        ? {
            ok: true,
            decision: { action: 'continue', setHeaders: { 'x-checked': 'yes' } },
            body: null,
          }
        : { ok: true, decision: { action: 'pass' }, body: null };
    },
    fallbackFor: () => null,
  };

  const plan = await buildRequestHookPlan(runtime, PLUGIN, 'post', '/app/notes?x=1');
  assert.deepEqual(
    plan.pre.map((m) => m.route),
    ['POST /app/*'],
  );
  assert.deepEqual(
    plan.post.map((m) => m.route),
    ['/app/*'],
  );

  const { app } = await userSurfaceApp({ hooks: runtime });
  try {
    const url = '/api/fx/app/notes?x=1';
    const res = await app.inject({
      method: 'POST',
      url,
      payload: '{"note":"ok"}',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        [RELAY_ASSERTION_HEADER]: vouch('POST', url),
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(
      inputs.map((i) => i.stage),
      ['pre-forward', 'post-forward'],
    );
    const pre = inputs[0].input;
    assert.deepEqual(pre.caller, { type: 'user', userId: AYSE.userId, roles: ['viewer'] });
    assert.equal(pre.path, '/app/notes');
    assert.equal(pre.query, 'x=1');
    assert.deepEqual(inputs[1].input.request.caller, pre.caller);
    assert.ok(!JSON.stringify(inputs).includes('ayse'), 'the username never reaches a hook');

    // Hooks Lamaste may not run: the user surface refuses, like the admin forwarder.
    refuse = 'Relay hooks of "fx" are not approved';
    const refused = await app.inject({
      method: 'GET',
      url: '/api/fx/app/me',
      headers: { [RELAY_ASSERTION_HEADER]: vouch('GET', '/api/fx/app/me') },
    });
    assert.equal(refused.statusCode, 503);
    assert.equal(refused.json().code, 'hooks_not_approved');
  } finally {
    await app.close();
  }
});

test('user surface: served under /api only', async () => {
  const { default: Fastify } = await import('fastify');
  const app = Fastify({ logger: false });
  await assert.rejects(
    app
      .register(
        async (scope) => {
          await scope.register(userSurfacePlugin, {
            verifyRelay: () => ({ ok: false, reason: 'x' }),
            resolveTarget: () => null,
            resolveUserCaller: () => ({ ok: false, status: 404, error: 'x' }),
            originFor: () => null,
          });
        },
        { prefix: '/panel' },
      )
      .ready(),
    /served under "\/api"/,
  );
  await app.close();
});
