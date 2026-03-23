import chalk from 'chalk';
import WebSocket from 'ws';
import { requireAgentConfig } from '../lib/config.js';
import { extractPemFromP12, buildWsUrl, buildWsTlsOptions } from '../lib/ws-helpers.js';

/**
 * Run the interactive shell client.
 * Connects to a remote agent's shell via the panel WebSocket relay.
 * @param {string[]} args
 */
export async function runShell(args) {
  const config = await requireAgentConfig();

  const agentLabel = args[0];
  if (!agentLabel) {
    console.error(`\n  Usage: ${chalk.cyan('portlama-agent shell <agent-label>')}\n`);
    process.exit(1);
  }

  console.log('');
  console.log(chalk.dim(`  Connecting to agent ${chalk.bold(agentLabel)}...`));

  // WebSocket requires PEM cert/key — not available with Keychain-bound keys
  if (config.authMethod === 'keychain') {
    console.error(chalk.red('\n  Shell access is not yet supported with hardware-bound (Keychain) certificates.'));
    console.error(chalk.dim('  Use a P12-enrolled agent for shell access.\n'));
    process.exit(1);
  }

  // Extract PEM certificates from p12
  let pem;
  try {
    pem = await extractPemFromP12(config.p12Path, config.p12Password);
  } catch (err) {
    console.error(chalk.red(`\n  Failed to extract certificates: ${err.message}\n`));
    process.exit(1);
  }

  const wsUrl = buildWsUrl(config.panelUrl, `/api/shell/connect/${encodeURIComponent(agentLabel)}`);

  const ws = new WebSocket(wsUrl, buildWsTlsOptions(pem));

  let connected = false;
  let rawModeSet = false;

  /**
   * Restore terminal state and exit.
   * @param {number} [code=0]
   */
  const cleanup = (code = 0) => {
    if (rawModeSet && process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000);
    }
    console.log('');
    process.exit(code);
  };

  ws.on('open', () => {
    console.log(chalk.green(`  Connected to ${agentLabel}.`));
    console.log(chalk.dim('  Waiting for shell session to start...'));
    console.log(chalk.dim('  Press Ctrl+] to disconnect.'));
    console.log('');
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      // Binary data — write directly to stdout
      process.stdout.write(raw);
      return;
    }

    switch (msg.type) {
      case 'session-started': {
        connected = true;
        console.log(chalk.green(`  Shell session started (${msg.sessionId}).`));
        console.log('');

        // Enter raw mode for interactive terminal
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
          rawModeSet = true;
        }
        process.stdin.resume();
        process.stdin.setEncoding('utf8');

        process.stdin.on('data', (data) => {
          // Ctrl+] (0x1d) to disconnect
          if (data === '\x1d') {
            console.log(chalk.dim('\n  Disconnecting...'));
            cleanup(0);
            return;
          }

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input', data }));
          }
        });

        // Send initial terminal size
        if (process.stdout.isTTY) {
          const [cols, rows] = [process.stdout.columns, process.stdout.rows];
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }

        // Handle terminal resize events
        process.stdout.on('resize', () => {
          if (ws.readyState === WebSocket.OPEN) {
            const [cols, rows] = [process.stdout.columns, process.stdout.rows];
            ws.send(JSON.stringify({ type: 'resize', cols, rows }));
          }
        });

        break;
      }

      case 'output': {
        if (msg.data) {
          // Clear screen and write full pane content for clean rendering
          process.stdout.write('\x1b[2J\x1b[H');
          process.stdout.write(msg.data);
        }
        break;
      }

      case 'agent-disconnected': {
        console.log(chalk.yellow('\n  Agent disconnected.'));
        cleanup(1);
        break;
      }

      case 'time-window-expired': {
        console.log(chalk.yellow('\n  Shell access time window has expired.'));
        cleanup(0);
        break;
      }

      case 'error': {
        console.error(chalk.red(`\n  Error: ${msg.message}`));
        cleanup(1);
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', (code, reason) => {
    if (!connected) {
      console.error(
        chalk.red(`\n  Connection failed: ${reason || 'agent may not be available'}\n`),
      );
    }
    cleanup(code === 1000 ? 0 : 1);
  });

  ws.on('error', (err) => {
    console.error(chalk.red(`\n  Connection error: ${err.message}\n`));
    cleanup(1);
  });

  // Keep the process alive — the event handlers above manage lifecycle
  await new Promise(() => {});
}
