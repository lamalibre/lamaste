import { z } from 'zod';
import { validateAndConsumeToken, lookupToken } from '../lib/enrollment.js';
import { signCSR } from '../lib/csr-signing.js';
import { fingerprintCertPem } from '../lib/mtls.js';

const EnrollBodySchema = z.object({
  token: z.string().min(1, 'Enrollment token is required'),
  csr: z
    .string()
    .min(1, 'CSR is required')
    .refine((v) => v.includes('BEGIN CERTIFICATE REQUEST'), {
      message: 'CSR must be PEM-encoded',
    }),
});

const LookupBodySchema = z.object({
  token: z.string().min(1, 'Enrollment token is required'),
});

/**
 * Public enrollment routes (no mTLS required).
 *
 * The agent doesn't have a cert yet — the one-time token (single-use,
 * 10-minute expiry) is the sole authentication gate.
 */
export default async function enrollmentRoutes(fastify, _opts) {
  // ------------------------------------------------------------------
  // POST /lookup — return the expected label for a token without
  // consuming it. Required because the panel's CSR signing wrapper no
  // longer overrides the CSR subject — the agent must build a CSR with
  // the correct CN before submitting it for signing.
  // ------------------------------------------------------------------
  fastify.post('/lookup', async (request, reply) => {
    const body = LookupBodySchema.parse(request.body);

    try {
      const result = await lookupToken(body.token);
      return { ok: true, label: result.label, type: result.type };
    } catch (err) {
      const statusCode = err.statusCode || 401;
      return reply.code(statusCode).send({
        error: err.message || 'Invalid enrollment token',
      });
    }
  });

  // ------------------------------------------------------------------
  // POST / — enroll an agent using a one-time token + CSR
  // ------------------------------------------------------------------
  fastify.post('/', async (request, reply) => {
    const body = EnrollBodySchema.parse(request.body);

    let tokenData;
    try {
      tokenData = await validateAndConsumeToken(body.token);
    } catch (err) {
      const statusCode = err.statusCode || 401;
      return reply.code(statusCode).send({
        error: err.message || 'Invalid enrollment token',
      });
    }

    try {
      // Build opts for delegated enrollments
      const signOpts =
        tokenData.type === 'delegated'
          ? { type: /** @type {const} */ ('delegated'), delegatedBy: tokenData.delegatedBy }
          : undefined;

      const result = await signCSR(
        body.csr,
        tokenData.label,
        tokenData.capabilities,
        tokenData.allowedSites,
        request.log,
        signOpts,
      );

      // Audit: enrollment is the moment a fresh agent cert enters circulation.
      // The token holder is the de facto principal — there is no client cert at
      // this point. Token type ('p12'/'delegated') and delegating label
      // (when present) capture the chain of trust.
      request.log.info(
        {
          admin:
            tokenData.type === 'delegated'
              ? `agent:${tokenData.delegatedBy ?? 'unknown'}`
              : 'enrollment-token',
          issuedFor: tokenData.type === 'delegated' ? result.label : `agent:${result.label}`,
          mode: tokenData.type === 'delegated' ? 'delegated' : 'hardware-bound',
          newSerial: result.serial,
          fingerprintSha256: result.certPem ? fingerprintCertPem(result.certPem) : null,
        },
        'mTLS certificate issued (agent enrollment)',
      );

      return {
        ok: true,
        cert: result.certPem,
        caCert: result.caCertPem,
        label: result.label,
        serial: result.serial,
        expiresAt: result.expiresAt,
      };
    } catch (err) {
      request.log.error(
        {
          err,
          issuedFor: tokenData.type === 'delegated' ? tokenData.label : `agent:${tokenData.label}`,
          mode: tokenData.type === 'delegated' ? 'delegated' : 'hardware-bound',
        },
        'Enrollment CSR signing failed',
      );
      const statusCode = err.statusCode || 500;
      // Only pass through client error messages (4xx); hide internal details for 5xx
      const message = statusCode < 500 ? err.message : 'Enrollment failed';
      return reply.code(statusCode).send({ error: message });
    }
  });
}
