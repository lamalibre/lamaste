/**
 * The failed-unit watch: a chisel that systemd left `failed` (a start rate
 * limit hit by a burst of revocation restarts) is recovered — reconciled,
 * which resets the failure and starts it — and administrators are told.
 * A chisel stopped on purpose, or held down by a failed reconciliation,
 * is left alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoverFailedChisel } from '../src/lib/chisel-reconcile.js';

const silent = { error() {}, info() {}, warn() {} };

function deps(overrides = {}) {
  const calls = { reconcile: 0, notify: [] };
  return {
    calls,
    deps: {
      isOnboarded: () => true,
      isFailClosed: async () => false,
      isChiselFailed: async () => true,
      reconcile: async () => {
        calls.reconcile += 1;
      },
      notify: async (n) => {
        calls.notify.push(n);
      },
      ...overrides,
    },
  };
}

test('a failed chisel is reconciled and administrators are notified', async () => {
  const { calls, deps: d } = deps();
  assert.equal(await recoverFailedChisel(silent, d), 'recovered');
  assert.equal(calls.reconcile, 1);
  assert.equal(calls.notify.length, 1);
  assert.equal(calls.notify[0].source, 'lamaste');
  assert.equal(calls.notify[0].level, 'warning');
});

test('a chisel that is not failed is left alone', async () => {
  const { calls, deps: d } = deps({ isChiselFailed: async () => false });
  assert.equal(await recoverFailedChisel(silent, d), 'ok');
  assert.equal(calls.reconcile, 0);
  assert.equal(calls.notify.length, 0);
});

test('a chisel held down by fail-closed is not started by the watch', async () => {
  const { calls, deps: d } = deps({ isFailClosed: async () => true });
  assert.equal(await recoverFailedChisel(silent, d), 'held-down');
  assert.equal(calls.reconcile, 0);
});

test('before onboarding the watch does nothing', async () => {
  const { calls, deps: d } = deps({ isOnboarded: () => false });
  assert.equal(await recoverFailedChisel(silent, d), 'not-onboarded');
  assert.equal(calls.reconcile, 0);
});

test('a reconciliation that fails is reported, and nobody is told it recovered', async () => {
  const { calls, deps: d } = deps({
    reconcile: async () => {
      throw new Error('authfile could not be written');
    },
  });
  await assert.rejects(recoverFailedChisel(silent, d), /authfile could not be written/);
  assert.equal(calls.notify.length, 0);
});
