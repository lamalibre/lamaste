/**
 * `lamaste-server plugins hooks|update|approve-hooks`: why a pending update
 * waits (its `approvalRequired`, a secret turned plain as a warning, an
 * identity change with its note), what auto-approve could not cover beyond
 * that, what an identity block lets a plugin learn and how an update
 * changes it, the command that approves it — by digest, by version, or
 * both — and the arguments `approve-hooks` takes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  APPROVE_HOOKS_USAGE,
  approveHooksCommand,
  identityBlockLines,
  identityDiffLines,
  parseApproveArgs,
  pendingUpdateReasons,
} from '../src/plugin-approval.js';

const DIGEST = 'a'.repeat(64);
const TOKEN_TURNS_PLAIN =
  'it turns secret settings into plain ones (token) — what is typed into them next is kept on the relay and shown in clear';

test('why an update waits: each reason, a secret turned plain as a warning', () => {
  assert.deepEqual(pendingUpdateReasons({}), { required: [], notCovered: [] });
  assert.deepEqual(pendingUpdateReasons(null), { required: [], notCovered: [] });
  const update = {
    approvalRequired: [
      { code: 'digest.unapproved', reason: 'its agent half is not what was approved' },
      { code: 'settings.secret-to-plain', reason: TOKEN_TURNS_PLAIN },
    ],
    // Auto-approve on: the secret withheld it — already said above.
    autoApproveWithheld: [TOKEN_TURNS_PLAIN],
  };
  assert.deepEqual(pendingUpdateReasons(update), {
    required: [
      { text: 'its agent half is not what was approved', warning: false, note: null },
      { text: TOKEN_TURNS_PLAIN, warning: true, note: null },
    ],
    notCovered: [],
  });
  // What auto-approve withheld beyond the reasons is listed on its own.
  assert.deepEqual(
    pendingUpdateReasons({
      approvalRequired: [
        { code: 'digest.unapproved', reason: 'its agent half is not what was approved' },
      ],
      autoApproveWithheld: ['it adds system packages (curl)'],
    }).notCovered,
    ['it adds system packages (curl)'],
  );
});

test('why an update waits: whatever the panel sent reaches the terminal printable', () => {
  const reasons = pendingUpdateReasons({
    approvalRequired: [
      null,
      'not an object',
      { code: 'settings.secret-to-plain', reason: 'turns \u001b[2Jplain‮' },
    ],
    autoApproveWithheld: ['adds\u0007 curl'],
  });
  assert.deepEqual(reasons, {
    required: [{ text: 'turns [2Jplain', warning: true, note: null }],
    notCovered: ['adds curl'],
  });
});

test('the approve command: by digest, by version, or both', () => {
  assert.equal(
    approveHooksCommand('fx', { digest: DIGEST }),
    `lamaste-server plugins approve-hooks fx --digest ${DIGEST}`,
  );
  assert.equal(
    approveHooksCommand('fx', { digest: DIGEST, version: '1.1.0' }),
    `lamaste-server plugins approve-hooks fx --digest ${DIGEST} --version 1.1.0`,
  );
  // An update that brings neither relay hooks nor an agent half has no digest.
  assert.equal(
    approveHooksCommand('ux', { digest: null, version: '1.1.0' }),
    'lamaste-server plugins approve-hooks ux --version 1.1.0',
  );
});

test('approve-hooks arguments: a digest, a version, or both — well-formed', () => {
  assert.deepEqual(parseApproveArgs(['--digest', DIGEST]), { digest: DIGEST, version: null });
  assert.deepEqual(parseApproveArgs(['--version', '1.1.0']), { digest: null, version: '1.1.0' });
  assert.deepEqual(parseApproveArgs(['--version', '1.1.0', '--digest', DIGEST]), {
    digest: DIGEST,
    version: '1.1.0',
  });
  for (const rest of [
    [],
    ['--digest'],
    ['--digest', 'f'.repeat(63)],
    ['--digest', DIGEST.toUpperCase()],
    ['--version'],
    ['--version', '1.1.0;rm'],
    ['--digest', DIGEST, '--version', ''],
  ]) {
    assert.deepEqual(parseApproveArgs(rest), { error: APPROVE_HOOKS_USAGE }, JSON.stringify(rest));
  }
});

const ROLES_ADDED = 'it adds roles (auditor) and receives more about its users (email)';

test('why an update waits: an identity change, with what auto-approve never covers', () => {
  const reasons = pendingUpdateReasons({
    approvalRequired: [
      { code: 'digest.unapproved', reason: 'its identity is not what was approved' },
      { code: 'identity.changed', reason: ROLES_ADDED },
    ],
    // Auto-approve on: the identity change withheld it — said above already.
    autoApproveWithheld: [ROLES_ADDED],
  });
  assert.deepEqual(reasons.required, [
    { text: 'its identity is not what was approved', warning: false, note: null },
    {
      text: ROLES_ADDED,
      warning: false,
      note: 'who its users are and what it learns about them — auto-approve never covers it',
    },
  ]);
  assert.deepEqual(reasons.notCovered, []);
});

test('an identity block: its roles, and what it receives about each member', () => {
  assert.deepEqual(
    identityBlockLines({
      roles: [
        { id: 'viewer', label: 'Viewer', description: 'Reads the dashboard' },
        { id: 'editor', label: 'Editor' },
      ],
      attributes: ['displayName', 'email'],
    }),
    [
      'roles:    viewer (Viewer — Reads the dashboard), editor (Editor)',
      'receives: user id, username, roles, status, display name, email address — of the users entitled to it',
    ],
  );
  assert.deepEqual(
    identityBlockLines({ roles: [{ id: 'viewer', label: 'V\u001b[2J' }], attributes: [] }),
    [
      'roles:    viewer (V[2J)',
      'receives: user id, username, roles, status — of the users entitled to it',
    ],
  );
  assert.deepEqual(identityBlockLines(null), []);
  assert.deepEqual(identityBlockLines({ roles: 'viewer' }), []);
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
  assert.deepEqual(
    identityDiffLines({
      before,
      after,
      rolesAdded: ['auditor'],
      rolesRemoved: ['editor'],
      attributesAdded: ['email'],
      attributesRemoved: ['displayName'],
      labelsChanged: ['viewer'],
    }),
    {
      headline: 'changes its identity',
      lines: [
        { text: 'roles added: auditor (Auditor) — waits for approval', approval: true },
        { text: 'roles removed: editor (Editor) — waits for approval', approval: true },
        {
          text: 'receives more about its users: email address — waits for approval',
          approval: true,
        },
        { text: 'receives less about its users: display name', approval: false },
        { text: 'role labels changed: viewer (Reader)', approval: false },
      ],
    },
  );
  const unchanged = {
    before,
    after: before,
    rolesAdded: [],
    rolesRemoved: [],
    attributesAdded: [],
    attributesRemoved: [],
    labelsChanged: [],
  };
  assert.equal(identityDiffLines(unchanged), null);
  assert.equal(identityDiffLines(null), null);
  assert.equal(
    identityDiffLines({ ...unchanged, before: null, after, rolesAdded: ['auditor', 'viewer'] })
      .headline,
    'declares identity for the first time',
  );
  assert.match(
    identityDiffLines({ ...unchanged, after: null, rolesRemoved: ['editor', 'viewer'] }).headline,
    /^no longer declares identity — it is sent no users, its role grants are revoked/,
  );
  // A removed role stays removed: how many grants approving it changes.
  const removing = { ...unchanged, after, rolesRemoved: ['editor'] };
  assert.deepEqual(
    identityDiffLines({ ...removing, grantsAffected: { rewritten: 2, revoked: 3 } }).lines.at(-1),
    {
      text: 'role grants affected: 3 revoked, 2 narrowed to the roles that stay — waits for approval',
      approval: true,
    },
  );
  assert.equal(
    identityDiffLines({ ...removing, grantsAffected: { rewritten: 0, revoked: 0 } }).lines.at(-1)
      .text,
    'role grants affected: none — waits for approval',
  );
  assert.match(
    identityDiffLines({ ...removing, grantsAffected: null }).lines.at(-1).text,
    /not known/,
  );
});
