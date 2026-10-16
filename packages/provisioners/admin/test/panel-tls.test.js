/**
 * create-lamaste-admin verifies the panel before anything is sent: a panel's
 * domain by its CA, a panel's IP address by its key pin (never `-k` alone);
 * and run by hand it reads the key the panel presents, for the operator to
 * compare with `lamaste-server panel-pin`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import https from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';

import { fetchPanelKeyPin, normalizePin, panelNeedsPin, panelTlsArgs } from '../src/panel-tls.js';

const PIN = '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=';

test('a domain is verified by its CA, an IP address by its pin', () => {
  assert.equal(panelNeedsPin('https://panel.example.com'), false);
  assert.equal(panelNeedsPin('https://203.0.113.7:9292'), true);
  assert.equal(panelNeedsPin('https://[2001:db8::1]:9292'), true);
  assert.throws(() => panelNeedsPin('http://203.0.113.7:9292'), /https/);

  assert.deepEqual(panelTlsArgs('https://panel.example.com', undefined), []);
  assert.deepEqual(panelTlsArgs('https://203.0.113.7:9292', `sha256//${PIN}`), [
    '-k',
    '--pinnedpubkey',
    `sha256//${PIN}`,
  ]);
  assert.deepEqual(panelTlsArgs('https://203.0.113.7:9292', PIN).at(-1), `sha256//${PIN}`);
});

test('an IP panel without a valid pin is refused, never reached with -k alone', () => {
  assert.throws(
    () => panelTlsArgs('https://203.0.113.7:9292', undefined),
    /reached at its IP address: its TLS key pin is required \(--panel-pin\)/,
  );
  for (const bad of ['', 'abc', 'sha256//abc', `sha1//${PIN}`, `${PIN}x`]) {
    assert.throws(() => panelTlsArgs('https://203.0.113.7:9292', bad), /pin/, bad);
  }
  assert.equal(normalizePin(` sha256//${PIN} `), PIN);
});

test('run by hand, it reads the key the panel presents as openssl computes its pin', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-admin-pin-'));
  try {
    const cert = path.join(dir, 'self-signed.pem');
    const key = path.join(dir, 'self-signed-key.pem');
    await execa('openssl', [
      'req',
      '-x509',
      '-nodes',
      '-days',
      '2',
      '-newkey',
      'rsa:2048',
      '-keyout',
      key,
      '-out',
      cert,
      '-subj',
      '/CN=127.0.0.1/O=Lamaste',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ]);
    const { stdout: expected } = await execa('sh', [
      '-c',
      'openssl x509 -pubkey -noout -in "$1" | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl base64 -A',
      'sh',
      cert,
    ]);
    let requests = 0;
    const server = https.createServer(
      { cert: await readFile(cert), key: await readFile(key) },
      (_req, res) => {
        requests += 1;
        res.end('{}');
      },
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const pin = await fetchPanelKeyPin(`https://127.0.0.1:${server.address().port}`);
      assert.equal(pin, expected.trim());
      assert.equal(requests, 0, 'reading the key sends no request');
    } finally {
      server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
