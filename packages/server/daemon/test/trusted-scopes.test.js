/**
 * Trusted publisher scopes on the relay: the list (built in + additional),
 * who changes it and how (audited, under the plugin lock), the refusal of a
 * scope the configured registry does not host (dependency confusion), the
 * refusal to stop trusting a scope in use, and every install path's check
 * — the plugin package, the packages its manifest names, the npm
 * userconfig routing every trusted scope to the registry. npm is a
 * stand-in (`fake-npm.js`); the registry's `GET /-/feria/scopes` is a
 * local HTTP server.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { installFakeNpm } from './fake-npm.js';

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const who = { actor: 'admin', log: logger };

let dir;
let stateDir;
let npm;
let lib;
let registry;
let registryUrl;
/** What the stand-in registry answers on `GET /-/feria/scopes` (null: 404, an older Feria). */
let hostedAnswer = null;

const manifest = (name, version, extra = {}) =>
  JSON.stringify({ name, version, description: '', ...extra });

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-trusted-scopes-'));
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

  registry = http.createServer((req, res) => {
    if (req.url === '/-/feria/scopes' && hostedAnswer !== null) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(hostedAnswer));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve) => registry.listen(0, '127.0.0.1', resolve));
  registryUrl = `http://127.0.0.1:${registry.address().port}/`;

  npm = await installFakeNpm(path.join(dir, 'npm'));
  lib = {
    ...(await import('../src/lib/config.js')),
    ...(await import('../src/lib/plugins.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/push-install.js')),
    ...(await import('../src/lib/registry-credential.js')),
    ...(await import('../src/lib/trusted-scopes.js')),
    ...(await import('../src/lib/trusted-scope-settings.js')),
  };
  await lib.loadConfig();

  await npm.publish('@example/ex-server', '1.0.0', {
    'lamaste-plugin.json': manifest('ex', '1.0.0', { packages: { server: '@example/ex-server' } }),
  });
  // A manifest that names another publisher's package.
  await npm.publish('@example/cross-server', '1.0.0', {
    'lamaste-plugin.json': manifest('cross', '1.0.0', {
      packages: { server: '@lamalibre/herd-server' },
    }),
  });
  await npm.publish('@lamalibre/lx-server', '1.0.0', {
    'lamaste-plugin.json': manifest('lx', '1.0.0'),
  });
});

after(async () => {
  await new Promise((resolve) => registry.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

async function setCredential() {
  await lib.writeRegistryCredentialConfig({
    provider: 'feria',
    registryUrl,
    scope: '@lamalibre',
    auth: { kind: 'token', token: 'feria_trustedscopes_test_token_0000' },
    configuredAt: new Date().toISOString(),
  });
  lib.resetRegistryHostedScopesCache();
}

async function rejects(promise, statusCode, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.statusCode, statusCode, err.message);
    assert.equal(err.code, code, err.message);
    return true;
  });
}

test('by default only @lamalibre is trusted', () => {
  assert.deepEqual(lib.trustedScopesView(), {
    builtIn: '@lamalibre',
    additional: [],
    effective: ['@lamalibre'],
  });
});

test('a package of another scope is refused before npm runs; @lamalibre installs', async () => {
  npm.clearCalls?.();
  const before = npm.calls().length;
  await rejects(lib.installPlugin('@example/ex-server', logger), 400, 'untrusted_scope');
  for (const lookalike of [
    '@lamalibre-evil/lx-server',
    '@lamalibrex/lx-server',
    '@LamaLibre/lx-server',
    '@lamalıbre/lx-server',
  ]) {
    await assert.rejects(lib.installPlugin(lookalike, logger), (err) => err.statusCode === 400);
  }
  await rejects(lib.installPlugin('@lamalibre/lx-server@npm:evil', logger), 400, 'invalid_package');
  assert.equal(npm.calls().length, before, 'npm never ran for a refused package');

  const plugin = await lib.installPlugin('@lamalibre/lx-server', logger);
  assert.equal(plugin.packageName, '@lamalibre/lx-server');
});

test('the built-in scope and malformed scopes cannot be added', async () => {
  await rejects(lib.addTrustedScope('@lamalibre', who), 400, 'builtin_scope');
  for (const bad of ['@Example', 'example', '@example/', '@ex_ample', '＠example', '@examplé']) {
    await rejects(lib.addTrustedScope(bad, who), 400, 'invalid_scope');
  }
});

test('an additional scope needs a registry that hosts it', async () => {
  await rejects(lib.addTrustedScope('@example', who), 409, 'registry_credential_required');
  await setCredential();
  hostedAnswer = null; // an older Feria: no scope list — @lamalibre alone
  await rejects(lib.addTrustedScope('@example', who), 409, 'registry_lacks_scope');
  hostedAnswer = { scopes: [{ scope: '@lamalibre' }, { scope: '@example', retired: true }] };
  lib.resetRegistryHostedScopesCache();
  await rejects(lib.addTrustedScope('@example', who), 409, 'registry_lacks_scope');
  assert.deepEqual(lib.trustedScopesView().additional, []);
});

test('adding a hosted scope is persisted and audited', async () => {
  hostedAnswer = { scopes: [{ scope: '@lamalibre' }, { scope: '@example' }] };
  lib.resetRegistryHostedScopesCache();
  const view = await lib.addTrustedScope('@example', who);
  assert.deepEqual(view.effective, ['@lamalibre', '@example']);
  const onDisk = JSON.parse(await readFile(process.env.LAMALIBRE_LAMASTE_CONFIG, 'utf8'));
  assert.deepEqual(onDisk.trustedScopes, ['@example']);
  const entries = await lib.listAudit({ action: 'settings.trusted-scope.added' });
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].details, { scope: '@example' });
  await rejects(lib.addTrustedScope('@example', who), 409, 'scope_already_trusted');
});

test('a trusted scope installs, routed to the registry with every trusted scope', async () => {
  const plugin = await lib.installPlugin('@example/ex-server', logger);
  assert.equal(plugin.packageName, '@example/ex-server');
  const install = npm
    .calls()
    .filter((c) => c.args[0] === 'install' && c.args.includes('@example/ex-server'))
    .at(-1);
  assert.ok(install, 'npm install ran');
  assert.match(install.userconfigText, /^@lamalibre:registry=http:\/\/127\.0\.0\.1:\d+\/$/m);
  assert.match(install.userconfigText, /^@example:registry=http:\/\/127\.0\.0\.1:\d+\/$/m);
  assert.match(install.userconfigText, /:_authToken=feria_trustedscopes_test_token_0000$/m);
});

test('a manifest naming another scope is refused and its package removed', async () => {
  await rejects(lib.installPlugin('@example/cross-server', logger), 400, 'untrusted_scope');
  const { plugins } = await lib.readPlugins();
  assert.equal(
    plugins.some((p) => p.packageName === '@example/cross-server'),
    false,
  );
  assert.ok(
    npm.calls().some((c) => c.args[0] === 'uninstall' && c.args.includes('@example/cross-server')),
  );
});

test('a scope the registry stops hosting stops installing', async () => {
  hostedAnswer = { scopes: [{ scope: '@lamalibre' }, { scope: '@example', retired: true }] };
  lib.resetRegistryHostedScopesCache();
  await rejects(lib.assertTrustedPackageSpec('@example/other-server'), 409, 'registry_lacks_scope');
  hostedAnswer = { scopes: [{ scope: '@lamalibre' }, { scope: '@example' }] };
  lib.resetRegistryHostedScopesCache();
  await lib.assertTrustedPackageSpec('@example/other-server@2.0.0');
});

test('a scope in use cannot be removed: plugins, then push-install policies', async () => {
  await rejects(lib.removeTrustedScope('@example', who), 409, 'scope_in_use');
  await assert.rejects(lib.removeTrustedScope('@example', who), (err) => {
    assert.deepEqual(err.plugins, ['@example/ex-server']);
    return true;
  });
  await lib.uninstallPlugin('ex', logger);

  await lib.createPushInstallPolicy({
    name: 'Example only',
    id: 'example-only',
    allowedPlugins: ['@example/ex-server'],
  });
  await assert.rejects(lib.removeTrustedScope('@example', who), (err) => {
    assert.equal(err.code, 'scope_in_use');
    assert.deepEqual(err.policies, ['example-only']);
    assert.deepEqual(err.plugins, []);
    return true;
  });
  await lib.deletePushInstallPolicy('example-only');
});

test('removing a scope is audited, and its packages are refused again', async () => {
  const view = await lib.removeTrustedScope('@example', who);
  assert.deepEqual(view.effective, ['@lamalibre']);
  const entries = await lib.listAudit({ action: 'settings.trusted-scope.removed' });
  assert.equal(entries.length, 1);
  await rejects(lib.installPlugin('@example/ex-server', logger), 400, 'untrusted_scope');
  await rejects(lib.removeTrustedScope('@example', who), 404, 'scope_not_trusted');
  await rejects(lib.removeTrustedScope('@lamalibre', who), 400, 'builtin_scope');
});
