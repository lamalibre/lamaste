/**
 * Server-side tunnel workflows — create, delete, toggle, assign, reconfigure.
 *
 * All functions accept their dependencies (nginx helpers, chisel helpers,
 * state persistence, config) as parameters. No Fastify dependency.
 *
 * Concurrency: every workflow that changes the tunnel state runs under one
 * process-wide lock ({@link withTunnelLock}) and validates against the state
 * it reads *inside* the lock. Two concurrent creates therefore cannot both
 * pass the "port is free" check, and a read-modify-write never loses a
 * concurrent change. The lock is not re-entrant: workflows must not call one
 * another; {@link updateTunnel} composes the PATCH steps under one hold.
 */

import crypto from 'node:crypto';
import {
  AGENT_LABEL_REGEX,
  RESERVED_TUNNEL_PORTS,
  derivePluginRoute as coreDerivePluginRoute,
} from '../constants.js';
import { PromiseChainMutex } from '../file-helpers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TunnelType = 'app' | 'panel' | 'plugin';
export type AccessMode = 'public' | 'authenticated' | 'restricted';

export interface TunnelEntry {
  id: string;
  subdomain: string;
  fqdn: string;
  port: number;
  description: string | null;
  type: TunnelType;
  accessMode?: AccessMode | undefined;
  enabled: boolean;
  createdAt: string;
  pluginName?: string | undefined;
  /**
   * The agent that carries this tunnel. Only that agent receives the tunnel
   * in its chisel config, and only that agent's chisel credential may bind
   * its port on the server. Required for every tunnel created by this
   * version; `undefined` only on tunnels persisted by an older version that
   * could not be bound unambiguously at upgrade (see `bindUnownedTunnels`)
   * — such a tunnel is carried by no agent until an administrator assigns it.
   */
  agentLabel?: string | undefined;
  pluginRoute?: string | undefined;
  /**
   * Largest request body nginx accepts for this tunnel, in MiB. Written into
   * the vhost as `client_max_body_size`. `undefined` only on tunnels created
   * before the setting existed, whose vhost carries no directive and therefore
   * nginx's built-in 1 MiB limit until the tunnel is reconfigured.
   */
  maxBodySizeMb?: number | undefined;
}

export interface TunnelLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

/** Certificate issuance result from certbot. */
export interface CertResult {
  readonly skipped: boolean;
  readonly reason?: string | undefined;
  readonly certPath: string;
}

// ---------------------------------------------------------------------------
// Dependency interfaces (injected by daemon layer)
// ---------------------------------------------------------------------------

/** Per-tunnel vhost settings passed to the nginx writers. */
export interface VhostOptions {
  /** Rewrite `/` to `/<pathPrefix>/` (plugin tunnels). */
  pathPrefix?: string;
  /** `client_max_body_size` in MiB. */
  maxBodySizeMb?: number;
  /**
   * Whether the site is linked into `sites-enabled` after the write
   * (default true). A disabled tunnel's vhost is rewritten without ever
   * being enabled, and a failed write restores the previous link state.
   */
  enabled?: boolean;
}

/** Writes an nginx vhost config based on tunnel type and access mode. */
export interface NginxDeps {
  writePublicVhost(
    subdomain: string,
    domain: string,
    port: number,
    certPath: string | undefined,
    opts?: VhostOptions,
  ): Promise<void>;
  writeAuthenticatedVhost(
    subdomain: string,
    domain: string,
    port: number,
    certPath: string | undefined,
    opts?: VhostOptions,
  ): Promise<void>;
  writeRestrictedVhost(
    subdomain: string,
    domain: string,
    port: number,
    certPath: string | undefined,
    opts?: VhostOptions,
  ): Promise<void>;
  writeAgentPanelVhost(
    subdomain: string,
    domain: string,
    port: number,
    certPath: string | undefined,
    opts?: Pick<VhostOptions, 'enabled'>,
  ): Promise<void>;
  removeAppVhost(subdomain: string): Promise<void>;
  removeAgentPanelVhost(subdomain: string): Promise<void>;
  enableAppVhost(subdomain: string): Promise<void>;
  disableAppVhost(subdomain: string): Promise<void>;
  enableAgentPanelVhost(subdomain: string): Promise<void>;
  disableAgentPanelVhost(subdomain: string): Promise<void>;
}

/** Issues TLS certificates for tunnel FQDNs. */
export interface CertbotDeps {
  issueTunnelCert(fqdn: string, email: string): Promise<CertResult>;
}

/**
 * Brings the chisel server in line with the persisted tunnel state.
 *
 * Implementations re-render the chisel authfile from the tunnel state and the
 * credential store — each agent may reverse-bind exactly the ports of the
 * enabled tunnels it owns. Chisel reloads the file by itself; when the new
 * file withdraws a grant, the implementation also restarts chisel so live
 * sessions drop the binding. Workflows call it only after the state file has
 * been written, so the authfile is always a function of persisted state.
 */
export interface ChiselDeps {
  syncChisel(): Promise<void>;
}

/** Resolves agent labels against the agent registry. */
export interface TunnelAgentDeps {
  /** True when `label` names an enrolled, non-revoked agent. */
  isActiveAgent(label: string): Promise<boolean>;
}

/** Reads and writes tunnel state. */
export interface TunnelStateDeps {
  readTunnels(): Promise<TunnelEntry[]>;
  writeTunnels(tunnels: TunnelEntry[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Subdomains reserved for core infrastructure. */
export const RESERVED_SUBDOMAINS = [
  'panel',
  'auth',
  'tunnel',
  'www',
  'mail',
  'ftp',
  'api',
] as const;

/**
 * Request body limit bounds for tunnels, in MiB. The default suits ordinary
 * web apps and form uploads; applications that take large uploads (a Git
 * forge's attachments, a file drop) raise it explicitly. There is no
 * "unlimited": an upper bound is part of what the relay promises.
 * `agentMax` is the ceiling an agent may choose for its own tunnels; only an
 * administrator can go beyond it, up to `max`.
 */
export const TUNNEL_MAX_BODY_MB = { default: 10, min: 1, max: 10240, agentMax: 100 } as const;

/** Reserved nginx path prefixes that plugin routes cannot use. */
const RESERVED_PLUGIN_ROUTES = ['api', 'plugin-bundles', 'internal', 'install'] as const;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TunnelError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'RESERVED_SUBDOMAIN'
      | 'RESERVED_AGENT_PREFIX'
      | 'SUBDOMAIN_IN_USE'
      | 'PORT_IN_USE'
      | 'DOMAIN_NOT_CONFIGURED'
      | 'CERT_FAILED'
      | 'NGINX_FAILED'
      | 'CHISEL_FAILED'
      | 'STATE_FAILED'
      | 'NOT_FOUND'
      | 'RESERVED_PLUGIN_ROUTE'
      | 'INVALID_AGENT_LABEL'
      | 'UNKNOWN_AGENT'
      | 'INVALID_SETTING'
      | 'RESERVED_PORT'
      | 'FORBIDDEN',
  ) {
    super(message);
    this.name = 'TunnelError';
  }
}

// ---------------------------------------------------------------------------
// Derive plugin route from package name
// ---------------------------------------------------------------------------

/**
 * Re-export of the canonical {@link coreDerivePluginRoute} from core constants.
 * The canonical implementation lives in the root module so the schema layer
 * (manifest validation) and the server tunnel workflow share one definition;
 * this re-export preserves the historical `@lamalibre/lamaste/server` import
 * path used by tunnel-routing call sites.
 */
export const derivePluginRoute = coreDerivePluginRoute;

// ---------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------

const tunnelMutex = new PromiseChainMutex();

/**
 * Run `fn` while holding the tunnel-state lock. Every workflow in this module
 * takes it; other code that rewrites the tunnel state (startup
 * reconciliation) must take it too.
 */
export function withTunnelLock<T>(fn: () => Promise<T>): Promise<T> {
  return tunnelMutex.run(fn);
}

/**
 * Optional authorization hook for workflows acting on an existing tunnel,
 * evaluated under the lock against the current entry. Throw (typically a
 * `TunnelError` with code `NOT_FOUND` or `FORBIDDEN`) to refuse.
 */
export type AuthorizeTunnel = (tunnel: TunnelEntry) => void;

function assertTunnelPort(port: number): void {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new TunnelError('Port must be an integer from 1024 to 65535', 'INVALID_SETTING');
  }
  if (RESERVED_TUNNEL_PORTS.includes(port)) {
    throw new TunnelError(
      `Port ${port} belongs to a Lamaste service on the relay and cannot carry a tunnel`,
      'RESERVED_PORT',
    );
  }
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

async function assertAssignableAgent(label: string, agents: TunnelAgentDeps): Promise<void> {
  if (typeof label !== 'string' || !AGENT_LABEL_REGEX.test(label)) {
    throw new TunnelError(`Invalid agent label '${String(label)}'`, 'INVALID_AGENT_LABEL');
  }
  if (!(await agents.isActiveAgent(label))) {
    throw new TunnelError(`Agent '${label}' is not enrolled or has been revoked`, 'UNKNOWN_AGENT');
  }
}

function assertMaxBodySize(mb: number): void {
  if (!Number.isInteger(mb) || mb < TUNNEL_MAX_BODY_MB.min || mb > TUNNEL_MAX_BODY_MB.max) {
    throw new TunnelError(
      `maxBodySizeMb must be an integer from ${TUNNEL_MAX_BODY_MB.min} to ${TUNNEL_MAX_BODY_MB.max}`,
      'INVALID_SETTING',
    );
  }
}

function writeModeVhost(
  nginx: NginxDeps,
  accessMode: AccessMode,
  subdomain: string,
  domain: string,
  port: number,
  certPath: string | undefined,
  opts: VhostOptions,
): Promise<void> {
  if (accessMode === 'public') {
    return nginx.writePublicVhost(subdomain, domain, port, certPath, opts);
  }
  if (accessMode === 'authenticated') {
    return nginx.writeAuthenticatedVhost(subdomain, domain, port, certPath, opts);
  }
  return nginx.writeRestrictedVhost(subdomain, domain, port, certPath, opts);
}

/**
 * The enabled tunnels an agent carries. This is the only set an agent is ever
 * told about, and the only set its chisel credential may bind.
 */
export function tunnelsCarriedBy<T extends Pick<TunnelEntry, 'agentLabel' | 'enabled'>>(
  tunnels: readonly T[],
  label: string,
): T[] {
  return tunnels.filter((t) => t.enabled !== false && t.agentLabel === label);
}

export interface BindUnownedResult {
  readonly tunnels: TunnelEntry[];
  /** Subdomains that received an owner, with the owner they received. */
  readonly bound: ReadonlyArray<{ readonly subdomain: string; readonly agentLabel: string }>;
  /** Subdomains still without an owner — carried by no agent. */
  readonly unowned: readonly string[];
}

/**
 * Upgrade path for tunnel state written before tunnels had owners.
 *
 * An agent panel tunnel names its agent in its hostname (`agent-<label>`), so
 * it is bound to that agent when that agent is active — and never to any
 * other. Older versions handed every other tunnel to every agent; when
 * exactly one agent is active that agent was necessarily the carrier, so
 * ownerless app and plugin tunnels are bound to it. With several active
 * agents the carrier cannot be known — guessing would silently route a
 * hostname to the wrong machine — so those tunnels stay unowned, dark, and
 * reported until an administrator assigns them. Pure: returns a new array
 * and never mutates the input.
 */
export function bindUnownedTunnels(
  tunnels: readonly TunnelEntry[],
  activeLabels: readonly string[],
): BindUnownedResult {
  const active = new Set(activeLabels);
  const sole = activeLabels.length === 1 ? activeLabels[0] : undefined;
  const bound: Array<{ subdomain: string; agentLabel: string }> = [];
  const unowned: string[] = [];
  const next = tunnels.map((t) => {
    if (t.agentLabel) return t;
    let owner: string | undefined;
    if (t.type === 'panel') {
      const named = t.subdomain.startsWith('agent-') ? t.subdomain.slice('agent-'.length) : '';
      owner = active.has(named) ? named : undefined;
    } else {
      owner = sole;
    }
    if (owner) {
      bound.push({ subdomain: t.subdomain, agentLabel: owner });
      return { ...t, agentLabel: owner };
    }
    unowned.push(t.subdomain);
    return t;
  });
  return { tunnels: next, bound, unowned };
}

// ---------------------------------------------------------------------------
// Create tunnel
// ---------------------------------------------------------------------------

export interface CreateTunnelOptions {
  subdomain: string;
  port: number;
  description?: string | undefined;
  type?: TunnelType | undefined;
  accessMode?: AccessMode | undefined;
  pluginName?: string | undefined;
  /** The agent that will carry the tunnel. Must be enrolled and not revoked. */
  agentLabel: string;
  /** Request body limit in MiB; defaults to `TUNNEL_MAX_BODY_MB.default`. */
  maxBodySizeMb?: number | undefined;
  domain: string;
  email: string;
  nginx: NginxDeps;
  certbot: CertbotDeps;
  chisel: ChiselDeps;
  state: TunnelStateDeps;
  agents: TunnelAgentDeps;
  logger: TunnelLogger;
}

/**
 * Create a tunnel with the 4-step workflow:
 * 1. Issue TLS certificate
 * 2. Write nginx vhost
 * 3. Save to state
 * 4. Sync chisel (authfile grants the owning agent the new port)
 *
 * Runs under the tunnel lock; the subdomain and port checks read the state
 * inside it. State is written before chisel is synced because the authfile
 * is rendered from persisted state. Rolls back on failure at each step.
 */
export function createTunnel(opts: CreateTunnelOptions): Promise<TunnelEntry> {
  return withTunnelLock(() => createTunnelLocked(opts));
}

async function createTunnelLocked(opts: CreateTunnelOptions): Promise<TunnelEntry> {
  const {
    subdomain,
    port,
    description,
    type = 'app',
    accessMode = 'restricted',
    pluginName,
    agentLabel,
    maxBodySizeMb = TUNNEL_MAX_BODY_MB.default,
    domain,
    email,
    nginx,
    certbot,
    chisel,
    state,
    agents,
    logger,
  } = opts;

  // --- Validation ---

  assertTunnelPort(port);
  assertMaxBodySize(maxBodySizeMb);
  await assertAssignableAgent(agentLabel, agents);

  if ((RESERVED_SUBDOMAINS as readonly string[]).includes(subdomain)) {
    throw new TunnelError(`Subdomain '${subdomain}' is reserved`, 'RESERVED_SUBDOMAIN');
  }

  if (subdomain.startsWith('agent-') && type !== 'panel') {
    throw new TunnelError(
      "Subdomain prefix 'agent-' is reserved for agent panel tunnels",
      'RESERVED_AGENT_PREFIX',
    );
  }

  let pluginRoute: string | undefined;
  if (type === 'plugin' && pluginName) {
    pluginRoute = derivePluginRoute(pluginName);
    if ((RESERVED_PLUGIN_ROUTES as readonly string[]).includes(pluginRoute)) {
      throw new TunnelError(
        `Plugin route prefix '${pluginRoute}' conflicts with reserved path`,
        'RESERVED_PLUGIN_ROUTE',
      );
    }
  }

  const existing = await state.readTunnels();

  if (existing.find((t) => t.subdomain === subdomain)) {
    throw new TunnelError(`Subdomain '${subdomain}' is already in use`, 'SUBDOMAIN_IN_USE');
  }

  if (existing.find((t) => t.port === port)) {
    throw new TunnelError(`Port ${port} is already in use by another tunnel`, 'PORT_IN_USE');
  }

  const fqdn = `${subdomain}.${domain}`;
  let certResult: CertResult;

  // --- Step 1: Issue TLS certificate ---

  try {
    logger.info({ fqdn }, 'Issuing TLS certificate');
    certResult = await certbot.issueTunnelCert(fqdn, email);
    logger.info({ fqdn, skipped: certResult.skipped }, 'Certificate ready');
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to issue TLS certificate');
    throw new TunnelError(
      `Certificate issuance failed: ${err instanceof Error ? err.message : String(err)}`,
      'CERT_FAILED',
    );
  }

  // --- Step 2: Write nginx vhost ---

  const removeVhost = type === 'panel' ? nginx.removeAgentPanelVhost : nginx.removeAppVhost;

  try {
    logger.info({ fqdn, port, type, accessMode }, 'Writing nginx vhost');
    const certPath = certResult.certPath || undefined;

    if (type === 'panel') {
      await nginx.writeAgentPanelVhost(subdomain, domain, port, certPath);
    } else {
      await writeModeVhost(nginx, accessMode, subdomain, domain, port, certPath, {
        ...(pluginRoute ? { pathPrefix: pluginRoute } : {}),
        maxBodySizeMb,
      });
    }
    logger.info({ fqdn }, 'Nginx vhost configured');
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to write nginx vhost');
    throw new TunnelError(
      `Nginx configuration failed: ${err instanceof Error ? err.message : String(err)}`,
      'NGINX_FAILED',
    );
  }

  // --- Step 3: Save to state ---

  const tunnel: TunnelEntry = {
    id: crypto.randomUUID(),
    subdomain,
    fqdn,
    port,
    description: description ?? null,
    type,
    accessMode: type === 'panel' ? undefined : accessMode,
    enabled: true,
    createdAt: new Date().toISOString(),
    agentLabel,
    maxBodySizeMb: type === 'panel' ? undefined : maxBodySizeMb,
  };

  // Plugin tunnels store additional metadata
  if (pluginRoute && pluginName) {
    tunnel.pluginName = pluginName;
    tunnel.pluginRoute = pluginRoute;
  }

  try {
    await state.writeTunnels([...existing, tunnel]);
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to save tunnel state');
    try {
      await removeVhost(subdomain);
    } catch (rollbackErr: unknown) {
      logger.error({ err: rollbackErr }, 'Rollback: failed to remove nginx vhost');
    }
    throw new TunnelError(
      `State persistence failed: ${err instanceof Error ? err.message : String(err)}`,
      'STATE_FAILED',
    );
  }

  // --- Step 4: Sync chisel ---

  try {
    logger.info({ port, agentLabel }, 'Syncing Chisel');
    await chisel.syncChisel();
    logger.info({}, 'Chisel synced');
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to sync Chisel');
    let stateRestored = false;
    try {
      await state.writeTunnels(existing);
      stateRestored = true;
    } catch (rollbackErr: unknown) {
      logger.error({ err: rollbackErr }, 'Rollback: failed to remove tunnel from state');
    }
    try {
      await removeVhost(subdomain);
    } catch (rollbackErr: unknown) {
      logger.error({ err: rollbackErr }, 'Rollback: failed to remove nginx vhost');
    }
    // The failed sync may have written the new grant before failing; render
    // the authfile again from the restored state so no grant outlives the
    // tunnel it was for.
    if (stateRestored) {
      try {
        await chisel.syncChisel();
      } catch (rollbackErr: unknown) {
        logger.error(
          { err: rollbackErr },
          'Rollback: failed to re-sync chisel; the authfile may still grant the removed port',
        );
      }
    }
    throw new TunnelError(
      `Chisel reconfiguration failed: ${err instanceof Error ? err.message : String(err)}`,
      'CHISEL_FAILED',
    );
  }

  return tunnel;
}

// ---------------------------------------------------------------------------
// Delete tunnel
// ---------------------------------------------------------------------------

export interface DeleteTunnelOptions {
  id: string;
  nginx: NginxDeps;
  chisel: ChiselDeps;
  state: TunnelStateDeps;
  logger: TunnelLogger;
  authorize?: AuthorizeTunnel | undefined;
}

/**
 * Delete a tunnel: remove nginx vhost, remove from state, sync chisel.
 */
export function deleteTunnel(opts: DeleteTunnelOptions): Promise<{ ok: true }> {
  return withTunnelLock(async () => {
    const { id, nginx, chisel, state, logger, authorize } = opts;

    const tunnels = await state.readTunnels();
    const tunnel = tunnels.find((t) => t.id === id);
    if (!tunnel) {
      throw new TunnelError('Tunnel not found', 'NOT_FOUND');
    }
    authorize?.(tunnel);

    logger.info({ subdomain: tunnel.subdomain }, 'Removing nginx vhost');
    if (tunnel.type === 'panel') {
      await nginx.removeAgentPanelVhost(tunnel.subdomain);
    } else {
      await nginx.removeAppVhost(tunnel.subdomain);
    }

    await state.writeTunnels(tunnels.filter((t) => t.id !== id));

    // Revokes the owner's grant on the port
    logger.info({}, 'Syncing Chisel');
    await syncOrThrow(chisel);

    return { ok: true as const };
  });
}

// ---------------------------------------------------------------------------
// Update tunnel (enable/disable, carrier, access mode, body limit)
// ---------------------------------------------------------------------------

export interface UpdateTunnelOptions {
  id: string;
  enabled?: boolean | undefined;
  agentLabel?: string | undefined;
  accessMode?: AccessMode | undefined;
  maxBodySizeMb?: number | undefined;
  domain: string;
  email: string;
  nginx: NginxDeps;
  certbot: CertbotDeps;
  chisel: ChiselDeps;
  state: TunnelStateDeps;
  agents: TunnelAgentDeps;
  logger: TunnelLogger;
  authorize?: AuthorizeTunnel | undefined;
}

/**
 * Apply any combination of carrier, access mode, body limit and enabled
 * state under one hold of the tunnel lock, in that order: ownership first,
 * so a failure later leaves the tunnel carried by the agent that was asked
 * for; enabled last, so a tunnel being disabled is never re-enabled by the
 * vhost rewrite before it.
 */
export function updateTunnel(
  opts: UpdateTunnelOptions,
): Promise<{ ok: true; tunnel: TunnelEntry }> {
  return withTunnelLock(async () => {
    const tunnels = await opts.state.readTunnels();
    const current = tunnels.find((t) => t.id === opts.id);
    if (!current) {
      throw new TunnelError('Tunnel not found', 'NOT_FOUND');
    }
    opts.authorize?.(current);

    let result: { ok: true; tunnel: TunnelEntry } = { ok: true as const, tunnel: current };
    if (opts.agentLabel !== undefined) {
      result = await assignTunnelLocked({ ...opts, agentLabel: opts.agentLabel });
    }
    if (opts.accessMode !== undefined || opts.maxBodySizeMb !== undefined) {
      result = await reconfigureTunnelLocked(opts);
    }
    if (opts.enabled !== undefined) {
      result = await toggleTunnelLocked({ ...opts, enabled: opts.enabled });
    }
    return result;
  });
}

// ---------------------------------------------------------------------------
// Toggle tunnel
// ---------------------------------------------------------------------------

export interface ToggleTunnelOptions {
  id: string;
  enabled: boolean;
  nginx: NginxDeps;
  chisel: ChiselDeps;
  state: TunnelStateDeps;
  logger: TunnelLogger;
}

/**
 * Toggle a tunnel's enabled/disabled state.
 */
export function toggleTunnel(
  opts: ToggleTunnelOptions,
): Promise<{ ok: true; tunnel: TunnelEntry }> {
  return withTunnelLock(() => toggleTunnelLocked(opts));
}

async function toggleTunnelLocked(
  opts: ToggleTunnelOptions,
): Promise<{ ok: true; tunnel: TunnelEntry }> {
  const { id, enabled, nginx, chisel, state, logger } = opts;

  const tunnels = await state.readTunnels();
  const tunnel = tunnels.find((t) => t.id === id);

  if (!tunnel) {
    throw new TunnelError('Tunnel not found', 'NOT_FOUND');
  }

  const wasEnabled = tunnel.enabled !== false;
  if (wasEnabled === enabled) {
    return { ok: true as const, tunnel };
  }
  tunnel.enabled = enabled;

  const isPanel = tunnel.type === 'panel';

  if (enabled) {
    logger.info({ subdomain: tunnel.subdomain }, 'Enabling tunnel');
    if (isPanel) {
      await nginx.enableAgentPanelVhost(tunnel.subdomain);
    } else {
      await nginx.enableAppVhost(tunnel.subdomain);
    }
  } else {
    logger.info({ subdomain: tunnel.subdomain }, 'Disabling tunnel');
    if (isPanel) {
      await nginx.disableAgentPanelVhost(tunnel.subdomain);
    } else {
      await nginx.disableAppVhost(tunnel.subdomain);
    }
  }

  // Save state, then sync chisel — a disabled tunnel's port is not granted
  await state.writeTunnels(tunnels);
  await syncOrThrow(chisel);

  return { ok: true as const, tunnel };
}

// ---------------------------------------------------------------------------
// Assign tunnel to an agent
// ---------------------------------------------------------------------------

export interface AssignTunnelOptions {
  id: string;
  agentLabel: string;
  chisel: ChiselDeps;
  state: TunnelStateDeps;
  agents: TunnelAgentDeps;
  logger: TunnelLogger;
}

/**
 * Move a tunnel to another agent, or give an unowned tunnel its first owner.
 *
 * The previous owner loses the port grant in the same chisel sync that gives
 * it to the new owner. Each agent picks the change up on its next
 * `lamaste-agent sync` (at most 30 seconds on an agent that runs the timer).
 */
export function assignTunnel(
  opts: AssignTunnelOptions,
): Promise<{ ok: true; tunnel: TunnelEntry }> {
  return withTunnelLock(() => assignTunnelLocked(opts));
}

async function assignTunnelLocked(
  opts: AssignTunnelOptions,
): Promise<{ ok: true; tunnel: TunnelEntry }> {
  const { id, agentLabel, chisel, state, agents, logger } = opts;

  await assertAssignableAgent(agentLabel, agents);

  const tunnels = await state.readTunnels();
  const tunnel = tunnels.find((t) => t.id === id);
  if (!tunnel) {
    throw new TunnelError('Tunnel not found', 'NOT_FOUND');
  }
  if (tunnel.type === 'panel') {
    // A panel tunnel exposes one agent's own management panel under
    // `agent-<label>`; carrying it from any other agent would be a lie.
    throw new TunnelError(
      'Agent panel tunnels belong to the agent they expose and cannot be reassigned',
      'INVALID_AGENT_LABEL',
    );
  }
  if (tunnel.agentLabel === agentLabel) {
    return { ok: true as const, tunnel };
  }

  const previous = tunnel.agentLabel;
  tunnel.agentLabel = agentLabel;
  await state.writeTunnels(tunnels);
  logger.info(
    { subdomain: tunnel.subdomain, from: previous ?? null, to: agentLabel },
    'Tunnel reassigned',
  );
  await syncOrThrow(chisel);

  return { ok: true as const, tunnel };
}

// ---------------------------------------------------------------------------
// Reconfigure tunnel (access mode, body limit)
// ---------------------------------------------------------------------------

export interface ReconfigureTunnelOptions {
  id: string;
  accessMode?: AccessMode | undefined;
  maxBodySizeMb?: number | undefined;
  domain: string;
  email: string;
  nginx: NginxDeps;
  certbot: CertbotDeps;
  state: TunnelStateDeps;
  logger: TunnelLogger;
}

/**
 * Change a tunnel's access mode and/or request body limit in place.
 *
 * Both live in the tunnel's nginx vhost, so the vhost is re-rendered from the
 * tunnel's full settings — keeping its enabled/disabled link state, and
 * restoring the previous file and link state if nginx rejects it — then the
 * state is saved. Gatekeeper watches the state file and picks up an
 * access-mode change on its own. Agent panel tunnels have a fixed mTLS vhost
 * and are not reconfigurable.
 */
export function reconfigureTunnel(
  opts: ReconfigureTunnelOptions,
): Promise<{ ok: true; tunnel: TunnelEntry }> {
  return withTunnelLock(() => reconfigureTunnelLocked(opts));
}

async function reconfigureTunnelLocked(
  opts: ReconfigureTunnelOptions,
): Promise<{ ok: true; tunnel: TunnelEntry }> {
  const { id, domain, email, nginx, certbot, state, logger } = opts;

  if (opts.maxBodySizeMb !== undefined) assertMaxBodySize(opts.maxBodySizeMb);

  const tunnels = await state.readTunnels();
  const tunnel = tunnels.find((t) => t.id === id);
  if (!tunnel) {
    throw new TunnelError('Tunnel not found', 'NOT_FOUND');
  }
  if (tunnel.type === 'panel') {
    throw new TunnelError(
      'Agent panel tunnels have a fixed configuration and cannot be reconfigured',
      'INVALID_SETTING',
    );
  }

  const before = {
    accessMode: tunnel.accessMode ?? 'restricted',
    maxBodySizeMb: tunnel.maxBodySizeMb,
  };
  const after = {
    accessMode: opts.accessMode ?? before.accessMode,
    maxBodySizeMb: opts.maxBodySizeMb ?? before.maxBodySizeMb,
  };
  if (after.accessMode === before.accessMode && after.maxBodySizeMb === before.maxBodySizeMb) {
    return { ok: true as const, tunnel };
  }

  let certPath: string | undefined;
  try {
    const cert = await certbot.issueTunnelCert(tunnel.fqdn, email);
    certPath = cert.certPath || undefined;
  } catch (err: unknown) {
    throw new TunnelError(
      `Certificate check failed: ${err instanceof Error ? err.message : String(err)}`,
      'CERT_FAILED',
    );
  }

  const enabled = tunnel.enabled !== false;
  const render = (settings: typeof after): Promise<void> =>
    writeModeVhost(nginx, settings.accessMode, tunnel.subdomain, domain, tunnel.port, certPath, {
      ...(tunnel.pluginRoute ? { pathPrefix: tunnel.pluginRoute } : {}),
      ...(settings.maxBodySizeMb !== undefined ? { maxBodySizeMb: settings.maxBodySizeMb } : {}),
      enabled,
    });

  try {
    await render(after);
  } catch (err: unknown) {
    throw new TunnelError(
      `Nginx configuration failed: ${err instanceof Error ? err.message : String(err)}`,
      'NGINX_FAILED',
    );
  }

  tunnel.accessMode = after.accessMode;
  tunnel.maxBodySizeMb = after.maxBodySizeMb;
  try {
    await state.writeTunnels(tunnels);
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to save tunnel state; restoring previous vhost');
    try {
      await render(before);
    } catch (rollbackErr: unknown) {
      logger.error({ err: rollbackErr }, 'Rollback: failed to restore previous vhost');
    }
    throw new TunnelError(
      `State persistence failed: ${err instanceof Error ? err.message : String(err)}`,
      'STATE_FAILED',
    );
  }

  logger.info({ subdomain: tunnel.subdomain, from: before, to: after }, 'Tunnel reconfigured');
  return { ok: true as const, tunnel };
}

// ---------------------------------------------------------------------------
// Release a revoked agent's tunnels
// ---------------------------------------------------------------------------

export interface ReleaseAgentTunnelsOptions {
  agentLabel: string;
  nginx: NginxDeps;
  chisel: ChiselDeps;
  state: TunnelStateDeps;
  logger: TunnelLogger;
}

export interface ReleaseAgentTunnelsResult {
  /** App and plugin tunnels that lost their owner (now unassigned, dark). */
  readonly released: readonly string[];
  /** The agent's own panel tunnel, removed with its vhost. */
  readonly removedPanels: readonly string[];
}

/**
 * Detach a revoked agent from every tunnel it carried. Its app and plugin
 * tunnels become unassigned (their hostnames stay reserved and dark until an
 * administrator assigns them), and its panel tunnel — which exposes that
 * agent's own management panel — is removed. Without this, a later
 * enrollment reusing the label would silently inherit the old tunnels.
 */
export function releaseAgentTunnels(
  opts: ReleaseAgentTunnelsOptions,
): Promise<ReleaseAgentTunnelsResult> {
  return withTunnelLock(async () => {
    const { agentLabel, nginx, chisel, state, logger } = opts;
    const tunnels = await state.readTunnels();
    const panelSubdomain = `agent-${agentLabel}`;

    const released: string[] = [];
    const removedPanels: string[] = [];
    const next: TunnelEntry[] = [];
    for (const t of tunnels) {
      if (t.type === 'panel' && (t.agentLabel === agentLabel || t.subdomain === panelSubdomain)) {
        removedPanels.push(t.subdomain);
        continue;
      }
      if (t.agentLabel === agentLabel) {
        released.push(t.subdomain);
        const { agentLabel: _dropped, ...rest } = t;
        next.push(rest);
        continue;
      }
      next.push(t);
    }
    if (released.length === 0 && removedPanels.length === 0) {
      return { released, removedPanels };
    }

    await state.writeTunnels(next);
    for (const subdomain of removedPanels) {
      try {
        await nginx.removeAgentPanelVhost(subdomain);
      } catch (err: unknown) {
        logger.error({ err, subdomain }, 'Failed to remove a revoked agent panel vhost');
      }
    }
    await syncOrThrow(chisel);
    logger.info({ agentLabel, released, removedPanels }, 'Released the tunnels of a revoked agent');
    return { released, removedPanels };
  });
}

async function syncOrThrow(chisel: ChiselDeps): Promise<void> {
  try {
    await chisel.syncChisel();
  } catch (err: unknown) {
    throw new TunnelError(
      `Chisel reconfiguration failed: ${err instanceof Error ? err.message : String(err)}`,
      'CHISEL_FAILED',
    );
  }
}
