/**
 * Admin management of the panel's registry (Feria) service credential.
 *
 *   GET    /api/registry-credential   what is configured — never the token
 *   PUT    /api/registry-credential   store a credential after verifying it
 *                                     against the registry (admin scope required)
 *   DELETE /api/registry-credential   remove it
 *
 * With a credential in place, agents obtain short-lived read tokens through
 * `GET /api/agents/me/registry-credential` for plugin installs.
 */

import { z } from 'zod';
import {
  RegistryCredentialError,
  summariseRegistryCredential,
  verifyRegistryCredential,
} from '@lamalibre/lamaste/server';

import {
  clearRegistryCredentialConfig,
  readRegistryCredentialConfig,
  writeRegistryCredentialConfig,
} from '../../lib/registry-credential.js';

const PutSchema = z.object({
  registryUrl: z.string().url(),
  token: z
    .string()
    .min(20)
    .max(512)
    .regex(/^feria_[A-Za-z0-9_-]+$/, 'token must be a Feria registry token'),
  scope: z
    .string()
    .regex(/^@[a-z0-9][a-z0-9-]*$/)
    .optional(),
});

export default async function registryCredentialRoutes(fastify) {
  fastify.get(
    '/registry-credential',
    { preHandler: fastify.requireRole(['admin']), config: { rateLimit: {} } },
    async () => {
      const config = await readRegistryCredentialConfig();
      if (!config) return { configured: false };
      return { configured: true, ...summariseRegistryCredential(config) };
    },
  );

  fastify.put(
    '/registry-credential',
    {
      preHandler: fastify.requireRole(['admin']),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = PutSchema.parse(request.body);
      let verified;
      try {
        verified = await verifyRegistryCredential({
          registryUrl: body.registryUrl,
          token: body.token,
        });
      } catch (err) {
        const status = err instanceof RegistryCredentialError ? err.statusCode : 502;
        return reply.code(status).send({ error: err.message });
      }

      const config = {
        provider: 'feria',
        registryUrl: body.registryUrl,
        token: body.token,
        scope: body.scope ?? '@lamalibre',
        owner: verified.owner,
        configuredAt: new Date().toISOString(),
      };
      await writeRegistryCredentialConfig(config);
      request.log.info(
        { registryUrl: body.registryUrl, owner: verified.owner },
        'Registry credential configured',
      );
      return { configured: true, ...summariseRegistryCredential(config) };
    },
  );

  fastify.delete(
    '/registry-credential',
    { preHandler: fastify.requireRole(['admin']), config: { rateLimit: {} } },
    async (request) => {
      const removed = await clearRegistryCredentialConfig();
      if (removed) request.log.info('Registry credential removed');
      return { configured: false, removed };
    },
  );
}
