/**
 * Unified service management interface.
 *
 * Dispatches to launchctl (macOS) or systemctl (Linux) based on process.platform.
 * All functions accept a `label` parameter for per-agent service isolation.
 *
 * Panel service management is also included — the agent panel server runs
 * on port 9393 as a separate service alongside the chisel tunnel service.
 */

import {
  isDarwin,
  panelPlistPath,
  panelSystemdUnitName,
  panelPlistLabel,
  plistLabel,
  systemdUnitName,
} from './platform.js';
import { runUserSystemctl } from './user-systemd-env.js';

/** Snapshot of a loaded service's runtime state. */
export interface LoadedAgentState {
  loaded: boolean;
  pid: number | null;
}

// ---------------------------------------------------------------------------
// Agent chisel service
// ---------------------------------------------------------------------------

/**
 * Check if the agent service is currently loaded/active.
 */
export async function isAgentLoaded(label: string): Promise<boolean> {
  if (isDarwin()) {
    const { isAgentLoaded: macIsLoaded } = await import('./launchctl.js');
    return macIsLoaded(label);
  }
  const { isAgentActive } = await import('./systemd.js');
  return isAgentActive(label);
}

/**
 * Get the PID of the running agent, or null if not running.
 */
export async function getAgentPid(label: string): Promise<number | null> {
  if (isDarwin()) {
    const { getAgentPid: macGetPid } = await import('./launchctl.js');
    return macGetPid(label);
  }
  const { getAgentPid: linuxGetPid } = await import('./systemd.js');
  return linuxGetPid(label);
}

/**
 * Load/start the agent service.
 */
export async function loadAgent(label: string): Promise<void> {
  if (isDarwin()) {
    const { loadAgent: macLoad } = await import('./launchctl.js');
    return macLoad(label);
  }
  const { startAgent } = await import('./systemd.js');
  return startAgent(label);
}

/**
 * Unload/stop the agent service. Silent if not loaded.
 */
export async function unloadAgent(label: string): Promise<void> {
  if (isDarwin()) {
    const { unloadAgent: macUnload } = await import('./launchctl.js');
    return macUnload(label);
  }
  const { stopAgent } = await import('./systemd.js');
  return stopAgent(label);
}

/**
 * Restart the agent service (unload + load).
 *
 * Both platforms use unload+load because launchctl requires it to pick up
 * plist changes — there is no `launchctl restart`. systemd's `restart`
 * subsumes both, but staying with the same shape keeps the cross-platform
 * code path identical and lets `unloadAgent`/`loadAgent` own the
 * platform-specific subprocess handling.
 */
export async function restartAgent(label: string): Promise<void> {
  await unloadAgent(label);
  await loadAgent(label);
}

// ---------------------------------------------------------------------------
// Agent panel service
// ---------------------------------------------------------------------------

/**
 * Check if the agent panel service is loaded/active.
 */
export async function isPanelServiceLoaded(label: string): Promise<boolean> {
  if (isDarwin()) {
    try {
      const { execa } = await import('execa');
      const target = panelPlistLabel(label);
      const { stdout } = await execa('launchctl', ['list']);
      for (const line of stdout.split('\n')) {
        const cols = line.split('\t');
        if (cols[2] === target) return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  try {
    await runUserSystemctl(['is-active', '--quiet', panelSystemdUnitName(label)]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load/start the agent panel service.
 */
export async function loadPanelService(label: string): Promise<void> {
  // launchctl reads the plist on `load`; systemd needs an explicit
  // `daemon-reload` first to pick up unit-file edits before `enable --now`.
  if (isDarwin()) {
    const { execa } = await import('execa');
    await execa('launchctl', ['load', panelPlistPath(label)]);
  } else {
    await runUserSystemctl(['daemon-reload']);
    await runUserSystemctl(['enable', '--now', panelSystemdUnitName(label)]);
  }
}

/**
 * Unload/stop the agent panel service. Silent if not loaded.
 */
export async function unloadPanelService(label: string): Promise<void> {
  try {
    // Symmetric with loadPanelService: launchctl unloads the plist;
    // systemd disables the unit and stops it in one shot.
    if (isDarwin()) {
      const { execa } = await import('execa');
      await execa('launchctl', ['unload', panelPlistPath(label)]);
    } else {
      await runUserSystemctl(['disable', '--now', panelSystemdUnitName(label)]);
    }
  } catch {
    // May not be loaded — this is fine
  }
}

/**
 * Restart the agent panel service (unload + load).
 *
 * Same shape as restartAgent: launchctl requires unload+load to pick up
 * plist changes; systemd's `restart` would suffice on Linux, but the
 * disable/enable pair inside loadPanelService/unloadPanelService also
 * toggles the boot-time-enable bit, which matches the desired semantics
 * for an agent operator restarting the panel after editing its unit.
 */
export async function restartPanelService(label: string): Promise<void> {
  await unloadPanelService(label);
  await loadPanelService(label);
}

// ---------------------------------------------------------------------------
// Batched service-state query (avoid N+1 launchctl/systemctl spawns)
// ---------------------------------------------------------------------------

/**
 * Query loaded state and PID for every agent service in a single subprocess
 * call (one launchctl/systemctl invocation regardless of agent count).
 *
 * Returns a Map keyed by agent label. Labels with no entry in the OS service
 * table are absent from the Map (callers should treat absence as "not loaded").
 *
 * If the platform-specific batch path fails (e.g. a systemd version too old
 * to support `--output=json`), the error propagates so callers can fall back
 * to per-label queries.
 */
export async function listLoadedAgents(): Promise<Map<string, LoadedAgentState>> {
  if (isDarwin()) {
    return listLoadedAgentsDarwin();
  }
  return listLoadedAgentsLinux();
}

async function listLoadedAgentsDarwin(): Promise<Map<string, LoadedAgentState>> {
  const { execa } = await import('execa');
  const { stdout } = await execa('launchctl', ['list']);
  const result = new Map<string, LoadedAgentState>();
  const prefix = plistLabel('');
  for (const line of stdout.split('\n')) {
    const cols = line.split('\t');
    const serviceLabel = cols[2];
    if (!serviceLabel || !serviceLabel.startsWith(prefix)) continue;
    const agentLabel = serviceLabel.slice(prefix.length);
    if (!agentLabel) continue;
    const parsed = parseInt(cols[0] ?? '', 10);
    const pid = Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
    result.set(agentLabel, { loaded: true, pid });
  }
  return result;
}

async function listLoadedAgentsLinux(): Promise<Map<string, LoadedAgentState>> {
  const { execa } = await import('execa');
  const result = new Map<string, LoadedAgentState>();
  // `show --all <glob>` emits Id=/ActiveState=/MainPID= records separated by
  // blank lines. Stable since systemd v230 (2016) — unlike
  // `list-units --output=json`, which is recent and not universally available.
  const prefix = systemdUnitName('');
  const { stdout } = await execa('systemctl', [
    '--user',
    'show',
    '--all',
    '--no-pager',
    '--property=Id',
    '--property=ActiveState',
    '--property=MainPID',
    `${prefix}*.service`,
  ]);
  const suffix = '.service';
  for (const block of stdout.split(/\n\s*\n/)) {
    let id = '';
    let activeState = '';
    let mainPid = '';
    for (const rawLine of block.split('\n')) {
      const line = rawLine.trim();
      if (line.startsWith('Id=')) id = line.slice(3);
      else if (line.startsWith('ActiveState=')) activeState = line.slice(12);
      else if (line.startsWith('MainPID=')) mainPid = line.slice(8);
    }
    if (!id.startsWith(prefix) || !id.endsWith(suffix)) continue;
    if (activeState !== 'active') continue;
    const agentLabel = id.slice(prefix.length, id.length - suffix.length);
    if (!agentLabel) continue;
    const parsed = parseInt(mainPid, 10);
    const pid = Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
    result.set(agentLabel, { loaded: true, pid });
  }
  return result;
}

let cached: { at: number; map: Map<string, LoadedAgentState> } | null = null;
const CACHE_TTL_MS = 5_000;

/**
 * Memoized variant of {@link listLoadedAgents} with a 5-second TTL.
 *
 * The desktop polls `/agents` every 5 seconds, so a short cache eliminates
 * roughly half of the subprocess spawns without making the UI feel stale.
 * The cache stores a single snapshot (size-bounded) per process.
 */
export async function listLoadedAgentsCached(): Promise<Map<string, LoadedAgentState>> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.map;
  }
  const map = await listLoadedAgents();
  cached = { at: now, map };
  return map;
}

/** Test/diagnostic hook — drop the cached snapshot. */
export function clearLoadedAgentsCache(): void {
  cached = null;
}
