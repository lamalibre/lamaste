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
  /**
   * Further hostnames that answer with a 301 to `https://<fqdn>` — typically
   * `www.<fqdn>`. Custom-domain sites only. One certificate lineage, named
   * after `fqdn`, covers the primary name and every alias.
   */
  aliases?: string[] | undefined;
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
  /** One lineage named after `fqdn` covering `fqdn` and every alias. */
  issueSiteCert(
    fqdn: string,
    aliases: readonly string[],
    email: string,
    options?: { readonly match?: 'covering' | 'exact' },
  ): Promise<CertResult>;
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

/** Upper bound on aliases per site — a redirect list, not a domain farm. */
export const MAX_SITE_ALIASES = 10;

const HOSTNAME_RE =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

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
      | 'AUTHELIA_FAILED'
      | 'INVALID_ALIAS'
      | 'ALIAS_IN_USE',
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

/**
 * Validate a site's alias list against every hostname already served.
 * Returns the normalised (lower-cased, de-duplicated) list.
 */
function validateAliases(
  fqdn: string,
  aliases: readonly string[],
  selfId: string | null,
  sites: readonly SiteEntry[],
  tunnels: ReadonlyArray<{ subdomain: string }>,
  domain: string,
): string[] {
  const normalised = [...new Set(aliases.map((a) => a.trim().toLowerCase()))];
  if (normalised.length > MAX_SITE_ALIASES) {
    throw new SiteError(`At most ${MAX_SITE_ALIASES} aliases per site`, 'INVALID_ALIAS');
  }
  const core = new Set(['panel', 'auth', 'tunnel'].map((s) => `${s}.${domain}`));
  const tunnelHosts = new Set(tunnels.map((t) => `${t.subdomain}.${domain}`));
  for (const alias of normalised) {
    if (!HOSTNAME_RE.test(alias)) {
      throw new SiteError(`Invalid alias hostname '${alias}'`, 'INVALID_ALIAS');
    }
    if (alias === fqdn) {
      throw new SiteError(`Alias '${alias}' is the site's own domain`, 'INVALID_ALIAS');
    }
    if (core.has(alias) || alias === domain) {
      throw new SiteError(`'${alias}' is reserved for Lamaste itself`, 'INVALID_ALIAS');
    }
    if (tunnelHosts.has(alias)) {
      throw new SiteError(`'${alias}' is already in use by a tunnel`, 'ALIAS_IN_USE');
    }
    const owner = sites.find(
      (s) => s.id !== selfId && (s.fqdn === alias || (s.aliases ?? []).includes(alias)),
    );
    if (owner) {
      throw new SiteError(`'${alias}' is already served by site '${owner.name}'`, 'ALIAS_IN_USE');
    }
  }
  return normalised;
}

/**
 * The hostnames among `names` that do not resolve to `serverIp` yet.
 */
async function unresolvedNames(names: readonly string[], serverIp: string): Promise<string[]> {
  const missing: string[] = [];
  for (const name of names) {
    const ips = await resolveA(name);
    if (!ips.includes(serverIp)) missing.push(name);
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Create site
// ---------------------------------------------------------------------------

export interface CreateSiteOptions {
  name: string;
  type: SiteType;
  customDomain?: string | undefined;
  /** Custom-domain sites only: hostnames that redirect to the site. */
  aliases?: string[] | undefined;
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
    aliases = [],
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

  if (existingSites.find((s) => (s.aliases ?? []).includes(fqdn))) {
    throw new SiteError(`Domain '${fqdn}' is already an alias of another site`, 'FQDN_IN_USE');
  }

  if (aliases.length > 0 && type !== 'custom') {
    throw new SiteError('Aliases are only supported on custom-domain sites', 'NOT_CUSTOM');
  }
  const siteAliases = validateAliases(fqdn, aliases, null, existingSites, tunnels, domain);

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
    ...(siteAliases.length > 0 ? { aliases: siteAliases } : {}),
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
    message:
      (site.aliases ?? []).length > 0
        ? `Site created. Add A records for ${[site.fqdn, ...(site.aliases ?? [])].join(', ')}, then verify DNS.`
        : 'Site created. Add an A record for your domain, then verify DNS.',
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
  /** Custom-domain sites only: the complete new alias list. */
  aliases?: string[] | undefined;
  domain: string;
  /** Needed only when aliases change on a live site. */
  email?: string | undefined;
  serverIp?: string | undefined;
  nginx: SiteNginxDeps;
  certbot: SiteCertbotDeps;
  siteState: SiteStateDeps;
  tunnelState?: TunnelReadDeps | undefined;
  authelia: AutheliaDeps;
  logger: SiteLogger;
}

export interface UpdateSiteResult {
  ok: true;
  site: SiteEntry;
  message?: string | undefined;
  /** Set when the update was applied but a follow-up step needs attention. */
  warning?: string | undefined;
}

/**
 * Update site settings (spaMode, autheliaProtected, allowedUsers, aliases).
 * Regenerates nginx vhost if needed and syncs Authelia access control.
 *
 * On a live custom-domain site an alias change takes effect immediately, in
 * an order where every intermediate state serves correctly:
 *
 * 1. Every added alias must already resolve to this server.
 * 2. The certificate is issued for the union of the old and new names, so
 *    it is valid for whichever vhost nginx serves at any moment.
 * 3. The vhost is rewritten (tested by nginx, previous file restored on
 *    failure), then the new list is saved.
 * 4. If names were removed, the certificate is re-issued for exactly the new
 *    set, so renewal never has to validate a hostname the site no longer
 *    serves (its DNS may already point elsewhere). A failure here leaves a
 *    working site with a certificate that still names the removed aliases;
 *    it is reported as `warning` and retried by the next alias update.
 *
 * A failure in steps 1–3 leaves the saved site unchanged; the certificate may
 * then already carry the added names, which is harmless. On a site still
 * awaiting DNS verification the list is only saved; DNS verification then
 * covers every alias.
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

  let newAliases = site.aliases ?? [];
  if (opts.aliases !== undefined) {
    if (site.type !== 'custom' && opts.aliases.length > 0) {
      throw new SiteError('Aliases are only supported on custom-domain sites', 'NOT_CUSTOM');
    }
    const tunnels = opts.tunnelState ? await opts.tunnelState.readTunnels() : [];
    newAliases = validateAliases(site.fqdn, opts.aliases, site.id, sites, tunnels, domain);
  }

  const spaModeChanged = newSpaMode !== site.spaMode;
  const autheliaChanged = newAutheliaProtected !== site.autheliaProtected;
  const usersChanged = JSON.stringify(newAllowedUsers) !== JSON.stringify(site.allowedUsers);
  const aliasesChanged = JSON.stringify(newAliases) !== JSON.stringify(site.aliases ?? []);

  if (!spaModeChanged && !autheliaChanged && !usersChanged && !aliasesChanged) {
    return { ok: true as const, site, message: 'No changes' };
  }

  // A live custom site's certificate must cover every name the vhost can
  // answer for, before and after the rewrite: issue for the union first.
  const oldAliases = site.aliases ?? [];
  const reissueCert = site.certIssued && site.type === 'custom' && aliasesChanged;
  if (reissueCert) {
    if (!opts.email) {
      throw new SiteError('Email is required to change aliases', 'DOMAIN_NOT_CONFIGURED');
    }
    const added = newAliases.filter((a) => !oldAliases.includes(a));
    if (added.length > 0) {
      if (!opts.serverIp) {
        throw new SiteError('Server IP is required to add aliases', 'DOMAIN_NOT_CONFIGURED');
      }
      const pending = await unresolvedNames(added, opts.serverIp);
      if (pending.length > 0) {
        throw new SiteError(
          `Add A records pointing ${pending.join(', ')} to ${opts.serverIp} before adding them as aliases`,
          'DNS_MISMATCH',
        );
      }
      const union = [...oldAliases, ...added];
      try {
        await certbot.issueSiteCert(site.fqdn, union, opts.email);
      } catch (err: unknown) {
        throw new SiteError(
          `Certificate issuance failed: ${err instanceof Error ? err.message : String(err)}`,
          'CERT_FAILED',
        );
      }
    }
  }

  // Update site fields
  site.spaMode = newSpaMode;
  site.autheliaProtected = newAutheliaProtected;
  site.allowedUsers = newAllowedUsers;
  if (newAliases.length > 0) site.aliases = newAliases;
  else delete site.aliases;

  // Regenerate nginx vhost if the site is live and nginx-affecting settings changed
  if (site.certIssued && (spaModeChanged || autheliaChanged || aliasesChanged)) {
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

  // Narrow the certificate to exactly the names the site now serves.
  let warning: string | undefined;
  if (reissueCert && opts.email) {
    try {
      await certbot.issueSiteCert(site.fqdn, newAliases, opts.email, { match: 'exact' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, fqdn: site.fqdn }, 'Failed to narrow the site certificate');
      warning =
        'The site now serves the new alias list, but its certificate still names removed ' +
        `aliases, and renewing it will fail once they stop resolving here: ${message}`;
    }
  }

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

  return { ok: true as const, site, ...(warning ? { warning } : {}) };
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

  // Every alias shares the certificate, so every alias must resolve here too.
  const aliases = site.aliases ?? [];
  const pending = await unresolvedNames(aliases, serverIp);
  if (pending.length > 0) {
    return {
      ok: false,
      fqdn: pending[0] ?? site.fqdn,
      expectedIp: serverIp,
      resolvedIps: await resolveA(pending[0] ?? site.fqdn),
      message: `Add A records pointing ${pending.join(', ')} to ${serverIp} — every alias shares the site's certificate.`,
    };
  }

  // DNS verified -- issue cert and configure vhost
  site.dnsVerified = true;

  try {
    logger.info({ fqdn: site.fqdn, aliases }, 'DNS verified, issuing certificate');
    await certbot.issueSiteCert(site.fqdn, aliases, email);
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
