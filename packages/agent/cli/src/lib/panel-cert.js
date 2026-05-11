/**
 * Panel server TLS certificate inspection.
 *
 * Used during enrollment (TOFU — trust on first use) to capture the panel
 * server's leaf certificate fingerprint and public key digest. The captured
 * pin is persisted in the agent config and re-used on every subsequent
 * panel call so a network MITM cannot impersonate the panel after
 * enrollment.
 *
 * Two digests are produced:
 *
 *  - `pubkeySha256Base64` — base64 SHA-256 of the SubjectPublicKeyInfo
 *    DER. Format used by curl's `--pinnedpubkey 'sha256//<base64>'`.
 *    Pinning the public key (not the cert) means the panel can rotate its
 *    TLS certificate without invalidating the agent's pin, so long as the
 *    key stays the same.
 *
 *  - `certSha256Hex` — hex SHA-256 of the full leaf certificate DER.
 *    Format used by chisel's `--fingerprint <hex>` flag for tunnel-server
 *    cert pinning.
 */

import crypto, { X509Certificate } from 'node:crypto';
import tls from 'node:tls';

/**
 * Open a TLS connection to the panel and return digests of the server's
 * leaf certificate. `rejectUnauthorized: false` is required because:
 *
 *  1. During first-time enrollment we have no pin yet (TOFU).
 *  2. The panel may use a self-signed cert (IP vhost on :9292) which Node
 *     would otherwise reject regardless of pinning.
 *
 * The returned digests are the *only* values that matter — the connection
 * itself is discarded. The caller is responsible for pinning verification
 * on subsequent calls.
 *
 * @param {string} panelUrl - Full panel URL (e.g. https://1.2.3.4:9292)
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ pubkeySha256Base64: string, certSha256Hex: string, subject: string }>}
 */
export async function fetchPanelServerCertDigests(panelUrl, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const parsed = new URL(panelUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error(`Panel URL must use HTTPS, got: ${parsed.protocol}`);
  }
  const host = parsed.hostname;
  const port = parsed.port ? Number(parsed.port) : 443;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // best-effort
      }
      if (err) reject(err);
      else resolve(value);
    };

    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        // TOFU: we have no trust anchor for the panel cert at this stage;
        // the digest we capture *is* the trust anchor for future calls.
        rejectUnauthorized: false,
        // Keep the handshake fast — we only need the leaf cert.
        ALPNProtocols: ['http/1.1'],
      },
      () => {
        try {
          // detailed=true so we get the cert object with raw DER buffer.
          const cert = socket.getPeerCertificate(true);
          if (!cert || Object.keys(cert).length === 0) {
            finish(new Error(`Panel at ${host}:${port} presented no certificate`));
            return;
          }
          if (!cert.raw || !Buffer.isBuffer(cert.raw)) {
            finish(
              new Error(`Panel cert is missing the raw DER buffer required for fingerprinting`),
            );
            return;
          }

          // Note on SubjectPublicKeyInfo extraction:
          // `cert.pubkey` from Node's TLS layer is the raw key bits only
          // (e.g. the EC point for ECDSA keys), NOT the DER-encoded
          // SubjectPublicKeyInfo. curl's `--pinnedpubkey 'sha256//<b64>'`
          // expects SHA-256 over the *full SPKI DER*. We re-parse the leaf
          // through X509Certificate and export SPKI to get the right bytes.
          const x509 = new X509Certificate(cert.raw);
          const spkiDer = x509.publicKey.export({ type: 'spki', format: 'der' });

          const pubkeySha256Base64 = crypto.createHash('sha256').update(spkiDer).digest('base64');

          const certSha256Hex = crypto.createHash('sha256').update(cert.raw).digest('hex');

          // Prefer the X509Certificate's subject string (RFC 4514) over
          // the structured object on `cert.subject`, which uses an
          // ad-hoc Node-specific shape.
          const subject = x509.subject || '';

          finish(null, { pubkeySha256Base64, certSha256Hex, subject });
        } catch (err) {
          finish(err);
        }
      },
    );

    const timer = setTimeout(() => {
      finish(
        new Error(`Timed out after ${timeoutMs}ms connecting to ${host}:${port} for cert pinning`),
      );
    }, timeoutMs);
    timer.unref();

    socket.once('error', (err) => finish(err));
    socket.once('close', () => clearTimeout(timer));
  });
}

/**
 * Format a base64 SHA-256 public-key digest for curl's `--pinnedpubkey`.
 * @param {string} base64Digest
 * @returns {string}
 */
export function formatCurlPinnedPubkey(base64Digest) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Digest)) {
    throw new Error('formatCurlPinnedPubkey: base64Digest has invalid characters');
  }
  return `sha256//${base64Digest}`;
}

/**
 * Validate a hex SHA-256 string (64 lowercase hex chars). Accepts upper or
 * mixed case as well — chisel itself is case-insensitive — but normalises
 * to lower case for consistent persistence.
 *
 * @param {string} hex
 * @returns {string}
 */
export function normalizeCertSha256Hex(hex) {
  const cleaned = String(hex).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleaned)) {
    throw new Error(`Invalid SHA-256 hex digest: expected 64 hex chars, got "${hex}"`);
  }
  return cleaned;
}
