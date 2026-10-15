/**
 * The agent panel's systemd user unit is enabled into default.target. A user
 * manager has no multi-user.target, so the unit written before 4.3
 * (`WantedBy=multi-user.target`) got a `.wants/` link nothing pulls in and
 * never started at boot. `repairPanelServiceInstallTarget` fixes such a unit
 * and moves an enabled one's link. Runs as Linux against a stand-in
 * `systemctl` that records its arguments.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const LABEL = 'vm1';
let work;
let calls;
let service;
let unitPath;
let unitName;

async function systemctlCalls() {
  try {
    return (await readFile(calls, 'utf8')).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

before(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'lamaste-panel-unit-'));
  process.env.HOME = path.join(work, 'home');
  Object.defineProperty(process, 'platform', { value: 'linux' });

  const bin = path.join(work, 'bin');
  await mkdir(bin);
  calls = path.join(work, 'systemctl-calls');
  // `is-enabled` answers what PANEL_UNIT_STATE says, as systemctl does.
  await writeFile(
    path.join(bin, 'systemctl'),
    `#!/bin/sh\necho "$*" >> "${calls}"\nif [ "$2" = is-enabled ]; then echo "$PANEL_UNIT_STATE"; [ "$PANEL_UNIT_STATE" = enabled ]; exit $?; fi\nexit 0\n`,
  );
  await chmod(path.join(bin, 'systemctl'), 0o755);
  const agentd = path.join(bin, 'lamaste-agentd');
  await writeFile(agentd, '#!/bin/sh\n');
  await chmod(agentd, 0o755);
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  process.env.LAMALIBRE_LAMASTE_AGENTD_PATH = agentd;

  const agent = await import('@lamalibre/lamaste/agent');
  unitPath = agent.panelSystemdUnitPath(LABEL);
  unitName = agent.panelSystemdUnitName(LABEL);
  service = await import('../src/lib/panel-service.js');
});

after(async () => {
  await rm(work, { recursive: true, force: true });
});

async function writeLegacyUnit() {
  const current = await service.generatePanelServiceConfig(LABEL, 9393);
  await mkdir(path.dirname(unitPath), { recursive: true });
  await writeFile(
    unitPath,
    current.replace('WantedBy=default.target', 'WantedBy=multi-user.target'),
  );
  await rm(calls, { force: true });
}

test('a new panel unit is enabled into default.target', async () => {
  const unit = await service.generatePanelServiceConfig(LABEL, 9393);
  assert.match(unit, /^\[Install\]\nWantedBy=default\.target$/m);
  assert.doesNotMatch(unit, /multi-user\.target/);
});

test('an enabled legacy unit is rewritten and re-enabled into default.target', async () => {
  await writeLegacyUnit();
  process.env.PANEL_UNIT_STATE = 'enabled';
  assert.deepEqual(await service.repairPanelServiceInstallTarget(LABEL), {
    repaired: true,
    reenabled: true,
  });
  const unit = await readFile(unitPath, 'utf8');
  assert.match(unit, /^WantedBy=default\.target$/m);
  assert.doesNotMatch(unit, /multi-user\.target/);
  assert.deepEqual(await systemctlCalls(), [
    `--user is-enabled ${unitName}`,
    '--user daemon-reload',
    `--user reenable ${unitName}`,
  ]);

  // Idempotent: a repaired unit is left alone.
  await rm(calls, { force: true });
  assert.deepEqual(await service.repairPanelServiceInstallTarget(LABEL), {
    repaired: false,
    reenabled: false,
  });
  assert.deepEqual(await systemctlCalls(), []);
});

test('a disabled legacy unit is rewritten but stays disabled', async () => {
  await writeLegacyUnit();
  process.env.PANEL_UNIT_STATE = 'disabled';
  assert.deepEqual(await service.repairPanelServiceInstallTarget(LABEL), {
    repaired: true,
    reenabled: false,
  });
  assert.deepEqual(await systemctlCalls(), [
    `--user is-enabled ${unitName}`,
    '--user daemon-reload',
  ]);
});

test('no unit, nothing to repair', async () => {
  await rm(unitPath, { force: true });
  assert.deepEqual(await service.repairPanelServiceInstallTarget(LABEL), {
    repaired: false,
    reenabled: false,
  });
});
