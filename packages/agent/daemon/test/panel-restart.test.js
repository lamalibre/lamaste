/**
 * The panel daemon restarts itself after a plugin enable or disable. The
 * restart goes through the service manager in a detached child — array
 * arguments, no shell interpolation, `detached` + `stdio: 'ignore'`, no
 * execa cleanup, unref'd — so the daemon being stopped by that restart does
 * not cancel it. The old unload-then-load from inside the daemon left the
 * panel stopped (unload stops the caller before load runs).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DETACHED_SPAWN_OPTIONS,
  panelRestartCommand,
  restartPanelService,
  panelPlistLabel,
  panelPlistPath,
  panelSystemdUnitName,
} from '@lamalibre/lamaste/agent';

test('panelRestartCommand: systemctl --user restart on Linux, launchctl kickstart -k on macOS, unload+load fallback', () => {
  assert.deepEqual(
    panelRestartCommand('r730', { platform: 'linux', uid: 0, kickstartAvailable: false }),
    { file: 'systemctl', args: ['--user', 'restart', panelSystemdUnitName('r730')] },
  );
  assert.equal(panelSystemdUnitName('r730'), 'lamalibre-lamaste-panel-r730');

  assert.deepEqual(
    panelRestartCommand('r730', { platform: 'darwin', uid: 501, kickstartAvailable: true }),
    { file: 'launchctl', args: ['kickstart', '-k', `gui/501/${panelPlistLabel('r730')}`] },
  );
  assert.equal(panelPlistLabel('r730'), 'com.lamalibre.lamaste.panel-r730');

  const fallback = panelRestartCommand('r730', {
    platform: 'darwin',
    uid: 501,
    kickstartAvailable: false,
  });
  assert.equal(fallback.file, 'sh');
  assert.equal(fallback.args[0], '-c');
  assert.equal(fallback.args[2], panelPlistPath('r730'));
  // The script is fixed; the plist path travels as $0, never interpolated.
  assert.ok(!fallback.args[1].includes(panelPlistPath('r730')));
  assert.match(fallback.args[1], /launchctl unload "\$0"; exec launchctl load "\$0"/);
});

test('restartPanelService spawns the command detached and unrefs it', async () => {
  const calls = [];
  let unrefCalled = 0;
  const spawn = async (file, args, options) => {
    calls.push({ file, args: [...args], options });
    return {
      unref() {
        unrefCalled += 1;
      },
    };
  };
  const command = await restartPanelService('r730', spawn);
  assert.equal(calls.length, 1);
  assert.equal(unrefCalled, 1);
  assert.deepEqual(DETACHED_SPAWN_OPTIONS, {
    detached: true,
    stdio: 'ignore',
    cleanup: false,
    reject: false,
  });
  const { options } = calls[0];
  assert.equal(options.detached, true);
  assert.equal(options.stdio, 'ignore');
  assert.equal(options.cleanup, false);
  assert.equal(options.reject, false);
  assert.deepEqual({ file: calls[0].file, args: calls[0].args }, command);
  if (process.platform === 'linux') {
    assert.deepEqual(command.args, ['--user', 'restart', 'lamalibre-lamaste-panel-r730']);
    assert.ok(options.env, 'systemctl --user needs the user session environment');
  } else if (process.platform === 'darwin') {
    assert.equal(command.file, command.args[0] === 'kickstart' ? 'launchctl' : 'sh');
    assert.equal(options.env, undefined);
  }
});
