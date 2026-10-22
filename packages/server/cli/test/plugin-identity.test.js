/**
 * Users and identity in requests at the terminal: the arguments of
 * `plugins entitlements|identity-sync`, `users …` and `tunnels
 * bind-user-surface|unbind-user-surface` are checked before the panel is
 * asked, a tunnel and a plugin are found by every name they go by, and
 * what the panel says is printed in its words — never with a control
 * character it sent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ENTITLEMENTS_USAGE,
  audienceRowText,
  findHostTunnel,
  findPluginByNameOrRoute,
  parseEntitlementsArgs,
  parseIdentitySyncArgs,
  parseUserArgs,
  parseUserSurfaceArgs,
  readinessText,
  syncRows,
  userSurfaceStatusText,
  warningLine,
} from '../src/plugin-identity.js';
import { removedUserText, userRows } from '../src/commands/users.js';

const USER_ID = '0f6c2a2e-6c1d-4c58-9d0e-3f1b2a4c5d6e';
const DIRECTORY_ID = '8d3f1c2b-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const OTHER_DIRECTORY_ID = '1b2c3d4e-5f60-4a1b-9c2d-3e4f5a6b7c8d';

test('entitlements: list, give exactly these roles, take them all away', () => {
  assert.deepEqual(parseEntitlementsArgs(['fx']), { ok: true, name: 'fx', action: 'list' });
  assert.deepEqual(parseEntitlementsArgs(['fx', '--user', 'alice', '--roles', 'viewer,editor']), {
    ok: true,
    name: 'fx',
    action: 'set',
    principalType: 'user',
    principalId: 'alice',
    roles: ['editor', 'viewer'],
  });
  // Repeated roles count once; spaces around the commas are ignored.
  assert.deepEqual(
    parseEntitlementsArgs(['--roles', 'viewer, viewer', '--group', 'ops-team', 'fx']).roles,
    ['viewer'],
  );
  assert.deepEqual(parseEntitlementsArgs(['fx', '--revoke', '--group', 'ops-team']), {
    ok: true,
    name: 'fx',
    action: 'revoke',
    principalType: 'group',
    principalId: 'ops-team',
  });
});

test('entitlements: refused before the panel is asked', () => {
  assert.deepEqual(parseEntitlementsArgs([]), { ok: false, error: ENTITLEMENTS_USAGE });
  for (const [args, error] of [
    [['fx', '--user', 'alice'], /Give --roles <a,b>, or --revoke/],
    [['fx', '--roles', 'viewer'], /Name whose roles/],
    [['fx', '--revoke'], /Name whose roles/],
    [['fx', '--user', 'alice', '--group', 'ops', '--roles', 'viewer'], /Name one principal/],
    [['fx', '--user'], /--user needs a value/],
    [['fx', '--user', '--roles', 'viewer'], /--user needs a value/],
    [['fx', '--user', 'alice', '--roles', 'viewer', '--revoke'], /takes no --roles/],
    [['fx', '--user', 'Alice', '--roles', 'viewer'], /"Alice" is not a username/],
    [['fx', '--user', '-alice', '--roles', 'viewer'], /"-alice" is not a username/],
    [['fx', '--group', 'Ops', '--roles', 'viewer'], /"Ops" is not a group name/],
    [['fx', '--group', 'a', '--roles', 'viewer'], /"a" is not a group name/],
    [['fx', '--user', 'alice', '--roles', 'Viewer'], /"Viewer" is not a role id/],
    [['fx', '--user', 'alice', '--roles', 'viewer,'], /comma-separated list of role ids/],
    [['fx', '--user', 'alice', '--roles', ','], /comma-separated list of role ids/],
    [['fx', 'gx'], /Unexpected argument "gx"/],
    [['fx', '--all'], /Unknown option --all/],
  ]) {
    const result = parseEntitlementsArgs(args);
    assert.equal(result.ok, false, JSON.stringify(args));
    assert.match(result.error, error, JSON.stringify(args));
  }
});

test('identity-sync: a plugin, and --reconcile', () => {
  assert.deepEqual(parseIdentitySyncArgs(['fx']), { ok: true, name: 'fx', reconcile: false });
  assert.deepEqual(parseIdentitySyncArgs(['--reconcile', 'fx']), {
    ok: true,
    name: 'fx',
    reconcile: true,
  });
  assert.equal(parseIdentitySyncArgs([]).ok, false);
  assert.match(parseIdentitySyncArgs(['fx', '--replay']).error, /Unknown option --replay/);
  assert.match(parseIdentitySyncArgs(['fx', 'gx']).error, /Unexpected argument "gx"/);
});

test('users: a username to disable, enable or delete; a user id to erase', () => {
  assert.deepEqual(parseUserArgs('disable', ['alice']), {
    ok: true,
    username: 'alice',
    erase: false,
  });
  assert.deepEqual(parseUserArgs('delete', ['alice', '--erase']), {
    ok: true,
    username: 'alice',
    erase: true,
  });
  assert.deepEqual(parseUserArgs('erase', [USER_ID]), { ok: true, userId: USER_ID });
  for (const [sub, args, error] of [
    ['disable', [], /^Usage: lamaste-server users disable <username>$/],
    ['enable', ['alice', '--erase'], /Unknown option --erase/],
    ['delete', ['alice', 'bob'], /Unexpected argument "bob"/],
    ['delete', ['Alice'], /"Alice" is not a username/],
    ['delete', ['a'], /"a" is not a username/],
    ['erase', ['alice'], /"alice" is not a user id/],
    ['erase', [USER_ID.toUpperCase()], /is not a user id/],
    ['erase', [USER_ID, '--erase'], /Unknown option --erase/],
  ]) {
    const result = parseUserArgs(sub, args);
    assert.equal(result.ok, false, `${sub} ${args.join(' ')}`);
    assert.match(result.error, error, `${sub} ${args.join(' ')}`);
  }
});

test('user surface: a tunnel by id, subdomain or FQDN; a plugin by name or route', () => {
  assert.deepEqual(parseUserSurfaceArgs('bind-user-surface', ['piyasa', 'market-indicators']), {
    ok: true,
    tunnel: 'piyasa',
    plugin: 'market-indicators',
  });
  assert.match(
    parseUserSurfaceArgs('unbind-user-surface', ['piyasa']).error,
    /^Usage: lamaste-server tunnels unbind-user-surface/,
  );
  assert.match(
    parseUserSurfaceArgs('bind-user-surface', ['piyasa', 'fx', '--force']).error,
    /Unknown option --force/,
  );

  const tunnels = [
    { id: 'aaaa', subdomain: 'piyasa', fqdn: 'piyasa.example.com' },
    // An internal plugin tunnel has no host: never a user surface.
    { id: 'bbbb', subdomain: null, fqdn: null, exposure: 'internal' },
    // A subdomain that reads like another tunnel's id loses to the id.
    { id: 'cccc', subdomain: 'aaaa', fqdn: 'aaaa.example.com' },
  ];
  for (const ref of ['aaaa', 'piyasa', 'piyasa.example.com']) {
    assert.equal(findHostTunnel(tunnels, ref).tunnel.id, 'aaaa', ref);
  }
  assert.equal(findHostTunnel(tunnels, 'aaaa.example.com').tunnel.id, 'cccc');
  assert.match(findHostTunnel(tunnels, 'bbbb').error, /No tunnel/);

  const plugins = [
    { name: 'market-indicators', route: 'market-indicators' },
    { name: 'herd-server', route: 'herd' },
  ];
  assert.equal(findPluginByNameOrRoute(plugins, 'herd').plugin.name, 'herd-server');
  assert.equal(findPluginByNameOrRoute(plugins, 'herd-server').plugin.route, 'herd');
  assert.match(findPluginByNameOrRoute(plugins, 'feria').error, /No installed plugin/);
});

test('readiness and user-surface status, in words', () => {
  assert.deepEqual(readinessText({ ready: true, reason: null }), {
    ready: true,
    text: 'ready — users reach its application',
  });
  assert.match(
    readinessText({ ready: false, reason: 'not_approved', version: '1.1.0' }).text,
    /version 1\.1\.0 waits for approval/,
  );
  assert.match(
    readinessText({ ready: false, reason: 'not_answered', version: '1.1.0' }).text,
    /has not answered the identity feed for version 1\.1\.0/,
  );
  assert.equal(readinessText({ ready: false, reason: 'x\u001b[2J' }).text, 'x[2J');
  assert.equal(userSurfaceStatusText({ route: 'fx', served: true, reason: null }), 'served');
  assert.match(
    userSurfaceStatusText({ route: 'fx', served: false, reason: 'no_identity' }),
    /requests go down the tunnel/,
  );
});

test('audience rows: members, users who left, erased users', () => {
  const member = audienceRowText({
    userId: USER_ID,
    seq: 3,
    change: {
      kind: 'upsert',
      member: {
        userId: USER_ID,
        username: 'alice',
        displayName: 'Alice‮',
        roles: ['viewer'],
        status: 'active',
        version: 1,
      },
    },
  });
  assert.deepEqual(member, {
    userId: USER_ID,
    seq: 3,
    who: 'Alice (alice)',
    roles: 'viewer',
    status: 'active',
    member: true,
  });
  const left = audienceRowText({
    userId: USER_ID,
    seq: 4,
    change: { kind: 'remove', userId: USER_ID, reason: 'unentitled', last: { username: 'alice' } },
  });
  assert.equal(left.status, 'removed (no longer entitled)');
  assert.equal(left.who, 'alice');
  assert.equal(left.member, false);
  const erased = audienceRowText({
    userId: USER_ID,
    seq: 5,
    change: { kind: 'remove', userId: USER_ID, reason: 'erased' },
  });
  assert.equal(erased.status, 'erased');
  assert.equal(erased.who, '—');
});

test('the feed, in rows: what the half follows, where it stands, what went wrong', () => {
  const now = Date.parse('2026-10-22T12:00:00.000Z');
  const sync = {
    directoryId: DIRECTORY_ID,
    halfDirectoryId: DIRECTORY_ID,
    cursor: 40,
    head: 42,
    behind: 2,
    readyVersion: '1.1.0',
    lastSyncAt: '2026-10-22T11:58:00.000Z',
    lastReconcileAt: '2026-10-22T03:00:00.000Z',
    lastMismatches: 0,
    lastError: 'the agent half answered the identity call with status 500',
  };
  const rows = Object.fromEntries(syncRows(sync, now));
  assert.equal(rows['half follows'], 'this directory');
  assert.equal(rows.position, 'cursor 40 of head 42 — 2 change(s) behind');
  assert.equal(rows['answered for'], 'version 1.1.0');
  assert.match(rows['last sync'], /\(2m ago\)$/);
  assert.match(rows['last reconcile'], /— 0 out of step$/);
  assert.equal(rows['last error'], sync.lastError);

  const other = Object.fromEntries(
    syncRows(
      { ...sync, halfDirectoryId: OTHER_DIRECTORY_ID, behind: 0, lastError: null, cursor: 42 },
      now,
    ),
  );
  assert.match(other['half follows'], /^another directory .* the next sync replays$/);
  assert.equal(other.position, 'cursor 42 of head 42 — up to date');
  assert.equal(other['last error'], undefined);
  assert.equal(
    Object.fromEntries(syncRows({ ...sync, halfDirectoryId: null }, now))['half follows'],
    'nothing yet',
  );
});

test('warnings read as one line each', () => {
  assert.equal(warningLine('registry tokens were not revoked'), 'registry tokens were not revoked');
  assert.equal(
    warningLine({ step: 'erase', message: 'Gatekeeper\u0007 is not reachable' }),
    'erase: Gatekeeper is not reachable',
  );
});

test('users list: status and directory id, a dash until the directory has seen a user', () => {
  assert.deepEqual(
    userRows([
      { username: 'alice', status: 'active', userId: USER_ID, groups: ['admins'] },
      { username: 'bob', status: 'disabled', userId: null, groups: [] },
    ]),
    [
      { username: 'alice', status: 'active', userId: USER_ID, groups: 'admins' },
      { username: 'bob', status: 'disabled', userId: '—', groups: '' },
    ],
  );
});

test('users directory: a tombstone, a pending cleanup, a pending erasure', () => {
  const now = Date.parse('2026-10-22T12:00:00.000Z');
  const base = {
    userId: USER_ID,
    status: 'removed',
    removedReason: 'deleted',
    removedAt: '2026-10-22T11:00:00.000Z',
    erasedAt: null,
    principalClearedAt: '2026-10-22T11:00:01.000Z',
    pendingErasures: [],
  };
  const tombstone = removedUserText({ ...base, username: 'alice', displayName: 'Alice' }, now);
  assert.equal(tombstone.who, 'alice (Alice)');
  assert.match(tombstone.removed, /^deleted 2026-10-22T11:00:00\.000Z \(1h ago\)$/);
  assert.equal(tombstone.pending, null);

  assert.match(
    removedUserText({ ...base, username: 'alice', principalClearedAt: null }, now).pending,
    /Gatekeeper cleanup of the username pending/,
  );
  assert.match(
    removedUserText({ ...base, username: 'bob', removedReason: 'deleted-outside' }, now).removed,
    /^gone from users\.yml/,
  );

  const erased = removedUserText(
    {
      ...base,
      username: null,
      erasedAt: '2026-10-22T11:30:00.000Z',
      principalClearedAt: null,
      pendingErasures: ['market-indicators'],
    },
    now,
  );
  assert.equal(erased.who, 'erased');
  assert.equal(erased.pending, 'erasure not yet acknowledged by market-indicators');
  assert.equal(
    removedUserText({ ...base, username: null, erasedAt: '2026-10-22T11:30:00.000Z' }, now).pending,
    null,
  );
});
