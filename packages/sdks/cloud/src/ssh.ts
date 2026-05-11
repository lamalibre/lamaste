/**
 * SSH key generation, remote execution, and secure file operations.
 *
 * Uses ssh-keygen for key generation and ssh/scp for remote operations.
 * Follows the same security patterns as create-lamaste-admin:
 * - Temporary files in 0700 directories
 * - Private keys with 0600 permissions
 * - Secure deletion (overwrite + unlink)
 */

import crypto from 'node:crypto';
import { readFile, writeFile, unlink, mkdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpDir } from '@lamalibre/lamaste/agent';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// SSH key generation
// ---------------------------------------------------------------------------

export interface SSHKeyPair {
  readonly privateKeyPath: string;
  readonly publicKeyPath: string;
  readonly publicKey: string;
  readonly knownHostsPath: string;
  readonly dir: string;
}

/**
 * Generate an ed25519 SSH keypair in a secure temporary directory.
 *
 * The directory is created at ~/.lamalibre/lamaste/tmp/provision-<uuid>/
 * with 0700 permissions. The private key gets 0600 permissions.
 */
export async function generateKeyPair(): Promise<SSHKeyPair> {
  const id = crypto.randomUUID();
  const dir = join(tmpDir(), `provision-${id}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const privateKeyPath = join(dir, 'id_ed25519');
  const publicKeyPath = `${privateKeyPath}.pub`;

  await execFileAsync('ssh-keygen', [
    '-t',
    'ed25519',
    '-f',
    privateKeyPath,
    '-N',
    '',
    '-C',
    'lamaste-provisioning',
  ]);

  const publicKey = await readFile(publicKeyPath, 'utf-8');

  // Create a per-session known_hosts file so SSH pins the host key
  // after the first connection (accept-new) and verifies it on
  // subsequent connections within this provisioning session.
  const knownHostsPath = join(dir, 'known_hosts');
  await writeFile(knownHostsPath, '', { mode: 0o600 });

  return {
    privateKeyPath,
    publicKeyPath,
    publicKey: publicKey.trim(),
    knownHostsPath,
    dir,
  };
}

// ---------------------------------------------------------------------------
// SSH remote execution
// ---------------------------------------------------------------------------

/**
 * Build common SSH options for all remote operations.
 *
 * Uses a per-session known_hosts file so the host key is pinned after
 * the first connection (accept-new) and verified on subsequent ones.
 * This is safer than /dev/null which discards host keys entirely.
 *
 * **Accepted risk — SSH TOFU (Trust-On-First-Use):**
 * The first SSH connection to a newly provisioned droplet accepts any
 * host key. A network-level attacker who can intercept the SSH handshake
 * to the new IP could MITM the session and steal the admin P12 credential.
 * This is accepted because: (a) the droplet was created seconds earlier,
 * (b) the IP is fresh from the cloud provider's pool, (c) DigitalOcean
 * does not expose host fingerprints via API, and (d) subsequent connections
 * within the same provisioning session verify against the pinned key.
 */
function sshOptions(knownHostsPath: string): string[] {
  return [
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'BatchMode=yes',
    '-o',
    `UserKnownHostsFile=${knownHostsPath}`,
    '-o',
    'LogLevel=ERROR',
  ];
}

export interface SshExecResult {
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Execute a command on a remote host via SSH.
 *
 * **Security note:** The `command` parameter is passed as a single string
 * to SSH, which executes it through the remote shell. It must never contain
 * user-controlled input — only hardcoded command strings are safe.
 */
export async function sshExec(
  ip: string,
  privateKeyPath: string,
  command: string,
  timeoutMs = 300_000,
  knownHostsPath?: string,
): Promise<SshExecResult> {
  const opts = sshOptions(knownHostsPath ?? '/dev/null');
  const { stdout, stderr } = await execFileAsync(
    'ssh',
    [...opts, '-i', privateKeyPath, `root@${ip}`, command],
    { timeout: timeoutMs },
  );

  return { stdout, stderr };
}

/**
 * Download a file from a remote host via SCP.
 */
export async function scpDownload(
  ip: string,
  privateKeyPath: string,
  remotePath: string,
  localPath: string,
  knownHostsPath?: string,
): Promise<void> {
  const opts = sshOptions(knownHostsPath ?? '/dev/null');
  await execFileAsync(
    'scp',
    [...opts, '-i', privateKeyPath, `root@${ip}:${remotePath}`, localPath],
    { timeout: 60_000 },
  );
}

/**
 * Wait for SSH to become reachable on the remote host.
 *
 * Retries with a fixed interval until success or timeout.
 * Default: 10s interval, 3 minutes total timeout.
 */
export async function waitForSSH(
  ip: string,
  privateKeyPath: string,
  options: { intervalMs?: number; timeoutMs?: number; knownHostsPath?: string } = {},
): Promise<void> {
  const { intervalMs = 10_000, timeoutMs = 180_000, knownHostsPath } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await sshExec(ip, privateKeyPath, 'echo ok', 15_000, knownHostsPath);
      return;
    } catch {
      if (Date.now() + intervalMs >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(`SSH not reachable on ${ip} after ${Math.round(timeoutMs / 1000)}s`);
}

// ---------------------------------------------------------------------------
// Secure file operations
// ---------------------------------------------------------------------------

/**
 * Overwrite a file with random bytes then unlink it.
 * Same pattern as create-lamaste-admin/src/upgrade.js.
 */
export async function secureDelete(filePath: string): Promise<void> {
  try {
    const info = await stat(filePath);
    const randomData = crypto.randomBytes(Math.max(info.size, 16384));
    await writeFile(filePath, randomData);
    await unlink(filePath);
  } catch {
    await unlink(filePath).catch(() => {});
  }
}

/**
 * Clean up a provisioning temporary directory.
 * Secure-deletes the private key, then removes the directory.
 */
export async function cleanupKeyPair(keyPair: SSHKeyPair): Promise<void> {
  await secureDelete(keyPair.privateKeyPath);
  await unlink(keyPair.publicKeyPath).catch(() => {});
  await rm(keyPair.dir, { recursive: true, force: true }).catch(() => {});
}
