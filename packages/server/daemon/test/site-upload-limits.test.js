/**
 * Static site upload limits: a file may be at most 50 MiB (the panel's
 * multipart parser), a request at most 64 MiB (the panel vhosts' upload
 * location). The planner splits a selection into requests within the
 * request limit, and any file the panel accepts fits a request of its own.
 * The panel UI mirrors the core module (it ships without the core library);
 * the mirror must agree with it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as core from '@lamalibre/lamaste';
import * as ui from '../../ui/src/admin/lib/siteUpload.js';

const MIB = 1024 * 1024;
const { SITE_UPLOAD_MAX_FILE_BYTES, SITE_UPLOAD_MAX_REQUEST_BYTES, planSiteUploadBatches } = core;

/** Deterministic file sizes from a seed: many small, some near the file limit. */
function sizes(seed, count) {
  let x = seed;
  const next = () => {
    x = (x * 48271) % 2147483647;
    return x / 2147483647;
  };
  return Array.from({ length: count }, () =>
    next() < 0.1
      ? Math.floor(next() * SITE_UPLOAD_MAX_FILE_BYTES)
      : Math.floor(next() * 512 * 1024),
  );
}

test('the limits: 50 MiB a file, 64 MiB a request', () => {
  assert.equal(SITE_UPLOAD_MAX_FILE_BYTES, 50 * MIB);
  assert.equal(core.SITE_UPLOAD_MAX_REQUEST_MIB, 64);
  assert.equal(SITE_UPLOAD_MAX_REQUEST_BYTES, 64 * MIB);
});

test('a selection is split in order into requests within the request limit', () => {
  assert.deepEqual(planSiteUploadBatches([]), []);
  const small = [{ size: 10 }, { size: 20 }, { size: 30 }];
  assert.deepEqual(planSiteUploadBatches(small), [small]);

  const files = sizes(7, 400).map((size, i) => ({ i, size }));
  const batches = planSiteUploadBatches(files);
  assert.ok(batches.length > 1);
  assert.deepEqual(
    batches.flat().map((f) => f.i),
    files.map((f) => f.i),
    'every file once, in order',
  );
  for (const batch of batches) {
    // 4 KiB framing per part and 64 KiB per request, as budgeted
    const bytes = batch.reduce((sum, f) => sum + f.size + 4096, 64 * 1024);
    assert.ok(bytes <= SITE_UPLOAD_MAX_REQUEST_BYTES, `${bytes} bytes`);
  }
});

test('a file at the file limit fits a request of its own; one byte more is refused', () => {
  const largest = { size: SITE_UPLOAD_MAX_FILE_BYTES };
  assert.deepEqual(planSiteUploadBatches([{ size: 1 }, largest, largest]), [
    [{ size: 1 }, largest],
    [largest],
  ]);
  const over = { size: SITE_UPLOAD_MAX_FILE_BYTES + 1 };
  assert.throws(() => planSiteUploadBatches([{ size: 1 }, over]), RangeError);
  assert.deepEqual(core.oversizedSiteUploads([{ size: 1 }, over, largest]), [over]);
});

test('the panel UI’s mirror agrees with the core module', () => {
  assert.equal(ui.SITE_UPLOAD_MAX_FILE_BYTES, SITE_UPLOAD_MAX_FILE_BYTES);
  assert.equal(ui.SITE_UPLOAD_MAX_REQUEST_BYTES, SITE_UPLOAD_MAX_REQUEST_BYTES);
  for (const seed of [1, 2, 3, 42]) {
    const files = sizes(seed, 300).map((size) => ({ size }));
    assert.deepEqual(ui.planSiteUploadBatches(files), planSiteUploadBatches(files), `seed ${seed}`);
    assert.deepEqual(ui.oversizedSiteUploads(files), core.oversizedSiteUploads(files));
  }
});
