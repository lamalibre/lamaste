#!/usr/bin/env node

/**
 * Entry point for the agent panel HTTP daemon.
 *
 * Parses --port and --label from process.argv (no CLI framework needed —
 * this binary only serves HTTP, it has no subcommands or interactive UI).
 */

import { startPanelServer } from '../src/server.js';
import { validateLabel } from '@lamalibre/lamaste/agent';

function parseArgs(argv) {
  let port = 9393;
  let label = '';

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' && i + 1 < argv.length) {
      const parsed = Number(argv[++i]);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        process.stderr.write(`Invalid port: ${argv[i]}\n`);
        process.exit(1);
      }
      port = parsed;
    } else if (arg === '--label' && i + 1 < argv.length) {
      label = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'Usage: lamaste-agentd --label <label> [--port <port>]\n\n' +
          '  --label <label>  Agent label (required)\n' +
          '  --port <port>    HTTP server port (default: 9393)\n',
      );
      process.exit(0);
    } else {
      process.stderr.write(`Unknown argument: ${arg}\n`);
      process.exit(1);
    }
  }

  if (!label) {
    process.stderr.write('Error: --label is required\n');
    process.exit(1);
  }

  // Defense-in-depth: validate the label shape before it is interpolated into
  // any filesystem path (~/.lamalibre/lamaste/agents/<label>/...) or service unit name.
  try {
    validateLabel(label);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid label';
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }

  return { port, label };
}

const { port, label } = parseArgs(process.argv);

try {
  await startPanelServer(label, { port });
} catch (error) {
  const msg = error instanceof Error ? error.message : 'Unknown error';
  process.stderr.write(`\n  Lamaste Agent Daemon failed.\n  Error: ${msg}\n\n`);
  process.exit(1);
}
