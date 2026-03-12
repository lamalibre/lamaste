import { z } from 'zod';
import crypto from 'node:crypto';
import { getConfig } from '../../lib/config.js';
import { readTunnels, writeTunnels } from '../../lib/state.js';
import { writeAppVhost, removeAppVhost, enableAppVhost, disableAppVhost } from '../../lib/nginx.js';
import { updateChiselConfig } from '../../lib/chisel.js';
import { issueTunnelCert } from '../../lib/certbot.js';
import { generatePlist } from '../../lib/plist.js';

const RESERVED_SUBDOMAINS = ['panel', 'auth', 'tunnel', 'www', 'mail', 'ftp', 'api'];

const IdParamSchema = z.object({ id: z.string().uuid() });

const CreateTunnelSchema = z.object({
  subdomain: z
    .string()
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
      'Subdomain must be lowercase alphanumeric with optional hyphens, cannot start or end with a hyphen',
    )
    .max(63, 'Subdomain must be at most 63 characters'),
  port: z
    .number()
    .int('Port must be an integer')
    .min(1024, 'Port must be at least 1024')
    .max(65535, 'Port must be at most 65535'),
  description: z
    .string()
    .max(200, 'Description must be at most 200 characters')
    .optional()
    .default(''),
});

export default async function tunnelRoutes(fastify, _opts) {
  // GET /api/tunnels/mac-plist — must be registered BEFORE /:id
  fastify.get('/tunnels/mac-plist', {
    preHandler: fastify.requireRole(['admin', 'agent']),
  }, async (request, reply) => {
    try {
      const config = getConfig();
      const tunnels = await readTunnels();

      if (!config.domain) {
        return reply.code(400).send({ error: 'Domain not configured' });
      }

      // Only include enabled tunnels in the plist
      const enabledTunnels = tunnels.filter((t) => t.enabled !== false);
      const format = request.query.format;

      if (format === 'json') {
        const plist = generatePlist(enabledTunnels, config.domain);
        return {
          plist,
          instructions: {
            download: 'Save the plist file to ~/Library/LaunchAgents/',
            install: 'launchctl load ~/Library/LaunchAgents/com.portlama.chisel.plist',
            uninstall: 'launchctl unload ~/Library/LaunchAgents/com.portlama.chisel.plist',
            logs: 'tail -f /usr/local/var/log/chisel.log',
            status: 'launchctl list | grep chisel',
            prerequisite:
              'Install Chisel on your Mac: brew install chisel (or download from https://github.com/jpillora/chisel/releases)',
          },
        };
      }

      const plist = generatePlist(enabledTunnels, config.domain);
      return reply
        .type('application/x-plist')
        .header('Content-Disposition', 'attachment; filename="com.portlama.chisel.plist"')
        .send(plist);
    } catch (err) {
      request.log.error(err, 'Failed to generate Mac plist');
      return reply.code(500).send({ error: 'Failed to generate Mac plist', details: err.message });
    }
  });

  // GET /api/tunnels
  fastify.get('/tunnels', {
    preHandler: fastify.requireRole(['admin', 'agent']),
  }, async (_request, _reply) => {
    const tunnels = await readTunnels();
    // Sort by createdAt descending (newest first)
    tunnels.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { tunnels };
  });

  // POST /api/tunnels
  fastify.post('/tunnels', {
    preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'tunnels:write' }),
  }, async (request, reply) => {
    const body = CreateTunnelSchema.parse(request.body);
    const { subdomain, port, description } = body;

    // Reserved subdomain check
    if (RESERVED_SUBDOMAINS.includes(subdomain)) {
      return reply.code(400).send({ error: `Subdomain '${subdomain}' is reserved` });
    }

    // Uniqueness check
    const existing = await readTunnels();
    if (existing.find((t) => t.subdomain === subdomain)) {
      return reply.code(400).send({ error: `Subdomain '${subdomain}' is already in use` });
    }

    // Port uniqueness check
    if (existing.find((t) => t.port === port)) {
      return reply.code(400).send({ error: `Port ${port} is already in use by another tunnel` });
    }

    const config = getConfig();
    if (!config.domain || !config.email) {
      return reply.code(400).send({
        error: 'Domain and email must be configured before creating tunnels',
      });
    }

    const fqdn = `${subdomain}.${config.domain}`;
    let certResult = null;

    try {
      // Step 1: Issue TLS certificate
      request.log.info({ fqdn }, 'Issuing TLS certificate');
      certResult = await issueTunnelCert(fqdn, config.email);
      request.log.info({ fqdn, skipped: certResult.skipped }, 'Certificate ready');
    } catch (err) {
      request.log.error(err, 'Failed to issue TLS certificate');
      return reply.code(500).send({
        error: 'Failed to create tunnel',
        details: `Certificate issuance failed: ${err.message}`,
      });
    }

    try {
      // Step 2: Write nginx vhost
      request.log.info({ fqdn, port }, 'Writing nginx vhost');
      const certPath = certResult.certPath || undefined;
      await writeAppVhost(subdomain, config.domain, port, certPath);
      request.log.info({ fqdn }, 'Nginx vhost configured');
    } catch (err) {
      request.log.error(err, 'Failed to write nginx vhost');
      // Cert can stay (harmless) — no rollback needed for step 1
      return reply.code(500).send({
        error: 'Failed to create tunnel',
        details: `Nginx configuration failed: ${err.message}`,
      });
    }

    try {
      // Step 3: Update Chisel config (only enabled tunnels)
      request.log.info({ port }, 'Updating Chisel configuration');
      const allTunnels = [...existing, { port, enabled: true }];
      const enabledForChisel = allTunnels.filter((t) => t.enabled !== false);
      await updateChiselConfig(enabledForChisel);
      request.log.info('Chisel configuration updated');
    } catch (err) {
      request.log.error(err, 'Failed to update Chisel config');
      // Rollback step 2: remove nginx vhost
      try {
        await removeAppVhost(subdomain);
      } catch (rollbackErr) {
        request.log.error(rollbackErr, 'Rollback: failed to remove nginx vhost');
      }
      return reply.code(500).send({
        error: 'Failed to create tunnel',
        details: `Chisel reconfiguration failed: ${err.message}`,
      });
    }

    // Step 4: Save to state
    const tunnel = {
      id: crypto.randomUUID(),
      subdomain,
      fqdn,
      port,
      description: description || null,
      enabled: true,
      createdAt: new Date().toISOString(),
    };

    try {
      const tunnels = await readTunnels();
      tunnels.push(tunnel);
      await writeTunnels(tunnels);
    } catch (err) {
      request.log.error(err, 'Failed to save tunnel state');
      // Rollback step 2: remove nginx vhost
      try {
        await removeAppVhost(subdomain);
      } catch (rollbackErr) {
        request.log.error(rollbackErr, 'Rollback: failed to remove nginx vhost');
      }
      return reply.code(500).send({
        error: 'Failed to create tunnel',
        details: `State persistence failed: ${err.message}`,
      });
    }

    return reply.code(201).send({ ok: true, tunnel });
  });

  // PATCH /api/tunnels/:id — toggle enabled/disabled
  fastify.patch('/tunnels/:id', {
    preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'tunnels:write' }),
  }, async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const body = z.object({ enabled: z.boolean() }).parse(request.body);

    const tunnels = await readTunnels();
    const tunnel = tunnels.find((t) => t.id === id);

    if (!tunnel) {
      return reply.code(404).send({ error: 'Tunnel not found' });
    }

    const wasEnabled = tunnel.enabled !== false; // default true for legacy tunnels
    tunnel.enabled = body.enabled;

    try {
      if (body.enabled && !wasEnabled) {
        // Re-enable: restore nginx vhost + add to chisel
        request.log.info({ subdomain: tunnel.subdomain }, 'Enabling tunnel');
        await enableAppVhost(tunnel.subdomain);
      } else if (!body.enabled && wasEnabled) {
        // Disable: remove nginx symlink (keep config file) + remove from chisel
        request.log.info({ subdomain: tunnel.subdomain }, 'Disabling tunnel');
        await disableAppVhost(tunnel.subdomain);
      }

      // Update chisel with only enabled tunnels
      const enabledTunnels = tunnels.filter((t) => t.enabled !== false);
      await updateChiselConfig(enabledTunnels);

      // Save state
      await writeTunnels(tunnels);
    } catch (err) {
      request.log.error(err, 'Failed to toggle tunnel');
      return reply.code(500).send({
        error: 'Failed to toggle tunnel',
        details: err.message,
      });
    }

    return { ok: true, tunnel };
  });

  // DELETE /api/tunnels/:id
  fastify.delete('/tunnels/:id', {
    preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'tunnels:write' }),
  }, async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);

    const tunnels = await readTunnels();
    const index = tunnels.findIndex((t) => t.id === id);

    if (index === -1) {
      return reply.code(404).send({ error: 'Tunnel not found' });
    }

    const tunnel = tunnels[index];

    try {
      // Step 1: Remove nginx vhost
      request.log.info({ subdomain: tunnel.subdomain }, 'Removing nginx vhost');
      await removeAppVhost(tunnel.subdomain);

      // Step 2: Update Chisel config (with remaining enabled tunnels)
      const remaining = tunnels.filter((_, i) => i !== index);
      const enabledRemaining = remaining.filter((t) => t.enabled !== false);
      request.log.info('Updating Chisel configuration');
      await updateChiselConfig(enabledRemaining);

      // Step 3: Remove from state
      await writeTunnels(remaining);
    } catch (err) {
      request.log.error(err, 'Failed to delete tunnel');
      return reply.code(500).send({
        error: 'Failed to delete tunnel',
        details: err.message,
      });
    }

    return { ok: true };
  });
}
