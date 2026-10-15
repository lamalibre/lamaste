/**
 * A plugin config reaches the agent half's service before it is
 * acknowledged (slice 3). For a route the app host helper installed
 * (apphost-state.json), the config sync writes the agent's copy, has the
 * service's copy written (`deliverPluginConfig`), and only then
 * acknowledges — so the relay keeps signing with the previous secret, which
 * the service still holds, until both copies have the new one. A caller
 * that cannot deliver (the agent daemon) leaves such a config
 * unacknowledged for the sync timer.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let home;
let agent;
let core;

const LABEL = 'vm1';

before(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'lamaste-app-plugin-delivery-'));
  process.env.HOME = home;
  agent = await import('@lamalibre/lamaste/agent');
  core = await import('@lamalibre/lamaste');
});

after(async () => {
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(path.join(home, '.lamalibre'), { recursive: true, force: true });
});

const assignment = (route, issuedAt, acknowledged = false) => ({
  route,
  port: 21000,
  secretIssuedAt: issuedAt,
  secretAcknowledged: acknowledged,
});

/** A panel and a deliverer that log every call, in order, into `calls`. */
function panel(issued, calls, deliver) {
  return {
    async fetchPluginConfig(route) {
      calls.push(['fetch', route]);
      return issued[route];
    },
    async acknowledgePluginConfig(route, issuedAt) {
      calls.push(['ack', route, issuedAt]);
    },
    ...(deliver
      ? {
          async deliverPluginConfig(route, config) {
            calls.push(['deliver', route, config.issuedAt]);
            return deliver(route, config);
          },
        }
      : {}),
  };
}

test('an apphost route: fetched, delivered to the service, then acknowledged', async () => {
  await agent.recordAppHostApp(LABEL, 'fx', '1.0.0');
  const secret = core.generateHostingSecret();
  const issued = { fx: { plugin: 'fx', port: 21000, secret, issuedAt: 't1' } };
  const calls = [];
  const delivered = [];
  const warnings = [];
  const result = await agent.syncAppPluginConfigs(
    LABEL,
    [assignment('fx', 't1')],
    panel(issued, calls, async (route, config) => {
      // The agent's own copy is written before the service's.
      assert.equal((await agent.loadAppPluginConfig(LABEL, route)).secret, config.secret);
      delivered.push(config);
      return 'delivered';
    }),
    warnings,
  );
  assert.deepEqual(calls, [
    ['fetch', 'fx'],
    ['deliver', 'fx', 't1'],
    ['ack', 'fx', 't1'],
  ]);
  assert.deepEqual(result, { fetched: ['fx'], acknowledged: ['fx'], removed: [] });
  assert.equal(delivered[0].secret, secret);
  assert.equal(delivered[0].plugin, 'fx');
  assert.deepEqual(warnings, []);
});

test('a failed delivery leaves the config unacknowledged; the next sync delivers, then acknowledges', async () => {
  await agent.recordAppHostApp(LABEL, 'fx', '1.0.0');
  const issued = {
    fx: { plugin: 'fx', port: 21000, secret: core.generateHostingSecret(), issuedAt: 't2' },
  };
  const calls = [];
  const warnings = [];
  const first = await agent.syncAppPluginConfigs(
    LABEL,
    [assignment('fx', 't2')],
    panel(issued, calls, async () => {
      throw new Error(
        'lamaste-apphost could not write the service copy: it did not finish in time',
      );
    }),
    warnings,
  );
  assert.deepEqual(first, { fetched: ['fx'], acknowledged: [], removed: [] });
  assert.deepEqual(calls, [
    ['fetch', 'fx'],
    ['deliver', 'fx', 't2'],
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /"fx" could not be synced .*did not finish in time.*retrying/);
  assert.equal((await agent.loadAppPluginConfig(LABEL, 'fx')).acknowledged, false);

  calls.length = 0;
  const second = await agent.syncAppPluginConfigs(
    LABEL,
    [assignment('fx', 't2')],
    panel(issued, calls, async () => 'delivered'),
    [],
  );
  assert.deepEqual(calls, [
    ['deliver', 'fx', 't2'],
    ['ack', 'fx', 't2'],
  ]);
  assert.deepEqual(second, { fetched: [], acknowledged: ['fx'], removed: [] });
  assert.equal((await agent.loadAppPluginConfig(LABEL, 'fx')).acknowledged, true);
});

test('a caller that cannot deliver does not acknowledge an apphost route; others are acknowledged', async () => {
  await agent.recordAppHostApp(LABEL, 'fx', '1.0.0');
  const issued = {
    fx: { plugin: 'fx', port: 21000, secret: core.generateHostingSecret(), issuedAt: 't3' },
    byhand: { plugin: 'byhand', port: 21001, secret: core.generateHostingSecret(), issuedAt: 'h1' },
  };
  const calls = [];
  const warnings = [];
  const result = await agent.syncAppPluginConfigs(
    LABEL,
    [assignment('fx', 't3'), { ...assignment('byhand', 'h1'), port: 21001 }],
    panel(issued, calls, null),
    warnings,
  );
  assert.deepEqual(calls, [
    ['fetch', 'fx'],
    ['fetch', 'byhand'],
    ['ack', 'byhand', 'h1'],
  ]);
  assert.deepEqual(result, { fetched: ['fx', 'byhand'], acknowledged: ['byhand'], removed: [] });
  assert.deepEqual(warnings, [
    'The plugin config of "fx" is acknowledged once the sync timer has delivered it to the ' +
      "agent half's service.",
  ]);
});

test('a hand-installed agent half (not in the record) is acknowledged without a delivery', async () => {
  const issued = {
    byhand: { plugin: 'byhand', port: 21000, secret: core.generateHostingSecret(), issuedAt: 'h1' },
  };
  const calls = [];
  await agent.syncAppPluginConfigs(
    LABEL,
    [assignment('byhand', 'h1')],
    panel(issued, calls, async () => assert.fail('nothing to deliver to')),
    [],
  );
  assert.deepEqual(calls, [
    ['fetch', 'byhand'],
    ['ack', 'byhand', 'h1'],
  ]);
});

test('a route the helper no longer has leaves the record and is acknowledged', async () => {
  await agent.recordAppHostApp(LABEL, 'fx', '1.0.0');
  const issued = {
    fx: { plugin: 'fx', port: 21000, secret: core.generateHostingSecret(), issuedAt: 't4' },
  };
  const calls = [];
  const result = await agent.syncAppPluginConfigs(
    LABEL,
    [assignment('fx', 't4')],
    panel(issued, calls, async () => 'not-installed'),
    [],
  );
  assert.deepEqual(result.acknowledged, ['fx']);
  assert.deepEqual(await agent.appHostRoutes(LABEL), []);
});

test('an unreadable record fails closed: nothing is delivered, nothing acknowledged', async () => {
  await agent.recordAppHostApp(LABEL, 'fx', '1.0.0');
  await writeFile(agent.appHostStatePath(LABEL), '{ not json');
  const issued = {
    fx: { plugin: 'fx', port: 21000, secret: core.generateHostingSecret(), issuedAt: 't5' },
    byhand: { plugin: 'byhand', port: 21001, secret: core.generateHostingSecret(), issuedAt: 'h5' },
  };
  const calls = [];
  const warnings = [];
  const result = await agent.syncAppPluginConfigs(
    LABEL,
    [assignment('fx', 't5'), { ...assignment('byhand', 'h5'), port: 21001 }],
    panel(issued, calls, async () => assert.fail('this agent cannot show the service is its own')),
    warnings,
  );
  // Fetched (the agent's own copy), but neither delivered nor acknowledged:
  // the relay keeps signing with the secret every service still holds.
  assert.deepEqual(calls, [
    ['fetch', 'fx'],
    ['fetch', 'byhand'],
  ]);
  assert.deepEqual(result.acknowledged, []);
  assert.equal(warnings.length, 1);
  assert.match(
    warnings[0],
    /apphost-state\.json\) could not be read.*no plugin config is delivered or acknowledged/,
  );
});

test('a route another agent on the machine records is neither delivered to nor acknowledged', async () => {
  await agent.recordAppHostApp(LABEL, 'fx', '1.0.0');
  await agent.recordAppHostApp('vm2', 'fx', '1.0.0');
  const issued = {
    fx: { plugin: 'fx', port: 21000, secret: core.generateHostingSecret(), issuedAt: 't6' },
  };
  const calls = [];
  const warnings = [];
  const result = await agent.syncAppPluginConfigs(
    LABEL,
    [assignment('fx', 't6')],
    panel(issued, calls, async () => assert.fail('not delivered to a claimed route')),
    warnings,
  );
  assert.deepEqual(calls, [['fetch', 'fx']]);
  assert.deepEqual(result.acknowledged, []);
  assert.match(warnings[0], /"fx" is also recorded by agent vm2 on this machine/);
  assert.deepEqual(await agent.appHostRouteRecordedElsewhere('vm2', 'fx'), [LABEL]);
  assert.deepEqual(await agent.appHostRouteRecordedElsewhere(LABEL, 'gx'), []);
});

test('the record is rebuilt from the routes the helper says this agent owns', async () => {
  const routes = await agent.rebuildAppHostState(LABEL, {
    fx: { current: '1.2.0', owner: { label: LABEL } },
    gx: { current: '1.0.0', owner: { label: 'vm2' } },
    hx: { current: null, owner: { label: LABEL } },
    ix: { current: '1.0.0', owner: null },
  });
  assert.deepEqual(routes, ['fx']);
  const { apps } = await agent.readAppHostState(LABEL);
  assert.deepEqual(Object.keys(apps), ['fx']);
  assert.equal(apps.fx.version, '1.2.0');
});

test('the record: routes and versions validated, written 0600, forgotten on removal', async () => {
  await agent.recordAppHostApp(LABEL, 'fx', '1.0.0');
  await agent.recordAppHostApp(LABEL, 'gx', '2.1.0-rc.1');
  assert.deepEqual(await agent.appHostRoutes(LABEL), ['fx', 'gx']);
  await assert.rejects(agent.recordAppHostApp(LABEL, '../x', '1.0.0'), /Invalid plugin route/);
  await assert.rejects(agent.recordAppHostApp(LABEL, 'fx', 'latest'), /Invalid agent half version/);
  assert.equal(await agent.forgetAppHostApp(LABEL, 'fx'), true);
  assert.equal(await agent.forgetAppHostApp(LABEL, 'fx'), false);
  const { apps } = await agent.readAppHostState(LABEL);
  assert.deepEqual(Object.keys(apps), ['gx']);
  assert.equal(apps.gx.version, '2.1.0-rc.1');
});
