/**
 * What create-lamaste provisions for Authelia's OpenID Connect provider:
 * the issuer key — generated here, written as the Authelia account, 0600,
 * never through a path root follows — and the `template` configuration
 * filter on the unit and on every `authelia` CLI run, which is how the
 * configuration reads that key without the panel ever holding it.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  AUTHELIA_CONFIG_FILTERS_ENV,
  AUTHELIA_OIDC_KEY_PATH,
  generateAutheliaUnit,
  generateServiceUnit,
  generateSudoersContent,
} from '../src/lib/service-config.js';
import { ensureOidcIssuerKey, generateIssuerKeyPem } from '../src/lib/oidc-issuer-key.js';

const require = createRequire(import.meta.url);
const { AUTHELIA_CLI_ENV } = require(
  fileURLToPath(new URL('../scripts/lamaste-priv', import.meta.url)),
);

let work;

before(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'lamaste-oidc-key-'));
});

after(async () => {
  await rm(work, { recursive: true, force: true });
});

test('the Authelia unit and the Authelia CLI run with the template configuration filter', () => {
  assert.equal(AUTHELIA_CONFIG_FILTERS_ENV, 'X_AUTHELIA_CONFIG_FILTERS=template');
  const unit = generateAutheliaUnit();
  assert.ok(unit.includes('\nEnvironment=X_AUTHELIA_CONFIG_FILTERS=template\n'));
  assert.ok(unit.includes('User=lamaste-authelia'));
  assert.ok(unit.includes('ReadWritePaths=/etc/authelia /var/log/authelia'));
  assert.equal(AUTHELIA_CLI_ENV.X_AUTHELIA_CONFIG_FILTERS, 'template');
  assert.equal(AUTHELIA_OIDC_KEY_PATH, '/etc/authelia/oidc-issuer.pem');
});

test('the panel unit gives npm a HOME and a cache inside the state directory', () => {
  // The lamaste account has no home directory and ProtectHome hides /home:
  // without these, every panel-side `npm install` failed with EACCES on
  // /home/lamaste/.npm (found by the OIDC provider e2e spec).
  const unit = generateServiceUnit({
    installDir: '/opt/lamalibre/lamaste',
    configDir: '/etc/lamalibre/lamaste',
  });
  assert.ok(unit.includes('\nEnvironment=HOME=/etc/lamalibre/lamaste\n'));
  assert.ok(unit.includes('\nEnvironment=npm_config_cache=/etc/lamalibre/lamaste/.npm\n'));
  assert.ok(unit.includes('\nProtectHome=true\n'));
  assert.match(unit, /\nReadWritePaths=\/etc\/lamalibre\/lamaste /);
});

test('the sudoers file still has no wildcard', () => {
  const content = generateSudoersContent();
  for (const line of content.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    assert.ok(!line.includes('*'), `wildcard in sudoers line: ${line}`);
  }
});

test('a generated issuer key is RSA-4096 PKCS#8', async () => {
  const pem = generateIssuerKeyPem();
  assert.ok(pem.startsWith('-----BEGIN PRIVATE KEY-----\n'));
  const { createPrivateKey } = await import('node:crypto');
  const key = createPrivateKey(pem);
  assert.equal(key.asymmetricKeyType, 'rsa');
  assert.equal(key.asymmetricKeyDetails.modulusLength, 4096);
});

test('ensureOidcIssuerKey writes the key once as the Authelia account, 0600, and keeps it afterwards', async () => {
  // Without root the "Authelia account" is this process's own identity.
  const uid = process.getuid();
  const gid = process.getgid();
  const lines = [];
  const first = await ensureOidcIssuerKey({
    autheliaUid: uid,
    autheliaGid: gid,
    dir: work,
    report: (l) => lines.push(l),
  });
  assert.equal(first.generated, true);
  assert.equal(first.path, path.join(work, 'oidc-issuer.pem'));
  const st = await lstat(first.path);
  assert.ok(st.isFile());
  assert.equal(st.mode & 0o7777, 0o600);
  assert.equal(st.uid, uid);
  const pem = await readFile(first.path, 'utf-8');
  assert.ok(pem.includes('PRIVATE KEY'));
  assert.ok(lines.some((l) => /Generating the OIDC issuer key/.test(l)));

  // Present and owned correctly: left alone (a new key would invalidate every token).
  const second = await ensureOidcIssuerKey({ autheliaUid: uid, autheliaGid: gid, dir: work });
  assert.equal(second.generated, false);
  assert.equal(await readFile(first.path, 'utf-8'), pem);

  // No temporary file is left behind.
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(work), ['oidc-issuer.pem']);
});

test("ensureOidcIssuerKey replaces a symlink planted at the key's name instead of following it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-oidc-key-link-'));
  try {
    const target = path.join(dir, 'victim');
    await writeFile(target, 'do not overwrite\n');
    await symlink(target, path.join(dir, 'oidc-issuer.pem'));
    const result = await ensureOidcIssuerKey({
      autheliaUid: process.getuid(),
      autheliaGid: process.getgid(),
      dir,
    });
    assert.equal(result.generated, true);
    const st = await lstat(path.join(dir, 'oidc-issuer.pem'));
    assert.ok(st.isFile() && !st.isSymbolicLink());
    assert.equal(st.mode & 0o7777, 0o600);
    assert.equal(await readFile(target, 'utf-8'), 'do not overwrite\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
