/**
 * Slice 6, the identity contract: the manifest's `identity` block (roles,
 * attributes; only an agent-hosted plugin with an agent half), its
 * canonical form, the approval digest — byte for byte 4.4.1's for a plugin
 * without identity, another one with it — the diff and what of it waits
 * for approval, and the feed's wire parsers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_IDENTITY_ATTRIBUTES,
  IDENTITY_BATCH_MAX_CHANGES,
  ManifestValidationError,
  USERNAME_REGEX,
  approvalDigest,
  hookEntrySha256,
  identityChangeNeedsApproval,
  identityDiff,
  isLamasteUsername,
  normalizeIdentityBlock,
  parseIdentityChangesAnswer,
  parseIdentityChangesRequest,
  parseIdentityCursorConflict,
  parseIdentityNotifyAnswer,
  parseIdentityNotifyRequest,
  relayHookSetOf,
  validateManifest,
} from '@lamalibre/lamaste';

const agentBlock = {
  requires: { os: ['linux'], node: '>=22', systemPackages: ['sqlite3', 'curl'] },
  package: '@lamalibre/fx-agent',
  service: { entry: 'dist/agentd.js', memoryMax: '512M' },
};

const base = { name: 'fx', version: '1.0.0', hosting: 'agent', agent: agentBlock };

const identity = {
  roles: [
    { id: 'viewer', label: 'Görüntüleyici' },
    { id: 'manager', label: 'Yönetici', description: 'Edits the indicator list' },
  ],
  attributes: ['displayName'],
};

const INTEGRITY = `sha512-${Buffer.alloc(64, 7).toString('base64')}`;

const spec = {
  package: '@lamalibre/fx-agent',
  version: '1.0.0',
  integrity: INTEGRITY,
  service: { entry: 'dist/agentd.js', memoryMax: '512M' },
  systemPackages: ['curl', 'sqlite3'],
};

function manifestError(manifest) {
  try {
    validateManifest(manifest);
    return null;
  } catch (err) {
    assert.ok(err instanceof ManifestValidationError, String(err));
    return err.issues.map((e) => `${e.path}: ${e.message}`).join('\n');
  }
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

test('manifest: identity on an agent-hosted plugin with an agent half; attributes default to displayName', () => {
  const m = validateManifest({ ...base, identity });
  assert.deepEqual(m.identity.roles, identity.roles);
  assert.deepEqual(m.identity.attributes, ['displayName']);
  const defaulted = validateManifest({
    ...base,
    identity: { roles: [{ id: 'viewer', label: 'V' }] },
  });
  assert.deepEqual(defaulted.identity.attributes, ['displayName']);
  // The default is a fresh array each time, never a shared one.
  defaulted.identity.attributes.push('email');
  assert.deepEqual(DEFAULT_IDENTITY_ATTRIBUTES, ['displayName']);
  assert.deepEqual(
    validateManifest({ ...base, identity: { roles: [{ id: 'viewer', label: 'V' }] } }).identity
      .attributes,
    ['displayName'],
  );
  const both = validateManifest({
    ...base,
    identity: { ...identity, attributes: ['email', 'displayName'] },
  });
  assert.deepEqual(both.identity.attributes, ['email', 'displayName']);
  const none = validateManifest({ ...base, identity: { ...identity, attributes: [] } });
  assert.deepEqual(none.identity.attributes, []);
  // A manifest without identity has none.
  assert.equal(validateManifest(base).identity, undefined);
});

test('manifest: identity needs hosting "agent" and an agent block', () => {
  assert.match(
    manifestError({ name: 'fx', version: '1.0.0', identity }),
    /^identity: .*agent half/,
  );
  assert.match(
    manifestError({ name: 'fx', version: '1.0.0', hosting: 'agent', identity }),
    /^identity: .*agent half/,
  );
});

test('manifest: roles and attributes are refused when they are not the contract', () => {
  const role = (r) => ({ ...base, identity: { roles: [r] } });
  for (const [bad, pattern] of [
    [{ ...base, identity: { roles: [] } }, /identity\.roles/],
    [
      {
        ...base,
        identity: { roles: Array.from({ length: 33 }, (_, i) => ({ id: `r${i}`, label: 'R' })) },
      },
      /identity\.roles/,
    ],
    [
      {
        ...base,
        identity: {
          roles: [
            { id: 'viewer', label: 'A' },
            { id: 'viewer', label: 'B' },
          ],
        },
      },
      /Role ids must be unique/,
    ],
    [role({ id: 'Viewer', label: 'V' }), /identity\.roles\.0\.id/],
    [role({ id: '1viewer', label: 'V' }), /identity\.roles\.0\.id/],
    [role({ id: 'a'.repeat(33), label: 'V' }), /identity\.roles\.0\.id/],
    [role({ id: 'viewer', label: '' }), /identity\.roles\.0\.label/],
    [role({ id: 'viewer', label: 'x'.repeat(65) }), /identity\.roles\.0\.label/],
    [role({ id: 'viewer', label: 'View‮er' }), /control characters/],
    [role({ id: 'viewer', label: 'V', description: 'd\u0007' }), /control characters/],
    [role({ id: 'viewer', label: 'V', description: 'x'.repeat(201) }), /description/],
    [role({ id: 'viewer', label: 'V', extra: true }), /identity\.roles\.0/],
    [{ ...base, identity: { ...identity, attributes: ['groups'] } }, /identity\.attributes/],
    [
      { ...base, identity: { ...identity, attributes: ['email', 'email'] } },
      /attributes must not repeat/,
    ],
    [{ ...base, identity: { ...identity, badges: true } }, /identity/],
  ]) {
    const error = manifestError(bad);
    assert.ok(error, JSON.stringify(bad.identity));
    assert.match(error, pattern);
  }
  // Edge values that are valid.
  assert.equal(manifestError(role({ id: 'a', label: 'x'.repeat(64) })), null);
  assert.equal(manifestError(role({ id: `a${'b-'.repeat(15)}c`, label: 'V' })), null);
});

// ---------------------------------------------------------------------------
// Canonical form, diff, approval
// ---------------------------------------------------------------------------

test('normalizeIdentityBlock: roles by id, attributes sorted, the default applied; invalid throws', () => {
  assert.deepEqual(normalizeIdentityBlock(identity), {
    roles: [
      { id: 'manager', label: 'Yönetici', description: 'Edits the indicator list' },
      { id: 'viewer', label: 'Görüntüleyici' },
    ],
    attributes: ['displayName'],
  });
  assert.deepEqual(
    normalizeIdentityBlock({
      roles: [{ id: 'viewer', label: 'V' }],
      attributes: ['email', 'displayName'],
    }).attributes,
    ['displayName', 'email'],
  );
  assert.deepEqual(normalizeIdentityBlock({ roles: [{ id: 'viewer', label: 'V' }] }).attributes, [
    'displayName',
  ]);
  assert.throws(() => normalizeIdentityBlock({ roles: [] }), /Not a valid identity block/);
});

test('identityDiff: roles and attributes added and removed, labels changed; what waits for approval', () => {
  const v1 = identity;
  // Label and description edits, and narrowing: no approval.
  const relabelled = {
    roles: [
      { id: 'viewer', label: 'İzleyici' },
      { id: 'manager', label: 'Yönetici' },
    ],
    attributes: [],
  };
  const narrowed = identityDiff(v1, relabelled);
  assert.deepEqual(narrowed, {
    rolesAdded: [],
    rolesRemoved: [],
    attributesAdded: [],
    attributesRemoved: ['displayName'],
    labelsChanged: ['manager', 'viewer'],
  });
  assert.equal(identityChangeNeedsApproval(narrowed), false);

  const widened = identityDiff(v1, { ...v1, attributes: ['displayName', 'email'] });
  assert.deepEqual(widened.attributesAdded, ['email']);
  assert.equal(identityChangeNeedsApproval(widened), true);

  const roleAdded = identityDiff(v1, {
    ...v1,
    roles: [...v1.roles, { id: 'auditor', label: 'Denetçi' }],
  });
  assert.deepEqual(roleAdded.rolesAdded, ['auditor']);
  assert.equal(identityChangeNeedsApproval(roleAdded), true);

  const roleRemoved = identityDiff(v1, { ...v1, roles: [v1.roles[0]] });
  assert.deepEqual(roleRemoved.rolesRemoved, ['manager']);
  assert.equal(identityChangeNeedsApproval(roleRemoved), true);

  // Declaring identity for the first time, or dropping it: roles change.
  const declared = identityDiff(null, v1);
  assert.deepEqual(declared.rolesAdded, ['manager', 'viewer']);
  assert.deepEqual(declared.attributesAdded, ['displayName']);
  assert.equal(identityChangeNeedsApproval(declared), true);
  assert.equal(identityChangeNeedsApproval(identityDiff(v1, null)), true);
  assert.equal(identityChangeNeedsApproval(identityDiff(null, null)), false);
  // The same block in another order is no change at all.
  const reordered = identityDiff(v1, {
    roles: [...v1.roles].reverse(),
    attributes: ['displayName'],
  });
  assert.deepEqual(reordered, {
    rolesAdded: [],
    rolesRemoved: [],
    attributesAdded: [],
    attributesRemoved: [],
    labelsChanged: [],
  });
});

test('approvalDigest: unchanged without identity (4.4.1 vectors); identity changes it, canonically', () => {
  const m = validateManifest({
    ...base,
    hooks: { relay: { entry: 'hooks/relay.mjs', install: { 'pre-tunnel': {} } } },
  });
  const set = relayHookSetOf(m);
  const sha = hookEntrySha256(Buffer.from('export default {}'));
  // Computed with Lamaste 4.4.1 before identity existed.
  const v441 = {
    agentHalfOnly: '4f7e859edd8211fec497d263cd07bbbe5a758ff057c6a864514c1a70cf6e397e',
    relayOnly: '3877045ce0317eca28bc3d7f6638764b806251793fb9cc9f745a21fe4b5c3d04',
    both: '54bdb708a87d37d1a0eca4329a5be873abaeae0d72e01ce82960d677a82d46e9',
  };
  const subjects = {
    agentHalfOnly: { relay: null, agentHalf: spec },
    relayOnly: { relay: { set, entrySha256: sha }, agentHalf: null },
    both: { relay: { set, entrySha256: sha }, agentHalf: spec },
  };
  for (const [name, subject] of Object.entries(subjects)) {
    assert.equal(approvalDigest(subject), v441[name], name);
    assert.equal(approvalDigest({ ...subject, identity: null }), v441[name], `${name}, null`);
    assert.equal(
      approvalDigest({ ...subject, identity: undefined }),
      v441[name],
      `${name}, undefined`,
    );
    const withIdentity = approvalDigest({ ...subject, identity });
    assert.match(withIdentity, /^[a-f0-9]{64}$/);
    assert.notEqual(withIdentity, v441[name], `${name}: identity enters the digest`);
  }

  const digest = (block) => approvalDigest({ relay: null, agentHalf: spec, identity: block });
  const d = digest(identity);
  // Order and the default are not changes.
  assert.equal(digest({ roles: [...identity.roles].reverse(), attributes: ['displayName'] }), d);
  assert.equal(digest({ roles: identity.roles }), d);
  assert.equal(digest(validateManifest({ ...base, identity }).identity), d);
  // Any edit is: a label, a description, an attribute, a role.
  const edits = [
    { ...identity, roles: [{ ...identity.roles[0], label: 'İzleyici' }, identity.roles[1]] },
    { ...identity, roles: [identity.roles[0], { id: 'manager', label: 'Yönetici' }] },
    { ...identity, attributes: [] },
    { ...identity, attributes: ['displayName', 'email'] },
    { ...identity, roles: [identity.roles[0]] },
  ];
  const seen = new Set([d]);
  for (const edit of edits) {
    const other = digest(edit);
    assert.ok(!seen.has(other), JSON.stringify(edit));
    seen.add(other);
  }
  assert.throws(() => digest({ roles: [] }), /Not a valid identity block/);
});

// ---------------------------------------------------------------------------
// Usernames and the feed's wire contract
// ---------------------------------------------------------------------------

test('usernames: one rule for the users API and the identity contract', () => {
  assert.equal(USERNAME_REGEX.source, '^[a-z0-9][a-z0-9_-]*$');
  for (const ok of ['ab', 'ayse', 'a_b-c', '0x', 'a'.repeat(32)])
    assert.equal(isLamasteUsername(ok), true, ok);
  for (const bad of ['a', 'a'.repeat(33), '-ab', '_ab', 'Ayse', 'ay se', 'ay.se', '', 7, null]) {
    assert.equal(isLamasteUsername(bad), false, String(bad));
  }
});

const DIRECTORY = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const PASS = 'c1b2c3d4-e5f6-4a7b-ac9d-0e1f2a3b4c5d';
const U1 = '11111111-1111-4111-8111-111111111111';

const member = {
  userId: U1,
  username: 'ayse',
  displayName: 'Ayşe Yılmaz',
  email: 'ayse@example.com',
  roles: ['viewer'],
  status: 'active',
  version: 1,
};

function changes(fields = {}) {
  return {
    protocol: 1,
    directoryId: DIRECTORY,
    from: 0,
    to: 10,
    reset: false,
    reconcile: false,
    pass: PASS,
    final: false,
    changes: [{ seq: 4, kind: 'upsert', member }],
    ...fields,
  };
}

test('wire: a batch is accepted only as the contract says', () => {
  assert.ok(parseIdentityChangesRequest(changes()));
  assert.ok(parseIdentityChangesRequest(changes({ changes: [] })));
  assert.ok(parseIdentityChangesRequest(changes({ from: 10, to: 10, changes: [] })));
  assert.ok(
    parseIdentityChangesRequest(
      changes({
        changes: [
          { seq: 1, kind: 'remove', userId: U1, reason: 'deleted', last: { username: 'ayse' } },
          {
            seq: 2,
            kind: 'remove',
            userId: U1,
            reason: 'unentitled',
            last: { username: 'ayse', displayName: 'A', email: 'a@example.com' },
          },
          { seq: 3, kind: 'remove', userId: U1, reason: 'erased' },
        ],
      }),
    ),
  );
  const many = Array.from({ length: IDENTITY_BATCH_MAX_CHANGES }, (_, i) => ({
    seq: i + 1,
    kind: 'upsert',
    member,
  }));
  assert.ok(parseIdentityChangesRequest(changes({ to: 1000, changes: many })));

  // A member without the attributes the plugin does not declare.
  const bare = { ...member };
  delete bare.displayName;
  delete bare.email;
  assert.ok(
    parseIdentityChangesRequest(changes({ changes: [{ seq: 4, kind: 'upsert', member: bare }] })),
  );

  for (const [why, bad] of [
    ['protocol', changes({ protocol: 2 })],
    ['directory', changes({ directoryId: DIRECTORY.toUpperCase() })],
    ['pass', changes({ pass: 'p' })],
    ['to before from', changes({ from: 5, to: 4, changes: [] })],
    ['reset from 0 only', changes({ reset: true, from: 3 })],
    ['seq at from', changes({ from: 4 })],
    ['seq past to', changes({ to: 3 })],
    [
      'seq order',
      changes({
        changes: [
          { seq: 5, kind: 'upsert', member },
          { seq: 5, kind: 'upsert', member },
        ],
      }),
    ],
    ['too many', changes({ to: 1000, changes: [...many, { seq: 999, kind: 'upsert', member }] })],
    ['unknown key', { ...changes(), extra: 1 }],
    [
      'member key',
      changes({ changes: [{ seq: 4, kind: 'upsert', member: { ...member, groups: [] } }] }),
    ],
    [
      'roles empty',
      changes({ changes: [{ seq: 4, kind: 'upsert', member: { ...member, roles: [] } }] }),
    ],
    [
      'roles repeat',
      changes({ changes: [{ seq: 4, kind: 'upsert', member: { ...member, roles: ['a', 'a'] } }] }),
    ],
    [
      'status',
      changes({ changes: [{ seq: 4, kind: 'upsert', member: { ...member, status: 'removed' } }] }),
    ],
    [
      'version',
      changes({ changes: [{ seq: 4, kind: 'upsert', member: { ...member, version: 0 } }] }),
    ],
    [
      'username',
      changes({ changes: [{ seq: 4, kind: 'upsert', member: { ...member, username: 'A' } }] }),
    ],
    [
      'display name',
      changes({ changes: [{ seq: 4, kind: 'upsert', member: { ...member, displayName: 'a‮b' } }] }),
    ],
    [
      'email',
      changes({ changes: [{ seq: 4, kind: 'upsert', member: { ...member, email: 'nope' } }] }),
    ],
    [
      'erased with last',
      changes({
        changes: [
          { seq: 4, kind: 'remove', userId: U1, reason: 'erased', last: { username: 'ayse' } },
        ],
      }),
    ],
    [
      'deleted without last',
      changes({ changes: [{ seq: 4, kind: 'remove', userId: U1, reason: 'deleted' }] }),
    ],
    [
      'reason',
      changes({
        changes: [
          { seq: 4, kind: 'remove', userId: U1, reason: 'banned', last: { username: 'ayse' } },
        ],
      }),
    ],
    ['kind', changes({ changes: [{ seq: 4, kind: 'patch', member }] })],
    ['not an object', 'batch'],
  ]) {
    assert.equal(parseIdentityChangesRequest(bad), null, why);
  }
});

test('wire: notifications, answers and the 409', () => {
  assert.deepEqual(parseIdentityNotifyRequest({ protocol: 1, directoryId: DIRECTORY, seq: 0 }), {
    protocol: 1,
    directoryId: DIRECTORY,
    seq: 0,
  });
  assert.equal(parseIdentityNotifyRequest({ protocol: 1, directoryId: DIRECTORY, seq: -1 }), null);
  assert.equal(parseIdentityNotifyRequest({ protocol: 1, directoryId: DIRECTORY }), null);
  assert.ok(parseIdentityNotifyAnswer({ protocol: 1, directoryId: null, cursor: 0 }));
  assert.ok(parseIdentityNotifyAnswer({ protocol: 1, directoryId: DIRECTORY, cursor: 9 }));
  assert.equal(parseIdentityNotifyAnswer({ protocol: 1, directoryId: null, cursor: 1.5 }), null);
  assert.ok(parseIdentityChangesAnswer({ protocol: 1, directoryId: DIRECTORY, cursor: 9 }));
  assert.ok(
    parseIdentityChangesAnswer({ protocol: 1, directoryId: DIRECTORY, cursor: 9, mismatches: 0 }),
  );
  assert.equal(
    parseIdentityChangesAnswer({ protocol: 1, directoryId: null, cursor: 9, mismatches: 0 }),
    null,
  );
  assert.ok(
    parseIdentityCursorConflict({
      error: 'cursor_mismatch',
      protocol: 1,
      directoryId: null,
      cursor: 0,
    }),
  );
  assert.equal(parseIdentityCursorConflict({ error: 'other', protocol: 1, cursor: 0 }), null);
});
