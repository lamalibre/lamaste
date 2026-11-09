/**
 * An agent half's request body limit (`agent.maxBodySizeMb`, 4.12): the
 * manifest declares it within 1–100 MiB, the approval covers it when
 * declared — a plugin that declares none keeps the digest it had — an
 * update shows it before and after, and auto-approve never stands in for
 * an administrator when it rises. npm is a stand-in (`fake-npm.js`).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { approvalDigest, agentHalfMaxBodyMb } from '@lamalibre/lamaste';

import { installFakeNpm } from './fake-npm.js';

const PKG = '@lamalibre/bl-server';
const AGENT_PKG = '@lamalibre/bl-agent';

const integrity = (seed) => `sha512-${crypto.createHash('sha512').update(seed).digest('base64')}`;

/** Plugin `bl`, its agent half installed by Lamaste, with `maxBodySizeMb` when given. */
const manifest = (version, maxBodySizeMb) => ({
  name: 'bl',
  version,
  hosting: 'agent',
  agent: {
    requires: { os: ['linux'], node: '>=22' },
    package: AGENT_PKG,
    service: { entry: 'dist/agentd.js' },
    ...(maxBodySizeMb === undefined ? {} : { maxBodySizeMb }),
  },
});

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const actor = { actor: 'admin', certSerial: '0A1B', logger };

let dir;
let npm;
let lib;

async function publish(version, maxBodySizeMb, pkg = PKG, name = 'bl') {
  await npm.publish(pkg, version, {
    'lamaste-plugin.json': JSON.stringify({ ...manifest(version, maxBodySizeMb), name }),
  });
  await npm.setIntegrity(
    `@lamalibre/${name}-agent@${version}`,
    integrity(`${name}-agent-${version}`),
  );
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-agent-half-body-limit-'));
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
    ...(await import('../src/lib/plugins.js')),
    ...(await import('../src/lib/plugin-hooks.js')),
    ...(await import('../src/lib/plugin-lifecycle.js')),
    ...(await import('../src/lib/plugin-operations.js')),
    ...(await import('../src/lib/audit.js')),
  };
  await lib.loadConfig();
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('a manifest declares a body limit of 1 to 100 MiB, a whole number', async () => {
  for (const [i, bad] of [0, 101, 2.5, '26', null].entries()) {
    const name = `bad${'abcde'[i]}`;
    const pkg = `@lamalibre/${name}-server`;
    await publish('1.0.0', bad, pkg, name);
    await assert.rejects(lib.installPlugin(pkg, logger), (err) => {
      assert.equal(err.statusCode, 400, JSON.stringify(bad));
      assert.match(err.message, /maxBodySizeMb|Expected number/, JSON.stringify(bad));
      return true;
    });
    assert.equal(await lib.findPlugin(name), null);
  }
});

test('without a declared limit: the default, and the digest of 4.11', async () => {
  await publish('1.0.0');
  await lib.installPlugin(PKG, logger);
  const plugin = await lib.findPlugin('bl');
  assert.equal(agentHalfMaxBodyMb(plugin), 10);
  const status = await lib.hookStatus(plugin);
  assert.deepEqual(status.body, { declared: false, maxBodySizeMb: 10 });
  assert.equal(
    status.approval.digest,
    approvalDigest({ relay: null, agentHalf: lib.installedAgentHalf(plugin) }),
  );
  await lib.approveHookSet(plugin, status.approval.digest, actor);
  await lib.setAutoApprove('bl', true, actor);
});

test('an update raising the limit waits for an administrator, auto-approve or not', async () => {
  await publish('1.1.0', 26);
  const staged = await lib.updatePlugin('bl', '1.1.0', actor);
  assert.ok(staged.pendingUpdate, 'auto-approve does not cover a limit that rises');
  const pending = staged.pendingUpdate;
  assert.deepEqual(pending.body, { before: 10, after: 26, declared: true });
  assert.deepEqual(pending.approvalRequired, [
    {
      code: 'digest.unapproved',
      reason: 'its agent half and request body limit are not what was approved',
    },
  ]);
  assert.deepEqual(pending.autoApproveWithheld, ['its request body limit rises (10 → 26 MiB)']);
  const [withheld] = await lib.listAudit({ plugin: 'bl', action: 'hooks.auto-approve.withheld' });
  assert.deepEqual(withheld.details.codes, ['body.raised']);

  // The digest covers the declared limit: the same agent half under another
  // limit is another digest.
  const spec = { ...lib.installedAgentHalf(await lib.findPlugin('bl')), version: '1.1.0' };
  spec.integrity = integrity('bl-agent-1.1.0');
  assert.equal(pending.digest, approvalDigest({ relay: null, agentHalf: spec, maxBodySizeMb: 26 }));
  assert.notEqual(
    pending.digest,
    approvalDigest({ relay: null, agentHalf: spec, maxBodySizeMb: 25 }),
  );
  assert.notEqual(pending.digest, approvalDigest({ relay: null, agentHalf: spec }));

  // The installed version stays live, with its limit, until it is approved.
  assert.equal(agentHalfMaxBodyMb(await lib.findPlugin('bl')), 10);
  const approved = await lib.approveHookSet(await lib.findPlugin('bl'), pending.digest, actor);
  await lib.updatePlugin('bl', '1.1.0', { ...actor, approvedUpdate: approved });
  const done = await lib.waitForPluginOperation('bl');
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  const updated = await lib.findPlugin('bl');
  assert.equal(updated.version, '1.1.0');
  assert.equal(agentHalfMaxBodyMb(updated), 26);
  const status = await lib.hookStatus(updated);
  assert.deepEqual(status.body, { declared: true, maxBodySizeMb: 26 });
  assert.equal(status.approval.state, 'approved');
});

test('a limit that stays or falls is covered by auto-approve', async () => {
  for (const [version, limit] of [
    ['1.2.0', 26],
    ['1.3.0', 20],
  ]) {
    await publish(version, limit);
    const { operation } = await lib.updatePlugin('bl', version, actor);
    assert.ok(operation, `${version} runs at once`);
    const done = await lib.waitForPluginOperation('bl');
    assert.equal(done.status, 'succeeded', JSON.stringify(done));
    assert.equal(agentHalfMaxBodyMb(await lib.findPlugin('bl')), limit);
  }

  // Dropping the declaration falls back to the default — lower, covered.
  await publish('1.4.0');
  const { operation } = await lib.updatePlugin('bl', '1.4.0', actor);
  assert.ok(operation);
  assert.equal((await lib.waitForPluginOperation('bl')).status, 'succeeded');
  assert.equal(agentHalfMaxBodyMb(await lib.findPlugin('bl')), 10);
});

test('a version bringing an agent half where there was none rises from the default: auto-approve withholds it', async () => {
  const pkg = '@lamalibre/io-server';
  // Identity only: no agent block, nothing to approve.
  await npm.publish(pkg, '1.0.0', {
    'lamaste-plugin.json': JSON.stringify({ name: 'io', version: '1.0.0', hosting: 'agent' }),
  });
  await lib.installPlugin(pkg, logger);
  await lib.setAutoApprove('io', true, actor);
  // Its next version adds an agent half installed by hand, declaring 100 MiB.
  await npm.publish(pkg, '1.1.0', {
    'lamaste-plugin.json': JSON.stringify({
      name: 'io',
      version: '1.1.0',
      hosting: 'agent',
      agent: { maxBodySizeMb: 100 },
    }),
  });
  const staged = await lib.updatePlugin('io', '1.1.0', actor);
  assert.ok(staged.pendingUpdate, 'waits for an administrator despite auto-approve');
  assert.deepEqual(staged.pendingUpdate.body, { before: null, after: 100, declared: true });
  assert.deepEqual(staged.pendingUpdate.autoApproveWithheld, [
    'its request body limit rises (10 → 100 MiB)',
  ]);
  assert.equal((await lib.findPlugin('io')).version, '1.0.0');
});
