/**
 * Slice 6, approval of a plugin's identity block: the block enters the
 * approval digest when present (an identity-only plugin needs approval; a
 * plugin without one keeps its digest), it is stored normalized with the
 * plugin's row, and an update that adds or removes a role or widens the
 * attributes waits for an administrator with the reason `identity.changed`
 * — which auto-approve never covers — while narrowing the attributes or
 * editing labels only changes the digest. The pending update shows the
 * identity change. npm is a stand-in (`fake-npm.js`).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { approvalDigest, normalizeIdentityBlock } from '@lamalibre/lamaste';

import { installFakeNpm } from './fake-npm.js';

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const actor = { actor: 'admin', certSerial: '0A1B', logger };

const VIEWER = { id: 'viewer', label: 'Viewer' };
const EDITOR = { id: 'editor', label: 'Editor' };

const manifest = (name, version, identity) => ({
  name,
  version,
  hosting: 'agent',
  agent: {},
  ...(identity ? { identity } : {}),
});

let dir;
let npm;
let lib;

async function publish(name, version, identity) {
  await npm.publish(`@lamalibre/${name}-server`, version, {
    'lamaste-plugin.json': JSON.stringify(manifest(name, version, identity)),
  });
}

/** Stage `version`; when it runs, wait for it. */
async function update(name, version) {
  const result = await lib.updatePlugin(name, version, { ...actor, sourceIp: '127.0.0.1' });
  if (result.operation) {
    const done = await lib.waitForPluginOperation(name);
    assert.equal(done.status, 'succeeded', JSON.stringify(done));
  }
  return result;
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-s6-approval-'));
  const stateDir = path.join(dir, 'state');
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
    ...(await import('../src/lib/gatekeeper-client.js')),
    ...(await import('../src/lib/plugins.js')),
    ...(await import('../src/lib/plugin-hooks.js')),
    ...(await import('../src/lib/plugin-lifecycle.js')),
    ...(await import('../src/lib/plugin-operations.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/identity-sync.js')),
  };
  await lib.loadConfig();
  lib.setOidcSyncForTests(async () => null);
  // No Gatekeeper: audiences keep what they have (nothing here).
  lib.setGatekeeperClientForTests(async () => ({
    ok: false,
    statusCode: 503,
    error: 'gatekeeper unreachable',
    reason: 'unreachable',
  }));
});

after(async () => {
  await lib.identityIdle();
  lib.setOidcSyncForTests(null);
  lib.setGatekeeperClientForTests(null);
  await rm(dir, { recursive: true, force: true });
});

test('an identity block alone needs approval; it is stored normalized and enters the digest', async () => {
  await publish('ax', '1.0.0', { roles: [VIEWER] });
  const entry = await lib.installPlugin('@lamalibre/ax-server', logger);
  const block = normalizeIdentityBlock({ roles: [VIEWER] });
  assert.deepEqual(entry.identity, block, 'attributes defaulted to displayName');
  const plugin = await lib.findPlugin('ax');
  assert.deepEqual(plugin.identity, { roles: [VIEWER], attributes: ['displayName'] });

  const approval = lib.installedApproval(plugin);
  assert.equal(approval.required, true);
  assert.equal(approval.relay, null);
  assert.equal(approval.agentHalf, null);
  assert.equal(approval.digest, approvalDigest({ relay: null, agentHalf: null, identity: block }));
  const status = await lib.hookStatus(plugin);
  assert.equal(status.approval.state, 'pending');
  assert.deepEqual(status.identity, { declared: true, approved: false, block });
  assert.equal(await lib.installedVersionApproved(plugin), false);

  await lib.approveHookSet(plugin, approval.digest, actor);
  assert.equal(await lib.installedVersionApproved(plugin), true);
  assert.equal((await lib.hookStatus(plugin)).identity.approved, true);

  // Without identity: nothing to approve, as before.
  await publish('bx', '1.0.0', null);
  await lib.installPlugin('@lamalibre/bx-server', logger);
  const bx = await lib.findPlugin('bx');
  assert.equal(bx.identity, undefined);
  assert.deepEqual(lib.installedApproval(bx).required, false);
  assert.deepEqual((await lib.hookStatus(bx)).identity, {
    declared: false,
    approved: false,
    block: null,
  });
});

test('a role added waits with identity.changed, which auto-approve never covers', async () => {
  await lib.setAutoApprove('ax', true, actor);
  await publish('ax', '1.1.0', { roles: [VIEWER, EDITOR] });
  const staged = await update('ax', '1.1.0');
  assert.ok(staged.pendingUpdate, 'waits despite auto-approve');
  const pending = staged.pendingUpdate;
  assert.deepEqual(
    pending.approvalRequired.map((r) => r.code),
    ['digest.unapproved', 'identity.changed'],
  );
  assert.equal(pending.approvalRequired[0].reason, 'its identity is not what was approved');
  assert.match(pending.approvalRequired[1].reason, /adds roles \(editor\)/);
  assert.deepEqual(pending.autoApproveWithheld, [pending.approvalRequired[1].reason]);
  assert.deepEqual(pending.identity, {
    before: { roles: [VIEWER], attributes: ['displayName'] },
    after: { roles: [EDITOR, VIEWER], attributes: ['displayName'] },
    rolesAdded: ['editor'],
    rolesRemoved: [],
    attributesAdded: [],
    attributesRemoved: [],
    labelsChanged: [],
  });
  assert.equal((await lib.findPlugin('ax')).version, '1.0.0');
  const [withheld] = await lib.listAudit({ plugin: 'ax', action: 'hooks.auto-approve.withheld' });
  assert.deepEqual(withheld.details.codes, ['identity.changed']);
  // The hook status shows the pending update the same way.
  const shown = (await lib.hookStatus(await lib.findPlugin('ax'))).pendingUpdate;
  assert.deepEqual(shown.identity, pending.identity);

  // An administrator approves it: the version goes in, its block with it.
  const approved = await lib.approveHookSet(await lib.findPlugin('ax'), pending.digest, {
    ...actor,
    version: '1.1.0',
  });
  assert.equal(approved.target, 'update');
  await lib.updatePlugin('ax', approved.version, {
    ...actor,
    sourceIp: '127.0.0.1',
    approvedUpdate: approved,
  });
  assert.equal((await lib.waitForPluginOperation('ax')).status, 'succeeded');
  const plugin = await lib.findPlugin('ax');
  assert.equal(plugin.version, '1.1.0');
  assert.deepEqual(
    plugin.identity.roles.map((r) => r.id),
    ['editor', 'viewer'],
  );
  assert.equal(await lib.installedVersionApproved(plugin), true);
});

test('a role removed, or an attribute widened, waits too', async () => {
  await publish('ax', '1.2.0', { roles: [VIEWER, EDITOR], attributes: ['displayName', 'email'] });
  const widened = await update('ax', '1.2.0');
  assert.deepEqual(
    widened.pendingUpdate.approvalRequired.map((r) => r.code),
    ['digest.unapproved', 'identity.changed'],
  );
  assert.match(
    widened.pendingUpdate.approvalRequired[1].reason,
    /receives more about its users \(email\)/,
  );
  assert.deepEqual(widened.pendingUpdate.identity.attributesAdded, ['email']);

  await publish('ax', '1.2.1', { roles: [VIEWER] });
  const removed = await update('ax', '1.2.1');
  assert.deepEqual(
    removed.pendingUpdate.approvalRequired.map((r) => r.code),
    ['digest.unapproved', 'identity.changed'],
  );
  assert.match(removed.pendingUpdate.approvalRequired[1].reason, /removes roles \(editor\)/);
  assert.equal((await lib.findPlugin('ax')).version, '1.1.0');
  await lib.setPendingUpdate('ax', null);
});

test('narrowing the attributes or editing a label only changes the digest: auto-approve covers it', async () => {
  await publish('ax', '1.3.0', {
    roles: [VIEWER, { id: 'editor', label: 'Düzenleyici', description: 'Changes the figures' }],
  });
  const relabelled = await update('ax', '1.3.0');
  assert.ok(relabelled.operation, 'auto-approved');
  let status = await lib.hookStatus(await lib.findPlugin('ax'));
  assert.equal(status.approval.approvedBy, 'auto-approve');
  assert.equal(status.approval.approvedVersion, '1.3.0');
  assert.equal(status.approval.state, 'approved');

  await publish('ax', '1.4.0', {
    roles: [VIEWER, { id: 'editor', label: 'Düzenleyici', description: 'Changes the figures' }],
    attributes: [],
  });
  const narrowed = await update('ax', '1.4.0');
  assert.ok(narrowed.operation);
  const plugin = await lib.findPlugin('ax');
  assert.deepEqual(plugin.identity.attributes, []);
  status = await lib.hookStatus(plugin);
  assert.equal(status.approval.approvedVersion, '1.4.0');

  // Without auto-approve, a label edit waits — for its digest alone.
  await lib.setAutoApprove('ax', false, actor);
  await publish('ax', '1.5.0', {
    roles: [VIEWER, { id: 'editor', label: 'Editor', description: 'Changes the figures' }],
    attributes: [],
  });
  const waiting = await update('ax', '1.5.0');
  assert.deepEqual(
    waiting.pendingUpdate.approvalRequired.map((r) => r.code),
    ['digest.unapproved'],
  );
  assert.deepEqual(waiting.pendingUpdate.identity.labelsChanged, ['editor']);
  await lib.setPendingUpdate('ax', null);
});

test('a version that brings identity where there was none waits, auto-approve or not', async () => {
  await lib.setAutoApprove('bx', true, actor);
  await publish('bx', '1.1.0', { roles: [VIEWER] });
  const staged = await update('bx', '1.1.0');
  assert.ok(staged.pendingUpdate);
  assert.deepEqual(
    staged.pendingUpdate.approvalRequired.map((r) => r.code),
    ['digest.unapproved', 'identity.changed'],
  );
  assert.equal(staged.pendingUpdate.identity.before, null);
  assert.deepEqual(staged.pendingUpdate.identity.rolesAdded, ['viewer']);
  assert.equal((await lib.findPlugin('bx')).identity, undefined);

  // Dropping it again needs nothing: no role is added, nothing widened, and
  // the version without identity has nothing to approve.
  await lib.setPendingUpdate('bx', null);
  await lib.setAutoApprove('bx', false, actor);
});
