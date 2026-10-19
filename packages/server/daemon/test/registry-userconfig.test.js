/**
 * The panel's own npm calls authenticate to the configured registry.
 *
 * `withRegistryUserconfig` (core): the throw-away userconfig it hands npm —
 * its lines (scope and registry from the credential, the token under npm's
 * nerf dart), its mode, its removal on success and on failure — and how a
 * refused token is handled: a 401 obtains the token again and retries once,
 * a token that did not change or a 403 fails naming the registry and the
 * status, never the token. Then the daemon's wiring: with a credential in
 * the state directory, `npm view` (pinning an agent half), `npm pack`
 * (staging an update) and `npm install` (installing a plugin) all run with
 * that userconfig, and without one they run as before.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  RegistryCredentialError,
  npmRegistryStatus,
  withRegistryUserconfig,
} from '@lamalibre/lamaste/server';

import { installFakeNpm } from './fake-npm.js';

const TOKEN_A = 'feria_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'feria_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const config = (overrides = {}) => ({
  provider: 'feria',
  registryUrl: 'https://feria.samplepark.tr/',
  scope: '@lamalibre',
  auth: { kind: 'token', token: TOKEN_A },
  configuredAt: new Date().toISOString(),
  ...overrides,
});

/** What npm leaves in an execa error when the registry answered `status`. */
const npmRefusal = (status) =>
  Object.assign(new Error(`Command failed with exit code 1: npm install`), {
    exitCode: 1,
    stderr: `npm error code E${status}\nnpm error ${status} Unauthorized - GET https://feria.samplepark.tr/@lamalibre%2fx`,
    stdout: '',
  });

/** A token resolver that answers `tokens` in turn and records how it was asked. */
function resolver(tokens) {
  const calls = [];
  return {
    calls,
    async resolve(opts) {
      calls.push(opts);
      return tokens[Math.min(calls.length, tokens.length) - 1];
    },
  };
}

/** The userconfig `env` names: its text, mode and directory mode, read while `fn` runs. */
async function inspect(env) {
  const file = env.npm_config_userconfig;
  assert.ok(file, 'npm_config_userconfig is set');
  assert.deepEqual(Object.keys(env), ['npm_config_userconfig']);
  const { readFile } = await import('node:fs/promises');
  return {
    file,
    text: await readFile(file, 'utf-8'),
    mode: (await stat(file)).mode & 0o777,
    dirMode: (await stat(path.dirname(file))).mode & 0o777,
  };
}

let tmp;

before(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'lamaste-regcred-userconfig-'));
});

after(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** Nothing of a userconfig is left under `tmp`. */
async function assertNothingLeft() {
  assert.deepEqual(
    (await readdir(tmp)).filter((n) => n.startsWith('lamaste-npmrc-')),
    [],
    'the userconfig directory is removed',
  );
}

test('the userconfig: scope and registry from the credential, the token under the nerf dart, 0600 in a 0700 directory, gone afterwards', async () => {
  const tokens = resolver([TOKEN_A]);
  let seen;
  const result = await withRegistryUserconfig(
    config(),
    tokens.resolve,
    async (env) => {
      seen = await inspect(env);
      return 'done';
    },
    { tmpDir: tmp },
  );
  assert.equal(result, 'done');
  assert.equal(
    seen.text,
    `@lamalibre:registry=https://feria.samplepark.tr/\n//feria.samplepark.tr/:_authToken=${TOKEN_A}\n`,
  );
  assert.equal(seen.mode, 0o600);
  assert.equal(seen.dirMode, 0o700);
  assert.ok(seen.file.startsWith(`${tmp}${path.sep}lamaste-npmrc-`));
  assert.deepEqual(tokens.calls, [{ refresh: false }]);
  await assert.rejects(stat(seen.file), { code: 'ENOENT' });
  await assertNothingLeft();
});

test('the registry URL and scope are derived from the credential: a path keeps its directory, a missing slash is added, the scope is not hard-coded', async () => {
  let seen;
  await withRegistryUserconfig(
    config({ registryUrl: 'https://panel.example/api/feria', scope: '@acme' }),
    async () => TOKEN_A,
    async (env) => {
      seen = await inspect(env);
    },
    { tmpDir: tmp },
  );
  assert.equal(
    seen.text,
    `@acme:registry=https://panel.example/api/feria/\n//panel.example/api/feria/:_authToken=${TOKEN_A}\n`,
  );
  await assertNothingLeft();
});

test('a failure of the call removes the userconfig and propagates as it is', async () => {
  const boom = npmRefusal(404);
  let file;
  await assert.rejects(
    withRegistryUserconfig(
      config(),
      async () => TOKEN_A,
      async (env) => {
        file = env.npm_config_userconfig;
        throw boom;
      },
      { tmpDir: tmp },
    ),
    (err) => err === boom,
  );
  await assert.rejects(stat(file), { code: 'ENOENT' });
  await assertNothingLeft();

  const plain = new Error('npm is not installed');
  await assert.rejects(
    withRegistryUserconfig(
      config(),
      async () => TOKEN_A,
      async () => {
        throw plain;
      },
      { tmpDir: tmp },
    ),
    (err) => err === plain,
  );
  await assertNothingLeft();
});

test('a 401 obtains the token again and retries once with the new one', async () => {
  const tokens = resolver([TOKEN_A, TOKEN_B]);
  const warnings = [];
  const seen = [];
  const result = await withRegistryUserconfig(
    config(),
    tokens.resolve,
    async (env) => {
      seen.push(await inspect(env));
      if (seen.length === 1) throw npmRefusal(401);
      return 'second';
    },
    { tmpDir: tmp, log: { warn: (obj, msg) => warnings.push({ obj, msg }) } },
  );
  assert.equal(result, 'second');
  assert.deepEqual(tokens.calls, [{ refresh: false }, { refresh: true }]);
  assert.equal(seen.length, 2);
  assert.match(seen[0].text, new RegExp(`_authToken=${TOKEN_A}\n$`));
  assert.match(seen[1].text, new RegExp(`_authToken=${TOKEN_B}\n$`));
  assert.equal(seen[0].file, seen[1].file, 'the same private file is rewritten');
  assert.equal(seen[1].mode, 0o600);
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0].obj, { registry: 'feria.samplepark.tr', status: 401 });
  assert.ok(
    !JSON.stringify(warnings).includes(TOKEN_A) && !JSON.stringify(warnings).includes(TOKEN_B),
  );
  await assert.rejects(stat(seen[0].file), { code: 'ENOENT' });
  await assertNothingLeft();
});

test('a 401 with a token that does not change (a pasted credential) is not retried: a RegistryCredentialError naming the registry and the status', async () => {
  const tokens = resolver([TOKEN_A, TOKEN_A]);
  let calls = 0;
  await assert.rejects(
    withRegistryUserconfig(
      config(),
      tokens.resolve,
      async () => {
        calls += 1;
        throw npmRefusal(401);
      },
      { tmpDir: tmp },
    ),
    (err) => {
      assert.ok(err instanceof RegistryCredentialError);
      assert.equal(err.statusCode, 502);
      assert.match(
        err.message,
        /registry feria\.samplepark\.tr refused the panel's token \(HTTP 401\)/,
      );
      assert.match(err.message, /set the registry credential again/);
      assert.ok(!err.message.includes(TOKEN_A));
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(tokens.calls, [{ refresh: false }, { refresh: true }]);
  await assertNothingLeft();
});

test('a fresh token refused as well fails after the one retry', async () => {
  const tokens = resolver([TOKEN_A, TOKEN_B]);
  let calls = 0;
  await assert.rejects(
    withRegistryUserconfig(
      config(),
      tokens.resolve,
      async () => {
        calls += 1;
        throw npmRefusal(401);
      },
      { tmpDir: tmp },
    ),
    (err) => err instanceof RegistryCredentialError && /HTTP 401/.test(err.message),
  );
  assert.equal(calls, 2);
  assert.deepEqual(tokens.calls, [{ refresh: false }, { refresh: true }]);
  await assertNothingLeft();
});

test('a 403 is not retried: the credential lacks the scope, a new token would not change that', async () => {
  const tokens = resolver([TOKEN_A, TOKEN_B]);
  let calls = 0;
  await assert.rejects(
    withRegistryUserconfig(
      config(),
      tokens.resolve,
      async () => {
        calls += 1;
        throw npmRefusal(403);
      },
      { tmpDir: tmp },
    ),
    (err) => {
      assert.ok(err instanceof RegistryCredentialError);
      assert.match(err.message, /feria\.samplepark\.tr refused the panel's token \(HTTP 403\)/);
      assert.match(err.message, /lacks the read scope/);
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(tokens.calls, [{ refresh: false }]);
  await assertNothingLeft();
});

test('npmRegistryStatus reads the status from what npm printed, on either stream', () => {
  assert.equal(npmRegistryStatus(npmRefusal(401)), 401);
  assert.equal(npmRegistryStatus({ stderr: '', stdout: '{"error":{"code":"E404"}}' }), 404);
  assert.equal(npmRegistryStatus({ stderr: 'npm error code ENOTFOUND' }), null);
  assert.equal(npmRegistryStatus({ stderr: 'exit 1' }), null);
  assert.equal(npmRegistryStatus(new Error('nope')), null);
  assert.equal(npmRegistryStatus(null), null);
  assert.equal(npmRegistryStatus('E401'), null);
});

// ---------------------------------------------------------------------------
// The daemon's wiring: every npm call of the panel's own goes through it
// ---------------------------------------------------------------------------

const PKG = '@lamalibre/ux-server';
const AGENT_PKG = '@lamalibre/ux-agent';
const INTEGRITY = `sha512-${Buffer.alloc(64, 7).toString('base64')}`;
const logger = { info() {}, warn() {}, error() {}, debug() {} };

let dir;
let stateDir;
let npm;
let lib;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-regcred-wiring-'));
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
    ...(await import('../src/lib/config.js')),
    ...(await import('../src/lib/plugins.js')),
    ...(await import('../src/lib/plugin-packages.js')),
    ...(await import('../src/lib/registry-credential.js')),
  };
  await lib.loadConfig();

  const manifest = {
    name: 'ux',
    version: '1.0.0',
    hosting: 'agent',
    agent: {
      requires: { os: ['linux'], node: '>=22', systemPackages: [] },
      package: AGENT_PKG,
      service: { entry: 'dist/agentd.js', memoryMax: '256M' },
    },
  };
  await npm.publish(PKG, '1.0.0', { 'lamaste-plugin.json': JSON.stringify(manifest) });
  await npm.setIntegrity(`${AGENT_PKG}@1.0.0`, INTEGRITY);
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const expectedNpmrc = (registryUrl, token) =>
  `@lamalibre:registry=${registryUrl}\n//${new URL(registryUrl).host}/:_authToken=${token}\n`;

test('with a credential configured, npm view, npm pack and npm install all run with the userconfig — and it is gone after each', async () => {
  await lib.writeRegistryCredentialConfig(
    config({ registryUrl: 'http://127.0.0.1:4874/', owner: 'machine:lamaste' }),
  );
  const expected = expectedNpmrc('http://127.0.0.1:4874/', TOKEN_A);
  const before = npm.calls().length;

  assert.equal(await lib.readRegistryIntegrity(AGENT_PKG, '1.0.0'), INTEGRITY);
  const staged = await lib.readRegistryPackage(PKG, '1.0.0');
  assert.equal(staged.version, '1.0.0');
  const entry = await lib.installPlugin(PKG, logger);
  assert.equal(entry.version, '1.0.0');

  const calls = npm.calls().slice(before);
  assert.deepEqual(
    calls.map((c) => c.args[0]),
    ['view', 'pack', 'install', 'view'],
    'the pin, the staging, the install and its own pin',
  );
  for (const call of calls) {
    assert.ok(call.userconfig, `${call.args[0]} ran with npm_config_userconfig`);
    assert.equal(call.userconfigText, expected, `${call.args[0]} saw the credential`);
    assert.equal(call.userconfigMode, 0o600);
    await assert.rejects(stat(call.userconfig), { code: 'ENOENT' });
    await assert.rejects(stat(path.dirname(call.userconfig)), { code: 'ENOENT' });
  }
  assert.equal(new Set(calls.map((c) => c.userconfig)).size, calls.length, 'one file per call');
  // The token reached npm through the file alone: not an argument, not the state directory.
  for (const call of calls) assert.ok(!call.args.some((a) => a.includes(TOKEN_A)));
  assert.deepEqual(
    (await readdir(stateDir)).filter((n) => n.includes('npmrc')),
    [],
    'nothing npmrc-like in the state directory',
  );
});

test('without a credential the calls run as before: no userconfig', async () => {
  assert.equal(await lib.clearRegistryCredentialConfig(), true);
  const before = npm.calls().length;
  assert.equal(await lib.readRegistryIntegrity(AGENT_PKG, '1.0.0'), INTEGRITY);
  await lib.readRegistryPackage(PKG, '1.0.0');
  const calls = npm.calls().slice(before);
  assert.deepEqual(
    calls.map((c) => c.args[0]),
    ['view', 'pack'],
  );
  for (const call of calls) assert.equal(call.userconfig, null);
});

test('a credential file that cannot be read fails the call instead of installing from the public registry', async () => {
  await writeFile(path.join(stateDir, 'registry-credential.json'), '{"provider":"feria"}', {
    mode: 0o600,
  });
  const before = npm.calls().length;
  await assert.rejects(lib.readRegistryIntegrity(AGENT_PKG, '1.0.0'), (err) => {
    assert.equal(err.statusCode, 502);
    assert.match(err.message, /Could not read .* from the registry: .*registry-credential\.json/);
    return true;
  });
  assert.equal(npm.calls().length, before, 'npm was not run');
  await rm(path.join(stateDir, 'registry-credential.json'));
});
