/**
 * Panel server updater — SSH into an existing VPS and run the
 * create-lamaste installer in redeploy mode.
 *
 * Reports progress via NDJSON on stdout so the Tauri desktop app
 * can read line-by-line and update the UI in real time.
 *
 * Reuses the same SSH key lifecycle as the provisioner:
 * generate → upload to DO → SSH → delete remote key → secure-delete local.
 */

import crypto from 'node:crypto';
import { writeFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  UpdateStep,
  UpdateStepEvent,
  UpdateProgressEvent,
  UpdateOptions,
  ServerEntry,
} from './types.js';
import { CloudError } from './errors.js';
import { DigitalOceanProvider } from './digitalocean/index.js';
import { assertValidDOToken } from './digitalocean/scopes.js';
import { generateKeyPair, waitForSSH, sshExec, cleanupKeyPair, type SSHKeyPair } from './ssh.js';
import { loadServers } from './registry.js';
import { CleanupStack } from './cleanup.js';
import { LAMASTE_DIR } from '@lamalibre/lamaste/agent';

// ---------------------------------------------------------------------------
// NDJSON helpers
// ---------------------------------------------------------------------------

function emit(event: UpdateProgressEvent): void {
  process.stdout.write(JSON.stringify(event) + '\n');
}

function emitStep(
  step: UpdateStep,
  status: 'running' | 'done' | 'failed',
  data?: Record<string, unknown> | undefined,
): void {
  const ev: UpdateStepEvent = data
    ? { event: 'step', step, status, data }
    : { event: 'step', step, status };
  emit(ev);
}

function emitError(step: UpdateStep, message: string, recoverable: boolean): void {
  emit({ event: 'error', step, message, recoverable });
}

// ---------------------------------------------------------------------------
// File lock (shared path with provisioner — only one operation at a time)
// ---------------------------------------------------------------------------

const LOCK_PATH = join(LAMASTE_DIR, '.provisioning.lock');

async function acquireLock(): Promise<void> {
  await mkdir(LAMASTE_DIR, { recursive: true, mode: 0o700 });

  try {
    await writeFile(LOCK_PATH, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // Check if the lock holder is still running
      try {
        const lockContent = await readFile(LOCK_PATH, 'utf-8');
        const pid = parseInt(lockContent.trim(), 10);
        if (!isNaN(pid) && pid !== process.pid) {
          try {
            process.kill(pid, 0);
          } catch {
            // Process is dead — steal the lock
            try {
              await unlink(LOCK_PATH);
              await writeFile(LOCK_PATH, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
              return;
            } catch {
              // Another process beat us to it
            }
          }
        }
      } catch {
        // Could not read lock file, fall through to error
      }
      throw new CloudError(
        'Another provisioning or update operation is in progress. ' +
          `If this is an error, delete ${LOCK_PATH}`,
      );
    }
    throw err;
  }
}

async function releaseLock(): Promise<void> {
  await unlink(LOCK_PATH).catch(() => {});
}

// ---------------------------------------------------------------------------
// Update flow
// ---------------------------------------------------------------------------

/**
 * Run the panel server update flow.
 *
 * SSHes into the server and runs `npx @lamalibre/create-lamaste@<version>`
 * which triggers the redeploy path (stops panel, updates code, restarts).
 *
 * @param options - Update options including token, serverId, and target version
 * @returns The version string reported by the panel after update
 */
export async function update(options: UpdateOptions): Promise<string> {
  const { token, serverId, version } = options;

  await acquireLock();
  const cleanup = new CleanupStack();
  let sshKeyPair: SSHKeyPair | null = null;
  let currentStep: UpdateStep = 'generate_ssh_key';

  try {
    // Load server from registry
    const servers = await loadServers();
    const server = servers.find((s: ServerEntry) => s.id === serverId);
    if (!server) {
      throw new CloudError(`Server not found: ${serverId}`);
    }

    const ip = server.ip;
    if (!ip) {
      throw new CloudError('Server has no IP address');
    }

    const provider = new DigitalOceanProvider(token);

    // Validate token before proceeding
    await assertValidDOToken(token);

    // Step 1: Generate SSH keypair
    currentStep = 'generate_ssh_key';
    emitStep('generate_ssh_key', 'running');
    sshKeyPair = await generateKeyPair();
    cleanup.push('delete local SSH key', () => cleanupKeyPair(sshKeyPair!));
    emitStep('generate_ssh_key', 'done');

    // Step 2: Upload SSH key to provider
    currentStep = 'upload_ssh_key';
    emitStep('upload_ssh_key', 'running');
    const keyName = `lamalibre-lamaste-update-${crypto.randomBytes(4).toString('hex')}`;
    const sshKey = await provider.createSSHKey(keyName, sshKeyPair.publicKey);
    cleanup.push('delete remote SSH key', () => provider.deleteSSHKey(sshKey.id));
    emitStep('upload_ssh_key', 'done');

    // Step 3: Wait for SSH
    currentStep = 'wait_ssh';
    emitStep('wait_ssh', 'running');
    const { knownHostsPath } = sshKeyPair;
    await waitForSSH(ip, sshKeyPair.privateKeyPath, { knownHostsPath });
    emitStep('wait_ssh', 'done');

    // Step 4: Run the update via create-lamaste in redeploy mode
    currentStep = 'update_panel';
    emitStep('update_panel', 'running');
    await sshExec(
      ip,
      sshKeyPair.privateKeyPath,
      `npx --yes @lamalibre/create-lamaste@${version} --json --yes`,
      600_000, // 10 minute timeout
      knownHostsPath,
    );
    emitStep('update_panel', 'done');

    // Step 5: Verify panel is healthy after restart
    currentStep = 'verify_health';
    emitStep('verify_health', 'running');

    let healthVersion = version;
    const maxRetries = 10;
    const retryDelay = 3_000;
    let healthy = false;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const { stdout } = await sshExec(
          ip,
          sshKeyPair.privateKeyPath,
          'curl -sf http://127.0.0.1:3100/api/health',
          15_000,
          knownHostsPath,
        );
        const parsed: unknown = JSON.parse(stdout.trim());
        if (parsed && typeof parsed === 'object' && 'status' in parsed) {
          const health = parsed as { status: string; version?: string };
          if (health.status === 'ok') {
            healthy = true;
            if (health.version) {
              healthVersion = health.version;
            }
            break;
          }
        }
      } catch {
        // Service may still be restarting
      }
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }

    if (!healthy) {
      throw new CloudError('Panel server did not become healthy after update');
    }
    emitStep('verify_health', 'done');

    // Step 6: Cleanup SSH resources
    currentStep = 'cleanup';
    emitStep('cleanup', 'running');
    try {
      await provider.deleteSSHKey(sshKey.id);
    } catch {
      // Best-effort
    }
    await cleanupKeyPair(sshKeyPair);
    sshKeyPair = null;
    cleanup.clear();
    emitStep('cleanup', 'done');

    emit({ event: 'complete', version: healthVersion });
    return healthVersion;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Run cleanup stack
    const cleanupResult = await cleanup.runAll();

    // Also clean up SSH key pair if still around
    if (sshKeyPair) {
      await cleanupKeyPair(sshKeyPair).catch(() => {});
    }

    if (!cleanupResult.ok) {
      emit({ event: 'cleanup-failed', resources: cleanupResult.failures });
    }

    emitError(currentStep, message, cleanupResult.ok);
    throw err;
  } finally {
    await releaseLock();
  }
}
