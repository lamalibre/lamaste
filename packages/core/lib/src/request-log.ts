/**
 * Request logging without personal data, for Lamaste's Fastify services
 * (the panel, Gatekeeper).
 *
 * Fastify's own request logging writes every URL — path and query — and
 * the client address, twice per request. A URL can carry a username (a
 * users route's parameter, a diagnostic query) and a client address is
 * personal data of whoever made the request, so the services turn that
 * logging off (`disableRequestLogging: true`) and log one metadata line per
 * request instead ({@link logRequestMetadata}): the method, the **route
 * pattern** the request matched (`/api/users/:username`, never the path it
 * was asked with), the status, the duration, whatever metadata the service
 * adds — and the client address only where the service says it may.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

/** The route pattern of a request that matched none. */
export const UNMATCHED_ROUTE = '(unmatched)';

export interface RequestMetadataLogOptions {
  /** Extra metadata for the line (the caller's certificate role, say) — never personal data. */
  readonly fields?: ((request: FastifyRequest) => Record<string, unknown>) | undefined;
  /** Whether the client address goes into the line; never when omitted. */
  readonly logIp?: ((request: FastifyRequest) => boolean) | undefined;
}

/**
 * Log one metadata line per request on `instance` (and every context
 * registered under it): `{ method, route, status, durationMs, ...fields,
 * ip? }`, at `info`, through the request's own logger (its request id
 * bound). Register it on the root instance before the routes.
 */
export function logRequestMetadata(
  instance: FastifyInstance,
  opts: RequestMetadataLogOptions = {},
): void {
  instance.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        route: request.routeOptions.url ?? UNMATCHED_ROUTE,
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
        ...(opts.fields?.(request) ?? {}),
        ...(opts.logIp?.(request) === true ? { ip: request.ip } : {}),
      },
      'request completed',
    );
  });
}
