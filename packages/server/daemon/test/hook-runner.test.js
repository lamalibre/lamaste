/**
 * Lifecycle hooks (slice 2b), end to end on one machine: the relay hook
 * runner as its own process under Node's permission model, the panel's call
 * to it, and the hooked forwarder in front of a fake agent half —
 * pre-forward rejecting before anything reaches the agent half, post-forward
 * redacting a planted token with the shared scanner, a stuck hook failing
 * closed, and the tunnel:down fallback.
 *
 * The systemd sandbox around the runner (no network, dynamic user, …) is
 * proven on a relay VM (rodeo); here it is the permission model only.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';

import { validateManifest, relayHookSetOf, signCallerAssertion } from '@lamalibre/lamaste';
import { createCallerAssertionVerifier } from '@lamalibre/lamaste/agent';
import {
  callRelayHook,
  createHookedForwarder,
  validateHookDecision,
} from '@lamalibre/lamaste/server';

const RUNNER = path.join(
  path.dirname(fileURLToPath(import.meta.resolve('@lamalibre/lamaste/hooks'))),
  'runner.js',
);
const RUNNER_DIR = path.dirname(RUNNER);
const NODE_MAJOR = Number(process.versions.node.split('.')[0]);

const PLUGIN = 'fx';
const SECRET = 'ab'.repeat(32);
const TOKEN = 'ghp_' + 'Z9y8'.repeat(9);

const HOOK_MODULE = `
import fs from 'node:fs';
const attempt = async (fn) => { try { await fn(); return 'ALLOWED'; } catch (e) { return e.code ?? e.name; } };
export default {
  'request:pre-forward': (req) => {
    if (req.path.startsWith('/admin/import')) {
      let data;
      try { data = req.body.json(); } catch { return { action: 'reject', status: 400, body: { error: 'not json' } }; }
      if (!data.valid) return { action: 'reject', status: 422, body: { error: 'invalid import' }, effects: [{ type: 'audit', event: 'import.rejected' }] };
      return { action: 'continue', setHeaders: { 'x-validated': 'yes' } };
    }
    if (req.path.startsWith('/admin/stuck')) { for (;;) {} }
    if (req.path.startsWith('/admin/throw')) throw new Error('boom ' + req.query);
    return { action: 'continue' };
  },
  'tunnel:down': (s) => ({ fallback: { status: 503, retryAfter: 30, body: { error: 'maintenance', reason: s.reason } } }),
  'install:pre-tunnel': async () => ({
    ok: true,
    output: {
      read: await attempt(() => fs.readFileSync('/etc/hosts')),
      write: await attempt(() => fs.writeFileSync('/tmp/lamaste-hook-escape', 'x')),
      spawn: await attempt(async () => (await import('node:child_process')).execFileSync('/bin/echo')),
      worker: await attempt(async () => new (await import('node:worker_threads')).Worker('1', { eval: true })),
      env: Object.keys(process.env).filter((k) => /SECRET|TOKEN|PASSWORD/i.test(k)).length,
    },
  }),
};
`;

const MANIFEST = validateManifest({
  name: PLUGIN,
  version: '1.0.0',
  hosting: 'agent',
  agent: {},
  hooks: {
    relay: {
      entry: 'hooks/relay.mjs',
      effects: ['audit'],
      request: [
        {
          stage: 'pre-forward',
          routes: ['POST /admin/import/*', '/admin/stuck', 'GET /admin/throw'],
          body: { maxBytes: 1024 },
          timeoutMs: 400,
        },
        {
          stage: 'post-forward',
          use: 'lamaste:secret-scan',
          routes: ['GET /admin/export/*', 'GET /admin/events', 'GET /admin/big'],
          body: { maxBytes: 2048 },
        },
        {
          stage: 'post-forward',
          use: 'lamaste:secret-scan',
          routes: ['GET /admin/big-pass'],
          body: { maxBytes: 16 },
          onOversize: 'pass',
        },
      ],
      tunnel: { down: {} },
    },
  },
});
const SET = relayHookSetOf(MANIFEST);

let dir;
let socketPath;
let runner;
let half;
let halfPort;
let halfLog = [];
let app;
let fallback = null;

async function startRunner() {
  // systemd owns the socket on a relay; here a killed runner leaves its file.
  await rm(socketPath, { force: true });
  const flags = [
    '--permission',
    `--allow-fs-read=${RUNNER_DIR}/*`,
    `--allow-fs-read=${dir}/hook.mjs`,
  ];
  if (NODE_MAJOR >= 25) flags.push('--allow-net');
  runner = spawn(
    process.execPath,
    [
      ...flags,
      RUNNER,
      '--plugin',
      PLUGIN,
      '--entry',
      path.join(dir, 'hook.mjs'),
      '--listen',
      socketPath,
    ],
    // A unit starts it with a clean environment; this test plants a secret
    // the runner must not let through to the hooks.
    { stdio: ['ignore', 'ignore', 'pipe'], env: { PATH: process.env.PATH, API_TOKEN: 'planted' } },
  );
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const up = await new Promise((resolve) => {
      const s = net.connect(socketPath);
      s.once('connect', () => {
        s.destroy();
        resolve(true);
      });
      s.once('error', () => resolve(false));
    });
    if (up) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('The hook runner did not start');
}

function stopRunner() {
  runner?.kill('SIGKILL');
  runner = null;
}

/** What the panel's runtime does, without the database: call, validate. */
const runtime = {
  async hooksFor() {
    return { hooks: SET.request };
  },
  async run(plugin, hook, input, body) {
    const outcome = await callRelayHook(socketPath, {
      plugin,
      stage: `request:${hook.stage}`,
      call: hook.use
        ? { kind: 'shared', name: hook.use, settings: hook.settings }
        : { kind: 'app' },
      input,
      body,
      timeoutMs: hook.timeoutMs,
    });
    if (!outcome.ok) {
      if (outcome.kind === 'timeout') {
        // The panel restarts a stuck runner (lamaste-priv hooks restart).
        stopRunner();
        await startRunner();
      }
      return { ok: false };
    }
    const v = validateHookDecision(`request:${hook.stage}`, outcome.decision);
    return v.ok ? { ok: true, decision: v.decision, body: outcome.body } : { ok: false };
  },
  fallbackFor() {
    return fallback;
  },
};

before(async () => {
  // The real path: Node's permission model checks resolved paths, and
  // macOS's tmpdir sits behind the /var → /private/var link.
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'lamaste-hooks-')));
  socketPath = path.join(dir, 'r.sock');
  await writeFile(path.join(dir, 'hook.mjs'), HOOK_MODULE);
  await writeFile(
    path.join(dir, 'half.json'),
    JSON.stringify({
      plugin: PLUGIN,
      port: 1,
      secret: SECRET,
      issuedAt: '2026-10-15T00:00:00.000Z',
      fetchedAt: '2026-10-15T00:00:00.000Z',
      acknowledged: true,
    }),
  );
  await startRunner();

  const verifier = createCallerAssertionVerifier({
    configPath: path.join(dir, 'half.json'),
    plugin: PLUGIN,
  });
  half = http.createServer(async (req, res) => {
    const v = await verifier.verify(req.headers, req.method, req.url);
    if (!v.ok) {
      res.writeHead(401).end();
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    halfLog.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    if (req.url.startsWith('/admin/export')) {
      res.writeHead(200, { 'content-type': 'application/json', etag: '"v1"' });
      res.end(JSON.stringify({ token: TOKEN, n: 12345678901234567890n.toString() }));
      return;
    }
    if (req.url.startsWith('/admin/events')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${TOKEN}\n\n`);
      return;
    }
    if (req.url.startsWith('/admin/big')) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`${'x'.repeat(4096)} ${TOKEN}`);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  halfPort = await new Promise((r) => half.listen(0, '127.0.0.1', () => r(half.address().port)));

  app = Fastify();
  await app.register(
    async (scope) => {
      await scope.register(
        createHookedForwarder({
          resolveTarget: async (route) =>
            route === PLUGIN
              ? { plugin: PLUGIN, port: halfPort, secret: SECRET, maxBodyBytes: 64 * 1024 }
              : route === 'down'
                ? { plugin: PLUGIN, port: 1, secret: SECRET, maxBodyBytes: 1024 }
                : { kind: 'not_found' },
          authorize: async () => ({ type: 'admin' }),
          hooks: runtime,
        }),
      );
    },
    { prefix: '/api' },
  );
  await app.ready();
});

after(async () => {
  stopRunner();
  half?.close();
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

test('runner: a lifecycle hook runs, and the sandbox refuses reads, writes, processes and workers', async () => {
  const outcome = await callRelayHook(socketPath, {
    plugin: PLUGIN,
    stage: 'install:pre-tunnel',
    call: { kind: 'app' },
    input: {},
    timeoutMs: 2000,
  });
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.decision.output, {
    read: 'ERR_ACCESS_DENIED',
    write: 'ERR_ACCESS_DENIED',
    spawn: 'ERR_ACCESS_DENIED',
    worker: 'ERR_ACCESS_DENIED',
    env: 0,
  });
});

test('runner: a missing stage and a wrong plugin are failures, not decisions', async () => {
  const missing = await callRelayHook(socketPath, {
    plugin: PLUGIN,
    stage: 'uninstall:post-teardown',
    call: { kind: 'app' },
    input: {},
    timeoutMs: 1000,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.kind, 'missing');
  const wrong = await callRelayHook(socketPath, {
    plugin: 'other',
    stage: 'tunnel:down',
    call: { kind: 'app' },
    input: {},
    timeoutMs: 1000,
  });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.kind, 'invalid');
});

test('forwarder: pre-forward rejects before anything reaches the agent half', async () => {
  halfLog = [];
  const res = await app.inject({
    method: 'POST',
    url: '/api/fx/import/batch',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ valid: false }),
  });
  assert.equal(res.statusCode, 422);
  assert.deepEqual(res.json(), { error: 'invalid import' });
  assert.equal(halfLog.length, 0);
});

test('forwarder: pre-forward continues with its header edit and the body intact', async () => {
  halfLog = [];
  const res = await app.inject({
    method: 'POST',
    url: '/api/fx/import/batch',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    payload: JSON.stringify({ valid: true, rows: [1, 2, 3] }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(halfLog.length, 1);
  assert.equal(halfLog[0].headers['x-validated'], 'yes');
  assert.equal(halfLog[0].headers.authorization, undefined);
  assert.deepEqual(JSON.parse(halfLog[0].body), { valid: true, rows: [1, 2, 3] });
});

test('forwarder: a body over the hook limit is refused (onOversize reject)', async () => {
  halfLog = [];
  const res = await app.inject({
    method: 'POST',
    url: '/api/fx/import/batch',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ valid: true, pad: 'x'.repeat(2000) }),
  });
  assert.equal(res.statusCode, 413);
  assert.equal(halfLog.length, 0);
});

test('forwarder: a hook that throws fails closed (503), and says nothing of what it saw', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/fx/throw?card=4111' });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().reasonId, 'hook-failed');
  assert.ok(!res.body.includes('4111'));
});

test('forwarder: a stuck hook times out, fails closed, and the runner is replaced', async () => {
  const started = Date.now();
  const res = await app.inject({ method: 'GET', url: '/api/fx/stuck' });
  assert.equal(res.statusCode, 503);
  assert.ok(Date.now() - started < 3000);
  const next = await app.inject({
    method: 'POST',
    url: '/api/fx/import/x',
    headers: { 'content-type': 'application/json' },
    payload: '{"valid":true}',
  });
  assert.equal(next.statusCode, 200);
});

test('forwarder: post-forward redacts a planted token with the shared scanner', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/fx/export/all' });
  assert.equal(res.statusCode, 200);
  assert.ok(!res.body.includes(TOKEN));
  assert.deepEqual(res.json(), { token: '[REDACTED:github-token]', n: '12345678901234567890' });
  assert.equal(res.headers['content-length'], String(Buffer.byteLength(res.body)));
  assert.equal(res.headers.etag, undefined);
  // The hooked route asked the agent half for an uncompressed body.
  assert.equal(halfLog.at(-1).headers['accept-encoding'], 'identity');
});

test('forwarder: a response too large for its hook is blocked, or passed when declared so', async () => {
  const blocked = await app.inject({ method: 'GET', url: '/api/fx/big' });
  assert.equal(blocked.statusCode, 502);
  assert.equal(blocked.json().reasonId, 'response-too-large');
  const passed = await app.inject({ method: 'GET', url: '/api/fx/big-pass' });
  assert.equal(passed.statusCode, 200);
  assert.equal(passed.body.length, 4096 + 1 + TOKEN.length);
});

test('forwarder: an event stream on a scanned route is refused as not checkable', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/fx/events' });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().reasonId, 'response-not-checkable');
  assert.ok(!res.body.includes(TOKEN));
});

test('forwarder: unhooked routes stream through untouched', async () => {
  halfLog = [];
  const res = await app.inject({ method: 'GET', url: '/api/fx/status' });
  assert.equal(res.statusCode, 200);
  assert.equal(halfLog.length, 1);
  assert.equal(halfLog[0].headers['accept-encoding'], undefined);
});

test('forwarder: while down, the tunnel:down fallback answers instead of a bare 502', async () => {
  const bare = await app.inject({ method: 'GET', url: '/api/down/x' });
  assert.equal(bare.statusCode, 502);
  const outcome = await callRelayHook(socketPath, {
    plugin: PLUGIN,
    stage: 'tunnel:down',
    call: { kind: 'app' },
    input: { state: 'down', reason: 'tunnel', since: new Date().toISOString() },
    timeoutMs: 1000,
  });
  fallback = validateHookDecision('tunnel:down', outcome.decision).decision.fallback;
  const res = await app.inject({ method: 'GET', url: '/api/down/x' });
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['retry-after'], '30');
  assert.deepEqual(res.json(), { error: 'maintenance', reason: 'tunnel' });
  fallback = null;
});

test('forwarder: /admin/hooks stays Lamaste-only even with hooks', async () => {
  halfLog = [];
  const res = await app.inject({
    method: 'POST',
    url: '/api/fx/hooks/install:pre-tunnel',
    payload: '{}',
  });
  assert.equal(res.statusCode, 404);
  assert.equal(halfLog.length, 0);
  // and a Lamaste call is what the agent half would accept there
  assert.ok(
    signCallerAssertion(
      { plugin: PLUGIN, caller: { type: 'lamaste' }, method: 'POST', path: '/admin/hooks/x' },
      SECRET,
    ),
  );
});
