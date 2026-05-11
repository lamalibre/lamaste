/**
 * Shim — chisel authfile credential management now lives in
 * `@lamalibre/lamaste/server`. This file resolves the chisel credential /
 * authfile paths from env and wires the daemon's execa instance to the
 * parameterized core API so existing callers keep their old signatures.
 */

import path from 'node:path';
import { execa } from 'execa';
import {
  addChiselCredential as addChiselCredentialCore,
  removeChiselCredential as removeChiselCredentialCore,
  rotateChiselCredential as rotateChiselCredentialCore,
  getChiselCredential as getChiselCredentialCore,
  reloadChiselAuth as reloadChiselAuthCore,
  migrateChiselCredentialsIfNeeded as migrateChiselCredentialsIfNeededCore,
  loadChiselCredentials as loadChiselCredentialsCore,
} from '@lamalibre/lamaste/server';

function paths() {
  const stateDir = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';
  return {
    credentialsFile: path.join(stateDir, 'chisel-credentials.json'),
    authFilePath:
      process.env.LAMALIBRE_LAMASTE_CHISEL_AUTHFILE || path.join(stateDir, 'chisel-users'),
  };
}

export function loadChiselCredentials() {
  return loadChiselCredentialsCore(paths());
}

export function reloadChiselAuth(logger) {
  return reloadChiselAuthCore(execa, logger);
}

export function addChiselCredential(label, logger) {
  return addChiselCredentialCore(label, paths(), execa, logger);
}

export function removeChiselCredential(label, logger) {
  return removeChiselCredentialCore(label, paths(), execa, logger);
}

export function rotateChiselCredential(label, logger) {
  return rotateChiselCredentialCore(label, paths(), execa, logger);
}

export function getChiselCredential(label) {
  return getChiselCredentialCore(label, paths());
}

export function migrateChiselCredentialsIfNeeded(loadAgentRegistry, logger) {
  return migrateChiselCredentialsIfNeededCore(loadAgentRegistry, paths(), execa, logger);
}

export function getAuthfilePath() {
  return paths().authFilePath;
}

export function getCredentialsPath() {
  return paths().credentialsFile;
}
