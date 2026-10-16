/**
 * The key pin of the panel's IP certificate, for the installer's JSON
 * `complete` event: the desktop app's local install stores it with the
 * server and verifies `https://<ip>:9292` by it from its first call on —
 * no trust on first use.
 */

import { X509Certificate, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Base64 SHA-256 of the certificate's SubjectPublicKeyInfo — curl's
 * `--pinnedpubkey sha256//<pin>` form, the one agents and the desktop app
 * store (`panelServerPubkeySha256`).
 *
 * @param {string | Buffer} certificatePem
 * @returns {string}
 */
export function panelKeyPin(certificatePem) {
  const spki = new X509Certificate(certificatePem).publicKey.export({
    type: 'spki',
    format: 'der',
  });
  return createHash('sha256').update(spki).digest('base64');
}

/**
 * The pin of `<pkiDir>/self-signed.pem` (written by `tasks/nginx.js`), or
 * undefined when it cannot be read — the desktop then pins on first use.
 *
 * @param {string} pkiDir
 * @returns {Promise<string | undefined>}
 */
export async function readPanelKeyPin(pkiDir) {
  try {
    return panelKeyPin(await readFile(join(pkiDir, 'self-signed.pem')));
  } catch {
    return undefined;
  }
}
