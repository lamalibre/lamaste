/**
 * Confidential OIDC client secrets: the pbkdf2 digest Authelia accepts,
 * and the 0600 store — minted on first appearance, kept across syncs,
 * rotated on demand, deleted when the client is gone.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  OIDC_SECRET_PBKDF2_ITERATIONS,
  adaptedBase64Decode,
  adaptedBase64Encode,
  clearOidcClientSecrets,
  encodePbkdf2Sha512Digest,
  generateClientSecret,
  listOidcClientSecrets,
  oidcClientsPath,
  readOidcClientSecret,
  readOidcClientSecretDigests,
  reconcileOidcClientSecrets,
  rotateOidcClientSecret,
  verifyPbkdf2Sha512Digest,
} from '@lamalibre/lamaste/server';

let stateDir;

before(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), 'lamaste-oidc-clients-'));
});

after(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

test("pbkdf2-sha512 digests match the vector in Authelia's client documentation", () => {
  // docs/content/configuration/identity-providers/openid-connect/clients.md
  // (v4.39.28): "The digest of 'insecure_secret'".
  const documented =
    '$pbkdf2-sha512$310000$c8p78n7pUMln0jzvd4aK4Q$JNRBzwAo0ek5qKn50cFzzvE9RXV88h1wJn5KGiHrD0YKtZaR/nCb2CJPOsKaPK0hjf.9yHxzQGZziziccp6Yng';
  const salt = adaptedBase64Decode('c8p78n7pUMln0jzvd4aK4Q');
  assert.equal(salt.length, 16);
  assert.equal(OIDC_SECRET_PBKDF2_ITERATIONS, 310000);
  assert.equal(encodePbkdf2Sha512Digest('insecure_secret', salt), documented);
  assert.equal(verifyPbkdf2Sha512Digest('insecure_secret', documented), true);
  assert.equal(verifyPbkdf2Sha512Digest('insecure_secreT', documented), false);
  assert.equal(verifyPbkdf2Sha512Digest('insecure_secret', '$argon2id$x'), false);

  // Adapted base64: standard alphabet with `+` → `.`, no padding.
  const bytes = Buffer.from([0xfb, 0xff, 0xbf, 0x01, 0x02]);
  assert.equal(Buffer.from(bytes).toString('base64'), '+/+/AQI=');
  assert.equal(adaptedBase64Encode(bytes), '././AQI');
  assert.deepEqual([...adaptedBase64Decode(adaptedBase64Encode(bytes))], [...bytes]);
  assert.throws(() => adaptedBase64Decode('abc+'), /adapted-base64/);
  assert.throws(() => encodePbkdf2Sha512Digest('x', Buffer.alloc(4)), /at least 8 bytes/);

  const secret = generateClientSecret();
  assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(secret, generateClientSecret());
});

test('secrets are minted once, kept while the client stays, deleted when it is gone', async () => {
  const first = await reconcileOidcClientSecrets(stateDir, [
    { id: 'feria-service', plugin: 'feria' },
    { id: 'lamaste-server', plugin: 'lamaste' },
  ]);
  assert.deepEqual(
    first.created.map((c) => c.id),
    ['feria-service', 'lamaste-server'],
  );
  assert.deepEqual(first.removed, []);
  assert.equal((await stat(oidcClientsPath(stateDir))).mode & 0o777, 0o600);
  for (const c of first.created) {
    assert.match(c.secret, /^[A-Za-z0-9_-]{43}$/);
    assert.match(first.digests[c.id], /^\$pbkdf2-sha512\$310000\$[A-Za-z0-9./]+\$[A-Za-z0-9./]+$/);
    assert.equal(verifyPbkdf2Sha512Digest(c.secret, first.digests[c.id]), true);
  }
  const onDisk = JSON.parse(await readFile(oidcClientsPath(stateDir), 'utf-8'));
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.clients['feria-service'].plugin, 'feria');
  assert.equal(onDisk.clients['feria-service'].rotatedAt, null);

  // The same clients again: nothing minted, the digest is byte-identical
  // (fixed salt) so Authelia's configuration does not change.
  const again = await reconcileOidcClientSecrets(stateDir, [
    { id: 'lamaste-server', plugin: 'lamaste' },
    { id: 'feria-service', plugin: 'feria' },
  ]);
  assert.deepEqual(again.created, []);
  assert.deepEqual(again.digests, first.digests);
  assert.deepEqual(await readOidcClientSecretDigests(stateDir), first.digests);
  assert.equal(
    await readOidcClientSecret(stateDir, 'lamaste-server'),
    first.created.find((c) => c.id === 'lamaste-server').secret,
  );

  // Metadata never carries the secret.
  const listed = await listOidcClientSecrets(stateDir);
  assert.deepEqual(
    listed.map((m) => m.id),
    ['feria-service', 'lamaste-server'],
  );
  assert.ok(!JSON.stringify(listed).includes(first.created[0].secret));

  // Rotation: new secret, new digest, timestamp; the old secret no longer verifies.
  const rotated = await rotateOidcClientSecret(stateDir, 'feria-service');
  assert.notEqual(rotated.secret, first.created[0].secret);
  const digests = await readOidcClientSecretDigests(stateDir);
  assert.notEqual(digests['feria-service'], first.digests['feria-service']);
  assert.equal(verifyPbkdf2Sha512Digest(rotated.secret, digests['feria-service']), true);
  assert.equal(verifyPbkdf2Sha512Digest(first.created[0].secret, digests['feria-service']), false);
  assert.equal((await listOidcClientSecrets(stateDir))[0].rotatedAt, rotated.rotatedAt);
  await assert.rejects(rotateOidcClientSecret(stateDir, 'nope'), /no stored secret/);

  // A different plugin claiming the id gets a fresh secret — the old one is gone.
  const reclaimed = await reconcileOidcClientSecrets(stateDir, [
    { id: 'feria-service', plugin: 'other' },
    { id: 'lamaste-server', plugin: 'lamaste' },
  ]);
  assert.deepEqual(
    reclaimed.created.map((c) => c.id),
    ['feria-service'],
  );
  assert.notEqual(reclaimed.created[0].secret, rotated.secret);

  // The plugin is uninstalled: its secret is deleted.
  const removed = await reconcileOidcClientSecrets(stateDir, [
    { id: 'lamaste-server', plugin: 'lamaste' },
  ]);
  assert.deepEqual(removed.removed, ['feria-service']);
  assert.equal(await readOidcClientSecret(stateDir, 'feria-service'), null);

  await assert.rejects(
    reconcileOidcClientSecrets(stateDir, [
      { id: 'x', plugin: 'a' },
      { id: 'x', plugin: 'b' },
    ]),
    /unique/,
  );

  assert.equal(await clearOidcClientSecrets(stateDir), 1);
  assert.deepEqual(await listOidcClientSecrets(stateDir), []);
});
