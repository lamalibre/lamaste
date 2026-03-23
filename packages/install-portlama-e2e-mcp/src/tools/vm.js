// ============================================================================
// VM Lifecycle Tools — vm_create, vm_list, vm_delete, vm_exec
// ============================================================================

import { z } from 'zod';
import * as mp from '../lib/multipass.js';
import { PROFILES, ALL_VMS, VM_NAME_MAP } from '../config.js';
import { setVmState, removeVmState, updateState } from '../lib/state.js';

export const vmCreateTool = {
  name: 'vm_create',
  description:
    'Create E2E test VMs (host, agent, visitor). ' +
    'Specify a profile (production/development/performance) or let env_detect recommend one. ' +
    'Optionally create only specific VMs with the "vms" parameter.',
  inputSchema: z.object({
    profile: z
      .enum(['production', 'development', 'performance'])
      .default('development')
      .describe('Resource profile for the VMs'),
    vms: z
      .array(z.enum(['host', 'agent', 'visitor']))
      .optional()
      .describe('Which VMs to create (default: all three)'),
  }),
  async handler({ profile, vms } = {}) {
    const p = profile || 'development';
    const specs = PROFILES[p];
    const targets = vms ? vms.map((v) => VM_NAME_MAP[v]) : ALL_VMS;

    const results = [];

    // Delete existing VMs in parallel (per-VM purge, won't affect other VMs)
    await Promise.all(
      targets.map(async (name) => {
        const existing = await mp.info(name);
        if (existing) {
          await mp.deleteVm(name);
          results.push(`Deleted existing ${name}`);
        }
      }),
    );

    // Create VMs in parallel
    await Promise.all(
      targets.map(async (name) => {
        await mp.launch(name, specs);
        const ip = await mp.getIp(name);
        setVmState(name, { ip, profile: p, state: 'running' });
        results.push(`Created ${name} (${ip}) — ${specs.cpus} CPU, ${specs.memory} RAM`);
      }),
    );

    updateState({ profile: p });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { ok: true, profile: p, specs, created: results },
            null,
            2,
          ),
        },
      ],
    };
  },
};

export const vmListTool = {
  name: 'vm_list',
  description: 'List all Multipass VMs with their state, IP, and resource profile.',
  inputSchema: z.object({}),
  async handler() {
    const allVms = await mp.list();
    const e2eVms = allVms.filter((vm) => ALL_VMS.includes(vm.name));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ vms: e2eVms, total: allVms.length }, null, 2),
        },
      ],
    };
  },
};

export const vmDeleteTool = {
  name: 'vm_delete',
  description:
    'Delete E2E test VMs. Specify which VMs or delete all three.',
  inputSchema: z.object({
    vms: z
      .array(z.enum(['host', 'agent', 'visitor']))
      .optional()
      .describe('Which VMs to delete (default: all three)'),
  }),
  async handler({ vms } = {}) {
    const targets = vms ? vms.map((v) => VM_NAME_MAP[v]) : ALL_VMS;

    // Delete VMs in parallel (per-VM purge, won't affect other VMs)
    await Promise.all(
      targets.map(async (name) => {
        await mp.deleteVm(name);
        removeVmState(name);
      }),
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { ok: true, deleted: targets },
            null,
            2,
          ),
        },
      ],
    };
  },
};

export const vmExecTool = {
  name: 'vm_exec',
  description:
    'Execute a command on a specific VM. Returns stdout, stderr, and exit code. ' +
    'Use for debugging or ad-hoc inspection.',
  inputSchema: z.object({
    vm: z.enum(['host', 'agent', 'visitor']).describe('Which VM to run on'),
    command: z.string().min(1).describe('Shell command to execute'),
    sudo: z.coerce.boolean().default(false).describe('Run with sudo'),
    timeout: z
      .coerce.number()
      .default(30000)
      .describe('Timeout in milliseconds (default: 30s)'),
  }),
  async handler(params = {}) {
    const vm = params.vm;
    const command = String(params.command || '');
    const sudo = params.sudo ?? false;
    const timeout = params.timeout || 30000;
    const vmName = VM_NAME_MAP[vm];

    if (!vmName) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: `Unknown VM "${vm}"` }, null, 2),
        }],
      };
    }

    const result = await mp.exec(vmName, command, {
      sudo,
      timeout,
      allowFailure: true,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              vm: vmName,
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};
