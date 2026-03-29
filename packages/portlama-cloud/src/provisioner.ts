/**
 * Server provisioner — orchestrates the full create-server flow.
 *
 * Reports progress via NDJSON on stdout so the Tauri desktop app
 * can read line-by-line and update the UI in real time.
 *
 * Maintains a cleanup stack so partially-created resources are
 * rolled back on failure.
 */

import crypto from 'node:crypto';
import { writeFile, mkdir, readFile, unlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { CloudProvider } from './provider.js';
import type {
  ProvisionOptions,
  ProvisionStep,
  ProgressEvent,
  ServerEntry,
} from './types.js';
import { CloudError } from './errors.js';
import { DigitalOceanProvider } from './digitalocean/index.js';
import { assertValidDOToken } from './digitalocean/scopes.js';
import {
  generateKeyPair,
  waitForSSH,
  sshExec,
  scpDownload,
  secureDelete,
  cleanupKeyPair,
  type SSHKeyPair,
} from './ssh.js';
import { addServer } from './registry.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Input validation (defense in depth — UI also validates, but CLI bypasses UI)
// ---------------------------------------------------------------------------

const FQDN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateProvisionInputs(options: ProvisionOptions): void {
  if (options.domain && !FQDN_REGEX.test(options.domain)) {
    throw new CloudError(`Invalid domain: ${options.domain}`);
  }
  if (options.email && !EMAIL_REGEX.test(options.email)) {
    throw new CloudError(`Invalid email: ${options.email}`);
  }
  if (options.doDomain && !FQDN_REGEX.test(options.doDomain)) {
    throw new CloudError(`Invalid DO domain: ${options.doDomain}`);
  }
  if (options.doSubdomain && !SUBDOMAIN_REGEX.test(options.doSubdomain)) {
    throw new CloudError(`Invalid subdomain: ${options.doSubdomain}`);
  }
}

// ---------------------------------------------------------------------------
// Progress reporting
// ---------------------------------------------------------------------------

function emit(event: ProgressEvent): void {
  process.stdout.write(JSON.stringify(event) + '\n');
}

function emitStep(step: ProvisionStep, status: 'running' | 'done', data?: Record<string, unknown>): void {
  emit({ event: 'step', step, status, ...(data ? { data } : {}) });
}

function emitError(step: ProvisionStep, message: string, recoverable: boolean): void {
  emit({ event: 'error', step, message, recoverable });
}

// ---------------------------------------------------------------------------
// Cleanup stack
// ---------------------------------------------------------------------------

type CleanupAction = () => Promise<void>;

class CleanupStack {
  readonly actions: Array<{ label: string; fn: CleanupAction }> = [];

  push(label: string, fn: CleanupAction): void {
    this.actions.push({ label, fn });
  }

  clear(): void {
    this.actions.length = 0;
  }

  async runAll(): Promise<boolean> {
    let allSucceeded = true;
    // Run in reverse order
    for (let i = this.actions.length - 1; i >= 0; i--) {
      try {
        await this.actions[i]!.fn();
      } catch {
        allSucceeded = false;
      }
    }
    return allSucceeded;
  }
}

// ---------------------------------------------------------------------------
// File lock
// ---------------------------------------------------------------------------

const LOCK_PATH = join(homedir(), '.portlama', '.provisioning.lock');

async function acquireLock(): Promise<void> {
  const dir = join(homedir(), '.portlama');
  await mkdir(dir, { recursive: true, mode: 0o700 });

  try {
    await writeFile(LOCK_PATH, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // Check if the lock holder is still running
      try {
        const lockContent = await readFile(LOCK_PATH, 'utf-8');
        const lockedPid = parseInt(lockContent.trim(), 10);
        if (!isNaN(lockedPid)) {
          try {
            // Signal 0 checks if process exists without sending a signal
            process.kill(lockedPid, 0);
            // Process is still running — lock is valid
          } catch {
            // Process is gone — stale lock. Remove and retry once.
            await unlink(LOCK_PATH).catch(() => {});
            try {
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
        'Another provisioning operation is in progress. ' +
          'If this is an error, delete ~/.portlama/.provisioning.lock',
      );
    }
    throw err;
  }
}

async function releaseLock(): Promise<void> {
  await unlink(LOCK_PATH).catch(() => {});
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

function createProvider(name: string, token: string): CloudProvider {
  switch (name) {
    case 'digitalocean':
      return new DigitalOceanProvider(token);
    default:
      throw new CloudError(`Unsupported provider: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Provisioner
// ---------------------------------------------------------------------------

/**
 * Run the full server provisioning flow.
 *
 * This is designed to be called from a CLI entry point. It writes
 * NDJSON progress events to stdout and throws on unrecoverable errors.
 */
export async function provision(options: ProvisionOptions): Promise<ServerEntry> {
  const { provider: providerName, token, region, label, platform } = options;

  validateProvisionInputs(options);
  await acquireLock();
  const cleanup = new CleanupStack();
  let sshKeyPair: SSHKeyPair | null = null;
  let currentStep: ProvisionStep = 'validate_token';

  try {
    // Step 1: Validate token
    currentStep = 'validate_token';
    emitStep('validate_token', 'running');
    if (providerName === 'digitalocean') {
      await assertValidDOToken(token);
    }
    const provider = createProvider(providerName, token);
    emitStep('validate_token', 'done');

    // Step 2: Generate SSH keypair
    currentStep = 'generate_ssh_key';
    emitStep('generate_ssh_key', 'running');
    sshKeyPair = await generateKeyPair();
    cleanup.push('delete local SSH key', () => cleanupKeyPair(sshKeyPair!));
    emitStep('generate_ssh_key', 'done');

    // Step 3: Upload SSH key to provider
    currentStep = 'upload_ssh_key';
    emitStep('upload_ssh_key', 'running');
    const keyName = `portlama-provision-${crypto.randomBytes(4).toString('hex')}`;
    const sshKey = await provider.createSSHKey(keyName, sshKeyPair.publicKey);
    cleanup.push('delete remote SSH key', () => provider.deleteSSHKey(sshKey.id));
    emitStep('upload_ssh_key', 'done', { keyId: sshKey.id });

    // Step 4: Create droplet
    currentStep = 'create_droplet';
    emitStep('create_droplet', 'running');
    const dropletName = `portlama-${label}`;
    const server = await provider.createServer({
      region,
      sshKeyId: sshKey.id,
      name: dropletName,
      size: options.size,
      tags: ['portlama:managed'],
    });
    cleanup.push('destroy droplet', () => provider.destroyServer(server.id));
    emitStep('create_droplet', 'done', { dropletId: server.id });

    // Step 5: Wait for droplet to become active with a public IP
    currentStep = 'wait_droplet';
    emitStep('wait_droplet', 'running');
    let activeServer = server;
    const pollDeadline = Date.now() + 5 * 60 * 1000; // 5 minutes
    while (activeServer.status !== 'active' || !activeServer.ip) {
      if (Date.now() >= pollDeadline) {
        throw new CloudError('Droplet did not become active within 5 minutes');
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      activeServer = await provider.getServer(server.id);
    }
    const ip = activeServer.ip;
    emitStep('wait_droplet', 'done', { ip });

    // Step 5b: Set up DNS records (only if DO-managed domain was selected)
    let effectiveDomain = options.domain;
    if (options.doDomain && provider instanceof DigitalOceanProvider) {
      currentStep = 'setup_dns';
      emitStep('setup_dns', 'running');
      try {
        const dnsResult = await provider.setupDnsRecords(
          options.doDomain,
          options.doSubdomain,
          ip,
        );

        // Register cleanup for created DNS records (prevents dangling DNS on failure)
        if (dnsResult.createdRecordIds.length > 0) {
          const doDomain = options.doDomain;
          cleanup.push('delete DNS records', async () => {
            const { deleteDomainRecord } = await import('./digitalocean/dns.js');
            for (const recordId of dnsResult.createdRecordIds) {
              try {
                await deleteDomainRecord(token, doDomain, recordId);
              } catch {
                // Best-effort — orphaned DNS records are harmless
              }
            }
          });
        }

        const stepData: Record<string, unknown> = {
          domain: dnsResult.domain,
          aRecordCreated: dnsResult.aRecordCreated,
          wildcardCreated: dnsResult.wildcardCreated,
        };
        if (dnsResult.conflictWarning) {
          stepData.conflictWarning = dnsResult.conflictWarning;
        }
        emitStep('setup_dns', 'done', stepData);

        // Use the composed FQDN as the effective domain for onboarding
        if (!effectiveDomain) {
          effectiveDomain = dnsResult.domain;
        }
      } catch (err: unknown) {
        // DNS setup is non-fatal — log warning and continue
        const msg = err instanceof Error ? err.message : String(err);
        emitStep('setup_dns', 'done', {
          warning: `DNS setup failed: ${msg}. You can configure DNS manually after provisioning.`,
        });
      }
    }

    // Step 6: Wait for SSH
    currentStep = 'wait_ssh';
    emitStep('wait_ssh', 'running');
    const { knownHostsPath } = sshKeyPair;
    await waitForSSH(ip, sshKeyPair.privateKeyPath, { knownHostsPath });
    emitStep('wait_ssh', 'done');

    // Step 7: Install Node.js and Portlama
    currentStep = 'install_portlama';
    emitStep('install_portlama', 'running');

    // Wait for cloud-init to finish — it holds apt locks on a fresh droplet
    await sshExec(
      ip,
      sshKeyPair.privateKeyPath,
      'cloud-init status --wait',
      300_000, // 5 minute timeout
      knownHostsPath,
    );

    // Install npm (Ubuntu 24.04 does not ship with Node.js/npm)
    await sshExec(
      ip,
      sshKeyPair.privateKeyPath,
      'apt-get update && apt-get install -y npm',
      300_000, // 5 minute timeout
      knownHostsPath,
    );

    // Run the Portlama installer
    await sshExec(
      ip,
      sshKeyPair.privateKeyPath,
      'npx --yes @lamalibre/create-portlama@latest --yes',
      600_000, // 10 minute timeout for installation
      knownHostsPath,
    );
    emitStep('install_portlama', 'done');

    // Step 8: Retrieve credentials
    currentStep = 'retrieve_credentials';
    emitStep('retrieve_credentials', 'running');
    const tmpDir = join(homedir(), '.portlama', 'tmp', `creds-${crypto.randomUUID()}`);
    await mkdir(tmpDir, { recursive: true, mode: 0o700 });

    // Read P12 password
    const { stdout: p12Password } = await sshExec(
      ip,
      sshKeyPair.privateKeyPath,
      'cat /etc/portlama/pki/.p12-password',
      300_000,
      knownHostsPath,
    );

    // Download P12 certificate
    const localP12Path = join(tmpDir, 'client.p12');
    await scpDownload(ip, sshKeyPair.privateKeyPath, '/etc/portlama/pki/client.p12', localP12Path, knownHostsPath);
    emitStep('retrieve_credentials', 'done');

    // Step 9: Enroll admin cert
    currentStep = 'enroll_admin';
    emitStep('enroll_admin', 'running');
    const serverId = crypto.randomUUID();
    let authMethod: 'p12' | 'keychain' = 'p12';
    let keychainIdentity: string | undefined;
    let finalP12Path: string | undefined;
    let finalP12Password: string | undefined;

    // Wait for the panel to be reachable before attempting enrollment.
    // nginx requires mTLS for /api/ routes, so check health via SSH
    // against the local Node.js port (bypasses nginx).
    const healthDeadline = Date.now() + 120_000; // 2 minutes
    while (Date.now() < healthDeadline) {
      try {
        await sshExec(
          ip,
          sshKeyPair.privateKeyPath,
          'curl -s -f --max-time 5 http://127.0.0.1:3100/api/health',
          15_000,
          knownHostsPath,
        );
        break;
      } catch {
        if (Date.now() + 5_000 >= healthDeadline) {
          throw new Error(`Panel not reachable on server after 2 minutes`);
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }

    // If domain and email were provided, start onboarding (set domain).
    // The payload is base64-encoded to avoid shell injection — sshExec
    // passes the command through a remote shell, so user-controlled values
    // must never be interpolated directly into the command string.
    const onboardDomain = effectiveDomain ?? options.domain;
    if (onboardDomain && options.email) {
      const onboardPayload = JSON.stringify({
        domain: onboardDomain,
        email: options.email,
      });
      const b64 = Buffer.from(onboardPayload).toString('base64');
      await sshExec(
        ip,
        sshKeyPair.privateKeyPath,
        `echo ${b64} | base64 -d | curl -s -f --max-time 15 -X POST -H 'Content-Type: application/json' -d @- http://127.0.0.1:3100/api/onboarding/domain`,
        30_000,
        knownHostsPath,
      );
    }

    // Store the P12 certificate locally.
    // Hardware-bound Keychain upgrade can be done later after onboarding
    // via the admin panel (requires onboarding complete).
    const serverDir = join(homedir(), '.portlama', 'servers', serverId);
    await mkdir(serverDir, { recursive: true, mode: 0o700 });
    const destP12 = join(serverDir, 'client.p12');
    const raw = await readFile(localP12Path);
    await writeFile(destP12, raw, { mode: 0o600 });

    authMethod = 'p12';
    finalP12Path = destP12;
    finalP12Password = p12Password.trim();
    emitStep('enroll_admin', 'done');

    // Step 10: Save registry
    currentStep = 'save_registry';
    emitStep('save_registry', 'running');
    const panelUrl = `https://${ip}:9292`;
    const entry: ServerEntry = {
      id: serverId,
      label,
      panelUrl,
      ip,
      provider: providerName,
      providerId: server.id,
      region,
      createdAt: new Date().toISOString(),
      active: true,
      authMethod,
      keychainIdentity,
      p12Path: finalP12Path,
      p12Password: finalP12Password,
    };
    await addServer(entry);
    emitStep('save_registry', 'done');

    // Step 11: Cleanup
    currentStep = 'cleanup';
    emitStep('cleanup', 'running');
    // Delete SSH key from provider
    try {
      await provider.deleteSSHKey(sshKey.id);
    } catch {
      // Best-effort — orphaned SSH keys are harmless
    }
    // Secure-delete local SSH key
    await cleanupKeyPair(sshKeyPair);
    sshKeyPair = null;
    // Clean up temp P12
    await secureDelete(localP12Path);
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    // Remove cleanup stack entries that we already handled
    cleanup.clear();
    emitStep('cleanup', 'done');

    // Done — redact p12Password before emitting to stdout
    const { p12Password: _redacted, ...redactedEntry } = entry;
    emit({ event: 'complete', server: redactedEntry as ServerEntry });
    return entry;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Run cleanup stack
    const cleanupOk = await cleanup.runAll();

    // Also clean up SSH key pair if still around
    if (sshKeyPair) {
      await cleanupKeyPair(sshKeyPair).catch(() => {});
    }

    emitError(currentStep, message, cleanupOk);
    throw err;
  } finally {
    await releaseLock();
  }
}
