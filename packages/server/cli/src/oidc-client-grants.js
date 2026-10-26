/**
 * Grants on a plugin's user-facing OIDC clients as `lamaste-server plugins
 * oidc-clients` takes and prints them — pure helpers, exported for tests
 * (the command is src/commands/plugins.js).
 *
 * A grant is a Gatekeeper grant with `resourceType: 'oidc-client'` and the
 * client id as `resourceId`; members of the plugin's domain sign in without
 * one, an external member only with one (to them or a Lamaste group they
 * belong to).
 */

import { terminalText } from './plugin-settings.js';

/** The Gatekeeper resource type of a grant on an OIDC client. */
export const OIDC_CLIENT_RESOURCE = 'oidc-client';

/**
 * The principal `--user <username>` or `--group <name>` names — exactly one
 * of them — or null.
 *
 * @param {string[]} args
 * @returns {{ principalType: 'user' | 'group', principalId: string } | null}
 */
export function parsePrincipal(args) {
  if (args.length !== 2) return null;
  const [flag, id] = args;
  if (!id || id.startsWith('--')) return null;
  if (flag === '--user') return { principalType: 'user', principalId: id };
  if (flag === '--group') return { principalType: 'group', principalId: id };
  return null;
}

/** A grant's principal in words: the username, or `group:<name>`. */
export function principalText(grant) {
  return terminalText(
    grant.principalType === 'group' ? `group:${grant.principalId}` : grant.principalId,
  );
}

/**
 * The grant on `clientId` that names `principal`, among the clients
 * `GET /api/plugins/:name/oidc-clients` lists — or why there is none to
 * revoke: `no_client` (not a user-facing client of the plugin),
 * `unreadable` (Gatekeeper could not be read), `no_grant`.
 *
 * @param {ReadonlyArray<Record<string, any>>} clients
 * @param {string} clientId
 * @param {{ principalType: string, principalId: string }} principal
 * @returns {{ grantId: string } | { error: 'no_client' | 'unreadable' | 'no_grant' }}
 */
export function findClientGrant(clients, clientId, principal) {
  const client = clients.find((c) => c.id === clientId && c.userFacing);
  if (!client) return { error: 'no_client' };
  if (!Array.isArray(client.grants)) return { error: 'unreadable' };
  const grant = client.grants.find(
    (g) => g.principalType === principal.principalType && g.principalId === principal.principalId,
  );
  return grant ? { grantId: grant.grantId } : { error: 'no_grant' };
}
