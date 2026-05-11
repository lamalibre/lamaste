// ============================================================================
// Provisioning Tools — thin MCP wrappers, delegate to lamaste-e2e CLI
// ============================================================================

import { z } from 'zod';
import { runE2eCommand } from '../subprocess.js';
import { ROLE_NAMES, TIER_NAMES, PACKAGE_NAMES, DEFAULT_DOMAIN } from '../project-config.js';

const domainSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]+$/)
  .default(DEFAULT_DOMAIN)
  .describe('Test domain (defaults to project default)');

const tierSchema =
  TIER_NAMES.length > 0
    ? z.enum(TIER_NAMES).describe('Target tier to reach')
    : z.string().min(1).describe('Target tier to reach');

const roleSchema =
  ROLE_NAMES.length > 0
    ? z.enum(ROLE_NAMES).describe('VM role name (must match a key in e2e.config.json vms)')
    : z.string().min(1).describe('VM role name');

const packageSchema =
  PACKAGE_NAMES.length > 0
    ? z.enum(PACKAGE_NAMES).describe('Which package to reload')
    : z.string().min(1).describe('Which package to reload');

// Pick last tier as the sensible "target" default when tiers are defined.
const defaultTier = TIER_NAMES.length > 0 ? TIER_NAMES[TIER_NAMES.length - 1] : undefined;

export const provisionTool = {
  name: 'provision',
  description:
    'Smart provisioning with layered snapshots. Restores from cached tier snapshots ' +
    'when possible, only runs stages that are needed. Auto-snapshots after each tier ' +
    'for fast future restores. Tiers are defined in e2e.config.json.',
  inputSchema: z.object({
    targetTier: defaultTier ? tierSchema.default(defaultTier) : tierSchema.optional(),
    domain: domainSchema,
    skipSnapshots: z.coerce
      .boolean()
      .default(false)
      .describe('Skip auto-snapshotting after each tier (faster but no cache)'),
    forceReprovision: z.coerce
      .boolean()
      .default(false)
      .describe('Ignore existing snapshots and reprovision from scratch'),
  }),
  async handler({ targetTier, domain, skipSnapshots, forceReprovision } = {}) {
    const args = ['provision'];
    if (targetTier) args.push('--tier', targetTier);
    if (domain) args.push('--domain', domain);
    if (skipSnapshots) args.push('--skip-snapshots');
    if (forceReprovision) args.push('--force');
    return runE2eCommand(args, { timeout: 600_000 });
  },
};

export const provisionRoleTool = {
  name: 'provision_role',
  description:
    'Provision a single role via the project hooks. Role must match a key in e2e.config.json vms.',
  inputSchema: z.object({
    role: roleSchema,
    domain: domainSchema,
  }),
  async handler({ role, domain } = {}) {
    const args = ['provision', role];
    if (domain) args.push('--domain', domain);
    return runE2eCommand(args, { timeout: 600_000 });
  },
};

export const hotReloadTool = {
  name: 'hot_reload',
  description:
    'Re-pack a specific workspace package, transfer it to the target VM, and restart ' +
    'the relevant service. Much faster than full reprovisioning — use during iteration. ' +
    'Package list comes from e2e.config.json packages map.',
  inputSchema: z.object({
    package: packageSchema,
  }),
  async handler({ package: pkgName }) {
    return runE2eCommand(['reload', '--package', pkgName]);
  },
};
