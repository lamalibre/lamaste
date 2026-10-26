/**
 * A redeploy (Panel Update) keeps the IP the relay was installed with.
 * Detecting it again failed on a relay installed with --dev on a private
 * address (the redeploy runs without --dev) and could rewrite panel.json's
 * `ip` away from the panel's IP certificate.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installedPanelIp } from '../src/lib/env.js';

function panelJson(content) {
  const file = join(mkdtempSync(join(tmpdir(), 'panel-ip-')), 'panel.json');
  writeFileSync(file, content);
  return file;
}

test('the installed IP, private addresses included', async () => {
  assert.equal(
    await installedPanelIp(panelJson('{"ip":"10.13.39.1","domain":"x.test"}')),
    '10.13.39.1',
  );
  assert.equal(await installedPanelIp(panelJson('{"ip":"203.0.113.7"}')), '203.0.113.7');
});

test('no install, an unreadable file or no valid IPv4: null (detect instead)', async () => {
  assert.equal(await installedPanelIp(join(tmpdir(), 'no-such-dir', 'panel.json')), null);
  assert.equal(await installedPanelIp(panelJson('{not json')), null);
  assert.equal(await installedPanelIp(panelJson('{"domain":"x.test"}')), null);
  assert.equal(await installedPanelIp(panelJson('{"ip":"300.1.1.1"}')), null);
  assert.equal(await installedPanelIp(panelJson('{"ip":"10.0.0.1; rm -rf /"}')), null);
});
