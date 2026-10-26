/**
 * Gatekeeper's management secret is compared in constant time, and nothing
 * but one string matches. Runs against the build (`npm run build`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('the management secret is compared in constant time and refused when absent', async () => {
  const { secretMatches } = await import('../dist/lib/secret.js');
  assert.equal(secretMatches('s3cret', 's3cret'), true);
  assert.equal(secretMatches('s3cre', 's3cret'), false);
  assert.equal(secretMatches(undefined, 's3cret'), false);
  assert.equal(secretMatches(['s3cret'], 's3cret'), false);
});
