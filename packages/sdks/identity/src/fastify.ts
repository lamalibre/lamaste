/**
 * Fastify plugin for automatic identity header parsing.
 *
 * Registers an `onRequest` hook that parses Authelia identity headers
 * and attaches the result to `request.identity`. Malformed headers
 * are logged as warnings and the identity is set to `null`.
 *
 * Note: `fastify` is NOT a runtime dependency — this file uses
 * `import type` only. Plugin consumers provide Fastify.
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AutheliaIdentity } from './types.js';
import { parseIdentity, isIdentityParseError } from './parser.js';

declare module 'fastify' {
  interface FastifyRequest {
    identity: AutheliaIdentity | null;
  }
}

const identityPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('identity', null);

  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    const result = parseIdentity(request.headers as Record<string, string | string[] | undefined>);
    if (result === null || isIdentityParseError(result)) {
      request.identity = null;
      if (isIdentityParseError(result)) {
        request.log.warn({ detail: result.message }, 'Malformed identity headers');
      }
    } else {
      request.identity = result;
    }
  });
};

export { identityPlugin };
export default identityPlugin;
