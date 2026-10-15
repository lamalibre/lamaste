/**
 * The agent's side of hosting an agent-hosted plugin (4.3): the config
 * files of hosted plugins follow the relay's `appPlugins` — fetched when the
 * relay issues a secret the agent does not hold, acknowledged, removed when
 * the relay no longer lists the plugin — and the agent half's verifier picks
 * a rotated secret up from the file without a restart.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let home;
let agent; // @lamalibre/lamaste/agent, imported once HOME points at the sandbox
let core;

const LABEL = 'vm1';

before(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'lamaste-app-plugins-'));
  process.env.HOME = home;
  agent = await import('@lamalibre/lamaste/agent');
  core = await import('@lamalibre/lamaste');
});

after(async () => {
  await rm(home, { recursive: true, force: true });
});

function fakePanel(issued, calls) {
  return {
    async fetchPluginConfig(route) {
      calls.push(['fetch', route]);
      const config = issued[route];
      if (!config) throw new Error(`no config for ${route}`);
      return config;
    },
    async acknowledgePluginConfig(route, issuedAt) {
      calls.push(['ack', route, issuedAt]);
    },
  };
}

test('sync: first delivery fetches and acknowledges; an unchanged relay view does nothing', async () => {
  const secret = core.generateHostingSecret();
  const issued = { app: { plugin: 'app', port: 21000, secret, issuedAt: 't1' } };
  const calls = [];
  const warnings = [];
  const first = await agent.syncAppPluginConfigs(
    LABEL,
    [{ route: 'app', port: 21000, secretIssuedAt: 't1', secretAcknowledged: false }],
    fakePanel(issued, calls),
    warnings,
  );
  assert.deepEqual(first, { fetched: ['app'], acknowledged: ['app'], removed: [] });
  assert.deepEqual(calls, [
    ['fetch', 'app'],
    ['ack', 'app', 't1'],
  ]);
  assert.deepEqual(warnings, []);
  const file = agent.appPluginConfigPath(LABEL, 'app');
  assert.equal(((await stat(file)).mode & 0o777).toString(8), '600');
  const stored = await agent.loadAppPluginConfig(LABEL, 'app');
  assert.equal(stored.secret, secret);
  assert.equal(stored.acknowledged, true);

  calls.length = 0;
  const second = await agent.syncAppPluginConfigs(
    LABEL,
    [{ route: 'app', port: 21000, secretIssuedAt: 't1', secretAcknowledged: true }],
    fakePanel(issued, calls),
    warnings,
  );
  assert.deepEqual(second, { fetched: [], acknowledged: [], removed: [] });
  assert.deepEqual(calls, []);
});

test('sync: a relay that lost the acknowledgement gets it again; a rotation is fetched with the previous secret', async () => {
  const stored = await agent.loadAppPluginConfig(LABEL, 'app');
  const calls = [];
  const warnings = [];
  const reack = await agent.syncAppPluginConfigs(
    LABEL,
    [{ route: 'app', port: 21000, secretIssuedAt: 't1', secretAcknowledged: false }],
    fakePanel({}, calls),
    warnings,
  );
  assert.deepEqual(reack, { fetched: [], acknowledged: ['app'], removed: [] });
  assert.deepEqual(calls, [['ack', 'app', 't1']]);

  const next = core.generateHostingSecret();
  const issued = {
    app: {
      plugin: 'app',
      port: 21000,
      secret: next,
      issuedAt: 't2',
      previousSecret: stored.secret,
      previousIssuedAt: 't1',
    },
  };
  calls.length = 0;
  const rotated = await agent.syncAppPluginConfigs(
    LABEL,
    [{ route: 'app', port: 21000, secretIssuedAt: 't2', secretAcknowledged: false }],
    fakePanel(issued, calls),
    warnings,
  );
  assert.deepEqual(rotated, { fetched: ['app'], acknowledged: ['app'], removed: [] });
  const after = await agent.loadAppPluginConfig(LABEL, 'app');
  assert.equal(after.secret, next);
  assert.equal(after.previousSecret, stored.secret);
  assert.equal(after.issuedAt, 't2');
});

test('sync: one failing plugin is a warning, the others proceed; an unlisted plugin loses its file', async () => {
  const issued = {
    other: { plugin: 'other', port: 21001, secret: core.generateHostingSecret(), issuedAt: 'o1' },
  };
  const calls = [];
  const warnings = [];
  const result = await agent.syncAppPluginConfigs(
    LABEL,
    [
      { route: 'missing', port: 21002, secretIssuedAt: 'm1', secretAcknowledged: false },
      { route: 'other', port: 21001, secretIssuedAt: 'o1', secretAcknowledged: false },
    ],
    fakePanel(issued, calls),
    warnings,
  );
  assert.deepEqual(result, { fetched: ['other'], acknowledged: ['other'], removed: ['app'] });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /"missing"/);
  assert.equal(await agent.loadAppPluginConfig(LABEL, 'app'), null);
  assert.deepEqual(await agent.listAppPluginConfigs(LABEL), ['other']);

  const parsed = agent.parseAppPluginAssignments(
    [{ route: 'ok', port: 1, secretIssuedAt: 'x' }, { route: 'Bad Route', port: 1 }, 'junk'],
    warnings,
  );
  assert.deepEqual(parsed, [
    { route: 'ok', port: 1, secretIssuedAt: 'x', secretAcknowledged: false },
  ]);
  assert.equal(warnings.length, 3);
});

test('verifier: reads the port, verifies, refuses replays, reloads a rotated secret', async () => {
  const s1 = core.generateHostingSecret();
  await agent.saveAppPluginConfig(LABEL, {
    plugin: 'v',
    port: 21005,
    secret: s1,
    issuedAt: 'v1',
    fetchedAt: 'now',
    acknowledged: true,
  });
  const verifier = agent.createCallerAssertionVerifier({
    configPath: agent.appPluginConfigPath(LABEL, 'v'),
    plugin: 'v',
    reloadIntervalMs: 0,
  });
  assert.equal(await verifier.port(), 21005);
  const sign = (withSecret, path = '/admin/x') =>
    core.signCallerAssertion(
      { plugin: 'v', caller: { type: 'admin' }, method: 'GET', path },
      withSecret,
    );

  const h1 = sign(s1);
  const ok = await verifier.verify({ [core.CALLER_ASSERTION_HEADER]: h1 }, 'GET', '/admin/x');
  assert.equal(ok.ok, true);
  const replay = await verifier.verify({ [core.CALLER_ASSERTION_HEADER]: h1 }, 'GET', '/admin/x');
  assert.equal(replay.reason, 'replayed');
  const elsewhere = await verifier.verify(
    { [core.CALLER_ASSERTION_HEADER]: sign(s1) },
    'POST',
    '/admin/x',
  );
  assert.equal(elsewhere.reason, 'wrong_request');

  // Rotation: the agent rewrote the file; the verifier notices on the next signature it cannot verify.
  const s2 = core.generateHostingSecret();
  await agent.saveAppPluginConfig(LABEL, {
    plugin: 'v',
    port: 21005,
    secret: s2,
    issuedAt: 'v2',
    previousSecret: s1,
    previousIssuedAt: 'v1',
    fetchedAt: 'now',
    acknowledged: false,
  });
  const fresh = await verifier.verify(
    { [core.CALLER_ASSERTION_HEADER]: sign(s2) },
    'GET',
    '/admin/x',
  );
  assert.equal(fresh.ok, true);
  const old = await verifier.verify(
    { [core.CALLER_ASSERTION_HEADER]: sign(s1) },
    'GET',
    '/admin/x',
  );
  assert.equal(old.ok, true, 'the previous secret is still accepted during the rotation');
  const stranger = await verifier.verify(
    { [core.CALLER_ASSERTION_HEADER]: sign(core.generateHostingSecret()) },
    'GET',
    '/admin/x',
  );
  assert.equal(stranger.reason, 'bad_signature');
  const foreign = await verifier.verify(
    {
      [core.CALLER_ASSERTION_HEADER]: core.signCallerAssertion(
        { plugin: 'w', caller: { type: 'admin' }, method: 'GET', path: '/admin/x' },
        s2,
      ),
    },
    'GET',
    '/admin/x',
  );
  assert.equal(foreign.reason, 'wrong_plugin');
});
