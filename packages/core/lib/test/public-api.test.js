/**
 * No release within a major takes a name away from `@lamalibre/lamaste`.
 *
 * 4.7.0's first build dropped two `./server` exports that serverd 4.6.0
 * imports; serverd's `^4.6.0` range resolves core 4.7, so a 4.6 relay
 * installed or redeployed after 4.7 shipped would not have started. The
 * build must export every name `public-api.json` (the latest release's)
 * holds — see scripts/public-api.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SNAPSHOT, exportedNames, missingNames } from '../scripts/public-api.mjs';

test('the build exports every name of the latest release', () => {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  assert.deepEqual(missingNames(snapshot, exportedNames()), []);
});

test('the deprecated 4.6 access-control exports are still there for a 4.6 serverd', () => {
  const server = exportedNames()['./server'] ?? [];
  assert.ok(server.includes('updateAutheliaAccessControl'));
  assert.ok(server.includes('syncAllAccessControl'));
});

test('a name missing from the build is reported with its subpath', () => {
  assert.deepEqual(missingNames({ './server': ['a', 'b'], '.': ['c'] }, { './server': ['a'] }), [
    './server b',
    '. c',
  ]);
});
