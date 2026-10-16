/**
 * The panel key pin the provisioner and the admin recovery read over SSH:
 * curl's `--pinnedpubkey sha256//` form of the certificate's public key, as
 * openssl computes it independently, and what the desktop app stores.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { PANEL_IP_CERT_PATH, panelKeyPin } from '../dist/panel-pin.js';

const run = promisify(execFile);

test("the pin is the base64 SHA-256 of the certificate's public key", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-cloud-pin-'));
  try {
    const cert = path.join(dir, 'self-signed.pem');
    await run('openssl', [
      'req',
      '-x509',
      '-nodes',
      '-days',
      '2',
      '-newkey',
      'rsa:2048',
      '-keyout',
      path.join(dir, 'self-signed-key.pem'),
      '-out',
      cert,
      '-subj',
      '/CN=203.0.113.7/O=Lamaste',
      '-addext',
      'subjectAltName=IP:203.0.113.7',
    ]);
    const { stdout: expected } = await run('sh', [
      '-c',
      'openssl x509 -pubkey -noout -in "$1" | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl base64 -A',
      'sh',
      cert,
    ]);
    const pin = panelKeyPin(await readFile(cert, 'utf-8'));
    assert.equal(pin, expected.trim());
    assert.match(pin, /^[A-Za-z0-9+/]{43}=$/);
    assert.throws(() => panelKeyPin('not a certificate'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  assert.equal(PANEL_IP_CERT_PATH, '/etc/lamalibre/lamaste/pki/self-signed.pem');
});
