/**
 * Static site management routes.
 *
 * Create/delete/update/verifyDns delegate to @lamalibre/lamaste/server core functions.
 * File management endpoints (list, upload, delete) and HTTP-specific auth checks remain here.
 */
import { z } from 'zod';
import {
  createSite,
  deleteSite,
  updateSite,
  verifyDns,
  SiteError,
  withTunnelLock,
} from '@lamalibre/lamaste/server';
import { DomainNameSchema } from '@lamalibre/lamaste';
import { AppError } from '../../lib/app-error.js';
import { webSurfaceServing } from '../../lib/web-surface.js';
import { getConfig } from '../../lib/config.js';
import { readSites, writeSites, readTunnels, withSitesLock } from '../../lib/state.js';
import { writeStaticSiteVhost, removeStaticSiteVhost } from '../../lib/nginx.js';
import {
  activeDomainNames,
  domainNames,
  resolveActiveDomain,
  syncDomainAccess,
} from '../../lib/domains.js';
import { issueTunnelCert, getCertPath, issueSiteCert } from '../../lib/certbot.js';
import {
  createSiteDirectory,
  removeSiteDirectory,
  listFiles,
  saveUploadedFile,
  deleteFile,
  getSiteSize,
  validatePath,
  validateFileExtension,
  getSiteRoot,
} from '../../lib/files.js';

const IdParamSchema = z.object({ id: z.string().uuid() });

const AliasSchema = z
  .string()
  .max(253, 'Alias must be at most 253 characters')
  .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/, 'Invalid alias hostname');

const CreateSiteSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be at most 100 characters')
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
      'Name must be lowercase alphanumeric with optional hyphens, cannot start or end with a hyphen',
    ),
  type: z.enum(['managed', 'custom']),
  customDomain: z
    .string()
    .max(253, 'Domain must be at most 253 characters')
    .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/, 'Invalid domain format')
    .optional(),
  aliases: z.array(AliasSchema).max(10, 'At most 10 aliases').optional(),
  spaMode: z.boolean().optional().default(false),
  autheliaProtected: z.boolean().optional().default(false),
  /** A managed site's domain (an active one; the primary when absent). */
  domain: DomainNameSchema.optional(),
});

const UpdateSiteSchema = z.object({
  spaMode: z.boolean().optional(),
  autheliaProtected: z.boolean().optional(),
  allowedUsers: z.array(z.string().min(1)).optional(),
  aliases: z.array(AliasSchema).max(10, 'At most 10 aliases').optional(),
});

const DeleteFileSchema = z.object({
  path: z.string().min(1, 'Path is required'),
});

const PathQuerySchema = z.object({
  path: z.string().max(500).optional().default('.'),
});

// `z.coerce.number()` lets browser query strings pass `?limit=50` without
// requiring callers to JSON-encode their numeric params.
const ListSitesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sort: z.enum(['createdAt', 'name']).optional().default('createdAt'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

// ---------------------------------------------------------------------------
// Dependency adapters for core functions
// ---------------------------------------------------------------------------

function buildNginxDeps() {
  return { writeStaticSiteVhost, removeStaticSiteVhost };
}

function buildCertbotDeps() {
  return { issueTunnelCert, getCertPath, issueSiteCert };
}

function buildFilesDeps() {
  return { createSiteDirectory, removeSiteDirectory, getSiteRoot };
}

function buildSiteStateDeps() {
  return { readSites, writeSites };
}

function buildTunnelReadDeps() {
  return { readTunnels };
}

/**
 * Authelia renders every site's protection together with the domains'
 * members (lib/domains.js) — given the sites being saved.
 */
function buildAutheliaDeps(logger) {
  return {
    renderAccess: async (sites) => {
      await syncDomainAccess({ logger, sites });
    },
  };
}

/**
 * The active domain a managed site is put on (the primary unless named), as
 * a SiteError the create route answers like its other refusals.
 *
 * @param {string | undefined} requested
 */
async function siteDomain(requested) {
  try {
    return await resolveActiveDomain(requested);
  } catch (err) {
    if (Number.isInteger(err.statusCode)) throw new SiteError(err.message, 'DOMAIN_NOT_CONFIGURED');
    throw err;
  }
}

/**
 * Map a SiteError code to an HTTP status code.
 */
function siteErrorStatus(code) {
  switch (code) {
    case 'CUSTOM_DOMAIN_REQUIRED':
    case 'NAME_IN_USE':
    case 'RESERVED_NAME':
    case 'FQDN_IN_USE':
    case 'FQDN_TUNNEL_COLLISION':
    case 'NOT_CUSTOM':
    case 'DOMAIN_NOT_CONFIGURED':
    case 'INVALID_ALIAS':
    case 'ALIAS_IN_USE':
    case 'DNS_MISMATCH':
    case 'NOT_UNDER_DOMAIN':
      return 400;
    case 'NOT_FOUND':
      return 404;
    case 'ALREADY_VERIFIED':
      return 200;
    default:
      return 500;
  }
}

/**
 * Run a site workflow that may give a site a hostname: under core's tunnel
 * lock, then the sites lock — the order every such workflow takes them in
 * (`withSitesLock`) — so no tunnel takes the name meanwhile.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withHostnameLocks(fn) {
  return withTunnelLock(() => withSitesLock(fn));
}

/**
 * Refuse (409) a site a plugin owns: its files are the plugin's approved
 * web tree and its settings follow the plugin — it is managed through the
 * plugin's web surface, never here (and never by `lamaste-agent deploy`).
 */
function assertNotPluginOwned(site) {
  if (site?.owner) {
    throw new AppError(
      `Site '${site.name}' is the web surface of plugin '${site.owner.plugin}' — manage it through the plugin`,
      409,
      { code: 'plugin_owned_site' },
    );
  }
}

/** The site `id`, refused when a plugin owns it; null when there is none. */
async function siteForManagement(id) {
  const site = (await readSites()).find((s) => s.id === id) ?? null;
  assertNotPluginOwned(site);
  return site;
}

/**
 * Record the size of site `id` on disk in sites.json, re-reading the file
 * under the sites lock — never a copy read before an upload, which would
 * undo every change made meanwhile.
 *
 * @returns {Promise<number>} the size
 */
async function recordSiteSize(id) {
  const totalSize = await getSiteSize(id);
  await withSitesLock(async () => {
    const sites = await readSites();
    const site = sites.find((s) => s.id === id);
    if (!site) return;
    site.totalSize = totalSize;
    await writeSites(sites);
  });
  return totalSize;
}

/**
 * Sites as listed: a plugin-owned one with `webSurface: { served, reason }`
 * — whether it serves its plugin's shell and API now, or answers 503 and why.
 */
async function withWebSurfaceState(sites) {
  if (!sites.some((site) => site.owner)) return sites;
  const tunnels = await readTunnels();
  return Promise.all(
    sites.map(async (site) => {
      if (!site.owner) return site;
      const serving = await webSurfaceServing(site.owner.plugin, tunnels);
      return {
        ...site,
        webSurface: { served: serving.served, reason: serving.served ? null : serving.reason },
      };
    }),
  );
}

function assertAgentSiteAccess(request, site) {
  if (request.certRole === 'agent') {
    const allowed = request.certAllowedSites || [];
    if (!allowed.includes(site.name)) {
      const err = new Error('You do not have access to this site');
      err.statusCode = 403;
      throw err;
    }
  }
}

export default async function sitesRoutes(fastify, _opts) {
  const nginxDeps = buildNginxDeps();
  const certbotDeps = buildCertbotDeps();
  const filesDeps = buildFilesDeps();
  const siteStateDeps = buildSiteStateDeps();
  const tunnelReadDeps = buildTunnelReadDeps();

  // GET /api/sites
  //
  // Paginated. Defaults (limit=100, offset=0, sort=createdAt desc) preserve
  // the prior unpaginated UX for installations under 100 sites. The
  // `sites` array stays the response envelope's primary field; older
  // clients that ignore `total`/`limit`/`offset` continue to function and
  // simply see the first window.
  //
  // Agent-side filtering happens BEFORE windowing so the `total` an agent
  // sees reflects the agent's visible set, not the global count.
  fastify.get(
    '/sites',
    {
      preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'sites:read' }),
    },
    async (request, _reply) => {
      const { limit, offset, sort, order } = ListSitesQuerySchema.parse(request.query);
      let sites = await readSites();

      const direction = order === 'asc' ? 1 : -1;
      sites.sort((a, b) => {
        if (sort === 'name') {
          const av = String(a.name ?? '');
          const bv = String(b.name ?? '');
          return av < bv ? -direction : av > bv ? direction : 0;
        }
        const at = new Date(a.createdAt ?? 0).getTime();
        const bt = new Date(b.createdAt ?? 0).getTime();
        return (at - bt) * direction;
      });

      // Agents only see their allowed sites
      if (request.certRole === 'agent') {
        const allowed = request.certAllowedSites || [];
        sites = sites.filter((s) => allowed.includes(s.name));
      }

      const total = sites.length;
      const windowed = await withWebSurfaceState(sites.slice(offset, offset + limit));

      return { sites: windowed, total, limit, offset };
    },
  );

  // POST /api/sites
  fastify.post(
    '/sites',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const body = CreateSiteSchema.parse(request.body);
      const config = getConfig();

      if (!config.domain || !config.email) {
        return reply.code(400).send({
          error: 'Domain and email must be configured before creating sites',
        });
      }
      if (body.domain !== undefined && body.type !== 'managed') {
        return reply.code(400).send({
          error: "A custom site's hostname names its domain — `domain` is for managed sites",
        });
      }
      try {
        // The domain is resolved under the hostname locks — those a domain's
        // removal takes — so the site never lands on a removed domain.
        const result = await withHostnameLocks(async () =>
          createSite({
            name: body.name,
            type: body.type,
            customDomain: body.customDomain,
            aliases: body.aliases,
            spaMode: body.spaMode,
            autheliaProtected: body.autheliaProtected,
            domain: await siteDomain(body.domain),
            domains: await activeDomainNames(),
            relayDomains: await domainNames(),
            email: config.email,
            nginx: nginxDeps,
            certbot: certbotDeps,
            files: filesDeps,
            siteState: siteStateDeps,
            tunnelState: tunnelReadDeps,
            logger: request.log,
          }),
        );

        const response = { ok: true, site: result.site };
        if (result.message) response.message = result.message;
        return reply.code(201).send(response);
      } catch (err) {
        if (err instanceof SiteError) {
          const status = siteErrorStatus(err.code);
          return reply.code(status).send({
            error: 'Failed to create site',
            details: err.message,
          });
        }
        request.log.error(err, 'Failed to create site');
        return reply.code(500).send({
          error: 'Failed to create site',
          details: err.message,
        });
      }
    },
  );

  // DELETE /api/sites/:id
  fastify.delete(
    '/sites/:id',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const { id } = IdParamSchema.parse(request.params);

      try {
        await withSitesLock(async () => {
          await siteForManagement(id);
          await deleteSite({
            id,
            nginx: nginxDeps,
            files: filesDeps,
            siteState: siteStateDeps,
            logger: request.log,
          });
        });
        return { ok: true };
      } catch (err) {
        if (err instanceof SiteError) {
          const status = siteErrorStatus(err.code);
          return reply.code(status).send({
            error: 'Failed to delete site',
            details: err.message,
          });
        }
        if (err instanceof AppError) throw err;
        request.log.error(err, 'Failed to delete site');
        return reply.code(500).send({
          error: 'Failed to delete site',
          details: err.message,
        });
      }
    },
  );

  // PATCH /api/sites/:id — update site settings (spaMode, autheliaProtected, allowedUsers, aliases)
  fastify.patch(
    '/sites/:id',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const { id } = IdParamSchema.parse(request.params);
      const body = UpdateSiteSchema.parse(request.body);
      const config = getConfig();

      try {
        const result = await withHostnameLocks(async () => {
          await siteForManagement(id);
          return updateSite({
            id,
            spaMode: body.spaMode,
            autheliaProtected: body.autheliaProtected,
            allowedUsers: body.allowedUsers,
            aliases: body.aliases,
            domains: await activeDomainNames(),
            relayDomains: await domainNames(),
            email: config.email,
            serverIp: config.ip,
            nginx: nginxDeps,
            certbot: certbotDeps,
            siteState: siteStateDeps,
            tunnelState: tunnelReadDeps,
            authelia: buildAutheliaDeps(request.log),
            logger: request.log,
          });
        });
        return result;
      } catch (err) {
        if (err instanceof SiteError) {
          const status = siteErrorStatus(err.code);
          // Special case: AUTHELIA_FAILED means state was saved but Authelia sync failed
          if (err.code === 'AUTHELIA_FAILED') {
            return reply.code(500).send({
              error: 'Site saved but Authelia configuration failed',
              details: err.message,
            });
          }
          return reply.code(status).send({
            error: 'Failed to update site configuration',
            details: err.message,
          });
        }
        if (err instanceof AppError) throw err;
        request.log.error(err, 'Failed to update site');
        return reply.code(500).send({
          error: 'Failed to update site configuration',
          details: err.message,
        });
      }
    },
  );

  // POST /api/sites/:id/verify-dns
  fastify.post(
    '/sites/:id/verify-dns',
    {
      preHandler: fastify.requireRole(['admin']),
      // Moderate tier — triggers DNS lookups and potentially certbot;
      // the work is amplified per request and must be bounded.
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { id } = IdParamSchema.parse(request.params);
      const config = getConfig();

      try {
        const result = await withHostnameLocks(async () => {
          await siteForManagement(id);
          return verifyDns({
            id,
            serverIp: config.ip,
            domains: await activeDomainNames(),
            email: config.email,
            nginx: nginxDeps,
            certbot: certbotDeps,
            siteState: siteStateDeps,
            logger: request.log,
          });
        });
        return result;
      } catch (err) {
        if (err instanceof SiteError) {
          const status = siteErrorStatus(err.code);
          return reply.code(status).send({
            error: err.message,
          });
        }
        if (err instanceof AppError) throw err;
        request.log.error(err, 'Failed to verify DNS');
        return reply.code(500).send({
          error: 'DNS verification failed',
          details: err.message,
        });
      }
    },
  );

  // GET /api/sites/:id/files
  fastify.get(
    '/sites/:id/files',
    {
      preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'sites:read' }),
    },
    async (request, reply) => {
      const { id } = IdParamSchema.parse(request.params);
      const { path: relativePath } = PathQuerySchema.parse(request.query);

      const site = await siteForManagement(id);
      if (!site) {
        return reply.code(404).send({ error: 'Site not found' });
      }

      assertAgentSiteAccess(request, site);

      try {
        const files = await listFiles(id, relativePath);
        return { files, path: relativePath };
      } catch (err) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  // POST /api/sites/:id/files — multipart file upload
  fastify.post(
    '/sites/:id/files',
    {
      preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'sites:write' }),
    },
    async (request, reply) => {
      const { id } = IdParamSchema.parse(request.params);
      const config = getConfig();

      const site = await siteForManagement(id);
      if (!site) {
        return reply.code(404).send({ error: 'Site not found' });
      }

      assertAgentSiteAccess(request, site);

      const { path: uploadDir } = PathQuerySchema.parse(request.query);
      const uploadedFiles = [];

      try {
        const parts = request.parts();
        for await (const part of parts) {
          if (part.type !== 'file' || !part.filename) {
            continue;
          }

          const relativePath = uploadDir === '.' ? part.filename : `${uploadDir}/${part.filename}`;

          // Validate path and file extension before saving
          validatePath(relativePath);
          validateFileExtension(part.filename);

          await saveUploadedFile(id, relativePath, part.file);
          uploadedFiles.push(relativePath);
        }
      } catch (err) {
        return reply.code(400).send({ error: `Upload failed: ${err.message}` });
      }

      // Update site size
      try {
        const totalSize = await recordSiteSize(id);
        if (totalSize > config.maxSiteSize) {
          // Don't block but warn
          return reply.code(200).send({
            ok: true,
            files: uploadedFiles,
            warning: `Site size (${formatBytes(totalSize)}) exceeds the ${formatBytes(config.maxSiteSize)} limit.`,
            totalSize,
          });
        }
      } catch {
        // Non-critical — don't fail the upload
      }

      return { ok: true, files: uploadedFiles };
    },
  );

  // DELETE /api/sites/:id/files
  fastify.delete(
    '/sites/:id/files',
    {
      preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'sites:write' }),
    },
    async (request, reply) => {
      const { id } = IdParamSchema.parse(request.params);

      const site = await siteForManagement(id);
      if (!site) {
        return reply.code(404).send({ error: 'Site not found' });
      }

      assertAgentSiteAccess(request, site);

      const body = DeleteFileSchema.parse(request.body);

      try {
        await deleteFile(id, body.path);
      } catch (err) {
        return reply.code(400).send({ error: err.message });
      }

      // Update site size
      try {
        await recordSiteSize(id);
      } catch {
        // Non-critical
      }

      return { ok: true };
    },
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
