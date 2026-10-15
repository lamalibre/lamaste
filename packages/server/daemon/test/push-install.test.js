/**
 * Push install as the admin surfaces operate it (hosting, updating and
 * removing an agent half Lamaste installs depend on it): the config reports
 * the bounds of an agent's window; the global switch and the default
 * policy; an agent's window opened within those bounds — refused outside
 * them with a message naming them, and while push install is off — for
 * any label enrolment allows, and closed again; and the agent list's
 * `status`, which the panel's badge and actions read.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DAY = 86_400_000;
const LONG_LABEL = `a${'b'.repeat(61)}c`; // 63 characters, the longest agent label

let dir;
let lib;
let app;

async function enroll(label, extra = {}) {
  const registry = await lib.loadAgentRegistry();
  registry.agents.push({
    label,
    serial: crypto.randomBytes(8).toString('hex'),
    capabilities: ['tunnels:read'],
    allowedSites: [],
    enrollmentMethod: 'p12',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 400 * DAY).toISOString(),
    revoked: false,
    ...extra,
  });
  await lib.saveAgentRegistry(registry);
}

const request = (method, url, payload) =>
  app.inject({ method, url: `/api${url}`, headers: { 'x-test-role': 'admin' }, payload });

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-push-install-'));
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = dir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = dir;
  process.env.LAMALIBRE_LAMASTE_PKI_DIR = path.join(dir, 'pki');
  lib = {
    ...(await import('../src/lib/mtls.js')),
    ...(await import('../src/lib/push-install.js')),
  };

  await enroll('vm1');
  await enroll(LONG_LABEL);
  await enroll('soon', { expiresAt: new Date(Date.now() + 10 * DAY).toISOString() });
  await enroll('old', { expiresAt: new Date(Date.now() - DAY).toISOString() });
  await enroll('gone', { revoked: true, revokedAt: new Date().toISOString() });

  // The plugin routes, behind stand-ins for the mTLS middleware and guard.
  const { default: Fastify } = await import('fastify');
  const { default: errors } = await import('../src/middleware/errors.js');
  const { default: pluginRoutes } = await import('../src/routes/management/plugins.js');
  app = Fastify({ logger: false });
  await app.register(errors);
  app.decorateRequest('certRole', null);
  app.decorateRequest('certLabel', null);
  app.addHook('onRequest', async (req) => {
    req.certRole = req.headers['x-test-role'] ?? 'unknown';
  });
  app.decorate('requireRole', (roles) => async (req, reply) => {
    if (req.certRole === 'admin' || roles.includes(req.certRole)) return;
    return reply.code(403).send({ error: 'forbidden' });
  });
  await app.register(pluginRoutes, { prefix: '/api' });
  await app.ready();
});

after(async () => {
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

test('the config: off by default, the default policy, and the bounds of a window', async () => {
  const res = await request('GET', '/plugins/push-install/config');
  assert.equal(res.statusCode, 200);
  const config = res.json();
  assert.equal(config.enabled, false);
  assert.equal(config.defaultPolicy, 'default');
  assert.deepEqual(config.windowMinutes, { min: 5, max: 480 });
  assert.deepEqual(config.windowMinutes, lib.PUSH_INSTALL_WINDOW_MINUTES);
  const policy = config.policies.find((p) => p.id === 'default');
  assert.ok(policy.allowedActions.includes('uninstall'), 'removing an agent half is a push too');
});

test('no window opens while push install is off', async () => {
  const res = await request('POST', '/plugins/push-install/enable/vm1', { durationMinutes: 30 });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /not enabled globally/);
  const vm1 = (await lib.loadAgentRegistry()).agents.find((a) => a.label === 'vm1');
  assert.equal(vm1.pushInstallEnabledUntil, undefined);
});

test('the global switch and the default policy', async () => {
  let res = await request('PATCH', '/plugins/push-install/config', { enabled: true });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().enabled, true);
  assert.deepEqual(res.json().windowMinutes, { min: 5, max: 480 });

  res = await request('PATCH', '/plugins/push-install/config', { defaultPolicy: 'nope' });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /Policy "nope" not found/);

  res = await request('POST', '/plugins/push-install/policies', {
    name: 'Installers',
    allowedActions: ['install'],
  });
  assert.equal(res.statusCode, 200, res.body);
  res = await request('PATCH', '/plugins/push-install/config', { defaultPolicy: 'installers' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().defaultPolicy, 'installers');
  res = await request('PATCH', '/plugins/push-install/config', { defaultPolicy: 'default' });
  assert.equal(
    (await request('GET', '/plugins/push-install/config')).json().defaultPolicy,
    'default',
  );
});

test('a window opens within the bounds, for any enrollable label, and closes again', async () => {
  // Outside the bounds, or not a whole number of minutes: refused, naming the bounds.
  for (const durationMinutes of [4, 481, 30.5, '30', undefined]) {
    const res = await request('POST', '/plugins/push-install/enable/vm1', { durationMinutes });
    assert.equal(res.statusCode, 400, `durationMinutes ${durationMinutes}`);
    const body = res.json();
    assert.equal(body.error, 'Validation failed');
    assert.deepEqual(body.details.issues[0].path, ['durationMinutes']);
    assert.match(body.details.issues[0].message, /open 5 to 480 minutes/);
  }

  const before = Date.now();
  let res = await request('POST', '/plugins/push-install/enable/vm1', { durationMinutes: 30 });
  assert.equal(res.statusCode, 200, res.body);
  let body = res.json();
  assert.equal(body.label, 'vm1');
  assert.equal(body.pushInstallPolicy, 'default', "the config's default policy");
  const until = Date.parse(body.pushInstallEnabledUntil);
  assert.ok(until >= before + 30 * 60_000 && until <= Date.now() + 30 * 60_000);

  // A policy named for the window; an unknown one is refused.
  res = await request('POST', '/plugins/push-install/enable/vm1', {
    durationMinutes: 480,
    policyId: 'installers',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().pushInstallPolicy, 'installers');
  res = await request('POST', '/plugins/push-install/enable/vm1', {
    durationMinutes: 5,
    policyId: 'nope',
  });
  assert.equal(res.statusCode, 404);

  // The longest label enrolment allows has a window like any other.
  res = await request('POST', `/plugins/push-install/enable/${LONG_LABEL}`, {
    durationMinutes: 5,
  });
  assert.equal(res.statusCode, 200, res.body);

  // Not an enrolled, unrevoked agent, or not an agent label at all.
  for (const label of ['ghost', 'gone']) {
    res = await request('POST', `/plugins/push-install/enable/${label}`, { durationMinutes: 5 });
    assert.equal(res.statusCode, 404, label);
  }
  res = await request('POST', '/plugins/push-install/enable/Bad_Label', { durationMinutes: 5 });
  assert.equal(res.statusCode, 400);

  // Listed with the agent, then closed.
  let listed = await lib.listAgentCerts();
  assert.equal(listed.find((a) => a.label === 'vm1').pushInstallPolicy, 'installers');
  assert.ok(Date.parse(listed.find((a) => a.label === 'vm1').pushInstallEnabledUntil) > Date.now());
  res = await request('DELETE', '/plugins/push-install/enable/vm1');
  assert.equal(res.statusCode, 200);
  body = res.json();
  assert.deepEqual(body, { ok: true, label: 'vm1' });
  listed = await lib.listAgentCerts();
  const vm1 = listed.find((a) => a.label === 'vm1');
  assert.equal(vm1.pushInstallEnabledUntil, undefined);
  assert.equal(vm1.pushInstallPolicy, undefined);
  const gate = await lib.validatePushInstallAccess('vm1', '127.0.0.1');
  assert.equal(gate.ok, false);
  assert.match(gate.error, /not enabled for agent "vm1"/);
});

test("the agent list sums each certificate up as `status` (the panel's badge and actions)", async () => {
  const status = Object.fromEntries((await lib.listAgentCerts()).map((a) => [a.label, a.status]));
  assert.deepEqual(status, {
    vm1: 'active',
    [LONG_LABEL]: 'active',
    soon: 'expiring-soon',
    old: 'expired',
    gone: 'revoked',
  });
});
