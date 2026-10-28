/**
 * Delegated invitations, relay assertions for the inviter's API: on the
 * sign-in host of a plugin's domain Gatekeeper vouches for the session's
 * user with the panel's audience and a target of its own kind —
 * `{ invitations: <route>, domain, path }`, the path being exactly that
 * route's `/api/delegated-invitations/<route>[/<id>]`. The kind never
 * stands in for a user surface's (`{ route, path }`) nor the other way
 * round, and an agent never accepts one.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  NonceStore,
  RELAY_PANEL_AUDIENCE,
  createRelaySigner,
  delegatedInvitationsApiPath,
  isDelegatedInvitationsUrl,
  isRelayInvitationsTarget,
  isRelayUserSurfaceTarget,
  parseRelayVerifyKey,
  relayVerifyKeyOf,
  signRelayAssertion,
  verifyRelayAssertion,
} from '@lamalibre/lamaste';

const PANEL_PORT = 3100;
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const BASE = '/api/delegated-invitations/corral';
let dir;
let key;
let keys;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-di-relay-'));
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

function forged(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const signature = crypto.sign(null, Buffer.from(encoded, 'utf-8'), key.privateKey);
  return `${encoded}.${signature.toString('base64url')}`;
}

function payload(target, aud = RELAY_PANEL_AUDIENCE) {
  return {
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
}

test('isDelegatedInvitationsUrl: exactly the route, or one invitation id under it', () => {
  assert.equal(delegatedInvitationsApiPath('corral'), BASE);
  assert.throws(() => delegatedInvitationsApiPath('Corral'), /Invalid plugin route/);
  assert.throws(() => delegatedInvitationsApiPath('users'), /Invalid plugin route/);
  for (const url of [BASE, `${BASE}?x=1`, `${BASE}/${ID}`, `${BASE}/${ID}?a=b`]) {
    assert.equal(isDelegatedInvitationsUrl(url, 'corral'), true, url);
  }
  for (const url of [
    `${BASE}/`,
    `${BASE}x`,
    `${BASE}/${ID}/`,
    `${BASE}/${ID}/more`,
    `${BASE}/${ID.toUpperCase()}`,
    `${BASE}/not-an-id`,
    `${BASE}/..`,
    `${BASE}/%2e%2e`,
    `/api/delegated-invitations/other`,
    `//api/delegated-invitations/corral`,
    `/api/corral/app`,
    `/API/delegated-invitations/corral`,
  ]) {
    assert.equal(isDelegatedInvitationsUrl(url, 'corral'), false, url);
  }
  assert.equal(isDelegatedInvitationsUrl(BASE, 'users'), false, 'a reserved prefix is no route');
});

test('an inviter target is signed and verified for its own path; the result tells the kind', () => {
  const target = { invitations: 'corral', domain: 'codelama.com.tr', path: `${BASE}/${ID}` };
  const result = verifyAt(sign(target), `${BASE}/${ID}`);
  assert.equal(result.ok, true);
  assert.deepEqual(result.payload.target, target);
  assert.equal(isRelayInvitationsTarget(result.payload.target), true);
  assert.equal(isRelayUserSurfaceTarget(result.payload.target), false);

  // Bound to the path byte for byte.
  assert.equal(verifyAt(sign(target), BASE).reason, 'wrong_request');
  assert.equal(verifyAt(sign(target), `${BASE}/${ID}?x`).reason, 'wrong_request');
  // And to the method.
  assert.equal(
    verifyAt(sign(target), `${BASE}/${ID}`, { method: 'DELETE' }).reason,
    'wrong_request',
  );
});

test('the signer refuses an inviter target off its API, without a domain, or naming a route too', () => {
  for (const target of [
    { invitations: 'corral', domain: 'codelama.com.tr', path: '/api/corral/app' },
    { invitations: 'corral', domain: 'codelama.com.tr', path: `${BASE}/` },
    { invitations: 'corral', domain: 'codelama.com.tr', path: '/api/delegated-invitations/x' },
    { invitations: 'Corral', domain: 'codelama.com.tr', path: BASE },
    { invitations: 'corral', domain: 'Not A Domain', path: BASE },
    { invitations: 'corral', path: BASE },
    { invitations: 'corral', domain: 'codelama.com.tr', route: 'corral', path: BASE },
  ]) {
    assert.throws(() => sign(target), Error, JSON.stringify(target));
  }
  // Never for an agent.
  assert.throws(
    () =>
      sign(
        { invitations: 'corral', domain: 'codelama.com.tr', path: BASE },
        { aud: 'agent-1', port: 9393, caller: { type: 'admin' } },
      ),
    /only for the panel audience/,
  );
});

test('the kinds never stand in for one another', () => {
  // A user-surface assertion does not admit the inviter API, even for its route.
  const surface = sign({ route: 'corral', path: '/api/corral/app/x' }, { method: 'POST' });
  assert.equal(verifyAt(surface, BASE).reason, 'wrong_request');
  // A forged user-surface target pointing at the inviter API is refused.
  assert.equal(
    verifyAt(forged(payload({ route: 'corral', path: BASE })), BASE).reason,
    'wrong_request',
  );
  // A forged inviter target pointing at a user surface is refused.
  assert.equal(
    verifyAt(
      forged(
        payload({ invitations: 'corral', domain: 'codelama.com.tr', path: '/api/corral/app' }),
      ),
      '/api/corral/app',
    ).reason,
    'wrong_request',
  );
  // Both route and invitations: malformed.
  assert.equal(
    verifyAt(
      forged(
        payload({ invitations: 'corral', route: 'corral', domain: 'codelama.com.tr', path: BASE }),
      ),
      BASE,
    ).reason,
    'malformed',
  );
  // A bad domain: malformed.
  assert.equal(
    verifyAt(forged(payload({ invitations: 'corral', domain: '-x', path: BASE })), BASE).reason,
    'malformed',
  );
  // A user surface's result is recognised as such.
  const ok = verifyAt(surface, '/api/corral/app/x');
  assert.equal(ok.ok, true);
  assert.equal(isRelayUserSurfaceTarget(ok.payload.target), true);
  assert.equal(isRelayInvitationsTarget(ok.payload.target), false);
});

test('an agent refuses an inviter target, whatever its audience', () => {
  const header = forged(
    payload({ invitations: 'corral', domain: 'codelama.com.tr', path: BASE }, 'agent-1'),
  );
  const result = verifyRelayAssertion(header, {
    keys,
    aud: 'agent-1',
    port: PANEL_PORT,
    method: 'POST',
    url: BASE,
    nonces: new NonceStore(),
  });
  assert.equal(result.reason, 'malformed');
});
