/**
 * Hosting an agent-hosted plugin's agent half (4.3, slice 2a): the hosting
 * store and its secret rotation with overlap, the panel's forwarder against
 * a fake agent half that verifies caller assertions with the agent-side
 * helper, the health probe with its hysteresis, and the hosting agent's
 * plugin-config routes.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  CALLER_ASSERTION_HEADER,
  NonceStore,
  signCallerAssertion,
  verifyCallerAssertion,
  generateHostingSecret,
  pluginHostCapability,
} from '@lamalibre/lamaste';
import { createCallerAssertionVerifier } from '@lamalibre/lamaste/agent';
import {
  agentForwarderPlugin,
  agentHalfPath,
  forwardedRequestHeaders,
  forwardedResponseHeaders,
  createPluginHosting,
  rotatePluginHostingSecret,
  acknowledgePluginHostingSecret,
  removePluginHosting,
  readPluginHostings,
  signingSecretFor,
  agentPluginConfigFor,
  agentPluginAssignments,
  pluginHostingView,
  probePluginHosting,
  applyProbe,
  assignInternalPluginPort,
} from '@lamalibre/lamaste/server';

let stateDir;
let secret;
let halfConfigPath;
let half; // the fake agent half (http.Server)
let halfPort;
let halfSeen; // last request the half received
let brokenHalf; // answers 500 to everything
let brokenPort;

const PLUGIN = 'fx';
const MAX_BODY = 64 * 1024;

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
  );
}

async function writeHalfConfig(config) {
  await writeFile(halfConfigPath, JSON.stringify(config), { mode: 0o600 });
}

/** A fake agent half: `/admin/*` behind the agent-side verifier, `/app/*` not. */
async function startFakeHalf() {
  const verifier = createCallerAssertionVerifier({ configPath: halfConfigPath, plugin: PLUGIN });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (!url.pathname.startsWith('/admin/') && url.pathname !== '/admin') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found on the admin surface' }));
      return;
    }
    const result = await verifier.verify(req.headers, req.method, req.url);
    if (!result.ok) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'caller assertion refused', reason: result.reason }));
      return;
    }
    halfSeen = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      caller: result.payload.caller,
    };
    if (url.pathname === '/admin/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === '/admin/echo') {
      let bytes = 0;
      req.on('data', (c) => (bytes += c.length));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'app=1' });
        res.end(JSON.stringify({ bytes }));
      });
      return;
    }
    if (url.pathname === '/admin/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      let n = 0;
      const timer = setInterval(() => {
        n += 1;
        res.write(`data: tick ${n}\n\n`);
        if (n === 3) {
          clearInterval(timer);
          res.end();
        }
      }, 20);
      return;
    }
    if (url.pathname === '/admin/slow') {
      setTimeout(() => {
        res.writeHead(200);
        res.end('late');
      }, 500);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        caller: result.payload.caller,
        path: req.url,
        cookie: req.headers.cookie ?? null,
        authorization: req.headers.authorization ?? null,
        forwarded: req.headers['x-forwarded-for'] ?? null,
        sslClient: req.headers['x-ssl-client-dn'] ?? null,
      }),
    );
  });
  return server;
}

before(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), 'lamaste-plugin-hosting-'));
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_PKI_DIR = path.join(stateDir, 'pki');
  secret = generateHostingSecret();
  halfConfigPath = path.join(stateDir, 'half-config.json');
  await writeHalfConfig({
    plugin: PLUGIN,
    port: 0,
    secret,
    issuedAt: '2026-10-15T00:00:00.000Z',
    fetchedAt: '2026-10-15T00:00:01.000Z',
    acknowledged: true,
  });
  half = await startFakeHalf();
  halfPort = await listen(half);
  brokenHalf = http.createServer((_req, res) => {
    res.writeHead(500);
    res.end('broken');
  });
  brokenPort = await listen(brokenHalf);
});

after(async () => {
  half?.close();
  brokenHalf?.close();
  await rm(stateDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Caller assertions
// ---------------------------------------------------------------------------

test('assertion: verifies once, then is a replay; stale and foreign ones are refused', () => {
  const nonces = new NonceStore();
  const header = signCallerAssertion(
    { plugin: PLUGIN, caller: { type: 'admin' }, method: 'get', path: '/admin/x?y=1' },
    secret,
  );
  const base = { secrets: [secret], plugin: PLUGIN, method: 'GET', path: '/admin/x?y=1', nonces };
  const first = verifyCallerAssertion(header, base);
  assert.equal(first.ok, true);
  assert.deepEqual(first.payload.caller, { type: 'admin' });
  assert.equal(verifyCallerAssertion(header, base).reason, 'replayed');
  assert.equal(
    verifyCallerAssertion(header, { ...base, nonces: new NonceStore(), path: '/admin/other' })
      .reason,
    'wrong_request',
  );
  assert.equal(
    verifyCallerAssertion(header, { ...base, nonces: new NonceStore(), plugin: 'other' }).reason,
    'wrong_plugin',
  );
  assert.equal(
    verifyCallerAssertion(header, {
      ...base,
      nonces: new NonceStore(),
      secrets: [generateHostingSecret()],
    }).reason,
    'bad_signature',
  );
  const stale = signCallerAssertion(
    {
      plugin: PLUGIN,
      caller: { type: 'admin' },
      method: 'GET',
      path: '/admin/x',
      iat: Date.now() - 120_000,
    },
    secret,
  );
  assert.equal(
    verifyCallerAssertion(stale, { ...base, path: '/admin/x', nonces: new NonceStore() }).reason,
    'expired',
  );
  assert.equal(verifyCallerAssertion('garbage', base).reason, 'malformed');
  assert.equal(verifyCallerAssertion(undefined, base).reason, 'malformed');
});

// ---------------------------------------------------------------------------
// Hosting store
// ---------------------------------------------------------------------------

test('store: create, rotate with overlap, acknowledge, remove', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-hosting-store-'));
  try {
    const created = await createPluginHosting(dir, {
      plugin: 'app',
      agentLabel: 'vm1',
      port: 21000,
      tunnelId: 'tunnel-1',
    });
    assert.match(created.current.secret, /^[a-f0-9]{64}$/);
    assert.equal(created.health.state, 'unknown');
    // A fresh hosting signs with its only secret even before the agent fetched it.
    assert.equal(signingSecretFor(created), created.current.secret);
    assert.equal(pluginHostingView(created).secretAcknowledged, false);
    await assert.rejects(
      createPluginHosting(dir, { plugin: 'app', agentLabel: 'vm2', port: 21001, tunnelId: 't' }),
      /already hosted/,
    );

    const acked = await acknowledgePluginHostingSecret(dir, 'app', created.current.issuedAt);
    assert.equal(acked.acknowledged, true);
    assert.equal(pluginHostingView(acked.record).secretAcknowledged, true);

    const rotated = await rotatePluginHostingSecret(dir, 'app');
    assert.notEqual(rotated.current.secret, created.current.secret);
    assert.equal(rotated.previous.secret, created.current.secret);
    // Until the agent acknowledges the new secret, the forwarder signs with the old one.
    assert.equal(signingSecretFor(rotated), created.current.secret);
    assert.equal(pluginHostingView(rotated).rotationPending, true);
    const config = agentPluginConfigFor(rotated);
    assert.equal(config.secret, rotated.current.secret);
    assert.equal(config.previousSecret, created.current.secret);
    assert.deepEqual(agentPluginAssignments(await readPluginHostings(dir), 'vm1'), [
      {
        route: 'app',
        port: 21000,
        secretIssuedAt: rotated.current.issuedAt,
        secretAcknowledged: false,
      },
    ]);
    assert.deepEqual(agentPluginAssignments(await readPluginHostings(dir), 'vm2'), []);

    const wrong = await acknowledgePluginHostingSecret(dir, 'app', created.current.issuedAt);
    assert.equal(wrong.acknowledged, false);
    assert.equal(signingSecretFor(wrong.record), created.current.secret);

    const right = await acknowledgePluginHostingSecret(dir, 'app', rotated.current.issuedAt);
    assert.equal(right.acknowledged, true);
    assert.equal(right.record.previous, undefined);
    assert.equal(signingSecretFor(right.record), rotated.current.secret);

    // A second rotation before the first is acknowledged keeps the secret the agent holds.
    const r2 = await rotatePluginHostingSecret(dir, 'app');
    const r3 = await rotatePluginHostingSecret(dir, 'app');
    assert.equal(r3.previous.secret, rotated.current.secret);
    assert.notEqual(r3.current.secret, r2.current.secret);

    assert.equal((await removePluginHosting(dir, 'app')).plugin, 'app');
    assert.equal(await removePluginHosting(dir, 'app'), null);
    assert.deepEqual(await readPluginHostings(dir), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('store: the internal port is the lowest free one of the range', () => {
  assert.equal(assignInternalPluginPort([]), 21000);
  assert.equal(
    assignInternalPluginPort([{ port: 21000 }, { port: 21001 }, { port: 20010 }]),
    21002,
  );
  assert.equal(assignInternalPluginPort([{ port: 21000 }, { port: 21002 }]), 21001);
});

// ---------------------------------------------------------------------------
// Forwarder: pure helpers
// ---------------------------------------------------------------------------

test('forwarder: path mapping confines requests to /admin', () => {
  assert.equal(agentHalfPath('/api/fx', '/api', 'fx'), '/admin');
  assert.equal(agentHalfPath('/api/fx/jobs/1?x=1', '/api', 'fx'), '/admin/jobs/1?x=1');
  assert.equal(agentHalfPath('/api/fx/app/secret', '/api', 'fx'), '/admin/app/secret');
  assert.equal(agentHalfPath('/api/fx/panel.js', '/api', 'fx'), '/admin/panel.js');
  assert.equal(agentHalfPath('/api/fxx/ping', '/api', 'fx'), null);
  assert.equal(agentHalfPath('/api/fx/../tunnels', '/api', 'fx'), null);
  assert.equal(agentHalfPath('/api/fx/%2e%2e/tunnels', '/api', 'fx'), null);
  assert.equal(agentHalfPath('/api/fx/a%2Fb', '/api', 'fx'), '/admin/a%2Fb');
});

test('forwarder: credentials and proxy verdicts are stripped, cookies never pass back', () => {
  const out = forwardedRequestHeaders(
    {
      host: 'panel.example',
      cookie: 'lamaste_2fa_session=x',
      authorization: 'Bearer t',
      'x-ssl-client-dn': 'CN=admin',
      'x-lamalibre-caller': 'forged',
      'remote-user': 'eve',
      'x-forwarded-for': '1.2.3.4',
      connection: 'keep-alive',
      'transfer-encoding': 'chunked',
      'content-type': 'application/json',
      accept: 'application/json',
    },
    21000,
  );
  assert.deepEqual(out, {
    'content-type': 'application/json',
    accept: 'application/json',
    host: '127.0.0.1:21000',
  });
  assert.deepEqual(
    forwardedResponseHeaders({
      'set-cookie': ['a=1'],
      'content-type': 'text/plain',
      connection: 'close',
    }),
    { 'content-type': 'text/plain' },
  );
});

// ---------------------------------------------------------------------------
// Forwarder: end to end against the fake agent half
// ---------------------------------------------------------------------------

async function forwarderApp() {
  const { default: Fastify } = await import('fastify');
  const app = Fastify({ logger: false });
  app.decorateRequest('certRole', null);
  app.get('/api/plugins', async () => ({ plugins: [] }));
  await app.register(
    async (scope) => {
      await scope.register(agentForwarderPlugin, {
        resolveTarget: async (route) => {
          if (route === PLUGIN)
            return { plugin: PLUGIN, port: halfPort, secret, maxBodyBytes: MAX_BODY };
          if (route === 'broken')
            return { plugin: PLUGIN, port: brokenPort, secret, maxBodyBytes: MAX_BODY };
          if (route === 'dead') return { plugin: PLUGIN, port: 1, secret, maxBodyBytes: MAX_BODY };
          if (route === 'off') return { kind: 'disabled' };
          if (route === 'nohost') return { kind: 'not_hosted' };
          return { kind: 'not_found' };
        },
        authorize: async (request) => {
          const role = request.headers['x-test-role'];
          if (role === 'admin') return { type: 'admin' };
          if (role === 'agent') return { type: 'agent', label: request.headers['x-test-label'] };
          return null;
        },
        guard: (request) =>
          request.headers['x-test-guard'] ? { status: 503, body: { error: 'guarded' } } : null,
        headersTimeoutMs: 300,
      });
    },
    { prefix: '/api' },
  );
  await app.ready();
  return app;
}

test('forwarder: an admin call reaches /admin with a valid assertion; the caller is named', async () => {
  const app = await forwarderApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/fx/ping?x=1',
      headers: {
        'x-test-role': 'admin',
        cookie: 'lamaste_2fa_session=s',
        authorization: 'Bearer leak',
        'x-ssl-client-dn': 'CN=admin',
        'x-forwarded-for': '203.0.113.9',
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.deepEqual(body.caller, { type: 'admin' });
    assert.equal(body.path, '/admin/ping?x=1');
    assert.equal(body.cookie, null);
    assert.equal(body.authorization, null);
    assert.equal(body.forwarded, null);
    assert.equal(body.sslClient, null);

    const agent = await app.inject({
      method: 'GET',
      url: '/api/fx',
      headers: { 'x-test-role': 'agent', 'x-test-label': 'vm1' },
    });
    assert.equal(agent.statusCode, 200);
    assert.deepEqual(agent.json().caller, { type: 'agent', label: 'vm1' });
    assert.equal(agent.json().path, '/admin');
  } finally {
    await app.close();
  }
});

test('forwarder: /app of the agent half is unreachable, and a path cannot climb out of /admin', async () => {
  const app = await forwarderApp();
  try {
    // `/app/*` on the agent half is the user surface; the forwarder prefixes
    // `/admin`, so what the half sees is `/admin/app/secret`, never `/app/secret`.
    const leak = await app.inject({
      method: 'GET',
      url: '/api/fx/app/secret',
      headers: { 'x-test-role': 'admin' },
    });
    assert.equal(leak.statusCode, 200);
    assert.equal(halfSeen.url, '/admin/app/secret');
    // Fastify resolves dot segments (encoded or not) before routing, so a
    // climbing path lands on the panel's own route and its own guards — the
    // forwarder never sees it, and the agent half never does either. Over a
    // real socket, since inject() normalises the URL on its own.
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    for (const rawPath of [
      '/api/fx/%2e%2e/plugins',
      '/api/fx/../plugins',
      '/api/fx/a/%2e%2e/%2e%2e/plugins',
    ]) {
      halfSeen = null;
      const climb = await new Promise((resolve, reject) => {
        http
          .get(`${address}${rawPath}`, { headers: { 'x-test-role': 'admin' } }, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve({ status: res.statusCode, body }));
          })
          .on('error', reject);
      });
      assert.equal(climb.status, 200, `${rawPath}: ${climb.body}`);
      assert.deepEqual(JSON.parse(climb.body), { plugins: [] }, 'answered by the core route');
      assert.equal(halfSeen, null, 'the agent half never saw it');
    }
  } finally {
    await app.close();
  }
});

test('forwarder: refusals — unauthorized, disabled, not hosted, unknown, reserved, guarded', async () => {
  const app = await forwarderApp();
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/api/fx/ping' })).statusCode, 403);
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: '/api/off/ping',
          headers: { 'x-test-role': 'admin' },
        })
      ).statusCode,
      503,
    );
    const nohost = await app.inject({
      method: 'GET',
      url: '/api/nohost/ping',
      headers: { 'x-test-role': 'admin' },
    });
    assert.equal(nohost.statusCode, 503);
    assert.match(nohost.json().hint, /hosting/);
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: '/api/nothing/ping',
          headers: { 'x-test-role': 'admin' },
        })
      ).statusCode,
      404,
    );
    // A core route the forwarder must never shadow, with a method it does not serve.
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/plugins/x',
          headers: { 'x-test-role': 'admin' },
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: '/api/fx/ping',
          headers: { 'x-test-role': 'admin', 'x-test-guard': '1' },
        })
      ).statusCode,
      503,
    );
  } finally {
    await app.close();
  }
});

test('forwarder: a dead port is a clean 502 and a broken app is passed through', async () => {
  const app = await forwarderApp();
  try {
    const started = Date.now();
    const dead = await app.inject({
      method: 'GET',
      url: '/api/dead/ping',
      headers: { 'x-test-role': 'admin' },
    });
    assert.equal(dead.statusCode, 502);
    assert.equal(dead.json().reason, 'tunnel');
    assert.ok(Date.now() - started < 2000, 'answered without hanging');
    const broken = await app.inject({
      method: 'GET',
      url: '/api/broken/ping',
      headers: { 'x-test-role': 'admin' },
    });
    assert.equal(broken.statusCode, 500);
    assert.equal(broken.body, 'broken');
    const slow = await app.inject({
      method: 'GET',
      url: '/api/fx/slow',
      headers: { 'x-test-role': 'admin' },
    });
    assert.equal(slow.statusCode, 504);
  } finally {
    await app.close();
  }
});

test('forwarder: bodies stream through, the body limit holds, set-cookie never returns', async () => {
  const app = await forwarderApp();
  try {
    const payload = Buffer.alloc(10_000, 'a');
    const ok = await app.inject({
      method: 'POST',
      url: '/api/fx/echo',
      headers: { 'x-test-role': 'admin', 'content-type': 'application/octet-stream' },
      payload,
    });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().bytes, 10_000);
    assert.equal(ok.headers['set-cookie'], undefined);

    const declared = await app.inject({
      method: 'POST',
      url: '/api/fx/echo',
      headers: {
        'x-test-role': 'admin',
        'content-type': 'application/octet-stream',
        'content-length': String(MAX_BODY + 1),
      },
      payload: Buffer.alloc(MAX_BODY + 1, 'b'),
    });
    assert.equal(declared.statusCode, 413);

    // Over a real socket (inject() never reads the request stream the way
    // Node does): a body with Content-Length, fully read before the reply.
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const socketPost = await new Promise((resolve, reject) => {
      const body = Buffer.alloc(20_000, 'e');
      const req = http.request(
        `${address}/api/fx/echo`,
        {
          method: 'POST',
          headers: {
            'x-test-role': 'admin',
            'content-type': 'application/octet-stream',
            'content-length': String(body.length),
          },
        },
        (res) => {
          let text = '';
          res.on('data', (c) => (text += c));
          res.on('end', () => resolve({ status: res.statusCode, body: text }));
        },
      );
      req.on('error', reject);
      req.end(body);
    });
    assert.equal(socketPost.status, 200, socketPost.body);
    assert.equal(JSON.parse(socketPost.body).bytes, 20_000);

    // A chunked body that only reveals its size as it arrives.
    const chunked = await new Promise((resolve, reject) => {
      const req = http.request(
        `${address}/api/fx/echo`,
        {
          method: 'POST',
          headers: {
            'x-test-role': 'admin',
            'transfer-encoding': 'chunked',
            'content-type': 'application/octet-stream',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode, body }));
        },
      );
      req.on('error', reject);
      req.write(Buffer.alloc(MAX_BODY, 'c'));
      req.write(Buffer.alloc(16, 'd'));
      req.end();
    });
    assert.equal(chunked.status, 413, chunked.body);
  } finally {
    await app.close();
  }
});

test('forwarder: server-sent events pass through unbuffered', async () => {
  const app = await forwarderApp();
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const seen = await new Promise((resolve, reject) => {
      const chunks = [];
      const headersAt = { time: 0 };
      http
        .get(`${address}/api/fx/events`, { headers: { 'x-test-role': 'admin' } }, (res) => {
          headersAt.time = Date.now();
          res.on('data', (c) => chunks.push({ at: Date.now(), text: c.toString() }));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              chunks,
              headersAt: headersAt.time,
            }),
          );
        })
        .on('error', reject);
    });
    assert.equal(seen.status, 200);
    assert.match(seen.headers['content-type'], /text\/event-stream/);
    assert.equal(seen.headers['x-accel-buffering'], 'no');
    assert.equal(
      seen.chunks.map((c) => c.text).join(''),
      'data: tick 1\n\ndata: tick 2\n\ndata: tick 3\n\n',
    );
    assert.ok(seen.chunks.length >= 2, 'events arrived as separate chunks');
  } finally {
    await app.close();
  }
});

test('forwarder: a rotated secret is picked up by the agent half without a restart', async () => {
  const app = await forwarderApp();
  try {
    const next = generateHostingSecret();
    // The agent wrote the new config: current = next, previous = the old secret.
    await writeHalfConfig({
      plugin: PLUGIN,
      port: 0,
      secret: next,
      issuedAt: '2026-10-15T01:00:00.000Z',
      previousSecret: secret,
      previousIssuedAt: '2026-10-15T00:00:00.000Z',
      fetchedAt: '2026-10-15T01:00:01.000Z',
      acknowledged: false,
    });
    // The forwarder still signs with the old secret (not acknowledged yet): accepted.
    const old = await app.inject({
      method: 'GET',
      url: '/api/fx/ping',
      headers: { 'x-test-role': 'admin' },
    });
    assert.equal(old.statusCode, 200);
    // Now signed with the new one: the half reloads its file on the first failure.
    secret = next;
    await new Promise((r) => setTimeout(r, 2100)); // past the verifier's reload interval
    const fresh = await app.inject({
      method: 'GET',
      url: '/api/fx/ping',
      headers: { 'x-test-role': 'admin' },
    });
    assert.equal(fresh.statusCode, 200, fresh.body);
    // A secret the half never held is refused.
    const bogus = await http_get_with_assertion(halfPort, generateHostingSecret());
    assert.equal(bogus.status, 401);
    assert.equal(bogus.body.reason, 'bad_signature');
    // A call straight to the loopback port without an assertion is refused too.
    const bare = await new Promise((resolve) =>
      http.get(`http://127.0.0.1:${halfPort}/admin/ping`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      }),
    );
    assert.equal(bare.status, 401);
    assert.equal(bare.body.reason, 'malformed');
  } finally {
    await app.close();
  }
});

function http_get_with_assertion(port, withSecret) {
  const header = signCallerAssertion(
    { plugin: PLUGIN, caller: { type: 'admin' }, method: 'GET', path: '/admin/ping' },
    withSecret,
  );
  return new Promise((resolve) =>
    http.get(
      `http://127.0.0.1:${port}/admin/ping`,
      { headers: { [CALLER_ASSERTION_HEADER]: header } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      },
    ),
  );
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

test('health: the probe tells a dead tunnel from a broken application', async () => {
  const up = await probePluginHosting({ plugin: PLUGIN, port: halfPort, secret });
  assert.deepEqual(up, { ok: true });
  const tunnel = await probePluginHosting(
    { plugin: PLUGIN, port: 1, secret },
    { connectTimeoutMs: 500 },
  );
  assert.equal(tunnel.ok, false);
  assert.equal(tunnel.reason, 'tunnel');
  const app = await probePluginHosting({ plugin: PLUGIN, port: brokenPort, secret });
  assert.equal(app.ok, false);
  assert.equal(app.reason, 'app');
  // The wrong secret is an application failure too: the half refuses the health call.
  const refused = await probePluginHosting({
    plugin: PLUGIN,
    port: halfPort,
    secret: generateHostingSecret(),
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'app');
});

test('health: hysteresis — three failures down, two successes up, a changed reason is a transition', () => {
  const now = new Date('2026-10-15T10:00:00Z');
  let t = {
    state: 'unknown',
    since: now.toISOString(),
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
  };
  let r = applyProbe(t, { ok: true }, now);
  assert.equal(r.changed, false);
  r = applyProbe(r.next, { ok: true }, now);
  assert.equal(r.changed, true);
  assert.equal(r.next.state, 'up');
  t = r.next;
  r = applyProbe(t, { ok: false, reason: 'tunnel', error: 'refused' }, now);
  assert.equal(r.changed, false);
  r = applyProbe(r.next, { ok: false, reason: 'tunnel', error: 'refused' }, now);
  assert.equal(r.changed, false);
  assert.equal(r.next.state, 'up');
  r = applyProbe(r.next, { ok: false, reason: 'tunnel', error: 'refused' }, now);
  assert.equal(r.changed, true);
  assert.equal(r.next.state, 'down');
  assert.equal(r.next.reason, 'tunnel');
  // The tunnel comes back but the app is down: a new reason, reported once more.
  let d = r.next;
  for (let i = 0; i < 3; i++) {
    r = applyProbe(d, { ok: false, reason: 'app', error: '500' }, now);
    d = r.next;
  }
  assert.equal(r.changed, true);
  assert.equal(d.reason, 'app');
  r = applyProbe(d, { ok: true }, now);
  assert.equal(r.changed, false);
  r = applyProbe(r.next, { ok: true }, now);
  assert.equal(r.next.state, 'up');
});

// ---------------------------------------------------------------------------
// The hosting agent's routes
// ---------------------------------------------------------------------------

test('routes: only the hosting agent with the host capability reads and acknowledges its plugin config', async () => {
  const { default: Fastify } = await import('fastify');
  const { default: agentsRoutes } = await import('../src/routes/management/agents.js');
  const record = await createPluginHosting(stateDir, {
    plugin: 'hosted',
    agentLabel: 'vm1',
    port: 21000,
    tunnelId: 'tunnel-x',
  });
  const app = Fastify({ logger: false });
  app.decorateRequest('certRole', null);
  app.decorateRequest('certLabel', null);
  app.decorateRequest('certCapabilities', null);
  app.addHook('onRequest', async (request) => {
    request.certRole = request.headers['x-test-role'] ?? 'unknown';
    request.certLabel = request.headers['x-test-label'] ?? null;
    request.certCapabilities = (request.headers['x-test-caps'] ?? '').split(',').filter(Boolean);
  });
  app.decorate('requireRole', (roles) => async (request, reply) => {
    if (request.certRole === 'admin' || roles.includes(request.certRole)) return;
    return reply.code(403).send({ error: 'forbidden' });
  });
  await app.register(agentsRoutes, { prefix: '/api' });
  await app.ready();
  try {
    const cap = pluginHostCapability('hosted');
    const get = (headers) =>
      app.inject({ method: 'GET', url: '/api/agents/me/plugin-config/hosted', headers });
    assert.equal((await get({ 'x-test-role': 'admin' })).statusCode, 403);
    assert.equal((await get({ 'x-test-role': 'agent', 'x-test-label': 'vm1' })).statusCode, 403);
    assert.equal(
      (await get({ 'x-test-role': 'agent', 'x-test-label': 'vm2', 'x-test-caps': cap })).statusCode,
      404,
    );
    const ok = await get({ 'x-test-role': 'agent', 'x-test-label': 'vm1', 'x-test-caps': cap });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().secret, record.current.secret);
    assert.equal(ok.json().port, 21000);

    const ack = await app.inject({
      method: 'POST',
      url: '/api/agents/me/plugin-config/hosted/ack',
      headers: { 'x-test-role': 'agent', 'x-test-label': 'vm1', 'x-test-caps': cap },
      payload: { issuedAt: record.current.issuedAt },
    });
    assert.equal(ack.statusCode, 200);
    assert.equal(ack.json().acknowledged, true);
    const stale = await app.inject({
      method: 'POST',
      url: '/api/agents/me/plugin-config/hosted/ack',
      headers: { 'x-test-role': 'agent', 'x-test-label': 'vm1', 'x-test-caps': cap },
      payload: { issuedAt: '2000-01-01T00:00:00.000Z' },
    });
    assert.equal(stale.json().acknowledged, false);
    assert.equal(stale.json().secretIssuedAt, record.current.issuedAt);
  } finally {
    await app.close();
    await removePluginHosting(stateDir, 'hosted');
  }
});
