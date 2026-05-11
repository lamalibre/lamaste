/**
 * DigitalOcean token scope validation.
 *
 * Validates tokens by probing actual API endpoints rather than relying
 * solely on the X-OAuth-Scopes header (which is only available on
 * GET /v2/account and requires the `account:read` scope).
 *
 * Strategy:
 * 1. Try GET /v2/account — if it works, we get the email and can read
 *    the X-OAuth-Scopes header for scope-level validation.
 * 2. If /v2/account returns 403 (no `account:read`), fall back to
 *    probing read endpoints for each required resource.
 * 3. Write scopes (create/delete) cannot be probed non-destructively,
 *    so we trust that if the read scope is present, the user likely
 *    selected the full resource group in the DO UI.
 */

import type { TokenValidation } from '../types.js';
import { TokenScopeError } from '../errors.js';
import { doGet, assertObject, assertField } from './api.js';
import { CloudHttpError } from '../errors.js';

/**
 * Scopes that Lamaste actually uses during provisioning.
 * This is the minimum set we need — shown in error messages.
 *
 * Note: `regions:read` is plural per the DO API.
 */
export const REQUIRED_SCOPES: readonly string[] = [
  'droplet:create',
  'droplet:read',
  'droplet:delete',
  'ssh_key:create',
  'ssh_key:read',
  'ssh_key:delete',
  'tag:create',
  'tag:read',
  'regions:read',
];

/**
 * Additional scopes that are expected on a correctly scoped token.
 *
 * These come from three sources:
 * 1. Resource group extras — selecting a resource in the DO UI adds
 *    all sub-scopes for that resource (e.g. droplet:update, droplet:admin).
 * 2. Required dependencies — DO auto-adds these when you select a scope
 *    (e.g. droplet:create requires regions:read, sizes:read, etc.).
 * 3. Associated scopes — DO documents these as supporting full functionality
 *    of a scope. Since April 2025 (authorization completeness fix), the DO
 *    UI may auto-add associated scopes to new tokens.
 *
 * All scopes here are harmless for Lamaste's purposes — either read-only,
 * update-only (no resource creation/deletion), or scoped to resources we
 * already interact with during provisioning.
 */
const SAFE_EXTRA_SCOPES: readonly string[] = [
  // Resource group extras (cannot opt out when selecting the group)
  'droplet:update',
  'droplet:admin',
  'ssh_key:update',
  'tag:delete',

  // Required dependencies auto-added by DO for our required scopes.
  // droplet:create/read/delete all require these:
  'account:read',
  'sizes:read',
  'actions:read',
  'image:read',
  'snapshot:read',
  'vpc:read',

  // Associated scopes of droplet:create — DO may auto-add these to
  // ensure full functionality (April 2025 authorization fix).
  'block_storage:read',
  'monitoring:create',
  'database:create',

  // Associated scopes of droplet:read
  'monitoring:read',
  'reserved_ip:read',
  'firewall:read',
  'project:read',

  // Associated scopes of tag:create — tags apply to all resource
  // types, so DO associates update scopes for every taggable resource.
  'app:update',
  'database:update',
  'reserved_ip:update',
  'image:update',
  'load_balancer:update',
  'addon:update',
  'spaces:update',
  'firewall:update',
  'kubernetes:update',

  // Associated scopes of tag:read — read scopes for taggable resources
  'app:read',
  'database:read',
  'load_balancer:read',
  'addon:read',
  'spaces:read',
  'block_storage_snapshot:read',
  'firewall:read',
  'kubernetes:read',

  // DNS management (opt-in — enables automatic DNS record creation).
  // DO's custom scope UI grants all 4 domain sub-scopes as a group;
  // domain:delete cannot be individually deselected. Accepted risk:
  // Lamaste only uses domain:read and domain:create, but we must
  // allow domain:delete and domain:update to avoid rejecting all
  // tokens that have any DNS access.
  'domain:read',
  'domain:create',
  'domain:delete',
  'domain:update',
];

/**
 * Scopes that indicate overly broad permissions.
 * If any of these are present, the token is rejected.
 *
 * This list excludes scopes that DO documents as associated (auto-addable)
 * scopes of the resource groups we require (droplet, ssh_key, tag, regions).
 * For example, database:create is an associated scope of droplet:create and
 * database:update is an associated scope of tag:create — both are in
 * SAFE_EXTRA_SCOPES, not here.
 *
 * Scope names updated to match current DO API (April 2025):
 *   volume:* → block_storage:*, loadbalancer:* → load_balancer:*
 */
const DANGEROUS_SCOPES: readonly string[] = [
  'account:write',
  'database:delete',
  'image:create',
  'image:delete',
  'kubernetes:create',
  'kubernetes:delete',
  'load_balancer:create',
  'load_balancer:delete',
  'block_storage:create',
  'block_storage:delete',
  'vpc:create',
  'vpc:delete',
];

/**
 * Parse the X-OAuth-Scopes header from a DO API response.
 * Returns a deduplicated list of scope strings.
 *
 * Handles both comma-separated (historically used by DO) and
 * space-separated (OAuth 2.0 RFC 6749 standard) formats, as well
 * as any mix of the two.
 */
function parseScopes(header: string | null): string[] {
  if (!header) return [];
  return [...new Set(header.split(/[,\s]+/).filter(Boolean))];
}

/**
 * Probe whether a GET endpoint is accessible (200) or forbidden (403).
 */
async function probeEndpoint(path: string, token: string): Promise<boolean> {
  try {
    await doGet(path, { token });
    return true;
  } catch (err: unknown) {
    if (err instanceof CloudHttpError && err.statusCode === 403) {
      return false;
    }
    throw err;
  }
}

/**
 * Validate a DigitalOcean API token.
 *
 * Tries GET /v2/account first for full scope-header validation.
 * If that fails (no `account:read`), probes read endpoints to verify
 * the token has access to the resources we need.
 */
export async function validateDOToken(token: string): Promise<TokenValidation> {
  // --- Try /v2/account for full validation ---
  let email = '';
  let tokenScopes: string[] | null = null;

  try {
    const { body, headers } = await doGet('/v2/account', { token });
    assertObject(body, 'account response');
    assertField(body, 'account', 'object', 'account response');
    const account = body.account as Record<string, unknown>;
    email = typeof account.email === 'string' ? account.email : '';

    const scopeHeader = headers.get('x-oauth-scopes');
    tokenScopes = parseScopes(scopeHeader);
  } catch (err: unknown) {
    if (err instanceof CloudHttpError && err.statusCode === 403) {
      // No `account:read` — fall back to probe-based validation
    } else {
      throw err;
    }
  }

  // --- If we got scopes from the header, do scope-level validation ---
  if (tokenScopes !== null && tokenScopes.length > 0) {
    const missingScopes = REQUIRED_SCOPES.filter((required) => !tokenScopes.includes(required));

    const excessScopes = tokenScopes.filter((scope) => DANGEROUS_SCOPES.includes(scope));

    const hasDnsAccess = tokenScopes.includes('domain:read');
    const valid = missingScopes.length === 0 && excessScopes.length === 0;
    return { valid, email, missingScopes, excessScopes, hasDnsAccess };
  }

  // --- Fallback: probe read endpoints ---
  const probeResults = await Promise.all([
    probeEndpoint('/v2/droplets?per_page=1', token),
    probeEndpoint('/v2/account/keys?per_page=1', token),
    probeEndpoint('/v2/regions?per_page=1', token),
    probeEndpoint('/v2/tags?per_page=1', token),
    probeEndpoint('/v2/domains?per_page=1', token),
  ]);

  const [hasDroplets, hasSSHKeys, hasRegions, hasTags, hasDnsAccess] = probeResults;
  const missingScopes: string[] = [];

  if (!hasDroplets) {
    missingScopes.push('droplet:read');
  }
  if (!hasSSHKeys) {
    missingScopes.push('ssh_key:read');
  }
  if (!hasRegions) {
    missingScopes.push('regions:read');
  }
  if (!hasTags) {
    missingScopes.push('tag:read');
  }

  // We cannot probe create/delete non-destructively, so if reads pass
  // we trust the user selected the full resource group.
  const valid = missingScopes.length === 0;
  return { valid, email, missingScopes, excessScopes: [], hasDnsAccess };
}

/**
 * Validate a token and throw TokenScopeError if invalid.
 */
export async function assertValidDOToken(token: string): Promise<void> {
  const result = await validateDOToken(token);

  if (!result.valid) {
    const parts: string[] = [];

    if (result.missingScopes.length > 0) {
      parts.push(`Missing required scopes: ${result.missingScopes.join(', ')}`);
    }
    if (result.excessScopes.length > 0) {
      parts.push(
        `Token has dangerous excess scopes: ${result.excessScopes.join(', ')}. ` +
          'Please create a new token with only the required scopes at ' +
          'https://cloud.digitalocean.com/account/api/tokens/new',
      );
    }

    throw new TokenScopeError(parts.join('. '), result.missingScopes, result.excessScopes);
  }
}
