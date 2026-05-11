// ============================================================================
// Status & Log Tools — thin MCP wrappers, delegate to lamaste-e2e CLI
// ============================================================================

import { z } from 'zod';
import { runE2eCommand } from '../subprocess.js';

export const envStatusTool = {
  name: 'env_status',
  description:
    'Full environment health check: are VMs running? Are services up? ' +
    'What profile are they using? Are there snapshots available? ' +
    'What was the last test run result?',
  inputSchema: z.object({}),
  async handler() {
    return runE2eCommand(['env', 'status']);
  },
};

export const testLogTool = {
  name: 'test_log',
  description:
    'Fetch the full raw log output for a specific test from an intermediate run. ' +
    'Use this after test_run shows a failure and you need the complete output to debug.',
  inputSchema: z.object({
    testName: z
      .string()
      .describe(
        'Test name (e.g. "01-onboarding-complete", "11-plugin-lifecycle")',
      ),
    runId: z
      .string()
      .optional()
      .describe('Run ID (default: most recent run)'),
  }),
  async handler({ testName, runId } = {}) {
    const args = ['log', 'show', testName];
    if (runId) args.push('--run', runId);
    return runE2eCommand(args);
  },
};
