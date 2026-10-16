/**
 * The pin the installer reports for the panel's IP certificate (the JSON
 * `complete` event a desktop local install reads): curl's `sha256//` form of
 * the certificate's public key, as openssl computes it independently.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';

import { panelKeyPin, readPanelKeyPin } from '../src/lib/panel-pin.js';

test('the installer reports the key pin of the IP certificate it made', async () => {
  const pkiDir = await mkdtemp(path.join(tmpdir(), 'lamaste-installer-pin-'));
  try {
    assert.equal(await readPanelKeyPin(pkiDir), undefined, 'no certificate, no pin');
    const cert = path.join(pkiDir, 'self-signed.pem');
    // As tasks/nginx.js makes it.
    await execa('openssl', [
      'req',
      '-x509',
      '-nodes',
      '-days',
      '2',
      '-newkey',
      'rsa:2048',
      '-keyout',
      path.join(pkiDir, 'self-signed-key.pem'),
      '-out',
      cert,
      '-subj',
      '/CN=203.0.113.7/O=Lamaste',
      '-addext',
      'subjectAltName=IP:203.0.113.7',
    ]);
    const { stdout: expected } = await execa('sh', [
      '-c',
      'openssl x509 -pubkey -noout -in "$1" | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl base64 -A',
      'sh',
      cert,
    ]);
    assert.equal(await readPanelKeyPin(pkiDir), expected.trim());
    assert.equal(panelKeyPin(await readFile(cert)), expected.trim());
  } finally {
    await rm(pkiDir, { recursive: true, force: true });
  }
});
