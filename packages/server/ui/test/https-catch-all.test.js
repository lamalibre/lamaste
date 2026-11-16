import { test } from 'node:test';
import assert from 'node:assert/strict';

import { httpsCatchAllProblem } from '../src/admin/lib/https-catch-all.js';

test('the Dashboard warns for every status but installed and not-yet-checked', () => {
  assert.equal(httpsCatchAllProblem('installed'), null);
  assert.equal(httpsCatchAllProblem(null), null);
  assert.equal(httpsCatchAllProblem(undefined), null);
  assert.match(httpsCatchAllProblem('missing'), /not enabled/);
  assert.match(httpsCatchAllProblem('changed'), /other content/);
  assert.match(httpsCatchAllProblem('unreadable'), /could not be read/);
});
