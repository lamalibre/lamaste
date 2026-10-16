/**
 * Agent halves Lamaste installs (slice 3), the relay's staging and
 * approval: installing a plugin and staging an update pin the agent
 * package's tarball integrity from the registry the panel installs from
 * (and refuse a missing, non-sha512 or unpublished one); the approval
 * digest covers the agent half, so a new agent half waits for approval
 * like a changed hook set; the runner's state stays about the relay hook
 * set alone. npm is a stand-in (`fake-npm.js`) that logs what it was asked.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { approvalDigest, relayHookSetDigest, relayHookSetOf } from '@lamalibre/lamaste';

import { installFakeNpm } from './fake-npm.js';

const PKG = '@lamalibre/fx-server';
const AGENT_PKG = '@lamalibre/fx-agent';
const HX_PKG = '@lamalibre/hx-server';
const HX_AGENT = '@lamalibre/hx-agent';
const MODULE = 'export default { "tunnel:down": () => ({}) };\n';

const integrity = (seed) => `sha512-${crypto.createHash('sha512').update(seed).digest('base64')}`;

const agentBlock = (pkg) => ({
  requires: { os: ['linux'], node: '>=22', systemPackages: ['sqlite3'] },
  package: pkg,
  service: { entry: 'dist/agentd.js', memoryMax: '256M' },
});

const fxManifest = (version) => ({
  name: 'fx',
  version,
  hosting: 'agent',
  agent: agentBlock(AGENT_PKG),
});

const hxManifest = (version) => ({
  name: 'hx',
  version,
  hosting: 'agent',
  agent: agentBlock(HX_AGENT),
  hooks: { relay: { entry: 'hooks/relay.mjs', tunnel: { down: {} } } },
});

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const actor = { actor: 'admin', certSerial: '0A1B', logger };

let dir;
let stateDir;
let npm;
let lib;
let runnerCalls;
const installedEntries = new Map();

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-agent-half-staging-'));
  stateDir = path.join(dir, 'state');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(stateDir);
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_PKI_DIR = path.join(stateDir, 'pki');
  process.env.LAMALIBRE_LAMASTE_CONFIG = path.join(stateDir, 'panel.json');
  await writeFile(
    process.env.LAMALIBRE_LAMASTE_CONFIG,
    JSON.stringify({
      ip: '203.0.113.10',
      domain: 'relay.test',
      email: 'ops@relay.test',
      dataDir: stateDir,
      onboarding: { status: 'COMPLETED' },
    }),
  );
  npm = await installFakeNpm(path.join(dir, 'npm'));

  lib = {
    ...(await import('../src/lib/config.js')),
    ...(await import('../src/lib/plugins.js')),
    ...(await import('../src/lib/plugin-hooks.js')),
    ...(await import('../src/lib/plugin-packages.js')),
    ...(await import('../src/lib/plugin-lifecycle.js')),
    ...(await import('../src/lib/plugin-operations.js')),
    ...(await import('../src/lib/audit.js')),
  };
  await lib.loadConfig();
  runnerCalls = [];
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
    async restart() {},
    async installedEntry(route) {
      return installedEntries.has(route) ? installedEntries.get(route) : undefined;
    },
  });

  await npm.publish(PKG, '1.0.0', { 'lamaste-plugin.json': JSON.stringify(fxManifest('1.0.0')) });
  await npm.setIntegrity(`${AGENT_PKG}@1.0.0`, integrity('fx-agent-1.0.0'));
});

after(async () => {
  lib.setHookRunnerManagerForTests(null);
  await rm(dir, { recursive: true, force: true });
});

test('install pins the agent half: the registry integrity, asked the way plugin installs ask', async () => {
  const entry = await lib.installPlugin(PKG, logger);
  assert.deepEqual(entry.agentHalfPin, {
    package: AGENT_PKG,
    version: '1.0.0',
    integrity: integrity('fx-agent-1.0.0'),
  });
  const plugin = await lib.findPlugin('fx');
  assert.deepEqual(plugin.agentHalfPin, entry.agentHalfPin);

  // npm view, in the state directory (its .npmrc is the panel's registry
  // configuration), with nothing but the spec and the field in its arguments.
  const view = npm.calls().find((c) => c.args[0] === 'view');
  assert.deepEqual(view.args, ['view', `${AGENT_PKG}@1.0.0`, 'dist.integrity', '--json']);
  assert.equal(view.cwd, await realpath(stateDir));

  // The approval covers it: required, pending, the digest over the spec.
  const status = await lib.hookStatus(plugin);
  const spec = lib.installedAgentHalf(plugin);
  assert.equal(status.relay, null);
  assert.equal(status.approval.required, true);
  assert.equal(status.approval.state, 'pending');
  assert.equal(status.approval.digest, approvalDigest({ relay: null, agentHalf: spec }));
  assert.deepEqual(status.agentHalf, {
    package: AGENT_PKG,
    version: '1.0.0',
    integrity: integrity('fx-agent-1.0.0'),
    entry: 'dist/agentd.js',
    memoryMax: '256M',
    systemPackages: ['sqlite3'],
    serviceUser: 'lamaste-app-fx',
    unitName: 'lamalibre-app-fx.service',
    dataDir: '/var/lib/lamalibre/apps/fx',
  });
  assert.equal(await lib.installedVersionApproved(plugin), false);

  await lib.approveHookSet(plugin, status.approval.digest, actor);
  const approved = await lib.hookStatus(plugin);
  assert.equal(approved.approval.state, 'approved');
  assert.equal(approved.runner.current, false); // no relay hooks, no runner
  assert.equal(await lib.installedVersionApproved(plugin), true);
  assert.deepEqual(runnerCalls, []);
});

test('install refuses an agent half without a sha512 integrity, unpublished, or unversionable', async () => {
  const cases = [
    { name: 'gx', value: null, error: /has no integrity/ },
    { name: 'kx', value: 'sha1-2jmj7l5rSw0yVb/vlWAYkK/YBwk=', error: /sha1 integrity/ },
    { name: 'mx', value: 'sha512-tooShort==', error: /malformed integrity/ },
    { name: 'nx', value: undefined, error: /not published on the registry/ },
  ];
  for (const c of cases) {
    const pkg = `@lamalibre/${c.name}-server`;
    await npm.publish(pkg, '1.0.0', {
      'lamaste-plugin.json': JSON.stringify({
        ...fxManifest('1.0.0'),
        name: c.name,
        agent: agentBlock(`@lamalibre/${c.name}-agent`),
      }),
    });
    await npm.setIntegrity(`@lamalibre/${c.name}-agent@1.0.0`, c.value);
    await assert.rejects(lib.installPlugin(pkg, logger), (err) => {
      assert.equal(err.statusCode, 400, c.name);
      assert.match(err.message, c.error);
      return true;
    });
    // Nothing stays behind: no row, no package.
    assert.equal(await lib.findPlugin(c.name), null);
    await assert.rejects(
      stat(path.join(stateDir, 'node_modules', '@lamalibre', `${c.name}-server`)),
    );
  }

  // A plugin version with build metadata cannot version an agent half.
  await npm.publish('@lamalibre/bx-server', '1.0.0', {
    'lamaste-plugin.json': JSON.stringify({
      ...fxManifest('1.0.0+build.7'),
      name: 'bx',
      agent: agentBlock('@lamalibre/bx-agent'),
    }),
  });
  await assert.rejects(
    lib.installPlugin('@lamalibre/bx-server', logger),
    /cannot version an agent half/,
  );

  // Only an exact version is pinned — never a dist-tag that moves.
  await assert.rejects(
    lib.readRegistryIntegrity('@lamalibre/fx-agent', 'latest'),
    /Invalid version/,
  );
});

test('an update whose agent half changed waits for approval and is pinned again when applied', async () => {
  await npm.publish(PKG, '1.1.0', { 'lamaste-plugin.json': JSON.stringify(fxManifest('1.1.0')) });
  await npm.setIntegrity(`${AGENT_PKG}@1.1.0`, integrity('fx-agent-1.1.0'));
  const before = await lib.hookStatus(await lib.findPlugin('fx'));

  const staged = await lib.updatePlugin('fx', '1.1.0', actor);
  assert.ok(staged.pendingUpdate, 'a new agent half waits for approval');
  assert.notEqual(staged.pendingUpdate.digest, before.approval.digest);
  assert.equal(staged.pendingUpdate.relay, null);
  assert.equal(staged.pendingUpdate.agentHalf.version, '1.1.0');
  assert.equal(staged.pendingUpdate.agentHalf.integrity, integrity('fx-agent-1.1.0'));
  assert.equal(staged.pendingUpdate.agentHalf.dataDir, '/var/lib/lamalibre/apps/fx');
  const shown = await lib.hookStatus(await lib.findPlugin('fx'));
  // The update response and the hook status show a pending update alike.
  assert.deepEqual(staged.pendingUpdate, shown.pendingUpdate);
  assert.deepEqual(Object.keys(shown.pendingUpdate).sort(), [
    'agentHalf',
    'autoApproveWithheld',
    'digest',
    'relay',
    'settings',
    'stagedAt',
    'version',
  ]);
  assert.equal(shown.pendingUpdate.autoApproveWithheld, null);
  // Neither version declares settings.
  assert.equal(shown.pendingUpdate.settings, null);
  assert.equal(shown.approval.state, 'approved', 'the installed version stays approved and live');

  // The registry's tarball is republished between review and approval:
  // the digest no longer matches, nothing is applied.
  await npm.setIntegrity(`${AGENT_PKG}@1.1.0`, integrity('fx-agent-1.1.0-republished'));
  await assert.rejects(
    lib.updatePlugin('fx', '1.1.0', { ...actor, approvedDigest: staged.pendingUpdate.digest }),
    (err) => err.statusCode === 409 && /no longer brings what was approved/.test(err.message),
  );
  assert.equal((await lib.findPlugin('fx')).version, '1.0.0');

  // Reviewed again and approved: applied (not hosted, so no agent is involved).
  const again = await lib.updatePlugin('fx', '1.1.0', actor);
  const plugin = await lib.findPlugin('fx');
  const approved = await lib.approveHookSet(plugin, again.pendingUpdate.digest, actor);
  assert.equal(approved.target, 'update');
  const { operation } = await lib.updatePlugin('fx', '1.1.0', {
    ...actor,
    approvedDigest: again.pendingUpdate.digest,
  });
  const done = await lib.waitForPluginOperation('fx');
  assert.equal(done.id, operation.id);
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  const updated = await lib.findPlugin('fx');
  assert.equal(updated.version, '1.1.0');
  assert.deepEqual(updated.agentHalfPin, {
    package: AGENT_PKG,
    version: '1.1.0',
    integrity: integrity('fx-agent-1.1.0-republished'),
  });
  const after = await lib.hookStatus(updated);
  assert.equal(after.approval.state, 'approved');
  assert.equal(after.approval.approvedDigest, again.pendingUpdate.digest);
  assert.equal(after.pendingUpdate, null);
  assert.ok(npm.calls().some((c) => c.args[0] === 'view' && c.args[1] === `${AGENT_PKG}@1.1.0`));
});

test('relay hooks and an agent half: one approval digest; the runner holds the relay set alone', async () => {
  await npm.publish(HX_PKG, '1.0.0', {
    'lamaste-plugin.json': JSON.stringify(hxManifest('1.0.0')),
    'hooks/relay.mjs': MODULE,
  });
  await npm.setIntegrity(`${HX_AGENT}@1.0.0`, integrity('hx-agent-1.0.0'));
  await lib.installPlugin(HX_PKG, logger);
  const plugin = await lib.findPlugin('hx');
  const status = await lib.hookStatus(plugin);
  const relaySet = relayHookSetOf({ hooks: plugin.hooks });
  const relayDigest = relayHookSetDigest(relaySet, plugin.hooksEntrySha256);
  assert.equal(status.relay.digest, relayDigest);
  assert.equal(
    status.approval.digest,
    approvalDigest({
      relay: { set: relaySet, entrySha256: plugin.hooksEntrySha256 },
      agentHalf: lib.installedAgentHalf(plugin),
    }),
  );
  assert.notEqual(status.approval.digest, relayDigest);

  // The relay set's digest alone does not approve what the plugin brings.
  await assert.rejects(lib.approveHookSet(plugin, relayDigest, actor), (err) => {
    assert.equal(err.statusCode, 409);
    assert.equal(err.currentDigest, status.approval.digest);
    return true;
  });
  assert.deepEqual(runnerCalls, []);

  await lib.approveHookSet(plugin, status.approval.digest, actor);
  let now = await lib.hookStatus(plugin);
  assert.equal(now.approval.state, 'approved');
  assert.equal(now.runner.installedDigest, relayDigest);
  assert.equal(now.runner.current, true);
  assert.deepEqual(runnerCalls, [['install', 'hx', plugin.hooksEntrySha256, MODULE]]);

  // A new version that changes only the agent half: its approval digest
  // differs (auto-approved here), the runner's set does not.
  await lib.setAutoApprove('hx', true, actor);
  await npm.publish(HX_PKG, '1.0.1', {
    'lamaste-plugin.json': JSON.stringify(hxManifest('1.0.1')),
    'hooks/relay.mjs': MODULE,
  });
  await npm.setIntegrity(`${HX_AGENT}@1.0.1`, integrity('hx-agent-1.0.1'));
  runnerCalls.length = 0;
  const { operation } = await lib.updatePlugin('hx', '1.0.1', actor);
  assert.ok(operation);
  const done = await lib.waitForPluginOperation('hx');
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  const updated = await lib.findPlugin('hx');
  now = await lib.hookStatus(updated);
  assert.equal(now.approval.state, 'approved');
  assert.equal(now.approval.approvedBy, 'auto-approve');
  assert.notEqual(now.approval.digest, status.approval.digest);
  assert.equal(now.runner.installedDigest, relayDigest, 'same relay module, same runner set');
  assert.equal(now.runner.current, true);
  const audit = await lib.listAudit({ plugin: 'hx', action: 'hooks.approved' });
  assert.equal(audit[0].actor, 'auto-approve');
  assert.equal(audit[0].details.digest, now.approval.digest);

  // Reconciling at start-up finds the runner current under the new approval.
  runnerCalls.length = 0;
  await lib.reconcileRelayHooks([updated], logger);
  assert.deepEqual(runnerCalls, []);

  // Without auto-approve the next version waits, and the update response
  // shows it as the hook status does: the relay set under `relay`, the
  // agent half under `agentHalf`.
  await lib.setAutoApprove('hx', false, actor);
  await npm.publish(HX_PKG, '1.0.2', {
    'lamaste-plugin.json': JSON.stringify(hxManifest('1.0.2')),
    'hooks/relay.mjs': MODULE,
  });
  await npm.setIntegrity(`${HX_AGENT}@1.0.2`, integrity('hx-agent-1.0.2'));
  const staged = await lib.updatePlugin('hx', '1.0.2', actor);
  assert.equal(staged.pendingUpdate.version, '1.0.2');
  assert.equal(staged.pendingUpdate.relay.digest, relayDigest);
  assert.equal(staged.pendingUpdate.agentHalf.version, '1.0.2');
  assert.equal(staged.pendingUpdate.agentHalf.dataDir, '/var/lib/lamalibre/apps/hx');
  assert.equal('preview' in staged.pendingUpdate, false);
  const waiting = await lib.hookStatus(await lib.findPlugin('hx'));
  assert.deepEqual(staged.pendingUpdate, waiting.pendingUpdate);
});

test('an invalid manifest is a 400 at install and at update, whichever zod copy validated it', async () => {
  // core validates with its own zod; serverd must not depend on that being the
  // same copy as its own (a workspace holds two) — it checks core's error class.
  const bad = { ...fxManifest('1.0.0'), name: 'iv', hosting: 'nowhere' };
  await npm.publish('@lamalibre/iv-server', '1.0.0', {
    'lamaste-plugin.json': JSON.stringify(bad),
  });
  await assert.rejects(lib.installPlugin('@lamalibre/iv-server', logger), (err) => {
    assert.equal(err.statusCode, 400);
    assert.match(err.message, /^Invalid plugin manifest: /);
    return true;
  });
  assert.equal(await lib.findPlugin('iv'), null);

  await npm.publish(PKG, '1.9.0', {
    'lamaste-plugin.json': JSON.stringify({ ...fxManifest('1.9.0'), hosting: 'nowhere' }),
  });
  await assert.rejects(lib.updatePlugin('fx', '1.9.0', actor), (err) => {
    assert.equal(err.statusCode, 400);
    assert.match(err.message, /^Invalid plugin manifest in 1\.9\.0: /);
    return true;
  });
});

test('routes are unique: a plugin whose route another installed plugin holds is refused', async () => {
  // A server plugin named "fx-server" would take route "fx" — fx's.
  await npm.publish('@lamalibre/fxs-server', '1.0.0', {
    'lamaste-plugin.json': JSON.stringify({ name: 'fx-server', version: '1.0.0' }),
  });
  await assert.rejects(lib.installPlugin('@lamalibre/fxs-server', logger), (err) => {
    assert.equal(err.statusCode, 409);
    assert.equal(err.code, 'route_taken');
    assert.equal(err.route, 'fx');
    assert.equal(err.owner, 'fx');
    return true;
  });
  assert.equal(await lib.findPlugin('fx-server'), null);
  await assert.rejects(stat(path.join(stateDir, 'node_modules', '@lamalibre', 'fxs-server')));
  assert.equal((await lib.findPluginByRoute('fx')).name, 'fx');
  assert.equal((await lib.findPlugin('fx')).route, 'fx');

  // A plugin with an agent half is named by its route.
  await npm.publish('@lamalibre/qx-server', '1.0.0', {
    'lamaste-plugin.json': JSON.stringify({
      ...fxManifest('1.0.0'),
      name: 'qx-agent',
      agent: agentBlock('@lamalibre/qx-agent'),
    }),
  });
  await npm.setIntegrity('@lamalibre/qx-agent@1.0.0', integrity('qx-agent-1.0.0'));
  await assert.rejects(
    lib.installPlugin('@lamalibre/qx-server', logger),
    (err) => err.statusCode === 400 && /named by its route/.test(err.message),
  );

  // The unique index backs the rule: a registry written with a shared route fails whole.
  const before = await lib.readPlugins();
  await assert.rejects(
    lib.writePlugins({
      plugins: [
        ...before.plugins,
        { ...before.plugins[0], name: 'fx-agent', route: 'fx', packageName: '@lamalibre/y' },
      ],
    }),
    /UNIQUE/,
  );
  assert.deepEqual(
    (await lib.readPlugins()).plugins.map((p) => p.name).sort(),
    before.plugins.map((p) => p.name).sort(),
  );
});

test('auto-approve covers a new version of the same agent half, not new system packages or another service', async () => {
  const base = lib.installedAgentHalf(await lib.findPlugin('fx'));
  const next = (over) => ({ ...base, version: '9.9.9', integrity: integrity('next'), ...over });
  assert.deepEqual(lib.autoApproveWithheld(base, next({})), []);
  assert.deepEqual(lib.autoApproveWithheld(base, next({ systemPackages: [] })), []);
  assert.deepEqual(lib.autoApproveWithheld(base, null), []);
  assert.deepEqual(lib.autoApproveWithheld(null, base), [
    'it brings an agent half Lamaste installs',
  ]);
  assert.deepEqual(lib.autoApproveWithheld(base, next({ systemPackages: ['curl', 'sqlite3'] })), [
    'it adds system packages (curl)',
  ]);
  assert.match(
    lib.autoApproveWithheld(
      base,
      next({ service: { entry: 'dist/other.js', memoryMax: '256M' } }),
    )[0],
    /service entry changes/,
  );
  assert.match(
    lib.autoApproveWithheld(
      base,
      next({ service: { entry: 'dist/agentd.js', memoryMax: null } }),
    )[0],
    /memory limit changes \(256M → none\)/,
  );
  assert.match(
    lib.autoApproveWithheld(base, next({ package: '@lamalibre/fy-agent' }))[0],
    /agent package changes/,
  );

  // Through an update: auto-approve on, a version adding a system package waits.
  await lib.setAutoApprove('fx', true, actor);
  const withCurl = (version) => ({
    ...fxManifest(version),
    agent: {
      ...agentBlock(AGENT_PKG),
      requires: { os: ['linux'], node: '>=22', systemPackages: ['sqlite3', 'curl'] },
    },
  });
  await npm.publish(PKG, '1.2.0', { 'lamaste-plugin.json': JSON.stringify(withCurl('1.2.0')) });
  await npm.setIntegrity(`${AGENT_PKG}@1.2.0`, integrity('fx-agent-1.2.0'));
  const staged = await lib.updatePlugin('fx', '1.2.0', actor);
  assert.ok(staged.pendingUpdate, 'waits for an administrator despite auto-approve');
  assert.deepEqual(staged.pendingUpdate.autoApproveWithheld, ['it adds system packages (curl)']);
  const [withheld] = await lib.listAudit({ plugin: 'fx', action: 'hooks.auto-approve.withheld' });
  assert.equal(withheld.actor, 'auto-approve');
  assert.equal(withheld.details.version, '1.2.0');
  assert.deepEqual(withheld.details.reasons, ['it adds system packages (curl)']);
  assert.equal((await lib.findPlugin('fx')).version, '1.1.0');

  // A version that only moves version and tarball is auto-approved.
  await npm.publish(PKG, '1.2.1', { 'lamaste-plugin.json': JSON.stringify(fxManifest('1.2.1')) });
  await npm.setIntegrity(`${AGENT_PKG}@1.2.1`, integrity('fx-agent-1.2.1'));
  const { operation } = await lib.updatePlugin('fx', '1.2.1', actor);
  assert.ok(operation);
  const done = await lib.waitForPluginOperation('fx');
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  const status = await lib.hookStatus(await lib.findPlugin('fx'));
  assert.equal(status.approval.approvedBy, 'auto-approve');
  assert.equal(status.approval.approvedVersion, '1.2.1');
  await lib.setAutoApprove('fx', false, actor);
});

test('an update that adds a confidential OIDC client shows its secret once, on the finished operation', async () => {
  // ox: agent-hosted, its agent half installed by hand — nothing to approve,
  // so an update applies at once. Authelia is not here: the sync is replaced.
  const OX_PKG = '@lamalibre/ox-server';
  const oxManifest = (version, oidcClients = []) => ({
    name: 'ox',
    version,
    hosting: 'agent',
    agent: {},
    oidcClients,
  });
  await npm.publish(OX_PKG, '1.0.0', {
    'lamaste-plugin.json': JSON.stringify(oxManifest('1.0.0')),
  });
  await lib.installPlugin(OX_PKG, logger);
  const created = [{ id: 'ox-service', plugin: 'ox', secret: 's3cr3t'.repeat(8) }];
  const syncs = [];
  lib.setOidcSyncForTests(async () => {
    syncs.push((await lib.findPlugin('ox')).version);
    return { changed: true, clients: ['ox-service'], createdSecrets: created };
  });
  try {
    const service = {
      id: 'ox-service',
      confidential: true,
      grantTypes: ['client_credentials'],
      scopes: ['ox_read'],
    };
    await npm.publish(OX_PKG, '1.1.0', {
      'lamaste-plugin.json': JSON.stringify(oxManifest('1.1.0', [service])),
    });
    const { operation } = await lib.updatePlugin('ox', '1.1.0', actor);
    const done = await lib.waitForPluginOperation('ox');
    assert.equal(done.status, 'succeeded', JSON.stringify(done));
    assert.deepEqual(syncs, ['1.1.0'], 'synced once the new version is in place');
    // Never in the stored operation.
    assert.equal(JSON.stringify(done).includes(created[0].secret), false);

    // The operation read that follows it to its end carries the secret, once.
    const { default: Fastify } = await import('fastify');
    const { default: errors } = await import('../src/middleware/errors.js');
    const { default: pluginRoutes } = await import('../src/routes/management/plugins.js');
    const app = Fastify({ logger: false });
    await app.register(errors);
    app.decorateRequest('certRole', null);
    app.addHook('onRequest', async (request) => {
      request.certRole = 'admin';
    });
    app.decorate('requireRole', () => async () => {});
    await app.register(pluginRoutes, { prefix: '/api' });
    await app.ready();
    try {
      const list = await app.inject({ method: 'GET', url: '/api/plugins/ox/operations' });
      assert.equal(list.statusCode, 200);
      assert.equal(list.body.includes(created[0].secret), false, 'never in the list');
      const url = `/api/plugins/ox/operations/${operation.id}`;
      const first = await app.inject({ method: 'GET', url });
      assert.equal(first.statusCode, 200);
      assert.deepEqual(first.json().operation.oidcClients, [
        { id: 'ox-service', secret: created[0].secret },
      ]);
      const second = await app.inject({ method: 'GET', url });
      assert.equal(second.json().operation.oidcClients, undefined, 'shown once');
      assert.equal(second.json().operation.status, 'succeeded');
    } finally {
      await app.close();
    }
  } finally {
    lib.setOidcSyncForTests(null);
  }
});
