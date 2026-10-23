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
 *
 * An app tunnel may be *bound* as the user surface of agent-hosted plugins
 * ({@link bindUserSurface}) — only a tunnel the plugin's hosting agent
 * carries: its host then serves `/api/<route>/app/*` for each bound route
 * whose plugin's installed, approved version declares `identity` and is
 * hosted by the agent that carries the tunnel — the panel's
 * {@link UserSurfaceDeps} decides which — through locations in its vhost
 * that ask Gatekeeper and pass the request to the panel. Every workflow that
 * renders the vhost carries them, and moving a bound tunnel to another
 * agent re-renders it.
 */

import crypto from 'node:crypto';
import {
  AGENT_LABEL_REGEX,
  AGENT_PANEL_SUBDOMAIN_PREFIX,
  INTERNAL_PLUGIN_PORT_RANGE,
  RESERVED_SUBDOMAINS,
  RESERVED_TUNNEL_PORTS,
  derivePluginRoute as coreDerivePluginRoute,
  isInternalPluginPort,
} from '../constants.js';
import { PromiseChainMutex } from '../file-helpers.js';
import {
  USER_SURFACE_MAX_ROUTES_PER_HOST,
  isUserSurfaceRoute,
  tunnelUserSurfaceRoutes,
} from '../user-surface.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TunnelType = 'app' | 'panel' | 'plugin';
export type AccessMode = 'public' | 'authenticated' | 'restricted';

/**
 * Where a tunnel is reachable from. `public` (the default, and every tunnel
 * before 4.3): an nginx vhost on `<subdomain>.<domain>` with a certificate.
 * `internal`: the relay's loopback only — the chisel grant and the port,
 * no vhost, no certificate, no DNS. Internal tunnels carry an agent-hosted
 * plugin's admin API to the panel's forwarder; they have no subdomain and no
 * access mode, and Lamaste assigns their port.
 */
export type TunnelExposure = 'public' | 'internal';

export interface TunnelEntry {
  id: string;
  /** `null` on an internal tunnel, which has no hostname. */
  subdomain: string | null;
  /** `null` on an internal tunnel. */
  fqdn: string | null;
  port: number;
  description: string | null;
  type: TunnelType;
  accessMode?: AccessMode | undefined;
  enabled: boolean;
  createdAt: string;
  /** Absent on tunnels written before 4.3 — those are public. */
  exposure?: TunnelExposure | undefined;
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
  /**
   * The agent-hosted plugins whose user surface (`/api/<route>/app/*`) this
   * tunnel's host serves — app tunnels only, `authenticated` or
   * `restricted`; a route on one host at most. Absent when it serves none.
   * Gatekeeper reads it too (`/authz/user-surface/<fqdn>`).
   */
  userSurface?: TunnelUserSurface | undefined;
}

/** A tunnel's binding as the user surface of agent-hosted plugins. */
export interface TunnelUserSurface {
  /** Plugin routes, each a valid user-surface route (`isUserSurfaceRoute`). */
  routes: string[];
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
  /**
   * The plugins' user surfaces the vhost serves: a location for
   * `/api/<route>/app` and everything under it per entry, authorized by
   * Gatekeeper and passed to the panel. Only for `authenticated` and
   * `restricted` vhosts — a public writer refuses any.
   */
  userSurface?: readonly UserSurfaceVhostRoute[];
}

/** One plugin's user surface as a tunnel's vhost serves it. */
export interface UserSurfaceVhostRoute {
  readonly route: string;
  /** `client_max_body_size` of its locations, in MiB: the plugin's internal tunnel's body limit. */
  readonly maxBodySizeMb: number;
}

/**
 * Which of a tunnel's bound user-surface routes its vhost serves, and which
 * agent hosts a plugin. The panel's: it knows the plugins and their
 * hostings.
 */
export interface UserSurfaceDeps {
  /**
   * Of `routes` (bound to `tunnel`), the ones served — an installed plugin
   * holds the route, its installed, approved version declares `identity`,
   * and its hosting agent is the agent carrying `tunnel` — each with its
   * body limit, in the order given. Called under the tunnel lock: it must
   * not take it.
   */
  servedRoutes(
    routes: readonly string[],
    tunnel: Pick<TunnelEntry, 'agentLabel'>,
  ): Promise<UserSurfaceVhostRoute[]>;
  /**
   * The agent hosting the plugin of `route` — the agent half and its
   * internal tunnel — or null when it is not hosted. Called under the
   * tunnel lock: it must not take it.
   */
  hostingAgent(route: string): Promise<string | null>;
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
      | 'FORBIDDEN'
      /** A route bound to another host, or a change a bound tunnel cannot take. */
      | 'USER_SURFACE_CONFLICT',
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
  if (isInternalPluginPort(port)) {
    throw new TunnelError(
      `Port ${port} is in the range ${INTERNAL_PLUGIN_PORT_RANGE.min}–${INTERNAL_PLUGIN_PORT_RANGE.max}, ` +
        'which Lamaste reserves for the internal tunnels of agent-hosted plugins',
      'RESERVED_PORT',
    );
  }
}

/** True for a tunnel reachable only on the relay's loopback. */
export function isInternalTunnel(tunnel: Pick<TunnelEntry, 'exposure'>): boolean {
  return tunnel.exposure === 'internal';
}

/** A name for a tunnel in logs and results: its subdomain, or its plugin for an internal one. */
export function tunnelLabel(tunnel: Pick<TunnelEntry, 'subdomain' | 'pluginRoute' | 'id'>): string {
  return tunnel.subdomain ?? `internal:${tunnel.pluginRoute ?? tunnel.id}`;
}

/**
 * The lowest port of {@link INTERNAL_PLUGIN_PORT_RANGE} no tunnel holds and
 * Lamaste does not reserve. Pure; the caller holds the tunnel lock.
 */
export function assignInternalPluginPort(
  tunnels: ReadonlyArray<Pick<TunnelEntry, 'port'>>,
): number {
  const taken = new Set(tunnels.map((t) => t.port));
  for (let port = INTERNAL_PLUGIN_PORT_RANGE.min; port <= INTERNAL_PLUGIN_PORT_RANGE.max; port++) {
    if (!taken.has(port) && !RESERVED_TUNNEL_PORTS.includes(port)) return port;
  }
  throw new TunnelError(
    `No free port left in the internal plugin range ${INTERNAL_PLUGIN_PORT_RANGE.min}–${INTERNAL_PLUGIN_PORT_RANGE.max}`,
    'PORT_IN_USE',
  );
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
 * The certificate directory a tunnel's vhost is rewritten with: what the
 * certificate check finds — a wildcard certificate, or the tunnel's own.
 */
async function tunnelCertPath(
  certbot: CertbotDeps,
  subdomain: string,
  tunnel: Pick<TunnelEntry, 'fqdn'>,
  domain: string,
  email: string,
): Promise<string | undefined> {
  const fqdn = tunnel.fqdn ?? `${subdomain}.${domain}`;
  try {
    const cert = await certbot.issueTunnelCert(fqdn, email);
    return cert.certPath || undefined;
  } catch (err: unknown) {
    throw new TunnelError(
      `Certificate check failed: ${err instanceof Error ? err.message : String(err)}`,
      'CERT_FAILED',
    );
  }
}

/**
 * Rewrite an app or plugin tunnel's vhost from its settings — access mode,
 * body limit, the user surfaces it serves — keeping its enabled/disabled
 * link state.
 */
function writeTunnelVhost(
  nginx: NginxDeps,
  tunnel: TunnelEntry,
  subdomain: string,
  domain: string,
  certPath: string | undefined,
  settings: {
    readonly accessMode: AccessMode;
    readonly maxBodySizeMb: number | undefined;
    readonly userSurface: readonly UserSurfaceVhostRoute[];
  },
): Promise<void> {
  return writeModeVhost(nginx, settings.accessMode, subdomain, domain, tunnel.port, certPath, {
    ...(tunnel.pluginRoute ? { pathPrefix: tunnel.pluginRoute } : {}),
    ...(settings.maxBodySizeMb !== undefined ? { maxBodySizeMb: settings.maxBodySizeMb } : {}),
    ...(settings.userSurface.length > 0 ? { userSurface: settings.userSurface } : {}),
    enabled: tunnel.enabled !== false,
  });
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
      const subdomain = t.subdomain ?? '';
      const named = subdomain.startsWith('agent-') ? subdomain.slice('agent-'.length) : '';
      owner = active.has(named) ? named : undefined;
    } else {
      owner = sole;
    }
    if (owner) {
      bound.push({ subdomain: tunnelLabel(t), agentLabel: owner });
      return { ...t, agentLabel: owner };
    }
    unowned.push(tunnelLabel(t));
    return t;
  });
  return { tunnels: next, bound, unowned };
}

// ---------------------------------------------------------------------------
// Create tunnel
// ---------------------------------------------------------------------------

export interface CreateTunnelOptions {
  /** Required for a public tunnel; must be absent for an internal one. */
  subdomain?: string | undefined;
  /** Required for a public tunnel; assigned from the internal range when absent on an internal one. */
  port?: number | undefined;
  description?: string | undefined;
  type?: TunnelType | undefined;
  accessMode?: AccessMode | undefined;
  /** `public` (default) or `internal` — see {@link TunnelExposure}. */
  exposure?: TunnelExposure | undefined;
  pluginName?: string | undefined;
  /** The agent that will carry the tunnel. Must be enrolled and not revoked. */
  agentLabel: string;
  /** Request body limit in MiB; defaults to `TUNNEL_MAX_BODY_MB.default`. */
  maxBodySizeMb?: number | undefined;
  /**
   * Internal tunnels only: `false` creates the tunnel without its chisel
   * grant — the port is reserved, nothing is reachable until it is enabled
   * (the install pipeline grants it once the agent half is ready).
   */
  enabled?: boolean | undefined;
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
 * An internal tunnel (`exposure: 'internal'`) skips steps 1 and 2: it has
 * no hostname, so there is nothing to certify or to serve. Its port is
 * assigned from the internal plugin range unless one is given.
 *
 * Runs under the tunnel lock; the subdomain and port checks read the state
 * inside it. State is written before chisel is synced because the authfile
 * is rendered from persisted state. Rolls back on failure at each step.
 */
export function createTunnel(opts: CreateTunnelOptions): Promise<TunnelEntry> {
  return withTunnelLock(() =>
    opts.exposure === 'internal' ? createInternalTunnelLocked(opts) : createTunnelLocked(opts),
  );
}

async function createInternalTunnelLocked(opts: CreateTunnelOptions): Promise<TunnelEntry> {
  const {
    description,
    type = 'plugin',
    pluginName,
    agentLabel,
    maxBodySizeMb = TUNNEL_MAX_BODY_MB.default,
    chisel,
    state,
    agents,
    logger,
  } = opts;

  // --- Validation ---

  if (type !== 'plugin' || !pluginName) {
    throw new TunnelError(
      'An internal tunnel is a plugin tunnel: pluginName is required',
      'INVALID_SETTING',
    );
  }
  if (opts.subdomain !== undefined) {
    throw new TunnelError('An internal tunnel has no subdomain', 'INVALID_SETTING');
  }
  if (opts.accessMode !== undefined) {
    throw new TunnelError(
      'An internal tunnel has no access mode — it is reachable only on the relay loopback',
      'INVALID_SETTING',
    );
  }
  assertMaxBodySize(maxBodySizeMb);
  await assertAssignableAgent(agentLabel, agents);
  const pluginRoute = derivePluginRoute(pluginName);
  if ((RESERVED_PLUGIN_ROUTES as readonly string[]).includes(pluginRoute)) {
    throw new TunnelError(
      `Plugin route prefix '${pluginRoute}' conflicts with reserved path`,
      'RESERVED_PLUGIN_ROUTE',
    );
  }

  const existing = await state.readTunnels();

  let port: number;
  if (opts.port === undefined) {
    port = assignInternalPluginPort(existing);
  } else {
    port = opts.port;
    if (!isInternalPluginPort(port)) {
      throw new TunnelError(
        `An internal tunnel's port must be in ${INTERNAL_PLUGIN_PORT_RANGE.min}–${INTERNAL_PLUGIN_PORT_RANGE.max}`,
        'INVALID_SETTING',
      );
    }
    if (RESERVED_TUNNEL_PORTS.includes(port)) {
      throw new TunnelError(`Port ${port} belongs to a Lamaste service`, 'RESERVED_PORT');
    }
    if (existing.find((t) => t.port === port)) {
      throw new TunnelError(`Port ${port} is already in use by another tunnel`, 'PORT_IN_USE');
    }
  }

  const tunnel: TunnelEntry = {
    id: crypto.randomUUID(),
    subdomain: null,
    fqdn: null,
    port,
    description: description ?? null,
    type: 'plugin',
    accessMode: undefined,
    enabled: opts.enabled ?? true,
    createdAt: new Date().toISOString(),
    exposure: 'internal',
    agentLabel,
    maxBodySizeMb,
    pluginName,
    pluginRoute,
  };

  // --- Save to state, then sync chisel (as for a public tunnel) ---

  try {
    await state.writeTunnels([...existing, tunnel]);
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to save tunnel state');
    throw new TunnelError(
      `State persistence failed: ${err instanceof Error ? err.message : String(err)}`,
      'STATE_FAILED',
    );
  }

  try {
    logger.info({ port, agentLabel, pluginRoute }, 'Syncing Chisel for internal plugin tunnel');
    await chisel.syncChisel();
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to sync Chisel');
    let stateRestored = false;
    try {
      await state.writeTunnels(existing);
      stateRestored = true;
    } catch (rollbackErr: unknown) {
      logger.error({ err: rollbackErr }, 'Rollback: failed to remove tunnel from state');
    }
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

  if (typeof subdomain !== 'string' || subdomain.length === 0) {
    throw new TunnelError('A tunnel needs a subdomain', 'INVALID_SETTING');
  }
  if (port === undefined) {
    throw new TunnelError('A tunnel needs a port', 'INVALID_SETTING');
  }
  assertTunnelPort(port);
  assertMaxBodySize(maxBodySizeMb);
  await assertAssignableAgent(agentLabel, agents);

  if ((RESERVED_SUBDOMAINS as readonly string[]).includes(subdomain)) {
    throw new TunnelError(`Subdomain '${subdomain}' is reserved`, 'RESERVED_SUBDOMAIN');
  }

  if (subdomain.startsWith(AGENT_PANEL_SUBDOMAIN_PREFIX) && type !== 'panel') {
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
 * Returns the removed entry — a user-surface binding it had goes with it.
 */
export function deleteTunnel(
  opts: DeleteTunnelOptions,
): Promise<{ ok: true; tunnel: TunnelEntry }> {
  return withTunnelLock(async () => {
    const { id, nginx, chisel, state, logger, authorize } = opts;

    const tunnels = await state.readTunnels();
    const tunnel = tunnels.find((t) => t.id === id);
    if (!tunnel) {
      throw new TunnelError('Tunnel not found', 'NOT_FOUND');
    }
    authorize?.(tunnel);

    if (tunnel.subdomain !== null && !isInternalTunnel(tunnel)) {
      logger.info({ subdomain: tunnel.subdomain }, 'Removing nginx vhost');
      if (tunnel.type === 'panel') {
        await nginx.removeAgentPanelVhost(tunnel.subdomain);
      } else {
        await nginx.removeAppVhost(tunnel.subdomain);
      }
    } else {
      logger.info({ tunnel: tunnelLabel(tunnel) }, 'Removing internal plugin tunnel');
    }

    await state.writeTunnels(tunnels.filter((t) => t.id !== id));

    // Revokes the owner's grant on the port
    logger.info({}, 'Syncing Chisel');
    await syncOrThrow(chisel);

    return { ok: true as const, tunnel };
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
  /** Which bound user surfaces a re-rendered vhost serves. */
  userSurface: UserSurfaceDeps;
  logger: TunnelLogger;
  authorize?: AuthorizeTunnel | undefined;
}

/**
 * Apply any combination of carrier, access mode, body limit and enabled
 * state under one hold of the tunnel lock, in that order: ownership first,
 * so a failure later leaves the tunnel carried by the agent that was asked
 * for; enabled last, so a tunnel being disabled is never re-enabled by the
 * vhost rewrite before it. A user-surface binding stays with the tunnel
 * through all of them; a bound tunnel cannot be made public.
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

  // An internal tunnel has no vhost: enabling or disabling it is only the
  // chisel grant, which the sync below gives or withdraws.
  if (tunnel.subdomain !== null && !isInternalTunnel(tunnel)) {
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
  } else {
    logger.info(
      { tunnel: tunnelLabel(tunnel), enabled },
      enabled ? 'Enabling internal plugin tunnel' : 'Disabling internal plugin tunnel',
    );
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
  /** For a tunnel bound as a user surface, whose vhost is rewritten. */
  domain: string;
  email: string;
  nginx: NginxDeps;
  certbot: CertbotDeps;
  chisel: ChiselDeps;
  state: TunnelStateDeps;
  agents: TunnelAgentDeps;
  /** Which bound user surfaces the re-rendered vhost serves. */
  userSurface: UserSurfaceDeps;
  logger: TunnelLogger;
}

/**
 * Move a tunnel to another agent, or give an unowned tunnel its first owner.
 *
 * The previous owner loses the port grant in the same chisel sync that gives
 * it to the new owner. Each agent picks the change up on its next
 * `lamaste-agent sync` (at most 30 seconds on an agent that runs the timer).
 *
 * A tunnel bound as a user surface keeps its binding, but its host serves a
 * route only while the new agent hosts the plugin: when that changes what
 * the vhost serves, the vhost is rewritten first (its link state kept),
 * then the state saved — a failed save restores the previous vhost.
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
  const bound = tunnelUserSurfaceRoutes(tunnel);
  let restoreVhost: (() => Promise<void>) | null = null;
  if (bound.length > 0 && tunnel.subdomain !== null && !isInternalTunnel(tunnel)) {
    restoreVhost = await rewriteServedRoutes(
      tunnel,
      tunnel.subdomain,
      await opts.userSurface.servedRoutes(bound, { agentLabel: previous }),
      await opts.userSurface.servedRoutes(bound, { agentLabel }),
      opts,
    );
  }

  tunnel.agentLabel = agentLabel;
  await saveTunnelsOrRestoreVhost(state, tunnels, restoreVhost, logger);
  logger.info(
    { tunnel: tunnelLabel(tunnel), from: previous ?? null, to: agentLabel },
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
  /** Which bound user surfaces the re-rendered vhost serves. */
  userSurface: UserSurfaceDeps;
  logger: TunnelLogger;
}

/**
 * Change a tunnel's access mode and/or request body limit in place.
 *
 * Both live in the tunnel's nginx vhost, so the vhost is re-rendered from the
 * tunnel's full settings — its user surfaces included, keeping its
 * enabled/disabled link state, and restoring the previous file and link
 * state if nginx rejects it — then the state is saved. Gatekeeper watches
 * the state file and picks up an access-mode change on its own. Agent panel
 * tunnels have a fixed mTLS vhost and are not reconfigurable. A tunnel bound
 * as a user surface cannot be made public (`USER_SURFACE_CONFLICT`): a
 * public host has no session to vouch for.
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

  // An internal tunnel has no vhost: it cannot be given an access mode, and
  // its body limit is enforced by the panel's forwarder, so only the state
  // changes.
  if (isInternalTunnel(tunnel) || tunnel.subdomain === null) {
    if (opts.accessMode !== undefined) {
      throw new TunnelError(
        'An internal tunnel has no access mode — it is reachable only on the relay loopback',
        'INVALID_SETTING',
      );
    }
    if (opts.maxBodySizeMb === undefined || opts.maxBodySizeMb === tunnel.maxBodySizeMb) {
      return { ok: true as const, tunnel };
    }
    const previousLimit = tunnel.maxBodySizeMb;
    tunnel.maxBodySizeMb = opts.maxBodySizeMb;
    await state.writeTunnels(tunnels);
    logger.info(
      { tunnel: tunnelLabel(tunnel), from: previousLimit ?? null, to: opts.maxBodySizeMb },
      'Internal plugin tunnel body limit changed',
    );
    return { ok: true as const, tunnel };
  }
  const subdomain = tunnel.subdomain;

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
  const bound = tunnelUserSurfaceRoutes(tunnel);
  if (after.accessMode === 'public' && bound.length > 0) {
    throw new TunnelError(
      `This tunnel serves the user surface of ${bound.map((r) => `"${r}"`).join(', ')} ` +
        'and cannot be made public — unbind it first',
      'USER_SURFACE_CONFLICT',
    );
  }

  const certPath = await tunnelCertPath(certbot, subdomain, tunnel, domain, email);
  const served = bound.length > 0 ? await opts.userSurface.servedRoutes(bound, tunnel) : [];
  const render = (settings: typeof after): Promise<void> =>
    writeTunnelVhost(nginx, tunnel, subdomain, domain, certPath, {
      accessMode: settings.accessMode,
      maxBodySizeMb: settings.maxBodySizeMb,
      userSurface: served,
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
  await saveTunnelsOrRestoreVhost(state, tunnels, () => render(before), logger);

  logger.info({ subdomain, from: before, to: after }, 'Tunnel reconfigured');
  return { ok: true as const, tunnel };
}

// ---------------------------------------------------------------------------
// User surface binding
// ---------------------------------------------------------------------------

export interface UserSurfaceBindingOptions {
  /** The tunnel. */
  id: string;
  /** The plugin route. */
  route: string;
  domain: string;
  email: string;
  nginx: NginxDeps;
  certbot: CertbotDeps;
  state: TunnelStateDeps;
  userSurface: UserSurfaceDeps;
  logger: TunnelLogger;
}

export interface BindUserSurfaceOptions extends UserSurfaceBindingOptions {
  /**
   * Called under the lock before anything changes: throw to refuse the
   * route (the panel requires an installed, agent-hosted plugin to hold it).
   */
  assertRoute(route: string): Promise<void>;
}

export interface UserSurfaceBindingResult {
  readonly ok: true;
  readonly tunnel: TunnelEntry;
  /** False when the request changed nothing (the route was bound already). */
  readonly changed: boolean;
}

/**
 * Bind `route` as a user surface of tunnel `id`: its host serves
 * `/api/<route>/app/*` once the plugin's installed, approved version
 * declares `identity`. Before that its vhost has no location for the route
 * and requests go down the tunnel as before — so binding a plugin whose
 * next version brings `identity` makes that update the switch-over.
 *
 * Only an enabled app tunnel, `authenticated` or `restricted`, carried by
 * the agent that hosts the plugin (`INVALID_SETTING` otherwise — the host
 * whose sessions reach the plugin's users is never another agent's); a
 * route on one host at most (`USER_SURFACE_CONFLICT`); at most
 * {@link USER_SURFACE_MAX_ROUTES_PER_HOST} routes on a host. Idempotent.
 * Under the tunnel lock: the vhost is rewritten first (when what it serves
 * changes), then the state saved; a failed save restores the previous
 * vhost. The binding stays when the tunnel moves to another agent or the
 * plugin to another host, but is served only while the two agree.
 */
export function bindUserSurface(opts: BindUserSurfaceOptions): Promise<UserSurfaceBindingResult> {
  return withTunnelLock(async () => {
    const { id, route, logger } = opts;
    if (!isUserSurfaceRoute(route)) {
      throw new TunnelError(`Invalid plugin route '${String(route)}'`, 'INVALID_SETTING');
    }
    await opts.assertRoute(route);

    const tunnels = await opts.state.readTunnels();
    const tunnel = tunnels.find((t) => t.id === id);
    if (!tunnel) {
      throw new TunnelError('Tunnel not found', 'NOT_FOUND');
    }
    const subdomain = userSurfaceHostSubdomain(tunnel);
    const current = tunnelUserSurfaceRoutes(tunnel);
    if (current.includes(route)) {
      return { ok: true as const, tunnel, changed: false };
    }
    const hostingAgent = await opts.userSurface.hostingAgent(route);
    if (hostingAgent === null) {
      throw new TunnelError(
        `Plugin '${route}' is not hosted on an agent — host it on the agent that carries this tunnel ('${tunnel.agentLabel}') first`,
        'INVALID_SETTING',
      );
    }
    if (hostingAgent !== tunnel.agentLabel) {
      throw new TunnelError(
        `Plugin '${route}' is hosted on agent '${hostingAgent}', but this tunnel is carried by '${tunnel.agentLabel}' — a plugin's user surface is served only from a tunnel its hosting agent carries`,
        'INVALID_SETTING',
      );
    }
    const holder = tunnels.find((t) => t.id !== id && tunnelUserSurfaceRoutes(t).includes(route));
    if (holder) {
      throw new TunnelError(
        `The user surface of '${route}' is already served on ${tunnelLabel(holder)} — a plugin's user surface is on one host at most`,
        'USER_SURFACE_CONFLICT',
      );
    }
    if (current.length >= USER_SURFACE_MAX_ROUTES_PER_HOST) {
      throw new TunnelError(
        `A host serves the user surfaces of at most ${USER_SURFACE_MAX_ROUTES_PER_HOST} plugins`,
        'INVALID_SETTING',
      );
    }

    await rebindUserSurfaceLocked(tunnels, tunnel, subdomain, [...current, route], opts);
    logger.info({ tunnel: tunnelLabel(tunnel), route }, 'User surface bound');
    return { ok: true as const, tunnel, changed: true };
  });
}

/**
 * Unbind `route` from tunnel `id` (`NOT_FOUND` when it is not bound there):
 * the vhost loses the route's locations, then the state its binding — a
 * failed save restores the previous vhost. Requests for the route go down
 * the tunnel again.
 */
export function unbindUserSurface(
  opts: UserSurfaceBindingOptions,
): Promise<UserSurfaceBindingResult> {
  return withTunnelLock(async () => {
    const { id, route, logger } = opts;
    const tunnels = await opts.state.readTunnels();
    const tunnel = tunnels.find((t) => t.id === id);
    if (!tunnel) {
      throw new TunnelError('Tunnel not found', 'NOT_FOUND');
    }
    const current = tunnelUserSurfaceRoutes(tunnel);
    if (!current.includes(route) || tunnel.subdomain === null) {
      throw new TunnelError(
        `This tunnel does not serve the user surface of '${String(route)}'`,
        'NOT_FOUND',
      );
    }
    await rebindUserSurfaceLocked(
      tunnels,
      tunnel,
      tunnel.subdomain,
      current.filter((r) => r !== route),
      opts,
    );
    logger.info({ tunnel: tunnelLabel(tunnel), route }, 'User surface unbound');
    return { ok: true as const, tunnel, changed: true };
  });
}

export interface ReleaseUserSurfaceRouteOptions {
  route: string;
  state: TunnelStateDeps;
  logger: TunnelLogger;
}

/**
 * Remove `route` from every tunnel's user-surface binding — its plugin is
 * gone. State only, so nothing outside the state can keep the binding
 * alive: Gatekeeper and the panel both read it from there and refuse the
 * route at once. The caller then re-renders the vhosts of the tunnels
 * returned (their locations for the route go).
 */
export function releaseUserSurfaceRoute(
  opts: ReleaseUserSurfaceRouteOptions,
): Promise<{ released: TunnelEntry[] }> {
  return withTunnelLock(async () => {
    const { route, state, logger } = opts;
    const tunnels = await state.readTunnels();
    const released: TunnelEntry[] = [];
    for (const tunnel of tunnels) {
      // The stored list as it is, whatever the tunnel: a binding a reader
      // would not honour still goes.
      const stored: unknown = tunnel.userSurface?.routes;
      if (!Array.isArray(stored) || !stored.includes(route)) continue;
      setBoundRoutes(
        tunnel,
        stored.filter((r): r is string => typeof r === 'string' && r !== route),
      );
      released.push(tunnel);
    }
    if (released.length === 0) return { released };
    await state.writeTunnels(tunnels);
    logger.info(
      { route, tunnels: released.map((t) => tunnelLabel(t)) },
      'Released a user surface from every tunnel',
    );
    return { released };
  });
}

/**
 * The subdomain of a tunnel that may serve a plugin's user surface — an
 * enabled app tunnel an agent carries, `authenticated` or `restricted` —
 * or a refusal (`INVALID_SETTING`).
 */
function userSurfaceHostSubdomain(tunnel: TunnelEntry): string {
  // Tunnels persisted before `type` existed are app tunnels.
  const type: string | undefined = tunnel.type;
  if (isInternalTunnel(tunnel) || tunnel.subdomain === null || (type ?? 'app') !== 'app') {
    throw new TunnelError(
      "Only an app tunnel's host can serve a plugin's user surface",
      'INVALID_SETTING',
    );
  }
  if (tunnel.enabled === false) {
    throw new TunnelError(
      "Enable the tunnel before it serves a plugin's user surface",
      'INVALID_SETTING',
    );
  }
  if (!tunnel.agentLabel) {
    throw new TunnelError(
      "Assign the tunnel to an agent before it serves a plugin's user surface",
      'INVALID_SETTING',
    );
  }
  if ((tunnel.accessMode ?? 'restricted') === 'public') {
    throw new TunnelError(
      'A public tunnel has no signed-in user to vouch for — make it authenticated or restricted first',
      'INVALID_SETTING',
    );
  }
  return tunnel.subdomain;
}

/** Store `routes` as the tunnel's binding — none leaves no `userSurface` at all. */
function setBoundRoutes(tunnel: TunnelEntry, routes: string[]): void {
  if (routes.length > 0) tunnel.userSurface = { routes };
  else delete tunnel.userSurface;
}

function sameServedRoutes(
  a: readonly UserSurfaceVhostRoute[],
  b: readonly UserSurfaceVhostRoute[],
): boolean {
  return (
    a.length === b.length &&
    a.every((r, i) => r.route === b[i]?.route && r.maxBodySizeMb === b[i]?.maxBodySizeMb)
  );
}

/**
 * Rewrite `tunnel`'s vhost to serve `after` when that differs from what it
 * serves now (`before`), keeping its other settings — `NGINX_FAILED` when
 * nginx refuses it. Returns what puts the previous vhost back, or null when
 * nothing was rewritten. Under the held tunnel lock.
 */
async function rewriteServedRoutes(
  tunnel: TunnelEntry,
  subdomain: string,
  before: readonly UserSurfaceVhostRoute[],
  after: readonly UserSurfaceVhostRoute[],
  deps: { domain: string; email: string; nginx: NginxDeps; certbot: CertbotDeps },
): Promise<(() => Promise<void>) | null> {
  if (sameServedRoutes(before, after)) return null;
  const { domain, nginx } = deps;
  const certPath = await tunnelCertPath(deps.certbot, subdomain, tunnel, domain, deps.email);
  const render = (served: readonly UserSurfaceVhostRoute[]): Promise<void> =>
    writeTunnelVhost(nginx, tunnel, subdomain, domain, certPath, {
      accessMode: tunnel.accessMode ?? 'restricted',
      maxBodySizeMb: tunnel.maxBodySizeMb,
      userSurface: served,
    });
  try {
    await render(after);
  } catch (err: unknown) {
    throw new TunnelError(
      `Nginx configuration failed: ${err instanceof Error ? err.message : String(err)}`,
      'NGINX_FAILED',
    );
  }
  return () => render(before);
}

/**
 * Save `tunnels` — `STATE_FAILED` when that fails, after putting the
 * previous vhost back (`restoreVhost`) when one was rewritten.
 */
async function saveTunnelsOrRestoreVhost(
  state: TunnelStateDeps,
  tunnels: TunnelEntry[],
  restoreVhost: (() => Promise<void>) | null,
  logger: TunnelLogger,
): Promise<void> {
  try {
    await state.writeTunnels(tunnels);
  } catch (err: unknown) {
    if (restoreVhost) {
      logger.error({ err }, 'Failed to save tunnel state; restoring previous vhost');
      try {
        await restoreVhost();
      } catch (rollbackErr: unknown) {
        logger.error({ err: rollbackErr }, 'Rollback: failed to restore previous vhost');
      }
    }
    throw new TunnelError(
      `State persistence failed: ${err instanceof Error ? err.message : String(err)}`,
      'STATE_FAILED',
    );
  }
}

/**
 * Change `tunnel`'s binding to `next` under the held lock: rewrite the vhost
 * when what it serves changes, then save the state; restore the vhost when
 * the save fails.
 */
async function rebindUserSurfaceLocked(
  tunnels: TunnelEntry[],
  tunnel: TunnelEntry,
  subdomain: string,
  next: string[],
  opts: UserSurfaceBindingOptions,
): Promise<void> {
  const restoreVhost = await rewriteServedRoutes(
    tunnel,
    subdomain,
    await opts.userSurface.servedRoutes(tunnelUserSurfaceRoutes(tunnel), tunnel),
    await opts.userSurface.servedRoutes(next, tunnel),
    opts,
  );
  setBoundRoutes(tunnel, next);
  await saveTunnelsOrRestoreVhost(opts.state, tunnels, restoreVhost, opts.logger);
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
  /** Their ids — the caller re-renders the vhosts of those bound as a user surface. */
  readonly releasedIds: readonly string[];
  /** The agent's own panel tunnel, removed with its vhost. */
  readonly removedPanels: readonly string[];
}

/**
 * Detach a revoked agent from every tunnel it carried. Its app and plugin
 * tunnels become unassigned (their hostnames stay reserved and dark until an
 * administrator assigns them), and its panel tunnel — which exposes that
 * agent's own management panel — is removed. Without this, a later
 * enrollment reusing the label would silently inherit the old tunnels.
 *
 * A released tunnel bound as a user surface keeps its binding, but no
 * agent carries it: it serves none of it from the state written here on
 * (Gatekeeper and the panel refuse at once); the caller re-renders its
 * vhost (`releasedIds`) so the locations go too.
 */
export function releaseAgentTunnels(
  opts: ReleaseAgentTunnelsOptions,
): Promise<ReleaseAgentTunnelsResult> {
  return withTunnelLock(async () => {
    const { agentLabel, nginx, chisel, state, logger } = opts;
    const tunnels = await state.readTunnels();
    const panelSubdomain = `agent-${agentLabel}`;

    const released: string[] = [];
    const releasedIds: string[] = [];
    const removedPanels: string[] = [];
    const next: TunnelEntry[] = [];
    for (const t of tunnels) {
      if (t.type === 'panel' && (t.agentLabel === agentLabel || t.subdomain === panelSubdomain)) {
        removedPanels.push(t.subdomain ?? panelSubdomain);
        continue;
      }
      if (t.agentLabel === agentLabel) {
        released.push(tunnelLabel(t));
        releasedIds.push(t.id);
        const { agentLabel: _dropped, ...rest } = t;
        next.push(rest);
        continue;
      }
      next.push(t);
    }
    if (released.length === 0 && removedPanels.length === 0) {
      return { released, releasedIds, removedPanels };
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
    return { released, releasedIds, removedPanels };
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
