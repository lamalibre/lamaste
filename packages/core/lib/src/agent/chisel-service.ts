/**
 * The agent's chisel client service — the one implementation used by both
 * the `lamaste-agent` CLI and the `lamaste-agentd` daemon.
 *
 * Three rules, each load-bearing:
 *
 * 1. **TLS is verified.** The chisel server sits behind nginx on
 *    `tunnel.<domain>:443` with a Let's Encrypt certificate, so the chisel
 *    client verifies it against the system roots like any HTTPS client.
 *    `--tls-skip-verify` is never emitted, and is dropped if an older panel
 *    still sends it — skipping verification would let anyone on the path
 *    impersonate the relay, collect the agent's chisel credential, and read
 *    every tunnelled request.
 * 2. **The credential never appears in process arguments.** Arguments are
 *    world-readable through `ps`. Chisel reads `AUTH=<user>:<password>` from
 *    its environment when `--auth` is absent, so the credential is delivered
 *    through a 0600 environment file (systemd) or the 0600 plist's
 *    `EnvironmentVariables` (launchd).
 * 3. **Only loopback remotes.** Every remote must be
 *    `R:127.0.0.1:<port>:127.0.0.1:<port>`: a compromised or spoofed panel
 *    response must not make the agent bind other interfaces or pivot into the
 *    agent's network.
 * 4. **Only the enrolled relay.** The server URL must be
 *    `https://tunnel.<domain>:443` for the domain the agent enrolled with
 *    ({@link assertRelayServerUrl}); a panel response cannot point the client,
 *    and its credential, at another host.
 */

import { chmod, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  CHISEL_BIN_PATH,
  agentDataDir,
  agentErrorLogFile,
  agentLogFile,
  agentLogsDir,
  isDarwin,
  plistLabel,
  plistPath,
  systemdUnitPath,
} from './platform.js';
import { runUserSystemctl } from './user-systemd-env.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What the chisel client needs, independent of platform. */
export interface ChiselClientSpec {
  /** `https://tunnel.<domain>:443` */
  readonly serverUrl: string;
  /** `R:127.0.0.1:<port>:127.0.0.1:<port>` entries, one per carried tunnel. */
  readonly remotes: readonly string[];
}

export interface ChiselCredential {
  readonly user: string;
  readonly password: string;
}

// ---------------------------------------------------------------------------
// Parsing the panel's chiselArgs
// ---------------------------------------------------------------------------

const SERVER_URL_RE = /^https:\/\/[a-z0-9.-]+:\d{1,5}$/;
const REMOTE_RE = /^R:127\.0\.0\.1:(\d{1,5}):127\.0\.0\.1:(\d{1,5})$/;
const USER_RE = /^[a-z0-9-]+$/;
const PASSWORD_RE = /^[a-f0-9]{32,}$/;

/**
 * Parse and validate the `chiselArgs` array from `GET /api/tunnels/agent-config`.
 *
 * Accepted: `['client', <serverUrl>, ...remotes]`. Panels older than this
 * version send `['client', '--tls-skip-verify', <serverUrl>, ...remotes]`;
 * the flag is accepted and discarded, never propagated. Anything else —
 * unknown flags, a credential, non-loopback remotes, control characters — is
 * rejected.
 */
export function parseChiselArgs(chiselArgs: unknown): ChiselClientSpec {
  if (!Array.isArray(chiselArgs) || chiselArgs.length < 2) {
    throw new Error('Invalid chiselArgs: expected at least ["client", <serverUrl>]');
  }
  for (const arg of chiselArgs) {
    if (typeof arg !== 'string') {
      throw new Error('Invalid chiselArgs: all elements must be strings');
    }
    if (/[\u0000-\u001f\u007f]/.test(arg)) {
      throw new Error('Invalid chiselArgs: element contains a control character');
    }
  }
  const args = chiselArgs as string[];
  if (args[0] !== 'client') {
    throw new Error('Invalid chiselArgs: first element must be "client"');
  }

  let cursor = 1;
  if (args[cursor] === '--tls-skip-verify') cursor += 1;

  const serverUrl = args[cursor];
  if (serverUrl === undefined || !SERVER_URL_RE.test(serverUrl)) {
    throw new Error(`Invalid chiselArgs: unexpected server URL: ${String(serverUrl)}`);
  }
  cursor += 1;

  const remotes: string[] = [];
  for (; cursor < args.length; cursor++) {
    const remote = args[cursor] as string;
    const match = REMOTE_RE.exec(remote);
    if (!match || match[1] !== match[2] || !isPort(Number(match[1]))) {
      throw new Error(`Invalid chiselArgs: unexpected argument at index ${cursor}: ${remote}`);
    }
    remotes.push(remote);
  }

  return { serverUrl, remotes };
}

/** The only chisel server URL an agent enrolled for `domain` will use. */
export function relayServerUrl(domain: string): string {
  return `https://tunnel.${domain}:443`;
}

/**
 * Refuse a chisel server URL other than the enrolled relay's. Returns the
 * spec unchanged when it matches.
 */
export function assertRelayServerUrl(spec: ChiselClientSpec, domain: string): ChiselClientSpec {
  const expected = relayServerUrl(domain);
  if (spec.serverUrl !== expected) {
    throw new Error(
      `Refusing chisel server ${spec.serverUrl}: this agent is enrolled with ${domain} ` +
        `and only connects to ${expected}. Re-enroll the agent to move it to another relay.`,
    );
  }
  return spec;
}

function isPort(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

function assertCredential(credential: ChiselCredential): void {
  if (!credential || !USER_RE.test(credential.user) || !PASSWORD_RE.test(credential.password)) {
    throw new Error('Invalid chisel credential');
  }
}

/**
 * Longest wait between reconnection attempts. Chisel's default backs off to
 * five minutes; a relay restart (which follows every revocation) would then
 * leave tunnels down for minutes after the relay is back.
 */
export const CHISEL_MAX_RETRY_INTERVAL = '30s';

/** The chisel client argv, without the binary. Contains no secret. */
export function chiselClientArgs(spec: ChiselClientSpec): string[] {
  return [
    'client',
    '--max-retry-interval',
    CHISEL_MAX_RETRY_INTERVAL,
    spec.serverUrl,
    ...spec.remotes,
  ];
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Path of the 0600 environment file carrying `AUTH=` for the systemd unit. */
export function chiselEnvFilePath(label: string): string {
  return path.join(agentDataDir(label), 'chisel.env');
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function systemdQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * launchd plist for the chisel client. Carries the credential in
 * `EnvironmentVariables`, so the file is written 0600.
 */
export function renderChiselPlist(
  spec: ChiselClientSpec,
  label: string,
  credential: ChiselCredential,
): string {
  assertCredential(credential);
  const programArgs = [CHISEL_BIN_PATH, ...chiselClientArgs(spec)]
    .map((a) => `        <string>${xmlEscape(a)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${xmlEscape(plistLabel(label))}</string>

    <key>ProgramArguments</key>
    <array>
${programArgs}
    </array>

    <key>KeepAlive</key>
    <true/>

    <key>RunAtLoad</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${xmlEscape(agentLogFile(label))}</string>

    <key>StandardErrorPath</key>
    <string>${xmlEscape(agentErrorLogFile(label))}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>AUTH</key>
        <string>${xmlEscape(`${credential.user}:${credential.password}`)}</string>
    </dict>
</dict>
</plist>
`;
}

/**
 * systemd user unit for the chisel client. The credential lives in
 * `EnvironmentFile=` (see {@link chiselEnvFilePath}), not in the unit.
 */
export function renderChiselSystemdUnit(spec: ChiselClientSpec, label: string): string {
  const execStart = [CHISEL_BIN_PATH, ...chiselClientArgs(spec)].map(systemdQuote).join(' ');
  return `[Unit]
Description=Lamaste Chisel Tunnel Client (${label})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
EnvironmentFile=${chiselEnvFilePath(label)}
Restart=always
RestartSec=5
StandardOutput=append:${agentLogFile(label)}
StandardError=append:${agentErrorLogFile(label)}
Environment=PATH=/usr/local/bin:/usr/bin:/bin
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${agentLogsDir(label)}

[Install]
WantedBy=default.target
`;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Write `content` atomically unless the file already holds exactly that.
 * Returns whether the file changed. The mode is (re)applied either way.
 */
async function atomicWrite(filePath: string, content: string, mode: number): Promise<boolean> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  let current: string | null = null;
  try {
    current = await readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (current === content) {
    await chmod(filePath, mode);
    return false;
  }
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, content, { encoding: 'utf-8', mode });
  await chmod(tmp, mode);
  const fd = await open(tmp, 'r');
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
  await rename(tmp, filePath);
  return true;
}

/**
 * Restrict an agent's data directory to its owner. It holds the agent's
 * private key or p12, its chisel credential and its environment file; older
 * versions created it with the default (world-listable) mode.
 */
export async function secureAgentDataDir(label: string): Promise<void> {
  await mkdir(agentDataDir(label), { recursive: true, mode: 0o700 });
  await chmod(agentDataDir(label), 0o700);
}

/**
 * Write the chisel client service definition for an agent: the launchd plist
 * (0600, credential inside) on macOS, or the systemd user unit plus its 0600
 * environment file on Linux, followed by `systemctl --user daemon-reload`
 * when anything changed. Files already holding the right content are left
 * alone. Does not start or restart the service; returns whether any file
 * changed, which is when a running service must be restarted.
 */
export async function writeChiselService(
  label: string,
  spec: ChiselClientSpec,
  credential: ChiselCredential,
): Promise<{ readonly changed: boolean }> {
  assertCredential(credential);
  await secureAgentDataDir(label);
  await mkdir(agentLogsDir(label), { recursive: true });

  if (isDarwin()) {
    const changed = await atomicWrite(
      plistPath(label),
      renderChiselPlist(spec, label, credential),
      0o600,
    );
    return { changed };
  }

  const envChanged = await atomicWrite(
    chiselEnvFilePath(label),
    `AUTH=${credential.user}:${credential.password}\n`,
    0o600,
  );
  const unitChanged = await atomicWrite(
    systemdUnitPath(label),
    renderChiselSystemdUnit(spec, label),
    0o644,
  );
  if (unitChanged) await runUserSystemctl(['daemon-reload']);
  return { changed: envChanged || unitChanged };
}

// ---------------------------------------------------------------------------
// Boot persistence (Linux)
// ---------------------------------------------------------------------------

/**
 * Whether the agent's user-level services start at boot without a login.
 *
 * The chisel client is a systemd *user* unit. Without lingering, the user's
 * systemd instance — and the tunnel with it — only exists while that user is
 * logged in: a headless server or VM loses its tunnels at every reboot until
 * someone logs in. Enabling it needs privileges the agent does not hold:
 * `sudo loginctl enable-linger <user>`.
 *
 * Returns `'n/a'` on macOS, where LaunchAgents start at login by design.
 */
export async function userLingerStatus(): Promise<'enabled' | 'disabled' | 'unknown' | 'n/a'> {
  if (isDarwin()) return 'n/a';
  const { execa } = await import('execa');
  try {
    const { stdout } = await execa('loginctl', [
      'show-user',
      os.userInfo().username,
      '--property=Linger',
      '--value',
    ]);
    const value = stdout.trim();
    if (value === 'yes') return 'enabled';
    if (value === 'no') return 'disabled';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The command an operator runs to make this user's services start at boot. */
export function enableLingerCommand(): string {
  return `sudo loginctl enable-linger ${os.userInfo().username}`;
}
