/**
 * Installing Node.js from NodeSource runs their setup script as root. It is
 * downloaded into a directory of its own (mkdtemp, 0700) — never a fixed
 * name in the shared /tmp, where another user could have put a file or a
 * link first — and that directory is gone afterwards, whatever happened.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { NODE_MAJOR, installNodeFromNodeSource } from '../src/lib/node-version.js';

let tmpRoot;

before(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'lamaste-node-version-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** The commands, recorded; `fail` names the one that fails. */
function fakeExec(fail = null) {
  const calls = [];
  const exec = async (file, args) => {
    const call = { file, args: [...args] };
    if (file === 'curl') {
      const out = args[args.indexOf('-o') + 1];
      call.dir = path.dirname(out);
      call.dirMode = (statSync(call.dir).mode & 0o777).toString(8);
      if (fail !== 'curl') writeFileSync(out, '#!/bin/bash\n');
    }
    if (file === 'bash') call.scriptExisted = existsSync(args[0]);
    calls.push(call);
    if (fail === file) throw Object.assign(new Error(`${file} failed`), { stderr: 'boom' });
    return { stdout: '', stderr: '' };
  };
  return { exec, calls };
}

test('the setup script goes into a fresh 0700 directory, runs from there, and the directory goes', async () => {
  const { exec, calls } = fakeExec();
  const lines = [];
  await installNodeFromNodeSource((line) => lines.push(line), { exec, tmpRoot });
  assert.deepEqual(
    calls.map((c) => c.file),
    ['curl', 'bash', 'apt-get'],
  );
  const [curl, bash] = calls;
  assert.equal(curl.dirMode, '700');
  assert.notEqual(curl.dir, tmpRoot);
  assert.equal(path.dirname(curl.dir), tmpRoot);
  assert.match(path.basename(curl.dir), /^lamaste-nodesource-/);
  assert.deepEqual(curl.args.slice(0, 2), [
    '-fsSL',
    `https://deb.nodesource.com/setup_${NODE_MAJOR}.x`,
  ]);
  assert.deepEqual(bash.args, [path.join(curl.dir, 'nodesource_setup.sh')]);
  assert.equal(bash.scriptExisted, true);
  assert.deepEqual(calls[2].args, ['install', '-y', 'nodejs']);
  assert.equal(existsSync(curl.dir), false, 'removed after the run');
  assert.deepEqual(readdirSync(tmpRoot), []);
  assert.equal(lines.length, 3);
});

test('a failed download or a failed setup leaves no directory behind', async () => {
  for (const fail of ['curl', 'bash']) {
    const { exec, calls } = fakeExec(fail);
    await assert.rejects(
      installNodeFromNodeSource(() => {}, { exec, tmpRoot }),
      fail === 'curl' ? /Failed to download the NodeSource setup script/ : /setup script failed/,
    );
    assert.equal(
      calls.some((c) => c.file === 'apt-get'),
      false,
      fail,
    );
    assert.deepEqual(readdirSync(tmpRoot), [], fail);
  }
});
