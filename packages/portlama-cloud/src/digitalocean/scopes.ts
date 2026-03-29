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
 * Scopes that Portlama actually uses during provisioning.
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
 * The DO custom scopes UI works at the resource level — selecting
 * "droplet" gives all 5 sub-scopes, "ssh_key" gives all 4, etc.
 * The minimum token (account + droplet + regions + ssh_key + tag)
 * has 20 scopes on the wire:
 *
 * From resource groups (cannot be individually deselected):
 *   droplet:update, droplet:admin, ssh_key:update, tag:delete
 *
 * Auto-added as dependencies of droplet:read:
 *   account:read, sizes:read, actions:read, image:read,
 *   snapshot:read, vpc:read
 *
 * All of these are harmless — either read-only or non-destructive.
 */
const SAFE_EXTRA_SCOPES: readonly string[] = [
  // Resource group extras (cannot opt out)
  'droplet:update',
  'droplet:admin',
  'ssh_key:update',
  'tag:delete',
  // Auto-added dependencies of droplet:read
  'account:read',
  'sizes:read',
  'actions:read',
  'image:read',
  'snapshot:read',
  'vpc:read',
  // DNS management (opt-in — enables automatic DNS record creation).
  // DO's custom scope UI grants all 4 domain sub-scopes as a group;
  // domain:delete cannot be individually deselected. Accepted risk:
  // Portlama only uses domain:read and domain:create, but we must
  // allow domain:delete and domain:update to avoid rejecting all
  // tokens that have any DNS access.
  'domain:read',
  'domain:create',
  'domain:delete',
  'domain:update',
];

/**
 * Scope patterns that indicate overly broad permissions.
 * If any of these are present, the token is rejected.
 */
const DANGEROUS_SCOPE_PREFIXES: readonly string[] = [
  'account:write',
  'database:create',
  'database:delete',
  'firewall:create',
  'firewall:delete',
  'image:create',
  'image:delete',
  'kubernetes:create',
  'kubernetes:delete',
  'loadbalancer:create',
  'loadbalancer:delete',
  'volume:create',
  'volume:delete',
  'vpc:create',
  'vpc:delete',
];

/**
 * Parse the X-OAuth-Scopes header from a DO API response.
 * Returns a deduplicated list of scope strings.
 */
function parseScopes(header: string | null): string[] {
  if (!header) return [];
  return [...new Set(
    header
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )];
}

/**
 * Probe whether a GET endpoint is accessible (200) or forbidden (403).
 */
async function probeEndpoint(
  path: string,
  token: string,
): Promise<boolean> {
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
    const missingScopes = REQUIRED_SCOPES.filter(
      (required) => !tokenScopes.includes(required),
    );

    const excessScopes = tokenScopes.filter((scope) =>
      DANGEROUS_SCOPE_PREFIXES.includes(scope),
    );

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

    throw new TokenScopeError(
      parts.join('. '),
      result.missingScopes,
      result.excessScopes,
    );
  }
}
