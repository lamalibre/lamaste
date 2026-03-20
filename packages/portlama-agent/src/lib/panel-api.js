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
 * Check panel connectivity by hitting /api/health.
 * @param {string} panelUrl - e.g. "https://1.2.3.4:9292"
 * @param {string} p12Path
 * @param {string} p12Password
 * @returns {Promise<object>}
 */
export async function fetchHealth(panelUrl, p12Path, p12Password) {
  const url = `${panelUrl}/api/health`;
  try {
    const { stdout } = await curlWithConfig(p12Path, p12Password, [url]);
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
    const { stdout } = await curlWithConfig(p12Path, p12Password, [url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to fetch plist from panel. ` + `Details: ${err.stderr || err.message}`);
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
    const { stdout } = await curlWithConfig(p12Path, p12Password, [url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to fetch tunnels from panel. ` + `Details: ${err.stderr || err.message}`,
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
    const { stdout } = await curlWithConfig(p12Path, p12Password, [url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to fetch sites from panel. ` + `Details: ${err.stderr || err.message}`);
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
    const { stdout } = await curlWithConfig(p12Path, p12Password, [
      '-X',
      'POST',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify(body),
      url,
    ]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to create site on panel. ` + `Details: ${err.stderr || err.message}`);
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
    const { stdout } = await curlWithConfig(p12Path, p12Password, ['-X', 'DELETE', url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to delete site from panel. ` + `Details: ${err.stderr || err.message}`);
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
    const { stdout } = await curlWithConfig(p12Path, p12Password, [url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to fetch site files from panel. ` + `Details: ${err.stderr || err.message}`,
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
export async function uploadSiteFiles(
  panelUrl,
  p12Path,
  p12Password,
  siteId,
  dirPath,
  localFilePaths,
) {
  const url = `${panelUrl}/api/sites/${encodeURIComponent(siteId)}/files?path=${encodeURIComponent(dirPath)}`;
  const fileArgs = localFilePaths.flatMap((fp) => ['-F', `file=@${fp}`]);
  try {
    const { stdout } = await curlWithConfig(p12Path, p12Password, ['-X', 'POST', ...fileArgs, url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to upload files to site. ` + `Details: ${err.stderr || err.message}`);
  }
}

/**
 * Fetch shell configuration for this agent.
 * @param {string} panelUrl
 * @param {string} p12Path
 * @param {string} p12Password
 * @returns {Promise<{ enabled: boolean, label: string, blocklist?: string[], timeWindow?: object }>}
 */
export async function fetchShellConfig(panelUrl, p12Path, p12Password) {
  const url = `${panelUrl}/api/shell/config`;
  try {
    const { stdout } = await curlWithConfig(p12Path, p12Password, [url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to fetch shell config from panel. ` + `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Fetch the agent's own status from the panel.
 * The server derives the agent label from the mTLS client certificate CN.
 * @param {string} panelUrl
 * @param {string} p12Path
 * @param {string} p12Password
 * @returns {Promise<{ label: string }>}
 */
export async function fetchAgentStatus(panelUrl, p12Path, p12Password) {
  const url = `${panelUrl}/api/shell/agent-status`;
  try {
    const { stdout } = await curlWithConfig(p12Path, p12Password, [url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to fetch agent status from panel. ` + `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Fetch shell session list from the panel.
 * @param {string} panelUrl
 * @param {string} p12Path
 * @param {string} p12Password
 * @returns {Promise<{ sessions: Array }>}
 */
export async function fetchShellSessions(panelUrl, p12Path, p12Password) {
  const url = `${panelUrl}/api/shell/sessions`;
  try {
    const { stdout } = await curlWithConfig(p12Path, p12Password, [url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to fetch shell sessions from panel. ` + `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Download a shell session recording from the panel.
 * @param {string} panelUrl
 * @param {string} p12Path
 * @param {string} p12Password
 * @param {string} agentLabel - The agent label that owns the recording
 * @param {string} sessionId
 * @param {string} outputPath - Local path to write the recording to
 * @returns {Promise<void>}
 */
export async function downloadShellRecording(
  panelUrl,
  p12Path,
  p12Password,
  agentLabel,
  sessionId,
  outputPath,
) {
  const url = `${panelUrl}/api/shell/recordings/${encodeURIComponent(agentLabel)}/${encodeURIComponent(sessionId)}`;
  try {
    await curlWithConfig(p12Path, p12Password, ['-o', outputPath, url]);
  } catch (err) {
    throw new Error(
      `Failed to download shell recording from panel. ` + `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Download a file from a remote agent via the panel relay.
 * @param {string} panelUrl
 * @param {string} p12Path
 * @param {string} p12Password
 * @param {string} agentLabel
 * @param {string} remotePath - Absolute path on the remote agent
 * @param {string} outputPath - Local path to write the file to
 * @returns {Promise<void>}
 */
export async function downloadRemoteFile(
  panelUrl,
  p12Path,
  p12Password,
  agentLabel,
  remotePath,
  outputPath,
) {
  const url = `${panelUrl}/api/shell/file/${encodeURIComponent(agentLabel)}?path=${encodeURIComponent(remotePath)}`;
  try {
    await curlWithConfig(p12Path, p12Password, ['-o', outputPath, url]);
  } catch (err) {
    throw new Error(
      `Failed to download file from agent ${agentLabel}. ` +
        `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Upload a local file to a remote agent via the panel relay.
 * @param {string} panelUrl
 * @param {string} p12Path
 * @param {string} p12Password
 * @param {string} agentLabel
 * @param {string} remotePath - Absolute path on the remote agent
 * @param {string} localFilePath - Local file to upload
 * @returns {Promise<object>}
 */
export async function uploadRemoteFile(
  panelUrl,
  p12Path,
  p12Password,
  agentLabel,
  remotePath,
  localFilePath,
) {
  const url = `${panelUrl}/api/shell/file/${encodeURIComponent(agentLabel)}?path=${encodeURIComponent(remotePath)}`;
  try {
    const { stdout } = await curlWithConfig(p12Path, p12Password, [
      '-X',
      'POST',
      '-F',
      `file=@${localFilePath}`,
      url,
    ]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to upload file to agent ${agentLabel}. ` + `Details: ${err.stderr || err.message}`,
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
    const { stdout } = await curlWithConfig(p12Path, p12Password, [
      '-X',
      'DELETE',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ path: filePath }),
      url,
    ]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to delete site file from panel. ` + `Details: ${err.stderr || err.message}`,
    );
  }
}
