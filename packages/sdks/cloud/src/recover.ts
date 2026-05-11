/**
 * SSH-based admin certificate recovery.
 *
 * Used by the desktop app's "Discover Server" wizard when the user has lost
 * their admin P12 certificate. The flow:
 *
 * 1. Generate ephemeral ed25519 SSH key pair
 * 2. User adds public key to droplet (via DigitalOcean console)
 * 3. Test SSH connectivity
 * 4. SSH in and run `sudo lamaste-reset-admin`
 * 5. Read the new P12 password from /etc/lamalibre/lamaste/pki/.p12-password
 * 6. SCP download the new client.p12
 * 7. Cleanup ephemeral SSH keys
 *
 * Security notes:
 * - All SSH commands are hardcoded strings (no user input interpolation)
 * - Ephemeral keys are secure-deleted after use (overwrite + unlink)
 * - Downloaded P12 is stored in the same temp directory as the SSH keys
 * - The temp directory has 0700 permissions
 */

import { dirname, join, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { tmpDir } from '@lamalibre/lamaste/agent';
import { generateKeyPair, sshExec, scpDownload, cleanupKeyPair, secureDelete } from './ssh.js';

export interface RecoveryKeyPair {
  readonly publicKey: string;
  readonly privateKeyPath: string;
  readonly knownHostsPath: string;
  readonly dir: string;
}

export interface RecoveryResult {
  readonly p12Path: string;
  readonly p12Password: string;
}

/**
 * Generate an ephemeral SSH key pair for recovery.
 *
 * The keys are created in ~/.lamalibre/lamaste/tmp/provision-<uuid>/ with 0700
 * directory permissions and 0600 private key permissions.
 */
export async function generateRecoveryKeyPair(): Promise<RecoveryKeyPair> {
  const keyPair = await generateKeyPair();
  return {
    publicKey: keyPair.publicKey,
    privateKeyPath: keyPair.privateKeyPath,
    knownHostsPath: keyPair.knownHostsPath,
    dir: keyPair.dir,
  };
}

/**
 * Test SSH connectivity to a server.
 *
 * Runs `echo ok` over SSH with a 15-second timeout.
 * Throws on connection failure.
 */
export async function testRecoverySSH(
  ip: string,
  privateKeyPath: string,
  knownHostsPath: string,
): Promise<void> {
  await sshExec(ip, privateKeyPath, 'echo ok', 15_000, knownHostsPath);
}

/**
 * Run `sudo lamaste-reset-admin` on the server, read the new P12 password,
 * and download the new client.p12 certificate.
 *
 * The P12 file is downloaded to the same temp directory as the SSH keys.
 * The password is read from the server's /etc/lamalibre/lamaste/pki/.p12-password file
 * (written by reset-admin during execution).
 */
export async function recoverAdmin(
  ip: string,
  privateKeyPath: string,
  knownHostsPath: string,
): Promise<RecoveryResult> {
  // Run the reset command — generates new admin keypair, P12, restarts serverd, reloads nginx
  await sshExec(ip, privateKeyPath, 'sudo lamaste-reset-admin', 120_000, knownHostsPath);

  // Read the P12 password from the known server-side location
  const { stdout: password } = await sshExec(
    ip,
    privateKeyPath,
    'sudo cat /etc/lamalibre/lamaste/pki/.p12-password',
    15_000,
    knownHostsPath,
  );

  // Download the P12 certificate to the ephemeral temp directory
  const dir = dirname(privateKeyPath);
  const localP12 = join(dir, 'recovered-admin.p12');
  await scpDownload(
    ip,
    privateKeyPath,
    '/etc/lamalibre/lamaste/pki/client.p12',
    localP12,
    knownHostsPath,
  );

  return {
    p12Path: localP12,
    p12Password: password.trim(),
  };
}

/**
 * Clean up all recovery temp files: SSH keys, known_hosts, and any
 * downloaded P12 certificate.
 *
 * The private key is secure-deleted (overwritten with random bytes before
 * unlinking). Other files are simply unlinked.
 */
export async function cleanupRecovery(dir: string): Promise<void> {
  // Validate the dir is under <tmpDir>/ to prevent path traversal
  const expectedPrefix = tmpDir();
  const canonicalDir = await realpath(resolve(dir)).catch(() => '');
  const canonicalPrefix = await realpath(expectedPrefix).catch(() => expectedPrefix);
  if (!canonicalDir || !canonicalDir.startsWith(canonicalPrefix + '/')) {
    throw new Error(`Recovery directory must be under ${expectedPrefix}/`);
  }

  // Use the canonical path for all operations to prevent TOCTOU
  await secureDelete(join(canonicalDir, 'recovered-admin.p12')).catch(() => {});

  // Use cleanupKeyPair to handle the SSH key files
  await cleanupKeyPair({
    privateKeyPath: join(canonicalDir, 'id_ed25519'),
    publicKeyPath: join(canonicalDir, 'id_ed25519.pub'),
    publicKey: '',
    knownHostsPath: join(canonicalDir, 'known_hosts'),
    dir: canonicalDir,
  });
}
