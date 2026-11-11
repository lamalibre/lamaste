/**
 * Starting chisel resets a failed unit first: systemd refuses `start` on a
 * unit that hit its start rate limit until the failure is reset, so a
 * start-up or the failed-unit watch could not bring it back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChiselFailed, startChisel } from '../dist/server/index.js';

function fakeExec({ failed }) {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'systemctl' && args[0] === 'is-failed') {
      if (failed) return { stdout: 'failed\n', stderr: '' };
      const err = new Error('not failed');
      err.stdout = 'active\n';
      throw err;
    }
    if (cmd === 'systemctl' && args[0] === 'is-active') return { stdout: 'active\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  return { calls, exec };
}

test('a failed chisel is reset before it is enabled and started', async () => {
  const { calls, exec } = fakeExec({ failed: true });
  assert.equal(await isChiselFailed(exec), true);
  assert.deepEqual(await startChisel(exec), { active: true });
  const sudo = calls.filter((c) => c.startsWith('sudo '));
  assert.deepEqual(sudo, [
    'sudo systemctl reset-failed chisel',
    'sudo systemctl enable chisel',
    'sudo systemctl start chisel',
  ]);
});

test('a chisel that is not failed is started without a reset', async () => {
  const { calls, exec } = fakeExec({ failed: false });
  assert.equal(await isChiselFailed(exec), false);
  await startChisel(exec);
  assert.ok(!calls.includes('sudo systemctl reset-failed chisel'));
  assert.ok(calls.includes('sudo systemctl start chisel'));
});
