/**
 * Panel REST API client for localhost calls.
 *
 * Used by tunnel/site commands that need the full dependency stack
 * (nginx, certbot, chisel) which lives in the running panel server.
 * Authenticates via the admin mTLS client certificate.
 */

import { readFile, writeFile, unlink } from 'node:fs/promises';
import crypto from 'node:crypto';
import { execa } from 'execa';
import { PKI_DIR } from './config.js';

const PANEL_URL = 'https://127.0.0.1:9292';

/**
 * Make an authenticated API request to the local panel server.
 *
 * Uses curl with the admin client certificate (mTLS) and a temporary
 * config file for the P12 password (never in process args).
 *
 * @param {string} method
 * @param {string} path  e.g. '/api/tunnels'
 * @param {Record<string, unknown> | null} [body]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function panelRequest(method, path, body = null) {
  const p12Path = `${PKI_DIR}/client.p12`;

  // Read p12 password from the stored file
  let p12Password;
  try {
    p12Password = (await readFile(`${PKI_DIR}/.p12-password`, 'utf-8')).trim();
  } catch {
    throw new Error(
      'Cannot read P12 password. Ensure the server is properly installed and /etc/lamalibre/lamaste/pki/.p12-password exists.',
    );
  }

  // Write password to a temporary config file (never in process args)
  const tmpConfigPath = `/tmp/lamalibre-lamaste-curl-${crypto.randomBytes(8).toString('hex')}`;
  try {
    await writeFile(tmpConfigPath, `--pass "${p12Password}"\n`, { mode: 0o600 });

    const curlArgs = [
      '-K',
      tmpConfigPath,
      '--cert-type',
      'P12',
      '--cert',
      p12Path,
      '-k', // Server uses self-signed cert on localhost
      '-s', // Silent
      '-S', // Show errors
      '-X',
      method,
      '-H',
      'Content-Type: application/json',
    ];

    if (body) {
      curlArgs.push('-d', JSON.stringify(body));
    }

    curlArgs.push(`${PANEL_URL}${path}`);

    const { stdout } = await execa('curl', curlArgs, { timeout: 30000 });

    if (!stdout.trim()) {
      return {};
    }

    return JSON.parse(stdout);
  } finally {
    await unlink(tmpConfigPath).catch(() => {});
  }
}
