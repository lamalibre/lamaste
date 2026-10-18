/**
 * Agent halves Lamaste installs (slice 3), the relay's pipelines and gates:
 * host facts reported by an agent, the hash of them agent-config tells it
 * (null when its record holds none), and the eligibility listing (an agent
 * must have pinned the key the relay signs with); app jobs in agent-config —
 * each signed by the relay for its agent — and their results checked per
 * kind; the install pipeline
 * installing the agent half between reserving and the agent's pre stage,
 * and a rollback removing it again; the uninstall pipeline removing it
 * (purged on request) before the secret is revoked; an update installing
 * the new agent half first and activating the previous one when a later
 * step fails; and the push-install gates and eligibility refusing a host
 * before anything runs. A plugin whose agent half is installed by hand is
 * hosted as before, ungated.
 *
 * The agent is played in-process (it reads its jobs and reports results as
 * its sync would); the internal tunnel's workflow is replaced (no chisel
 * here) and "the agent half through the tunnel" is a local HTTP server.
 */

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  APPHOST_PROTOCOL_VERSION,
  CALLER_ASSERTION_HEADER,
  NonceStore,
  RESPONDER_HEADER,
  hostFactsHash,
  parseRelayVerifyKey,
  pluginHostCapability,
  verifyAppJobSignature,
  verifyCallerAssertion,
} from '@lamalibre/lamaste';

import { installFakeNpm } from './fake-npm.js';

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const actor = { actor: 'admin', certSerial: '0A1B', logger };
const IP = '127.0.0.1';

const integrity = (seed) => `sha512-${crypto.createHash('sha512').update(seed).digest('base64')}`;

/** An Ubuntu agent with the helper; `relayKid` is set to the relay's key once it exists. */
const LINUX = {
  os: 'linux',
  arch: 'x64',
  distro: { id: 'ubuntu', idLike: ['debian'], versionId: '24.04' },
  node: '22.13.1',
  systemd: true,
  apphost: { version: APPHOST_PROTOCOL_VERSION, node: '22.13.1', relayKid: null },
};
/** The relay's signing key (its public half, as agents verify with it). */
let relayKey;
const MACOS = {
  os: 'darwin',
  arch: 'arm64',
  distro: null,
  node: '22.13.1',
  systemd: false,
  apphost: null,
};

const agentBlock = (route) => ({
  requires: { os: ['linux'], node: '>=22', systemPackages: ['sqlite3'] },
  package: `@lamalibre/${route}-agent`,
  service: { entry: 'dist/agentd.js' },
});

/** fx: an agent half with agent hooks; ux: an agent half only; hand: installed by hand (2a). */
const manifests = {
  fx: (version) => ({
    name: 'fx',
    version,
    hosting: 'agent',
    agent: agentBlock('fx'),
    hooks: {
      agent: { install: { 'pre-tunnel': {} }, uninstall: { 'post-teardown': {} } },
    },
  }),
  ux: (version) => ({ name: 'ux', version, hosting: 'agent', agent: agentBlock('ux') }),
  hand: (version) => ({ name: 'hand', version, hosting: 'agent', agent: {} }),
  zx: (version) => ({ name: 'zx', version, hosting: 'agent', agent: agentBlock('zx') }),
};

let dir;
let stateDir;
let npm;
let lib;
let half; // "the agent half through the tunnel"
let halfPort;
const halfCalls = [];
/** What happened, in order, across the fake agent and the fake half. */
const events = [];
let tunnelBehaviour = { failWait: false };
let app;

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
  );
}

async function enroll(label, extra = {}) {
  const registry = await lib.loadAgentRegistry();
  registry.agents.push({
    label,
    serial: crypto.randomBytes(8).toString('hex'),
    capabilities: ['tunnels:read'],
    allowedSites: [],
    enrollmentMethod: 'p12',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    revoked: false,
    ...extra,
  });
  await lib.saveAgentRegistry(registry);
}

/** How the default agent answers each job. */
function defaultAnswer(job) {
  switch (job.kind) {
    case 'hook':
      return { ok: true, decision: { ok: true } };
    case 'app-install':
      return { ok: true, app: { version: job.spec.version, unit: 'active' } };
    case 'app-activate':
      return { ok: true, app: { version: job.version, unit: 'active' } };
    case 'app-remove':
      return { ok: true, app: { version: null, unit: 'absent' } };
    default:
      throw new Error(`unexpected job ${job.kind}`);
  }
}

/**
 * Play agent `label`'s sync: read agent-config's jobs, answer each once.
 * `answer(job)` returns a result, `'expire'` (the agent never reports; the
 * job's deadline is brought forward), or undefined for the default.
 */
function startAgent(label, answer = () => undefined) {
  const jobs = [];
  const seen = new Set();
  let stopped = false;
  let timer;
  const tick = async () => {
    if (stopped) return;
    for (const job of await lib.pendingAgentJobs(label)) {
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      jobs.push(job);
      events.push(`job:${job.kind}${job.stage ? `:${job.stage}` : ''}`);
      const result = answer(job) ?? defaultAnswer(job);
      if (result === 'expire') {
        const db = await lib.getStateDb();
        db.prepare('UPDATE agent_jobs SET deadline_at = ? WHERE id = ?').run(
          new Date(Date.now() + 50).toISOString(),
          job.id,
        );
        continue;
      }
      await lib.completeAgentJob(label, job.id, result);
    }
    if (!stopped) timer = setTimeout(tick, 10);
  };
  timer = setTimeout(tick, 0);
  return {
    jobs,
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

let agent = null;
afterEach(() => {
  agent?.stop();
  agent = null;
  tunnelBehaviour = { failWait: false };
});

async function settle(name) {
  return lib.waitForPluginOperation(name);
}

const steps = (op) => op.steps.map((s) => [s.name, s.status]);
const stepIndex = (op, name) => op.steps.findIndex((s) => s.name === name);

async function approve(name) {
  const plugin = await lib.findPlugin(name);
  const status = await lib.hookStatus(plugin);
  if (status.approval.state === 'pending') {
    await lib.approveHookSet(plugin, status.approval.digest, actor);
  }
}

async function publish(name, version) {
  await npm.publish(`@lamalibre/${name}-server`, version, {
    'lamaste-plugin.json': JSON.stringify(manifests[name](version)),
  });
  if (name !== 'hand') {
    await npm.setIntegrity(`@lamalibre/${name}-agent@${version}`, integrity(`${name}-${version}`));
  }
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-agent-half-pipelines-'));
  stateDir = path.join(dir, 'state');
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
    ...(await import('../src/lib/state-db.js')),
    ...(await import('../src/lib/config.js')),
    ...(await import('../src/lib/mtls.js')),
    ...(await import('../src/lib/plugins.js')),
    ...(await import('../src/lib/plugin-hooks.js')),
    ...(await import('../src/lib/plugin-hosting.js')),
    ...(await import('../src/lib/plugin-lifecycle.js')),
    ...(await import('../src/lib/plugin-operations.js')),
    ...(await import('../src/lib/hook-pipelines.js')),
    ...(await import('../src/lib/agent-jobs.js')),
    ...(await import('../src/lib/push-install.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/retained-data.js')),
    ...(await import('../src/lib/relay-signing.js')),
    core: await import('@lamalibre/lamaste/server'),
  };
  await lib.loadConfig();
  const signing = await lib.relaySigner.current();
  relayKey = parseRelayVerifyKey({ kid: signing.kid, publicKey: signing.publicKey });
  LINUX.apphost.relayKid = signing.kid;

  // The agent half of whichever hosting signed the call: it verifies the
  // assertion (with its body) against the hostings' secrets and
  // authenticates its answer, as core's hook handler does.
  const nonces = new NonceStore();
  half = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      let verified = null;
      for (const record of Object.values(await lib.core.readPluginHostings(stateDir))) {
        const result = verifyCallerAssertion(req.headers[CALLER_ASSERTION_HEADER], {
          secrets: [lib.core.signingSecretFor(record)],
          plugin: record.plugin,
          method: req.method,
          path: req.url,
          nonces,
          body,
          requireBodyHash: true,
        });
        if (result.ok) verified = result;
      }
      if (!verified) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'caller assertion refused' }));
        return;
      }
      const stage = req.url.replace('/admin/hooks/', '');
      halfCalls.push(stage);
      events.push(`half:${stage}`);
      const text = JSON.stringify({ ok: true });
      res.writeHead(200, {
        'content-type': 'application/json',
        [RESPONDER_HEADER]: verified.responder(200, text),
      });
      res.end(text);
    });
  });
  halfPort = await listen(half);
  lib.setTunnelOpsForTests({
    async create(ctx) {
      return { id: `tunnel-${ctx.route}`, port: halfPort };
    },
    async enable() {},
    async remove() {},
    async waitForAgentHalf() {
      if (tunnelBehaviour.failWait) {
        throw new lib.StageFailure('The agent half did not answer through the tunnel');
      }
    },
  });

  await enroll('vm1');
  await enroll('mac1');
  await enroll('vm2'); // never reports host facts
  await lib.setAgentHostFacts('vm1', LINUX);
  await lib.setAgentHostFacts('mac1', MACOS);

  for (const name of ['fx', 'ux', 'hand']) {
    await publish(name, '1.0.0');
    await lib.installPlugin(`@lamalibre/${name}-server`, logger);
    await approve(name);
  }

  // Push install: on, and vm1's window open under the default policy.
  await lib.updatePushInstallConfigFields({ enabled: true });
  await lib.enableAgentPushInstall('vm1', 60);

  // The agents routes, behind stand-ins for the mTLS middleware and guard.
  const { default: Fastify } = await import('fastify');
  const { default: errors } = await import('../src/middleware/errors.js');
  const { default: agentsRoutes } = await import('../src/routes/management/agents.js');
  app = Fastify({ logger: false });
  await app.register(errors);
  app.decorateRequest('certRole', null);
  app.decorateRequest('certLabel', null);
  app.decorateRequest('certCapabilities', null);
  app.addHook('onRequest', async (request) => {
    request.certRole = request.headers['x-test-role'] ?? 'unknown';
    request.certLabel = request.headers['x-test-label'] ?? null;
    request.certCapabilities = (request.headers['x-test-caps'] ?? '').split(',').filter(Boolean);
  });
  app.decorate('requireRole', (roles) => async (request, reply) => {
    const role =
      request.certRole === 'plugin-agent' && roles.includes('agent') ? 'agent' : request.certRole;
    if (role === 'admin' || roles.includes(role)) return;
    return reply.code(403).send({ error: 'forbidden' });
  });
  const { default: pluginRoutes } = await import('../src/routes/management/plugins.js');
  const { default: tunnelRoutes } = await import('../src/routes/management/tunnels.js');
  await app.register(agentsRoutes, { prefix: '/api' });
  await app.register(pluginRoutes, { prefix: '/api' });
  await app.register(tunnelRoutes, { prefix: '/api' });
  await app.ready();
});

after(async () => {
  agent?.stop();
  lib.setTunnelOpsForTests(null);
  half?.close();
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Host facts and eligibility
// ---------------------------------------------------------------------------

test('host facts: only an agent certificate reports them; they land on its registry record', async () => {
  const put = (headers, payload) =>
    app.inject({ method: 'PUT', url: '/api/agents/me/host-facts', headers, payload });

  let res = await put({ 'x-test-role': 'admin' }, LINUX);
  assert.equal(res.statusCode, 403);
  res = await put({ 'x-test-role': 'plugin-agent', 'x-test-label': 'plugin-agent:vm1:x' }, LINUX);
  assert.equal(res.statusCode, 403);
  res = await put(
    { 'x-test-role': 'agent', 'x-test-label': 'vm2' },
    { ...LINUX, kernel: '6.8' }, // strict: unknown keys are refused
  );
  assert.equal(res.statusCode, 400);
  res = await put({ 'x-test-role': 'agent', 'x-test-label': 'ghost' }, LINUX);
  assert.equal(res.statusCode, 404);

  res = await put(
    { 'x-test-role': 'agent', 'x-test-label': 'vm2' },
    { ...LINUX, apphost: { version: 1, node: '20.11.0' } }, // no relayKid: refused
  );
  assert.equal(res.statusCode, 400);
  res = await put(
    { 'x-test-role': 'agent', 'x-test-label': 'vm2' },
    { ...LINUX, apphost: { ...LINUX.apphost, node: '20.11.0' } },
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });

  const listed = await lib.listAgentCerts();
  const vm2 = listed.find((a) => a.label === 'vm2');
  assert.deepEqual(vm2.hostFacts, { ...LINUX, apphost: { ...LINUX.apphost, node: '20.11.0' } });
  assert.ok(Date.parse(vm2.hostFactsAt) > 0);
  // Survives other writers of the registry, and the push-install window persists too.
  await lib.updateAgentCapabilities('vm2', ['tunnels:read']);
  const again = (await lib.loadAgentRegistry()).agents.find((a) => a.label === 'vm2');
  assert.deepEqual(again.hostFacts, vm2.hostFacts);
  const vm1 = (await lib.loadAgentRegistry()).agents.find((a) => a.label === 'vm1');
  assert.ok(Date.parse(vm1.pushInstallEnabledUntil) > Date.now());
  assert.equal(vm1.pushInstallPolicy, 'default');
  // An agent that never reported lists null, not an absent field.
  await enroll('vm3');
  assert.equal((await lib.listAgentCerts()).find((a) => a.label === 'vm3').hostFacts, null);
});

test('eligibility: listed per enrolled agent with reasons; a hand-installed half is unchecked', async () => {
  const agents = await lib.hostingEligibility('fx');
  const by = Object.fromEntries(agents.map((a) => [a.label, a]));
  assert.deepEqual(by.vm1, { label: 'vm1', eligible: true, reasons: [] });
  assert.equal(by.mac1.eligible, false);
  assert.ok(by.mac1.reasons.some((r) => /Linux/.test(r)));
  assert.equal(by.vm2.eligible, false);
  assert.ok(by.vm2.reasons.some((r) => /Node\.js >=22/.test(r)));
  assert.equal(by.vm3.eligible, false);
  assert.ok(by.vm3.reasons.some((r) => /not reported its host/.test(r)));
  assert.deepEqual(
    agents.map((a) => a.label),
    ['mac1', 'vm1', 'vm2', 'vm3'],
  );

  for (const a of await lib.hostingEligibility('hand')) {
    assert.deepEqual(a.reasons, []);
    assert.equal(a.eligible, true);
  }

  // The helper runs only what this relay signed: an agent that pinned
  // another key (the relay rotated) is told to pin again.
  await enroll('vm4');
  await lib.setAgentHostFacts('vm4', {
    ...LINUX,
    apphost: { ...LINUX.apphost, relayKid: 'cd'.repeat(16) },
  });
  const vm4 = (await lib.hostingEligibility('fx')).find((a) => a.label === 'vm4');
  assert.equal(vm4.eligible, false);
  assert.deepEqual(vm4.reasons, [
    `The agent's app host helper trusts relay key cdcdcdcdcdcd, but this relay signs with ${LINUX.apphost.relayKid.slice(0, 12)}; re-pin the relay key: sudo lamaste-agent apphost pin`,
  ]);
  await assert.rejects(
    lib.hostPlugin('fx', 'vm4', { ...actor, sourceIp: IP }),
    (err) => err.statusCode === 409 && /re-pin the relay key/.test(err.message),
  );
  // Out of the way of the tests below.
  const registry = await lib.loadAgentRegistry();
  registry.agents.find((a) => a.label === 'vm4').revoked = true;
  await lib.saveAgentRegistry(registry);
});

test('host facts: agent-config tells the agent the hash of those stored for it — null when none, never to an admin', async () => {
  const agentConfig = (headers, query = '') =>
    app.inject({ method: 'GET', url: `/api/tunnels/agent-config${query}`, headers });
  const sync = async (label) => {
    const res = await agentConfig({ 'x-test-role': 'agent', 'x-test-label': label });
    assert.equal(res.statusCode, 200);
    return res.json();
  };

  // What the agent computes over its own facts (core's root hostFactsHash).
  assert.equal((await sync('vm1')).hostFactsHash, hostFactsHash(LINUX));
  assert.equal((await sync('mac1')).hostFactsHash, hostFactsHash(MACOS));
  // Never reported: null, not an absent field — absent means a relay that does not say.
  const vm3 = await sync('vm3');
  assert.ok(Object.hasOwn(vm3, 'hostFactsHash'));
  assert.equal(vm3.hostFactsHash, null);

  // An administrator's ?agent= call is not the agent's own view; neither is a plugin-agent's.
  const admin = await agentConfig({ 'x-test-role': 'admin' }, '?agent=vm1');
  assert.equal(admin.statusCode, 200);
  assert.equal(admin.json().agentLabel, 'vm1');
  assert.equal(Object.hasOwn(admin.json(), 'hostFactsHash'), false);
  const domainOnly = await agentConfig({ 'x-test-role': 'admin' });
  assert.equal(Object.hasOwn(domainOnly.json(), 'hostFactsHash'), false);
  const pluginAgent = await agentConfig({
    'x-test-role': 'plugin-agent',
    'x-test-label': 'plugin-agent:vm1:x',
  });
  assert.equal(pluginAgent.statusCode, 200);
  assert.equal(Object.hasOwn(pluginAgent.json(), 'hostFactsHash'), false);

  // Enrolled again on its label: the new record holds none until the agent reports again.
  await enroll('vm5');
  await lib.setAgentHostFacts('vm5', LINUX);
  assert.equal((await sync('vm5')).hostFactsHash, hostFactsHash(LINUX));
  let registry = await lib.loadAgentRegistry();
  registry.agents.find((a) => a.label === 'vm5').revoked = true;
  await lib.saveAgentRegistry(registry);
  await enroll('vm5');
  assert.equal((await sync('vm5')).hostFactsHash, null);
  const put = await app.inject({
    method: 'PUT',
    url: '/api/agents/me/host-facts',
    headers: { 'x-test-role': 'agent', 'x-test-label': 'vm5' },
    payload: LINUX,
  });
  assert.equal(put.statusCode, 200);
  assert.equal((await sync('vm5')).hostFactsHash, hostFactsHash(LINUX));

  // Stored facts that no longer parse (another version wrote them) read as none.
  const db = await lib.getStateDb();
  db.prepare('UPDATE agents SET host_facts = ? WHERE label = ?').run(
    JSON.stringify({ ...LINUX, kernel: '6.8' }),
    'vm5',
  );
  assert.equal((await sync('vm5')).hostFactsHash, null);

  // Out of the way of the tests below.
  registry = await lib.loadAgentRegistry();
  registry.agents.find((a) => a.label === 'vm5').revoked = true;
  await lib.saveAgentRegistry(registry);
});

// ---------------------------------------------------------------------------
// App jobs
// ---------------------------------------------------------------------------

test('app jobs: agent-config lists them in the contract shape; results must fit the kind', async () => {
  const spec = lib.installedAgentHalf(await lib.findPlugin('ux'));
  const ids = {
    install: await lib.createAppJob({ agentLabel: 'vm9', plugin: 'ux', kind: 'app-install', spec }),
    activate: await lib.createAppJob({
      agentLabel: 'vm9',
      plugin: 'ux',
      kind: 'app-activate',
      version: '1.0.0',
      package: spec.package,
    }),
    remove: await lib.createAppJob({
      agentLabel: 'vm9',
      plugin: 'ux',
      kind: 'app-remove',
      purge: false,
      package: spec.package,
    }),
  };
  const listed = await lib.pendingAgentJobs('vm9');
  const by = Object.fromEntries(listed.map((j) => [j.id, j]));
  const keys = (j) => Object.keys(j).sort();
  assert.deepEqual(keys(by[ids.install]), [
    'deadlineAt',
    'id',
    'kind',
    'route',
    'signature',
    'spec',
    'timeoutMs',
  ]);
  assert.equal(by[ids.install].kind, 'app-install');
  assert.equal(by[ids.install].route, 'ux');
  assert.equal(by[ids.install].timeoutMs, 600_000);
  assert.deepEqual(by[ids.install].spec, spec);
  assert.deepEqual(keys(by[ids.activate]), [
    'deadlineAt',
    'id',
    'kind',
    'package',
    'route',
    'signature',
    'timeoutMs',
    'version',
  ]);
  assert.equal(by[ids.activate].timeoutMs, 120_000);
  assert.equal(by[ids.activate].version, '1.0.0');
  assert.equal(by[ids.activate].package, spec.package);
  assert.deepEqual(keys(by[ids.remove]), [
    'deadlineAt',
    'id',
    'kind',
    'package',
    'purge',
    'route',
    'signature',
    'timeoutMs',
  ]);
  assert.equal(by[ids.remove].timeoutMs, 300_000);
  assert.equal(by[ids.remove].purge, false);
  // Each is signed by the relay for its agent, route, id, kind, payload and deadline.
  const payloads = {
    install: { spec },
    activate: { version: '1.0.0', package: spec.package },
    remove: { purge: false, package: spec.package },
  };
  for (const [name, id] of Object.entries(ids)) {
    const job = by[id];
    const verified = verifyAppJobSignature(job.signature, { key: relayKey });
    assert.equal(verified.ok, true, name);
    assert.deepEqual(
      {
        agent: verified.envelope.agent,
        route: verified.envelope.route,
        jobId: verified.envelope.jobId,
        kind: verified.envelope.kind,
        payload: verified.envelope.payload,
        expiresAt: verified.envelope.expiresAt,
      },
      {
        agent: 'vm9',
        route: 'ux',
        jobId: id,
        kind: job.kind,
        payload: payloads[name],
        expiresAt: job.deadlineAt,
      },
    );
  }
  // Hook jobs carry none: the helper never sees them.
  const hookId = await lib.createAgentJob({
    agentLabel: 'vm9',
    plugin: 'ux',
    stage: 'install:pre-tunnel',
    input: {},
    timeoutMs: 1000,
  });
  const listedHook = (await lib.pendingAgentJobs('vm9')).find((j) => j.id === hookId);
  assert.equal(listedHook.signature, undefined);
  assert.equal(
    await lib.completeAgentJob('vm9', hookId, { ok: true, decision: { ok: true } }),
    'recorded',
  );
  // Deadline: the job's timeout plus delivery slack.
  assert.ok(
    Date.parse(by[ids.install].deadlineAt) - Date.now() >
      600_000 + lib.AGENT_JOB_DELIVERY_SLACK_MS - 5_000,
  );

  // Nothing unpinned or malformed becomes a job.
  await assert.rejects(
    lib.createAppJob({
      agentLabel: 'vm9',
      plugin: 'ux',
      kind: 'app-install',
      spec: { ...spec, integrity: 'sha1-x' },
    }),
  );
  await assert.rejects(
    lib.createAppJob({
      agentLabel: 'vm9',
      plugin: 'ux',
      kind: 'app-remove',
      package: spec.package,
    }),
    /purge/,
  );
  // A removal or activation names the package, so the helper never acts on another's.
  await assert.rejects(
    lib.createAppJob({ agentLabel: 'vm9', plugin: 'ux', kind: 'app-remove', purge: true }),
    /package/,
  );
  await assert.rejects(
    lib.createAppJob({ agentLabel: 'vm9', plugin: 'ux', kind: 'app-activate', version: '1.0.0' }),
    /package/,
  );
  await assert.rejects(
    lib.createAppJob({ agentLabel: 'vm9', plugin: 'ux', kind: 'app-upgrade', version: '1.0.0' }),
    /Unknown app job kind/,
  );

  // Results: a hook decision, a bad version, a multi-line error do not fit.
  assert.equal(
    await lib.completeAgentJob('vm9', ids.install, { ok: true, decision: { ok: true } }),
    'invalid',
  );
  assert.equal(
    await lib.completeAgentJob('vm9', ids.install, {
      ok: true,
      app: { version: '1.0.0+b', unit: 'active' },
    }),
    'invalid',
  );
  assert.equal(
    await lib.completeAgentJob('vm9', ids.install, { ok: false, error: 'two\nlines' }),
    'invalid',
  );
  assert.equal(
    await lib.completeAgentJob('vm9', ids.install, {
      ok: true,
      app: { version: '1.0.0', unit: 'active' },
    }),
    'recorded',
  );
  assert.deepEqual(await lib.waitForAgentJob(ids.install), {
    ok: true,
    app: { version: '1.0.0', unit: 'active' },
  });

  // Through the route: only the machine agent the job is for; the kind
  // decides the shape. An app job needs no host capability — purging the
  // data an agent half left runs after the hosting (and the capability)
  // is gone.
  const post = (id, payload, { caps = [pluginHostCapability('ux')], role = 'agent' } = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/agents/me/jobs/${id}/result`,
      headers: { 'x-test-role': role, 'x-test-label': 'vm9', 'x-test-caps': caps.join(',') },
      payload,
    });
  let res = await post(
    ids.activate,
    { ok: true, app: { version: '1.0.0', unit: 'active' } },
    { role: 'admin' },
  );
  assert.equal(res.statusCode, 403);
  const hookJob = await lib.createAgentJob({
    agentLabel: 'vm9',
    plugin: 'ux',
    stage: 'install:pre-tunnel',
    input: {},
    timeoutMs: 1000,
  });
  res = await post(hookJob, { ok: true, decision: { ok: true } }, { caps: [] });
  assert.equal(res.statusCode, 403, 'a hook job still needs the host capability');
  res = await post(ids.activate, { ok: true, decision: { ok: true } });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /An app job reports/);
  res = await post(ids.activate, { ok: true, app: { version: 'x', unit: 'active' } });
  assert.equal(res.statusCode, 400);
  res = await post(ids.activate, { ok: true, app: { version: '1.0.0', unit: 'active' } });
  assert.equal(res.statusCode, 200);
  res = await post(ids.activate, { ok: true, app: { version: '1.0.0', unit: 'active' } });
  assert.equal(res.statusCode, 409);
  res = await post(
    ids.remove,
    { ok: false, error: 'apt-get failed: sqlite3 not found' },
    { caps: [] },
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(await lib.waitForAgentJob(ids.remove), {
    ok: false,
    error: 'apt-get failed: sqlite3 not found',
  });
});

// ---------------------------------------------------------------------------
// Install and uninstall pipelines
// ---------------------------------------------------------------------------

test('install: the agent half goes on after reserving and before the agent pre stage', async () => {
  events.length = 0;
  agent = startAgent('vm1');
  const operation = await lib.hostPlugin('fx', 'vm1', { ...actor, sourceIp: IP });
  const done = await settle('fx');
  assert.equal(done.id, operation.id);
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  assert.deepEqual(steps(done), [
    ['relay install:pre-tunnel', 'skipped'],
    ['reserve port, secret and capability', 'done'],
    ['install the agent half', 'done'],
    ['agent install:pre-tunnel', 'done'],
    ['grant the tunnel and wait for the agent half', 'done'],
    ['agent install:post-tunnel', 'skipped'],
    ['relay install:post-tunnel', 'skipped'],
    ['activate', 'done'],
  ]);
  assert.deepEqual(events, ['job:app-install', 'job:hook:install:pre-tunnel']);
  const [install] = agent.jobs;
  assert.deepEqual(install.spec, lib.installedAgentHalf(await lib.findPlugin('fx')));

  const hosting = await lib.getHostingView('fx');
  assert.equal(hosting.phase, 'active');
  assert.equal(hosting.agentHalf.version, '1.0.0');
  const [audited] = await lib.listAudit({ plugin: 'fx', action: 'plugin.agent-half.installed' });
  assert.equal(audited.details.agentLabel, 'vm1');
  assert.equal(audited.details.version, '1.0.0');
  assert.equal(audited.details.integrity, integrity('fx-1.0.0'));
  assert.equal(audited.details.operation, operation.id);
  const sessions = await lib.readPushInstallSessions();
  const session = sessions.find((s) => s.operationId === operation.id);
  assert.equal(session.action, 'install');
  assert.equal(session.packageName, '@lamalibre/fx-agent');
  assert.equal(session.agentLabel, 'vm1');
});

test('uninstall: agent post-teardown, then the agent half (purged on request), then the secret', async () => {
  events.length = 0;
  agent = startAgent('vm1');
  const operation = await lib.unhostPlugin('fx', { ...actor, purge: true, sourceIp: IP });
  assert.deepEqual(operation.params, { force: false, purge: true });
  const done = await settle('fx');
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  const order = [
    'remove the tunnel',
    'agent uninstall:post-teardown',
    'remove the agent half',
    'revoke the secret and the capability',
  ].map((name) => stepIndex(done, name));
  assert.ok(
    order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])),
    JSON.stringify(steps(done)),
  );
  const remove = agent.jobs.find((j) => j.kind === 'app-remove');
  assert.equal(remove.purge, true);
  assert.deepEqual(events, ['job:hook:uninstall:post-teardown', 'job:app-remove']);
  assert.equal(await lib.getHostingView('fx'), null);
  const [audited] = await lib.listAudit({ plugin: 'fx', action: 'plugin.agent-half.removed' });
  assert.deepEqual(
    { version: audited.details.version, purge: audited.details.purge },
    { version: '1.0.0', purge: true },
  );
  const sessions = await lib.readPushInstallSessions();
  assert.equal(sessions.find((s) => s.operationId === operation.id).action, 'uninstall');

  // Hosted again and removed without purge: the data stays.
  agent.stop();
  agent = startAgent('vm1');
  await lib.hostPlugin('fx', 'vm1', { ...actor, sourceIp: IP });
  assert.equal((await settle('fx')).status, 'succeeded');
  await lib.unhostPlugin('fx', { ...actor, sourceIp: IP });
  assert.equal((await settle('fx')).status, 'succeeded');
  assert.equal(agent.jobs.filter((j) => j.kind === 'app-remove').at(-1).purge, false);
});

test('rollback: a failure after the agent half went on removes it again, keeping its data', async () => {
  // The agent half refuses its install:pre-tunnel stage.
  agent = startAgent('vm1', (job) =>
    job.kind === 'hook' ? { ok: true, decision: { ok: false, reason: 'no data dir' } } : undefined,
  );
  await lib.hostPlugin('fx', 'vm1', { ...actor, sourceIp: IP });
  let done = await settle('fx');
  assert.equal(done.status, 'failed');
  assert.match(done.error, /no data dir/);
  assert.deepEqual(
    steps(done).filter(([name]) => !name.startsWith('relay ')),
    [
      ['reserve port, secret and capability', 'done'],
      ['install the agent half', 'done'],
      ['agent install:pre-tunnel', 'failed'],
      ['remove the tunnel', 'done'],
      ['remove the agent half', 'done'],
      ['revoke the secret and the capability', 'done'],
    ],
  );
  assert.equal(agent.jobs.find((j) => j.kind === 'app-remove').purge, false);
  assert.equal(await lib.getHostingView('fx'), null);
  agent.stop();

  // The agent half never answers through the granted tunnel: rolled back.
  agent = startAgent('vm1');
  tunnelBehaviour.failWait = true;
  await lib.hostPlugin('fx', 'vm1', { ...actor, sourceIp: IP });
  done = await settle('fx');
  assert.equal(done.status, 'rolled-back');
  assert.equal(
    stepIndex(done, 'remove the agent half') > stepIndex(done, 'agent uninstall:post-teardown'),
    true,
  );
  assert.equal(done.steps.find((s) => s.name === 'remove the agent half').status, 'done');
  assert.equal(await lib.getHostingView('fx'), null);
});

test('rollback: once the install job went out, the agent half is removed whatever it reported', async () => {
  agent = startAgent('vm1', (job) =>
    job.kind === 'app-install' ? { ok: false, error: 'apt-get failed' } : undefined,
  );
  await lib.hostPlugin('ux', 'vm1', { ...actor, sourceIp: IP });
  let done = await settle('ux');
  assert.equal(done.status, 'failed');
  assert.match(done.error, /Installing the agent half failed: apt-get failed/);
  assert.equal(done.steps.find((s) => s.name === 'install the agent half').status, 'failed');
  // The agent may have left something: removal is idempotent and keeps data.
  assert.equal(done.steps.find((s) => s.name === 'remove the agent half').status, 'done');
  assert.equal(agent.jobs.find((j) => j.kind === 'app-remove').purge, false);
  assert.equal(await lib.getHostingView('ux'), null);
  // The helper reported its own failure: no data of this install to record.
  assert.deepEqual(await lib.retainedDataOf('ux'), []);
  // Nothing installed: nothing audited as installed.
  assert.equal(
    (await lib.listAudit({ plugin: 'ux', action: 'plugin.agent-half.installed' })).length,
    0,
  );
  agent.stop();

  agent = startAgent('vm1', (job) => (job.kind === 'app-install' ? 'expire' : undefined));
  await lib.hostPlugin('ux', 'vm1', { ...actor, sourceIp: IP });
  done = await settle('ux');
  assert.equal(done.status, 'failed');
  assert.match(done.error, /did not report the job before its deadline/);
  assert.equal(done.steps.find((s) => s.name === 'remove the agent half').status, 'done');
  assert.equal(agent.jobs.find((j) => j.kind === 'app-remove').purge, false);
  assert.equal(await lib.getHostingView('ux'), null);
  // An install that never reported may have left data: the relay keeps a record.
  const [kept] = await lib.retainedDataOf('ux');
  assert.deepEqual(
    { agentLabel: kept.agentLabel, route: kept.route, package: kept.package },
    { agentLabel: 'vm1', route: 'ux', package: '@lamalibre/ux-agent' },
  );

  // A unit the helper installed but could not start fails the step, and is removed.
  agent.stop();
  agent = startAgent('vm1', (job) =>
    job.kind === 'app-install'
      ? { ok: true, app: { version: job.spec.version, unit: 'inactive' } }
      : undefined,
  );
  await lib.hostPlugin('ux', 'vm1', { ...actor, sourceIp: IP });
  done = await settle('ux');
  assert.equal(done.status, 'failed');
  assert.match(done.error, /installed, but its service is inactive/);
  assert.equal(done.steps.find((s) => s.name === 'remove the agent half').status, 'done');
  // The install was not verified: not audited as installed.
  assert.equal(
    (await lib.listAudit({ plugin: 'ux', action: 'plugin.agent-half.installed' })).length,
    0,
  );
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

test('update: the new agent half first; a failure after the switch activates the previous one', async () => {
  agent = startAgent('vm1');
  await lib.hostPlugin('fx', 'vm1', { ...actor, sourceIp: IP });
  assert.equal((await settle('fx')).status, 'succeeded');
  await lib.setAutoApprove('fx', true, actor);
  await publish('fx', '1.1.0');
  await npm.failInstall('@lamalibre/fx-server@1.1.0');

  events.length = 0;
  const { operation } = await lib.updatePlugin('fx', '1.1.0', { ...actor, sourceIp: IP });
  let done = await settle('fx');
  assert.equal(done.id, operation.id);
  assert.equal(done.status, 'rolled-back', JSON.stringify(done));
  assert.deepEqual(
    steps(done).filter(([name]) => !name.startsWith('relay ')),
    [
      ['agent install:pre-tunnel', 'done'],
      ['install the new agent half', 'done'],
      ['install the new version', 'failed'],
      ['restore the previous version', 'done'],
      ['activate the previous agent half', 'done'],
    ],
  );
  // The agent's pre stage (through the tunnel) runs before the switch.
  assert.deepEqual(events, ['half:install:pre-tunnel', 'job:app-install', 'job:app-activate']);
  assert.equal(agent.jobs.at(-2).spec.version, '1.1.0');
  assert.equal(agent.jobs.at(-1).version, '1.0.0');
  assert.equal((await lib.getHostingView('fx')).agentHalf.version, '1.0.0');
  const plugin = await lib.findPlugin('fx');
  assert.equal(plugin.version, '1.0.0');
  assert.equal(plugin.agentHalfPin.integrity, integrity('fx-1.0.0'));
  const [activated] = await lib.listAudit({ plugin: 'fx', action: 'plugin.agent-half.activated' });
  assert.deepEqual(
    { version: activated.details.version, from: activated.details.from },
    { version: '1.0.0', from: '1.1.0' },
  );

  // The relay package installs: the update goes through on both sides.
  await npm.failInstall('@lamalibre/fx-server@1.1.0', false);
  events.length = 0;
  const second = await lib.updatePlugin('fx', '1.1.0', { ...actor, sourceIp: IP });
  done = await settle('fx');
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  assert.ok(
    stepIndex(done, 'install the new agent half') < stepIndex(done, 'install the new version'),
  );
  assert.deepEqual(events, ['half:install:pre-tunnel', 'job:app-install']);
  const updated = await lib.findPlugin('fx');
  assert.equal(updated.version, '1.1.0');
  assert.equal(updated.agentHalfPin.integrity, integrity('fx-1.1.0'));
  assert.equal((await lib.getHostingView('fx')).agentHalf.version, '1.1.0');
  const sessions = await lib.readPushInstallSessions();
  const session = sessions.find((s) => s.operationId === second.operation.id);
  assert.equal(session.action, 'update');
  assert.equal(session.packageName, '@lamalibre/fx-agent');

  // Who installs the agent half cannot change under a hosting.
  await npm.publish('@lamalibre/fx-server', '1.2.0', {
    'lamaste-plugin.json': JSON.stringify({
      ...manifests.fx('1.2.0'),
      agent: {},
      hooks: undefined,
    }),
  });
  await assert.rejects(
    lib.updatePlugin('fx', '1.2.0', { ...actor, sourceIp: IP }),
    /no longer has an agent half Lamaste installs/,
  );
  await lib.unhostPlugin('fx', { ...actor, sourceIp: IP });
  assert.equal((await settle('fx')).status, 'succeeded');
});

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

async function refusedHost(name, label, check) {
  await assert.rejects(lib.hostPlugin(name, label, { ...actor, sourceIp: IP }), (err) => {
    check(err);
    return true;
  });
  assert.equal(await lib.getHostingView(name), null);
}

test('gates: push install off, window closed, action or package or IP not allowed, agent not eligible', async () => {
  await lib.updatePushInstallConfigFields({ enabled: false });
  await refusedHost('ux', 'vm1', (err) => {
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, 'push_install_refused');
    assert.match(err.message, /not enabled globally/);
  });
  await lib.updatePushInstallConfigFields({ enabled: true });

  await lib.disableAgentPushInstall('vm1');
  await refusedHost('ux', 'vm1', (err) => {
    assert.equal(err.statusCode, 403);
    assert.equal(err.code, 'push_install_refused');
    assert.match(err.message, /not enabled for agent "vm1"/);
  });

  await lib.createPushInstallPolicy({
    id: 'updates-only',
    name: 'Updates only',
    allowedActions: ['update'],
  });
  await lib.enableAgentPushInstall('vm1', 60, 'updates-only');
  await refusedHost('ux', 'vm1', (err) => {
    assert.equal(err.statusCode, 403);
    assert.match(err.message, /Action "install" is not allowed/);
  });

  await lib.createPushInstallPolicy({
    id: 'other-package',
    name: 'Other package',
    allowedPlugins: ['@lamalibre/other-agent'],
  });
  await lib.enableAgentPushInstall('vm1', 60, 'other-package');
  await refusedHost('ux', 'vm1', (err) => {
    assert.equal(err.statusCode, 403);
    assert.match(err.message, /Package "@lamalibre\/ux-agent" is not allowed/);
  });

  await lib.createPushInstallPolicy({ id: 'no-loopback', name: 'No loopback', deniedIps: [IP] });
  await lib.enableAgentPushInstall('vm1', 60, 'no-loopback');
  await refusedHost('ux', 'vm1', (err) => {
    assert.equal(err.statusCode, 403);
    assert.match(err.message, /Source IP/);
  });

  await lib.enableAgentPushInstall('vm1', 60, 'default');
  await lib.enableAgentPushInstall('mac1', 60, 'default');
  await refusedHost('ux', 'mac1', (err) => {
    assert.equal(err.statusCode, 409);
    assert.equal(err.code, 'agent_not_eligible');
    assert.ok(err.reasons.some((r) => /Linux/.test(r)));
  });
  await refusedHost('ux', 'vm3', (err) => {
    assert.equal(err.code, 'agent_not_eligible');
    assert.ok(err.reasons.some((r) => /not reported its host/.test(r)));
  });

  // Removal is gated as `uninstall`: refused while the window is closed.
  agent = startAgent('vm1');
  await lib.hostPlugin('ux', 'vm1', { ...actor, sourceIp: IP });
  assert.equal((await settle('ux')).status, 'succeeded');
  await lib.disableAgentPushInstall('vm1');
  await assert.rejects(lib.unhostPlugin('ux', { ...actor, sourceIp: IP }), (err) => {
    assert.equal(err.statusCode, 403);
    assert.equal(err.code, 'push_install_refused');
    return true;
  });
  await assert.rejects(lib.uninstallPluginWithHosting('ux', { ...actor, sourceIp: IP }), (err) => {
    assert.equal(err.statusCode, 403);
    assert.equal(err.code, 'push_install_refused');
    return true;
  });
  assert.ok(await lib.getHostingView('ux'), 'nothing was removed');
  await lib.enableAgentPushInstall('vm1', 60);
});

test('removal: a revoked agent cannot be pushed to — the agent half is left for its operator', async () => {
  // ux is hosted on vm1 (previous test); vm1's certificate is revoked.
  const registry = await lib.loadAgentRegistry();
  registry.agents.find((a) => a.label === 'vm1').revoked = true;
  await lib.saveAgentRegistry(registry);
  agent = startAgent('vm1');
  await lib.unhostPlugin('ux', { ...actor, sourceIp: IP });
  const done = await settle('ux');
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  assert.equal(done.steps.find((s) => s.name === 'remove the agent half').status, 'skipped');
  assert.ok(done.warnings.some((w) => /sudo lamaste-agent apphost remove ux/.test(w)));
  assert.equal(await lib.getHostingView('ux'), null);
  assert.equal(
    agent.jobs.some((j) => j.kind === 'app-remove' && j.route === 'ux'),
    false,
  );
  // vm1 enrolled again for what follows.
  registry.agents.find((a) => a.label === 'vm1').revoked = false;
  await lib.saveAgentRegistry(registry);
  await lib.enableAgentPushInstall('vm1', 60);
});

test('a hand-installed agent half: no gates, no app jobs, purge refused (2a/2b unchanged)', async () => {
  await lib.updatePushInstallConfigFields({ enabled: false });
  agent = startAgent('vm2');
  await lib.hostPlugin('hand', 'vm2', { ...actor, sourceIp: IP });
  const done = await settle('hand');
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  assert.equal(stepIndex(done, 'install the agent half'), -1);
  assert.equal(agent.jobs.length, 0);
  assert.equal((await lib.getHostingView('hand')).agentHalf, null);
  const status = await lib.hookStatus(await lib.findPlugin('hand'));
  assert.equal(status.approval.required, false);
  assert.equal(status.agentHalf, null);

  await assert.rejects(
    lib.unhostPlugin('hand', { ...actor, purge: true, sourceIp: IP }),
    (err) => err.statusCode === 400 && /installed by hand/.test(err.message),
  );
  await lib.unhostPlugin('hand', { ...actor, sourceIp: IP });
  const removed = await settle('hand');
  assert.equal(removed.status, 'succeeded');
  assert.equal(stepIndex(removed, 'remove the agent half'), -1);
  await lib.updatePushInstallConfigFields({ enabled: true });

  // Uninstalling a plugin that is not hosted purges nothing: its retained
  // data has an operation of its own.
  await assert.rejects(
    lib.uninstallPluginWithHosting('ux', { ...actor, purge: true, sourceIp: IP }),
    (err) => err.statusCode === 400 && /is not hosted/.test(err.message),
  );
});

// ---------------------------------------------------------------------------
// Ownership and retained data
// ---------------------------------------------------------------------------

test('ownership: a hosting another plugin owns on the route is never read, changed or removed', async () => {
  // A record on ux's route that names another plugin as its owner.
  await lib.core.createPluginHosting(stateDir, {
    plugin: 'ux',
    pluginName: 'ux-legacy',
    agentLabel: 'vm1',
    port: halfPort,
    tunnelId: 'tunnel-foreign',
  });
  const ux = await lib.findPlugin('ux');
  assert.equal(await lib.getHostingView('ux'), null);
  assert.equal(await lib.isPluginHosted('ux'), false);
  assert.equal(await lib.ownHosting(ux), null);
  await assert.rejects(lib.unhostPlugin('ux', { ...actor, sourceIp: IP }), (err) => {
    assert.equal(err.statusCode, 404);
    return true;
  });
  await assert.rejects(lib.rotateHostingSecret('ux', logger), (err) => err.statusCode === 404);
  await assert.rejects(lib.hostPlugin('ux', 'vm1', { ...actor, sourceIp: IP }), (err) => {
    assert.equal(err.statusCode, 409);
    assert.equal(err.code, 'hosting_owner_mismatch');
    return true;
  });
  await lib.enablePlugin('ux', logger);
  assert.deepEqual(await lib.resolveForwardTarget('ux'), { kind: 'not_hosted' });
  await lib.disablePlugin('ux', logger);
  const [listed] = await lib.attachHostings([ux]);
  assert.equal(listed.agentHosting, null);

  // A teardown run for ux refuses the record instead of removing it.
  const { done } = await lib.startPluginOperation({
    plugin: 'ux',
    kind: 'unhost',
    actor: 'admin',
    logger,
    run: (op) => lib.teardownHosting(op, ux, { logger }),
  });
  const refused = await done;
  assert.equal(refused.status, 'failed');
  assert.match(refused.error, /belongs to plugin "ux-legacy", not "ux"/);
  assert.ok(await lib.core.getPluginHosting(stateDir, 'ux'), 'the record is untouched');
  await lib.core.removePluginHosting(stateDir, 'ux');

  // A record written before owners were kept belongs to the plugin named like the route.
  await lib.core.createPluginHosting(stateDir, {
    plugin: 'ux',
    pluginName: 'ux',
    agentLabel: 'vm1',
    port: halfPort,
    tunnelId: 'tunnel-legacy',
  });
  const file = path.join(stateDir, 'plugin-hostings.json');
  const { readFile } = await import('node:fs/promises');
  const store = JSON.parse(await readFile(file, 'utf-8'));
  delete store.ux.pluginName;
  await writeFile(file, JSON.stringify(store), { mode: 0o600 });
  const view = await lib.getHostingView('ux');
  assert.equal(view.pluginName, 'ux');
  await lib.core.removePluginHosting(stateDir, 'ux');
});

test('retained data: recorded on removal without purge, shown, taken back, purged later', async () => {
  // fx was last unhosted without purge (update test): vm1 keeps its data.
  let kept = await lib.retainedDataOf('fx');
  assert.deepEqual(
    kept.map((r) => [r.agentLabel, r.route, r.package]),
    [['vm1', 'fx', '@lamalibre/fx-agent']],
  );
  const [fxView] = await lib.attachHostings([await lib.findPlugin('fx')]);
  assert.equal(fxView.retainedData.length, 1);

  // Hosting fx there again takes the data back.
  agent = startAgent('vm1');
  await lib.hostPlugin('fx', 'vm1', { ...actor, sourceIp: IP });
  assert.equal((await settle('fx')).status, 'succeeded');
  assert.deepEqual(await lib.retainedDataOf('fx'), []);
  const [installed] = await lib.listAudit({ plugin: 'fx', action: 'plugin.agent-half.installed' });
  assert.equal(installed.details.retainedDataReused, true);

  // Data the plugin uses cannot be purged as retained.
  await lib.recordRetainedData({
    agentLabel: 'vm1',
    route: 'fx',
    plugin: 'fx',
    package: '@lamalibre/fx-agent',
  });
  await assert.rejects(
    lib.purgeRetainedData('fx', 'vm1', { ...actor, sourceIp: IP }),
    (err) => err.statusCode === 409 && err.code === 'retained_data_in_use',
  );
  await lib.forgetRetainedData('vm1', 'fx');
  await lib.unhostPlugin('fx', { ...actor, sourceIp: IP });
  assert.equal((await settle('fx')).status, 'succeeded');
  [kept] = await lib.retainedDataOf('fx');
  assert.equal(kept.agentLabel, 'vm1');

  // Purged later: an app-remove with purge, gated as `uninstall`, audited.
  agent.jobs.length = 0;
  const { operation } = await lib.purgeRetainedData('fx', 'vm1', { ...actor, sourceIp: IP });
  assert.equal(operation.kind, 'purge-data');
  const purged = await settle('fx');
  assert.equal(purged.status, 'succeeded', JSON.stringify(purged));
  assert.deepEqual(steps(purged), [['purge the retained data', 'done']]);
  const [job] = agent.jobs;
  assert.deepEqual([job.kind, job.route, job.purge], ['app-remove', 'fx', true]);
  assert.deepEqual(await lib.retainedDataOf('fx'), []);
  const [audited] = await lib.listAudit({ plugin: 'fx', action: 'plugin.agent-half.purged' });
  assert.equal(audited.details.agentLabel, 'vm1');
  const session = (await lib.readPushInstallSessions()).find((x) => x.operationId === operation.id);
  assert.deepEqual([session.action, session.packageName], ['uninstall', '@lamalibre/fx-agent']);
  await assert.rejects(
    lib.purgeRetainedData('fx', 'vm1', { ...actor, sourceIp: IP }),
    (err) => err.statusCode === 404,
  );

  // Gated: an agent without an open window is not pushed to.
  await lib.recordRetainedData({
    agentLabel: 'vm2',
    route: 'fx',
    plugin: 'fx',
    package: '@lamalibre/fx-agent',
  });
  await assert.rejects(
    lib.purgeRetainedData('fx', 'vm2', { ...actor, sourceIp: IP }),
    (err) => err.statusCode === 403 && err.code === 'push_install_refused',
  );
  // An agent that is gone cannot be pushed to: the record can only be forgotten.
  const registry = await lib.loadAgentRegistry();
  registry.agents.find((a) => a.label === 'vm2').revoked = true;
  await lib.saveAgentRegistry(registry);
  await assert.rejects(
    lib.purgeRetainedData('fx', 'vm2', { ...actor, sourceIp: IP }),
    (err) =>
      err.statusCode === 409 &&
      err.code === 'agent_not_enrolled' &&
      /lamaste-server plugins forget-data fx --agent vm2/.test(err.message),
  );
  const forgotten = await lib.purgeRetainedData('fx', 'vm2', {
    ...actor,
    sourceIp: IP,
    forget: true,
  });
  assert.equal(forgotten.forgotten.agentLabel, 'vm2');
  assert.deepEqual(await lib.retainedDataOf('fx'), []);
  assert.equal(
    (await lib.listAudit({ plugin: 'fx', action: 'plugin.agent-half.retained-data.forgotten' }))
      .length,
    1,
  );
  registry.agents.find((a) => a.label === 'vm2').revoked = false;
  await lib.saveAgentRegistry(registry);
});

test('retained data: another agent package is not installed over it', async () => {
  await lib.recordRetainedData({
    agentLabel: 'vm1',
    route: 'ux',
    plugin: 'ux',
    package: '@lamalibre/ux-old-agent',
  });
  await assert.rejects(lib.hostPlugin('ux', 'vm1', { ...actor, sourceIp: IP }), (err) => {
    assert.equal(err.statusCode, 409);
    assert.equal(err.code, 'retained_data_conflict');
    assert.equal(err.retained.package, '@lamalibre/ux-old-agent');
    assert.match(err.message, /purge that data first/);
    // The refusal names the panel and the CLI, not the raw API.
    assert.match(err.message, /lamaste-server plugins purge-data ux --agent vm1/);
    return true;
  });
  assert.equal(await lib.getHostingView('ux'), null);
  await lib.forgetRetainedData('vm1', 'ux');
});

test('retained data: the data of an uninstalled plugin stays on record and is purged by its name', async () => {
  await publish('zx', '1.0.0');
  await lib.installPlugin('@lamalibre/zx-server', logger);
  await approve('zx');
  agent = startAgent('vm1');
  await lib.hostPlugin('zx', 'vm1', { ...actor, sourceIp: IP });
  assert.equal((await settle('zx')).status, 'succeeded');
  const { operation } = await lib.uninstallPluginWithHosting('zx', { ...actor, sourceIp: IP });
  const done = await settle('zx');
  assert.equal(done.id, operation.id);
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  assert.equal(await lib.findPlugin('zx'), null);
  assert.deepEqual(
    (await lib.listRetainedData()).filter((r) => r.plugin === 'zx').map((r) => r.agentLabel),
    ['vm1'],
  );

  agent.jobs.length = 0;
  const purge = await lib.purgeRetainedData('zx', 'vm1', { ...actor, sourceIp: IP });
  const purged = await settle('zx');
  assert.equal(purged.id, purge.operation.id);
  assert.equal(purged.status, 'succeeded', JSON.stringify(purged));
  assert.deepEqual(
    agent.jobs.map((j) => [j.kind, j.route, j.purge]),
    [['app-remove', 'zx', true]],
  );
  assert.deepEqual(await lib.retainedDataOf('zx'), []);
});

test('retained data through the API: listed with the plugins, per plugin, forgotten or purged', async () => {
  await lib.recordRetainedData({
    agentLabel: 'vm1',
    route: 'ux',
    plugin: 'ux',
    package: '@lamalibre/ux-agent',
  });
  // Uninstalling with purge a plugin that is not hosted: refused, naming
  // where its retained data is purged — the panel and the CLI.
  await assert.rejects(
    lib.uninstallPluginWithHosting('ux', { ...actor, purge: true, sourceIp: IP }),
    (err) =>
      err.statusCode === 400 &&
      /\(vm1\) is purged per agent/.test(err.message) &&
      /lamaste-server plugins purge-data ux --agent <label>/.test(err.message),
  );
  const admin = { 'x-test-role': 'admin' };
  let res = await app.inject({ method: 'GET', url: '/api/plugins', headers: admin });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(
    body.retainedData.map((r) => [r.agentLabel, r.route, r.plugin, r.package]),
    [['vm1', 'ux', 'ux', '@lamalibre/ux-agent']],
  );
  const ux = body.plugins.find((p) => p.name === 'ux');
  assert.equal(ux.route, 'ux');
  assert.equal(ux.retainedData.length, 1);
  assert.ok(Date.parse(ux.retainedData[0].since) > 0);
  // What a purge deletes on the agent, for the panel's and the CLI's confirmations.
  assert.equal(ux.retainedData[0].dataDir, '/var/lib/lamalibre/apps/ux');
  assert.equal(ux.retainedData[0].serviceUser, 'lamaste-app-ux');

  res = await app.inject({ method: 'GET', url: '/api/plugins/ux/retained-data', headers: admin });
  assert.equal(res.json().retainedData[0].agentLabel, 'vm1');
  res = await app.inject({
    method: 'GET',
    url: '/api/plugins/ux/retained-data',
    headers: { 'x-test-role': 'agent', 'x-test-label': 'vm1' },
  });
  assert.equal(res.statusCode, 403);

  res = await app.inject({
    method: 'DELETE',
    url: '/api/plugins/ux/retained-data',
    headers: admin,
  });
  assert.equal(res.statusCode, 400, 'the agent is named');
  res = await app.inject({
    method: 'DELETE',
    url: '/api/plugins/ux/retained-data?agentLabel=vm1&forget=true',
    headers: admin,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().forgotten.package, '@lamalibre/ux-agent');
  res = await app.inject({
    method: 'DELETE',
    url: '/api/plugins/ux/retained-data?agentLabel=vm1',
    headers: admin,
  });
  assert.equal(res.statusCode, 404);

  // Purged through the API: 202 with the operation.
  await lib.recordRetainedData({
    agentLabel: 'vm1',
    route: 'ux',
    plugin: 'ux',
    package: '@lamalibre/ux-agent',
  });
  agent = startAgent('vm1');
  res = await app.inject({
    method: 'DELETE',
    url: '/api/plugins/ux/retained-data?agentLabel=vm1',
    headers: admin,
  });
  assert.equal(res.statusCode, 202);
  assert.equal(res.json().operation.kind, 'purge-data');
  assert.equal((await settle('ux')).status, 'succeeded');
  assert.deepEqual(await lib.retainedDataOf('ux'), []);
});
