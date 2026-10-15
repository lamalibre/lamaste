/**
 * Host facts (slice 3): what the relay checks a plugin's `agent.requires`
 * and an agent half's needs against. Gathered from os-release, PID 1 and
 * the app host helper; reported when they change or a day has passed; a
 * panel without the endpoint is a warning, retried on the next sync. The
 * helper is asked through sudo only when its file changed or its answer is
 * a day old, so the sync does not fill the sudo log every 30 seconds. The
 * relay key pinned for the agent is read on every sync — a root-owned file
 * anyone may read — so a re-pin is reported at once.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
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

const KID = 'ab'.repeat(16);

test('gather: a Linux agent with systemd and the helper; validated against the schema', async () => {
  const facts = await agent.gatherHostFacts(LABEL, {
    ...linux(),
    appHost: async () => ({ version: 1, node: '22.11.0', relayKid: KID }),
  });
  assert.deepEqual(facts, {
    os: 'linux',
    arch: 'arm64',
    distro: { id: 'ubuntu', idLike: ['debian'], versionId: '24.04' },
    node: '22.13.1',
    systemd: true,
    apphost: { version: 1, node: '22.11.0', relayKid: KID },
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
    { relayKid: KID },
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
  const viaPid1 = await agent.gatherHostFacts(LABEL, {
    ...linux({ systemdDir: false }),
    appHost: async () => null,
  });
  assert.equal(viaPid1.systemd, true);
  assert.equal(viaPid1.apphost, null);
  const none = await agent.gatherHostFacts(LABEL, {
    ...linux({ systemdDir: false, pid1: '/sbin/init', osRelease: null }),
    appHost: async () => null,
  });
  assert.equal(none.systemd, false);
  assert.equal(none.distro, null);
});

test('gather: macOS has no distribution, no systemd and never a helper', async () => {
  const facts = await agent.gatherHostFacts(LABEL, {
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
  await assert.rejects(
    agent.gatherHostFacts(LABEL, { platform: 'win32' }),
    /not defined for platform/,
  );
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
  const probe = {
    key: 'dev:1:100:1000',
    answer,
    probes: 0,
    relayKid: null,
    kidReads: 0,
    labels: new Set(),
  };
  probe.options = {
    helperKey: async () => probe.key,
    probe: async () => {
      probe.probes++;
      return probe.answer;
    },
    relayKid: async (label) => {
      probe.labels.add(label);
      probe.kidReads++;
      return probe.relayKid;
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
  assert.deepEqual(sent[0].apphost, { version: 1, node: '22.13.1', relayKid: null });
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
  assert.deepEqual(sent.at(-1).apphost, { version: 2, node: '24.1.0', relayKid: null });

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

test('sync: the pinned relay key is read every run, without sudo; a re-pin is a change reported at once', async () => {
  const probe = helperProbe();
  const { sent, calls } = reporter();
  const t0 = Date.parse('2026-10-15T10:00:00Z');
  const run = (now) =>
    agent.syncHostFacts(LABEL, calls, [], { now, sources: linux(), appHost: probe.options });

  await run(t0);
  probe.relayKid = KID;
  assert.deepEqual(await run(t0 + 30_000), { reported: true, changed: true });
  assert.equal(probe.probes, 1, 'the helper itself is not asked again');
  assert.equal(probe.kidReads, 2);
  assert.deepEqual([...probe.labels], [LABEL], "the reporting agent's own pin");
  assert.equal(sent.at(-1).apphost.relayKid, KID);
  assert.deepEqual(await run(t0 + 60_000), { reported: false, changed: false });
  probe.relayKid = 'cd'.repeat(16);
  assert.deepEqual(await run(t0 + 90_000), { reported: true, changed: true });
  assert.equal(sent.at(-1).apphost.relayKid, 'cd'.repeat(16));
});

test('relay pin: read as the helper reads it — a root-owned file in a root-owned directory, strictly', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lamaste-relay-pin-'));
  const uid = process.getuid();
  const opts = { root, ownerUid: uid };
  const signer = core.createRelaySigner(path.join(root, 'key.json'), { create: true });
  const key = await signer.current();
  const pin = {
    label: LABEL,
    agent: 'vm1-relay',
    kid: key.kid,
    publicKey: key.publicKey,
    panelUrl: 'https://203.0.113.5:9292',
    pinnedAt: '2026-10-16T08:00:00.000Z',
  };
  const file = path.join(root, core.APPHOST_PATHS.relayPinFile(LABEL));
  try {
    assert.deepEqual(await agent.readRelayPin(LABEL, opts), { state: 'absent' });
    await mkdir(path.dirname(file), { recursive: true, mode: 0o755 });
    await writeFile(file, agent.relayPinJson(pin), { mode: 0o644 });
    assert.deepEqual(await agent.readRelayPin(LABEL, opts), { state: 'pinned', pin });
    assert.equal(agent.parseRelayPin(agent.relayPinJson(pin), LABEL).kid, key.kid);

    // Another owner — the agent's own user — is no pin.
    assert.equal((await agent.readRelayPin(LABEL, { root, ownerUid: uid + 1 })).state, 'invalid');
    // Writable by the group or others: no pin.
    await chmod(file, 0o664);
    assert.equal((await agent.readRelayPin(LABEL, opts)).state, 'invalid');
    await chmod(file, 0o644);
    await chmod(path.dirname(file), 0o777);
    assert.equal((await agent.readRelayPin(LABEL, opts)).state, 'invalid');
    await chmod(path.dirname(file), 0o755);
    // A link: no pin.
    await rm(file);
    await writeFile(path.join(root, 'elsewhere.json'), agent.relayPinJson(pin));
    await symlink(path.join(root, 'elsewhere.json'), file);
    assert.equal((await agent.readRelayPin(LABEL, opts)).state, 'invalid');
    await rm(file);

    // The content, strictly: its own label, a kid derived from its key, no other field.
    const text = (patch) => JSON.stringify({ v: 1, ...pin, ...patch });
    assert.equal(agent.parseRelayPin(text({}), 'vm2'), null);
    assert.equal(agent.parseRelayPin(text({ kid: 'cd'.repeat(16) }), LABEL), null);
    assert.equal(agent.parseRelayPin(text({ v: 2 }), LABEL), null);
    assert.equal(agent.parseRelayPin(text({ extra: 1 }), LABEL), null);
    assert.equal(agent.parseRelayPin(text({ panelUrl: 'http://x' }), LABEL), null);
    assert.equal(agent.parseRelayPin(text({ agent: 'VM1' }), LABEL), null);
    assert.equal(agent.parseRelayPin('{', LABEL), null);
    assert.ok(agent.parseRelayPin(text({}), LABEL));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
