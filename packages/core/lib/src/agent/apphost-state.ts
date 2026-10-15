/**
 * The agent's record of the agent halves the app host helper installed for
 * it (slice 3):
 *
 *     ~/.lamalibre/lamaste/agents/<label>/apphost-state.json   (0600)
 *     { "apps": { "<route>": { "version": "1.0.0", "updatedAt": "<ISO 8601>" } } }
 *
 * The sync's app jobs write it (`app-install` and `app-activate` record a
 * route, `app-remove` drops it); the config sync reads it: a plugin config
 * fetched for a route recorded here is handed to the agent half's service
 * (`lamaste-apphost config`) before it is acknowledged, so the relay never
 * signs with a secret the service does not hold. The helper's own status is
 * the truth about what is installed — a route it no longer has is dropped
 * when a delivery finds that out.
 *
 * Several agents (of different relays) may share a machine. A route belongs
 * to the agent that installed it (the helper's root-owned owner record); an
 * agent never acts on a route another agent's record lists.
 *
 * Writers outside converge take the agent lock ({@link withAgentLock});
 * converge already holds it.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { APPHOST_ROUTE_RE, AgentHalfVersionSchema } from '../agent-half.js';
import { atomicWriteJSON, readJSONFile } from '../file-helpers.js';
import { agentDataDir, agentsDir } from './platform.js';
import { AGENT_LABEL_RE } from './registry.js';

export interface AppHostAppRecord {
  /** The version the helper's `current` pointed at after the last app job. */
  readonly version: string;
  readonly updatedAt: string;
}

export interface AppHostState {
  readonly apps: Readonly<Record<string, AppHostAppRecord>>;
}

export function appHostStatePath(label: string): string {
  return path.join(agentDataDir(label), 'apphost-state.json');
}

/**
 * Read the record; `{ apps: {} }` when there is none. Throws when the file
 * cannot be read or parsed — a caller must not mistake an unreadable record
 * for "nothing installed".
 */
export async function readAppHostState(label: string): Promise<AppHostState> {
  const raw = await readJSONFile<unknown>(appHostStatePath(label), { apps: {} });
  const apps: Record<string, AppHostAppRecord> = {};
  const listed =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)['apps']
      : undefined;
  if (listed === null || typeof listed !== 'object' || Array.isArray(listed)) {
    throw new Error(`${appHostStatePath(label)} is not an app host record`);
  }
  for (const [route, entry] of Object.entries(listed as Record<string, unknown>)) {
    if (!APPHOST_ROUTE_RE.test(route) || entry === null || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (!AgentHalfVersionSchema.safeParse(e['version']).success) continue;
    apps[route] = {
      version: e['version'] as string,
      updatedAt: typeof e['updatedAt'] === 'string' ? e['updatedAt'] : '',
    };
  }
  return { apps };
}

/** The routes whose agent half the helper installed for this agent. */
export async function appHostRoutes(label: string): Promise<string[]> {
  return Object.keys((await readAppHostState(label)).apps).sort();
}

/** Read the record, or start a new one when the file cannot be read. */
async function readForUpdate(label: string): Promise<Record<string, AppHostAppRecord>> {
  try {
    return { ...(await readAppHostState(label)).apps };
  } catch {
    return {};
  }
}

/** Replace the record, owner-only (0600). */
async function writeAppHostState(
  label: string,
  apps: Record<string, AppHostAppRecord>,
): Promise<void> {
  await atomicWriteJSON(appHostStatePath(label), { apps }, { mode: 0o600, mkdirp: true });
}

/** Record that `route`'s agent half is installed at `version`. */
export async function recordAppHostApp(
  label: string,
  route: string,
  version: string,
): Promise<void> {
  if (!APPHOST_ROUTE_RE.test(route)) throw new Error(`Invalid plugin route "${route}"`);
  if (!AgentHalfVersionSchema.safeParse(version).success) {
    throw new Error(`Invalid agent half version "${version}"`);
  }
  const apps = await readForUpdate(label);
  apps[route] = { version, updatedAt: new Date().toISOString() };
  await writeAppHostState(label, apps);
}

/** Drop `route` from the record. Returns whether it was there. */
export async function forgetAppHostApp(label: string, route: string): Promise<boolean> {
  const apps = await readForUpdate(label);
  if (!(route in apps)) return false;
  delete apps[route];
  await writeAppHostState(label, apps);
  return true;
}

/**
 * The other agents on this machine whose record lists `route` — when there
 * are any, the route is theirs and this agent leaves it alone. A record
 * that cannot be read is passed over here: the helper's owner record still
 * refuses an agent that does not own the route.
 */
export async function appHostRouteRecordedElsewhere(
  label: string,
  route: string,
): Promise<string[]> {
  let labels: string[];
  try {
    labels = await readdir(agentsDir());
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const others: string[] = [];
  for (const other of labels.sort()) {
    if (other === label || !AGENT_LABEL_RE.test(other)) continue;
    try {
      if (route in (await readAppHostState(other)).apps) others.push(other);
    } catch {
      // Unreadable: not evidence either way.
    }
  }
  return others;
}

/**
 * Rewrite the record from what the helper reports: the agent halves whose
 * owner record names `label`, at the version `current` points at. How an
 * unreadable record is repaired — from root-owned facts, not guesses.
 */
export async function rebuildAppHostState(
  label: string,
  apps: Readonly<Record<string, { current: string | null; owner: { label: string } | null }>>,
): Promise<string[]> {
  const rebuilt: Record<string, AppHostAppRecord> = {};
  const updatedAt = new Date().toISOString();
  for (const [route, app] of Object.entries(apps)) {
    if (app.owner?.label !== label || app.current === null || !APPHOST_ROUTE_RE.test(route)) {
      continue;
    }
    rebuilt[route] = { version: app.current, updatedAt };
  }
  await writeAppHostState(label, rebuilt);
  return Object.keys(rebuilt).sort();
}
