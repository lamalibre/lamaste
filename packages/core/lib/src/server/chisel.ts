/**
 * Chisel tunnel server lifecycle — binary install, systemd unit, start/stop/restart.
 *
 * Pure logic: accepts an `exec` function and a resolved `authFilePath`. The
 * daemon is responsible for picking the authfile location.
 */

import crypto from 'node:crypto';
import { access, constants, readFile, writeFile as fsWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CHISEL_RELEASE } from '../constants.js';
import type { ChiselArch } from '../constants.js';
import {
  curlDownloadArgs,
  downloadVerifiedChisel,
  isPinnedChiselVersion,
  normaliseChiselVersion,
} from '../chisel-download.js';
import { CHISEL_AUTHFILE_GROUP } from './chisel-users.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CHISEL_BIN = '/usr/local/bin/chisel';
export const CHISEL_SERVICE = 'chisel';
export const CHISEL_UNIT_PATH = '/etc/systemd/system/chisel.service';

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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

export interface InstallResult {
  readonly installed?: true;
  readonly skipped?: true;
  readonly version: string;
  /** Version reported by the binary that was replaced, if any. */
  readonly previousVersion?: string | null;
}

/** The version the installed chisel binary reports, or null if it does not run. */
export async function getInstalledChiselVersion(exec: ExecFn): Promise<string | null> {
  try {
    const { stdout } = await exec(CHISEL_BIN, ['--version']);
    return normaliseChiselVersion(stdout);
  } catch {
    return null;
  }
}

const SERVER_ARCH: Record<string, ChiselArch> = {
  x86_64: 'linux_amd64',
  amd64: 'linux_amd64',
  aarch64: 'linux_arm64',
  arm64: 'linux_arm64',
};

/**
 * Install the pinned Chisel release ({@link CHISEL_RELEASE}) at
 * `/usr/local/bin/chisel`, replacing any binary that reports another
 * version. The download is verified against the pinned SHA-256 before it is
 * unpacked. A running chisel keeps the old binary until it is restarted.
 */
export async function installChisel(exec: ExecFn): Promise<InstallResult> {
  const previousVersion = (await fileExists(CHISEL_BIN))
    ? await getInstalledChiselVersion(exec)
    : null;
  if (isPinnedChiselVersion(previousVersion)) {
    return { skipped: true, version: CHISEL_RELEASE.version };
  }

  const { stdout: unameArch } = await exec('uname', ['-m']);
  const arch = SERVER_ARCH[unameArch.trim()];
  if (!arch) {
    throw new Error(`Unsupported server architecture for Chisel: ${unameArch.trim()}`);
  }

  // Temp name matches the sudoers `mv /tmp/lamalibre-lamaste-chisel-* /usr/local/bin/chisel`
  // rule. Any rename of this prefix must keep service-config.js in sync.
  const suffix = crypto.randomBytes(8).toString('hex');
  const tmpBin = path.join(tmpdir(), `lamalibre-lamaste-chisel-${suffix}`);
  const tmpGz = path.join(tmpdir(), `lamalibre-lamaste-chisel-download-${suffix}.gz`);

  try {
    await downloadVerifiedChisel(arch, tmpGz, tmpBin, async (url, out) => {
      await exec('curl', curlDownloadArgs(url, out));
    });
    await exec('sudo', ['mv', tmpBin, CHISEL_BIN]);
    await exec('sudo', ['chmod', '+x', CHISEL_BIN]);
  } catch (err: unknown) {
    throw new Error(`Failed to install Chisel ${CHISEL_RELEASE.version}: ${errText(err)}`);
  } finally {
    await exec('rm', ['-f', tmpBin]).catch(() => undefined);
  }

  const version = await getInstalledChiselVersion(exec);
  if (!isPinnedChiselVersion(version)) {
    throw new Error(
      `Chisel was installed but reports version ${String(version)}, expected ${CHISEL_RELEASE.version}.`,
    );
  }

  return { installed: true, version: CHISEL_RELEASE.version, previousVersion };
}

// ---------------------------------------------------------------------------
// Systemd unit
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
 * The key must be readable by the user that runs chisel (systemd unit uses
 * `User=nobody`), so we chown it to `nobody:nogroup` and mode 0400.
 */
export async function ensureChiselKey(
  keyFilePath: string,
  exec: ExecFn,
): Promise<{ readonly generated: boolean }> {
  if (await fileExists(keyFilePath)) {
    return { generated: false };
  }
  // Temp file name matches the sudoers `mv /tmp/lamalibre-lamaste-chisel-server-key-*`
  // rule that lets us install into /etc/lamalibre/lamaste/chisel-server.key.
  const tmpKey = path.join(
    tmpdir(),
    `lamalibre-lamaste-chisel-server-key-${crypto.randomBytes(4).toString('hex')}`,
  );
  try {
    await exec(CHISEL_BIN, ['server', '--keygen', tmpKey]);
    await exec('sudo', ['mv', tmpKey, keyFilePath]);
    await exec('sudo', ['chown', 'nobody:nogroup', keyFilePath]);
    await exec('sudo', ['chmod', '0400', keyFilePath]);
  } catch (err: unknown) {
    await exec('rm', ['-f', tmpKey]).catch(() => undefined);
    throw new Error(`Failed to generate Chisel server key at ${keyFilePath}: ${errText(err)}`);
  }
  return { generated: true };
}

/**
 * Build the systemd unit text for the Chisel server.
 *
 * The `--authfile` flag carries per-agent credentials and port grants.
 * Without it, anyone on the public internet could reverse-bind 127.0.0.1
 * ports on this server. Chisel reloads the file on change; see
 * `chisel-users.ts` for which changes also need a restart.
 *
 * The process runs as `nobody` with group {@link CHISEL_AUTHFILE_GROUP}, the
 * only group allowed to read the 0640 authfile. `--keyfile` keeps the SSH
 * host identity stable across restarts.
 */
export function buildChiselUnit(authFilePath: string, keyFilePath: string): string {
  return `[Unit]
Description=Chisel Tunnel Server
After=network.target

[Service]
Type=simple
User=nobody
Group=${CHISEL_AUTHFILE_GROUP}
ExecStart=/usr/local/bin/chisel server --reverse --port 9090 --host 127.0.0.1 --keyfile ${keyFilePath} --authfile ${authFilePath}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=chisel

[Install]
WantedBy=multi-user.target
`;
}

async function installUnit(content: string, exec: ExecFn): Promise<void> {
  // Temp file name matches the sudoers `mv /tmp/lamalibre-lamaste-chisel-service-*`
  // rule that lets us install into /etc/systemd/system/chisel.service.
  const tmpFile = path.join(
    tmpdir(),
    `lamalibre-lamaste-chisel-service-${crypto.randomBytes(4).toString('hex')}`,
  );
  await fsWriteFile(tmpFile, content, 'utf-8');
  try {
    await exec('sudo', ['mv', tmpFile, CHISEL_UNIT_PATH]);
    await exec('sudo', ['chmod', '644', CHISEL_UNIT_PATH]);
    await exec('sudo', ['systemctl', 'daemon-reload']);
  } catch (err: unknown) {
    await exec('rm', ['-f', tmpFile]).catch(() => undefined);
    throw new Error(`Failed to write Chisel service file: ${errText(err)}`);
  }
}

/**
 * Write the Chisel systemd service unit file unconditionally.
 */
export async function writeChiselService(
  authFilePath: string,
  keyFilePath: string,
  exec: ExecFn,
): Promise<string> {
  await installUnit(buildChiselUnit(authFilePath, keyFilePath), exec);
  return CHISEL_UNIT_PATH;
}

/**
 * Write the Chisel unit only if the installed one differs, followed by
 * `daemon-reload`. Reports whether it changed; the caller restarts chisel
 * for the new unit to take effect. Does not start or restart anything.
 */
export async function ensureChiselService(
  authFilePath: string,
  keyFilePath: string,
  exec: ExecFn,
): Promise<{ readonly changed: boolean }> {
  const desired = buildChiselUnit(authFilePath, keyFilePath);
  let current: string | null = null;
  try {
    current = await readFile(CHISEL_UNIT_PATH, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (current === desired) return { changed: false };
  await installUnit(desired, exec);
  return { changed: true };
}

/** True once onboarding has provisioned the chisel server (its unit exists). */
export function isChiselProvisioned(): Promise<boolean> {
  return fileExists(CHISEL_UNIT_PATH);
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
