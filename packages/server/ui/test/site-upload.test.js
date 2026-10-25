/**
 * Static site uploads from the file browser: a selection goes in as many
 * requests as the panel's 64 MiB request limit needs, one after another,
 * and answers as one upload; a file over the 50 MiB file limit is found
 * before anything is sent. (The limits and the planner's agreement with the
 * core library are tested in the panel's site-upload-limits test.)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SITE_UPLOAD_MAX_FILE_BYTES,
  oversizedSiteUploads,
  uploadSiteFilesInBatches,
} from '../src/admin/lib/siteUpload.js';

const MIB = 1024 * 1024;
const file = (name, size) => ({ name, size });

test('a selection within one request is sent once', async () => {
  const sent = [];
  const files = [file('a.html', 100), file('b.css', 200)];
  const answer = await uploadSiteFilesInBatches(files, async (batch) => {
    sent.push(batch.map((f) => f.name));
    return { ok: true, files: batch.map((f) => f.name) };
  });
  assert.deepEqual(sent, [['a.html', 'b.css']]);
  assert.deepEqual(answer, { ok: true, files: ['a.html', 'b.css'] });
});

test('a larger selection is sent in requests one after another and answers as one', async () => {
  const files = [file('a.mp4', 40 * MIB), file('b.mp4', 40 * MIB), file('c.txt', 10)];
  const sent = [];
  let inFlight = 0;
  const answer = await uploadSiteFilesInBatches(files, async (batch) => {
    inFlight += 1;
    assert.equal(inFlight, 1, 'one request at a time');
    await new Promise((resolve) => setTimeout(resolve, 0));
    inFlight -= 1;
    sent.push(batch.map((f) => f.name));
    const names = batch.map((f) => f.name);
    return names.includes('c.txt')
      ? { ok: true, files: names, warning: 'Site size exceeds the limit.' }
      : { ok: true, files: names };
  });
  assert.deepEqual(sent, [['a.mp4'], ['b.mp4', 'c.txt']]);
  assert.deepEqual(answer, {
    ok: true,
    files: ['a.mp4', 'b.mp4', 'c.txt'],
    warning: 'Site size exceeds the limit.',
  });
});

test('a failed request stops the rest and says what was saved before it', async () => {
  const files = [file('a.mp4', 40 * MIB), file('b.mp4', 40 * MIB), file('c.mp4', 40 * MIB)];
  let calls = 0;
  await assert.rejects(
    uploadSiteFilesInBatches(files, async (batch) => {
      calls += 1;
      if (calls === 2) throw new Error('Upload failed: disk full');
      return { ok: true, files: batch.map((f) => f.name) };
    }),
    { message: 'Upload failed: disk full (1 of 3 files were uploaded before it)' },
  );
  assert.equal(calls, 2);

  await assert.rejects(
    uploadSiteFilesInBatches(files, async () => {
      throw new Error('Upload failed: forbidden');
    }),
    { message: 'Upload failed: forbidden' },
  );
});

test('a file over the file limit is found before anything is sent', async () => {
  const over = file('huge.zip', SITE_UPLOAD_MAX_FILE_BYTES + 1);
  assert.deepEqual(oversizedSiteUploads([file('a', 1), over]), [over]);
  let called = false;
  await assert.rejects(
    uploadSiteFilesInBatches([file('a', 1), over], async () => {
      called = true;
      return { ok: true, files: [] };
    }),
    RangeError,
  );
  assert.equal(called, false);
});
