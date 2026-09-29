import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import path from 'node:path';
import { Listr } from 'listr2';
import chalk from 'chalk';
import {
  assertSupportedPlatform,
  CHISEL_BIN_DIR,
  LAMASTE_DIR,
  agentDataDir,
  agentLogsDir,
} from '@lamalibre/lamaste/agent';
import {
  saveAgentConfig,
  validateLabel,
  deriveLabel,
  upsertAgent,
  getAgent,
} from '@lamalibre/lamaste/agent';
import {
  fetchHealth,
  fetchAgentConfig,
  fetchChiselCredential,
  curlPostUnauthenticated,
} from '../lib/panel-api.js';
import { fetchPanelServerCertDigests } from '../lib/panel-cert.js';
import { extractPemFromP12, cleanupPemFiles } from '../lib/ws-helpers.js';
import {
  saveChiselCredential,
  userLingerStatus,
  enableLingerCommand,
  ensureAgentChiselBinary,
  resolveInstalledAgentCli,
  installSyncService,
} from '@lamalibre/lamaste/agent';
import { convergeWithPanel, describeConverge } from '../lib/converge.js';
import { generateKeypairAndCSR, secureDelete } from '../lib/keychain.js';
import { storeEnrolledCert } from '../lib/cert-store.js';

/**
 * Prompt for user input via readline.
 * @param {string} question
 * @param {string} [defaultValue]
 * @returns {Promise<string>}
 */
function prompt(question, defaultValue) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const suffix = defaultValue ? ` ${chalk.dim(`[${defaultValue}]`)}` : '';

  return new Promise((resolvePromise) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      rl.close();
      resolvePromise(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * Parse --token, --panel-url, and --label flags from argv.
 * Token can also be provided via LAMALIBRE_LAMASTE_ENROLLMENT_TOKEN env var
 * to avoid exposure in process listings.
 * @returns {{ token?: string, panelUrl?: string, label?: string }}
 */
function parseSetupFlags() {
  const args = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--token' && args[i + 1]) {
      flags.token = args[++i];
    } else if (args[i] === '--panel-url' && args[i + 1]) {
      flags.panelUrl = args[++i];
    } else if (args[i] === '--label' && args[i + 1]) {
      flags.label = args[++i];
    }
  }
  // Prefer env var over CLI arg to keep token out of process listings
  if (process.env.LAMALIBRE_LAMASTE_ENROLLMENT_TOKEN) {
    flags.token = process.env.LAMALIBRE_LAMASTE_ENROLLMENT_TOKEN;
  }
  return flags;
}

/**
 * Write a single NDJSON line to stdout.
 * @param {object} obj
 */
function emitJson(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

/**
 * Run a single setup step with NDJSON progress output.
 * Wraps the task in a silent Listr to reuse existing error handling.
 * @param {object} ctx - Shared context
 * @param {{ key: string, title: string, fn: (ctx: object) => Promise<void>, skip?: () => string | false }} step
 */
async function runJsonStep(ctx, step) {
  if (step.skip) {
    const reason = await step.skip();
    if (reason) {
      emitJson({ event: 'step', step: step.key, status: 'skipped' });
      return;
    }
  }

  emitJson({ event: 'step', step: step.key, status: 'running' });

  const taskList = new Listr([{ title: step.title, task: () => step.fn(ctx) }], {
    renderer: 'silent',
    exitOnError: true,
  });

  try {
    await taskList.run();
  } catch (error) {
    emitJson({ event: 'step', step: step.key, status: 'failed' });
    throw error;
  }

  emitJson({ event: 'step', step: step.key, status: 'complete' });
}

/**
 * The mTLS config the panel calls of a setup in progress use.
 * @param {object} ctx
 */
function setupAuthConfig(ctx) {
  return {
    panelUrl: ctx.panelUrl,
    authMethod: 'p12',
    p12Path: ctx.p12Path,
    p12Password: ctx.p12Password,
    panelServerPubkeySha256: ctx.panelServerPubkeySha256,
  };
}

/**
 * The final setup steps, shared by every flow once the agent holds its
 * certificate: install chisel, take the tunnel credential, save the agent
 * configuration, converge the tunnel client with the panel, and install the
 * sync timer that keeps it converged.
 *
 * @param {object} ctx
 * @returns {Array<{ key: string, title: string, fn: () => Promise<string | void> }>}
 */
function serviceSetupSteps(ctx) {
  return [
    {
      key: 'install_chisel',
      title: 'Installing Chisel',
      fn: async () => {
        const result = await ensureAgentChiselBinary();
        ctx.chiselVersion = result.version;
        return result.installed
          ? `Installed ${result.version} (checksum verified)`
          : `Already installed (${result.version})`;
      },
    },
    {
      key: 'fetch_config',
      title: 'Fetching the tunnel credential',
      fn: async () => {
        const authConfig = setupAuthConfig(ctx);
        const agentConfig = await fetchAgentConfig(authConfig);
        ctx.domain = agentConfig.domain;
        // Straight from the panel into a 0600 file: this credential has never
        // been exposed, so the configuration below marks it sealed.
        const credential = await fetchChiselCredential(authConfig);
        await saveChiselCredential(ctx.resolvedLabel, {
          ...credential,
          issuedAt: credential.createdAt,
        });
        return `Credential for ${credential.user} stored`;
      },
    },
    {
      key: 'save_config',
      title: 'Saving configuration',
      fn: async () => {
        const setupAt = new Date().toISOString();
        await saveAgentConfig(ctx.resolvedLabel, {
          panelUrl: ctx.panelUrl,
          authMethod: 'p12',
          p12Path: ctx.p12Path,
          p12Password: ctx.p12Password,
          ...(ctx.agentLabel ? { agentLabel: ctx.agentLabel } : {}),
          domain: ctx.domain,
          chiselVersion: ctx.chiselVersion,
          setupAt,
          panelServerPubkeySha256: ctx.panelServerPubkeySha256,
          panelServerCertSha256Hex: ctx.panelServerCertSha256Hex,
          panelServerCertPinnedAt: ctx.panelServerCertPinnedAt,
          chiselCredentialSealedAt: setupAt,
        });
        await upsertAgent({
          label: ctx.resolvedLabel,
          panelUrl: ctx.panelUrl,
          authMethod: 'p12',
          p12Path: ctx.p12Path,
          keychainIdentity: null,
          agentLabel: ctx.agentLabel ?? null,
          domain: ctx.domain,
          chiselVersion: ctx.chiselVersion,
          setupAt,
          updatedAt: null,
        });
      },
    },
    {
      key: 'start_tunnels',
      title: 'Starting the tunnel client',
      fn: async () => {
        const { result, response } = await convergeWithPanel(ctx.resolvedLabel, {
          forceRestart: true,
        });
        ctx.converge = result;
        ctx.tunnels = Array.isArray(response.tunnels) ? response.tunnels : [];
        return describeConverge(result);
      },
    },
    {
      key: 'install_sync',
      title: 'Installing the sync timer',
      fn: async () => {
        await installSyncService(ctx.resolvedLabel, ctx.program);
        return 'Tunnel changes on the panel apply within 30 seconds';
      },
    },
  ];
}

/**
 * {@link serviceSetupSteps} as Listr tasks for the interactive flows.
 * @param {object} ctx
 */
function serviceSetupTasks(ctx) {
  return serviceSetupSteps(ctx).map((step) => ({
    title: step.title,
    task: async (_ctx, task) => {
      const output = await step.fn();
      if (output) task.output = output;
    },
    rendererOptions: { persistentOutput: true },
  }));
}

/**
 * Run the agent setup flow.
 * Dispatches to interactive (P12 or token) or non-interactive (--json) mode.
 * @param {{ label?: string, json?: boolean }} options
 */
export async function runSetup(options = {}) {
  const flags = parseSetupFlags();
  // CLI --label from index.js takes precedence, then from parseSetupFlags
  const explicitLabel = options.label || flags.label;
  const json = options.json || false;

  if (flags.token) {
    if (json) {
      return runTokenSetupJson({ ...flags, label: explicitLabel });
    }
    return runTokenSetup({ ...flags, label: explicitLabel });
  }

  if (json) {
    emitJson({
      event: 'error',
      message:
        'Token is required for --json mode. Provide LAMALIBRE_LAMASTE_ENROLLMENT_TOKEN env var or --token flag.',
      recoverable: false,
    });
    process.exit(1);
  }

  return runP12Setup({ label: explicitLabel });
}

/**
 * Hardware-bound enrollment flow using a one-time token.
 * Generates a keypair locally, sends CSR to the panel, imports the signed
 * certificate into macOS Keychain as a non-extractable identity.
 *
 * @param {{ token: string, panelUrl?: string, label?: string }} flags
 */
async function runTokenSetup(flags) {
  // Step 1: Verify supported platform
  assertSupportedPlatform();
  // The sync timer runs the installed program; check before the single-use
  // token is spent.
  const program = await resolveInstalledAgentCli(process.argv[1]);

  // Validate explicit label early if provided
  if (flags.label) {
    validateLabel(flags.label);
    const existing = await getAgent(flags.label);
    if (existing) {
      console.log('');
      console.log(chalk.yellow(`  An agent with label "${flags.label}" already exists.`));
      console.log(chalk.yellow('  Running setup again will overwrite it.'));
      console.log('');
    }
  }

  console.log('');
  console.log(chalk.bold('  Lamaste Agent Setup (Token-Based Enrollment)'));
  console.log(chalk.dim('  Connect this machine to your Lamaste server using a certificate.'));
  console.log('');

  let panelUrl = flags.panelUrl;
  if (!panelUrl) {
    panelUrl = await prompt('Panel URL (e.g. https://1.2.3.4:9292)');
  }
  if (!panelUrl) {
    throw new Error('Panel URL is required. Pass --panel-url <url> or enter interactively.');
  }

  const normalizedUrl = panelUrl.replace(/\/+$/, '');

  console.log('');

  // Context shared across tasks
  const ctx = {
    panelUrl: normalizedUrl,
    token: flags.token,
    explicitLabel: flags.label,
    agentLabel: null,
    resolvedLabel: null,
    p12Path: null,
    p12Password: null,
    chiselVersion: null,
    domain: null,
    tunnels: [],
    panelServerPubkeySha256: null,
    panelServerCertSha256Hex: null,
    panelServerCertPinnedAt: null,
    program,
    converge: null,
  };

  const tasks = new Listr(
    [
      {
        title: 'Creating directories',
        task: async () => {
          await mkdir(LAMASTE_DIR, { recursive: true, mode: 0o700 });
          await mkdir(CHISEL_BIN_DIR, { recursive: true });
          // Per-agent dirs created after we know the label (post-enrollment)
        },
      },
      {
        title: 'Pinning panel server certificate (TOFU)',
        task: async (_ctx, task) => {
          // Capture the panel server cert fingerprint BEFORE any other
          // panel call so every subsequent request can pin against it.
          // This is true TOFU: we accept whatever cert the panel presents
          // on this single connection, then refuse to talk to anything
          // else until the operator runs `lamaste-agent panel reset-pin`.
          const digests = await fetchPanelServerCertDigests(ctx.panelUrl);
          ctx.panelServerPubkeySha256 = digests.pubkeySha256Base64;
          ctx.panelServerCertSha256Hex = digests.certSha256Hex;
          ctx.panelServerCertPinnedAt = new Date().toISOString();
          task.output =
            `Pinned sha256//${digests.pubkeySha256Base64}\n` +
            `Cert SHA-256: ${digests.certSha256Hex}\n` +
            `Subject: ${digests.subject || '(unknown)'}\n` +
            `Future panel calls will reject any other server key.`;
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Looking up enrollment token',
        task: async (_ctx, task) => {
          // Ask the panel which label this token will produce, so we can
          // generate a CSR with the correct CN. The panel-side signing
          // wrapper (B9 hardening) no longer overrides the CSR subject —
          // the CSR's CN must match the token's label exactly.
          const lookupUrl = `${ctx.panelUrl}/api/enroll/lookup`;
          const result = await curlPostUnauthenticated(
            lookupUrl,
            { token: ctx.token },
            { panelServerPubkeySha256: ctx.panelServerPubkeySha256, panelUrl: ctx.panelUrl },
          );
          if (!result.ok) {
            throw new Error(result.error || 'Token lookup failed');
          }
          ctx.tokenLabel = result.label;
          task.output = `Token will enroll as "${result.label}"`;
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Generating keypair and CSR',
        task: async (_ctx, task) => {
          // CSR CN must match the label embedded in the enrollment token —
          // the panel verifies this before signing.
          ctx._keyData = await generateKeypairAndCSR(ctx.tokenLabel);
          task.output = 'Keypair generated (4096-bit RSA)';
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Enrolling with panel',
        task: async (_ctx, task) => {
          const enrollUrl = `${ctx.panelUrl}/api/enroll`;
          const result = await curlPostUnauthenticated(
            enrollUrl,
            { token: ctx.token, csr: ctx._keyData.csrPem },
            { panelServerPubkeySha256: ctx.panelServerPubkeySha256, panelUrl: ctx.panelUrl },
          );

          if (!result.ok) {
            throw new Error(result.error || 'Enrollment failed');
          }

          ctx.agentLabel = result.label;
          ctx._certPem = result.cert;
          ctx._caCertPem = result.caCert;

          // Resolve label: explicit > derived from enrollment label > derived from panel URL
          ctx.resolvedLabel = ctx.explicitLabel || deriveLabel(null, result.label);
          validateLabel(ctx.resolvedLabel);

          task.output = `Enrolled as "${result.label}" (label: ${ctx.resolvedLabel})`;
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Creating agent directories',
        task: async () => {
          const dataDir = agentDataDir(ctx.resolvedLabel);
          const logsDir = agentLogsDir(ctx.resolvedLabel);
          await mkdir(dataDir, { recursive: true, mode: 0o700 });
          await mkdir(logsDir, { recursive: true, mode: 0o700 });
        },
      },
      {
        title: 'Storing certificate',
        task: async (_ctx, task) => {
          const result = await storeEnrolledCert(
            ctx._keyData.keyPath,
            ctx._certPem,
            ctx._caCertPem,
            ctx.resolvedLabel,
            console,
          );
          ctx.p12Path = result.p12Path;
          ctx.p12Password = result.p12Password;
          task.output = `Certificate stored at ${result.p12Path}`;
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Saving CA certificate',
        task: async () => {
          const caPath = path.join(agentDataDir(ctx.resolvedLabel), 'ca.crt');
          await writeFile(caPath, ctx._caCertPem, { mode: 0o644 });
        },
      },
      {
        title: 'Verifying panel connectivity',
        task: async (_ctx, task) => {
          const authConfig = {
            panelUrl: ctx.panelUrl,
            authMethod: 'p12',
            p12Path: ctx.p12Path,
            p12Password: ctx.p12Password,
            panelServerPubkeySha256: ctx.panelServerPubkeySha256,
          };
          const health = await fetchHealth(authConfig);
          task.output = `Panel is reachable (status: ${health.status || 'ok'})`;
        },
        rendererOptions: { persistentOutput: true },
      },
      ...serviceSetupTasks(ctx),
    ],
    {
      renderer: 'default',
      rendererOptions: { collapseSubtasks: false },
      exitOnError: true,
    },
  );

  try {
    await tasks.run();
  } catch (err) {
    if (ctx._keyData?.keyPath) {
      await secureDelete(ctx._keyData.keyPath).catch(() => {});
    }
    throw err;
  }

  await printSetupSummary(ctx);
}

/**
 * Non-interactive NDJSON setup flow for desktop app integration.
 * Requires --panel-url and a token (env var or --token).
 *
 * @param {{ token: string, panelUrl: string, label?: string }} flags
 */
async function runTokenSetupJson(flags) {
  assertSupportedPlatform();

  let program;
  try {
    program = await resolveInstalledAgentCli(process.argv[1]);
  } catch (err) {
    emitJson({ event: 'error', message: err.message, recoverable: false });
    process.exit(1);
  }

  if (!flags.panelUrl) {
    emitJson({
      event: 'error',
      message: 'Panel URL is required. Pass --panel-url <url>.',
      recoverable: false,
    });
    process.exit(1);
  }

  if (flags.label) {
    validateLabel(flags.label);
  }

  const normalizedUrl = flags.panelUrl.replace(/\/+$/, '');

  const ctx = {
    panelUrl: normalizedUrl,
    token: flags.token,
    explicitLabel: flags.label,
    agentLabel: null,
    resolvedLabel: null,
    p12Path: null,
    p12Password: null,
    chiselVersion: null,
    domain: null,
    tunnels: [],
    panelServerPubkeySha256: null,
    panelServerCertSha256Hex: null,
    panelServerCertPinnedAt: null,
    program,
    converge: null,
  };

  const steps = [
    {
      key: 'create_directories',
      title: 'Creating directories',
      fn: async () => {
        await mkdir(LAMASTE_DIR, { recursive: true, mode: 0o700 });
        await mkdir(CHISEL_BIN_DIR, { recursive: true });
      },
    },
    {
      key: 'pin_panel_cert',
      title: 'Pinning panel server certificate (TOFU)',
      fn: async () => {
        const digests = await fetchPanelServerCertDigests(ctx.panelUrl);
        ctx.panelServerPubkeySha256 = digests.pubkeySha256Base64;
        ctx.panelServerCertSha256Hex = digests.certSha256Hex;
        ctx.panelServerCertPinnedAt = new Date().toISOString();
      },
    },
    {
      key: 'lookup_token',
      title: 'Looking up enrollment token',
      fn: async () => {
        // The panel's CSR signing wrapper (B9) no longer overrides the
        // CSR subject. We must ask the panel which label the token will
        // produce, then generate a CSR with that exact CN.
        const lookupUrl = `${ctx.panelUrl}/api/enroll/lookup`;
        const result = await curlPostUnauthenticated(
          lookupUrl,
          { token: ctx.token },
          { panelServerPubkeySha256: ctx.panelServerPubkeySha256, panelUrl: ctx.panelUrl },
        );
        if (!result.ok) {
          throw new Error(result.error || 'Token lookup failed');
        }
        ctx.tokenLabel = result.label;
      },
    },
    {
      key: 'generate_keypair',
      title: 'Generating keypair and CSR',
      fn: async () => {
        ctx._keyData = await generateKeypairAndCSR(ctx.tokenLabel);
      },
    },
    {
      key: 'enroll_panel',
      title: 'Enrolling with panel',
      fn: async () => {
        const enrollUrl = `${ctx.panelUrl}/api/enroll`;
        const result = await curlPostUnauthenticated(
          enrollUrl,
          { token: ctx.token, csr: ctx._keyData.csrPem },
          { panelServerPubkeySha256: ctx.panelServerPubkeySha256, panelUrl: ctx.panelUrl },
        );

        if (!result.ok) {
          throw new Error(result.error || 'Enrollment failed');
        }

        ctx.agentLabel = result.label;
        ctx._certPem = result.cert;
        ctx._caCertPem = result.caCert;

        ctx.resolvedLabel = ctx.explicitLabel || deriveLabel(null, result.label);
        validateLabel(ctx.resolvedLabel);
      },
    },
    {
      key: 'create_agent_dirs',
      title: 'Creating agent directories',
      fn: async () => {
        const dataDir = agentDataDir(ctx.resolvedLabel);
        const logsDir = agentLogsDir(ctx.resolvedLabel);
        await mkdir(dataDir, { recursive: true, mode: 0o700 });
        await mkdir(logsDir, { recursive: true, mode: 0o700 });
      },
    },
    {
      key: 'import_cert',
      title: 'Storing certificate',
      fn: async () => {
        const result = await storeEnrolledCert(
          ctx._keyData.keyPath,
          ctx._certPem,
          ctx._caCertPem,
          ctx.resolvedLabel,
          { log: () => {}, warn: () => {}, error: () => {} },
        );
        ctx.p12Path = result.p12Path;
        ctx.p12Password = result.p12Password;
      },
    },
    {
      key: 'save_ca',
      title: 'Saving CA certificate',
      fn: async () => {
        const caPath = path.join(agentDataDir(ctx.resolvedLabel), 'ca.crt');
        await writeFile(caPath, ctx._caCertPem, { mode: 0o644 });
      },
    },
    {
      key: 'verify_connectivity',
      title: 'Verifying panel connectivity',
      fn: async () => {
        const authConfig = {
          panelUrl: ctx.panelUrl,
          authMethod: 'p12',
          p12Path: ctx.p12Path,
          p12Password: ctx.p12Password,
          panelServerPubkeySha256: ctx.panelServerPubkeySha256,
        };
        await fetchHealth(authConfig);
      },
    },
    ...serviceSetupSteps(ctx),
  ];

  try {
    for (const step of steps) {
      await runJsonStep(ctx, step);
    }
  } catch (err) {
    if (ctx._keyData?.keyPath) {
      await secureDelete(ctx._keyData.keyPath).catch(() => {});
    }
    emitJson({ event: 'error', message: err.message || 'Setup failed', recoverable: false });
    process.exit(1);
  }

  // The p12Password transits via stdout pipe to the parent process (Tauri desktop app),
  // which stores it in the OS credential store. Pipes are not visible in process listings.
  // This is the same trust boundary as the server provisioner's SCP-based P12 transfer.
  emitJson({
    event: 'complete',
    agent: {
      label: ctx.resolvedLabel,
      panelUrl: ctx.panelUrl,
      authMethod: 'p12',
      p12Path: ctx.p12Path,
      p12Password: ctx.p12Password,
      domain: ctx.domain,
      chiselVersion: ctx.chiselVersion,
      panelServerPubkeySha256: ctx.panelServerPubkeySha256,
      panelServerCertSha256Hex: ctx.panelServerCertSha256Hex,
      // 'disabled' on Linux means the tunnel stops at logout and does not
      // return after reboot until `enableLingerCommand` is run.
      bootPersistence: await userLingerStatus(),
    },
  });
}

/**
 * Traditional P12-based setup flow.
 * @param {{ label?: string }} options
 */
async function runP12Setup(options = {}) {
  assertSupportedPlatform();
  const program = await resolveInstalledAgentCli(process.argv[1]);

  // Validate explicit label early if provided
  if (options.label) {
    validateLabel(options.label);
  }

  console.log('');
  console.log(chalk.bold('  Lamaste Agent Setup'));
  console.log(chalk.dim('  Connect this machine to your Lamaste server.'));
  console.log('');
  console.log(chalk.dim('  The admin must generate an agent certificate from the panel first:'));
  console.log(chalk.dim('    Panel → Certificates → Agent Certificates → Generate'));
  console.log('');

  const panelUrl = await prompt('Panel URL (e.g. https://1.2.3.4:9292)');
  if (!panelUrl) {
    throw new Error('Panel URL is required.');
  }

  const normalizedUrl = panelUrl.replace(/\/+$/, '');

  const defaultP12 = './agent.p12';
  const p12Input = await prompt('Path to agent certificate (.p12)', defaultP12);
  const p12Path = resolve(p12Input);

  if (!existsSync(p12Path)) {
    throw new Error(`client.p12 not found at: ${p12Path}`);
  }

  const p12Password = await prompt('P12 password');
  if (!p12Password) {
    throw new Error('P12 password is required.');
  }

  // Derive label if not explicitly provided
  const agentLabel =
    options.label || deriveLabel(normalizedUrl.replace(/^https?:\/\//, '').split(':')[0]);

  console.log('');

  const ctx = {
    panelUrl: normalizedUrl,
    p12Path,
    p12Password,
    resolvedLabel: agentLabel,
    chiselVersion: null,
    domain: null,
    tunnels: [],
    panelServerPubkeySha256: null,
    panelServerCertSha256Hex: null,
    panelServerCertPinnedAt: null,
    program,
    converge: null,
  };

  const tasks = new Listr(
    [
      {
        title: 'Creating directories',
        task: async () => {
          await mkdir(LAMASTE_DIR, { recursive: true, mode: 0o700 });
          await mkdir(CHISEL_BIN_DIR, { recursive: true });
          const dataDir = agentDataDir(ctx.resolvedLabel);
          const logsDir = agentLogsDir(ctx.resolvedLabel);
          await mkdir(dataDir, { recursive: true, mode: 0o700 });
          await mkdir(logsDir, { recursive: true, mode: 0o700 });
        },
      },
      {
        title: 'Pinning panel server certificate (TOFU)',
        task: async (_ctx, task) => {
          const digests = await fetchPanelServerCertDigests(ctx.panelUrl);
          ctx.panelServerPubkeySha256 = digests.pubkeySha256Base64;
          ctx.panelServerCertSha256Hex = digests.certSha256Hex;
          ctx.panelServerCertPinnedAt = new Date().toISOString();
          task.output =
            `Pinned sha256//${digests.pubkeySha256Base64}\n` +
            `Cert SHA-256: ${digests.certSha256Hex}\n` +
            `Future panel calls will reject any other server key.`;
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Extracting certificates from P12',
        task: async (_ctx, task) => {
          const pem = await extractPemFromP12(ctx.p12Path, ctx.p12Password);
          if (pem.caPath) {
            task.output = `mTLS CA certificate saved to ${pem.caPath}`;
          } else {
            task.output = 'No CA certificate found in P12';
          }
          await cleanupPemFiles(pem);
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Verifying panel connectivity',
        task: async (_ctx, task) => {
          // Use the config-object form so the captured pin is enforced.
          const authConfig = {
            panelUrl: ctx.panelUrl,
            authMethod: 'p12',
            p12Path: ctx.p12Path,
            p12Password: ctx.p12Password,
            panelServerPubkeySha256: ctx.panelServerPubkeySha256,
          };
          const health = await fetchHealth(authConfig);
          task.output = `Panel is reachable (status: ${health.status || 'ok'})`;
        },
        rendererOptions: { persistentOutput: true },
      },
      ...serviceSetupTasks(ctx),
    ],
    {
      renderer: 'default',
      rendererOptions: { collapseSubtasks: false },
      exitOnError: true,
    },
  );

  await tasks.run();

  await printSetupSummary(ctx);
}

/**
 * Print a formatted summary after successful setup.
 * @param {object} ctx
 */
async function printSetupSummary(ctx) {
  const b = chalk.bold;
  const c = chalk.cyan;
  const d = chalk.dim;
  const g = chalk.green;

  console.log('');
  console.log(c('  ╔══════════════════════════════════════════════════════════╗'));
  console.log(
    c('  ║') + `  ${g.bold('Lamaste Agent installed successfully!')}` + ' '.repeat(17) + c('║'),
  );
  console.log(c('  ╠══════════════════════════════════════════════════════════╣'));

  if (ctx.resolvedLabel) {
    console.log(
      c('  ║') +
        `  ${b('Label:')}   ${c(ctx.resolvedLabel)}` +
        ' '.repeat(Math.max(0, 46 - ctx.resolvedLabel.length)) +
        c('║'),
    );
  }

  if (ctx.domain) {
    console.log(
      c('  ║') +
        `  ${b('Domain:')}  ${c(ctx.domain)}` +
        ' '.repeat(Math.max(0, 46 - ctx.domain.length)) +
        c('║'),
    );
  }

  console.log(
    c('  ║') +
      `  ${b('Chisel:')}  ${ctx.chiselVersion}` +
      ' '.repeat(Math.max(0, 46 - (ctx.chiselVersion || '').length)) +
      c('║'),
  );
  console.log(
    c('  ║') + `  ${b('Tunnels:')} ${ctx.tunnels.length} carried` + ' '.repeat(36) + c('║'),
  );
  console.log(c('  ║') + ' '.repeat(58) + c('║'));

  if (ctx.tunnels.length > 0) {
    for (const t of ctx.tunnels) {
      const line = `${t.subdomain} → localhost:${t.port}`;
      console.log(
        c('  ║') + `    ${d('•')} ${line}` + ' '.repeat(Math.max(0, 54 - line.length)) + c('║'),
      );
    }
    console.log(c('  ║') + ' '.repeat(58) + c('║'));
  }

  console.log(c('  ║') + `  ${b('Commands:')}` + ' '.repeat(47) + c('║'));
  console.log(
    c('  ║') +
      `    ${d('lamaste-agent list')}       ${d('— list all agents')}` +
      ' '.repeat(13) +
      c('║'),
  );
  console.log(
    c('  ║') +
      `    ${d('lamaste-agent status')}     ${d('— check agent health')}` +
      ' '.repeat(10) +
      c('║'),
  );
  console.log(
    c('  ║') +
      `    ${d('lamaste-agent logs')}       ${d('— stream chisel logs')}` +
      ' '.repeat(10) +
      c('║'),
  );
  console.log(
    c('  ║') +
      `    ${d('lamaste-agent update')}     ${d('— apply changes now')}` +
      ' '.repeat(11) +
      c('║'),
  );
  console.log(
    c('  ║') +
      `    ${d('lamaste-agent uninstall')}  ${d('— remove everything')}` +
      ' '.repeat(11) +
      c('║'),
  );
  console.log(c('  ║') + ' '.repeat(58) + c('║'));
  console.log(c('  ╚══════════════════════════════════════════════════════════╝'));
  console.log('');

  if (ctx.panelServerPubkeySha256) {
    console.log(b('  Pinned panel server public key (verify out-of-band):'));
    console.log(`    ${d('curl pin :')} ${c(`sha256//${ctx.panelServerPubkeySha256}`)}`);
    if (ctx.panelServerCertSha256Hex) {
      console.log(`    ${d('cert sha256:')} ${c(ctx.panelServerCertSha256Hex)}`);
    }
    console.log(d('  Future panel calls will reject any other server key.'));
    console.log('');
  }

  if (ctx.tunnels.length === 0) {
    console.log(d('  No tunnel is assigned to this agent yet. Once an administrator creates one'));
    console.log(d('  for it, the sync timer starts carrying it within 30 seconds.'));
    console.log('');
  }
  for (const warning of ctx.converge?.warnings ?? []) {
    console.log(chalk.yellow(`  ${warning}`));
  }

  const linger = await userLingerStatus();
  if (linger === 'disabled' || linger === 'unknown') {
    console.log(
      chalk.yellow.bold('  The tunnel will not come back after a reboot until you log in.'),
    );
    console.log(
      d('  The tunnel client and its sync timer are systemd user units; without lingering they'),
    );
    console.log(d('  only run while this user has a session. On a server or VM, enable it once:'));
    console.log(`    ${c(enableLingerCommand())}`);
    console.log('');
  }
}
