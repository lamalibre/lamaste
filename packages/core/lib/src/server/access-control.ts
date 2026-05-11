/**
 * Authelia access control synchronization.
 *
 * Merges site rules and plugin tunnel grant rules into a single
 * Authelia access_control configuration. This is a pure function
 * that accepts all state/config paths and dependencies as parameters.
 *
 * Note: The full syncAllAccessControl implementation depends on the
 * gatekeeper state files (groups.json, access-grants.json) and Authelia
 * configuration YAML. This module provides the interface and orchestration
 * logic; the actual Authelia YAML manipulation is delegated to the
 * authelia dependency.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SiteEntry {
  readonly id: string;
  readonly name: string;
  readonly fqdn: string;
  readonly type: 'managed' | 'custom';
  readonly autheliaProtected: boolean;
  readonly allowedUsers: readonly string[];
}

export interface PluginTunnelGrant {
  readonly principalType: 'user' | 'group';
  readonly principalId: string;
  readonly resourceType: string;
  readonly resourceId: string;
}

export interface TunnelEntry {
  readonly subdomain: string;
  readonly fqdn: string;
  readonly type: 'app' | 'panel' | 'plugin';
  readonly accessMode?: 'public' | 'authenticated' | 'restricted' | undefined;
  readonly enabled: boolean;
  readonly pluginName?: string | undefined;
  readonly agentLabel?: string | undefined;
}

export interface AccessControlLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

// ---------------------------------------------------------------------------
// Dependency interfaces
// ---------------------------------------------------------------------------

export interface AutheliaDeps {
  /**
   * Update Authelia access_control rules based on sites and their protection settings.
   */
  updateAccessControl(sites: SiteEntry[]): Promise<void>;
}

export interface GrantStateDeps {
  /**
   * Read all access grants from the grants state file.
   */
  readGrants(): Promise<PluginTunnelGrant[]>;
}

export interface TunnelStateDeps {
  readTunnels(): Promise<TunnelEntry[]>;
}

export interface SiteStateDeps {
  readSites(): Promise<SiteEntry[]>;
}

// ---------------------------------------------------------------------------
// Access control sync
// ---------------------------------------------------------------------------

export interface SyncAccessControlOptions {
  authelia: AutheliaDeps;
  siteState: SiteStateDeps;
  logger: AccessControlLogger;
}

/**
 * Synchronize site-derived Authelia access_control rules.
 *
 * NOTE: This used to accept `grantState` and `tunnelState` deps for merging
 * plugin tunnel grants into the same call. That merging is not implemented in
 * the core library — gatekeeper now owns plugin tunnel access control via its
 * own `auth_request` flow on :9294. Carrying unused deps in the signature was
 * misleading, so they were removed. If site rules and gatekeeper grants ever
 * need to be coalesced into a single Authelia file again, re-add the deps and
 * implement the merge — do not silently accept them again.
 */
export async function syncAllAccessControl(opts: SyncAccessControlOptions): Promise<void> {
  const { authelia, siteState, logger } = opts;

  try {
    const allSites = await siteState.readSites();
    await authelia.updateAccessControl(allSites);
    logger.info({}, 'Authelia access control synchronized');
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to synchronize Authelia access control');
    throw err;
  }
}
