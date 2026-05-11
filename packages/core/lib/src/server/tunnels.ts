/**
 * Server-side tunnel workflows — create, delete, toggle.
 *
 * Extracts the 4-step tunnel creation workflow from serverd route handlers.
 * All functions are pure: they accept dependencies (nginx helpers, chisel helpers,
 * state persistence, config) as parameters. No Fastify dependency.
 */

import crypto from 'node:crypto';
import { derivePluginRoute as coreDerivePluginRoute } from '../constants.js';

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
  agentLabel?: string | undefined;
  pluginRoute?: string | undefined;
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

/** Writes an nginx vhost config based on tunnel type and access mode. */
export interface NginxDeps {
  writePublicVhost(
    subdomain: string,
    domain: string,
    port: number,
    certPath: string | undefined,
    opts?: { pathPrefix?: string },
  ): Promise<void>;
  writeAuthenticatedVhost(
    subdomain: string,
    domain: string,
    port: number,
    certPath: string | undefined,
    opts?: { pathPrefix?: string },
  ): Promise<void>;
  writeRestrictedVhost(
    subdomain: string,
    domain: string,
    port: number,
    certPath: string | undefined,
    opts?: { pathPrefix?: string },
  ): Promise<void>;
  writeAgentPanelVhost(
    subdomain: string,
    domain: string,
    port: number,
    certPath: string | undefined,
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

/** Updates chisel reverse tunnel configuration. */
export interface ChiselDeps {
  updateChiselConfig(tunnels: Array<{ port: number }>): Promise<void>;
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
      | 'RESERVED_PLUGIN_ROUTE',
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
// Create tunnel
// ---------------------------------------------------------------------------

export interface CreateTunnelOptions {
  subdomain: string;
  port: number;
  description?: string | undefined;
  type?: TunnelType | undefined;
  accessMode?: AccessMode | undefined;
  pluginName?: string | undefined;
  agentLabel?: string | undefined;
  domain: string;
  email: string;
  nginx: NginxDeps;
  certbot: CertbotDeps;
  chisel: ChiselDeps;
  state: TunnelStateDeps;
  logger: TunnelLogger;
}

/**
 * Create a tunnel with the 4-step workflow:
 * 1. Issue TLS certificate
 * 2. Write nginx vhost
 * 3. Update chisel config
 * 4. Save to state
 *
 * Rolls back on failure at each step.
 */
export async function createTunnel(opts: CreateTunnelOptions): Promise<TunnelEntry> {
  const {
    subdomain,
    port,
    description,
    type = 'app',
    accessMode = 'restricted',
    pluginName,
    agentLabel,
    domain,
    email,
    nginx,
    certbot,
    chisel,
    state,
    logger,
  } = opts;

  // --- Validation ---

  if ((RESERVED_SUBDOMAINS as readonly string[]).includes(subdomain)) {
    throw new TunnelError(`Subdomain '${subdomain}' is reserved`, 'RESERVED_SUBDOMAIN');
  }

  if (subdomain.startsWith('agent-') && type !== 'panel') {
    throw new TunnelError(
      "Subdomain prefix 'agent-' is reserved for agent panel tunnels",
      'RESERVED_AGENT_PREFIX',
    );
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

      const vhostOpts = pluginRoute ? { pathPrefix: pluginRoute } : {};
      if (accessMode === 'public') {
        await nginx.writePublicVhost(subdomain, domain, port, certPath, vhostOpts);
      } else if (accessMode === 'authenticated') {
        await nginx.writeAuthenticatedVhost(subdomain, domain, port, certPath, vhostOpts);
      } else {
        await nginx.writeRestrictedVhost(subdomain, domain, port, certPath, vhostOpts);
      }
    }
    logger.info({ fqdn }, 'Nginx vhost configured');
  } catch (err: unknown) {
    if (err instanceof TunnelError) throw err;
    logger.error({ err }, 'Failed to write nginx vhost');
    throw new TunnelError(
      `Nginx configuration failed: ${err instanceof Error ? err.message : String(err)}`,
      'NGINX_FAILED',
    );
  }

  // --- Step 3: Update chisel config ---

  try {
    logger.info({ port }, 'Updating Chisel configuration');
    const allTunnels = [...existing, { port, enabled: true }];
    const enabledForChisel = allTunnels.filter((t) => 'enabled' in t && t.enabled !== false);
    await chisel.updateChiselConfig(enabledForChisel);
    logger.info({}, 'Chisel configuration updated');
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to update Chisel config');
    try {
      await removeVhost(subdomain);
    } catch (rollbackErr: unknown) {
      logger.error({ err: rollbackErr }, 'Rollback: failed to remove nginx vhost');
    }
    throw new TunnelError(
      `Chisel reconfiguration failed: ${err instanceof Error ? err.message : String(err)}`,
      'CHISEL_FAILED',
    );
  }

  // --- Step 4: Save to state ---

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
  };

  // Plugin tunnels store additional metadata
  if (type === 'plugin' && pluginName) {
    tunnel.pluginName = pluginName;
    tunnel.agentLabel = agentLabel;
    tunnel.pluginRoute = derivePluginRoute(pluginName);
  }

  try {
    const tunnels = await state.readTunnels();
    tunnels.push(tunnel);
    await state.writeTunnels(tunnels);
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
}

/**
 * Delete a tunnel: remove nginx vhost, update chisel, remove from state.
 */
export async function deleteTunnel(opts: DeleteTunnelOptions): Promise<{ ok: true }> {
  const { id, nginx, chisel, state, logger } = opts;

  const tunnels = await state.readTunnels();
  const index = tunnels.findIndex((t) => t.id === id);

  if (index === -1) {
    throw new TunnelError('Tunnel not found', 'NOT_FOUND');
  }

  const tunnel = tunnels[index]!;

  // Step 1: Remove nginx vhost
  logger.info({ subdomain: tunnel.subdomain }, 'Removing nginx vhost');
  if (tunnel.type === 'panel') {
    await nginx.removeAgentPanelVhost(tunnel.subdomain);
  } else {
    await nginx.removeAppVhost(tunnel.subdomain);
  }

  // Step 2: Update chisel config (with remaining enabled tunnels)
  const remaining = tunnels.filter((_, i) => i !== index);
  const enabledRemaining = remaining.filter((t) => t.enabled !== false);
  logger.info({}, 'Updating Chisel configuration');
  await chisel.updateChiselConfig(enabledRemaining);

  // Step 3: Remove from state
  await state.writeTunnels(remaining);

  return { ok: true as const };
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
export async function toggleTunnel(
  opts: ToggleTunnelOptions,
): Promise<{ ok: true; tunnel: TunnelEntry }> {
  const { id, enabled, nginx, chisel, state, logger } = opts;

  const tunnels = await state.readTunnels();
  const tunnel = tunnels.find((t) => t.id === id);

  if (!tunnel) {
    throw new TunnelError('Tunnel not found', 'NOT_FOUND');
  }

  const wasEnabled = tunnel.enabled !== false;
  tunnel.enabled = enabled;

  const isPanel = tunnel.type === 'panel';

  if (enabled && !wasEnabled) {
    logger.info({ subdomain: tunnel.subdomain }, 'Enabling tunnel');
    if (isPanel) {
      await nginx.enableAgentPanelVhost(tunnel.subdomain);
    } else {
      await nginx.enableAppVhost(tunnel.subdomain);
    }
  } else if (!enabled && wasEnabled) {
    logger.info({ subdomain: tunnel.subdomain }, 'Disabling tunnel');
    if (isPanel) {
      await nginx.disableAgentPanelVhost(tunnel.subdomain);
    } else {
      await nginx.disableAppVhost(tunnel.subdomain);
    }
  }

  // Update chisel with only enabled tunnels
  const enabledTunnels = tunnels.filter((t) => t.enabled !== false);
  await chisel.updateChiselConfig(enabledTunnels);

  // Save state
  await state.writeTunnels(tunnels);

  return { ok: true as const, tunnel };
}
