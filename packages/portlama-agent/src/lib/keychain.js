import crypto from 'node:crypto';
import { writeFile, unlink, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { AGENT_DIR } from './platform.js';

/**
 * Overwrite a file with random bytes, then unlink it.
 * Provides defense-in-depth against key recovery from disk.
 *
 * @param {string} filePath - Path to the file to securely delete
 */
export async function secureDelete(filePath) {
  try {
    const { size } = await stat(filePath);
    const randomData = crypto.randomBytes(Math.min(size, 16384));
    await writeFile(filePath, randomData);
    await unlink(filePath);
  } catch {
    // Best effort — if stat/write fails, still try to unlink
    await unlink(filePath).catch(() => {});
  }
}

/**
 * Generate a 4096-bit RSA keypair and CSR for agent enrollment.
 *
 * The private key is written to a temporary file in ~/.portlama/ with
 * mode 0600. The CSR is generated with the agent-scoped subject
 * /CN=agent:<label>/O=Portlama.
 *
 * @param {string} label - Agent label
 * @returns {Promise<{ keyPath: string, csrPem: string }>}
 */
export async function generateKeypairAndCSR(label) {
  const suffix = crypto.randomBytes(8).toString('hex');
  const keyPath = path.join(AGENT_DIR, `.tmp-key-${suffix}.pem`);
  const csrPath = path.join(AGENT_DIR, `.tmp-csr-${suffix}.pem`);

  try {
    // Generate 4096-bit RSA key
    await execa('openssl', ['genrsa', '-out', keyPath, '4096']);

    // Set restrictive permissions
    await execa('chmod', ['600', keyPath]);

    // Create CSR with agent-scoped subject
    await execa('openssl', [
      'req',
      '-new',
      '-key',
      keyPath,
      '-out',
      csrPath,
      '-subj',
      `/CN=agent:${label}/O=Portlama`,
    ]);

    const csrPem = await readFile(csrPath, 'utf-8');

    return { keyPath, csrPem };
  } catch (err) {
    // Clean up on failure
    await secureDelete(keyPath);
    throw new Error(`Failed to generate keypair and CSR: ${err.stderr || err.message}`);
  } finally {
    // Always clean up the CSR temp file (the key is needed by the caller)
    await unlink(csrPath).catch(() => {});
  }
}

/**
 * Import a signed certificate and its private key into the macOS Keychain
 * as a non-extractable identity.
 *
 * Creates a temporary P12 from the key+cert+CA, imports into Keychain with
 * the -x flag (non-extractable), sets the key partition list for curl access,
 * and securely deletes all temporary files.
 *
 * @param {string} keyPath - Path to the temporary private key PEM
 * @param {string} certPem - PEM-encoded signed certificate
 * @param {string} caCertPem - PEM-encoded CA certificate
 * @param {string} label - Agent label
 * @param {import('pino').Logger | Console} logger
 * @returns {Promise<{ identity: string }>}
 */
export async function importIdentityToKeychain(keyPath, certPem, caCertPem, label, logger) {
  const suffix = crypto.randomBytes(8).toString('hex');
  const certPath = path.join(AGENT_DIR, `.tmp-cert-${suffix}.pem`);
  const caPath = path.join(AGENT_DIR, `.tmp-ca-${suffix}.pem`);
  const p12Path = path.join(AGENT_DIR, `.tmp-import-${suffix}.p12`);
  const p12Password = crypto.randomBytes(16).toString('hex');
  const identityName = `Portlama Agent (${label})`;

  try {
    // Write cert and CA to temp files
    await writeFile(certPath, certPem, { mode: 0o600 });
    await writeFile(caPath, caCertPem, { mode: 0o600 });

    // Create temporary P12 from key + cert + CA
    logger.info?.({ label }, 'Creating temporary P12 for Keychain import') ??
      logger.log?.(`Creating temporary P12 for Keychain import: ${label}`);
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
      identityName,
      '-passout',
      `env:PORTLAMA_TMP_P12_PASS`,
    ], {
      env: { ...process.env, PORTLAMA_TMP_P12_PASS: p12Password },
    });

    // Import into Keychain with -x (non-extractable) and -T for curl access.
    // Known limitation: `security import -P` passes the password as a CLI argument,
    // visible in `ps aux`. The `security` command does not support stdin or env var
    // password input. Mitigated by: the P12 is ephemeral (random password, temp file,
    // deleted immediately after import), so the exposure window is seconds.
    logger.info?.({ label }, 'Importing identity into Keychain (non-extractable)') ??
      logger.log?.(`Importing identity into Keychain: ${label}`);
    await execa('security', [
      'import',
      p12Path,
      '-x',                 // non-extractable private key
      '-T',
      '/usr/bin/curl',      // allow curl to use this identity
      '-P',
      p12Password,
    ]);

    // Set the key partition list so curl can access the identity without prompts.
    // This uses the default Keychain password (empty string for login Keychain
    // on most macOS setups), which may prompt the user if the Keychain is locked.
    try {
      await execa('security', [
        'set-key-partition-list',
        '-S',
        'apple:',
        '-k',
        '',                  // Keychain password (empty for login Keychain)
        '-D',
        identityName,
      ]);
    } catch (err) {
      // This can fail if the Keychain is locked or the password is wrong.
      // The import still succeeded — the user may need to authorize curl manually.
      logger.warn?.({ err, label }, 'Could not set key partition list — curl may prompt for access') ??
        logger.log?.(`Warning: Could not set key partition list for ${label}`);
    }

    return { identity: identityName };
  } finally {
    // Securely delete all temp files
    await secureDelete(keyPath);
    await secureDelete(certPath);
    await secureDelete(caPath);
    await secureDelete(p12Path);
  }
}

/**
 * Check if a Keychain identity exists for the given agent label.
 *
 * @param {string} label - Agent label
 * @returns {Promise<boolean>}
 */
export async function keychainIdentityExists(label) {
  const identityName = `Portlama Agent (${label})`;
  try {
    const { stdout } = await execa('security', [
      'find-identity',
      '-v',
      '-p',
      'ssl-client',
    ]);
    return stdout.includes(identityName);
  } catch {
    return false;
  }
}

/**
 * Remove a Keychain identity for the given agent label.
 *
 * @param {string} label - Agent label
 */
export async function removeKeychainIdentity(label) {
  const identityName = `Portlama Agent (${label})`;
  await execa('security', [
    'delete-identity',
    '-c',
    identityName,
  ]);
}
