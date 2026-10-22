/**
 * Users and identity in requests, in the panel's words: who may not be
 * disabled, why users cannot reach a plugin's application yet, whether a
 * tunnel's host can serve a user surface (the panel's rule), how an
 * audience row reads, what an entitlement change sends, and how an update
 * changes a plugin's identity block — which of its changes wait for an
 * administrator.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  audienceRowView,
  boundRoutes,
  identityDiffRows,
  isLastEnabledAdmin,
  readinessText,
  shortId,
  toggledRoles,
  userSurfaceEligibility,
  userSurfaceReasonText,
  warningText,
} from '../src/admin/lib/identity.js';

const USER_ID = '0f6c2a2e-6c1d-4c58-9d0e-3f1b2a4c5d6e';

test('the last enabled administrator cannot be disabled', () => {
  const alice = { username: 'alice', groups: ['admins'] };
  const bob = { username: 'bob', groups: ['admins'], disabled: true };
  const carol = { username: 'carol', groups: ['users'] };
  assert.equal(isLastEnabledAdmin(alice, [alice, bob, carol]), true);
  // A second enabled administrator lifts it.
  const dave = { username: 'dave', groups: ['admins', 'users'] };
  assert.equal(isLastEnabledAdmin(alice, [alice, bob, carol, dave]), false);
  // Someone who is not an enabled administrator is never it.
  assert.equal(isLastEnabledAdmin(carol, [alice, carol]), false);
  assert.equal(isLastEnabledAdmin(bob, [bob, carol]), false);
});

test('a user id is shortened for the eye, kept whole elsewhere', () => {
  assert.equal(shortId(USER_ID), '0f6c2a2e…');
  assert.equal(shortId('short'), 'short');
  assert.equal(shortId(null), '');
});

test('warnings read as one line each', () => {
  assert.equal(
    warningText('registry tokens were not revoked: x'),
    'registry tokens were not revoked: x',
  );
  assert.equal(
    warningText({ step: 'session-epoch', message: 'Live desktop sessions were not ended' }),
    'session-epoch: Live desktop sessions were not ended',
  );
  assert.equal(warningText({ message: 'no step' }), 'no step');
});

test('readiness: ready, or why users cannot reach the application yet', () => {
  const base = { ready: false, version: '1.1.0', readyVersion: null };
  assert.deepEqual(readinessText({ ...base, ready: true, reason: null }), {
    ready: true,
    text: 'Users reach its application',
  });
  assert.match(readinessText({ ...base, reason: 'not_approved' }).text, /^Version 1\.1\.0 waits/);
  assert.match(readinessText({ ...base, reason: 'no_identity' }).text, /declares no identity/);
  assert.match(readinessText({ ...base, reason: 'not_hosted' }).text, /not hosted/);
  assert.match(
    readinessText({ ...base, reason: 'not_answered' }).text,
    /has not answered the identity feed for version 1\.1\.0/,
  );
  assert.equal(readinessText({ ...base, reason: 'not_installed' }).ready, false);
  assert.deepEqual(readinessText(null), { ready: false, text: 'Unknown' });
});

test('a user surface is served, or why its requests still go down the tunnel', () => {
  assert.match(userSurfaceReasonText(null), /^served/);
  assert.match(userSurfaceReasonText('no_identity'), /go down the tunnel/);
  assert.match(userSurfaceReasonText('not_approved'), /waits for approval/);
  assert.match(userSurfaceReasonText('not_installed'), /no installed plugin/);
});

test('which tunnels can serve a user surface: the panel’s rule', () => {
  const app = {
    subdomain: 'piyasa',
    type: 'app',
    enabled: true,
    agentLabel: 'vm1',
    accessMode: 'authenticated',
  };
  assert.deepEqual(userSurfaceEligibility(app), { eligible: true, reason: null });
  // Restricted, and a tunnel from before access modes (restricted), too.
  assert.equal(userSurfaceEligibility({ ...app, accessMode: 'restricted' }).eligible, true);
  assert.equal(userSurfaceEligibility({ ...app, accessMode: undefined }).eligible, true);
  // Tunnels persisted before `type` existed are app tunnels.
  assert.equal(userSurfaceEligibility({ ...app, type: undefined }).eligible, true);
  for (const [tunnel, reason] of [
    [{ ...app, accessMode: 'public' }, /public tunnel/],
    [{ ...app, enabled: false }, /Enable/],
    [{ ...app, agentLabel: null }, /Assign/],
    [{ ...app, type: 'panel' }, /app tunnel/],
    [{ ...app, type: 'plugin' }, /app tunnel/],
    [{ ...app, exposure: 'internal', subdomain: null }, /app tunnel/],
  ]) {
    const result = userSurfaceEligibility(tunnel);
    assert.equal(result.eligible, false);
    assert.match(result.reason, reason);
  }
  assert.deepEqual(boundRoutes({ userSurface: { routes: ['fx', 'gx'] } }), ['fx', 'gx']);
  assert.deepEqual(boundRoutes({}), []);
  assert.deepEqual(boundRoutes({ userSurface: { routes: 'fx' } }), []);
});

test('audience rows: members, users who left, erased users', () => {
  const member = audienceRowView({
    userId: USER_ID,
    seq: 7,
    version: 2,
    updatedAt: '2026-10-22T10:00:00.000Z',
    change: {
      kind: 'upsert',
      member: {
        userId: USER_ID,
        username: 'alice',
        displayName: 'Alice',
        roles: ['viewer'],
        status: 'disabled',
        version: 2,
      },
    },
  });
  assert.equal(member.member, true);
  assert.equal(member.status, 'disabled');
  assert.deepEqual(member.roles, ['viewer']);
  assert.equal(member.displayName, 'Alice');

  const left = audienceRowView({
    userId: USER_ID,
    seq: 8,
    version: 3,
    updatedAt: '2026-10-22T10:01:00.000Z',
    change: { kind: 'remove', userId: USER_ID, reason: 'unentitled', last: { username: 'alice' } },
  });
  assert.equal(left.member, false);
  assert.equal(left.status, 'removed');
  assert.equal(left.reason, 'unentitled');
  assert.equal(left.username, 'alice');

  const erased = audienceRowView({
    userId: USER_ID,
    seq: 9,
    version: 4,
    updatedAt: '2026-10-22T10:02:00.000Z',
    change: { kind: 'remove', userId: USER_ID, reason: 'erased' },
  });
  assert.equal(erased.status, 'erased');
  assert.equal(erased.username, null);

  // A row the panel cannot read is shown as such, not as a member.
  assert.equal(audienceRowView({ userId: USER_ID, seq: 1, change: null }).status, 'unknown');
});

test('an entitlement change sends the roles sorted, each once', () => {
  assert.deepEqual(toggledRoles(['viewer'], 'editor', true), ['editor', 'viewer']);
  assert.deepEqual(toggledRoles(['editor', 'viewer'], 'editor', false), ['viewer']);
  assert.deepEqual(toggledRoles(['viewer'], 'viewer', true), ['viewer']);
});

test('an identity diff: what waits for approval, what only changes the digest', () => {
  const before = {
    roles: [
      { id: 'editor', label: 'Editor' },
      { id: 'viewer', label: 'Viewer' },
    ],
    attributes: ['displayName'],
  };
  const after = {
    roles: [
      { id: 'auditor', label: 'Auditor' },
      { id: 'viewer', label: 'Reader' },
    ],
    attributes: ['email'],
  };
  const shown = identityDiffRows({
    before,
    after,
    rolesAdded: ['auditor'],
    rolesRemoved: ['editor'],
    attributesAdded: ['email'],
    attributesRemoved: ['displayName'],
    labelsChanged: ['viewer'],
  });
  assert.deepEqual(shown, {
    rows: [
      { label: 'roles added', entries: ['auditor (Auditor)'], approval: true },
      { label: 'roles removed', entries: ['editor (Editor)'], approval: true },
      { label: 'receives more about its users', entries: ['email address'], approval: true },
      { label: 'receives less about its users', entries: ['display name'], approval: false },
      { label: 'role labels changed', entries: ['viewer (Reader)'], approval: false },
    ],
    declaredBefore: true,
    declaredAfter: true,
  });

  // A removed role stays removed: how many grants approving it changes.
  const removing = {
    before,
    after,
    rolesAdded: [],
    rolesRemoved: ['editor'],
    attributesAdded: [],
    attributesRemoved: [],
    labelsChanged: [],
  };
  assert.deepEqual(
    identityDiffRows({ ...removing, grantsAffected: { rewritten: 1, revoked: 4 } }).rows.at(-1),
    {
      label: 'role grants affected',
      entries: ['4 revoked', '1 narrowed to the roles that stay'],
      approval: true,
    },
  );
  assert.deepEqual(identityDiffRows({ ...removing, grantsAffected: null }).rows.at(-1).entries, [
    'not known — Gatekeeper could not be read',
  ]);
  assert.equal(
    identityDiffRows(removing).rows.some((row) => row.label === 'role grants affected'),
    false,
    'nothing said when the view does not carry it',
  );

  // Unchanged: nothing to show.
  const same = {
    before,
    after: before,
    rolesAdded: [],
    rolesRemoved: [],
    attributesAdded: [],
    attributesRemoved: [],
    labelsChanged: [],
  };
  assert.equal(identityDiffRows(same), null);
  assert.equal(identityDiffRows(null), null);

  // Declared for the first time.
  const first = identityDiffRows({
    before: null,
    after,
    rolesAdded: ['auditor', 'viewer'],
    rolesRemoved: [],
    attributesAdded: ['email'],
    attributesRemoved: [],
    labelsChanged: [],
  });
  assert.equal(first.declaredBefore, false);
  assert.equal(first.declaredAfter, true);
  assert.deepEqual(
    first.rows.map((row) => row.label),
    ['roles added', 'receives more about its users'],
  );
});
