import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { execa } from 'execa';
import WebSocket from 'ws';
import { AGENT_DIR } from '../lib/platform.js';
import { requireAgentConfig } from '../lib/config.js';
import { fetchAgentStatus } from '../lib/panel-api.js';
import { extractPemFromP12, buildWsUrl, buildWsTlsOptions } from '../lib/ws-helpers.js';

const RECORDINGS_DIR = path.join(AGENT_DIR, 'shell-recordings');
const BLOCKLIST_PATH = path.join(AGENT_DIR, 'shell-blocklist.json');
const PORTLAMA_SHELL_PATH = path.join(AGENT_DIR, 'portlama-shell.sh');
const TMUX_SESSION_NAME = 'portlama-shell';
const POLL_INTERVAL_MS = 10_000;
const RECONNECT_DELAY_MS = 5_000;

/**
 * Install the portlama-shell wrapper script to ~/.portlama/.
 * Copies from the bundled template in src/lib/.
 */
async function installShellWrapper() {
  const srcPath = new URL('../lib/portlama-shell.sh', import.meta.url).pathname;
  if (!existsSync(srcPath)) {
    throw new Error(`Shell wrapper template not found at ${srcPath}`);
  }
  const content = await readFile(srcPath, 'utf8');
  const tmp = PORTLAMA_SHELL_PATH + '.tmp';
  await writeFile(tmp, content, { encoding: 'utf8', mode: 0o755 });
  await rename(tmp, PORTLAMA_SHELL_PATH);
}

/**
 * Write the command blocklist file for the shell wrapper.
 * Transforms the server blocklist format (hardBlocked + restricted map)
 * into the format portlama-shell.sh expects (hardBlocked, blockedPatterns,
 * restrictedPrefixes).
 * @param {{ hardBlocked?: string[], restricted?: Record<string, boolean> }} blocklist
 */
async function writeBlocklist(blocklist) {
  await mkdir(AGENT_DIR, { recursive: true });
  const shellBlocklist = {
    hardBlocked: blocklist.hardBlocked || [],
    blockedPatterns: [], // server doesn't use regex patterns yet
    restrictedPrefixes: Object.entries(blocklist.restricted || {})
      .filter(([, allowed]) => !allowed)
      .map(([cmd]) => cmd),
  };
  const tmp = BLOCKLIST_PATH + '.tmp';
  await writeFile(tmp, JSON.stringify(shellBlocklist, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(tmp, BLOCKLIST_PATH);
}

/**
 * Kill any existing portlama-shell tmux session.
 */
async function killTmuxSession() {
  try {
    await execa('tmux', ['kill-session', '-t', TMUX_SESSION_NAME]);
  } catch {
    // Session may not exist — that is fine
  }
}

/**
 * Spawn a tmux session for the shell gateway.
 * @param {string} sessionId - Unique session identifier for recording
 * @returns {Promise<string>} - The session ID
 */
async function spawnTmuxSession(sessionId) {
  await mkdir(RECORDINGS_DIR, { recursive: true });
  await killTmuxSession();

  // Spawn a new detached tmux session with the portlama-shell wrapper
  const shellCmd = existsSync(PORTLAMA_SHELL_PATH) ? PORTLAMA_SHELL_PATH : '/bin/bash';
  await execa('tmux', [
    'new-session',
    '-d',
    '-s',
    TMUX_SESSION_NAME,
    '-x',
    '120',
    '-y',
    '40',
    shellCmd,
  ]);

  // Enable session recording via pipe-pane
  const recordingFile = path.join(RECORDINGS_DIR, `${sessionId}.log`);
  await execa('tmux', [
    'pipe-pane',
    '-t',
    TMUX_SESSION_NAME,
    `cat >> '${recordingFile.replace(/'/g, "'\\''")}'`,
  ]);

  return sessionId;
}

/**
 * Read current tmux pane content and return it.
 * Uses capture-pane to get the visible buffer.
 * @returns {Promise<string>}
 */
async function captureTmuxOutput() {
  try {
    const { stdout } = await execa('tmux', [
      'capture-pane',
      '-t',
      TMUX_SESSION_NAME,
      '-p',
      '-S',
      '-',
    ]);
    return stdout;
  } catch {
    return '';
  }
}

/**
 * Send keystrokes to the tmux session.
 * @param {string} data - Raw input data from the WebSocket
 */
async function sendToTmux(data) {
  // Use send-keys with literal flag to send exact characters
  await execa('tmux', ['send-keys', '-t', TMUX_SESSION_NAME, '-l', data]);
}

/** Strict allowlist of permitted tmux special key names. */
const ALLOWED_SPECIAL_KEYS = new Set([
  'Enter',
  'Escape',
  'C-c',
  'C-d',
  'C-z',
  'Tab',
  'Up',
  'Down',
  'Left',
  'Right',
  'BSpace',
  'DC',
  'Home',
  'End',
  'PPage',
  'NPage',
]);

/**
 * Send a special key (like Enter, Ctrl-C) to the tmux session.
 * Only keys in the allowlist are accepted to prevent injection.
 * @param {string} key - tmux key name
 */
async function sendSpecialKey(key) {
  if (!ALLOWED_SPECIAL_KEYS.has(key)) {
    throw new Error(`Rejected special key not in allowlist: ${key}`);
  }
  await execa('tmux', ['send-keys', '-t', TMUX_SESSION_NAME, key]);
}

/**
 * Resize the tmux session.
 * @param {number} cols
 * @param {number} rows
 */
async function resizeTmux(cols, rows) {
  try {
    await execa('tmux', [
      'resize-window',
      '-t',
      TMUX_SESSION_NAME,
      '-x',
      String(cols),
      '-y',
      String(rows),
    ]);
  } catch {
    // May fail if tmux version doesn't support resize-window
  }
}

/**
 * Connect to the panel WebSocket relay and pipe data to/from tmux.
 * @param {object} config - Agent config
 * @param {string} agentLabel - Agent label from shell config
 * @param {object} pem - PEM cert/key paths
 */
async function connectRelay(config, agentLabel, pem) {
  const sessionId = randomUUID();
  const wsUrl = buildWsUrl(config.panelUrl, `/api/shell/agent/${encodeURIComponent(agentLabel)}`);

  console.log(chalk.dim(`  Connecting to relay: ${wsUrl}`));

  const ws = new WebSocket(wsUrl, buildWsTlsOptions(pem));

  let tmuxStarted = false;
  let outputPoller = null;
  let lastOutput = '';

  ws.on('open', () => {
    console.log(chalk.green('  Connected to panel relay.'));
    console.log(chalk.dim('  Waiting for admin to connect...'));

    // Send ready message
    ws.send(JSON.stringify({ type: 'agent-ready', label: agentLabel }));
  });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      // Binary data — treat as raw input
      if (tmuxStarted) {
        try {
          await sendToTmux(raw.toString());
        } catch (err) {
          console.error(chalk.red(`  Failed to send to tmux: ${err.message}`));
        }
      }
      return;
    }

    switch (msg.type) {
      case 'admin-connected': {
        // Admin has connected — spawn tmux session
        if (!tmuxStarted) {
          try {
            await spawnTmuxSession(sessionId);
            tmuxStarted = true;
            console.log(chalk.green(`  Session started: ${sessionId}`));

            // Start polling tmux output and sending to WebSocket
            outputPoller = setInterval(async () => {
              try {
                const output = await captureTmuxOutput();
                if (output !== lastOutput) {
                  lastOutput = output;
                  ws.send(JSON.stringify({ type: 'output', data: output }));
                }
              } catch {
                // tmux may have died
              }
            }, 100);

            ws.send(JSON.stringify({ type: 'session-started', sessionId }));
          } catch (err) {
            console.error(chalk.red(`  Failed to start tmux: ${err.message}`));
            ws.send(JSON.stringify({ type: 'error', message: 'Failed to start shell session' }));
          }
        }
        break;
      }

      case 'input': {
        if (tmuxStarted && msg.data) {
          try {
            await sendToTmux(msg.data);
          } catch (err) {
            console.error(chalk.red(`  Failed to send to tmux: ${err.message}`));
          }
        }
        break;
      }

      case 'special-key': {
        if (tmuxStarted && msg.key) {
          try {
            await sendSpecialKey(msg.key);
          } catch (err) {
            console.error(chalk.red(`  Failed to send special key: ${err.message}`));
          }
        }
        break;
      }

      case 'resize': {
        if (tmuxStarted && msg.cols && msg.rows) {
          const cols = Number(msg.cols);
          const rows = Number(msg.rows);
          if (
            Number.isInteger(cols) &&
            Number.isInteger(rows) &&
            cols >= 1 &&
            cols <= 500 &&
            rows >= 1 &&
            rows <= 500
          ) {
            await resizeTmux(cols, rows);
          }
        }
        break;
      }

      case 'admin-disconnected': {
        console.log(chalk.yellow('  Admin disconnected.'));
        if (outputPoller) {
          clearInterval(outputPoller);
          outputPoller = null;
        }
        if (tmuxStarted) {
          await killTmuxSession();
          tmuxStarted = false;
          lastOutput = '';
        }
        console.log(chalk.dim('  Waiting for admin to reconnect...'));
        break;
      }

      case 'time-window-expired': {
        console.log(chalk.yellow('  Shell access time window expired.'));
        if (outputPoller) {
          clearInterval(outputPoller);
          outputPoller = null;
        }
        if (tmuxStarted) {
          await killTmuxSession();
          tmuxStarted = false;
        }
        ws.close(1000, 'Time window expired');
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', (code, reason) => {
    console.log(chalk.dim(`  WebSocket closed: ${code} ${reason || ''}`));
    if (outputPoller) {
      clearInterval(outputPoller);
      outputPoller = null;
    }
    if (tmuxStarted) {
      killTmuxSession().catch(() => {});
      tmuxStarted = false;
    }
  });

  ws.on('error', (err) => {
    console.error(chalk.red(`  WebSocket error: ${err.message}`));
  });

  // Return a promise that resolves when the WebSocket closes
  return new Promise((resolve) => {
    ws.on('close', () => resolve());
  });
}

/**
 * Clean up temporary PEM files.
 * @param {object} pem
 */
async function cleanupPem(pem) {
  try {
    if (pem.certPath) await unlink(pem.certPath);
    if (pem.keyPath) await unlink(pem.keyPath);
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Run the shell server: poll for shell config, connect when enabled.
 */
export async function runShellServer() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    console.error(
      `Unsupported platform: ${process.platform}. Shell server requires macOS or Linux.`,
    );
    process.exit(1);
  }
  const config = await requireAgentConfig();

  console.log('');
  console.log(chalk.bold('  Portlama Shell Server'));
  console.log(chalk.dim('  ─'.repeat(28)));

  // Verify tmux is installed
  try {
    await execa('which', ['tmux']);
  } catch {
    console.error(chalk.red('  tmux is not installed.'));
    console.error('');
    if (process.platform === 'darwin') {
      console.error(chalk.dim('  Install with: brew install tmux'));
    } else {
      console.error(chalk.dim('  Install with: sudo apt install tmux'));
    }
    console.error('');
    console.error(chalk.dim('  tmux is required for remote shell sessions.'));
    process.exit(1);
  }

  // WebSocket requires PEM cert/key — not available with Keychain-bound keys
  if (config.authMethod === 'keychain') {
    console.error(chalk.red('  Shell server is not yet supported with hardware-bound (Keychain) certificates.'));
    console.error(chalk.dim('  Use a P12-enrolled agent for shell access.'));
    process.exit(1);
  }

  // Extract PEM certificates from p12
  let pem;
  try {
    pem = await extractPemFromP12(config.p12Path, config.p12Password);
    console.log(chalk.dim('  Extracted mTLS certificates.'));
  } catch (err) {
    console.error(chalk.red(`  Failed to extract certificates: ${err.message}`));
    process.exit(1);
  }

  // Install the shell wrapper script
  try {
    await installShellWrapper();
    console.log(chalk.dim('  Shell wrapper installed.'));
  } catch (err) {
    console.error(chalk.yellow(`  Could not install shell wrapper: ${err.message}`));
    console.log(chalk.dim('  Falling back to /bin/bash for shell sessions.'));
  }

  // Handle graceful shutdown
  let running = true;
  const shutdown = async () => {
    running = false;
    console.log(chalk.dim('\n  Shutting down shell server...'));
    await killTmuxSession();
    await cleanupPem(pem);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(chalk.dim('  Polling for shell access configuration...'));
  console.log('');

  // Main loop: poll for agent status, connect when enabled
  while (running) {
    let agentStatus;
    try {
      agentStatus = await fetchAgentStatus(config);
    } catch (err) {
      console.error(chalk.yellow(`  Could not reach panel: ${err.message}`));
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!agentStatus.globalEnabled) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!agentStatus.shellEnabled) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const agentLabel = agentStatus.label;
    console.log(chalk.green(`  Shell access enabled for agent: ${agentLabel}`));

    // Write blocklist if provided
    if (agentStatus.commandBlocklist) {
      try {
        await writeBlocklist(agentStatus.commandBlocklist);
      } catch (err) {
        console.error(chalk.yellow(`  Failed to write blocklist: ${err.message}`));
      }
    }

    // Connect to the relay
    try {
      await connectRelay(config, agentLabel, pem);
    } catch (err) {
      console.error(chalk.red(`  Relay connection failed: ${err.message}`));
    }

    if (!running) break;

    // Reconnect after a delay
    console.log(chalk.dim(`  Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`));
    await sleep(RECONNECT_DELAY_MS);
  }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
