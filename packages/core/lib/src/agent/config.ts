/**
 * Agent config I/O for per-agent configurations.
 *
 * Per-agent config: ~/.lamalibre/lamaste/agents/<label>/config.json
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJSON } from '../file-helpers.js';
import { agentConfigPath, agentsDir } from './platform.js';
import { validateLabel } from './registry.js';

/**
 * Resolve and assert the per-agent config path stays under `<agents root>/`.
 *
 * Belt-and-suspenders for CodeQL path-injection data flow: even though
 * `validateLabel` rejects every traversal vector, callers downstream may not
 * recognize it as a sanitizer. Re-validate after `path.resolve` so the data
 * flow visibly terminates at a guarded sink.
 */
function safeAgentConfigPath(label: string): string {
  validateLabel(label);
  const root = path.resolve(agentsDir());
  const resolved = path.resolve(agentConfigPath(label));
  const withSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (!resolved.startsWith(withSep)) {
    throw new Error('Resolved agent config path escapes agents root');
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentConfig {
  panelUrl: string;
  authMethod: 'p12' | 'keychain';
  p12Path?: string | undefined;
  p12Password?: string | undefined;
  keychainIdentity?: string | undefined;
  agentLabel?: string | undefined;
  domain?: string | undefined;
  chiselVersion?: string | undefined;
  setupAt?: string | undefined;
  updatedAt?: string | undefined;
  /**
   * Server certificate pinning (TOFU — captured at enrollment, used on every
   * subsequent panel call to defeat MITM after first use).
   *
   * `panelServerPubkeySha256` — base64 SHA-256 of the panel TLS server cert's
   * SubjectPublicKeyInfo. Used by curl `--pinnedpubkey 'sha256//<base64>'`.
   * Pins the public key (not the cert), so panel cert rotation that keeps
   * the same key does not break the pin.
   *
   * `panelServerCertSha256Hex` — hex SHA-256 of the panel TLS server leaf
   * cert DER, shown to the operator for out-of-band verification.
   *
   * `panelServerCertPinnedAt` — ISO timestamp of the TOFU capture, used in
   * status output and audit logs.
   *
   * Legacy agents lacking these fields fall back to `-k` with a one-shot
   * warning and should re-enroll (or run `lamaste-agent panel reset-pin`) to
   * capture the pin. The chisel tunnel itself is not pinned here: it verifies
   * the relay's publicly trusted `tunnel.<domain>` certificate.
   */
  panelServerPubkeySha256?: string | undefined;
  panelServerCertSha256Hex?: string | undefined;
  panelServerCertPinnedAt?: string | undefined;
  /**
   * When this agent last received a chisel credential that has only ever
   * been kept in 0600 files (ISO 8601). Absent on agents set up by versions
   * that passed the credential as a process argument and wrote it into a
   * world-readable unit file; `lamaste-agent sync` rotates such a credential
   * once and then sets this.
   */
  chiselCredentialSealedAt?: string | undefined;
  /**
   * True when the operator stopped this agent's tunnels (agent panel or
   * desktop "stop"). Sync then keeps the chisel client stopped instead of
   * restarting it; "start" clears it.
   */
  tunnelsStopped?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Config I/O
// ---------------------------------------------------------------------------

/**
 * Load the agent config for a given label.
 * Reads from ~/.lamalibre/lamaste/agents/<label>/config.json.
 * Returns null if the file does not exist.
 */
export async function loadAgentConfig(label: string): Promise<AgentConfig | null> {
  // Validate label OUTSIDE the try/catch: invalid labels (path traversal,
  // forbidden chars) must surface to the caller, not silently return null.
  const configPath = safeAgentConfigPath(label);
  try {
    const raw = await readFile(configPath, 'utf8');
    const config = JSON.parse(raw) as AgentConfig;
    // Default authMethod to 'p12' for backwards compatibility
    if (config && !config.authMethod) {
      config.authMethod = 'p12';
    }
    return config;
  } catch {
    return null;
  }
}

/**
 * Save the agent config atomically (write tmp -> fsync -> rename).
 *
 * The parent directory (`agentDataDir(label)`) is created via the helper's
 * `mkdirp` option with mode 0o700.
 */
export async function saveAgentConfig(label: string, config: AgentConfig): Promise<void> {
  await atomicWriteJSON(safeAgentConfigPath(label), config, {
    mkdirp: true,
    dirMode: 0o700,
    mode: 0o600,
  });
}

/**
 * Load agent config or throw if it doesn't exist.
 * Used by commands that require prior setup.
 */
export async function requireAgentConfig(label: string): Promise<AgentConfig> {
  const config = await loadAgentConfig(label);
  if (!config) {
    throw new Error(
      `No agent configuration found for "${label}". Run "lamaste-agent setup --label ${label}" first.`,
    );
  }
  return config;
}
