/**
 * Relay-signed app jobs (slice 3): the agent's root helper runs an
 * `app-install`, `app-activate` or `app-remove` only when the relay signed
 * it, so the relay signs every app job when it creates it.
 *
 * The contract (core `app-job-signature.ts`): the canonical form of the
 * envelope, a signature that verifies only with the relay's key and only
 * over exactly those bytes — every field tampered with is refused — and no
 * confusion with relay assertions, signed with the same key. Then the
 * relay: an app job is created only while its signing key is usable, and
 * the app jobs a relay had pending from before signing are cancelled by
 * the migration rather than listed unsigned.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APP_JOB_SIGNATURE_CLOCK_SKEW_MS,
  APP_JOB_SIGNATURE_MAX_LIFETIME_MS,
  APP_JOB_SIGNATURE_TYPE,
  NonceStore,
  RELAY_SIGNING_KEY_FILE,
  appJobEnvelopeMatches,
  appJobPayload,
  canonicalJson,
  createRelaySigner,
  decodeAppJobSignature,
  parseRelayVerifyKey,
  relayVerifyKeyOf,
  signAppJob,
  signRelayAssertion,
  verifyAppJobSignature,
  verifyRelayAssertion,
} from '@lamalibre/lamaste';

const MIGRATIONS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'lib',
  'migrations',
  'state',
);

let dir;
let stateDir;
let key;
let otherKey;
let verifyKey;
let lib;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-app-job-signature-'));
  stateDir = path.join(dir, 'state');
  await mkdir(stateDir);
  key = await createRelaySigner(path.join(dir, 'a.json'), { create: true }).current();
  otherKey = await createRelaySigner(path.join(dir, 'b.json'), { create: true }).current();
  verifyKey = parseRelayVerifyKey(relayVerifyKeyOf(key));
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = stateDir;
  lib = {
    ...(await import('../src/lib/agent-jobs.js')),
    ...(await import('../src/lib/relay-signing.js')),
    ...(await import('../src/lib/plugin-hosting.js')),
  };
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const spec = {
  package: '@lamalibre/fx-agent',
  version: '1.2.0',
  integrity: `sha512-${Buffer.alloc(64, 9).toString('base64')}`,
  service: { entry: 'dist/agentd.js', memoryMax: '512M' },
  systemPackages: ['curl', 'sqlite3'],
};

const NOW = Date.parse('2026-10-16T10:00:00.000Z');
const at = (ms) => new Date(ms).toISOString();

function input(overrides = {}) {
  return {
    agent: 'vm1',
    route: 'fx',
    jobId: '7b0c6a1e-4a8f-4c55-9a43-2f1f3c2d9e10',
    kind: 'app-install',
    payload: { spec },
    issuedAt: at(NOW),
    expiresAt: at(NOW + 690_000),
    ...overrides,
  };
}

const verify = (signature, now = NOW, k = verifyKey) =>
  verifyAppJobSignature(signature, { key: k, now });

/** A signature over `envelope` — whatever it holds — made with `signingKey`. */
function forge(envelope, signingKey = key, text = canonicalJson(envelope)) {
  const bytes = Buffer.from(text, 'utf-8');
  return {
    envelope: bytes.toString('base64url'),
    sig: crypto.sign(null, bytes, signingKey.privateKey).toString('base64url'),
  };
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

test('canonical form: the envelope is the sorted, whitespace-free JSON of exactly its fields', () => {
  const signature = signAppJob(input(), key);
  assert.deepEqual(Object.keys(signature).sort(), ['envelope', 'sig']);
  assert.match(signature.sig, /^[A-Za-z0-9_-]{86}$/);
  const text = Buffer.from(signature.envelope, 'base64url').toString('utf-8');
  const parsed = JSON.parse(text);
  assert.equal(text, canonicalJson(parsed));
  assert.deepEqual(Object.keys(parsed), [
    'agent',
    'expiresAt',
    'issuedAt',
    'jobId',
    'kid',
    'kind',
    'payload',
    'route',
    'typ',
    'v',
  ]);
  assert.deepEqual(parsed, {
    v: 1,
    typ: APP_JOB_SIGNATURE_TYPE,
    kid: key.kid,
    ...input(),
  });
  assert.ok(!/\s/.test(text.replace(/"[^"]*"/g, '')), 'no whitespace outside strings');
  // Nested keys are sorted too, at every level.
  assert.equal(
    canonicalJson({ b: { d: 1, c: [{ f: 1, e: 2 }] }, a: null }),
    '{"a":null,"b":{"c":[{"e":2,"f":1}],"d":1}}',
  );
  // Only what JSON carries: nothing is silently dropped.
  for (const value of [
    { a: undefined },
    { a: () => 1 },
    { a: Number.NaN },
    { a: 1n },
    [new Date()],
  ]) {
    assert.throws(() => canonicalJson(value), TypeError);
  }
  // A "__proto__" key stays a key (and is refused as an envelope field).
  const proto = JSON.parse('{"__proto__":{"x":1},"a":1}');
  assert.equal(canonicalJson(proto), '{"__proto__":{"x":1},"a":1}');
});

test('payloads: each kind its own, strictly; removal and activation name the package', () => {
  assert.deepEqual(appJobPayload('app-install', { spec }), { spec });
  assert.deepEqual(appJobPayload('app-activate', { version: '1.0.0', package: spec.package }), {
    version: '1.0.0',
    package: spec.package,
  });
  assert.deepEqual(appJobPayload('app-remove', { purge: true, package: spec.package }), {
    purge: true,
    package: spec.package,
  });
  assert.throws(() => appJobPayload('app-remove', { purge: true }), /package/);
  assert.throws(() => appJobPayload('app-activate', { version: '1.0.0' }), /package/);
  assert.throws(
    () => appJobPayload('app-remove', { purge: 'yes', package: spec.package }),
    /purge/,
  );
  assert.throws(() => appJobPayload('app-install', { spec, extra: 1 }), TypeError);
  assert.throws(() => appJobPayload('app-install', { spec: { ...spec, version: 'latest' } }));
  assert.throws(() => appJobPayload('app-activate', { version: '1', package: spec.package }));
  assert.throws(() => appJobPayload('app-remove', { purge: true, package: 'left-pad' }));
});

test('verify: the relay key and the exact bytes, current, every kind', () => {
  for (const extra of [
    {},
    { kind: 'app-activate', payload: { version: '1.0.0', package: spec.package } },
    { kind: 'app-remove', payload: { purge: false, package: spec.package } },
  ]) {
    const result = verify(signAppJob(input(extra), key));
    assert.equal(result.ok, true);
    assert.deepEqual(result.envelope, {
      v: 1,
      typ: APP_JOB_SIGNATURE_TYPE,
      kid: key.kid,
      ...input(extra),
    });
  }
  // Another key: unknown; another key claiming this kid: a bad signature.
  assert.deepEqual(verify(signAppJob(input(), otherKey)), { ok: false, reason: 'unknown_key' });
  const envelope = { v: 1, typ: APP_JOB_SIGNATURE_TYPE, kid: key.kid, ...input() };
  assert.deepEqual(verify(forge(envelope, otherKey)), { ok: false, reason: 'bad_signature' });

  // Time: issued up to the clock skew ahead; never past its expiry.
  const good = signAppJob(input(), key);
  assert.equal(verify(good, NOW - APP_JOB_SIGNATURE_CLOCK_SKEW_MS).ok, true);
  assert.deepEqual(verify(good, NOW - APP_JOB_SIGNATURE_CLOCK_SKEW_MS - 1), {
    ok: false,
    reason: 'future',
  });
  assert.equal(verify(good, NOW + 689_999).ok, true);
  assert.deepEqual(verify(good, NOW + 690_000), { ok: false, reason: 'expired' });

  // At most an hour's validity, and expiry after issue: neither signed nor accepted.
  const tooLong = input({ expiresAt: at(NOW + APP_JOB_SIGNATURE_MAX_LIFETIME_MS + 1) });
  assert.throws(() => signAppJob(tooLong, key), /Not a valid app-install job/);
  assert.deepEqual(verify(forge({ v: 1, typ: APP_JOB_SIGNATURE_TYPE, kid: key.kid, ...tooLong })), {
    ok: false,
    reason: 'malformed',
  });
  assert.throws(() => signAppJob(input({ expiresAt: at(NOW) }), key));
  assert.ok(signAppJob(input({ expiresAt: at(NOW + APP_JOB_SIGNATURE_MAX_LIFETIME_MS) }), key));
});

test('tamper: every field changed after signing is refused', () => {
  const signature = signAppJob(input(), key);
  const original = JSON.parse(Buffer.from(signature.envelope, 'base64url').toString('utf-8'));
  const changes = {
    v: 2,
    typ: 'lamaste.relay.assertion',
    kid: otherKey.kid,
    agent: 'vm2',
    route: 'gx',
    jobId: '7b0c6a1e-4a8f-4c55-9a43-2f1f3c2d9e11',
    kind: 'app-remove',
    payload: { spec: { ...spec, systemPackages: ['curl', 'sqlite3', 'openssh-server'] } },
    issuedAt: at(NOW - 1000),
    expiresAt: at(NOW + 700_000),
  };
  for (const [field, value] of Object.entries(changes)) {
    const tampered = {
      ...signature,
      envelope: Buffer.from(canonicalJson({ ...original, [field]: value })).toString('base64url'),
    };
    const result = verify(tampered);
    assert.equal(result.ok, false, field);
  }
  // Each part of the spec, the version and the integrity among them.
  for (const [field, value] of Object.entries({
    package: '@lamalibre/other-agent',
    version: '1.2.1',
    integrity: `sha512-${Buffer.alloc(64, 8).toString('base64')}`,
    service: { entry: 'dist/evil.js', memoryMax: '512M' },
    systemPackages: ['curl'],
  })) {
    const payload = { spec: { ...spec, [field]: value } };
    const tampered = {
      ...signature,
      envelope: Buffer.from(canonicalJson({ ...original, payload })).toString('base64url'),
    };
    assert.deepEqual(verify(tampered), { ok: false, reason: 'bad_signature' }, field);
  }
  // The signature itself, one bit.
  const sig = Buffer.from(signature.sig, 'base64url');
  sig[10] ^= 1;
  assert.deepEqual(verify({ ...signature, sig: sig.toString('base64url') }), {
    ok: false,
    reason: 'bad_signature',
  });
  // Signed — but not canonical, or with a field more: refused before anything else.
  const envelope = { v: 1, typ: APP_JOB_SIGNATURE_TYPE, kid: key.kid, ...input() };
  assert.deepEqual(verify(forge(envelope, key, JSON.stringify(envelope))), {
    ok: false,
    reason: 'malformed',
  });
  assert.deepEqual(verify(forge(envelope, key, JSON.stringify(envelope, null, 1))), {
    ok: false,
    reason: 'malformed',
  });
  assert.deepEqual(verify(forge({ ...envelope, note: 'x' })), { ok: false, reason: 'malformed' });
  assert.deepEqual(verify(forge({ ...envelope, payload: { ...envelope.payload, x: 1 } })), {
    ok: false,
    reason: 'malformed',
  });
  // The shape it travels in, strictly.
  for (const bad of [
    null,
    'x',
    { envelope: signature.envelope },
    { ...signature, extra: 1 },
    { envelope: `${signature.envelope}=`, sig: signature.sig },
    { envelope: signature.envelope, sig: `${signature.sig}A` },
    { envelope: 'not base64url!', sig: signature.sig },
  ]) {
    assert.deepEqual(verify(bad), { ok: false, reason: 'malformed' });
    assert.equal(decodeAppJobSignature(bad), null);
  }
});

test('domain separation: an app job is never a relay assertion, nor the other way round', () => {
  const nonces = new NonceStore();
  const keys = new Map([[key.kid, verifyKey.publicKey]]);
  // An app job's envelope and signature presented as an assertion header.
  const job = signAppJob(input(), key);
  const asAssertion = verifyRelayAssertion(`${job.envelope}.${job.sig}`, {
    keys,
    aud: 'vm1',
    port: 9393,
    method: 'GET',
    url: '/api/status',
    nonces,
    now: NOW,
  });
  assert.equal(asAssertion.ok, false);
  assert.equal(asAssertion.reason, 'bad_signature');

  // A relay assertion presented as an app job.
  const header = signRelayAssertion(
    {
      aud: 'vm1',
      port: 9393,
      caller: { type: 'admin' },
      method: 'POST',
      target: { path: '/api/plugins' },
      iat: NOW,
    },
    key,
  );
  const [encoded, sig] = header.split('.');
  assert.deepEqual(verify({ envelope: encoded, sig }), { ok: false, reason: 'malformed' });
  // And at the signature level: the bytes signed differ in kind — an
  // assertion signs base64url text, a job JSON (which starts with "{").
  const jobBytes = Buffer.from(job.envelope, 'base64url');
  assert.equal(jobBytes[0], '{'.charCodeAt(0));
  assert.equal(
    crypto.verify(
      null,
      Buffer.from(encoded, 'utf-8'),
      verifyKey.publicKey,
      Buffer.from(sig, 'base64url'),
    ),
    true,
  );
  assert.equal(
    crypto.verify(
      null,
      Buffer.from(encoded, 'base64url'),
      verifyKey.publicKey,
      Buffer.from(sig, 'base64url'),
    ),
    false,
  );
  assert.equal(
    crypto.verify(
      null,
      Buffer.from(job.envelope, 'utf-8'),
      verifyKey.publicKey,
      Buffer.from(job.sig, 'base64url'),
    ),
    false,
  );
});

test('matching: the agent checks a job and its signature describe the same work', () => {
  const decoded = decodeAppJobSignature(signAppJob(input(), key));
  const expected = {
    jobId: input().jobId,
    route: 'fx',
    kind: 'app-install',
    payload: { spec: { ...spec, systemPackages: [...spec.systemPackages] } },
    expiresAt: input().expiresAt,
  };
  assert.equal(appJobEnvelopeMatches(decoded.envelope, expected), true);
  for (const [field, value] of Object.entries({
    jobId: '7b0c6a1e-4a8f-4c55-9a43-2f1f3c2d9e11',
    route: 'gx',
    kind: 'app-remove',
    payload: { spec: { ...spec, version: '1.2.1' } },
    expiresAt: at(NOW + 1),
  })) {
    assert.equal(
      appJobEnvelopeMatches(decoded.envelope, { ...expected, [field]: value }),
      false,
      field,
    );
  }
});

// ---------------------------------------------------------------------------
// The relay
// ---------------------------------------------------------------------------

test('relay: no app job is created while the signing key is unusable; then each is signed', async () => {
  // A key file others may read is refused: nothing is signed with it.
  const keyFile = path.join(stateDir, RELAY_SIGNING_KEY_FILE);
  await createRelaySigner(keyFile, { create: true }).current();
  await chmod(keyFile, 0o644);
  await assert.rejects(
    lib.createAppJob({ agentLabel: 'vm1', plugin: 'fx', kind: 'app-install', spec }),
    (err) => err instanceof lib.AppJobSigningError && /signing key is unusable/.test(err.message),
  );
  assert.deepEqual(await lib.pendingAgentJobs('vm1'), []);
  // Eligibility knows: an agent half cannot be hosted anywhere meanwhile.
  assert.deepEqual(await lib.relayEligibility(), { relayKid: null });

  await chmod(keyFile, 0o600);
  const relayKey = await lib.relaySigner.current();
  const id = await lib.createAppJob({
    agentLabel: 'vm1',
    plugin: 'fx',
    kind: 'app-remove',
    purge: true,
    package: spec.package,
  });
  const [job] = await lib.pendingAgentJobs('vm1');
  assert.equal(job.id, id);
  const result = verifyAppJobSignature(job.signature, {
    key: parseRelayVerifyKey(relayVerifyKeyOf(relayKey)),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.envelope.payload, { purge: true, package: spec.package });
  assert.equal(result.envelope.agent, 'vm1');
  assert.equal(result.envelope.expiresAt, job.deadlineAt);
  assert.equal(
    Date.parse(job.deadlineAt) - Date.parse(result.envelope.issuedAt),
    300_000 + lib.AGENT_JOB_DELIVERY_SLACK_MS,
  );
  assert.deepEqual(await lib.relayEligibility(), { relayKid: relayKey.kid });
});

test('0011: app jobs pending from before signing are cancelled, hook jobs kept', async () => {
  const migrationDir = await mkdtemp(path.join(tmpdir(), 'lamaste-migration-0011-'));
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const { ensureMigrations } = await import('../src/lib/state-db.js');
    const earlier = path.join(migrationDir, 'before');
    await mkdir(earlier);
    for (const file of await readdir(MIGRATIONS)) {
      if (file < '0011') await copyFile(path.join(MIGRATIONS, file), path.join(earlier, file));
    }
    const db = new DatabaseSync(path.join(migrationDir, 'state.db'));
    await ensureMigrations(db, earlier);
    const insert = db.prepare(
      `INSERT INTO agent_jobs (id, agent_label, plugin, kind, stage, input, payload, timeout_ms, status, created_at, deadline_at)
       VALUES (?, 'vm1', 'fx', ?, ?, ?, ?, 1000, ?, '2026-10-16T10:00:00.000Z', '2026-10-16T11:00:00.000Z')`,
    );
    insert.run('a', 'app-remove', null, null, '{"purge":true}', 'pending');
    insert.run('b', 'hook', 'install:pre-tunnel', '{}', null, 'pending');
    insert.run('c', 'app-install', null, null, '{}', 'done');

    await ensureMigrations(db, MIGRATIONS);
    const rows = Object.fromEntries(
      db
        .prepare('SELECT id, status, signature, completed_at FROM agent_jobs')
        .all()
        .map((r) => [r.id, r]),
    );
    assert.equal(rows.a.status, 'cancelled');
    assert.ok(Date.parse(rows.a.completed_at) > 0);
    assert.equal(rows.b.status, 'pending');
    assert.equal(rows.c.status, 'done');
    assert.equal(rows.a.signature, null);
    db.close();
  } finally {
    await rm(migrationDir, { recursive: true, force: true });
  }
});
