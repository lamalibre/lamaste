/**
 * Server provisioning orchestrator.
 *
 * Extracts the provisioning workflow from serverd's onboarding route.
 * Reports progress via a callback function rather than WebSocket/SSE.
 * All dependencies are injected — no global state.
 */

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'running' | 'done' | 'error';

export interface TaskDefinition {
  readonly id: string;
  readonly title: string;
}

export interface TaskState extends TaskDefinition {
  status: TaskStatus;
  message: string | null;
  log: string | null;
}

export interface ProvisioningProgress {
  readonly task: string;
  readonly title: string;
  readonly status: TaskStatus | 'done';
  readonly message: string;
  readonly log?: string | null;
  readonly progress: { readonly current: number; readonly total: number };
  readonly result?: ProvisioningResult | undefined;
  readonly error?: string | undefined;
}

export interface ProvisioningResult {
  readonly adminUsername: string;
  adminPassword: string | null;
  readonly panelUrl: string;
  readonly authUrl: string;
}

export interface ProvisioningState {
  isRunning: boolean;
  tasks: TaskState[];
  error: { task: string; message: string } | null;
  result: ProvisioningResult | null;
}

export interface ProvisioningLogger {
  error(obj: Record<string, unknown>, msg?: string): void;
}

// ---------------------------------------------------------------------------
// Task definitions
// ---------------------------------------------------------------------------

export const TASK_DEFINITIONS: readonly TaskDefinition[] = [
  { id: 'install-chisel', title: 'Installing Chisel' },
  { id: 'install-authelia', title: 'Installing Authelia' },
  { id: 'issue-certs', title: 'Issuing TLS certificates' },
  { id: 'configure-nginx', title: 'Configuring nginx' },
  { id: 'verify-services', title: 'Verifying services' },
  { id: 'finalize', title: 'Finalizing setup' },
] as const;

// ---------------------------------------------------------------------------
// Dependency interfaces
// ---------------------------------------------------------------------------

export interface ChiselProvDeps {
  installChisel(): Promise<{ skipped?: boolean; version?: string }>;
  ensureChiselKey(): Promise<{ generated: boolean }>;
  writeChiselService(): Promise<unknown>;
  startChisel(): Promise<unknown>;
  isChiselRunning(): Promise<boolean>;
}

export interface AutoeliaProvDeps {
  installAuthelia(): Promise<{ skipped?: boolean; version?: string }>;
  writeAutheliaConfig(
    domain: string,
    secrets: { jwtSecret: string; sessionSecret: string; storageEncryptionKey: string },
  ): Promise<void>;
  createUser(username: string, password: string): Promise<void>;
  writeAutheliaService(): Promise<void>;
  startAuthelia(): Promise<void>;
  isAutheliaRunning(): Promise<boolean>;
}

export interface CertbotProvDeps {
  issueCoreCerts(domain: string, email: string): Promise<unknown>;
  setupAutoRenew(): Promise<unknown>;
}

export interface NginxProvDeps {
  writePanelVhost(domain: string): Promise<void>;
  writeAuthVhost(domain: string): Promise<void>;
  writeTunnelVhost(domain: string): Promise<void>;
  enableSite(name: string): Promise<void>;
  testConfig(): Promise<{ valid: boolean; error?: string }>;
  reload(): Promise<void>;
}

export interface InvitePageDeps {
  writeInvitePage(): Promise<void>;
}

export interface ConfigDeps {
  updateConfig(patch: Record<string, unknown>): Promise<void>;
}

export interface HealthCheckDeps {
  /** Check if a systemd service is active (e.g. nginx). */
  isServiceActive(serviceName: string): Promise<boolean>;
  /** Check panel server health endpoint. */
  checkPanelHealth(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Progress tracker
// ---------------------------------------------------------------------------

function createProgressTracker(
  tasks: TaskState[],
  onProgress: (progress: ProvisioningProgress) => void,
): (taskId: string, status: TaskStatus, message: string, log?: string | null) => void {
  return (taskId, status, message, log = null) => {
    const taskIndex = tasks.findIndex((t) => t.id === taskId);
    if (taskIndex !== -1) {
      const task = tasks[taskIndex]!;
      task.status = status;
      task.message = message;
      if (log !== null) {
        task.log = log;
      }
    }

    const doneCount = tasks.filter((t) => t.status === 'done').length;
    const current = doneCount + (status === 'running' ? 1 : 0);

    onProgress({
      task: taskId,
      title: tasks[taskIndex]?.title ?? taskId,
      status,
      message,
      log,
      progress: { current, total: TASK_DEFINITIONS.length },
    });
  };
}

// ---------------------------------------------------------------------------
// Provisioning orchestrator
// ---------------------------------------------------------------------------

export interface ProvisionServerOptions {
  domain: string;
  email: string;
  chisel: ChiselProvDeps;
  authelia: AutoeliaProvDeps;
  certbot: CertbotProvDeps;
  nginx: NginxProvDeps;
  invitePage: InvitePageDeps;
  config: ConfigDeps;
  healthCheck: HealthCheckDeps;
  logger: ProvisioningLogger;
  onProgress: (progress: ProvisioningProgress) => void;
}

/**
 * Run the full provisioning sequence.
 *
 * Returns the provisioning result on success, or throws on failure.
 * Progress is reported via the `onProgress` callback.
 *
 * The admin password is generated inside this function and included
 * in the result. Callers should clear it from memory after delivering
 * it to the user.
 */
export async function provisionServer(
  opts: ProvisionServerOptions,
): Promise<ProvisioningResult> {
  const {
    domain,
    email,
    chisel,
    authelia,
    certbot,
    nginx: nginxDeps,
    invitePage,
    config,
    healthCheck,
    logger,
    onProgress,
  } = opts;

  const tasks: TaskState[] = TASK_DEFINITIONS.map((t) => ({
    ...t,
    status: 'pending' as TaskStatus,
    message: null,
    log: null,
  }));

  const emitProgress = createProgressTracker(tasks, onProgress);

  let adminPassword: string | undefined;

  try {
    // Step 1: Install Chisel
    emitProgress('install-chisel', 'running', 'Downloading Chisel binary...');
    const chiselResult = await chisel.installChisel();
    emitProgress(
      'install-chisel',
      'running',
      'Writing systemd service...',
      chiselResult.skipped
        ? 'Chisel already installed'
        : `Installed Chisel ${chiselResult.version ?? 'unknown'}`,
    );
    await chisel.ensureChiselKey();
    await chisel.writeChiselService();
    emitProgress('install-chisel', 'running', 'Starting Chisel service...');
    await chisel.startChisel();
    emitProgress('install-chisel', 'done', 'Chisel installed and running');

    // Step 2: Install Authelia
    emitProgress('install-authelia', 'running', 'Downloading Authelia binary...');
    const autheliaResult = await authelia.installAuthelia();
    emitProgress(
      'install-authelia',
      'running',
      'Writing configuration...',
      autheliaResult.skipped
        ? 'Authelia already installed'
        : `Installed Authelia ${autheliaResult.version ?? 'unknown'}`,
    );

    const secrets = {
      jwtSecret: crypto.randomBytes(32).toString('hex'),
      sessionSecret: crypto.randomBytes(32).toString('hex'),
      storageEncryptionKey: crypto.randomBytes(32).toString('hex'),
    };
    await authelia.writeAutheliaConfig(domain, secrets);

    emitProgress('install-authelia', 'running', 'Creating admin user...');
    adminPassword = crypto.randomBytes(16).toString('base64url');
    await authelia.createUser('admin', adminPassword);

    emitProgress('install-authelia', 'running', 'Writing systemd service...');
    await authelia.writeAutheliaService();

    emitProgress('install-authelia', 'running', 'Starting Authelia service...');
    await authelia.startAuthelia();
    emitProgress('install-authelia', 'done', 'Authelia installed and running');

    // Step 3: Issue certificates
    emitProgress('issue-certs', 'running', `Issuing certificate for panel.${domain}...`);
    await certbot.issueCoreCerts(domain, email);
    emitProgress('issue-certs', 'running', 'Setting up auto-renewal...');
    await certbot.setupAutoRenew();
    emitProgress('issue-certs', 'done', 'TLS certificates issued');

    // Step 4: Configure nginx
    emitProgress('configure-nginx', 'running', 'Writing panel vhost...');
    await nginxDeps.writePanelVhost(domain);

    emitProgress('configure-nginx', 'running', 'Writing auth vhost...');
    await nginxDeps.writeAuthVhost(domain);

    emitProgress('configure-nginx', 'running', 'Writing tunnel vhost...');
    await nginxDeps.writeTunnelVhost(domain);

    emitProgress('configure-nginx', 'running', 'Writing invitation page...');
    await invitePage.writeInvitePage();

    emitProgress('configure-nginx', 'running', 'Enabling sites...');
    await nginxDeps.enableSite('lamalibre-lamaste-panel-domain');
    await nginxDeps.enableSite('lamalibre-lamaste-auth');
    await nginxDeps.enableSite('lamalibre-lamaste-tunnel');

    emitProgress('configure-nginx', 'running', 'Testing nginx configuration...');
    const testResult = await nginxDeps.testConfig();
    if (!testResult.valid) {
      throw new Error(`nginx configuration test failed: ${testResult.error ?? 'unknown error'}`);
    }

    emitProgress('configure-nginx', 'running', 'Reloading nginx...');
    await nginxDeps.reload();
    emitProgress('configure-nginx', 'done', 'nginx configured and reloaded');

    // Step 5: Verify services
    emitProgress('verify-services', 'running', 'Checking Chisel...');
    const chiselRunning = await chisel.isChiselRunning();
    if (!chiselRunning) {
      throw new Error('Chisel service is not running after provisioning');
    }

    emitProgress('verify-services', 'running', 'Checking Authelia...');
    const autheliaRunning = await authelia.isAutheliaRunning();
    if (!autheliaRunning) {
      throw new Error('Authelia service is not running after provisioning');
    }

    emitProgress('verify-services', 'running', 'Checking nginx...');
    const nginxActive = await healthCheck.isServiceActive('nginx');
    if (!nginxActive) {
      throw new Error('nginx service is not running after provisioning');
    }

    emitProgress('verify-services', 'running', 'Checking panel server...');
    const panelHealthy = await healthCheck.checkPanelHealth();
    if (!panelHealthy) {
      throw new Error('Panel server health check failed');
    }
    emitProgress('verify-services', 'done', 'All services running');

    // Step 6: Finalize
    emitProgress('finalize', 'running', 'Updating configuration...');
    await config.updateConfig({ onboarding: { status: 'COMPLETED' } });

    const result: ProvisioningResult = {
      adminUsername: 'admin',
      adminPassword,
      panelUrl: `https://panel.${domain}`,
      authUrl: `https://auth.${domain}`,
    };

    emitProgress('finalize', 'done', 'Provisioning complete');

    // Send the completion event
    onProgress({
      task: 'complete',
      title: 'Complete',
      status: 'done',
      message: 'Provisioning complete',
      result,
      progress: { current: TASK_DEFINITIONS.length, total: TASK_DEFINITIONS.length },
    });

    return result;
  } catch (err: unknown) {
    const failedTask = tasks.find((t) => t.status === 'running');
    const failedTaskId = failedTask?.id ?? 'unknown';

    if (failedTask) {
      failedTask.status = 'error';
      failedTask.message = err instanceof Error ? err.message : String(err);
    }

    onProgress({
      task: failedTaskId,
      title: failedTask?.title ?? failedTaskId,
      status: 'error',
      message: `Failed: ${failedTask?.title ?? failedTaskId}`,
      error: err instanceof Error ? err.message : String(err),
      progress: {
        current: tasks.filter((t) => t.status === 'done').length,
        total: TASK_DEFINITIONS.length,
      },
    });

    logger.error(
      { err, task: failedTaskId },
      'Provisioning failed',
    );

    throw err;
  }
}
