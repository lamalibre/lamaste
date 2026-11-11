/**
 * Relay assertions for a password change (mail-design.md §6.3): on a
 * domain's sign-in host Gatekeeper vouches for the session's user with the
 * panel's audience and a target of its own kind — `{ account: 'password',
 * domain, path: '/api/account/password' }`. The kind admits that one path,
 * never stands in for an inviter's or a user surface's, and no agent ever
 * accepts one.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  ACCOUNT_PASSWORD_API_PATH,
  NonceStore,
  RELAY_PANEL_AUDIENCE,
  createRelaySigner,
  isRelayAccountTarget,
  isRelayInvitationsTarget,
  isRelayUserSurfaceTarget,
  parseRelayVerifyKey,
  relayVerifyKeyOf,
  signRelayAssertion,
  verifyRelayAssertion,
} from '@lamalibre/lamaste';

const PANEL_PORT = 3100;
const TARGET = { account: 'password', domain: 'codelama.com.tr', path: ACCOUNT_PASSWORD_API_PATH };
let dir;
let key;
let keys;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-account-relay-'));
  key = await createRelaySigner(path.join(dir, 'relay-signing-key.json'), {
    create: true,
  }).current();
  keys = new Map([[key.kid, parseRelayVerifyKey(relayVerifyKeyOf(key)).publicKey]]);
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

function sign(target, overrides = {}) {
  return signRelayAssertion(
    {
      aud: RELAY_PANEL_AUDIENCE,
      port: PANEL_PORT,
      caller: { type: 'user', username: 'ayse' },
      method: 'POST',
      target,
      ...overrides,
    },
    key,
  );
}

function verifyAt(header, url, overrides = {}) {
  return verifyRelayAssertion(header, {
    keys,
    aud: RELAY_PANEL_AUDIENCE,
    port: PANEL_PORT,
    method: 'POST',
    url,
    nonces: new NonceStore(),
    ...overrides,
  });
}

function forged(target, aud = RELAY_PANEL_AUDIENCE) {
  const payload = {
    v: 1,
    kid: key.kid,
    aud,
    port: PANEL_PORT,
    caller: { type: 'user', username: 'ayse' },
    method: 'POST',
    target,
    iat: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const signature = crypto.sign(null, Buffer.from(encoded, 'utf-8'), key.privateKey);
  return `${encoded}.${signature.toString('base64url')}`;
}

test('a password change target is signed and verified for that one path; the result tells the kind', () => {
  const result = verifyAt(sign(TARGET), ACCOUNT_PASSWORD_API_PATH);
  assert.equal(result.ok, true);
  assert.deepEqual(result.payload.caller, { type: 'user', username: 'ayse' });
  assert.deepEqual(result.payload.target, TARGET);
  assert.equal(isRelayAccountTarget(result.payload.target), true);
  assert.equal(isRelayInvitationsTarget(result.payload.target), false);
  assert.equal(isRelayUserSurfaceTarget(result.payload.target), false);
  assert.equal(verifyAt(sign(TARGET), `${ACCOUNT_PASSWORD_API_PATH}?x=1`).reason, 'wrong_request');
  assert.equal(
    verifyAt(sign(TARGET), ACCOUNT_PASSWORD_API_PATH, { method: 'GET' }).reason,
    'wrong_request',
  );
});

test('the signer refuses another path, no domain, or a route beside it — and never for an agent', () => {
  for (const target of [
    { ...TARGET, path: '/api/account/reset/finish' },
    { ...TARGET, path: `${ACCOUNT_PASSWORD_API_PATH}/` },
    { ...TARGET, account: 'other' },
    { account: 'password', path: ACCOUNT_PASSWORD_API_PATH },
    { ...TARGET, route: 'corral' },
    { ...TARGET, invitations: 'corral' },
  ]) {
    assert.throws(() => sign(target), Error, JSON.stringify(target));
  }
  assert.throws(
    () => sign(TARGET, { aud: 'agent-1', port: 9393, caller: { type: 'admin' } }),
    /only for the panel audience/,
  );
});

test('the kinds never stand in for one another; an agent refuses one', () => {
  // An inviter's or a user surface's assertion does not admit the password change.
  const inviter = sign({
    invitations: 'corral',
    domain: 'codelama.com.tr',
    path: '/api/delegated-invitations/corral',
  });
  assert.equal(verifyAt(inviter, ACCOUNT_PASSWORD_API_PATH).reason, 'wrong_request');
  const surface = sign({ route: 'corral', path: '/api/corral/app/x' });
  assert.equal(verifyAt(surface, ACCOUNT_PASSWORD_API_PATH).reason, 'wrong_request');
  // A forged account target pointing elsewhere is malformed.
  assert.equal(
    verifyAt(forged({ ...TARGET, path: '/api/corral/app' }), '/api/corral/app').reason,
    'malformed',
  );
  // An agent (its label as the audience) never parses one.
  assert.equal(
    verifyRelayAssertion(forged(TARGET, 'agent-1'), {
      keys,
      aud: 'agent-1',
      port: PANEL_PORT,
      method: 'POST',
      url: ACCOUNT_PASSWORD_API_PATH,
      nonces: new NonceStore(),
    }).reason,
    'malformed',
  );
});
