import { z } from 'zod';
import path from 'node:path';
import {
  readShellConfig,
  writeShellConfig,
  readShellSessions,
  enableAgentShell,
  disableAgentShell,
  isAgentShellEnabled,
  isIpAllowed,
  validateShellAccess,
  logShellSession,
  updateShellSession,
} from '../../lib/shell.js';
import { loadAgentRegistry } from '../../lib/mtls.js';

// --- Validation schemas ---

const IpEntrySchema = z
  .string()
  .min(1)
  .max(45)
  .regex(
    /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/,
    'Must be an IPv4 address or CIDR (e.g. 192.168.1.0/24)',
  )
  .refine((v) => {
    if (!v.includes('/')) return true;
    const prefix = parseInt(v.split('/')[1], 10);
    return prefix >= 1 && prefix <= 32;
  }, 'CIDR prefix length must be between 1 and 32');

const CommandBlocklistSchema = z.object({
  hardBlocked: z.array(z.string().min(1).max(200)).optional(),
  restricted: z.record(z.string(), z.boolean()).optional(),
});

const PolicyIdSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9-]+$/, 'Policy ID must contain only lowercase letters, numbers, and hyphens');

const CreatePolicySchema = z.object({
  id: PolicyIdSchema.optional(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
  allowedIps: z.array(IpEntrySchema).default([]),
  deniedIps: z.array(IpEntrySchema).default([]),
  maxFileSize: z
    .number()
    .int()
    .min(1024)
    .max(500 * 1024 * 1024)
    .optional(),
  inactivityTimeout: z.number().int().min(60).max(7200).optional(),
  commandBlocklist: CommandBlocklistSchema.optional(),
});

const UpdatePolicySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  allowedIps: z.array(IpEntrySchema).optional(),
  deniedIps: z.array(IpEntrySchema).optional(),
  maxFileSize: z
    .number()
    .int()
    .min(1024)
    .max(500 * 1024 * 1024)
    .optional(),
  inactivityTimeout: z.number().int().min(60).max(7200).optional(),
  commandBlocklist: CommandBlocklistSchema.optional(),
});

const UpdateShellConfigSchema = z.object({
  enabled: z.boolean().optional(),
  defaultPolicy: PolicyIdSchema.optional(),
});

const EnableShellSchema = z.object({
  durationMinutes: z.number().int().min(5).max(480).default(30),
  policyId: z.string().optional(),
});

const AgentLabelParamSchema = z.object({
  label: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Label must contain only lowercase letters, numbers, and hyphens'),
});

const PolicyIdParamSchema = z.object({
  policyId: PolicyIdSchema,
});

const FilePathQuerySchema = z.object({
  path: z
    .string()
    .min(1, 'File path is required')
    .max(4096, 'File path must not exceed 4096 characters')
    .refine((v) => !v.includes('\0'), 'File path must not contain null bytes')
    .refine(
      (v) => !path.normalize(v).split(path.sep).includes('..'),
      'File path must not contain ".." after normalization',
    ),
});

const RecordingParamSchema = z.object({
  label: AgentLabelParamSchema.shape.label,
  sessionId: z.string().uuid('Session ID must be a valid UUID'),
});

// --- Helpers ---

/**
 * Derive a slug-style ID from a policy name.
 * Converts to lowercase, replaces non-alphanumeric runs with hyphens, trims.
 */
function slugifyPolicyName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

// --- Routes ---

export default async function shellRoutes(fastify, _opts) {
  // GET /api/shell/config — get shell configuration
  fastify.get(
    '/shell/config',
    { preHandler: fastify.requireRole(['admin']) },
    async (_request, _reply) => {
      const config = await readShellConfig();
      return config;
    },
  );

  // PATCH /api/shell/config — update shell configuration (enabled + defaultPolicy only)
  fastify.patch(
    '/shell/config',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const body = UpdateShellConfigSchema.parse(request.body);
      const current = await readShellConfig();

      if (body.enabled !== undefined) current.enabled = body.enabled;

      if (body.defaultPolicy !== undefined) {
        // Verify the referenced policy exists
        const policyExists = current.policies.some((p) => p.id === body.defaultPolicy);
        if (!policyExists) {
          return reply.code(400).send({
            error: `Policy "${body.defaultPolicy}" does not exist`,
          });
        }
        current.defaultPolicy = body.defaultPolicy;
      }

      try {
        await writeShellConfig(current);
      } catch (err) {
        request.log.error(err, 'Failed to save shell config');
        return reply.code(500).send({ error: 'Failed to save shell configuration' });
      }

      return { ok: true, config: current };
    },
  );

  // ---------------------------------------------------------------------------
  // Policy CRUD endpoints
  // ---------------------------------------------------------------------------

  // GET /api/shell/policies — list all policies
  fastify.get(
    '/shell/policies',
    { preHandler: fastify.requireRole(['admin']) },
    async (_request, _reply) => {
      const config = await readShellConfig();
      return { policies: config.policies, defaultPolicy: config.defaultPolicy };
    },
  );

  // POST /api/shell/policies — create a new policy
  fastify.post(
    '/shell/policies',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const body = CreatePolicySchema.parse(request.body);
      const config = await readShellConfig();

      // Generate ID from name if not provided
      let policyId = body.id || slugifyPolicyName(body.name);
      if (!policyId) {
        return reply.code(400).send({ error: 'Could not derive a valid policy ID from the name' });
      }

      // Ensure uniqueness
      if (config.policies.some((p) => p.id === policyId)) {
        return reply.code(409).send({ error: `A policy with ID "${policyId}" already exists` });
      }

      const newPolicy = {
        id: policyId,
        name: body.name,
        description: body.description,
        allowedIps: body.allowedIps,
        deniedIps: body.deniedIps,
        maxFileSize: body.maxFileSize ?? 100 * 1024 * 1024,
        inactivityTimeout: body.inactivityTimeout ?? 600,
        commandBlocklist: body.commandBlocklist ?? {
          hardBlocked: [],
          restricted: {},
        },
      };

      config.policies.push(newPolicy);

      try {
        await writeShellConfig(config);
      } catch (err) {
        request.log.error(err, 'Failed to save shell config after creating policy');
        return reply.code(500).send({ error: 'Failed to save policy' });
      }

      request.log.info({ policyId }, 'Shell policy created');
      return { ok: true, policy: newPolicy };
    },
  );

  // PATCH /api/shell/policies/:policyId — update a policy
  fastify.patch(
    '/shell/policies/:policyId',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const { policyId } = PolicyIdParamSchema.parse(request.params);
      const body = UpdatePolicySchema.parse(request.body);
      const config = await readShellConfig();

      const policyIndex = config.policies.findIndex((p) => p.id === policyId);
      if (policyIndex === -1) {
        return reply.code(404).send({ error: `Policy "${policyId}" not found` });
      }

      const existing = config.policies[policyIndex];

      // Apply updates
      if (body.name !== undefined) existing.name = body.name;
      if (body.description !== undefined) existing.description = body.description;
      if (body.allowedIps !== undefined) existing.allowedIps = body.allowedIps;
      if (body.deniedIps !== undefined) existing.deniedIps = body.deniedIps;
      if (body.maxFileSize !== undefined) existing.maxFileSize = body.maxFileSize;
      if (body.inactivityTimeout !== undefined) existing.inactivityTimeout = body.inactivityTimeout;
      if (body.commandBlocklist) {
        if (body.commandBlocklist.hardBlocked !== undefined) {
          existing.commandBlocklist.hardBlocked = body.commandBlocklist.hardBlocked;
        }
        if (body.commandBlocklist.restricted !== undefined) {
          existing.commandBlocklist.restricted = {
            ...existing.commandBlocklist.restricted,
            ...body.commandBlocklist.restricted,
          };
        }
      }

      config.policies[policyIndex] = existing;

      try {
        await writeShellConfig(config);
      } catch (err) {
        request.log.error(err, 'Failed to save shell config after updating policy');
        return reply.code(500).send({ error: 'Failed to save policy' });
      }

      request.log.info({ policyId }, 'Shell policy updated');
      return { ok: true, policy: existing };
    },
  );

  // DELETE /api/shell/policies/:policyId — delete a policy
  fastify.delete(
    '/shell/policies/:policyId',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const { policyId } = PolicyIdParamSchema.parse(request.params);
      const config = await readShellConfig();

      // Cannot delete the default policy
      if (config.defaultPolicy === policyId) {
        return reply.code(400).send({
          error: `Cannot delete the default policy "${policyId}". Change the default policy first.`,
        });
      }

      const policyIndex = config.policies.findIndex((p) => p.id === policyId);
      if (policyIndex === -1) {
        return reply.code(404).send({ error: `Policy "${policyId}" not found` });
      }

      // Check if any active agent is currently using this policy
      const registry = await loadAgentRegistry();
      const agentsUsingPolicy = registry.agents.filter(
        (a) => !a.revoked && a.shellPolicy === policyId && a.shellEnabledUntil,
      );

      if (agentsUsingPolicy.length > 0) {
        const labels = agentsUsingPolicy.map((a) => a.label).join(', ');
        return reply.code(400).send({
          error: `Cannot delete policy "${policyId}" — it is currently assigned to agents: ${labels}`,
        });
      }

      config.policies.splice(policyIndex, 1);

      try {
        await writeShellConfig(config);
      } catch (err) {
        request.log.error(err, 'Failed to save shell config after deleting policy');
        return reply.code(500).send({ error: 'Failed to delete policy' });
      }

      request.log.info({ policyId }, 'Shell policy deleted');
      return { ok: true };
    },
  );

  // ---------------------------------------------------------------------------
  // Agent shell enable/disable
  // ---------------------------------------------------------------------------

  // POST /api/shell/enable/:label — enable shell access for an agent
  fastify.post(
    '/shell/enable/:label',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const { label } = AgentLabelParamSchema.parse(request.params);
      const { durationMinutes, policyId } = EnableShellSchema.parse(request.body || {});

      // Check that shell is globally enabled
      const config = await readShellConfig();
      if (!config.enabled) {
        return reply.code(400).send({
          error: 'Remote shell is not enabled globally. Enable it in Settings first.',
        });
      }

      // If a policyId is provided, verify it exists
      if (policyId && !config.policies.some((p) => p.id === policyId)) {
        return reply.code(400).send({
          error: `Policy "${policyId}" does not exist`,
        });
      }

      try {
        const result = await enableAgentShell(label, durationMinutes, policyId);
        request.log.info(
          { label, durationMinutes, policyId: result.shellPolicy },
          'Shell access enabled for agent',
        );
        return result;
      } catch (err) {
        if (err.statusCode) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        request.log.error(err, 'Failed to enable shell access');
        return reply.code(500).send({ error: 'Failed to enable shell access' });
      }
    },
  );

  // DELETE /api/shell/enable/:label — disable shell access for an agent
  fastify.delete(
    '/shell/enable/:label',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const { label } = AgentLabelParamSchema.parse(request.params);

      try {
        const result = await disableAgentShell(label);
        request.log.info({ label }, 'Shell access disabled for agent');
        return result;
      } catch (err) {
        if (err.statusCode) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        request.log.error(err, 'Failed to disable shell access');
        return reply.code(500).send({ error: 'Failed to disable shell access' });
      }
    },
  );

  // GET /api/shell/sessions — list shell session audit log
  fastify.get(
    '/shell/sessions',
    { preHandler: fastify.requireRole(['admin']) },
    async (_request, _reply) => {
      const sessions = await readShellSessions();
      return { sessions };
    },
  );

  // ---------------------------------------------------------------------------
  // Agent-accessible status endpoint
  // ---------------------------------------------------------------------------

  // GET /api/shell/agent-status — agent checks its own shell enabled status
  fastify.get(
    '/shell/agent-status',
    { preHandler: fastify.requireRole(['admin', 'agent']) },
    async (request, reply) => {
      const label = request.certRole === 'agent' ? request.certLabel : request.query?.label;
      if (!label) {
        return reply.code(400).send({ error: 'Missing agent label' });
      }

      const config = await readShellConfig();
      const registry = await loadAgentRegistry();
      const agent = registry.agents.find((a) => a.label === label && !a.revoked);

      if (!agent) {
        return reply.code(404).send({ error: `Agent certificate "${label}" not found` });
      }

      const shellEnabled = isAgentShellEnabled(agent);

      // Resolve the policy to return the command blocklist
      const policyId = agent.shellPolicy || config.defaultPolicy;
      const policy = config.policies.find((p) => p.id === policyId);

      return {
        label,
        globalEnabled: config.enabled,
        shellEnabled,
        shellEnabledUntil: agent.shellEnabledUntil || null,
        policyId: policyId,
        commandBlocklist: policy?.commandBlocklist || null,
      };
    },
  );

  // ---------------------------------------------------------------------------
  // File transfer relay endpoints
  // ---------------------------------------------------------------------------

  /**
   * Extract the client source IP from request headers or socket.
   */
  function extractSourceIp(request) {
    const xff = request.headers['x-forwarded-for'];
    // X-Forwarded-For may contain multiple IPs; take the leftmost (original client)
    const forwardedIp = xff ? xff.split(',')[0].trim() : undefined;
    return request.headers['x-real-ip'] || forwardedIp || request.ip;
  }

  // GET /api/shell/file/:label — download a file from an agent
  fastify.get(
    '/shell/file/:label',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const { label } = AgentLabelParamSchema.parse(request.params);

      let query;
      try {
        query = FilePathQuerySchema.parse(request.query);
      } catch (err) {
        return reply.code(400).send({ error: err.errors?.[0]?.message || 'Invalid file path' });
      }

      const sourceIp = extractSourceIp(request);
      const access = await validateShellAccess(label, sourceIp);
      if (!access.ok) {
        return reply.code(access.statusCode).send({ error: access.error });
      }

      request.log.info(
        { label, path: query.path },
        'File download requested (relay not yet connected)',
      );
      return reply.code(501).send({ error: 'Agent file relay not yet connected' });
    },
  );

  // POST /api/shell/file/:label — upload a file to an agent
  fastify.post(
    '/shell/file/:label',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const { label } = AgentLabelParamSchema.parse(request.params);

      let query;
      try {
        query = FilePathQuerySchema.parse(request.query);
      } catch (err) {
        return reply.code(400).send({ error: err.errors?.[0]?.message || 'Invalid file path' });
      }

      const sourceIp = extractSourceIp(request);
      const access = await validateShellAccess(label, sourceIp);
      if (!access.ok) {
        return reply.code(access.statusCode).send({ error: access.error });
      }

      request.log.info(
        { label, path: query.path },
        'File upload requested (relay not yet connected)',
      );
      return reply.code(501).send({ error: 'Agent file relay not yet connected' });
    },
  );

  // ---------------------------------------------------------------------------
  // Session recording endpoints
  // ---------------------------------------------------------------------------

  // GET /api/shell/recordings/:label — list session recordings for an agent
  fastify.get(
    '/shell/recordings/:label',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, _reply) => {
      const { label } = AgentLabelParamSchema.parse(request.params);

      const sessions = await readShellSessions();
      const agentSessions = sessions
        .filter((s) => s.agentLabel === label)
        .map((s) => ({
          sessionId: s.id,
          startedAt: s.startedAt,
          endedAt: s.endedAt || null,
          duration: s.duration || null,
          status: s.status,
        }));

      return { recordings: agentSessions };
    },
  );

  // GET /api/shell/recordings/:label/:sessionId — download a specific recording
  fastify.get(
    '/shell/recordings/:label/:sessionId',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const params = RecordingParamSchema.parse(request.params);

      // Verify the session exists and belongs to this agent
      const sessions = await readShellSessions();
      const session = sessions.find(
        (s) => s.id === params.sessionId && s.agentLabel === params.label,
      );

      if (!session) {
        return reply.code(404).send({ error: 'Recording not found for this agent and session' });
      }

      request.log.info(
        { label: params.label, sessionId: params.sessionId },
        'Recording download requested (recordings stored on agent)',
      );
      return reply.code(501).send({ error: 'Recordings are stored on the agent, not the panel' });
    },
  );

  // ---------------------------------------------------------------------------
  // WebSocket shell relay
  // ---------------------------------------------------------------------------

  // Pending admin connections waiting for their agent to connect
  // Map<label, { socket, request, sessionEntry, timeout }>
  const pendingAdminConnections = new Map();

  // Connected agents ready for relay pairing
  // Map<label, socket>
  const connectedAgents = new Map();

  // Active paired relay sessions for cleanup tracking
  // Map<label, { adminSocket, agentSocket, sessionEntry }>
  const activeSessions = new Map();

  /**
   * Run the 5-gate auth chain for an admin shell connection.
   *
   * 1. Global shell enabled
   * 2. Agent cert exists and not revoked
   * 3. Agent's shellEnabledUntil is in the future
   * 4. Admin's source IP passes the agent's assigned policy allow/deny list
   * 5. Connecting cert is admin role
   *
   * @returns {{ ok: true, agent: object, config: object, policy: object } | { ok: false, code: number, error: string }}
   */
  async function runAdminAuthGates(request, label) {
    // Gate 5: Connecting cert is admin role (already enforced by preHandler,
    // but verify explicitly for defense in depth)
    if (request.certRole !== 'admin') {
      return { ok: false, code: 4403, error: 'Admin certificate required' };
    }

    // Gate 1: Global shell enabled
    const config = await readShellConfig();
    if (!config.enabled) {
      return { ok: false, code: 4400, error: 'Remote shell is not enabled globally' };
    }

    // Gate 2: Agent cert exists and not revoked
    const registry = await loadAgentRegistry();
    const agent = registry.agents.find((a) => a.label === label && !a.revoked);
    if (!agent) {
      return { ok: false, code: 4404, error: `Agent certificate "${label}" not found` };
    }

    // Gate 3: Agent's shellEnabledUntil is in the future
    if (!isAgentShellEnabled(agent)) {
      return {
        ok: false,
        code: 4403,
        error: `Shell access not enabled for agent "${label}"`,
      };
    }

    // Resolve the agent's assigned policy
    const policyId = agent.shellPolicy || config.defaultPolicy;
    const policy = config.policies.find((p) => p.id === policyId);
    if (!policy) {
      return { ok: false, code: 4500, error: `Policy "${policyId}" not found` };
    }

    // Gate 4: Admin's source IP passes the policy's allow/deny list
    const sourceIp = extractSourceIp(request);
    if (!isIpAllowed(sourceIp, policy.allowedIps, policy.deniedIps)) {
      return { ok: false, code: 4403, error: 'Source IP is not allowed' };
    }

    return { ok: true, agent, config, policy };
  }

  /**
   * Pair an admin and agent WebSocket for bidirectional relay.
   * Forwards raw frames between the two sockets and handles cleanup.
   */
  function pairSockets(label, adminSocket, agentSocket, sessionEntry, log) {
    // Periodic check: enforce shellEnabledUntil during active sessions
    const timeWindowCheck = setInterval(async () => {
      try {
        const registry = await loadAgentRegistry();
        const agent = registry.agents.find((a) => a.label === label && !a.revoked);
        if (!agent || !isAgentShellEnabled(agent)) {
          log.info({ label }, 'Shell time window expired during active session');
          const expiredMsg = JSON.stringify({ type: 'time-window-expired' });
          try {
            if (adminSocket.readyState === 1) adminSocket.send(expiredMsg);
          } catch { /* socket may be closed */ }
          try {
            if (agentSocket.readyState === 1) agentSocket.send(expiredMsg);
          } catch { /* socket may be closed */ }
          try {
            if (adminSocket.readyState === 1) adminSocket.close(4403, 'Shell time window expired');
          } catch { /* already closed */ }
          try {
            if (agentSocket.readyState === 1) agentSocket.close(4403, 'Shell time window expired');
          } catch { /* already closed */ }
        }
      } catch (err) {
        log.error({ err, label }, 'Error checking shell time window during active session');
      }
    }, 30_000);

    // Store in active sessions for cleanup
    activeSessions.set(label, { adminSocket, agentSocket, sessionEntry });

    // Notify admin that relay is established
    try {
      adminSocket.send(
        JSON.stringify({ type: 'connected', message: 'Agent connected, shell relay active' }),
      );
    } catch {
      // Admin socket may have closed
    }

    // Notify agent that the admin has connected and relay is active
    try {
      agentSocket.send(
        JSON.stringify({ type: 'admin-connected', message: 'Admin connected, shell relay active' }),
      );
    } catch {
      // Agent socket may have closed
    }

    // Admin → Agent relay
    adminSocket.on('message', (data) => {
      try {
        if (agentSocket.readyState === 1 /* OPEN */) {
          agentSocket.send(data);
        }
      } catch (err) {
        log.error({ err, label }, 'Error forwarding admin frame to agent');
      }
    });

    // Agent → Admin relay
    agentSocket.on('message', (data) => {
      try {
        if (adminSocket.readyState === 1 /* OPEN */) {
          adminSocket.send(data);
        }
      } catch (err) {
        log.error({ err, label }, 'Error forwarding agent frame to admin');
      }
    });

    // Cleanup function shared by both sides
    async function endSession(initiator) {
      if (!activeSessions.has(label)) return;
      clearInterval(timeWindowCheck);
      activeSessions.delete(label);
      connectedAgents.delete(label);
      pendingAdminConnections.delete(label);

      log.info({ label, initiator }, 'Shell relay session ended');

      // Close the other side
      try {
        if (initiator !== 'admin' && adminSocket.readyState === 1) {
          adminSocket.close(1000, 'Agent disconnected');
        }
      } catch {
        /* already closed */
      }

      try {
        if (initiator !== 'agent' && agentSocket.readyState === 1) {
          agentSocket.close(1000, 'Admin disconnected');
        }
      } catch {
        /* already closed */
      }

      // Update session audit log with end time and duration (lock-protected)
      if (sessionEntry?.id) {
        try {
          const endedAt = new Date().toISOString();
          const duration = Math.round(
            (new Date(endedAt).getTime() - new Date(sessionEntry.startedAt).getTime()) / 1000,
          );
          await updateShellSession(sessionEntry.id, { endedAt, duration });
        } catch (err) {
          log.error({ err, label }, 'Failed to update session audit log on close');
        }
      }
    }

    adminSocket.on('close', () => endSession('admin'));
    adminSocket.on('error', (err) => {
      log.error({ err, label }, 'Admin WebSocket error in shell relay');
      endSession('admin');
    });

    agentSocket.on('close', () => endSession('agent'));
    agentSocket.on('error', (err) => {
      log.error({ err, label }, 'Agent WebSocket error in shell relay');
      endSession('agent');
    });
  }

  // GET /api/shell/connect/:label — admin connects to start a shell relay
  fastify.get(
    '/shell/connect/:label',
    { websocket: true, preHandler: fastify.requireRole(['admin']) },
    async (socket, request) => {
      let label;
      try {
        ({ label } = AgentLabelParamSchema.parse(request.params));
      } catch {
        socket.close(1008, 'Invalid agent label');
        return;
      }

      // Run the 5-gate auth chain
      const authResult = await runAdminAuthGates(request, label);
      if (!authResult.ok) {
        request.log.warn({ label, error: authResult.error }, 'Shell relay auth failed');
        socket.send(JSON.stringify({ type: 'error', message: authResult.error }));
        socket.close(authResult.code, authResult.error);
        return;
      }

      // Reject if there is already a pending or active session for this label
      if (pendingAdminConnections.has(label) || activeSessions.has(label)) {
        socket.send(
          JSON.stringify({
            type: 'error',
            message: 'A shell session for this agent is already active',
          }),
        );
        socket.close(4409, 'Session already active');
        return;
      }

      // Create audit log entry
      const sourceIp = extractSourceIp(request);
      let sessionEntry;
      try {
        sessionEntry = await logShellSession({
          agentLabel: label,
          sourceIp,
          status: 'pending',
        });
      } catch (err) {
        request.log.error({ err, label }, 'Failed to create session audit entry');
        socket.send(
          JSON.stringify({ type: 'error', message: 'Failed to create session audit entry' }),
        );
        socket.close(1011, 'Internal error');
        return;
      }

      request.log.info({ label, sessionId: sessionEntry.id }, 'Admin connected for shell relay');

      // Check if agent is already connected and waiting
      if (connectedAgents.has(label)) {
        const agentSocket = connectedAgents.get(label);
        connectedAgents.delete(label);
        request.log.info({ label }, 'Pairing admin with already-connected agent');
        pairSockets(label, socket, agentSocket, sessionEntry, request.log);
        return;
      }

      // Agent not connected yet — store pending and wait
      socket.send(JSON.stringify({ type: 'waiting', message: 'Waiting for agent...' }));

      const timeout = setTimeout(() => {
        if (pendingAdminConnections.has(label)) {
          pendingAdminConnections.delete(label);
          request.log.warn({ label }, 'Shell relay timed out waiting for agent');
          try {
            socket.send(
              JSON.stringify({ type: 'error', message: 'Agent did not connect within 30 seconds' }),
            );
            socket.close(4408, 'Agent connection timeout');
          } catch {
            /* socket may already be closed */
          }
        }
      }, 30_000);

      pendingAdminConnections.set(label, { socket, request, sessionEntry, timeout });

      // Clean up if admin disconnects while waiting
      socket.on('close', () => {
        const pending = pendingAdminConnections.get(label);
        if (pending && pending.socket === socket) {
          clearTimeout(pending.timeout);
          pendingAdminConnections.delete(label);
          request.log.info({ label }, 'Admin disconnected while waiting for agent');
        }
      });

      socket.on('error', (err) => {
        request.log.error({ err, label }, 'Admin WebSocket error while waiting');
        const pending = pendingAdminConnections.get(label);
        if (pending && pending.socket === socket) {
          clearTimeout(pending.timeout);
          pendingAdminConnections.delete(label);
        }
      });
    },
  );

  // GET /api/shell/agent/:label — agent connects to provide shell access
  //
  // Shell access for agents is controlled by the time-limited `shellEnabledUntil`
  // window on the agent registry entry, not by agent certificate capabilities.
  // An admin explicitly enables shell for a specific agent and duration via
  // POST /api/shell/enable/:label.  The agent only needs a valid, non-revoked
  // cert whose label matches the route parameter.
  fastify.get(
    '/shell/agent/:label',
    { websocket: true, preHandler: fastify.requireRole(['agent']) },
    async (socket, request) => {
      let label;
      try {
        ({ label } = AgentLabelParamSchema.parse(request.params));
      } catch {
        socket.close(1008, 'Invalid agent label');
        return;
      }

      // Gate: Global shell must be enabled before accepting agent connections
      const config = await readShellConfig();
      if (!config.enabled) {
        socket.send(
          JSON.stringify({ type: 'error', message: 'Remote shell is not enabled globally' }),
        );
        socket.close(4400, 'Shell not enabled');
        return;
      }

      // Verify the connecting agent cert matches the requested label
      if (request.certRole === 'agent' && request.certLabel !== label) {
        request.log.warn(
          { label, certLabel: request.certLabel },
          'Agent cert label mismatch for shell relay',
        );
        socket.send(
          JSON.stringify({
            type: 'error',
            message: 'Agent certificate does not match the requested label',
          }),
        );
        socket.close(4403, 'Agent label mismatch');
        return;
      }

      // Verify agent shell access is still valid
      const registry = await loadAgentRegistry();
      const agent = registry.agents.find((a) => a.label === label && !a.revoked);
      if (!agent) {
        socket.send(JSON.stringify({ type: 'error', message: `Agent "${label}" not found` }));
        socket.close(4404, 'Agent not found');
        return;
      }

      if (!isAgentShellEnabled(agent)) {
        socket.send(
          JSON.stringify({ type: 'error', message: 'Shell access is not enabled for this agent' }),
        );
        socket.close(4403, 'Shell access not enabled');
        return;
      }

      // Reject if agent is already connected for this label
      if (connectedAgents.has(label) || activeSessions.has(label)) {
        socket.send(
          JSON.stringify({
            type: 'error',
            message: 'An agent connection for this label already exists',
          }),
        );
        socket.close(4409, 'Agent already connected');
        return;
      }

      request.log.info({ label }, 'Agent connected for shell relay');

      // Check if an admin is already waiting
      if (pendingAdminConnections.has(label)) {
        const pending = pendingAdminConnections.get(label);
        pendingAdminConnections.delete(label);
        clearTimeout(pending.timeout);

        request.log.info({ label }, 'Pairing agent with waiting admin');
        pairSockets(label, pending.socket, socket, pending.sessionEntry, request.log);
        return;
      }

      // No admin waiting yet — store agent connection and wait
      connectedAgents.set(label, socket);
      socket.send(JSON.stringify({ type: 'waiting', message: 'Waiting for admin to connect...' }));

      // Clean up if agent disconnects before pairing
      socket.on('close', () => {
        if (connectedAgents.get(label) === socket) {
          connectedAgents.delete(label);
          request.log.info({ label }, 'Agent disconnected before pairing');
        }
      });

      socket.on('error', (err) => {
        request.log.error({ err, label }, 'Agent WebSocket error while waiting');
        if (connectedAgents.get(label) === socket) {
          connectedAgents.delete(label);
        }
      });
    },
  );

  // Clean up all pending connections and active sessions on server shutdown
  fastify.addHook('onClose', async () => {
    for (const [, pending] of pendingAdminConnections) {
      clearTimeout(pending.timeout);
      try {
        pending.socket.close(1001, 'Server shutting down');
      } catch {
        /* ignore */
      }
    }
    pendingAdminConnections.clear();

    for (const [, agentSocket] of connectedAgents) {
      try {
        agentSocket.close(1001, 'Server shutting down');
      } catch {
        /* ignore */
      }
    }
    connectedAgents.clear();

    for (const [, session] of activeSessions) {
      try {
        session.adminSocket.close(1001, 'Server shutting down');
      } catch {
        /* ignore */
      }
      try {
        session.agentSocket.close(1001, 'Server shutting down');
      } catch {
        /* ignore */
      }
    }
    activeSessions.clear();
  });
}
