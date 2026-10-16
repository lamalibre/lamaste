/**
 * Slice 4 security fixes, the relay's side and core's pure parts: anything
 * that takes a tunnel's loopback port must get nothing and serve nothing.
 *
 * - Caller assertions bind the exact body (`bodySha256`): a replay with
 *   another body is `wrong_body`, and burns no nonce.
 * - The agent half authenticates its answers (`X-Lamalibre-Responder`):
 *   `callAgentHalf` / `callAgentHalfHook` answer `unauthenticated`, the
 *   health probe counts `app`, and the forwarder answers 502 — whatever a
 *   squatter without the installation secret sends.
 * - Settings secrets travel sealed to their request (AES-256-GCM under a
 *   key derived from the installation secret): round trip, and no opening
 *   under another nonce, key, revision, plugin or secret.
 * - The review's fixes: the manifest schema never runs a pattern (ReDoS),
 *   unknown keys are counted and never named, the agent half's messages are
 *   normalized, display text refuses control and bidi characters, the
 *   2 MiB bound holds the largest valid update, and the forwarder reserves
 *   `hooks*` / `settings*` however they are spelled.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  AGENT_HALF_SETTINGS_MAX_BYTES,
  CALLER_ASSERTION_HEADER,
  NonceStore,
  RESPONDER_HEADER,
  SETTINGS_STRING_MAX_LENGTH,
  SettingsBlockSchema,
  bodySha256Hex,
  callAgentHalf,
  callAgentHalfHook,
  decryptSettingsSecret,
  encryptSettingsSecret,
  generateCallerAssertionNonce,
  generateHostingSecret,
  normalizeSettingsErrorMessage,
  parseAgentHalfSettingsUpdate,
  signCallerAssertion,
  signResponder,
  validateManifest,
  validateSettingsUpdate,
  verifyCallerAssertion,
  verifyResponder,
} from '@lamalibre/lamaste';
import {
  createAgentHookHandler,
  createCallerAssertionVerifier,
  createHealthHandler,
  responderHeaderFor,
} from '@lamalibre/lamaste/agent';
import {
  agentForwarderPlugin,
  isAgentHalfHooksPath,
  isAgentHalfReservedPath,
  probePluginHosting,
} from '@lamalibre/lamaste/server';

const PLUGIN = 'fx';
/** A secret value distinctive enough to search every error and answer for. */
const VALUE = 'sk-Zq9-DISTINCTIVE-S1-VALUE-5521';

let dir;
let secret;
let configPath;
const servers = [];

function listen(server) {
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
  );
}

/** A node:http server around one of core's framework-agnostic handlers. */
function serve(handler) {
  return http.createServer((req, res) => {
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
}

/** Whatever took the port: answers everything with `status` and `body`, plus `headers`. */
function squatter(status, body, headers = {}) {
  return http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(body);
    });
  });
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-s1-security-'));
  secret = generateHostingSecret();
  configPath = path.join(dir, 'half.json');
  await writeFile(
    configPath,
    JSON.stringify({
      plugin: PLUGIN,
      port: 0,
      secret,
      issuedAt: '2026-10-16T00:00:00.000Z',
      fetchedAt: '2026-10-16T00:00:01.000Z',
      acknowledged: true,
    }),
    { mode: 0o600 },
  );
});

after(async () => {
  for (const server of servers) {
    server.closeAllConnections?.();
    server.close();
  }
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Body binding
// ---------------------------------------------------------------------------

const BODY = Buffer.from('{"stage":"tunnel:up","input":{}}');

function bound(body = BODY, extra = {}) {
  return signCallerAssertion(
    {
      plugin: PLUGIN,
      caller: { type: 'lamaste' },
      method: 'POST',
      path: '/admin/hooks/tunnel:up',
      bodySha256: bodySha256Hex(body),
      ...extra,
    },
    secret,
  );
}

function verify(header, opts = {}) {
  return verifyCallerAssertion(header, {
    secrets: [secret],
    plugin: PLUGIN,
    method: 'POST',
    path: '/admin/hooks/tunnel:up',
    nonces: new NonceStore(),
    ...opts,
  });
}

test('body binding: the signed hash must match the body; a replay with another body is wrong_body', () => {
  assert.equal(verify(bound(), { body: BODY, requireBodyHash: true }).ok, true);
  assert.equal(verify(bound(), { body: BODY.toString(), requireBodyHash: true }).ok, true);
  const other = Buffer.from('{"stage":"tunnel:up","input":{"evil":true}}');
  assert.equal(verify(bound(), { body: other, requireBodyHash: true }).reason, 'wrong_body');
  // Required: an assertion without a body hash is refused, whatever the body.
  const unbound = signCallerAssertion(
    { plugin: PLUGIN, caller: { type: 'lamaste' }, method: 'POST', path: '/admin/hooks/tunnel:up' },
    secret,
  );
  assert.equal(verify(unbound, { body: BODY, requireBodyHash: true }).reason, 'wrong_body');
  assert.equal(verify(unbound, { requireBodyHash: true }).reason, 'wrong_body');
  // An absent body counts as empty.
  assert.equal(verify(bound(Buffer.alloc(0)), { requireBodyHash: true }).ok, true);
  // Not required: a hash is checked when the body is given...
  assert.equal(verify(bound(), { body: other }).reason, 'wrong_body');
  assert.equal(verify(unbound, { body: other }).ok, true);
  // ...and ignored when it is not, as a verifier from before the field does.
  assert.equal(verify(bound()).ok, true);
});

test('body binding: a refused body burns no nonce; the true one still verifies', () => {
  const nonces = new NonceStore();
  const header = bound();
  const other = Buffer.from('{}');
  assert.equal(verify(header, { body: other, requireBodyHash: true, nonces }).reason, 'wrong_body');
  assert.equal(nonces.size, 0);
  assert.equal(verify(header, { body: BODY, requireBodyHash: true, nonces }).ok, true);
  assert.equal(verify(header, { body: BODY, requireBodyHash: true, nonces }).reason, 'replayed');
});

test('body binding: a malformed body hash or nonce is refused at signing and at verifying', () => {
  assert.throws(() => bound(BODY, { bodySha256: 'ABC' }), /body hash/);
  assert.throws(() => bound(BODY, { nonce: 'not-a-nonce' }), /nonce/);
  // A payload with a malformed hash, correctly signed: malformed.
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      plugin: PLUGIN,
      caller: { type: 'lamaste' },
      method: 'POST',
      path: '/admin/hooks/tunnel:up',
      iat: Date.now(),
      nonce: generateCallerAssertionNonce(),
      bodySha256: 'Z'.repeat(64),
    }),
  ).toString('base64url');
  const mac = crypto
    .createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(payload)
    .digest('base64url');
  assert.equal(verify(`${payload}.${mac}`).reason, 'malformed');
});

// ---------------------------------------------------------------------------
// Responder signatures
// ---------------------------------------------------------------------------

test('responder: bound to the secret, the nonce, the status and — in the body form — the body', () => {
  const nonce = generateCallerAssertionNonce();
  const base = { secret, nonce, status: 200, body: '{"ok":true}' };
  const header = signResponder(base);
  assert.equal(header.length, 43);
  assert.equal(verifyResponder(header, base), true);
  assert.equal(verifyResponder(header, { ...base, body: Buffer.from('{"ok":true}') }), true);
  for (const changed of [
    { secret: generateHostingSecret() },
    { nonce: generateCallerAssertionNonce() },
    { status: 201 },
    { body: '{"ok":false}' },
    { body: undefined }, // the `-` form is another signature
  ]) {
    assert.equal(verifyResponder(header, { ...base, ...changed }), false, JSON.stringify(changed));
  }
  const stream = signResponder({ secret, nonce, status: 200 });
  assert.equal(verifyResponder(stream, { secret, nonce, status: 200 }), true);
  assert.equal(verifyResponder(stream, { secret, nonce, status: 200, body: '' }), false);
  for (const bad of [undefined, '', 'x'.repeat(43), [header], `${header}=`, header.slice(1)]) {
    assert.equal(verifyResponder(bad, base), false, String(bad));
  }
  assert.throws(() => signResponder({ ...base, status: 99 }), /status/);
  assert.throws(() => signResponder({ ...base, nonce: 'x' }), /nonce/);
});

test('responder: a verified request signs its answers without handing out the secret', () => {
  const nonce = generateCallerAssertionNonce();
  const verified = verify(bound(BODY, { nonce }), { body: BODY, requireBodyHash: true });
  assert.equal(verified.ok, true);
  assert.equal(
    verified.responder(200, 'x'),
    signResponder({ secret, nonce, status: 200, body: 'x' }),
  );
  assert.equal(verified.responder(204), signResponder({ secret, nonce, status: 204 }));
  assert.deepEqual(responderHeaderFor(verified, 200), {
    [RESPONDER_HEADER]: signResponder({ secret, nonce, status: 200 }),
  });
  assert.ok(!JSON.stringify(verified).includes(secret));
  assert.ok(!Object.values(verified).some((v) => v === secret));
});

test('callAgentHalf: an answer without a valid responder header is unauthenticated, never an answer', async () => {
  const call = (port) =>
    callAgentHalf({
      plugin: PLUGIN,
      port,
      secret,
      method: 'PUT',
      path: '/admin/settings',
      body: { secret: VALUE },
      timeoutMs: 2_000,
      maxResponseBytes: 64 * 1024,
    });
  // A squatter answering a plausible state, with no header.
  const bare = await call(await listen(squatter(200, '{"revision":0}')));
  assert.equal(bare.ok, false);
  assert.equal(bare.code, 'unauthenticated');
  assert.match(bare.error, /did not authenticate its answer/);
  assert.match(bare.error, /without an X-Lamalibre-Responder header/);
  assert.match(bare.error, /older @lamalibre\/lamaste that must be rebuilt/);
  // A header that does not verify: made up, or signed with another secret.
  const madeUp = await call(
    await listen(squatter(200, '{}', { [RESPONDER_HEADER]: 'A'.repeat(43) })),
  );
  assert.equal(madeUp.code, 'unauthenticated');
  assert.match(madeUp.error, /does not verify/);
  // A genuine signature over another body (the answer altered on the way).
  const nonces = new NonceStore();
  const altered = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const verified = verifyCallerAssertion(req.headers[CALLER_ASSERTION_HEADER], {
        secrets: [secret],
        plugin: PLUGIN,
        method: req.method,
        path: req.url,
        nonces,
      });
      res.writeHead(200, { [RESPONDER_HEADER]: verified.responder(200, '{"a":1}') });
      res.end('{"a":2}');
    });
  });
  const swapped = await call(await listen(altered));
  assert.equal(swapped.code, 'unauthenticated');
  for (const failure of [bare, madeUp, swapped]) {
    assert.ok(!JSON.stringify(failure).includes(VALUE), 'the request body is never repeated');
  }
});

test('callAgentHalfHook: core’s hook handler is believed; a squatter is unauthenticated', async () => {
  const verifier = createCallerAssertionVerifier({ configPath, plugin: PLUGIN });
  const handler = createAgentHookHandler({
    verifier,
    hooks: { 'install:pre-tunnel': (input) => ({ ok: true, output: { phase: input.phase } }) },
  });
  const port = await listen(serve(handler));
  const call = (p) =>
    callAgentHalfHook({
      plugin: PLUGIN,
      port: p,
      secret,
      stage: 'install:pre-tunnel',
      input: { plugin: PLUGIN, phase: 'install', outputs: {} },
      timeoutMs: 2_000,
    });
  assert.deepEqual(await call(port), {
    ok: true,
    decision: { ok: true, output: { phase: 'install' } },
  });
  const fake = await call(await listen(squatter(200, '{"ok":true}')));
  assert.equal(fake.ok, false);
  assert.equal(fake.code, 'unauthenticated');
});

test('health: only an authenticated 2xx is up; a failing check and a squatter are app failures', async () => {
  const verifier = createCallerAssertionVerifier({ configPath, plugin: PLUGIN });
  let healthy = true;
  const port = await listen(serve(createHealthHandler({ verifier, check: () => healthy })));
  assert.deepEqual(await probePluginHosting({ plugin: PLUGIN, port, secret }), { ok: true });
  healthy = false;
  const sick = await probePluginHosting({ plugin: PLUGIN, port, secret });
  assert.deepEqual(sick, { ok: false, reason: 'app', error: '/admin/health answered 503' });
  const fake = await probePluginHosting({
    plugin: PLUGIN,
    port: await listen(squatter(200, '{"ok":true}')),
    secret,
  });
  assert.equal(fake.ok, false);
  assert.equal(fake.reason, 'app');
  assert.match(fake.error, /did not authenticate its answer/);
});

test('forwarder: an unauthenticated answer is a 502 (app) — or the tunnel:down fallback while down', async () => {
  const { default: Fastify } = await import('fastify');
  const squatPort = await listen(
    squatter(200, 'window.panel = "not the plugin";', { 'content-type': 'text/javascript' }),
  );
  let fallback = null;
  const app = Fastify({ logger: false });
  await app.register(
    async (scope) => {
      await scope.register(agentForwarderPlugin, {
        resolveTarget: async () => ({
          plugin: PLUGIN,
          port: squatPort,
          secret,
          maxBodyBytes: 1024,
        }),
        authorize: async () => ({ type: 'admin' }),
        hooks: {
          hooksFor: async () => ({ hooks: [] }),
          run: async () => ({ ok: false }),
          fallbackFor: () => fallback,
        },
      });
    },
    { prefix: '/api' },
  );
  await app.ready();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/fx/panel.js' });
    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.json(), {
      error: 'The agent half did not authenticate its answer',
      reason: 'app',
    });
    assert.doesNotMatch(res.body, /not the plugin/);
    // While the plugin is down, the fallback its tunnel:down hook returned.
    fallback = { status: 503, body: { error: 'maintenance' }, retryAfter: 30 };
    const down = await app.inject({ method: 'GET', url: '/api/fx/panel.js' });
    assert.equal(down.statusCode, 503);
    assert.deepEqual(down.json(), { error: 'maintenance' });
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Sealed settings secrets
// ---------------------------------------------------------------------------

test('settings secrets: sealed and opened under the same plugin, nonce, key, revision and secret', () => {
  const nonce = generateCallerAssertionNonce();
  const ctx = { secret, plugin: PLUGIN, nonce, key: 'apiKey', baseRevision: 3 };
  const sealed = encryptSettingsSecret({ ...ctx, value: VALUE });
  assert.deepEqual(Object.keys(sealed), ['v', 'iv', 'ct']);
  assert.equal(sealed.v, 1);
  assert.equal(Buffer.from(sealed.iv, 'base64url').length, 12);
  assert.equal(Buffer.from(sealed.ct, 'base64url').length, Buffer.byteLength(VALUE) + 16);
  assert.ok(!JSON.stringify(sealed).includes(VALUE));
  assert.equal(decryptSettingsSecret({ ...ctx, sealed }), VALUE);
  // A fresh IV every time: the same value never seals the same way twice.
  assert.notEqual(encryptSettingsSecret({ ...ctx, value: VALUE }).ct, sealed.ct);
  // Unicode survives.
  const text = 'şifre-密码-🔑';
  assert.equal(
    decryptSettingsSecret({ ...ctx, sealed: encryptSettingsSecret({ ...ctx, value: text }) }),
    text,
  );
});

test('settings secrets: another nonce, key, revision, plugin or secret — or a flipped bit — does not open', () => {
  const ctx = {
    secret,
    plugin: PLUGIN,
    nonce: generateCallerAssertionNonce(),
    key: 'apiKey',
    baseRevision: 3,
  };
  const sealed = encryptSettingsSecret({ ...ctx, value: VALUE });
  const ct = Buffer.from(sealed.ct, 'base64url');
  ct[0] ^= 1;
  const iv = Buffer.from(sealed.iv, 'base64url');
  iv[0] ^= 1;
  for (const [what, attempt] of [
    ['nonce', { ...ctx, nonce: generateCallerAssertionNonce(), sealed }],
    ['key', { ...ctx, key: 'token', sealed }],
    ['revision', { ...ctx, baseRevision: 4, sealed }],
    ['plugin', { ...ctx, plugin: 'other', sealed }],
    ['secret', { ...ctx, secret: generateHostingSecret(), sealed }],
    ['ciphertext', { ...ctx, sealed: { ...sealed, ct: ct.toString('base64url') } }],
    ['iv', { ...ctx, sealed: { ...sealed, iv: iv.toString('base64url') } }],
    ['version', { ...ctx, sealed: { ...sealed, v: 2 } }],
    ['shape', { ...ctx, sealed: VALUE }],
  ]) {
    assert.throws(
      () => decryptSettingsSecret(attempt),
      (err) =>
        err.message === 'The secret could not be decrypted' && !String(err.stack).includes(VALUE),
      what,
    );
  }
});

test('settings secrets: the update parser takes only the sealed form, within its size', () => {
  const nonce = generateCallerAssertionNonce();
  const big = 'é'.repeat(SETTINGS_STRING_MAX_LENGTH); // 2 bytes each
  const sealedBig = encryptSettingsSecret({
    secret,
    plugin: PLUGIN,
    nonce,
    key: 'apiKey',
    baseRevision: 0,
    value: big,
  });
  const update = (secrets) => ({ schemaVersion: 1, baseRevision: 0, values: {}, secrets });
  assert.ok(parseAgentHalfSettingsUpdate(update({ apiKey: sealedBig })));
  // Over the bound (more than 3 bytes per unit of the longest secret).
  const tooBig = encryptSettingsSecret({
    secret,
    plugin: PLUGIN,
    nonce,
    key: 'apiKey',
    baseRevision: 0,
    value: '🔑'.repeat(SETTINGS_STRING_MAX_LENGTH * 0.75 + 1),
  });
  assert.equal(parseAgentHalfSettingsUpdate(update({ apiKey: tooBig })), null);
  assert.equal(parseAgentHalfSettingsUpdate(update({ apiKey: VALUE })), null);
});

// ---------------------------------------------------------------------------
// Review fixes
// ---------------------------------------------------------------------------

test('ReDoS: a catastrophic pattern with a non-matching default validates instantly on the relay', () => {
  const field = {
    key: 'name',
    label: 'Name',
    type: 'string',
    pattern: '^(a+)+$',
    default: `${'a'.repeat(40)}!`,
  };
  const started = process.hrtime.bigint();
  assert.equal(SettingsBlockSchema.safeParse({ schemaVersion: 1, fields: [field] }).success, true);
  const manifest = validateManifest({
    name: 'fx',
    version: '1.0.0',
    hosting: 'agent',
    agent: {},
    settings: { schemaVersion: 1, fields: [field] },
  });
  const checked = validateSettingsUpdate(
    manifest.settings,
    { values: { name: `${'a'.repeat(40)}!` } },
    { checkPattern: false },
  );
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(checked.ok, true);
  // Running the pattern once on that input would take many minutes.
  assert.ok(elapsedMs < 250, `validated in ${elapsedMs} ms`);
});

test('unknown keys: counted under "_", never named, whatever their shape', () => {
  const block = SettingsBlockSchema.parse({
    schemaVersion: 1,
    fields: [{ key: 'note', label: 'Note', type: 'string' }],
  });
  const result = validateSettingsUpdate(
    block,
    {
      values: { apikeyvalue: 1, [`Bad ${VALUE}`]: 2, note: 'ok' },
      secrets: { [VALUE.toLowerCase().replace(/-/g, '')]: 'x' },
    },
    { checkPattern: true },
  );
  assert.deepEqual(result, { ok: false, errors: { _: '3 unknown settings' } });
  assert.ok(!JSON.stringify(result).includes('apikeyvalue'));
  assert.ok(!JSON.stringify(result).toLowerCase().includes('distinctive'));
});

test('messages: the agent half’s 422 passes on only messages Lamaste’s validation produces', () => {
  for (const message of [
    'Must be a string',
    'Must not be empty',
    'Does not match the required format',
    'Must be an integer',
    'Must be a number',
    'Must be true or false',
    'Must be one of the options',
    'Is a secret; send it in secrets',
    'Is not a secret; send it in values',
    'Is required',
    'Could not be decrypted',
    '"values" must be an object',
    'Must be at most 1024 characters',
    'Must be at least -5',
    'Must be at most 0.25',
    'Must be at least 1e+21',
    'Must be at most -1.5e-7',
    '1 unknown setting',
    '12 unknown settings',
  ]) {
    assert.equal(normalizeSettingsErrorMessage(message), message);
  }
  for (const message of [
    `Must be a string: ${VALUE}`,
    `Is required ${VALUE}`,
    'Must be at most 12345 characters',
    'Must be at least abc',
    'Must be at most 1 or else',
    'Unknown setting',
    '1 unknown settings of apiKey',
    VALUE,
    '',
    'x'.repeat(1000),
    42,
    null,
    { message: 'Is required' },
  ]) {
    assert.equal(normalizeSettingsErrorMessage(message), 'Invalid value', String(message));
  }
});

test('display text: labels, descriptions, options, string defaults and patterns refuse control and bidi characters', () => {
  const base = { key: 'k', label: 'K', type: 'string' };
  const enumField = { key: 'e', label: 'E', type: 'enum', options: [{ value: 'a', label: 'A' }] };
  const issue = (field) => {
    const result = SettingsBlockSchema.safeParse({ schemaVersion: 1, fields: [field] });
    return result.success ? null : result.error.issues.map((i) => i.message).join('\n');
  };
  for (const bad of ['‮evil', 'a\u0007', 'tab\there', 'new\nline', '\u0085', '⁦x', '‏', '\u007F']) {
    for (const field of [
      { ...base, label: `L${bad}` },
      { ...base, description: bad },
      { ...base, default: bad },
      { ...base, pattern: bad },
      { ...enumField, options: [{ value: bad, label: 'A' }] },
      { ...enumField, options: [{ value: 'a', label: bad }] },
    ]) {
      assert.match(issue(field) ?? '', /Contains control characters/, JSON.stringify(field));
    }
  }
  assert.equal(issue({ ...base, label: 'Übersicht — API key (ünıcode)' }), null);
  assert.equal(issue({ ...base, default: 'plain', pattern: '^[a-z]+$' }), null);
});

test('size: the largest valid update, sealed secrets included, fits the 2 MiB bound', () => {
  assert.equal(AGENT_HALF_SETTINGS_MAX_BYTES, 2 * 1024 * 1024);
  const nonce = generateCallerAssertionNonce();
  const values = {};
  const secrets = {};
  for (let i = 0; i < 50; i += 1) {
    const key = `k${String(i).padStart(2, '0')}${'x'.repeat(60)}`;
    // Every unit a control character: JSON escapes each to six bytes.
    if (i % 2 === 0) values[key] = '\u0001'.repeat(SETTINGS_STRING_MAX_LENGTH);
    else {
      secrets[key] = encryptSettingsSecret({
        secret,
        plugin: PLUGIN,
        nonce,
        key,
        baseRevision: Number.MAX_SAFE_INTEGER,
        value: '￿'.repeat(SETTINGS_STRING_MAX_LENGTH), // 3 UTF-8 bytes each
      });
    }
  }
  const all = { schemaVersion: 1, baseRevision: Number.MAX_SAFE_INTEGER, values, secrets };
  const bytes = Buffer.byteLength(JSON.stringify(all));
  assert.ok(bytes < AGENT_HALF_SETTINGS_MAX_BYTES, `${bytes} bytes`);
  // All 50 as escaped strings — the worst valid case — still fits.
  const allValues = Object.fromEntries(
    Array.from({ length: 50 }, (_, i) => [
      `k${String(i).padStart(2, '0')}${'x'.repeat(60)}`,
      '\u0001'.repeat(SETTINGS_STRING_MAX_LENGTH),
    ]),
  );
  const worst = Buffer.byteLength(JSON.stringify({ ...all, values: allValues, secrets: {} }));
  assert.ok(worst < AGENT_HALF_SETTINGS_MAX_BYTES, `${worst} bytes`);
});

test('reservation: hooks* and settings* however they are spelled, encoded or suffixed', () => {
  for (const reserved of [
    '/admin/hooks',
    '/admin/HOOKS/x',
    '/admin/hooks.json',
    '/admin/hooks-v2/x',
    '/admin/.hooks',
    '/admin/h%00ooks',
    '/admin/%68ooks',
    '/admin/%2568ooks', // encoded twice
    '/admin/%252568ooks', // three times
    '/admin/settings',
    '/admin/Settings_V2',
    '/admin/settings.json?x=1',
    '/admin/%73ettings',
    '/admin/%2573ettings',
    '/admin/%E0%A4%A', // undecodable
    '/admin/%25252568ooks', // still decoding after the last round
  ]) {
    assert.equal(isAgentHalfReservedPath(reserved), true, reserved);
  }
  for (const open of [
    '/admin',
    '/admin/jobs',
    '/admin/hook',
    '/admin/xhooks',
    '/admin/sett',
    '/admin/xsettings',
    '/admin/jobs/settings',
    '/admin/jobs/hooks',
    '/admin/panel.js',
  ]) {
    assert.equal(isAgentHalfReservedPath(open), false, open);
  }
  assert.equal(isAgentHalfHooksPath('/admin/%2568ooks.json'), true);
  assert.equal(isAgentHalfHooksPath('/admin/settings'), false);
});
