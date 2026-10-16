/**
 * How create-lamaste-admin verifies the panel it upgrades the admin
 * certificate with.
 *
 * The panel's answer to the upgrade is the admin certificate and the CA
 * this Mac then trusts in the login keychain, so it must come from the
 * panel. At its domain (`https://panel.<domain>`) the panel has a publicly
 * trusted certificate, which curl verifies the normal way. At its IP address
 * (`https://<ip>:9292`) it serves a self-signed certificate no CA vouches
 * for, so the panel is verified by the pin of its public key — the pin the
 * desktop app passes (`--panel-pin`), or, run by hand, the key the panel
 * presents, shown before the operator confirms (compare it with
 * `sudo lamaste-server panel-pin` on the server). curl gets the pin with
 * `-k`: that waives only the CA and name checks a self-signed certificate
 * cannot pass; a different key fails before curl sends anything.
 */

import { X509Certificate, createHash } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

/**
 * Whether the panel at `panelUrl` is reached at an IP address (and so is
 * verified by a key pin).
 *
 * @param {string} panelUrl
 * @returns {boolean}
 */
export function panelNeedsPin(panelUrl) {
  const url = new URL(panelUrl);
  if (url.protocol !== 'https:') throw new Error('The panel URL must use https://');
  return net.isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0;
}

/**
 * A pin as given (`sha256//<base64>` or bare base64), checked to be a
 * base64 SHA-256 digest. Returns the bare form.
 *
 * @param {string} pin
 * @returns {string}
 */
export function normalizePin(pin) {
  const bare = String(pin)
    .trim()
    .replace(/^sha256\/\//, '');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(bare)) {
    throw new Error('The panel key pin must be a base64 SHA-256 digest (sha256//…)');
  }
  return bare;
}

/**
 * curl's arguments verifying the panel: none for a domain, the pin for an
 * IP address — which then needs one: never `-k` alone.
 *
 * @param {string} panelUrl
 * @param {string | undefined} pin
 * @returns {string[]}
 */
export function panelTlsArgs(panelUrl, pin) {
  if (!panelNeedsPin(panelUrl)) return [];
  if (!pin) {
    throw new Error(
      `The panel at ${panelUrl} is reached at its IP address: its TLS key pin is required (--panel-pin)`,
    );
  }
  return ['-k', '--pinnedpubkey', `sha256//${normalizePin(pin)}`];
}

/**
 * The pin of the key the panel at `panelUrl` presents: one TLS handshake,
 * nothing sent. What it returns is only as good as the network path it
 * crossed — the caller shows it for the operator to compare.
 *
 * @param {string} panelUrl
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<string>}
 */
export function fetchPanelKeyPin(panelUrl, { timeoutMs = 10_000 } = {}) {
  const url = new URL(panelUrl);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = url.port ? Number(url.port) : 443;
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      // No CA vouches for the certificate: its key's pin is what is read.
      rejectUnauthorized: false,
      ...(net.isIP(host) ? {} : { servername: host }),
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out reading the TLS key of ${panelUrl}`));
    }, timeoutMs);
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      try {
        const peer = socket.getPeerCertificate(true);
        if (!peer?.raw) throw new Error(`The panel at ${panelUrl} presented no certificate`);
        const spki = new X509Certificate(peer.raw).publicKey.export({
          type: 'spki',
          format: 'der',
        });
        resolve(createHash('sha256').update(spki).digest('base64'));
      } catch (err) {
        reject(err);
      } finally {
        socket.end();
      }
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not reach the panel at ${panelUrl}: ${err.message}`));
    });
  });
}
