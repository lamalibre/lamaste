/**
 * Server configuration helpers.
 *
 * Reads panel.json and provides common paths used by all commands.
 */

import { readFile } from 'node:fs/promises';

/** Default paths used on the server. */
export const CONFIG_PATH =
  process.env.LAMALIBRE_LAMASTE_CONFIG || '/etc/lamalibre/lamaste/panel.json';
export const STATE_DIR = process.env.LAMALIBRE_LAMASTE_DATA_DIR || '/etc/lamalibre/lamaste';
export const PKI_DIR = process.env.LAMALIBRE_LAMASTE_PKI_DIR || '/etc/lamalibre/lamaste/pki';

/** Systemd service names. */
export const PANEL_SERVICE = 'lamalibre-lamaste-serverd';
export const GATEKEEPER_SERVICE = 'lamalibre-lamaste-gatekeeper';

/**
 * Read and parse panel.json.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readConfig() {
  const raw = await readFile(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Read panel.json, returning null on error instead of throwing.
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function readConfigSafe() {
  try {
    return await readConfig();
  } catch {
    return null;
  }
}
