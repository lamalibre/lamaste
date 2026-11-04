/**
 * The pages' polling under the panel's rate limit: a 429 (from the web
 * client's status or the desktop's message) is never retried at once, a
 * refusal neither, anything else once; a failed refresh keeps the data it
 * had, with a note.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  failedWithoutData,
  isRateLimited,
  refreshProblemText,
  retryQuery,
} from '../src/admin/lib/query-refresh.js';

const status = (code, message = 'x') => Object.assign(new Error(message), { status: code });

test('isRateLimited: the status, or the rate limiter’s messages as the desktop passes them', () => {
  assert.equal(isRateLimited(status(429)), true);
  assert.equal(isRateLimited('Rate limit exceeded, retry in 1 minute'), true);
  assert.equal(isRateLimited(new Error('Too Many Requests')), true);
  assert.equal(isRateLimited(status(500, 'Rate limited by nobody')), false);
  assert.equal(isRateLimited('Gatekeeper is not reachable'), false);
  assert.equal(isRateLimited(null), false);
});

test('retryQuery: never a 429 or another refusal, once for the rest', () => {
  assert.equal(retryQuery(0, status(429)), false);
  assert.equal(retryQuery(0, 'Rate limit exceeded, retry in 1 minute'), false);
  assert.equal(retryQuery(0, status(404)), false);
  assert.equal(retryQuery(0, status(502)), true);
  assert.equal(retryQuery(0, 'curl: (7) Failed to connect'), true);
  assert.equal(retryQuery(1, 'curl: (7) Failed to connect'), false);
});

test('refreshProblemText and failedWithoutData: data kept beside a failed refresh', () => {
  const at = Date.UTC(2026, 10, 4, 12, 0, 0);
  const limited = { isError: true, data: { a: 1 }, error: status(429), dataUpdatedAt: at };
  assert.match(
    refreshProblemText(limited),
    /^The panel is limiting requests; this refreshes again shortly — showing what it said at /,
  );
  assert.equal(failedWithoutData(limited), false);

  const broken = { isError: true, data: [], error: new Error('boom'), dataUpdatedAt: 0 };
  assert.equal(refreshProblemText(broken), 'Could not refresh: boom');

  const never = { isError: true, data: undefined, error: new Error('boom'), dataUpdatedAt: 0 };
  assert.equal(refreshProblemText(never), null);
  assert.equal(failedWithoutData(never), true);

  const fine = { isError: false, data: {}, error: null, dataUpdatedAt: at };
  assert.equal(refreshProblemText(fine), null);
  assert.equal(failedWithoutData(fine), false);
});
