/**
 * Authelia is started or restarted, then waited for until it serves
 * requests — systemd's `active` and a 200 from its health endpoint — never a
 * fixed pause: `systemctl restart` returns before the listener is up, and a
 * caller that spoke to Authelia right after (the registry credential's token
 * request) raced it (three-VM spec 43).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AUTHELIA_HEALTH_URL, reloadAuthelia, startAuthelia } from '@lamalibre/lamaste/server';

/** A systemctl that is `activating` for `activatingChecks` checks, then `active`. */
function fakeExec({ activatingChecks = 0 } = {}) {
  const calls = [];
  let checks = 0;
  const exec = async (file, args) => {
    calls.push([file, ...args].join(' '));
    if (file === 'systemctl' && args[0] === 'is-active') {
      checks += 1;
      if (checks <= activatingChecks) {
        throw Object.assign(new Error('activating'), { stdout: 'activating\n' });
      }
      return { stdout: 'active\n', stderr: '' };
    }
    if (file === 'journalctl') return { stdout: 'level=fatal msg="bad config"\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  return { exec, calls };
}

/** A health endpoint that refuses connections `refusals` times, then answers `status`. */
function fakeHealth({ refusals = 0, status = 200 } = {}) {
  const urls = [];
  return {
    urls,
    fetchImpl: async (url) => {
      urls.push(url);
      if (urls.length <= refusals) throw new TypeError('fetch failed');
      return { status };
    },
  };
}

const fast = { intervalMs: 1, timeoutMs: 2_000 };

test('a restart returns once Authelia serves requests, not when systemd has spawned it', async () => {
  const { exec, calls } = fakeExec({ activatingChecks: 2 });
  const health = fakeHealth({ refusals: 3 });
  assert.deepEqual(await reloadAuthelia(exec, { ...fast, fetchImpl: health.fetchImpl }), {
    active: true,
  });
  assert.equal(calls[0], 'sudo systemctl restart authelia');
  // Health is asked only once systemd says active, until it answers 200.
  assert.equal(health.urls.length, 4);
  assert.ok(health.urls.every((u) => u === AUTHELIA_HEALTH_URL));
  assert.equal(AUTHELIA_HEALTH_URL, 'http://127.0.0.1:9091/api/health');
});

test('a restart that never serves requests fails at the deadline', async () => {
  const { exec } = fakeExec();
  const health = fakeHealth({ status: 503 });
  await assert.rejects(
    reloadAuthelia(exec, { intervalMs: 1, timeoutMs: 30, fetchImpl: health.fetchImpl }),
    /not serving requests after restart/,
  );
});

test('a start waits the same way, and a failed one says what the journal said', async () => {
  const ok = fakeExec({ activatingChecks: 1 });
  const health = fakeHealth({ refusals: 1 });
  assert.deepEqual(await startAuthelia(ok.exec, { ...fast, fetchImpl: health.fetchImpl }), {
    active: true,
  });
  assert.deepEqual(ok.calls.slice(0, 2), [
    'sudo systemctl enable authelia',
    'sudo systemctl start authelia',
  ]);

  const failed = fakeExec({ activatingChecks: 1_000_000 });
  await assert.rejects(
    startAuthelia(failed.exec, {
      intervalMs: 1,
      timeoutMs: 30,
      fetchImpl: fakeHealth().fetchImpl,
    }),
    /not serving requests after starting\. Journal output:\nlevel=fatal msg="bad config"/,
  );
});
