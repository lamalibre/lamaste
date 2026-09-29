/**
 * Shim — chisel service lifecycle lives in `@lamalibre/lamaste/server`.
 * This file wires the daemon's execa instance and resolved authfile path
 * to the parameterized core API.
 *
 * The binary and the unit are create-lamaste's (installed as root); the
 * panel manages the key, the authfile and the service state.
 */

import { execa } from 'execa';
import { access } from 'node:fs/promises';
import { CHISEL_BIN } from '@lamalibre/lamaste/server';
import {
  getInstalledChiselVersion as getInstalledChiselVersionCore,
  ensureChiselKey as ensureChiselKeyCore,
  startChisel as startChiselCore,
  reloadChisel as reloadChiselCore,
  stopChisel as stopChiselCore,
  isChiselRunning as isChiselRunningCore,
  getChiselStatus as getChiselStatusCore,
} from '@lamalibre/lamaste/server';
import { syncChiselAuthfile } from './chisel-users.js';
import { applyAuthfileChange } from './chisel-runtime.js';

function keyFilePath() {
  return process.env.LAMALIBRE_LAMASTE_CHISEL_KEYFILE || '/etc/lamalibre/lamaste/chisel-server.key';
}

/** True once create-lamaste has installed the chisel binary. */
export async function isChiselInstalled() {
  try {
    await access(CHISEL_BIN);
    return true;
  } catch {
    return false;
  }
}

export function getInstalledChiselVersion() {
  return getInstalledChiselVersionCore(execa);
}

export function ensureChiselKey() {
  return ensureChiselKeyCore(keyFilePath(), execa);
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
