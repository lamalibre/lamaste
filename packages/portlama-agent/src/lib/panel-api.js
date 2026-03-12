import { execa } from 'execa';

/**
 * Build the common curl args for mTLS authentication.
 * @param {string} p12Path - Path to client.p12
 * @param {string} p12Password - P12 password
 * @returns {string[]}
 */
function certArgs(p12Path, p12Password) {
  return [
    '--cert-type', 'P12',
    '--cert', `${p12Path}:${p12Password}`,
    '-k', // accept self-signed server cert
    '-s', // silent
    '-f', // fail on HTTP errors
    '--max-time', '30',
  ];
}

/**
 * Check panel connectivity by hitting /api/health.
 * @param {string} panelUrl - e.g. "https://1.2.3.4:9292"
 * @param {string} p12Path
 * @param {string} p12Password
 * @returns {Promise<object>}
 */
export async function fetchHealth(panelUrl, p12Path, p12Password) {
  const url = `${panelUrl}/api/health`;
  try {
    const { stdout } = await execa('curl', [
      ...certArgs(p12Path, p12Password),
      url,
    ]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Cannot reach panel at ${url}. ` +
        `Check the URL and that your client.p12 is valid. ` +
        `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Fetch the plist XML and metadata from the panel.
 * @param {string} panelUrl
 * @param {string} p12Path
 * @param {string} p12Password
 * @returns {Promise<{ plist: string, instructions: object }>}
 */
export async function fetchPlist(panelUrl, p12Path, p12Password) {
  const url = `${panelUrl}/api/tunnels/mac-plist?format=json`;
  try {
    const { stdout } = await execa('curl', [
      ...certArgs(p12Path, p12Password),
      url,
    ]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to fetch plist from panel. ` +
        `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Fetch the tunnel list from the panel.
 * @param {string} panelUrl
 * @param {string} p12Path
 * @param {string} p12Password
 * @returns {Promise<{ tunnels: Array<{ id: string, subdomain: string, port: number }> }>}
 */
export async function fetchTunnels(panelUrl, p12Path, p12Password) {
  const url = `${panelUrl}/api/tunnels`;
  try {
    const { stdout } = await execa('curl', [
      ...certArgs(p12Path, p12Password),
      url,
    ]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to fetch tunnels from panel. ` +
        `Details: ${err.stderr || err.message}`,
    );
  }
}
