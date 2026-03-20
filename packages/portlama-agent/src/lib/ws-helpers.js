import { readFileSync, existsSync } from 'node:fs';
import { mkdir, chmod, unlink } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { AGENT_DIR } from './platform.js';

/** Default path where the panel CA certificate is stored. */
export const CA_CERT_PATH = path.join(AGENT_DIR, 'ca.crt');

/**
 * Delete the temporary PEM cert and key files with best-effort error handling.
 * After setup, only ca.crt needs to remain on disk — the client cert/key
 * are embedded in the P12 and re-extracted on demand.
 * @param {{ certPath: string, keyPath: string }} pem
 */
export async function cleanupPemFiles(pem) {
  try {
    if (pem.certPath) await unlink(pem.certPath);
  } catch {
    // Best-effort — file may already be gone
  }
  try {
    if (pem.keyPath) await unlink(pem.keyPath);
  } catch {
    // Best-effort — file may already be gone
  }
}

/**
 * Load the p12 certificate as PEM files for the ws library.
 * Converts the p12 to temporary PEM cert + key files using openssl,
 * and also extracts the CA certificate for TLS verification.
 * @param {string} p12Path
 * @param {string} p12Password
 * @returns {Promise<{ certPath: string, keyPath: string, caPath: string | null }>}
 */
export async function extractPemFromP12(p12Path, p12Password) {
  const pemDir = path.join(AGENT_DIR, '.pem');
  await mkdir(pemDir, { recursive: true, mode: 0o700 });

  const certPath = path.join(pemDir, 'client-cert.pem');
  const keyPath = path.join(pemDir, 'client-key.pem');

  // Pass the P12 password via environment variable instead of command-line
  // argument to prevent it from being visible in `ps aux` process listings.
  const opensslEnv = { ...process.env, PORTLAMA_P12_PASS: p12Password };

  // Extract client certificate
  await execa(
    'openssl',
    [
      'pkcs12',
      '-in',
      p12Path,
      '-clcerts',
      '-nokeys',
      '-out',
      certPath,
      '-passin',
      'env:PORTLAMA_P12_PASS',
      '-legacy',
    ],
    { env: opensslEnv },
  );

  // Extract private key
  await execa(
    'openssl',
    [
      'pkcs12',
      '-in',
      p12Path,
      '-nocerts',
      '-nodes',
      '-out',
      keyPath,
      '-passin',
      'env:PORTLAMA_P12_PASS',
      '-legacy',
    ],
    { env: opensslEnv },
  );

  // Restrict private key file permissions to owner-only read/write
  await chmod(keyPath, 0o600);

  // Extract CA certificate from the P12 bundle
  let caPath = null;
  try {
    await execa(
      'openssl',
      [
        'pkcs12',
        '-in',
        p12Path,
        '-cacerts',
        '-nokeys',
        '-out',
        CA_CERT_PATH,
        '-passin',
        'env:PORTLAMA_P12_PASS',
        '-legacy',
      ],
      { env: opensslEnv },
    );
    // Verify the file was actually created and contains a valid certificate
    if (
      existsSync(CA_CERT_PATH) &&
      readFileSync(CA_CERT_PATH, 'utf8').includes('BEGIN CERTIFICATE')
    ) {
      await chmod(CA_CERT_PATH, 0o644);
      caPath = CA_CERT_PATH;
    } else if (existsSync(CA_CERT_PATH)) {
      // Remove stale/empty file so it doesn't cause confusing TLS errors later
      await unlink(CA_CERT_PATH).catch(() => {});
    }
  } catch {
    // CA cert may not be present in the P12 — that is acceptable.
    // The caller will fall back to insecure mode with a warning.
  }

  return { certPath, keyPath, caPath };
}

/**
 * Build TLS options for a WebSocket connection using the extracted PEM files.
 * @param {{ certPath: string, keyPath: string, caPath: string | null }} pem
 * @returns {{ cert: Buffer, key: Buffer, rejectUnauthorized: boolean }}
 */
export function buildWsTlsOptions(pem) {
  const cert = readFileSync(pem.certPath);
  const key = readFileSync(pem.keyPath);

  // The panel uses a self-signed TLS server certificate that is separate from
  // the mTLS CA used to sign client certificates. The CA cert extracted from
  // the P12 (mTLS CA) cannot verify the server's TLS cert. Until proper server
  // certificate distribution is implemented, we must skip server TLS verification.
  // The mTLS client cert still authenticates the agent to the panel.
  //
  // TODO: Implement server certificate distribution during setup so we can
  // enable rejectUnauthorized: true with the correct server CA.
  return {
    cert,
    key,
    rejectUnauthorized: false,
  };
}

/**
 * Build WebSocket URL from panel URL.
 * Converts https:// to wss:// and http:// to ws://.
 * @param {string} panelUrl
 * @param {string} wsPath
 * @returns {string}
 */
export function buildWsUrl(panelUrl, wsPath) {
  return panelUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + wsPath;
}
