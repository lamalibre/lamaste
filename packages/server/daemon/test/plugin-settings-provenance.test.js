/**
 * Plugin settings on the relay after the slice 4 security review (S2):
 *
 * - an answer of the agent half's port that does not authenticate itself
 *   (a squatter, or an agent half built against an older core) is a 502
 *   `unauthenticated`, never an answer;
 * - the agent half's 422 messages reach the administrator only as messages
 *   Lamaste's own validation produces, under keys of the installed schema;
 * - a settings schema change (install, update, revert) prunes the relay's
 *   cache in the transaction that writes the plugin's row: a value whose
 *   field became a secret goes, a secret whose field became a plain value
 *   loses its `setAt`;
 * - provenance: a revision of the agent half's that Lamaste did not write
 *   is audited (`plugin.settings.changed-outside-lamaste`) and notified
 *   once, with key names only; a change whose answer was lost and that
 *   turns out stored is the administrator's, not an outside one;
 * - an update that turns a secret into a plain value always waits for an
 *   administrator's approval (`settings.secret-to-plain` in its
 *   `approvalRequired`) — its digest already approved or not, relay hooks
 *   and agent half or neither, auto-approve on or off — audited and
 *   notified; approving it (by digest, or by version) applies it, and an
 *   approval covers only the secrets that were shown;
 * - the panel reads every reachable hosting's settings once when it starts.
 *
 * The agent half is core's real settings store and handler over a
 * temporary data directory, verifying Lamaste's assertions with the
 * hosting's real installation secret; its modes play what else may answer
 * on the tunnel's port.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { RESPONDER_HEADER } from '@lamalibre/lamaste';
import {
  createCallerAssertionVerifier,
  createSettingsHandler,
  createSettingsStore,
} from '@lamalibre/lamaste/agent';

import { installFakeNpm } from './fake-npm.js';

const SECRET = 'sk-prov-Qm4-DISTINCTIVE-SECRET-6630';
const OTHER_SECRET = 'sk-prov-Rt8-DISTINCTIVE-OTHER-1177';
const IP = '127.0.0.1';
const integrity = (seed) => `sha512-${crypto.createHash('sha512').update(seed).digest('base64')}`;

/** sx's schema: a secret, a credential-looking plain field, a number, a choice. */
const SX_SETTINGS = {
  schemaVersion: 1,
  fields: [
    { key: 'apiKey', label: 'API key', type: 'secret', required: true },
    { key: 'endpoint', label: 'Endpoint', type: 'string' },
    { key: 'retries', label: 'Retries', type: 'integer', min: 0, max: 10, default: 3 },
    {
      key: 'region',
      label: 'Region',
      type: 'enum',
      options: [
        { value: 'eu', label: 'Europe' },
        { value: 'us', label: 'United States' },
      ],
    },
  ],
};

/** qx's schema before and after: token secret → string, endpoint string → secret. */
const QX_V1 = {
  schemaVersion: 1,
  fields: [
    { key: 'token', label: 'Token', type: 'secret' },
    { key: 'endpoint', label: 'Endpoint', type: 'string' },
    { key: 'retries', label: 'Retries', type: 'integer' },
    { key: 'gone', label: 'Gone', type: 'boolean' },
  ],
};
const QX_V2 = {
  schemaVersion: 2,
  fields: [
    { key: 'token', label: 'Token', type: 'string' },
    { key: 'endpoint', label: 'Endpoint', type: 'secret', required: true },
    { key: 'retries', label: 'Retries', type: 'integer' },
    { key: 'region', label: 'Region', type: 'string', required: true },
  ],
};

/**
 * px (an agent half Lamaste installs: every version has another approval
 * digest), rx (relay hooks only: an unchanged module keeps its digest) and
 * ux (an agent half installed by hand, no hooks: nothing to approve) share
 * these: `token` is a secret in v1 and a string from v2, `pin` a secret
 * until v3.
 */
const PX_V1 = {
  schemaVersion: 1,
  fields: [
    { key: 'token', label: 'Token', type: 'secret' },
    { key: 'pin', label: 'PIN', type: 'secret' },
    { key: 'retries', label: 'Retries', type: 'integer', default: 3 },
  ],
};
const PX_V2 = {
  schemaVersion: 2,
  fields: [
    { key: 'token', label: 'Token', type: 'string' },
    { key: 'pin', label: 'PIN', type: 'secret' },
    { key: 'retries', label: 'Retries', type: 'integer', default: 3 },
  ],
};
const PX_V3 = {
  schemaVersion: 3,
  fields: [
    { key: 'token', label: 'Token', type: 'string' },
    { key: 'pin', label: 'PIN', type: 'string' },
    { key: 'retries', label: 'Retries', type: 'integer', default: 3 },
  ],
};
/** v1 with another default: a settings change that turns no secret plain. */
const PX_V1_RETRIES = {
  ...PX_V1,
  schemaVersion: 4,
  fields: [PX_V1.fields[0], PX_V1.fields[1], { ...PX_V1.fields[2], default: 5 }],
};
const RELAY_MODULE = 'export default { "tunnel:down": () => ({}) };\n';

const manifests = {
  sx: (version, settings = SX_SETTINGS) => ({
    name: 'sx',
    version,
    hosting: 'agent',
    agent: {},
    settings,
  }),
  qx: (version, settings = QX_V1) => ({
    name: 'qx',
    version,
    hosting: 'agent',
    agent: {},
    settings,
  }),
  px: (version, settings = PX_V1) => ({
    name: 'px',
    version,
    hosting: 'agent',
    agent: { package: '@lamalibre/px-agent', service: { entry: 'dist/agentd.js' } },
    settings,
  }),
  rx: (version, settings = PX_V1) => ({
    name: 'rx',
    version,
    hosting: 'agent',
    agent: {},
    settings,
    hooks: { relay: { entry: 'hooks/relay.mjs', tunnel: { down: {} } } },
  }),
  ux: (version, settings = PX_V1) => ({
    name: 'ux',
    version,
    hosting: 'agent',
    agent: {},
    settings,
  }),
};

let dir;
let stateDir;
let halvesDir;
let npm;
let lib;
let core;
let app;
const halves = {};
const responses = [];
const logLines = [];

function listen(server, port = 0) {
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve(server.address().port)),
  );
}

/**
 * A fake agent half on the tunnel's port. `mode`:
 * - `normal` — core's settings handler, every answer authenticated;
 * - `unsigned` — core's handler (the change is stored), but the answer
 *   without its responder header: an agent half built against an older core;
 * - `squatter` — something that took the port: a plausible state, no header,
 *   nothing stored;
 * - `reject` — verifies the call and answers an authenticated 422 with the
 *   errors in `half.rejectWith`.
 */
async function startFakeHalf(route, block) {
  const half = {
    route,
    dataDir: path.join(halvesDir, route),
    configPath: path.join(halvesDir, `${route}-config.json`),
    mode: 'normal',
    rejectWith: {},
    store: null,
    verifier: null,
    handler: null,
    server: null,
    port: null,
    puts: 0,
  };
  await mkdir(half.dataDir, { recursive: true });
  half.useStore = async (settings, dataDir = half.dataDir) => {
    half.store = createSettingsStore({ dataDir, settings });
    await half.store.load();
    half.handler = createSettingsHandler({ verifier: half.verifier, store: half.store });
  };
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
      if (req.method === 'PUT') half.puts += 1;
      const send = (status, payload, headers = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
      };
      const pathOnly = req.url.split('?')[0];
      if (pathOnly === '/admin/health') {
        const verified = await half.verifier.verify(req.headers, req.method, req.url);
        if (!verified.ok) return send(401, { error: verified.reason });
        const text = JSON.stringify({ ok: true });
        return send(200, text, { [RESPONDER_HEADER]: verified.responder(200, text) });
      }
      if (!pathOnly.startsWith('/admin/settings')) return send(404, { error: 'Not found' });
      if (half.mode === 'squatter') {
        return send(200, {
          schemaVersion: block.schemaVersion,
          revision: 99,
          values: {},
          secrets: {},
          configured: true,
          missing: [],
        });
      }
      if (half.mode === 'reject' && req.method === 'PUT') {
        const verified = await half.verifier.verify(req.headers, req.method, req.url, {
          body,
          requireBodyHash: true,
        });
        if (!verified.ok) return send(401, { error: verified.reason });
        const text = JSON.stringify({ error: 'Invalid settings', errors: half.rejectWith });
        return send(422, text, { [RESPONDER_HEADER]: verified.responder(422, text) });
      }
      const out = await half.handler.handle({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      });
      const headers = { ...out.headers };
      if (half.mode === 'unsigned') delete headers[RESPONDER_HEADER];
      res.writeHead(out.status, headers);
      return res.end(out.bodyText);
    });
  });
  half.port = await listen(half.server);
  halves[route] = half;
  return half;
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
  if (manifest.hooks?.relay) files['hooks/relay.mjs'] = RELAY_MODULE;
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

async function call(method, url, payload) {
  const res = await app.inject({
    method,
    url,
    headers: {
      'x-test-role': 'admin',
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
  responses.push(res.body);
  return res;
}

async function db() {
  return lib.getStateDb();
}

async function cacheRow(name) {
  return (await db()).prepare('SELECT * FROM plugin_settings WHERE plugin = ?').get(name) ?? null;
}

async function auditOf(action, plugin) {
  return (await db())
    .prepare('SELECT * FROM audit_events WHERE action = ? AND plugin = ? ORDER BY id')
    .all(action, plugin)
    .map((row) => ({ ...row, details: JSON.parse(row.details) }));
}

async function notificationsMatching(re) {
  return (await db())
    .prepare('SELECT * FROM notifications ORDER BY id')
    .all()
    .filter((n) => re.test(n.message));
}

async function setHealth(route, state, reason) {
  const next = { state, ...(reason ? { reason } : {}), since: new Date().toISOString() };
  await core.updatePluginHostingHealth(stateDir, route, next);
}

async function host(name) {
  await lib.hostPlugin(name, 'vm1', { actor: 'admin', logger: app.log, sourceIp: IP });
  const done = await lib.waitForPluginOperation(name);
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
}

before(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'lsp-')));
  stateDir = path.join(dir, 'state');
  halvesDir = path.join(dir, 'halves');
  await mkdir(stateDir);
  await mkdir(halvesDir);
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_PKI_DIR = path.join(stateDir, 'pki');
  process.env.LAMALIBRE_LAMASTE_CONFIG = path.join(stateDir, 'panel.json');
  process.env.LAMALIBRE_LAMASTE_HOOKS_SOCKET_DIR = path.join(dir, 's');
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
  };
  core = await import('@lamalibre/lamaste/server');
  await lib.loadConfig();
  lib.setOidcSyncForTests(async () => null);
  lib.setHookRunnerManagerForTests({
    async install() {},
    async activate() {},
    async remove() {},
    async restart() {},
    async installedEntry() {
      return undefined;
    },
  });
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

  const { default: Fastify } = await import('fastify');
  const { default: errors } = await import('../src/middleware/errors.js');
  const { default: pluginRoutes } = await import('../src/routes/management/plugins.js');
  app = Fastify({
    logger: { level: 'trace', stream: { write: (line) => logLines.push(line) } },
  });
  await app.register(errors);
  app.decorateRequest('certRole', null);
  app.decorateRequest('certLabel', null);
  app.decorateRequest('certCapabilities', null);
  app.addHook('onRequest', async (request) => {
    request.certRole = request.headers['x-test-role'] ?? 'unknown';
    request.certLabel = null;
    request.certCapabilities = [];
  });
  app.decorate('requireRole', (roles) => async (request, reply) => {
    if (request.certRole === 'admin' || roles.includes(request.certRole)) return;
    return reply.code(403).send({ error: 'forbidden' });
  });
  await app.register(pluginRoutes, { prefix: '/api' });
  await app.ready();

  await enroll('vm1');
  await startFakeHalf('sx', SX_SETTINGS);
  for (const name of ['sx', 'qx', 'px', 'rx', 'ux']) {
    await publish(name, '1.0.0');
    await lib.installPlugin(`@lamalibre/${name}-server`, app.log);
    await approve(name);
  }
  await host('sx');
});

after(async () => {
  lib.setTunnelOpsForTests(null);
  lib.setHookRunnerManagerForTests(null);
  lib.setOidcSyncForTests(null);
  for (const half of Object.values(halves)) half.server.close();
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Answers that do not authenticate themselves
// ---------------------------------------------------------------------------

test('a squatter on the tunnel’s port: 502 unauthenticated; reads keep the cache', async () => {
  const first = await call('PUT', '/api/plugins/sx/settings', {
    revision: 0,
    values: { endpoint: 'https://a.example' },
    secrets: { apiKey: SECRET },
  });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal((await cacheRow('sx')).lamaste_revision, 1);

  halves.sx.mode = 'squatter';
  const res = await call('PUT', '/api/plugins/sx/settings', {
    revision: 1,
    values: { retries: 4 },
    secrets: { apiKey: OTHER_SECRET },
  });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().code, 'unauthenticated');
  assert.match(res.json().error, /did not authenticate its answer/);
  assert.match(res.json().error, /older @lamalibre\/lamaste/);
  assert.equal(halves.sx.store.state().revision, 1, 'nothing reached the agent half');

  // The squatter's plausible state never reaches the cache.
  const read = await call('GET', '/api/plugins/sx/settings');
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().source, 'cache');
  assert.equal(read.json().revision, 1);
  const row = await cacheRow('sx');
  assert.equal(row.revision, 1);
  // The change is remembered by key names until the agent half is read.
  assert.deepEqual(JSON.parse(row.unconfirmed_change_json), {
    revision: 2,
    actor: 'admin',
    changed: ['retries'],
    cleared: [],
    secretsSet: ['apiKey'],
    secretsCleared: [],
  });
  halves.sx.mode = 'normal';

  // The agent half answers again at revision 1: nothing changed, nothing reported.
  const back = await call('GET', '/api/plugins/sx/settings');
  assert.equal(back.json().source, 'live');
  assert.equal(back.json().revision, 1);
  assert.equal((await auditOf(lib.SETTINGS_CHANGED_OUTSIDE_ACTION, 'sx')).length, 0);
});

test('an agent half that stores the change but answers unsigned: 502, then recorded as the admin’s change', async () => {
  halves.sx.mode = 'unsigned';
  const res = await call('PUT', '/api/plugins/sx/settings', {
    revision: 1,
    values: { retries: 6 },
  });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().code, 'unauthenticated');
  assert.equal(halves.sx.store.state().revision, 2, 'the old agent half stored it');
  halves.sx.mode = 'normal';

  const before = (await auditOf('plugin.settings.updated', 'sx')).length;
  const read = await call('GET', '/api/plugins/sx/settings');
  assert.equal(read.json().revision, 2);
  assert.equal(read.json().values.retries, 6);
  const updates = await auditOf('plugin.settings.updated', 'sx');
  assert.equal(updates.length, before + 1);
  assert.deepEqual(updates.at(-1).details, {
    changed: ['retries'],
    cleared: [],
    secretsSet: [],
    secretsCleared: [],
    revision: 2,
    confirmedLater: true,
  });
  assert.equal(updates.at(-1).actor, 'admin');
  const row = await cacheRow('sx');
  assert.equal(row.lamaste_revision, 2);
  assert.equal(row.unconfirmed_change_json, null);
  assert.equal((await auditOf(lib.SETTINGS_CHANGED_OUTSIDE_ACTION, 'sx')).length, 0);
});

// ---------------------------------------------------------------------------
// The agent half's 422
// ---------------------------------------------------------------------------

test('422: only Lamaste’s own messages, under keys of the installed schema', async () => {
  halves.sx.mode = 'reject';
  halves.sx.rejectWith = {
    endpoint: `Must look like ${SECRET}`,
    retries: 'Must be at most 10',
    region: 'Must be one of the options',
    apiKey: 'Could not be decrypted',
    _: '2 unknown settings',
    [SECRET.replace(/-/g, '').replace(/^sk/, 'zz')]: 'Is required',
    notAField: 'Is required',
  };
  const res = await call('PUT', '/api/plugins/sx/settings', {
    revision: 2,
    values: { endpoint: 'https://b.example' },
  });
  assert.equal(res.statusCode, 422);
  assert.deepEqual(res.json(), {
    error: 'Invalid settings',
    errors: {
      endpoint: 'Invalid value',
      retries: 'Must be at most 10',
      region: 'Must be one of the options',
      apiKey: 'Could not be decrypted',
      _: '2 unknown settings',
    },
  });
  assert.ok(!res.body.includes(SECRET));

  // Nothing passed on at all: one message for the update as a whole.
  halves.sx.rejectWith = { [`x${'y'.repeat(70)}`]: 'Is required' };
  const empty = await call('PUT', '/api/plugins/sx/settings', {
    revision: 2,
    values: { endpoint: 'https://b.example' },
  });
  assert.deepEqual(empty.json().errors, { _: 'The agent half refused the values' });
  halves.sx.mode = 'normal';
});

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

test('a change made outside Lamaste is audited and notified once, by key name, then adopted', async () => {
  const changed = await halves.sx.store.update({
    schemaVersion: 1,
    baseRevision: 2,
    values: { endpoint: 'https://outside.example', region: 'us' },
    secrets: { apiKey: OTHER_SECRET },
  });
  assert.equal(changed.ok, true);

  const read = await call('GET', '/api/plugins/sx/settings');
  assert.equal(read.json().revision, 3);
  const outside = await auditOf(lib.SETTINGS_CHANGED_OUTSIDE_ACTION, 'sx');
  assert.equal(outside.length, 1);
  assert.equal(outside[0].actor, 'lamaste');
  assert.deepEqual(outside[0].details, {
    changed: ['endpoint', 'region'],
    secretsChanged: ['apiKey'],
    fromRevision: 2,
    revision: 3,
    agentLabel: 'vm1',
  });
  const notes = await notificationsMatching(/changed outside Lamaste/);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].level, 'warning');
  assert.match(notes[0].message, /sx .*agent "vm1" \(revision 2 → 3: endpoint, region, apiKey\)/);
  assert.equal((await cacheRow('sx')).lamaste_revision, 3);

  // Read again: adopted, so reported once.
  await call('GET', '/api/plugins/sx/settings');
  await lib.refreshPluginSettings('sx', { logger: app.log });
  assert.equal((await auditOf(lib.SETTINGS_CHANGED_OUTSIDE_ACTION, 'sx')).length, 1);
  assert.equal((await notificationsMatching(/changed outside Lamaste/)).length, 1);

  // A change of Lamaste's own is not one made outside.
  const own = await call('PUT', '/api/plugins/sx/settings', {
    revision: 3,
    values: { retries: 2 },
  });
  assert.equal(own.statusCode, 200, own.body);
  await call('GET', '/api/plugins/sx/settings');
  assert.equal((await auditOf(lib.SETTINGS_CHANGED_OUTSIDE_ACTION, 'sx')).length, 1);
});

test('files put back with an older revision are a change made outside Lamaste too', async () => {
  // The agent half now runs from a fresh data directory: revision 0, nothing set.
  await halves.sx.useStore(SX_SETTINGS, await mkdtemp(path.join(halvesDir, 'sx-restored-')));
  await lib.refreshPluginSettings('sx', { logger: app.log });
  const outside = await auditOf(lib.SETTINGS_CHANGED_OUTSIDE_ACTION, 'sx');
  assert.equal(outside.length, 2);
  assert.deepEqual(outside[1].details, {
    changed: ['endpoint', 'region', 'retries'],
    secretsChanged: ['apiKey'],
    fromRevision: 4,
    revision: 0,
    agentLabel: 'vm1',
  });
  assert.equal((await cacheRow('sx')).lamaste_revision, 0);
});

test('a change made on a revision Lamaste never saw reports what changed before it', async () => {
  // Outside: revision 0 → 1, without the relay reading it.
  await halves.sx.store.update({
    schemaVersion: 1,
    baseRevision: 0,
    values: { region: 'eu' },
    secrets: {},
  });
  // An API client that guessed the revision.
  const res = await call('PUT', '/api/plugins/sx/settings', {
    revision: 1,
    values: { retries: 9 },
    secrets: { apiKey: SECRET },
  });
  assert.equal(res.statusCode, 200, res.body);
  const outside = await auditOf(lib.SETTINGS_CHANGED_OUTSIDE_ACTION, 'sx');
  assert.equal(outside.length, 3);
  assert.deepEqual(outside[2].details, {
    changed: ['region'],
    secretsChanged: [],
    fromRevision: 0,
    revision: 1,
    agentLabel: 'vm1',
  });
  assert.equal((await cacheRow('sx')).lamaste_revision, 2);
});

test('a lost answer and then a change outside Lamaste in other keys: reported as outside', async () => {
  halves.sx.mode = 'squatter';
  const lost = await call('PUT', '/api/plugins/sx/settings', {
    revision: 2,
    values: { retries: 1 },
  });
  assert.equal(lost.json().code, 'unauthenticated');
  halves.sx.mode = 'normal';
  // Revision 3 is the lost change's revision — but it changed another key.
  await halves.sx.store.update({
    schemaVersion: 1,
    baseRevision: 2,
    values: { endpoint: 'https://sneaky.example' },
    secrets: {},
  });
  await lib.refreshPluginSettings('sx', { logger: app.log });
  const outside = await auditOf(lib.SETTINGS_CHANGED_OUTSIDE_ACTION, 'sx');
  assert.equal(outside.length, 4);
  assert.deepEqual(outside[3].details.changed, ['endpoint']);
  assert.equal(outside[3].details.revision, 3);
  assert.equal((await cacheRow('sx')).unconfirmed_change_json, null);
});

// ---------------------------------------------------------------------------
// The panel starting
// ---------------------------------------------------------------------------

test('start: every reachable hosting with settings is read once; a hosting that is down is not', async () => {
  // While the panel was down, the agent half changed.
  await halves.sx.store.update({
    schemaVersion: 1,
    baseRevision: 3,
    values: { retries: 7 },
    secrets: {},
  });
  await setHealth('sx', 'down', 'tunnel');
  assert.equal(await lib.refreshHostedPluginSettings(app.log), 0);
  assert.equal((await cacheRow('sx')).revision, 3);

  await setHealth('sx', 'up');
  assert.equal(await lib.refreshHostedPluginSettings(app.log), 1);
  const row = await cacheRow('sx');
  assert.equal(row.revision, 4);
  assert.equal(JSON.parse(row.values_json).retries, 7);
  const outside = await auditOf(lib.SETTINGS_CHANGED_OUTSIDE_ACTION, 'sx');
  assert.equal(outside.length, 5, 'the change made while the panel was down is reported');
  assert.equal(outside[4].details.fromRevision, 3);

  // Nothing new: read, nothing reported.
  assert.equal(await lib.refreshHostedPluginSettings(app.log), 1);
  assert.equal((await auditOf(lib.SETTINGS_CHANGED_OUTSIDE_ACTION, 'sx')).length, 5);
});

// ---------------------------------------------------------------------------
// Pruning on a schema change
// ---------------------------------------------------------------------------

async function seedCache(name, values, secretsSet) {
  (await db())
    .prepare(
      `INSERT INTO plugin_settings
         (plugin, schema_version, revision, values_json, secrets_set_json, configured,
          missing_json, synced_at, lamaste_revision)
       VALUES (?, 1, 5, ?, ?, 1, '[]', ?, 5)
       ON CONFLICT(plugin) DO UPDATE SET values_json = excluded.values_json,
         secrets_set_json = excluded.secrets_set_json, configured = 1, missing_json = '[]'`,
    )
    .run(name, JSON.stringify(values), JSON.stringify(secretsSet), new Date().toISOString());
}

test('pruning: secret ↔ plain both ways, dropped fields, status worked out again', () => {
  const row = {
    values_json: JSON.stringify({ endpoint: 'https://x.example', retries: 2, gone: true }),
    secrets_set_json: JSON.stringify({ token: '2026-10-16T08:00:00.000Z' }),
  };
  const pruned = lib.prunedSettingsCache(row, QX_V1, QX_V2);
  assert.deepEqual(pruned, {
    // endpoint became a secret: its plain value goes; gone is gone.
    values: { retries: 2 },
    // token became a plain value: its setAt goes, never its value into values.
    secretsSet: {},
    configured: false,
    missing: ['endpoint', 'region'],
  });
  assert.equal(lib.prunedSettingsCache(row, QX_V1, QX_V1), null, 'same schema: untouched');
  assert.equal(lib.prunedSettingsCache(null, QX_V1, QX_V2), null, 'no row: nothing');
  assert.deepEqual(lib.prunedSettingsCache(row, QX_V1, null), { delete: true });
  // A schema the relay never had: nothing is known to still match.
  assert.deepEqual(lib.prunedSettingsCache(row, null, QX_V1).values, {});
});

test('pruning: writing the plugin row prunes the cache in the same transaction', async () => {
  await seedCache(
    'qx',
    { endpoint: 'https://x.example', retries: 2, gone: true },
    { token: '2026-10-16T08:00:00.000Z' },
  );
  await lib.writePluginRow('qx', manifests.qx('1.1.0', QX_V2), null, null);
  let row = await cacheRow('qx');
  assert.deepEqual(JSON.parse(row.values_json), { retries: 2 });
  assert.deepEqual(JSON.parse(row.secrets_set_json), {});
  assert.equal(row.configured, 0);
  assert.deepEqual(JSON.parse(row.missing_json), ['endpoint', 'region']);
  assert.equal(row.revision, 5, 'the revision and provenance stay');
  assert.equal(row.lamaste_revision, 5);
  assert.deepEqual((await lib.findPlugin('qx')).settings, QX_V2);

  // The revert: the plain token's value never existed in the cache, and
  // the endpoint secret was never set — nothing comes back.
  await lib.writePluginRow('qx', manifests.qx('1.0.0', QX_V1), null, null);
  row = await cacheRow('qx');
  assert.deepEqual(JSON.parse(row.values_json), { retries: 2 });
  assert.deepEqual(JSON.parse(row.secrets_set_json), {});

  // One transaction: when pruning fails, the plugin's row is not written either.
  const handle = await db();
  await seedCache('qx', { endpoint: 'https://x.example' }, { token: '2026-10-16T08:00:00.000Z' });
  handle.exec(`CREATE TEMP TRIGGER fail_prune BEFORE UPDATE ON plugin_settings
               BEGIN SELECT RAISE(ABORT, 'prune refused'); END`);
  try {
    await assert.rejects(
      lib.writePluginRow('qx', manifests.qx('1.1.0', QX_V2), null, null),
      /prune refused/,
    );
  } finally {
    handle.exec('DROP TRIGGER fail_prune');
  }
  const plugin = await lib.findPlugin('qx');
  assert.equal(plugin.version, '1.0.0');
  assert.deepEqual(plugin.settings, QX_V1);
  assert.deepEqual(JSON.parse((await cacheRow('qx')).values_json), {
    endpoint: 'https://x.example',
  });

  // A version without settings drops the cache with the row's write.
  const withoutSettings = manifests.qx('1.2.0');
  delete withoutSettings.settings;
  await lib.writePluginRow('qx', withoutSettings, null, null);
  assert.equal(await cacheRow('qx'), null);
});

// ---------------------------------------------------------------------------
// Secrets that become plain values: always an administrator's approval
// ---------------------------------------------------------------------------

const TOKEN_TURNS_PLAIN =
  'it turns secret settings into plain ones (token) — what is typed into them next is kept on the relay and shown in clear';

function stageUpdate(name, version) {
  return lib.updatePlugin(name, version, {
    actor: 'admin',
    certSerial: null,
    logger: app.log,
    sourceIp: IP,
  });
}

async function finished(name, operation) {
  assert.ok(operation, 'an operation started');
  const done = await lib.waitForPluginOperation(name);
  assert.equal(done.id, operation.id);
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  return done;
}

async function updateApprovals(name) {
  return (await auditOf('hooks.approved', name)).filter((entry) => entry.details.for === 'update');
}

test('a secret turned plain waits for approval even when the digest is already approved', async () => {
  const before = await lib.hookStatus(await lib.findPlugin('rx'));
  assert.equal(before.approval.state, 'approved');
  const { digest } = before.approval;

  // As before: the same relay hooks and the same settings run at once; so
  // does a settings change that turns no secret plain.
  await publish('rx', '1.0.1');
  await finished('rx', (await stageUpdate('rx', '1.0.1')).operation);
  await publish('rx', '1.0.2', manifests.rx('1.0.2', PX_V1_RETRIES));
  await finished('rx', (await stageUpdate('rx', '1.0.2')).operation);
  assert.equal((await lib.findPlugin('rx')).version, '1.0.2');
  assert.equal((await auditOf('plugin.update.awaiting-approval', 'rx')).length, 0);

  // token turns plain; the relay hooks — and so the digest — stay the same.
  await publish('rx', '1.1.0', manifests.rx('1.1.0', PX_V2));
  const staged = await stageUpdate('rx', '1.1.0');
  assert.ok(staged.pendingUpdate, JSON.stringify(staged));
  assert.equal(staged.pendingUpdate.digest, digest, 'the digest is the approved one');
  assert.deepEqual(staged.pendingUpdate.approvalRequired, [
    { code: 'settings.secret-to-plain', reason: TOKEN_TURNS_PLAIN },
  ]);
  assert.equal(staged.pendingUpdate.autoApproveWithheld, null, 'auto-approve is off');
  assert.deepEqual(staged.pendingUpdate.settings.secretToPlain, ['token']);
  assert.equal((await lib.findPlugin('rx')).version, '1.0.2', 'the installed version stays');

  // The same pending state and view as an update whose digest changed.
  const hooks = (await call('GET', '/api/plugins/rx/hooks')).json().hooks;
  assert.deepEqual(hooks.pendingUpdate, staged.pendingUpdate);
  assert.equal(hooks.approval.state, 'approved');
  const listed = (await call('GET', '/api/plugins')).json().plugins.find((p) => p.name === 'rx');
  assert.deepEqual(listed.hooks.pendingUpdate, { version: '1.1.0', digest });

  const waiting = await auditOf('plugin.update.awaiting-approval', 'rx');
  assert.equal(waiting.length, 1);
  assert.deepEqual(waiting[0].details, {
    from: '1.0.2',
    to: '1.1.0',
    digest,
    codes: ['settings.secret-to-plain'],
    certSerial: null,
  });
  assert.equal((await auditOf('hooks.auto-approve.withheld', 'rx')).length, 0);
  const notes = await notificationsMatching(/^rx 1\.1\.0 /);
  assert.deepEqual(
    notes.map((n) => [n.level, n.message]),
    [['warning', `rx 1.1.0 waits for your approval: ${TOKEN_TURNS_PLAIN}.`]],
  );

  // Approved with the digest it shows — the one already approved: applied.
  const approved = await call('POST', '/api/plugins/rx/hooks/approve', { digest });
  assert.equal(approved.statusCode, 202, approved.body);
  await finished('rx', approved.json().operation);
  const updated = await lib.findPlugin('rx');
  assert.equal(updated.version, '1.1.0');
  assert.deepEqual(updated.settings, PX_V2);
  const after = await lib.hookStatus(updated);
  assert.equal(after.pendingUpdate, null);
  assert.equal(after.approval.state, 'approved');
  assert.equal(after.approval.approvedDigest, digest);
  assert.equal(after.approval.approvedVersion, '1.1.0');
  assert.equal(after.approval.approvedBy, 'admin');
  const approvals = await updateApprovals('rx');
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].actor, 'admin');
  assert.deepEqual(approvals[0].details, {
    digest,
    version: '1.1.0',
    for: 'update',
    codes: ['settings.secret-to-plain'],
    certSerial: null,
  });
  const updates = await auditOf('plugin.updated', 'rx');
  assert.equal(updates.at(-1).details.to, '1.1.0');
  assert.equal(updates.at(-1).details.approvedBy, 'admin');
});

test('auto-approve never covers a secret turned plain; the approval binds the update as shown', async () => {
  await lib.setAutoApprove('px', true, { actor: 'admin', certSerial: null });
  const installedDigest = (await lib.hookStatus(await lib.findPlugin('px'))).approval.digest;
  await publish('px', '1.1.0', manifests.px('1.1.0', PX_V2));
  const staged = await stageUpdate('px', '1.1.0');
  assert.ok(staged.pendingUpdate, 'it waits for an administrator, auto-approve on');
  const { digest } = staged.pendingUpdate;
  assert.notEqual(digest, installedDigest, 'a new agent half: another digest');
  assert.deepEqual(staged.pendingUpdate.approvalRequired, [
    { code: 'digest.unapproved', reason: 'its agent half is not what was approved' },
    { code: 'settings.secret-to-plain', reason: TOKEN_TURNS_PLAIN },
  ]);
  // Auto-approve would cover the agent half (same package and service): only the secret withholds it.
  assert.deepEqual(staged.pendingUpdate.autoApproveWithheld, [TOKEN_TURNS_PLAIN]);
  const withheld = await auditOf('hooks.auto-approve.withheld', 'px');
  assert.equal(withheld.length, 1);
  assert.equal(withheld[0].actor, 'auto-approve');
  assert.deepEqual(withheld[0].details, {
    digest,
    version: '1.1.0',
    reasons: [TOKEN_TURNS_PLAIN],
    codes: ['settings.secret-to-plain'],
    requestedBy: 'admin',
  });
  const [waiting] = await auditOf('plugin.update.awaiting-approval', 'px');
  assert.deepEqual(waiting.details.codes, ['digest.unapproved', 'settings.secret-to-plain']);
  const notes = await notificationsMatching(/^px 1\.1\.0 /);
  assert.deepEqual(
    notes.map((n) => n.message),
    [
      `px 1.1.0 waits for your approval: its agent half is not what was approved; ${TOKEN_TURNS_PLAIN}.`,
    ],
  );

  // An approval names the update that was shown.
  const refusals = [
    [{ digest, version: '1.0.9' }, 409, /is version 1\.1\.0, not 1\.0\.9/],
    [{ version: '1.1.0' }, 400, /approve it with the approval digest it shows/],
    [{ digest: null, version: '1.1.0' }, 400, /approve it with the approval digest it shows/],
    [{ digest: installedDigest, version: '1.1.0' }, 409, /changed since it was shown/],
    [{}, 400, null],
    [{ digest: null }, 400, null],
    [{ digest, version: '1.1.0', extra: true }, 400, null],
  ];
  for (const [body, status, message] of refusals) {
    const res = await call('POST', '/api/plugins/px/hooks/approve', body);
    assert.equal(res.statusCode, status, `${JSON.stringify(body)}: ${res.body}`);
    if (message) assert.match(res.json().error, message);
  }
  const mismatch = await call('POST', '/api/plugins/px/hooks/approve', {
    digest: installedDigest,
    version: '1.1.0',
  });
  assert.equal(mismatch.json().currentDigest, digest);

  // 1.1.0 is published again turning pin plain too: approving token alone
  // does not cover it, and nothing is applied or audited as approved.
  await publish('px', '1.1.0', manifests.px('1.1.0', PX_V3));
  const stale = await call('POST', '/api/plugins/px/hooks/approve', { digest, version: '1.1.0' });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.match(stale.json().error, /plain ones that were not approved \(pin\) — review it again/);
  assert.equal((await lib.findPlugin('px')).version, '1.0.0');
  assert.equal((await updateApprovals('px')).length, 0);

  // Reviewed again — token and pin — and approved by version and digest: applied.
  const again = await stageUpdate('px', '1.1.0');
  assert.deepEqual(again.pendingUpdate.settings.secretToPlain, ['token', 'pin']);
  assert.equal(again.pendingUpdate.digest, digest, 'settings are outside the digest');
  const approved = await call('POST', '/api/plugins/px/hooks/approve', {
    digest,
    version: '1.1.0',
  });
  assert.equal(approved.statusCode, 202, approved.body);
  await finished('px', approved.json().operation);
  const status = await lib.hookStatus(await lib.findPlugin('px'));
  assert.equal(status.pendingUpdate, null);
  assert.equal(status.approval.approvedDigest, digest);
  assert.equal(status.approval.approvedBy, 'admin');
  const approvals = await updateApprovals('px');
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].actor, 'admin');
  assert.deepEqual(approvals[0].details.codes, ['digest.unapproved', 'settings.secret-to-plain']);

  // As before: the same agent half with no secret turned plain is auto-approved.
  await publish('px', '1.1.1', manifests.px('1.1.1', PX_V3));
  const auto = await stageUpdate('px', '1.1.1');
  await finished('px', auto.operation);
  const [autoApproval] = (await updateApprovals('px')).slice(-1);
  assert.equal(autoApproval.actor, 'auto-approve');
  assert.deepEqual(autoApproval.details.codes, ['digest.unapproved']);
  assert.equal(
    (await lib.hookStatus(await lib.findPlugin('px'))).approval.approvedBy,
    'auto-approve',
  );
  assert.equal((await auditOf('hooks.auto-approve.withheld', 'px')).length, 2);
  await lib.setAutoApprove('px', false, { actor: 'admin', certSerial: null });
});

test('nothing else to approve: a secret turned plain still waits, approved by its version', async () => {
  // ux brings neither relay hooks nor an agent half Lamaste installs.
  await lib.setAutoApprove('ux', true, { actor: 'admin', certSerial: null });
  assert.equal((await lib.hookStatus(await lib.findPlugin('ux'))).approval.state, 'not-required');

  // As before: an update that needs no approval runs at once, settings changed or not.
  await publish('ux', '1.0.1', manifests.ux('1.0.1', PX_V1_RETRIES));
  await finished('ux', (await stageUpdate('ux', '1.0.1')).operation);

  await publish('ux', '1.1.0', manifests.ux('1.1.0', PX_V2));
  const staged = await stageUpdate('ux', '1.1.0');
  assert.ok(staged.pendingUpdate, JSON.stringify(staged));
  assert.equal(staged.pendingUpdate.digest, null, 'there is no digest to approve it with');
  assert.equal(staged.pendingUpdate.relay, null);
  assert.equal(staged.pendingUpdate.agentHalf, null);
  assert.deepEqual(staged.pendingUpdate.approvalRequired, [
    { code: 'settings.secret-to-plain', reason: TOKEN_TURNS_PLAIN },
  ]);
  assert.deepEqual(staged.pendingUpdate.autoApproveWithheld, [TOKEN_TURNS_PLAIN]);
  const hooks = (await call('GET', '/api/plugins/ux/hooks')).json().hooks;
  assert.deepEqual(hooks.pendingUpdate, staged.pendingUpdate);
  assert.equal(hooks.approval.state, 'not-required');
  assert.equal((await lib.findPlugin('ux')).version, '1.0.1');
  const [waiting] = await auditOf('plugin.update.awaiting-approval', 'ux');
  assert.deepEqual(waiting.details, {
    from: '1.0.1',
    to: '1.1.0',
    digest: null,
    codes: ['settings.secret-to-plain'],
    certSerial: null,
  });

  // A digest cannot approve it; a digest where it has none is a changed update.
  const byDigest = await call('POST', '/api/plugins/ux/hooks/approve', { digest: 'a'.repeat(64) });
  assert.equal(byDigest.statusCode, 400);
  assert.match(byDigest.json().error, /nothing to approve/);
  const withDigest = await call('POST', '/api/plugins/ux/hooks/approve', {
    digest: 'a'.repeat(64),
    version: '1.1.0',
  });
  assert.equal(withDigest.statusCode, 409);
  assert.equal(withDigest.json().currentDigest, null);

  // Discarded and staged again, it waits again; approved by its version: applied.
  assert.equal((await call('DELETE', '/api/plugins/ux/update')).statusCode, 200);
  assert.equal((await lib.hookStatus(await lib.findPlugin('ux'))).pendingUpdate, null);
  assert.ok((await stageUpdate('ux', '1.1.0')).pendingUpdate);
  const approved = await call('POST', '/api/plugins/ux/hooks/approve', {
    digest: null,
    version: '1.1.0',
  });
  assert.equal(approved.statusCode, 202, approved.body);
  await finished('ux', approved.json().operation);
  const updated = await lib.findPlugin('ux');
  assert.equal(updated.version, '1.1.0');
  assert.equal((await lib.hookStatus(updated)).pendingUpdate, null);
  const approvals = await updateApprovals('ux');
  assert.equal(approvals.length, 1);
  assert.deepEqual(approvals[0].details, {
    digest: null,
    version: '1.1.0',
    for: 'update',
    codes: ['settings.secret-to-plain'],
    certSerial: null,
  });
  const updates = await auditOf('plugin.updated', 'ux');
  assert.equal(updates.at(-1).details.approvedBy, 'admin');

  // Approving by version with no update waiting is refused.
  const none = await call('POST', '/api/plugins/ux/hooks/approve', { version: '1.1.0' });
  assert.equal(none.statusCode, 409);
  assert.match(none.json().error, /has no update waiting for approval/);
  await lib.setAutoApprove('ux', false, { actor: 'admin', certSerial: null });
});

test('a pending update stored without its reasons waited for its digest', () => {
  const view = lib.pendingUpdateView({
    version: '2.0.0',
    digest: 'b'.repeat(64),
    stagedAt: '2026-10-16T08:00:00.000Z',
    preview: { digest: 'c'.repeat(64) },
    agentHalf: null,
    settings: null,
  });
  assert.deepEqual(view.approvalRequired, [
    { code: 'digest.unapproved', reason: 'its relay hooks are not what was approved' },
  ]);
  assert.equal(view.autoApproveWithheld, null);
  assert.deepEqual(lib.settingsApprovalRequired(null), []);
  assert.deepEqual(lib.settingsApprovalRequired({ secretToPlain: [] }), []);
});

// ---------------------------------------------------------------------------
// The secrets, nowhere
// ---------------------------------------------------------------------------

test('no response, log line, audit entry or notification carries a secret', async () => {
  assert.ok(responses.length > 10);
  const rows = JSON.stringify([
    (await db()).prepare('SELECT * FROM audit_events').all(),
    (await db()).prepare('SELECT * FROM notifications').all(),
    (await db()).prepare('SELECT * FROM plugin_settings').all(),
  ]);
  for (const secret of [SECRET, OTHER_SECRET]) {
    for (const body of responses) assert.ok(!body.includes(secret), 'a response');
    for (const line of logLines) assert.ok(!line.includes(secret), 'a log line');
    assert.ok(!rows.includes(secret), 'a row');
  }
});
