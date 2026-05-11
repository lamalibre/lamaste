// ============================================================================
// Test Tools — thin MCP wrappers, delegate to lamaste-e2e CLI
// ============================================================================

import { z } from 'zod';
import { runE2eCommand } from '../subprocess.js';
import { SUITE_NAMES, DEFAULT_DOMAIN, DEFAULT_SUITE } from '../project-config.js';

const defaultSuite = DEFAULT_SUITE;

const suiteSchema =
  SUITE_NAMES.length > 0
    ? z.enum(SUITE_NAMES).describe('Which test suite')
    : z.string().min(1).describe('Which test suite');

// test_run_all and test_list additionally accept 'all' — run every suite.
const suiteOrAllValues =
  SUITE_NAMES.length > 0 ? [...SUITE_NAMES, 'all'] : ['all'];
const suiteOrAllSchema = z
  .enum(suiteOrAllValues)
  .describe('Which suite(s) to run — a suite name or "all" for every suite');

const domainSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]+$/)
  .default(DEFAULT_DOMAIN)
  .describe('Test domain (defaults to project default)');

export const testRunTool = {
  name: 'test_run',
  description:
    'Run a specific test by number, automatically resolving its dependencies. ' +
    'Returns a compact summary with pass/fail and error lines only — no full logs. ' +
    'Use test_log to fetch full output for a specific test if needed.',
  inputSchema: z.object({
    test: z.coerce.number().int().min(1).describe('Test number to run (e.g. 11)'),
    suite: defaultSuite ? suiteSchema.default(defaultSuite) : suiteSchema,
    skipDeps: z
      .coerce.boolean()
      .default(false)
      .describe(
        'Skip dependency tests (use if you know prerequisites are met, e.g. from a snapshot)',
      ),
  }),
  async handler({ test, suite, skipDeps } = {}) {
    const args = ['test', 'run', String(test)];
    if (suite) args.push('--suite', suite);
    if (skipDeps) args.push('--skip-deps');
    return runE2eCommand(args, { timeout: 600_000 });
  },
};

export const testRunAllTool = {
  name: 'test_run_all',
  description:
    'Run all tests in a suite (any suite from e2e.config.json, or "all" to run every suite). ' +
    'Returns a compact summary — errors only for failed tests.',
  inputSchema: z.object({
    suite: suiteOrAllSchema.default('all'),
  }),
  async handler({ suite } = {}) {
    const args = ['test', 'run-all'];
    if (suite) args.push('--suite', suite);
    return runE2eCommand(args, { timeout: 600_000 });
  },
};

export const testListTool = {
  name: 'test_list',
  description:
    'List all available tests with their dependency graph and filenames.',
  inputSchema: z.object({
    suite: suiteOrAllSchema.default('all'),
  }),
  async handler({ suite } = {}) {
    const args = ['test', 'list'];
    if (suite) args.push('--suite', suite);
    return runE2eCommand(args);
  },
};

export const testResetTool = {
  name: 'test_reset',
  description:
    'Reset shared state between tests without reprovisioning. ' +
    'Runs the project-defined reset hooks.',
  inputSchema: z.object({}),
  async handler() {
    return runE2eCommand(['test', 'reset']);
  },
};

export const testPublishTool = {
  name: 'test_publish',
  description:
    'Run the full E2E suite with the production profile and write rich Markdown logs ' +
    'to the configured logs dir for committing. This is the final gate before shipping. ' +
    'VMs must be created with the production profile and provisioned first, then call ' +
    'with skipRecreate=true.',
  inputSchema: z.object({
    domain: domainSchema,
    skipRecreate: z
      .coerce.boolean()
      .default(false)
      .describe(
        'Skip VM recreation (use if VMs are already running with production profile)',
      ),
  }),
  async handler({ domain, skipRecreate } = {}) {
    const args = ['test', 'publish'];
    if (domain) args.push('--domain', domain);
    if (skipRecreate) args.push('--skip-recreate');
    return runE2eCommand(args, { timeout: 600_000 });
  },
};
