/**
 * Plugin settings on the relay (slice 4): the panel reads an agent-hosted
 * plugin's settings from its agent half through the internal tunnel — or,
 * while the hosting is offline, from its cache in state.db — and sends a
 * change there (`PUT /admin/settings`, caller `lamaste`) after checking it
 * against the installed schema. The agent half is core's real settings
 * store and handler over a temporary data directory, verifying Lamaste's
 * caller assertion with the hosting's real installation secret.
 *
 * Covered: live / cache / none; the round trip and its cache and audit
 * entry; validation messages without values; 409 (a running operation, the
 * agent half's revision and schema conflicts), 422, 502, 503 and their
 * codes; the cache re-read after a hosting, an update and the health coming
 * up, and dropped with the hosting and the plugin; relay hooks seeing the
 * effective non-secret values and agent hooks none; the update preview's
 * schema diff; agent presence written at most once a minute; and a
 * distinctive secret appearing in no response, log line, row or file of the
 * relay.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AGENT_HALF_SETTINGS_MAX_BYTES, RESPONDER_HEADER } from '@lamalibre/lamaste';
import {
  createCallerAssertionVerifier,
  createSettingsHandler,
  createSettingsStore,
} from '@lamalibre/lamaste/agent';
import { encodeFrame, readFrame } from '@lamalibre/lamaste/hooks';

import { installFakeNpm } from './fake-npm.js';

/** Distinctive enough to search every response, log line, row and file for. */
const SECRET = 'sk-relay-Zq9-DISTINCTIVE-SECRET-4471';
const TOKEN_SECRET = 'tok-relay-Wv2-DISTINCTIVE-TOKEN-0815';
/** A value typed into the wrong field — never repeated either. */
const MISPLACED = 'pw-relay-Kx7-DISTINCTIVE-MISPLACED-2290';

const IP = '127.0.0.1';
const integrity = (seed) => `sha512-${crypto.createHash('sha512').update(seed).digest('base64')}`;

const SETTINGS_V1 = {
  schemaVersion: 1,
  fields: [
    { key: 'apiKey', label: 'API key', type: 'secret', required: true },
    { key: 'token', label: 'Token', type: 'secret' },
    {
      key: 'schedule',
      label: 'Schedule',
      type: 'string',
      pattern: '^[0-9]{2}:[0-9]{2}$',
      default: '06:00',
    },
    { key: 'retries', label: 'Retries', type: 'integer', min: 0, max: 10, default: 3 },
    {
      key: 'region',
      label: 'Region',
      type: 'enum',
      required: true,
      options: [
        { value: 'eu', label: 'Europe' },
        { value: 'us', label: 'United States' },
      ],
    },
    { key: 'verbose', label: 'Verbose', type: 'boolean' },
  ],
};

/** v2: retries becomes a required string, verbose goes, endpoint is new and required. */
const SETTINGS_V2 = {
  schemaVersion: 2,
  fields: [
    SETTINGS_V1.fields[0],
    SETTINGS_V1.fields[1],
    SETTINGS_V1.fields[2],
    { key: 'retries', label: 'Retries', type: 'string', required: true },
    SETTINGS_V1.fields[4],
    { key: 'endpoint', label: 'Endpoint', type: 'string', required: true },
  ],
};

const HOOK_MODULE = 'export default {};\n';

/** sx: a hand-installed agent half; hx: with relay and agent hooks; px: an agent half Lamaste installs. */
const manifests = {
  sx: (version) => ({
    name: 'sx',
    version,
    hosting: 'agent',
    agent: {},
    settings: SETTINGS_V1,
  }),
  hx: (version) => ({
    name: 'hx',
    version,
    hosting: 'agent',
    agent: {},
    settings: SETTINGS_V1,
    hooks: {
      relay: {
        entry: 'hooks/relay.mjs',
        install: { 'pre-tunnel': {}, 'post-tunnel': {} },
        uninstall: { 'pre-teardown': {} },
      },
      agent: {
        install: { 'post-tunnel': {} },
        uninstall: { 'pre-teardown': {} },
      },
    },
  }),
  px: (version, settings = SETTINGS_V1) => ({
    name: 'px',
    version,
    hosting: 'agent',
    agent: { package: '@lamalibre/px-agent', service: { entry: 'dist/agentd.js' } },
    settings,
  }),
  plain: (version) => ({ name: 'plain', version, hosting: 'agent', agent: {} }),
};

let dir;
let stateDir;
let halvesDir;
let socketDir;
let npm;
let lib;
let core;
let app;
let runner; // the fake relay hook runner of hx
const runnerInputs = [];
const halves = {};
/** Every response body the panel gave in this file. */
const responses = [];
/** Every log line the panel wrote in this file. */
const logLines = [];
/** Every request body that crossed the tunnel to a fake agent half — what a squatter would get. */
const wireBodies = [];
let now = Date.parse('2026-10-16T08:00:00.000Z');

function listen(server, port = 0) {
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve(server.address().port)),
  );
}

/**
 * A fake agent half: core's settings store and handler over a data
 * directory of its own, behind the agent-side caller-assertion verifier,
 * answering its lifecycle hooks too — every answer authenticated with the
 * responder header, as core's handlers make it. `mode: 'unsupported'` plays
 * an agent half that does not serve plugin settings (an authenticated 404
 * on /admin/settings).
 */
async function startFakeHalf(route, block) {
  const half = {
    route,
    dataDir: path.join(halvesDir, route),
    configPath: path.join(halvesDir, `${route}-config.json`),
    mode: 'normal',
    hookInputs: [],
    store: null,
    verifier: null,
    handler: null,
    server: null,
    port: null,
  };
  await mkdir(half.dataDir, { recursive: true });
  half.useStore = async (settings, dataDir = half.dataDir) => {
    half.store = createSettingsStore({ dataDir, settings });
    await half.store.load();
    half.handler = createSettingsHandler({ verifier: half.verifier, store: half.store });
  };
  /** What the agent's sync does once the hosting exists: the config file with the secret. */
  half.writeConfig = async (secret) => {
    await writeFile(
      half.configPath,
      JSON.stringify({
        plugin: route,
        port: half.port,
        secret,
        issuedAt: new Date().toISOString(),
        fetchedAt: new Date().toISOString(),
        acknowledged: true,
      }),
      { mode: 0o600 },
    );
    half.verifier = createCallerAssertionVerifier({ configPath: half.configPath, plugin: route });
    half.handler = createSettingsHandler({ verifier: half.verifier, store: half.store });
  };
  half.verifier = createCallerAssertionVerifier({ configPath: half.configPath, plugin: route });
  await half.useStore(block);
  half.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      wireBodies.push(body);
      /** A JSON answer; authenticated over its exact bytes when the request verified. */
      const send = (status, payload, verified = null) => {
        const text = JSON.stringify(payload);
        const headers = { 'content-type': 'application/json' };
        if (verified) headers[RESPONDER_HEADER] = verified.responder(status, text);
        res.writeHead(status, headers);
        res.end(text);
      };
      const pathOnly = req.url.split('?')[0];
      if (pathOnly.startsWith('/admin/hooks/')) {
        const verified = await half.verifier.verify(req.headers, req.method, req.url, {
          body,
          requireBodyHash: true,
        });
        if (!verified.ok) return send(401, { error: verified.reason });
        half.hookInputs.push(JSON.parse(body.toString('utf-8')));
        return send(200, { ok: true }, verified);
      }
      if (pathOnly === '/admin/settings' || pathOnly.startsWith('/admin/settings/')) {
        if (half.mode === 'unsupported') {
          const verified = await half.verifier.verify(req.headers, req.method, req.url);
          if (!verified.ok) return send(401, { error: verified.reason });
          return send(404, { error: 'Not found' }, verified);
        }
        const out = await half.handler.handle({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        });
        res.writeHead(out.status, out.headers);
        return res.end(out.bodyText);
      }
      return send(404, { error: 'Not found' });
    });
  });
  half.port = await listen(half.server);
  halves[route] = half;
  return half;
}

/** The relay hook runner of `route`, answering every stage with `{ ok: true }`. */
async function startFakeRunner(route) {
  const server = net.createServer((socket) => {
    readFrame(socket, { timeoutMs: 5_000 })
      .then((frame) => {
        runnerInputs.push({ stage: frame.header.stage, input: frame.header.input });
        socket.end(encodeFrame({ v: 1, ok: true, decision: { ok: true } }));
      })
      .catch(() => socket.destroy());
  });
  await new Promise((resolve) => server.listen(path.join(socketDir, `${route}.sock`), resolve));
  return server;
}

async function enroll(label) {
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
  });
  await lib.saveAgentRegistry(registry);
}

async function publish(name, version, manifest = manifests[name](version)) {
  const files = { 'lamaste-plugin.json': JSON.stringify(manifest) };
  if (manifest.hooks?.relay) files['hooks/relay.mjs'] = HOOK_MODULE;
  await npm.publish(`@lamalibre/${name}-server`, version, files);
  if (manifest.agent?.package) {
    await npm.setIntegrity(`${manifest.agent.package}@${version}`, integrity(`${name}-${version}`));
  }
}

async function approve(name) {
  const plugin = await lib.findPlugin(name);
  const status = await lib.hookStatus(plugin);
  if (status.approval.state === 'pending') {
    await lib.approveHookSet(plugin, status.approval.digest, {
      actor: 'admin',
      certSerial: null,
      logger: app.log,
    });
  }
}

/** One request to the panel as an admin; every answer is kept for the final check. */
async function call(method, url, payload, headers = {}) {
  const res = await app.inject({
    method,
    url,
    headers: {
      'x-test-role': 'admin',
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
  responses.push(res.body);
  return res;
}

async function cacheRow(name) {
  const db = await lib.getStateDb();
  return db.prepare('SELECT * FROM plugin_settings WHERE plugin = ?').get(name) ?? null;
}

/** Persist a health transition of `route` as the monitor does; returns it. */
async function setHealth(route, state, reason) {
  const before = (await core.getPluginHosting(stateDir, route)).health;
  const next = { state, ...(reason ? { reason } : {}), since: new Date().toISOString() };
  await core.updatePluginHostingHealth(stateDir, route, next);
  return { before, after: next };
}

async function host(name) {
  const operation = await lib.hostPlugin(name, 'vm1', {
    actor: 'admin',
    logger: app.log,
    sourceIp: IP,
  });
  const done = await lib.waitForPluginOperation(name);
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  return operation;
}

before(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'lps-')));
  stateDir = path.join(dir, 'state');
  halvesDir = path.join(dir, 'halves');
  socketDir = path.join(dir, 's');
  await mkdir(stateDir);
  await mkdir(halvesDir);
  await mkdir(socketDir);
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_PKI_DIR = path.join(stateDir, 'pki');
  process.env.LAMALIBRE_LAMASTE_CONFIG = path.join(stateDir, 'panel.json');
  process.env.LAMALIBRE_LAMASTE_HOOKS_SOCKET_DIR = socketDir;
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
    ...(await import('../src/lib/plugin-settings.js')),
    ...(await import('../src/lib/hook-pipelines.js')),
    ...(await import('../src/lib/tunnel-hooks.js')),
    ...(await import('../src/lib/agent-presence.js')),
  };
  core = await import('@lamalibre/lamaste/server');
  await lib.loadConfig();
  lib.setPresenceClockForTests(() => now);
  lib.setOidcSyncForTests(async () => null);

  const installedEntries = new Map();
  lib.setHookRunnerManagerForTests({
    async install(route, sha) {
      installedEntries.set(route, sha);
    },
    async activate(route, sha) {
      installedEntries.set(route, sha);
    },
    async remove(route) {
      installedEntries.delete(route);
    },
    async restart() {},
    async installedEntry(route) {
      return installedEntries.has(route) ? installedEntries.get(route) : undefined;
    },
  });

  // No chisel here: the tunnel's port is the fake agent half's, and the
  // agent's sync delivering the secret is the half reading its config file.
  lib.setTunnelOpsForTests({
    async create(ctx) {
      return { id: `tunnel-${ctx.route}`, port: halves[ctx.route].port };
    },
    async enable() {},
    async remove() {},
    async waitForAgentHalf(record) {
      await halves[record.plugin].writeConfig(record.current.secret);
    },
  });

  // The panel's routes, behind stand-ins for the mTLS middleware and guard,
  // logging to a stream this file reads.
  const { default: Fastify } = await import('fastify');
  const { default: errors } = await import('../src/middleware/errors.js');
  const { default: pluginRoutes } = await import('../src/routes/management/plugins.js');
  const { default: tunnelRoutes } = await import('../src/routes/management/tunnels.js');
  const { default: certsRoutes } = await import('../src/routes/management/certs.js');
  app = Fastify({
    logger: { level: 'trace', stream: { write: (line) => logLines.push(line) } },
  });
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
    if (request.certRole === 'admin' || roles.includes(request.certRole)) return;
    return reply.code(403).send({ error: 'forbidden' });
  });
  await app.register(pluginRoutes, { prefix: '/api' });
  await app.register(tunnelRoutes, { prefix: '/api' });
  await app.register(certsRoutes, { prefix: '/api' });
  await app.ready();

  await enroll('vm1');
  await enroll('vm2');
  await startFakeHalf('sx', SETTINGS_V1);
  await startFakeHalf('hx', SETTINGS_V1);
  runner = await startFakeRunner('hx');
  for (const name of ['sx', 'hx', 'px', 'plain']) {
    await publish(name, '1.0.0');
    await lib.installPlugin(`@lamalibre/${name}-server`, app.log);
    await approve(name);
  }
});

after(async () => {
  lib.setTunnelOpsForTests(null);
  lib.setHookRunnerManagerForTests(null);
  lib.setOidcSyncForTests(null);
  lib.setPresenceClockForTests(null);
  for (const half of Object.values(halves)) half.server.close();
  runner?.close();
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

test('list and detail: a summary for a plugin with settings, never values; 404 no_settings', async () => {
  const res = await call('GET', '/api/plugins');
  assert.equal(res.statusCode, 200);
  const by = Object.fromEntries(res.json().plugins.map((p) => [p.name, p]));
  assert.deepEqual(by.sx.settings, {
    configured: false,
    missing: ['apiKey', 'region'],
    syncedAt: null,
  });
  assert.equal('settings' in by.plain, false);

  const detail = await call('GET', '/api/plugins/px');
  assert.deepEqual(detail.json().plugin.settings, {
    configured: false,
    missing: ['apiKey', 'region'],
    syncedAt: null,
  });

  const none = await call('GET', '/api/plugins/plain/settings');
  assert.equal(none.statusCode, 404);
  assert.equal(none.json().code, 'no_settings');
  assert.equal((await call('GET', '/api/plugins/ghost/settings')).statusCode, 404);
  assert.equal(
    (await call('PUT', '/api/plugins/plain/settings', { revision: 0, values: {} })).json().code,
    'no_settings',
  );
});

test('read before hosting: the defaults, source none; a change is refused (503, not hosted)', async () => {
  const res = await call('GET', '/api/plugins/sx/settings');
  assert.equal(res.statusCode, 200);
  const view = res.json();
  assert.equal(view.source, 'none');
  assert.equal(view.revision, null);
  assert.equal(view.syncedAt, null);
  assert.equal(view.hosting, null);
  assert.equal(view.schemaVersion, 1);
  assert.deepEqual(
    view.fields.map((f) => f.key),
    ['apiKey', 'token', 'schedule', 'retries', 'region', 'verbose'],
  );
  assert.deepEqual(view.values, {
    apiKey: { set: false },
    token: { set: false },
    schedule: '06:00',
    retries: 3,
  });
  assert.equal(view.configured, false);
  assert.deepEqual(view.missing, ['apiKey', 'region']);

  const put = await call('PUT', '/api/plugins/sx/settings', {
    revision: 0,
    secrets: { apiKey: SECRET },
  });
  assert.equal(put.statusCode, 503);
  assert.equal(put.json().code, 'hosting_offline');
  assert.equal(put.json().hosting, null);
  assert.match(put.json().error, /not hosted/);
});

test('hosting: the hosting operation reads the settings; a read while up is live', async () => {
  await host('sx');
  // The hosting succeeded: the relay read the (empty) settings of the agent half.
  const row = await cacheRow('sx');
  assert.ok(row, 'the hosting success refreshed the cache');
  assert.equal(row.revision, 0);
  assert.equal(row.configured, 0);
  assert.deepEqual(JSON.parse(row.missing_json), ['apiKey', 'region']);

  const res = await call('GET', '/api/plugins/sx/settings');
  assert.equal(res.statusCode, 200);
  const view = res.json();
  assert.equal(view.source, 'live');
  assert.equal(view.revision, 0);
  assert.ok(Date.parse(view.syncedAt) > 0);
  assert.deepEqual(view.hosting, {
    agentLabel: 'vm1',
    phase: 'active',
    state: 'unknown',
    reason: null,
    since: view.hosting.since,
    agentLastSeenAt: null,
  });
});

// ---------------------------------------------------------------------------
// Changing
// ---------------------------------------------------------------------------

test('change: the agent half stores it; the cache follows; the audit names keys only', async () => {
  const res = await call(
    'PUT',
    '/api/plugins/sx/settings',
    {
      revision: 0,
      values: { region: 'eu', retries: 5 },
      secrets: { apiKey: SECRET, token: TOKEN_SECRET },
    },
    { 'x-ssl-client-serial': '0A1B' },
  );
  assert.equal(res.statusCode, 200, res.body);
  const view = res.json();
  assert.equal(view.source, 'live');
  assert.equal(view.revision, 1);
  assert.equal(view.configured, true);
  assert.deepEqual(view.missing, []);
  assert.equal(view.values.apiKey.set, true);
  assert.ok(Date.parse(view.values.apiKey.setAt) > 0);
  assert.equal(view.values.token.set, true);
  assert.equal(view.values.region, 'eu');
  assert.equal(view.values.retries, 5);
  assert.equal(view.values.schedule, '06:00');

  // The agent half holds the secrets — the relay passed them on.
  assert.equal(halves.sx.store.secret('apiKey'), SECRET);
  assert.equal(halves.sx.store.secret('token'), TOKEN_SECRET);

  const row = await cacheRow('sx');
  assert.equal(row.revision, 1);
  assert.equal(row.schema_version, 1);
  assert.equal(row.configured, 1);
  assert.deepEqual(JSON.parse(row.values_json), { retries: 5, region: 'eu' });
  assert.deepEqual(Object.keys(JSON.parse(row.secrets_set_json)).sort(), ['apiKey', 'token']);

  const db = await lib.getStateDb();
  const audit = db
    .prepare("SELECT * FROM audit_events WHERE action = 'plugin.settings.updated'")
    .all();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor, 'admin');
  assert.equal(audit[0].plugin, 'sx');
  assert.deepEqual(JSON.parse(audit[0].details), {
    changed: ['region', 'retries'],
    cleared: [],
    secretsSet: ['apiKey', 'token'],
    secretsCleared: [],
    revision: 1,
    certSerial: '0A1B',
  });

  // Clearing: an optional secret and a non-secret back to its default.
  const cleared = await call('PUT', '/api/plugins/sx/settings', {
    revision: 1,
    values: { retries: null },
    secrets: { token: null },
  });
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.equal(cleared.json().revision, 2);
  assert.deepEqual(cleared.json().values.token, { set: false });
  assert.equal(cleared.json().values.retries, 3);
  assert.equal(halves.sx.store.secret('token'), undefined);
  const last = db
    .prepare(
      "SELECT details FROM audit_events WHERE action = 'plugin.settings.updated' ORDER BY id DESC",
    )
    .get();
  assert.deepEqual(JSON.parse(last.details), {
    changed: [],
    cleared: ['retries'],
    secretsSet: [],
    secretsCleared: ['token'],
    revision: 2,
  });

  // An empty change stores nothing and answers the settings as they are.
  const empty = await call('PUT', '/api/plugins/sx/settings', { revision: 2 });
  assert.equal(empty.statusCode, 200);
  assert.equal(empty.json().revision, 2);
  assert.equal(empty.json().source, 'live');
});

test('validation: 400 with a message per field — never the value', async () => {
  const cases = [
    [{ revision: 2, values: { retries: MISPLACED } }, { retries: 'Must be an integer' }],
    [{ revision: 2, values: { apiKey: MISPLACED } }, { apiKey: 'Is a secret; send it in secrets' }],
    [
      { revision: 2, secrets: { region: MISPLACED } },
      { region: 'Is not a secret; send it in values' },
    ],
    [{ revision: 2, values: { region: MISPLACED } }, { region: 'Must be one of the options' }],
    [{ revision: 2, values: { nope: MISPLACED } }, { _: '1 unknown setting' }],
    [{ revision: 2, values: { [MISPLACED]: 1 } }, { _: '1 unknown setting' }],
    [{ revision: 2, secrets: { apiKey: null } }, { apiKey: 'Is required' }],
    [{ revision: 2, values: { region: null } }, { region: 'Is required' }],
    [{ revision: 2, values: { retries: 11 } }, { retries: 'Must be at most 10' }],
    [{ revision: 2, secrets: { apiKey: '' } }, { apiKey: 'Must not be empty' }],
    [{ revision: 2, secrets: { apiKey: 'x'.repeat(1025) } }, { apiKey: /at most 1024/ }],
    [{ revision: 2, values: MISPLACED }, { _: '"values" must be an object' }],
    [{ values: { region: 'eu' } }, { _: /"revision" must be/ }],
    [{ revision: -1 }, { _: /"revision" must be/ }],
    [
      { revision: 2, [MISPLACED]: true },
      { _: 'The body carries only revision, values and secrets' },
    ],
    [[MISPLACED], { _: /must be a JSON object/ }],
  ];
  for (const [payload, expected] of cases) {
    const res = await call('PUT', '/api/plugins/sx/settings', payload);
    assert.equal(res.statusCode, 400, JSON.stringify(expected));
    const body = res.json();
    assert.equal(body.error, 'Invalid settings');
    assert.deepEqual(Object.keys(body.errors), Object.keys(expected));
    for (const [key, message] of Object.entries(expected)) {
      if (message instanceof RegExp) assert.match(body.errors[key], message);
      else assert.equal(body.errors[key], message);
    }
    assert.ok(!res.body.includes(MISPLACED), 'the value is not repeated');
  }
  // A body that is not JSON, and one too large: Fastify's own refusals, which repeat nothing.
  const raw = await app.inject({
    method: 'PUT',
    url: '/api/plugins/sx/settings',
    headers: { 'x-test-role': 'admin', 'content-type': 'application/json' },
    payload: `{"revision": 2, "secrets": {"apiKey": "${MISPLACED}"`,
  });
  responses.push(raw.body);
  assert.equal(raw.statusCode, 400);
  assert.ok(!raw.body.includes(MISPLACED));
  const big = await app.inject({
    method: 'PUT',
    url: '/api/plugins/sx/settings',
    headers: { 'x-test-role': 'admin', 'content-type': 'application/json' },
    payload: JSON.stringify({
      revision: 2,
      secrets: {
        apiKey: MISPLACED.repeat(Math.ceil(AGENT_HALF_SETTINGS_MAX_BYTES / MISPLACED.length) + 1),
      },
    }),
  });
  responses.push(big.body);
  assert.equal(big.statusCode, 413);
  // Nothing reached the agent half.
  assert.equal(halves.sx.store.state().revision, 2);
});

test('409: a running operation; the agent half’s revision and schema conflicts, with their code', async () => {
  let release;
  const { operation } = await lib.startPluginOperation({
    plugin: 'sx',
    kind: 'test-hold',
    actor: 'admin',
    logger: app.log,
    run: () => new Promise((resolve) => (release = resolve)),
  });
  const busy = await call('PUT', '/api/plugins/sx/settings', {
    revision: 2,
    values: { verbose: true },
  });
  assert.equal(busy.statusCode, 409);
  assert.equal(busy.json().code, 'operation_running');
  assert.equal(busy.json().operationId, operation.id);
  release();
  await lib.waitForPluginOperation('sx');

  const stale = await call('PUT', '/api/plugins/sx/settings', {
    revision: 1,
    values: { verbose: true },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, 'revision_mismatch');
  assert.equal(stale.json().revision, 2);

  // The agent half runs schema version 2 (an update under way): the relay's 1 is refused.
  await halves.sx.useStore(
    { ...SETTINGS_V1, schemaVersion: 2 },
    await mkdtemp(path.join(halvesDir, 'sx-v2-')),
  );
  const mismatch = await call('PUT', '/api/plugins/sx/settings', {
    revision: 0,
    values: { verbose: true },
  });
  assert.equal(mismatch.statusCode, 409);
  assert.equal(mismatch.json().code, 'schema_mismatch');
  await halves.sx.useStore(SETTINGS_V1);
  assert.equal(halves.sx.store.state().revision, 2);
});

test('422: the agent half checks the pattern the panel never evaluates; its errors pass through', async () => {
  const res = await call('PUT', '/api/plugins/sx/settings', {
    revision: 2,
    values: { schedule: 'at dawn' },
    secrets: { token: TOKEN_SECRET },
  });
  assert.equal(res.statusCode, 422);
  assert.deepEqual(res.json(), {
    error: 'Invalid settings',
    errors: { schedule: 'Does not match the required format' },
  });
  assert.equal(halves.sx.store.state().revision, 2, 'nothing was stored');
  assert.equal(halves.sx.store.secret('token'), undefined);
});

test('502: an agent half without /admin/settings, and nothing on the tunnel', async () => {
  halves.sx.mode = 'unsupported';
  const res = await call('PUT', '/api/plugins/sx/settings', {
    revision: 2,
    values: { verbose: true },
  });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().code, 'settings_unsupported');
  // A read falls back to the cache.
  const read = await call('GET', '/api/plugins/sx/settings');
  assert.equal(read.json().source, 'cache');
  assert.equal(read.json().revision, 2);
  halves.sx.mode = 'normal';

  const { port } = halves.sx;
  await new Promise((resolve) => halves.sx.server.close(resolve));
  const refused = await call('PUT', '/api/plugins/sx/settings', {
    revision: 2,
    values: { verbose: true },
  });
  assert.equal(refused.statusCode, 502);
  assert.equal(refused.json().code, 'refused');
  await listen(halves.sx.server, port);
});

// ---------------------------------------------------------------------------
// Offline, and the cache coming back
// ---------------------------------------------------------------------------

test('offline: 503 hosting_offline with the hosting; read from the cache; up again re-reads', async () => {
  // The agent synced once, then went away.
  const seen = await app.inject({
    method: 'GET',
    url: '/api/tunnels/agent-config',
    headers: { 'x-test-role': 'agent', 'x-test-label': 'vm1' },
  });
  assert.equal(seen.statusCode, 200);
  const down = await setHealth('sx', 'down', 'tunnel');
  await lib.onHealthTransition('sx', down.before, down.after, app.log);

  const res = await call('PUT', '/api/plugins/sx/settings', {
    revision: 2,
    values: { verbose: true },
    secrets: { token: TOKEN_SECRET },
  });
  assert.equal(res.statusCode, 503);
  const body = res.json();
  assert.equal(body.code, 'hosting_offline');
  assert.match(body.error, /Hosting agent "vm1" of plugin "sx" is offline since/);
  assert.deepEqual(body.hosting, {
    agentLabel: 'vm1',
    phase: 'active',
    state: 'down',
    reason: 'tunnel',
    since: down.after.since,
    agentLastSeenAt: new Date(now).toISOString(),
  });

  const read = await call('GET', '/api/plugins/sx/settings');
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().source, 'cache');
  assert.equal(read.json().revision, 2);
  assert.deepEqual(read.json().values.apiKey.set, true);
  assert.equal(read.json().hosting.state, 'down');

  // While it was gone the agent half changed (a restore on the agent, say).
  const changed = await halves.sx.store.update({
    schemaVersion: 1,
    baseRevision: 2,
    values: { verbose: true },
    secrets: {},
  });
  assert.equal(changed.ok, true);
  assert.equal(JSON.parse((await cacheRow('sx')).values_json).verbose, undefined);

  // Health comes back up: the relay re-reads the settings beside the tunnel:up pipeline.
  const up = await setHealth('sx', 'up');
  await lib.onHealthTransition('sx', up.before, up.after, app.log);
  const row = await cacheRow('sx');
  assert.equal(row.revision, 3);
  assert.equal(JSON.parse(row.values_json).verbose, true);

  const app503 = await setHealth('sx', 'down', 'app');
  const notResponding = await call('PUT', '/api/plugins/sx/settings', {
    revision: 3,
    values: { verbose: false },
  });
  assert.equal(notResponding.statusCode, 503);
  assert.match(notResponding.json().error, /agent half of plugin "sx" is not responding since/);
  assert.equal(notResponding.json().hosting.reason, 'app');
  const back = await setHealth('sx', 'up');
  assert.equal(back.before.state, app503.after.state);
});

test('update: the agent half is re-read afterwards; the preview lists the settings schema diff', async () => {
  // A hand-installed agent half needs no approval: the update runs at once.
  await halves.sx.store.update({
    schemaVersion: 1,
    baseRevision: 3,
    values: { schedule: '07:30' },
    secrets: {},
  });
  await publish('sx', '1.0.1');
  const { operation } = await lib.updatePlugin('sx', '1.0.1', {
    actor: 'admin',
    certSerial: null,
    logger: app.log,
    sourceIp: IP,
  });
  assert.ok(operation);
  const done = await lib.waitForPluginOperation('sx');
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  const row = await cacheRow('sx');
  assert.equal(row.revision, 4);
  assert.equal(JSON.parse(row.values_json).schedule, '07:30');
  assert.deepEqual((await lib.findPlugin('sx')).settings, SETTINGS_V1);

  // px: a new agent half waits for approval — its preview shows how the
  // settings schema changes (outside the digest).
  await publish('px', '1.1.0', manifests.px('1.1.0', SETTINGS_V2));
  const staged = await lib.updatePlugin('px', '1.1.0', {
    actor: 'admin',
    certSerial: null,
    logger: app.log,
    sourceIp: IP,
  });
  const expected = {
    added: [{ key: 'endpoint', type: 'string' }],
    removed: [{ key: 'verbose', type: 'boolean' }],
    retyped: [{ key: 'retries', from: 'integer', to: 'string' }],
    newRequired: ['retries', 'endpoint'],
    secretToPlain: [],
  };
  assert.deepEqual(staged.pendingUpdate.settings, expected);
  const hooks = await call('GET', '/api/plugins/px/hooks');
  assert.deepEqual(hooks.json().hooks.pendingUpdate.settings, expected);
  // The digest does not cover settings: the same agent half with other settings has the same one.
  await publish('px', '1.1.0', manifests.px('1.1.0', SETTINGS_V1));
  const again = await lib.updatePlugin('px', '1.1.0', {
    actor: 'admin',
    certSerial: null,
    logger: app.log,
    sourceIp: IP,
  });
  assert.equal(again.pendingUpdate.digest, staged.pendingUpdate.digest);
  assert.deepEqual(again.pendingUpdate.settings, {
    added: [],
    removed: [],
    retyped: [],
    newRequired: [],
    secretToPlain: [],
  });
});

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

test('presence: an agent’s sync is written at most once a minute; lastSeenAt and agentLastSeenAt', async () => {
  const db = await lib.getStateDb();
  const stored = (label) =>
    db.prepare('SELECT last_seen_at FROM agent_presence WHERE label = ?').get(label)
      ?.last_seen_at ?? null;
  const sync = (label) =>
    app.inject({
      method: 'GET',
      url: '/api/tunnels/agent-config',
      headers: { 'x-test-role': 'agent', 'x-test-label': label },
    });

  now += 120_000;
  const t0 = new Date(now).toISOString();
  assert.equal((await sync('vm1')).statusCode, 200);
  assert.equal(stored('vm1'), t0);

  now += 20_000;
  const t1 = new Date(now).toISOString();
  await sync('vm1');
  assert.equal(stored('vm1'), t0, 'not written again within the minute');
  const certs = await call('GET', '/api/certs/agent');
  const vm1 = certs.json().agents.find((a) => a.label === 'vm1');
  assert.equal(vm1.lastSeenAt, t1, 'memory holds the latest contact');
  assert.equal(certs.json().agents.find((a) => a.label === 'vm2').lastSeenAt, null);
  const hosting = await call('GET', '/api/plugins/sx/hosting');
  assert.equal(hosting.json().hosting.agentLastSeenAt, t1);
  const listed = await call('GET', '/api/plugins');
  assert.equal(listed.json().plugins.find((p) => p.name === 'sx').agentHosting.agentLastSeenAt, t1);

  now += 45_000;
  const t2 = new Date(now).toISOString();
  await sync('vm1');
  assert.equal(stored('vm1'), t2, 'written again once a minute passed');

  // An admin asking for an agent's config is not that agent's contact.
  const admin = await app.inject({
    method: 'GET',
    url: '/api/tunnels/agent-config?agent=vm2',
    headers: { 'x-test-role': 'admin' },
  });
  assert.equal(admin.statusCode, 200);
  assert.equal(stored('vm2'), null);

  // After a restart the panel knows the last written contact.
  now += 10_000;
  await sync('vm1');
  lib.forgetPresenceMemoryForTests();
  assert.equal(await lib.agentLastSeenAt('vm1'), t2);

  // A revoked agent's presence goes with it (a later enrollment reusing the label starts fresh).
  await lib.forgetAgentPresence('vm2');
  await sync('vm2');
  assert.ok(stored('vm2'));
  await lib.forgetAgentPresence('vm2');
  assert.equal(stored('vm2'), null);
  assert.equal(await lib.agentLastSeenAt('vm2'), null);
});

// ---------------------------------------------------------------------------
// Hook inputs, and the cache going with the hosting and the plugin
// ---------------------------------------------------------------------------

test('hook inputs: relay stages see the effective non-secret values, agent stages none', async () => {
  await host('hx');
  // First hosting: nothing read yet when the stages ran.
  const installStages = runnerInputs.map((r) => [r.stage, r.input.settings]);
  assert.deepEqual(installStages, [
    ['install:pre-tunnel', {}],
    ['install:post-tunnel', {}],
  ]);
  assert.deepEqual(
    halves.hx.hookInputs.map((h) => [h.stage, h.input.settings]),
    [['install:post-tunnel', {}]],
  );
  assert.ok(await cacheRow('hx'), 'read after the hosting succeeded');

  const put = await call('PUT', '/api/plugins/hx/settings', {
    revision: 0,
    values: { region: 'us', retries: 7 },
    secrets: { apiKey: SECRET },
  });
  assert.equal(put.statusCode, 200, put.body);

  const operation = await lib.unhostPlugin('hx', {
    actor: 'admin',
    logger: app.log,
    sourceIp: IP,
  });
  assert.ok(operation);
  const done = await lib.waitForPluginOperation('hx');
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  const teardown = runnerInputs.find((r) => r.stage === 'uninstall:pre-teardown');
  assert.deepEqual(teardown.input.settings, { schedule: '06:00', retries: 7, region: 'us' });
  const agentTeardown = halves.hx.hookInputs.find((h) => h.stage === 'uninstall:pre-teardown');
  assert.deepEqual(agentTeardown.input.settings, {});
  const allInputs = JSON.stringify([runnerInputs, halves.hx.hookInputs]);
  assert.ok(!allInputs.includes(SECRET), 'no hook ever sees a secret');

  // With the hosting gone the cache describes nothing.
  assert.equal(await cacheRow('hx'), null);
  const read = await call('GET', '/api/plugins/hx/settings');
  assert.equal(read.json().source, 'none');
  assert.equal(read.json().hosting, null);
  // The agent half keeps them with its data (here: its store), as retained data would.
  assert.equal(halves.hx.store.secret('apiKey'), SECRET);
});

test('uninstall: the cache row goes with the plugin row, in one transaction', async () => {
  const db = await lib.getStateDb();
  // A cache row left from before (as if the hosting's removal could not drop it).
  db.prepare(
    `INSERT INTO plugin_settings
       (plugin, schema_version, revision, values_json, secrets_set_json, configured,
        missing_json, synced_at)
     VALUES ('hx', 1, 9, '{}', '{}', 0, '[]', ?)`,
  ).run(new Date().toISOString());
  const result = await lib.uninstallPluginWithHosting('hx', {
    actor: 'admin',
    logger: app.log,
    sourceIp: IP,
  });
  assert.deepEqual(result.removed, { ok: true, name: 'hx' });
  assert.equal(await cacheRow('hx'), null);
  assert.equal(await lib.findPlugin('hx'), null);
});

// ---------------------------------------------------------------------------
// The secret, nowhere on the relay
// ---------------------------------------------------------------------------

async function filesUnder(root) {
  const out = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

test('the secrets appear in no response, log line, row, relay file — nor in clear on the tunnel', async () => {
  const secrets = [SECRET, TOKEN_SECRET, MISPLACED];
  assert.ok(responses.length > 30, `${responses.length} responses checked`);
  assert.ok(logLines.length > 30, `${logLines.length} log lines checked`);
  for (const secret of secrets) {
    for (const body of responses) assert.ok(!body.includes(secret), 'a response');
    for (const line of logLines) assert.ok(!line.includes(secret), `a log line: ${line}`);
  }
  // Every secret crossed the tunnel sealed to its request.
  const updates = wireBodies.filter((b) => b.includes(Buffer.from('"baseRevision"')));
  assert.ok(updates.length > 3, `${updates.length} updates checked`);
  for (const body of wireBodies) {
    for (const secret of secrets) {
      assert.equal(body.includes(Buffer.from(secret)), false, 'a request body on the tunnel');
    }
  }
  assert.ok(
    updates.some((b) => /"secrets":\{"apiKey":\{"v":1,"iv":"/.test(b.toString('utf-8'))),
    'a sealed secret on the wire',
  );
  // No log line carries a request body at all.
  for (const line of logLines) {
    const entry = JSON.parse(line);
    assert.equal(entry.req?.body, undefined);
    assert.equal(entry.body, undefined);
  }

  const db = await lib.getStateDb();
  for (const table of [
    'plugin_settings',
    'audit_events',
    'plugin_operations',
    'notifications',
    'agent_jobs',
    'plugin_hook_sets',
    'plugins',
    'agent_presence',
  ]) {
    const rows = JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
    for (const secret of secrets) assert.ok(!rows.includes(secret), `a row of ${table}`);
  }
  db.exec('PRAGMA wal_checkpoint(FULL)');
  for (const file of await filesUnder(stateDir)) {
    const bytes = await readFile(file);
    for (const secret of secrets) {
      assert.equal(bytes.includes(Buffer.from(secret)), false, `${file} holds a secret`);
    }
  }
  // …while the agent half holds what it was given.
  assert.equal(halves.sx.store.secret('apiKey'), SECRET);
});
