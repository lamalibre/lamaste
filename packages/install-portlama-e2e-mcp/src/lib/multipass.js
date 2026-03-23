// ============================================================================
// Multipass CLI wrapper
// ============================================================================
// All VM interactions go through this module. Uses execa with array arguments
// per project convention — no shell interpolation.

import { execa } from 'execa';

/**
 * Run a multipass command and return { stdout, stderr, exitCode }.
 * Throws on non-zero exit unless `allowFailure` is set.
 */
export async function run(args, { allowFailure = false, timeout = 120_000 } = {}) {
  try {
    const result = await execa('multipass', args, { timeout });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err) {
    if (allowFailure) {
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || err.message,
        exitCode: err.exitCode || 1,
      };
    }
    throw err;
  }
}

/** Launch a new VM with the given specs. */
export async function launch(name, { cpus, memory, disk }) {
  return run([
    'launch',
    '24.04',
    '--name',
    name,
    '--cpus',
    String(cpus),
    '--memory',
    memory,
    '--disk',
    disk,
  ]);
}

/** Delete a VM and purge only that VM (not other users' deleted VMs). */
export async function deleteVm(name) {
  await run(['delete', '--purge', name], { allowFailure: true });
}

/** Get info for a VM as JSON. Returns null if VM doesn't exist. */
export async function info(name) {
  const result = await run(['info', name, '--format', 'json'], {
    allowFailure: true,
  });
  if (result.exitCode !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/** Get the IPv4 address of a VM. Returns null if unavailable. */
export async function getIp(name) {
  const data = await info(name);
  if (!data?.info?.[name]?.ipv4?.[0]) return null;
  return data.info[name].ipv4[0];
}

/** List all VMs. Returns an array of { name, state, ipv4 }. */
export async function list() {
  const result = await run(['list', '--format', 'json'], {
    allowFailure: true,
  });
  if (result.exitCode !== 0) return [];
  try {
    const data = JSON.parse(result.stdout);
    return (data.list || []).map((vm) => ({
      name: vm.name,
      state: vm.state,
      ipv4: vm.ipv4?.[0] || null,
    }));
  } catch {
    return [];
  }
}

/** Execute a command on a VM. */
export async function exec(
  vmName,
  command,
  { sudo = false, timeout = 120_000, allowFailure = false } = {},
) {
  const args = ['exec', vmName, '--'];
  if (sudo) args.push('sudo');

  // command can be a string or array
  if (typeof command === 'string') {
    args.push('bash', '-c', command);
  } else if (Array.isArray(command)) {
    args.push(...command);
  } else {
    throw new Error(`exec: command must be a string or array, got ${typeof command}: ${JSON.stringify(command)}`);
  }

  return run(args, { allowFailure, timeout });
}

/** Transfer a file to a VM. */
export async function transfer(localPath, vmDest) {
  return run(['transfer', localPath, vmDest]);
}

/** Transfer a file from a VM to local. */
export async function transferFrom(vmSource, localPath) {
  return run(['transfer', vmSource, localPath]);
}

/** Create a snapshot of a VM. */
export async function snapshot(vmName, snapshotName) {
  return run(['snapshot', vmName, '--name', snapshotName]);
}

/** Restore a VM to a named snapshot. */
export async function restore(vmName, snapshotName) {
  return run(['restore', '--destructive', `${vmName}.${snapshotName}`]);
}

/** List snapshots for a VM. Returns array of snapshot names. */
export async function listSnapshots(vmName) {
  const result = await run(['list', '--snapshots', '--format', 'json'], {
    allowFailure: true,
  });
  if (result.exitCode !== 0) return [];
  try {
    const data = JSON.parse(result.stdout);
    // multipass list --snapshots --format json returns { "info": { "vm-name": { "snap-name": {...} } } }
    const vmInfo = data?.info?.[vmName];
    if (!vmInfo || typeof vmInfo !== 'object') return [];
    return Object.keys(vmInfo);
  } catch {
    return [];
  }
}

/** Delete a specific snapshot. */
export async function deleteSnapshot(vmName, snapshotName) {
  return run(['delete', `${vmName}.${snapshotName}`], { allowFailure: true });
}

/** Check if multipass is installed and running. */
export async function isAvailable() {
  const result = await run(['version'], { allowFailure: true });
  return result.exitCode === 0;
}
