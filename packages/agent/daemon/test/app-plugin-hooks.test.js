/**
 * Lifecycle hooks on the agent (4.3, slice 2b): the agent half answers
 * `POST /admin/hooks/<stage>` only for Lamaste; the sync runs the relay's
 * agent jobs on this machine's loopback (waiting while the agent half is not
 * up yet) and reports them; tunnel hooks follow the relay's view of the
 * tunnel once per change, and the panel out of reach counts as the tunnel
 * down.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let home;
let agent;
let core;
let half;
let halfPort;
let seen = [];

const LABEL = 'vm1';
const ROUTE = 'fx';

before(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'lamaste-app-plugin-hooks-'));
  process.env.HOME = home;
  agent = await import('@lamalibre/lamaste/agent');
  core = await import('@lamalibre/lamaste');

  // A free port for the agent half; its config file names it.
  halfPort = await new Promise((resolve) => {
    const probe = http.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
  await agent.saveAppPluginConfig(LABEL, {
    plugin: ROUTE,
    port: halfPort,
    secret: core.generateHostingSecret(),
    issuedAt: 't1',
    fetchedAt: new Date().toISOString(),
    acknowledged: true,
  });
});

after(async () => {
  half?.close();
  await rm(home, { recursive: true, force: true });
});

async function startHalf() {
  const verifier = agent.createCallerAssertionVerifier({
    configPath: agent.appPluginConfigPath(LABEL, ROUTE),
    plugin: ROUTE,
  });
  const handler = agent.createAgentHookHandler({
    verifier,
    hooks: {
      'install:pre-tunnel': (input) => {
        seen.push(['install:pre-tunnel', input.phase]);
        return input.outputs['relay:install:pre-tunnel'] === 'refuse'
          ? { ok: false, reason: 'no room' }
          : { ok: true, output: { migrated: 3 } };
      },
      'uninstall:post-teardown': () => {
        throw new Error('backup volume missing');
      },
      'tunnel:down': (input) => {
        seen.push(['tunnel:down', input.reason]);
      },
      'tunnel:up': () => {
        seen.push(['tunnel:up']);
      },
    },
  });
  half = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const out = await handler.handle({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: Buffer.concat(chunks),
    });
    res.writeHead(out.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out.body));
  });
  await new Promise((r) => half.listen(halfPort, '127.0.0.1', r));
}

function call(stage, input, caller = { type: 'lamaste' }) {
  return agent.loadAppPluginConfig(LABEL, ROUTE).then((config) => {
    const pathName = `/admin/hooks/${stage}`;
    const body = JSON.stringify({ stage, input });
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: halfPort,
          method: 'POST',
          path: pathName,
          headers: {
            'x-lamalibre-caller': core.signCallerAssertion(
              { plugin: ROUTE, caller, method: 'POST', path: pathName },
              config.secret,
            ),
            'content-type': 'application/json',
          },
        },
        (res) => {
          let text = '';
          res.on('data', (c) => (text += c));
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  });
}

const job = (stage, input = {}) => ({
  id: crypto.randomUUID(),
  route: ROUTE,
  kind: 'hook',
  stage,
  input: { plugin: ROUTE, phase: 'install', outputs: {}, ...input },
  timeoutMs: 2000,
  deadlineAt: new Date(Date.now() + 60_000).toISOString(),
});

test('jobs: deferred while the agent half is not up, run and reported once it is', async () => {
  const reports = [];
  const reporter = { reportJobResult: async (id, result) => reports.push([id, result]) };
  const warnings = [];
  const pre = job('install:pre-tunnel');
  let outcome = await agent.runAgentJobs(LABEL, [pre], reporter, warnings);
  assert.deepEqual(outcome, { ran: [], deferred: [pre.id] });
  assert.equal(reports.length, 0);

  await startHalf();
  outcome = await agent.runAgentJobs(LABEL, [pre], reporter, warnings);
  assert.deepEqual(outcome.ran, [pre.id]);
  assert.deepEqual(reports[0], [
    pre.id,
    { ok: true, decision: { ok: true, output: { migrated: 3 } } },
  ]);

  const refused = job('install:pre-tunnel', { outputs: { 'relay:install:pre-tunnel': 'refuse' } });
  const thrown = job('uninstall:post-teardown');
  await agent.runAgentJobs(LABEL, [refused, thrown], reporter, warnings);
  assert.deepEqual(reports[1][1], { ok: true, decision: { ok: false, reason: 'no room' } });
  assert.deepEqual(reports[2][1], {
    ok: true,
    decision: { ok: false, reason: 'backup volume missing' },
  });
  assert.deepEqual(warnings, []);
  assert.equal(agent.parseAgentJobs([{ id: 'x' }, pre], warnings).length, 1);
  assert.equal(warnings.length, 1);
});

test('agent half: only Lamaste may call a hook', async () => {
  const admin = await call(
    'install:pre-tunnel',
    { phase: 'install', outputs: {} },
    { type: 'admin' },
  );
  assert.equal(admin.status, 403);
  const agentCaller = await call('tunnel:down', { state: 'down' }, { type: 'agent', label: 'x' });
  assert.equal(agentCaller.status, 403);
  const missing = await call('install:post-tunnel', { phase: 'install', outputs: {} });
  assert.equal(missing.status, 404);
  const ok = await call('tunnel:up', { state: 'up', since: 'now' });
  assert.deepEqual(ok, { status: 200, body: { ok: true } });
});

test('tunnel hooks: one call per change of the relay view; panel loss counts as down', async () => {
  seen = [];
  const warnings = [];
  const assignment = (state, reason) => ({
    route: ROUTE,
    phase: 'active',
    health: { state, ...(reason ? { reason } : {}), since: new Date().toISOString() },
    agentHooks: [
      { stage: 'tunnel:down', timeoutMs: 2000 },
      { stage: 'tunnel:up', timeoutMs: 2000 },
    ],
  });
  // First seen up: nothing to tell.
  assert.deepEqual(await agent.syncAgentTunnelHooks(LABEL, [assignment('up')], warnings), []);
  // Down (tunnel): once.
  assert.deepEqual(
    await agent.syncAgentTunnelHooks(LABEL, [assignment('down', 'tunnel')], warnings),
    [ROUTE],
  );
  assert.deepEqual(
    await agent.syncAgentTunnelHooks(LABEL, [assignment('down', 'tunnel')], warnings),
    [],
  );
  // Same state, another reason: told again.
  assert.deepEqual(await agent.syncAgentTunnelHooks(LABEL, [assignment('down', 'app')], warnings), [
    ROUTE,
  ]);
  // Up: once.
  assert.deepEqual(await agent.syncAgentTunnelHooks(LABEL, [assignment('up')], warnings), [ROUTE]);
  // A hosting still being set up is left alone.
  const installing = { ...assignment('down', 'tunnel'), phase: 'installing' };
  assert.deepEqual(await agent.syncAgentTunnelHooks(LABEL, [installing], warnings), []);
  assert.deepEqual(seen, [['tunnel:down', 'tunnel'], ['tunnel:down', 'app'], ['tunnel:up']]);

  // The panel out of reach: not yet down after a minute, down after the window.
  seen = [];
  await agent.syncAgentTunnelHooks(LABEL, [assignment('up')], warnings);
  const recently = new Date(Date.now() - 30_000).toISOString();
  assert.deepEqual(await agent.agentTunnelHooksOnPanelLoss(LABEL, recently, warnings), []);
  const long = new Date(Date.now() - agent.PANEL_LOSS_DOWN_AFTER_MS - 1000).toISOString();
  assert.deepEqual(await agent.agentTunnelHooksOnPanelLoss(LABEL, long, warnings), [ROUTE]);
  assert.deepEqual(await agent.agentTunnelHooksOnPanelLoss(LABEL, long, warnings), []);
  assert.deepEqual(seen, [['tunnel:down', 'tunnel']]);
  // The panel back and the relay seeing it up: tunnel:up.
  assert.deepEqual(await agent.syncAgentTunnelHooks(LABEL, [assignment('up')], warnings), [ROUTE]);
  assert.deepEqual(warnings, []);
});
