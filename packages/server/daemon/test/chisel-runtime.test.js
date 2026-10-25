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
