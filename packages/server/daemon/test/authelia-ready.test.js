/**
 * Authelia is started or restarted, then waited for until it serves
 * requests — a 200 from its health endpoint — never a fixed pause:
 * `systemctl restart` returns before the listener is up, and a caller that
 * spoke to Authelia right after (the registry credential's token request)
 * raced it (three-VM spec 43). A unit systemd reports failed ends the wait at
 * once.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { autheliaReady, reloadAuthelia, startAuthelia } from '@lamalibre/lamaste/server';

/** A systemctl whose unit is failed when `failed` is set; every call recorded. */
function fakeExec({ failed = false } = {}) {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args].join(' '));
    if (file === 'systemctl' && args[0] === 'is-failed') {
      if (failed) return { stdout: 'failed\n', stderr: '' };
      throw Object.assign(new Error('not failed'), { stdout: 'active\n' });
    }
    if (file === 'systemctl' && args[0] === 'is-active') {
      if (failed) throw Object.assign(new Error('failed'), { stdout: 'failed\n' });
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

/** Run `fn` with the global fetch answering as `health` does. */
async function withGlobalFetch(health, fn) {
  const kept = globalThis.fetch;
  globalThis.fetch = health.fetchImpl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = kept;
  }
}

test('ready once the health endpoint answers 200, asked until it does', async () => {
  const { exec } = fakeExec();
  const health = fakeHealth({ refusals: 3 });
  assert.equal(await autheliaReady(exec, { intervalMs: 1, fetchImpl: health.fetchImpl }), true);
  assert.equal(health.urls.length, 4);
  assert.ok(health.urls.every((u) => u === 'http://127.0.0.1:9091/api/health'));
});

test('not ready at the deadline, or at once when systemd reports the unit failed', async () => {
  const slow = fakeHealth({ status: 503 });
  assert.equal(
    await autheliaReady(fakeExec().exec, {
      intervalMs: 1,
      timeoutMs: 30,
      fetchImpl: slow.fetchImpl,
    }),
    false,
  );
  assert.ok(slow.urls.length > 1, 'asked again until the deadline');

  const broken = fakeHealth({ refusals: 1_000 });
  assert.equal(
    await autheliaReady(fakeExec({ failed: true }).exec, {
      intervalMs: 1,
      timeoutMs: 60_000,
      fetchImpl: broken.fetchImpl,
    }),
    false,
  );
  assert.equal(broken.urls.length, 1, 'a failed unit ends the wait at once');
});

test('a restart and a start return once Authelia serves requests', async () => {
  const restart = fakeExec();
  assert.deepEqual(
    await withGlobalFetch(fakeHealth({ refusals: 1 }), () => reloadAuthelia(restart.exec)),
    {
      active: true,
    },
  );
  assert.equal(restart.calls[0], 'sudo systemctl restart authelia');

  const start = fakeExec();
  assert.deepEqual(await withGlobalFetch(fakeHealth(), () => startAuthelia(start.exec)), {
    active: true,
  });
  assert.deepEqual(start.calls.slice(0, 2), [
    'sudo systemctl enable authelia',
    'sudo systemctl start authelia',
  ]);
});

test('a failed restart or start says so, a start with what the journal said', async () => {
  const unreachable = fakeHealth({ refusals: 1_000 });
  await assert.rejects(
    withGlobalFetch(unreachable, () => reloadAuthelia(fakeExec({ failed: true }).exec)),
    /not serving requests after restart \(not running\)/,
  );
  await assert.rejects(
    withGlobalFetch(unreachable, () => startAuthelia(fakeExec({ failed: true }).exec)),
    /not serving requests after starting \(not running\)\. Journal output:\nlevel=fatal msg="bad config"/,
  );
});
