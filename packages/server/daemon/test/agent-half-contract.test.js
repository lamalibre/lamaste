/**
 * Agent halves Lamaste installs onto an agent (slice 3), the contract: the
 * manifest's `agent.package` / `agent.service`, the declaration and the
 * pinned spec, the account, unit and paths the agent's root helper derives,
 * the approval digest (v2: relay hooks and the agent half), host facts and
 * eligibility, and agent job results.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateManifest,
  ManifestValidationError,
  agentHalfOf,
  agentHalfPreview,
  appServiceUser,
  appUnitName,
  APP_SERVICE_USER_MAX,
  APPHOST_PATHS,
  APPHOST_PROTOCOL_VERSION,
  AGENT_HALF_INTEGRITY_RE,
  AgentHalfSpecSchema,
  approvalDigest,
  relayHookSetDigest,
  relayHookSetOf,
  hookEntrySha256,
  HOOK_SET_DIGEST_VERSION,
  HostFactsSchema,
  hostEligibility,
  AgentJobResultSchema,
  AgentHookJobResultSchema,
  AgentAppJobResultSchema,
  AGENT_APP_JOB_TIMEOUTS,
  AGENT_JOB_ERROR_MAX_CHARS,
  agentJobError,
} from '@lamalibre/lamaste';

const agentBlock = {
  requires: { os: ['linux'], node: '>=22', systemPackages: ['sqlite3', 'curl'] },
  package: '@lamalibre/fx-agent',
  service: { entry: 'dist/agentd.js', memoryMax: '512M' },
};

const base = { name: 'fx', version: '1.0.0', hosting: 'agent', agent: agentBlock };

const INTEGRITY = `sha512-${Buffer.alloc(64, 7).toString('base64')}`;

const spec = {
  package: '@lamalibre/fx-agent',
  version: '1.0.0',
  integrity: INTEGRITY,
  service: { entry: 'dist/agentd.js', memoryMax: '512M' },
  systemPackages: ['curl', 'sqlite3'],
};

function manifestError(agent, extra = {}) {
  try {
    validateManifest({ ...base, ...extra, agent });
    return null;
  } catch (err) {
    // core's own error class: never zod's, which another copy of zod would not match.
    assert.ok(err instanceof ManifestValidationError, String(err));
    return err.issues.map((e) => `${e.path}: ${e.message}`).join('\n');
  }
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

test('manifest: an agent block with package and service validates, with lifecycle hooks too', () => {
  const m = validateManifest(base);
  assert.equal(m.agent.package, '@lamalibre/fx-agent');
  assert.deepEqual(m.agent.service, { entry: 'dist/agentd.js', memoryMax: '512M' });
  // memoryMax is optional; the 2b hook rules still hold beside a package.
  const withHooks = validateManifest({
    ...base,
    agent: { ...agentBlock, service: { entry: 'agentd.mjs' } },
    hooks: { agent: { install: { 'pre-tunnel': {} } } },
  });
  assert.equal(withHooks.agent.service.memoryMax, undefined);
  assert.match(
    manifestError(agentBlock, { hosting: 'server', hooks: undefined }),
    /needs "hosting": "agent"/,
  );
});

test('manifest: package and service go together; a block without either is hosted by hand', () => {
  assert.match(
    manifestError({ ...agentBlock, service: undefined }),
    /^agent\.service: .*needs "service"/,
  );
  assert.match(
    manifestError({ ...agentBlock, package: undefined }),
    /^agent\.package: .*needs "package"/,
  );
  assert.equal(manifestError({ requires: { os: ['linux'] } }), null);
  assert.equal(manifestError({}), null);
});

test('manifest: the service entry is a plain relative path to a .js, .mjs or .cjs file', () => {
  const entry = (e) => manifestError({ ...agentBlock, service: { entry: e } });
  for (const bad of [
    '../agentd.js',
    'dist/../../agentd.js',
    'dist/..',
    'a..b.js',
    '/opt/agentd.js',
    './agentd.js',
    'dist/./agentd.js',
    'dist//agentd.js',
    'dist/agentd.ts',
    'dist/agentd',
    'dist/agent d.js',
    'dist\\agentd.js',
    '',
  ]) {
    assert.match(entry(bad) ?? '', /agent\.service\.entry/, `entry ${JSON.stringify(bad)}`);
  }
  for (const good of ['dist/agentd.js', 'agentd.mjs', 'lib/x/agent-d.cjs', '.bin/agentd.js']) {
    assert.equal(entry(good), null, `entry ${good}`);
  }
  assert.match(
    manifestError({ ...agentBlock, service: { entry: 'a.js', user: 'root' } }),
    /Unrecognized key/,
  );
});

test('manifest: memoryMax is a systemd size in K, M or G', () => {
  const mem = (m) => manifestError({ ...agentBlock, service: { entry: 'a.js', memoryMax: m } });
  for (const bad of ['512', '0M', '0512M', '512MB', '512m', '1T', '1234567M', ' 512M', '']) {
    assert.match(mem(bad) ?? '', /agent\.service\.memoryMax/, `memoryMax ${JSON.stringify(bad)}`);
  }
  for (const good of ['1K', '512M', '2G', '999999M']) assert.equal(mem(good), null);
});

test('manifest: the agent package, the Node.js range and the route are checked', () => {
  const pkg = (p) => manifestError({ ...agentBlock, package: p });
  for (const bad of [
    'fx-agent',
    '@other/fx-agent',
    '@lamalibre/Fx',
    '@lamalibre/fx_agent',
    '@lamalibre/-fx',
    '@lamalibre/',
  ]) {
    assert.match(pkg(bad) ?? '', /agent\.package/, `package ${bad}`);
  }
  assert.match(
    manifestError({ ...agentBlock, requires: { node: 'latest' } }),
    /agent\.requires\.node: node must be a semver range/,
  );
  assert.equal(manifestError({ ...agentBlock, requires: { node: '^22.13 || >=24' } }), null);
  // The root helper names accounts and units after the route.
  assert.match(manifestError(agentBlock, { name: 'fx-' }), /^name: .*route/);
  assert.equal(manifestError({ requires: {} }, { name: 'fx-' }), null);
});

// ---------------------------------------------------------------------------
// Declaration, names and paths
// ---------------------------------------------------------------------------

test('agentHalfOf: the declaration with defaults, null when installed by hand', () => {
  assert.deepEqual(agentHalfOf(validateManifest(base)), {
    package: '@lamalibre/fx-agent',
    service: { entry: 'dist/agentd.js', memoryMax: '512M' },
    systemPackages: ['curl', 'sqlite3'],
  });
  const bare = validateManifest({
    ...base,
    agent: { package: '@lamalibre/fx-agent', service: { entry: 'agentd.js' } },
  });
  assert.deepEqual(agentHalfOf(bare), {
    package: '@lamalibre/fx-agent',
    service: { entry: 'agentd.js', memoryMax: null },
    systemPackages: [],
  });
  assert.equal(agentHalfOf(validateManifest({ ...base, agent: { requires: {} } })), null);
  assert.equal(agentHalfOf({ agent: undefined }), null);
  assert.equal(agentHalfOf({}), null);
  assert.throws(() => agentHalfOf({ agent: { package: '@lamalibre/fx-agent' } }), /no service/);
});

test('appServiceUser: readable up to 30 characters, 64 bits of hash at exactly 31 beyond', () => {
  assert.equal(appServiceUser('fx'), 'lamaste-app-fx');
  const eighteen = 'a'.repeat(18);
  assert.equal(appServiceUser(eighteen), `lamaste-app-${eighteen}`);
  assert.equal(appServiceUser(eighteen).length, 30);
  // 31 characters would have been readable before — and could equal a
  // hashed name. Now every name of 31 characters is a hashed one.
  const nineteen = 'a'.repeat(19);
  assert.match(appServiceUser(nineteen), /^lamaste-app-aa-[a-f0-9]{16}$/);
  assert.equal(appServiceUser(nineteen).length, APP_SERVICE_USER_MAX);

  const long = `market-indicators-${'x'.repeat(82)}`;
  assert.equal(long.length, 100);
  const user = appServiceUser(long);
  assert.match(user, /^lamaste-app-ma-[a-f0-9]{16}$/);
  assert.equal(appServiceUser(long), user);
  assert.notEqual(appServiceUser(`${long.slice(0, 99)}y`), user);

  // The collision of the old rule: a route whose readable name is another's hashed one.
  const crafted = user.slice('lamaste-app-'.length);
  assert.equal(crafted.length, 19);
  assert.notEqual(appServiceUser(crafted), user);

  for (const bad of ['', 'Fx', '-fx', 'fx-', 'f_x', '../fx', 'a'.repeat(101)]) {
    assert.throws(() => appServiceUser(bad), /Invalid plugin route/, `route ${bad}`);
  }
});

test('appServiceAccountComment: the route that owns the account', async () => {
  const { appServiceAccountComment } = await import('@lamalibre/lamaste/agent');
  assert.equal(appServiceAccountComment('fx'), 'lamaste-app route=fx');
  assert.throws(() => appServiceAccountComment('f:x'), /Invalid plugin route/);
});

test('names and paths: unit, helper and per-route directories', () => {
  assert.equal(appUnitName('fx'), 'lamalibre-app-fx.service');
  assert.equal(APPHOST_PATHS.helper, '/usr/local/sbin/lamaste-apphost');
  assert.equal(APPHOST_PATHS.sudoers, '/etc/sudoers.d/lamaste-apphost');
  assert.equal(APPHOST_PATHS.codeDir('fx'), '/opt/lamalibre/apps/fx');
  assert.equal(APPHOST_PATHS.dataDir('fx'), '/var/lib/lamalibre/apps/fx');
  assert.equal(APPHOST_PATHS.configDir('fx'), '/etc/lamalibre/apps/fx');
  assert.equal(APPHOST_PATHS.configFile('fx'), '/etc/lamalibre/apps/fx/plugin-config.json');
  assert.equal(APPHOST_PATHS.ownerFile('fx'), '/var/lib/lamalibre/apps/.owners/fx.json');
  assert.throws(() => APPHOST_PATHS.dataDir('../etc'), /Invalid plugin route/);
  assert.throws(() => appUnitName('fx.service'), /Invalid plugin route/);
  assert.ok(Object.isFrozen(APPHOST_PATHS));
  assert.equal(APPHOST_PROTOCOL_VERSION, 2);
});

test('spec: integrity is a sha512 SRI; the spec is checked strictly', () => {
  assert.match(INTEGRITY, AGENT_HALF_INTEGRITY_RE);
  assert.ok(AgentHalfSpecSchema.safeParse(spec).success);
  const bad = (patch) => !AgentHalfSpecSchema.safeParse({ ...spec, ...patch }).success;
  assert.ok(bad({ integrity: `sha256-${Buffer.alloc(32).toString('base64')}` }));
  assert.ok(bad({ integrity: INTEGRITY.slice(0, -2) }));
  assert.ok(bad({ version: '1.0' }));
  assert.ok(bad({ version: '01.0.0' }));
  assert.ok(bad({ version: '1.0.0+build.1' }));
  assert.ok(bad({ service: { entry: 'dist/agentd.js' } }));
  assert.ok(bad({ systemPackages: ['Bad Name'] }));
  assert.ok(bad({ route: 'fx' }));
  assert.ok(!bad({ version: '1.0.0-rc.1', service: { entry: 'a.js', memoryMax: null } }));
});

test('agentHalfPreview: what the approval shows', () => {
  assert.deepEqual(agentHalfPreview('fx', { ...spec, systemPackages: ['sqlite3', 'curl'] }), {
    package: '@lamalibre/fx-agent',
    version: '1.0.0',
    integrity: INTEGRITY,
    entry: 'dist/agentd.js',
    memoryMax: '512M',
    systemPackages: ['curl', 'sqlite3'],
    serviceUser: 'lamaste-app-fx',
    unitName: 'lamalibre-app-fx.service',
    dataDir: '/var/lib/lamalibre/apps/fx',
  });
});

// ---------------------------------------------------------------------------
// Approval digest v2
// ---------------------------------------------------------------------------

test('approvalDigest: stable, and binds every field of the agent half', () => {
  assert.equal(HOOK_SET_DIGEST_VERSION, 2);
  const d = approvalDigest({ relay: null, agentHalf: spec });
  assert.match(d, /^[a-f0-9]{64}$/);
  assert.equal(approvalDigest({ relay: null, agentHalf: structuredClone(spec) }), d);
  // System package order and repeats are not a change.
  assert.equal(
    approvalDigest({
      relay: null,
      agentHalf: { ...spec, systemPackages: ['sqlite3', 'curl', 'curl'] },
    }),
    d,
  );
  const changes = [
    { package: '@lamalibre/fx-agent2' },
    { version: '1.0.1' },
    { integrity: `sha512-${Buffer.alloc(64, 8).toString('base64')}` },
    { service: { entry: 'dist/agentd.mjs', memoryMax: '512M' } },
    { service: { entry: 'dist/agentd.js', memoryMax: '1G' } },
    { service: { entry: 'dist/agentd.js', memoryMax: null } },
    { systemPackages: ['curl'] },
    { systemPackages: ['curl', 'sqlite3', 'jq'] },
  ];
  const seen = new Set([d]);
  for (const patch of changes) {
    const other = approvalDigest({ relay: null, agentHalf: { ...spec, ...patch } });
    assert.ok(!seen.has(other), `a change of ${JSON.stringify(patch)} changes the digest`);
    seen.add(other);
  }
});

test('approvalDigest: relay-only equals relayHookSetDigest; both parts differ from each alone', () => {
  const m = validateManifest({
    ...base,
    hooks: { relay: { entry: 'hooks/relay.mjs', install: { 'pre-tunnel': {} } } },
  });
  const set = relayHookSetOf(m);
  const sha = hookEntrySha256(Buffer.from('export default {}'));
  const relayOnly = approvalDigest({ relay: { set, entrySha256: sha }, agentHalf: null });
  assert.equal(approvalDigest({ relay: { set, entrySha256: sha }, agentHalf: null }), relayOnly);
  assert.equal(relayHookSetDigest(set, sha), relayOnly);
  assert.equal(
    approvalDigest({
      relay: { set: relayHookSetOf(validateManifest(m)), entrySha256: sha },
      agentHalf: null,
    }),
    relayOnly,
  );
  const both = approvalDigest({ relay: { set, entrySha256: sha }, agentHalf: spec });
  assert.notEqual(both, relayOnly);
  assert.notEqual(both, approvalDigest({ relay: null, agentHalf: spec }));
  assert.notEqual(
    approvalDigest({ relay: { set, entrySha256: null }, agentHalf: null }),
    relayOnly,
  );
});

test('approvalDigest: refuses what cannot be approved', () => {
  assert.throws(
    () =>
      approvalDigest({
        relay: { set: { entry: null, effects: [], stages: [], request: [] }, entrySha256: 'xyz' },
        agentHalf: null,
      }),
    /entrySha256/,
  );
  assert.throws(
    () => approvalDigest({ relay: null, agentHalf: { ...spec, integrity: 'sha512-short' } }),
    /not a valid agent half spec.*integrity/,
  );
  assert.throws(
    () => approvalDigest({ relay: null, agentHalf: { ...spec, version: 'latest' } }),
    /version/,
  );
});

// ---------------------------------------------------------------------------
// Host facts and eligibility
// ---------------------------------------------------------------------------

/** The key this relay signs app jobs with, and the one the agent pinned. */
const RELAY_KID = 'ab'.repeat(16);
const RELAY = { relayKid: RELAY_KID };

const ubuntu = {
  os: 'linux',
  arch: 'x64',
  distro: { id: 'ubuntu', idLike: ['debian'], versionId: '24.04' },
  node: '22.13.1',
  systemd: true,
  apphost: { version: APPHOST_PROTOCOL_VERSION, node: '22.13.1', relayKid: RELAY_KID },
};

const mac = {
  os: 'darwin',
  arch: 'arm64',
  distro: null,
  node: '22.13.1',
  systemd: false,
  apphost: null,
};

test('HostFactsSchema: what an agent reports, strictly', () => {
  assert.ok(HostFactsSchema.safeParse(ubuntu).success);
  assert.ok(HostFactsSchema.safeParse(mac).success);
  const bad = (patch) => !HostFactsSchema.safeParse({ ...ubuntu, ...patch }).success;
  assert.ok(bad({ os: 'windows' }));
  assert.ok(bad({ arch: 'X86-64' }));
  assert.ok(bad({ node: 'v22.13.1' }));
  assert.ok(bad({ node: '22' }));
  assert.ok(bad({ systemd: 'yes' }));
  assert.ok(bad({ apphost: { version: 0, node: '22.13.1', relayKid: null } }));
  assert.ok(bad({ apphost: { version: 1.5, node: '22.13.1', relayKid: null } }));
  assert.ok(bad({ apphost: { version: 1, relayKid: null } }), "the helper's Node.js is part of it");
  assert.ok(bad({ apphost: { version: 1, node: 'v22', relayKid: null } }));
  assert.ok(
    bad({ apphost: { version: 1, node: '22.13.1' } }),
    'the pinned relay key is part of it',
  );
  assert.ok(bad({ apphost: { version: 1, node: '22.13.1', relayKid: 'AB'.repeat(16) } }));
  assert.ok(bad({ apphost: { version: 1, node: '22.13.1', relayKid: 'ab' } }));
  assert.ok(!bad({ apphost: { version: 1, node: '22.13.1', relayKid: null } }));
  assert.ok(bad({ distro: { id: 'Ubuntu', idLike: [], versionId: '24.04' } }));
  assert.ok(bad({ distro: { id: 'ubuntu', idLike: Array(11).fill('debian'), versionId: '' } }));
  assert.ok(bad({ distro: { id: 'ubuntu', idLike: [], versionId: '24.04 LTS' } }));
  assert.ok(bad({ hostname: 'vm1' }));
  assert.ok(!bad({ distro: { id: 'debian', idLike: [], versionId: '' } }));
  // Only the top level is strict; nothing else is kept from a nested object.
  assert.deepEqual(
    HostFactsSchema.parse({ ...ubuntu, apphost: { ...ubuntu.apphost, path: '/tmp/x' } }).apphost,
    ubuntu.apphost,
  );
});

test('hostEligibility: an Ubuntu agent with the helper hosts; a hand-installed half needs only requires', () => {
  const requires = validateManifest(base).agent.requires;
  const declaration = agentHalfOf(validateManifest(base));
  assert.deepEqual(hostEligibility(requires, declaration, ubuntu, RELAY), {
    eligible: true,
    reasons: [],
  });
  // Raspberry Pi OS: debian through ID_LIKE.
  const raspbian = { ...ubuntu, distro: { id: 'raspbian', idLike: ['debian'], versionId: '12' } };
  assert.equal(hostEligibility(requires, declaration, raspbian, RELAY).eligible, true);
  // Without an agent half Lamaste installs, macOS can host what does not require Linux.
  assert.deepEqual(hostEligibility(undefined, null, mac, RELAY), { eligible: true, reasons: [] });
  assert.deepEqual(
    hostEligibility(null, null, { ...ubuntu, apphost: null, systemd: false }, RELAY),
    {
      eligible: true,
      reasons: [],
    },
  );
  // An agent half without system packages needs no Debian family.
  const noPackages = { ...declaration, systemPackages: [] };
  const fedora = { ...ubuntu, distro: { id: 'fedora', idLike: [], versionId: '40' } };
  assert.equal(hostEligibility(undefined, noPackages, fedora, RELAY).eligible, true);
});

test('hostEligibility: each reason', () => {
  const declaration = agentHalfOf(validateManifest(base));
  const reasons = (requires, half, facts, relay = RELAY) => {
    const out = hostEligibility(requires, half, facts, relay);
    assert.equal(out.eligible, out.reasons.length === 0);
    return out.reasons;
  };

  assert.match(reasons({ os: ['linux'] }, declaration, null).join(), /has not reported its host/);
  assert.equal(reasons({ os: ['linux'] }, declaration, null).length, 1);

  assert.deepEqual(reasons({ os: ['linux'] }, null, mac), [
    'The plugin runs on Linux; the agent runs macOS',
  ]);
  assert.deepEqual(reasons({ node: '>=24' }, null, ubuntu), [
    'The plugin needs Node.js >=24; the agent has 22.13.1',
  ]);
  assert.match(reasons({ node: 'latest' }, null, ubuntu).join(), /"latest" is not a semver range/);
  assert.deepEqual(reasons({ node: '^22.13' }, null, ubuntu), []);

  assert.deepEqual(reasons(undefined, declaration, mac), [
    'Lamaste installs an agent half only on a Linux agent; the agent runs macOS',
  ]);
  assert.match(reasons(undefined, declaration, { ...ubuntu, systemd: false }).join(), /systemd/);
  assert.match(
    reasons(undefined, declaration, { ...ubuntu, apphost: null }).join(),
    /app host helper is not enabled/,
  );
  assert.match(
    reasons(undefined, declaration, {
      ...ubuntu,
      apphost: { version: APPHOST_PROTOCOL_VERSION - 1, node: '22.13.1', relayKid: RELAY_KID },
    }).join(),
    /speaks protocol 1; this relay needs 2 \(update lamaste-agent, then sudo lamaste-agent apphost enable\)/,
  );
  // The helper runs only what this relay signed: it must trust the key the relay signs with.
  assert.deepEqual(
    reasons(undefined, declaration, {
      ...ubuntu,
      apphost: { ...ubuntu.apphost, relayKid: 'cd'.repeat(16) },
    }),
    [
      "The agent's app host helper trusts relay key cdcdcdcdcdcd, but this relay signs with " +
        'abababababab; re-pin the relay key: sudo lamaste-agent apphost pin',
    ],
  );
  assert.deepEqual(
    reasons(undefined, declaration, { ...ubuntu, apphost: { ...ubuntu.apphost, relayKid: null } }),
    [
      "The agent's app host helper has no key of this relay pinned; re-pin the relay key: " +
        'sudo lamaste-agent apphost pin',
    ],
  );
  assert.match(
    reasons(undefined, declaration, ubuntu, { relayKid: null }).join(),
    /relay's signing key is unusable/,
  );
  // The relay key is about the agent half Lamaste installs: a hand-installed one never minds it.
  assert.deepEqual(reasons(undefined, null, ubuntu, { relayKid: null }), []);
  assert.deepEqual(
    reasons(undefined, null, { ...ubuntu, apphost: { ...ubuntu.apphost, relayKid: null } }),
    [],
  );
  assert.match(
    reasons(undefined, declaration, {
      ...ubuntu,
      distro: { id: 'fedora', idLike: ['rhel'], versionId: '40' },
    }).join(),
    /system packages \(curl, sqlite3\).*Debian or Ubuntu only; the agent runs "fedora"/,
  );
  assert.match(
    reasons(undefined, declaration, { ...ubuntu, distro: null }).join(),
    /an unknown distribution/,
  );

  // Everything at once: one reason per failed check. Without the helper
  // there is no Node.js to check the agent half against yet.
  assert.equal(
    reasons({ os: ['linux'], node: '>=24' }, declaration, {
      ...ubuntu,
      systemd: false,
      apphost: null,
      distro: null,
      node: '20.0.0',
    }).length,
    3,
  );
  assert.equal(
    reasons({ os: ['linux'], node: '>=24' }, declaration, {
      ...ubuntu,
      systemd: false,
      distro: null,
      apphost: { version: APPHOST_PROTOCOL_VERSION - 1, node: '20.0.0', relayKid: null },
    }).length,
    5,
  );
});

test('hostEligibility: requires.node is checked against the Node.js the agent half runs on', () => {
  const declaration = agentHalfOf(validateManifest(base));
  // The agent itself runs an older Node.js (nvm, say) than the helper's /usr/bin/node.
  const split = {
    ...ubuntu,
    node: '20.11.0',
    apphost: { version: APPHOST_PROTOCOL_VERSION, node: '24.1.0', relayKid: RELAY_KID },
  };

  // Lamaste installs the agent half: it runs on the helper's Node.js.
  assert.deepEqual(hostEligibility({ node: '>=24' }, declaration, split, RELAY), {
    eligible: true,
    reasons: [],
  });
  assert.deepEqual(hostEligibility({ node: '>=25' }, declaration, split, RELAY).reasons, [
    "The plugin needs Node.js >=25; the agent half would run on 24.1.0 (the Node.js of the agent's app host helper)",
  ]);
  // Installed by hand: it runs however the operator runs it — the agent's own is the measure.
  assert.deepEqual(hostEligibility({ node: '>=24' }, null, split, RELAY).reasons, [
    'The plugin needs Node.js >=24; the agent has 20.11.0',
  ]);
  assert.equal(hostEligibility({ node: '>=20' }, null, split, RELAY).eligible, true);
});

// ---------------------------------------------------------------------------
// Agent job results
// ---------------------------------------------------------------------------

test('AgentJobResultSchema: hook and app results, one-line errors, nothing else', () => {
  const ok = (schema, value) => schema.safeParse(value).success;
  const hook = { ok: true, decision: { ok: true, output: { migrated: 3 } } };
  const refusal = { ok: true, decision: { ok: false, reason: 'no room' } };
  const app = { ok: true, app: { version: '1.0.0', unit: 'active' } };
  const removed = { ok: true, app: { version: null, unit: 'absent' } };
  const failure = { ok: false, error: 'npm pack failed: 404 Not Found' };

  for (const v of [hook, refusal, app, removed, failure]) assert.ok(ok(AgentJobResultSchema, v));
  assert.deepEqual(AgentJobResultSchema.parse(refusal), refusal);

  assert.ok(ok(AgentHookJobResultSchema, hook) && ok(AgentHookJobResultSchema, failure));
  assert.ok(!ok(AgentHookJobResultSchema, app));
  assert.ok(ok(AgentAppJobResultSchema, app) && ok(AgentAppJobResultSchema, failure));
  assert.ok(!ok(AgentAppJobResultSchema, hook));

  for (const bad of [
    { ok: true, decision: { ok: 'yes' } },
    { ok: true, decision: { ok: false } },
    { ok: true },
    { ok: true, decision: { ok: true }, app: { version: '1.0.0', unit: 'active' } },
    { ok: true, app: { version: '1.0', unit: 'active' } },
    { ok: true, app: { version: '1.0.0', unit: 'failed' } },
    { ok: true, app: { version: '1.0.0', unit: 'active', pid: 42 } },
    { ok: false, error: '' },
    { ok: false, error: 'line one\nline two' },
    { ok: false, error: 'x'.repeat(AGENT_JOB_ERROR_MAX_CHARS + 1) },
    { ok: false, error: 'failed', stack: 'at x' },
    { ok: false },
  ]) {
    assert.ok(!ok(AgentJobResultSchema, bad), JSON.stringify(bad));
  }
  assert.ok(ok(AgentJobResultSchema, { ok: false, error: 'x'.repeat(AGENT_JOB_ERROR_MAX_CHARS) }));
});

test('agentJobError: one line, bounded; job timeouts', () => {
  assert.equal(
    agentJobError('apt-get failed:\n  E: Unable to locate\tpackage x\r\n'),
    'apt-get failed: E: Unable to locate package x',
  );
  assert.equal(agentJobError('bell\u0007 rung'), 'bell rung');
  assert.equal(agentJobError(' \n '), 'The job failed');
  const long = agentJobError('y'.repeat(2000));
  assert.equal(long.length, AGENT_JOB_ERROR_MAX_CHARS);
  assert.ok(long.endsWith('…'));
  assert.ok(AgentJobResultSchema.safeParse({ ok: false, error: long }).success);
  assert.deepEqual(
    { ...AGENT_APP_JOB_TIMEOUTS },
    { install: 600_000, activate: 120_000, remove: 300_000 },
  );
});
