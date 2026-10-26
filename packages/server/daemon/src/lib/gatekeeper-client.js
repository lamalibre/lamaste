/**
 * Tiny gatekeeper admin-API client for callers other than the
 * /api/gatekeeper/* proxy routes.
 *
 * Reads the shared secret on first use (cached for the process lifetime
 * once found) and forwards a request to http://127.0.0.1:9294/api/...
 *
 * Used by the user-delete route to cascade-revoke grants belonging to a
 * deleted Authelia user, by the plugin audiences (grants and groups), the
 * entitlements and the erasure of a removed user, and by other internal
 * callers that need to talk to gatekeeper without going through the
 * panel's own mTLS layer.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getConfigPath } from './config.js';

const GATEKEEPER_BASE = 'http://127.0.0.1:9294';
let cachedSecret = null;

/** Replaces the HTTP exchange with Gatekeeper (tests: there is no Gatekeeper). */
let transportOverride = null;

/**
 * Answer every Gatekeeper request with `transport(method, apiPath, body)`
 * — a {@link GatekeeperResult} — instead of calling Gatekeeper (tests);
 * `null` calls Gatekeeper again.
 *
 * @param {((method: string, apiPath: string, body?: unknown) => Promise<GatekeeperResult>) | null} transport
 */
export function setGatekeeperClientForTests(transport) {
  transportOverride = transport;
}

/**
 * Load the gatekeeper API secret. Supports both the new JSON envelope
 * (`gatekeeper-secret.json`) written by the gatekeeper service and the
 * legacy plain-text file (`gatekeeper-secret`). Returns null if neither
 * exists — callers must treat this as "gatekeeper not installed (yet)".
 * Only a secret that was found is kept: Gatekeeper writes it when it first
 * starts, which may be after the panel's first call.
 */
async function loadSecret() {
  if (cachedSecret) return cachedSecret;

  const configDir = path.dirname(getConfigPath());

  // Prefer the JSON envelope written by recent gatekeeper builds
  try {
    const raw = await readFile(path.join(configDir, 'gatekeeper-secret.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.secret === 'string' && parsed.secret.length > 0) {
      cachedSecret = parsed.secret;
      return cachedSecret;
    }
  } catch {
    // Fall through to legacy
  }

  // Legacy plain-text fallback
  try {
    const raw = (await readFile(path.join(configDir, 'gatekeeper-secret'), 'utf-8')).trim();
    if (raw.length > 0) {
      cachedSecret = raw;
      return cachedSecret;
    }
  } catch {
    // No secret available
  }

  return null;
}

/**
 * Result envelope.
 *
 * @typedef {{ ok: true, statusCode: number, data: unknown }
 *          | { ok: false, statusCode: number, error: string, reason: 'unreachable' | 'no-secret' | 'http-error' }
 *          } GatekeeperResult
 */

/**
 * Forward a request to the gatekeeper service.
 *
 * Network failures (ECONNREFUSED, etc.) and missing-secret conditions
 * are reported as `{ ok: false, reason: ... }` rather than thrown — the
 * panel server treats gatekeeper as best-effort during cascade operations.
 *
 * @param {string} method
 * @param {string} apiPath - e.g. "/api/grants?principalType=user&principalId=alice"
 * @param {unknown} [body]
 * @returns {Promise<GatekeeperResult>}
 */
export async function gatekeeperRequest(method, apiPath, body) {
  if (transportOverride) return transportOverride(method, apiPath, body);

  const secret = await loadSecret();
  if (!secret) {
    return {
      ok: false,
      statusCode: 503,
      error: 'gatekeeper secret not available',
      reason: 'no-secret',
    };
  }

  const url = `${GATEKEEPER_BASE}${apiPath}`;
  // Only set Content-Type when we actually have a body. Fastify rejects
  // `Content-Type: application/json` with an empty body (e.g. DELETE) as
  // 400 Bad Request.
  const headers = { 'X-Gatekeeper-Secret': secret };
  const options = { method, headers };
  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    return {
      ok: false,
      statusCode: 503,
      error: `gatekeeper unreachable: ${err.message}`,
      reason: 'unreachable',
    };
  }

  const text = await response.text();
  let data;
  try {
    data = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (response.status >= 400) {
    return {
      ok: false,
      statusCode: response.status,
      error:
        data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
          ? data.error
          : `gatekeeper returned HTTP ${response.status}`,
      reason: 'http-error',
    };
  }

  return { ok: true, statusCode: response.status, data };
}

// ---------------------------------------------------------------------------
// Typed calls
// ---------------------------------------------------------------------------

/**
 * A grant as Gatekeeper lists it.
 *
 * @typedef {object} GatekeeperGrant
 * @property {string} grantId
 * @property {'user' | 'group'} principalType
 * @property {string} principalId
 * @property {string} resourceType
 * @property {string} resourceId
 * @property {Record<string, unknown>} context
 * @property {boolean} used
 * @property {string} createdAt
 */

/**
 * A Lamaste group as Gatekeeper lists it.
 *
 * @typedef {object} GatekeeperGroup
 * @property {string} name
 * @property {string} description
 * @property {string[]} members usernames
 */

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A failed call as a result, for an answer that is not the shape Gatekeeper gives. */
function malformed(what) {
  return {
    ok: false,
    statusCode: 502,
    error: `gatekeeper answered ${what} in an unexpected shape`,
    reason: 'http-error',
  };
}

function grantOf(raw) {
  if (
    !isRecord(raw) ||
    typeof raw.grantId !== 'string' ||
    (raw.principalType !== 'user' && raw.principalType !== 'group') ||
    typeof raw.principalId !== 'string' ||
    typeof raw.resourceType !== 'string' ||
    typeof raw.resourceId !== 'string'
  ) {
    return null;
  }
  return {
    grantId: raw.grantId,
    principalType: raw.principalType,
    principalId: raw.principalId,
    resourceType: raw.resourceType,
    resourceId: raw.resourceId,
    context: isRecord(raw.context) ? raw.context : {},
    used: raw.used === true,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
  };
}

function groupOf(raw) {
  if (!isRecord(raw) || typeof raw.name !== 'string' || !Array.isArray(raw.members)) return null;
  return {
    name: raw.name,
    description: typeof raw.description === 'string' ? raw.description : '',
    members: raw.members.filter((m) => typeof m === 'string'),
  };
}

/**
 * Every grant on one resource (`resourceType`, `resourceId`).
 *
 * @param {string} resourceType
 * @param {string} resourceId
 * @returns {Promise<{ ok: true, grants: GatekeeperGrant[] } | Extract<GatekeeperResult, { ok: false }>>}
 */
export function listResourceGrants(resourceType, resourceId) {
  return listGrantsMatching({ resourceType, resourceId });
}

/**
 * Every grant on resources of `resourceType` (`tunnel`, `site`,
 * `oidc-client`, …).
 *
 * @param {string} resourceType
 * @returns {Promise<{ ok: true, grants: GatekeeperGrant[] } | Extract<GatekeeperResult, { ok: false }>>}
 */
export function listGrantsOfType(resourceType) {
  return listGrantsMatching({ resourceType });
}

/** The grants matching `filter` (its fields are Gatekeeper's query filters). */
async function listGrantsMatching(filter) {
  const qs = new URLSearchParams(filter).toString();
  const result = await gatekeeperRequest('GET', `/api/grants?${qs}`);
  if (!result.ok) return result;
  if (!isRecord(result.data) || !Array.isArray(result.data.grants)) return malformed('its grants');
  const grants = result.data.grants.map(grantOf);
  if (grants.some((g) => g === null)) return malformed('its grants');
  // Gatekeeper filters by the query; a grant on anything else is not one asked for.
  return {
    ok: true,
    grants: grants.filter((g) => Object.entries(filter).every(([key, value]) => g[key] === value)),
  };
}

/**
 * Every grant on plugin `route` (`resourceType: 'plugin'`, `resourceId:
 * <route>`) — with roles or without.
 *
 * @param {string} route
 * @returns {Promise<{ ok: true, grants: GatekeeperGrant[] } | Extract<GatekeeperResult, { ok: false }>>}
 */
export function listPluginGrants(route) {
  return listResourceGrants('plugin', route);
}

/**
 * Every Lamaste group with its members.
 *
 * @returns {Promise<{ ok: true, groups: GatekeeperGroup[] } | Extract<GatekeeperResult, { ok: false }>>}
 */
export async function listGatekeeperGroups() {
  const result = await gatekeeperRequest('GET', '/api/groups');
  if (!result.ok) return result;
  if (!isRecord(result.data) || !Array.isArray(result.data.groups)) return malformed('its groups');
  const groups = result.data.groups.map(groupOf);
  if (groups.some((g) => g === null)) return malformed('its groups');
  return { ok: true, groups };
}

/**
 * Create a grant. Gatekeeper refuses a duplicate (409: same principal,
 * resource and context JSON) and a grant beyond its limit (503).
 *
 * @param {{ principalType: 'user' | 'group', principalId: string, resourceType: string, resourceId: string, context: Record<string, unknown> }} grant
 * @returns {Promise<{ ok: true, grant: GatekeeperGrant } | Extract<GatekeeperResult, { ok: false }>>}
 */
export async function createGatekeeperGrant(grant) {
  const result = await gatekeeperRequest('POST', '/api/grants', grant);
  if (!result.ok) return result;
  const created = isRecord(result.data) ? grantOf(result.data.grant) : null;
  return created ? { ok: true, grant: created } : malformed('the grant it created');
}

/**
 * Revoke one grant.
 *
 * @param {string} grantId
 * @returns {Promise<GatekeeperResult>}
 */
export function revokeGatekeeperGrant(grantId) {
  return gatekeeperRequest('DELETE', `/api/grants/${encodeURIComponent(grantId)}`);
}

/**
 * Remove everything Gatekeeper holds under `username` — every grant naming
 * the user (any resource type) and its membership of every group — in one
 * transaction. Idempotent. The username goes in the body (a URL is what
 * request logs keep).
 *
 * @param {string} username
 * @returns {Promise<{ ok: true, grantsRemoved: number, groupsLeft: number } | Extract<GatekeeperResult, { ok: false }>>}
 */
export async function removeUserPrincipal(username) {
  const result = await gatekeeperRequest('POST', '/api/principals/user/remove', { username });
  if (!result.ok) return result;
  const data = isRecord(result.data) ? result.data : {};
  if (
    !Number.isSafeInteger(data.grantsRemoved) ||
    data.grantsRemoved < 0 ||
    !Number.isSafeInteger(data.groupsLeft) ||
    data.groupsLeft < 0
  ) {
    return malformed('the principal removal');
  }
  return { ok: true, grantsRemoved: data.grantsRemoved, groupsLeft: data.groupsLeft };
}

/**
 * Drop Gatekeeper's cached session verdicts. Authelia ends every session
 * when users.yml changes; without this a cached verdict would keep a
 * disabled or deleted user in for up to the cache lifetime (30 s).
 *
 * @returns {Promise<{ ok: true } | Extract<GatekeeperResult, { ok: false }>>}
 */
export async function bustGatekeeperSessions() {
  const result = await gatekeeperRequest('POST', '/api/cache/bust');
  return result.ok ? { ok: true } : result;
}

/**
 * Delete the access-request log rows of `username` (logged before
 * `before`, an ISO 8601 time, when given) — part of erasing a removed user.
 * The username goes in the body (a URL is what request logs keep).
 *
 * @param {string} username
 * @param {{ before?: string }} [opts]
 * @returns {Promise<{ ok: true, removed: number } | Extract<GatekeeperResult, { ok: false }>>}
 */
export async function purgeAccessLogForUser(username, { before } = {}) {
  const result = await gatekeeperRequest('POST', '/api/access-log/purge', {
    username,
    ...(before ? { before } : {}),
  });
  if (!result.ok) return result;
  const removed = isRecord(result.data) ? result.data.removed : undefined;
  if (!Number.isSafeInteger(removed) || removed < 0) return malformed('the purge');
  return { ok: true, removed };
}
