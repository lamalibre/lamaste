/**
 * Slice 6, the user surface on the relay: `/api/<route>/app/*`, admitted by
 * a relay assertion for the panel, forwarded to the agent half's `/app/*`
 * with a `user` caller the half verifies — through the admin forwarder's
 * pipeline (header strips, signing, responder check, streaming, hooks) —
 * and `/admin/identity*` reserved on the admin forwarder. End to end
 * against a fake agent half that verifies like a real one.
 *
 * Also what a user surface adds to that pipeline: a request another site
 * started is refused; every answer carries `Cross-Origin-Resource-Policy:
 * same-origin`, `nosniff` and `Content-Security-Policy: sandbox;
 * default-src 'none'`, and no `Access-Control-*`; the relay's own errors
 * are fixed texts; nothing is forwarded while the hosting is down; and a
 * response is ended when the panel's sweep says so or once it has lived its
 * bound. Both entries strip `X-Accel-*` from answers and method/URL
 * override headers from requests.
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
  METHOD_URL_OVERRIDE_HEADERS,
  agentForwarderPlugin,
  buildRequestHookPlan,
  isHookEditableHeader,
  isAgentHalfReservedPath,
  isCodeFetch,
  isSameOriginFetch,
  userSurfaceErrorText,
  userSurfaceHalfPath,
  userSurfacePlugin,
  userSurfaceResponseHeaders,
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
/** The open `/app/stream` responses of the fake half: closed when the relay ends them. */
const streams = [];

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
      halfSeen = {
        method: req.method,
        url: req.url,
        caller: result.payload.caller,
        headers: Object.keys(req.headers),
      };
      const head = (status, headers = {}) =>
        res.writeHead(status, { ...headers, ...responderHeaderFor(result, status) });
      if (req.url === '/app/forged') {
        res.writeHead(200, responderHeaderFor(result, 201));
        res.end('forged');
        return;
      }
      if (req.url === '/app/stream' || req.url === '/admin/stream') {
        // Server-sent events that never end on their own.
        head(200, { 'content-type': 'text/event-stream' });
        res.write('data: one\n\n');
        const stream = { closed: false };
        streams.push(stream);
        res.on('close', () => {
          stream.closed = true;
        });
        return;
      }
      if (req.url === '/app/headers' || req.url === '/admin/headers') {
        // An application that tries to steer nginx and the browser.
        head(200, {
          'content-type': 'text/html',
          'access-control-allow-origin': '*',
          'access-control-allow-credentials': 'true',
          'x-accel-redirect': '/internal/secret',
          'x-accel-buffering': 'yes',
          'x-accel-expires': '3600',
          'content-security-policy': "frame-ancestors 'none'",
          'cross-origin-resource-policy': 'cross-origin',
          'x-content-type-options': 'sniff',
        });
        res.end('<script>alert(1)</script>');
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
          if (route === 'down') return { kind: 'down', reason: 'tunnel' };
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
          route === 'squat' || route === 'dead' || route === 'down' || route === PLUGIN
            ? ORIGIN
            : null,
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
    // An encoded `%`: a router decoding twice would read `..` or `/`.
    '/api/fx/app/%252e%252e/admin/x',
    '/api/fx/app/a%252Fb',
    '/api/fx/app/%25',
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
      // A fixed text: not which side failed, not how.
      assert.deepEqual(res.json(), { error: 'The application is unavailable' }, route);
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
    assert.equal(refused.json().error, userSurfaceErrorText(503), 'never the internal message');
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

// ---------------------------------------------------------------------------
// What a user surface adds: cross-site refusal, response headers, fixed
// errors, the hosting being down, open responses ended
// ---------------------------------------------------------------------------

test('user surface: a request another site started is refused, whatever its method', async () => {
  assert.equal(isSameOriginFetch({}), true);
  const { app, calls } = await userSurfaceApp();
  try {
    const url = '/api/fx/app/me';
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'DELETE']) {
      for (const site of ['cross-site', 'same-site', 'same-origin, cross-site', 'bogus']) {
        halfSeen = null;
        const res = await app.inject({
          method,
          url,
          headers: {
            'sec-fetch-site': site,
            origin: ORIGIN,
            [RELAY_ASSERTION_HEADER]: vouch(method, url),
          },
        });
        assert.equal(res.statusCode, 403, `${method} ${site}`);
        if (method !== 'HEAD') {
          assert.deepEqual(
            res.json(),
            { error: 'cross-site request refused' },
            `${method} ${site}`,
          );
        }
        assert.equal(halfSeen, null, `${method} ${site}: nothing reached the half`);
      }
    }
    assert.equal(calls.resolveTarget, 0, 'refused before anything is looked up');
    for (const site of ['same-origin', 'none', undefined]) {
      const res = await app.inject({
        method: 'GET',
        url,
        headers: {
          ...(site ? { 'sec-fetch-site': site } : {}),
          [RELAY_ASSERTION_HEADER]: vouch('GET', url),
        },
      });
      assert.equal(res.statusCode, 200, String(site));
    }
  } finally {
    await app.close();
  }
});

test('user surface: a request loading a script, a style sheet or a worker is refused', async () => {
  assert.equal(isCodeFetch({}), false);
  assert.equal(isCodeFetch({ 'sec-fetch-dest': 'empty' }), false);
  const { app } = await userSurfaceApp();
  try {
    const url = '/api/fx/app/me';
    for (const dest of [
      'script',
      'style',
      'worker',
      'sharedworker',
      'serviceworker',
      'paintworklet',
    ]) {
      halfSeen = null;
      const res = await app.inject({
        method: 'GET',
        url,
        headers: {
          'sec-fetch-site': 'same-origin',
          'sec-fetch-dest': dest,
          [RELAY_ASSERTION_HEADER]: vouch('GET', url),
        },
      });
      assert.equal(res.statusCode, 403, dest);
      assert.deepEqual(res.json(), { error: 'not a script or style source' }, dest);
      assert.equal(halfSeen, null, `${dest}: nothing reached the half`);
    }
    for (const dest of ['empty', 'document', undefined]) {
      const res = await app.inject({
        method: 'GET',
        url,
        headers: {
          'sec-fetch-site': 'same-origin',
          ...(dest ? { 'sec-fetch-dest': dest } : {}),
          [RELAY_ASSERTION_HEADER]: vouch('GET', url),
        },
      });
      assert.equal(res.statusCode, 200, String(dest));
    }
  } finally {
    await app.close();
  }
});

/** The three headers every user-surface answer carries. */
function assertUserSurfaceHeaders(res, label) {
  assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin', label);
  assert.equal(res.headers['x-content-type-options'], 'nosniff', label);
  const csp = [res.headers['content-security-policy']].flat();
  assert.equal(csp[0], "sandbox; default-src 'none'", label);
  for (const name of Object.keys(res.headers)) {
    assert.ok(!name.startsWith('access-control-'), `${label}: ${name}`);
    assert.ok(!name.startsWith('x-accel-'), `${label}: ${name}`);
  }
}

test('user surface: every answer — forwarded, refused, failed — carries the user-surface headers', async () => {
  const { app } = await userSurfaceApp({
    hooks: {
      hooksFor: async () => ({ hooks: [] }),
      run: async () => ({ ok: false }),
      fallbackFor: () => null,
    },
  });
  try {
    const as = (method, url, headers = {}) =>
      app.inject({
        method,
        url,
        headers: { [RELAY_ASSERTION_HEADER]: vouch(method, url), ...headers },
      });
    assertUserSurfaceHeaders(await as('GET', '/api/fx/app/me'), 'forwarded');
    assertUserSurfaceHeaders(
      await app.inject({ method: 'GET', url: '/api/fx/app/me' }),
      '401 unauthenticated',
    );
    assertUserSurfaceHeaders(
      await app.inject({
        method: 'GET',
        url: '/api/fx/app/me',
        headers: { 'sec-fetch-site': 'cross-site' },
      }),
      '403 cross-site',
    );
    assertUserSurfaceHeaders(await as('POST', '/api/fx/app/me'), '403 cross-origin');
    const dead = '/api/dead/app/x';
    assertUserSurfaceHeaders(
      await app.inject({
        method: 'GET',
        url: dead,
        headers: { [RELAY_ASSERTION_HEADER]: vouch('GET', dead, 'ayse', 'dead') },
      }),
      '502',
    );

    // The application's own headers cannot undo them, nor steer nginx.
    const steered = await as('GET', '/api/fx/app/headers');
    assert.equal(steered.statusCode, 200);
    assertUserSurfaceHeaders(steered, 'the application’s answer');
    assert.deepEqual(steered.headers['content-security-policy'], [
      "sandbox; default-src 'none'",
      "frame-ancestors 'none'",
    ]);
  } finally {
    await app.close();
  }

  // Pure: the application's CSP stays as a further policy, ours first.
  assert.deepEqual(
    userSurfaceResponseHeaders({
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
      'x-content-type-options': 'off',
      'content-security-policy': ["default-src 'self'", 'img-src *'],
    }),
    {
      'content-type': 'application/json',
      'cross-origin-resource-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
      'content-security-policy': ["sandbox; default-src 'none'", "default-src 'self'", 'img-src *'],
    },
  );
});

test('both entries: no X-Accel-* reaches nginx, no method or URL override reaches the half', async () => {
  const overrides = {
    'x-http-method-override': 'DELETE',
    'x-http-method': 'DELETE',
    'x-method-override': 'DELETE',
    'x-original-url': '/admin/settings',
    'x-rewrite-url': '/admin/settings',
    'x-forwarded-prefix': '/admin',
    'x-forwarded-uri': '/admin/settings',
    'x-original-method': 'DELETE',
  };
  const { default: Fastify } = await import('fastify');
  const admin = Fastify({ logger: false });
  await admin.register(
    async (scope) => {
      await scope.register(agentForwarderPlugin, {
        resolveTarget: async () => ({ plugin: PLUGIN, port: halfPort, secret, maxBodyBytes: 1024 }),
        authorize: async () => ({ type: 'admin' }),
      });
    },
    { prefix: '/api' },
  );
  await admin.ready();
  const { app: user } = await userSurfaceApp();
  try {
    halfSeen = null;
    const adminRes = await admin.inject({
      method: 'GET',
      url: '/api/fx/headers',
      headers: overrides,
    });
    assert.equal(adminRes.statusCode, 200);
    for (const name of Object.keys(adminRes.headers)) {
      assert.ok(!name.startsWith('x-accel-'), `admin answer: ${name}`);
    }
    for (const name of Object.keys(overrides)) {
      assert.ok(!halfSeen.headers.includes(name), `admin request: ${name}`);
    }

    halfSeen = null;
    const url = '/api/fx/app/me';
    const userRes = await user.inject({
      method: 'GET',
      url,
      headers: { ...overrides, [RELAY_ASSERTION_HEADER]: vouch('GET', url) },
    });
    assert.equal(userRes.statusCode, 200);
    assert.equal(halfSeen.method, 'GET');
    assert.equal(halfSeen.url, '/app/me');
    for (const name of Object.keys(overrides)) {
      assert.ok(!halfSeen.headers.includes(name), `user request: ${name}`);
    }
    // Nor may a request hook set one again.
    assert.deepEqual([...METHOD_URL_OVERRIDE_HEADERS].sort(), Object.keys(overrides).sort());
    for (const name of METHOD_URL_OVERRIDE_HEADERS) {
      assert.equal(isHookEditableHeader(name), false, name);
    }
  } finally {
    await admin.close();
    await user.close();
  }
});

test('user surface: the relay’s own errors are fixed texts, never an internal message', async () => {
  const { app } = await userSurfaceApp({
    resolveTarget: (route) => ({ plugin: route, port: halfPort, secret, maxBodyBytes: 16 }),
  });
  try {
    const url = '/api/fx/app/notes';
    const big = await app.inject({
      method: 'POST',
      url,
      payload: 'x'.repeat(64),
      headers: {
        origin: ORIGIN,
        'content-type': 'text/plain',
        [RELAY_ASSERTION_HEADER]: vouch('POST', url),
      },
    });
    assert.equal(big.statusCode, 413);
    assert.deepEqual(big.json(), { error: 'Request body too large' });
  } finally {
    await app.close();
  }
  assert.equal(userSurfaceErrorText(502), 'The application is unavailable');
  assert.equal(userSurfaceErrorText(504), 'The application did not answer in time');
  assert.equal(userSurfaceErrorText(418), 'Request refused');
});

test('user surface: nothing is forwarded while the plugin’s hosting is down — 503', async () => {
  const { app } = await userSurfaceApp();
  try {
    halfSeen = null;
    const url = '/api/down/app/me';
    const res = await app.inject({
      method: 'GET',
      url,
      headers: { [RELAY_ASSERTION_HEADER]: vouch('GET', url, 'ayse', 'down') },
    });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.json(), { error: 'The plugin is not available right now' });
    assert.equal(halfSeen, null);
  } finally {
    await app.close();
  }
});

/** GET `path` from a listening app with headers; resolves with the response once its headers arrive. */
function openStream(port, url, headers) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: url, headers }, resolve);
    req.on('error', reject);
  });
}

/** Read a response to its end (or until the connection is cut); resolves with what arrived. */
function drain(res) {
  return new Promise((resolve) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk.toString('utf-8');
    });
    const done = () => resolve(data);
    res.on('end', done);
    res.on('close', done);
    res.on('error', done);
  });
}

test('user surface: an open response is tracked, and ends when the panel ends it — down to the half', async () => {
  const tracked = [];
  const { app, lines } = await userSurfaceApp({
    trackResponse: (response) => {
      const entry = { response, untracked: false };
      tracked.push(entry);
      return () => {
        entry.untracked = true;
      };
    },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  try {
    const url = '/api/fx/app/stream';
    const before = streams.length;
    const res = await openStream(app.server.address().port, url, {
      [RELAY_ASSERTION_HEADER]: vouch('GET', url),
    });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/event-stream/);
    assert.equal(res.headers['content-security-policy'], "sandbox; default-src 'none'");
    const body = drain(res);
    // The first event arrives; the response stays open.
    for (let i = 0; i < 100 && streams.length === before; i += 1) await sleep(5);
    assert.equal(tracked.length, 1);
    const [{ response }] = tracked;
    assert.equal(response.route, PLUGIN);
    assert.equal(response.plugin, PLUGIN);
    assert.deepEqual(response.caller, AYSE);
    assert.ok(Math.abs(response.startedAt - Date.now()) < 5_000);
    assert.equal(tracked[0].untracked, false);

    // The panel's sweep found the user may no longer use the plugin.
    response.end('access_revoked');
    response.end('access_revoked'); // idempotent
    assert.match(await body, /data: one/);
    const stream = streams[before];
    for (let i = 0; i < 200 && !stream.closed; i += 1) await sleep(5);
    assert.equal(stream.closed, true, 'the request to the agent half is gone too');
    for (let i = 0; i < 200 && !tracked[0].untracked; i += 1) await sleep(5);
    assert.equal(tracked[0].untracked, true, 'no longer tracked');
    const ended = () => lines.find((l) => /ended by the relay: access_revoked/.test(l.obj.error));
    for (let i = 0; i < 200 && !ended(); i += 1) await sleep(5);
    assert.ok(ended(), 'the log line says why');
    assert.ok(!JSON.stringify(lines).includes('ayse'));
  } finally {
    await app.close();
  }
});

test('user surface: no response outlives its bound', async () => {
  const tracked = [];
  const { app, lines } = await userSurfaceApp({
    maxResponseMs: 150,
    trackResponse: (response) => {
      tracked.push(response);
      return () => {};
    },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  try {
    const url = '/api/fx/app/stream';
    const before = streams.length;
    const startedAt = Date.now();
    const res = await openStream(app.server.address().port, url, {
      [RELAY_ASSERTION_HEADER]: vouch('GET', url),
    });
    assert.match(await drain(res), /data: one/);
    const lived = Date.now() - startedAt;
    assert.ok(lived >= 140 && lived < 5_000, `ended after ${lived} ms`);
    const stream = streams[before];
    for (let i = 0; i < 200 && !stream.closed; i += 1) await sleep(5);
    assert.equal(stream.closed, true);
    const ended = () => lines.find((l) => /ended by the relay: lifetime/.test(l.obj.error));
    for (let i = 0; i < 200 && !ended(); i += 1) await sleep(5);
    assert.ok(ended());
    // A short answer is never cut: it is over long before the bound.
    const quick = await app.inject({
      method: 'GET',
      url: '/api/fx/app/me',
      headers: { [RELAY_ASSERTION_HEADER]: vouch('GET', '/api/fx/app/me') },
    });
    assert.equal(quick.statusCode, 200);
  } finally {
    await app.close();
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('admin forwarder: nothing is forwarded while the hosting is down — a dead tunnel’s answer, or the fallback', async () => {
  const { default: Fastify } = await import('fastify');
  let down = { kind: 'down', reason: 'tunnel' };
  let fallback = null;
  let callerAllowed = true;
  const lines = [];
  const app = Fastify({ logger: false });
  await app.register(
    async (scope) => {
      await scope.register(agentForwarderPlugin, {
        resolveTarget: async () =>
          down ?? { plugin: PLUGIN, port: halfPort, secret, maxBodyBytes: 1024 },
        authorize: async () => (callerAllowed ? { type: 'admin' } : null),
        hooks: {
          hooksFor: async () => ({ hooks: [] }),
          run: async () => ({ ok: false }),
          fallbackFor: () => fallback,
        },
        logger: {
          info: (obj, msg) => lines.push({ obj, msg }),
          warn: (obj, msg) => lines.push({ obj, msg }),
        },
      });
    },
    { prefix: '/api' },
  );
  await app.ready();
  try {
    halfSeen = null;
    const tunnel = await app.inject({ method: 'POST', url: '/api/fx/status', payload: '{"a":1}' });
    assert.equal(tunnel.statusCode, 502);
    assert.deepEqual(tunnel.json(), {
      error: 'The hosting agent is unreachable',
      reason: 'tunnel',
    });
    down = { kind: 'down', reason: 'app' };
    const app502 = await app.inject({ method: 'GET', url: '/api/fx/status' });
    assert.equal(app502.statusCode, 502);
    assert.deepEqual(app502.json(), { error: 'The agent half is not responding', reason: 'app' });
    assert.equal(halfSeen, null, 'nothing reached the port');

    // The plugin's tunnel:down fallback answers instead, as for a dead tunnel.
    fallback = { status: 503, body: { error: 'maintenance' }, retryAfter: 30 };
    const fell = await app.inject({ method: 'GET', url: '/api/fx/status' });
    assert.equal(fell.statusCode, 503);
    assert.deepEqual(fell.json(), { error: 'maintenance' });
    assert.equal(fell.headers['retry-after'], '30');
    fallback = null;

    // Only an authorized caller learns anything; a reserved path stays a 404.
    callerAllowed = false;
    assert.equal((await app.inject({ method: 'GET', url: '/api/fx/status' })).statusCode, 403);
    callerAllowed = true;
    assert.equal((await app.inject({ method: 'GET', url: '/api/fx/settings' })).statusCode, 404);
    assert.ok(lines.some((l) => l.obj.status === 502 && l.obj.path === '/admin/status'));

    // Up again: forwarded as before.
    down = null;
    const up = await app.inject({ method: 'GET', url: '/api/fx/status' });
    assert.equal(up.statusCode, 200, up.body);
    assert.equal(halfSeen.url, '/admin/status');
  } finally {
    await app.close();
  }
});
