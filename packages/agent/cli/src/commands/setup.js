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
  fetchTunnels,
  fetchChiselCredential,
  curlPostUnauthenticated,
} from '../lib/panel-api.js';
import { fetchPanelServerCertDigests } from '../lib/panel-cert.js';
import { extractPemFromP12, cleanupPemFiles } from '../lib/ws-helpers.js';
import { installChisel } from '../lib/chisel.js';
import {
  generateServiceConfig,
  writeServiceConfigFile,
  injectChiselAuth,
  injectChiselFingerprint,
} from '../lib/service-config.js';
import { saveChiselCredential } from '../lib/chisel-credential.js';
import {
  isAgentLoaded,
  unloadAgent,
  loadAgent,
  getAgentPid,
} from '@lamalibre/lamaste/agent';
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

  const taskList = new Listr(
    [{ title: step.title, task: () => step.fn(ctx) }],
    { renderer: 'silent', exitOnError: true },
  );

  try {
    await taskList.run();
  } catch (error) {
    emitJson({ event: 'step', step: step.key, status: 'failed' });
    throw error;
  }

  emitJson({ event: 'step', step: step.key, status: 'complete' });
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
    emitJson({ event: 'error', message: 'Token is required for --json mode. Provide LAMALIBRE_LAMASTE_ENROLLMENT_TOKEN env var or --token flag.', recoverable: false });
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
    serviceConfig: null,
    domain: null,
    tunnels: [],
    panelServerPubkeySha256: null,
    panelServerCertSha256Hex: null,
    panelServerCertPinnedAt: null,
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
      {
        title: 'Installing Chisel',
        task: async (_ctx, task) => {
          const result = await installChisel();
          ctx.chiselVersion = result.version;
          if (result.skipped) {
            task.output = `Already installed (${result.version})`;
          } else {
            task.output = `Installed ${result.version}`;
          }
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Fetching tunnel configuration',
        task: async (_ctx, task) => {
          const authConfig = {
            panelUrl: ctx.panelUrl,
            authMethod: 'p12',
            p12Path: ctx.p12Path,
            p12Password: ctx.p12Password,
            panelServerPubkeySha256: ctx.panelServerPubkeySha256,
          };

          const agentConfig = await fetchAgentConfig(authConfig);
          ctx.domain = agentConfig.domain;

          // Capture the chisel TLS server fingerprint via TOFU so the chisel
          // client can pin with --fingerprint. The chisel server runs behind
          // nginx on tunnel.<domain>:443, which often has a different TLS
          // cert from the panel — pin them separately.
          const chiselServerUrl = `https://tunnel.${ctx.domain}:443`;
          try {
            const chiselDigests = await fetchPanelServerCertDigests(chiselServerUrl);
            ctx.chiselServerCertSha256Hex = chiselDigests.certSha256Hex;
          } catch (err) {
            // Don't hard-fail enrollment if the tunnel host isn't reachable
            // yet (DNS or LE cert may still be propagating). The agent will
            // fall back to --tls-skip-verify and warn until the next update.
            ctx.chiselServerCertSha256Hex = null;
            task.output = `Warning: could not pin chisel server cert (${err.message})`;
          }

          // Fetch the per-agent chisel tunnel credential and inject it into
          // the chisel client args. The chisel server enforces --authfile so
          // a missing credential here means tunnels will fail to connect.
          const credential = await fetchChiselCredential(authConfig);
          await saveChiselCredential(ctx.resolvedLabel, credential);
          let chiselArgs = injectChiselAuth(agentConfig.chiselArgs, credential);
          if (ctx.chiselServerCertSha256Hex) {
            chiselArgs = injectChiselFingerprint(chiselArgs, ctx.chiselServerCertSha256Hex);
          }

          ctx.serviceConfig = generateServiceConfig(chiselArgs, ctx.resolvedLabel);

          const tunnelData = await fetchTunnels(authConfig);
          ctx.tunnels = tunnelData.tunnels || [];
          task.output = `${ctx.tunnels.length} tunnel(s) configured`;
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Writing service config',
        task: async () => {
          await writeServiceConfigFile(ctx.serviceConfig, ctx.resolvedLabel);
        },
      },
      {
        title: 'Unloading previous agent',
        skip: async () => {
          const loaded = await isAgentLoaded(ctx.resolvedLabel);
          return !loaded && 'No previous agent loaded';
        },
        task: async () => {
          await unloadAgent(ctx.resolvedLabel);
        },
      },
      {
        title: 'Loading agent',
        skip: () => ctx.tunnels.length === 0 && 'No tunnels configured — run lamaste-agent update after creating tunnels',
        task: async () => {
          await loadAgent(ctx.resolvedLabel);
        },
      },
      {
        title: 'Verifying agent is running',
        skip: () => ctx.tunnels.length === 0 && 'No tunnels configured',
        task: async (_ctx, task) => {
          await new Promise((r) => setTimeout(r, 2000));
          const pid = await getAgentPid(ctx.resolvedLabel);
          if (pid) {
            task.output = `Agent running (PID ${pid})`;
          } else {
            const loaded = await isAgentLoaded(ctx.resolvedLabel);
            if (loaded) {
              task.output = 'Agent loaded (process starting...)';
            } else {
              throw new Error('Agent failed to load. Check logs with: lamaste-agent logs');
            }
          }
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Saving configuration',
        task: async () => {
          const configData = {
            panelUrl: ctx.panelUrl,
            authMethod: 'p12',
            p12Path: ctx.p12Path,
            p12Password: ctx.p12Password,
            agentLabel: ctx.agentLabel,
            domain: ctx.domain,
            chiselVersion: ctx.chiselVersion,
            setupAt: new Date().toISOString(),
            panelServerPubkeySha256: ctx.panelServerPubkeySha256,
            panelServerCertSha256Hex: ctx.panelServerCertSha256Hex,
            panelServerCertPinnedAt: ctx.panelServerCertPinnedAt,
            chiselServerCertSha256Hex: ctx.chiselServerCertSha256Hex || undefined,
          };

          await saveAgentConfig(ctx.resolvedLabel, configData);

          // Add or update registry entry
          await upsertAgent({
            label: ctx.resolvedLabel,
            panelUrl: ctx.panelUrl,
            authMethod: 'p12',
            p12Path: ctx.p12Path,
            keychainIdentity: null,
            agentLabel: ctx.agentLabel,
            domain: ctx.domain,
            chiselVersion: ctx.chiselVersion,
            setupAt: configData.setupAt,
            updatedAt: null,
          });
        },
      },
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

  printSetupSummary(ctx);
}

/**
 * Non-interactive NDJSON setup flow for desktop app integration.
 * Requires --panel-url and a token (env var or --token).
 *
 * @param {{ token: string, panelUrl: string, label?: string }} flags
 */
async function runTokenSetupJson(flags) {
  assertSupportedPlatform();

  if (!flags.panelUrl) {
    emitJson({ event: 'error', message: 'Panel URL is required. Pass --panel-url <url>.', recoverable: false });
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
    serviceConfig: null,
    domain: null,
    tunnels: [],
    panelServerPubkeySha256: null,
    panelServerCertSha256Hex: null,
    panelServerCertPinnedAt: null,
    chiselServerCertSha256Hex: null,
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
    {
      key: 'install_chisel',
      title: 'Installing Chisel',
      fn: async () => {
        const result = await installChisel();
        ctx.chiselVersion = result.version;
      },
    },
    {
      key: 'fetch_config',
      title: 'Fetching tunnel configuration',
      fn: async () => {
        const authConfig = {
          panelUrl: ctx.panelUrl,
          authMethod: 'p12',
          p12Path: ctx.p12Path,
          p12Password: ctx.p12Password,
          panelServerPubkeySha256: ctx.panelServerPubkeySha256,
        };

        const agentConfig = await fetchAgentConfig(authConfig);
        ctx.domain = agentConfig.domain;

        // TOFU-pin the chisel server cert at tunnel.<domain>:443. May fail
        // on fresh installs where DNS or LE has not converged yet — fall
        // back to --tls-skip-verify in that case (the agent will warn and
        // the operator can re-pin via `lamaste-agent panel reset-pin`).
        const chiselServerUrl = `https://tunnel.${ctx.domain}:443`;
        try {
          const chiselDigests = await fetchPanelServerCertDigests(chiselServerUrl);
          ctx.chiselServerCertSha256Hex = chiselDigests.certSha256Hex;
        } catch {
          ctx.chiselServerCertSha256Hex = null;
        }

        // Fetch and persist this agent's chisel tunnel-server credential.
        // Without --auth the chisel server rejects the connection.
        const credential = await fetchChiselCredential(authConfig);
        await saveChiselCredential(ctx.resolvedLabel, credential);
        let chiselArgs = injectChiselAuth(agentConfig.chiselArgs, credential);
        if (ctx.chiselServerCertSha256Hex) {
          chiselArgs = injectChiselFingerprint(chiselArgs, ctx.chiselServerCertSha256Hex);
        }

        ctx.serviceConfig = generateServiceConfig(chiselArgs, ctx.resolvedLabel);

        const tunnelData = await fetchTunnels(authConfig);
        ctx.tunnels = tunnelData.tunnels || [];
      },
    },
    {
      key: 'write_service',
      title: 'Writing service config',
      fn: async () => {
        await writeServiceConfigFile(ctx.serviceConfig, ctx.resolvedLabel);
      },
    },
    {
      key: 'unload_previous',
      title: 'Unloading previous agent',
      skip: async () => {
        const loaded = await isAgentLoaded(ctx.resolvedLabel);
        return !loaded && 'No previous agent loaded';
      },
      fn: async () => {
        await unloadAgent(ctx.resolvedLabel);
      },
    },
    {
      key: 'load_service',
      title: 'Loading agent',
      skip: () => ctx.tunnels.length === 0 && 'No tunnels configured',
      fn: async () => {
        await loadAgent(ctx.resolvedLabel);
      },
    },
    {
      key: 'verify_running',
      title: 'Verifying agent is running',
      skip: () => ctx.tunnels.length === 0 && 'No tunnels configured',
      fn: async () => {
        await new Promise((r) => setTimeout(r, 2000));
        const pid = await getAgentPid(ctx.resolvedLabel);
        if (!pid) {
          const loaded = await isAgentLoaded(ctx.resolvedLabel);
          if (!loaded) {
            throw new Error('Agent failed to load. Check logs with: lamaste-agent logs');
          }
        }
      },
    },
    {
      key: 'save_config',
      title: 'Saving configuration',
      fn: async () => {
        const configData = {
          panelUrl: ctx.panelUrl,
          authMethod: 'p12',
          p12Path: ctx.p12Path,
          p12Password: ctx.p12Password,
          agentLabel: ctx.agentLabel,
          domain: ctx.domain,
          chiselVersion: ctx.chiselVersion,
          setupAt: new Date().toISOString(),
          panelServerPubkeySha256: ctx.panelServerPubkeySha256,
          panelServerCertSha256Hex: ctx.panelServerCertSha256Hex,
          panelServerCertPinnedAt: ctx.panelServerCertPinnedAt,
          chiselServerCertSha256Hex: ctx.chiselServerCertSha256Hex || undefined,
        };

        await saveAgentConfig(ctx.resolvedLabel, configData);

        await upsertAgent({
          label: ctx.resolvedLabel,
          panelUrl: ctx.panelUrl,
          authMethod: 'p12',
          p12Path: ctx.p12Path,
          keychainIdentity: null,
          agentLabel: ctx.agentLabel,
          domain: ctx.domain,
          chiselVersion: ctx.chiselVersion,
          setupAt: configData.setupAt,
          updatedAt: null,
        });
      },
    },
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
      chiselServerCertSha256Hex: ctx.chiselServerCertSha256Hex || null,
    },
  });
}

/**
 * Traditional P12-based setup flow.
 * @param {{ label?: string }} options
 */
async function runP12Setup(options = {}) {
  assertSupportedPlatform();

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
  const agentLabel = options.label || deriveLabel(normalizedUrl.replace(/^https?:\/\//, '').split(':')[0]);

  console.log('');

  const ctx = {
    panelUrl: normalizedUrl,
    p12Path,
    p12Password,
    resolvedLabel: agentLabel,
    chiselVersion: null,
    serviceConfig: null,
    domain: null,
    tunnels: [],
    panelServerPubkeySha256: null,
    panelServerCertSha256Hex: null,
    panelServerCertPinnedAt: null,
    chiselServerCertSha256Hex: null,
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
      {
        title: 'Installing Chisel',
        task: async (_ctx, task) => {
          const result = await installChisel();
          ctx.chiselVersion = result.version;
          if (result.skipped) {
            task.output = `Already installed (${result.version})`;
          } else {
            task.output = `Installed ${result.version}`;
          }
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Fetching tunnel configuration',
        task: async (_ctx, task) => {
          const authConfig = {
            panelUrl: ctx.panelUrl,
            authMethod: 'p12',
            p12Path: ctx.p12Path,
            p12Password: ctx.p12Password,
            panelServerPubkeySha256: ctx.panelServerPubkeySha256,
          };

          const agentConfig = await fetchAgentConfig(authConfig);
          ctx.domain = agentConfig.domain;

          // TOFU-pin the chisel server cert at tunnel.<domain>:443.
          const chiselServerUrl = `https://tunnel.${ctx.domain}:443`;
          try {
            const chiselDigests = await fetchPanelServerCertDigests(chiselServerUrl);
            ctx.chiselServerCertSha256Hex = chiselDigests.certSha256Hex;
          } catch (err) {
            ctx.chiselServerCertSha256Hex = null;
            task.output = `Warning: could not pin chisel server cert (${err.message})`;
          }

          // Fetch and persist this agent's chisel tunnel-server credential.
          const credential = await fetchChiselCredential(authConfig);
          await saveChiselCredential(ctx.resolvedLabel, credential);
          let chiselArgs = injectChiselAuth(agentConfig.chiselArgs, credential);
          if (ctx.chiselServerCertSha256Hex) {
            chiselArgs = injectChiselFingerprint(chiselArgs, ctx.chiselServerCertSha256Hex);
          }

          ctx.serviceConfig = generateServiceConfig(chiselArgs, ctx.resolvedLabel);

          const tunnelData = await fetchTunnels(authConfig);
          ctx.tunnels = tunnelData.tunnels || [];
          task.output = `${ctx.tunnels.length} tunnel(s) configured`;
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Writing service config',
        task: async () => {
          await writeServiceConfigFile(ctx.serviceConfig, ctx.resolvedLabel);
        },
      },
      {
        title: 'Unloading previous agent',
        skip: async () => {
          const loaded = await isAgentLoaded(ctx.resolvedLabel);
          return !loaded && 'No previous agent loaded';
        },
        task: async () => {
          await unloadAgent(ctx.resolvedLabel);
        },
      },
      {
        title: 'Loading agent',
        skip: () => ctx.tunnels.length === 0 && 'No tunnels configured — run lamaste-agent update after creating tunnels',
        task: async () => {
          await loadAgent(ctx.resolvedLabel);
        },
      },
      {
        title: 'Verifying agent is running',
        skip: () => ctx.tunnels.length === 0 && 'No tunnels configured',
        task: async (_ctx, task) => {
          await new Promise((r) => setTimeout(r, 2000));
          const pid = await getAgentPid(ctx.resolvedLabel);
          if (pid) {
            task.output = `Agent running (PID ${pid})`;
          } else {
            const loaded = await isAgentLoaded(ctx.resolvedLabel);
            if (loaded) {
              task.output = 'Agent loaded (process starting...)';
            } else {
              throw new Error('Agent failed to load. Check logs with: lamaste-agent logs');
            }
          }
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Saving configuration',
        task: async () => {
          const configData = {
            panelUrl: ctx.panelUrl,
            authMethod: 'p12',
            p12Path: ctx.p12Path,
            p12Password: ctx.p12Password,
            domain: ctx.domain,
            chiselVersion: ctx.chiselVersion,
            setupAt: new Date().toISOString(),
            panelServerPubkeySha256: ctx.panelServerPubkeySha256,
            panelServerCertSha256Hex: ctx.panelServerCertSha256Hex,
            panelServerCertPinnedAt: ctx.panelServerCertPinnedAt,
            chiselServerCertSha256Hex: ctx.chiselServerCertSha256Hex || undefined,
          };
          await saveAgentConfig(ctx.resolvedLabel, configData);

          await upsertAgent({
            label: ctx.resolvedLabel,
            panelUrl: ctx.panelUrl,
            authMethod: 'p12',
            p12Path: ctx.p12Path,
            keychainIdentity: null,
            agentLabel: null,
            domain: ctx.domain,
            chiselVersion: ctx.chiselVersion,
            setupAt: configData.setupAt,
            updatedAt: null,
          });
        },
      },
    ],
    {
      renderer: 'default',
      rendererOptions: { collapseSubtasks: false },
      exitOnError: true,
    },
  );

  await tasks.run();

  printSetupSummary(ctx);
}

/**
 * Print a formatted summary after successful setup.
 * @param {object} ctx
 */
function printSetupSummary(ctx) {
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
    c('  ║') + `  ${b('Tunnels:')} ${ctx.tunnels.length} configured` + ' '.repeat(33) + c('║'),
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
      `    ${d('lamaste-agent update')}     ${d('— refresh tunnel config')}` +
      ' '.repeat(7) +
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
    if (ctx.chiselServerCertSha256Hex) {
      console.log(`    ${d('chisel sha256:')} ${c(ctx.chiselServerCertSha256Hex)}`);
    } else {
      console.log(
        `    ${chalk.yellow('chisel cert was not pinned — falling back to --tls-skip-verify')}`,
      );
    }
    console.log(d('  Future panel calls will reject any other server key.'));
    console.log('');
  }
}
