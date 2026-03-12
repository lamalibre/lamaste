import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { execa } from 'execa';
import { getConfig, updateConfig } from '../../lib/config.js';
import * as chisel from '../../lib/chisel.js';
import * as authelia from '../../lib/authelia.js';
import * as certbot from '../../lib/certbot.js';
import * as nginx from '../../lib/nginx.js';
import { writeInvitePage } from '../../lib/invite-page.js';

// Module-level state for provisioning
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

const TASK_DEFINITIONS = [
  { id: 'install-chisel', title: 'Installing Chisel' },
  { id: 'install-authelia', title: 'Installing Authelia' },
  { id: 'issue-certs', title: 'Issuing TLS certificates' },
  { id: 'configure-nginx', title: 'Configuring nginx' },
  { id: 'verify-services', title: 'Verifying services' },
  { id: 'finalize', title: 'Finalizing setup' },
];

let provisioningState = {
  isRunning: false,
  tasks: TASK_DEFINITIONS.map((t) => ({ ...t, status: 'pending', message: null, log: null })),
  error: null,
  result: null,
};

/**
 * Reset provisioning state for a fresh run.
 */
function resetState() {
  provisioningState = {
    isRunning: true,
    tasks: TASK_DEFINITIONS.map((t) => ({ ...t, status: 'pending', message: null, log: null })),
    error: null,
    result: null,
  };
}

/**
 * Emit a progress event and update the provisioning state.
 */
function emitProgress(taskId, status, message, log = null) {
  const taskIndex = provisioningState.tasks.findIndex((t) => t.id === taskId);
  if (taskIndex !== -1) {
    provisioningState.tasks[taskIndex].status = status;
    provisioningState.tasks[taskIndex].message = message;
    if (log !== null) {
      provisioningState.tasks[taskIndex].log = log;
    }
  }

  const current = provisioningState.tasks.filter((t) => t.status === 'done').length +
    (status === 'running' ? 1 : 0);

  const payload = {
    task: taskId,
    title: provisioningState.tasks[taskIndex]?.title || taskId,
    status,
    message,
    log,
    progress: { current, total: TASK_DEFINITIONS.length },
  };

  emitter.emit('progress', payload);
}

/**
 * Run the full provisioning sequence.
 */
async function runProvisioning(log) {
  const config = getConfig();
  const { domain, email } = config;

  let adminPassword;

  try {
    // Step 1: Install Chisel
    emitProgress('install-chisel', 'running', 'Downloading Chisel binary...');
    const chiselResult = await chisel.installChisel();
    emitProgress('install-chisel', 'running', 'Writing systemd service...', chiselResult.skipped ? 'Chisel already installed' : `Installed Chisel ${chiselResult.version}`);
    await chisel.writeChiselService();
    emitProgress('install-chisel', 'running', 'Starting Chisel service...');
    await chisel.startChisel();
    emitProgress('install-chisel', 'done', 'Chisel installed and running');

    // Step 2: Install Authelia
    emitProgress('install-authelia', 'running', 'Downloading Authelia binary...');
    const autheliaResult = await authelia.installAuthelia();
    emitProgress('install-authelia', 'running', 'Writing configuration...', autheliaResult.skipped ? 'Authelia already installed' : `Installed Authelia ${autheliaResult.version}`);

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
    await nginx.writePanelVhost(domain);

    emitProgress('configure-nginx', 'running', 'Writing auth vhost...');
    await nginx.writeAuthVhost(domain);

    emitProgress('configure-nginx', 'running', 'Writing tunnel vhost...');
    await nginx.writeTunnelVhost(domain);

    emitProgress('configure-nginx', 'running', 'Writing invitation page...');
    await writeInvitePage();

    emitProgress('configure-nginx', 'running', 'Enabling sites...');
    await nginx.enableSite('portlama-panel-domain');
    await nginx.enableSite('portlama-auth');
    await nginx.enableSite('portlama-tunnel');

    emitProgress('configure-nginx', 'running', 'Testing nginx configuration...');
    const testResult = await nginx.testConfig();
    if (!testResult.valid) {
      throw new Error(`nginx configuration test failed: ${testResult.error}`);
    }

    emitProgress('configure-nginx', 'running', 'Reloading nginx...');
    await nginx.reload();
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
    try {
      const { stdout } = await execa('systemctl', ['is-active', 'nginx']);
      if (stdout.trim() !== 'active') {
        throw new Error('nginx is not active');
      }
    } catch {
      throw new Error('nginx service is not running after provisioning');
    }

    emitProgress('verify-services', 'running', 'Checking panel server...');
    try {
      const { stdout } = await execa('curl', ['-s', 'http://127.0.0.1:3100/api/health']);
      const health = JSON.parse(stdout);
      if (health.status !== 'ok') {
        throw new Error('Panel server health check returned unexpected status');
      }
    } catch (err) {
      throw new Error(`Panel server health check failed: ${err.message}`);
    }
    emitProgress('verify-services', 'done', 'All services running');

    // Step 6: Finalize
    emitProgress('finalize', 'running', 'Updating configuration...');
    await updateConfig({ onboarding: { status: 'COMPLETED' } });

    const result = {
      adminUsername: 'admin',
      adminPassword,
      panelUrl: `https://panel.${domain}`,
      authUrl: `https://auth.${domain}`,
    };

    provisioningState.result = result;
    provisioningState.isRunning = false;
    emitProgress('finalize', 'done', 'Provisioning complete');

    // Send the completion event
    emitter.emit('progress', {
      task: 'complete',
      status: 'done',
      message: 'Provisioning complete',
      result,
      progress: { current: TASK_DEFINITIONS.length, total: TASK_DEFINITIONS.length },
    });

  } catch (err) {
    const failedTask = provisioningState.tasks.find((t) => t.status === 'running');
    const failedTaskId = failedTask?.id || 'unknown';

    if (failedTask) {
      failedTask.status = 'error';
      failedTask.message = err.message;
    }

    provisioningState.error = { task: failedTaskId, message: err.message };
    provisioningState.isRunning = false;

    emitter.emit('progress', {
      task: failedTaskId,
      status: 'error',
      message: `Failed: ${failedTask?.title || failedTaskId}`,
      error: err.message,
      progress: {
        current: provisioningState.tasks.filter((t) => t.status === 'done').length,
        total: TASK_DEFINITIONS.length,
      },
    });

    log.error({ err, task: failedTaskId }, 'Provisioning failed');
  } finally {
    // Clear sensitive data from memory after clients have had time to receive it.
    // This runs on both success and error paths to prevent password leaks.
    setTimeout(() => {
      adminPassword = undefined;
      if (provisioningState.result) {
        provisioningState.result.adminPassword = null;
      }
    }, 5000);
  }
}

export default async function provisionRoute(fastify, _opts) {
  // POST /provision — start provisioning
  fastify.post('/provision', async (request, reply) => {
    const config = getConfig();
    const { status } = config.onboarding;

    if (status === 'FRESH' || status === 'DOMAIN_SET') {
      return reply.code(409).send({
        error: 'DNS must be verified before provisioning',
      });
    }

    if (status === 'COMPLETED') {
      return reply.code(410).send({
        error: 'Onboarding already completed',
      });
    }

    // If provisioning is actively running, return 409
    if (provisioningState.isRunning) {
      return reply.code(409).send({
        error: 'Provisioning already in progress',
      });
    }

    // Set status to PROVISIONING
    await updateConfig({ onboarding: { status: 'PROVISIONING' } });

    // Reset state and start provisioning in the background
    resetState();
    runProvisioning(request.log);

    return reply.code(202).send({ ok: true, message: 'Provisioning started' });
  });

  // WebSocket /provision/stream — real-time progress
  fastify.get('/provision/stream', { websocket: true }, (socket, _request) => {
    // Send current state immediately for late-joining clients
    socket.send(JSON.stringify({
      type: 'state',
      ...provisioningState,
    }));

    // Subscribe to progress events
    function onProgress(payload) {
      try {
        socket.send(JSON.stringify(payload));
      } catch {
        // Client disconnected — handled by close event
      }
    }

    emitter.on('progress', onProgress);

    socket.on('close', () => {
      emitter.off('progress', onProgress);
    });

    socket.on('error', () => {
      emitter.off('progress', onProgress);
    });
  });
}
