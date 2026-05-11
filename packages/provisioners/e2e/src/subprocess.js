// ============================================================================
// Subprocess helper — spawns lamaste-e2e CLI with --json and parses NDJSON
// ============================================================================

import { execa } from 'execa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Resolve the lamaste-e2e CLI binary path. */
function resolveBin() {
  // Prefer the workspace-linked binary (works in monorepo without global install)
  return path.resolve(__dirname, '..', '..', '..', 'tools', 'e2e', 'bin', 'lamaste-e2e.js');
}

/**
 * Spawn `lamaste-e2e ... --json` and return the last complete/error event
 * as an MCP tool response.
 *
 * @param {string[]} args — CLI arguments (without --json, it's added automatically)
 * @param {{ timeout?: number }} options
 * @returns {Promise<{ content: Array<{ type: string, text: string }> }>}
 */
export async function runE2eCommand(args, { timeout = 600_000 } = {}) {
  const bin = resolveBin();

  const result = await execa('node', [bin, ...args, '--json'], {
    all: true,
    timeout,
    reject: false,
  });

  const output = result.all || '';
  const lines = output.split('\n').filter(Boolean);

  // Find the last complete or error event
  let lastEvent = null;
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.event === 'complete' || event.event === 'error') {
        lastEvent = event;
      }
    } catch {
      // Skip non-JSON lines (e.g., stderr leakage)
    }
  }

  if (!lastEvent) {
    // No structured event found — return raw output
    return {
      content: [{ type: 'text', text: output || `Process exited with code ${result.exitCode}` }],
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(lastEvent, null, 2) }],
  };
}
