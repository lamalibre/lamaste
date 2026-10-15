/**
 * `lamaste-server plugins purge-data|forget-data <name> --agent <label>`
 * check their arguments before the panel is asked, and `retained-data`
 * marks the records of plugins that are no longer installed — a record
 * outlives its plugin's uninstall.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRetainedDataArgs, retainedDataRows } from '../src/commands/plugins.js';

test('purge-data and forget-data: a plugin name and the agent, in either order', () => {
  assert.deepEqual(parseRetainedDataArgs('purge-data', ['fx', '--agent', 'vm1']), {
    ok: true,
    name: 'fx',
    agentLabel: 'vm1',
  });
  assert.deepEqual(parseRetainedDataArgs('forget-data', ['--agent', 'vm-2', 'fx']), {
    ok: true,
    name: 'fx',
    agentLabel: 'vm-2',
  });
});

test('purge-data and forget-data: refused before the panel is asked', () => {
  const usage = /^Usage: lamaste-server plugins purge-data <name> --agent <label>$/;
  assert.match(parseRetainedDataArgs('purge-data', []).error, usage);
  assert.match(parseRetainedDataArgs('purge-data', ['fx']).error, usage);
  assert.match(parseRetainedDataArgs('purge-data', ['--agent', 'vm1']).error, usage);
  assert.match(
    parseRetainedDataArgs('forget-data', ['fx', '--agent']).error,
    /--agent needs a value — Usage: lamaste-server plugins forget-data/,
  );
  assert.match(
    parseRetainedDataArgs('purge-data', ['fx', '--agent', '--force']).error,
    /--agent needs a value/,
  );
  assert.match(
    parseRetainedDataArgs('purge-data', ['fx', 'gx', '--agent', 'vm1']).error,
    /Unexpected argument "gx"/,
  );
  assert.match(
    parseRetainedDataArgs('purge-data', ['fx', '--agent', 'vm1', '--purge']).error,
    /Unknown option --purge/,
  );
  for (const label of ['VM1', '-vm1', 'vm1-', 'a/b', 'x'.repeat(64)]) {
    assert.equal(parseRetainedDataArgs('purge-data', ['fx', '--agent', label]).ok, false, label);
  }
});

test('retained-data: records of uninstalled plugins are marked', () => {
  const records = [
    { agentLabel: 'vm1', route: 'fx', plugin: 'fx', package: '@lamalibre/fx-agent' },
    { agentLabel: 'vm1', route: 'zx', plugin: 'zx', package: '@lamalibre/zx-agent' },
  ];
  assert.deepEqual(
    retainedDataRows(records, new Set(['fx'])).map((r) => [r.plugin, r.installed]),
    [
      ['fx', true],
      ['zx', false],
    ],
  );
});
