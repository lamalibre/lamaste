/**
 * The daemon's relay-assertion verifier: it learns the relay's keys from the
 * panel on first use and again when the relay rotated, never more often
 * than its window allows (the key id it reacts to is a caller's input), and
 * the assertions themselves fail closed on every field.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createRelaySigner,
  NonceStore,
  parseRelayVerifyKey,
  relayVerifyKeyOf,
  signRelayAssertion,
  verifyRelayAssertion,
} from '@lamalibre/lamaste';
import {
  createRelayVerifier,
  REFETCH_AFTER_FAILURE_MS,
  REFETCH_AFTER_SUCCESS_MS,
} from '../src/lib/relay-verifier.js';

const quiet = { info() {}, warn() {} };
let dir;
let keyA;
let keyB;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-relay-verifier-'));
  keyA = await createRelaySigner(path.join(dir, 'a.json'), { create: true }).current();
  keyB = await createRelaySigner(path.join(dir, 'b.json'), { create: true }).current();
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sign = (key, overrides = {}) =>
  signRelayAssertion(
    {
      aud: 'vm1',
      port: 9393,
      caller: { type: 'admin' },
      method: 'GET',
      target: { path: '/api/status' },
      ...overrides,
    },
    key,
  );

test('keys are fetched on first use, and again only once the window has passed', async () => {
  let clock = 1_000_000;
  let published = [relayVerifyKeyOf(keyA)];
  let fetches = 0;
  const verifier = createRelayVerifier({
    port: 9393,
    logger: quiet,
    now: () => clock,
    fetchKeys: async () => {
      fetches += 1;
      return { keys: published, agentLabel: 'vm1' };
    },
  });

  assert.equal((await verifier.verify(sign(keyA, { iat: clock }), 'GET', '/api/status')).ok, true);
  assert.equal(fetches, 1);

  // The relay rotates to B; within the window B is not learned.
  published = [relayVerifyKeyOf(keyB)];
  clock += 1_000;
  let result = await verifier.verify(sign(keyB, { iat: clock }), 'GET', '/api/status');
  assert.deepEqual([result.ok, result.reason], [false, 'unknown_key']);
  assert.equal(fetches, 1);

  clock += REFETCH_AFTER_SUCCESS_MS;
  result = await verifier.verify(sign(keyB, { iat: clock }), 'GET', '/api/status');
  assert.equal(result.ok, true);
  assert.equal(fetches, 2);

  // A is no longer published, so no longer accepted.
  result = await verifier.verify(sign(keyA, { iat: clock }), 'GET', '/api/status');
  assert.deepEqual([result.ok, result.reason], [false, 'unknown_key']);
});

test('a failed fetch keeps the keys it had and is retried after the shorter window', async () => {
  let clock = 5_000_000;
  let fail = false;
  let fetches = 0;
  const verifier = createRelayVerifier({
    port: 9393,
    logger: quiet,
    now: () => clock,
    fetchKeys: async () => {
      fetches += 1;
      if (fail) throw new Error('panel unreachable');
      return { keys: [relayVerifyKeyOf(keyA)], agentLabel: 'vm1' };
    },
  });
  fail = true;
  assert.equal((await verifier.verify(sign(keyA, { iat: clock }), 'GET', '/api/status')).ok, false);
  assert.equal(fetches, 1);
  clock += REFETCH_AFTER_FAILURE_MS - 1;
  await verifier.verify(sign(keyA, { iat: clock }), 'GET', '/api/status');
  assert.equal(fetches, 1);
  fail = false;
  clock += 1;
  assert.equal((await verifier.verify(sign(keyA, { iat: clock }), 'GET', '/api/status')).ok, true);
  assert.equal(fetches, 2);
});

test("malformed key lists are refused; a key id must be the key's own, the agent named", async () => {
  const verifier = createRelayVerifier({
    port: 9393,
    logger: quiet,
    // B's id on A's key: the response lies about which key it is.
    fetchKeys: async () => ({
      keys: [{ kid: relayVerifyKeyOf(keyB).kid, publicKey: relayVerifyKeyOf(keyA).publicKey }],
      agentLabel: 'vm1',
    }),
  });
  assert.equal((await verifier.verify(sign(keyA), 'GET', '/api/status')).ok, false);

  // A panel that does not say which agent this is gives no audience to check.
  const unnamed = createRelayVerifier({
    port: 9393,
    logger: quiet,
    fetchKeys: async () => ({ keys: [relayVerifyKeyOf(keyA)] }),
  });
  assert.equal((await unnamed.verify(sign(keyA), 'GET', '/api/status')).ok, false);
  assert.throws(() => parseRelayVerifyKey({ kid: 'x', publicKey: 'AAAA' }));
  assert.throws(() => parseRelayVerifyKey(null));
});

test('verifyRelayAssertion fails closed on tampering and on every bound field', () => {
  const keys = new Map([[keyA.kid, parseRelayVerifyKey(relayVerifyKeyOf(keyA)).publicKey]]);
  const base = { keys, aud: 'vm1', port: 9393, method: 'GET', url: '/api/status' };
  const reason = (header, extra = {}) => {
    const r = verifyRelayAssertion(header, { ...base, nonces: new NonceStore(), ...extra });
    return r.ok ? 'ok' : r.reason;
  };

  const good = sign(keyA);
  assert.equal(reason(good), 'ok');

  const [payload, signature] = good.split('.');
  const tampered = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
  tampered.caller = { type: 'agent', label: 'vm1' };
  const forged = `${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${signature}`;
  assert.equal(reason(forged), 'bad_signature');

  assert.equal(reason(undefined), 'malformed');
  assert.equal(reason(''), 'malformed');
  assert.equal(reason(`${good}.extra`), 'malformed');
  assert.equal(reason(`${payload}.short`), 'malformed');
  assert.equal(reason(sign(keyB)), 'unknown_key');
  assert.equal(reason(good, { aud: 'vm2' }), 'wrong_audience');
  assert.equal(reason(good, { port: 9394 }), 'wrong_port');
  assert.equal(reason(good, { method: 'POST' }), 'wrong_request');
  assert.equal(reason(good, { url: '/api/status?x' }), 'wrong_request');
  assert.equal(reason(sign(keyA, { iat: Date.now() + 60_000 })), 'future');
  assert.equal(reason(sign(keyA, { iat: Date.now() - 66_000 })), 'expired');

  const nonces = new NonceStore();
  assert.equal(reason(good, { nonces }), 'ok');
  assert.equal(reason(good, { nonces }), 'replayed');

  // A user is bound to a plugin route, a certificate caller to a path.
  const user = { type: 'user', username: 'alice', groups: [], name: '', email: '' };
  assert.equal(
    reason(sign(keyA, { caller: user, target: { route: 'herd' } }), { url: '/herd/x' }),
    'ok',
  );
  assert.equal(
    reason(sign(keyA, { caller: user, target: { route: 'herd' } }), { url: '/herdsman/x' }),
    'wrong_request',
  );
  assert.throws(() => sign(keyA, { caller: user, target: { path: '/herd/x' } }));
  assert.throws(() => sign(keyA, { target: { route: 'herd' } }));
  assert.throws(() => sign(keyA, { caller: { ...user, username: 'a b' }, target: { route: 'h' } }));
  assert.throws(() => sign(keyA, { target: { path: '/api/x y' } }));
});

test('the signer refuses a key file other users can read, and follows a replaced file', async () => {
  const file = path.join(dir, 'rotating.json');
  const signer = createRelaySigner(file, { create: true, recheckMs: 0 });
  const first = await signer.current();
  assert.ok(first);

  // Replace the file with another key (as an operator rotating would).
  await rename(path.join(dir, 'b.json'), file);
  const second = await signer.current();
  assert.equal(second.kid, keyB.kid);

  const { chmod } = await import('node:fs/promises');
  await chmod(file, 0o644);
  await assert.rejects(signer.current(), /readable by other users/);

  const reader = createRelaySigner(path.join(dir, 'missing.json'), { create: false });
  assert.equal(await reader.current(), null);
});
