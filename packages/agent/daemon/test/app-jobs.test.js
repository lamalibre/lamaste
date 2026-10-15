/**
 * App jobs on the agent (slice 3): the relay's `agentJobs` carry
 * `app-install`, `app-activate` and `app-remove` beside the 2b hook jobs.
 * The sync validates them strictly, hands them to the caller's handlers (the
 * agent CLI, through the app host helper), and reports what the handlers
 * answer; without handlers an app job stays pending.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let home;
let agent;
let core;

const LABEL = 'vm1';

before(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'lamaste-app-jobs-'));
  process.env.HOME = home;
  agent = await import('@lamalibre/lamaste/agent');
  core = await import('@lamalibre/lamaste');
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

const job = (kind, fields, extra = {}) => ({
  id: crypto.randomUUID(),
  route: 'fx',
  kind,
  timeoutMs: 1000,
  deadlineAt: new Date(Date.now() + 60_000).toISOString(),
  ...fields,
  ...extra,
});

const install = (extra) => job('app-install', { spec }, extra);
const activate = (extra) => job('app-activate', { version: '1.0.0' }, extra);
const remove = (extra) => job('app-remove', { purge: false }, extra);

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
  assert.equal(jobs[2].purge, true);
});

test('parse: a malformed app job is ignored with a warning', () => {
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
  assert.deepEqual(agent.parseAgentJobs([...malformed, remove()], warnings).length, 1);
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
