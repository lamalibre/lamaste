/**
 * The stock invitation page (lib/invite-page.js): core's page, written
 * 0640 through a temporary file, left alone when the installed file is
 * already it, replaced when it differs — and a link at its name never
 * followed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { renderInvitePage } from '@lamalibre/lamaste/server';

import { writeInvitePage } from '../src/lib/invite-page.js';

test('the stock page is written once, compared before every later write, and replaces a stale file or a link', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lamaste-invite-page-'));
  try {
    const dir = path.join(root, 'invite');
    const file = path.join(dir, 'index.html');
    const logged = [];
    const logger = { info: (obj, msg) => logged.push({ ...obj, msg }) };

    assert.deepEqual(await writeInvitePage({ dir, logger }), { written: true });
    assert.equal(await readFile(file, 'utf-8'), renderInvitePage(null));
    assert.equal((await lstat(dir)).mode & 0o777, 0o750);
    assert.equal((await lstat(file)).mode & 0o777, 0o640);
    assert.deepEqual(logged, [{ file, msg: 'Stock invitation page written' }]);
    const first = await lstat(file);

    // Already this page: nothing written, nothing logged, the inode kept.
    assert.deepEqual(await writeInvitePage({ dir, logger }), { written: false });
    assert.equal((await lstat(file)).ino, first.ino);
    assert.equal(logged.length, 1);
    assert.deepEqual(await readdir(dir), ['index.html'], 'no temporary file left');

    // An older release's page: replaced.
    await writeFile(file, '<!DOCTYPE html><title>Lamaste — Accept Invitation</title>');
    assert.deepEqual(await writeInvitePage({ dir, logger }), { written: true });
    assert.equal(await readFile(file, 'utf-8'), renderInvitePage(null));

    // A link at its name is never read through, and is replaced by a file.
    const elsewhere = path.join(root, 'elsewhere.html');
    await writeFile(elsewhere, renderInvitePage(null));
    await rm(file);
    await symlink(elsewhere, file);
    assert.deepEqual(await writeInvitePage({ dir, logger }), { written: true });
    assert.ok((await lstat(file)).isFile());
    await assert.rejects(readlink(file));
    assert.equal(await readFile(elsewhere, 'utf-8'), renderInvitePage(null), 'untouched');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
