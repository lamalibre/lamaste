/**
 * TLS material for the panel client's tests, made with the `openssl` CLI in a
 * private temporary directory: the panel's IP certificate (issued for a
 * TEST-NET-3 address, as create-lamaste issues it for the server's address),
 * an impostor's certificate for the same address with another key, and an
 * admin client certificate as P12. The P12 uses SHA-1/3DES so every curl
 * build reads it (LibreSSL on macOS included).
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';

/** The address the test panel's certificate is issued for. */
export const PANEL_ADDRESS = '203.0.113.7';

/**
 * @param {string} dir
 * @param {string} name
 * @param {string} subject
 * @param {string | null} san
 */
async function selfSigned(dir, name, subject, san) {
  const keyPath = path.join(dir, `${name}.key`);
  const certPath = path.join(dir, `${name}.pem`);
  await execa('openssl', [
    'req',
    '-x509',
    '-nodes',
    '-days',
    '2',
    '-newkey',
    'rsa:2048',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-subj',
    subject,
    ...(san ? ['-addext', `subjectAltName=${san}`] : []),
  ]);
  return { keyPath, certPath, key: await readFile(keyPath), cert: await readFile(certPath) };
}

/**
 * @param {string} p12Password
 */
export async function makeTlsFixtures(p12Password) {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-cli-tls-'));
  const panel = await selfSigned(
    dir,
    'panel',
    `/CN=${PANEL_ADDRESS}/O=Lamaste`,
    `IP:${PANEL_ADDRESS}`,
  );
  const impostor = await selfSigned(
    dir,
    'impostor',
    `/CN=${PANEL_ADDRESS}/O=Lamaste`,
    `IP:${PANEL_ADDRESS}`,
  );
  const named = await selfSigned(dir, 'named', '/CN=panel.example.com', 'DNS:panel.example.com');
  const client = await selfSigned(dir, 'client', '/CN=admin', null);
  const p12Path = path.join(dir, 'client.p12');
  await execa(
    'openssl',
    [
      'pkcs12',
      '-export',
      '-inkey',
      client.keyPath,
      '-in',
      client.certPath,
      '-out',
      p12Path,
      '-passout',
      'stdin',
      '-certpbe',
      'PBE-SHA1-3DES',
      '-keypbe',
      'PBE-SHA1-3DES',
      '-macalg',
      'sha1',
    ],
    { input: `${p12Password}\n` },
  );
  return {
    dir,
    panel,
    impostor,
    named,
    p12Path,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
