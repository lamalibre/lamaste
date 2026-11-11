/**
 * The installer command the provisioner and updater run over SSH: the
 * installer comes from the hosted Feria, the version is pinned, and
 * nothing but a plain version reaches the remote shell.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installerCommand } from '../dist/installer-command.js';

test('fresh install: @lamalibre from the hosted Feria, the version pinned', () => {
  assert.equal(
    installerCommand('4.14.0'),
    'npx --yes --@lamalibre:registry=https://feria.codelama.com.tr/ @lamalibre/create-lamaste@4.14.0 --yes',
  );
});

test('update: NDJSON progress', () => {
  assert.equal(
    installerCommand('4.14.0', { json: true }),
    'npx --yes --@lamalibre:registry=https://feria.codelama.com.tr/ @lamalibre/create-lamaste@4.14.0 --json --yes',
  );
  assert.match(installerCommand('latest'), /create-lamaste@latest --yes$/);
});

test('anything but a plain version is refused', () => {
  for (const bad of ['4.14', '4.14.0; rm -rf /', '$(id)', '4.14.0 --x', '', 'next']) {
    assert.throws(() => installerCommand(bad), /Invalid installer version/, bad);
  }
});
