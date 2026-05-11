// ============================================================================
// VM Tools — thin MCP wrappers, delegate to lamaste-e2e CLI
// ============================================================================

import { z } from 'zod';
import { runE2eCommand } from '../subprocess.js';
import { ROLE_NAMES, PROFILE_NAMES, DEFAULT_PROFILE } from '../project-config.js';

const roleItemSchema = ROLE_NAMES.length > 0 ? z.enum(ROLE_NAMES) : z.string().min(1);

const profileSchema =
  PROFILE_NAMES.length > 0
    ? z.enum(PROFILE_NAMES).describe('Resource profile for the VMs')
    : z.string().min(1).describe('Resource profile for the VMs');

// Default profile: profile flagged `default: true` in e2e.config.json,
// falling back to the first declared profile.
const defaultProfile = DEFAULT_PROFILE;

export const vmCreateTool = {
  name: 'vm_create',
  description:
    'Create E2E test VMs from roles defined in e2e.config.json. ' +
    'Specify a profile or let env_detect recommend one. ' +
    'Optionally create only specific VMs with the "vms" parameter.',
  inputSchema: z.object({
    profile: defaultProfile ? profileSchema.default(defaultProfile) : profileSchema.optional(),
    vms: z.array(roleItemSchema).optional().describe('Which VMs to create (default: all roles)'),
  }),
  async handler({ profile, vms } = {}) {
    const args = ['vm', 'create'];
    if (profile) args.push('--profile', profile);
    if (vms) args.push('--vms', vms.join(','));
    return runE2eCommand(args, { timeout: 600_000 });
  },
};

export const vmListTool = {
  name: 'vm_list',
  description: 'List all Multipass VMs with their state, IP, and resource profile.',
  inputSchema: z.object({}),
  async handler() {
    return runE2eCommand(['vm', 'list']);
  },
};

export const vmDeleteTool = {
  name: 'vm_delete',
  description: 'Delete E2E test VMs. Specify which VMs or delete all roles.',
  inputSchema: z.object({
    vms: z.array(roleItemSchema).optional().describe('Which VMs to delete (default: all roles)'),
  }),
  async handler({ vms } = {}) {
    const args = ['vm', 'delete'];
    if (vms) args.push('--vms', vms.join(','));
    return runE2eCommand(args);
  },
};

export const vmExecTool = {
  name: 'vm_exec',
  description:
    'Execute a command on a specific VM. Returns stdout, stderr, and exit code. ' +
    'Use for debugging or ad-hoc inspection.',
  inputSchema: z.object({
    vm: roleItemSchema.describe('Which VM role to run on'),
    command: z.string().min(1).describe('Shell command to execute'),
    sudo: z.coerce.boolean().default(false).describe('Run with sudo'),
    timeout: z.coerce.number().default(30000).describe('Timeout in milliseconds (default: 30s)'),
  }),
  async handler(params = {}) {
    const args = ['vm', 'exec', '--vm', params.vm, '--command', params.command];
    if (params.sudo) args.push('--sudo');
    if (params.timeout) args.push('--timeout', String(params.timeout));
    return runE2eCommand(args, { timeout: (params.timeout || 30000) + 10000 });
  },
};
