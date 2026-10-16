/**
 * The panel's TLS key pin, read from the server over SSH.
 *
 * At its IP address (`https://<ip>:9292`) the panel serves a self-signed
 * certificate create-lamaste made for the server, which no CA vouches for.
 * The desktop app verifies such a panel by the pin of that certificate's
 * public key. Where the app itself sets the server up — provisioning, admin
 * recovery — it reads the certificate over the SSH session the admin
 * credentials come through, so the pin needs no trust on first use.
 */

import { X509Certificate, createHash } from 'node:crypto';
import { sshExec } from './ssh.js';

/** The certificate of the panel's IP vhost on the server. */
export const PANEL_IP_CERT_PATH = '/etc/lamalibre/lamaste/pki/self-signed.pem';

/**
 * The pin of a PEM certificate's public key: base64 SHA-256 of its
 * SubjectPublicKeyInfo — curl's `--pinnedpubkey sha256//<pin>` form, the
 * one agents (`panelServerPubkeySha256`) and the desktop app store.
 */
export function panelKeyPin(certificatePem: string): string {
  const cert = new X509Certificate(certificatePem);
  const spki = cert.publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(spki).digest('base64');
}

/**
 * Read the panel's IP certificate over SSH and return its key pin.
 *
 * @param useSudo - the SSH user is not root (the PKI directory is the
 *   panel's own, mode 0700)
 */
export async function readPanelKeyPin(
  ip: string,
  privateKeyPath: string,
  knownHostsPath: string,
  { useSudo }: { useSudo: boolean },
): Promise<string> {
  const { stdout } = await sshExec(
    ip,
    privateKeyPath,
    `${useSudo ? 'sudo ' : ''}cat ${PANEL_IP_CERT_PATH}`,
    30_000,
    knownHostsPath,
  );
  return panelKeyPin(stdout);
}
