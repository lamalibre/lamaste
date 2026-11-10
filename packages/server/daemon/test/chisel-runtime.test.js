/**
 * When an authfile change restarts chisel (`authfileChangeNeedsRestart`):
 * a withdrawn grant does — so live sessions drop the binding — unless the
 * caller keeps live sessions (a port nothing routes to any more, which its
 * agent drops by itself); a chisel too old to reload its authfile restarts
 * on every change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authfileChangeNeedsRestart,
  createRestartCoalescer,
  setChiselRunningPinnedRelease,
} from '../src/lib/chisel-runtime.js';

test('a withdrawn grant restarts chisel, unless live sessions are kept', () => {
  setChiselRunningPinnedRelease(true);
  assert.equal(authfileChangeNeedsRestart({ changed: true, revoked: true }), true);
  assert.equal(
    authfileChangeNeedsRestart({ changed: true, revoked: true }, { keepLiveSessions: true }),
    false,
  );
  assert.equal(authfileChangeNeedsRestart({ changed: true, revoked: false }), false);
  assert.equal(authfileChangeNeedsRestart({ changed: false, revoked: false }), false);
});

test('a chisel that cannot reload its authfile restarts on any change, kept sessions or not', () => {
  setChiselRunningPinnedRelease(false);
  try {
    assert.equal(
      authfileChangeNeedsRestart({ changed: true, revoked: true }, { keepLiveSessions: true }),
      true,
    );
    assert.equal(authfileChangeNeedsRestart({ changed: true, revoked: false }), true);
    assert.equal(authfileChangeNeedsRestart({ changed: false, revoked: false }), false);
  } finally {
    setChiselRunningPinnedRelease(false);
  }
});

// --- Coalesced restarts -----------------------------------------------------
// A burst of revocations (three plugin uninstalls within seconds) restarted
// chisel once per revocation, until systemd's start limit left it failed and
// every tunnel dark. Restarts are now coalesced; each still starts after the
// request it answers.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function recordingRestart({ durationMs = 30, result = { ok: true }, fail } = {}) {
  const starts = [];
  const restart = async () => {
    starts.push(Date.now());
    await sleep(durationMs);
    if (fail) throw fail;
    return result;
  };
  return { starts, restart };
}

test('a burst of requests shares one restart and every caller gets its result', async () => {
  const { starts, restart } = recordingRestart({ result: { ok: true, n: 1 } });
  const request = createRestartCoalescer(restart, { settleMs: 20, minIntervalMs: 50 });
  const results = await Promise.all([request(), request(), request(), request(), request()]);
  assert.equal(starts.length, 1);
  for (const r of results) assert.deepEqual(r, { ok: true, n: 1 });
});

test('a request made while a restart runs gets a later restart, never the running one', async () => {
  const { starts, restart } = recordingRestart({ durationMs: 60 });
  const request = createRestartCoalescer(restart, { settleMs: 10, minIntervalMs: 0 });
  const first = request();
  await sleep(30); // the first restart is running now
  assert.equal(starts.length, 1);
  const askedAt = Date.now();
  const second = request();
  const third = request(); // joins the second
  await Promise.all([first, second, third]);
  assert.equal(starts.length, 2);
  assert.ok(starts[1] >= askedAt, 'the answering restart started after the request');
  assert.ok(starts[1] >= starts[0] + 60, 'it started after the running one ended');
});

test('restarts start at least the minimum interval apart', async () => {
  const { starts, restart } = recordingRestart({ durationMs: 5 });
  const request = createRestartCoalescer(restart, { settleMs: 5, minIntervalMs: 120 });
  await request();
  await request();
  await request();
  assert.equal(starts.length, 3);
  assert.ok(starts[1] - starts[0] >= 115);
  assert.ok(starts[2] - starts[1] >= 115);
});

test('a failed restart reaches every joined caller and the next request restarts again', async () => {
  const failing = recordingRestart({ result: { ok: false, error: 'start-limit-hit' } });
  const request = createRestartCoalescer(failing.restart, { settleMs: 5, minIntervalMs: 0 });
  const results = await Promise.all([request(), request()]);
  assert.deepEqual(results, [
    { ok: false, error: 'start-limit-hit' },
    { ok: false, error: 'start-limit-hit' },
  ]);
  await request();
  assert.equal(failing.starts.length, 2);

  const throwing = recordingRestart({ fail: new Error('exec failed') });
  const requestThrowing = createRestartCoalescer(throwing.restart, {
    settleMs: 5,
    minIntervalMs: 0,
  });
  const settled = await Promise.allSettled([requestThrowing(), requestThrowing()]);
  assert.deepEqual(
    settled.map((s) => s.status),
    ['rejected', 'rejected'],
  );
  await assert.rejects(requestThrowing(), /exec failed/);
  assert.equal(throwing.starts.length, 2);
});
