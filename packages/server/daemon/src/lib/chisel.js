/**
 * Shim — chisel service lifecycle now lives in `@lamalibre/lamaste/server`.
 * This file wires the daemon's execa instance and resolved authfile path
 * to the parameterized core API.
 */

import { execa } from 'execa';
import {
  installChisel as installChiselCore,
  ensureChiselKey as ensureChiselKeyCore,
  buildChiselUnit as buildChiselUnitCore,
  writeChiselService as writeChiselServiceCore,
  startChisel as startChiselCore,
  reloadChisel as reloadChiselCore,
  stopChisel as stopChiselCore,
  isChiselRunning as isChiselRunningCore,
  getChiselStatus as getChiselStatusCore,
  updateChiselConfig as updateChiselConfigCore,
} from '@lamalibre/lamaste/server';

function authFilePath() {
  return process.env.LAMALIBRE_LAMASTE_CHISEL_AUTHFILE || '/etc/lamalibre/lamaste/chisel-users';
}

function keyFilePath() {
  return process.env.LAMALIBRE_LAMASTE_CHISEL_KEYFILE || '/etc/lamalibre/lamaste/chisel-server.key';
}

export function installChisel() {
  return installChiselCore(execa);
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

export function updateChiselConfig(tunnels) {
  return updateChiselConfigCore(tunnels, authFilePath(), keyFilePath(), execa);
}
