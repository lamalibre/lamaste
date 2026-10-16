import { z } from 'zod';
import { AGENT_HALF_SETTINGS_MAX_BYTES, AGENT_LABEL_REGEX } from '@lamalibre/lamaste';
import {
  readPlugins,
  installPlugin,
  enablePlugin,
  disablePlugin,
  getPluginCapabilities,
  findPlugin,
} from '../../lib/plugins.js';
import { setPluginCapabilities, loadAgentRegistry } from '../../lib/mtls.js';
import { listPluginOidcClients, rotatePluginOidcClientSecret } from '../../lib/plugin-oidc.js';
import {
  hostPlugin,
  unhostPlugin,
  getHostingView,
  attachHostings,
  rotateHostingSecret,
  hostingEligibility,
  retainedDataOf,
  purgeRetainedData,
} from '../../lib/plugin-hosting.js';
import { listRetainedData } from '../../lib/retained-data.js';
import {
  hookStatus,
  approveHookSet,
  setAutoApprove,
  setPendingUpdate,
  readHookState,
} from '../../lib/plugin-hooks.js';
import { uninstallPluginWithHosting, updatePlugin } from '../../lib/plugin-lifecycle.js';
import {
  getPluginOperation,
  listPluginOperations,
  takeOperationReveal,
} from '../../lib/plugin-operations.js';
import {
  attachSettingsSummaries,
  getPluginSettingsView,
  updatePluginSettings,
} from '../../lib/plugin-settings.js';
import { actorFromRequest, certSerialFromRequest } from '../../lib/actor.js';
import { recordAudit } from '../../lib/audit.js';
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
  pushInstallPolicyRefusal,
  PUSH_INSTALL_ACTIONS,
  PUSH_INSTALL_WINDOW_MINUTES,
} from '../../lib/push-install.js';

// --- Zod schemas ---

const PluginNameParamSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Plugin name must contain only lowercase letters, numbers, and hyphens'),
});

const OidcClientIdParamSchema = z.object({
  clientId: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Client id must be lowercase letters, numbers and hyphens'),
});

const AgentLabelSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Invalid agent label');

const HostingBodySchema = z.object({
  agentLabel: AgentLabelSchema,
});

const RetainedDataQuerySchema = z.object({
  agentLabel: AgentLabelSchema,
  // Drop the relay's record only; the agent is not touched.
  forget: z.enum(['true', 'false']).optional(),
});

const ForceQuerySchema = z.object({
  force: z.enum(['true', 'false']).optional(),
  // Remove the data directory and service account of an agent half Lamaste installed.
  purge: z.enum(['true', 'false']).optional(),
});

/**
 * The error body of a refused plugin operation: the message, and what a
 * client acts on — `code` (`hooks_not_approved`, `agent_not_eligible` with
 * its `reasons`, `push_install_refused`, `route_taken`, `route_conflict`,
 * `hosting_owner_mismatch`, `retained_data_conflict` with the `retained`
 * record, `retained_data_in_use`, `agent_not_enrolled`) and a running
 * operation's id.
 */
function operationErrorBody(err, fallback) {
  return {
    error: err.message || fallback,
    ...(err.code ? { code: err.code } : {}),
    ...(Array.isArray(err.reasons) ? { reasons: err.reasons } : {}),
    ...(err.retained ? { retained: err.retained } : {}),
    ...(err.owner ? { route: err.route, owner: err.owner } : {}),
    ...(err.operationId ? { operationId: err.operationId } : {}),
  };
}

/**
 * The error body of a refused settings read or change: the message and what
 * a client acts on — `code` (`no_settings`, `operation_running` with the
 * operation's id, `hosting_offline` with the `hosting`, `revision_mismatch`
 * with the current `revision`, `schema_mismatch`, `settings_unsupported`,
 * `refused`, `timeout`, …) and `errors` per field (400: the panel's check,
 * 422: the agent half's). Built from what the settings library put on the
 * error — never from the request body.
 */
function settingsErrorBody(err, fallback) {
  // Only the settings library's own refusals carry a status; anything else
  // is answered without its message.
  if (!err.statusCode) return { error: fallback };
  return {
    error: err.message,
    ...(err.code ? { code: err.code } : {}),
    ...(err.errors ? { errors: err.errors } : {}),
    ...(Number.isInteger(err.revision) ? { revision: err.revision } : {}),
    ...(err.operationId ? { operationId: err.operationId } : {}),
    ...(err.hosting !== undefined ? { hosting: err.hosting } : {}),
    // The agent half's own status, when it refused with an unexpected one.
    ...(Number.isInteger(err.status) ? { status: err.status } : {}),
  };
}

const OperationParamSchema = z.object({
  id: z.string().uuid(),
});

/**
 * `digest`: the approval digest that was shown — the installed version's or
 * a pending update's. `version`: a pending update's version, which approves
 * that update (with its digest, null when it brings neither relay hooks nor
 * an agent half).
 */
const ApproveHooksBodySchema = z
  .object({
    digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/, 'digest is a SHA-256 hex string')
      .nullable()
      .optional(),
    version: z
      .string()
      .regex(/^[0-9A-Za-z.+-]{1,64}$/, 'version is a plugin version')
      .optional(),
  })
  .strict()
  .refine((body) => (body.digest ?? null) !== null || body.version !== undefined, {
    message: 'digest or version is required',
  });

const AutoApproveBodySchema = z.object({ enabled: z.boolean() }).strict();

const UpdateBodySchema = z
  .object({
    version: z
      .string()
      .regex(/^[0-9A-Za-z.+-]{1,64}$/, 'version is an exact version or a dist-tag')
      .optional(),
  })
  .strict();

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
    .array(z.enum(PUSH_INSTALL_ACTIONS))
    .optional()
    .default([...PUSH_INSTALL_ACTIONS]),
});

const UpdatePolicySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  allowedIps: z.array(IpEntrySchema).optional(),
  deniedIps: z.array(IpEntrySchema).optional(),
  allowedPlugins: z.array(ScopedPackageSchema).optional(),
  allowedActions: z.array(z.enum(PUSH_INSTALL_ACTIONS)).optional(),
});

const UpdatePushInstallConfigSchema = z.object({
  enabled: z.boolean().optional(),
  defaultPolicy: PolicyIdSchema.optional(),
});

const WINDOW_BOUNDS = `A push-install window is open ${PUSH_INSTALL_WINDOW_MINUTES.min} to ${PUSH_INSTALL_WINDOW_MINUTES.max} minutes`;

const EnablePushInstallSchema = z.object({
  durationMinutes: z
    .number({ invalid_type_error: WINDOW_BOUNDS, required_error: WINDOW_BOUNDS })
    .int(WINDOW_BOUNDS)
    .min(PUSH_INSTALL_WINDOW_MINUTES.min, WINDOW_BOUNDS)
    .max(PUSH_INSTALL_WINDOW_MINUTES.max, WINDOW_BOUNDS),
  policyId: PolicyIdSchema.optional(),
});

/** A machine agent's label (a DNS label of up to 63 characters, as enrolment allows). */
const AgentLabelParamSchema = z.object({
  label: z.string().regex(AGENT_LABEL_REGEX, 'Invalid agent label'),
});

/** The push-install config as the panel shows it, with the window bounds. */
function pushInstallConfigView(config) {
  return { ...config, windowMinutes: PUSH_INSTALL_WINDOW_MINUTES };
}

const PushInstallCommandSchema = z
  .object({
    action: z.enum(PUSH_INSTALL_ACTIONS),
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

/** A plugin entry with a summary of its hooks for list views. */
async function withHooks(plugin) {
  const status = await hookStatus(plugin);
  return {
    ...plugin,
    hooks: {
      relay: status.relay !== null,
      agent: status.agent !== null,
      // Lamaste installs the agent half (agent.package); false: none, or installed by hand.
      agentHalf: status.agentHalf !== null,
      approval: status.approval.state,
      autoApprove: status.autoApprove,
      failOpenCount: status.relay?.failOpenCount ?? 0,
      pendingUpdate: status.pendingUpdate
        ? { version: status.pendingUpdate.version, digest: status.pendingUpdate.digest }
        : null,
    },
  };
}

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
      // `agentHosting`: where an agent-hosted plugin's agent half runs, or null.
      // `retainedData`: what agents keep of its agent half after it was
      // removed without purge. `hooks`: its lifecycle hooks and their
      // approval (see GET /plugins/:name/hooks).
      // `settings`: for a plugin that declares settings, whether it still
      // needs configuration — { configured, missing, syncedAt }, no values
      // (see GET /plugins/:name/settings).
      const plugins = await attachSettingsSummaries(await attachHostings(registry.plugins));
      return {
        plugins: await Promise.all(plugins.map(withHooks)),
        // Every agent's retained data — of uninstalled plugins too, which
        // no entry of `plugins` lists any more.
        retainedData: await listRetainedData(),
      };
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

      const [withHosting] = await attachSettingsSummaries(await attachHostings([plugin]));
      return { plugin: await withHooks(withHosting) };
    },
  );

  // ===========================================================================
  // Hosting an agent-hosted plugin's agent half on an agent
  // ===========================================================================

  // ------------------------------------------------------------------
  // GET /plugins/:name/hosting — which agent hosts the plugin, port, health
  // ------------------------------------------------------------------
  fastify.get(
    '/plugins/:name/hosting',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);
      const registry = await readPlugins();
      if (!registry.plugins.some((p) => p.name === params.name)) {
        return reply.code(404).send({ error: `Plugin "${params.name}" not found` });
      }
      const hosting = await getHostingView(params.name);
      if (!hosting) {
        return reply.code(404).send({ error: `Plugin "${params.name}" is not hosted on an agent` });
      }
      return { hosting };
    },
  );

  // ------------------------------------------------------------------
  // POST /plugins/:name/hosting — host the plugin on an agent: internal
  // tunnel (port assigned), installation secret, host capability, and the
  // agent half when Lamaste installs it (the agent must be eligible —
  // 409 agent_not_eligible with reasons — and the push-install gates must
  // allow `install` of the agent package — push_install_refused)
  // ------------------------------------------------------------------
  fastify.post(
    '/plugins/:name/hosting',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);
      const body = HostingBodySchema.parse(request.body);
      try {
        const operation = await hostPlugin(params.name, body.agentLabel, {
          actor: actorFromRequest(request),
          logger: request.log,
          sourceIp: request.ip,
        });
        return reply.code(202).send({ ok: true, operation });
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send(operationErrorBody(err, 'Failed to host plugin'));
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /plugins/:name/hosting/eligibility — which enrolled agents can host
  // the plugin, and why the others cannot (the host dialog). For a plugin
  // whose agent half Lamaste installs: `agent.requires` and what installing
  // it needs, against the host facts each agent reported.
  // ------------------------------------------------------------------
  fastify.get(
    '/plugins/:name/hosting/eligibility',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);
      try {
        return { agents: await hostingEligibility(params.name) };
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply
          .code(statusCode)
          .send({ error: err.message || 'Failed to check which agents can host the plugin' });
      }
    },
  );

  // ------------------------------------------------------------------
  // DELETE /plugins/:name/hosting?force=&purge= — remove tunnel, secret,
  // capability and the agent half Lamaste installed (a push: `uninstall`);
  // `purge=true` removes the agent half's data and service account too
  // ------------------------------------------------------------------
  fastify.delete(
    '/plugins/:name/hosting',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);
      const query = ForceQuerySchema.parse(request.query);
      try {
        const operation = await unhostPlugin(params.name, {
          actor: actorFromRequest(request),
          logger: request.log,
          force: query.force === 'true',
          purge: query.purge === 'true',
          sourceIp: request.ip,
        });
        return reply.code(202).send({ ok: true, operation });
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply
          .code(statusCode)
          .send(operationErrorBody(err, 'Failed to remove plugin hosting'));
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /plugins/:name/hosting/rotate-secret — a new installation secret;
  // the previous one stays accepted until the hosting agent acknowledges
  // the new one (its sync does that within about 30 seconds)
  // ------------------------------------------------------------------
  fastify.post(
    '/plugins/:name/hosting/rotate-secret',
    {
      preHandler: fastify.requireRole(['admin']),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);
      try {
        const hosting = await rotateHostingSecret(params.name, request.log);
        return { ok: true, hosting };
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply
          .code(statusCode)
          .send({ error: err.message || 'Failed to rotate the installation secret' });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /plugins/:name/retained-data — the data agents keep of the plugin's
  // agent half after it was removed without purge (an unhost, an uninstall,
  // a rolled-back install): [{ agentLabel, route, plugin, package, since,
  // operation }]. By the plugin's name, so it answers after the plugin is
  // uninstalled too.
  // ------------------------------------------------------------------
  fastify.get(
    '/plugins/:name/retained-data',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request) => {
      const params = PluginNameParamSchema.parse(request.params);
      return { retainedData: await retainedDataOf(params.name) };
    },
  );

  // ------------------------------------------------------------------
  // DELETE /plugins/:name/retained-data?agentLabel=<label>[&forget=true] —
  // purge the data agent <label> keeps of the plugin's agent half (its data
  // directory and service account): 202 with the operation (kind
  // `purge-data`), an app-remove job with purge, push-install gated as
  // `uninstall` of the agent package. `forget=true` drops the record only
  // (the agent is not touched — it is gone, or was cleaned by hand): 200.
  // ------------------------------------------------------------------
  fastify.delete(
    '/plugins/:name/retained-data',
    {
      preHandler: fastify.requireRole(['admin']),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);
      const query = RetainedDataQuerySchema.parse(request.query);
      try {
        const result = await purgeRetainedData(params.name, query.agentLabel, {
          actor: actorFromRequest(request),
          logger: request.log,
          sourceIp: request.ip,
          forget: query.forget === 'true',
        });
        if (result.forgotten) return { ok: true, forgotten: result.forgotten };
        return reply.code(202).send({ ok: true, operation: result.operation });
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply
          .code(statusCode)
          .send(operationErrorBody(err, 'Failed to purge the retained data'));
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /plugins/:name/operations — the plugin's recent operations
  // (hosting, unhosting, update, uninstall), newest first
  // GET /plugins/:name/operations/:id — one of them. Once it finished, the
  // first read also carries `oidcClients`: the secrets of confidential OIDC
  // clients it created (an update adding one), shown this once — as
  // POST /plugins/install returns them — and never stored.
  // ------------------------------------------------------------------
  fastify.get(
    '/plugins/:name/operations',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request) => {
      const params = PluginNameParamSchema.parse(request.params);
      return { operations: await listPluginOperations(params.name) };
    },
  );

  fastify.get(
    '/plugins/:name/operations/:id',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.merge(OperationParamSchema).parse(request.params);
      const operation = await getPluginOperation(params.name, params.id);
      if (!operation) return reply.code(404).send({ error: 'Operation not found' });
      const reveal = operation.status === 'running' ? null : takeOperationReveal(operation.id);
      return { operation: reveal ? { ...operation, oidcClients: reveal.oidcClients } : operation };
    },
  );

  // ===========================================================================
  // Settings of an agent-hosted plugin (kept by its agent half)
  // ===========================================================================

  // ------------------------------------------------------------------
  // GET /plugins/:name/settings — { schemaVersion, fields, values, configured,
  // missing, revision, source, syncedAt, hosting }: each non-secret field's
  // effective value, each secret as { set: true, setAt } or { set: false }
  // (never a value). Read from the agent half when its hosting is active
  // and not down (`source: live`), else from the relay's cache (`cache`;
  // `none` when never read). 404 `no_settings` for a plugin without them.
  // ------------------------------------------------------------------
  fastify.get(
    '/plugins/:name/settings',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);
      try {
        return await getPluginSettingsView(params.name, { logger: request.log });
      } catch (err) {
        if (!err.statusCode) {
          request.log.error(
            { plugin: params.name, err: err.message },
            'Failed to read the plugin settings',
          );
        }
        return reply
          .code(err.statusCode || 500)
          .send(settingsErrorBody(err, 'Failed to read the plugin settings'));
      }
    },
  );

  // ------------------------------------------------------------------
  // PUT /plugins/:name/settings { revision, values?, secrets? } — a partial
  // change (`null` clears an optional field), sent through the tunnel to
  // the agent half, which stores it: 200 with the settings as above. 400
  // `errors` (checked here), 409 (`operation_running`, the agent half's
  // `revision_mismatch` with `revision`, `schema_mismatch`), 422 `errors`
  // (the agent half's check, normalized), 503 `hosting_offline` with
  // `hosting`, 502 `settings_unsupported` / `refused` / `unauthenticated`
  // (an answer without the agent half's responder signature), 504 `timeout`.
  //
  // The body may carry secrets. It is handed to the settings library once
  // and dropped from the request; nothing here logs or repeats it. The
  // library seals each secret to the one call that carries it through the
  // tunnel.
  // ------------------------------------------------------------------
  fastify.put(
    '/plugins/:name/settings',
    {
      preHandler: fastify.requireRole(['admin']),
      bodyLimit: AGENT_HALF_SETTINGS_MAX_BYTES,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = request.body;
      request.body = undefined;
      const params = PluginNameParamSchema.parse(request.params);
      try {
        return await updatePluginSettings(params.name, body, {
          actor: actorFromRequest(request),
          certSerial: certSerialFromRequest(request),
          logger: request.log,
        });
      } catch (err) {
        if (!err.statusCode) {
          // A failure of Lamaste's own (state.db, a malformed hosting record):
          // its message names no value of the change.
          request.log.error(
            { plugin: params.name, err: err.message },
            'Failed to change the plugin settings',
          );
        }
        return reply
          .code(err.statusCode || 500)
          .send(settingsErrorBody(err, 'Failed to change the plugin settings'));
      }
    },
  );

  // ===========================================================================
  // Lifecycle hooks: review, approval, auto-approve
  // ===========================================================================

  // ------------------------------------------------------------------
  // GET /plugins/:name/hooks — the relay hook set (entry, stages, routes,
  // fail-open flags, effects, digest), the agent hooks, the agent half
  // Lamaste installs (package, version, integrity, service, system
  // packages), the approval (`approval.digest` is what to approve) and a
  // pending update — its relay hook set and agent half, its settings
  // schema diff, why it waits (`approvalRequired`)
  // ------------------------------------------------------------------
  fastify.get(
    '/plugins/:name/hooks',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);
      const plugin = await findPlugin(params.name);
      if (!plugin) return reply.code(404).send({ error: `Plugin "${params.name}" not found` });
      return { hooks: await hookStatus(plugin) };
    },
  );

  // ------------------------------------------------------------------
  // POST /plugins/:name/hooks/approve { digest?, version? } — approve what
  // the plugin brings (relay hooks, an agent half Lamaste installs) with
  // the digest that was shown. Approving a pending update — by its digest,
  // or by its version (and digest, when it has one) — approves everything
  // it waits for (`approvalRequired`) and applies it (202 with its
  // operation).
  // ------------------------------------------------------------------
  fastify.post(
    '/plugins/:name/hooks/approve',
    {
      preHandler: fastify.requireRole(['admin']),
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);
      const body = ApproveHooksBodySchema.parse(request.body);
      const plugin = await findPlugin(params.name);
      if (!plugin) return reply.code(404).send({ error: `Plugin "${params.name}" not found` });
      const actor = actorFromRequest(request);
      const certSerial = certSerialFromRequest(request);
      try {
        const approved = await approveHookSet(plugin, body.digest ?? null, {
          actor,
          certSerial,
          logger: request.log,
          version: body.version ?? null,
        });
        if (approved.target === 'update') {
          // The update as it was approved: fetched again, it must still be that.
          const result = await updatePlugin(plugin.name, approved.version, {
            actor,
            certSerial,
            logger: request.log,
            approvedUpdate: {
              version: approved.version,
              digest: approved.digest,
              secretToPlain: approved.secretToPlain,
            },
            sourceIp: request.ip,
          });
          return reply.code(202).send({ ok: true, ...result });
        }
        return { ok: true, hooks: await hookStatus(plugin) };
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({
          ...operationErrorBody(err, 'Failed to approve the hook set'),
          // The digest to review now: null when what waits brings nothing to approve by one.
          ...(err.currentDigest !== undefined ? { currentDigest: err.currentDigest } : {}),
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // PUT /plugins/:name/hooks/auto-approve — approve later hook-set changes
  // of this plugin automatically (off by default; every use is audited)
  // ------------------------------------------------------------------
  fastify.put(
    '/plugins/:name/hooks/auto-approve',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);
      const body = AutoApproveBodySchema.parse(request.body);
      const plugin = await findPlugin(params.name);
      if (!plugin) return reply.code(404).send({ error: `Plugin "${params.name}" not found` });
      const result = await setAutoApprove(plugin.name, body.enabled, {
        actor: actorFromRequest(request),
        certSerial: certSerialFromRequest(request),
      });
      return { ok: true, ...result };
    },
  );

  // ===========================================================================
  // Updating an agent-hosted plugin in place
  // ===========================================================================

  // ------------------------------------------------------------------
  // POST /plugins/:name/update { version? } — fetch the version (default
  // latest) and read it without installing it; pin its agent half. A
  // changed relay hook set or agent half (unless auto-approved), and a
  // secret setting turned plain (always), wait for approval
  // (202 { pendingUpdate }, its `approvalRequired` says why); otherwise the
  // update runs as an operation (202 { operation }). 200 { upToDate } when
  // there is nothing to do.
  // ------------------------------------------------------------------
  fastify.post(
    '/plugins/:name/update',
    {
      preHandler: fastify.requireRole(['admin']),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);
      const body = UpdateBodySchema.parse(request.body ?? {});
      try {
        const result = await updatePlugin(params.name, body.version ?? 'latest', {
          actor: actorFromRequest(request),
          certSerial: certSerialFromRequest(request),
          logger: request.log,
          sourceIp: request.ip,
        });
        if (result.upToDate) return { ok: true, ...result };
        return reply.code(202).send({ ok: true, ...result });
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send(operationErrorBody(err, 'Plugin update failed'));
      }
    },
  );

  // ------------------------------------------------------------------
  // DELETE /plugins/:name/update — discard an update that waits for approval
  // ------------------------------------------------------------------
  fastify.delete(
    '/plugins/:name/update',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);
      const state = await readHookState(params.name);
      if (!state?.pendingUpdate) {
        return reply.code(404).send({ error: `Plugin "${params.name}" has no pending update` });
      }
      await setPendingUpdate(params.name, null);
      await recordAudit({
        actor: actorFromRequest(request),
        action: 'plugin.update.discarded',
        plugin: params.name,
        details: { version: state.pendingUpdate.version },
      });
      return { ok: true };
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
        // `oidcClients` carries the secrets of confidential OIDC clients this
        // install created — shown once, never stored in the registry row.
        const { oidcClients, ...plugin } = await installPlugin(body.packageName, request.log);
        // Refresh in-memory capability list so new plugin caps are valid immediately
        setPluginCapabilities(await getPluginCapabilities());
        await recordAudit({
          actor: actorFromRequest(request),
          action: 'plugin.installed',
          plugin: plugin.name,
          details: { packageName: plugin.packageName, version: plugin.version },
        });
        // `hooks`: the relay hook set to review (and approve) before hosting.
        const [listed] = await attachSettingsSummaries([plugin]);
        return { ok: true, plugin: listed, oidcClients, hooks: await hookStatus(plugin) };
      } catch (err) {
        const statusCode = err.statusCode || 500;
        // `route_taken`: another installed plugin holds the route (`route`, `owner`).
        return reply.code(statusCode).send(operationErrorBody(err, 'Plugin installation failed'));
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
  // DELETE /plugins/:name?force=&purge= — uninstall a plugin (must be
  // disabled); a hosted one's hosting is removed first (see
  // DELETE /plugins/:name/hosting)
  // ------------------------------------------------------------------
  fastify.delete(
    '/plugins/:name',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);
      const query = ForceQuerySchema.parse(request.query);

      try {
        // A hosted plugin's hosting is removed first, by an operation
        // (its uninstall pipeline); any other plugin goes at once.
        const result = await uninstallPluginWithHosting(params.name, {
          actor: actorFromRequest(request),
          logger: request.log,
          force: query.force === 'true',
          purge: query.purge === 'true',
          sourceIp: request.ip,
        });
        if (result.operation)
          return reply.code(202).send({ ok: true, operation: result.operation });
        return result.removed;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send(operationErrorBody(err, 'Plugin uninstall failed'));
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /plugins/:name/oidc-clients — the OIDC clients a plugin declares
  //
  // Metadata only: a confidential client's secret is shown by the install
  // or enable response that created it, and by rotate-secret — never here.
  // ------------------------------------------------------------------
  fastify.get(
    '/plugins/:name/oidc-clients',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);
      const registry = await readPlugins();
      if (!registry.plugins.some((p) => p.name === params.name)) {
        return reply.code(404).send({ error: `Plugin "${params.name}" not found` });
      }
      return { clients: await listPluginOidcClients(params.name) };
    },
  );

  // ------------------------------------------------------------------
  // POST /plugins/:name/oidc-clients/:clientId/rotate-secret
  //
  // Replaces a confidential client's secret in the store and in Authelia.
  // The new secret is in the response and nowhere else.
  // ------------------------------------------------------------------
  fastify.post(
    '/plugins/:name/oidc-clients/:clientId/rotate-secret',
    {
      preHandler: fastify.requireRole(['admin']),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const params = PluginNameParamSchema.parse(request.params);
      const { clientId } = OidcClientIdParamSchema.parse(request.params);
      const registry = await readPlugins();
      if (!registry.plugins.some((p) => p.name === params.name)) {
        return reply.code(404).send({ error: `Plugin "${params.name}" not found` });
      }
      try {
        const rotated = await rotatePluginOidcClientSecret(params.name, clientId, request.log);
        return { ok: true, ...rotated };
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({
          error: err.message || 'Failed to rotate the client secret',
        });
      }
    },
  );

  // ===========================================================================
  // Push install routes
  // ===========================================================================

  // ------------------------------------------------------------------
  // GET /plugins/push-install/config — get push install config: the
  // global switch, the policies, the default policy and the bounds of an
  // agent's window (`windowMinutes`)
  // ------------------------------------------------------------------
  fastify.get(
    '/plugins/push-install/config',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (_request, _reply) => {
      const config = await readPushInstallConfig();
      return pushInstallConfigView(config);
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
        return { ok: true, ...pushInstallConfigView(config) };
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
  // POST /plugins/push-install/:label — record a push-install command
  // (legacy). It checks the push-install gates and logs the command in the
  // push-install session log, and that is all: no agent polls for it and
  // nothing delivers it. What Lamaste really pushes — installing, updating
  // and removing an agent half — runs as plugin operations (hosting, update,
  // unhosting, uninstall, purging retained data), gated the same way.
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

      // Check the action and the package against the policy
      const refusal = pushInstallPolicyRefusal(
        access.policy,
        body.action,
        body.packageName ?? null,
      );
      if (refusal) {
        return reply.code(refusal.statusCode).send({ error: refusal.error });
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

      return {
        ok: true,
        label: params.label,
        action: body.action,
        packageName: body.packageName || null,
        message: `Push install command "${body.action}" for agent "${params.label}" recorded in the push-install log; nothing delivers it to the agent`,
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
