/**
 * Panel service config generation, writing, and removal.
 *
 * Service start/stop/loaded checks are delegated to @lamalibre/lamaste/agent
 * (isPanelServiceLoaded, loadPanelService, unloadPanelService).
 *
 * This module retains only the config file generation and filesystem operations
 * needed by the CLI panel command.
 */

import { writeFile, rename, mkdir, unlink, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import {
  isDarwin,
  panelPlistLabel,
  panelPlistPath,
  panelSystemdUnitPath,
  panelLogFile,
  panelErrorLogFile,
  agentLogsDir,
  agentDataDir,
  runUserSystemctl,
} from '@lamalibre/lamaste/agent';

/**
 * Resolve the absolute path to the installed `lamaste-agentd` binary.
 *
 * The CLI no longer ships a sibling `serverd-entry.js` — `lamaste-agentd`
 * is its own published package and is installed (typically globally) via npm.
 * Service units must point at a real, executable file on disk so launchd /
 * systemd can spawn it without help from the user's shell PATH.
 *
 * Resolution order:
 *   1. LAMALIBRE_LAMASTE_AGENTD_PATH env var (lets ops override for test installs)
 *   2. `which lamaste-agentd` (POSIX) — the npm `bin` entry should be on PATH
 *
 * Throws a descriptive error so `panel --enable` fails loudly when the binary
 * is missing, rather than writing a unit that points at a nonexistent file.
 */
async function resolveAgentdPath() {
  const override = process.env.LAMALIBRE_LAMASTE_AGENTD_PATH;
  if (override) {
    try {
      await access(override, fsConstants.X_OK);
      return override;
    } catch (err) {
      throw new Error(
        `LAMALIBRE_LAMASTE_AGENTD_PATH=${override} is not an executable file: ${err.message}`,
      );
    }
  }

  try {
    const { stdout } = await execa('which', ['lamaste-agentd']);
    const resolved = stdout.trim();
    if (!resolved) throw new Error('which returned empty output');
    await access(resolved, fsConstants.X_OK);
    return resolved;
  } catch (err) {
    throw new Error(
      'lamaste-agentd binary not found on PATH. Install it with ' +
        '`npm install -g @lamalibre/lamaste-agentd` and try again. ' +
        `(underlying error: ${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

/**
 * Generate the panel service config (plist or systemd unit).
 * @param {string} label - Agent label
 * @param {number} port - HTTP server port
 * @returns {Promise<string>}
 */
export async function generatePanelServiceConfig(label, port) {
  const agentdPath = await resolveAgentdPath();
  if (isDarwin()) {
    return generatePanelPlist(label, port, agentdPath);
  }
  return generatePanelSystemdUnit(label, port, agentdPath);
}

/**
 * Write the panel service config file to the appropriate location.
 * @param {string} content - Config file content
 * @param {string} label - Agent label
 */
export async function writePanelServiceConfig(content, label) {
  if (isDarwin()) {
    return writePanelPlist(content, label);
  }
  return writePanelSystemdUnit(content, label);
}

/**
 * Remove the panel service config file.
 * @param {string} label - Agent label
 */
export async function removePanelServiceConfig(label) {
  const filePath = isDarwin() ? panelPlistPath(label) : panelSystemdUnitPath(label);
  try {
    await unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
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

function generatePanelPlist(label, port, agentdPath) {
  const xmlEsc = (str) =>
    String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const serviceLabel = panelPlistLabel(label);
  const logFile = panelLogFile(label);
  const errorLogFile = panelErrorLogFile(label);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${xmlEsc(serviceLabel)}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${xmlEsc(agentdPath)}</string>
        <string>--label</string>
        <string>${xmlEsc(label)}</string>
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

async function writePanelPlist(content, label) {
  const filePath = panelPlistPath(label);
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  // Ensure logs directory exists for launchd stdout/stderr
  await mkdir(agentLogsDir(label), { recursive: true });
  const tmp = filePath + '.tmp';
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, filePath);
}

// ---------------------------------------------------------------------------
// Linux — systemd
// ---------------------------------------------------------------------------

function generatePanelSystemdUnit(label, port, agentdPath) {
  const systemdQuote = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

  const logFile = panelLogFile(label);
  const errorLogFile = panelErrorLogFile(label);
  const logsDir = agentLogsDir(label);
  const dataDir = agentDataDir(label);

  const execStart = [agentdPath, '--label', label, '--port', String(port)]
    .map(systemdQuote)
    .join(' ');

  return `[Unit]
Description=Lamaste Agent Panel Server (${label})
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
ProtectSystem=strict
ReadWritePaths=${logsDir} ${dataDir}

[Install]
WantedBy=multi-user.target
`;
}

async function writePanelSystemdUnit(content, label) {
  const logsDir = agentLogsDir(label);
  await mkdir(logsDir, { recursive: true });

  const filePath = panelSystemdUnitPath(label);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = filePath + '.tmp';
  await writeFile(tmp, content, { encoding: 'utf8', mode: 0o644 });
  await rename(tmp, filePath);

  await runUserSystemctl(['daemon-reload']);
  await warnIfLingerDisabled();
}

/**
 * User-scoped systemd services stop when the user's last login session ends
 * unless lingering is enabled. When the panel unit is written we probe the
 * current user's linger state with `loginctl show-user` and, if disabled,
 * print a one-line notice pointing at the `loginctl enable-linger` command.
 * We never attempt the enable ourselves — it requires root, and the agent
 * CLI is expected to run unprivileged.
 */
async function warnIfLingerDisabled() {
  if (isDarwin()) return;
  try {
    const user = process.env.USER || process.env.LOGNAME;
    if (!user) return;
    const { stdout } = await execa('loginctl', ['show-user', user, '--property=Linger', '--value']);
    if (stdout.trim() === 'yes') return;
    process.stderr.write(
      `  Note: user lingering is disabled. The agent panel service will stop when you log out.\n` +
        `        Run: sudo loginctl enable-linger ${user}\n`,
    );
  } catch {
    // loginctl not available (not systemd-logind, non-systemd init) — nothing to warn about.
  }
}
