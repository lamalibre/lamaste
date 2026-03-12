import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Listr } from 'listr2';
import chalk from 'chalk';
import { assertMacOS, CHISEL_BIN_DIR, LOGS_DIR } from '../lib/platform.js';
import { loadAgentConfig, saveAgentConfig } from '../lib/config.js';
import { fetchHealth, fetchPlist, fetchTunnels } from '../lib/panel-api.js';
import { installChisel } from '../lib/chisel.js';
import { rewritePlist, writePlistFile } from '../lib/plist.js';
import { isAgentLoaded, unloadAgent, loadAgent, getAgentPid } from '../lib/launchctl.js';

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
 * Run the interactive setup flow.
 */
export async function runSetup() {
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

  const panelUrl = await prompt(
    'Panel URL (e.g. https://1.2.3.4:9292)',
    existingConfig?.panelUrl,
  );
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
        title: 'Verifying panel connectivity',
        task: async (_ctx, task) => {
          const health = await fetchHealth(ctx.panelUrl, ctx.p12Path, ctx.p12Password);
          task.output = `Panel is reachable (status: ${health.status || 'ok'})`;
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Creating directories',
        task: async () => {
          await mkdir(CHISEL_BIN_DIR, { recursive: true });
          await mkdir(LOGS_DIR, { recursive: true });
        },
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
              throw new Error(
                'Agent failed to load. Check logs with: portlama-agent logs',
              );
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
  console.log(c('  ║') + `  ${g.bold('Portlama Agent installed successfully!')}` + ' '.repeat(17) + c('║'));
  console.log(c('  ╠══════════════════════════════════════════════════════════╣'));

  if (ctx.domain) {
    console.log(c('  ║') + `  ${b('Domain:')}  ${c(ctx.domain)}` + ' '.repeat(Math.max(0, 46 - ctx.domain.length)) + c('║'));
  }

  console.log(c('  ║') + `  ${b('Chisel:')}  ${ctx.chiselVersion}` + ' '.repeat(Math.max(0, 46 - (ctx.chiselVersion || '').length)) + c('║'));
  console.log(c('  ║') + `  ${b('Tunnels:')} ${ctx.tunnels.length} configured` + ' '.repeat(33) + c('║'));
  console.log(c('  ║') + ' '.repeat(58) + c('║'));

  if (ctx.tunnels.length > 0) {
    for (const t of ctx.tunnels) {
      const line = `${t.subdomain} → localhost:${t.port}`;
      console.log(c('  ║') + `    ${d('•')} ${line}` + ' '.repeat(Math.max(0, 54 - line.length)) + c('║'));
    }
    console.log(c('  ║') + ' '.repeat(58) + c('║'));
  }

  console.log(c('  ║') + `  ${b('Commands:')}` + ' '.repeat(47) + c('║'));
  console.log(c('  ║') + `    ${d('portlama-agent status')}    ${d('— check agent health')}` + ' '.repeat(11) + c('║'));
  console.log(c('  ║') + `    ${d('portlama-agent logs')}      ${d('— stream chisel logs')}` + ' '.repeat(11) + c('║'));
  console.log(c('  ║') + `    ${d('portlama-agent update')}    ${d('— refresh tunnel config')}` + ' '.repeat(8) + c('║'));
  console.log(c('  ║') + `    ${d('portlama-agent uninstall')} ${d('— remove everything')}` + ' '.repeat(12) + c('║'));
  console.log(c('  ║') + ' '.repeat(58) + c('║'));
  console.log(c('  ╚══════════════════════════════════════════════════════════╝'));
  console.log('');
}
