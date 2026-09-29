/**
 * Shim — chisel service lifecycle lives in `@lamalibre/lamaste/server`.
 * This file wires the daemon's execa instance and resolved authfile path
 * to the parameterized core API.
 */

import { execa } from 'execa';
import {
  installChisel as installChiselCore,
  getInstalledChiselVersion as getInstalledChiselVersionCore,
  ensureChiselKey as ensureChiselKeyCore,
  buildChiselUnit as buildChiselUnitCore,
  writeChiselService as writeChiselServiceCore,
  ensureChiselService as ensureChiselServiceCore,
  isChiselProvisioned as isChiselProvisionedCore,
  startChisel as startChiselCore,
  reloadChisel as reloadChiselCore,
  stopChisel as stopChiselCore,
  isChiselRunning as isChiselRunningCore,
  getChiselStatus as getChiselStatusCore,
} from '@lamalibre/lamaste/server';
import { syncChiselAuthfile } from './chisel-users.js';
import { applyAuthfileChange } from './chisel-runtime.js';

function authFilePath() {
  return process.env.LAMALIBRE_LAMASTE_CHISEL_AUTHFILE || '/etc/lamalibre/lamaste/chisel-users';
}

function keyFilePath() {
  return process.env.LAMALIBRE_LAMASTE_CHISEL_KEYFILE || '/etc/lamalibre/lamaste/chisel-server.key';
}

export function installChisel() {
  return installChiselCore(execa);
}

export function getInstalledChiselVersion() {
  return getInstalledChiselVersionCore(execa);
}

export function ensureChiselKey() {
  return ensureChiselKeyCore(keyFilePath(), execa);
}

export function buildChiselUnit() {
  return buildChiselUnitCore(authFilePath(), keyFilePath());
}

export function writeChiselService() {
  return writeChiselServiceCore(authFilePath(), keyFilePath(), execa);
}

/** Rewrite the chisel unit if it differs; reports `{ changed }`. */
export function ensureChiselService() {
  return ensureChiselServiceCore(authFilePath(), keyFilePath(), execa);
}

export function isChiselProvisioned() {
  return isChiselProvisionedCore();
}

export function startChisel() {
  return startChiselCore(execa);
}

export function reloadChisel() {
  return reloadChiselCore(execa);
}

export function stopChisel() {
  return stopChiselCore(execa);
}

export function isChiselRunning() {
  return isChiselRunningCore(execa);
}

export function getChiselStatus() {
  return getChiselStatusCore(execa);
}

/**
 * Bring chisel in line with the persisted tunnel state: re-render the
 * authfile (each agent may bind only the ports of the enabled tunnels it
 * owns). Chisel reloads the file by itself; when the new file withdraws a
 * grant, chisel is restarted so live sessions drop the binding. Call only
 * after the tunnel state has been written. Throws if the restart fails,
 * since a withdrawn grant would otherwise stay live.
 */
export async function syncChisel() {
  const change = await syncChiselAuthfile();
  const { restartOk, restartError } = await applyAuthfileChange(change);
  if (!restartOk) {
    throw new Error(`Chisel restart failed after withdrawing a port grant: ${restartError}`);
  }
}
