/**
 * Service config generation for the chisel tunnel client.
 *
 * Dispatches to plist (macOS) or systemd unit (Linux) based on process.platform.
 * Used by the agent update route to regenerate the service config after
 * fetching updated chiselArgs from the panel server.
 *
 * Extracted from lamaste-agent/src/lib/service-config.js.
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
} from '@lamalibre/lamaste/agent';

/**
 * Validate chiselArgs against expected patterns to prevent injection.
 * Mirrors the CLI validator — accepts the legacy `--tls-skip-verify` form
 * and the B10 `--fingerprint <hex>` form, with an optional injected
 * `--auth user:password` pair before the URL.
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
    if (/[\n\r\0]/.test(arg)) {
      throw new Error('Invalid chiselArgs: element contains newline or null byte');
    }
  }

  let cursor;
  if (chiselArgs[1] === '--tls-skip-verify') {
    cursor = 2;
  } else if (chiselArgs[1] === '--fingerprint') {
    const fp = chiselArgs[2];
    if (typeof fp !== 'string' || !/^[0-9a-f]{64}$/.test(fp)) {
      throw new Error('Invalid chiselArgs: --fingerprint requires a 64-char lowercase hex SHA-256');
    }
    cursor = 3;
  } else {
    throw new Error(
      `Invalid chiselArgs: expected --tls-skip-verify or --fingerprint at index 1, got: ${chiselArgs[1]}`,
    );
  }

  if (chiselArgs[cursor] === '--auth') {
    const authValue = chiselArgs[cursor + 1];
    if (typeof authValue !== 'string' || !/^[a-z0-9-]+:[a-f0-9]{32,}$/.test(authValue)) {
      throw new Error('Invalid chiselArgs: --auth value does not match expected format');
    }
    cursor += 2;
  }

  if (!/^https:\/\/[a-z0-9._-]+:\d+$/.test(chiselArgs[cursor])) {
    throw new Error(`Invalid chiselArgs: unexpected server URL format: ${chiselArgs[cursor]}`);
  }
  cursor += 1;

  for (let i = cursor; i < chiselArgs.length; i++) {
    const arg = chiselArgs[i];
    if (/^R:127\.0\.0\.1:\d+:127\.0\.0\.1:\d+$/.test(arg)) continue;
    throw new Error(`Invalid chiselArgs: unexpected argument at index ${i}: ${arg}`);
  }
}

/**
 * Replace `--tls-skip-verify` with `--fingerprint <hex>` (B10 chisel pin).
 * Returns a new array — the caller's input is not mutated. Idempotent if
 * `--fingerprint` is already in place; the existing fingerprint is overwritten.
 *
 * @param {string[]} chiselArgs
 * @param {string} certSha256Hex
 * @returns {string[]}
 */
export function injectChiselFingerprint(chiselArgs, certSha256Hex) {
  if (typeof certSha256Hex !== 'string' || !/^[0-9a-f]{64}$/.test(certSha256Hex)) {
    throw new Error(
      'injectChiselFingerprint: certSha256Hex must be a 64-char lowercase hex SHA-256',
    );
  }
  const out = [...chiselArgs];
  if (out[1] === '--tls-skip-verify') {
    out.splice(1, 1, '--fingerprint', certSha256Hex);
  } else if (out[1] === '--fingerprint') {
    out[2] = certSha256Hex;
  } else {
    throw new Error(
      `injectChiselFingerprint: expected --tls-skip-verify or --fingerprint at index 1, got: ${out[1]}`,
    );
  }
  return out;
}

/**
 * Generate service config text from chiselArgs for a specific agent.
 * @param {string[]} chiselArgs
 * @param {string} label
 * @returns {string}
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
 * @param {string} content
 * @param {string} label
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
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
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
  const systemdQuote = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const execStart = [CHISEL_BIN_PATH, ...chiselArgs].map(systemdQuote).join(' ');

  const logFile = agentLogFile(label);
  const errorLogFile = agentErrorLogFile(label);
  const logsDir = agentLogsDir(label);

  return `[Unit]
Description=Lamaste Chisel Tunnel Client (${label})
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
WantedBy=default.target
`;
}

async function writeSystemdUnitFile(content, label) {
  const logsDir = agentLogsDir(label);
  await mkdir(logsDir, { recursive: true });

  const filePath = systemdUnitPath(label);
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  await writeFile(tmp, content, { encoding: 'utf8', mode: 0o644 });
  await rename(tmp, filePath);

  await execa('systemctl', ['--user', 'daemon-reload']);
}
