import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import path from 'node:path';
import { Listr } from 'listr2';
import chalk from 'chalk';
import { assertMacOS, CHISEL_BIN_DIR, LOGS_DIR, AGENT_DIR } from '../lib/platform.js';
import { loadAgentConfig, saveAgentConfig } from '../lib/config.js';
import { fetchHealth, fetchPlist, fetchTunnels, curlPostUnauthenticated } from '../lib/panel-api.js';
import { extractPemFromP12, cleanupPemFiles } from '../lib/ws-helpers.js';
import { installChisel } from '../lib/chisel.js';
import { rewritePlist, writePlistFile } from '../lib/plist.js';
import { isAgentLoaded, unloadAgent, loadAgent, getAgentPid } from '../lib/launchctl.js';
import { generateKeypairAndCSR, importIdentityToKeychain, secureDelete } from '../lib/keychain.js';

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
 * Parse --token and --panel-url flags from argv.
 * @returns {{ token?: string, panelUrl?: string }}
 */
function parseSetupFlags() {
  const args = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--token' && args[i + 1]) {
      flags.token = args[++i];
    } else if (args[i] === '--panel-url' && args[i + 1]) {
      flags.panelUrl = args[++i];
    }
  }
  return flags;
}

/**
 * Run the interactive setup flow.
 * If --token is provided, uses the hardware-bound enrollment flow.
 */
export async function runSetup() {
  const flags = parseSetupFlags();

  if (flags.token) {
    return runTokenSetup(flags);
  }

  return runP12Setup();
}

/**
 * Hardware-bound enrollment flow using a one-time token.
 * Generates a keypair locally, sends CSR to the panel, imports the signed
 * certificate into macOS Keychain as a non-extractable identity.
 *
 * @param {{ token: string, panelUrl?: string }} flags
 */
async function runTokenSetup(flags) {
  // Step 1: Verify macOS
  assertMacOS();

  // Check for existing config
  const existingConfig = await loadAgentConfig();
  if (existingConfig) {
    console.log('');
    console.log(chalk.yellow('  An existing agent configuration was found.'));
    console.log(chalk.yellow('  Running setup again will overwrite it.'));
    console.log('');
  }

  console.log('');
  console.log(chalk.bold('  Portlama Agent Setup (Hardware-Bound Certificate)'));
  console.log(chalk.dim('  Connect this Mac to your Portlama server using a Keychain-bound certificate.'));
  console.log('');

  let panelUrl = flags.panelUrl;
  if (!panelUrl) {
    panelUrl = await prompt('Panel URL (e.g. https://1.2.3.4:9292)', existingConfig?.panelUrl);
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
    agentLabel: null,
    keychainIdentity: null,
    chiselVersion: null,
    plistXml: null,
    domain: null,
    tunnels: [],
  };

  const tasks = new Listr(
    [
      {
        title: 'Creating directories',
        task: async () => {
          await mkdir(AGENT_DIR, { recursive: true, mode: 0o700 });
          await mkdir(CHISEL_BIN_DIR, { recursive: true });
          await mkdir(LOGS_DIR, { recursive: true });
        },
      },
      {
        title: 'Generating keypair and CSR',
        task: async (_ctx, task) => {
          // We use a temporary label placeholder — the actual label comes from the token
          // We'll pass 'pending' and fix after enrollment
          ctx._keyData = await generateKeypairAndCSR('pending');
          task.output = 'Keypair generated (4096-bit RSA)';
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Enrolling with panel',
        task: async (_ctx, task) => {
          const enrollUrl = `${ctx.panelUrl}/api/enroll`;
          const result = await curlPostUnauthenticated(enrollUrl, {
            token: ctx.token,
            csr: ctx._keyData.csrPem,
          });

          if (!result.ok) {
            throw new Error(result.error || 'Enrollment failed');
          }

          ctx.agentLabel = result.label;
          ctx._certPem = result.cert;
          ctx._caCertPem = result.caCert;
          task.output = `Enrolled as "${result.label}" (serial: ${result.serial})`;
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Importing certificate into Keychain',
        task: async (_ctx, task) => {
          // The server overrides the CSR subject with the correct CN=agent:<label>
          // during signing, so the CSR placeholder subject doesn't matter.
          const { identity } = await importIdentityToKeychain(
            ctx._keyData.keyPath,
            ctx._certPem,
            ctx._caCertPem,
            ctx.agentLabel,
            console,
          );
          ctx.keychainIdentity = identity;
          task.output = `Identity "${identity}" imported (non-extractable)`;
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Saving CA certificate',
        task: async () => {
          const caPath = path.join(AGENT_DIR, 'ca.crt');
          await writeFile(caPath, ctx._caCertPem, { mode: 0o644 });
        },
      },
      {
        title: 'Verifying panel connectivity',
        task: async (_ctx, task) => {
          const config = {
            panelUrl: ctx.panelUrl,
            authMethod: 'keychain',
            keychainIdentity: ctx.keychainIdentity,
          };
          const health = await fetchHealth(config);
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
          const config = {
            panelUrl: ctx.panelUrl,
            authMethod: 'keychain',
            keychainIdentity: ctx.keychainIdentity,
          };
          const data = await fetchPlist(config);
          ctx.plistXml = data.plist;

          const tunnelData = await fetchTunnels(config);
          ctx.tunnels = tunnelData.tunnels || [];
          task.output = `${ctx.tunnels.length} tunnel(s) configured`;
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Rewriting plist paths',
        task: async () => {
          ctx.plistXml = rewritePlist(ctx.plistXml);
        },
      },
      {
        title: 'Writing plist file',
        task: async () => {
          await writePlistFile(ctx.plistXml);
        },
      },
      {
        title: 'Unloading previous agent',
        skip: async () => {
          const loaded = await isAgentLoaded();
          return !loaded && 'No previous agent loaded';
        },
        task: async () => {
          await unloadAgent();
        },
      },
      {
        title: 'Loading agent',
        task: async () => {
          await loadAgent();
        },
      },
      {
        title: 'Verifying agent is running',
        task: async (_ctx, task) => {
          await new Promise((r) => setTimeout(r, 2000));
          const pid = await getAgentPid();
          if (pid) {
            task.output = `Agent running (PID ${pid})`;
          } else {
            const loaded = await isAgentLoaded();
            if (loaded) {
              task.output = 'Agent loaded (process starting...)';
            } else {
              throw new Error('Agent failed to load. Check logs with: portlama-agent logs');
            }
          }
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Saving configuration',
        task: async () => {
          const domainMatch = ctx.plistXml.match(/wss:\/\/tunnel\.([^:]+):/);
          ctx.domain = domainMatch ? domainMatch[1] : null;

          await saveAgentConfig({
            panelUrl: ctx.panelUrl,
            authMethod: 'keychain',
            keychainIdentity: ctx.keychainIdentity,
            agentLabel: ctx.agentLabel,
            domain: ctx.domain,
            chiselVersion: ctx.chiselVersion,
            setupAt: new Date().toISOString(),
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
    // Securely delete the temporary private key if it was generated but not
    // yet imported into Keychain (importIdentityToKeychain handles its own cleanup).
    if (ctx._keyData?.keyPath) {
      await secureDelete(ctx._keyData.keyPath).catch(() => {});
    }
    throw err;
  }

  // Print summary
  printSetupSummary(ctx);
}

/**
 * Traditional P12-based setup flow.
 */
async function runP12Setup() {
  // Step 1: Verify macOS
  assertMacOS();

  // Check for existing config
  const existingConfig = await loadAgentConfig();
  if (existingConfig) {
    console.log('');
    console.log(chalk.yellow('  An existing agent configuration was found.'));
    console.log(chalk.yellow('  Running setup again will overwrite it.'));
    console.log('');
  }

  // Step 2: Prompt credentials
  console.log('');
  console.log(chalk.bold('  Portlama Agent Setup'));
  console.log(chalk.dim('  Connect this Mac to your Portlama server.'));
  console.log('');
  console.log(chalk.dim('  The admin must generate an agent certificate from the panel first:'));
  console.log(chalk.dim('    Panel → Certificates → Agent Certificates → Generate'));
  console.log('');

  const panelUrl = await prompt('Panel URL (e.g. https://1.2.3.4:9292)', existingConfig?.panelUrl);
  if (!panelUrl) {
    throw new Error('Panel URL is required.');
  }

  // Normalize URL: strip trailing slash
  const normalizedUrl = panelUrl.replace(/\/+$/, '');

  const defaultP12 = existingConfig?.p12Path || './agent.p12';
  const p12Input = await prompt('Path to agent certificate (.p12)', defaultP12);
  const p12Path = resolve(p12Input);

  if (!existsSync(p12Path)) {
    throw new Error(`client.p12 not found at: ${p12Path}`);
  }

  const p12Password = await prompt('P12 password');
  if (!p12Password) {
    throw new Error('P12 password is required.');
  }

  console.log('');

  // Context shared across tasks
  const ctx = {
    panelUrl: normalizedUrl,
    p12Path,
    p12Password,
    chiselVersion: null,
    plistXml: null,
    domain: null,
    tunnels: [],
  };

  const tasks = new Listr(
    [
      {
        title: 'Creating directories',
        task: async () => {
          await mkdir(CHISEL_BIN_DIR, { recursive: true });
          await mkdir(LOGS_DIR, { recursive: true });
        },
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
          // Clean up temporary PEM cert/key files — they are only needed transiently
          await cleanupPemFiles(pem);
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Verifying panel connectivity',
        task: async (_ctx, task) => {
          const health = await fetchHealth(ctx.panelUrl, ctx.p12Path, ctx.p12Password);
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
          const data = await fetchPlist(ctx.panelUrl, ctx.p12Path, ctx.p12Password);
          ctx.plistXml = data.plist;

          // Also fetch tunnel list for the summary
          const tunnelData = await fetchTunnels(ctx.panelUrl, ctx.p12Path, ctx.p12Password);
          ctx.tunnels = tunnelData.tunnels || [];
          task.output = `${ctx.tunnels.length} tunnel(s) configured`;
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Rewriting plist paths',
        task: async () => {
          ctx.plistXml = rewritePlist(ctx.plistXml);
        },
      },
      {
        title: 'Writing plist file',
        task: async () => {
          await writePlistFile(ctx.plistXml);
        },
      },
      {
        title: 'Unloading previous agent',
        skip: async () => {
          const loaded = await isAgentLoaded();
          return !loaded && 'No previous agent loaded';
        },
        task: async () => {
          await unloadAgent();
        },
      },
      {
        title: 'Loading agent',
        task: async () => {
          await loadAgent();
        },
      },
      {
        title: 'Verifying agent is running',
        task: async (_ctx, task) => {
          // Give launchd a moment to start the process
          await new Promise((r) => setTimeout(r, 2000));
          const pid = await getAgentPid();
          if (pid) {
            task.output = `Agent running (PID ${pid})`;
          } else {
            const loaded = await isAgentLoaded();
            if (loaded) {
              task.output = 'Agent loaded (process starting...)';
            } else {
              throw new Error('Agent failed to load. Check logs with: portlama-agent logs');
            }
          }
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Saving configuration',
        task: async () => {
          // Extract domain from the plist (look for wss://tunnel.<domain>)
          const domainMatch = ctx.plistXml.match(/wss:\/\/tunnel\.([^:]+):/);
          ctx.domain = domainMatch ? domainMatch[1] : null;

          await saveAgentConfig({
            panelUrl: ctx.panelUrl,
            authMethod: 'p12',
            p12Path: ctx.p12Path,
            p12Password: ctx.p12Password,
            domain: ctx.domain,
            chiselVersion: ctx.chiselVersion,
            setupAt: new Date().toISOString(),
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

  // Print summary
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
    c('  ║') + `  ${g.bold('Portlama Agent installed successfully!')}` + ' '.repeat(17) + c('║'),
  );
  console.log(c('  ╠══════════════════════════════════════════════════════════╣'));

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
      `    ${d('portlama-agent status')}    ${d('— check agent health')}` +
      ' '.repeat(11) +
      c('║'),
  );
  console.log(
    c('  ║') +
      `    ${d('portlama-agent logs')}      ${d('— stream chisel logs')}` +
      ' '.repeat(11) +
      c('║'),
  );
  console.log(
    c('  ║') +
      `    ${d('portlama-agent update')}    ${d('— refresh tunnel config')}` +
      ' '.repeat(8) +
      c('║'),
  );
  console.log(
    c('  ║') +
      `    ${d('portlama-agent uninstall')} ${d('— remove everything')}` +
      ' '.repeat(12) +
      c('║'),
  );
  console.log(c('  ║') + ' '.repeat(58) + c('║'));
  console.log(c('  ╚══════════════════════════════════════════════════════════╝'));
  console.log('');
}
