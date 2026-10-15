/**
 * What `sudo lamaste-agent apphost enable|disable` relies on before acting
 * as root: a lamaste-agent install no other user can change (the helper
 * root installs comes from it), and the sudoers rule — the helper only,
 * with a reset environment that never carries Node.js's own variables —
 * which visudo must accept.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const setup = await import('../src/lib/apphost-setup.js');

/** A file system of `{ path: { uid, mode } }`; realpath maps through `links`. */
function fakeFs(entries, links = {}) {
  return {
    realpath: async (p) => links[p] ?? p,
    lstat: async (p) => {
      const e = entries[p];
      if (!e) throw Object.assign(new Error(`ENOENT ${p}`), { code: 'ENOENT' });
      return e;
    },
  };
}

const ROOT_DIR = { uid: 0, mode: 0o40755 };
const ROOT_FILE = { uid: 0, mode: 0o100755 };

const globalInstall = {
  '/': ROOT_DIR,
  '/usr': ROOT_DIR,
  '/usr/lib': ROOT_DIR,
  '/usr/lib/node_modules': ROOT_DIR,
  '/usr/lib/node_modules/@lamalibre': ROOT_DIR,
  '/usr/lib/node_modules/@lamalibre/lamaste-agent': ROOT_DIR,
  '/usr/lib/node_modules/@lamalibre/lamaste-agent/scripts': ROOT_DIR,
  '/usr/lib/node_modules/@lamalibre/lamaste-agent/scripts/lamaste-apphost': ROOT_FILE,
};
const PKG = '/usr/lib/node_modules/@lamalibre/lamaste-agent';
const SOURCE = `${PKG}/scripts/lamaste-apphost`;

test('a root-owned global install is trusted, up to /', async () => {
  assert.deepEqual(await setup.untrustedPaths([PKG, SOURCE], fakeFs(globalInstall)), []);
});

test('anything another user owns or may write, anywhere up to /, is not', async () => {
  const userOwned = { ...globalInstall, [PKG]: { uid: 1000, mode: 0o40755 } };
  assert.deepEqual(await setup.untrustedPaths([PKG, SOURCE], fakeFs(userOwned)), [
    `${PKG} is owned by uid 1000, not root`,
  ]);
  const groupWritable = { ...globalInstall, '/usr/lib': { uid: 0, mode: 0o40775 } };
  assert.deepEqual(await setup.untrustedPaths([SOURCE], fakeFs(groupWritable)), [
    '/usr/lib is writable by its group or by others',
  ]);
  const worldWritableFile = { ...globalInstall, [SOURCE]: { uid: 0, mode: 0o100757 } };
  assert.match(
    (await setup.untrustedPaths([SOURCE], fakeFs(worldWritableFile))).join(),
    /lamaste-apphost is writable by its group or by others/,
  );
});

test('paths are judged where they really are (through links), each directory once', async () => {
  // npm's global bin is a link into a home directory the user owns (nvm).
  const nvm = {
    '/': ROOT_DIR,
    '/home': ROOT_DIR,
    '/home/ubuntu': { uid: 1000, mode: 0o40750 },
    '/home/ubuntu/.nvm': { uid: 1000, mode: 0o40755 },
  };
  const problems = await setup.untrustedPaths(
    ['/usr/lib/node_modules/@lamalibre/lamaste-agent'],
    fakeFs(nvm, { '/usr/lib/node_modules/@lamalibre/lamaste-agent': '/home/ubuntu/.nvm' }),
  );
  assert.deepEqual(problems, [
    '/home/ubuntu/.nvm is owned by uid 1000, not root',
    '/home/ubuntu is owned by uid 1000, not root',
  ]);
});

test('what root runs and installs: this package, the helper source, the core library', () => {
  const paths = setup.trustedSourcePaths();
  assert.ok(paths.includes(setup.HELPER_SOURCE));
  assert.ok(existsSync(setup.HELPER_SOURCE));
  assert.ok(
    paths.some((p) => existsSync(path.join(p, 'package.json'))),
    'the package directory',
  );
  assert.ok(
    paths.some((p) => /core[/\\]lib|lamaste[/\\]dist/.test(p)),
    paths.join(', '),
  );
});

test('the sudoers rule: the helper only, a reset environment, no Node.js variables', () => {
  const rule = setup.sudoersRule('ubuntu');
  const lines = rule.split('\n').filter((l) => l && !l.startsWith('#'));
  const helper = '/usr/local/sbin/lamaste-apphost';
  const denied = setup.HELPER_DENIED_ENV.join(' ');
  assert.deepEqual(lines, [
    `Defaults!${helper} env_reset`,
    `Defaults!${helper} !setenv`,
    `Defaults!${helper} env_keep -= "${denied}"`,
    `Defaults!${helper} env_delete += "${denied}"`,
    `ubuntu ALL=(root) NOPASSWD: ${helper}`,
  ]);
  for (const name of [
    'NODE_OPTIONS',
    'NODE_PATH',
    'NODE_EXTRA_CA_CERTS',
    'NODE_REDIRECT_WARNINGS',
  ]) {
    assert.ok(setup.HELPER_DENIED_ENV.includes(name), name);
  }
});

test('visudo accepts the sudoers rule', { skip: !existsSync('/usr/sbin/visudo') }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lamaste-sudoers-'));
  try {
    const file = path.join(dir, 'lamaste-apphost');
    writeFileSync(file, setup.sudoersRule('ubuntu'), { mode: 0o440 });
    execFileSync('/usr/sbin/visudo', ['-c', '-q', '-f', file], { stdio: 'pipe' });
    // …and refuses a broken one, so the check means something.
    writeFileSync(path.join(dir, 'broken'), 'ubuntu ALL=(root NOPASSWD: /bin/true\n', {
      mode: 0o440,
    });
    assert.throws(() =>
      execFileSync('/usr/sbin/visudo', ['-c', '-q', '-f', path.join(dir, 'broken')], {
        stdio: 'pipe',
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
