/**
 * Per-agent self-service routes.
 *
 * `/api/agents/me/*` returns information scoped to the agent identified by
 * its mTLS client certificate (CN=agent:<label>). Admins must specify the
 * label explicitly via separate routes — they have no implicit "me" agent.
 */

import { getChiselCredential, getChiselCredentialIssuedAt } from '../../lib/chisel-users.js';
import {
  rotateAgentChiselCredential,
  getAgentCapabilities,
  getAgentAllowedSites,
} from '../../lib/mtls.js';
import { z } from 'zod';
import { AGENT_LABEL_REGEX, pluginHostCapability } from '@lamalibre/lamaste';
import { RegistryCredentialError } from '@lamalibre/lamaste/server';
import { acquireAgentToken } from '../../lib/registry-credential.js';
import { agentPluginConfig, acknowledgeAgentPluginConfig } from '../../lib/plugin-hosting.js';

/**
 * An agent may rotate its own chisel credential at most this often. Every
 * rotation restarts chisel (the old password must stop working), which drops
 * every agent's tunnels for a few seconds.
 */
const SELF_ROTATE_MIN_INTERVAL_MS = 10 * 60 * 1000;

const PluginRouteParamSchema = z.object({
  route: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Invalid plugin route'),
});

const AckBodySchema = z.object({
  issuedAt: z.string().min(1).max(64),
});

const LabelParamSchema = z.object({
  label: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Invalid agent label'),
});

/**
 * The plugin-config routes admit only a machine agent whose certificate
 * carries the plugin's host capability. The admin master role passes every
 * `requireRole` guard but has no agent identity to serve, so it is refused
 * here too. Returns the reply when refused, undefined when admitted.
 */
function refuseUnlessHostingAgent(request, reply, route) {
  if (request.certRole !== 'agent') {
    return reply
      .code(403)
      .send({ error: 'Only the hosting agent certificate can read a plugin config' });
  }
  const label = request.certLabel;
  if (!label || !AGENT_LABEL_REGEX.test(label)) {
    return reply
      .code(400)
      .send({ error: 'Agent label could not be determined from client certificate' });
  }
  const required = pluginHostCapability(route);
  if (!(request.certCapabilities || []).includes(required)) {
    return reply.code(403).send({
      error: 'Insufficient certificate capability',
      details: { required, granted: request.certCapabilities || [] },
    });
  }
  return undefined;
}

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
  // POST /agents/me/chisel-credential/rotate
  //
  // Replaces the calling agent's chisel credential and returns the new one.
  // An upgraded agent calls this once: versions before the credential moved
  // into a 0600 environment file exposed it in process arguments and a
  // world-readable unit file. Identity comes strictly from the mTLS cert.
  // ------------------------------------------------------------------
  fastify.post(
    '/agents/me/chisel-credential/rotate',
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
      if (!AGENT_LABEL_REGEX.test(label)) {
        return reply
          .code(400)
          .send({ error: 'Plugin-agents do not use chisel tunnel credentials' });
      }
      const issuedAt = await getChiselCredentialIssuedAt(label);
      if (issuedAt && Date.now() - Date.parse(issuedAt) < SELF_ROTATE_MIN_INTERVAL_MS) {
        return reply.code(429).send({
          error: 'The chisel credential was issued less than 10 minutes ago',
          issuedAt,
        });
      }
      try {
        const result = await rotateAgentChiselCredential(label, request.log);
        return {
          user: result.user,
          password: result.password,
          createdAt: result.createdAt,
        };
      } catch (err) {
        const status = err.statusCode || 500;
        return reply.code(status).send({
          error: err.message || 'Failed to rotate chisel credential',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /agents/me/registry-credential
  //
  // Brokers a one-hour, read-only npm registry token for the calling agent
  // so it can `npm install` a plugin from the Lamalibre registry (Feria)
  // without ever holding a long-lived credential. Identity comes strictly
  // from the mTLS cert; the token is owned by `agent:<label>` on the
  // registry, so its audit log says which agent installed what.
  //
  // The token is cached per agent until five minutes before it expires, so
  // repeated installs within the hour get the same one; an agent may be
  // issued at most ten new tokens per hour (429 + Retry-After beyond that).
  // The per-IP limit stays as a backstop.
  //
  // 404 when the panel has no registry credential configured — the agent
  // then installs from the public registry as before.
  // ------------------------------------------------------------------
  fastify.get(
    '/agents/me/registry-credential',
    {
      preHandler: fastify.requireRole(['agent']),
      // One token per install is the expected rate; this only stops a loop.
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      // requireRole lets the admin master role through every guard; an admin
      // certificate has no agent identity to broker for. Plugin-agents pass
      // here and are answered 400 below.
      if (request.certRole !== 'agent' && request.certRole !== 'plugin-agent') {
        return reply
          .code(403)
          .send({ error: 'Only an agent certificate can obtain a registry credential' });
      }
      const label = request.certLabel;
      if (!label) {
        return reply.code(400).send({
          error: 'Agent label could not be determined from client certificate',
        });
      }
      if (!AGENT_LABEL_REGEX.test(label)) {
        return reply.code(400).send({ error: 'Plugin-agents do not install plugins' });
      }
      try {
        const acquired = await acquireAgentToken(label);
        if (!acquired) {
          return reply.code(404).send({
            error: 'No registry credential is configured on this panel',
            hint: 'lamaste-server registry-credential set --url <registry> --oidc',
          });
        }
        if (!acquired.ok) {
          request.log.warn(
            { label, retryAfterSeconds: acquired.retryAfterSeconds },
            'Agent exceeded its registry token issuance limit',
          );
          return reply.code(429).header('Retry-After', String(acquired.retryAfterSeconds)).send({
            error: 'This agent has been issued its hourly share of registry tokens',
            retryAfterSeconds: acquired.retryAfterSeconds,
          });
        }
        const { credential } = acquired;
        request.log.info(
          {
            label,
            tokenId: credential.tokenId,
            expiresAt: credential.expiresAt,
            cached: acquired.cached,
          },
          acquired.cached ? 'Reused registry token for agent' : 'Brokered registry token for agent',
        );
        return credential;
      } catch (err) {
        const status = err instanceof RegistryCredentialError ? err.statusCode : 502;
        request.log.warn({ label, err: err.message }, 'Failed to broker registry token');
        return reply.code(status).send({ error: err.message || 'Failed to broker registry token' });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /agents/me/plugin-config/:route
  //
  // The config of an agent-hosted plugin hosted on the calling agent: the
  // port its agent half listens on and the installation secret (plus the
  // previous secret during a rotation). Only the hosting agent can read it:
  // its certificate must carry `plugin:<route>:host`, which hosting granted,
  // and the hosting must name it. Identity comes strictly from the mTLS
  // certificate.
  // ------------------------------------------------------------------
  fastify.get(
    '/agents/me/plugin-config/:route',
    {
      preHandler: fastify.requireRole(['agent']),
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { route } = PluginRouteParamSchema.parse(request.params);
      const refused = refuseUnlessHostingAgent(request, reply, route);
      if (refused) return refused;
      const config = await agentPluginConfig(request.certLabel, route);
      if (!config) {
        return reply.code(404).send({ error: `Plugin "${route}" is not hosted on this agent` });
      }
      return config;
    },
  );

  // ------------------------------------------------------------------
  // POST /agents/me/plugin-config/:route/ack
  //
  // The hosting agent confirms it holds the secret issued at `issuedAt`.
  // From then on the panel's forwarder signs with it and drops the previous
  // one. An `issuedAt` that is not the current secret's is answered with
  // `acknowledged: false` and the current `secretIssuedAt`, so the agent
  // fetches again.
  // ------------------------------------------------------------------
  fastify.post(
    '/agents/me/plugin-config/:route/ack',
    {
      preHandler: fastify.requireRole(['agent']),
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { route } = PluginRouteParamSchema.parse(request.params);
      const body = AckBodySchema.parse(request.body);
      const refused = refuseUnlessHostingAgent(request, reply, route);
      if (refused) return refused;
      const result = await acknowledgeAgentPluginConfig(request.certLabel, route, body.issuedAt);
      if (!result) {
        return reply.code(404).send({ error: `Plugin "${route}" is not hosted on this agent` });
      }
      request.log.info(
        { label: request.certLabel, plugin: route, acknowledged: result.acknowledged },
        'Plugin config acknowledgement',
      );
      return { ok: true, ...result };
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
