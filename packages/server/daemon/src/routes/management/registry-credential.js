/**
 * Admin management of the panel's registry (Feria) service credential.
 *
 *   GET    /api/registry-credential   what is configured — never a token
 *   PUT    /api/registry-credential   store a credential after verifying the
 *                                     whole chain against the registry
 *                                     (read + admin scopes required)
 *   DELETE /api/registry-credential   remove it
 *
 * `auth.kind` is `token` (a pasted long-lived Feria token) or `oidc` (the
 * panel's own `lamaste-server` client on Authelia: client-credentials grant,
 * Feria login). For `oidc` the client is written to Authelia before the
 * chain is verified; if verification fails it is removed again, and the
 * error says what Feria's `auth.json` needs.
 *
 * With a credential in place, agents obtain short-lived read tokens through
 * `GET /api/agents/me/registry-credential` for plugin installs.
 */

import { z } from 'zod';
import {
  LAMASTE_SERVER_OIDC_CLIENT_ID,
  RegistryCredentialError,
  summariseRegistryCredential,
} from '@lamalibre/lamaste/server';

import {
  clearRegistryCredentialConfig,
  readRegistryCredentialConfig,
  verifyRegistryCredential,
  writeRegistryCredentialConfig,
} from '../../lib/registry-credential.js';
import { syncOidcClients } from '../../lib/plugin-oidc.js';

const FeriaTokenSchema = z
  .string()
  .min(20)
  .max(512)
  .regex(/^feria_[A-Za-z0-9_-]+$/, 'token must be a Feria registry token');

const AuthSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('token'), token: FeriaTokenSchema }),
  z.object({ kind: z.literal('oidc') }),
]);

const PutSchema = z
  .object({
    registryUrl: z.string().url(),
    scope: z
      .string()
      .regex(/^@[a-z0-9][a-z0-9-]*$/)
      .optional(),
    auth: AuthSchema.optional(),
    /** The first release's shape — a token at the top level. */
    token: FeriaTokenSchema.optional(),
  })
  .superRefine((body, ctx) => {
    if (!body.auth && !body.token) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['auth'],
        message: 'auth is required: { kind: "token", token } or { kind: "oidc" }',
      });
    }
  });

/** The stored `auth` for a request body. */
function authOf(body) {
  if (body.auth?.kind === 'oidc') return { kind: 'oidc', clientId: LAMASTE_SERVER_OIDC_CLIENT_ID };
  if (body.auth?.kind === 'token') return { kind: 'token', token: body.auth.token };
  return { kind: 'token', token: body.token };
}

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
      const auth = authOf(body);
      const candidate = { registryUrl: body.registryUrl, auth };

      // The panel's own client must exist in Authelia (with a secret in the
      // store) before the chain can be exercised.
      if (auth.kind === 'oidc') {
        try {
          const synced = await syncOidcClients(request.log, {
            registryAuth: { registryUrl: body.registryUrl },
          });
          if (!synced) {
            return reply.code(503).send({ error: 'Complete onboarding (set a domain) first' });
          }
        } catch (err) {
          return reply.code(500).send({
            error: `Could not register the ${LAMASTE_SERVER_OIDC_CLIENT_ID} client in Authelia: ${err.message}`,
          });
        }
      }

      let verified;
      try {
        verified = await verifyRegistryCredential(candidate);
      } catch (err) {
        if (auth.kind === 'oidc') {
          // Leave Authelia as the stored credential says — the candidate is
          // not kept.
          await syncOidcClients(request.log).catch((syncErr) =>
            request.log.warn({ err: syncErr.message }, 'Failed to roll back the OIDC client'),
          );
        }
        const status = err instanceof RegistryCredentialError ? err.statusCode : 502;
        return reply.code(status).send({ error: err.message });
      }

      const config = {
        provider: 'feria',
        registryUrl: body.registryUrl,
        scope: body.scope ?? '@lamalibre',
        auth,
        owner: verified.owner,
        configuredAt: new Date().toISOString(),
      };
      await writeRegistryCredentialConfig(config);
      // The stored credential now decides whether Authelia carries the client.
      await syncOidcClients(request.log).catch((err) =>
        request.log.warn(
          { err: err.message },
          'Failed to sync OIDC clients after credential change',
        ),
      );
      request.log.info(
        { registryUrl: body.registryUrl, owner: verified.owner, auth: auth.kind },
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
      if (removed) {
        request.log.info('Registry credential removed');
        // Removes the lamaste-server client and its secret if it was in use.
        await syncOidcClients(request.log).catch((err) =>
          request.log.warn(
            { err: err.message },
            'Failed to sync OIDC clients after credential removal',
          ),
        );
      }
      return { configured: false, removed };
    },
  );
}
