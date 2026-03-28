/**
 * Unified service config generation.
 *
 * Dispatches to plist (macOS) or systemd unit (Linux) based on process.platform.
 * All functions accept a `label` parameter for per-agent service isolation.
 */

import { writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import {
  isDarwin,
  CHISEL_BIN_PATH,
  plistLabel,
  plistPath,
  systemdUnitPath,
  agentLogFile,
  agentErrorLogFile,
  agentLogsDir,
} from './platform.js';

/**
 * Validate chiselArgs against expected patterns to prevent injection.
 * Chisel args must be: ['client', '--tls-skip-verify', 'https://tunnel.DOMAIN:443', 'R:...', ...]
 * @param {string[]} chiselArgs
 */
function validateChiselArgs(chiselArgs) {
  if (!Array.isArray(chiselArgs) || chiselArgs.length < 3) {
    throw new Error('Invalid chiselArgs: expected at least 3 elements');
  }
  if (chiselArgs[0] !== 'client') {
    throw new Error('Invalid chiselArgs: first element must be "client"');
  }

  for (const arg of chiselArgs) {
    if (typeof arg !== 'string') {
      throw new Error('Invalid chiselArgs: all elements must be strings');
    }
    // Reject newlines, null bytes, and other control characters
    if (/[\n\r\0]/.test(arg)) {
      throw new Error('Invalid chiselArgs: element contains newline or null byte');
    }
  }

  // Validate the --tls-skip-verify flag at index 1 (only allowed flag)
  if (chiselArgs[1] !== '--tls-skip-verify') {
    throw new Error(`Invalid chiselArgs: expected --tls-skip-verify at index 1, got: ${chiselArgs[1]}`);
  }

  // Validate URL argument (3rd element)
  if (!/^https:\/\/[a-z0-9._-]+:\d+$/.test(chiselArgs[2])) {
    throw new Error(`Invalid chiselArgs: unexpected server URL format: ${chiselArgs[2]}`);
  }

  // Validate remaining args are R:127.0.0.1:port:127.0.0.1:port tunnel mappings.
  // Only 127.0.0.1 is accepted to prevent binding to all interfaces or pivoting
  // to internal network addresses via a compromised panel response.
  for (let i = 3; i < chiselArgs.length; i++) {
    const arg = chiselArgs[i];
    if (/^R:127\.0\.0\.1:\d+:127\.0\.0\.1:\d+$/.test(arg)) continue;
    throw new Error(`Invalid chiselArgs: unexpected argument at index ${i}: ${arg}`);
  }
}

/**
 * Generate service config text from chiselArgs for a specific agent.
 * @param {string[]} chiselArgs - Chisel client argument array
 * @param {string} label - Agent label
 * @returns {string} Config file content (plist XML on macOS, systemd unit on Linux)
 */
export function generateServiceConfig(chiselArgs, label) {
  validateChiselArgs(chiselArgs);
  if (isDarwin()) {
    return generatePlistConfig(chiselArgs, label);
  }
  return generateSystemdUnit(chiselArgs, label);
}

/**
 * Write the service config file to the platform-appropriate location.
 * @param {string} content - Config file content
 * @param {string} label - Agent label
 */
export async function writeServiceConfigFile(content, label) {
  if (isDarwin()) {
    return writePlistConfigFile(content, label);
  }
  return writeSystemdUnitFile(content, label);
}

// ---------------------------------------------------------------------------
// macOS — plist
// ---------------------------------------------------------------------------

function generatePlistConfig(chiselArgs, label) {
  const xmlEsc = (str) =>
    String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  // First arg is the binary path, rest are arguments
  const programArgs = [
    `        <string>${xmlEsc(CHISEL_BIN_PATH)}</string>`,
    ...chiselArgs.map((arg) => `        <string>${xmlEsc(arg)}</string>`),
  ];

  const logFile = agentLogFile(label);
  const errorLogFile = agentErrorLogFile(label);
  const serviceLabel = plistLabel(label);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${xmlEsc(serviceLabel)}</string>

    <key>ProgramArguments</key>
    <array>
${programArgs.join('\n')}
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

async function writePlistConfigFile(content, label) {
  const filePath = plistPath(label);
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, filePath);
}

// ---------------------------------------------------------------------------
// Linux — systemd
// ---------------------------------------------------------------------------

function generateSystemdUnit(chiselArgs, label) {
  // Build ExecStart with proper systemd quoting (double-quote each argument)
  const systemdQuote = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const execStart = [CHISEL_BIN_PATH, ...chiselArgs].map(systemdQuote).join(' ');

  const logFile = agentLogFile(label);
  const errorLogFile = agentErrorLogFile(label);
  const logsDir = agentLogsDir(label);

  return `[Unit]
Description=Portlama Chisel Tunnel Client (${label})
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
ReadWritePaths=${logsDir}

[Install]
WantedBy=multi-user.target
`;
}

async function writeSystemdUnitFile(content, label) {
  const logsDir = agentLogsDir(label);
  await mkdir(logsDir, { recursive: true });

  const filePath = systemdUnitPath(label);
  const tmp = filePath + '.tmp';
  await writeFile(tmp, content, { encoding: 'utf8', mode: 0o644 });
  await rename(tmp, filePath);

  // Reload systemd so it picks up the new/changed unit file
  await execa('systemctl', ['daemon-reload']);
}
