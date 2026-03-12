import { z } from 'zod';
import { execa } from 'execa';
import { listCerts } from '../../lib/certbot.js';
import {
  getMtlsCerts, readCertExpiry, rotateClientCert, getP12Path,
  generateAgentCert, listAgentCerts, revokeAgentCert, getAgentP12Path,
  updateAgentCapabilities, VALID_CAPABILITIES,
} from '../../lib/mtls.js';
import * as nginx from '../../lib/nginx.js';

const DomainParamSchema = z.object({
  domain: z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, 'Invalid domain name'),
});

const CapabilityEnum = z.enum(VALID_CAPABILITIES);

const AgentGenerateBodySchema = z.object({
  label: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Label must contain only lowercase letters, numbers, and hyphens'),
  capabilities: z.array(CapabilityEnum)
    .optional()
    .default(['tunnels:read'])
    .refine((caps) => caps.includes('tunnels:read'), {
      message: 'tunnels:read is mandatory and cannot be removed',
    }),
});

const UpdateCapabilitiesSchema = z.object({
  capabilities: z.array(CapabilityEnum)
    .refine((caps) => caps.includes('tunnels:read'), {
      message: 'tunnels:read is mandatory and cannot be removed',
    }),
});

const AgentLabelParamSchema = z.object({
  label: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Invalid agent label'),
});

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
          'show', timerName, '--property=NextElapseUSecRealtime',
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
          'show', timerName, '--property=LastTriggerUSecRealtime',
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
  fastify.get('/certs', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, _reply) => {
    const certs = [];

    // Source 1: Let's Encrypt certificates
    try {
      const leCerts = await listCerts();
      certs.push(...formatLetsEncryptCerts(leCerts));
    } catch (err) {
      request.log.error({ err }, 'Failed to list Let\'s Encrypt certificates');
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
  });

  // ------------------------------------------------------------------
  // GET /certs/auto-renew-status — certbot timer status
  // Must be registered BEFORE :domain routes to avoid param conflicts
  // ------------------------------------------------------------------
  fastify.get('/certs/auto-renew-status', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, _reply) => {
    try {
      return await getAutoRenewStatus();
    } catch (err) {
      request.log.error({ err }, 'Failed to get auto-renew status');
      return { active: false, nextRun: null, lastRun: null };
    }
  });

  // ------------------------------------------------------------------
  // POST /certs/mtls/rotate — rotate mTLS client certificate
  // Must be registered BEFORE :domain routes
  // ------------------------------------------------------------------
  fastify.post('/certs/mtls/rotate', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
    try {
      const result = await rotateClientCert(request.log);

      // Reload nginx to pick up the new client cert
      const testResult = await nginx.testConfig();
      if (testResult.valid) {
        try {
          await nginx.reload();
        } catch (reloadErr) {
          request.log.error({ err: reloadErr }, 'nginx reload failed after mTLS rotation');
          result.warning += ' Note: nginx reload failed — you may need to restart nginx manually.';
        }
      } else {
        request.log.error({ error: testResult.error }, 'nginx config test failed after mTLS rotation');
        result.warning += ' Note: nginx config test failed — you may need to fix nginx manually.';
      }

      return result;
    } catch (err) {
      const statusCode = err.statusCode || 500;
      return reply.code(statusCode).send({
        error: err.message || 'mTLS rotation failed',
      });
    }
  });

  // ------------------------------------------------------------------
  // GET /certs/mtls/download — download client.p12 file
  // Must be registered BEFORE :domain routes
  // ------------------------------------------------------------------
  fastify.get('/certs/mtls/download', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
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
  });

  // ------------------------------------------------------------------
  // POST /certs/agent — generate a new agent certificate
  // ------------------------------------------------------------------
  fastify.post('/certs/agent', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
    const body = AgentGenerateBodySchema.parse(request.body);

    try {
      const result = await generateAgentCert(body.label, request.log, body.capabilities);
      return { ok: true, ...result };
    } catch (err) {
      const statusCode = err.statusCode || 500;
      return reply.code(statusCode).send({
        error: err.message || 'Agent certificate generation failed',
      });
    }
  });

  // ------------------------------------------------------------------
  // GET /certs/agent — list all agent certificates
  // ------------------------------------------------------------------
  fastify.get('/certs/agent', {
    preHandler: fastify.requireRole(['admin']),
  }, async (_request, _reply) => {
    const agents = await listAgentCerts();
    return { agents };
  });

  // ------------------------------------------------------------------
  // GET /certs/agent/:label/download — download agent P12 file
  // ------------------------------------------------------------------
  fastify.get('/certs/agent/:label/download', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
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
  });

  // ------------------------------------------------------------------
  // DELETE /certs/agent/:label — revoke an agent certificate
  // ------------------------------------------------------------------
  fastify.delete('/certs/agent/:label', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
    const params = AgentLabelParamSchema.parse(request.params);

    try {
      const result = await revokeAgentCert(params.label, request.log);
      return result;
    } catch (err) {
      const statusCode = err.statusCode || 500;
      return reply.code(statusCode).send({
        error: err.message || 'Agent certificate revocation failed',
      });
    }
  });

  // ------------------------------------------------------------------
  // PATCH /certs/agent/:label/capabilities — update agent capabilities
  // ------------------------------------------------------------------
  fastify.patch('/certs/agent/:label/capabilities', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
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
  });

  // ------------------------------------------------------------------
  // POST /certs/:domain/renew — force-renew a Let's Encrypt certificate
  // ------------------------------------------------------------------
  fastify.post('/certs/:domain/renew', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
    const params = DomainParamSchema.parse(request.params);
    const { domain } = params;

    try {
      // Force renewal via certbot
      await execa('sudo', [
        'certbot', 'renew',
        '--cert-name', domain,
        '--force-renewal',
      ], { timeout: 90000 });
    } catch (err) {
      const stderr = err.stderr || err.message;

      if (stderr.includes('No certificate found') || stderr.includes('not found')) {
        return reply.code(404).send({ error: 'Certificate not found' });
      }

      request.log.error({ err, domain }, 'Certificate renewal failed');
      return reply.code(500).send({
        error: 'Certificate renewal failed',
        details: stderr,
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
      request.log.error({ error: testResult.error }, 'nginx config test failed after cert renewal');
      warning = 'Certificate renewed but nginx config test failed';
    }

    const result = { ok: true, domain, newExpiry };
    if (warning) result.warning = warning;
    return result;
  });
}
