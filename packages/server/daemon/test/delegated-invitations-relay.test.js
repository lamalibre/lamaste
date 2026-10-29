/**
 * The panel's check of an inviter's relay assertion (delegated invitations,
 * `lib/user-surface.js` `verifyInvitationsRelay`), with the relay signing
 * key Gatekeeper signs with: bound to the method and raw target, used once,
 * and of its own kind — an inviter's assertion never passes the user
 * surface's check, nor a user surface's the inviter's.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  RELAY_ASSERTION_HEADER,
  RELAY_PANEL_AUDIENCE,
  RELAY_PANEL_PORT,
  signRelayAssertion,
} from '@lamalibre/lamaste';

let dir;
let lib;
let key;
const quiet = { info() {}, warn() {}, error() {} };

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-inviter-relay-'));
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = dir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = dir;
  lib = {
    ...(await import('../src/lib/relay-signing.js')),
    ...(await import('../src/lib/user-surface.js')),
  };
  key = await lib.relaySigner.current();
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

function request(method, url, assertion) {
  return {
    method,
    headers: assertion ? { [RELAY_ASSERTION_HEADER]: assertion } : {},
    raw: { url },
    log: quiet,
  };
}

const sign = (method, target, username = 'coord') =>
  signRelayAssertion(
    {
      aud: RELAY_PANEL_AUDIENCE,
      port: RELAY_PANEL_PORT,
      caller: { type: 'user', username },
      method,
      target,
    },
    key,
  );

test('an inviter’s assertion verifies once, for its method and target, with its route and domain', async () => {
  const url = '/api/delegated-invitations/corral';
  const assertion = sign('POST', { invitations: 'corral', domain: 'codelama.test', path: url });
  assert.deepEqual(await lib.verifyInvitationsRelay(request('POST', url, assertion)), {
    ok: true,
    username: 'coord',
    route: 'corral',
    domain: 'codelama.test',
  });
  // Once.
  assert.equal((await lib.verifyInvitationsRelay(request('POST', url, assertion))).ok, false);
  // Another method, another target.
  const other = sign('POST', { invitations: 'corral', domain: 'codelama.test', path: url });
  assert.equal((await lib.verifyInvitationsRelay(request('DELETE', url, other))).ok, false);
  const moved = sign('GET', { invitations: 'corral', domain: 'codelama.test', path: url });
  assert.equal((await lib.verifyInvitationsRelay(request('GET', `${url}?x=1`, moved))).ok, false);
  assert.equal((await lib.verifyInvitationsRelay(request('GET', url))).ok, false);
});

test('the two kinds never stand in for each other', async () => {
  const surfaceUrl = '/api/corral/app/people';
  const surface = sign('GET', { route: 'corral', path: surfaceUrl });
  assert.equal((await lib.verifyInvitationsRelay(request('GET', surfaceUrl, surface))).ok, false);

  const inviterUrl = '/api/delegated-invitations/corral';
  const inviter = sign('GET', { invitations: 'corral', domain: 'codelama.test', path: inviterUrl });
  assert.equal((await lib.verifyUserSurfaceRelay(request('GET', inviterUrl, inviter))).ok, false);

  // And core refuses to sign an inviter's target on a user-surface path, or the other way round.
  assert.throws(() =>
    sign('GET', { invitations: 'corral', domain: 'codelama.test', path: surfaceUrl }),
  );
  assert.throws(() => sign('GET', { route: 'corral', path: inviterUrl }));
});
