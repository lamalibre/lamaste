/**
 * `lamaste-agent uninstall` refuses while the app host helper runs agent
 * halves for the agents it would remove — they would run on without a
 * tunnel — and names them and the two ways out: unhost them on the panel,
 * or `sudo lamaste-agent apphost disable --force`. Without the helper there
 * are none (disabling it removes every agent half first).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let home;
let agent;
let guard;
let uninstall;

before(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'lamaste-uninstall-guard-'));
  process.env.HOME = home;
  agent = await import('@lamalibre/lamaste/agent');
  guard = await import('../src/lib/app-host-guard.js');
  uninstall = await import('../src/commands/uninstall.js');
});

after(async () => {
  await rm(home, { recursive: true, force: true });
});

/** `routes`: route names (no owner record) or `route:label` (owned by that agent). */
const ready = (routes) => async () => ({
  state: 'ready',
  status: {
    protocol: 2,
    node: '22.13.1',
    apps: Object.fromEntries(
      routes.map((entry) => {
        const [route, label] = entry.split(':');
        const owner = label ? { package: `@lamalibre/${route}-agent`, label } : null;
        return [
          route,
          { versions: ['1.0.0'], current: '1.0.0', previous: null, unit: 'active', owner },
        ];
      }),
    ),
  },
});

/** The helper and the agents' records, replaced. */
function machine({ enabled = true, onMachine = [], records = {}, unusable = false } = {}) {
  return {
    isAppHostEnabled: async () => enabled,
    appHostStatus: unusable
      ? async () => ({
          state: 'unusable',
          reason: 'it could not be run (sudo: a password is required)',
        })
      : ready(onMachine),
    readAppHostState: async (label) => {
      const record = records[label];
      if (record === 'unreadable') throw new Error('Unexpected token');
      return { apps: Object.fromEntries((record ?? []).map((r) => [r, { version: '1.0.0' }])) };
    },
  };
}

test('no helper: nothing is installed, whatever a stale record says', async () => {
  const deps = machine({ enabled: false, records: { vm1: ['fx'] } });
  assert.deepEqual(await guard.installedAgentHalves(['vm1'], { everyAgent: true }, deps), []);
});

test('the only agent: every agent half the helper has is its own, recorded or not', async () => {
  const deps = machine({ onMachine: ['fx', 'gx'], records: { vm1: ['fx'] } });
  assert.deepEqual(await guard.installedAgentHalves(['vm1'], { everyAgent: true }, deps), [
    'fx',
    'gx',
  ]);
});

test("one of several agents: those the helper's owner records give it", async () => {
  // Owner records decide, whatever the agents' own records say.
  const owned = machine({
    onMachine: ['fx:vm2', 'gx:vm1', 'hx:vm1'],
    records: { vm1: ['fx', 'gx'], vm2: ['hx'] },
  });
  assert.deepEqual(await guard.installedAgentHalves(['vm1'], { everyAgent: false }, owned), [
    'gx',
    'hx',
  ]);
  // Without an owner record: this agent's record decides.
  const deps = machine({ onMachine: ['fx', 'gx'], records: { vm1: ['gx', 'gone'], vm2: ['fx'] } });
  assert.deepEqual(await guard.installedAgentHalves(['vm1'], { everyAgent: false }, deps), ['gx']);
  // A record the helper no longer confirms (removed with apphost disable --force) does not count.
  const cleared = machine({ onMachine: [], records: { vm1: ['gx'] } });
  assert.deepEqual(await guard.installedAgentHalves(['vm1'], { everyAgent: false }, cleared), []);
});

test('an unreadable record: owner records still decide; with a silent helper the answer is unknown', async () => {
  const deps = machine({ onMachine: ['fx', 'gx:vm2', 'hx:vm1'], records: { vm1: 'unreadable' } });
  assert.deepEqual(await guard.installedAgentHalves(['vm1'], { everyAgent: false }, deps), [
    'fx',
    'hx',
  ]);

  const silent = machine({ unusable: true, records: { vm1: ['fx'] } });
  assert.deepEqual(await guard.installedAgentHalves(['vm1'], { everyAgent: false }, silent), [
    'fx',
  ]);
  const unknown = machine({ unusable: true, records: { vm1: 'unreadable' } });
  await assert.rejects(
    guard.installedAgentHalves(['vm1'], { everyAgent: false }, unknown),
    /Cannot tell whether agent halves are installed.*sudo: a password is required/,
  );
});

test('uninstall refuses before touching anything, naming the agent halves and both ways out', async () => {
  await agent.addAgent({ label: 'vm1', panelUrl: 'https://panel.invalid', authMethod: 'p12' });
  await agent.recordAppHostApp('vm1', 'fx', '1.0.0');
  const deps = machine({ onMachine: ['fx', 'market-indicators'] });

  for (const options of [{ label: 'vm1' }, {}, { all: true }]) {
    await assert.rejects(uninstall.runUninstall(options, { appHost: deps }), (err) => {
      assert.match(err.message, /agent halves of fx, market-indicators are installed/);
      assert.match(err.message, /without a tunnel/);
      assert.match(err.message, /Unhost or uninstall those plugins on the panel/);
      assert.match(err.message, /sudo lamaste-agent apphost disable --force/);
      assert.match(err.message, /their data is kept/);
      return true;
    });
  }
  assert.ok(existsSync(agent.agentDataDir('vm1')), 'the agent is untouched');
  assert.deepEqual(
    (await agent.listAgents()).map((a) => a.label),
    ['vm1'],
  );
});
