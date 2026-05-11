/**
 * Unified service config generation.
 *
 * Dispatches to plist (macOS) or systemd unit (Linux) based on process.platform.
 * All functions accept a `label` parameter for per-agent service isolation.
 */

import { writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  isDarwin,
  CHISEL_BIN_PATH,
  plistLabel,
  plistPath,
  systemdUnitPath,
  agentLogFile,
  agentErrorLogFile,
  agentLogsDir,
  runUserSystemctl,
} from '@lamalibre/lamaste/agent';

/**
 * Validate chiselArgs against expected patterns to prevent injection.
 *
 * Expected layout (as returned by the panel `/api/tunnels/agent-config`):
 *
 *     ['client', '--tls-skip-verify', 'https://tunnel.DOMAIN:443', 'R:...', ...]
 *
 * After local injection, `--tls-skip-verify` may be replaced by
 * `--fingerprint <hex>` to pin the chisel server's TLS leaf cert (B10).
 * Both forms are accepted at index 1 — agents that have not yet captured
 * a pin keep emitting `--tls-skip-verify`.
 *
 * Optionally an auth pair `--auth user:password` may be inserted between
 * the TLS verification flag and the URL. The agent injects this pair
 * locally from its stored chisel credential — the panel never echoes the
 * credential back into chiselArgs.
 *
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

  // Index 1 is the chisel TLS verification mode. Either the legacy
  // --tls-skip-verify (no pin captured) or --fingerprint <hex> followed
  // by a 64-char SHA-256 hex digest (B10 pinning).
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

  // Optional --auth user:password pair before the URL
  if (chiselArgs[cursor] === '--auth') {
    const authValue = chiselArgs[cursor + 1];
    if (typeof authValue !== 'string') {
      throw new Error('Invalid chiselArgs: --auth flag missing value');
    }
    // Format: agent-<label>:<hex-password>. Reject anything with whitespace
    // or characters outside the printable ASCII subset chisel parses.
    if (!/^[a-z0-9-]+:[a-f0-9]{32,}$/.test(authValue)) {
      throw new Error('Invalid chiselArgs: --auth value does not match expected format');
    }
    cursor += 2;
  }

  // Validate URL argument
  if (!/^https:\/\/[a-z0-9._-]+:\d+$/.test(chiselArgs[cursor])) {
    throw new Error(`Invalid chiselArgs: unexpected server URL format: ${chiselArgs[cursor]}`);
  }
  cursor += 1;

  // Validate remaining args are R:127.0.0.1:port:127.0.0.1:port tunnel mappings.
  // Only 127.0.0.1 is accepted to prevent binding to all interfaces or pivoting
  // to internal network addresses via a compromised panel response.
  for (let i = cursor; i < chiselArgs.length; i++) {
    const arg = chiselArgs[i];
    if (/^R:127\.0\.0\.1:\d+:127\.0\.0\.1:\d+$/.test(arg)) continue;
    throw new Error(`Invalid chiselArgs: unexpected argument at index ${i}: ${arg}`);
  }
}

/**
 * Compute the index *after* the chisel TLS verification flag(s).
 * Returns 2 for `--tls-skip-verify`, 3 for `--fingerprint <hex>`. Anything
 * else is rejected because we never want to silently insert auth into an
 * unrecognised arg layout.
 *
 * @param {string[]} chiselArgs
 * @returns {number}
 */
function tlsArgsEnd(chiselArgs) {
  if (chiselArgs[1] === '--tls-skip-verify') return 2;
  if (chiselArgs[1] === '--fingerprint') return 3;
  throw new Error(
    `chiselArgs: expected --tls-skip-verify or --fingerprint at index 1, got: ${chiselArgs[1]}`,
  );
}

/**
 * Inject a chisel `--auth user:password` pair into a chiselArgs array.
 * The credential is placed immediately after the TLS-verification flag
 * (`--tls-skip-verify` or `--fingerprint <hex>`) and before the server URL
 * so the resulting array still passes `validateChiselArgs`.
 *
 * Returns a new array — the caller's input is not mutated.
 *
 * @param {string[]} chiselArgs - args from /api/tunnels/agent-config
 * @param {{ user: string, password: string }} credential
 * @returns {string[]}
 */
export function injectChiselAuth(chiselArgs, credential) {
  if (!credential || !credential.user || !credential.password) {
    throw new Error('injectChiselAuth: credential.user and credential.password are required');
  }
  // Reject malformed credential values defensively — a panel response with
  // a tampered chisel credential file should not lead to arg-list injection.
  if (!/^[a-z0-9-]+$/.test(credential.user)) {
    throw new Error('injectChiselAuth: credential.user has invalid characters');
  }
  if (!/^[a-f0-9]{32,}$/.test(credential.password)) {
    throw new Error('injectChiselAuth: credential.password has invalid characters');
  }
  const out = [...chiselArgs];
  // Replace any existing --auth pair the panel may have included (defensive
  // — the panel is not supposed to send one, but if it does the local
  // credential takes precedence).
  for (let i = 0; i < out.length; i++) {
    if (out[i] === '--auth') {
      out.splice(i, 2);
      i--;
    }
  }
  const insertAt = tlsArgsEnd(out);
  out.splice(insertAt, 0, '--auth', `${credential.user}:${credential.password}`);
  return out;
}

/**
 * Record the captured TLS leaf cert SHA-256 for the tunnel vhost.
 *
 * Historically this swapped `--tls-skip-verify` for `--fingerprint <hex>` under
 * the belief that `--fingerprint` pins the TLS leaf. It does not — chisel's
 * `--fingerprint` validates the *SSH server key* (base64 SHA-256 of the ECDSA
 * public key, not a TLS cert SHA-256 in hex). Swapping the two flags both
 * dropped TLS verification of the self-signed tunnel chain and fed chisel a
 * fingerprint value it cannot parse.
 *
 * We leave the args untouched — `--tls-skip-verify` stays, which lets the
 * TLS handshake succeed against the panel-issued tunnel cert. True TLS
 * pinning is tracked as follow-up work (needs `--tls-ca` with the CA bundle
 * or a chisel build that accepts TLS-leaf fingerprints).
 *
 * @param {string[]} chiselArgs
 * @param {string} _certSha256Hex - ignored for now; kept for API compat
 * @returns {string[]}
 */
export function injectChiselFingerprint(chiselArgs, _certSha256Hex) {
  return [...chiselArgs];
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
  // Build ExecStart with proper systemd quoting (double-quote each argument)
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

  // Reload user-level systemd so it picks up the new/changed unit file
  await runUserSystemctl(['daemon-reload']);
}
