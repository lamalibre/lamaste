/**
 * Slice 6, relay assertions for the panel: Gatekeeper vouches for a user on
 * a plugin's user surface with the audience `@panel` — which no agent
 * label can be — the username alone, and a target binding both the route
 * and the raw request path, which must lie on that route's user surface
 * with no dot segment, encoded separator or backslash. The assertions
 * lamaste-agentd verifies (an agent label, a route-only target for a
 * session user, a path for a certificate holder) are exactly as before.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  AGENT_LABEL_REGEX,
  NonceStore,
  RELAY_PANEL_AUDIENCE,
  createRelaySigner,
  isUserSurfaceUrl,
  parseRelayVerifyKey,
  relayVerifyKeyOf,
  signRelayAssertion,
  verifyRelayAssertion,
} from '@lamalibre/lamaste';

const PANEL_PORT = 3100;
let dir;
let key;
let keys;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-s6-relay-panel-'));
  key = await createRelaySigner(path.join(dir, 'relay-signing-key.json'), {
    create: true,
  }).current();
  keys = new Map([[key.kid, parseRelayVerifyKey(relayVerifyKeyOf(key)).publicKey]]);
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

function panelAssertion(url, overrides = {}) {
  return signRelayAssertion(
    {
      aud: RELAY_PANEL_AUDIENCE,
      port: PANEL_PORT,
      caller: { type: 'user', username: 'ayse' },
      method: 'GET',
      target: { route: 'fx', path: url },
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
    method: 'GET',
    url,
    nonces: new NonceStore(),
    ...overrides,
  });
}

/** An assertion over exactly `payload`, signed with the relay key — what a signer that checks nothing would send. */
function forged(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const signature = crypto.sign(null, Buffer.from(encoded, 'utf-8'), key.privateKey);
  return `${encoded}.${signature.toString('base64url')}`;
}

function payload(target, caller = { type: 'user', username: 'ayse' }, aud = RELAY_PANEL_AUDIENCE) {
  return {
    v: 1,
    kid: key.kid,
    aud,
    port: PANEL_PORT,
    caller,
    method: 'GET',
    target,
    iat: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex'),
  };
}

test('the panel audience is no agent label', () => {
  assert.equal(RELAY_PANEL_AUDIENCE, '@panel');
  assert.equal(AGENT_LABEL_REGEX.test(RELAY_PANEL_AUDIENCE), false);
});

test('a user on the user surface: the username alone, bound to the route and the exact path', () => {
  for (const url of [
    '/api/fx/app',
    '/api/fx/app/',
    '/api/fx/app/me',
    '/api/fx/app/x?y=1&z=%2F',
    '/api/fx/app?x=1',
  ]) {
    const result = verifyAt(panelAssertion(url), url);
    assert.equal(result.ok, true, `${url}: ${result.reason}`);
    assert.deepEqual(result.payload.caller, { type: 'user', username: 'ayse' });
    assert.deepEqual(result.payload.target, { route: 'fx', path: url });
  }
  // Only the username is signed, whatever the signer was handed.
  const header = panelAssertion('/api/fx/app/me', {
    caller: {
      type: 'user',
      username: 'ayse',
      groups: ['admins'],
      name: 'Ayşe',
      email: 'a@x.example',
    },
  });
  const signedText = Buffer.from(header.split('.')[0], 'base64url').toString('utf-8');
  assert.ok(!signedText.includes('admins') && !signedText.includes('x.example'));
  assert.deepEqual(verifyAt(header, '/api/fx/app/me').payload.caller, {
    type: 'user',
    username: 'ayse',
  });
});

test('the path must be the request target, on the route’s user surface', () => {
  const header = panelAssertion('/api/fx/app/me');
  assert.equal(verifyAt(header, '/api/fx/app/me?x=1').reason, 'wrong_request', 'another query');
  assert.equal(verifyAt(header, '/api/fx/app/other').reason, 'wrong_request', 'another path');
  assert.equal(
    verifyAt(header, '/api/fx/app/me', { method: 'POST' }).reason,
    'wrong_request',
    'another method',
  );
  assert.equal(verifyAt(header, '/api/fx/app/me', { port: 3101 }).reason, 'wrong_port');
  assert.equal(verifyAt(header, '/api/fx/app/me', { aud: 'vm1' }).reason, 'wrong_audience');

  // What no signer may sign, and no verifier accept even when signed.
  for (const [why, url, route = 'fx'] of [
    ['the admin surface', '/api/fx/panel.js'],
    ['another route', '/api/other/app/me'],
    ['a route prefix', '/api/fx/apps'],
    ['dot segments', '/api/fx/app/../settings'],
    ['a dot segment', '/api/fx/app/./me'],
    ['encoded dots', '/api/fx/app/%2e%2e/x'],
    ['an encoded dot', '/api/fx/app/report%2Epdf'],
    ['an encoded slash', '/api/fx/app/a%2Fb'],
    ['an encoded backslash', '/api/fx/app/a%5cb'],
    ['a backslash', '/api/fx/app/a\\b'],
    ['an undecodable escape', '/api/fx/app/%E0%A4%A'],
    ['the route in the target is not the path’s', '/api/fx/app/me', 'other'],
  ]) {
    assert.throws(
      () => panelAssertion(url, { target: { route, path: url } }),
      /not on the route's user surface/,
      why,
    );
    assert.equal(isUserSurfaceUrl(url, route), false, why);
    const result = verifyAt(forged(payload({ route, path: url })), url);
    assert.equal(result.reason, 'wrong_request', why);
  }
});

test('the panel audience takes nothing but a user with a route and a path', () => {
  assert.throws(
    () => panelAssertion('/api/fx/app', { caller: { type: 'admin' } }),
    /vouches for a user only/,
  );
  assert.throws(
    () => panelAssertion('/api/fx/app', { target: { route: 'fx' } }),
    /bound to a route and a path/,
  );
  assert.throws(
    () => panelAssertion('/api/fx/app', { target: { path: '/api/fx/app' } }),
    /bound to a route and a path/,
  );
  assert.throws(
    () => panelAssertion('/api/fx/app', { caller: { type: 'user', username: 'a b' } }),
    /Invalid username/,
  );
  for (const bad of [
    payload({ route: 'fx', path: '/api/fx/app' }, { type: 'admin' }),
    payload({ route: 'fx', path: '/api/fx/app' }, { type: 'agent', label: 'vm1' }),
    payload({ route: 'fx' }),
    payload({ path: '/api/fx/app' }),
    payload({ route: 'fx', path: 'api/fx/app' }),
    payload({ route: 'fx', path: '/api/fx/app x' }),
    payload({ route: 'FX', path: '/api/FX/app' }),
  ]) {
    assert.equal(verifyAt(forged(bad), bad.target.path ?? '/api/fx/app').reason, 'malformed');
  }
});

test('agentd’s assertions are unchanged; neither kind passes for the other', () => {
  const agentOpts = (url) => ({
    keys,
    aud: 'vm1',
    port: 9393,
    method: 'GET',
    url,
    nonces: new NonceStore(),
  });
  const session = {
    type: 'user',
    username: 'ayse',
    groups: ['staff'],
    name: 'Ayşe',
    email: 'a@x.example',
  };
  const plugin = signRelayAssertion(
    { aud: 'vm1', port: 9393, caller: session, method: 'GET', target: { route: 'shell' } },
    key,
  );
  const verified = verifyRelayAssertion(plugin, agentOpts('/shell/ws?x=1'));
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.payload.caller, session);
  assert.deepEqual(verified.payload.target, { route: 'shell' });
  const cert = signRelayAssertion(
    {
      aud: 'vm1',
      port: 9393,
      caller: { type: 'admin' },
      method: 'GET',
      target: { path: '/api/status' },
    },
    key,
  );
  assert.equal(verifyRelayAssertion(cert, agentOpts('/api/status')).ok, true);

  // A user-surface target is the panel's alone; a session user needs the session's fields.
  assert.throws(
    () =>
      signRelayAssertion(
        {
          aud: 'vm1',
          port: 9393,
          caller: session,
          method: 'GET',
          target: { route: 'fx', path: '/api/fx/app' },
        },
        key,
      ),
    /only for the panel audience/,
  );
  assert.throws(
    () =>
      signRelayAssertion(
        {
          aud: 'vm1',
          port: 9393,
          caller: { type: 'user', username: 'ayse' },
          method: 'GET',
          target: { route: 'shell' },
        },
        key,
      ),
    /groups, name and email/,
  );
  const forgedForAgent = forged(payload({ route: 'fx', path: '/api/fx/app' }, session, 'vm1'));
  assert.equal(verifyRelayAssertion(forgedForAgent, agentOpts('/api/fx/app')).reason, 'malformed');

  // A panel assertion presented to an agent daemon: another audience.
  const panel = panelAssertion('/api/fx/app/me');
  assert.equal(
    verifyRelayAssertion(panel, { ...agentOpts('/api/fx/app/me'), port: PANEL_PORT }).reason,
    'wrong_audience',
  );
  // An agent's assertion presented to the panel: another audience.
  assert.equal(verifyAt(plugin, '/shell/ws').reason, 'wrong_audience');
});

test('a panel assertion is single use', () => {
  const nonces = new NonceStore();
  const header = panelAssertion('/api/fx/app/me');
  assert.equal(verifyAt(header, '/api/fx/app/me', { nonces }).ok, true);
  assert.equal(verifyAt(header, '/api/fx/app/me', { nonces }).reason, 'replayed');
});
