/**
 * Agent config I/O for per-agent configurations.
 *
 * Per-agent config: ~/.lamalibre/lamaste/agents/<label>/config.json
 */

import { readFile } from 'node:fs/promises';
import { atomicWriteJSON } from '../file-helpers.js';
import { agentConfigPath } from './platform.js';

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
   * cert DER. Used by chisel `--fingerprint <hex>` for tunnel-server cert
   * pinning. The chisel server runs behind nginx on `tunnel.<domain>` so
   * this is the same TLS endpoint as the panel for fingerprinting purposes.
   *
   * `panelServerCertPinnedAt` — ISO timestamp of the TOFU capture, used in
   * status output and audit logs.
   *
   * Legacy agents lacking these fields fall back to `-k` / `--tls-skip-verify`
   * with a one-shot warning and should re-enroll (or run `lamaste-agent panel
   * reset-pin`) to capture the pin.
   */
  panelServerPubkeySha256?: string | undefined;
  panelServerCertSha256Hex?: string | undefined;
  panelServerCertPinnedAt?: string | undefined;
  /**
   * Hex SHA-256 of the chisel TLS server's leaf cert at `tunnel.<domain>:443`.
   * Captured by TOFU during enrollment and re-injected into chisel client
   * args as `--fingerprint <hex>`. Stored separately from
   * `panelServerCertSha256Hex` because the chisel server typically has its
   * own LE cert (different subdomain, different cert).
   */
  chiselServerCertSha256Hex?: string | undefined;
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
  try {
    const configPath = agentConfigPath(label);
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
  await atomicWriteJSON(agentConfigPath(label), config, {
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
