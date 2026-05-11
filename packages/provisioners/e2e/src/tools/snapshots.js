// ============================================================================
// Snapshot Tools — thin MCP wrappers, delegate to lamaste-e2e CLI
// ============================================================================

import { z } from 'zod';
import { runE2eCommand } from '../subprocess.js';
import { ROLE_NAMES, TIER_NAMES } from '../project-config.js';

const roleItemSchema = ROLE_NAMES.length > 0 ? z.enum(ROLE_NAMES) : z.string().min(1);

const tierSchema =
  TIER_NAMES.length > 0
    ? z
        .enum(TIER_NAMES)
        .describe(
          'Tier name — auto-generates snapshot name as "tier-<tierName>" and records in state',
        )
    : z.string().min(1).describe('Tier name');

export const snapshotCreateTool = {
  name: 'snapshot_create',
  description:
    'Create a named snapshot of one or all VMs. Use checkpoint names like ' +
    '"post-create" or "post-setup" for standard save-points, a tier name for ' +
    'tier snapshots, or any custom name.',
  inputSchema: z.object({
    name: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
      .optional()
      .describe('Snapshot name (e.g. "post-setup"). Required unless tier is set.'),
    tier: tierSchema.optional(),
    vms: z.array(roleItemSchema).optional().describe('Which VMs to snapshot (default: all roles)'),
  }),
  async handler({ name, tier, vms } = {}) {
    const args = ['snapshot', 'create'];
    if (name) args.push('--name', name);
    if (tier) args.push('--tier', tier);
    if (vms) args.push('--vms', vms.join(','));
    return runE2eCommand(args, { timeout: 600_000 });
  },
};

export const snapshotRestoreTool = {
  name: 'snapshot_restore',
  description:
    'Restore one or all VMs to a named snapshot. This resets the VM to the ' +
    'exact state when the snapshot was taken — much faster than reprovisioning. ' +
    'Use "tier" param for tier-aware restores that update VM tier state.',
  inputSchema: z.object({
    name: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
      .optional()
      .describe('Snapshot name to restore. Required unless tier is set.'),
    tier: tierSchema.optional(),
    vms: z.array(roleItemSchema).optional().describe('Which VMs to restore (default: all roles)'),
  }),
  async handler({ name, tier, vms } = {}) {
    const args = ['snapshot', 'restore'];
    if (name) args.push('--name', name);
    if (tier) args.push('--tier', tier);
    if (vms) args.push('--vms', vms.join(','));
    return runE2eCommand(args, { timeout: 600_000 });
  },
};

export const snapshotListTool = {
  name: 'snapshot_list',
  description:
    'List all available snapshots across VMs, plus known checkpoint descriptions and tier state.',
  inputSchema: z.object({}),
  async handler() {
    return runE2eCommand(['snapshot', 'list']);
  },
};
