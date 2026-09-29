/**
 * Chisel tunnel server lifecycle — key, start/stop/restart, status.
 *
 * The binary (the pinned release, digest-verified) and the systemd unit are
 * installed by create-lamaste as root; the panel never writes either. What
 * the panel manages runs as the lamaste user: the server key and the
 * authfile (see chisel-users.ts) are written with the group chisel runs as.
 *
 * Pure logic: accepts an `exec` function and resolved paths.
 */

import crypto from 'node:crypto';
import { chmod, lstat, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { normaliseChiselVersion } from '../chisel-download.js';
import { CHISEL_AUTHFILE_GROUP } from './chisel-users.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CHISEL_BIN = '/usr/local/bin/chisel';
export const CHISEL_SERVICE = 'chisel';

// ---------------------------------------------------------------------------
// Exec abstraction
// ---------------------------------------------------------------------------

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface ExecError extends Error {
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface ExecFn {
  (file: string, args: string[]): Promise<ExecResult>;
}

function isExecError(err: unknown): err is ExecError {
  return err instanceof Error;
}

function errText(err: unknown): string {
  if (!isExecError(err)) return String(err);
  return err.stderr || err.message;
}

// ---------------------------------------------------------------------------
// Binary
// ---------------------------------------------------------------------------

/** The version the installed chisel binary reports, or null if it does not run. */
export async function getInstalledChiselVersion(exec: ExecFn): Promise<string | null> {
  try {
    const { stdout } = await exec(CHISEL_BIN, ['--version']);
    return normaliseChiselVersion(stdout);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Server key
// ---------------------------------------------------------------------------

/**
 * Ensure a persistent chisel server private key exists at `keyFilePath`.
 *
 * Without `--keyfile`, chisel generates a fresh SSH key pair on every start,
 * so every `systemctl restart chisel` would rotate the server's SSH host
 * identity. Agents authenticate the relay through the TLS certificate of
 * `tunnel.<domain>` rather than this key, but a stable identity keeps the
 * inner SSH layer predictable and its fingerprint meaningful in logs.
 *
 * Generated as the lamaste user and handed to the group chisel runs as
 * ({@link CHISEL_AUTHFILE_GROUP}), mode 0640 — the same way as the authfile.
 */
export async function ensureChiselKey(
  keyFilePath: string,
  exec: ExecFn,
): Promise<{ readonly generated: boolean }> {
  try {
    await lstat(keyFilePath);
    return { generated: false };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const tmpKey = path.join(
    path.dirname(keyFilePath),
    `.${path.basename(keyFilePath)}.${crypto.randomBytes(8).toString('hex')}`,
  );
  try {
    await exec(CHISEL_BIN, ['server', '--keygen', tmpKey]);
    await exec('chgrp', [CHISEL_AUTHFILE_GROUP, tmpKey]);
    await chmod(tmpKey, 0o640);
    await rename(tmpKey, keyFilePath);
  } catch (err: unknown) {
    await rm(tmpKey, { force: true }).catch(() => undefined);
    throw new Error(`Failed to generate Chisel server key at ${keyFilePath}: ${errText(err)}`);
  }
  return { generated: true };
}

// ---------------------------------------------------------------------------
// Service control
// ---------------------------------------------------------------------------

export interface ServiceActiveStatus {
  readonly active: boolean;
}

export interface ServiceStatus {
  readonly active: boolean;
  readonly uptime: string | null;
}

async function waitActive(
  service: string,
  exec: ExecFn,
  failureMessage: string,
): Promise<ServiceActiveStatus> {
  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const { stdout } = await exec('systemctl', ['is-active', service]);
    if (stdout.trim() === 'active') {
      return { active: true };
    }
  } catch {
    // non-zero for inactive
  }

  let journalOutput = '';
  try {
    const { stdout } = await exec('journalctl', ['-u', service, '--no-pager', '-n', '10']);
    journalOutput = stdout;
  } catch {
    journalOutput = 'Could not read journal logs';
  }

  throw new Error(`${failureMessage} Journal output:\n${journalOutput}`);
}

/**
 * Enable and start the Chisel systemd service.
 */
export async function startChisel(exec: ExecFn): Promise<ServiceActiveStatus> {
  try {
    await exec('sudo', ['systemctl', 'enable', CHISEL_SERVICE]);
    await exec('sudo', ['systemctl', 'start', CHISEL_SERVICE]);
  } catch (err: unknown) {
    throw new Error(`Failed to start Chisel service: ${errText(err)}`);
  }

  return waitActive(CHISEL_SERVICE, exec, 'Chisel service is not active after starting.');
}

/**
 * Restart the Chisel service.
 */
export async function reloadChisel(exec: ExecFn): Promise<ServiceActiveStatus> {
  try {
    await exec('sudo', ['systemctl', 'restart', CHISEL_SERVICE]);
  } catch (err: unknown) {
    throw new Error(`Failed to restart Chisel service: ${errText(err)}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const { stdout } = await exec('systemctl', ['is-active', CHISEL_SERVICE]);
    if (stdout.trim() === 'active') {
      return { active: true };
    }
  } catch {
    // non-zero for inactive
  }

  throw new Error('Chisel service is not active after restart.');
}

/**
 * Stop the Chisel service.
 */
export async function stopChisel(exec: ExecFn): Promise<{ active: false }> {
  try {
    await exec('sudo', ['systemctl', 'stop', CHISEL_SERVICE]);
  } catch (err: unknown) {
    throw new Error(`Failed to stop Chisel service: ${errText(err)}`);
  }
  return { active: false };
}

/**
 * Check whether the Chisel service is currently running.
 */
export async function isChiselRunning(exec: ExecFn): Promise<boolean> {
  try {
    const { stdout } = await exec('systemctl', ['is-active', CHISEL_SERVICE]);
    return stdout.trim() === 'active';
  } catch {
    return false;
  }
}

/**
 * Get Chisel service status including uptime.
 */
export async function getChiselStatus(exec: ExecFn): Promise<ServiceStatus> {
  let active = false;
  try {
    const { stdout } = await exec('systemctl', ['is-active', CHISEL_SERVICE]);
    active = stdout.trim() === 'active';
  } catch {
    return { active: false, uptime: null };
  }

  let uptime: string | null = null;
  if (active) {
    try {
      const { stdout } = await exec('systemctl', [
        'show',
        CHISEL_SERVICE,
        '--property=ActiveEnterTimestamp',
      ]);
      const match = stdout.match(/ActiveEnterTimestamp=(.+)/);
      if (match && match[1] && match[1].trim()) {
        const startTime = new Date(match[1].trim());
        const diffMs = Date.now() - startTime.getTime();
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        uptime = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
      }
    } catch {
      // non-critical
    }
  }

  return { active, uptime };
}
