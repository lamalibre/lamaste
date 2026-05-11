/**
 * Direct state file readers for server CLI.
 *
 * Used by list/read commands that only need to read the JSON state files.
 * Mutation commands use the panel REST API instead, since mutations require
 * the full dependency stack (nginx, certbot, chisel).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { STATE_DIR } from './config.js';

/**
 * Read and parse a JSON state file, returning a default value on ENOENT.
 * @param {string} filename
 * @param {unknown} defaultValue
 * @returns {Promise<unknown>}
 */
async function readStateFile(filename, defaultValue) {
  try {
    const raw = await readFile(path.join(STATE_DIR, filename), 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return defaultValue;
    throw new Error(`Failed to read ${filename}: ${err.message}`);
  }
}

/**
 * Read the tunnels array from tunnels.json.
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function readTunnels() {
  const data = await readStateFile('tunnels.json', []);
  return Array.isArray(data) ? data : [];
}

/**
 * Read the sites array from sites.json.
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function readSites() {
  const data = await readStateFile('sites.json', []);
  return Array.isArray(data) ? data : [];
}
