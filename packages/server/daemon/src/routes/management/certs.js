import { z } from 'zod';
import { execa } from 'execa';
import { listCerts, renewCert } from '../../lib/certbot.js';
import {
  getMtlsCerts,
  readCertExpiry,
  rotateClientCert,
  getP12Path,
  generateAgentCert,
  listAgentCerts,
  revokeAgentCert,
  getAgentP12Path,
  updateAgentCapabilities,
  updateAgentAllowedSites,
  getValidCapabilities,
  fingerprintCertPem,
} from '../../lib/mtls.js';
import { createEnrollmentToken, createDelegatedEnrollmentToken, revokeEnrollmentToken } from '../../lib/enrollment.js';
import { signAdminCSR, rotateAgentCSR } from '../../lib/csr-signing.js';
import { getConfig, updateConfig } from '../../lib/config.js';
import { addToRevocationList } from '../../lib/revocation.js';
import { agentOwnsInstanceForScope } from '../../lib/tickets.js';
import * as nginx from '../../lib/nginx.js';

const DomainParamSchema = z.object({
  domain: z
    .string()
    .regex(
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
      'Invalid domain name',
    ),
});

const AgentGenerateBodySchema = z.object({
  label: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Label must contain only lowercase letters, numbers, and hyphens'),
  capabilities: z
    .array(z.string())
    .optional()
    .default(['tunnels:read'])
    .refine((caps) => caps.includes('tunnels:read'), {
      message: 'tunnels:read is mandatory and cannot be removed',
    })
    .superRefine((caps, ctx) => {
      const validCaps = getValidCapabilities();
      for (const c of caps) {
        if (!validCaps.includes(c)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid capability: ${c}` });
        }
      }
    }),
  allowedSites: z
    .array(
      z
        .string()
        .min(1)
        .max(100)
        .regex(
          /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
          'Site name must contain only lowercase letters, numbers, and hyphens',
        ),
    )
    .optional()
    .default([]),
});

const UpdateCapabilitiesSchema = z.object({
  capabilities: z
    .array(z.string())
    .superRefine((caps, ctx) => {
      const validCaps = getValidCapabilities();
      for (const c of caps) {
        if (!validCaps.includes(c)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid capability: ${c}` });
        }
      }
    }),
});

const UpdateAllowedSitesSchema = z.object({
  allowedSites: z.array(
    z
      .string()
      .min(1)
      .max(100)
      .regex(
        /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
        'Site name must contain only lowercase letters, numbers, and hyphens',
      ),
  ),
});

const AdminUpgradeSchema = z.object({
  csr: z
    .string()
    .min(1, 'CSR is required')
    .refine((v) => v.includes('BEGIN CERTIFICATE REQUEST'), {
      message: 'CSR must be PEM-encoded',
    }),
});

const AgentUpgradeSchema = z.object({
  csr: z
    .string()
    .min(1, 'CSR is required')
    .refine((v) => v.includes('BEGIN CERTIFICATE REQUEST'), {
      message: 'CSR must be PEM-encoded',
    }),
});

const AgentLabelParamSchema = z.object({
  label: z.string().min(1).max(150).regex(/^[a-z0-9][a-z0-9:-]*$/, 'Invalid agent label'),
});

const DelegatedEnrollBodySchema = z.object({
  pluginAgentLabel: z
    .string()
    .min(1)
    .max(50)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      'Label must start with a letter or number and contain only lowercase letters, numbers, and hyphens',
    ),
  scope: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9-]+:[a-z0-9-]+$/,
      'Scope must follow scope:action format (e.g., sync:connect)',
    ),
});

/**
 * Derive a stable audit identifier for the calling principal.
 *
 * Returns the certificate CN form (`admin`, `agent:<label>`, `plugin-agent:...`)
 * so a journalctl reader can correlate cert lifecycle events with the
 * principal that initiated them. Returns `'unknown'` when middleware did not
 * populate cert metadata (e.g. dev mode shortcut on /api/health).
 */
function actorFromRequest(request) {
  if (request.certRole === 'admin') return 'admin';
  if (request.certRole === 'agent' && request.certLabel) return `agent:${request.certLabel}`;
  if (request.certRole === 'plugin-agent' && request.certLabel) return request.certLabel;
  return 'unknown';
}

/**
 * Parse certbot listing results into the unified cert response format.
 */
function formatLetsEncryptCerts(certbotCerts) {
  return certbotCerts.map((cert) => ({
    type: 'letsencrypt',
    domain: cert.name,
    expiresAt: cert.expiryDate,
    daysUntilExpiry: cert.daysRemaining,
    path: cert.certPath,
    expiringSoon: cert.daysRemaining <= 30,
  }));
}

/**
 * Check the certbot auto-renewal timer status.
 * Some systems use certbot.timer, others use certbot-renew.timer.
 */
async function getAutoRenewStatus() {
  const timerNames = ['certbot.timer', 'certbot-renew.timer'];

  for (const timerName of timerNames) {
    try {
      const { stdout: activeStatus } = await execa('systemctl', ['is-active', timerName]);
      if (activeStatus.trim() !== 'active') continue;

      let nextRun = null;
      let lastRun = null;

      try {
        const { stdout: nextElapse } = await execa('systemctl', [
          'show',
          timerName,
          '--property=NextElapseUSecRealtime',
        ]);
        const nextMatch = nextElapse.match(/NextElapseUSecRealtime=(.+)/);
        if (nextMatch && nextMatch[1] && nextMatch[1] !== 'n/a') {
          const parsed = new Date(nextMatch[1]);
          if (!isNaN(parsed.getTime())) nextRun = parsed.toISOString();
        }
      } catch {
        // Ignore — next run time unavailable
      }

      try {
        const { stdout: lastTrigger } = await execa('systemctl', [
          'show',
          timerName,
          '--property=LastTriggerUSecRealtime',
        ]);
        const lastMatch = lastTrigger.match(/LastTriggerUSecRealtime=(.+)/);
        if (lastMatch && lastMatch[1] && lastMatch[1] !== 'n/a') {
          const parsed = new Date(lastMatch[1]);
          if (!isNaN(parsed.getTime())) lastRun = parsed.toISOString();
        }
      } catch {
        // Ignore — last run time unavailable
      }

      return { active: true, nextRun, lastRun };
    } catch {
      // Timer doesn't exist or is inactive — try next name
      continue;
    }
  }

  return { active: false, nextRun: null, lastRun: null };
}

export default async function certsRoutes(fastify, _opts) {
  // ------------------------------------------------------------------
  // GET /certs — list all certificates
  // ------------------------------------------------------------------
  fastify.get(
    '/certs',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, _reply) => {
      const certs = [];

      // Source 1: Let's Encrypt certificates
      try {
        const leCerts = await listCerts();
        certs.push(...formatLetsEncryptCerts(leCerts));
      } catch (err) {
        request.log.error({ err }, "Failed to list Let's Encrypt certificates");
      }

      // Source 2: mTLS certificates
      try {
        const mtlsCerts = await getMtlsCerts();
        certs.push(...mtlsCerts);
      } catch (err) {
        request.log.error({ err }, 'Failed to list mTLS certificates');
      }

      // Sort by daysUntilExpiry ascending (soonest expiry first)
      certs.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

      return { certs };
    },
  );

  // ------------------------------------------------------------------
  // GET /certs/auto-renew-status — certbot timer status
  // Must be registered BEFORE :domain routes to avoid param conflicts
  // ------------------------------------------------------------------
  fastify.get(
    '/certs/auto-renew-status',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, _reply) => {
      try {
        return await getAutoRenewStatus();
      } catch (err) {
        request.log.error({ err }, 'Failed to get auto-renew status');
        return { active: false, nextRun: null, lastRun: null };
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /certs/mtls/rotate — rotate mTLS client certificate
  // Must be registered BEFORE :domain routes
  // ------------------------------------------------------------------
  fastify.post(
    '/certs/mtls/rotate',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const actor = actorFromRequest(request);
      // Block P12 rotation when admin uses hardware-bound auth
      const config = getConfig();
      if (config.adminAuthMode === 'hardware-bound') {
        request.log.info(
          { admin: actor, rotatedFor: 'admin', outcome: 'refused', reason: 'hardware-bound' },
          'mTLS certificate rotation refused',
        );
        return reply.code(410).send({
          error: 'P12 certificate rotation is disabled. Admin uses hardware-bound authentication. Use lamaste-reset-admin on the server to revert.',
        });
      }

      try {
        const result = await rotateClientCert(request.log);

        // Reload nginx to pick up the new client cert
        const testResult = await nginx.testConfig();
        if (testResult.valid) {
          try {
            await nginx.reload();
          } catch (reloadErr) {
            request.log.error({ err: reloadErr }, 'nginx reload failed after mTLS rotation');
            result.warning +=
              ' Note: nginx reload failed — you may need to restart nginx manually.';
          }
        } else {
          request.log.error(
            { error: testResult.error },
            'nginx config test failed after mTLS rotation',
          );
          result.warning += ' Note: nginx config test failed — you may need to fix nginx manually.';
        }

        request.log.info(
          {
            admin: actor,
            rotatedFor: 'admin',
            newSerial: result?.serial ?? null,
            fingerprintSha256: result?.certPem ? fingerprintCertPem(result.certPem) : null,
          },
          'mTLS certificate rotated',
        );

        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        request.log.error(
          { admin: actor, rotatedFor: 'admin', err, statusCode },
          'mTLS certificate rotation failed',
        );
        return reply.code(statusCode).send({
          error: err.message || 'mTLS rotation failed',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /certs/mtls/download — download client.p12 file
  // Must be registered BEFORE :domain routes
  // ------------------------------------------------------------------
  fastify.get(
    '/certs/mtls/download',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      // Block P12 download when admin uses hardware-bound auth
      const config = getConfig();
      if (config.adminAuthMode === 'hardware-bound') {
        return reply.code(410).send({
          error: 'P12 certificate download is disabled. Admin uses hardware-bound authentication. Use lamaste-reset-admin on the server to revert.',
        });
      }

      const p12Path = getP12Path();
      const { readFile } = await import('node:fs/promises');

      try {
        const data = await readFile(p12Path);

        return reply
          .header('Content-Type', 'application/x-pkcs12')
          .header('Content-Disposition', 'attachment; filename="client.p12"')
          .send(data);
      } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'EACCES') {
          return reply.code(404).send({ error: 'No client certificate found' });
        }
        request.log.error({ err }, 'Failed to read client.p12');
        return reply.code(500).send({ error: 'Failed to download certificate' });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /certs/admin/upgrade-to-hardware-bound — upgrade admin cert
  // to hardware-bound (Keychain) authentication via CSR
  // ------------------------------------------------------------------
  fastify.post(
    '/certs/admin/upgrade-to-hardware-bound',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const body = AdminUpgradeSchema.parse(request.body);
      const actor = actorFromRequest(request);

      const config = getConfig();
      if (config.adminAuthMode === 'hardware-bound') {
        return reply.code(409).send({
          error: 'Admin is already using hardware-bound authentication',
        });
      }

      try {
        const result = await signAdminCSR(body.csr, request.log);

        // Revoke old admin cert
        if (result.oldSerial) {
          request.log.info({ serial: result.oldSerial }, 'Revoking old admin certificate');
          await addToRevocationList(result.oldSerial, 'admin (upgraded to hardware-bound)');
        }

        // Set adminAuthMode to hardware-bound
        await updateConfig({ adminAuthMode: 'hardware-bound' });

        // Reload nginx to pick up revocation changes
        const testResult = await nginx.testConfig();
        if (testResult.valid) {
          try {
            await nginx.reload();
          } catch (reloadErr) {
            request.log.error({ err: reloadErr }, 'nginx reload failed after admin upgrade');
          }
        }

        request.log.info(
          {
            admin: actor,
            rotatedFor: 'admin',
            mode: 'hardware-bound',
            oldSerial: result.oldSerial ?? null,
            newSerial: result.serial,
            fingerprintSha256: result.certPem ? fingerprintCertPem(result.certPem) : null,
          },
          'mTLS certificate rotated (admin hardware-bound upgrade)',
        );

        return {
          ok: true,
          cert: result.certPem,
          caCert: result.caCertPem,
          serial: result.serial,
          expiresAt: result.expiresAt,
        };
      } catch (err) {
        const statusCode = err.statusCode || 500;
        request.log.error(
          { admin: actor, rotatedFor: 'admin', mode: 'hardware-bound', err, statusCode },
          'mTLS certificate rotation failed (admin hardware-bound upgrade)',
        );
        return reply.code(statusCode).send({
          error: err.message || 'Admin upgrade failed',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /certs/admin/auth-mode — get current admin auth mode
  // ------------------------------------------------------------------
  fastify.get(
    '/certs/admin/auth-mode',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (_request, _reply) => {
      const config = getConfig();
      return { adminAuthMode: config.adminAuthMode || 'p12' };
    },
  );

  // ------------------------------------------------------------------
  // POST /certs/agent/upgrade-cert — upgrade agent cert to hardware-bound
  // via CSR. Agent-role only — agents can only rotate their own cert.
  // ------------------------------------------------------------------
  fastify.post(
    '/certs/agent/upgrade-cert',
    {
      preHandler: fastify.requireRole(['agent']),
    },
    async (request, reply) => {
      const body = AgentUpgradeSchema.parse(request.body);
      const label = request.certLabel;
      const actor = actorFromRequest(request);

      if (!label) {
        return reply.code(403).send({ error: 'Agent label not found in certificate' });
      }

      try {
        const result = await rotateAgentCSR(body.csr, label, request.log);
        request.log.info(
          {
            admin: actor,
            rotatedFor: `agent:${label}`,
            mode: 'hardware-bound',
            newSerial: result.serial,
            fingerprintSha256: result.certPem ? fingerprintCertPem(result.certPem) : null,
          },
          'mTLS certificate rotated (agent hardware-bound upgrade)',
        );
        return {
          ok: true,
          cert: result.certPem,
          caCert: result.caCertPem,
          serial: result.serial,
          expiresAt: result.expiresAt,
        };
      } catch (err) {
        const statusCode = err.statusCode || 500;
        request.log.error(
          { admin: actor, rotatedFor: `agent:${label}`, mode: 'hardware-bound', err, statusCode },
          'mTLS certificate rotation failed (agent hardware-bound upgrade)',
        );
        return reply.code(statusCode).send({
          error: err.message || 'Agent certificate upgrade failed',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /certs/agent — generate a new agent certificate
  // ------------------------------------------------------------------
  fastify.post(
    '/certs/agent',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const body = AgentGenerateBodySchema.parse(request.body);
      const actor = actorFromRequest(request);

      try {
        const result = await generateAgentCert(
          body.label,
          request.log,
          body.capabilities,
          body.allowedSites,
        );
        request.log.info(
          {
            admin: actor,
            issuedFor: `agent:${body.label}`,
            mode: 'p12',
            newSerial: result.serial,
            capabilities: body.capabilities,
          },
          'mTLS certificate issued (agent)',
        );
        return { ok: true, ...result };
      } catch (err) {
        const statusCode = err.statusCode || 500;
        request.log.error(
          { admin: actor, issuedFor: `agent:${body.label}`, mode: 'p12', err, statusCode },
          'mTLS certificate issuance failed (agent)',
        );
        return reply.code(statusCode).send({
          error: err.message || 'Agent certificate generation failed',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /certs/agent/enroll — generate a one-time enrollment token
  // for hardware-bound agent certificate enrollment via CSR
  // ------------------------------------------------------------------
  fastify.post(
    '/certs/agent/enroll',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const body = AgentGenerateBodySchema.parse(request.body);
      const actor = actorFromRequest(request);

      try {
        const result = await createEnrollmentToken(
          body.label,
          body.capabilities,
          body.allowedSites,
          request.log,
        );
        request.log.info(
          {
            admin: actor,
            issuedFor: `agent:${body.label}`,
            mode: 'enrollment-token',
            capabilities: body.capabilities,
            expiresAt: result.expiresAt ?? null,
          },
          'Enrollment token issued (agent hardware-bound)',
        );
        return { ok: true, ...result };
      } catch (err) {
        const statusCode = err.statusCode || 500;
        request.log.error(
          { admin: actor, issuedFor: `agent:${body.label}`, mode: 'enrollment-token', err, statusCode },
          'Enrollment token issuance failed (agent hardware-bound)',
        );
        return reply.code(statusCode).send({
          error: err.message || 'Enrollment token generation failed',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // DELETE /certs/agent/enroll/:label — revoke unused enrollment token
  // Called by the desktop app when agent installation fails before
  // enrollment, preventing the token from being used elsewhere.
  // ------------------------------------------------------------------
  fastify.delete(
    '/certs/agent/enroll/:label',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, _reply) => {
      const params = AgentLabelParamSchema.parse(request.params);
      const actor = actorFromRequest(request);
      const result = await revokeEnrollmentToken(params.label, request.log);
      request.log.info(
        { admin: actor, revokedFor: `agent:${params.label}`, mode: 'enrollment-token' },
        'Enrollment token revoked',
      );
      return { ok: true, ...result };
    },
  );

  // ------------------------------------------------------------------
  // POST /certs/agent/enroll-delegated — pre-announce a delegated enrollment
  // token for a plugin agent. Requires agent role — only agents that own
  // a ticket instance for the given scope can delegate enrollment.
  // ------------------------------------------------------------------
  fastify.post(
    '/certs/agent/enroll-delegated',
    {
      preHandler: fastify.requireRole(['agent']),
    },
    async (request, reply) => {
      // Plugin-agents cannot delegate enrollment — prevents recursive delegation chains
      if (request.certRole === 'plugin-agent') {
        return reply.code(403).send({ error: 'Plugin agents cannot delegate enrollment' });
      }

      const body = DelegatedEnrollBodySchema.parse(request.body);
      const delegatingLabel = request.certLabel;

      if (!delegatingLabel) {
        return reply.code(403).send({ error: 'Agent label not found in certificate' });
      }

      // Validate the calling agent owns a ticket instance for the given scope
      const ownsInstance = await agentOwnsInstanceForScope(delegatingLabel, body.scope);
      if (!ownsInstance) {
        return reply.code(403).send({
          error: 'Insufficient delegation authority',
        });
      }

      const actor = actorFromRequest(request);
      try {
        const result = await createDelegatedEnrollmentToken(
          delegatingLabel,
          body.scope,
          body.pluginAgentLabel,
          request.log,
        );
        request.log.info(
          {
            admin: actor,
            issuedFor: result.pluginAgentLabel,
            mode: 'enrollment-token-delegated',
            scope: body.scope,
            delegatedBy: delegatingLabel,
            expiresAt: result.expiresAt ?? null,
          },
          'Enrollment token issued (delegated plugin-agent)',
        );
        return {
          ok: true,
          enrollmentToken: result.token,
          expiresAt: result.expiresAt,
          pluginAgentLabel: result.pluginAgentLabel,
        };
      } catch (err) {
        const statusCode = err.statusCode || 500;
        request.log.error(
          {
            admin: actor,
            mode: 'enrollment-token-delegated',
            scope: body.scope,
            delegatedBy: delegatingLabel,
            requestedFor: body.pluginAgentLabel,
            err,
            statusCode,
          },
          'Enrollment token issuance failed (delegated plugin-agent)',
        );
        return reply.code(statusCode).send({
          error: err.message || 'Delegated enrollment token generation failed',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /certs/agent — list all agent certificates
  // ------------------------------------------------------------------
  fastify.get(
    '/certs/agent',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (_request, _reply) => {
      const agents = await listAgentCerts();
      return { agents };
    },
  );

  // ------------------------------------------------------------------
  // GET /certs/agent/:label/download — download agent P12 file
  // ------------------------------------------------------------------
  fastify.get(
    '/certs/agent/:label/download',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = AgentLabelParamSchema.parse(request.params);
      const p12Path = getAgentP12Path(params.label);

      try {
        const { readFile: readFileRaw } = await import('node:fs/promises');
        const fileBuffer = await readFileRaw(p12Path);

        return reply
          .header('Content-Type', 'application/x-pkcs12')
          .header('Content-Disposition', `attachment; filename="${params.label}.p12"`)
          .send(fileBuffer);
      } catch (err) {
        if (err.code === 'ENOENT') {
          return reply.code(404).send({ error: `Agent certificate "${params.label}" not found` });
        }
        request.log.error({ err }, 'Failed to read agent client.p12');
        return reply.code(500).send({ error: 'Failed to download agent certificate' });
      }
    },
  );

  // ------------------------------------------------------------------
  // DELETE /certs/agent/:label — revoke an agent certificate
  // ------------------------------------------------------------------
  fastify.delete(
    '/certs/agent/:label',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = AgentLabelParamSchema.parse(request.params);
      const actor = actorFromRequest(request);

      try {
        const result = await revokeAgentCert(params.label, request.log);
        request.log.info(
          { admin: actor, revokedFor: `agent:${params.label}` },
          'mTLS certificate revoked (agent)',
        );
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        request.log.error(
          { admin: actor, revokedFor: `agent:${params.label}`, err, statusCode },
          'mTLS certificate revocation failed (agent)',
        );
        return reply.code(statusCode).send({
          error: err.message || 'Agent certificate revocation failed',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // PATCH /certs/agent/:label/capabilities — update agent capabilities
  // ------------------------------------------------------------------
  fastify.patch(
    '/certs/agent/:label/capabilities',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = AgentLabelParamSchema.parse(request.params);
      const body = UpdateCapabilitiesSchema.parse(request.body);

      try {
        const result = await updateAgentCapabilities(params.label, body.capabilities);
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({
          error: err.message || 'Failed to update capabilities',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // PATCH /certs/agent/:label/allowed-sites — update agent allowed sites
  // ------------------------------------------------------------------
  fastify.patch(
    '/certs/agent/:label/allowed-sites',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = AgentLabelParamSchema.parse(request.params);
      const body = UpdateAllowedSitesSchema.parse(request.body);

      try {
        const result = await updateAgentAllowedSites(params.label, body.allowedSites);
        return result;
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return reply.code(statusCode).send({
          error: err.message || 'Failed to update allowed sites',
        });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /certs/:domain/renew — force-renew a Let's Encrypt certificate
  // ------------------------------------------------------------------
  fastify.post(
    '/certs/:domain/renew',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const params = DomainParamSchema.parse(request.params);
      const { domain } = params;

      try {
        await renewCert(domain, { forceRenewal: true });
      } catch (err) {
        const msg = err.message || '';

        if (msg.includes('No certificate found') || msg.includes('not found')) {
          return reply.code(404).send({ error: 'Certificate not found' });
        }

        request.log.error({ err, domain }, 'Certificate renewal failed');
        return reply.code(500).send({
          error: 'Certificate renewal failed',
        });
      }

      // Read the new expiry date
      const certPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
      const expiry = await readCertExpiry(certPath);
      const newExpiry = expiry?.expiresAt || null;

      // Reload nginx
      const testResult = await nginx.testConfig();
      let warning;
      if (testResult.valid) {
        try {
          await nginx.reload();
        } catch (reloadErr) {
          request.log.error({ err: reloadErr }, 'nginx reload failed after cert renewal');
          warning = 'Certificate renewed but nginx reload failed';
        }
      } else {
        request.log.error(
          { error: testResult.error },
          'nginx config test failed after cert renewal',
        );
        warning = 'Certificate renewed but nginx config test failed';
      }

      const result = { ok: true, domain, newExpiry };
      if (warning) result.warning = warning;
      return result;
    },
  );
}
