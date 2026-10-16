/**
 * App plugins on the agent — the agent's side of hosting an agent-hosted
 * plugin's agent half.
 *
 * When an administrator hosts a plugin on this agent, the relay creates an
 * internal plugin tunnel (its chisel grant arrives with the agent's tunnels)
 * and an installation secret. The relay's agent-config response lists the
 * plugins this agent hosts (`appPlugins`), and `syncAppPluginConfigs` —
 * called by the same converge that keeps the chisel client current — fetches
 * each plugin's config (port and secret) when the relay reports a secret the
 * agent does not hold yet, writes it to
 *
 *     ~/.lamalibre/lamaste/agents/<label>/app-plugins/<route>.json   (0600)
 *
 * and acknowledges it, which lets the relay stop signing with the previous
 * secret. A plugin the relay no longer lists loses its file. When the app
 * host helper installed the plugin's agent half (slice 3), the service has a
 * copy of its own (`/etc/lamalibre/apps/<route>/plugin-config.json`): a
 * config is acknowledged only once both copies are written.
 *
 * The agent half reads that file for its port and verifies every request on
 * `/admin/*` with {@link createCallerAssertionVerifier}, which re-reads the
 * file when a signature does not verify, so a rotation needs no restart.
 * A verified request answers with the verifier's closures — the responder
 * signature every answer carries and, for a settings update, the opening
 * of its sealed secrets — so no route of the agent half holds the secret.
 */

import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { CALLER_ASSERTION_HEADER, NonceStore, verifyCallerAssertion } from '../caller-assertion.js';
import type { VerifyCallerAssertionResult } from '../caller-assertion.js';
import { atomicWriteJSON } from '../file-helpers.js';
import { appHostRouteRecordedElsewhere, appHostRoutes, forgetAppHostApp } from './apphost-state.js';
import { agentDataDir } from './platform.js';

const ROUTE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const SECRET_RE = /^[a-f0-9]{64}$/;

/** The config file of one hosted plugin, as written by the agent. */
export interface AgentAppPluginConfig {
  /** The plugin's route. */
  readonly plugin: string;
  /** The port the agent half listens on (127.0.0.1) — the internal tunnel's port. */
  readonly port: number;
  readonly secret: string;
  readonly issuedAt: string;
  /** The secret before the last rotation, accepted alongside `secret`. */
  readonly previousSecret?: string | undefined;
  readonly previousIssuedAt?: string | undefined;
  readonly fetchedAt: string;
  /** The relay confirmed it knows this agent holds `secret`. */
  readonly acknowledged: boolean;
}

export function appPluginsDir(label: string): string {
  return path.join(agentDataDir(label), 'app-plugins');
}

export function appPluginConfigPath(label: string, route: string): string {
  if (!ROUTE_RE.test(route)) throw new Error(`Invalid plugin route: ${route}`);
  return path.join(appPluginsDir(label), `${route}.json`);
}

function parseConfig(raw: string): AgentAppPluginConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const c = parsed as Record<string, unknown>;
  if (
    typeof c['plugin'] !== 'string' ||
    !ROUTE_RE.test(c['plugin']) ||
    typeof c['port'] !== 'number' ||
    typeof c['secret'] !== 'string' ||
    !SECRET_RE.test(c['secret']) ||
    typeof c['issuedAt'] !== 'string' ||
    typeof c['fetchedAt'] !== 'string'
  ) {
    return null;
  }
  const previousSecret =
    typeof c['previousSecret'] === 'string' && SECRET_RE.test(c['previousSecret'])
      ? c['previousSecret']
      : undefined;
  return {
    plugin: c['plugin'],
    port: c['port'],
    secret: c['secret'],
    issuedAt: c['issuedAt'],
    ...(previousSecret
      ? {
          previousSecret,
          previousIssuedAt:
            typeof c['previousIssuedAt'] === 'string' ? c['previousIssuedAt'] : undefined,
        }
      : {}),
    fetchedAt: c['fetchedAt'],
    acknowledged: c['acknowledged'] === true,
  };
}

/** Read a config file by path — what an agent half does at start. */
export async function readAppPluginConfigFile(
  filePath: string,
): Promise<AgentAppPluginConfig | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return parseConfig(raw);
}

export function loadAppPluginConfig(
  label: string,
  route: string,
): Promise<AgentAppPluginConfig | null> {
  return readAppPluginConfigFile(appPluginConfigPath(label, route));
}

export async function saveAppPluginConfig(
  label: string,
  config: AgentAppPluginConfig,
): Promise<void> {
  if (!SECRET_RE.test(config.secret)) throw new Error('saveAppPluginConfig: malformed secret');
  const filePath = appPluginConfigPath(label, config.plugin);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await atomicWriteJSON(filePath, config, { mode: 0o600 });
}

export async function removeAppPluginConfig(label: string, route: string): Promise<boolean> {
  const filePath = appPluginConfigPath(label, route);
  try {
    await rm(filePath);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/** The routes with a config file on this agent. */
export async function listAppPluginConfigs(label: string): Promise<string[]> {
  try {
    const entries = await readdir(appPluginsDir(label));
    return entries
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .filter((r) => ROUTE_RE.test(r))
      .sort();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Converge step
// ---------------------------------------------------------------------------

/** One entry of the relay's `appPlugins` (agent-config response). */
export interface AppPluginAssignment {
  readonly route: string;
  readonly port: number;
  readonly secretIssuedAt: string;
  readonly secretAcknowledged: boolean;
}

/** What `GET /api/agents/me/plugin-config/<route>` returns. */
export interface IssuedAppPluginConfig {
  readonly plugin: string;
  readonly port: number;
  readonly secret: string;
  readonly issuedAt: string;
  readonly previousSecret?: string | undefined;
  readonly previousIssuedAt?: string | undefined;
}

export interface AppPluginPanelCalls {
  fetchPluginConfig(route: string): Promise<IssuedAppPluginConfig>;
  acknowledgePluginConfig(route: string, issuedAt: string): Promise<void>;
  /**
   * Hand `config` to the service of an agent half the app host helper
   * installed (a route in `apphost-state.json`) — called before the config
   * is acknowledged. `not-installed`: the helper no longer has that agent
   * half, so the agent's own copy is the only one. Throws when the config
   * could not be delivered: it then stays unacknowledged, and the relay
   * keeps signing with the previous secret, which the service still holds.
   * A caller without it (the agent daemon) leaves such configs
   * unacknowledged for the sync timer, which delivers them.
   */
  deliverPluginConfig?(
    route: string,
    config: AgentAppPluginConfig,
  ): Promise<'delivered' | 'not-installed'>;
}

export interface AppPluginSyncResult {
  /** Routes whose config was fetched (first delivery or a rotation). */
  readonly fetched: readonly string[];
  /** Routes acknowledged to the relay in this run. */
  readonly acknowledged: readonly string[];
  /** Routes whose config file was removed because the relay no longer lists them. */
  readonly removed: readonly string[];
}

/** Validate the relay's `appPlugins` field; anything malformed is ignored with a warning. */
export function parseAppPluginAssignments(raw: unknown, warnings: string[]): AppPluginAssignment[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push('The panel reported appPlugins in an unexpected shape; ignoring it.');
    return [];
  }
  const out: AppPluginAssignment[] = [];
  for (const entry of raw) {
    const e = entry as Record<string, unknown>;
    if (
      !e ||
      typeof e !== 'object' ||
      typeof e['route'] !== 'string' ||
      !ROUTE_RE.test(e['route']) ||
      typeof e['port'] !== 'number' ||
      typeof e['secretIssuedAt'] !== 'string'
    ) {
      warnings.push('The panel reported a malformed appPlugins entry; ignoring it.');
      continue;
    }
    out.push({
      route: e['route'],
      port: e['port'],
      secretIssuedAt: e['secretIssuedAt'],
      secretAcknowledged: e['secretAcknowledged'] === true,
    });
  }
  return out;
}

/**
 * Bring the config files in line with what the relay reports. Fetches a
 * config whose secret the agent does not hold (or holds for another port),
 * acknowledges what the relay has not yet seen acknowledged — for an agent
 * half the app host helper installed, only after
 * {@link AppPluginPanelCalls.deliverPluginConfig} wrote the service's copy —
 * and removes files for plugins no longer hosted here. A failure on one
 * plugin is a warning; the others are still processed.
 */
export async function syncAppPluginConfigs(
  label: string,
  assignments: readonly AppPluginAssignment[],
  panel: AppPluginPanelCalls,
  warnings: string[],
): Promise<AppPluginSyncResult> {
  const fetched: string[] = [];
  const acknowledged: string[] = [];
  const removed: string[] = [];

  // The agent halves the app host helper installed for this agent. When the
  // record cannot be read this agent cannot show which services are its own:
  // no config is delivered (another agent's service must not get it) and
  // none is acknowledged (the relay keeps signing with secrets the services
  // still hold) until the record is repaired — fail closed.
  let apphostRoutes: ReadonlySet<string> | null = null;
  try {
    apphostRoutes = new Set(await appHostRoutes(label));
  } catch (err: unknown) {
    warnings.push(
      'The record of the agent halves installed for this agent (apphost-state.json) could not ' +
        `be read (${err instanceof Error ? err.message : String(err)}); no plugin config is ` +
        'delivered or acknowledged until it is repaired (the sync rebuilds it from the app ' +
        'host helper).',
    );
  }

  for (const assignment of assignments) {
    try {
      let stored = await loadAppPluginConfig(label, assignment.route);
      const current =
        stored !== null &&
        stored.issuedAt === assignment.secretIssuedAt &&
        stored.port === assignment.port;
      if (!current) {
        const issued = await panel.fetchPluginConfig(assignment.route);
        if (issued.plugin !== assignment.route || !SECRET_RE.test(issued.secret)) {
          throw new Error('the panel returned a malformed plugin config');
        }
        stored = {
          plugin: issued.plugin,
          port: issued.port,
          secret: issued.secret,
          issuedAt: issued.issuedAt,
          ...(issued.previousSecret
            ? { previousSecret: issued.previousSecret, previousIssuedAt: issued.previousIssuedAt }
            : {}),
          fetchedAt: new Date().toISOString(),
          acknowledged: false,
        };
        await saveAppPluginConfig(label, stored);
        fetched.push(assignment.route);
      }
      if (stored && (!stored.acknowledged || !assignment.secretAcknowledged)) {
        if (apphostRoutes === null) continue;
        if (apphostRoutes.has(assignment.route)) {
          const elsewhere = await appHostRouteRecordedElsewhere(label, assignment.route);
          if (elsewhere.length > 0) {
            warnings.push(
              `The agent half of "${assignment.route}" is also recorded by agent ` +
                `${elsewhere.join(', ')} on this machine; its plugin config is neither ` +
                'delivered nor acknowledged while two agents claim it.',
            );
            continue;
          }
          if (!panel.deliverPluginConfig) {
            warnings.push(
              `The plugin config of "${assignment.route}" is acknowledged once the sync timer ` +
                "has delivered it to the agent half's service.",
            );
            continue;
          }
          const delivery = await panel.deliverPluginConfig(assignment.route, stored);
          if (delivery === 'not-installed') await forgetAppHostApp(label, assignment.route);
        }
        await panel.acknowledgePluginConfig(assignment.route, stored.issuedAt);
        await saveAppPluginConfig(label, { ...stored, acknowledged: true });
        acknowledged.push(assignment.route);
      }
    } catch (err: unknown) {
      warnings.push(
        `Plugin config for "${assignment.route}" could not be synced ` +
          `(${err instanceof Error ? err.message : String(err)}); retrying on the next sync.`,
      );
    }
  }

  const listed = new Set(assignments.map((a) => a.route));
  for (const route of await listAppPluginConfigs(label)) {
    if (listed.has(route)) continue;
    try {
      if (await removeAppPluginConfig(label, route)) removed.push(route);
    } catch (err: unknown) {
      warnings.push(
        `Stale plugin config for "${route}" could not be removed ` +
          `(${err instanceof Error ? err.message : String(err)}).`,
      );
    }
  }

  return { fetched, acknowledged, removed };
}

// ---------------------------------------------------------------------------
// Verifying caller assertions in the agent half
// ---------------------------------------------------------------------------

export interface CallerAssertionVerifierOptions {
  /** The config file the agent wrote for this plugin (`LAMALIBRE_LAMASTE_APP_PLUGIN_CONFIG`). */
  readonly configPath: string;
  /** The plugin's route; assertions for another plugin are refused. */
  readonly plugin: string;
  /** How often at most the file is re-read on a failed verification. */
  readonly reloadIntervalMs?: number | undefined;
}

/** What {@link CallerAssertionVerifier.verify} also checks the assertion against. */
export interface CallerAssertionVerifyOptions {
  /**
   * The request body exactly as received (null: none). When given and the
   * assertion signs a body hash, the two must match (`wrong_body`).
   */
  readonly body?: Buffer | string | null | undefined;
  /**
   * Refuse an assertion that does not sign the body — for routes only
   * Lamaste calls with a body (hook calls, settings updates).
   */
  readonly requireBodyHash?: boolean | undefined;
}

export interface CallerAssertionVerifier {
  /**
   * Verify the `X-Lamalibre-Caller` header of a request for `method` and
   * `path` (the request's path with its query string) — and its body, as
   * `opts` asks. On a signature that does not verify the config file is
   * re-read once — a rotated secret arrives that way — and the check
   * repeated. A verified result carries `responder` (the header every
   * answer to it must carry) and `decryptSettingsSecret`, both closed over
   * the secret that verified it.
   */
  verify(
    headers: Record<string, string | string[] | undefined>,
    method: string,
    path: string,
    opts?: CallerAssertionVerifyOptions,
  ): Promise<VerifyCallerAssertionResult>;
  /** The port from the config file, once loaded. */
  port(): Promise<number>;
}

/**
 * The agent half's verifier. One per process; it owns the nonce store, so
 * a replayed assertion is refused wherever it lands.
 */
export function createCallerAssertionVerifier(
  opts: CallerAssertionVerifierOptions,
): CallerAssertionVerifier {
  const reloadIntervalMs = opts.reloadIntervalMs ?? 2_000;
  const nonces = new NonceStore();
  let config: AgentAppPluginConfig | null = null;
  let lastReload = 0;

  async function load(force: boolean): Promise<AgentAppPluginConfig> {
    const now = Date.now();
    if (config && (!force || now - lastReload < reloadIntervalMs)) return config;
    const next = await readAppPluginConfigFile(opts.configPath);
    lastReload = now;
    if (!next) {
      if (config) return config;
      throw new Error(`No plugin config at ${opts.configPath}`);
    }
    if (next.plugin !== opts.plugin) {
      throw new Error(
        `Plugin config at ${opts.configPath} is for "${next.plugin}", not "${opts.plugin}"`,
      );
    }
    config = next;
    return next;
  }

  function secretsOf(c: AgentAppPluginConfig): string[] {
    return c.previousSecret ? [c.secret, c.previousSecret] : [c.secret];
  }

  return {
    async verify(headers, method, path, verifyOpts = {}) {
      const raw = headers[CALLER_ASSERTION_HEADER];
      const header = Array.isArray(raw) ? raw[0] : raw;
      const check = (c: AgentAppPluginConfig): VerifyCallerAssertionResult =>
        verifyCallerAssertion(header, {
          secrets: secretsOf(c),
          plugin: opts.plugin,
          method,
          path,
          nonces,
          body: verifyOpts.body,
          requireBodyHash: verifyOpts.requireBodyHash,
        });
      let result = check(await load(false));
      if (!result.ok && result.reason === 'bad_signature') {
        result = check(await load(true));
      }
      return result;
    },
    async port() {
      return (await load(false)).port;
    },
  };
}
