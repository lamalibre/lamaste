import { z } from 'zod';
import { validateAndConsumeToken } from '../lib/enrollment.js';
import { signCSR } from '../lib/csr-signing.js';

const EnrollBodySchema = z.object({
  token: z.string().min(1, 'Enrollment token is required'),
  csr: z
    .string()
    .min(1, 'CSR is required')
    .refine((v) => v.includes('BEGIN CERTIFICATE REQUEST'), {
      message: 'CSR must be PEM-encoded',
    }),
});

/**
 * Public enrollment routes (no mTLS required).
 *
 * The agent doesn't have a cert yet — the one-time token (single-use,
 * 10-minute expiry) is the sole authentication gate.
 */
export default async function enrollmentRoutes(fastify, _opts) {
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
      const result = await signCSR(
        body.csr,
        tokenData.label,
        tokenData.capabilities,
        tokenData.allowedSites,
        request.log,
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
      request.log.error({ err }, 'Enrollment CSR signing failed');
      const statusCode = err.statusCode || 500;
      // Only pass through client error messages (4xx); hide internal details for 5xx
      const message = statusCode < 500 ? err.message : 'Enrollment failed';
      return reply.code(statusCode).send({ error: message });
    }
  });
}
