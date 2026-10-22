/**
 * Slice 6, the agent half's identity routes: the panel's feed arrives at
 * `/admin/identity/notify` and `/admin/identity/changes` — only from
 * Lamaste, only with the body its assertion signs, every answer to a
 * verified call authenticated over its exact bytes. End to end: the relay's
 * `callAgentHalf` against the handlers over HTTP, the projection in
 * `node:sqlite`. A batch's changes travel sealed to the request — bound to
 * its nonce and envelope, under a key derived from the installation secret —
 * so the wire carries no member in clear. Nothing about a member reaches a
 * log line or an error.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  AGENT_HALF_IDENTITY_CHANGES_PATH,
  AGENT_HALF_IDENTITY_NOTIFY_PATH,
  IDENTITY_ANSWER_MAX_BYTES,
  IDENTITY_BATCH_MAX_BYTES,
  RESPONDER_HEADER,
  bodySha256Hex,
  callAgentHalf,
  encryptSettingsSecret,
  generateCallerAssertionNonce,
  generateHostingSecret,
  parseIdentityChangesAnswer,
  parseIdentityCursorConflict,
  parseIdentityNotifyAnswer,
  sealIdentityChanges,
  signCallerAssertion,
  signResponder,
} from '@lamalibre/lamaste';
import {
  createCallerAssertionVerifier,
  createIdentityHandlers,
  createIdentityProjection,
} from '@lamalibre/lamaste/agent';

const PLUGIN = 'fx';
const DIRECTORY = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const U1 = '11111111-1111-4111-8111-111111111111';
const NAME = 'Ayşe DISTINCTIVE-NAME-5512';
const EMAIL = 'ayse.distinctive.5512@example.com';

let dir;
let configPath;
let secret;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-s6-identity-'));
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

function recordingLogger() {
  const lines = [];
  return {
    lines,
    info: (obj, msg) => lines.push(JSON.stringify({ obj, msg })),
    warn: (obj, msg) => lines.push(JSON.stringify({ obj, msg })),
  };
}

/** A half serving the identity routes over HTTP, its body passed as received. */
async function startHalf(handlers) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const out = await handlers.handle({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      res.writeHead(out.status, out.headers);
      res.end(out.bodyText);
    });
  });
  const port = await new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
  );
  return { server, port };
}

function setup(hooks = {}) {
  const logger = recordingLogger();
  const projection = createIdentityProjection({ db: new DatabaseSync(':memory:'), ...hooks });
  const verifier = createCallerAssertionVerifier({ configPath, plugin: PLUGIN });
  const handlers = createIdentityHandlers({ verifier, projection, logger });
  return { logger, projection, handlers };
}

function changesBody(fields = {}) {
  return {
    protocol: 1,
    directoryId: DIRECTORY,
    from: 0,
    to: 5,
    reset: true,
    reconcile: false,
    pass: crypto.randomUUID(),
    final: true,
    changes: [
      {
        seq: 3,
        kind: 'upsert',
        member: {
          userId: U1,
          username: 'ayse',
          displayName: NAME,
          email: EMAIL,
          roles: ['viewer'],
          status: 'active',
          version: 1,
        },
      },
    ],
    ...fields,
  };
}

/**
 * A batch as the relay sends it: the envelope in clear, `changes` sealed for
 * the request with `nonce` (`sealFor` another plugin, `with` another secret).
 */
function seal(batch, nonce, { sealFor = PLUGIN, with: key = secret } = {}) {
  const { protocol, changes, ...envelope } = batch;
  return {
    protocol,
    ...envelope,
    changes: sealIdentityChanges({ secret: key, plugin: sealFor, nonce, envelope, changes }),
  };
}

/**
 * A request as the relay signs it, with any caller; `nonce` returned to check
 * the answer. A `body` function is called with the nonce (to seal to it).
 */
function signed(method, url, body, { caller = { type: 'lamaste' }, bindBody = true } = {}) {
  const nonce = generateCallerAssertionNonce();
  const value = typeof body === 'function' ? body(nonce) : body;
  const bytes = value === undefined ? undefined : Buffer.from(JSON.stringify(value), 'utf-8');
  const header = signCallerAssertion(
    {
      plugin: PLUGIN,
      caller,
      method,
      path: url,
      nonce,
      ...(bytes && bindBody ? { bodySha256: bodySha256Hex(bytes) } : {}),
    },
    secret,
  );
  return {
    nonce,
    request: { method, url, headers: { 'x-lamalibre-caller': header }, body: bytes },
  };
}

test('end to end: the panel notifies, pushes a batch, and learns the cursor from a 409', async () => {
  const { logger, projection, handlers } = setup();
  const { server, port } = await startHalf(handlers);
  try {
    const call = (p, body) =>
      callAgentHalf({
        plugin: PLUGIN,
        port,
        secret,
        method: 'POST',
        path: p,
        body,
        timeoutMs: 5_000,
        maxResponseBytes: IDENTITY_ANSWER_MAX_BYTES,
      });
    const notify = { protocol: 1, directoryId: DIRECTORY, seq: 5 };
    const first = await call(AGENT_HALF_IDENTITY_NOTIFY_PATH, notify);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.status, 200);
    assert.deepEqual(parseIdentityNotifyAnswer(first.body), {
      protocol: 1,
      directoryId: null,
      cursor: 0,
    });

    const applied = await call(AGENT_HALF_IDENTITY_CHANGES_PATH, (nonce) =>
      seal(changesBody(), nonce),
    );
    assert.equal(applied.status, 200, JSON.stringify(applied));
    assert.deepEqual(parseIdentityChangesAnswer(applied.body), {
      protocol: 1,
      directoryId: DIRECTORY,
      cursor: 5,
      mismatches: 0,
    });
    assert.equal(projection.getUser(U1).displayName, NAME);

    const second = await call(AGENT_HALF_IDENTITY_NOTIFY_PATH, notify);
    assert.deepEqual(second.body, { protocol: 1, directoryId: DIRECTORY, cursor: 5 });

    // The same batch again: the cursor is past it — 409 with what the half holds.
    const conflict = await call(AGENT_HALF_IDENTITY_CHANGES_PATH, (nonce) =>
      seal(changesBody({ reset: false, final: false }), nonce),
    );
    assert.equal(conflict.status, 409);
    assert.deepEqual(parseIdentityCursorConflict(conflict.body), {
      error: 'cursor_mismatch',
      protocol: 1,
      directoryId: DIRECTORY,
      cursor: 5,
    });

    // Metadata only: no member's attributes in any log line.
    const logged = logger.lines.join('\n');
    assert.match(logged, /Applied an identity batch/);
    assert.match(logged, /did not continue from the cursor/);
    for (const personal of ['ayse', NAME, EMAIL]) assert.ok(!logged.includes(personal), personal);
  } finally {
    server.close();
  }
});

test('only Lamaste, only with the body it signed; answers to a verified call are authenticated', async () => {
  const { handlers, projection } = setup();
  const url = AGENT_HALF_IDENTITY_CHANGES_PATH;
  const plain = changesBody();
  const body = (nonce) => seal(plain, nonce);

  // An admin through some other path: verified, refused, and the refusal signed over its body.
  const admin = signed('POST', url, body, { caller: { type: 'admin' } });
  const refused = await handlers.handle(admin.request);
  assert.equal(refused.status, 403);
  assert.equal(
    refused.headers[RESPONDER_HEADER],
    signResponder({ secret, nonce: admin.nonce, status: 403 }),
    'a forwarded caller gets the `-` form',
  );
  const agent = signed('POST', url, body, { caller: { type: 'agent', label: 'vm1' } });
  assert.equal((await handlers.handle(agent.request)).status, 403);

  // Lamaste without the body hash, or with another body: 401, unsigned.
  const unbound = signed('POST', url, body, { bindBody: false });
  const unboundAnswer = await handlers.handle(unbound.request);
  assert.equal(unboundAnswer.status, 401);
  assert.deepEqual(unboundAnswer.body, { error: 'wrong_body' });
  assert.equal(unboundAnswer.headers[RESPONDER_HEADER], undefined);
  const swapped = signed('POST', url, body);
  const swappedAnswer = await handlers.handle({
    ...swapped.request,
    body: Buffer.from(JSON.stringify(seal(changesBody({ to: 9 }), swapped.nonce))),
  });
  assert.equal(swappedAnswer.status, 401);

  // No assertion, a body a framework parsed, another path or method, too large.
  assert.equal(
    (await handlers.handle({ method: 'POST', url, headers: {}, body: '{}' })).status,
    401,
  );
  assert.equal(
    (await handlers.handle({ ...signed('POST', url, body).request, body: plain })).status,
    400,
  );
  assert.equal(
    (await handlers.handle(signed('POST', '/admin/identity/other', body).request)).status,
    404,
  );
  assert.equal((await handlers.handle(signed('GET', url).request)).status, 405);
  const huge = await handlers.handle({
    method: 'POST',
    url,
    headers: {},
    body: Buffer.alloc(IDENTITY_BATCH_MAX_BYTES + 1, 0x20),
  });
  assert.equal(huge.status, 413);

  // Verified, but not the contract: signed 400s.
  const otherProtocol = signed('POST', url, (nonce) => ({ ...body(nonce), protocol: 2 }));
  const protocolAnswer = await handlers.handle(otherProtocol.request);
  assert.equal(protocolAnswer.status, 400);
  assert.deepEqual(protocolAnswer.body, { error: 'Unsupported identity protocol', protocol: 1 });
  assert.equal(
    protocolAnswer.headers[RESPONDER_HEADER],
    signResponder({
      secret,
      nonce: otherProtocol.nonce,
      status: 400,
      body: protocolAnswer.bodyText,
    }),
  );
  // Changes in clear are not the contract; sealed changes that are not a batch either.
  const unsealed = signed('POST', url, plain);
  const unsealedAnswer = await handlers.handle(unsealed.request);
  assert.equal(unsealedAnswer.status, 400);
  assert.deepEqual(unsealedAnswer.body, { error: 'Malformed identity batch' });
  const malformed = signed('POST', url, (nonce) =>
    seal({ ...plain, changes: [{ seq: 1, kind: 'upsert' }] }, nonce),
  );
  const malformedAnswer = await handlers.handle(malformed.request);
  assert.equal(malformedAnswer.status, 400);
  assert.deepEqual(malformedAnswer.body, { error: 'Malformed identity batch' });
  const notJson = signed('POST', url, body);
  assert.equal(
    (await handlers.handle({ ...notJson.request, body: Buffer.from('{not json') })).status,
    401,
    'a body other than the signed one never gets as far as parsing',
  );
  const badNotify = signed('POST', AGENT_HALF_IDENTITY_NOTIFY_PATH, {
    protocol: 1,
    directoryId: 'nope',
    seq: 1,
  });
  assert.deepEqual((await handlers.handle(badNotify.request)).body, {
    error: 'Malformed identity notification',
  });

  // Nothing of it was applied.
  assert.deepEqual(projection.state(), { directoryId: null, cursor: 0 });

  // Lamaste with the body it signed: applied, the answer signed over its exact bytes.
  const lamaste = signed('POST', url, body);
  const ok = await handlers.handle(lamaste.request);
  assert.equal(ok.status, 200);
  assert.equal(
    ok.headers[RESPONDER_HEADER],
    signResponder({ secret, nonce: lamaste.nonce, status: 200, body: ok.bodyText }),
  );
});

test('a projection failure is a signed 500 that names nothing, and the batch is rolled back', async () => {
  const { handlers, projection, logger } = setup({
    onUpsert: (user) => {
      throw new Error(`cannot store ${user.displayName}`);
    },
  });
  const request = signed('POST', AGENT_HALF_IDENTITY_CHANGES_PATH, (nonce) =>
    seal(changesBody(), nonce),
  );
  const answer = await handlers.handle(request.request);
  assert.equal(answer.status, 500);
  assert.deepEqual(answer.body, { error: 'The identity projection failed' });
  assert.equal(
    answer.headers[RESPONDER_HEADER],
    signResponder({ secret, nonce: request.nonce, status: 500, body: answer.bodyText }),
  );
  assert.deepEqual(projection.state(), { directoryId: null, cursor: 0 });
  assert.equal(projection.getUser(U1), null);
  const logged = logger.lines.join('\n');
  assert.match(logged, /Applying an identity batch failed/);
  assert.ok(!logged.includes(NAME));
});

test('the changes travel sealed: nothing of a member in clear, and they open only for their request', async () => {
  const { handlers, projection, logger } = setup();
  const url = AGENT_HALF_IDENTITY_CHANGES_PATH;
  const plain = changesBody();

  const sent = signed('POST', url, (nonce) => seal(plain, nonce));
  const wire = sent.request.body.toString('utf-8');
  for (const personal of ['ayse', NAME, EMAIL, U1]) {
    assert.ok(!wire.includes(personal), `${personal} is not on the wire in clear`);
  }
  assert.deepEqual(Object.keys(JSON.parse(wire).changes).sort(), ['ct', 'iv', 'v']);

  const refusedAs = async (request) => {
    const answer = await handlers.handle(request);
    assert.equal(answer.status, 400);
    assert.deepEqual(answer.body, { error: 'The identity changes could not be opened' });
    assert.ok(answer.headers[RESPONDER_HEADER], 'a verified call gets a signed refusal');
  };
  // Sealed to another request's nonce (replayed under a fresh assertion).
  const otherNonce = generateCallerAssertionNonce();
  await refusedAs(signed('POST', url, seal(plain, otherNonce)).request);
  // Moved under another envelope — re-signed, so only the seal can tell.
  await refusedAs(
    signed('POST', url, (nonce) => ({ ...seal(plain, nonce), to: 9, final: false })).request,
  );
  // Sealed for another plugin, or with another secret.
  await refusedAs(signed('POST', url, (nonce) => seal(plain, nonce, { sealFor: 'gx' })).request);
  await refusedAs(
    signed('POST', url, (nonce) => seal(plain, nonce, { with: generateHostingSecret() })).request,
  );
  // A settings secret sealed for the same request is not identity changes.
  await refusedAs(
    signed('POST', url, (nonce) => ({
      ...seal(plain, nonce),
      changes: encryptSettingsSecret({
        secret,
        plugin: PLUGIN,
        nonce,
        key: 'changes',
        baseRevision: 0,
        value: JSON.stringify(plain.changes),
      }),
    })).request,
  );
  assert.deepEqual(projection.state(), { directoryId: null, cursor: 0 });

  assert.equal((await handlers.handle(sent.request)).status, 200);
  assert.equal(projection.getUser(U1).displayName, NAME);
  const logged = logger.lines.join('\n');
  for (const personal of ['ayse', NAME, EMAIL]) assert.ok(!logged.includes(personal), personal);
});
