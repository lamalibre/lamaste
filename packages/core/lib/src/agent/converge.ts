/**
 * Converge an agent's chisel client with the relay — the one path every
 * refresher takes: `lamaste-agent setup`, `update`, `sync` (the 30-second
 * timer), `panel`, and the agent daemon.
 *
 * Input is the relay's `GET /api/tunnels/agent-config` response for this
 * agent. Converging means:
 *
 * 1. The relay is the one the agent enrolled with — the chisel server URL
 *    must be `https://tunnel.<enrolled domain>:443`.
 * 2. The chisel credential is current and private: a credential from a
 *    version that exposed it (process arguments, 0644 unit) is rotated once;
 *    one the relay has since replaced is fetched again.
 * 3. The chisel binary is the pinned release.
 * 4. The service definition matches the tunnels the relay grants this agent.
 * 5. The service runs when there is something to carry — and is stopped when
 *    the agent carries no tunnel (chisel refuses to start without a remote
 *    and would crash-loop) or when the operator stopped it.
 *
 * Nothing is rewritten or restarted when everything already matches, so
 * running this every 30 seconds costs one panel request.
 */

import { saveAgentConfig, requireAgentConfig } from './config.js';
import type { AgentConfig } from './config.js';
import { loadChiselCredential, saveChiselCredential } from './chisel-credential.js';
import {
  assertRelayServerUrl,
  parseChiselArgs,
  secureAgentDataDir,
  writeChiselService,
} from './chisel-service.js';
import { ensureAgentChiselBinary } from './chisel-binary.js';
import { isAgentEnabled, isAgentLoaded, loadAgent, unloadAgent } from './service.js';
import { withAgentLock } from './agent-lock.js';

/** The fields of the relay's agent-config response that converge reads. */
export interface AgentConfigResponse {
  readonly domain?: unknown;
  readonly chiselArgs?: unknown;
  readonly chiselCredentialIssuedAt?: unknown;
  readonly tunnels?: unknown;
}

export interface IssuedChiselCredential {
  readonly user: string;
  readonly password: string;
  readonly createdAt: string | null;
}

/** Panel calls converge may need, bound to the agent's mTLS identity. */
export interface ConvergePanelCalls {
  fetchChiselCredential(): Promise<IssuedChiselCredential>;
  rotateChiselCredential(): Promise<IssuedChiselCredential>;
}

export interface ConvergeOptions {
  /** Restart a running service even when nothing changed (`lamaste-agent update`). */
  readonly forceRestart?: boolean | undefined;
}

export type ConvergeState = 'running' | 'idle' | 'stopped';

export interface ConvergeResult {
  /** running: carries tunnels. idle: carries none, service stopped. stopped: the operator stopped it. */
  readonly state: ConvergeState;
  /** Number of tunnels the relay grants this agent. */
  readonly tunnels: number;
  /** The service was (re)started or stopped by this call. */
  readonly serviceChanged: boolean;
  readonly credential: 'kept' | 'fetched' | 'rotated';
  readonly binaryUpdated: boolean;
  /** Non-fatal problems worth reporting (the run still converged). */
  readonly warnings: readonly string[];
}

const HOSTNAME_RE =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * The domain this agent enrolled with. Agents set up before the domain was
 * recorded adopt the one their (pinned) panel reports, once.
 */
async function enrolledDomain(
  label: string,
  config: AgentConfig,
  response: AgentConfigResponse,
): Promise<string> {
  const reported = typeof response.domain === 'string' ? response.domain : null;
  if (config.domain) {
    if (reported !== null && reported !== config.domain) {
      throw new Error(
        `The panel reports domain ${reported}, but this agent is enrolled with ${config.domain}. ` +
          'Re-enroll the agent to move it to another relay.',
      );
    }
    return config.domain;
  }
  if (reported === null || !HOSTNAME_RE.test(reported)) {
    throw new Error('The panel did not report a valid domain');
  }
  const fresh = await requireAgentConfig(label);
  await saveAgentConfig(label, { ...fresh, domain: reported });
  return reported;
}

async function ensureCredential(
  label: string,
  config: AgentConfig,
  response: AgentConfigResponse,
  panel: ConvergePanelCalls,
  warnings: string[],
): Promise<{ credential: IssuedChiselCredential; source: ConvergeResult['credential'] }> {
  // A credential from a version that put it in process arguments and a
  // 0644 unit file may have been read by any local user: replace it once.
  // If the relay cannot rotate it right now (rate limit, or a relay not yet
  // upgraded), keep using the current one and try again on the next run.
  if (!config.chiselCredentialSealedAt) {
    try {
      const rotated = await panel.rotateChiselCredential();
      await saveChiselCredential(label, { ...rotated, issuedAt: rotated.createdAt });
      const fresh = await requireAgentConfig(label);
      await saveAgentConfig(label, {
        ...fresh,
        chiselCredentialSealedAt: new Date().toISOString(),
      });
      return { credential: rotated, source: 'rotated' };
    } catch (err: unknown) {
      warnings.push(
        'The chisel credential from before this version could not be rotated yet ' +
          `(${err instanceof Error ? err.message : String(err)}); retrying on the next sync.`,
      );
    }
  }

  const stored = await loadChiselCredential(label);
  const current =
    typeof response.chiselCredentialIssuedAt === 'string'
      ? response.chiselCredentialIssuedAt
      : null;
  if (stored && (current === null || stored.issuedAt === current)) {
    return {
      credential: {
        user: stored.user,
        password: stored.password,
        createdAt: stored.issuedAt ?? null,
      },
      source: 'kept',
    };
  }
  const fetched = await panel.fetchChiselCredential();
  await saveChiselCredential(label, { ...fetched, issuedAt: fetched.createdAt });
  return { credential: fetched, source: 'fetched' };
}

/**
 * Converge the agent's chisel client with the relay's agent-config
 * `response`. See the module comment for what that entails. Runs under the
 * agent's cross-process lock ({@link withAgentLock}).
 */
export async function convergeChiselService(
  label: string,
  response: AgentConfigResponse,
  panel: ConvergePanelCalls,
  options: ConvergeOptions = {},
): Promise<ConvergeResult> {
  await secureAgentDataDir(label);
  return withAgentLock(label, () => convergeLocked(label, response, panel, options));
}

/** Stop the tunnel client if it is set to run. Returns whether it was. */
async function stopService(label: string): Promise<boolean> {
  const present = (await isAgentLoaded(label)) || (await isAgentEnabled(label));
  // Unconditional: `disable --now` / `launchctl unload` are idempotent, and a
  // systemd unit between crash restarts reports neither active nor loaded.
  await unloadAgent(label);
  return present;
}

async function convergeLocked(
  label: string,
  response: AgentConfigResponse,
  panel: ConvergePanelCalls,
  options: ConvergeOptions,
): Promise<ConvergeResult> {
  const config = await requireAgentConfig(label);

  const domain = await enrolledDomain(label, config, response);
  const spec = assertRelayServerUrl(parseChiselArgs(response.chiselArgs), domain);

  // Operator stopped the tunnels, or there is nothing to carry: chisel must
  // not run (it exits at once without a remote, and would crash-loop).
  // Decided before anything that needs the network, so a stop never waits on
  // the relay's credential endpoint or a chisel download.
  const stopState: ConvergeState | null = config.tunnelsStopped
    ? 'stopped'
    : spec.remotes.length === 0
      ? 'idle'
      : null;
  if (stopState) {
    const serviceChanged = await stopService(label);
    return {
      state: stopState,
      tunnels: spec.remotes.length,
      serviceChanged,
      credential: 'kept',
      binaryUpdated: false,
      warnings: [],
    };
  }

  const warnings: string[] = [];
  const { credential, source } = await ensureCredential(label, config, response, panel, warnings);
  const binary = await ensureAgentChiselBinary();

  const { changed } = await writeChiselService(label, spec, credential);
  const running = await isAgentLoaded(label);
  const present = running || (await isAgentEnabled(label));
  const restart = changed || binary.installed || source !== 'kept' || options.forceRestart === true;
  if (present && restart) {
    await unloadAgent(label);
  }
  if (!running || restart) {
    await loadAgent(label);
  }
  return {
    state: 'running',
    tunnels: spec.remotes.length,
    serviceChanged: !running || restart,
    credential: source,
    binaryUpdated: binary.installed,
    warnings,
  };
}

/**
 * Record that the operator stopped (or resumed) this agent's tunnels, and
 * stop the client when stopping — atomically with respect to any converge,
 * so a sync that is already running cannot start the client again. Resuming
 * only clears the flag; converge starts the client.
 */
export function setAgentTunnelsStopped(label: string, stopped: boolean): Promise<void> {
  return withAgentLock(label, async () => {
    const config = await requireAgentConfig(label);
    if (stopped) config.tunnelsStopped = true;
    else delete config.tunnelsStopped;
    await saveAgentConfig(label, config);
    if (stopped) await stopService(label);
  });
}

/**
 * Read-modify-write the agent's `config.json` under the agent lock, so it
 * cannot lose a concurrent change (an operator stop, a sealed credential).
 */
export function updateAgentConfig(
  label: string,
  mutate: (config: AgentConfig) => AgentConfig | void,
): Promise<AgentConfig> {
  return withAgentLock(label, async () => {
    const config = await requireAgentConfig(label);
    const next = mutate(config) ?? config;
    await saveAgentConfig(label, next);
    return next;
  });
}
