import { z } from 'zod';
import crypto from 'node:crypto';
import { getConfig } from '../../lib/config.js';
import { readTunnels, writeTunnels } from '../../lib/state.js';
import {
  writeAppVhost,
  removeAppVhost,
  enableAppVhost,
  disableAppVhost,
  writeAgentPanelVhost,
  removeAgentPanelVhost,
  enableAgentPanelVhost,
  disableAgentPanelVhost,
} from '../../lib/nginx.js';
import { updateChiselConfig } from '../../lib/chisel.js';
import { issueTunnelCert } from '../../lib/certbot.js';
import { generatePlist } from '../../lib/plist.js';
import { buildChiselArgs } from '../../lib/chisel-args.js';
import { syncAllAccessControl } from '../../lib/access-control-sync.js';

// Note: the 'agent-' prefix is also reserved for panel tunnels (checked separately in the handler)
const RESERVED_SUBDOMAINS = ['panel', 'auth', 'tunnel', 'www', 'mail', 'ftp', 'api'];

const IdParamSchema = z.object({ id: z.string().uuid() });

const CreateTunnelSchema = z
  .object({
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
    type: z.enum(['app', 'panel', 'plugin']).optional().default('app'),
    pluginName: z
      .string()
      .min(1)
      .max(200)
      .regex(/^@lamalibre\/[a-z0-9][a-z0-9._-]*$/, 'Invalid plugin name — must be @lamalibre/ scoped with valid npm characters')
      .optional(),
    agentLabel: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'Invalid agent label format')
      .optional(),
  })
  .refine(
    (d) => d.type !== 'plugin' || (d.pluginName && d.agentLabel),
    { message: 'pluginName and agentLabel are required for plugin tunnels' },
  );

const ExposePanelSchema = z.object({
  port: z
    .number()
    .int('Port must be an integer')
    .min(1024, 'Port must be at least 1024')
    .max(65535, 'Port must be at most 65535'),
});

export default async function tunnelRoutes(fastify, _opts) {
  // GET /api/tunnels/agent-config — must be registered BEFORE /:id
  fastify.get(
    '/tunnels/agent-config',
    {
      preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'tunnels:read' }),
    },
    async (request, reply) => {
      try {
        const config = getConfig();
        const tunnels = await readTunnels();

        if (!config.domain) {
          return reply.code(400).send({ error: 'Domain not configured' });
        }

        const enabledTunnels = tunnels.filter((t) => t.enabled !== false);
        const chiselArgs = buildChiselArgs(enabledTunnels, config.domain);

        return {
          domain: config.domain,
          chiselServerUrl: `https://tunnel.${config.domain}:443`,
          chiselArgs,
          tunnels: enabledTunnels.map((t) => ({
            port: t.port,
            subdomain: t.subdomain,
          })),
        };
      } catch (err) {
        request.log.error(err, 'Failed to generate agent config');
        return reply
          .code(500)
          .send({ error: 'Failed to generate agent config' });
      }
    },
  );

  // GET /api/tunnels/mac-plist — must be registered BEFORE /:id
  fastify.get(
    '/tunnels/mac-plist',
    {
      preHandler: fastify.requireRole(['admin', 'agent']),
    },
    async (request, reply) => {
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
        return reply
          .code(500)
          .send({ error: 'Failed to generate Mac plist', details: err.message });
      }
    },
  );

  // GET /api/tunnels
  fastify.get(
    '/tunnels',
    {
      preHandler: fastify.requireRole(['admin', 'agent']),
    },
    async (_request, _reply) => {
      const tunnels = await readTunnels();
      // Sort by createdAt descending (newest first)
      tunnels.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return { tunnels };
    },
  );

  // POST /api/tunnels
  fastify.post(
    '/tunnels',
    {
      preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'tunnels:write' }),
    },
    async (request, reply) => {
      const body = CreateTunnelSchema.parse(request.body);
      const { subdomain, port, description, type, pluginName, agentLabel } = body;

      // Reserved subdomain check
      if (RESERVED_SUBDOMAINS.includes(subdomain)) {
        return reply.code(400).send({ error: `Subdomain '${subdomain}' is reserved` });
      }

      // Reserve agent- prefix for panel tunnels only
      if (subdomain.startsWith('agent-') && type !== 'panel') {
        return reply.code(400).send({ error: "Subdomain prefix 'agent-' is reserved for agent panel tunnels" });
      }

      // Plugin tunnels are admin-only (they grant browser access to non-admin users)
      if (type === 'plugin') {
        if (request.certRole !== 'admin') {
          return reply.code(403).send({ error: 'Plugin tunnels can only be created by administrators' });
        }
      }

      // Panel tunnels require panel:expose capability and must match the requesting agent's label
      if (type === 'panel') {
        const caps = request.certCapabilities || [];
        if (request.certRole !== 'admin' && !caps.includes('panel:expose')) {
          return reply.code(403).send({ error: 'Agent does not have panel:expose capability' });
        }
        // Prevent cross-agent spoofing: agents can only create panel tunnels for themselves
        if (request.certRole === 'agent' && request.certLabel) {
          const expectedSubdomain = `agent-${request.certLabel}`;
          if (subdomain !== expectedSubdomain) {
            return reply.code(403).send({ error: 'Agents can only create panel tunnels for their own label' });
          }
        }
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
        request.log.info({ fqdn, port, type }, 'Writing nginx vhost');
        const certPath = certResult.certPath || undefined;
        if (type === 'panel') {
          await writeAgentPanelVhost(subdomain, config.domain, port, certPath);
        } else if (type === 'plugin') {
          // Derive the plugin route prefix from the package name
          const pluginRoute = pluginName.replace(/^@lamalibre\//, '').replace(/-server$/, '');
          // Prevent routing collision with management API or reserved paths
          const reservedRoutes = ['api', 'plugin-bundles', 'internal', 'install'];
          if (reservedRoutes.includes(pluginRoute)) {
            return reply.code(400).send({ error: `Plugin route prefix '${pluginRoute}' conflicts with reserved path` });
          }
          await writeAppVhost(subdomain, config.domain, port, certPath, { pathPrefix: pluginRoute });
        } else {
          await writeAppVhost(subdomain, config.domain, port, certPath);
        }
        request.log.info({ fqdn }, 'Nginx vhost configured');
      } catch (err) {
        request.log.error(err, 'Failed to write nginx vhost');
        // Cert can stay (harmless) — no rollback needed for step 1
        return reply.code(500).send({
          error: 'Failed to create tunnel',
          details: `Nginx configuration failed: ${err.message}`,
        });
      }

      // Plugin tunnels use the same vhost format as app tunnels (Authelia forward auth)
      const removeVhost = type === 'panel' ? removeAgentPanelVhost : removeAppVhost;

      try {
        // Step 3: Update Chisel config (only enabled tunnels)
        request.log.info({ port }, 'Updating Chisel configuration');
        const allTunnels = [...existing, { port, enabled: true }];
        const enabledForChisel = allTunnels.filter((t) => t.enabled !== false);
        await updateChiselConfig(enabledForChisel);
        request.log.info('Chisel configuration updated');
      } catch (err) {
        request.log.error(err, 'Failed to update Chisel config');
        try {
          await removeVhost(subdomain);
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
        type,
        enabled: true,
        createdAt: new Date().toISOString(),
      };

      // Plugin tunnels store additional metadata for grant resolution
      if (type === 'plugin') {
        tunnel.pluginName = pluginName;
        tunnel.agentLabel = agentLabel;
        tunnel.pluginRoute = pluginName.replace(/^@lamalibre\//, '').replace(/-server$/, '');
      }

      try {
        const tunnels = await readTunnels();
        tunnels.push(tunnel);
        await writeTunnels(tunnels);
      } catch (err) {
        request.log.error(err, 'Failed to save tunnel state');
        try {
          await removeVhost(subdomain);
        } catch (rollbackErr) {
          request.log.error(rollbackErr, 'Rollback: failed to remove nginx vhost');
        }
        return reply.code(500).send({
          error: 'Failed to create tunnel',
          details: `State persistence failed: ${err.message}`,
        });
      }

      // Sync Authelia access control for plugin tunnels (applies any pre-existing grants)
      if (type === 'plugin') {
        try {
          await syncAllAccessControl(request.log);
        } catch (syncErr) {
          request.log.error(syncErr, 'Failed to sync Authelia access control after plugin tunnel creation');
        }
      }

      return reply.code(201).send({ ok: true, tunnel });
    },
  );

  // PATCH /api/tunnels/:id — toggle enabled/disabled
  fastify.patch(
    '/tunnels/:id',
    {
      preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'tunnels:write' }),
    },
    async (request, reply) => {
      const { id } = IdParamSchema.parse(request.params);
      const body = z.object({ enabled: z.boolean() }).parse(request.body);

      const tunnels = await readTunnels();
      const tunnel = tunnels.find((t) => t.id === id);

      if (!tunnel) {
        return reply.code(404).send({ error: 'Tunnel not found' });
      }

      const wasEnabled = tunnel.enabled !== false; // default true for legacy tunnels
      tunnel.enabled = body.enabled;

      const isPanel = tunnel.type === 'panel';

      // Panel tunnels require panel:expose capability or admin
      if (isPanel) {
        const caps = request.certCapabilities || [];
        if (request.certRole !== 'admin' && !caps.includes('panel:expose')) {
          return reply.code(403).send({ error: 'Cannot toggle panel tunnel without panel:expose capability' });
        }
      }

      try {
        if (body.enabled && !wasEnabled) {
          request.log.info({ subdomain: tunnel.subdomain }, 'Enabling tunnel');
          if (isPanel) {
            await enableAgentPanelVhost(tunnel.subdomain);
          } else {
            await enableAppVhost(tunnel.subdomain);
          }
        } else if (!body.enabled && wasEnabled) {
          request.log.info({ subdomain: tunnel.subdomain }, 'Disabling tunnel');
          if (isPanel) {
            await disableAgentPanelVhost(tunnel.subdomain);
          } else {
            await disableAppVhost(tunnel.subdomain);
          }
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

      // Sync Authelia access control when toggling plugin tunnels
      if (tunnel.type === 'plugin') {
        try {
          await syncAllAccessControl(request.log);
        } catch (syncErr) {
          request.log.error(syncErr, 'Failed to sync Authelia access control after plugin tunnel toggle');
        }
      }

      return { ok: true, tunnel };
    },
  );

  // DELETE /api/tunnels/:id
  fastify.delete(
    '/tunnels/:id',
    {
      preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'tunnels:write' }),
    },
    async (request, reply) => {
      const { id } = IdParamSchema.parse(request.params);

      const tunnels = await readTunnels();
      const index = tunnels.findIndex((t) => t.id === id);

      if (index === -1) {
        return reply.code(404).send({ error: 'Tunnel not found' });
      }

      const tunnel = tunnels[index];

      // Panel tunnels require panel:expose capability or admin
      if (tunnel.type === 'panel') {
        const caps = request.certCapabilities || [];
        if (request.certRole !== 'admin' && !caps.includes('panel:expose')) {
          return reply.code(403).send({ error: 'Cannot delete panel tunnel without panel:expose capability' });
        }
      }

      try {
        // Step 1: Remove nginx vhost
        request.log.info({ subdomain: tunnel.subdomain }, 'Removing nginx vhost');
        if (tunnel.type === 'panel') {
          await removeAgentPanelVhost(tunnel.subdomain);
        } else {
          await removeAppVhost(tunnel.subdomain);
        }

        // Step 2: Update Chisel config (with remaining enabled tunnels)
        const remaining = tunnels.filter((_, i) => i !== index);
        const enabledRemaining = remaining.filter((t) => t.enabled !== false);
        request.log.info('Updating Chisel configuration');
        await updateChiselConfig(enabledRemaining);

        // Step 3: Remove from state
        await writeTunnels(remaining);

        // Sync Authelia access control after plugin tunnel deletion
        if (tunnel.type === 'plugin') {
          try {
            await syncAllAccessControl(request.log);
          } catch (syncErr) {
            request.log.error(syncErr, 'Failed to sync Authelia access control after plugin tunnel deletion');
          }
        }
      } catch (err) {
        request.log.error(err, 'Failed to delete tunnel');
        return reply.code(500).send({
          error: 'Failed to delete tunnel',
          details: err.message,
        });
      }

      return { ok: true };
    },
  );

  // GET /api/tunnels/agent-panel-status — check if agent has a panel tunnel
  fastify.get(
    '/tunnels/agent-panel-status',
    {
      preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'panel:expose' }),
    },
    async (request, _reply) => {
      const label = request.certLabel;
      const tunnels = await readTunnels();
      const subdomain = label ? `agent-${label}` : null;
      const panelTunnel = tunnels.find(
        (t) => t.type === 'panel' && t.subdomain === subdomain,
      );

      if (!panelTunnel) {
        return { enabled: false, fqdn: null, port: null };
      }

      return {
        enabled: panelTunnel.enabled !== false,
        fqdn: panelTunnel.fqdn,
        port: panelTunnel.port,
      };
    },
  );

  // POST /api/tunnels/expose-panel — create a panel tunnel for the requesting agent
  fastify.post(
    '/tunnels/expose-panel',
    {
      preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'panel:expose' }),
    },
    async (request, reply) => {
      const { port } = ExposePanelSchema.parse(request.body);
      const label = request.certLabel;

      if (!label) {
        return reply.code(400).send({ error: 'Agent label is required (must use agent certificate)' });
      }

      const subdomain = `agent-${label}`;
      const config = getConfig();

      if (!config.domain || !config.email) {
        return reply.code(400).send({
          error: 'Domain and email must be configured before exposing agent panel',
        });
      }

      // Check if a panel tunnel already exists for this agent
      const existing = await readTunnels();
      const existingPanel = existing.find(
        (t) => t.type === 'panel' && t.subdomain === subdomain,
      );
      if (existingPanel) {
        return reply.code(409).send({
          error: 'Agent panel tunnel already exists',
          tunnel: existingPanel,
        });
      }

      // Check subdomain uniqueness (across all tunnel types)
      if (existing.find((t) => t.subdomain === subdomain)) {
        return reply.code(409).send({ error: `Subdomain '${subdomain}' is already in use` });
      }

      // Check port uniqueness
      if (existing.find((t) => t.port === port)) {
        return reply.code(400).send({ error: `Port ${port} is already in use by another tunnel` });
      }

      const fqdn = `${subdomain}.${config.domain}`;
      let certResult = null;

      try {
        request.log.info({ fqdn }, 'Issuing TLS certificate for agent panel');
        certResult = await issueTunnelCert(fqdn, config.email);
      } catch (err) {
        request.log.error(err, 'Failed to issue TLS certificate for agent panel');
        return reply.code(500).send({
          error: 'Failed to expose agent panel',
          details: `Certificate issuance failed: ${err.message}`,
        });
      }

      try {
        request.log.info({ fqdn, port }, 'Writing mTLS nginx vhost for agent panel');
        const certPath = certResult.certPath || undefined;
        await writeAgentPanelVhost(subdomain, config.domain, port, certPath);
      } catch (err) {
        request.log.error(err, 'Failed to write nginx vhost for agent panel');
        return reply.code(500).send({
          error: 'Failed to expose agent panel',
          details: `Nginx configuration failed: ${err.message}`,
        });
      }

      try {
        request.log.info({ port }, 'Updating Chisel configuration for agent panel');
        const allTunnels = [...existing, { port, enabled: true }];
        const enabledForChisel = allTunnels.filter((t) => t.enabled !== false);
        await updateChiselConfig(enabledForChisel);
      } catch (err) {
        request.log.error(err, 'Failed to update Chisel config for agent panel');
        try {
          await removeAgentPanelVhost(subdomain);
        } catch (rollbackErr) {
          request.log.error(rollbackErr, 'Rollback: failed to remove agent panel vhost');
        }
        return reply.code(500).send({
          error: 'Failed to expose agent panel',
          details: `Chisel reconfiguration failed: ${err.message}`,
        });
      }

      const tunnel = {
        id: crypto.randomUUID(),
        subdomain,
        fqdn,
        port,
        description: `Agent management panel for ${label}`,
        type: 'panel',
        agentLabel: label,
        enabled: true,
        createdAt: new Date().toISOString(),
      };

      try {
        existing.push(tunnel);
        await writeTunnels(existing);
      } catch (err) {
        request.log.error(err, 'Failed to save agent panel tunnel state');
        try {
          await removeAgentPanelVhost(subdomain);
        } catch (rollbackErr) {
          request.log.error(rollbackErr, 'Rollback: failed to remove agent panel vhost');
        }
        return reply.code(500).send({
          error: 'Failed to expose agent panel',
          details: `State persistence failed: ${err.message}`,
        });
      }

      return reply.code(201).send({ ok: true, tunnel });
    },
  );

  // DELETE /api/tunnels/retract-panel — remove the panel tunnel for the requesting agent
  fastify.delete(
    '/tunnels/retract-panel',
    {
      preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'panel:expose' }),
    },
    async (request, reply) => {
      const label = request.certLabel;

      if (!label) {
        return reply.code(400).send({ error: 'Agent label is required (must use agent certificate)' });
      }

      const subdomain = `agent-${label}`;
      const tunnels = await readTunnels();
      const index = tunnels.findIndex(
        (t) => t.type === 'panel' && t.subdomain === subdomain,
      );

      if (index === -1) {
        return reply.code(404).send({ error: 'No panel tunnel found for this agent' });
      }

      try {
        request.log.info({ subdomain }, 'Removing agent panel nginx vhost');
        await removeAgentPanelVhost(subdomain);

        const remaining = tunnels.filter((_, i) => i !== index);
        const enabledRemaining = remaining.filter((t) => t.enabled !== false);
        request.log.info('Updating Chisel configuration');
        await updateChiselConfig(enabledRemaining);

        await writeTunnels(remaining);
      } catch (err) {
        request.log.error(err, 'Failed to retract agent panel');
        return reply.code(500).send({
          error: 'Failed to retract agent panel',
          details: err.message,
        });
      }

      return { ok: true };
    },
  );
}
