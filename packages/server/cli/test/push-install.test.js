/**
 * `lamaste-server push-install`: `open` checks its arguments against the
 * window bounds the panel reports before asking it (whole minutes, within
 * the bounds, default 30), and `status` lists each machine agent's window —
 * open only while its time lies ahead; revoked agents and plugin-agent
 * certificates have none.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_WINDOW_MINUTES,
  agentWindows,
  parseOpenArgs,
} from '../src/commands/push-install.js';

const bounds = { min: 5, max: 480 };

test('open: an agent, minutes within the bounds (default 30), an optional policy', () => {
  assert.deepEqual(parseOpenArgs(['vm1'], bounds), {
    ok: true,
    label: 'vm1',
    minutes: DEFAULT_WINDOW_MINUTES,
    policyId: null,
  });
  assert.deepEqual(parseOpenArgs(['--minutes', '480', 'vm1', '--policy', 'installers'], bounds), {
    ok: true,
    label: 'vm1',
    minutes: 480,
    policyId: 'installers',
  });
  assert.equal(parseOpenArgs(['vm1', '--minutes', '5'], bounds).minutes, 5);
});

test('open: refused before the panel is asked — bounds, whole minutes, usage', () => {
  for (const minutes of ['4', '481', '30.5', '-10', 'ten', '1e2']) {
    const parsed = parseOpenArgs(['vm1', '--minutes', minutes], bounds);
    assert.equal(parsed.ok, false, minutes);
    assert.match(parsed.error, /open 5 to 480 minutes/);
  }
  assert.match(parseOpenArgs([], bounds).error, /^Usage:/);
  assert.match(parseOpenArgs(['vm1', '--minutes'], bounds).error, /--minutes needs a value/);
  assert.match(
    parseOpenArgs(['vm1', '--policy', '--minutes', '9'], bounds).error,
    /--policy needs/,
  );
  assert.match(parseOpenArgs(['vm1', 'vm2'], bounds).error, /Unexpected argument "vm2"/);
  assert.match(parseOpenArgs(['vm1', '--hours', '2'], bounds).error, /Unknown option --hours/);
  // The panel's bounds are the ones applied.
  assert.equal(parseOpenArgs(['vm1', '--minutes', '600'], { min: 5, max: 600 }).ok, true);
});

test("status: each machine agent's window, open only while its time lies ahead", () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const windows = agentWindows(
    [
      { label: 'vm2', revoked: false },
      {
        label: 'vm1',
        revoked: false,
        pushInstallEnabledUntil: '2026-10-15T12:30:00.000Z',
        pushInstallPolicy: 'default',
      },
      {
        label: 'old',
        revoked: false,
        pushInstallEnabledUntil: '2026-10-15T11:00:00.000Z',
        pushInstallPolicy: 'default',
      },
      { label: 'gone', revoked: true, pushInstallEnabledUntil: '2026-10-15T13:00:00.000Z' },
      { label: 'plugin-agent:vm1:sync', revoked: false },
    ],
    now,
  );
  assert.deepEqual(windows, [
    { label: 'old', open: false, until: null, policy: null },
    { label: 'vm1', open: true, until: '2026-10-15T12:30:00.000Z', policy: 'default' },
    { label: 'vm2', open: false, until: null, policy: null },
  ]);
});
