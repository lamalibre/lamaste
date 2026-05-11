/**
 * Tunnel management routes.
 *
 * Create/delete/toggle delegate to @lamalibre/lamaste/server core functions.
 * Read-only endpoints and HTTP-specific auth checks remain here.
 */
import { z } from 'zod';
import { createTunnel, deleteTunnel, toggleTunnel, TunnelError } from '@lamalibre/lamaste/server';
import { getConfig } from '../../lib/config.js';
import { readTunnels, writeTunnels } from '../../lib/state.js';
import {
  writePublicVhost,
  writeAuthenticatedVhost,
  writeRestrictedVhost,
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

const IdParamSchema = z.object({ id: z.string().uuid() });

// `z.coerce.number()` lets browser query strings pass `?limit=50` without
// requiring callers to JSON-encode their numeric params.
const ListTunnelsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sort: z.enum(['createdAt', 'name']).optional().default('createdAt'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

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
      .regex(
        /^@lamalibre\/[a-z0-9][a-z0-9._-]*$/,
        'Invalid plugin name — must be @lamalibre/ scoped with valid npm characters',
      )
      .optional(),
    agentLabel: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'Invalid agent label format')
      .optional(),
    accessMode: z.enum(['public', 'authenticated', 'restricted']).optional().default('restricted'),
  })
  .refine((d) => d.type !== 'plugin' || (d.pluginName && d.agentLabel), {
    message: 'pluginName and agentLabel are required for plugin tunnels',
  });

const ExposePanelSchema = z.object({
  port: z
    .number()
    .int('Port must be an integer')
    .min(1024, 'Port must be at least 1024')
    .max(65535, 'Port must be at most 65535'),
});

// ---------------------------------------------------------------------------
// Dependency adapters for core functions
// ---------------------------------------------------------------------------

function buildNginxDeps() {
  return {
    writePublicVhost,
    writeAuthenticatedVhost,
    writeRestrictedVhost,
    writeAgentPanelVhost,
    removeAppVhost,
    removeAgentPanelVhost,
    enableAppVhost,
    disableAppVhost,
    enableAgentPanelVhost,
    disableAgentPanelVhost,
  };
}

function buildCertbotDeps() {
  return { issueTunnelCert };
}

function buildChiselDeps() {
  return { updateChiselConfig };
}

function buildStateDeps() {
  return { readTunnels, writeTunnels };
}

/**
 * Map a TunnelError code to an HTTP status code.
 */
function tunnelErrorStatus(code) {
  switch (code) {
    case 'RESERVED_SUBDOMAIN':
    case 'RESERVED_AGENT_PREFIX':
    case 'SUBDOMAIN_IN_USE':
    case 'PORT_IN_USE':
    case 'DOMAIN_NOT_CONFIGURED':
    case 'RESERVED_PLUGIN_ROUTE':
      return 400;
    case 'NOT_FOUND':
      return 404;
    default:
      return 500;
  }
}

export default async function tunnelRoutes(fastify, _opts) {
  const nginxDeps = buildNginxDeps();
  const certbotDeps = buildCertbotDeps();
  const chiselDeps = buildChiselDeps();
  const stateDeps = buildStateDeps();

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
        return reply.code(500).send({ error: 'Failed to generate agent config' });
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
              install: 'launchctl load ~/Library/LaunchAgents/com.lamalibre.lamaste.chisel.plist',
              uninstall:
                'launchctl unload ~/Library/LaunchAgents/com.lamalibre.lamaste.chisel.plist',
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
          .header(
            'Content-Disposition',
            'attachment; filename="com.lamalibre.lamaste.chisel.plist"',
          )
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
  //
  // Paginated. Defaults (limit=100, offset=0, sort=createdAt desc) preserve
  // the prior unpaginated UX for installations under 100 tunnels. The
  // `tunnels` array stays the response envelope's primary field; older
  // clients that ignore `total`/`limit`/`offset` continue to function and
  // simply see the first window.
  fastify.get(
    '/tunnels',
    {
      preHandler: fastify.requireRole(['admin', 'agent']),
    },
    async (request, _reply) => {
      const { limit, offset, sort, order } = ListTunnelsQuerySchema.parse(request.query);
      const tunnels = await readTunnels();

      // Sort the in-process state-file copy. Tunnel counts are bounded by
      // operational reality (no installation realistically holds 10k+);
      // an in-memory sort is the right tool here, no DB index needed.
      const direction = order === 'asc' ? 1 : -1;
      tunnels.sort((a, b) => {
        if (sort === 'name') {
          const av = String(a.subdomain ?? '');
          const bv = String(b.subdomain ?? '');
          return av < bv ? -direction : av > bv ? direction : 0;
        }
        const at = new Date(a.createdAt ?? 0).getTime();
        const bt = new Date(b.createdAt ?? 0).getTime();
        return (at - bt) * direction;
      });

      const total = tunnels.length;
      const windowed = tunnels.slice(offset, offset + limit);

      return { tunnels: windowed, total, limit, offset };
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
      const { subdomain, port, description, type, pluginName, agentLabel, accessMode } = body;

      // --- HTTP-specific auth checks (cannot be done in core) ---

      // Non-restricted access modes are admin-only
      if (accessMode !== 'restricted' && request.certRole !== 'admin') {
        return reply.code(403).send({
          error: 'Only administrators can set tunnel access mode to public or authenticated',
        });
      }

      // Plugin tunnels are admin-only
      if (type === 'plugin' && request.certRole !== 'admin') {
        return reply
          .code(403)
          .send({ error: 'Plugin tunnels can only be created by administrators' });
      }

      // Panel tunnels require panel:expose capability and must match the requesting agent's label
      if (type === 'panel') {
        const caps = request.certCapabilities || [];
        if (request.certRole !== 'admin' && !caps.includes('panel:expose')) {
          return reply.code(403).send({ error: 'Agent does not have panel:expose capability' });
        }
        if (request.certRole === 'agent' && request.certLabel) {
          const expectedSubdomain = `agent-${request.certLabel}`;
          if (subdomain !== expectedSubdomain) {
            return reply
              .code(403)
              .send({ error: 'Agents can only create panel tunnels for their own label' });
          }
        }
      }

      // --- Delegate to core ---

      const config = getConfig();
      if (!config.domain || !config.email) {
        return reply.code(400).send({
          error: 'Domain and email must be configured before creating tunnels',
        });
      }

      try {
        const tunnel = await createTunnel({
          subdomain,
          port,
          description,
          type,
          accessMode,
          pluginName,
          agentLabel,
          domain: config.domain,
          email: config.email,
          nginx: nginxDeps,
          certbot: certbotDeps,
          chisel: chiselDeps,
          state: stateDeps,
          logger: request.log,
        });
        return reply.code(201).send({ ok: true, tunnel });
      } catch (err) {
        if (err instanceof TunnelError) {
          const status = tunnelErrorStatus(err.code);
          return reply.code(status).send({
            error: 'Failed to create tunnel',
            details: err.message,
          });
        }
        request.log.error(err, 'Failed to create tunnel');
        return reply.code(500).send({
          error: 'Failed to create tunnel',
          details: err.message,
        });
      }
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

      // Panel tunnel auth check requires reading state first
      const tunnels = await readTunnels();
      const tunnel = tunnels.find((t) => t.id === id);
      if (!tunnel) {
        return reply.code(404).send({ error: 'Tunnel not found' });
      }

      if (tunnel.type === 'panel') {
        const caps = request.certCapabilities || [];
        if (request.certRole !== 'admin' && !caps.includes('panel:expose')) {
          return reply
            .code(403)
            .send({ error: 'Cannot toggle panel tunnel without panel:expose capability' });
        }
      }

      try {
        const result = await toggleTunnel({
          id,
          enabled: body.enabled,
          nginx: nginxDeps,
          chisel: chiselDeps,
          state: stateDeps,
          logger: request.log,
        });
        return result;
      } catch (err) {
        if (err instanceof TunnelError) {
          const status = tunnelErrorStatus(err.code);
          return reply.code(status).send({
            error: 'Failed to toggle tunnel',
            details: err.message,
          });
        }
        request.log.error(err, 'Failed to toggle tunnel');
        return reply.code(500).send({
          error: 'Failed to toggle tunnel',
          details: err.message,
        });
      }
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

      // Panel tunnel auth check requires reading state first
      const tunnels = await readTunnels();
      const tunnel = tunnels.find((t) => t.id === id);
      if (!tunnel) {
        return reply.code(404).send({ error: 'Tunnel not found' });
      }

      if (tunnel.type === 'panel') {
        const caps = request.certCapabilities || [];
        if (request.certRole !== 'admin' && !caps.includes('panel:expose')) {
          return reply
            .code(403)
            .send({ error: 'Cannot delete panel tunnel without panel:expose capability' });
        }
      }

      try {
        await deleteTunnel({
          id,
          nginx: nginxDeps,
          chisel: chiselDeps,
          state: stateDeps,
          logger: request.log,
        });
        return { ok: true };
      } catch (err) {
        if (err instanceof TunnelError) {
          const status = tunnelErrorStatus(err.code);
          return reply.code(status).send({
            error: 'Failed to delete tunnel',
            details: err.message,
          });
        }
        request.log.error(err, 'Failed to delete tunnel');
        return reply.code(500).send({
          error: 'Failed to delete tunnel',
          details: err.message,
        });
      }
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
      const panelTunnel = tunnels.find((t) => t.type === 'panel' && t.subdomain === subdomain);

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
        return reply
          .code(400)
          .send({ error: 'Agent label is required (must use agent certificate)' });
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
      const existingPanel = existing.find((t) => t.type === 'panel' && t.subdomain === subdomain);
      if (existingPanel) {
        return reply.code(409).send({
          error: 'Agent panel tunnel already exists',
          tunnel: existingPanel,
        });
      }

      try {
        const tunnel = await createTunnel({
          subdomain,
          port,
          description: `Agent management panel for ${label}`,
          type: 'panel',
          agentLabel: label,
          domain: config.domain,
          email: config.email,
          nginx: nginxDeps,
          certbot: certbotDeps,
          chisel: chiselDeps,
          state: stateDeps,
          logger: request.log,
        });
        return reply.code(201).send({ ok: true, tunnel });
      } catch (err) {
        if (err instanceof TunnelError) {
          const status = tunnelErrorStatus(err.code);
          return reply.code(status).send({
            error: 'Failed to expose agent panel',
            details: err.message,
          });
        }
        request.log.error(err, 'Failed to expose agent panel');
        return reply.code(500).send({
          error: 'Failed to expose agent panel',
          details: err.message,
        });
      }
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
        return reply
          .code(400)
          .send({ error: 'Agent label is required (must use agent certificate)' });
      }

      const subdomain = `agent-${label}`;
      const tunnels = await readTunnels();
      const panelTunnel = tunnels.find((t) => t.type === 'panel' && t.subdomain === subdomain);

      if (!panelTunnel) {
        return reply.code(404).send({ error: 'No panel tunnel found for this agent' });
      }

      try {
        await deleteTunnel({
          id: panelTunnel.id,
          nginx: nginxDeps,
          chisel: chiselDeps,
          state: stateDeps,
          logger: request.log,
        });
        return { ok: true };
      } catch (err) {
        if (err instanceof TunnelError) {
          const status = tunnelErrorStatus(err.code);
          return reply.code(status).send({
            error: 'Failed to retract agent panel',
            details: err.message,
          });
        }
        request.log.error(err, 'Failed to retract agent panel');
        return reply.code(500).send({
          error: 'Failed to retract agent panel',
          details: err.message,
        });
      }
    },
  );
}
