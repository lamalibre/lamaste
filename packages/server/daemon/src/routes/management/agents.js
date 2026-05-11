/**
 * Per-agent self-service routes.
 *
 * `/api/agents/me/*` returns information scoped to the agent identified by
 * its mTLS client certificate (CN=agent:<label>). Admins must specify the
 * label explicitly via separate routes — they have no implicit "me" agent.
 */

import { getChiselCredential } from '../../lib/chisel-users.js';
import {
  rotateAgentChiselCredential,
  getAgentCapabilities,
  getAgentAllowedSites,
} from '../../lib/mtls.js';
import { z } from 'zod';

const LabelParamSchema = z.object({
  label: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Invalid agent label'),
});

export default async function agentsRoutes(fastify, _opts) {
  // ------------------------------------------------------------------
  // GET /agents/me/chisel-credential
  //
  // Returns the calling agent's chisel tunnel-server credential.
  // Identifies the agent strictly via the mTLS cert label — never accepts
  // a label query parameter, so a compromised agent cannot leak others'
  // credentials.
  // ------------------------------------------------------------------
  fastify.get(
    '/agents/me/chisel-credential',
    {
      preHandler: fastify.requireRole(['agent'], { capability: 'tunnels:read' }),
    },
    async (request, reply) => {
      const label = request.certLabel;
      if (!label) {
        return reply.code(400).send({
          error: 'Agent label could not be determined from client certificate',
        });
      }
      const credential = await getChiselCredential(label);
      if (!credential) {
        return reply.code(404).send({
          error: 'No chisel credential found for this agent',
          hint:
            'Ask an admin to run `lamaste-server chisel rotate-credential --label ' +
            label +
            '` to provision a credential.',
        });
      }
      return credential;
    },
  );

  // ------------------------------------------------------------------
  // GET /agents/me/capabilities
  //
  // Returns the calling agent's capabilities and allowedSites. Used by the
  // agent daemon (lamaste-agentd) to enforce per-route capability checks
  // when a non-admin mTLS cert calls its REST API.
  //
  // Cert identity is taken strictly from `request.certLabel` (set by the
  // mtls middleware from the cert CN). No body/query inputs — a compromised
  // agent cannot ask for another agent's capabilities.
  //
  // Admin callers need an explicit label since they have no implicit "me"
  // agent — they get an empty payload (admins are unconstrained).
  // ------------------------------------------------------------------
  fastify.get(
    '/agents/me/capabilities',
    {
      preHandler: fastify.requireRole(['admin', 'agent']),
    },
    async (request, reply) => {
      // Admin has no "me" agent — return empty (admin is master, no caps needed)
      if (request.certRole === 'admin') {
        return { capabilities: [], allowedSites: [], role: 'admin' };
      }
      const label = request.certLabel;
      if (!label) {
        return reply.code(400).send({
          error: 'Agent label could not be determined from client certificate',
        });
      }
      // Re-fetch from registry rather than reusing request.certCapabilities.
      // The mtls middleware filters caps against currently-valid ones, but
      // an explicit registry read here is the canonical source — keeps this
      // endpoint robust to middleware changes.
      const capabilities = await getAgentCapabilities(label);
      const allowedSites = await getAgentAllowedSites(label);
      return { capabilities, allowedSites, role: request.certRole };
    },
  );

  // ------------------------------------------------------------------
  // POST /agents/:label/chisel-credential/rotate (admin only)
  //
  // Mints a new chisel password for the named agent and writes the
  // updated authfile. Triggers a chisel restart. Returns the new
  // credential so the admin can hand it off out-of-band — but the
  // expected flow is for the agent to re-fetch via the /me endpoint.
  // ------------------------------------------------------------------
  fastify.post(
    '/agents/:label/chisel-credential/rotate',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = LabelParamSchema.parse(request.params);
      try {
        const result = await rotateAgentChiselCredential(params.label, request.log);
        return result;
      } catch (err) {
        const status = err.statusCode || 500;
        return reply.code(status).send({
          error: err.message || 'Failed to rotate chisel credential',
        });
      }
    },
  );
}
