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

/**
 * Fetch the list of static sites from the panel.
 * @param {string} panelUrl
 * @param {string} p12Path
 * @param {string} p12Password
 * @returns {Promise<{ sites: Array }>}
 */
export async function fetchSites(panelUrl, p12Path, p12Password) {
  const url = `${panelUrl}/api/sites`;
  try {
    const { stdout } = await execa('curl', [
      ...certArgs(p12Path, p12Password),
      url,
    ]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to fetch sites from panel. ` +
        `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Create a new static site on the panel.
 * @param {string} panelUrl
 * @param {string} p12Path
 * @param {string} p12Password
 * @param {object} body - Site creation payload
 * @returns {Promise<object>}
 */
export async function createSite(panelUrl, p12Path, p12Password, body) {
  const url = `${panelUrl}/api/sites`;
  try {
    const { stdout } = await execa('curl', [
      ...certArgs(p12Path, p12Password),
      '-X', 'POST',
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify(body),
      url,
    ]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to create site on panel. ` +
        `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Delete a static site from the panel.
 * @param {string} panelUrl
 * @param {string} p12Path
 * @param {string} p12Password
 * @param {string} siteId - Site UUID
 * @returns {Promise<object>}
 */
export async function deleteSite(panelUrl, p12Path, p12Password, siteId) {
  const url = `${panelUrl}/api/sites/${encodeURIComponent(siteId)}`;
  try {
    const { stdout } = await execa('curl', [
      ...certArgs(p12Path, p12Password),
      '-X', 'DELETE',
      url,
    ]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to delete site from panel. ` +
        `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Fetch the file listing for a static site directory.
 * @param {string} panelUrl
 * @param {string} p12Path
 * @param {string} p12Password
 * @param {string} siteId - Site UUID
 * @param {string} [dirPath='.'] - Directory path to list
 * @returns {Promise<{ files: Array }>}
 */
export async function fetchSiteFiles(panelUrl, p12Path, p12Password, siteId, dirPath = '.') {
  const url = `${panelUrl}/api/sites/${encodeURIComponent(siteId)}/files?path=${encodeURIComponent(dirPath)}`;
  try {
    const { stdout } = await execa('curl', [
      ...certArgs(p12Path, p12Password),
      url,
    ]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to fetch site files from panel. ` +
        `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Upload files to a static site directory.
 * @param {string} panelUrl
 * @param {string} p12Path
 * @param {string} p12Password
 * @param {string} siteId - Site UUID
 * @param {string} dirPath - Target directory path
 * @param {string[]} localFilePaths - Array of absolute local file paths
 * @returns {Promise<object>}
 */
export async function uploadSiteFiles(panelUrl, p12Path, p12Password, siteId, dirPath, localFilePaths) {
  const url = `${panelUrl}/api/sites/${encodeURIComponent(siteId)}/files?path=${encodeURIComponent(dirPath)}`;
  const fileArgs = localFilePaths.flatMap((fp) => ['-F', `file=@${fp}`]);
  try {
    const { stdout } = await execa('curl', [
      ...certArgs(p12Path, p12Password),
      '-X', 'POST',
      ...fileArgs,
      url,
    ]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to upload files to site. ` +
        `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Delete a file from a static site.
 * @param {string} panelUrl
 * @param {string} p12Path
 * @param {string} p12Password
 * @param {string} siteId - Site UUID
 * @param {string} filePath - Path of the file to delete
 * @returns {Promise<object>}
 */
export async function deleteSiteFile(panelUrl, p12Path, p12Password, siteId, filePath) {
  const url = `${panelUrl}/api/sites/${encodeURIComponent(siteId)}/files`;
  try {
    const { stdout } = await execa('curl', [
      ...certArgs(p12Path, p12Password),
      '-X', 'DELETE',
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({ path: filePath }),
      url,
    ]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to delete site file from panel. ` +
        `Details: ${err.stderr || err.message}`,
    );
  }
}
