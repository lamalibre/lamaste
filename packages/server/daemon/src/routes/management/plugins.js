import { z } from 'zod';
import {
  readPlugins,
  installPlugin,
  uninstallPlugin,
  enablePlugin,
  disablePlugin,
  getPluginCapabilities,
} from '../../lib/plugins.js';
import { setPluginCapabilities, loadAgentRegistry } from '../../lib/mtls.js';
import {
  readPushInstallConfig,
  readPushInstallSessions,
  updatePushInstallConfigFields,
  createPushInstallPolicy,
  updatePushInstallPolicy,
  deletePushInstallPolicy,
  enableAgentPushInstall,
  disableAgentPushInstall,
  logPushInstallSession,
  validatePushInstallAccess,
} from '../../lib/push-install.js';

// --- Zod schemas ---

const PluginNameParamSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Plugin name must contain only lowercase letters, numbers, and hyphens'),
});

const InstallBodySchema = z.object({
  packageName: z
    .string()
    .min(1)
    .max(200)
    .regex(/^@lamalibre\//, 'Package must be in the @lamalibre/ scope'),
});

// --- Push install schemas ---

const IpEntrySchema = z.string().refine(
  (val) => {
    // Accept bare IPv4 or IPv4/CIDR
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
    const cidr = /^(\d{1,3}\.){3}\d{1,3}\/(\d{1,2})$/;

    if (ipv4.test(val)) return true;

    if (cidr.test(val)) {
      const prefix = parseInt(val.split('/')[1], 10);
      return prefix >= 0 && prefix <= 32;
    }

    return false;
  },
  { message: 'Must be a valid IPv4 address or CIDR (e.g. 192.168.1.0/24)' },
);

const PolicyIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9-]+$/, 'Policy ID must contain only lowercase letters, numbers, and hyphens');

const ScopedPackageSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^@lamalibre\//, 'Package must be in the @lamalibre/ scope');

const CreatePolicySchema = z.object({
  name: z.string().min(1).max(100),
  id: PolicyIdSchema.optional(),
  description: z.string().max(500).optional().default(''),
  allowedIps: z.array(IpEntrySchema).optional().default([]),
  deniedIps: z.array(IpEntrySchema).optional().default([]),
  allowedPlugins: z.array(ScopedPackageSchema).optional().default([]),
  allowedActions: z
    .array(z.enum(['install', 'update', 'uninstall', 'check-prerequisites']))
    .optional()
    .default(['install', 'update', 'check-prerequisites']),
});

const UpdatePolicySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  allowedIps: z.array(IpEntrySchema).optional(),
  deniedIps: z.array(IpEntrySchema).optional(),
  allowedPlugins: z.array(ScopedPackageSchema).optional(),
  allowedActions: z
    .array(z.enum(['install', 'update', 'uninstall', 'check-prerequisites']))
    .optional(),
});

const UpdatePushInstallConfigSchema = z.object({
  enabled: z.boolean().optional(),
  defaultPolicy: PolicyIdSchema.optional(),
});

const EnablePushInstallSchema = z.object({
  durationMinutes: z.number().int().min(5).max(480),
  policyId: PolicyIdSchema.optional(),
});

const AgentLabelParamSchema = z.object({
  label: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Invalid agent label'),
});

const PushInstallCommandSchema = z
  .object({
    action: z.enum(['install', 'update', 'uninstall', 'check-prerequisites']),
    packageName: z
      .string()
      .min(1)
      .max(200)
      .regex(/^@lamalibre\//, 'Package must be in the @lamalibre/ scope')
      .optional(),
  })
  .refine(
    (data) => {
      if (data.action === 'install' || data.action === 'update' || data.action === 'uninstall') {
        return !!data.packageName;
      }
      return true;
    },
    {
      message: 'packageName is required for install, update, and uninstall actions',
      path: ['packageName'],
    },
  );

export default async function pluginRoutes(fastify, _opts) {
  // ===========================================================================
  // Plugin management routes
  // ===========================================================================

  // ------------------------------------------------------------------
  // GET /plugins — list all plugins
  // ------------------------------------------------------------------
  fastify.get(
    '/plugins',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (_request, _reply) => {
      const registry = await readPlugins();
      return { plugins: registry.plugins };
    },
  );

  // ------------------------------------------------------------------
  // GET /plugins/:name — get plugin details
  // ------------------------------------------------------------------
  fastify.get(
    '/plugins/:name',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);
      const registry = await readPlugins();
      const plugin = registry.plugins.find((p) => p.name === params.name);

      if (!plugin) {
        return reply.code(404).send({ error: `Plugin "${params.name}" not found` });
      }

      return { plugin };
    },
  );

  // ------------------------------------------------------------------
  // POST /plugins/install — install a plugin
  // ------------------------------------------------------------------
  fastify.post(
    '/plugins/install',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const body = InstallBodySchema.parse(request.body);

      try {
        const plugin = await installPlugin(body.packageName, request.log);
        // Refresh in-memory capability list so new plugin caps are valid immediately
        setPluginCapabilities(await getPluginCapabilities());
        return { ok: true, plugin };
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({
          error: err.message || 'Plugin installation failed',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /plugins/:name/enable — enable a plugin
  // ------------------------------------------------------------------
  fastify.post(
    '/plugins/:name/enable',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);

      try {
        const result = await enablePlugin(params.name, request.log);
        setPluginCapabilities(await getPluginCapabilities());
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({
          error: err.message || 'Failed to enable plugin',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /plugins/:name/disable — disable a plugin
  // ------------------------------------------------------------------
  fastify.post(
    '/plugins/:name/disable',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);

      try {
        const result = await disablePlugin(params.name, request.log);
        setPluginCapabilities(await getPluginCapabilities());
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({
          error: err.message || 'Failed to disable plugin',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // DELETE /plugins/:name — uninstall a plugin (must be disabled)
  // ------------------------------------------------------------------
  fastify.delete(
    '/plugins/:name',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);

      try {
        const result = await uninstallPlugin(params.name, request.log);
        setPluginCapabilities(await getPluginCapabilities());
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({
          error: err.message || 'Plugin uninstall failed',
        });
      }
    },
  );

  // ===========================================================================
  // Push install routes
  // ===========================================================================

  // ------------------------------------------------------------------
  // GET /plugins/push-install/config — get push install config
  // ------------------------------------------------------------------
  fastify.get(
    '/plugins/push-install/config',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (_request, _reply) => {
      const config = await readPushInstallConfig();
      return config;
    },
  );

  // ------------------------------------------------------------------
  // PATCH /plugins/push-install/config — update push install config
  // ------------------------------------------------------------------
  fastify.patch(
    '/plugins/push-install/config',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const body = UpdatePushInstallConfigSchema.parse(request.body);

      try {
        const config = await updatePushInstallConfigFields(body);
        return { ok: true, ...config };
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({
          error: err.message || 'Failed to update push install config',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /plugins/push-install/policies — list push install policies
  // ------------------------------------------------------------------
  fastify.get(
    '/plugins/push-install/policies',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (_request, _reply) => {
      const config = await readPushInstallConfig();
      return { policies: config.policies };
    },
  );

  // ------------------------------------------------------------------
  // POST /plugins/push-install/policies — create push install policy
  // ------------------------------------------------------------------
  fastify.post(
    '/plugins/push-install/policies',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const body = CreatePolicySchema.parse(request.body);

      try {
        const policy = await createPushInstallPolicy(body);
        return { ok: true, policy };
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({
          error: err.message || 'Failed to create policy',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // PATCH /plugins/push-install/policies/:id — update push install policy
  // ------------------------------------------------------------------
  fastify.patch(
    '/plugins/push-install/policies/:id',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const { id } = z.object({ id: PolicyIdSchema }).parse(request.params);
      const body = UpdatePolicySchema.parse(request.body);

      try {
        const policy = await updatePushInstallPolicy(id, body);
        return { ok: true, policy };
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({
          error: err.message || 'Failed to update policy',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // DELETE /plugins/push-install/policies/:id — delete push install policy
  // ------------------------------------------------------------------
  fastify.delete(
    '/plugins/push-install/policies/:id',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const { id } = z.object({ id: PolicyIdSchema }).parse(request.params);

      try {
        const result = await deletePushInstallPolicy(id);
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({
          error: err.message || 'Failed to delete policy',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /plugins/push-install/enable/:label — enable push install for agent
  // ------------------------------------------------------------------
  fastify.post(
    '/plugins/push-install/enable/:label',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = AgentLabelParamSchema.parse(request.params);
      const body = EnablePushInstallSchema.parse(request.body);

      try {
        const result = await enableAgentPushInstall(
          params.label,
          body.durationMinutes,
          body.policyId,
        );
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({
          error: err.message || 'Failed to enable push install',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // DELETE /plugins/push-install/enable/:label — disable push install for agent
  // ------------------------------------------------------------------
  fastify.delete(
    '/plugins/push-install/enable/:label',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = AgentLabelParamSchema.parse(request.params);

      try {
        const result = await disableAgentPushInstall(params.label);
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({
          error: err.message || 'Failed to disable push install',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /plugins/push-install/:label — send push install command
  // ------------------------------------------------------------------
  fastify.post(
    '/plugins/push-install/:label',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = AgentLabelParamSchema.parse(request.params);
      const body = PushInstallCommandSchema.parse(request.body);

      // Validate push install access (5-gate auth)
      const access = await validatePushInstallAccess(params.label, request.ip);
      if (!access.ok) {
        return reply.code(access.statusCode).send({ error: access.error });
      }

      // Check if the action is allowed by the policy
      if (
        access.policy.allowedActions &&
        access.policy.allowedActions.length > 0 &&
        !access.policy.allowedActions.includes(body.action)
      ) {
        return reply.code(403).send({
          error: `Action "${body.action}" is not allowed by the assigned policy`,
        });
      }

      // Check if the package is allowed by the policy
      if (
        body.packageName &&
        access.policy.allowedPlugins &&
        access.policy.allowedPlugins.length > 0 &&
        !access.policy.allowedPlugins.includes(body.packageName)
      ) {
        return reply.code(403).send({
          error: `Package "${body.packageName}" is not allowed by the assigned policy`,
        });
      }

      // Log the session
      await logPushInstallSession({
        agentLabel: params.label,
        action: body.action,
        packageName: body.packageName || null,
        sourceIp: request.ip,
        policyId: access.policy.id,
        status: 'sent',
      });

      // The actual command execution happens on the agent side.
      // This endpoint signals intent; the agent polls or receives via WebSocket.
      return {
        ok: true,
        label: params.label,
        action: body.action,
        packageName: body.packageName || null,
        message: `Push install command "${body.action}" sent to agent "${params.label}"`,
      };
    },
  );

  // ------------------------------------------------------------------
  // GET /plugins/push-install/sessions — audit log
  // ------------------------------------------------------------------
  fastify.get(
    '/plugins/push-install/sessions',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (_request, _reply) => {
      const sessions = await readPushInstallSessions();
      return { sessions };
    },
  );

  // ------------------------------------------------------------------
  // GET /plugins/push-install/agent-status — agent self-check
  // ------------------------------------------------------------------
  fastify.get(
    '/plugins/push-install/agent-status',
    {
      preHandler: fastify.requireRole(['admin', 'agent']),
    },
    async (request, _reply) => {
      const label = request.certLabel;
      if (!label) {
        return { pushInstallEnabled: false };
      }

      const registry = await loadAgentRegistry();
      const agent = registry.agents.find((a) => a.label === label && !a.revoked);

      if (!agent) {
        return { pushInstallEnabled: false };
      }

      const enabled =
        agent.pushInstallEnabledUntil && new Date(agent.pushInstallEnabledUntil) > new Date();

      return {
        pushInstallEnabled: !!enabled,
        pushInstallEnabledUntil: agent.pushInstallEnabledUntil || null,
        pushInstallPolicy: agent.pushInstallPolicy || null,
      };
    },
  );
}
