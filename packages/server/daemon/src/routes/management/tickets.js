import { z } from 'zod';
import {
  RegisterScopeSchema,
  RegisterInstanceSchema,
  RequestTicketSchema,
  ValidateTicketSchema,
  CreateSessionSchema,
  UpdateSessionSchema,
  AssignmentSchema,
  TicketScopeNameSchema,
  registerScope,
  listScopes,
  unregisterScope,
  registerInstance,
  deregisterInstance,
  instanceHeartbeat,
  createAssignment,
  removeAssignment,
  listAssignments,
  requestTicket,
  getTicketInbox,
  validateTicket,
  listTickets,
  revokeTicket,
  createSession,
  sessionHeartbeat,
  updateSession,
  killSession,
  listSessions,
} from '../../lib/tickets.js';

// Param validation schemas
const HexIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-f0-9]+$/);
const SessionIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
// Accepts regular agent labels (e.g., "macbook-pro") and plugin-agent labels
// (e.g., "plugin-agent:macbook-pro:raspi-sync")
const AgentLabelSchema = z
  .string()
  .min(1)
  .max(150)
  .regex(/^[a-zA-Z0-9_:-]+$/);
const InstanceScopeSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^plugin:[a-z0-9-]+:[a-z0-9-]+:[a-f0-9]+$/);

export default async function ticketRoutes(fastify, _opts) {
  // -----------------------------------------------------------------------
  // Ticket scope management (admin only)
  // -----------------------------------------------------------------------

  // POST /api/tickets/scopes — Register ticket scopes
  fastify.post(
    '/tickets/scopes',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const body = RegisterScopeSchema.parse(request.body);
      try {
        const result = await registerScope(body, request.log);
        return reply.code(201).send(result);
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );

  // GET /api/tickets/scopes — List registered scopes
  fastify.get(
    '/tickets/scopes',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      try {
        const result = await listScopes();
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );

  // DELETE /api/tickets/scopes/:name — Unregister ticket scopes
  fastify.delete(
    '/tickets/scopes/:name',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const name = TicketScopeNameSchema.parse(request.params.name);
      try {
        const result = await unregisterScope(name, request.log);
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );

  // -----------------------------------------------------------------------
  // Instance registration (agent, scoped)
  // -----------------------------------------------------------------------

  // POST /api/tickets/instances — Register or re-register as scope host
  fastify.post(
    '/tickets/instances',
    { preHandler: fastify.requireRole(['admin', 'agent']) },
    async (request, reply) => {
      const body = RegisterInstanceSchema.parse(request.body);
      try {
        // Verify caller has the base scope capability
        if (request.certRole === 'agent') {
          const caps = request.certCapabilities || [];
          if (!caps.includes(body.scope)) {
            return reply.code(403).send({ error: 'Insufficient capability' });
          }
        }

        const agentLabel = request.certLabel;
        if (!agentLabel) {
          return reply.code(400).send({ error: 'Agent label required' });
        }
        const result = await registerInstance(body.scope, body.transport, agentLabel, request.log);
        return reply.code(result.isReregistration ? 200 : 201).send({
          ok: result.ok,
          instanceId: result.instanceId,
          instanceScope: result.instanceScope,
        });
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );

  // DELETE /api/tickets/instances/:instanceId — Deregister instance
  fastify.delete(
    '/tickets/instances/:instanceId',
    { preHandler: fastify.requireRole(['admin', 'agent']) },
    async (request, reply) => {
      const instanceId = HexIdSchema.parse(request.params.instanceId);
      try {
        const result = await deregisterInstance(
          instanceId,
          request.certLabel,
          request.certRole,
          request.log,
        );
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );

  // POST /api/tickets/instances/:instanceId/heartbeat — Instance liveness
  fastify.post(
    '/tickets/instances/:instanceId/heartbeat',
    { preHandler: fastify.requireRole(['admin', 'agent']) },
    async (request, reply) => {
      const instanceId = HexIdSchema.parse(request.params.instanceId);
      try {
        const agentLabel = request.certLabel;
        if (!agentLabel) {
          return reply.code(400).send({ error: 'Agent label required' });
        }
        // Defense-in-depth: reject agents with no capabilities before acquiring
        // the lock. The library's instanceHeartbeat verifies the specific scope.
        if (request.certRole === 'agent') {
          const caps = request.certCapabilities || [];
          if (caps.length === 0) {
            return reply.code(404).send({ error: 'Not found' });
          }
        }
        const result = await instanceHeartbeat(instanceId, agentLabel);
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );

  // -----------------------------------------------------------------------
  // Instance assignment (admin only)
  // -----------------------------------------------------------------------

  // POST /api/tickets/assignments — Assign agent to instance
  fastify.post(
    '/tickets/assignments',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const body = AssignmentSchema.parse(request.body);
      try {
        const { isExisting, ...response } = await createAssignment(
          body.agentLabel,
          body.instanceScope,
          request.log,
        );
        return reply.code(isExisting ? 200 : 201).send(response);
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );

  // DELETE /api/tickets/assignments/:agentLabel/:instanceScope — Remove assignment
  fastify.delete(
    '/tickets/assignments/:agentLabel/:instanceScope',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const agentLabel = AgentLabelSchema.parse(request.params.agentLabel);
      const instanceScope = InstanceScopeSchema.parse(request.params.instanceScope);
      try {
        const result = await removeAssignment(agentLabel, instanceScope, request.log);
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );

  // GET /api/tickets/assignments — List all assignments
  fastify.get(
    '/tickets/assignments',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const filters = {};
      if (request.query.agentLabel)
        filters.agentLabel = AgentLabelSchema.parse(request.query.agentLabel);
      if (request.query.instanceScope)
        filters.instanceScope = InstanceScopeSchema.parse(request.query.instanceScope);
      try {
        const result = await listAssignments(filters);
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );

  // -----------------------------------------------------------------------
  // Ticket operations (agent, scoped)
  // -----------------------------------------------------------------------

  // POST /api/tickets — Request a ticket
  fastify.post(
    '/tickets',
    { preHandler: fastify.requireRole(['admin', 'agent']) },
    async (request, reply) => {
      const body = RequestTicketSchema.parse(request.body);
      try {
        // Verify caller has the base scope capability
        if (request.certRole === 'agent') {
          const caps = request.certCapabilities || [];
          if (!caps.includes(body.scope)) {
            return reply.code(404).send({ error: 'Not found' });
          }
        }

        const sourceLabel = request.certLabel;
        if (!sourceLabel) {
          return reply.code(400).send({ error: 'Agent label required' });
        }
        const result = await requestTicket(
          body.scope,
          body.instanceId,
          body.target,
          sourceLabel,
          request.log,
        );
        return reply.code(201).send(result);
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );

  // GET /api/tickets/inbox — Retrieve pending tickets
  fastify.get(
    '/tickets/inbox',
    { preHandler: fastify.requireRole(['admin', 'agent']) },
    async (request, reply) => {
      try {
        const agentLabel = request.certLabel;
        if (!agentLabel) {
          return reply.code(400).send({ error: 'Agent label required' });
        }
        const result = await getTicketInbox(agentLabel);
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );

  // POST /api/tickets/validate — Validate a ticket
  fastify.post(
    '/tickets/validate',
    { preHandler: fastify.requireRole(['admin', 'agent']) },
    async (request, reply) => {
      const body = ValidateTicketSchema.parse(request.body);
      try {
        const callerLabel = request.certLabel;
        if (!callerLabel) {
          return reply.code(401).send({ error: 'Invalid ticket' });
        }
        const result = await validateTicket(body.ticketId, callerLabel, request.log);
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );

  // GET /api/tickets — List active tickets (admin)
  fastify.get(
    '/tickets',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      try {
        const result = await listTickets();
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );

  // DELETE /api/tickets/:ticketId — Revoke a ticket (admin)
  fastify.delete(
    '/tickets/:ticketId',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const ticketId = HexIdSchema.parse(request.params.ticketId);
      try {
        const result = await revokeTicket(ticketId, request.log);
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );

  // -----------------------------------------------------------------------
  // Session management (agent + admin)
  // -----------------------------------------------------------------------

  // POST /api/tickets/sessions — Report session creation
  fastify.post(
    '/tickets/sessions',
    { preHandler: fastify.requireRole(['admin', 'agent']) },
    async (request, reply) => {
      const body = CreateSessionSchema.parse(request.body);
      try {
        const callerLabel = request.certLabel;
        if (!callerLabel) {
          return reply.code(400).send({ error: 'Agent label required' });
        }
        const result = await createSession(body.ticketId, callerLabel, request.log);
        return reply.code(201).send(result);
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );

  // POST /api/tickets/sessions/:sessionId/heartbeat — Session heartbeat
  fastify.post(
    '/tickets/sessions/:sessionId/heartbeat',
    { preHandler: fastify.requireRole(['admin', 'agent']) },
    async (request, reply) => {
      const sessionId = SessionIdSchema.parse(request.params.sessionId);
      try {
        const callerLabel = request.certLabel;
        if (!callerLabel) {
          return reply.code(400).send({ error: 'Agent label required' });
        }
        const result = await sessionHeartbeat(sessionId, callerLabel);
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );

  // PATCH /api/tickets/sessions/:sessionId — Update session status
  fastify.patch(
    '/tickets/sessions/:sessionId',
    { preHandler: fastify.requireRole(['admin', 'agent']) },
    async (request, reply) => {
      const sessionId = SessionIdSchema.parse(request.params.sessionId);
      const body = UpdateSessionSchema.parse(request.body);
      try {
        const callerLabel = request.certLabel;
        if (!callerLabel) {
          return reply.code(400).send({ error: 'Agent label required' });
        }
        const result = await updateSession(sessionId, body.status, callerLabel);
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );

  // DELETE /api/tickets/sessions/:sessionId — Admin kill session
  fastify.delete(
    '/tickets/sessions/:sessionId',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const sessionId = SessionIdSchema.parse(request.params.sessionId);
      try {
        const result = await killSession(sessionId, request.log);
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );

  // GET /api/tickets/sessions — List active sessions (admin)
  fastify.get(
    '/tickets/sessions',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      try {
        const result = await listSessions();
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({ error: err.message });
      }
    },
  );
}
