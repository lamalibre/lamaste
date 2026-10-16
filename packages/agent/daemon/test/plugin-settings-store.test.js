/**
 * Plugin settings in the agent half (slice 4): the store keeps
 * `settings.json` and `secrets.json` in the half's data directory — 0600,
 * written atomically, never through a symbolic link, a secret never in
 * `settings.json` — reconciles them with the half's own schema on load
 * (retyped and unknown keys dropped, never converted; `settings.json` then
 * records that schema's version), refuses a stale
 * revision or another schema version, and `/admin/settings` answers only
 * Lamaste — an update only with its body as signed and its secrets sealed
 * to that request — never with a secret's value, every answer authenticated.
 * End to end: the relay's `callAgentHalf` against the handler over HTTP.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  ManifestValidationError,
  RESPONDER_HEADER,
  signCallerAssertion,
  signResponder,
  bodySha256Hex,
  generateCallerAssertionNonce,
  generateHostingSecret,
  encryptSettingsSecret,
  callAgentHalf,
  AGENT_HALF_SETTINGS_MAX_BYTES,
} from '@lamalibre/lamaste';
import {
  settingsFromManifest,
  createSettingsStore,
  createSettingsHandler,
  createCallerAssertionVerifier,
} from '@lamalibre/lamaste/agent';

/** A secret value distinctive enough to search every file and answer for. */
const SECRET = 'sk-Zq9-distinctive-SECRET-7731';
const PLUGIN = 'fx';

const manifestV1 = {
  name: 'fx',
  version: '1.0.0',
  settings: {
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
      { key: 'gone', label: 'Gone', type: 'string' },
    ],
  },
};

/** v2: retries becomes a string, apiKey a plain string, verbose a secret, gone removed, us dropped. */
const manifestV2 = {
  ...manifestV1,
  settings: {
    schemaVersion: 2,
    fields: [
      { key: 'apiKey', label: 'API key', type: 'string' },
      { key: 'token', label: 'Token', type: 'secret' },
      {
        key: 'schedule',
        label: 'Schedule',
        type: 'string',
        pattern: '^[0-9]{2}:[0-9]{2}$',
        default: '06:00',
      },
      { key: 'retries', label: 'Retries', type: 'string' },
      {
        key: 'region',
        label: 'Region',
        type: 'enum',
        required: true,
        options: [{ value: 'eu', label: 'Europe' }],
      },
      { key: 'verbose', label: 'Verbose', type: 'secret' },
      { key: 'endpoint', label: 'Endpoint', type: 'string', required: true },
    ],
  },
};

const v1 = settingsFromManifest(manifestV1);
const v2 = settingsFromManifest(manifestV2);

let root;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'lamaste-plugin-settings-'));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A new, empty data directory for one agent half. */
function freshDir() {
  return mkdtemp(path.join(root, 'data-'));
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf-8'));
}

async function mode(file) {
  return (await stat(file)).mode & 0o777;
}

async function filesIn(dir) {
  return (await readdir(dir)).sort();
}

async function loadedStore(dataDir, settings = v1) {
  const store = createSettingsStore({ dataDir, settings });
  await store.load();
  return store;
}

const FULL_UPDATE = {
  schemaVersion: 1,
  baseRevision: 0,
  values: { schedule: '07:30', retries: 5, region: 'us', verbose: true, gone: 'old' },
  secrets: { apiKey: SECRET },
};

// ---------------------------------------------------------------------------
// The manifest's block
// ---------------------------------------------------------------------------

test('settingsFromManifest: parses only the settings block; throws on none or a bad one', () => {
  assert.equal(v1.schemaVersion, 1);
  assert.equal(v1.fields.length, 7);
  // Nothing else of the manifest is validated here.
  assert.equal(settingsFromManifest({ settings: manifestV1.settings, name: 7 }).fields.length, 7);
  for (const bad of [null, [], 'x', { name: 'fx' }]) {
    assert.throws(() => settingsFromManifest(bad), ManifestValidationError);
  }
  assert.throws(
    () =>
      settingsFromManifest({
        settings: {
          schemaVersion: 1,
          fields: [{ key: 'k', label: 'K', type: 'secret', default: 'x' }],
        },
      }),
    (err) =>
      err instanceof ManifestValidationError &&
      err.issues.some((i) => i.path === 'settings.fields.0.default'),
  );
});

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

test('store: an empty directory loads as unconfigured and creates nothing', async () => {
  const dir = await freshDir();
  const store = await loadedStore(dir);
  assert.deepEqual(store.state(), {
    schemaVersion: 1,
    revision: 0,
    values: {},
    secrets: {},
    configured: false,
    missing: ['apiKey', 'region'],
  });
  assert.deepEqual(store.values(), { schedule: '06:00', retries: 3 });
  assert.equal(store.secret('apiKey'), undefined);
  assert.equal(store.configured(), false);
  assert.deepEqual(await filesIn(dir), []);
  assert.throws(() => createSettingsStore({ dataDir: dir, settings: v1 }).state(), /before load/);
});

test('store: an update is stored in two 0600 files; the secret only in secrets.json', async () => {
  const dir = await freshDir();
  const store = await loadedStore(dir);
  const result = await store.update(FULL_UPDATE);
  assert.equal(result.ok, true);
  assert.equal(result.state.revision, 1);
  assert.equal(result.state.configured, true);
  assert.deepEqual(result.state.missing, []);
  assert.deepEqual(Object.keys(result.state.secrets), ['apiKey']);
  assert.match(result.state.secrets.apiKey.setAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(!JSON.stringify(result.state).includes(SECRET), 'the state never carries a secret');
  assert.ok(!JSON.stringify(store.state()).includes(SECRET));
  assert.equal(store.secret('apiKey'), SECRET);
  assert.equal(store.secret('schedule'), undefined, 'secret() answers only for a secret field');
  assert.deepEqual(store.values(), {
    schedule: '07:30',
    retries: 5,
    region: 'us',
    verbose: true,
    gone: 'old',
  });

  // Atomic writes leave no temp file behind.
  assert.deepEqual(await filesIn(dir), ['secrets.json', 'settings.json']);
  assert.equal(await mode(path.join(dir, 'settings.json')), 0o600);
  assert.equal(await mode(path.join(dir, 'secrets.json')), 0o600);
  const settingsText = await readFile(path.join(dir, 'settings.json'), 'utf-8');
  assert.ok(!settingsText.includes(SECRET), 'settings.json never holds a secret');
  assert.deepEqual(JSON.parse(settingsText), {
    v: 1,
    schemaVersion: 1,
    revision: 1,
    values: {
      schedule: { type: 'string', value: '07:30' },
      retries: { type: 'integer', value: 5 },
      region: { type: 'enum', value: 'us' },
      verbose: { type: 'boolean', value: true },
      gone: { type: 'string', value: 'old' },
    },
  });
  const secretsFile = await readJson(path.join(dir, 'secrets.json'));
  assert.equal(secretsFile.v, 1);
  assert.equal(secretsFile.secrets.apiKey.value, SECRET);

  // A fresh store reads the same state back.
  const again = await loadedStore(dir);
  assert.deepEqual(again.state(), store.state());
  assert.equal(again.secret('apiKey'), SECRET);
});

test('store: secrets.json is rewritten only when a secret changes; null clears', async () => {
  const dir = await freshDir();
  const store = await loadedStore(dir);
  await store.update(FULL_UPDATE);
  const secretsPath = path.join(dir, 'secrets.json');
  const before = (await stat(secretsPath)).ino;

  const valuesOnly = await store.update({
    schemaVersion: 1,
    baseRevision: 1,
    values: { retries: null, gone: null },
    secrets: {},
  });
  assert.equal(valuesOnly.ok, true);
  assert.equal(valuesOnly.state.revision, 2);
  assert.equal((await stat(secretsPath)).ino, before, 'secrets.json untouched');
  assert.equal(store.values().retries, 3, 'back to the default');
  assert.equal(store.values().gone, undefined);

  const cleared = await store.update({
    schemaVersion: 1,
    baseRevision: 2,
    values: {},
    secrets: { token: 'tok-1' },
  });
  assert.equal(cleared.ok, true);
  assert.notEqual((await stat(secretsPath)).ino, before, 'secrets.json rewritten');
  const tokenCleared = await store.update({
    schemaVersion: 1,
    baseRevision: 3,
    values: {},
    secrets: { token: null },
  });
  assert.equal(tokenCleared.ok, true);
  assert.equal(store.secret('token'), undefined);
  assert.deepEqual(Object.keys(store.state().secrets), ['apiKey']);
  assert.deepEqual(Object.keys((await readJson(secretsPath)).secrets), ['apiKey']);
});

test('store: a stale revision, another schema version, invalid values — refused, nothing written', async () => {
  const dir = await freshDir();
  const store = await loadedStore(dir);
  await store.update(FULL_UPDATE);
  const settingsPath = path.join(dir, 'settings.json');
  const ino = (await stat(settingsPath)).ino;

  assert.deepEqual(await store.update({ ...FULL_UPDATE, baseRevision: 0 }), {
    ok: false,
    status: 409,
    body: {
      error: 'The settings changed since they were read',
      code: 'revision_mismatch',
      revision: 1,
    },
  });
  const schema = await store.update({ ...FULL_UPDATE, schemaVersion: 2, baseRevision: 1 });
  assert.equal(schema.ok, false);
  assert.equal(schema.status, 409);
  assert.equal(schema.body.code, 'schema_mismatch');

  const invalid = await store.update({
    schemaVersion: 1,
    baseRevision: 1,
    values: { schedule: 'Zq:97', apiKey: SECRET },
    secrets: { region: SECRET },
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 422);
  assert.deepEqual(invalid.body, {
    error: 'Invalid settings',
    errors: {
      schedule: 'Does not match the required format',
      apiKey: 'Is a secret; send it in secrets',
      region: 'Is not a secret; send it in values',
    },
  });
  assert.ok(!JSON.stringify(invalid).includes(SECRET));
  assert.ok(!JSON.stringify(invalid).includes('Zq:97'));
  assert.equal((await stat(settingsPath)).ino, ino, 'nothing written');
  assert.equal(store.state().revision, 1);
});

test('store: updates are serialized — two edits of the same revision, one wins', async () => {
  const dir = await freshDir();
  const store = await loadedStore(dir);
  const [a, b] = await Promise.all([
    store.update({ schemaVersion: 1, baseRevision: 0, values: { retries: 1 }, secrets: {} }),
    store.update({ schemaVersion: 1, baseRevision: 0, values: { retries: 2 }, secrets: {} }),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, false);
  assert.equal(b.body.code, 'revision_mismatch');
  assert.equal(store.values().retries, 1);
});

test('store: onChange after an update and a reload; unsubscribe; a throwing listener is ignored', async () => {
  const dir = await freshDir();
  const store = await loadedStore(dir);
  const seen = [];
  const off = store.onChange((state) => seen.push(state));
  store.onChange(() => {
    throw new Error('listener bug');
  });
  const result = await store.update(FULL_UPDATE);
  assert.equal(result.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].revision, 1);
  assert.ok(!JSON.stringify(seen[0]).includes(SECRET));

  await store.update({ ...FULL_UPDATE, baseRevision: 0 }); // refused: no event
  assert.equal(seen.length, 1);

  const reloaded = await store.reload();
  assert.equal(reloaded.revision, 1);
  assert.equal(seen.length, 2);
  off();
  await store.update({ ...FULL_UPDATE, baseRevision: 1 });
  assert.equal(seen.length, 2);
});

test('store: reconcile drops retyped and unknown keys — never converts, persists only then', async () => {
  const dir = await freshDir();
  const s1 = await loadedStore(dir);
  await s1.update({ ...FULL_UPDATE, secrets: { apiKey: SECRET, token: 'tok-1' } });

  // The same version loads with nothing to drop: no file rewritten.
  const settingsPath = path.join(dir, 'settings.json');
  const secretsPath = path.join(dir, 'secrets.json');
  const inos = [(await stat(settingsPath)).ino, (await stat(secretsPath)).ino];
  await loadedStore(dir);
  assert.deepEqual([(await stat(settingsPath)).ino, (await stat(secretsPath)).ino], inos);

  const s2 = await loadedStore(dir, v2);
  const state = s2.state();
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.revision, 1, 'reconciling is not an update');
  // retries (integer -> string), verbose (boolean -> secret), gone (removed),
  // region "us" (no longer an option): dropped. schedule survives.
  assert.deepEqual(state.values, { schedule: '07:30' });
  // apiKey (secret -> string) dropped; token stays a secret.
  assert.deepEqual(Object.keys(state.secrets), ['token']);
  assert.equal(s2.secret('apiKey'), undefined);
  assert.equal(s2.secret('token'), 'tok-1');
  assert.deepEqual(state.missing, ['region', 'endpoint']);
  assert.equal(state.configured, false);

  // Persisted: the secret that became a string is gone from secrets.json and
  // never moved into settings.json.
  const settingsText = await readFile(settingsPath, 'utf-8');
  assert.ok(!settingsText.includes(SECRET));
  assert.deepEqual(JSON.parse(settingsText), {
    v: 1,
    schemaVersion: 2,
    revision: 1,
    values: { schedule: { type: 'string', value: '07:30' } },
  });
  assert.ok(!(await readFile(secretsPath, 'utf-8')).includes(SECRET));
  assert.deepEqual(Object.keys((await readJson(secretsPath)).secrets), ['token']);

  // A string that becomes a secret: the stored string is dropped, not adopted as the secret.
  const s3 = await loadedStore(dir, v1);
  assert.equal(s3.secret('apiKey'), undefined);
});

test('store: settings.json records the schema version it was reconciled with, even when no value was dropped', async () => {
  const dir = await freshDir();
  const s1 = await loadedStore(dir);
  await s1.update({ ...FULL_UPDATE, secrets: { apiKey: SECRET, token: 'tok-1' } });
  const settingsPath = path.join(dir, 'settings.json');
  const written = await readJson(settingsPath);

  // v3: the secret token becomes a plain string — only secrets.json loses something.
  const v3 = settingsFromManifest({
    ...manifestV1,
    settings: {
      schemaVersion: 3,
      fields: manifestV1.settings.fields.map((f) =>
        f.key === 'token' ? { key: 'token', label: 'Token', type: 'string' } : f,
      ),
    },
  });
  const s3 = await loadedStore(dir, v3);
  assert.equal(s3.secret('token'), undefined);
  assert.equal(s3.state().revision, 1, 'reconciling is not an update');
  assert.deepEqual(await readJson(settingsPath), { ...written, schemaVersion: 3 });
  assert.equal(await mode(settingsPath), 0o600);

  // Loaded again at v3: nothing to rewrite.
  const ino = (await stat(settingsPath)).ino;
  await loadedStore(dir, v3);
  assert.equal((await stat(settingsPath)).ino, ino);

  // No settings.json records no version: an empty directory still gets no file.
  const empty = await freshDir();
  await loadedStore(empty, v3);
  assert.deepEqual(await filesIn(empty), []);
});

test('store: a value that no longer passes its checks is dropped on load', async () => {
  const dir = await freshDir();
  await writeFile(
    path.join(dir, 'settings.json'),
    JSON.stringify({
      v: 1,
      schemaVersion: 1,
      revision: 7,
      values: {
        schedule: { type: 'string', value: 'not-a-time' },
        retries: { type: 'integer', value: 42 },
        verbose: { type: 'boolean', value: false },
      },
    }),
    { mode: 0o600 },
  );
  const store = await loadedStore(dir);
  assert.equal(store.state().revision, 7);
  assert.deepEqual(store.state().values, { verbose: false });
  assert.deepEqual((await readJson(path.join(dir, 'settings.json'))).values, {
    verbose: { type: 'boolean', value: false },
  });
});

test('store: a symbolic link is refused on read and on write; its target is untouched', async () => {
  const dir = await freshDir();
  const elsewhere = path.join(await mkdtemp(path.join(root, 'elsewhere-')), 'target.json');
  await writeFile(elsewhere, JSON.stringify({ v: 1, secrets: {} }), { mode: 0o600 });
  await symlink(elsewhere, path.join(dir, 'secrets.json'));
  await assert.rejects(loadedStore(dir), /secrets\.json: it is a symbolic link/);

  // Loaded before the link appeared: the write is refused, nothing lands in the target.
  const dir2 = await freshDir();
  const store = await loadedStore(dir2);
  await symlink(elsewhere, path.join(dir2, 'secrets.json'));
  await assert.rejects(store.update(FULL_UPDATE), /symbolic link/);
  assert.ok(!(await readFile(elsewhere, 'utf-8')).includes(SECRET));
  assert.equal(store.state().revision, 0);
  assert.equal(store.secret('apiKey'), undefined);

  const dir3 = await freshDir();
  await symlink(elsewhere, path.join(dir3, 'settings.json'));
  await assert.rejects(loadedStore(dir3), /settings\.json: it is a symbolic link/);
});

test('store: a malformed file is a clear error that never repeats its contents', async () => {
  for (const [file, text] of [
    ['settings.json', `{"v":1,"revision":"${SECRET}"`],
    [
      'settings.json',
      JSON.stringify({ v: 1, revision: 0, schemaVersion: 1, values: { a: SECRET } }),
    ],
    ['settings.json', JSON.stringify({ v: 2, revision: 0, schemaVersion: 1, values: {} })],
    ['secrets.json', `${SECRET}`],
    ['secrets.json', JSON.stringify({ v: 1, secrets: { apiKey: { value: SECRET } } })],
    ['secrets.json', JSON.stringify({ v: 1, secrets: [SECRET] })],
  ]) {
    const dir = await freshDir();
    await writeFile(path.join(dir, file), text, { mode: 0o600 });
    await assert.rejects(loadedStore(dir), (err) => {
      assert.match(
        err.message,
        new RegExp(`${file.replace('.', '\\.')} is (malformed|not valid JSON)`),
      );
      assert.ok(!err.message.includes(SECRET), err.message);
      assert.equal(err.cause, undefined);
      return true;
    });
  }
});

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

/**
 * The wire form of a plaintext update, as the relay builds it for one
 * request: each secret sealed to that request's nonce and the update's
 * revision.
 */
function sealedUpdate(update, secret, nonce) {
  return {
    ...update,
    secrets: Object.fromEntries(
      Object.entries(update.secrets ?? {}).map(([key, value]) => [
        key,
        value === null
          ? null
          : encryptSettingsSecret({
              secret,
              plugin: PLUGIN,
              nonce,
              key,
              baseRevision: update.baseRevision,
              value,
            }),
      ]),
    ),
  };
}

async function handlerFor(dataDir) {
  const secret = generateHostingSecret();
  const configPath = path.join(dataDir, '..', `${path.basename(dataDir)}-config.json`);
  await writeFile(
    configPath,
    JSON.stringify({
      plugin: PLUGIN,
      port: 0,
      secret,
      issuedAt: '2026-10-16T00:00:00.000Z',
      fetchedAt: '2026-10-16T00:00:01.000Z',
      acknowledged: true,
    }),
    { mode: 0o600 },
  );
  const verifier = createCallerAssertionVerifier({ configPath, plugin: PLUGIN });
  const store = await loadedStore(dataDir);
  const handler = createSettingsHandler({ verifier, store });
  /**
   * A request as Lamaste makes it: the assertion signs the method, the
   * path and — for a raw body — its bytes. `body` may be a function of the
   * nonce (a sealed update).
   */
  const request = (method, url, body, caller = { type: 'lamaste' }) => {
    const nonce = generateCallerAssertionNonce();
    const built = typeof body === 'function' ? body(nonce) : body;
    const raw = Buffer.isBuffer(built) || typeof built === 'string';
    return handler.handle({
      method,
      url,
      headers: {
        'x-lamalibre-caller': signCallerAssertion(
          {
            plugin: PLUGIN,
            caller,
            method,
            path: url,
            nonce,
            ...(raw ? { bodySha256: bodySha256Hex(built) } : {}),
          },
          secret,
        ),
      },
      body: built,
    });
  };
  /** A PUT of a plaintext update, sealed and serialized as the relay sends it. */
  const put = (update, caller) =>
    request(
      'PUT',
      '/admin/settings',
      (nonce) => Buffer.from(JSON.stringify(sealedUpdate(update, secret, nonce))),
      caller,
    );
  return { secret, store, handler, request, put };
}

/** The answer a response authenticates: its responder header over its exact bytes. */
function assertAuthenticated(out, secret, nonce) {
  assert.equal(
    out.headers[RESPONDER_HEADER],
    signResponder({ secret, nonce, status: out.status, body: out.bodyText }),
  );
  assert.deepEqual(JSON.parse(out.bodyText), out.body);
}

test('handler: only Lamaste reads and changes settings', async () => {
  const dir = await freshDir();
  const { secret, handler, request, put } = await handlerFor(dir);
  const ok = await request('GET', '/admin/settings');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.revision, 0);
  assert.equal((await request('GET', '/admin/settings', undefined, { type: 'admin' })).status, 403);
  assert.equal(
    (await request('GET', '/admin/settings', undefined, { type: 'agent', label: 'vm1' })).status,
    403,
  );
  assert.equal((await put(FULL_UPDATE, { type: 'admin' })).status, 403);
  const unsigned = await handler.handle({ method: 'GET', url: '/admin/settings', headers: {} });
  assert.equal(unsigned.status, 401);
  assert.deepEqual(unsigned.body, { error: 'malformed' });
  // Not verified: nothing to bind a responder signature to.
  assert.equal(unsigned.headers[RESPONDER_HEADER], undefined);
  const assertion = (withSecret, method, p, extra = {}) =>
    signCallerAssertion(
      { plugin: PLUGIN, caller: { type: 'lamaste' }, method, path: p, ...extra },
      withSecret,
    );
  // Signed with a secret the agent half does not hold.
  const forged = await handler.handle({
    method: 'GET',
    url: '/admin/settings',
    headers: { 'x-lamalibre-caller': assertion(generateHostingSecret(), 'GET', '/admin/settings') },
  });
  assert.equal(forged.status, 401);
  assert.deepEqual(forged.body, { error: 'bad_signature' });
  const body = Buffer.from(JSON.stringify({ ...FULL_UPDATE, secrets: {} }));
  // A GET's assertion does not open a PUT.
  const replayed = await handler.handle({
    method: 'PUT',
    url: '/admin/settings',
    headers: { 'x-lamalibre-caller': assertion(secret, 'GET', '/admin/settings') },
    body,
  });
  assert.equal(replayed.status, 401);
  assert.deepEqual(replayed.body, { error: 'wrong_request' });
  // A PUT whose assertion does not sign the body, or signs another one.
  const unbound = await handler.handle({
    method: 'PUT',
    url: '/admin/settings',
    headers: { 'x-lamalibre-caller': assertion(secret, 'PUT', '/admin/settings') },
    body,
  });
  assert.deepEqual(unbound.body, { error: 'wrong_body' });
  const swapped = await handler.handle({
    method: 'PUT',
    url: '/admin/settings',
    headers: {
      'x-lamalibre-caller': assertion(secret, 'PUT', '/admin/settings', {
        bodySha256: bodySha256Hex('{"other":"body"}'),
      }),
    },
    body,
  });
  assert.deepEqual(swapped.body, { error: 'wrong_body' });
});

test('handler: every answer to a verified request is authenticated over its exact bytes', async () => {
  const dir = await freshDir();
  const { secret, handler } = await handlerFor(dir);
  for (const [method, url, caller] of [
    ['GET', '/admin/settings', { type: 'lamaste' }],
    ['POST', '/admin/settings/reload', { type: 'lamaste' }],
    ['GET', '/admin/settings', { type: 'admin' }],
  ]) {
    const nonce = generateCallerAssertionNonce();
    const out = await handler.handle({
      method,
      url,
      headers: {
        'x-lamalibre-caller': signCallerAssertion(
          { plugin: PLUGIN, caller, method, path: url, nonce },
          secret,
        ),
      },
    });
    if (caller.type === 'lamaste') {
      assertAuthenticated(out, secret, nonce);
    } else {
      // A forwarded caller would read a stream: the `-` form.
      assert.equal(out.status, 403);
      assert.equal(out.headers[RESPONDER_HEADER], signResponder({ secret, nonce, status: 403 }));
    }
    assert.equal(out.headers['content-type'], 'application/json');
  }
});

test('handler: paths and methods', async () => {
  const dir = await freshDir();
  const { request } = await handlerFor(dir);
  for (const url of ['/admin/settings/x', '/admin/settings/', '/admin/settingsx', '/admin/other']) {
    const out = await request('GET', url);
    assert.equal(out.status, 404, url);
    assert.equal(out.headers[RESPONDER_HEADER], undefined, url);
  }
  assert.equal((await request('DELETE', '/admin/settings')).status, 405);
  assert.equal((await request('POST', '/admin/settings')).status, 405);
  assert.equal((await request('GET', '/admin/settings/reload')).status, 405);
  assert.equal((await request('PUT', '/admin/settings/reload')).status, 405);
  const reload = await request('POST', '/admin/settings/reload');
  assert.equal(reload.status, 200);
  assert.equal(reload.body.schemaVersion, 1);
  // A query string is part of the signed path and does not change the route.
  assert.equal((await request('GET', '/admin/settings?fresh=1')).status, 200);
});

test('handler: PUT — raw, sized, opened, stored; 400 / 409 / 413 / 422; never a secret back', async () => {
  const dir = await freshDir();
  const { secret, request, put, store } = await handlerFor(dir);

  const stored = await put(FULL_UPDATE);
  assert.equal(stored.status, 200, JSON.stringify(stored.body));
  assert.equal(stored.body.revision, 1);
  assert.ok(!JSON.stringify(stored).includes(SECRET));
  assert.equal(store.secret('apiKey'), SECRET);

  // A body passed as a string is as good as a Buffer.
  const asString = await request('PUT', '/admin/settings', (nonce) =>
    JSON.stringify(sealedUpdate({ ...FULL_UPDATE, baseRevision: 1, secrets: {} }, secret, nonce)),
  );
  assert.equal(asString.status, 200);
  assert.equal(asString.body.revision, 2);

  // A body a framework already parsed: the signed bytes are gone.
  const parsed = await request('PUT', '/admin/settings', { ...FULL_UPDATE, baseRevision: 2 });
  assert.equal(parsed.status, 400);
  assert.deepEqual(parsed.body, { error: 'The body must be passed as received' });

  const stale = await put(FULL_UPDATE);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'revision_mismatch');
  assert.equal(stale.body.revision, 2);

  const invalid = await put({ ...FULL_UPDATE, baseRevision: 2, values: { retries: SECRET } });
  assert.equal(invalid.status, 422);
  assert.deepEqual(invalid.body.errors, { retries: 'Must be an integer' });
  assert.ok(!JSON.stringify(invalid).includes(SECRET));

  // A secret in clear is not an update; nor is a body that is not JSON.
  const clear = Buffer.from(JSON.stringify({ ...FULL_UPDATE, baseRevision: 2 }));
  assert.equal((await request('PUT', '/admin/settings', clear)).status, 400);
  assert.equal((await request('PUT', '/admin/settings', Buffer.from('{not json'))).status, 400);
  assert.equal((await request('PUT', '/admin/settings', Buffer.alloc(0))).status, 400);
  const envelope = Buffer.from(JSON.stringify({ values: {} }));
  assert.equal((await request('PUT', '/admin/settings', envelope)).status, 400);
  const huge = Buffer.from(
    JSON.stringify({
      ...FULL_UPDATE,
      baseRevision: 2,
      secrets: {},
      values: { gone: 'x'.repeat(AGENT_HALF_SETTINGS_MAX_BYTES) },
    }),
  );
  const tooLarge = await request('PUT', '/admin/settings', huge);
  assert.equal(tooLarge.status, 413);
  assert.equal(store.state().revision, 2);
});

test('handler: a secret sealed for another request, key or revision does not open (422)', async () => {
  const dir = await freshDir();
  const { secret, request, store } = await handlerFor(dir);
  const send = (build) =>
    request('PUT', '/admin/settings', (nonce) => Buffer.from(JSON.stringify(build(nonce))));
  const sealed = (overrides) =>
    encryptSettingsSecret({
      secret,
      plugin: PLUGIN,
      nonce: generateCallerAssertionNonce(),
      key: 'apiKey',
      baseRevision: 0,
      value: SECRET,
      ...overrides,
    });
  const base = { schemaVersion: 1, baseRevision: 0, values: { region: 'eu' } };
  const cases = [
    // Sealed to another request's nonce: a replay of a captured value.
    () => ({ ...base, secrets: { apiKey: sealed({}) } }),
    (nonce) => ({ ...base, secrets: { apiKey: sealed({ nonce, key: 'token' }) } }),
    (nonce) => ({ ...base, secrets: { apiKey: sealed({ nonce, baseRevision: 1 }) } }),
    (nonce) => ({ ...base, secrets: { apiKey: sealed({ nonce, plugin: 'other' }) } }),
    (nonce) => ({
      ...base,
      secrets: { apiKey: sealed({ nonce, secret: generateHostingSecret() }) },
    }),
  ];
  for (const build of cases) {
    const out = await send(build);
    assert.equal(out.status, 422, JSON.stringify(out.body));
    assert.deepEqual(out.body, {
      error: 'Invalid settings',
      errors: { apiKey: 'Could not be decrypted' },
    });
    assert.ok(!out.bodyText.includes(SECRET));
  }
  assert.equal(store.state().revision, 0);
  assert.equal(store.secret('apiKey'), undefined);
  // Sealed for this request: stored.
  const good = await send((nonce) => ({ ...base, secrets: { apiKey: sealed({ nonce }) } }));
  assert.equal(good.status, 200);
  assert.equal(store.secret('apiKey'), SECRET);
});

test('handler: a store failure is a 500 that says nothing more', async () => {
  const dir = await freshDir();
  const { put } = await handlerFor(dir);
  await symlink(path.join(root, 'nowhere.json'), path.join(dir, 'secrets.json'));
  const failed = await put(FULL_UPDATE);
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.body, { error: 'The settings store failed' });
});

test('end to end: the relay calls the agent half with callAgentHalf', async () => {
  const dir = await freshDir();
  const { secret, handler } = await handlerFor(dir);
  const half = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const out = await handler.handle({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      res.writeHead(out.status, out.headers);
      res.end(out.bodyText);
    });
  });
  const port = await new Promise((resolve) =>
    half.listen(0, '127.0.0.1', () => resolve(half.address().port)),
  );
  try {
    const call = (method, p, body) =>
      callAgentHalf({
        plugin: PLUGIN,
        port,
        secret,
        method,
        path: p,
        body,
        timeoutMs: 5_000,
        maxResponseBytes: AGENT_HALF_SETTINGS_MAX_BYTES,
      });
    const read = await call('GET', '/admin/settings');
    assert.equal(read.status, 200);
    assert.equal(read.body.configured, false);
    const sealed = (nonce) => sealedUpdate(FULL_UPDATE, secret, nonce);
    const written = await call('PUT', '/admin/settings', sealed);
    assert.equal(written.status, 200, JSON.stringify(written));
    assert.equal(written.body.configured, true);
    assert.ok(!JSON.stringify(written).includes(SECRET));
    const conflict = await call('PUT', '/admin/settings', sealed);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.revision, 1);
    const reloaded = await call('POST', '/admin/settings/reload');
    assert.equal(reloaded.status, 200);
    assert.deepEqual(Object.keys(reloaded.body.secrets), ['apiKey']);
  } finally {
    half.close();
  }
});
