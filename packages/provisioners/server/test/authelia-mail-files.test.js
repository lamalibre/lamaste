/**
 * Authelia's mail files (packages/core/docs/mail-design.md §5): the
 * certificate directory and the submission password, owned by the panel's
 * account with the Authelia account's group — and nothing root does there
 * follows a link the panel's account could have planted.
 *
 * Run as the current user: the owner and group are the test's own.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ensureAutheliaMailFiles } from '../src/lib/ownership.js';

const ids = { lamasteUid: process.getuid(), autheliaGid: process.getgid() };

test('the certificate directory is made 2750 and the password file set 0640; files inside are left alone', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-authelia-'));
  try {
    await writeFile(path.join(dir, 'mail-submission-password'), 'x', { mode: 0o600 });
    await ensureAutheliaMailFiles(dir, ids);
    const certs = await stat(path.join(dir, 'certs'));
    assert.ok(certs.isDirectory());
    assert.equal(certs.mode & 0o7777, 0o2750);
    assert.equal((await stat(path.join(dir, 'mail-submission-password'))).mode & 0o7777, 0o640);

    // A certificate the panel wrote is the panel's to keep: never re-owned by root.
    await writeFile(path.join(dir, 'certs', 'lamaste-mail-ca.pem'), 'pem', { mode: 0o600 });
    await ensureAutheliaMailFiles(dir, ids);
    assert.equal((await stat(path.join(dir, 'certs', 'lamaste-mail-ca.pem'))).mode & 0o777, 0o600);

    // No password yet (a relay that never sent mail): nothing made.
    await rm(path.join(dir, 'mail-submission-password'));
    await ensureAutheliaMailFiles(dir, ids);
    await assert.rejects(stat(path.join(dir, 'mail-submission-password')), { code: 'ENOENT' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a link where the certificate directory belongs is refused, never followed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-authelia-'));
  try {
    await mkdir(path.join(dir, 'elsewhere'), { mode: 0o755 });
    await symlink(path.join(dir, 'elsewhere'), path.join(dir, 'certs'));
    await assert.rejects(ensureAutheliaMailFiles(dir, ids));
    assert.equal((await stat(path.join(dir, 'elsewhere'))).mode & 0o7777, 0o755);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
