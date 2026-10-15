/**
 * Authentication of lamaste-agentd's callers.
 *
 * The daemon listens on 127.0.0.1. That is not an authentication boundary:
 * every OS user on the agent machine can connect to it, and so can every
 * process on the relay, through the panel or plugin tunnel's port on the
 * relay's loopback. A caller is therefore accepted only with proof it
 * cannot forge from there:
 *
 *   - the **owner** — `Authorization: Bearer <agentd.token>`; the token file
 *     is 0600 in the owning user's `~/.lamalibre/lamaste/` (the desktop app,
 *     scripts run as that user). Full access.
 *   - the **relay** — `X-Lamalibre-Relay-Assertion`, signed by the relay per
 *     request (relay-assertion.ts) and verified against the relay's public
 *     keys: the administrator certificate (full access) or this agent's own
 *     certificate (the capabilities the panel lists for it) on the
 *     agent-panel vhost, or an Authelia user on a plugin tunnel (that
 *     plugin's routes only).
 *
 * Headers that merely claim a caller — `X-SSL-Client-*` (the agent-panel
 * vhost's client certificate), `Remote-*` (Authelia's identity) — are
 * removed from every request before any route or plugin sees it. `Remote-*`
 * are put back only from a verified user assertion, so a plugin that reads
 * them (`@lamalibre/lamaste-identity`) reads the relay's word, not a
 * caller's.
 *
 * Which requests need a caller is decided by the route Fastify matched, not
 * by the URL: the router decodes percent-escapes (`/%61pi/...` is routed as
 * `/api/...`), so a URL test can be walked around. Every matched route needs
 * one unless it is marked public ({@link PUBLIC_ROUTE} in its config: the
 * health check, the plugin bundles, the SPA's static files). A request no
 * route matched is answered by a not-found handler: the daemon's own (the
 * SPA shell, or a 404 under /api) carries nothing to protect, but a plugin
 * may set one for its prefix, so an unmatched path under an installed
 * plugin's name — decoded as the router decodes it — needs a caller too.
 */

import { RELAY_ASSERTION_HEADER } from '@lamalibre/lamaste';
import { extractBearerToken, verifyAgentdToken } from './agentd-token.js';

/** Route config key marking a route that answers without a caller. */
export const PUBLIC_ROUTE = 'lamastePublic';

/** Headers that claim a caller. Never passed on as received. */
const CALLER_CLAIM_HEADERS = new Set([
  RELAY_ASSERTION_HEADER,
  'x-ssl-client-verify',
  'x-ssl-client-dn',
  'x-ssl-client-serial',
  'remote-user',
  'remote-groups',
  'remote-name',
  'remote-email',
]);

/**
 * Remove every caller-claiming header from the request — the parsed headers
 * and `rawHeaders` alike; returns the relay assertion it carried, if any.
 *
 * @param {import('fastify').FastifyRequest} request
 * @returns {string | string[] | undefined}
 */
function takeCallerClaims(request) {
  const assertion = request.headers[RELAY_ASSERTION_HEADER];
  for (const name of CALLER_CLAIM_HEADERS) delete request.headers[name];
  const raw = request.raw.rawHeaders;
  if (Array.isArray(raw)) {
    const kept = [];
    for (let i = 0; i + 1 < raw.length; i += 2) {
      if (!CALLER_CLAIM_HEADERS.has(String(raw[i]).toLowerCase())) kept.push(raw[i], raw[i + 1]);
    }
    raw.splice(0, raw.length, ...kept);
  }
  return assertion;
}

/** Set an identity header the relay vouched for, in both header views. */
function setVouchedHeader(request, name, value) {
  request.headers[name] = value;
  if (Array.isArray(request.raw.rawHeaders)) request.raw.rawHeaders.push(name, value);
}

/**
 * The installed plugin a path no route matched lies under, if any: its first
 * segment as the router would decode it. A path that does not decode is
 * treated as under a plugin (refused without a caller, never served).
 *
 * @param {string} url
 * @param {ReadonlySet<string>} pluginNames
 * @returns {string | null}
 */
function unmatchedPluginScope(url, pluginNames) {
  let path;
  try {
    path = decodeURIComponent(url.split('?')[0] ?? '');
  } catch {
    return '';
  }
  const segment = path.split('/')[1] ?? '';
  return pluginNames.has(segment) ? segment : null;
}

/** @param {string} pattern @param {string} route */
function routeBelongsToPlugin(pattern, route) {
  return pattern === `/${route}` || pattern.startsWith(`/${route}/`);
}

/** @param {string} pattern */
function isManagementRoute(pattern) {
  return pattern === '/api' || pattern.startsWith('/api/');
}

/**
 * @typedef {{ ok: true, capabilities: string[], allowedSites: string[] } | { ok: false, error: string }} CapabilityResult
 */

/**
 * Build the daemon's `onRequest` authentication hook.
 *
 * @param {object} opts
 * @param {string} opts.label - the agent this daemon serves (its local registry name)
 * @param {string} opts.agentdToken - the owner's Bearer token
 * @param {import('./relay-verifier.js').RelayVerifier} opts.relayVerifier
 * @param {(request: import('fastify').FastifyRequest) => Promise<CapabilityResult>} opts.loadAgentCapabilities
 *        - the capabilities of this agent's certificate, from the panel
 * @param {ReadonlySet<string>} [opts.pluginNames] - installed plugins (their route prefixes)
 */
export function createAuthHook({
  label,
  agentdToken,
  relayVerifier,
  loadAgentCapabilities,
  pluginNames = new Set(),
}) {
  /**
   * @param {import('fastify').FastifyRequest} request
   * @param {import('fastify').FastifyReply} reply
   * @param {string} header
   * @param {string} pattern - the matched route (`/<plugin>/*` for an unmatched path under a plugin)
   */
  async function authenticateRelayCaller(request, reply, header, pattern) {
    const result = await relayVerifier.verify(header, request.method, request.url);
    if (!result.ok) {
      request.log.warn({ reason: result.reason }, 'Relay assertion refused');
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const { caller, target } = result.payload;

    if (caller.type === 'admin') {
      // The administrator certificate is the master key: no capability check.
      request.certCN = 'admin';
      request.certRole = 'admin';
      request.certLabel = null;
      request.certCapabilities = null;
      request.certAllowedSites = null;
      return;
    }

    if (caller.type === 'agent') {
      // This agent's own certificate: the label the relay knows it by is the
      // assertion's (verified) audience, which a local name need not equal.
      if (caller.label !== result.payload.aud) {
        return reply.code(403).send({ error: 'Certificate not authorized for this agent panel' });
      }
      request.certCN = `agent:${caller.label}`;
      request.certRole = 'agent';
      request.certLabel = label;
      // The panel is the canonical source of the certificate's capabilities;
      // when it cannot be asked, deny — never default to allow.
      const caps = await loadAgentCapabilities(request);
      if (!caps.ok) return reply.code(503).send({ error: caps.error });
      request.certCapabilities = caps.capabilities;
      request.certAllowedSites = caps.allowedSites;
      return;
    }

    // An Authelia user on a plugin tunnel: that plugin's routes only, never
    // the management API. Plugin authorization is Gatekeeper's (grants).
    if (
      !('route' in target) ||
      isManagementRoute(pattern) ||
      !routeBelongsToPlugin(pattern, target.route)
    ) {
      return reply.code(403).send({ error: 'Not a route of the plugin this tunnel serves' });
    }
    setVouchedHeader(request, 'remote-user', caller.username);
    setVouchedHeader(request, 'remote-groups', caller.groups.join(','));
    setVouchedHeader(request, 'remote-name', caller.name);
    setVouchedHeader(request, 'remote-email', caller.email);
    request.certCN = `user:${caller.username}`;
    request.certRole = 'user';
    request.certLabel = null;
    request.autheliaUser = caller.username;
    request.certCapabilities = [];
    request.certAllowedSites = null;
  }

  return async function authHook(request, reply) {
    const assertion = takeCallerClaims(request);

    let pattern = request.routeOptions.url;
    if (pattern === undefined) {
      const plugin = unmatchedPluginScope(request.url, pluginNames);
      if (plugin === null) return;
      pattern = `/${plugin}/*`;
    } else if (request.routeOptions.config?.[PUBLIC_ROUTE] === true) {
      return;
    }

    if (assertion !== undefined) {
      if (typeof assertion !== 'string') {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      return authenticateRelayCaller(request, reply, assertion, pattern);
    }

    const presented = extractBearerToken(request.headers.authorization);
    if (presented && verifyAgentdToken(presented, agentdToken)) {
      // The token proves "this is the owning user". The daemon serves one
      // label; the owner has full access by definition (they own the
      // agent's files) — null means "all capabilities" to requireCap.
      request.certCN = `agent:${label}`;
      request.certRole = 'agent';
      request.certLabel = label;
      request.certCapabilities = null;
      request.certAllowedSites = null;
      return;
    }

    // No usable credential. Generic message — do not disclose which auth
    // paths exist.
    return reply.code(401).send({ error: 'Unauthorized' });
  };
}
