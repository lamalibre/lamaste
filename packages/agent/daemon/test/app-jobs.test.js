/**
 * App jobs on the agent (slice 3): the relay's `agentJobs` carry
 * `app-install`, `app-activate` and `app-remove` beside the 2b hook jobs,
 * each with the relay's signature over it. The sync validates them
 * strictly — a job and its signature must describe the same work, and one
 * without a signature is reported failed, never run — hands them to the
 * caller's handlers (the agent CLI, through the app host helper), and
 * reports what the handlers answer; without handlers an app job stays
 * pending. A result the relay did not take is reported again, the job not
 * run again: the helper runs a signed job once.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let home;
let agent;
let core;
let relayKey;

const LABEL = 'vm1';

before(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'lamaste-app-jobs-'));
  process.env.HOME = home;
  agent = await import('@lamalibre/lamaste/agent');
  core = await import('@lamalibre/lamaste');
  relayKey = await core
    .createRelaySigner(path.join(home, 'relay-signing-key.json'), { create: true })
    .current();
});

after(async () => {
  await rm(home, { recursive: true, force: true });
});

const spec = {
  package: '@lamalibre/fx-agent',
  version: '1.0.0',
  integrity: `sha512-${Buffer.alloc(64, 7).toString('base64')}`,
  service: { entry: 'dist/agentd.js', memoryMax: null },
  systemPackages: ['sqlite3'],
};

const PKG = '@lamalibre/fx-agent';

const job = (kind, fields, extra = {}) => ({
  id: crypto.randomUUID(),
  route: 'fx',
  kind,
  timeoutMs: 1000,
  deadlineAt: new Date(Date.now() + 60_000).toISOString(),
  ...fields,
  ...extra,
});

/** The payload the relay signs for a listed app job. */
function payloadOf(j) {
  switch (j.kind) {
    case 'app-install':
      return { spec: j.spec };
    case 'app-activate':
      return { version: j.version, package: j.package };
    default:
      return { purge: j.purge, package: j.package };
  }
}

/** `j` with the relay's signature over it, as agent-config lists it (`over` changes what is signed). */
function signed(j, over = {}) {
  const signature = core.signAppJob(
    {
      agent: LABEL,
      route: j.route,
      jobId: j.id,
      kind: j.kind,
      payload: payloadOf(j),
      issuedAt: new Date(Date.parse(j.deadlineAt) - 60_000).toISOString(),
      expiresAt: j.deadlineAt,
      ...over,
    },
    relayKey,
  );
  return { ...j, signature };
}

const install = (extra) => signed(job('app-install', { spec }, extra));
const activate = (extra) => signed(job('app-activate', { version: '1.0.0', package: PKG }, extra));
const remove = (extra) => signed(job('app-remove', { purge: false, package: PKG }, extra));

function recorder() {
  const reports = [];
  return {
    reports,
    reporter: { reportJobResult: async (id, result) => reports.push([id, result]) },
  };
}

test('parse: the app kinds validate, each timeout capped at its kind', () => {
  const warnings = [];
  const jobs = agent.parseAgentJobs(
    [
      install({ timeoutMs: 10_000_000 }),
      activate({ timeoutMs: 10_000_000 }),
      remove({ timeoutMs: 10_000_000, purge: true }),
      job('hook', {
        stage: 'install:pre-tunnel',
        input: { plugin: 'fx' },
        timeoutMs: 10_000_000,
      }),
    ],
    warnings,
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    jobs.map((j) => [j.kind, j.timeoutMs]),
    [
      ['app-install', core.AGENT_APP_JOB_TIMEOUTS.install],
      ['app-activate', core.AGENT_APP_JOB_TIMEOUTS.activate],
      ['app-remove', core.AGENT_APP_JOB_TIMEOUTS.remove],
      ['hook', 300_000],
    ],
  );
  assert.deepEqual(jobs[0].spec, spec);
  assert.equal(jobs[1].version, '1.0.0');
  assert.equal(jobs[1].package, PKG);
  assert.equal(jobs[2].purge, true);
  assert.equal(jobs[2].package, PKG);
  for (const j of jobs.slice(0, 3)) {
    assert.deepEqual(Object.keys(j.signature).sort(), ['envelope', 'sig']);
  }
});

test('parse: an app job without a signature that matches it is refused, never runnable', () => {
  const unsigned = { ...install() };
  delete unsigned.signature;
  const base = job('app-remove', { purge: false, package: PKG });
  const otherJob = { ...signed(base), id: crypto.randomUUID() };
  const cases = [
    [unsigned, /did not sign this app-install job/],
    [{ ...activate(), signature: { envelope: 'e30', sig: 'x' } }, /malformed/],
    [{ ...activate(), signature: 'not an object' }, /malformed/],
    [otherJob, /does not match the relay's signature/],
    [signed(base, { route: 'gx' }), /does not match/],
    [signed(base, { payload: { purge: true, package: PKG } }), /does not match/],
    [
      signed(base, { payload: { purge: false, package: '@lamalibre/other-agent' } }),
      /does not match/,
    ],
    [
      signed(base, { kind: 'app-activate', payload: { version: '1.0.0', package: PKG } }),
      /does not match/,
    ],
    [
      signed(base, { expiresAt: new Date(Date.parse(base.deadlineAt) + 1000).toISOString() }),
      /does not match/,
    ],
  ];
  const warnings = [];
  const jobs = agent.parseAgentJobs(
    cases.map(([j]) => j),
    warnings,
  );
  assert.deepEqual(warnings, [], 'their own fields are valid: refused, not ignored');
  assert.equal(jobs.length, cases.length);
  for (const [i, parsed] of jobs.entries()) {
    assert.equal(parsed.kind, 'refused', `case ${i}`);
    assert.equal(parsed.id, cases[i][0].id);
    assert.match(parsed.reason, cases[i][1], `case ${i}`);
    assert.equal(parsed.signature, undefined);
  }
  assert.equal(jobs[0].jobKind, 'app-install');
  // A hook job carries no signature: the helper never sees one.
  const hook = job('hook', { stage: 'install:pre-tunnel', input: {} });
  assert.equal(agent.parseAgentJobs([hook], warnings)[0].kind, 'hook');
});

test('run: a refused app job is reported failed and never handed to a handler', async () => {
  const { reports, reporter } = recorder();
  const warnings = [];
  const unsigned = { ...remove() };
  delete unsigned.signature;
  const [refused] = agent.parseAgentJobs([unsigned], warnings);
  const outcome = await agent.runAgentJobs(LABEL, [refused], reporter, warnings, {
    appJobs: {
      install: async () => assert.fail('not run'),
      activate: async () => assert.fail('not run'),
      remove: async () => assert.fail('not run'),
    },
  });
  assert.deepEqual(outcome, { ran: [refused.id], deferred: [] });
  assert.equal(reports.length, 1);
  assert.equal(reports[0][1].ok, false);
  assert.match(reports[0][1].error, /did not sign this app-remove job/);
  assert.ok(core.AgentJobResultSchema.safeParse(reports[0][1]).success);
  assert.match(warnings[0], /app-remove job of "fx" was refused/);
});

test('run: a result the relay did not take is reported again, the job not run again', async () => {
  const warnings = [];
  let runs = 0;
  const appJobs = {
    install: async () => assert.fail('not listed'),
    activate: async (j) => {
      runs++;
      return { ok: true, app: { version: j.version, unit: 'active' } };
    },
    remove: async () => assert.fail('not listed'),
  };
  const j = activate();
  let up = false;
  const reports = [];
  const reporter = {
    reportJobResult: async (id, result) => {
      if (!up) throw new Error('panel unreachable');
      reports.push([id, result]);
    },
  };
  const file = path.join(home, '.lamalibre', 'lamaste', 'agents', LABEL, 'app-job-results.json');

  assert.deepEqual(await agent.runAgentJobs(LABEL, [j], reporter, warnings, { appJobs }), {
    ran: [],
    deferred: [],
  });
  assert.equal(runs, 1);
  assert.equal(((await stat(file)).mode & 0o777).toString(8), '600');
  assert.deepEqual(Object.keys(JSON.parse(await readFile(file, 'utf-8'))), [j.id]);

  up = true;
  assert.deepEqual(await agent.runAgentJobs(LABEL, [j], reporter, warnings, { appJobs }), {
    ran: [j.id],
    deferred: [],
  });
  assert.equal(runs, 1, 'reported from what was kept, not run again');
  assert.deepEqual(reports, [[j.id, { ok: true, app: { version: '1.0.0', unit: 'active' } }]]);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf-8')), {}, 'dropped once taken');
});

test('parse: a malformed app job is ignored with a warning', () => {
  // Their own fields are wrong: ignored before any signature is looked at.
  const install = (extra) => job('app-install', { spec }, extra);
  const activate = (extra) => job('app-activate', { version: '1.0.0', package: PKG }, extra);
  const remove = (extra) => job('app-remove', { purge: false, package: PKG }, extra);
  const malformed = [
    install({ spec: { ...spec, integrity: 'sha512-short' } }),
    install({ spec: { ...spec, version: 'latest' } }),
    install({ spec: { ...spec, service: { entry: '../agentd.js', memoryMax: null } } }),
    install({ spec: { ...spec, systemPackages: ['sqlite3; rm -rf /'] } }),
    install({ spec: { ...spec, preinstall: 'curl x | sh' } }),
    install({ spec: undefined }),
    activate({ version: '1.0' }),
    activate({ version: undefined }),
    remove({ purge: 'yes' }),
    remove({ purge: undefined }),
    remove({ package: undefined }),
    remove({ package: 'left-pad' }),
    activate({ package: undefined }),
    remove({ route: '-fx' }),
    remove({ route: 'a'.repeat(101) }),
    remove({ route: '../fx' }),
    remove({ id: 'not-a-uuid' }),
    remove({ timeoutMs: Number.NaN }),
    remove({ deadlineAt: 'soon' }),
    job('app-upgrade', { version: '1.0.0' }),
    null,
    'app-install',
  ];
  const warnings = [];
  assert.deepEqual(agent.parseAgentJobs([...malformed, signed(remove())], warnings).length, 1);
  assert.equal(warnings.length, malformed.length);
  assert.ok(warnings.every((w) => w === 'The panel reported a malformed agent job; ignoring it.'));
});

test('run: without handlers an app job stays pending, with a warning', async () => {
  const { reports, reporter } = recorder();
  const warnings = [];
  const jobs = [install(), activate(), remove()];
  const outcome = await agent.runAgentJobs(LABEL, jobs, reporter, warnings);
  assert.deepEqual(outcome, { ran: [], deferred: jobs.map((j) => j.id) });
  assert.equal(reports.length, 0);
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /app-install for "fx".*stays pending/);
});

test('run: handlers run each kind and their answers are reported', async () => {
  const { reports, reporter } = recorder();
  const warnings = [];
  const calls = [];
  const appJobs = {
    install: async (j) => {
      calls.push(['install', j.spec.version]);
      return { ok: true, app: { version: j.spec.version, unit: 'active' } };
    },
    activate: async (j) => {
      calls.push(['activate', j.version]);
      return { ok: false, error: `Version ${j.version} is not installed` };
    },
    remove: async (j) => {
      calls.push(['remove', j.purge]);
      return { ok: true, app: { version: null, unit: 'absent' } };
    },
  };
  const jobs = [install(), activate(), remove({ purge: true })];
  const outcome = await agent.runAgentJobs(LABEL, jobs, reporter, warnings, { appJobs });
  assert.deepEqual(outcome, { ran: jobs.map((j) => j.id), deferred: [] });
  assert.deepEqual(calls, [
    ['install', '1.0.0'],
    ['activate', '1.0.0'],
    ['remove', true],
  ]);
  assert.deepEqual(
    reports.map(([id, result]) => [jobs.findIndex((j) => j.id === id), result]),
    [
      [0, { ok: true, app: { version: '1.0.0', unit: 'active' } }],
      [1, { ok: false, error: 'Version 1.0.0 is not installed' }],
      [2, { ok: true, app: { version: null, unit: 'absent' } }],
    ],
  );
  assert.deepEqual(warnings, []);
  for (const [, result] of reports) assert.ok(core.AgentJobResultSchema.safeParse(result).success);
});

test('run: a deferral waits; a throw or a malformed answer is reported without its detail', async () => {
  const { reports, reporter } = recorder();
  const warnings = [];
  const appJobs = {
    install: async () => ({ deferred: true, reason: 'the registry is unreachable' }),
    activate: async () => {
      throw new Error('sudo: a password is required');
    },
    remove: async () => ({ ok: true, app: { version: '1.0.0', unit: 'stopped' } }),
  };
  const jobs = [install(), activate(), remove()];
  const outcome = await agent.runAgentJobs(LABEL, jobs, reporter, warnings, { appJobs });
  assert.deepEqual(outcome, { ran: [jobs[1].id, jobs[2].id], deferred: [jobs[0].id] });
  assert.deepEqual(reports, [
    [
      jobs[1].id,
      {
        ok: false,
        error: 'The app-activate job failed unexpectedly on the agent (see its sync log)',
      },
    ],
    [
      jobs[2].id,
      { ok: false, error: 'The app-remove job produced a malformed result on the agent' },
    ],
  ]);
  assert.match(warnings[0], /app-install job of "fx" waits for the next sync: the registry/);
  assert.match(warnings[1], /app-activate job of "fx" failed: sudo: a password is required/);
  assert.match(warnings[2], /app-remove job of "fx" produced a malformed result/);

  // A handler that answers nothing at all is a malformed result too.
  const silent = remove();
  await agent.runAgentJobs(LABEL, [silent], reporter, warnings, {
    appJobs: { ...appJobs, remove: async () => undefined },
  });
  assert.deepEqual(reports[2], [
    silent.id,
    { ok: false, error: 'The app-remove job produced a malformed result on the agent' },
  ]);
});

test('run: an expired job is left to the relay; a failed report is a warning', async () => {
  const warnings = [];
  const appJobs = {
    install: async () => assert.fail('an expired job must not run'),
    activate: async () => ({ ok: true, app: { version: '1.0.0', unit: 'active' } }),
    remove: async () => assert.fail('not listed'),
  };
  const expired = install({ deadlineAt: new Date(Date.now() - 1000).toISOString() });
  const reporter = {
    reportJobResult: async () => {
      throw new Error('panel unreachable');
    },
  };
  const outcome = await agent.runAgentJobs(LABEL, [expired, activate()], reporter, warnings, {
    appJobs,
  });
  assert.deepEqual(outcome, { ran: [], deferred: [] });
  assert.deepEqual(warnings, [
    'The result of the app-activate job of "fx" could not be reported (panel unreachable).',
  ]);
});
