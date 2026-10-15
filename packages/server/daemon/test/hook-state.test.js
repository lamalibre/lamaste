/**
 * Lifecycle hooks (slice 2b), the panel's state: approval bound to the
 * digest, the runner installed only for the approved module, auto-approve,
 * the audit log and notifications, effects and their limits, the request
 * hook runtime refusing an unapproved set, agent jobs, and operations.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PKG = '@lamalibre/e2e-fx-server';
const MODULE = 'export default { "tunnel:down": () => ({}) };\n';
const manifest = {
  name: 'fx',
  version: '1.0.0',
  hosting: 'agent',
  agent: {},
  hooks: {
    relay: {
      entry: 'hooks/relay.mjs',
      effects: ['audit'],
      tunnel: { down: {} },
      request: [
        {
          stage: 'post-forward',
          use: 'lamaste:secret-scan',
          routes: ['GET /admin/*'],
          body: { maxBytes: 1024 },
        },
      ],
    },
  },
};

let stateDir;
let runnerCalls;
let installedEntries;
let lib;

before(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), 'lamaste-hook-state-'));
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_PKI_DIR = path.join(stateDir, 'pki');
  const pkgDir = path.join(stateDir, 'node_modules', ...PKG.split('/'));
  await mkdir(path.join(pkgDir, 'hooks'), { recursive: true });
  await writeFile(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: PKG, version: '1.0.0' }),
  );
  await writeFile(path.join(pkgDir, 'lamaste-plugin.json'), JSON.stringify(manifest));
  await writeFile(path.join(pkgDir, 'hooks', 'relay.mjs'), MODULE);

  lib = {
    ...(await import('../src/lib/plugins.js')),
    ...(await import('../src/lib/plugin-hooks.js')),
    ...(await import('../src/lib/plugin-packages.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/notifications.js')),
    ...(await import('../src/lib/hook-effects.js')),
    ...(await import('../src/lib/agent-jobs.js')),
    ...(await import('../src/lib/plugin-operations.js')),
    ...(await import('../src/lib/request-hooks.js')),
  };
  const core = await import('@lamalibre/lamaste');
  const validated = core.validateManifest(manifest);
  await lib.writePlugins({
    plugins: [
      {
        name: 'fx',
        packageName: PKG,
        version: '1.0.0',
        capabilities: [],
        hosting: 'agent',
        agent: {},
        hooks: validated.hooks,
        hooksEntrySha256: await lib.installedHookEntrySha256(PKG, validated),
        status: 'enabled',
        installedAt: new Date().toISOString(),
      },
    ],
  });
  runnerCalls = [];
  installedEntries = new Map();
  lib.setHookRunnerManagerForTests({
    async install(route, sha, bytes) {
      runnerCalls.push(['install', route, sha, bytes?.toString() ?? null]);
      installedEntries.set(route, sha);
    },
    async activate(route, sha) {
      runnerCalls.push(['activate', route, sha]);
      installedEntries.set(route, sha);
    },
    async remove(route) {
      runnerCalls.push(['remove', route]);
      installedEntries.delete(route);
    },
    async restart(route) {
      runnerCalls.push(['restart', route]);
    },
    async installedEntry(route) {
      return installedEntries.has(route) ? installedEntries.get(route) : undefined;
    },
  });
});

after(async () => {
  lib.setHookRunnerManagerForTests(null);
  await rm(stateDir, { recursive: true, force: true });
});

const actor = { actor: 'admin', certSerial: '0A1B', logger: undefined };

test('approval: pending until the shown digest is approved; the runner gets exactly the approved module', async () => {
  const plugin = await lib.findPlugin('fx');
  let status = await lib.hookStatus(plugin);
  assert.equal(status.approval.state, 'pending');
  assert.equal(status.relay.entry, 'hooks/relay.mjs');
  assert.deepEqual(status.relay.effects, ['audit']);
  assert.equal(await lib.installedVersionApproved(plugin), false);
  const refused = await lib.requestHookRuntime.hooksFor('fx');
  assert.match(refused.refuse, /not approved/);

  await assert.rejects(
    lib.approveHookSet(plugin, 'f'.repeat(64), actor),
    /changed since it was shown/,
  );
  assert.deepEqual(runnerCalls, []);

  await lib.approveHookSet(plugin, status.relay.digest, actor);
  status = await lib.hookStatus(plugin);
  assert.equal(status.approval.state, 'approved');
  assert.equal(status.approval.approvedBy, 'admin');
  assert.equal(status.runner.current, true);
  assert.deepEqual(runnerCalls, [['install', 'fx', plugin.hooksEntrySha256, MODULE]]);
  const allowed = await lib.requestHookRuntime.hooksFor('fx');
  assert.equal(allowed.hooks.length, 1);

  const audit = await lib.listAudit({ plugin: 'fx', action: 'hooks.' });
  assert.equal(audit[0].action, 'hooks.approved');
  assert.equal(audit[0].details.digest, status.relay.digest);
  assert.equal(audit[0].details.certSerial, '0A1B');

  // Reconciling at start-up finds the runner current: nothing to do.
  runnerCalls.length = 0;
  await lib.reconcileRelayHooks([plugin]);
  assert.deepEqual(runnerCalls, []);
  // …and reinstalls it when a redeploy lost it.
  installedEntries.clear();
  await lib.reconcileRelayHooks([plugin]);
  assert.equal(runnerCalls[0][0], 'install');
});

test('approval: a module changed on disk after approval is refused, not installed', async () => {
  const plugin = await lib.findPlugin('fx');
  const pkgDir = path.join(stateDir, 'node_modules', ...PKG.split('/'));
  await writeFile(path.join(pkgDir, 'hooks', 'relay.mjs'), MODULE + '// changed\n');
  installedEntries.clear();
  await assert.rejects(lib.ensureRelayHooksInstalled(plugin), /changed on disk/);
  await writeFile(path.join(pkgDir, 'hooks', 'relay.mjs'), MODULE);
});

test('runner: the hook set it holds follows an update and its revert', async () => {
  const plugin = await lib.findPlugin('fx');
  await lib.ensureRelayHooksInstalled(plugin);
  const approved = (await lib.hookStatus(plugin)).relay.digest;
  assert.equal((await lib.hookStatus(plugin)).runner.current, true);

  // An update puts the new version's module in first: the runner holds its set.
  const next = {
    digest: 'a'.repeat(64),
    entrySha256: 'b'.repeat(64),
    moduleBytes: Buffer.from('x'),
  };
  await lib.installRunnerModule('fx', next);
  assert.equal((await lib.readHookState('fx')).installedDigest, next.digest);
  assert.equal(installedEntries.get('fx'), next.entrySha256);
  // (the registry still names the installed version's set until the package is in)
  assert.equal((await lib.hookStatus(plugin)).runner.current, false);

  // Reverting points the runner back, and the state with it.
  await lib.restoreRunnerModule('fx', { digest: approved, entrySha256: plugin.hooksEntrySha256 });
  assert.equal((await lib.readHookState('fx')).installedDigest, approved);
  assert.equal(installedEntries.get('fx'), plugin.hooksEntrySha256);
  assert.equal((await lib.hookStatus(plugin)).runner.current, true);

  // Removing a runner of a plugin with no hook state records nothing.
  await lib.removeRunner('no-hooks');
  assert.equal(await lib.readHookState('no-hooks'), null);
});

test('auto-approve: off by default, audited both ways', async () => {
  assert.equal((await lib.readHookState('fx')).autoApprove, false);
  await lib.setAutoApprove('fx', true, actor);
  await lib.setAutoApprove('fx', true, actor); // no change, no entry
  await lib.setAutoApprove('fx', false, actor);
  const entries = await lib.listAudit({ plugin: 'fx', action: 'hooks.auto-approve.' });
  assert.deepEqual(
    entries.map((e) => e.action),
    ['hooks.auto-approve.disabled', 'hooks.auto-approve.enabled'],
  );
});

test('effects: declared types only, rate-limited, dropped ones audited once', async () => {
  lib.resetHookEffectLimitsForTests();
  const effects = [
    { type: 'audit', event: 'import.rejected', data: { rows: 3 } },
    { type: 'notify-admins', message: 'undeclared for this plugin' },
  ];
  await lib.performHookEffects('fx', 'request:pre-forward', effects, new Set(['audit']));
  const audited = await lib.listAudit({ plugin: 'fx', action: 'hook.import.rejected' });
  assert.equal(audited.length, 1);
  assert.equal(audited[0].actor, 'plugin:fx');
  assert.deepEqual(audited[0].details, { stage: 'request:pre-forward', rows: 3 });
  const dropped = await lib.listAudit({ plugin: 'fx', action: 'hooks.effects-dropped' });
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].details.refused, 1);
  const { notifications } = await lib.listNotifications();
  assert.equal(notifications.filter((n) => n.source === 'plugin:fx').length, 0);

  // notify-admins: 6 a minute.
  const burst = Array.from({ length: 10 }, (_, i) => ({
    type: 'notify-admins',
    message: `n${i}\nx`,
  }));
  for (const effect of burst) {
    await lib.performHookEffects('fx', 'tunnel:down', [effect], new Set(['notify-admins']));
  }
  const after = await lib.listNotifications({ unreadOnly: true });
  const mine = after.notifications.filter((n) => n.source === 'plugin:fx');
  assert.equal(mine.length, 6);
  assert.equal(mine[0].message, 'n5 x');
  assert.equal((await lib.markNotificationsRead({ all: true })) >= 6, true);
  assert.equal((await lib.listNotifications()).unread, 0);
});

test("audit: details are capped and secrets are the caller's to leave out", async () => {
  await lib.recordAudit({
    actor: 'admin',
    action: 'test.big',
    details: { long: 'y'.repeat(1000), nested: { a: { b: { c: { d: 1 } } } } },
  });
  const [entry] = await lib.listAudit({ action: 'test.big' });
  assert.equal(entry.details.long.length, 301);
  assert.equal(entry.details.nested.a.b, null); // three levels deep at most
  await assert.rejects(lib.recordAudit({ actor: 'a b', action: 'x' }), /actor/);
  await assert.rejects(lib.recordAudit({ actor: 'admin', action: 'X!' }), /action/);
});

test('agent jobs: listed for their agent, completed once, waited for, expired', async () => {
  const id = await lib.createAgentJob({
    agentLabel: 'vm1',
    plugin: 'fx',
    stage: 'install:pre-tunnel',
    input: { plugin: 'fx' },
    timeoutMs: 1000,
  });
  assert.equal((await lib.pendingAgentJobs('vm2')).length, 0);
  const [job] = await lib.pendingAgentJobs('vm1');
  assert.equal(job.id, id);
  assert.equal(job.stage, 'install:pre-tunnel');
  const waiting = lib.waitForAgentJob(id);
  assert.equal(
    await lib.completeAgentJob('vm2', id, { ok: true, decision: { ok: true } }),
    'not_found',
  );
  assert.equal(
    await lib.completeAgentJob('vm1', id, { ok: true, decision: { ok: true } }),
    'recorded',
  );
  assert.equal(
    await lib.completeAgentJob('vm1', id, { ok: true, decision: { ok: true } }),
    'not_pending',
  );
  assert.deepEqual(await waiting, { ok: true, decision: { ok: true } });

  // A job nobody reports expires at its deadline (timeout + delivery slack).
  const db = await (await import('../src/lib/state-db.js')).getStateDb();
  const late = await lib.createAgentJob({
    agentLabel: 'vm1',
    plugin: 'fx',
    stage: 'uninstall:post-teardown',
    input: {},
    timeoutMs: 1,
  });
  db.prepare('UPDATE agent_jobs SET deadline_at = ? WHERE id = ?').run(
    new Date(Date.now() + 200).toISOString(),
    late,
  );
  const result = await lib.waitForAgentJob(late);
  assert.equal(result.ok, false);
  assert.equal(result.expired, true);
});

test('operations: one per plugin, steps recorded, a stage failure fails it', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const first = await lib.startPluginOperation({
    plugin: 'fx',
    kind: 'host',
    actor: 'admin',
    params: { agentLabel: 'vm1' },
    run: async (op) => {
      await op.step('one', async () => gate);
      op.skip('two', 'not declared');
      op.warn('careful');
      return { status: 'succeeded' };
    },
  });
  assert.equal(first.operation.status, 'running');
  await assert.rejects(
    lib.startPluginOperation({
      plugin: 'fx',
      kind: 'unhost',
      actor: 'admin',
      run: async () => ({}),
    }),
    /operation in progress/,
  );
  release();
  const done = await first.done;
  assert.equal(done.status, 'succeeded');
  assert.deepEqual(
    done.steps.map((s) => [s.name, s.status]),
    [
      ['one', 'done'],
      ['two', 'skipped'],
    ],
  );
  assert.deepEqual(done.warnings, ['careful']);
  assert.deepEqual(done.params, { agentLabel: 'vm1' });

  const failed = await lib.startPluginOperation({
    plugin: 'fx',
    kind: 'unhost',
    actor: 'admin',
    run: async (op) => {
      await op.step('agent uninstall:pre-teardown', async () => {
        throw new lib.StageFailure('agent uninstall:pre-teardown refused: data not backed up');
      });
    },
  });
  const failedDone = await failed.done;
  assert.equal(failedDone.status, 'failed');
  assert.match(failedDone.error, /data not backed up/);
  assert.equal(failedDone.steps[0].status, 'failed');
  assert.equal((await lib.listPluginOperations('fx')).length, 2);
});
