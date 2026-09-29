/**
 * The agent's sync timer — runs `lamaste-agent sync --label <label>` every
 * {@link SYNC_INTERVAL_SECONDS} seconds.
 *
 * Why a timer: the relay grants each agent exactly the ports of the enabled
 * tunnels it carries, and chisel rejects a client's whole session when a single
 * remote it asks for is not granted. So when a tunnel is disabled, deleted or
 * moved, the owning agent must drop that remote promptly or all of its other
 * tunnels stay dark. `sync` converges the local chisel service with the
 * relay's view (see converge.ts) and does nothing when they already agree.
 *
 * Why a global install: the timer outlives the shell that set it up, so it
 * must name a stable program. An `npx` run lives in a cache directory npm may
 * delete at any time; the timer would silently stop. Setup therefore requires
 * `npm install -g @lamalibre/lamaste-agent` and records the absolute paths of
 * the Node.js binary and the installed CLI script.
 *
 * - Linux: a systemd user service (Type=oneshot) plus a user timer.
 * - macOS: a LaunchAgent with `StartInterval`.
 */

import {
  access,
  constants,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { productBundleId, productUnit } from '../branding.js';
import { agentDataDir, agentLogsDir, isDarwin } from './platform.js';
import { runUserSystemctl } from './user-systemd-env.js';
import { withAgentLock } from './agent-lock.js';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Names and paths
// ---------------------------------------------------------------------------

export const SYNC_INTERVAL_SECONDS = 30;

/** LaunchAgent label. Deliberately outside the `chisel-` prefix that
 *  `listLoadedAgents` scans for chisel services. */
export function syncPlistLabel(label: string): string {
  return productBundleId(`sync-${label}`);
}

export function syncPlistPath(label: string): string {
  return path.join(homedir(), 'Library', 'LaunchAgents', `${syncPlistLabel(label)}.plist`);
}

export function syncSystemdServiceName(label: string): string {
  return `${productUnit(`sync-${label}`)}.service`;
}

export function syncSystemdTimerName(label: string): string {
  return `${productUnit(`sync-${label}`)}.timer`;
}

function systemdUserDir(): string {
  return path.join(homedir(), '.config', 'systemd', 'user');
}

export function syncLogFile(label: string): string {
  return path.join(agentLogsDir(label), 'sync.log');
}

/** Last outcome of `lamaste-agent sync`, for `status` and log de-duplication. */
export function syncStateFile(label: string): string {
  return path.join(agentDataDir(label), 'sync-state.json');
}

// ---------------------------------------------------------------------------
// Resolving the installed CLI
// ---------------------------------------------------------------------------

/** The program the timer runs: `<node> <script> sync --label <label>`. */
export interface AgentCliProgram {
  /** Absolute path of the Node.js binary. */
  readonly node: string;
  /** Absolute, symlink-free path of the installed `lamaste-agent` script. */
  readonly script: string;
}

/**
 * Resolve the globally installed `lamaste-agent` CLI that the timer will run,
 * given the script this process was started from (`process.argv[1]`).
 *
 * Accepted when the script lives under npm's global `node_modules`
 * (`npm root -g`). `LAMALIBRE_LAMASTE_AGENT_CLI_PATH` overrides the check for
 * installations npm does not manage (it must name an existing script).
 * Throws with the install command otherwise — in particular for `npx`.
 */
export async function resolveInstalledAgentCli(currentScript: string): Promise<AgentCliProgram> {
  const node = await stableNodePath();
  const override = process.env['LAMALIBRE_LAMASTE_AGENT_CLI_PATH'];
  if (override) {
    const script = await realpath(override).catch(() => null);
    if (!script) {
      throw new Error(`LAMALIBRE_LAMASTE_AGENT_CLI_PATH=${override} does not exist`);
    }
    return { node, script };
  }

  const script = await realpath(currentScript);
  const { execa } = await import('execa');
  let globalRoot: string;
  try {
    const { stdout } = await execa('npm', ['root', '-g'], { timeout: 30_000 });
    globalRoot = await realpath(stdout.trim());
  } catch (err: unknown) {
    throw new Error(
      `Cannot locate npm's global package directory (npm root -g): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!script.startsWith(globalRoot + path.sep)) {
    throw new Error(
      'lamaste-agent must be installed globally: its sync timer runs the installed program ' +
        'every 30 seconds, and an npx copy can disappear from the npm cache at any time.\n' +
        '  npm install -g @lamalibre/lamaste-agent\n' +
        'then run `lamaste-agent setup ...` again.',
    );
  }
  return { node, script };
}

/**
 * The path of the running Node.js binary that survives upgrades of it.
 *
 * `process.execPath` is the resolved binary — on Homebrew a versioned
 * `Cellar/node/<version>/bin/node` that `brew upgrade node` deletes, which
 * would silently stop the timer. When a `node` on PATH resolves to the same
 * binary, that stable path (e.g. `/opt/homebrew/bin/node`) is used instead.
 */
async function stableNodePath(): Promise<string> {
  const actual = await realpath(process.execPath).catch(() => process.execPath);
  for (const dir of (process.env['PATH'] ?? '').split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, 'node');
    const resolved = await realpath(candidate).catch(() => null);
    if (resolved === actual) return candidate;
  }
  return process.execPath;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

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

function syncArgs(program: AgentCliProgram, label: string): string[] {
  return [program.node, program.script, 'sync', '--label', label, '--quiet'];
}

export function renderSyncPlist(label: string, program: AgentCliProgram): string {
  const args = syncArgs(program, label)
    .map((a) => `        <string>${xmlEscape(a)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${xmlEscape(syncPlistLabel(label))}</string>

    <key>ProgramArguments</key>
    <array>
${args}
    </array>

    <key>StartInterval</key>
    <integer>${SYNC_INTERVAL_SECONDS}</integer>

    <key>RunAtLoad</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${xmlEscape(syncLogFile(label))}</string>

    <key>StandardErrorPath</key>
    <string>${xmlEscape(syncLogFile(label))}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
`;
}

export function renderSyncSystemdService(label: string, program: AgentCliProgram): string {
  const execStart = syncArgs(program, label).map(systemdQuote).join(' ');
  return `[Unit]
Description=Lamaste agent sync (${label})
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=${execStart}
TimeoutStartSec=5min
StandardOutput=append:${syncLogFile(label)}
StandardError=append:${syncLogFile(label)}
Environment=PATH=/usr/local/bin:/usr/bin:/bin
`;
}

export function renderSyncSystemdTimer(label: string): string {
  return `[Unit]
Description=Lamaste agent sync every ${SYNC_INTERVAL_SECONDS}s (${label})

[Timer]
OnActiveSec=5s
OnUnitInactiveSec=${SYNC_INTERVAL_SECONDS}s
AccuracySec=5s
Unit=${syncSystemdServiceName(label)}

[Install]
WantedBy=timers.target
`;
}

// ---------------------------------------------------------------------------
// Installing and removing
// ---------------------------------------------------------------------------

async function writeIfChanged(filePath: string, content: string, mode: number): Promise<boolean> {
  await mkdir(path.dirname(filePath), { recursive: true });
  let current: string | null = null;
  try {
    current = await readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (current === content) return false;
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, content, { encoding: 'utf-8', mode });
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
 * Install (or update) and start the sync timer for an agent. Idempotent: an
 * unchanged definition is not reloaded.
 */
export async function installSyncService(label: string, program: AgentCliProgram): Promise<void> {
  await mkdir(agentLogsDir(label), { recursive: true });
  const { execa } = await import('execa');

  if (isDarwin()) {
    const plist = syncPlistPath(label);
    const changed = await writeIfChanged(plist, renderSyncPlist(label, program), 0o644);
    const loaded = await isSyncServiceLoaded(label);
    if (changed && loaded) {
      await execa('launchctl', ['unload', plist]).catch(() => undefined);
    }
    if (changed || !loaded) {
      await execa('launchctl', ['load', plist]);
    }
    return;
  }

  const dir = systemdUserDir();
  const serviceChanged = await writeIfChanged(
    path.join(dir, syncSystemdServiceName(label)),
    renderSyncSystemdService(label, program),
    0o644,
  );
  const timerChanged = await writeIfChanged(
    path.join(dir, syncSystemdTimerName(label)),
    renderSyncSystemdTimer(label),
    0o644,
  );
  if (serviceChanged || timerChanged) {
    await runUserSystemctl(['daemon-reload']);
  }
  await runUserSystemctl(['enable', '--now', syncSystemdTimerName(label)]);
  if (timerChanged) {
    await runUserSystemctl(['restart', syncSystemdTimerName(label)]);
  }
}

/**
 * Stop and remove the sync timer. Silent when it is not installed.
 *
 * Also ends a sync run already in progress (unloading a LaunchAgent
 * terminates its job; the systemd service is stopped explicitly) and then
 * waits for the agent lock, so no sync can load the tunnel client again after
 * this returns — callers remove the client service next.
 */
export async function removeSyncService(label: string): Promise<void> {
  const { execa } = await import('execa');
  if (isDarwin()) {
    const plist = syncPlistPath(label);
    await execa('launchctl', ['unload', plist]).catch(() => undefined);
    await rm(plist, { force: true });
  } else {
    await runUserSystemctl(['disable', '--now', syncSystemdTimerName(label)]).catch(
      () => undefined,
    );
    await runUserSystemctl(['stop', syncSystemdServiceName(label)]).catch(() => undefined);
    const dir = systemdUserDir();
    await rm(path.join(dir, syncSystemdTimerName(label)), { force: true });
    await rm(path.join(dir, syncSystemdServiceName(label)), { force: true });
    await runUserSystemctl(['daemon-reload']).catch(() => undefined);
  }
  await withAgentLock(label, async () => undefined).catch(() => undefined);
}

/** True when the sync timer is installed and active. */
export async function isSyncServiceLoaded(label: string): Promise<boolean> {
  if (isDarwin()) {
    const { execa } = await import('execa');
    try {
      const { stdout } = await execa('launchctl', ['list']);
      const target = syncPlistLabel(label);
      return stdout.split('\n').some((line) => line.split('\t')[2] === target);
    } catch {
      return false;
    }
  }
  try {
    await runUserSystemctl(['is-active', '--quiet', syncSystemdTimerName(label)]);
    return true;
  } catch {
    return false;
  }
}

/** True when the sync timer's definition file exists. */
export async function isSyncServiceInstalled(label: string): Promise<boolean> {
  const file = isDarwin()
    ? syncPlistPath(label)
    : path.join(systemdUserDir(), syncSystemdTimerName(label));
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Last sync outcome
// ---------------------------------------------------------------------------

export interface SyncState {
  /** When sync last ran (ISO 8601). */
  readonly lastRunAt: string;
  /** When sync last succeeded. */
  readonly lastOkAt: string | null;
  /** The last failure's message, or null after a success. */
  readonly lastError: string | null;
  /** What the last successful run left the tunnel service doing. */
  readonly lastState: 'running' | 'idle' | 'stopped' | null;
  /** Number of tunnels the agent carried at the last successful run. */
  readonly tunnels: number | null;
  /** Warnings of the last successful run, so repeats are logged once. */
  readonly lastWarnings?: readonly string[] | undefined;
}

/**
 * True when the last run is older than a few timer intervals — the timer is
 * not running (unloaded, or its program no longer exists).
 */
export function isSyncStale(state: SyncState, now = Date.now()): boolean {
  return now - Date.parse(state.lastRunAt) > 4 * SYNC_INTERVAL_SECONDS * 1000;
}

export async function readSyncState(label: string): Promise<SyncState | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(syncStateFile(label), 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as SyncState;
  } catch {
    return null;
  }
}

export async function writeSyncState(label: string, state: SyncState): Promise<void> {
  await writeIfChanged(syncStateFile(label), JSON.stringify(state, null, 2) + '\n', 0o600);
}
