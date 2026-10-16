/**
 * The identity the CLI verifies the panel against: the IP vhost's
 * certificate, read from disk — its address and its public-key pin (curl's
 * `sha256//` form, which agents and the desktop app store) — and the refusal
 * to connect at all when nginx does not hold the panel's port.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { X509Certificate } from 'node:crypto';
import { chmod, copyFile, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import https from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

import {
  assertPanelListener,
  certifiedAddress,
  panelListenerRefusal,
  readPanelIdentity,
} from '../src/panel-identity.js';
import { PANEL_ADDRESS, makeTlsFixtures } from './tls-fixtures.js';

/** @type {Awaited<ReturnType<typeof makeTlsFixtures>>} */
let tls;
/** @type {string} */
let dir;
before(async () => {
  tls = await makeTlsFixtures('unused');
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-cli-identity-'));
});
after(async () => {
  await tls?.cleanup();
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** A copy of `source` at `name` in the test directory with `mode`. */
async function placed(source, name, mode = 0o644) {
  const target = path.join(dir, name);
  await copyFile(source, target);
  await chmod(target, mode);
  return target;
}

test("the identity is the certificate's IPv4 address and its public-key pin", async () => {
  const certPath = await placed(tls.panel.certPath, 'self-signed.pem');
  const identity = await readPanelIdentity(certPath);
  assert.equal(identity.certPath, certPath);
  assert.equal(identity.address, PANEL_ADDRESS);
  assert.equal(identity.port, 9292);
  assert.match(identity.pin, /^[A-Za-z0-9+/]{43}=$/);
  const other = await readPanelIdentity(await placed(tls.impostor.certPath, 'impostor.pem'));
  assert.notEqual(other.pin, identity.pin, 'another key, another pin');
});

test("the pin is curl's --pinnedpubkey form: it admits the panel and refuses another key", async () => {
  const { pin } = await readPanelIdentity(await placed(tls.panel.certPath, 'pin.pem'));
  const server = https.createServer({ cert: tls.panel.cert, key: tls.panel.key }, (_req, res) =>
    res.end('ok'),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `https://127.0.0.1:${server.address().port}/`;
  try {
    // The form agents and the desktop app use for the self-signed panel: the
    // pin, not the CA chain, is what is checked.
    const ok = await execa('curl', ['-q', '-s', '-k', '--pinnedpubkey', `sha256//${pin}`, url], {
      reject: false,
    });
    assert.equal(ok.exitCode, 0, ok.stderr);
    assert.equal(ok.stdout, 'ok');
    const { pin: otherPin } = await readPanelIdentity(
      await placed(tls.impostor.certPath, 'other-pin.pem'),
    );
    const refused = await execa(
      'curl',
      ['-q', '-s', '-k', '--pinnedpubkey', `sha256//${otherPin}`, url],
      { reject: false },
    );
    assert.equal(refused.exitCode, 90, 'curl: public key does not match pinned public key');
  } finally {
    server.close();
  }
});

test('a certificate file others could write, a link, a missing file or no certificate is refused', async () => {
  await assert.rejects(
    readPanelIdentity(await placed(tls.panel.certPath, 'group-writable.pem', 0o664)),
    /is writable by group or others; refusing to trust it/,
  );
  await assert.rejects(
    readPanelIdentity(await placed(tls.panel.certPath, 'world-writable.pem', 0o646)),
    /is writable by group or others/,
  );
  const link = path.join(dir, 'link.pem');
  await symlink(await placed(tls.panel.certPath, 'target.pem'), link);
  await assert.rejects(readPanelIdentity(link), /is not a regular file/);
  await assert.rejects(
    readPanelIdentity(path.join(dir, 'missing.pem')),
    /Cannot read the panel's TLS certificate .*missing\.pem \(ENOENT\)/,
  );
  const garbage = path.join(dir, 'garbage.pem');
  await writeFile(garbage, 'not a certificate', { mode: 0o644 });
  await assert.rejects(readPanelIdentity(garbage), /does not hold a certificate/);
});

test('a certificate that names no IPv4 address cannot be verified for one', async () => {
  assert.throws(
    () => certifiedAddress(new X509Certificate(tls.named.cert)),
    /names no IPv4 address \(subjectAltName IP:<address>\)/,
  );
  assert.equal(certifiedAddress(new X509Certificate(tls.panel.cert)), PANEL_ADDRESS);
});

test('with panel 2FA on or the IP vhost off, nothing is sent to the port', async () => {
  assert.match(
    panelListenerRefusal({ panel2faEnabled: true, siteEnabled: false }),
    /^Panel 2FA is enabled: it switches off the panel listener on port 9292/,
  );
  assert.match(
    panelListenerRefusal({ panel2faEnabled: false, siteEnabled: false }),
    /^The panel listener on port 9292 is not enabled \(nginx site lamalibre-lamaste-panel-ip\)/,
  );
  assert.equal(panelListenerRefusal({ panel2faEnabled: false, siteEnabled: true }), null);

  const site = path.join(dir, 'lamalibre-lamaste-panel-ip');
  await assert.rejects(assertPanelListener({}, site), /is not enabled/);
  await symlink(path.join(dir, 'sites-available-ip'), site); // nginx's link, dangling here
  await assertPanelListener({ panel2fa: { enabled: false } }, site);
  await assertPanelListener(null, site);
  await assert.rejects(
    assertPanelListener({ panel2fa: { enabled: true, setupComplete: true } }, site),
    /^Error: Panel 2FA is enabled/,
  );
});

test('lamaste-server panel-pin prints the pin read from the certificate on disk', async () => {
  const pkiDir = await mkdtemp(path.join(dir, 'pki-'));
  await copyFile(tls.panel.certPath, path.join(pkiDir, 'self-signed.pem'));
  await chmod(path.join(pkiDir, 'self-signed.pem'), 0o644);
  const { pin } = await readPanelIdentity(path.join(pkiDir, 'self-signed.pem'));
  const bin = fileURLToPath(new URL('../bin/lamaste-server.js', import.meta.url));
  const { stdout } = await execa(process.execPath, [bin, '--json', 'panel-pin'], {
    env: { LAMALIBRE_LAMASTE_PKI_DIR: pkiDir },
  });
  assert.deepEqual(JSON.parse(stdout), {
    pin: `sha256//${pin}`,
    address: PANEL_ADDRESS,
    port: 9292,
    certificate: path.join(pkiDir, 'self-signed.pem'),
  });
});
