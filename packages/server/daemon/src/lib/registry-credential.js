/**
 * Registry credential (Feria) — daemon shim over `@lamalibre/lamaste/server`.
 *
 * Binds the core module to this daemon's state directory and adds the one
 * piece of policy that belongs here: when a user loses a `feria-*` group or
 * is deleted, their registry tokens are revoked (best effort, never blocks
 * the user operation).
 */

import {
  readRegistryCredentialConfig as readCore,
  writeRegistryCredentialConfig as writeCore,
  clearRegistryCredentialConfig as clearCore,
  brokerAgentRegistryToken,
  revokeRegistryTokensForOwner,
  lostFeriaGroups,
} from '@lamalibre/lamaste/server';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';

export function readRegistryCredentialConfig() {
  return readCore(STATE_DIR);
}

export function writeRegistryCredentialConfig(config) {
  return writeCore(STATE_DIR, config);
}

export function clearRegistryCredentialConfig() {
  return clearCore(STATE_DIR);
}

/**
 * Broker a one-hour read token for an agent. Throws RegistryCredentialError
 * (with `statusCode`) when no credential is configured or the registry
 * refuses.
 * @param {string} agentLabel
 */
export async function brokerAgentToken(agentLabel) {
  const config = await readRegistryCredentialConfig();
  if (!config) return null;
  return brokerAgentRegistryToken(config, agentLabel);
}

/**
 * Revoke a user's registry tokens after their `feria-*` groups changed or
 * they were deleted. Returns the number revoked, or `null` when nothing
 * needed doing (no credential configured, or no feria group lost).
 *
 * @param {string} username
 * @param {{ before: string[], after: string[] } | { deleted: true }} change
 * @param {import('pino').Logger} log
 */
export async function revokeUserRegistryTokens(username, change, log) {
  const config = await readRegistryCredentialConfig();
  if (!config) return null;

  const lost =
    'deleted' in change ? ['(deleted)'] : lostFeriaGroups(change.before ?? [], change.after ?? []);
  if (lost.length === 0) return null;

  const owner = `user:${username}`;
  const revoked = await revokeRegistryTokensForOwner(config, owner);
  log.info({ username, lost, revoked }, 'Revoked registry tokens after group change');
  return revoked;
}
