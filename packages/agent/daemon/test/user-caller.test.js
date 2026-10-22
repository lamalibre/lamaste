/**
 * Slice 6, the agent half's verifier: the `user` caller — a person on the
 * plugin's user surface, named by the directory's id, username and roles —
 * is valid only for a path under `/app`, read literally, and every other
 * caller is never valid for a path a router could take for `/app`. Signing
 * refuses either mistake; a verifier answers `wrong_request` for a
 * correctly signed one. Whatever the caller, a path is in origin form — one
 * leading `/`, no scheme, no host — and an encoded `%` (`%25`) never
 * reaches `/app`. Assertions as 4.4 signed them still verify, byte for
 * byte, extra fields and all.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  NonceStore,
  RESPONDER_HEADER,
  generateCallerAssertionNonce,
  generateHostingSecret,
  parseCallerIdentity,
  signCallerAssertion,
  signResponder,
  verifyCallerAssertion,
} from '@lamalibre/lamaste';
import {
  createCallerAssertionVerifier,
  createHealthHandler,
  responderHeaderFor,
} from '@lamalibre/lamaste/agent';

const PLUGIN = 'fx';
const USER = {
  type: 'user',
  userId: '4f0b8c9e-2d1a-4c3b-9a8e-7f6d5c4b3a21',
  username: 'ayse',
  roles: ['viewer'],
};

let dir;
let configPath;
let secret;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-s6-user-caller-'));
  configPath = path.join(dir, 'half.json');
  secret = generateHostingSecret();
  await writeFile(
    configPath,
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
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** An assertion over exactly `payload`, signed by hand — what a signer that checks nothing would send. */
function forged(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const mac = crypto
    .createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${mac}`;
}

function payloadFor(caller, method, pathWithQuery, extra = {}) {
  return {
    v: 1,
    plugin: PLUGIN,
    caller,
    method,
    path: pathWithQuery,
    iat: Date.now(),
    nonce: generateCallerAssertionNonce(),
    ...extra,
  };
}

function verify(header, method, pathWithQuery) {
  return verifyCallerAssertion(header, {
    secrets: [secret],
    plugin: PLUGIN,
    method,
    path: pathWithQuery,
    nonces: new NonceStore(),
  });
}

test('a user caller verifies under /app, with its id, username and roles', async () => {
  const verifier = createCallerAssertionVerifier({ configPath, plugin: PLUGIN });
  for (const p of [
    '/app',
    '/app/',
    '/app/me',
    '/app/series/x?from=2026-01&to=2026-10',
    '/app?x=1',
  ]) {
    const header = signCallerAssertion(
      { plugin: PLUGIN, caller: USER, method: 'GET', path: p },
      secret,
    );
    const result = await verifier.verify({ 'x-lamalibre-caller': header }, 'GET', p);
    assert.equal(result.ok, true, `${p}: ${result.reason}`);
    assert.deepEqual(result.payload.caller, USER);
  }
});

test('a user caller is never valid outside /app: refused at signing and at verifying', () => {
  for (const p of ['/admin', '/admin/health', '/admin/app/x', '/apps', '/App/x', '/application']) {
    assert.throws(
      () => signCallerAssertion({ plugin: PLUGIN, caller: USER, method: 'GET', path: p }, secret),
      /only valid for a path under \/app/,
      p,
    );
    assert.equal(verify(forged(payloadFor(USER, 'GET', p)), 'GET', p).reason, 'wrong_request', p);
  }
  // Under /app, but with a segment a server could resolve elsewhere.
  for (const p of [
    '/app/../admin/settings',
    '/app/%2e%2e/admin',
    '/app/a%2Fb',
    '/app/a%5Cb',
    '/app/a\\b',
    '/app/./x',
    '/app/%E0%A4%A',
    // An encoded `%`: a router decoding twice would read `..` or `/`.
    '/app/%252e%252e/admin/x',
    '/app/a%252Fb',
    '/app/%25',
  ]) {
    assert.throws(
      () => signCallerAssertion({ plugin: PLUGIN, caller: USER, method: 'GET', path: p }, secret),
      /only valid for a path under \/app/,
      p,
    );
    assert.equal(verify(forged(payloadFor(USER, 'GET', p)), 'GET', p).reason, 'wrong_request', p);
  }
});

test('admin, agent and Lamaste are never valid under /app, however it is spelled', () => {
  const others = [{ type: 'admin' }, { type: 'agent', label: 'vm1' }, { type: 'lamaste' }];
  for (const caller of others) {
    for (const p of ['/app', '/app/me', '/app?x=1', '/App/me', '/%61pp/me', '/app.json']) {
      assert.throws(
        () => signCallerAssertion({ plugin: PLUGIN, caller, method: 'GET', path: p }, secret),
        /Only a user caller is valid for a path under \/app/,
        `${caller.type} ${p}`,
      );
      const result = verify(forged(payloadFor(caller, 'GET', p)), 'GET', p);
      assert.equal(result.reason, 'wrong_request', `${caller.type} ${p}`);
    }
    // Their own surface is unchanged.
    const header = signCallerAssertion(
      { plugin: PLUGIN, caller, method: 'GET', path: '/admin/app/x' },
      secret,
    );
    assert.equal(verify(header, 'GET', '/admin/app/x').ok, true, caller.type);
  }
});

test('every caller is signed and verified for an origin-form path only — no scheme, no host', () => {
  const callers = [USER, { type: 'admin' }, { type: 'agent', label: 'vm1' }, { type: 'lamaste' }];
  for (const caller of callers) {
    for (const p of [
      'http://x/app/me',
      'https://evil.example.com/admin/health',
      '//app/x',
      '//evil.example.com/admin/x',
      '/\\evil.example.com/app/x',
      'app/me',
      'admin/health',
      '*',
      '?x=1',
      '',
    ]) {
      assert.throws(
        () => signCallerAssertion({ plugin: PLUGIN, caller, method: 'GET', path: p }, secret),
        /origin form/,
        `${caller.type} ${JSON.stringify(p)}`,
      );
      assert.equal(
        verify(forged(payloadFor(caller, 'GET', p)), 'GET', p).reason,
        'wrong_request',
        `${caller.type} ${JSON.stringify(p)}`,
      );
    }
  }
  // One leading slash is all it takes — the paths every caller uses still verify.
  for (const [caller, p] of [
    [USER, '/app/me'],
    [{ type: 'admin' }, '/admin/status'],
    [{ type: 'lamaste' }, '/admin/health'],
    [{ type: 'agent', label: 'vm1' }, '/admin//x'],
  ]) {
    const header = signCallerAssertion({ plugin: PLUGIN, caller, method: 'GET', path: p }, secret);
    assert.equal(verify(header, 'GET', p).ok, true, `${caller.type} ${p}`);
  }
});

test('a malformed user caller is malformed — the id, the username and the roles are checked', () => {
  const bad = [
    { ...USER, userId: USER.userId.toUpperCase() },
    { ...USER, userId: '4f0b8c9e-2d1a-1c3b-9a8e-7f6d5c4b3a21' }, // v1
    { ...USER, userId: 'not-a-uuid' },
    { ...USER, username: 'Ayse' },
    { ...USER, username: '-ayse' },
    { ...USER, username: 'a' },
    { ...USER, username: 'a'.repeat(33) },
    { ...USER, roles: [] },
    { ...USER, roles: ['viewer', 'viewer'] },
    { ...USER, roles: ['Viewer'] },
    { ...USER, roles: Array.from({ length: 33 }, (_, i) => `r${i}`) },
    { type: 'user', userId: USER.userId, username: USER.username },
  ];
  for (const caller of bad) {
    assert.equal(parseCallerIdentity(caller), null, JSON.stringify(caller));
    assert.throws(
      () => signCallerAssertion({ plugin: PLUGIN, caller, method: 'GET', path: '/app' }, secret),
      /Invalid caller/,
    );
    assert.equal(
      verify(forged(payloadFor(caller, 'GET', '/app')), 'GET', '/app').reason,
      'malformed',
      JSON.stringify(caller),
    );
  }
  // Extra fields of a user caller are dropped, not signed.
  const header = signCallerAssertion(
    { plugin: PLUGIN, caller: { ...USER, email: 'ayse@example.com' }, method: 'GET', path: '/app' },
    secret,
  );
  const encoded = header.split('.')[0];
  assert.ok(!Buffer.from(encoded, 'base64url').toString('utf-8').includes('example.com'));
  assert.deepEqual(verify(header, 'GET', '/app').payload.caller, USER);
});

test('assertions as 4.4 signed them: byte for byte the same, and still verified', () => {
  const iat = Date.now();
  const nonce = generateCallerAssertionNonce();
  const cases = [
    [{ type: 'admin' }, 'GET', '/admin/panel.js'],
    [{ type: 'agent', label: 'vm1' }, 'POST', '/admin/jobs?x=1'],
    [{ type: 'lamaste' }, 'GET', '/admin/health'],
  ];
  for (const [caller, method, p] of cases) {
    // 4.4's serialization: v, plugin, caller, method, path, iat, nonce.
    const expected = forged({ v: 1, plugin: PLUGIN, caller, method, path: p, iat, nonce });
    const signed = signCallerAssertion(
      { plugin: PLUGIN, caller, method, path: p, iat, nonce },
      secret,
    );
    assert.equal(signed, expected, caller.type);
    const result = verify(expected, method, p);
    assert.equal(result.ok, true, caller.type);
    assert.deepEqual(result.payload.caller, caller);
  }
  // Extra fields are still tolerated, as in 4.4.
  const extra = forged(
    payloadFor({ type: 'admin', note: 'x' }, 'GET', '/admin/x', { future: { field: 1 } }),
  );
  const result = verify(extra, 'GET', '/admin/x');
  assert.equal(result.ok, true);
  assert.deepEqual(result.payload.caller, { type: 'admin' });
});

test('a verified user request is answered in the `-` form; core routes refuse a user caller', async () => {
  const verifier = createCallerAssertionVerifier({ configPath, plugin: PLUGIN });
  const nonce = generateCallerAssertionNonce();
  const signed = signCallerAssertion(
    { plugin: PLUGIN, caller: USER, method: 'GET', path: '/app/me', nonce },
    secret,
  );
  const verified = await verifier.verify({ 'x-lamalibre-caller': signed }, 'GET', '/app/me');
  assert.equal(verified.ok, true);
  // What the panel's forwarder checks on the answer: the nonce and the status.
  assert.deepEqual(responderHeaderFor(verified, 200), {
    [RESPONDER_HEADER]: signResponder({ secret, nonce, status: 200 }),
  });

  const handler = createHealthHandler({ verifier });
  // A user assertion for /admin/health cannot even be signed; forged, it is wrong_request (401).
  const header = forged(payloadFor(USER, 'GET', '/admin/health'));
  const answer = await handler.handle({
    method: 'GET',
    url: '/admin/health',
    headers: { 'x-lamalibre-caller': header },
  });
  assert.equal(answer.status, 401);
  assert.deepEqual(answer.body, { error: 'wrong_request' });
});
