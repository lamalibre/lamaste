/**
 * The sync's app jobs (slice 3) and the config delivery, with the helper,
 * the panel and npm replaced: the helper must be enabled and answer before
 * anything is fetched; the tarball's integrity is checked before the helper
 * sees it; the relay's signature goes to the helper first on its stdin, and
 * a job without one never reaches it; the token and the config travel on
 * stdin, never as arguments; a failure is one line without secrets — and is
 * left for the relay to undo with a signed job; apphost-state.json follows
 * the jobs.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let home;
let agent;
let core;
let jobs;
let relayKey;

const LABEL = 'vm1';
const ROUTE = 'fx';
const TOKEN = 'feria_tok_0123456789abcdefSECRET';
const SECRET = 'ab'.repeat(32);

before(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'lamaste-app-host-jobs-'));
  process.env.HOME = home;
  agent = await import('@lamalibre/lamaste/agent');
  core = await import('@lamalibre/lamaste');
  jobs = await import('../src/lib/app-host-jobs.js');
  relayKey = await core
    .createRelaySigner(path.join(home, 'relay-signing-key.json'), { create: true })
    .current();
  await agent.saveAppPluginConfig(LABEL, {
    plugin: ROUTE,
    port: 21000,
    secret: SECRET,
    issuedAt: 't1',
    fetchedAt: new Date().toISOString(),
    acknowledged: true,
  });
});

after(async () => {
  await rm(home, { recursive: true, force: true });
});

const TGZ = Buffer.from('a package tarball');
const integrity = (bytes) => `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`;

const spec = (overrides = {}) => ({
  package: '@lamalibre/fx-agent',
  version: '1.0.0',
  integrity: integrity(TGZ),
  service: { entry: 'dist/agentd.js', memoryMax: '512M' },
  systemPackages: ['sqlite3'],
  ...overrides,
});

const PKG = '@lamalibre/fx-agent';

/** An app job as the sync hands it on: with the relay's signature over it. */
function job(kind, fields, route = ROUTE) {
  const base = {
    id: crypto.randomUUID(),
    route,
    kind,
    timeoutMs: 60_000,
    deadlineAt: new Date(Date.now() + 120_000).toISOString(),
    ...(kind === 'app-install' ? {} : { package: PKG }),
    ...fields,
  };
  const payload =
    kind === 'app-install'
      ? { spec: base.spec }
      : kind === 'app-activate'
        ? { version: base.version, package: base.package }
        : { purge: base.purge, package: base.package };
  const signature = core.signAppJob(
    {
      agent: LABEL,
      route,
      jobId: base.id,
      kind,
      payload,
      issuedAt: new Date().toISOString(),
      expiresAt: base.deadlineAt,
    },
    relayKey,
  );
  return { ...base, signature };
}

/** The first line of the helper's stdin: the job's signature. */
const signatureLine = (j) => `${JSON.stringify(j.signature)}\n`;

const ok = (stdout) => ({ exitCode: 0, stdout, stderr: '', timedOut: false });
const failed = (stderr, exitCode = 1) => ({ exitCode, stdout: '', stderr, timedOut: false });
const READY = { state: 'ready', status: { protocol: 2, node: '22.13.1', apps: {} } };

/** A fake helper that records its calls and answers from `answers[command]`. */
function fakeHelper(answers = {}) {
  const calls = [];
  return {
    calls,
    runAppHost: async (args, options = {}) => {
      calls.push({ args, input: options.input });
      const answer = answers[args[0]];
      return typeof answer === 'function'
        ? answer(args, options)
        : (answer ?? ok(JSON.stringify({ ok: true, version: '1.0.0', unit: 'active' })));
    },
  };
}

function handlers(overrides = {}) {
  const helper = fakeHelper(overrides.answers);
  const packed = [];
  const h = jobs.createAppJobHandlers(
    LABEL,
    { panelUrl: 'https://panel.invalid' },
    {
      appHostStatus: async () => READY,
      isAppHostEnabled: async () => true,
      runAppHost: helper.runAppHost,
      fetchRegistryCredential: async () => ({
        registryUrl: 'https://feria.example/',
        scope: '@lamalibre',
        token: TOKEN,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        tokenId: 'tok-1',
      }),
      packPackage: async (name, version, npmrc, timeoutMs) => {
        packed.push({ name, version, npmrc, timeoutMs });
        return TGZ;
      },
      ...overrides.deps,
    },
  );
  return { h, helper, packed };
}

const state = async () => agent.readAppHostState(LABEL);

test('install: helper ready, pinned tarball piped with its spec, config handed over, state recorded', async () => {
  const outcome = JSON.stringify({ ok: true, version: '1.0.0', unit: 'active' });
  let lockedDuringConfig = null;
  const { h, helper, packed } = handlers({
    answers: {
      // The service's copy is written under the agent lock converge takes
      // to fetch and acknowledge configs, after the route is recorded.
      config: async () => {
        lockedDuringConfig =
          (await stat(path.join(agent.agentDataDir(LABEL), 'agent.lock')).catch(() => null)) !==
            null && (await state()).apps[ROUTE]?.version === '1.0.0';
        return ok(outcome);
      },
    },
  });
  const installJob = job('app-install', { spec: spec() });
  const result = await h.install(installJob);
  assert.deepEqual(result, { ok: true, app: { version: '1.0.0', unit: 'active' } });
  assert.equal(lockedDuringConfig, true);

  assert.equal(packed.length, 1);
  assert.equal(packed[0].name, '@lamalibre/fx-agent');
  assert.equal(packed[0].version, '1.0.0');
  assert.deepEqual(packed[0].npmrc, {
    registryUrl: 'https://feria.example/',
    token: TOKEN,
    scope: '@lamalibre',
  });

  assert.deepEqual(
    helper.calls.map((c) => c.args),
    [
      ['install', LABEL, ROUTE, '1.0.0', spec().integrity],
      ['config', LABEL, ROUTE],
    ],
  );
  const [installCall, configCall] = helper.calls;
  // stdin: the relay's signature, the service spec, the tarball.
  const first = installCall.input.indexOf(0x0a);
  assert.equal(installCall.input.subarray(0, first + 1).toString(), signatureLine(installJob));
  const rest = installCall.input.subarray(first + 1);
  const newline = rest.indexOf(0x0a);
  assert.deepEqual(JSON.parse(rest.subarray(0, newline).toString()), {
    package: '@lamalibre/fx-agent',
    service: { entry: 'dist/agentd.js', memoryMax: '512M' },
    systemPackages: ['sqlite3'],
  });
  assert.ok(rest.subarray(newline + 1).equals(TGZ));
  assert.equal(configCall.input.includes('"envelope"'), false, 'config is not signed');
  const handed = JSON.parse(configCall.input);
  assert.equal(handed.plugin, ROUTE);
  assert.equal(handed.secret, SECRET);
  for (const call of helper.calls) {
    assert.ok(!call.args.some((a) => a.includes(TOKEN) || a.includes(SECRET)), 'never an argument');
  }

  const recorded = await state();
  assert.equal(recorded.apps[ROUTE].version, '1.0.0');
  assert.equal(((await stat(agent.appHostStatePath(LABEL))).mode & 0o777).toString(8), '600');
  assert.ok(core.AgentJobResultSchema.safeParse(result).success);
});

test('install: a tarball that does not match the pinned integrity never reaches the helper', async () => {
  const { h, helper } = handlers({ deps: { packPackage: async () => Buffer.from('tampered') } });
  const result = await h.install(job('app-install', { spec: spec() }));
  assert.equal(result.ok, false);
  assert.match(
    result.error,
    /does not match the integrity the panel pinned; nothing was installed/,
  );
  assert.deepEqual(helper.calls, []);
});

test('install: without the helper it fails at once with the remedy; an unusable helper says why', async () => {
  const absent = handlers({ deps: { appHostStatus: async () => ({ state: 'absent' }) } });
  assert.deepEqual(await absent.h.install(job('app-install', { spec: spec() })), {
    ok: false,
    error: jobs.HELPER_NOT_ENABLED,
  });
  assert.equal(absent.packed.length, 0, 'nothing fetched');

  const unusable = handlers({
    deps: {
      appHostStatus: async () => ({
        state: 'unusable',
        reason: 'it could not be run (sudo: a password is required)',
      }),
    },
  });
  const result = await unusable.h.install(job('app-install', { spec: spec() }));
  assert.match(
    result.error,
    /did not answer: it could not be run \(sudo: a password is required\)/,
  );

  const old = handlers({
    deps: {
      appHostStatus: async () => ({
        state: 'ready',
        status: { protocol: 1, node: '22.13.1', apps: {} },
      }),
    },
  });
  assert.match(
    (await old.h.install(job('app-install', { spec: spec() }))).error,
    /protocol 1; this agent needs 2/,
  );
});

test('install: waits for the plugin config; the public registry when the panel brokers none', async () => {
  const waiting = handlers({ deps: { loadPluginConfig: async () => null } });
  const deferred = await waiting.h.install(job('app-install', { spec: spec() }));
  assert.equal(deferred.deferred, true);
  assert.match(deferred.reason, /plugin config of "fx" has not arrived/);
  assert.equal(waiting.packed.length, 0);

  const pub = handlers({ deps: { fetchRegistryCredential: async () => null } });
  assert.equal((await pub.h.install(job('app-install', { spec: spec() }))).ok, true);
  assert.equal(pub.packed[0].npmrc, undefined);
});

test('install: npm and helper failures are one line without the token', async () => {
  const npmError = Object.assign(new Error('Command failed with exit code 1'), {
    exitCode: 1,
    stderr:
      'npm notice\n' +
      `npm error code E401\nnpm error 401 Unauthorized - GET https://feria.example/@lamalibre%2ffx-agent - token ${TOKEN} expired\n` +
      `npm error //feria.example/:_authToken=${TOKEN}\n` +
      'npm error A complete log of this run can be found in: /home/x/.npm/_logs/1.log\n',
  });
  const npm = handlers({
    deps: {
      packPackage: async () => {
        throw npmError;
      },
    },
  });
  const result = await npm.h.install(job('app-install', { spec: spec() }));
  assert.equal(result.ok, false);
  assert.ok(!result.error.includes(TOKEN), result.error);
  assert.ok(!/\n/.test(result.error));
  assert.match(
    result.error,
    /^npm could not fetch @lamalibre\/fx-agent@1\.0\.0: code E401; 401 Unauthorized/,
  );

  const refused = handlers({
    answers: {
      install: failed(
        'lamaste-apphost: the agent package must be bundled, but it declares dependencies\n',
        2,
      ),
    },
  });
  assert.deepEqual(await refused.h.install(job('app-install', { spec: spec() })), {
    ok: false,
    error:
      'lamaste-apphost could not install @lamalibre/fx-agent@1.0.0: the agent package must be bundled, but it declares dependencies',
  });

  const credential = handlers({
    deps: {
      fetchRegistryCredential: async () => {
        throw new Error('The panel refused to broker a registry credential (HTTP 429)');
      },
    },
  });
  assert.match(
    (await credential.h.install(job('app-install', { spec: spec() }))).error,
    /did not broker a registry credential for @lamalibre\/fx-agent@1\.0\.0: .*HTTP 429/,
  );
});

test('npmFailure: credentials are removed wherever they appear', () => {
  const err = {
    exitCode: 1,
    stderr: `npm error fetch https://user:pass@feria.example/x Bearer ${TOKEN} password=hunter2\n`,
  };
  const line = jobs.npmFailure(err, [TOKEN]);
  assert.ok(
    !line.includes(TOKEN) && !line.includes('hunter2') && !line.includes('user:pass'),
    line,
  );
  assert.equal(jobs.npmFailure({ timedOut: true, stderr: '' }), 'npm did not finish in time');
  assert.equal(jobs.npmFailure({ exitCode: 1, stderr: 'garbage' }), 'npm exited with status 1');
  assert.equal(
    jobs.npmFailure(new Error('npm pack did not report the tarball it wrote')),
    'npm pack did not report the tarball it wrote',
  );
});

test('activate: switches through the helper and records the version', async () => {
  const { h, helper } = handlers({
    answers: { activate: ok(JSON.stringify({ ok: true, version: '0.9.0', unit: 'active' })) },
  });
  const activateJob = job('app-activate', { version: '0.9.0' });
  const result = await h.activate(activateJob);
  assert.deepEqual(result, { ok: true, app: { version: '0.9.0', unit: 'active' } });
  assert.deepEqual(helper.calls[0].args, ['activate', LABEL, ROUTE, '0.9.0']);
  assert.equal(helper.calls[0].input, signatureLine(activateJob));
  assert.equal((await state()).apps[ROUTE].version, '0.9.0');

  const missing = handlers({
    answers: {
      activate: failed('lamaste-apphost: version 0.8.0 of fx is not kept on this agent\n'),
    },
  });
  assert.deepEqual(await missing.h.activate(job('app-activate', { version: '0.8.0' })), {
    ok: false,
    error:
      'lamaste-apphost could not activate 0.8.0 of "fx": version 0.8.0 of fx is not kept on this agent',
  });
  const disabled = handlers({ deps: { isAppHostEnabled: async () => false } });
  assert.deepEqual(await disabled.h.activate(job('app-activate', { version: '1.0.0' })), {
    ok: false,
    error: jobs.HELPER_NOT_ENABLED,
  });
});

test('remove: through the helper (with --purge only when asked); the route leaves the state', async () => {
  await agent.recordAppHostApp(LABEL, ROUTE, '1.0.0');
  const absent = JSON.stringify({ ok: true, version: null, unit: 'absent' });
  const { h, helper } = handlers({ answers: { remove: ok(absent) } });
  const removeJob = job('app-remove', { purge: false });
  assert.deepEqual(await h.remove(removeJob), {
    ok: true,
    app: { version: null, unit: 'absent' },
  });
  assert.deepEqual(helper.calls[0].args, ['remove', LABEL, ROUTE]);
  assert.equal(helper.calls[0].input, signatureLine(removeJob));
  assert.equal((await state()).apps[ROUTE], undefined);
  await h.remove(job('app-remove', { purge: true }));
  assert.deepEqual(helper.calls[1].args, ['remove', LABEL, ROUTE, '--purge']);

  // Without the helper nothing of the agent half is left to stop — but its
  // data cannot be purged.
  await agent.recordAppHostApp(LABEL, ROUTE, '1.0.0');
  const gone = handlers({ deps: { isAppHostEnabled: async () => false } });
  assert.deepEqual(await gone.h.remove(job('app-remove', { purge: false })), {
    ok: true,
    app: { version: null, unit: 'absent' },
  });
  assert.equal((await state()).apps[ROUTE], undefined);
  assert.match((await gone.h.remove(job('app-remove', { purge: true }))).error, /cannot be purged/);
  assert.deepEqual(gone.helper.calls, []);
});

test('the sync runs the handlers through runAgentJobs and reports valid results', async () => {
  const reports = [];
  const { h } = handlers();
  const listed = [job('app-install', { spec: spec() }), job('app-remove', { purge: false })];
  const warnings = [];
  const parsed = agent.parseAgentJobs(listed, warnings);
  const outcome = await agent.runAgentJobs(
    LABEL,
    parsed,
    { reportJobResult: async (id, result) => reports.push([id, result]) },
    warnings,
    { appJobs: h },
  );
  assert.deepEqual(
    outcome.ran,
    listed.map((j) => j.id),
  );
  assert.deepEqual(warnings, []);
  for (const [, result] of reports) assert.ok(core.AgentJobResultSchema.safeParse(result).success);
});

test('deliverer: config on stdin; not installed is not an error; a failure throws', async () => {
  const config = await agent.loadAppPluginConfig(LABEL, ROUTE);
  const helper = fakeHelper();
  const deliverer = jobs.createPluginConfigDeliverer(LABEL, {
    isAppHostEnabled: async () => true,
    runAppHost: helper.runAppHost,
  });
  assert.equal(await deliverer.deliver(ROUTE, config), 'delivered');
  assert.deepEqual(helper.calls[0].args, ['config', LABEL, ROUTE]);
  assert.equal(JSON.parse(helper.calls[0].input).secret, SECRET);
  assert.deepEqual(deliverer.delivered, [ROUTE]);

  const notInstalled = jobs.createPluginConfigDeliverer(LABEL, {
    isAppHostEnabled: async () => true,
    runAppHost: async () => failed('lamaste-apphost: the agent half of fx is not installed\n', 3),
  });
  assert.equal(await notInstalled.deliver(ROUTE, config), 'not-installed');
  const disabled = jobs.createPluginConfigDeliverer(LABEL, { isAppHostEnabled: async () => false });
  assert.equal(await disabled.deliver(ROUTE, config), 'not-installed');
  const broken = jobs.createPluginConfigDeliverer(LABEL, {
    isAppHostEnabled: async () => true,
    runAppHost: async () => failed('sudo: a password is required\n'),
  });
  await assert.rejects(broken.deliver(ROUTE, config), (err) => {
    assert.match(err.message, /could not be run \(sudo: a password is required\)/);
    assert.ok(!err.message.includes(SECRET));
    return true;
  });
});

// ---------------------------------------------------------------------------
// Several agents on one machine; an install that cannot be finished
// ---------------------------------------------------------------------------

const readyWith = (apps) => async () => ({
  state: 'ready',
  status: { protocol: 2, node: '22.13.1', apps },
});

test('install: a route the helper says another agent owns is refused before anything is fetched', async () => {
  const { h, helper, packed } = handlers({
    deps: {
      appHostStatus: readyWith({
        [ROUTE]: {
          versions: ['1.0.0'],
          current: '1.0.0',
          previous: null,
          unit: 'active',
          owner: { package: '@lamalibre/fx-agent', label: 'vm2' },
        },
      }),
    },
  });
  const result = await h.install(job('app-install', { spec: spec() }));
  assert.equal(result.ok, false);
  assert.match(result.error, /belongs to agent "vm2" \(@lamalibre\/fx-agent\), not "vm1"/);
  assert.equal(packed.length, 0);
  assert.deepEqual(helper.calls, []);
});

test("app jobs: one without the relay's signature never reaches the helper", async () => {
  const { h, helper, packed } = handlers();
  const unsigned = (j) => {
    const rest = { ...j };
    delete rest.signature;
    return rest;
  };
  for (const result of [
    await h.install(unsigned(job('app-install', { spec: spec() }))),
    await h.activate(unsigned(job('app-activate', { version: '1.0.0' }))),
    await h.remove(unsigned(job('app-remove', { purge: true }))),
    await h.remove({ ...job('app-remove', { purge: true }), signature: { envelope: 1 } }),
  ]) {
    assert.equal(result.ok, false);
    assert.match(result.error, /no signature of the relay/);
  }
  assert.equal(packed.length, 0);
  assert.deepEqual(helper.calls, []);
});

test("app jobs: a route another agent's record lists is left alone", async () => {
  await agent.recordAppHostApp('vm2', 'gx', '1.0.0');
  const { h, helper, packed } = handlers();
  const theirs = (kind, fields) => job(kind, fields, 'gx');
  for (const result of [
    await h.install(theirs('app-install', { spec: spec() })),
    await h.activate(theirs('app-activate', { version: '1.0.0' })),
    await h.remove(theirs('app-remove', { purge: true })),
  ]) {
    assert.equal(result.ok, false);
    assert.match(result.error, /"gx" on this machine belongs to agent vm2, not "vm1"/);
  }
  assert.equal(packed.length, 0);
  assert.deepEqual(helper.calls, []);
  await agent.forgetAppHostApp('vm2', 'gx');
});

test('install: a config that cannot be handed over is reported, left for the relay to undo', async () => {
  // The helper runs only signed jobs, and the agent holds none for an undo:
  // the relay, which recovers from every install it dispatched, sends the
  // signed removal (or, for an update, the activation of the version before).
  const { h, helper } = handlers({
    answers: { config: failed('lamaste-apphost: systemctl start exited with status 1: boom\n') },
  });
  const result = await h.install(job('app-install', { spec: spec() }));
  assert.equal(result.ok, false);
  assert.equal(
    result.error,
    '@lamalibre/fx-agent@1.0.0 was installed, but lamaste-apphost could not hand "fx" its plugin config: systemctl start exited with status 1: boom',
  );
  assert.deepEqual(
    helper.calls.map((c) => c.args.slice(0, 3)),
    [
      ['install', LABEL, ROUTE],
      ['config', LABEL, ROUTE],
    ],
  );
  // Recorded as installed: converge delivers the next config, and the
  // relay's removal forgets it.
  assert.equal((await state()).apps[ROUTE].version, '1.0.0');
  const removal = handlers({
    answers: { remove: ok(JSON.stringify({ ok: true, version: null, unit: 'absent' })) },
  });
  assert.equal((await removal.h.remove(job('app-remove', { purge: false }))).ok, true);
  assert.equal((await state()).apps[ROUTE], undefined);
});

test('an unreadable record is rebuilt from the helper: the routes its owner records give this agent', async () => {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(agent.appHostStatePath(LABEL), '{ broken');
  const apps = {
    fx: {
      versions: ['1.2.0'],
      current: '1.2.0',
      previous: null,
      unit: 'active',
      owner: { package: '@lamalibre/fx-agent', label: LABEL },
    },
    gx: {
      versions: ['1.0.0'],
      current: '1.0.0',
      previous: null,
      unit: 'active',
      owner: { package: '@lamalibre/gx-agent', label: 'vm2' },
    },
  };
  assert.deepEqual(await jobs.repairAppHostRecord(LABEL, { appHostStatus: readyWith(apps) }), [
    'fx',
  ]);
  assert.deepEqual(Object.keys((await state()).apps), ['fx']);
  assert.equal((await state()).apps.fx.version, '1.2.0');
  // Readable: left alone.
  assert.equal(await jobs.repairAppHostRecord(LABEL, { appHostStatus: readyWith({}) }), null);

  // The helper does not answer: nothing to prove ownership with — left unreadable (fail closed).
  await writeFile(agent.appHostStatePath(LABEL), '{ broken');
  const unusable = async () => ({ state: 'unusable', reason: 'sudo: a password is required' });
  assert.equal(await jobs.repairAppHostRecord(LABEL, { appHostStatus: unusable }), null);
  await assert.rejects(agent.readAppHostState(LABEL));
  // No helper at all: nothing of this agent's can be installed — an empty record.
  assert.deepEqual(
    await jobs.repairAppHostRecord(LABEL, { appHostStatus: async () => ({ state: 'absent' }) }),
    [],
  );
  assert.deepEqual((await state()).apps, {});
});
