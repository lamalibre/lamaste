/**
 * `lamaste-server plugins hooks|update|approve-hooks`: why a pending update
 * waits (its `approvalRequired`, a secret turned plain as a warning), what
 * auto-approve could not cover beyond that, the command that approves it —
 * by digest, by version, or both — and the arguments `approve-hooks` takes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  APPROVE_HOOKS_USAGE,
  approveHooksCommand,
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
      { text: 'its agent half is not what was approved', warning: false },
      { text: TOKEN_TURNS_PLAIN, warning: true },
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
    required: [{ text: 'turns [2Jplain', warning: true }],
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
