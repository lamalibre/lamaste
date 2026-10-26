/**
 * No release takes a name away from `@lamalibre/lamaste` by accident: the
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

test('a name missing from the build is reported with its subpath', () => {
  assert.deepEqual(missingNames({ './server': ['a', 'b'], '.': ['c'] }, { './server': ['a'] }), [
    './server b',
    '. c',
  ]);
});
