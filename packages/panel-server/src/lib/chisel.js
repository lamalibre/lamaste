import { execa } from 'execa';
import { writeFile as fsWriteFile } from 'node:fs/promises';
import { access, constants } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const CHISEL_BIN = '/usr/local/bin/chisel';
const CHISEL_SERVICE = 'chisel';
const GITHUB_API = 'https://api.github.com/repos/jpillora/chisel/releases/latest';

/**
 * Check if a file exists at the given path.
 */
async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the currently installed Chisel version, or null if not installed.
 */
async function getInstalledVersion() {
  try {
    const { stdout } = await execa(CHISEL_BIN, ['--version']);
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Download and install the Chisel binary from GitHub releases.
 */
export async function installChisel() {
  const exists = await fileExists(CHISEL_BIN);
  if (exists) {
    const version = await getInstalledVersion();
    if (version) {
      return { skipped: true, version };
    }
  }

  let releaseInfo;
  try {
    const { stdout } = await execa('curl', [
      '-s', '-L',
      '-H', 'Accept: application/vnd.github+json',
      GITHUB_API,
    ]);
    releaseInfo = JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to fetch Chisel release info from GitHub: ${err.message}. Check internet connectivity.`,
    );
  }

  if (releaseInfo.message && releaseInfo.message.includes('rate limit')) {
    throw new Error(
      'GitHub API rate limit exceeded. Please try again later or set a GITHUB_TOKEN environment variable.',
    );
  }

  const { stdout: unameArch } = await execa('uname', ['-m']);
  const archMap = { x86_64: 'linux_amd64', aarch64: 'linux_arm64', arm64: 'linux_arm64' };
  const chiselArch = archMap[unameArch.trim()] || 'linux_amd64';

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
  const tmpGz = path.join(tmpdir(), `chisel-${crypto.randomBytes(4).toString('hex')}.gz`);
  const tmpBin = tmpGz.replace('.gz', '');

  try {
    await execa('curl', ['-L', '-o', tmpGz, downloadUrl]);
  } catch (err) {
    throw new Error(
      `Failed to download Chisel from ${downloadUrl}: ${err.stderr || err.message}. Check internet connectivity.`,
    );
  }

  try {
    await execa('gunzip', ['-f', tmpGz]);
    await execa('sudo', ['mv', tmpBin, CHISEL_BIN]);
    await execa('sudo', ['chmod', '+x', CHISEL_BIN]);
  } catch (err) {
    throw new Error(`Failed to install Chisel binary: ${err.stderr || err.message}`);
  } finally {
    // Clean up temp files silently
    await execa('rm', ['-f', tmpGz, tmpBin]).catch(() => {});
  }

  const version = await getInstalledVersion();
  if (!version) {
    throw new Error('Chisel was installed but version check failed. The binary may be corrupted.');
  }

  return { installed: true, version };
}

/**
 * Write the Chisel systemd service unit file.
 */
export async function writeChiselService() {
  const serviceContent = `[Unit]
Description=Chisel Tunnel Server
After=network.target

[Service]
Type=simple
User=nobody
ExecStart=/usr/local/bin/chisel server --reverse --port 9090 --host 127.0.0.1
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=chisel

[Install]
WantedBy=multi-user.target
`;

  const tmpFile = path.join(tmpdir(), `chisel-service-${crypto.randomBytes(4).toString('hex')}`);
  await fsWriteFile(tmpFile, serviceContent, 'utf-8');

  try {
    await execa('sudo', ['mv', tmpFile, '/etc/systemd/system/chisel.service']);
    await execa('sudo', ['chmod', '644', '/etc/systemd/system/chisel.service']);
    await execa('sudo', ['systemctl', 'daemon-reload']);
  } catch (err) {
    throw new Error(`Failed to write Chisel service file: ${err.stderr || err.message}`);
  }

  return '/etc/systemd/system/chisel.service';
}

/**
 * Enable and start the Chisel systemd service.
 */
export async function startChisel() {
  try {
    await execa('sudo', ['systemctl', 'enable', CHISEL_SERVICE]);
    await execa('sudo', ['systemctl', 'start', CHISEL_SERVICE]);
  } catch (err) {
    throw new Error(`Failed to start Chisel service: ${err.stderr || err.message}`);
  }

  // Wait briefly for service to start
  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const { stdout } = await execa('systemctl', ['is-active', CHISEL_SERVICE]);
    if (stdout.trim() === 'active') {
      return { active: true };
    }
  } catch {
    // is-active returns non-zero for inactive services
  }

  // Service is not active — read journal for diagnostics
  let journalOutput = '';
  try {
    const { stdout } = await execa('journalctl', ['-u', CHISEL_SERVICE, '--no-pager', '-n', '10']);
    journalOutput = stdout;
  } catch {
    journalOutput = 'Could not read journal logs';
  }

  throw new Error(`Chisel service is not active after starting. Journal output:\n${journalOutput}`);
}

/**
 * Restart the Chisel service.
 */
export async function reloadChisel() {
  try {
    await execa('sudo', ['systemctl', 'restart', CHISEL_SERVICE]);
  } catch (err) {
    throw new Error(`Failed to restart Chisel service: ${err.stderr || err.message}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const { stdout } = await execa('systemctl', ['is-active', CHISEL_SERVICE]);
    if (stdout.trim() === 'active') {
      return { active: true };
    }
  } catch {
    // is-active returns non-zero for inactive
  }

  throw new Error('Chisel service is not active after restart.');
}

/**
 * Stop the Chisel service.
 */
export async function stopChisel() {
  try {
    await execa('sudo', ['systemctl', 'stop', CHISEL_SERVICE]);
  } catch (err) {
    throw new Error(`Failed to stop Chisel service: ${err.stderr || err.message}`);
  }

  return { active: false };
}

/**
 * Check whether the Chisel service is currently running.
 */
export async function isChiselRunning() {
  try {
    const { stdout } = await execa('systemctl', ['is-active', CHISEL_SERVICE]);
    return stdout.trim() === 'active';
  } catch {
    return false;
  }
}

/**
 * Get Chisel service status including uptime.
 *
 * @returns {{ active: boolean, uptime: string | null }}
 */
export async function getChiselStatus() {
  let active = false;
  try {
    const { stdout } = await execa('systemctl', ['is-active', CHISEL_SERVICE]);
    active = stdout.trim() === 'active';
  } catch {
    return { active: false, uptime: null };
  }

  let uptime = null;
  if (active) {
    try {
      const { stdout } = await execa('systemctl', [
        'show', CHISEL_SERVICE, '--property=ActiveEnterTimestamp',
      ]);
      const match = stdout.match(/ActiveEnterTimestamp=(.+)/);
      if (match && match[1].trim()) {
        const startTime = new Date(match[1].trim());
        const diffMs = Date.now() - startTime.getTime();
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        uptime = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
      }
    } catch {
      // Non-critical — uptime is informational
    }
  }

  return { active, uptime };
}

// Module-level mutex for serializing updateChiselConfig calls
let chiselUpdateLock = Promise.resolve();

/**
 * Update the Chisel server configuration and restart the service.
 * Serialized via a promise chain to prevent concurrent restarts.
 *
 * @param {Array<{ port: number }>} tunnels - Current tunnel list
 */
export async function updateChiselConfig(tunnels) {
  // Chain onto the lock to serialize concurrent calls
  const previousLock = chiselUpdateLock;
  let resolveLock;
  chiselUpdateLock = new Promise((resolve) => {
    resolveLock = resolve;
  });

  try {
    await previousLock;
    await _doUpdateChiselConfig(tunnels);
  } finally {
    resolveLock();
  }
}

/**
 * Internal: performs the actual Chisel config update and restart.
 */
async function _doUpdateChiselConfig(_tunnels) {
  // The Chisel server in --reverse mode doesn't need per-tunnel port entries.
  // The service file remains the same; we just restart to pick up any changes.
  const serviceContent = `[Unit]
Description=Chisel Tunnel Server
After=network.target

[Service]
Type=simple
User=nobody
ExecStart=/usr/local/bin/chisel server --reverse --port 9090 --host 127.0.0.1
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=chisel

[Install]
WantedBy=multi-user.target
`;

  const tmpFile = path.join(tmpdir(), `chisel-service-${crypto.randomBytes(4).toString('hex')}`);
  await fsWriteFile(tmpFile, serviceContent, 'utf-8');

  try {
    await execa('sudo', ['mv', tmpFile, '/etc/systemd/system/chisel.service']);
    await execa('sudo', ['chmod', '644', '/etc/systemd/system/chisel.service']);
  } catch (err) {
    throw new Error(`Failed to write Chisel service file: ${err.stderr || err.message}`);
  }

  try {
    await execa('sudo', ['systemctl', 'daemon-reload']);
    await execa('sudo', ['systemctl', 'restart', CHISEL_SERVICE]);
  } catch (err) {
    throw new Error(`Failed to restart Chisel service: ${err.stderr || err.message}`);
  }

  // Wait briefly for service to start
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Verify
  try {
    const { stdout } = await execa('systemctl', ['is-active', CHISEL_SERVICE]);
    if (stdout.trim() === 'active') {
      return { active: true };
    }
  } catch {
    // is-active returns non-zero for inactive
  }

  // Service not active — gather diagnostics
  let journalOutput = '';
  try {
    const { stdout } = await execa('journalctl', ['-u', CHISEL_SERVICE, '-n', '20', '--no-pager']);
    journalOutput = stdout;
  } catch {
    journalOutput = 'Could not read journal logs';
  }

  throw new Error(
    `Chisel service is not active after restart. Journal output:\n${journalOutput}`,
  );
}
