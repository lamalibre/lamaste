/**
 * Portable certificate storage for token-based enrollment.
 *
 * Dispatches to macOS Keychain or Linux P12 file storage based on process.platform.
 */

import crypto from 'node:crypto';
import { writeFile, access, constants } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { isDarwin, agentDataDir } from './platform.js';
import { secureDelete } from './keychain.js';

/**
 * Store an enrolled certificate using the platform-appropriate mechanism.
 *
 * - macOS: imports identity into Keychain (non-extractable)
 * - Linux: creates a P12 file at ~/.portlama/client.p12 with mode 0600
 *
 * @param {string} keyPath - Path to the temporary private key PEM
 * @param {string} certPem - PEM-encoded signed certificate
 * @param {string} caCertPem - PEM-encoded CA certificate
 * @param {string} label - Agent label
 * @param {import('pino').Logger | Console} logger
 * @returns {Promise<{ identity?: string, p12Path?: string, p12Password?: string }>}
 */
export async function storeEnrolledCert(keyPath, certPem, caCertPem, label, logger) {
  if (isDarwin()) {
    const { importIdentityToKeychain } = await import('./keychain.js');
    const { identity } = await importIdentityToKeychain(keyPath, certPem, caCertPem, label, logger);
    return { identity };
  }
  return storeP12Linux(keyPath, certPem, caCertPem, label, logger);
}

/**
 * Check if an enrolled certificate exists.
 * @param {string} label - Agent label
 * @returns {Promise<boolean>}
 */
export async function enrolledCertExists(label) {
  if (isDarwin()) {
    const { keychainIdentityExists } = await import('./keychain.js');
    return keychainIdentityExists(label);
  }
  return linuxP12Exists(label);
}

/**
 * Remove an enrolled certificate.
 * @param {string} label - Agent label
 */
export async function removeEnrolledCert(label) {
  if (isDarwin()) {
    const { removeKeychainIdentity } = await import('./keychain.js');
    return removeKeychainIdentity(label);
  }
  return removeLinuxP12(label);
}

// ---------------------------------------------------------------------------
// Linux — P12 file storage
// ---------------------------------------------------------------------------

/**
 * Create a P12 from key + cert + CA and store at ~/.portlama/client.p12.
 *
 * Uses the same `-keypbe PBE-SHA1-3DES` parameters as keychain.js for
 * maximum curl compatibility.
 */
async function storeP12Linux(keyPath, certPem, caCertPem, label, logger) {
  const dataDir = agentDataDir(label);
  const p12Path = path.join(dataDir, 'client.p12');
  const suffix = crypto.randomBytes(8).toString('hex');
  const certPath = path.join(dataDir, `.tmp-cert-${suffix}.pem`);
  const caPath = path.join(dataDir, `.tmp-ca-${suffix}.pem`);
  const p12Password = crypto.randomBytes(16).toString('hex');

  try {
    // Write cert and CA to temp files
    await writeFile(certPath, certPem, { mode: 0o600 });
    await writeFile(caPath, caCertPem, { mode: 0o600 });

    logger.info?.({ label }, 'Creating P12 certificate bundle') ??
      logger.log?.(`Creating P12 certificate bundle: ${label}`);

    await execa('openssl', [
      'pkcs12',
      '-export',
      '-keypbe',
      'PBE-SHA1-3DES',
      '-certpbe',
      'PBE-SHA1-3DES',
      '-macalg',
      'sha1',
      '-out',
      p12Path,
      '-inkey',
      keyPath,
      '-in',
      certPath,
      '-certfile',
      caPath,
      '-name',
      `Portlama Agent (${label})`,
      '-passout',
      'env:PORTLAMA_TMP_P12_PASS',
    ], {
      env: { ...process.env, PORTLAMA_TMP_P12_PASS: p12Password },
    });

    // Set restrictive permissions on the P12
    await execa('chmod', ['600', p12Path]);

    logger.info?.({ label, path: p12Path }, 'P12 stored') ??
      logger.log?.(`P12 stored at ${p12Path}`);

    return { p12Path, p12Password };
  } finally {
    // Securely delete temp files — the key is consumed here
    await secureDelete(keyPath);
    await secureDelete(certPath);
    await secureDelete(caPath);
  }
}

async function linuxP12Exists(label) {
  try {
    const p12Path = path.join(agentDataDir(label), 'client.p12');
    await access(p12Path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function removeLinuxP12(label) {
  try {
    const p12Path = path.join(agentDataDir(label), 'client.p12');
    await secureDelete(p12Path);
  } catch {
    // May not exist — this is fine
  }
}
