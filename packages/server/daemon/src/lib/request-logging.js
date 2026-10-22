/**
 * How the panel logs its requests: one metadata line per request (core
 * `logRequestMetadata`) instead of Fastify's own lines, which carry every
 * URL with its query and the client address. The line has the method, the
 * route pattern (never the URL a username or a query may be in), the
 * status, the duration and the caller's certificate role; the client
 * address only for certificate holders — administrators and agents, not
 * people: never for a user of a plugin's user surface, the desktop's
 * user-access calls or the public routes.
 */

/** Callers whose address a request line may carry: certificate holders, not people. */
const CERT_ROLES_LOGGED_WITH_IP = new Set(['admin', 'agent', 'plugin-agent']);

/** The options the panel passes to `logRequestMetadata`. */
export const panelRequestLogOptions = Object.freeze({
  fields: (request) => ({ certRole: request.certRole ?? null }),
  logIp: (request) => CERT_ROLES_LOGGED_WITH_IP.has(request.certRole),
});
