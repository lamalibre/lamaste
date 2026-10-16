/**
 * The sweep of curl config files a crash left behind: only stale ones go,
 * because the directory is shared with processes that may have just
 * written one (another lamaste-agent, the daemon, the desktop app).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CURL_CONFIG_STALE_MS, sweepStaleCurlConfigs } from '@lamalibre/lamaste/agent';

test('only curl configs older than the stale age are removed; nothing else is touched', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'curl-sweep-'));
  try {
    const now = Date.now();
    const at = (name, ageMs) => {
      const file = path.join(dir, name);
      writeFileSync(file, 'pass = "x"\n', { mode: 0o600 });
      const t = (now - ageMs) / 1000;
      utimesSync(file, t, t);
      return file;
    };
    const stale = at('.curl-config-aaaa.tmp', CURL_CONFIG_STALE_MS + 1_000);
    const live = at('.curl-config-bbbb.tmp', 2_000);
    const other = at('agents.json', CURL_CONFIG_STALE_MS * 10);
    const near = at('.curl-config-cccc.txt', CURL_CONFIG_STALE_MS * 10);
    const target = at('target.json', CURL_CONFIG_STALE_MS * 10);
    const link = path.join(dir, '.curl-config-link.tmp');
    symlinkSync(target, link);

    sweepStaleCurlConfigs(dir, now);

    assert.equal(existsSync(stale), false, 'a stale config is removed');
    assert.equal(existsSync(live), true, 'a config written moments ago is kept');
    assert.equal(existsSync(other), true, 'other files are kept');
    assert.equal(existsSync(near), true, 'a name that is not a curl config is kept');
    assert.equal(existsSync(target), true, 'a link is removed as a link, never followed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing directory is not an error', () => {
  assert.doesNotThrow(() => sweepStaleCurlConfigs(path.join(tmpdir(), 'no-such-dir-curl-sweep')));
});
