import crypto from 'node:crypto';
import { readdirSync, unlinkSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { LAMASTE_DIR } from '@lamalibre/lamaste/agent';
import { formatCurlPinnedPubkey } from './panel-cert.js';

const AGENT_DIR = LAMASTE_DIR;

/**
 * One-shot warnings — emit a "missing pin" warning at most once per process
 * lifetime per agent label so we don't spam logs on every API call.
 */
const _missingPinWarned = new Set();
function warnMissingPin(panelUrl) {
  const key = panelUrl || '<unknown>';
  if (_missingPinWarned.has(key)) return;
  _missingPinWarned.add(key);
  console.warn(
    `[lamaste-agent] WARNING: no pinned panel server cert for ${key}. ` +
      `Falling back to insecure -k. Run \`lamaste-agent panel reset-pin\` ` +
      `or re-enroll to capture a pin and prevent server-side MITM.`,
  );
}

/**
 * Build the TLS verification args for curl based on whether the agent
 * config carries a panel server pubkey pin. Returns `--pinnedpubkey
 * 'sha256//<base64>'` when present, otherwise `-k` plus a one-shot
 * warning. The pinnedpubkey form does NOT also need `-k` — curl will
 * still validate hostname/expiry against any trust anchor it has, but
 * fail-closed if the pin doesn't match.
 *
 * NOTE: `--pinnedpubkey` alone leaves curl's chain validation enabled.
 * For self-signed panel certs (the IP vhost on :9292) the chain check
 * fails before the pin is even consulted, so we pair the pin with `-k`
 * to skip chain validation but keep pin enforcement. The pin itself is
 * the trust anchor — chain validation is redundant once pinning is in
 * place, and would otherwise reject the legitimate self-signed cert.
 *
 * @param {object|null|undefined} pinSource - Object that may carry
 *   `panelServerPubkeySha256` (typically the agent config). May be
 *   null/undefined for unauthenticated calls during enrollment.
 * @returns {string[]}
 */
function tlsVerifyArgs(pinSource) {
  const pin = pinSource?.panelServerPubkeySha256;
  if (typeof pin === 'string' && pin.length > 0) {
    return ['--pinnedpubkey', formatCurlPinnedPubkey(pin), '-k'];
  }
  warnMissingPin(pinSource?.panelUrl);
  return ['-k'];
}

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
 * Server-side TLS is verified via a pinned public-key digest captured at
 * enrollment time (`--pinnedpubkey 'sha256//<base64>'`), see
 * `tlsVerifyArgs` for the fallback semantics.
 *
 * @param {string} configPath - Path to the temporary curl config file
 * @param {object|null|undefined} pinSource - Carries `panelServerPubkeySha256`
 * @returns {string[]}
 */
function certArgs(configPath, pinSource) {
  return [
    '-K',
    configPath,
    '-s', // silent
    '-f', // fail on HTTP errors
    '--max-time',
    '30',
    ...tlsVerifyArgs(pinSource),
  ];
}

/**
 * Validate and extract a safe HTTPS URL from the last element of a curl
 * argument list. Parses via `new URL()` (CodeQL-recognised taint sanitiser)
 * and rejects non-HTTPS schemes. Returns just the sanitised href string.
 *
 * @param {string[]} args - curl arguments; the last element must be the URL
 * @returns {{ safeUrl: string, preArgs: string[] }}
 */
function extractSafeUrl(args) {
  const parsed = new URL(args[args.length - 1]);
  if (parsed.protocol !== 'https:') {
    throw new Error(`Refusing to call curl with non-HTTPS URL: ${parsed.protocol}`);
  }
  // Build preArgs from scratch — each element is a new string so that
  // CodeQL's array-level taint from the original args does not propagate.
  const preArgs = [];
  for (let i = 0; i < args.length - 1; i++) {
    preArgs.push(`${args[i]}`);
  }
  return { safeUrl: parsed.href, preArgs };
}

/**
 * Execute a curl command with mTLS credentials passed via a temporary config
 * file.  The config file is created before the call and removed afterwards,
 * regardless of success or failure.
 * @param {string} p12Path
 * @param {string} p12Password
 * @param {string[]} extraArgs - Additional curl arguments (must end with the URL)
 * @param {object|null|undefined} [pinSource] - Optional config carrying the panel server pubkey pin
 * @returns {Promise<import('execa').ExecaReturnValue>}
 */
async function curlWithConfig(p12Path, p12Password, extraArgs, pinSource) {
  const { safeUrl, preArgs } = extractSafeUrl(extraArgs);
  const configPath = await createCurlConfig(p12Path, p12Password);
  try {
    return await execa('curl', [...certArgs(configPath, pinSource), ...preArgs, safeUrl]);
  } finally {
    await removeCurlConfig(configPath);
  }
}

/**
 * Execute a curl command using a macOS Keychain identity for mTLS.
 * curl on macOS natively supports Keychain identities via --cert.
 *
 * @param {string} keychainIdentity - Keychain identity name (e.g. "Lamaste Agent (macbook-pro)")
 * @param {string[]} extraArgs - Additional curl arguments (must end with the URL)
 * @param {object|null|undefined} [pinSource] - Optional config carrying the panel server pubkey pin
 * @returns {Promise<import('execa').ExecaReturnValue>}
 */
async function curlWithKeychain(keychainIdentity, extraArgs, pinSource) {
  const { safeUrl, preArgs } = extractSafeUrl(extraArgs);
  return execa('curl', [
    '--cert',
    keychainIdentity,
    '-s', // silent
    '-f', // fail on HTTP errors
    '--max-time',
    '30',
    ...tlsVerifyArgs(pinSource),
    ...preArgs,
    safeUrl,
  ]);
}

/**
 * Execute an authenticated curl command, dispatching to the correct auth
 * method based on the config.
 *
 * @param {object} config - Agent config carrying `authMethod`, `p12Path`,
 *   `p12Password`, `keychainIdentity`, and the optional pin source.
 * @param {string[]} extraArgs - Curl arguments (must end with the URL).
 * @returns {Promise<import('execa').ExecaReturnValue>}
 */
async function curlAuthenticated(config, extraArgs) {
  if (config.authMethod === 'keychain') {
    return curlWithKeychain(config.keychainIdentity, extraArgs, config);
  }

  // Default to P12
  return curlWithConfig(config.p12Path, config.p12Password, extraArgs, config);
}

/**
 * Execute an authenticated curl command and return the HTTP status with the
 * body — also for an error status, which `-f` turns into curl exit 22 with
 * no body (the write-out still names the status).
 *
 * @param {object} config - Agent config
 * @param {string[]} extraArgs - Curl arguments (must end with the URL)
 * @returns {Promise<{ status: number, body: string }>}
 */
async function curlAuthenticatedStatus(config, extraArgs) {
  const url = extraArgs[extraArgs.length - 1];
  const args = [...extraArgs.slice(0, -1), '-w', '\n%{http_code}', url];
  let stdout;
  try {
    ({ stdout } = await curlAuthenticated(config, args));
  } catch (err) {
    if (err?.exitCode !== 22 || typeof err.stdout !== 'string') throw err;
    stdout = err.stdout;
  }
  const newline = stdout.lastIndexOf('\n');
  const status = Number.parseInt(stdout.slice(newline + 1), 10);
  if (!Number.isInteger(status)) throw new Error('curl reported no HTTP status');
  return { status, body: newline === -1 ? '' : stdout.slice(0, newline) };
}

/**
 * Resolve and validate the panel URL from a config object.
 * Parses via `new URL()` to break any taint chain from unvalidated
 * config values, and enforces HTTPS to prevent SSRF.
 * @param {object} config
 * @returns {string}
 */
function resolvePanelUrl(config) {
  const parsed = new URL(config.panelUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error(`Panel URL must use HTTPS, got: ${parsed.protocol}`);
  }
  // Return parsed.href to break taint chain (URL constructor is a recognised sanitiser)
  let href = parsed.href;
  while (href.endsWith('/')) href = href.slice(0, -1);
  return href;
}

/**
 * Check panel connectivity by hitting /api/health.
 * @param {object} config - Agent config object
 * @returns {Promise<object>}
 */
export async function fetchHealth(config) {
  const panelUrl = resolvePanelUrl(config);
  const url = `${panelUrl}/api/health`;
  try {
    const { stdout } = await curlAuthenticated(config, [url]);
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
 * Fetch the platform-agnostic agent config from the panel.
 * Returns chiselArgs, domain, and tunnel metadata for any platform.
 *
 * @param {object} config - Agent config object
 * @returns {Promise<{ domain: string, chiselServerUrl: string, chiselArgs: string[], tunnels: Array<{ port: number, subdomain: string }> }>}
 */
export async function fetchAgentConfig(config) {
  const panelUrl = resolvePanelUrl(config);
  const url = `${panelUrl}/api/tunnels/agent-config`;
  try {
    const { stdout } = await curlAuthenticated(config, [url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to fetch agent config from panel. ` + `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Validate a chisel credential payload from the panel.
 * @param {unknown} parsed
 * @returns {{ user: string, password: string, createdAt: string | null }}
 */
function parseChiselCredential(parsed) {
  if (!parsed || typeof parsed.user !== 'string' || typeof parsed.password !== 'string') {
    throw new Error('Panel returned malformed chisel credential payload');
  }
  return {
    user: parsed.user,
    password: parsed.password,
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
  };
}

/**
 * Fetch this agent's chisel tunnel-server credential from the panel.
 *
 * Returns `{ user, password, createdAt }`. The agent hands the credential to
 * its chisel client through the environment, never in process arguments.
 * Identifies the agent strictly via the mTLS cert; the panel does not accept
 * a label query parameter.
 *
 * @param {object} config - Agent config (must use config-object form)
 * @returns {Promise<{ user: string, password: string, createdAt: string | null }>}
 */
export async function fetchChiselCredential(config) {
  const panelUrl = resolvePanelUrl(config);
  const url = `${panelUrl}/api/agents/me/chisel-credential`;
  try {
    const { stdout } = await curlAuthenticated(config, [url]);
    return parseChiselCredential(JSON.parse(stdout));
  } catch (err) {
    throw new Error(
      `Failed to fetch chisel credential from panel. Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Ask the panel to replace this agent's chisel credential and return the new
 * one. The panel allows it at most once every 10 minutes per agent.
 *
 * @param {object} config - Agent config
 * @returns {Promise<{ user: string, password: string, createdAt: string | null }>}
 */
export async function rotateChiselCredential(config) {
  const panelUrl = resolvePanelUrl(config);
  const url = `${panelUrl}/api/agents/me/chisel-credential/rotate`;
  try {
    const { stdout } = await curlAuthenticated(config, ['-X', 'POST', url]);
    return parseChiselCredential(JSON.parse(stdout));
  } catch (err) {
    throw new Error(
      `Failed to rotate the chisel credential on the panel. Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Validate a plugin config payload from the panel (`GET /api/agents/me/plugin-config/<route>`).
 * @param {unknown} parsed
 * @returns {{ plugin: string, port: number, secret: string, issuedAt: string, previousSecret?: string, previousIssuedAt?: string }}
 */
function parsePluginConfig(parsed) {
  if (
    !parsed ||
    typeof parsed.plugin !== 'string' ||
    typeof parsed.port !== 'number' ||
    typeof parsed.secret !== 'string' ||
    typeof parsed.issuedAt !== 'string'
  ) {
    throw new Error('Panel returned malformed plugin config payload');
  }
  return {
    plugin: parsed.plugin,
    port: parsed.port,
    secret: parsed.secret,
    issuedAt: parsed.issuedAt,
    ...(typeof parsed.previousSecret === 'string'
      ? {
          previousSecret: parsed.previousSecret,
          ...(typeof parsed.previousIssuedAt === 'string'
            ? { previousIssuedAt: parsed.previousIssuedAt }
            : {}),
        }
      : {}),
  };
}

/**
 * Fetch the config of an agent-hosted plugin hosted on this agent: the port
 * its agent half listens on and the installation secret. Only the hosting
 * agent's certificate (capability `plugin:<route>:host`) is admitted.
 *
 * @param {object} config - Agent config
 * @param {string} route - The plugin's route
 */
export async function fetchPluginConfig(config, route) {
  const panelUrl = resolvePanelUrl(config);
  const url = `${panelUrl}/api/agents/me/plugin-config/${encodeURIComponent(route)}`;
  try {
    const { stdout } = await curlAuthenticated(config, [url]);
    return parsePluginConfig(JSON.parse(stdout));
  } catch (err) {
    throw new Error(
      `Failed to fetch the plugin config for "${route}" from panel. Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Tell the panel this agent holds the plugin secret issued at `issuedAt`;
 * the panel's forwarder then signs with it and drops the previous one.
 *
 * @param {object} config - Agent config
 * @param {string} route
 * @param {string} issuedAt
 */
export async function acknowledgePluginConfig(config, route, issuedAt) {
  const panelUrl = resolvePanelUrl(config);
  const url = `${panelUrl}/api/agents/me/plugin-config/${encodeURIComponent(route)}/ack`;
  try {
    const { stdout } = await curlAuthenticated(config, [
      '-X',
      'POST',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ issuedAt }),
      url,
    ]);
    const parsed = JSON.parse(stdout);
    if (parsed?.acknowledged !== true) {
      throw new Error(
        `the panel now issues the secret of ${parsed?.secretIssuedAt ?? 'an unknown time'}`,
      );
    }
  } catch (err) {
    throw new Error(
      `Failed to acknowledge the plugin config for "${route}". Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Ask the panel to broker a registry credential for an install on this
 * agent: a one-hour, read-only token owned by `agent:<label>`. `null` when
 * the panel has none configured (404) — the install then uses the public
 * registry. The token is for an isolated, throw-away npm userconfig only.
 *
 * @param {object} config - Agent config
 * @returns {Promise<{ registryUrl: string, scope: string, token: string, expiresAt: string, tokenId: string } | null>}
 */
export async function fetchRegistryCredential(config) {
  const panelUrl = resolvePanelUrl(config);
  const url = `${panelUrl}/api/agents/me/registry-credential`;
  let response;
  try {
    response = await curlAuthenticatedStatus(config, [url]);
  } catch (err) {
    throw new Error(
      `Failed to fetch a registry credential from the panel. Details: ${err.stderr || err.message}`,
    );
  }
  if (response.status === 404) return null;
  if (response.status !== 200) {
    throw new Error(`The panel refused to broker a registry credential (HTTP ${response.status})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw new Error('The panel returned a malformed registry credential');
  }
  if (
    !parsed ||
    typeof parsed.registryUrl !== 'string' ||
    typeof parsed.token !== 'string' ||
    typeof parsed.expiresAt !== 'string'
  ) {
    throw new Error('The panel returned a malformed registry credential');
  }
  return {
    registryUrl: parsed.registryUrl,
    scope: typeof parsed.scope === 'string' ? parsed.scope : '@lamalibre',
    token: parsed.token,
    expiresAt: parsed.expiresAt,
    tokenId: typeof parsed.tokenId === 'string' ? parsed.tokenId : '',
  };
}

/**
 * Report this agent's host facts (OS, distribution, architecture, Node.js,
 * systemd, app host helper) — what the panel checks a plugin's
 * requirements against when it is hosted here. `'unsupported'` when the
 * panel has no such endpoint yet (404, a relay before 4.3).
 *
 * @param {object} config - Agent config
 * @param {import('@lamalibre/lamaste').HostFacts} facts
 * @returns {Promise<'ok' | 'unsupported'>}
 */
export async function putHostFacts(config, facts) {
  const panelUrl = resolvePanelUrl(config);
  const url = `${panelUrl}/api/agents/me/host-facts`;
  let response;
  try {
    response = await curlAuthenticatedStatus(config, [
      '-X',
      'PUT',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify(facts),
      url,
    ]);
  } catch (err) {
    throw new Error(`Failed to report host facts. Details: ${err.stderr || err.message}`);
  }
  if (response.status === 404) return 'unsupported';
  if (response.status !== 200) {
    throw new Error(`The panel refused the host facts (HTTP ${response.status})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    parsed = null;
  }
  if (parsed?.ok !== true) throw new Error('The panel answered the host facts unexpectedly');
  return 'ok';
}

/**
 * Fetch the tunnel list from the panel.
 * @param {object} config - Agent config object
 * @returns {Promise<{ tunnels: Array<{ id: string, subdomain: string, port: number }> }>}
 */
export async function fetchTunnels(config) {
  const panelUrl = resolvePanelUrl(config);
  const url = `${panelUrl}/api/tunnels`;
  try {
    const { stdout } = await curlAuthenticated(config, [url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to fetch tunnels from panel. ` + `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Fetch the list of static sites from the panel.
 * @param {object} config - Agent config object
 * @returns {Promise<{ sites: Array }>}
 */
export async function fetchSites(config) {
  const panelUrl = resolvePanelUrl(config);
  const url = `${panelUrl}/api/sites`;
  try {
    const { stdout } = await curlAuthenticated(config, [url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to fetch sites from panel. ` + `Details: ${err.stderr || err.message}`);
  }
}

/**
 * Create a new static site on the panel.
 * @param {object} config - Agent config object
 * @param {object} body - Site creation payload
 * @returns {Promise<object>}
 */
export async function createSite(config, body) {
  const panelUrl = resolvePanelUrl(config);
  const url = `${panelUrl}/api/sites`;
  const curlArgs = [
    '-X',
    'POST',
    '-H',
    'Content-Type: application/json',
    '-d',
    JSON.stringify(body),
    url,
  ];
  try {
    const { stdout } = await curlAuthenticated(config, curlArgs);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to create site on panel. ` + `Details: ${err.stderr || err.message}`);
  }
}

/**
 * Delete a static site from the panel.
 * @param {object} config - Agent config object
 * @param {string} siteId - Site UUID
 * @returns {Promise<object>}
 */
export async function deleteSite(config, siteId) {
  const panelUrl = resolvePanelUrl(config);
  const url = `${panelUrl}/api/sites/${encodeURIComponent(siteId)}`;
  const curlArgs = ['-X', 'DELETE', url];
  try {
    const { stdout } = await curlAuthenticated(config, curlArgs);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to delete site from panel. ` + `Details: ${err.stderr || err.message}`);
  }
}

/**
 * Fetch the file listing for a static site directory.
 * @param {object} config - Agent config object
 * @param {string} siteId - Site UUID
 * @param {string} [dirPath='.'] - Directory path to list
 * @returns {Promise<{ files: Array }>}
 */
export async function fetchSiteFiles(config, siteId, dirPath = '.') {
  const panelUrl = resolvePanelUrl(config);
  const url = `${panelUrl}/api/sites/${encodeURIComponent(siteId)}/files?path=${encodeURIComponent(dirPath)}`;
  try {
    const { stdout } = await curlAuthenticated(config, [url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to fetch site files from panel. ` + `Details: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Upload files to a static site directory.
 * @param {object} config - Agent config object
 * @param {string} siteId - Site UUID
 * @param {string} dirPath - Target directory path
 * @param {string[]} localFilePaths - Array of absolute local file paths
 * @returns {Promise<object>}
 */
export async function uploadSiteFiles(config, siteId, dirPath, localFilePaths) {
  const panelUrl = resolvePanelUrl(config);
  const url = `${panelUrl}/api/sites/${encodeURIComponent(siteId)}/files?path=${encodeURIComponent(dirPath)}`;
  const fileArgs = localFilePaths.flatMap((fp) => ['-F', `file=@${fp}`]);
  const curlArgs = ['-X', 'POST', ...fileArgs, url];
  try {
    const { stdout } = await curlAuthenticated(config, curlArgs);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to upload files to site. ` + `Details: ${err.stderr || err.message}`);
  }
}

/**
 * Delete a file from a static site.
 * @param {object} config - Agent config object
 * @param {string} siteId - Site UUID
 * @param {string} filePath - Path of the file to delete
 * @returns {Promise<object>}
 */
export async function deleteSiteFile(config, siteId, filePath) {
  const panelUrl = resolvePanelUrl(config);
  const url = `${panelUrl}/api/sites/${encodeURIComponent(siteId)}/files`;
  const curlArgs = [
    '-X',
    'DELETE',
    '-H',
    'Content-Type: application/json',
    '-d',
    JSON.stringify({ path: filePath }),
    url,
  ];
  try {
    const { stdout } = await curlAuthenticated(config, curlArgs);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to delete site file from panel. ` + `Details: ${err.stderr || err.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Ticket system API functions
// ---------------------------------------------------------------------------

// --- Ticket API functions ---
// These use config-object only (no dual positional args). The ticket system is new
// and only called from code that already uses config objects, so the legacy positional
// calling convention used by older functions above is not needed here.

/**
 * Fetch pending tickets from the agent's inbox.
 * @param {object} config - Agent config object
 * @returns {Promise<{ tickets: Array }>}
 */
export async function fetchTicketInbox(config) {
  const url = `${config.panelUrl}/api/tickets/inbox`;
  try {
    const { stdout } = await curlAuthenticated(config, [url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to fetch ticket inbox. Details: ${err.stderr || err.message}`);
  }
}

/**
 * Validate a ticket from the inbox.
 * @param {object} config - Agent config object
 * @param {string} ticketId - The ticket ID to validate
 * @returns {Promise<object>}
 */
export async function validateTicket(config, ticketId) {
  const url = `${config.panelUrl}/api/tickets/validate`;
  const curlArgs = [
    '-X',
    'POST',
    '-H',
    'Content-Type: application/json',
    '-d',
    JSON.stringify({ ticketId }),
    url,
  ];
  try {
    const { stdout } = await curlAuthenticated(config, curlArgs);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to validate ticket. Details: ${err.stderr || err.message}`);
  }
}

/**
 * Register an instance for a ticket scope.
 * @param {object} config - Agent config object
 * @param {string} scope - The scope capability (e.g. "shell:connect")
 * @param {object} transport - Transport configuration
 * @returns {Promise<object>}
 */
export async function registerTicketInstance(config, scope, transport) {
  const url = `${config.panelUrl}/api/tickets/instances`;
  const curlArgs = [
    '-X',
    'POST',
    '-H',
    'Content-Type: application/json',
    '-d',
    JSON.stringify({ scope, transport }),
    url,
  ];
  try {
    const { stdout } = await curlAuthenticated(config, curlArgs);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to register ticket instance. Details: ${err.stderr || err.message}`);
  }
}

/**
 * Send an instance heartbeat.
 * @param {object} config - Agent config object
 * @param {string} instanceId - The instance ID
 * @returns {Promise<object>}
 */
export async function sendInstanceHeartbeat(config, instanceId) {
  const url = `${config.panelUrl}/api/tickets/instances/${encodeURIComponent(instanceId)}/heartbeat`;
  const curlArgs = ['-X', 'POST', url];
  try {
    const { stdout } = await curlAuthenticated(config, curlArgs);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to send instance heartbeat. Details: ${err.stderr || err.message}`);
  }
}

/**
 * Request a ticket for a target agent.
 * @param {object} config - Agent config object
 * @param {string} scope - Capability scope
 * @param {string} instanceId - The instance ID
 * @param {string} target - Target agent label
 * @returns {Promise<object>}
 */
export async function requestTicket(config, scope, instanceId, target) {
  const url = `${config.panelUrl}/api/tickets`;
  const curlArgs = [
    '-X',
    'POST',
    '-H',
    'Content-Type: application/json',
    '-d',
    JSON.stringify({ scope, instanceId, target }),
    url,
  ];
  try {
    const { stdout } = await curlAuthenticated(config, curlArgs);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to request ticket. Details: ${err.stderr || err.message}`);
  }
}

/**
 * Report a session creation to the panel. Session ID is generated server-side.
 * @param {object} config - Agent config object
 * @param {string} ticketId - The ticket ID
 * @returns {Promise<{ ok: boolean, session: object }>}
 */
export async function reportSessionCreation(config, ticketId) {
  const url = `${config.panelUrl}/api/tickets/sessions`;
  const curlArgs = [
    '-X',
    'POST',
    '-H',
    'Content-Type: application/json',
    '-d',
    JSON.stringify({ ticketId }),
    url,
  ];
  try {
    const { stdout } = await curlAuthenticated(config, curlArgs);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to report session creation. Details: ${err.stderr || err.message}`);
  }
}

/**
 * Send a session heartbeat to the panel for re-validation.
 * @param {object} config - Agent config object
 * @param {string} sessionId - The session ID
 * @returns {Promise<{ authorized: boolean, reason?: string }>}
 */
export async function sendSessionHeartbeat(config, sessionId) {
  const url = `${config.panelUrl}/api/tickets/sessions/${encodeURIComponent(sessionId)}/heartbeat`;
  const curlArgs = ['-X', 'POST', url];
  try {
    const { stdout } = await curlAuthenticated(config, curlArgs);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to send session heartbeat. Details: ${err.stderr || err.message}`);
  }
}

/**
 * Update session status on the panel.
 * @param {object} config - Agent config object
 * @param {string} sessionId - The session ID
 * @param {string} status - New status: 'active' or 'grace'
 * @returns {Promise<object>}
 */
export async function updateSessionStatus(config, sessionId, status) {
  const url = `${config.panelUrl}/api/tickets/sessions/${encodeURIComponent(sessionId)}`;
  const curlArgs = [
    '-X',
    'PATCH',
    '-H',
    'Content-Type: application/json',
    '-d',
    JSON.stringify({ status }),
    url,
  ];
  try {
    const { stdout } = await curlAuthenticated(config, curlArgs);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to update session status. Details: ${err.stderr || err.message}`);
  }
}

/**
 * Execute an unauthenticated curl POST to a panel URL.
 * Used for the enrollment endpoint which doesn't require mTLS.
 *
 * The optional `pinSource` carries `panelServerPubkeySha256` — when provided
 * (typically a pin captured by `fetchPanelServerCertDigests` before the very
 * first lookup call) curl pins the panel's public key, defeating MITM during
 * the rest of the enrollment flow. Without a pin, we fall back to `-k`
 * (true TOFU on the first contact only).
 *
 * @param {string} url - Full URL
 * @param {object} body - JSON body
 * @param {{ panelServerPubkeySha256?: string, panelUrl?: string } | null} [pinSource]
 * @returns {Promise<object>}
 */
export async function curlPostUnauthenticated(url, body, pinSource) {
  try {
    // Do NOT use -f flag — it swallows the response body on 4xx/5xx errors.
    // We need to read the JSON error message from the server.
    const { stdout } = await execa('curl', [
      '-s',
      '--max-time',
      '30',
      ...tlsVerifyArgs(pinSource),
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
    throw new Error(`Request to ${url} failed. Details: ${err.stderr || err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Agent panel tunnel operations
// ---------------------------------------------------------------------------

/**
 * Execute an authenticated curl command and parse JSON response.
 * Exported so panel-api-routes.js can proxy requests to the panel server.
 *
 * @param {object} config - Agent config with auth credentials
 * @param {string[]} curlArgs - Curl arguments
 * @returns {Promise<object>}
 */
export async function curlAuthenticatedJson(config, curlArgs) {
  const { stdout } = await curlAuthenticated(config, curlArgs);
  return JSON.parse(stdout);
}

/**
 * Request the panel server to expose the agent's management panel.
 * Creates a panel tunnel with mTLS nginx vhost.
 *
 * @param {object} config - Agent config
 * @param {number} port - Local panel server port
 * @returns {Promise<object>}
 */
export async function exposePanelTunnel(config, port) {
  const url = `${config.panelUrl}/api/tunnels/expose-panel`;
  try {
    const { stdout } = await curlAuthenticated(config, [
      '-X',
      'POST',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ port }),
      url,
    ]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to expose panel tunnel. Details: ${err.stderr || err.message}`);
  }
}

/**
 * Request the panel server to retract (remove) the agent's panel tunnel.
 *
 * @param {object} config - Agent config
 * @returns {Promise<object>}
 */
export async function retractPanelTunnel(config) {
  const url = `${config.panelUrl}/api/tunnels/retract-panel`;
  try {
    const { stdout } = await curlAuthenticated(config, ['-X', 'DELETE', url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to retract panel tunnel. Details: ${err.stderr || err.message}`);
  }
}

/**
 * Check the status of the agent's panel tunnel.
 *
 * @param {object} config - Agent config
 * @returns {Promise<{ enabled: boolean, fqdn: string | null, port: number | null }>}
 */
export async function fetchPanelTunnelStatus(config) {
  const url = `${config.panelUrl}/api/tunnels/agent-panel-status`;
  try {
    const { stdout } = await curlAuthenticated(config, [url]);
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to fetch panel tunnel status. Details: ${err.stderr || err.message}`);
  }
}

/**
 * Report the result of an agent job (a lifecycle hook call this agent made
 * to its agent half, or an app job run through the app host helper) to the
 * panel. Hosting-agent certificate only.
 *
 * @param {object} config - Agent config
 * @param {string} id - The job id from agent-config `agentJobs`
 * @param {import('@lamalibre/lamaste').AgentJobResult} result
 */
export async function reportJobResult(config, id, result) {
  const panelUrl = resolvePanelUrl(config);
  const url = `${panelUrl}/api/agents/me/jobs/${encodeURIComponent(id)}/result`;
  try {
    const { stdout } = await curlAuthenticated(config, [
      '-X',
      'POST',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify(result),
      url,
    ]);
    const parsed = JSON.parse(stdout);
    if (parsed?.ok !== true) throw new Error(parsed?.error ?? 'the panel refused the result');
  } catch (err) {
    throw new Error(`Failed to report job ${id}. Details: ${err.stderr || err.message}`);
  }
}
