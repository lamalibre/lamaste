import { z } from 'zod';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { getConfig } from '../../lib/config.js';
import { readSites, writeSites } from '../../lib/state.js';
import { readTunnels } from '../../lib/state.js';
import { writeStaticSiteVhost, removeStaticSiteVhost } from '../../lib/nginx.js';
import { updateAccessControl } from '../../lib/authelia.js';
import { issueTunnelCert, getCertPath } from '../../lib/certbot.js';
import {
  createSiteDirectory,
  removeSiteDirectory,
  listFiles,
  saveUploadedFile,
  deleteFile,
  getSiteSize,
  validatePath,
  getSiteRoot,
} from '../../lib/files.js';

const RESERVED_SUBDOMAINS = ['panel', 'auth', 'tunnel', 'www', 'mail', 'ftp', 'api'];

const IdParamSchema = z.object({ id: z.string().uuid() });

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
  spaMode: z.boolean().optional().default(false),
  autheliaProtected: z.boolean().optional().default(false),
});

const UpdateSiteSchema = z.object({
  spaMode: z.boolean().optional(),
  autheliaProtected: z.boolean().optional(),
  allowedUsers: z.array(z.string().min(1)).optional(),
});

const DeleteFileSchema = z.object({
  path: z.string().min(1, 'Path is required'),
});

/**
 * Resolve A records for a hostname, returning an empty array on expected DNS errors.
 */
async function resolveA(hostname) {
  try {
    return await dns.resolve4(hostname);
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA' || err.code === 'ETIMEOUT') {
      return [];
    }
    throw err;
  }
}

export default async function sitesRoutes(fastify, _opts) {
  // GET /api/sites
  fastify.get('/sites', {
    preHandler: fastify.requireRole(['admin']),
  }, async (_request, _reply) => {
    const sites = await readSites();
    sites.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { sites };
  });

  // POST /api/sites
  fastify.post('/sites', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
    const body = CreateSiteSchema.parse(request.body);
    const { name, type, customDomain, spaMode, autheliaProtected } = body;

    const config = getConfig();
    if (!config.domain || !config.email) {
      return reply.code(400).send({
        error: 'Domain and email must be configured before creating sites',
      });
    }

    // For custom domains, customDomain is required
    if (type === 'custom' && !customDomain) {
      return reply.code(400).send({ error: 'Custom domain is required for custom type sites' });
    }

    // Check name uniqueness against existing sites
    const existingSites = await readSites();
    if (existingSites.find((s) => s.name === name)) {
      return reply.code(400).send({ error: `Site name '${name}' is already in use` });
    }

    // Check against reserved subdomains (for managed type)
    if (type === 'managed' && RESERVED_SUBDOMAINS.includes(name)) {
      return reply.code(400).send({ error: `Name '${name}' is reserved` });
    }

    // Check against existing tunnels (no collision with tunnel subdomains)
    const tunnels = await readTunnels();
    if (type === 'managed' && tunnels.find((t) => t.subdomain === name)) {
      return reply.code(400).send({
        error: `Name '${name}' is already in use by a tunnel`,
      });
    }

    const fqdn = type === 'managed' ? `${name}.${config.domain}` : customDomain;

    // Check FQDN uniqueness across sites
    if (existingSites.find((s) => s.fqdn === fqdn)) {
      return reply.code(400).send({ error: `Domain '${fqdn}' is already in use by another site` });
    }

    // Check FQDN uniqueness across tunnels (for all site types)
    if (tunnels.find((t) => `${t.subdomain}.${config.domain}` === fqdn)) {
      return reply.code(400).send({ error: `Domain '${fqdn}' is already in use by a tunnel` });
    }

    const id = crypto.randomUUID();
    const rootPath = getSiteRoot(id);

    const site = {
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
      // Managed subdomain: cert + vhost + directory in one go
      let certResult;
      try {
        request.log.info({ fqdn }, 'Issuing TLS certificate for static site');
        certResult = await issueTunnelCert(fqdn, config.email);
        site.certIssued = true;
        request.log.info({ fqdn, skipped: certResult.skipped }, 'Certificate ready');
      } catch (err) {
        request.log.error(err, 'Failed to issue TLS certificate for static site');
        return reply.code(500).send({
          error: 'Failed to create site',
          details: `Certificate issuance failed: ${err.message}`,
        });
      }

      try {
        request.log.info({ fqdn }, 'Writing nginx vhost for static site');
        const certDir = certResult.certPath || await getCertPath(fqdn, config.domain);
        await writeStaticSiteVhost(site, certDir, config.domain);
        request.log.info({ fqdn }, 'Nginx vhost configured');
      } catch (err) {
        request.log.error(err, 'Failed to write nginx vhost for static site');
        return reply.code(500).send({
          error: 'Failed to create site',
          details: `Nginx configuration failed: ${err.message}`,
        });
      }

      try {
        await createSiteDirectory(id, name);
      } catch (err) {
        request.log.error(err, 'Failed to create site directory');
        try { await removeStaticSiteVhost(id); } catch (rollbackErr) {
          request.log.error(rollbackErr, 'Rollback: failed to remove nginx vhost');
        }
        return reply.code(500).send({
          error: 'Failed to create site',
          details: `Directory creation failed: ${err.message}`,
        });
      }

      try {
        existingSites.push(site);
        await writeSites(existingSites);
      } catch (err) {
        request.log.error(err, 'Failed to save site state');
        try { await removeStaticSiteVhost(id); } catch (e) { request.log.error(e); }
        try { await removeSiteDirectory(id); } catch (e) { request.log.error(e); }
        return reply.code(500).send({
          error: 'Failed to create site',
          details: `State persistence failed: ${err.message}`,
        });
      }

      return reply.code(201).send({ ok: true, site });
    }

    // Custom domain: save with pending DNS, create directory for uploads
    try {
      await createSiteDirectory(id, name);
    } catch (err) {
      request.log.error(err, 'Failed to create site directory');
      return reply.code(500).send({
        error: 'Failed to create site',
        details: `Directory creation failed: ${err.message}`,
      });
    }

    try {
      existingSites.push(site);
      await writeSites(existingSites);
    } catch (err) {
      request.log.error(err, 'Failed to save site state');
      try { await removeSiteDirectory(id); } catch (e) { request.log.error(e); }
      return reply.code(500).send({
        error: 'Failed to create site',
        details: `State persistence failed: ${err.message}`,
      });
    }

    return reply.code(201).send({
      ok: true,
      site,
      message: 'Site created. Add an A record for your domain, then verify DNS.',
    });
  });

  // DELETE /api/sites/:id
  fastify.delete('/sites/:id', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);

    const sites = await readSites();
    const index = sites.findIndex((s) => s.id === id);

    if (index === -1) {
      return reply.code(404).send({ error: 'Site not found' });
    }

    const site = sites[index];

    try {
      // Step 1: Remove nginx vhost (only if cert was issued / vhost exists)
      if (site.certIssued) {
        request.log.info({ fqdn: site.fqdn }, 'Removing nginx vhost for static site');
        await removeStaticSiteVhost(site.id);
      }

      // Step 2: Remove site directory
      request.log.info({ id: site.id }, 'Removing site directory');
      await removeSiteDirectory(site.id);

      // Step 3: Remove from state
      const remaining = sites.filter((_, i) => i !== index);
      await writeSites(remaining);
    } catch (err) {
      request.log.error(err, 'Failed to delete site');
      return reply.code(500).send({
        error: 'Failed to delete site',
        details: err.message,
      });
    }

    return { ok: true };
  });

  // PATCH /api/sites/:id — update site settings (spaMode, autheliaProtected, allowedUsers)
  fastify.patch('/sites/:id', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const body = UpdateSiteSchema.parse(request.body);

    const sites = await readSites();
    const siteIndex = sites.findIndex((s) => s.id === id);

    if (siteIndex === -1) {
      return reply.code(404).send({ error: 'Site not found' });
    }

    const site = sites[siteIndex];

    // Compute new values
    const newSpaMode = body.spaMode !== undefined ? body.spaMode : site.spaMode;
    const newAutheliaProtected = body.autheliaProtected !== undefined ? body.autheliaProtected : site.autheliaProtected;
    const newAllowedUsers = body.allowedUsers !== undefined ? body.allowedUsers : (site.allowedUsers || []);

    const spaModeChanged = newSpaMode !== site.spaMode;
    const autheliaChanged = newAutheliaProtected !== site.autheliaProtected;
    const usersChanged = JSON.stringify(newAllowedUsers) !== JSON.stringify(site.allowedUsers || []);

    if (!spaModeChanged && !autheliaChanged && !usersChanged) {
      return { ok: true, site, message: 'No changes' };
    }

    // Update site fields
    site.spaMode = newSpaMode;
    site.autheliaProtected = newAutheliaProtected;
    site.allowedUsers = newAllowedUsers;

    // Regenerate nginx vhost if the site is live and nginx-affecting settings changed
    if (site.certIssued && (spaModeChanged || autheliaChanged)) {
      try {
        const config = getConfig();
        const certDir = site.type === 'managed'
          ? await getCertPath(site.fqdn, config.domain)
          : `/etc/letsencrypt/live/${site.fqdn}/`;
        await writeStaticSiteVhost(site, certDir, config.domain);
        request.log.info({ fqdn: site.fqdn, spaMode: site.spaMode, autheliaProtected: site.autheliaProtected }, 'Nginx vhost updated');
      } catch (err) {
        request.log.error(err, 'Failed to update nginx vhost');
        return reply.code(500).send({
          error: 'Failed to update site configuration',
          details: `Nginx configuration failed: ${err.message}`,
        });
      }
    }

    // Persist state first
    sites[siteIndex] = site;
    await writeSites(sites);

    // Sync Authelia access_control if auth settings or user assignments changed
    if (autheliaChanged || usersChanged) {
      try {
        await updateAccessControl(sites);
        request.log.info('Authelia access control updated');
      } catch (err) {
        request.log.error(err, 'Failed to update Authelia access control');
        return reply.code(500).send({
          error: 'Site saved but Authelia configuration failed',
          details: err.message,
        });
      }
    }

    return { ok: true, site };
  });

  // POST /api/sites/:id/verify-dns
  fastify.post('/sites/:id/verify-dns', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const config = getConfig();

    const sites = await readSites();
    const site = sites.find((s) => s.id === id);

    if (!site) {
      return reply.code(404).send({ error: 'Site not found' });
    }

    if (site.type !== 'custom') {
      return reply.code(400).send({ error: 'DNS verification is only needed for custom domains' });
    }

    if (site.dnsVerified && site.certIssued) {
      return { ok: true, message: 'DNS already verified and certificate issued' };
    }

    // Resolve DNS
    const resolvedIps = await resolveA(site.fqdn);
    const expectedIp = config.ip;
    const dnsOk = resolvedIps.includes(expectedIp);

    if (!dnsOk) {
      return {
        ok: false,
        fqdn: site.fqdn,
        expectedIp,
        resolvedIps,
        message: resolvedIps.length > 0
          ? `Domain resolves to ${resolvedIps.join(', ')} but your server IP is ${expectedIp}. Please update your A record.`
          : `Domain does not resolve yet. Please add an A record pointing ${site.fqdn} to ${expectedIp}.`,
      };
    }

    // DNS verified — issue cert and configure vhost
    site.dnsVerified = true;

    try {
      request.log.info({ fqdn: site.fqdn }, 'DNS verified, issuing certificate');
      await issueTunnelCert(site.fqdn, config.email);
      site.certIssued = true;
    } catch (err) {
      request.log.error(err, 'Failed to issue certificate for custom domain');
      return reply.code(500).send({
        error: 'DNS verified but certificate issuance failed',
        details: err.message,
      });
    }

    try {
      const certDir = `/etc/letsencrypt/live/${site.fqdn}/`;
      await writeStaticSiteVhost(site, certDir, config.domain);
    } catch (err) {
      request.log.error(err, 'Failed to write nginx vhost for custom domain');
      return reply.code(500).send({
        error: 'Certificate issued but nginx configuration failed',
        details: err.message,
      });
    }

    // Update state
    const siteIndex = sites.findIndex((s) => s.id === id);
    sites[siteIndex] = site;
    await writeSites(sites);

    return {
      ok: true,
      message: 'DNS verified, certificate issued, and site is now live.',
    };
  });

  // GET /api/sites/:id/files
  fastify.get('/sites/:id/files', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const relativePath = request.query.path || '.';

    const sites = await readSites();
    const site = sites.find((s) => s.id === id);
    if (!site) {
      return reply.code(404).send({ error: 'Site not found' });
    }

    try {
      const files = await listFiles(id, relativePath);
      return { files, path: relativePath };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // POST /api/sites/:id/files — multipart file upload
  fastify.post('/sites/:id/files', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const config = getConfig();

    const sites = await readSites();
    const site = sites.find((s) => s.id === id);
    if (!site) {
      return reply.code(404).send({ error: 'Site not found' });
    }

    const uploadDir = request.query.path || '.';
    const uploadedFiles = [];

    try {
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type !== 'file' || !part.filename) {
          continue;
        }

        const relativePath = uploadDir === '.'
          ? part.filename
          : `${uploadDir}/${part.filename}`;

        // Validate path before saving
        validatePath(relativePath);

        await saveUploadedFile(id, relativePath, part.file);
        uploadedFiles.push(relativePath);
      }
    } catch (err) {
      return reply.code(400).send({ error: `Upload failed: ${err.message}` });
    }

    // Update site size
    try {
      const totalSize = await getSiteSize(id);
      const siteIndex = sites.findIndex((s) => s.id === id);
      sites[siteIndex].totalSize = totalSize;

      if (totalSize > config.maxSiteSize) {
        // Don't block but warn
        await writeSites(sites);
        return reply.code(200).send({
          ok: true,
          files: uploadedFiles,
          warning: `Site size (${formatBytes(totalSize)}) exceeds the ${formatBytes(config.maxSiteSize)} limit.`,
          totalSize,
        });
      }

      await writeSites(sites);
    } catch {
      // Non-critical — don't fail the upload
    }

    return { ok: true, files: uploadedFiles };
  });

  // DELETE /api/sites/:id/files
  fastify.delete('/sites/:id/files', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);

    const sites = await readSites();
    const site = sites.find((s) => s.id === id);
    if (!site) {
      return reply.code(404).send({ error: 'Site not found' });
    }

    const body = DeleteFileSchema.parse(request.body);

    try {
      await deleteFile(id, body.path);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }

    // Update site size
    try {
      const totalSize = await getSiteSize(id);
      const siteIndex = sites.findIndex((s) => s.id === id);
      sites[siteIndex].totalSize = totalSize;
      await writeSites(sites);
    } catch {
      // Non-critical
    }

    return { ok: true };
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
