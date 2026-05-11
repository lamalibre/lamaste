/**
 * Authenticated HTTP proxy to the Lamaste panel server.
 *
 * All requests use mTLS (P12 or macOS Keychain) via curl. The P12 password
 * is passed through a temp config file (-K) so it never appears in process
 * argument lists.
 *
 * Extracted from lamaste-agent/src/lib/panel-api.js — only the functions
 * needed by the daemon's REST API routes are included here.
 */

import crypto from 'node:crypto';
import { readdirSync, unlinkSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { agentDataDir } from '@lamalibre/lamaste/agent';

// ---------------------------------------------------------------------------
// Server cert pinning (B10) — one-shot warning when no pin is on file
// ---------------------------------------------------------------------------

const _missingPinWarned = new Set();
function warnMissingPin(panelUrl, log) {
  const key = panelUrl || '<unknown>';
  if (_missingPinWarned.has(key)) return;
  _missingPinWarned.add(key);
  const msg =
    `[lamaste-agentd] WARNING: no pinned panel server cert for ${key}. ` +
    `Falling back to insecure -k. Re-enroll the agent or run ` +
    `\`lamaste-agent panel reset-pin\` to capture a pin.`;
  if (log && typeof log.warn === 'function') {
    log.warn(msg);
  } else {
    console.warn(msg);
  }
}

/**
 * Build curl TLS verification args based on the agent config's pin.
 * @param {object|null|undefined} pinSource
 * @returns {string[]}
 */
function tlsVerifyArgs(pinSource) {
  const pin = pinSource?.panelServerPubkeySha256;
  if (typeof pin === 'string' && pin.length > 0) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(pin)) {
      throw new Error('panelServerPubkeySha256 contains invalid base64 characters');
    }
    return ['--pinnedpubkey', `sha256//${pin}`, '-k'];
  }
  warnMissingPin(pinSource?.panelUrl);
  return ['-k'];
}

// ---------------------------------------------------------------------------
// Stale curl config cleanup
// ---------------------------------------------------------------------------

/**
 * Clean up stale curl config temp files left behind by previous crashes.
 * Runs once at module load — synchronous to keep it simple.
 * @param {string} dir
 */
function cleanupStaleCurlConfigs(dir) {
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith('.curl-config-') && entry.endsWith('.tmp')) {
        try {
          unlinkSync(path.join(dir, entry));
        } catch {
          // Best-effort
        }
      }
    }
  } catch {
    // Dir may not exist yet
  }
}

// ---------------------------------------------------------------------------
// Curl config file management
// ---------------------------------------------------------------------------

/**
 * Validate that p12Path and p12Password contain no injection characters.
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
 * Create a temporary curl config file with mTLS cert credentials.
 * Written with mode 0600 — password never in process arg lists.
 * @param {string} baseDir - Directory for temp files
 * @param {string} p12Path
 * @param {string} p12Password
 * @returns {Promise<string>} Path to the temp config file
 */
async function createCurlConfig(baseDir, p12Path, p12Password) {
  validateCertInputs(p12Path, p12Password);
  const suffix = crypto.randomBytes(8).toString('hex');
  const configPath = path.join(baseDir, `.curl-config-${suffix}.tmp`);
  const escapedPath = p12Path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedPass = p12Password.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const content = `cert = "${escapedPath}:${escapedPass}"\ncert-type = "P12"\n`;
  await writeFile(configPath, content, { flag: 'wx', mode: 0o600 });
  return configPath;
}

/**
 * Remove a temporary curl config file.
 * @param {string} configPath
 */
async function removeCurlConfig(configPath) {
  try {
    await unlink(configPath);
  } catch {
    // Ignore
  }
}

/**
 * Build common curl args for mTLS authentication via config file.
 * Server-side TLS is verified via the pinned public-key digest captured at
 * enrollment (`--pinnedpubkey 'sha256//<base64>'`). Falls back to `-k`
 * with a one-shot warning for legacy agents lacking a pin.
 *
 * @param {string} configPath
 * @param {object|null|undefined} pinSource
 * @returns {string[]}
 */
function certArgs(configPath, pinSource) {
  return [
    '-K', configPath,
    '-s',
    '-f',
    '--max-time', '30',
    ...tlsVerifyArgs(pinSource),
  ];
}

/**
 * Validate and extract a safe HTTPS URL from the last element of a curl
 * argument list.
 * @param {string[]} args
 * @returns {{ safeUrl: string, preArgs: string[] }}
 */
function extractSafeUrl(args) {
  const parsed = new URL(args[args.length - 1]);
  if (parsed.protocol !== 'https:') {
    throw new Error(`Refusing to call curl with non-HTTPS URL: ${parsed.protocol}`);
  }
  const preArgs = [];
  for (let i = 0; i < args.length - 1; i++) {
    preArgs.push(`${args[i]}`);
  }
  return { safeUrl: parsed.href, preArgs };
}

// ---------------------------------------------------------------------------
// Core curl execution
// ---------------------------------------------------------------------------

/**
 * Execute curl with mTLS credentials via a temporary config file.
 * @param {string} baseDir - Directory for temp files
 * @param {string} p12Path
 * @param {string} p12Password
 * @param {string[]} extraArgs
 * @param {object|null|undefined} [pinSource]
 * @returns {Promise<import('execa').ExecaReturnValue>}
 */
async function curlWithConfig(baseDir, p12Path, p12Password, extraArgs, pinSource) {
  const { safeUrl, preArgs } = extractSafeUrl(extraArgs);
  const configPath = await createCurlConfig(baseDir, p12Path, p12Password);
  try {
    return await execa('curl', [...certArgs(configPath, pinSource), ...preArgs, safeUrl]);
  } finally {
    await removeCurlConfig(configPath);
  }
}

/**
 * Execute curl using a macOS Keychain identity for mTLS.
 * @param {string} keychainIdentity
 * @param {string[]} extraArgs
 * @param {object|null|undefined} [pinSource]
 * @returns {Promise<import('execa').ExecaReturnValue>}
 */
async function curlWithKeychain(keychainIdentity, extraArgs, pinSource) {
  const { safeUrl, preArgs } = extractSafeUrl(extraArgs);
  return execa('curl', [
    '--cert', keychainIdentity,
    '-s', '-f', '--max-time', '30',
    ...tlsVerifyArgs(pinSource),
    ...preArgs,
    safeUrl,
  ]);
}

/**
 * Execute an authenticated curl command, dispatching to the correct auth
 * method based on the config. The agent config is also the pin source —
 * `panelServerPubkeySha256`, when present, becomes
 * `--pinnedpubkey 'sha256//<base64>'`.
 *
 * @param {string} baseDir - Directory for temp files
 * @param {object} config - Agent config object
 * @param {string[]} extraArgs
 * @returns {Promise<import('execa').ExecaReturnValue>}
 */
async function curlAuthenticated(baseDir, config, extraArgs) {
  if (config.authMethod === 'keychain') {
    return curlWithKeychain(config.keychainIdentity, extraArgs, config);
  }
  return curlWithConfig(baseDir, config.p12Path, config.p12Password, extraArgs, config);
}

/**
 * Resolve and validate the panel URL from a config object.
 * Enforces HTTPS and strips trailing slashes.
 * @param {object} config
 * @returns {string}
 */
function resolvePanelUrl(config) {
  const parsed = new URL(config.panelUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error(`Panel URL must use HTTPS, got: ${parsed.protocol}`);
  }
  let href = parsed.href;
  while (href.endsWith('/')) href = href.slice(0, -1);
  return href;
}

// ---------------------------------------------------------------------------
// Panel API functions used by daemon routes
// ---------------------------------------------------------------------------

/**
 * Create a panel API client bound to a specific agent label.
 * Cleans up stale curl configs on creation.
 *
 * @param {string} label - Agent label
 * @returns {PanelApiClient}
 */
export function createPanelApiClient(label) {
  const baseDir = agentDataDir(label);
  cleanupStaleCurlConfigs(baseDir);

  return {
    /**
     * Execute an authenticated curl command and parse JSON response.
     * @param {object} config - Agent config with auth credentials
     * @param {string[]} curlArgs
     * @returns {Promise<object>}
     */
    async curlAuthenticatedJson(config, curlArgs) {
      const { stdout } = await curlAuthenticated(baseDir, config, curlArgs);
      return JSON.parse(stdout);
    },

    /**
     * Fetch the tunnel list from the panel.
     * @param {object} config
     * @returns {Promise<object>}
     */
    async fetchTunnels(config) {
      const panelUrl = resolvePanelUrl(config);
      const url = `${panelUrl}/api/tunnels`;
      try {
        const { stdout } = await curlAuthenticated(baseDir, config, [url]);
        return JSON.parse(stdout);
      } catch (err) {
        throw new Error(`Failed to fetch tunnels from panel. Details: ${err.stderr || err.message}`);
      }
    },

    /**
     * Fetch the platform-agnostic agent config from the panel.
     * @param {object} config
     * @returns {Promise<object>}
     */
    async fetchAgentConfig(config) {
      const panelUrl = resolvePanelUrl(config);
      const url = `${panelUrl}/api/tunnels/agent-config`;
      try {
        const { stdout } = await curlAuthenticated(baseDir, config, [url]);
        return JSON.parse(stdout);
      } catch (err) {
        throw new Error(`Failed to fetch agent config from panel. Details: ${err.stderr || err.message}`);
      }
    },

    /**
     * Request the panel to expose the agent's management panel tunnel.
     * @param {object} config
     * @param {number} port
     * @returns {Promise<object>}
     */
    async exposePanelTunnel(config, port) {
      const panelUrl = resolvePanelUrl(config);
      const url = `${panelUrl}/api/tunnels/expose-panel`;
      try {
        const { stdout } = await curlAuthenticated(baseDir, config, [
          '-X', 'POST',
          '-H', 'Content-Type: application/json',
          '-d', JSON.stringify({ port }),
          url,
        ]);
        return JSON.parse(stdout);
      } catch (err) {
        throw new Error(`Failed to expose panel tunnel. Details: ${err.stderr || err.message}`);
      }
    },

    /**
     * Request the panel to retract the agent's panel tunnel.
     * @param {object} config
     * @returns {Promise<object>}
     */
    async retractPanelTunnel(config) {
      const panelUrl = resolvePanelUrl(config);
      const url = `${panelUrl}/api/tunnels/retract-panel`;
      try {
        const { stdout } = await curlAuthenticated(baseDir, config, ['-X', 'DELETE', url]);
        return JSON.parse(stdout);
      } catch (err) {
        throw new Error(`Failed to retract panel tunnel. Details: ${err.stderr || err.message}`);
      }
    },

    /**
     * Fetch this agent's capabilities and allowedSites from the panel.
     * Used by the daemon to enforce per-route capability checks against
     * mTLS callers presenting an `agent:<label>` cert. The panel route
     * derives identity from the cert CN — no client-controlled label.
     *
     * @param {object} config
     * @returns {Promise<{ capabilities: string[], allowedSites: string[], role: string }>}
     */
    async fetchSelfCapabilities(config) {
      const panelUrl = resolvePanelUrl(config);
      const url = `${panelUrl}/api/agents/me/capabilities`;
      try {
        const { stdout } = await curlAuthenticated(baseDir, config, [url]);
        const parsed = JSON.parse(stdout);
        // Defensive shape check — bad upstream responses must not produce
        // capability bypass (e.g. an unexpected null becoming "all caps").
        const capabilities = Array.isArray(parsed?.capabilities) ? parsed.capabilities : [];
        const allowedSites = Array.isArray(parsed?.allowedSites) ? parsed.allowedSites : [];
        const role = typeof parsed?.role === 'string' ? parsed.role : 'agent';
        return { capabilities, allowedSites, role };
      } catch (err) {
        throw new Error(`Failed to fetch self capabilities. Details: ${err.stderr || err.message}`);
      }
    },

    /**
     * Check the status of the agent's panel tunnel.
     * @param {object} config
     * @returns {Promise<{ enabled: boolean, fqdn: string | null, port: number | null }>}
     */
    async fetchPanelTunnelStatus(config) {
      const panelUrl = resolvePanelUrl(config);
      const url = `${panelUrl}/api/tunnels/agent-panel-status`;
      try {
        const { stdout } = await curlAuthenticated(baseDir, config, [url]);
        return JSON.parse(stdout);
      } catch (err) {
        throw new Error(`Failed to fetch panel tunnel status. Details: ${err.stderr || err.message}`);
      }
    },
  };
}

/**
 * @typedef {ReturnType<typeof createPanelApiClient>} PanelApiClient
 */
