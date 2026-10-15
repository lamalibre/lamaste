/**
 * Host facts (slice 3): what the relay checks a plugin's `agent.requires`
 * and an agent half's needs against. Gathered from os-release, PID 1 and
 * the app host helper; reported when they change or a day has passed; a
 * panel without the endpoint is a warning, retried on the next sync. The
 * helper is asked through sudo only when its file changed or its answer is
 * a day old, so the sync does not fill the sudo log every 30 seconds.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let home;
let agent;
let core;

const LABEL = 'vm1';
const DAY = 24 * 60 * 60 * 1000;

before(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'lamaste-host-facts-'));
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

const UBUNTU = [
  'PRETTY_NAME="Ubuntu 24.04.1 LTS"',
  'NAME="Ubuntu"',
  'VERSION_ID="24.04"',
  'ID=ubuntu',
  'ID_LIKE=debian',
  '',
].join('\n');

function linux({ osRelease = UBUNTU, systemdDir = true, pid1 = '/usr/lib/systemd/systemd' } = {}) {
  return {
    platform: 'linux',
    arch: 'arm64',
    nodeVersion: '22.13.1',
    readFile: async (p) => {
      if (p === '/etc/os-release' && osRelease !== null) return osRelease;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    isDirectory: async (p) => systemdDir && p === '/run/systemd/system',
    readlink: async () => pid1,
  };
}

test('os-release: ID, ID_LIKE and VERSION_ID, quoted or not; nothing invalid is reported', () => {
  assert.deepEqual(agent.parseOsRelease(UBUNTU), {
    id: 'ubuntu',
    idLike: ['debian'],
    versionId: '24.04',
  });
  assert.deepEqual(agent.parseOsRelease('ID=\'rhel\'\nID_LIKE="fedora centos"\nVERSION_ID=9.4\n'), {
    id: 'rhel',
    idLike: ['fedora', 'centos'],
    versionId: '9.4',
  });
  assert.deepEqual(agent.parseOsRelease('ID=debian\n'), {
    id: 'debian',
    idLike: [],
    versionId: '',
  });
  assert.equal(agent.parseOsRelease('NAME=Something\n'), null);
  assert.equal(agent.parseOsRelease('ID="Not Valid"\n'), null);
  assert.deepEqual(agent.parseOsRelease('ID=x\nID_LIKE="ok BAD $(x)"\nVERSION_ID="a b"\n'), {
    id: 'x',
    idLike: ['ok'],
    versionId: '',
  });
});

test('gather: a Linux agent with systemd and the helper; validated against the schema', async () => {
  const facts = await agent.gatherHostFacts({
    ...linux(),
    appHost: async () => ({ version: 1, node: '22.11.0' }),
  });
  assert.deepEqual(facts, {
    os: 'linux',
    arch: 'arm64',
    distro: { id: 'ubuntu', idLike: ['debian'], versionId: '24.04' },
    node: '22.13.1',
    systemd: true,
    apphost: { version: 1, node: '22.11.0' },
  });
  assert.ok(core.HostFactsSchema.safeParse(facts).success);
  const eligible = core.hostEligibility(
    { os: ['linux'], node: '>=22', systemPackages: ['sqlite3'] },
    {
      package: '@lamalibre/fx-agent',
      service: { entry: 'dist/agentd.js', memoryMax: null },
      systemPackages: ['sqlite3'],
    },
    facts,
  );
  assert.deepEqual(eligible, { eligible: true, reasons: [] });
});

test("the helper's status must name its Node.js; the probe reports it as x.y.z", () => {
  const status = { protocol: 1, node: '22.13.1', apps: {} };
  assert.deepEqual(agent.parseAppHostStatus(JSON.stringify(status)), status);
  assert.equal(agent.parseAppHostStatus(JSON.stringify({ protocol: 1, apps: {} })), null);
  assert.equal(agent.parseAppHostStatus(JSON.stringify({ ...status, node: 'v22' })), null);
  assert.ok(agent.parseAppHostStatus(JSON.stringify({ ...status, node: '25.0.0-nightly2026' })));
});

test('gather: systemd from PID 1 when /run/systemd/system is missing; none otherwise; no helper', async () => {
  const viaPid1 = await agent.gatherHostFacts({
    ...linux({ systemdDir: false }),
    appHost: async () => null,
  });
  assert.equal(viaPid1.systemd, true);
  assert.equal(viaPid1.apphost, null);
  const none = await agent.gatherHostFacts({
    ...linux({ systemdDir: false, pid1: '/sbin/init', osRelease: null }),
    appHost: async () => null,
  });
  assert.equal(none.systemd, false);
  assert.equal(none.distro, null);
});

test('gather: macOS has no distribution, no systemd and never a helper', async () => {
  const facts = await agent.gatherHostFacts({
    platform: 'darwin',
    arch: 'x64',
    nodeVersion: '24.1.0-pre',
    appHost: async () => assert.fail('not asked on macOS'),
  });
  assert.deepEqual(facts, {
    os: 'darwin',
    arch: 'x64',
    distro: null,
    node: '24.1.0',
    systemd: false,
    apphost: null,
  });
  await assert.rejects(agent.gatherHostFacts({ platform: 'win32' }), /not defined for platform/);
});

function reporter(answers = []) {
  const sent = [];
  return {
    sent,
    calls: {
      async putHostFacts(facts) {
        sent.push(facts);
        const answer = answers.length > 0 ? answers.shift() : 'ok';
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
}

function helperProbe(answer = { version: 1, node: '22.13.1' }) {
  const probe = { key: 'dev:1:100:1000', answer, probes: 0 };
  probe.options = {
    helperKey: async () => probe.key,
    probe: async () => {
      probe.probes++;
      return probe.answer;
    },
  };
  return probe;
}

test('sync: reported on the first run and on a change, not when nothing changed, again after a day', async () => {
  const probe = helperProbe();
  const { sent, calls } = reporter();
  const t0 = Date.parse('2026-10-15T10:00:00Z');
  const run = (now, sources = linux()) =>
    agent.syncHostFacts(LABEL, calls, [], { now, sources, appHost: probe.options });

  assert.deepEqual(await run(t0), { reported: true, changed: true });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].apphost, { version: 1, node: '22.13.1' });
  assert.deepEqual(await run(t0 + 30_000), { reported: false, changed: false });
  assert.equal(sent.length, 1);

  const state = JSON.parse(await readFile(agent.hostFactsStatePath(LABEL), 'utf-8'));
  assert.equal(state.reported.hash, agent.hostFactsHash(sent[0]));
  assert.equal(((await stat(agent.hostFactsStatePath(LABEL))).mode & 0o777).toString(8), '600');

  // Node.js upgraded: a change.
  assert.deepEqual(await run(t0 + 60_000, { ...linux(), nodeVersion: '22.14.0' }), {
    reported: true,
    changed: true,
  });
  // A day later, unchanged: refreshed, not a change.
  assert.deepEqual(await run(t0 + 60_000 + DAY, { ...linux(), nodeVersion: '22.14.0' }), {
    reported: true,
    changed: false,
  });
  assert.equal(sent.length, 3);
});

test('sync: the helper is probed once per helper file (or day), and its removal is noticed without sudo', async () => {
  const probe = helperProbe();
  const { sent, calls } = reporter();
  const t0 = Date.parse('2026-10-15T10:00:00Z');
  const run = (now) =>
    agent.syncHostFacts(LABEL, calls, [], { now, sources: linux(), appHost: probe.options });

  await run(t0);
  await run(t0 + 30_000);
  await run(t0 + 60_000);
  assert.equal(probe.probes, 1);

  // `apphost enable` again (a new helper file): asked again.
  probe.key = 'dev:2:120:2000';
  probe.answer = { version: 2, node: '24.1.0' };
  await run(t0 + 90_000);
  assert.equal(probe.probes, 2);
  assert.deepEqual(sent.at(-1).apphost, { version: 2, node: '24.1.0' });

  // A day on: asked again even though the file is the same.
  await run(t0 + 90_000 + DAY);
  assert.equal(probe.probes, 3);

  // `apphost disable`: no helper file, no probe, reported as not enabled.
  probe.key = null;
  await run(t0 + 120_000 + DAY);
  assert.equal(probe.probes, 3);
  assert.equal(sent.at(-1).apphost, null);
});

test('sync: a panel without the endpoint is a steady warning, retried on every sync until it takes them', async () => {
  const probe = helperProbe();
  const { sent, calls } = reporter(['unsupported', 'unsupported', 'ok']);
  const t0 = Date.parse('2026-10-15T10:00:00Z');
  const run = async (now) => {
    const warnings = [];
    const result = await agent.syncHostFacts(LABEL, calls, warnings, {
      now,
      sources: linux(),
      appHost: probe.options,
    });
    return { result, warnings };
  };

  const first = await run(t0);
  const second = await run(t0 + 30_000);
  assert.deepEqual(first.result, { reported: false, changed: false });
  assert.equal(first.warnings.length, 1);
  assert.match(first.warnings[0], /does not take host facts yet/);
  assert.deepEqual(second.warnings, first.warnings, 'the same text, so the sync log has it once');
  const third = await run(t0 + 60_000);
  assert.deepEqual(third.result, { reported: true, changed: true });
  assert.deepEqual(third.warnings, []);
  assert.equal(sent.length, 3);

  const failing = reporter([new Error('Failed to report host facts. Details: HTTP 503')]);
  const warnings = [];
  await agent.syncHostFacts('vm2', failing.calls, warnings, {
    now: t0,
    sources: linux(),
    appHost: probe.options,
  });
  assert.match(warnings[0], /could not be reported .*HTTP 503.*retrying/);
});
