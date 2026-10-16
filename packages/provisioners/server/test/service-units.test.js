/**
 * The systemd units create-lamaste writes for the relay's own Node.js
 * services: none of them leaves a core dump behind. The panel holds the CA
 * key and every plugin's installation secret, the gatekeeper its API secret
 * and cached sessions, a hook runner the application data a hook sees — a
 * core file would put any of it on disk, readable by whoever reads crash
 * dumps. `LimitCORE=0` sets the hard limit too, so the process cannot raise
 * it again.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateGatekeeperServiceUnit,
  generateHooksServiceUnit,
  generateHooksSocketUnit,
  generateServiceUnit,
} from '../src/lib/service-config.js';

const CTX = { installDir: '/opt/lamalibre/lamaste', configDir: '/etc/lamalibre/lamaste' };

/** The lines of one `[Section]` of a unit, comments and blank lines left out. */
function section(unit, name) {
  const lines = [];
  let current = null;
  for (const raw of unit.split('\n')) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) current = header[1];
    else if (current === name && line !== '' && !line.startsWith('#')) lines.push(line);
  }
  return lines;
}

test('the panel, gatekeeper and hook runner services write no core dump', () => {
  for (const [name, unit] of [
    ['panel', generateServiceUnit(CTX)],
    ['gatekeeper', generateGatekeeperServiceUnit(CTX)],
    ['hook runner', generateHooksServiceUnit(CTX)],
  ]) {
    const service = section(unit, 'Service');
    assert.deepEqual(
      service.filter((l) => l.startsWith('LimitCORE=')),
      ['LimitCORE=0'],
      `${name}: exactly one LimitCORE, in [Service]`,
    );
    for (const other of ['Unit', 'Install']) {
      assert.ok(
        !section(unit, other).some((l) => l.startsWith('LimitCORE=')),
        `${name}: not in [${other}]`,
      );
    }
  }
});

test('the hook runner socket stays a socket unit: no process, no resource limits', () => {
  const socket = generateHooksSocketUnit();
  assert.ok(section(socket, 'Socket').length > 0);
  assert.deepEqual(section(socket, 'Service'), []);
  assert.ok(!socket.includes('LimitCORE'));
});
