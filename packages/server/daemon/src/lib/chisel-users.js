/**
 * Shim — chisel authfile credential management lives in
 * `@lamalibre/lamaste/server`. This file resolves the chisel credential /
 * authfile paths from env, wires the daemon's execa instance and the
 * persisted tunnel state (the source of per-agent port grants) to the
 * parameterized core API, and applies the restart policy of
 * chisel-runtime.js to every change.
 */

import path from 'node:path';
import { execa } from 'execa';
import {
  addChiselCredential as addChiselCredentialCore,
  removeChiselCredential as removeChiselCredentialCore,
  rotateChiselCredential as rotateChiselCredentialCore,
  getChiselCredential as getChiselCredentialCore,
  getChiselCredentialIssuedAt as getChiselCredentialIssuedAtCore,
  migrateChiselCredentialsIfNeeded as migrateChiselCredentialsIfNeededCore,
  loadChiselCredentials as loadChiselCredentialsCore,
  syncChiselAuthfile as syncChiselAuthfileCore,
} from '@lamalibre/lamaste/server';
import { readTunnels } from './state.js';
import { applyAuthfileChange } from './chisel-runtime.js';

function paths() {
  const stateDir = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';
  return {
    credentialsFile: path.join(stateDir, 'chisel-credentials.json'),
    authFilePath:
      process.env.LAMALIBRE_LAMASTE_CHISEL_AUTHFILE || path.join(stateDir, 'chisel-users'),
    sentinelFile: path.join(stateDir, 'chisel-sentinel'),
  };
}

export function loadChiselCredentials() {
  return loadChiselCredentialsCore(paths());
}

/**
 * Mint a credential for a new agent. Hot-reloaded by chisel; no restart.
 * @returns {Promise<{ user: string, password: string, createdAt: string, restartOk: boolean, restartError?: string }>}
 */
export async function addChiselCredential(label, logger) {
  const result = await addChiselCredentialCore(label, paths(), readTunnels, execa);
  const restart = await applyAuthfileChange(result, logger);
  return { user: result.user, password: result.password, createdAt: result.createdAt, ...restart };
}

/**
 * Remove an agent's credential. Restarts chisel so a live session using it ends.
 * @returns {Promise<{ removed: boolean, restartOk: boolean, restartError?: string }>}
 */
export async function removeChiselCredential(label, logger) {
  const result = await removeChiselCredentialCore(label, paths(), readTunnels, execa);
  const restart = await applyAuthfileChange(result, logger);
  return { removed: result.removed, ...restart };
}

/**
 * Replace an agent's credential. Restarts chisel so the old password stops working.
 * @returns {Promise<{ user: string, password: string, createdAt: string, restartOk: boolean, restartError?: string }>}
 */
export async function rotateChiselCredential(label, logger) {
  const result = await rotateChiselCredentialCore(label, paths(), readTunnels, execa);
  const restart = await applyAuthfileChange(result, logger);
  return { user: result.user, password: result.password, createdAt: result.createdAt, ...restart };
}

export function getChiselCredential(label) {
  return getChiselCredentialCore(label, paths());
}

/** When the agent's current chisel password was issued (not secret), or null. */
export function getChiselCredentialIssuedAt(label) {
  return getChiselCredentialIssuedAtCore(label, paths());
}

/**
 * Mint credentials for active agents that lack one and re-render the
 * authfile. Does not restart chisel — the caller (onboarding, startup
 * reconciliation) owns the chisel lifecycle at that point.
 */
export function migrateChiselCredentialsIfNeeded(loadAgentRegistry, logger) {
  return migrateChiselCredentialsIfNeededCore(
    loadAgentRegistry,
    paths(),
    readTunnels,
    execa,
    logger,
  );
}

/**
 * Re-render the authfile from the credential store and tunnel state.
 * `force` rewrites unchanged content too, re-applying ownership and mode.
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ changed: boolean, revoked: boolean }>}
 */
export function syncChiselAuthfile(options = {}) {
  return syncChiselAuthfileCore(paths(), readTunnels, execa, options);
}

export function getAuthfilePath() {
  return paths().authFilePath;
}

export function getCredentialsPath() {
  return paths().credentialsFile;
}
