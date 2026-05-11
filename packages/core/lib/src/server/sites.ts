/**
 * Server-side static site workflows — create, delete, update, DNS verification.
 *
 * Extracts the site creation workflow from serverd route handlers.
 * All functions are pure: they accept dependencies as parameters.
 * No Fastify dependency.
 */

import crypto from 'node:crypto';
import dns from 'node:dns/promises';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SiteType = 'managed' | 'custom';

export interface SiteEntry {
  id: string;
  name: string;
  fqdn: string;
  type: SiteType;
  spaMode: boolean;
  autheliaProtected: boolean;
  allowedUsers: string[];
  dnsVerified: boolean;
  certIssued: boolean;
  rootPath: string;
  createdAt: string;
  totalSize: number;
}

export interface SiteLogger {
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
// Dependency interfaces
// ---------------------------------------------------------------------------

export interface SiteNginxDeps {
  writeStaticSiteVhost(site: SiteEntry, certDir: string, domain: string): Promise<void>;
  removeStaticSiteVhost(siteId: string): Promise<void>;
}

export interface SiteCertbotDeps {
  issueTunnelCert(fqdn: string, email: string): Promise<CertResult>;
  getCertPath(fqdn: string, domain: string): Promise<string>;
}

export interface SiteFilesDeps {
  createSiteDirectory(id: string, name: string): Promise<void>;
  removeSiteDirectory(id: string): Promise<void>;
  getSiteRoot(id: string): string;
}

export interface SiteStateDeps {
  readSites(): Promise<SiteEntry[]>;
  writeSites(sites: SiteEntry[]): Promise<void>;
}

export interface TunnelReadDeps {
  readTunnels(): Promise<Array<{ subdomain: string }>>;
}

export interface AutheliaDeps {
  updateAccessControl(sites: SiteEntry[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RESERVED_SUBDOMAINS = ['panel', 'auth', 'tunnel', 'www', 'mail', 'ftp', 'api'] as const;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SiteError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'DOMAIN_NOT_CONFIGURED'
      | 'CUSTOM_DOMAIN_REQUIRED'
      | 'NAME_IN_USE'
      | 'RESERVED_NAME'
      | 'NAME_TUNNEL_COLLISION'
      | 'FQDN_IN_USE'
      | 'FQDN_TUNNEL_COLLISION'
      | 'CERT_FAILED'
      | 'NGINX_FAILED'
      | 'DIRECTORY_FAILED'
      | 'STATE_FAILED'
      | 'NOT_FOUND'
      | 'NOT_CUSTOM'
      | 'ALREADY_VERIFIED'
      | 'DNS_MISMATCH'
      | 'AUTHELIA_FAILED',
  ) {
    super(message);
    this.name = 'SiteError';
  }
}

// ---------------------------------------------------------------------------
// DNS resolution helper
// ---------------------------------------------------------------------------

/**
 * Resolve A records for a hostname, returning an empty array on expected DNS errors.
 */
async function resolveA(hostname: string): Promise<string[]> {
  try {
    return await dns.resolve4(hostname);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ETIMEOUT') {
      return [];
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Create site
// ---------------------------------------------------------------------------

export interface CreateSiteOptions {
  name: string;
  type: SiteType;
  customDomain?: string | undefined;
  spaMode?: boolean | undefined;
  autheliaProtected?: boolean | undefined;
  domain: string;
  email: string;
  nginx: SiteNginxDeps;
  certbot: SiteCertbotDeps;
  files: SiteFilesDeps;
  siteState: SiteStateDeps;
  tunnelState: TunnelReadDeps;
  logger: SiteLogger;
}

export interface CreateSiteResult {
  site: SiteEntry;
  message?: string | undefined;
}

/**
 * Create a static site.
 *
 * For managed sites: issues cert, writes nginx vhost, creates directory, saves state.
 * For custom domain sites: creates directory, saves state, waits for DNS verification.
 */
export async function createSite(opts: CreateSiteOptions): Promise<CreateSiteResult> {
  const {
    name,
    type,
    customDomain,
    spaMode = false,
    autheliaProtected = false,
    domain,
    email,
    nginx,
    certbot,
    files,
    siteState,
    tunnelState,
    logger,
  } = opts;

  // --- Validation ---

  if (type === 'custom' && !customDomain) {
    throw new SiteError(
      'Custom domain is required for custom type sites',
      'CUSTOM_DOMAIN_REQUIRED',
    );
  }

  const existingSites = await siteState.readSites();
  if (existingSites.find((s) => s.name === name)) {
    throw new SiteError(`Site name '${name}' is already in use`, 'NAME_IN_USE');
  }

  if (type === 'managed' && (RESERVED_SUBDOMAINS as readonly string[]).includes(name)) {
    throw new SiteError(`Name '${name}' is reserved`, 'RESERVED_NAME');
  }

  const tunnels = await tunnelState.readTunnels();
  if (type === 'managed' && tunnels.find((t) => t.subdomain === name)) {
    throw new SiteError(`Name '${name}' is already in use by a tunnel`, 'NAME_TUNNEL_COLLISION');
  }

  const fqdn = type === 'managed' ? `${name}.${domain}` : customDomain!;

  if (existingSites.find((s) => s.fqdn === fqdn)) {
    throw new SiteError(`Domain '${fqdn}' is already in use by another site`, 'FQDN_IN_USE');
  }

  if (tunnels.find((t) => `${t.subdomain}.${domain}` === fqdn)) {
    throw new SiteError(`Domain '${fqdn}' is already in use by a tunnel`, 'FQDN_TUNNEL_COLLISION');
  }

  const id = crypto.randomUUID();
  const rootPath = files.getSiteRoot(id);

  const site: SiteEntry = {
    id,
    name,
    fqdn,
    type,
    spaMode,
    autheliaProtected,
    allowedUsers: [],
    dnsVerified: type === 'managed',
    certIssued: false,
    rootPath,
    createdAt: new Date().toISOString(),
    totalSize: 0,
  };

  if (type === 'managed') {
    return createManagedSite(
      site,
      existingSites,
      domain,
      email,
      nginx,
      certbot,
      files,
      siteState,
      logger,
    );
  }

  return createCustomSite(site, existingSites, files, siteState, logger);
}

async function createManagedSite(
  site: SiteEntry,
  existingSites: SiteEntry[],
  domain: string,
  email: string,
  nginx: SiteNginxDeps,
  certbot: SiteCertbotDeps,
  files: SiteFilesDeps,
  siteState: SiteStateDeps,
  logger: SiteLogger,
): Promise<CreateSiteResult> {
  // Step 1: Issue TLS certificate
  let certResult: CertResult;
  try {
    logger.info({ fqdn: site.fqdn }, 'Issuing TLS certificate for static site');
    certResult = await certbot.issueTunnelCert(site.fqdn, email);
    site.certIssued = true;
    logger.info({ fqdn: site.fqdn, skipped: certResult.skipped }, 'Certificate ready');
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to issue TLS certificate for static site');
    throw new SiteError(
      `Certificate issuance failed: ${err instanceof Error ? err.message : String(err)}`,
      'CERT_FAILED',
    );
  }

  // Step 2: Write nginx vhost
  try {
    logger.info({ fqdn: site.fqdn }, 'Writing nginx vhost for static site');
    const certDir = certResult.certPath || (await certbot.getCertPath(site.fqdn, domain));
    await nginx.writeStaticSiteVhost(site, certDir, domain);
    logger.info({ fqdn: site.fqdn }, 'Nginx vhost configured');
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to write nginx vhost for static site');
    throw new SiteError(
      `Nginx configuration failed: ${err instanceof Error ? err.message : String(err)}`,
      'NGINX_FAILED',
    );
  }

  // Step 3: Create site directory
  try {
    await files.createSiteDirectory(site.id, site.name);
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to create site directory');
    try {
      await nginx.removeStaticSiteVhost(site.id);
    } catch (rollbackErr: unknown) {
      logger.error({ err: rollbackErr }, 'Rollback: failed to remove nginx vhost');
    }
    throw new SiteError(
      `Directory creation failed: ${err instanceof Error ? err.message : String(err)}`,
      'DIRECTORY_FAILED',
    );
  }

  // Step 4: Save state
  try {
    existingSites.push(site);
    await siteState.writeSites(existingSites);
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to save site state');
    try {
      await nginx.removeStaticSiteVhost(site.id);
    } catch {
      // best effort
    }
    try {
      await files.removeSiteDirectory(site.id);
    } catch {
      // best effort
    }
    throw new SiteError(
      `State persistence failed: ${err instanceof Error ? err.message : String(err)}`,
      'STATE_FAILED',
    );
  }

  return { site };
}

async function createCustomSite(
  site: SiteEntry,
  existingSites: SiteEntry[],
  files: SiteFilesDeps,
  siteState: SiteStateDeps,
  logger: SiteLogger,
): Promise<CreateSiteResult> {
  // Create directory for uploads
  try {
    await files.createSiteDirectory(site.id, site.name);
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to create site directory');
    throw new SiteError(
      `Directory creation failed: ${err instanceof Error ? err.message : String(err)}`,
      'DIRECTORY_FAILED',
    );
  }

  // Save state
  try {
    existingSites.push(site);
    await siteState.writeSites(existingSites);
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to save site state');
    try {
      await files.removeSiteDirectory(site.id);
    } catch {
      // best effort
    }
    throw new SiteError(
      `State persistence failed: ${err instanceof Error ? err.message : String(err)}`,
      'STATE_FAILED',
    );
  }

  return {
    site,
    message: 'Site created. Add an A record for your domain, then verify DNS.',
  };
}

// ---------------------------------------------------------------------------
// Delete site
// ---------------------------------------------------------------------------

export interface DeleteSiteOptions {
  id: string;
  nginx: SiteNginxDeps;
  files: SiteFilesDeps;
  siteState: SiteStateDeps;
  logger: SiteLogger;
}

/**
 * Delete a static site: remove nginx vhost, remove directory, remove from state.
 */
export async function deleteSite(opts: DeleteSiteOptions): Promise<{ ok: true }> {
  const { id, nginx, files, siteState, logger } = opts;

  const sites = await siteState.readSites();
  const index = sites.findIndex((s) => s.id === id);

  if (index === -1) {
    throw new SiteError('Site not found', 'NOT_FOUND');
  }

  const site = sites[index]!;

  // Step 1: Remove nginx vhost (only if cert was issued)
  if (site.certIssued) {
    logger.info({ fqdn: site.fqdn }, 'Removing nginx vhost for static site');
    await nginx.removeStaticSiteVhost(site.id);
  }

  // Step 2: Remove site directory
  logger.info({ id: site.id }, 'Removing site directory');
  await files.removeSiteDirectory(site.id);

  // Step 3: Remove from state
  const remaining = sites.filter((_, i) => i !== index);
  await siteState.writeSites(remaining);

  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Update site
// ---------------------------------------------------------------------------

export interface UpdateSiteOptions {
  id: string;
  spaMode?: boolean | undefined;
  autheliaProtected?: boolean | undefined;
  allowedUsers?: string[] | undefined;
  domain: string;
  nginx: SiteNginxDeps;
  certbot: SiteCertbotDeps;
  siteState: SiteStateDeps;
  authelia: AutheliaDeps;
  logger: SiteLogger;
}

export interface UpdateSiteResult {
  ok: true;
  site: SiteEntry;
  message?: string | undefined;
}

/**
 * Update site settings (spaMode, autheliaProtected, allowedUsers).
 * Regenerates nginx vhost if needed and syncs Authelia access control.
 */
export async function updateSite(opts: UpdateSiteOptions): Promise<UpdateSiteResult> {
  const { id, domain, nginx, certbot, siteState, authelia, logger } = opts;

  const sites = await siteState.readSites();
  const siteIndex = sites.findIndex((s) => s.id === id);

  if (siteIndex === -1) {
    throw new SiteError('Site not found', 'NOT_FOUND');
  }

  const site = sites[siteIndex]!;

  const newSpaMode = opts.spaMode !== undefined ? opts.spaMode : site.spaMode;
  const newAutheliaProtected =
    opts.autheliaProtected !== undefined ? opts.autheliaProtected : site.autheliaProtected;
  const newAllowedUsers = opts.allowedUsers !== undefined ? opts.allowedUsers : site.allowedUsers;

  const spaModeChanged = newSpaMode !== site.spaMode;
  const autheliaChanged = newAutheliaProtected !== site.autheliaProtected;
  const usersChanged = JSON.stringify(newAllowedUsers) !== JSON.stringify(site.allowedUsers);

  if (!spaModeChanged && !autheliaChanged && !usersChanged) {
    return { ok: true as const, site, message: 'No changes' };
  }

  // Update site fields
  site.spaMode = newSpaMode;
  site.autheliaProtected = newAutheliaProtected;
  site.allowedUsers = newAllowedUsers;

  // Regenerate nginx vhost if the site is live and nginx-affecting settings changed
  if (site.certIssued && (spaModeChanged || autheliaChanged)) {
    try {
      const certDir =
        site.type === 'managed'
          ? await certbot.getCertPath(site.fqdn, domain)
          : `/etc/letsencrypt/live/${site.fqdn}/`;
      await nginx.writeStaticSiteVhost(site, certDir, domain);
      logger.info(
        {
          fqdn: site.fqdn,
          spaMode: site.spaMode,
          autheliaProtected: site.autheliaProtected,
        },
        'Nginx vhost updated',
      );
    } catch (err: unknown) {
      logger.error({ err }, 'Failed to update nginx vhost');
      throw new SiteError(
        `Nginx configuration failed: ${err instanceof Error ? err.message : String(err)}`,
        'NGINX_FAILED',
      );
    }
  }

  // Persist state
  sites[siteIndex] = site;
  await siteState.writeSites(sites);

  // Sync Authelia access_control if auth settings or user assignments changed
  if (autheliaChanged || usersChanged) {
    try {
      const allSites = await siteState.readSites();
      await authelia.updateAccessControl(allSites);
      logger.info({}, 'Authelia access control updated');
    } catch (err: unknown) {
      logger.error({ err }, 'Failed to update Authelia access control');
      throw new SiteError(
        `Site saved but Authelia configuration failed: ${err instanceof Error ? err.message : String(err)}`,
        'AUTHELIA_FAILED',
      );
    }
  }

  return { ok: true as const, site };
}

// ---------------------------------------------------------------------------
// Verify DNS
// ---------------------------------------------------------------------------

export interface VerifyDnsOptions {
  id: string;
  serverIp: string;
  domain: string;
  email: string;
  nginx: SiteNginxDeps;
  certbot: SiteCertbotDeps;
  siteState: SiteStateDeps;
  logger: SiteLogger;
}

export type VerifyDnsResult =
  | { ok: true; message: string }
  | {
      ok: false;
      fqdn: string;
      expectedIp: string;
      resolvedIps: string[];
      message: string;
    };

/**
 * Verify DNS for a custom domain site.
 * On success, issues TLS cert and configures nginx.
 */
export async function verifyDns(opts: VerifyDnsOptions): Promise<VerifyDnsResult> {
  const { id, serverIp, domain, email, nginx, certbot, siteState, logger } = opts;

  const sites = await siteState.readSites();
  const site = sites.find((s) => s.id === id);

  if (!site) {
    throw new SiteError('Site not found', 'NOT_FOUND');
  }

  if (site.type !== 'custom') {
    throw new SiteError('DNS verification is only needed for custom domains', 'NOT_CUSTOM');
  }

  if (site.dnsVerified && site.certIssued) {
    return { ok: true, message: 'DNS already verified and certificate issued' };
  }

  const resolvedIps = await resolveA(site.fqdn);
  const dnsOk = resolvedIps.includes(serverIp);

  if (!dnsOk) {
    return {
      ok: false,
      fqdn: site.fqdn,
      expectedIp: serverIp,
      resolvedIps,
      message:
        resolvedIps.length > 0
          ? `Domain resolves to ${resolvedIps.join(', ')} but your server IP is ${serverIp}. Please update your A record.`
          : `Domain does not resolve yet. Please add an A record pointing ${site.fqdn} to ${serverIp}.`,
    };
  }

  // DNS verified -- issue cert and configure vhost
  site.dnsVerified = true;

  try {
    logger.info({ fqdn: site.fqdn }, 'DNS verified, issuing certificate');
    await certbot.issueTunnelCert(site.fqdn, email);
    site.certIssued = true;
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to issue certificate for custom domain');
    throw new SiteError(
      `DNS verified but certificate issuance failed: ${err instanceof Error ? err.message : String(err)}`,
      'CERT_FAILED',
    );
  }

  try {
    const certDir = `/etc/letsencrypt/live/${site.fqdn}/`;
    await nginx.writeStaticSiteVhost(site, certDir, domain);
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to write nginx vhost for custom domain');
    throw new SiteError(
      `Certificate issued but nginx configuration failed: ${err instanceof Error ? err.message : String(err)}`,
      'NGINX_FAILED',
    );
  }

  // Update state
  const siteIndex = sites.findIndex((s) => s.id === id);
  sites[siteIndex] = site;
  await siteState.writeSites(sites);

  return { ok: true, message: 'DNS verified, certificate issued, and site is now live.' };
}
