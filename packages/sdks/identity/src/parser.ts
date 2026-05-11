/**
 * Pure functions for parsing Authelia identity headers.
 *
 * No HTTP, no dependencies — these operate on raw header objects
 * as provided by Node.js/Fastify (lowercase keys, string or string[] values).
 */

import type { AutheliaIdentity, IdentityParseError, IdentityParseResult } from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract a single string value from a header that may be a string,
 * string array, or undefined. For arrays, takes the first element.
 */
function headerValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Check if a string contains control characters (chars < 0x20 except tab).
 */
function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 && code !== 0x09) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse Authelia identity headers from a request.
 *
 * @param headers — Raw header object (lowercase keys, as Node.js/Fastify provides).
 * @returns `null` if no identity headers are present, an error object if headers
 *   are malformed, or a parsed `AutheliaIdentity`.
 */
export function parseIdentity(
  headers: Record<string, string | string[] | undefined>,
): IdentityParseResult {
  const rawUser = headerValue(headers['remote-user']);

  // No Remote-User header at all — unauthenticated request
  if (rawUser === undefined) return null;

  // Remote-User present but empty
  if (rawUser === '') {
    return {
      error: true,
      message: 'Remote-User header is empty string',
    } satisfies IdentityParseError;
  }

  // Control character check (chars < 0x20 except tab) — applied to every
  // Remote-* header we read, not just Remote-User. Authelia normalizes its
  // own output, but if any upstream injects a value (header smuggling, plugin
  // bug, mis-templated nginx config) we want to fail closed before the value
  // reaches a logger or a downstream client.
  if (hasControlCharacters(rawUser)) {
    return {
      error: true,
      message: 'Remote-User header contains control characters',
    } satisfies IdentityParseError;
  }

  // Parse groups: comma-separated, trimmed, empty entries removed
  const rawGroups = headerValue(headers['remote-groups']) ?? '';
  if (hasControlCharacters(rawGroups)) {
    return {
      error: true,
      message: 'Remote-Groups header contains control characters',
    } satisfies IdentityParseError;
  }
  const groups = rawGroups
    .split(',')
    .map((g) => g.trim())
    .filter((g) => g.length > 0);

  // Display name and email default to empty string
  const displayName = headerValue(headers['remote-name']) ?? '';
  if (hasControlCharacters(displayName)) {
    return {
      error: true,
      message: 'Remote-Name header contains control characters',
    } satisfies IdentityParseError;
  }
  const email = headerValue(headers['remote-email']) ?? '';
  if (hasControlCharacters(email)) {
    return {
      error: true,
      message: 'Remote-Email header contains control characters',
    } satisfies IdentityParseError;
  }

  return { username: rawUser, displayName, email, groups } satisfies AutheliaIdentity;
}

/**
 * Check if an identity belongs to a specific group.
 */
export function hasGroup(identity: AutheliaIdentity, group: string): boolean {
  return identity.groups.includes(group);
}

/**
 * Type guard for `IdentityParseError`.
 */
export function isIdentityParseError(result: IdentityParseResult): result is IdentityParseError {
  return (
    result !== null && typeof result === 'object' && 'error' in result && result.error === true
  );
}
