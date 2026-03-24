import crypto from 'node:crypto';
import { readdirSync, unlinkSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { AGENT_DIR } from './platform.js';

/**
 * Clean up stale curl config temp files left behind by previous crashes.
 * Runs once at module load — synchronous to keep it simple and non-blocking
 * at startup (these files are tiny).
 */
function cleanupStaleCurlConfigs() {
  try {
    const entries = readdirSync(AGENT_DIR);
    for (const entry of entries) {
      if (entry.startsWith('.curl-config-') && entry.endsWith('.tmp')) {
        try {
          unlinkSync(path.join(AGENT_DIR, entry));
        } catch {
          // Best-effort — may be locked or already removed
        }
      }
    }
  } catch {
    // AGENT_DIR may not exist yet — that is fine
  }
}

// Run cleanup once at import time
cleanupStaleCurlConfigs();

/**
 * Validate that p12Path and p12Password do not contain newlines or other
 * characters that could break the curl config file format.
 * @param {string} p12Path
 * @param {string} p12Password
 */
function validateCertInputs(p12Path, p12Password) {
  if (/[\r\n\0]/.test(p12Path)) {
    throw new Error('p12Path must not contain newline or null characters');
  }
  if (/[\r\n\0]/.test(p12Password)) {
    throw new Error('p12Password must not contain newline or null characters');
  }
}

/**
 * Create a temporary curl config file containing the mTLS cert credentials.
 * The file is written with mode 0600 so only the owner can read it, keeping
 * the P12 password out of process argument lists (invisible to `ps aux`).
 * @param {string} p12Path - Path to client.p12
 * @param {string} p12Password - P12 password
 * @returns {Promise<string>} Path to the temporary config file
 */
async function createCurlConfig(p12Path, p12Password) {
  validateCertInputs(p12Path, p12Password);
  const suffix = crypto.randomBytes(8).toString('hex');
  const configPath = path.join(AGENT_DIR, `.curl-config-${suffix}.tmp`);
  // Escape backslashes and double-quotes in the cert path and password to prevent
  // curl config injection. Curl config files use \" for literal quote and \\ for backslash.
  const escapedPath = p12Path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedPass = p12Password.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const content = `cert = "${escapedPath}:${escapedPass}"\ncert-type = "P12"\n`;
  // O_EXCL (wx flag) prevents symlink attacks — fails if the file already exists
  await writeFile(configPath, content, { flag: 'wx', mode: 0o600 });
  return configPath;
}

/**
 * Remove a temporary curl config file. Errors are silently ignored
 * (the file may already have been cleaned up).
 * @param {string} configPath
 */
async function removeCurlConfig(configPath) {
  try {
    await unlink(configPath);
  } catch {
    // Ignore — file may already be gone
  }
}

/**
 * Build the common curl args for mTLS authentication.
 * The cert credentials are passed via a config file (-K) so the P12
 * password never appears in process argument lists.
 *
 * TODO: Implement server certificate distribution during setup so we can
 * replace -k with --cacert and verify the panel's TLS server certificate.
 *
 * @param {string} configPath - Path to the temporary curl config file
 * @returns {string[]}
 */
function certArgs(configPath) {
  // The panel uses a self-signed TLS server certificate that is separate from
  // the mTLS CA used to sign client certificates. The CA cert extracted from
  // the P12 (mTLS CA) cannot verify the server's TLS cert. Until proper server
  // certificate distribution is implemented, we must skip server TLS verification
  // with -k. The mTLS client cert still authenticates the agent to the panel.
  return [
    '-K',
    configPath,
    '-s', // silent
    '-f', // fail on HTTP errors
    '--max-time',
    '30',
    '-k', // skip server TLS verification (self-signed server cert)
  ];
}

/**
 * Execute a curl command with mTLS credentials passed via a temporary config
 * file.  The config file is created before the call and removed afterwards,
 * regardless of success or failure.
 * @param {string} p12Path
 * @param {string} p12Password
 * @param {string[]} extraArgs - Additional curl arguments (must end with the URL)
 * @returns {Promise<import('execa').ExecaReturnValue>}
 */
async function curlWithConfig(p12Path, p12Password, extraArgs) {
  const configPath = await createCurlConfig(p12Path, p12Password);
  try {
    return await execa('curl', [...certArgs(configPath), ...extraArgs]);
  } finally {
    await removeCurlConfig(configPath);
  }
}

/**
 * Execute a curl command using a macOS Keychain identity for mTLS.
 * curl on macOS natively supports Keychain identities via --cert.
 *
 * @param {string} keychainIdentity - Keychain identity name (e.g. "Portlama Agent (macbook-pro)")
 * @param {string[]} extraArgs - Additional curl arguments (must end with the URL)
 * @returns {Promise<import('execa').ExecaReturnValue>}
 */
async function curlWithKeychain(keychainIdentity, extraArgs) {
  return execa('curl', [
    '--cert',
    keychainIdentity,
    '-s',           // silent
    '-f',           // fail on HTTP errors
    '--max-time',
    '30',
    '-k',           // skip server TLS verification (self-signed server cert)
    ...extraArgs,
  ]);
}

/**
 * Execute an authenticated curl command, dispatching to the correct auth
 * method based on the config.
 *
 * Supports two calling conventions:
 * 1. Config object: `curlAuthenticated(config, extraArgs)`
 * 2. Legacy positional args: `curlAuthenticated(p12Path, p12Password, extraArgs)`
 *
 * @param {object|string} configOrP12Path - Config object or P12 path (legacy)
 * @param {string[]|string} extraArgsOrP12Password - Extra args or P12 password (legacy)
 * @param {string[]} [legacyExtraArgs] - Extra args (legacy calling convention)
 * @returns {Promise<import('execa').ExecaReturnValue>}
 */
async function curlAuthenticated(configOrP12Path, extraArgsOrP12Password, legacyExtraArgs) {
  // Legacy calling convention: curlAuthenticated(p12Path, p12Password, extraArgs)
  if (typeof configOrP12Path === 'string') {
    return curlWithConfig(configOrP12Path, extraArgsOrP12Password, legacyExtraArgs);
  }

  // New calling convention: curlAuthenticated(config, extraArgs)
  const config = configOrP12Path;
  const extraArgs = extraArgsOrP12Password;

  if (config.authMethod === 'keychain') {
    return curlWithKeychain(config.keychainIdentity, extraArgs);
  }

  // Default to P12
  return curlWithConfig(config.p12Path, config.p12Password, extraArgs);
}

/**
 * Resolve panel URL from arguments.
 * Accepts either a config object (with panelUrl) or a string.
 * @param {object|string} configOrUrl
 * @returns {string}
 */
function resolvePanelUrl(configOrUrl) {
  if (typeof configOrUrl === 'object' && configOrUrl !== null) {
    return configOrUrl.panelUrl;
  }
  return configOrUrl;
}

/**
 * Check panel connectivity by hitting /api/health.
 * @param {string|object} panelUrlOrConfig - Panel URL string or config object
 * @param {string} [p12Path]
 * @param {string} [p12Password]
 * @returns {Promise<object>}
 */
export async function fetchHealth(panelUrlOrConfig, p12Path, p12Password) {
  const panelUrl = resolvePanelUrl(panelUrlOrConfig);
  const url = `${panelUrl}/api/health`;
  try {
    const { stdout } = typeof panelUrlOrConfig === 'object'
      ? await curlAuthenticated(panelUrlOrConfig, [url])
      : await curlWithConfig(p12Path, p12Password, [url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Cannot reach panel at ${url}. ` +
        `Check the URL and that your certificate is valid. ` +
        `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Fetch the plist XML and metadata from the panel.
 * @param {string|object} panelUrlOrConfig
 * @param {string} [p12Path]
 * @param {string} [p12Password]
 * @returns {Promise<{ plist: string, instructions: object }>}
 */
export async function fetchPlist(panelUrlOrConfig, p12Path, p12Password) {
  const panelUrl = resolvePanelUrl(panelUrlOrConfig);
  const url = `${panelUrl}/api/tunnels/mac-plist?format=json`;
  try {
    const { stdout } = typeof panelUrlOrConfig === 'object'
      ? await curlAuthenticated(panelUrlOrConfig, [url])
      : await curlWithConfig(p12Path, p12Password, [url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to fetch plist from panel. ` + `Details: ${err.stderr || err.message}`);
  }
}

/**
 * Fetch the tunnel list from the panel.
 * @param {string|object} panelUrlOrConfig
 * @param {string} [p12Path]
 * @param {string} [p12Password]
 * @returns {Promise<{ tunnels: Array<{ id: string, subdomain: string, port: number }> }>}
 */
export async function fetchTunnels(panelUrlOrConfig, p12Path, p12Password) {
  const panelUrl = resolvePanelUrl(panelUrlOrConfig);
  const url = `${panelUrl}/api/tunnels`;
  try {
    const { stdout } = typeof panelUrlOrConfig === 'object'
      ? await curlAuthenticated(panelUrlOrConfig, [url])
      : await curlWithConfig(p12Path, p12Password, [url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to fetch tunnels from panel. ` + `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Fetch the list of static sites from the panel.
 * @param {string|object} panelUrlOrConfig
 * @param {string} [p12Path]
 * @param {string} [p12Password]
 * @returns {Promise<{ sites: Array }>}
 */
export async function fetchSites(panelUrlOrConfig, p12Path, p12Password) {
  const panelUrl = resolvePanelUrl(panelUrlOrConfig);
  const url = `${panelUrl}/api/sites`;
  try {
    const { stdout } = typeof panelUrlOrConfig === 'object'
      ? await curlAuthenticated(panelUrlOrConfig, [url])
      : await curlWithConfig(p12Path, p12Password, [url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to fetch sites from panel. ` + `Details: ${err.stderr || err.message}`);
  }
}

/**
 * Create a new static site on the panel.
 * @param {string|object} panelUrlOrConfig
 * @param {string} [p12Path]
 * @param {string} [p12Password]
 * @param {object} body - Site creation payload
 * @returns {Promise<object>}
 */
export async function createSite(panelUrlOrConfig, p12Path, p12Password, body) {
  const panelUrl = resolvePanelUrl(panelUrlOrConfig);
  // Support config object: createSite(config, body)
  const actualBody = typeof panelUrlOrConfig === 'object' ? p12Path : body;
  const url = `${panelUrl}/api/sites`;
  const curlArgs = [
    '-X',
    'POST',
    '-H',
    'Content-Type: application/json',
    '-d',
    JSON.stringify(actualBody),
    url,
  ];
  try {
    const { stdout } = typeof panelUrlOrConfig === 'object'
      ? await curlAuthenticated(panelUrlOrConfig, curlArgs)
      : await curlWithConfig(p12Path, p12Password, curlArgs);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to create site on panel. ` + `Details: ${err.stderr || err.message}`);
  }
}

/**
 * Delete a static site from the panel.
 * @param {string|object} panelUrlOrConfig
 * @param {string} [p12Path]
 * @param {string} [p12Password]
 * @param {string} siteId - Site UUID
 * @returns {Promise<object>}
 */
export async function deleteSite(panelUrlOrConfig, p12Path, p12Password, siteId) {
  const panelUrl = resolvePanelUrl(panelUrlOrConfig);
  const actualSiteId = typeof panelUrlOrConfig === 'object' ? p12Path : siteId;
  const url = `${panelUrl}/api/sites/${encodeURIComponent(actualSiteId)}`;
  const curlArgs = ['-X', 'DELETE', url];
  try {
    const { stdout } = typeof panelUrlOrConfig === 'object'
      ? await curlAuthenticated(panelUrlOrConfig, curlArgs)
      : await curlWithConfig(p12Path, p12Password, curlArgs);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to delete site from panel. ` + `Details: ${err.stderr || err.message}`);
  }
}

/**
 * Fetch the file listing for a static site directory.
 * @param {string|object} panelUrlOrConfig
 * @param {string} [p12Path]
 * @param {string} [p12Password]
 * @param {string} siteId - Site UUID
 * @param {string} [dirPath='.'] - Directory path to list
 * @returns {Promise<{ files: Array }>}
 */
export async function fetchSiteFiles(panelUrlOrConfig, p12Path, p12Password, siteId, dirPath = '.') {
  const panelUrl = resolvePanelUrl(panelUrlOrConfig);
  let actualSiteId, actualDirPath;
  if (typeof panelUrlOrConfig === 'object') {
    actualSiteId = p12Path;
    actualDirPath = p12Password || '.';
  } else {
    actualSiteId = siteId;
    actualDirPath = dirPath;
  }
  const url = `${panelUrl}/api/sites/${encodeURIComponent(actualSiteId)}/files?path=${encodeURIComponent(actualDirPath)}`;
  try {
    const { stdout } = typeof panelUrlOrConfig === 'object'
      ? await curlAuthenticated(panelUrlOrConfig, [url])
      : await curlWithConfig(p12Path, p12Password, [url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to fetch site files from panel. ` + `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Upload files to a static site directory.
 * @param {string|object} panelUrlOrConfig
 * @param {string} [p12Path]
 * @param {string} [p12Password]
 * @param {string} siteId - Site UUID
 * @param {string} dirPath - Target directory path
 * @param {string[]} localFilePaths - Array of absolute local file paths
 * @returns {Promise<object>}
 */
export async function uploadSiteFiles(
  panelUrlOrConfig,
  p12Path,
  p12Password,
  siteId,
  dirPath,
  localFilePaths,
) {
  const panelUrl = resolvePanelUrl(panelUrlOrConfig);
  let actualSiteId, actualDirPath, actualLocalFilePaths;
  if (typeof panelUrlOrConfig === 'object') {
    actualSiteId = p12Path;
    actualDirPath = p12Password;
    actualLocalFilePaths = siteId;
  } else {
    actualSiteId = siteId;
    actualDirPath = dirPath;
    actualLocalFilePaths = localFilePaths;
  }
  const url = `${panelUrl}/api/sites/${encodeURIComponent(actualSiteId)}/files?path=${encodeURIComponent(actualDirPath)}`;
  const fileArgs = actualLocalFilePaths.flatMap((fp) => ['-F', `file=@${fp}`]);
  const curlArgs = ['-X', 'POST', ...fileArgs, url];
  try {
    const { stdout } = typeof panelUrlOrConfig === 'object'
      ? await curlAuthenticated(panelUrlOrConfig, curlArgs)
      : await curlWithConfig(p12Path, p12Password, curlArgs);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to upload files to site. ` + `Details: ${err.stderr || err.message}`);
  }
}

/**
 * Delete a file from a static site.
 * @param {string|object} panelUrlOrConfig
 * @param {string} [p12Path]
 * @param {string} [p12Password]
 * @param {string} siteId - Site UUID
 * @param {string} filePath - Path of the file to delete
 * @returns {Promise<object>}
 */
export async function deleteSiteFile(panelUrlOrConfig, p12Path, p12Password, siteId, filePath) {
  const panelUrl = resolvePanelUrl(panelUrlOrConfig);
  let actualSiteId, actualFilePath;
  if (typeof panelUrlOrConfig === 'object') {
    actualSiteId = p12Path;
    actualFilePath = p12Password;
  } else {
    actualSiteId = siteId;
    actualFilePath = filePath;
  }
  const url = `${panelUrl}/api/sites/${encodeURIComponent(actualSiteId)}/files`;
  const curlArgs = [
    '-X',
    'DELETE',
    '-H',
    'Content-Type: application/json',
    '-d',
    JSON.stringify({ path: actualFilePath }),
    url,
  ];
  try {
    const { stdout } = typeof panelUrlOrConfig === 'object'
      ? await curlAuthenticated(panelUrlOrConfig, curlArgs)
      : await curlWithConfig(p12Path, p12Password, curlArgs);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to delete site file from panel. ` + `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Execute an unauthenticated curl POST to a panel URL.
 * Used for the enrollment endpoint which doesn't require mTLS.
 *
 * @param {string} url - Full URL
 * @param {object} body - JSON body
 * @returns {Promise<object>}
 */
export async function curlPostUnauthenticated(url, body) {
  try {
    // Do NOT use -f flag — it swallows the response body on 4xx/5xx errors.
    // We need to read the JSON error message from the server.
    const { stdout } = await execa('curl', [
      '-s',
      '--max-time',
      '30',
      '-k',
      '-w',
      '\n%{http_code}',
      '-X',
      'POST',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify(body),
      url,
    ]);
    // stdout ends with \n<status_code>
    const lines = stdout.trimEnd().split('\n');
    const httpCode = parseInt(lines.pop(), 10);
    const responseBody = lines.join('\n');

    if (!responseBody) {
      throw new Error(`Empty response from ${url} (HTTP ${httpCode})`);
    }

    const parsed = JSON.parse(responseBody);

    if (httpCode >= 400) {
      throw new Error(parsed.error || `HTTP ${httpCode}`);
    }

    return parsed;
  } catch (err) {
    if (err.message && !err.message.startsWith('Request to')) {
      throw err;
    }
    throw new Error(
      `Request to ${url} failed. Details: ${err.stderr || err.message}`,
    );
  }
}
