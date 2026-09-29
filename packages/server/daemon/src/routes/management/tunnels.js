/**
 * Tunnel management routes.
 *
 * Mutations delegate to @lamalibre/lamaste/server core workflows, which run
 * under the tunnel-state lock. Read-only endpoints and HTTP-specific auth
 * checks remain here; checks that depend on the tunnel's current state run
 * inside the lock through the workflows' `authorize` hook.
 */
import { z } from 'zod';
import {
  createTunnel,
  deleteTunnel,
  updateTunnel,
  TUNNEL_MAX_BODY_MB,
  grantedTunnelsFor,
  TunnelError,
} from '@lamalibre/lamaste/server';
import {
  AGENT_LABEL_REGEX,
  PLUGIN_AGENT_CN_PREFIX,
  RESERVED_TUNNEL_PORTS,
} from '@lamalibre/lamaste';
import { getConfig } from '../../lib/config.js';
import { readTunnels, readSites } from '../../lib/state.js';
import { loadAgentRegistry } from '../../lib/mtls.js';
import { getChiselCredentialIssuedAt } from '../../lib/chisel-users.js';
import { buildChiselArgs } from '../../lib/chisel-args.js';
import {
  tunnelNginxDeps,
  tunnelCertbotDeps,
  tunnelChiselDeps,
  tunnelStateDeps,
} from '../../lib/tunnel-deps.js';

const IdParamSchema = z.object({ id: z.string().uuid() });

const TunnelPortSchema = z
  .number()
  .int('Port must be an integer')
  .min(1024, 'Port must be at least 1024')
  .max(65535, 'Port must be at most 65535')
  .refine((p) => !RESERVED_TUNNEL_PORTS.includes(p), {
    message: `Ports ${RESERVED_TUNNEL_PORTS.join(', ')} belong to Lamaste services on the relay`,
  });

const AgentLabelSchema = z.string().regex(AGENT_LABEL_REGEX, 'Invalid agent label format');

const AccessModeSchema = z.enum(['public', 'authenticated', 'restricted']);

const MaxBodySizeSchema = z
  .number()
  .int('maxBodySizeMb must be an integer')
  .min(TUNNEL_MAX_BODY_MB.min, `maxBodySizeMb must be at least ${TUNNEL_MAX_BODY_MB.min}`)
  .max(TUNNEL_MAX_BODY_MB.max, `maxBodySizeMb must be at most ${TUNNEL_MAX_BODY_MB.max}`);

const AgentConfigQuerySchema = z.object({
  agent: AgentLabelSchema.optional(),
});

const UpdateTunnelSchema = z
  .object({
    enabled: z.boolean().optional(),
    agentLabel: AgentLabelSchema.optional(),
    accessMode: AccessModeSchema.optional(),
    maxBodySizeMb: MaxBodySizeSchema.optional(),
  })
  .strict()
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'Provide at least one of enabled, agentLabel, accessMode, maxBodySizeMb',
  });

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
    port: TunnelPortSchema,
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
    // The agent that carries the tunnel. Admins must name it; an agent may
    // omit it (it defaults to the agent itself) but may not name another.
    agentLabel: AgentLabelSchema.optional(),
    accessMode: AccessModeSchema.optional().default('restricted'),
    maxBodySizeMb: MaxBodySizeSchema.optional(),
  })
  .refine((d) => d.type !== 'plugin' || (d.pluginName && d.agentLabel), {
    message: 'pluginName and agentLabel are required for plugin tunnels',
  });

const ExposePanelSchema = z.object({
  port: TunnelPortSchema,
});

// ---------------------------------------------------------------------------
// Dependency adapters for core functions
// ---------------------------------------------------------------------------

function buildAgentDeps() {
  return {
    async isActiveAgent(label) {
      const registry = await loadAgentRegistry();
      return registry.agents.some((a) => a.label === label && !a.revoked);
    },
  };
}

/**
 * Resolve which agent's tunnels a request may see and act on.
 * Agents are confined to their own label; admins see everything.
 * @returns {string | null} the confining label, or null for admin
 */
function confinedLabel(request) {
  return request.certRole === 'admin' ? null : request.certLabel;
}

/** True when the requester may act on this tunnel. */
function mayActOn(request, tunnel) {
  const label = confinedLabel(request);
  return label === null || tunnel.agentLabel === label;
}

/**
 * `authorize` hook for workflows on an existing tunnel, evaluated under the
 * tunnel lock: an agent sees only its own tunnels (anything else is "not
 * found"), and an agent panel tunnel needs `panel:expose`.
 */
function authorizeFor(request, action) {
  return (tunnel) => {
    if (!mayActOn(request, tunnel)) {
      throw new TunnelError('Tunnel not found', 'NOT_FOUND');
    }
    if (tunnel.type === 'panel' && request.certRole !== 'admin') {
      const caps = request.certCapabilities || [];
      if (!caps.includes('panel:expose')) {
        throw new TunnelError(
          `Cannot ${action} a panel tunnel without the panel:expose capability`,
          'FORBIDDEN',
        );
      }
    }
  };
}

/** The largest body limit the requester may set. */
function maxBodyCeiling(request) {
  return request.certRole === 'admin' ? TUNNEL_MAX_BODY_MB.max : TUNNEL_MAX_BODY_MB.agentMax;
}

/** A static site (or one of its aliases) that already answers on `fqdn`. */
async function siteServing(fqdn) {
  const sites = await readSites();
  return sites.find((s) => s.fqdn === fqdn || (s.aliases ?? []).includes(fqdn)) ?? null;
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
    case 'INVALID_AGENT_LABEL':
    case 'UNKNOWN_AGENT':
    case 'INVALID_SETTING':
    case 'RESERVED_PORT':
      return 400;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    default:
      return 500;
  }
}

export default async function tunnelRoutes(fastify, _opts) {
  const nginxDeps = tunnelNginxDeps;
  const certbotDeps = tunnelCertbotDeps;
  const chiselDeps = tunnelChiselDeps;
  const stateDeps = tunnelStateDeps;
  const agentDeps = buildAgentDeps();

  // GET /api/tunnels/agent-config — must be registered BEFORE /:id
  fastify.get(
    '/tunnels/agent-config',
    {
      preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'tunnels:read' }),
    },
    async (request, reply) => {
      // Parsed outside the try so a malformed ?agent= is a 400 from the
      // shared Zod error handler, not a 500 from the catch below.
      const { agent } = AgentConfigQuerySchema.parse(request.query);
      try {
        const config = getConfig();
        const tunnels = await readTunnels();

        if (!config.domain) {
          return reply.code(400).send({ error: 'Domain not configured' });
        }

        // An agent always gets its own tunnels and nothing else. An admin
        // names the agent with ?agent=<label>; without it the admin gets the
        // domain only, because a chisel config is meaningless without an
        // agent to carry it.
        const label = confinedLabel(request) ?? agent ?? null;

        const base = {
          domain: config.domain,
          chiselServerUrl: `https://tunnel.${config.domain}:443`,
        };
        if (label === null) {
          return base;
        }

        // Exactly what chisel grants this agent: a tunnel chisel withholds
        // (reserved port, duplicate claim) must not be requested, or chisel
        // refuses the agent's whole session.
        const carried = grantedTunnelsFor(tunnels, label);
        return {
          ...base,
          agentLabel: label,
          chiselArgs: buildChiselArgs(carried, config.domain),
          // When the agent's chisel password was issued (not the password).
          // An agent holding an older one fetches the current credential.
          chiselCredentialIssuedAt: AGENT_LABEL_REGEX.test(label)
            ? await getChiselCredentialIssuedAt(label)
            : null,
          tunnels: carried.map((t) => ({
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
      // Agents see only the tunnels they carry — the hostnames and ports of
      // other agents' tunnels are none of their business.
      const label = confinedLabel(request);
      const tunnels = (await readTunnels()).filter((t) => label === null || t.agentLabel === label);

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
      const { subdomain, port, description, type, pluginName, accessMode, maxBodySizeMb } = body;

      // --- HTTP-specific auth checks (cannot be done in core) ---

      // Resolve the carrying agent. An agent can only create tunnels it
      // carries itself; an admin must say which agent carries it.
      let agentLabel;
      if (request.certRole === 'admin') {
        if (!body.agentLabel) {
          return reply
            .code(400)
            .send({ error: 'agentLabel is required: name the agent that will carry the tunnel' });
        }
        agentLabel = body.agentLabel;
      } else {
        if (!request.certLabel) {
          return reply.code(403).send({ error: 'Agent certificate has no label' });
        }
        // A plugin-agent certificate belongs to a plugin running on an agent,
        // not to a machine that runs a chisel client: it holds no chisel
        // credential and can carry nothing. Tunnels for a plugin are created
        // with the agent's own certificate, or by an administrator.
        if (request.certLabel.startsWith(PLUGIN_AGENT_CN_PREFIX)) {
          return reply.code(403).send({
            error:
              'Plugin-agent certificates cannot create tunnels — use the agent certificate of ' +
              'the machine that carries the tunnel',
          });
        }
        if (body.agentLabel && body.agentLabel !== request.certLabel) {
          return reply
            .code(403)
            .send({ error: 'Agents can only create tunnels they carry themselves' });
        }
        agentLabel = request.certLabel;
      }

      // Non-restricted access modes are admin-only
      if (accessMode !== 'restricted' && request.certRole !== 'admin') {
        return reply.code(403).send({
          error: 'Only administrators can set tunnel access mode to public or authenticated',
        });
      }

      if (maxBodySizeMb !== undefined && maxBodySizeMb > maxBodyCeiling(request)) {
        return reply.code(403).send({
          error: `Only administrators can set a body limit above ${TUNNEL_MAX_BODY_MB.agentMax} MiB`,
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

      // A static site (or one of its aliases) may already answer on this
      // hostname; two vhosts with one server_name make nginx pick silently.
      const fqdn = `${subdomain}.${config.domain}`;
      if (await siteServing(fqdn)) {
        return reply.code(400).send({
          error: 'Failed to create tunnel',
          details: `Domain '${fqdn}' is already served by a static site`,
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
          maxBodySizeMb,
          domain: config.domain,
          email: config.email,
          nginx: nginxDeps,
          certbot: certbotDeps,
          chisel: chiselDeps,
          state: stateDeps,
          agents: agentDeps,
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

  // PATCH /api/tunnels/:id — enable/disable, reassign carrier, change access
  // mode or body limit, in one workflow under the tunnel lock (see core
  // updateTunnel for the order).
  fastify.patch(
    '/tunnels/:id',
    {
      preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'tunnels:write' }),
    },
    async (request, reply) => {
      const { id } = IdParamSchema.parse(request.params);
      const body = UpdateTunnelSchema.parse(request.body);

      if (body.agentLabel !== undefined && request.certRole !== 'admin') {
        return reply
          .code(403)
          .send({ error: 'Only administrators can change which agent carries a tunnel' });
      }

      if (
        body.accessMode !== undefined &&
        body.accessMode !== 'restricted' &&
        request.certRole !== 'admin'
      ) {
        return reply.code(403).send({
          error: 'Only administrators can set tunnel access mode to public or authenticated',
        });
      }

      if (body.maxBodySizeMb !== undefined && body.maxBodySizeMb > maxBodyCeiling(request)) {
        return reply.code(403).send({
          error: `Only administrators can set a body limit above ${TUNNEL_MAX_BODY_MB.agentMax} MiB`,
        });
      }

      const config = getConfig();
      if (
        (body.accessMode !== undefined || body.maxBodySizeMb !== undefined) &&
        (!config.domain || !config.email)
      ) {
        return reply.code(400).send({ error: 'Domain and email must be configured' });
      }

      try {
        return await updateTunnel({
          id,
          enabled: body.enabled,
          agentLabel: body.agentLabel,
          accessMode: body.accessMode,
          maxBodySizeMb: body.maxBodySizeMb,
          domain: config.domain,
          email: config.email,
          nginx: nginxDeps,
          certbot: certbotDeps,
          chisel: chiselDeps,
          state: stateDeps,
          agents: agentDeps,
          logger: request.log,
          authorize: authorizeFor(request, 'change'),
        });
      } catch (err) {
        if (err instanceof TunnelError) {
          const status = tunnelErrorStatus(err.code);
          return reply.code(status).send({
            error: status === 404 ? 'Tunnel not found' : 'Failed to update tunnel',
            details: err.message,
          });
        }
        request.log.error(err, 'Failed to update tunnel');
        return reply.code(500).send({
          error: 'Failed to update tunnel',
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

      try {
        await deleteTunnel({
          id,
          nginx: nginxDeps,
          chisel: chiselDeps,
          state: stateDeps,
          logger: request.log,
          authorize: authorizeFor(request, 'delete'),
        });
        return { ok: true };
      } catch (err) {
        if (err instanceof TunnelError) {
          const status = tunnelErrorStatus(err.code);
          return reply.code(status).send({
            error: status === 404 ? 'Tunnel not found' : 'Failed to delete tunnel',
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

      const fqdn = `${subdomain}.${config.domain}`;
      if (await siteServing(fqdn)) {
        return reply.code(400).send({
          error: 'Failed to expose agent panel',
          details: `Domain '${fqdn}' is already served by a static site`,
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
          agents: agentDeps,
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
