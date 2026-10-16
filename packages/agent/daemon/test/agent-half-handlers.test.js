/**
 * Slice 4 security fixes, the agent half's side: core's handlers answer a
 * verified request with `X-Lamalibre-Responder` (over the exact bytes they
 * return for Lamaste's own calls, the `-` form for a forwarded caller) and
 * nothing else with it; a body Lamaste signs must be passed as received;
 * the verifier checks bodies, keeps doing so across a secret rotation, and
 * opens sealed settings secrets without handing the secret out; and
 * `createHealthHandler` answers the relay's probe.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  RESPONDER_HEADER,
  bodySha256Hex,
  encryptSettingsSecret,
  generateCallerAssertionNonce,
  generateHostingSecret,
  signCallerAssertion,
  signResponder,
} from '@lamalibre/lamaste';
import {
  createAgentHookHandler,
  createCallerAssertionVerifier,
  createHealthHandler,
  responderHeaderFor,
} from '@lamalibre/lamaste/agent';

const PLUGIN = 'fx';
const VALUE = 'sk-Zq9-DISTINCTIVE-AGENT-S1-8810';

let dir;
let configPath;
let secret;

async function writeConfig(config) {
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-s1-handlers-'));
  configPath = path.join(dir, 'half.json');
  secret = generateHostingSecret();
  await writeConfig({
    plugin: PLUGIN,
    port: 0,
    secret,
    issuedAt: '2026-10-16T00:00:00.000Z',
    fetchedAt: '2026-10-16T00:00:01.000Z',
    acknowledged: true,
  });
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A request as the relay signs it; `nonce` returned so the answer can be checked. */
function signed(method, url, { caller = { type: 'lamaste' }, body, withSecret = secret } = {}) {
  const nonce = generateCallerAssertionNonce();
  const header = signCallerAssertion(
    {
      plugin: PLUGIN,
      caller,
      method,
      path: url,
      nonce,
      ...(body !== undefined ? { bodySha256: bodySha256Hex(body) } : {}),
    },
    withSecret,
  );
  return { nonce, request: { method, url, headers: { 'x-lamalibre-caller': header }, body } };
}

test('health: an authenticated answer for Lamaste, the `-` form for a forwarded caller', async () => {
  const verifier = createCallerAssertionVerifier({ configPath, plugin: PLUGIN });
  let healthy = true;
  const handler = createHealthHandler({ verifier, check: async () => healthy });

  const lamaste = signed('GET', '/admin/health');
  const up = await handler.handle(lamaste.request);
  assert.equal(up.status, 200);
  assert.deepEqual(up.body, { ok: true });
  assert.equal(up.bodyText, '{"ok":true}');
  assert.equal(up.headers['content-type'], 'application/json');
  assert.equal(
    up.headers[RESPONDER_HEADER],
    signResponder({ secret, nonce: lamaste.nonce, status: 200, body: up.bodyText }),
  );

  const admin = signed('GET', '/admin/health?x=1', { caller: { type: 'admin' } });
  const forwarded = await handler.handle(admin.request);
  assert.equal(forwarded.status, 200);
  assert.equal(
    forwarded.headers[RESPONDER_HEADER],
    signResponder({ secret, nonce: admin.nonce, status: 200 }),
  );

  healthy = false;
  const sickRequest = signed('GET', '/admin/health');
  const sick = await handler.handle(sickRequest.request);
  assert.equal(sick.status, 503);
  assert.deepEqual(sick.body, { ok: false });
  assert.equal(
    sick.headers[RESPONDER_HEADER],
    signResponder({ secret, nonce: sickRequest.nonce, status: 503, body: sick.bodyText }),
  );
});

test('health: a throwing check is unhealthy and says nothing; unverified answers carry no signature', async () => {
  const verifier = createCallerAssertionVerifier({ configPath, plugin: PLUGIN });
  const handler = createHealthHandler({
    verifier,
    check: () => {
      throw new Error(`database at ${VALUE} is gone`);
    },
  });
  const thrown = await handler.handle(signed('GET', '/admin/health').request);
  assert.equal(thrown.status, 503);
  assert.ok(!thrown.bodyText.includes(VALUE));

  const plain = createHealthHandler({ verifier });
  const unsigned = await plain.handle({ method: 'GET', url: '/admin/health', headers: {} });
  assert.equal(unsigned.status, 401);
  assert.deepEqual(unsigned.body, { error: 'malformed' });
  assert.equal(unsigned.headers[RESPONDER_HEADER], undefined);
  const forged = await plain.handle(
    signed('GET', '/admin/health', { withSecret: generateHostingSecret() }).request,
  );
  assert.equal(forged.status, 401);
  assert.equal(forged.headers[RESPONDER_HEADER], undefined);
  assert.equal((await plain.handle(signed('GET', '/admin/healthz').request)).status, 404);
  assert.equal((await plain.handle(signed('POST', '/admin/health').request)).status, 405);
  // No check: healthy.
  assert.equal((await plain.handle(signed('GET', '/admin/health').request)).status, 200);
});

test('hooks: the body must be passed as received, and be the one the assertion signs', async () => {
  const verifier = createCallerAssertionVerifier({ configPath, plugin: PLUGIN });
  const handler = createAgentHookHandler({ verifier, hooks: { 'tunnel:up': () => undefined } });
  const url = '/admin/hooks/tunnel:up';
  const body = JSON.stringify({ stage: 'tunnel:up', input: { state: 'up', since: 'now' } });

  const ok = signed('POST', url, { body: Buffer.from(body) });
  const answered = await handler.handle(ok.request);
  assert.equal(answered.status, 200);
  assert.deepEqual(answered.body, { ok: true });
  assert.equal(
    answered.headers[RESPONDER_HEADER],
    signResponder({ secret, nonce: ok.nonce, status: 200, body: answered.bodyText }),
  );

  // Parsed by a framework: the signed bytes are gone.
  const parsed = signed('POST', url, { body });
  const refused = await handler.handle({ ...parsed.request, body: JSON.parse(body) });
  assert.equal(refused.status, 400);
  assert.deepEqual(refused.body, { error: 'The body must be passed as received' });
  assert.equal(refused.headers[RESPONDER_HEADER], undefined);

  // The assertion of one call with another body: refused, and its nonce not burned.
  const other = JSON.stringify({ stage: 'tunnel:up', input: { state: 'up', since: 'later' } });
  const lifted = signed('POST', url, { body });
  const swapped = await handler.handle({ ...lifted.request, body: Buffer.from(other) });
  assert.equal(swapped.status, 401);
  assert.deepEqual(swapped.body, { error: 'wrong_body' });
  assert.equal((await handler.handle(lifted.request)).status, 200);

  // An assertion that signs no body at all.
  const unbound = signed('POST', url);
  const noHash = await handler.handle({ ...unbound.request, body });
  assert.deepEqual(noHash.body, { error: 'wrong_body' });

  // A forwarded caller gets a signed refusal in the `-` form.
  const admin = signed('POST', url, { body, caller: { type: 'admin' } });
  const forbidden = await handler.handle(admin.request);
  assert.equal(forbidden.status, 403);
  assert.equal(
    forbidden.headers[RESPONDER_HEADER],
    signResponder({ secret, nonce: admin.nonce, status: 403 }),
  );
});

test('verifier: bodies are checked across a rotation; sealed secrets open without the secret leaving it', async () => {
  const verifier = createCallerAssertionVerifier({
    configPath,
    plugin: PLUGIN,
    reloadIntervalMs: 0,
  });
  const url = '/admin/settings';
  const body = Buffer.from('{"x":1}');
  // Rotated: the relay signs with the new secret, the file holds both.
  const next = generateHostingSecret();
  await writeConfig({
    plugin: PLUGIN,
    port: 0,
    secret: next,
    issuedAt: '2026-10-16T01:00:00.000Z',
    previousSecret: secret,
    previousIssuedAt: '2026-10-16T00:00:00.000Z',
    fetchedAt: '2026-10-16T01:00:01.000Z',
    acknowledged: false,
  });
  try {
    const fresh = signed('PUT', url, { body, withSecret: next });
    const wrong = await verifier.verify(fresh.request.headers, 'PUT', url, {
      body: Buffer.from('{"x":2}'),
      requireBodyHash: true,
    });
    assert.equal(wrong.reason, 'wrong_body');
    const verified = await verifier.verify(fresh.request.headers, 'PUT', url, {
      body,
      requireBodyHash: true,
    });
    assert.equal(verified.ok, true);
    assert.equal(verified.secretIndex, 0);
    // Answers are signed with the secret that verified the request.
    assert.deepEqual(responderHeaderFor(verified, 200), {
      [RESPONDER_HEADER]: signResponder({ secret: next, nonce: fresh.nonce, status: 200 }),
    });
    const sealed = encryptSettingsSecret({
      secret: next,
      plugin: PLUGIN,
      nonce: fresh.nonce,
      key: 'apiKey',
      baseRevision: 2,
      value: VALUE,
    });
    assert.equal(verified.decryptSettingsSecret('apiKey', 2, sealed), VALUE);
    assert.throws(
      () => verified.decryptSettingsSecret('apiKey', 3, sealed),
      /could not be decrypted/,
    );
    assert.ok(!JSON.stringify(verified).includes(next));

    // The previous secret still verifies during the overlap, and signs as itself.
    const old = signed('PUT', url, { body, withSecret: secret });
    const previous = await verifier.verify(old.request.headers, 'PUT', url, {
      body,
      requireBodyHash: true,
    });
    assert.equal(previous.secretIndex, 1);
    assert.equal(
      previous.responder(200, '{}'),
      signResponder({ secret, nonce: old.nonce, status: 200, body: '{}' }),
    );
  } finally {
    await writeConfig({
      plugin: PLUGIN,
      port: 0,
      secret,
      issuedAt: '2026-10-16T00:00:00.000Z',
      fetchedAt: '2026-10-16T00:00:01.000Z',
      acknowledged: true,
    });
  }
});
