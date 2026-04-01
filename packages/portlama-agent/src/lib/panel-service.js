/**
 * Panel HTTP server service management.
 *
 * Manages a separate launchd/systemd service for the agent panel web server,
 * independent of the chisel tunnel service. This allows the panel to remain
 * accessible even when the tunnel agent is stopped.
 */

import { writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import {
  isDarwin,
  panelPlistLabel,
  panelPlistPath,
  panelSystemdUnitName,
  panelSystemdUnitPath,
  panelLogFile,
  panelErrorLogFile,
  agentLogsDir,
  agentDataDir,
} from './platform.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the absolute path to the panel-server-entry.js script.
 * @returns {string}
 */
function panelEntryPath() {
  return path.resolve(__dirname, '..', 'panel-server-entry.js');
}

/**
 * Generate the panel service config (plist or systemd unit).
 * @param {string} label - Agent label
 * @param {number} port - HTTP server port
 * @returns {string}
 */
export function generatePanelServiceConfig(label, port) {
  if (isDarwin()) {
    return generatePanelPlist(label, port);
  }
  return generatePanelSystemdUnit(label, port);
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
 * Check if the panel service is loaded/active.
 * @param {string} label - Agent label
 * @returns {Promise<boolean>}
 */
export async function isPanelLoaded(label) {
  if (isDarwin()) {
    return macIsPanelLoaded(label);
  }
  return systemctlIsPanelActive(label);
}

/**
 * Start the panel service.
 * @param {string} label - Agent label
 */
export async function loadPanelService(label) {
  if (isDarwin()) {
    return macLoadPanel(label);
  }
  return systemctlStartPanel(label);
}

/**
 * Stop the panel service. Silent if not loaded.
 * @param {string} label - Agent label
 */
export async function unloadPanelService(label) {
  if (isDarwin()) {
    return macUnloadPanel(label);
  }
  return systemctlStopPanel(label);
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
      await execa('systemctl', ['daemon-reload']);
    } catch {
      // best-effort
    }
  }
}

// ---------------------------------------------------------------------------
// macOS — plist
// ---------------------------------------------------------------------------

function generatePanelPlist(label, port) {
  const xmlEsc = (str) =>
    String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const nodePath = process.execPath;
  const entryPath = panelEntryPath();
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
        <string>${xmlEsc(nodePath)}</string>
        <string>${xmlEsc(entryPath)}</string>
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
        <string>/usr/local/bin:/usr/bin:/bin</string>
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

async function macIsPanelLoaded(label) {
  try {
    const { stdout } = await execa('launchctl', ['list']);
    const serviceLabel = panelPlistLabel(label);
    return stdout.split('\n').some((line) => {
      const cols = line.trim().split(/\s+/);
      return cols[2] === serviceLabel;
    });
  } catch {
    return false;
  }
}

async function macLoadPanel(label) {
  const filePath = panelPlistPath(label);
  await execa('launchctl', ['load', filePath]);
}

async function macUnloadPanel(label) {
  try {
    const filePath = panelPlistPath(label);
    await execa('launchctl', ['unload', filePath]);
  } catch {
    // may not be loaded — that is fine
  }
}

// ---------------------------------------------------------------------------
// Linux — systemd
// ---------------------------------------------------------------------------

function generatePanelSystemdUnit(label, port) {
  const systemdQuote = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

  const nodePath = process.execPath;
  const entryPath = panelEntryPath();
  const logFile = panelLogFile(label);
  const errorLogFile = panelErrorLogFile(label);
  const logsDir = agentLogsDir(label);
  const dataDir = agentDataDir(label);

  const execStart = [nodePath, entryPath, '--label', label, '--port', String(port)]
    .map(systemdQuote)
    .join(' ');

  return `[Unit]
Description=Portlama Agent Panel Server (${label})
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
  const tmp = filePath + '.tmp';
  await writeFile(tmp, content, { encoding: 'utf8', mode: 0o644 });
  await rename(tmp, filePath);

  await execa('systemctl', ['daemon-reload']);
}

async function systemctlIsPanelActive(label) {
  try {
    await execa('systemctl', ['is-active', '--quiet', panelSystemdUnitName(label)]);
    return true;
  } catch {
    return false;
  }
}

async function systemctlStartPanel(label) {
  try {
    await execa('systemctl', ['daemon-reload']);
    await execa('systemctl', ['enable', '--now', panelSystemdUnitName(label)]);
  } catch (err) {
    throw new Error(`Failed to start panel service: ${err.stderr || err.message}`);
  }
}

async function systemctlStopPanel(label) {
  try {
    await execa('systemctl', ['disable', '--now', panelSystemdUnitName(label)]);
  } catch {
    // may not be active — that is fine
  }
}
