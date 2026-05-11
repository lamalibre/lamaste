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
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { CloudProvider } from './provider.js';
import type { ProvisionOptions, ProvisionStep, ProgressEvent, ServerEntry } from './types.js';
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
import { CleanupStack } from './cleanup.js';
import { LAMASTE_DIR, serverDataDir, tmpDir } from '@lamalibre/lamaste/agent';

const execFileAsync = promisify(execFile);

// Read the create-lamaste version from its package.json so we can
// pin provisioning to the exact version instead of @latest.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let installerVersion = 'latest';
{
  // Works in both src/ (dev) and dist/ (compiled): both live at
  // packages/sdks/cloud/{src,dist}, so up three levels reaches packages/.
  const pkgPath = join(__dirname, '..', '..', '..', 'provisioners', 'server', 'package.json');
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    if (typeof pkg.version === 'string' && pkg.version.length > 0) {
      installerVersion = pkg.version;
    } else {
      throw new Error('package.json missing version field');
    }
  } catch (err) {
    // Standalone install (e.g. npm i -g @lamalibre/lamaste-cloud) cannot
    // resolve the workspace path. Surface the fallback loudly so the operator
    // knows they are pinning to @latest rather than failing silently.
    process.stderr.write(
      `[lamaste-cloud] WARNING: could not read create-lamaste version (${(err as Error).message}); ` +
        `falling back to '@latest'. Pass an explicit version in code paths that ship to users.\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// Input validation (defense in depth — UI also validates, but CLI bypasses UI)
// ---------------------------------------------------------------------------

const FQDN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

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

function emitStep(
  step: ProvisionStep,
  status: 'running' | 'done',
  data?: Record<string, unknown>,
): void {
  emit({ event: 'step', step, status, ...(data ? { data } : {}) });
}

function emitError(step: ProvisionStep, message: string, recoverable: boolean): void {
  emit({ event: 'error', step, message, recoverable });
}

// ---------------------------------------------------------------------------
// File lock
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

// ---------------------------------------------------------------------------
// Remote onboarding helper — completes the full onboarding flow via SSH
// ---------------------------------------------------------------------------

/**
 * Run a curl command on the remote server via SSH and return the HTTP status + body.
 *
 * Uses curl's -w flag to append the HTTP status code as the last line of output.
 * Does NOT throw on HTTP errors — caller checks the status.
 */
async function sshCurl(
  ip: string,
  keyPath: string,
  knownHostsPath: string,
  method: string,
  path: string,
  body?: string,
  timeoutMs = 30_000,
): Promise<{ status: string; body: string }> {
  // Use nginx (port 9292) with the admin P12 cert for mTLS.
  // The P12 and its password are on the server filesystem from the installer.
  //
  // Security: the P12 password MUST NOT appear in the curl argv on the remote
  // host (it would be visible in `ps`). We write it into a curl config file
  // (mode 0600) on the remote and pass it via `-K`. The config file is removed
  // by a `trap ... EXIT` regardless of success or failure.
  //
  // The password is read from /etc/lamalibre/lamaste/pki/.p12-password (root-readable
  // file already on the box) into the config file via output redirection;
  // it is never substituted into an exec'd argv.
  const url = `https://127.0.0.1:9292${path}`;
  const buildBase = (extra = '') =>
    `TMP=$(mktemp -t lamaste-curl-XXXXXX) || exit 1; ` +
    `chmod 600 "$TMP"; ` +
    `trap 'rm -f "$TMP"' EXIT HUP INT TERM; ` +
    `printf 'cert-type=P12\\ncert=/etc/lamalibre/lamaste/pki/client.p12:%s\\n' ` +
    `"$(cat /etc/lamalibre/lamaste/pki/.p12-password)" > "$TMP"; ` +
    `${extra}` +
    `curl -sS --max-time 15 -k -K "$TMP" -w '\\n%{http_code}' -X ${method} `;

  let cmd: string;
  if (body) {
    const b64 = Buffer.from(body).toString('base64');
    // The body is base64-encoded and decoded on the remote shell; the body
    // bytes are then piped to curl on stdin via `-d @-`.
    cmd =
      buildBase(`echo ${b64} | base64 -d | `) + `-H 'Content-Type: application/json' -d @- ${url}`;
  } else {
    cmd = buildBase() + url;
  }

  const { stdout } = await sshExec(ip, keyPath, cmd, timeoutMs, knownHostsPath);
  const lines = stdout.trimEnd().split('\n');
  const httpStatus = lines.pop() ?? '';
  return { status: httpStatus, body: lines.join('\n') };
}

/**
 * Complete the full onboarding flow (domain → DNS verify → provision) via SSH.
 *
 * For cloud-provisioned servers with DNS records already created, this avoids
 * requiring the user to open the browser panel for onboarding.
 */
async function completeOnboarding(
  ip: string,
  keyPath: string,
  knownHostsPath: string,
  domain: string,
  email: string,
): Promise<void> {
  // Step 1: Set domain (FRESH → DOMAIN_SET)
  const domainPayload = JSON.stringify({ domain, email });
  const domainResult = await sshCurl(
    ip,
    keyPath,
    knownHostsPath,
    'POST',
    '/api/onboarding/domain',
    domainPayload,
  );
  if (!domainResult.status.startsWith('2')) {
    throw new Error(`Domain setup returned HTTP ${domainResult.status}: ${domainResult.body}`);
  }

  // Step 2: Verify DNS — retry for up to 60 seconds (records may still be propagating)
  const dnsDeadline = Date.now() + 60_000;
  let dnsOk = false;
  while (Date.now() < dnsDeadline) {
    const dnsResult = await sshCurl(
      ip,
      keyPath,
      knownHostsPath,
      'POST',
      '/api/onboarding/verify-dns',
    );
    if (dnsResult.status.startsWith('2')) {
      try {
        const parsed = JSON.parse(dnsResult.body);
        if (parsed.ok) {
          dnsOk = true;
          break;
        }
      } catch {
        /* ignore parse errors */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  if (!dnsOk) {
    throw new Error('DNS verification timed out — records may not have propagated yet');
  }

  // Step 3: Trigger provisioning (DNS_READY → PROVISIONING → COMPLETED)
  const provisionResult = await sshCurl(
    ip,
    keyPath,
    knownHostsPath,
    'POST',
    '/api/onboarding/provision',
  );
  if (!provisionResult.status.startsWith('2')) {
    throw new Error(
      `Server provisioning returned HTTP ${provisionResult.status}: ${provisionResult.body}`,
    );
  }

  // Step 4: Wait for provisioning to complete (runs in background on the server)
  const provDeadline = Date.now() + 300_000; // 5 minutes
  while (Date.now() < provDeadline) {
    const statusResult = await sshCurl(
      ip,
      keyPath,
      knownHostsPath,
      'GET',
      '/api/onboarding/status',
    );
    if (statusResult.status.startsWith('2')) {
      try {
        const parsed = JSON.parse(statusResult.body);
        if (parsed.status === 'COMPLETED') return;
        if (parsed.error) {
          throw new Error(`Server provisioning failed: ${parsed.error}`);
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.message.startsWith('Server provisioning failed')) throw e;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error('Server provisioning timed out after 5 minutes');
}

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
    const keyName = `lamaste-provision-${crypto.randomBytes(4).toString('hex')}`;
    const sshKey = await provider.createSSHKey(keyName, sshKeyPair.publicKey);
    cleanup.push('delete remote SSH key', () => provider.deleteSSHKey(sshKey.id));
    emitStep('upload_ssh_key', 'done', { keyId: sshKey.id });

    // Step 4: Create droplet
    currentStep = 'create_droplet';
    emitStep('create_droplet', 'running');
    const dropletName = `lamaste-${label}`;
    // The provider's createServer applies the required Lamalibre management
    // tags (`lamalibre:managed`, `product:lamaste`) automatically — we
    // pass an empty extras list here so the droplet stays minimally tagged.
    const server = await provider.createServer({
      region,
      sshKeyId: sshKey.id,
      name: dropletName,
      size: options.size,
      tags: [],
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
          options.overrideDns ?? false,
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
        // DNS setup is non-fatal — log warning and continue.
        // Still compute the effective domain so onboarding can proceed.
        const msg = err instanceof Error ? err.message : String(err);
        emitStep('setup_dns', 'done', {
          warning: `DNS setup failed: ${msg}. You can configure DNS manually after provisioning.`,
        });
        if (!effectiveDomain && options.doDomain) {
          effectiveDomain = options.doSubdomain
            ? `${options.doSubdomain}.${options.doDomain}`
            : options.doDomain;
        }
      }
    }

    // Step 6: Wait for SSH
    currentStep = 'wait_ssh';
    emitStep('wait_ssh', 'running');
    const { knownHostsPath } = sshKeyPair;
    await waitForSSH(ip, sshKeyPair.privateKeyPath, { knownHostsPath });
    emitStep('wait_ssh', 'done');

    // Step 7: Install Node.js and Lamaste
    currentStep = 'install_lamaste';
    emitStep('install_lamaste', 'running');

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

    // Run the Lamaste installer
    await sshExec(
      ip,
      sshKeyPair.privateKeyPath,
      `npx --yes @lamalibre/create-lamaste@${installerVersion} --yes`,
      600_000, // 10 minute timeout for installation
      knownHostsPath,
    );
    emitStep('install_lamaste', 'done');

    // Step 8: Retrieve credentials
    currentStep = 'retrieve_credentials';
    emitStep('retrieve_credentials', 'running');
    const credsTmpDir = join(tmpDir(), `creds-${crypto.randomUUID()}`);
    await mkdir(credsTmpDir, { recursive: true, mode: 0o700 });

    // Read P12 password
    const { stdout: p12Password } = await sshExec(
      ip,
      sshKeyPair.privateKeyPath,
      'cat /etc/lamalibre/lamaste/pki/.p12-password',
      300_000,
      knownHostsPath,
    );

    // Download P12 certificate
    const localP12Path = join(credsTmpDir, 'client.p12');
    await scpDownload(
      ip,
      sshKeyPair.privateKeyPath,
      '/etc/lamalibre/lamaste/pki/client.p12',
      localP12Path,
      knownHostsPath,
    );
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
    //
    // This step is non-fatal: domain can always be set later through the
    // browser onboarding UI, so a failure here should not abort provisioning.
    const onboardDomain = effectiveDomain ?? options.domain;
    if (onboardDomain && options.email) {
      try {
        await completeOnboarding(
          ip,
          sshKeyPair.privateKeyPath,
          knownHostsPath,
          onboardDomain,
          options.email,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        emitStep('enroll_admin', 'running', {
          warning: `Onboarding failed: ${msg}. Complete it through the browser panel.`,
        });
      }
    } else if (options.doDomain) {
      // DO DNS was selected but effectiveDomain is empty — DNS setup must have failed.
      // This means the onboarding can't proceed automatically.
      emitStep('enroll_admin', 'running', {
        warning: `DNS setup did not produce a domain. Complete onboarding through the browser panel.`,
      });
    }

    // Store the P12 certificate locally.
    // Hardware-bound Keychain upgrade can be done later after onboarding
    // via the admin panel (requires onboarding complete).
    const serverDir = serverDataDir(serverId);
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
      domain: onboardDomain,
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
    await rm(credsTmpDir, { recursive: true, force: true }).catch(() => {});
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
