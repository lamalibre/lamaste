/**
 * Portable certificate storage for token-based enrollment.
 *
 * Stores enrolled certificates as P12 files on all platforms.
 * The P12 password is returned to the caller for secure storage
 * (e.g., macOS Keychain via security-framework, Linux libsecret).
 */

import crypto from 'node:crypto';
import { writeFile, access, constants } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { agentDataDir } from '@lamalibre/lamaste/agent';
import { secureDelete } from './keychain.js';

/**
 * Store an enrolled certificate as a P12 file.
 *
 * Creates a P12 bundle from key + cert + CA at
 * ~/.lamalibre/lamaste/agents/<label>/client.p12 with mode 0600.
 *
 * @param {string} keyPath - Path to the temporary private key PEM
 * @param {string} certPem - PEM-encoded signed certificate
 * @param {string} caCertPem - PEM-encoded CA certificate
 * @param {string} label - Agent label
 * @param {import('pino').Logger | Console} logger
 * @returns {Promise<{ p12Path: string, p12Password: string }>}
 */
export async function storeEnrolledCert(keyPath, certPem, caCertPem, label, logger) {
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

    await execa(
      'openssl',
      [
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
        `Lamaste Agent (${label})`,
        '-passout',
        'env:LAMALIBRE_LAMASTE_TMP_P12_PASS',
      ],
      {
        env: { ...process.env, LAMALIBRE_LAMASTE_TMP_P12_PASS: p12Password },
      },
    );

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

/**
 * Check if an enrolled certificate exists.
 * @param {string} label - Agent label
 * @returns {Promise<boolean>}
 */
export async function enrolledCertExists(label) {
  try {
    const p12Path = path.join(agentDataDir(label), 'client.p12');
    await access(p12Path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove an enrolled certificate.
 * @param {string} label - Agent label
 */
export async function removeEnrolledCert(label) {
  try {
    const p12Path = path.join(agentDataDir(label), 'client.p12');
    await secureDelete(p12Path);
  } catch {
    // May not exist — this is fine
  }
}
