/**
 * Local plugin host service management.
 *
 * Manages a launchd (macOS) or user-level systemd (Linux) service for the
 * local plugin host Fastify server. Unlike per-agent services, this uses
 * user-level systemd (~/.config/systemd/user/) since no root is needed.
 */

import { writeFile, rename, mkdir, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import {
  isDarwin,
  localHostPlistLabel,
  localHostPlistPath,
  localHostSystemdUnitName,
  localHostSystemdUnitPath,
  localHostLogFile,
  localHostErrorLogFile,
  localHostLogsDir,
} from './platform.js';
import { runUserSystemctl } from './user-systemd-env.js';

// ---------------------------------------------------------------------------
// Config generation
// ---------------------------------------------------------------------------

/**
 * Generate the local host service config content.
 * @param entryPath - Absolute path to the local-plugin-host-entry.js script
 * @param port - Port number for the local plugin host (default: 9293)
 */
export function generateLocalHostServiceConfig(entryPath: string, port = 9293): string {
  if (isDarwin()) {
    return generateLocalHostPlist(entryPath, port);
  }
  return generateLocalHostSystemdUnit(entryPath, port);
}

/**
 * Write the local host service config to the appropriate location.
 */
export async function writeLocalHostServiceConfig(content: string): Promise<void> {
  if (isDarwin()) {
    return writeLocalHostPlist(content);
  }
  return writeLocalHostSystemdUnit(content);
}

// ---------------------------------------------------------------------------
// Service lifecycle
// ---------------------------------------------------------------------------

/**
 * Check if the local host service is loaded/active.
 */
export async function isLocalHostLoaded(): Promise<boolean> {
  if (isDarwin()) {
    return macIsLocalHostLoaded();
  }
  return systemctlIsLocalHostActive();
}

/**
 * Start the local host service.
 */
export async function loadLocalHost(): Promise<void> {
  if (isDarwin()) {
    return macLoadLocalHost();
  }
  return systemctlStartLocalHost();
}

/**
 * Stop the local host service. Silent if not loaded.
 */
export async function unloadLocalHost(): Promise<void> {
  if (isDarwin()) {
    return macUnloadLocalHost();
  }
  return systemctlStopLocalHost();
}

/**
 * Restart the local host service (stop + start).
 *
 * Same shape as restartAgent / restartPanelService: launchctl requires
 * unload+load to pick up plist changes; systemd's `restart` subsumes both
 * but we go through unload/load so the cross-platform code path stays
 * symmetric and the disable/enable toggle inside the Linux helpers also
 * refreshes the boot-time-enable bit.
 */
export async function restartLocalHost(): Promise<void> {
  await unloadLocalHost();
  await loadLocalHost();
}

/**
 * Remove the local host service config file.
 */
export async function removeLocalHostServiceConfig(): Promise<void> {
  const filePath = isDarwin() ? localHostPlistPath() : localHostSystemdUnitPath();
  try {
    await unlink(filePath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (!isDarwin()) {
    try {
      await runUserSystemctl(['daemon-reload']);
    } catch {
      // best-effort
    }
  }
}

// ---------------------------------------------------------------------------
// macOS — plist
// ---------------------------------------------------------------------------

function xmlEsc(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateLocalHostPlist(entryPath: string, port: number): string {
  const nodePath = process.execPath;
  const serviceLabel = localHostPlistLabel();
  const logFile = localHostLogFile();
  const errorLogFile = localHostErrorLogFile();

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${xmlEsc(serviceLabel)}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${xmlEsc(nodePath)}</string>
        <string>${xmlEsc(entryPath)}</string>
        <string>--port</string>
        <string>${port}</string>
    </array>

    <key>KeepAlive</key>
    <true/>

    <key>RunAtLoad</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${xmlEsc(logFile)}</string>

    <key>StandardErrorPath</key>
    <string>${xmlEsc(errorLogFile)}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
`;
}

async function writeLocalHostPlist(content: string): Promise<void> {
  const filePath = localHostPlistPath();
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  await mkdir(localHostLogsDir(), { recursive: true });
  const tmp = filePath + '.tmp';
  await writeFile(tmp, content, 'utf8');
  const fd = await open(tmp, 'r');
  await fd.sync();
  await fd.close();
  await rename(tmp, filePath);
}

async function macIsLocalHostLoaded(): Promise<boolean> {
  try {
    const { execa } = await import('execa');
    const { stdout } = await execa('launchctl', ['list']);
    const serviceLabel = localHostPlistLabel();
    return stdout.split('\n').some((line) => {
      const cols = line.trim().split(/\s+/);
      return cols[2] === serviceLabel;
    });
  } catch {
    return false;
  }
}

async function macLoadLocalHost(): Promise<void> {
  const { execa } = await import('execa');
  const filePath = localHostPlistPath();
  await execa('launchctl', ['load', filePath]);
}

async function macUnloadLocalHost(): Promise<void> {
  try {
    const { execa } = await import('execa');
    const filePath = localHostPlistPath();
    await execa('launchctl', ['unload', filePath]);
  } catch {
    // may not be loaded — that is fine
  }
}

// ---------------------------------------------------------------------------
// Linux — user-level systemd
// ---------------------------------------------------------------------------

function systemdQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function generateLocalHostSystemdUnit(entryPath: string, port: number): string {
  const nodePath = process.execPath;
  const logFile = localHostLogFile();
  const errorLogFile = localHostErrorLogFile();
  const logsDir = localHostLogsDir();

  const execStart = [nodePath, entryPath, '--port', String(port)].map(systemdQuote).join(' ');

  return `[Unit]
Description=Lamaste Local Plugin Host
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=always
RestartSec=5
StandardOutput=append:${logFile}
StandardError=append:${errorLogFile}
Environment=PATH=/usr/local/bin:/usr/bin:/bin
NoNewPrivileges=true
ReadWritePaths=${logsDir}

[Install]
WantedBy=default.target
`;
}

async function writeLocalHostSystemdUnit(content: string): Promise<void> {
  const logsDir = localHostLogsDir();
  await mkdir(logsDir, { recursive: true });

  const filePath = localHostSystemdUnitPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  await writeFile(tmp, content, { encoding: 'utf8', mode: 0o644 });
  const fd = await open(tmp, 'r');
  await fd.sync();
  await fd.close();
  await rename(tmp, filePath);

  await runUserSystemctl(['daemon-reload']);
}

async function systemctlIsLocalHostActive(): Promise<boolean> {
  try {
    await runUserSystemctl(['is-active', '--quiet', localHostSystemdUnitName()]);
    return true;
  } catch {
    return false;
  }
}

async function systemctlStartLocalHost(): Promise<void> {
  try {
    await runUserSystemctl(['daemon-reload']);
    await runUserSystemctl(['enable', '--now', localHostSystemdUnitName()]);
  } catch (err: unknown) {
    const message = (err as { stderr?: string; message?: string }).stderr ?? (err as Error).message;
    throw new Error(`Failed to start local plugin host: ${message}`);
  }
}

async function systemctlStopLocalHost(): Promise<void> {
  try {
    await runUserSystemctl(['disable', '--now', localHostSystemdUnitName()]);
  } catch {
    // may not be active — that is fine
  }
}
