/**
 * Chisel tunnel server lifecycle — binary install, systemd unit, start/stop/restart.
 *
 * Pure logic: accepts an `exec` function and a resolved `authFilePath`. The
 * daemon is responsible for picking the authfile location.
 */

import crypto from 'node:crypto';
import { access, constants, writeFile as fsWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PromiseChainMutex } from '../file-helpers.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CHISEL_BIN = '/usr/local/bin/chisel';
export const CHISEL_SERVICE = 'chisel';
const GITHUB_API = 'https://api.github.com/repos/jpillora/chisel/releases/latest';

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
}

async function getInstalledVersion(exec: ExecFn): Promise<string | null> {
  try {
    const { stdout } = await exec(CHISEL_BIN, ['--version']);
    return stdout.trim();
  } catch {
    return null;
  }
}

interface GitHubAsset {
  readonly name: string;
  readonly browser_download_url: string;
}
interface GitHubReleaseInfo {
  readonly assets?: GitHubAsset[];
  readonly message?: string;
}

/**
 * Download and install the Chisel binary from GitHub releases.
 */
export async function installChisel(exec: ExecFn): Promise<InstallResult> {
  const exists = await fileExists(CHISEL_BIN);
  if (exists) {
    const version = await getInstalledVersion(exec);
    if (version) {
      return { skipped: true, version };
    }
  }

  let releaseInfo: GitHubReleaseInfo;
  try {
    const { stdout } = await exec('curl', [
      '-s',
      '-L',
      '-H',
      'Accept: application/vnd.github+json',
      GITHUB_API,
    ]);
    releaseInfo = JSON.parse(stdout) as GitHubReleaseInfo;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to fetch Chisel release info from GitHub: ${message}. Check internet connectivity.`,
    );
  }

  if (releaseInfo.message && releaseInfo.message.includes('rate limit')) {
    throw new Error(
      'GitHub API rate limit exceeded. Please try again later or set a GITHUB_TOKEN environment variable.',
    );
  }

  const { stdout: unameArch } = await exec('uname', ['-m']);
  const archMap: Record<string, string> = {
    x86_64: 'linux_amd64',
    aarch64: 'linux_arm64',
    arm64: 'linux_arm64',
  };
  const chiselArch = archMap[unameArch.trim()] ?? 'linux_amd64';

  const asset = releaseInfo.assets?.find(
    (a) => a.name.includes(chiselArch) && a.name.endsWith('.gz'),
  );

  if (!asset) {
    throw new Error(
      `Could not find ${chiselArch} asset in the latest Chisel release. Available assets: ` +
        (releaseInfo.assets?.map((a) => a.name).join(', ') || 'none'),
    );
  }

  const downloadUrl = asset.browser_download_url;
  // Temp file name matches the sudoers `mv /tmp/lamalibre-lamaste-chisel-*`
  // rule that lets us install into /usr/local/bin/chisel. Any rename of this
  // prefix must keep the sudoers rule in service-config.js in sync.
  const tmpGz = path.join(tmpdir(), `lamalibre-lamaste-chisel-${crypto.randomBytes(4).toString('hex')}.gz`);
  const tmpBin = tmpGz.replace('.gz', '');

  try {
    await exec('curl', ['-L', '-o', tmpGz, downloadUrl]);
  } catch (err: unknown) {
    throw new Error(
      `Failed to download Chisel from ${downloadUrl}: ${errText(err)}. Check internet connectivity.`,
    );
  }

  try {
    await exec('gunzip', ['-f', tmpGz]);
    await exec('sudo', ['mv', tmpBin, CHISEL_BIN]);
    await exec('sudo', ['chmod', '+x', CHISEL_BIN]);
  } catch (err: unknown) {
    throw new Error(`Failed to install Chisel binary: ${errText(err)}`);
  } finally {
    await exec('rm', ['-f', tmpGz, tmpBin]).catch(() => undefined);
  }

  const version = await getInstalledVersion(exec);
  if (!version) {
    throw new Error('Chisel was installed but version check failed. The binary may be corrupted.');
  }

  return { installed: true, version };
}

// ---------------------------------------------------------------------------
// Systemd unit
// ---------------------------------------------------------------------------

/**
 * Ensure a persistent chisel server private key exists at `keyFilePath`.
 *
 * Without `--keyfile`, chisel generates a fresh SSH key pair on every start,
 * meaning every `systemctl restart chisel` rotates the server fingerprint.
 * Enrolled agents pin the server fingerprint at setup time, so rotation
 * breaks every subsequent tunnel handshake. Generating the key once and
 * reusing it keeps the fingerprint stable across restarts.
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
  const tmpKey = path.join(tmpdir(), `lamalibre-lamaste-chisel-server-key-${crypto.randomBytes(4).toString('hex')}`);
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
 * The `--authfile` flag pins per-agent credentials. Without it, anyone on the
 * public internet can reverse-bind 127.0.0.1 ports on this server (CVE-class
 * hole). Chisel does not support graceful authfile reload — every credential
 * change triggers a full `systemctl restart chisel`; agents auto-reconnect.
 *
 * `--keyfile` pins the server identity. Without it, chisel rotates its
 * fingerprint on every restart and breaks agent TLS pinning.
 */
export function buildChiselUnit(authFilePath: string, keyFilePath: string): string {
  return `[Unit]
Description=Chisel Tunnel Server
After=network.target

[Service]
Type=simple
User=nobody
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

/**
 * Write the Chisel systemd service unit file.
 */
export async function writeChiselService(
  authFilePath: string,
  keyFilePath: string,
  exec: ExecFn,
): Promise<string> {
  const serviceContent = buildChiselUnit(authFilePath, keyFilePath);

  // Temp file name matches the sudoers `mv /tmp/lamalibre-lamaste-chisel-service-*`
  // rule that lets us install into /etc/systemd/system/chisel.service.
  const tmpFile = path.join(tmpdir(), `lamalibre-lamaste-chisel-service-${crypto.randomBytes(4).toString('hex')}`);
  await fsWriteFile(tmpFile, serviceContent, 'utf-8');

  try {
    await exec('sudo', ['mv', tmpFile, '/etc/systemd/system/chisel.service']);
    await exec('sudo', ['chmod', '644', '/etc/systemd/system/chisel.service']);
    await exec('sudo', ['systemctl', 'daemon-reload']);
  } catch (err: unknown) {
    throw new Error(`Failed to write Chisel service file: ${errText(err)}`);
  }

  return '/etc/systemd/system/chisel.service';
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

// ---------------------------------------------------------------------------
// Config updates (re-apply unit + restart)
// ---------------------------------------------------------------------------

const updateMutex = new PromiseChainMutex();

/**
 * Update the Chisel server configuration and restart the service.
 * Serialized via a promise-chain mutex to prevent concurrent restarts.
 *
 * The tunnels parameter is retained for API stability — the chisel server in
 * `--reverse` mode does not need per-tunnel port entries.
 */
export function updateChiselConfig(
  _tunnels: readonly { port: number }[],
  authFilePath: string,
  keyFilePath: string,
  exec: ExecFn,
): Promise<ServiceActiveStatus> {
  return updateMutex.run(async () => {
    const serviceContent = buildChiselUnit(authFilePath, keyFilePath);

    // Same sudoers prefix as the initial writeChiselService — the rule is
    // `mv /tmp/lamalibre-lamaste-chisel-service-*` and applies to both call
    // sites.
    const tmpFile = path.join(tmpdir(), `lamalibre-lamaste-chisel-service-${crypto.randomBytes(4).toString('hex')}`);
    await fsWriteFile(tmpFile, serviceContent, 'utf-8');

    try {
      await exec('sudo', ['mv', tmpFile, '/etc/systemd/system/chisel.service']);
      await exec('sudo', ['chmod', '644', '/etc/systemd/system/chisel.service']);
    } catch (err: unknown) {
      throw new Error(`Failed to write Chisel service file: ${errText(err)}`);
    }

    try {
      await exec('sudo', ['systemctl', 'daemon-reload']);
      await exec('sudo', ['systemctl', 'restart', CHISEL_SERVICE]);
    } catch (err: unknown) {
      throw new Error(`Failed to restart Chisel service: ${errText(err)}`);
    }

    return waitActive(CHISEL_SERVICE, exec, 'Chisel service is not active after restart.');
  });
}
