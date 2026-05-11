/**
 * Server-side mTLS certificate management — cert info, rotation, agent certs, revocation.
 *
 * All functions are pure: they accept paths, config, and exec/logger dependencies
 * as parameters. No global state, no Fastify dependency.
 */

import crypto from 'node:crypto';
import { access, constants, readFile } from 'node:fs/promises';
import {
  BASE_CAPABILITIES,
  PLUGIN_AGENT_CN_PREFIX,
  DEFAULT_AGENT_CAPABILITY,
} from '../constants.js';
import { PromiseChainMutex, atomicWriteJSON } from '../file-helpers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CertExpiry {
  readonly expiresAt: string;
  readonly daysUntilExpiry: number;
}

export interface MtlsCertInfo {
  readonly type: 'mtls-ca' | 'mtls-client';
  readonly domain: null;
  readonly expiresAt: string;
  readonly daysUntilExpiry: number;
  readonly path: string;
  readonly expiringSoon: boolean;
}

export interface RotationResult {
  readonly ok: true;
  readonly p12Password: string;
  readonly expiresAt: string;
  readonly warning: string;
}

export interface AgentCertResult {
  readonly label: string;
  readonly p12Password: string;
  readonly serial: string;
  readonly expiresAt: string;
}

export interface AgentCertEntry {
  label: string;
  serial: string;
  capabilities: string[];
  allowedSites: string[];
  enrollmentMethod: 'p12' | 'hardware-bound';
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  revokedAt?: string | undefined;
  delegatedBy?: string | undefined;
  certType?: 'plugin-agent' | undefined;
}

export interface AgentRegistry {
  agents: AgentCertEntry[];
}

export interface MtlsLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * Abstraction for running shell commands.
 * Supports optional `input` for stdin piping (e.g. p12 passwords).
 */
export interface ExecFn {
  (
    file: string,
    args: string[],
    options?: { cwd?: string; timeout?: number; input?: string },
  ): Promise<{ stdout: string; stderr: string }>;
}

/** Function to add a serial to the revocation list. */
export type AddToRevocationListFn = (serial: string, label: string) => Promise<void>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class MtlsError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'CA_KEY_NOT_FOUND'
      | 'ROTATION_FAILED'
      | 'AGENT_EXISTS'
      | 'AGENT_NOT_FOUND'
      | 'INVALID_CAPABILITY'
      | 'INVALID_LABEL'
      | 'GENERATION_FAILED',
  ) {
    super(message);
    this.name = 'MtlsError';
  }
}

// ---------------------------------------------------------------------------
// Promise-chain mutex for agent registry
// ---------------------------------------------------------------------------

const registryMutex = new PromiseChainMutex();

function withRegistryLock<T>(fn: () => Promise<T>): Promise<T> {
  return registryMutex.run(fn);
}

// ---------------------------------------------------------------------------
// Cert expiry reading
// ---------------------------------------------------------------------------

/**
 * Read the expiry date from a certificate file using openssl.
 */
export async function readCertExpiry(
  certPath: string,
  exec: ExecFn,
): Promise<CertExpiry | null> {
  try {
    const { stdout } = await exec('sudo', [
      'openssl',
      'x509',
      '-in',
      certPath,
      '-enddate',
      '-noout',
    ]);
    const match = stdout.match(/notAfter=(.+)/);
    if (!match?.[1]) return null;

    const expiryDate = new Date(match[1]);
    if (isNaN(expiryDate.getTime())) return null;

    const daysUntilExpiry = Math.floor(
      (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );

    return { expiresAt: expiryDate.toISOString(), daysUntilExpiry };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// mTLS certificate info
// ---------------------------------------------------------------------------

/**
 * Get mTLS certificate info (CA and client certs).
 */
export async function getMtlsCerts(
  pkiDir: string,
  exec: ExecFn,
): Promise<MtlsCertInfo[]> {
  const certs: MtlsCertInfo[] = [];

  const certFiles: Array<{ type: 'mtls-ca' | 'mtls-client'; filename: string }> = [
    { type: 'mtls-ca', filename: 'ca.crt' },
    { type: 'mtls-client', filename: 'client.crt' },
  ];

  for (const { type, filename } of certFiles) {
    const certPath = `${pkiDir}/${filename}`;

    try {
      await access(certPath, constants.R_OK);
    } catch {
      continue;
    }

    const expiry = await readCertExpiry(certPath, exec);
    if (!expiry) continue;

    certs.push({
      type,
      domain: null,
      expiresAt: expiry.expiresAt,
      daysUntilExpiry: expiry.daysUntilExpiry,
      path: certPath,
      expiringSoon: expiry.daysUntilExpiry <= 30,
    });
  }

  return certs;
}

// ---------------------------------------------------------------------------
// mTLS client cert rotation
// ---------------------------------------------------------------------------

/**
 * Rotate the mTLS client certificate.
 * Generates a new key, CSR, signs with existing CA, creates PKCS12 bundle.
 * Backs up old files before replacement.
 */
export async function rotateClientCert(
  pkiDir: string,
  exec: ExecFn,
  logger: MtlsLogger,
): Promise<RotationResult> {
  // Verify CA key exists
  try {
    await access(`${pkiDir}/ca.key`, constants.R_OK);
  } catch {
    try {
      await exec('sudo', ['test', '-r', `${pkiDir}/ca.key`]);
    } catch {
      throw new MtlsError('CA key not found — cannot sign new certificate', 'CA_KEY_NOT_FOUND');
    }
  }

  const newKeyPath = `${pkiDir}/client.key.new`;
  const csrPath = `${pkiDir}/client.csr`;
  const newCertPath = `${pkiDir}/client.crt.new`;
  const newP12Path = `${pkiDir}/client.p12.new`;

  const p12Password = crypto.randomBytes(16).toString('hex');

  try {
    // 1. Generate new client private key
    logger.info({}, 'Generating new client private key');
    await exec('sudo', ['openssl', 'genrsa', '-out', newKeyPath, '4096']);

    // 2. Create CSR
    logger.info({}, 'Creating certificate signing request');
    await exec('sudo', [
      'openssl',
      'req',
      '-new',
      '-key',
      newKeyPath,
      '-out',
      csrPath,
      '-subj',
      '/CN=Lamaste Client/O=Lamaste',
    ]);

    // 3. Sign with CA (2-year validity)
    logger.info({}, 'Signing certificate with CA');
    await exec('sudo', [
      'openssl',
      'x509',
      '-req',
      '-in',
      csrPath,
      '-CA',
      `${pkiDir}/ca.crt`,
      '-CAkey',
      `${pkiDir}/ca.key`,
      '-CAcreateserial',
      '-out',
      newCertPath,
      '-days',
      '730',
      '-sha256',
    ]);

    // 4. Create PKCS12 bundle
    logger.info({}, 'Creating PKCS12 bundle');
    await exec(
      'sudo',
      [
        'openssl',
        'pkcs12',
        '-export',
        '-keypbe',
        'PBE-SHA1-3DES',
        '-certpbe',
        'PBE-SHA1-3DES',
        '-macalg',
        'sha1',
        '-out',
        newP12Path,
        '-inkey',
        newKeyPath,
        '-in',
        newCertPath,
        '-certfile',
        `${pkiDir}/ca.crt`,
        '-passout',
        'stdin',
      ],
      { input: p12Password },
    );

    // 5. Back up current files
    logger.info({}, 'Backing up current certificates');
    await exec('sudo', ['cp', `${pkiDir}/client.crt`, `${pkiDir}/client.crt.bak`]);
    await exec('sudo', ['cp', `${pkiDir}/client.key`, `${pkiDir}/client.key.bak`]);
    await exec('sudo', ['cp', `${pkiDir}/client.p12`, `${pkiDir}/client.p12.bak`]);

    // 6. Move new files into place
    logger.info({}, 'Installing new certificates');
    await exec('sudo', ['mv', newKeyPath, `${pkiDir}/client.key`]);
    await exec('sudo', ['mv', newCertPath, `${pkiDir}/client.crt`]);
    await exec('sudo', ['mv', newP12Path, `${pkiDir}/client.p12`]);

    // 7. Clean up CSR and serial file
    await exec('sudo', ['rm', '-f', csrPath, `${pkiDir}/ca.srl`]);

    // 8. Set file permissions and ownership
    await exec('sudo', ['chmod', '600', `${pkiDir}/client.key`]);
    await exec('sudo', ['chmod', '644', `${pkiDir}/client.crt`]);
    await exec('sudo', ['chmod', '600', `${pkiDir}/client.p12`]);
    await exec('sudo', [
      'chown',
      'lamaste:lamaste',
      `${pkiDir}/client.key`,
      `${pkiDir}/client.crt`,
      `${pkiDir}/client.p12`,
      `${pkiDir}/client.key.bak`,
      `${pkiDir}/client.crt.bak`,
      `${pkiDir}/client.p12.bak`,
    ]);

    // 9. Read the new expiry
    const expiry = await readCertExpiry(`${pkiDir}/client.crt`, exec);

    return {
      ok: true,
      p12Password,
      expiresAt: expiry?.expiresAt ?? new Date(Date.now() + 730 * 86400000).toISOString(),
      warning:
        'Your current browser certificate is now invalid. Download and import the new certificate before closing this page.',
    };
  } catch (err: unknown) {
    logger.error({ err }, 'mTLS rotation failed, cleaning up');
    await exec('sudo', ['rm', '-f', newKeyPath, csrPath, newCertPath, newP12Path]).catch(
      () => {},
    );

    if (err instanceof MtlsError) throw err;
    const stderr =
      err instanceof Error && 'stderr' in err ? (err as { stderr: string }).stderr : '';
    const message = err instanceof Error ? err.message : String(err);
    throw new MtlsError(
      `mTLS rotation failed: ${stderr || message}`,
      'ROTATION_FAILED',
    );
  }
}

/**
 * Get the path to the client.p12 file.
 */
export function getP12Path(pkiDir: string): string {
  return `${pkiDir}/client.p12`;
}

// ---------------------------------------------------------------------------
// Agent registry persistence
// ---------------------------------------------------------------------------

function agentsDir(pkiDir: string): string {
  return `${pkiDir}/agents`;
}

/**
 * Load the agent registry from disk.
 */
export async function loadAgentRegistry(pkiDir: string): Promise<AgentRegistry> {
  try {
    const raw = await readFile(`${agentsDir(pkiDir)}/registry.json`, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('agents' in parsed) ||
      !Array.isArray((parsed as AgentRegistry).agents)
    ) {
      return { agents: [] };
    }
    return parsed as AgentRegistry;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { agents: [] };
    }
    throw new Error(
      `Failed to read agent registry: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Atomically save the agent registry to disk.
 */
export async function saveAgentRegistry(
  pkiDir: string,
  data: AgentRegistry,
): Promise<void> {
  await atomicWriteJSON(`${agentsDir(pkiDir)}/registry.json`, data, { mode: 0o640 });
}

/**
 * Get the path to an agent's PKCS12 bundle.
 */
export function getAgentP12Path(pkiDir: string, label: string): string {
  return `${agentsDir(pkiDir)}/${label}/client.p12`;
}

// ---------------------------------------------------------------------------
// Capability management
// ---------------------------------------------------------------------------

/**
 * Compute the full list of valid capabilities (base + plugin + ticket scope).
 *
 * The two contributed lists must already use the `plugin:<short-name>:<action>`
 * namespace (enforced at registration time by the manifest schema and the
 * ticket scope route). Returning a deduplicated set means the caller can
 * trust an `includes()` check against the result.
 */
export function getValidCapabilities(
  pluginCapabilities: readonly string[],
  ticketScopeCapabilities: readonly string[],
): string[] {
  return [
    ...new Set<string>([
      ...BASE_CAPABILITIES,
      ...pluginCapabilities,
      ...ticketScopeCapabilities,
    ]),
  ];
}

/**
 * Drop capabilities for an uninstalled plugin from every agent in the
 * registry. Does not revoke the agent certificate — only mutates the stored
 * capability subset, so the agent's next config refresh will reflect the
 * reduced set.
 *
 * Closes the silent re-grant path: re-installing/enabling the same plugin
 * later would not restore previously-granted capabilities; the admin must
 * explicitly re-grant.
 *
 * Returns the per-agent diff so callers can audit what was removed.
 */
export function revokePluginCapabilitiesFromAgents(
  pkiDir: string,
  pluginRoute: string,
): Promise<Array<{ label: string; removed: string[] }>> {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(pluginRoute)) {
    throw new MtlsError(`Invalid plugin route: ${pluginRoute}`, 'INVALID_CAPABILITY');
  }
  const prefix = `plugin:${pluginRoute}:`;
  return withRegistryLock(async () => {
    const registry = await loadAgentRegistry(pkiDir);
    const diffs: Array<{ label: string; removed: string[] }> = [];
    let changed = false;
    for (const agent of registry.agents) {
      if (agent.revoked || !Array.isArray(agent.capabilities)) continue;
      const removed: string[] = [];
      const kept: string[] = [];
      for (const cap of agent.capabilities) {
        if (cap.startsWith(prefix)) removed.push(cap);
        else kept.push(cap);
      }
      if (removed.length > 0) {
        agent.capabilities = kept;
        diffs.push({ label: agent.label, removed });
        changed = true;
      }
    }
    if (changed) await saveAgentRegistry(pkiDir, registry);
    return diffs;
  });
}

/**
 * Filter a stored capability list against the currently valid set.
 *
 * Use everywhere a stored agent capability feeds into an authorization
 * decision. Reading `agent.capabilities` directly is unsafe because the
 * stored list can include entries that became invalid after a plugin
 * uninstall or ticket scope deregistration; `getAgentCapabilities()` /
 * `getAgentCapabilitiesLive()` (and this filter, for callers that already
 * have the entry in hand) collapse the stored set to what is currently
 * honored.
 */
export function filterLiveCapabilities(
  stored: readonly string[],
  pluginCapabilities: readonly string[],
  ticketScopeCapabilities: readonly string[],
): string[] {
  const valid = new Set(getValidCapabilities(pluginCapabilities, ticketScopeCapabilities));
  return stored.filter((c) => valid.has(c));
}

/**
 * Get an agent's capabilities lazy-filtered against the live valid set.
 *
 * Convenience wrapper around {@link getAgentCapabilities} that exists so
 * callers naming the concept "live" pick a single canonical helper instead
 * of re-implementing the filter at each call site (the original bug).
 */
export function getAgentCapabilitiesLive(
  pkiDir: string,
  label: string,
  pluginCapabilities: readonly string[],
  ticketScopeCapabilities: readonly string[],
): Promise<string[]> {
  return getAgentCapabilities(pkiDir, label, pluginCapabilities, ticketScopeCapabilities);
}

// ---------------------------------------------------------------------------
// Defense-in-depth label shape check
// ---------------------------------------------------------------------------

// Matches the agent label rule defined in src/agent/registry.ts. Duplicated
// here because the core domain isolation forbids server/ from importing agent/.
// A registry tampering attack (e.g. a label containing '..' or '/') must not
// be able to make us interpolate into a path like `${agentsDir}/../foo/`.
const MTLS_LABEL_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function assertSafeLabel(label: string): void {
  if (typeof label !== 'string' || !MTLS_LABEL_REGEX.test(label)) {
    throw new MtlsError(`Invalid agent label: ${label}`, 'INVALID_LABEL');
  }
}

// ---------------------------------------------------------------------------
// Agent certificate generation
// ---------------------------------------------------------------------------

export interface GenerateAgentCertOptions {
  label: string;
  pkiDir: string;
  exec: ExecFn;
  logger: MtlsLogger;
  capabilities?: string[] | undefined;
  allowedSites?: string[] | undefined;
}

/**
 * Generate an agent-scoped client certificate.
 *
 * Creates a new RSA key, CSR, signs with the existing CA, and packages
 * the result as a PKCS12 bundle (legacy PBE-SHA1-3DES for macOS compat).
 */
export function generateAgentCert(
  opts: GenerateAgentCertOptions,
): Promise<AgentCertResult> {
  const { label, pkiDir, exec, logger, capabilities, allowedSites } = opts;
  assertSafeLabel(label);

  return withRegistryLock(async () => {
    const registry = await loadAgentRegistry(pkiDir);
    const existing = registry.agents.find((a) => a.label === label && !a.revoked);
    if (existing) {
      throw new MtlsError(
        `Agent certificate with label "${label}" already exists`,
        'AGENT_EXISTS',
      );
    }

    // Verify CA key exists
    try {
      await access(`${pkiDir}/ca.key`, constants.R_OK);
    } catch {
      try {
        await exec('sudo', ['test', '-r', `${pkiDir}/ca.key`]);
      } catch {
        throw new MtlsError(
          'CA key not found — cannot sign new certificate',
          'CA_KEY_NOT_FOUND',
        );
      }
    }

    const agentDirPath = `${agentsDir(pkiDir)}/${label}`;
    const keyPath = `${agentDirPath}/client.key`;
    const csrPath = `${agentDirPath}/client.csr`;
    const certPath = `${agentDirPath}/client.crt`;
    const p12Path = `${agentDirPath}/client.p12`;

    const p12Password = crypto.randomBytes(16).toString('hex');

    try {
      // 1. Create agents base directory and hand to lamaste
      logger.info({ label }, 'Creating agent certificate directory');
      await exec('sudo', ['mkdir', '-p', agentsDir(pkiDir)]);
      await exec('sudo', ['chown', 'lamaste:lamaste', agentsDir(pkiDir)]);

      // Create the per-agent subdirectory
      await exec('mkdir', ['-p', agentDirPath]);

      // 2. Generate 4096-bit RSA key
      logger.info({ label }, 'Generating agent private key');
      await exec('sudo', ['openssl', 'genrsa', '-out', keyPath, '4096']);
      await exec('sudo', ['chown', '-R', 'lamaste:lamaste', agentDirPath]);

      // 3. Create CSR with agent-scoped CN
      logger.info({ label }, 'Creating certificate signing request');
      await exec('sudo', [
        'openssl',
        'req',
        '-new',
        '-key',
        keyPath,
        '-out',
        csrPath,
        '-subj',
        `/CN=agent:${label}/O=Lamaste`,
      ]);

      // 4. Sign with CA (2-year validity)
      logger.info({ label }, 'Signing certificate with CA');
      await exec('sudo', [
        'openssl',
        'x509',
        '-req',
        '-in',
        csrPath,
        '-CA',
        `${pkiDir}/ca.crt`,
        '-CAkey',
        `${pkiDir}/ca.key`,
        '-CAcreateserial',
        '-out',
        certPath,
        '-days',
        '730',
        '-sha256',
      ]);

      // 5. Create PKCS12 bundle (legacy flags for macOS compatibility)
      logger.info({ label }, 'Creating PKCS12 bundle');
      await exec(
        'sudo',
        [
          'openssl',
          'pkcs12',
          '-export',
          '-keypbe',
          'PBE-SHA1-3DES',
          '-certpbe',
          'PBE-SHA1-3DES',
          '-macalg',
          'sha1',
          '-out',
          p12Path,
          '-inkey',
          keyPath,
          '-in',
          certPath,
          '-certfile',
          `${pkiDir}/ca.crt`,
          '-passout',
          'stdin',
        ],
        { input: p12Password },
      );

      // 6. Ensure all generated files are owned by lamaste
      await exec('sudo', ['chown', '-R', 'lamaste:lamaste', agentDirPath]);

      // 7. Read serial number
      const { stdout: serialOut } = await exec('openssl', [
        'x509',
        '-in',
        certPath,
        '-serial',
        '-noout',
      ]);
      const serialMatch = serialOut.match(/serial=([A-Fa-f0-9]+)/);
      const serial = serialMatch?.[1] ?? '';

      // 8. Read expiry
      const expiry = await readCertExpiry(certPath, exec);
      const expiresAt =
        expiry?.expiresAt ?? new Date(Date.now() + 730 * 86400000).toISOString();

      // 9. Clean up CSR
      await exec('rm', ['-f', csrPath]);

      // 10. Set file permissions
      await exec('chmod', ['600', keyPath]);
      await exec('chmod', ['644', certPath]);
      await exec('chmod', ['600', p12Path]);

      // 11. Add to registry
      registry.agents.push({
        label,
        serial,
        capabilities: capabilities ?? [DEFAULT_AGENT_CAPABILITY],
        allowedSites: allowedSites ?? [],
        enrollmentMethod: 'p12',
        createdAt: new Date().toISOString(),
        expiresAt,
        revoked: false,
      });
      await saveAgentRegistry(pkiDir, registry);

      return { label, p12Password, serial, expiresAt };
    } catch (err: unknown) {
      logger.error(
        { err, label },
        'Agent certificate generation failed, cleaning up',
      );
      await exec('rm', ['-rf', agentDirPath]).catch(() => {});

      if (err instanceof MtlsError) throw err;
      const stderr =
        err instanceof Error && 'stderr' in err
          ? (err as { stderr: string }).stderr
          : '';
      const message = err instanceof Error ? err.message : String(err);
      throw new MtlsError(
        `Agent certificate generation failed: ${stderr || message}`,
        'GENERATION_FAILED',
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Agent certificate queries
// ---------------------------------------------------------------------------

export interface AgentCertListEntry extends AgentCertEntry {
  readonly expiringSoon: boolean;
}

/**
 * List all agent certificates with expiry status.
 */
export async function listAgentCerts(pkiDir: string): Promise<AgentCertListEntry[]> {
  const registry = await loadAgentRegistry(pkiDir);

  return registry.agents.map((agent) => {
    let expiringSoon = false;
    if (!agent.revoked && agent.expiresAt) {
      const daysUntilExpiry = Math.floor(
        (new Date(agent.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      expiringSoon = daysUntilExpiry <= 30;
    }
    const isPluginAgent = agent.label.startsWith(PLUGIN_AGENT_CN_PREFIX);
    const entry: AgentCertListEntry = {
      ...agent,
      capabilities:
        agent.capabilities ?? (isPluginAgent ? [] : [DEFAULT_AGENT_CAPABILITY]),
      enrollmentMethod: agent.enrollmentMethod ?? 'p12',
      expiringSoon,
      certType: isPluginAgent ? 'plugin-agent' : undefined,
    };
    return entry;
  });
}

/**
 * Get capabilities for a specific agent by label, filtered against valid capabilities.
 */
export async function getAgentCapabilities(
  pkiDir: string,
  label: string,
  pluginCapabilities: readonly string[],
  ticketScopeCapabilities: readonly string[],
): Promise<string[]> {
  const registry = await loadAgentRegistry(pkiDir);
  const agent = registry.agents.find((a) => a.label === label && !a.revoked);

  // Plugin-agents have no default capabilities
  if (!agent) {
    return label.startsWith(PLUGIN_AGENT_CN_PREFIX) ? [] : [DEFAULT_AGENT_CAPABILITY];
  }

  const stored =
    agent.capabilities ??
    (label.startsWith(PLUGIN_AGENT_CN_PREFIX) ? [] : [DEFAULT_AGENT_CAPABILITY]);

  const valid = getValidCapabilities(pluginCapabilities, ticketScopeCapabilities);
  return stored.filter((c) => valid.includes(c));
}

/**
 * Update capabilities for an agent certificate.
 */
export function updateAgentCapabilities(
  pkiDir: string,
  label: string,
  capabilities: string[],
  pluginCapabilities: readonly string[],
  ticketScopeCapabilities: readonly string[],
): Promise<{ ok: true; label: string; capabilities: string[] }> {
  return withRegistryLock(async () => {
    const registry = await loadAgentRegistry(pkiDir);
    const agent = registry.agents.find((a) => a.label === label && !a.revoked);

    if (!agent) {
      throw new MtlsError(
        `Agent certificate "${label}" not found`,
        'AGENT_NOT_FOUND',
      );
    }

    const validCaps = getValidCapabilities(pluginCapabilities, ticketScopeCapabilities);
    for (const cap of capabilities) {
      if (!validCaps.includes(cap)) {
        throw new MtlsError(`Invalid capability: ${cap}`, 'INVALID_CAPABILITY');
      }
    }

    // Ensure tunnels:read is always present for regular agents
    if (!label.startsWith('plugin-agent:') && !capabilities.includes(DEFAULT_AGENT_CAPABILITY)) {
      capabilities.unshift(DEFAULT_AGENT_CAPABILITY);
    }

    agent.capabilities = capabilities;
    await saveAgentRegistry(pkiDir, registry);

    return { ok: true as const, label, capabilities };
  });
}

/**
 * Get allowed sites for a specific agent.
 */
export async function getAgentAllowedSites(
  pkiDir: string,
  label: string,
): Promise<string[]> {
  const registry = await loadAgentRegistry(pkiDir);
  const agent = registry.agents.find((a) => a.label === label && !a.revoked);
  if (!agent) return [];
  return agent.allowedSites ?? [];
}

/**
 * Update allowed sites for an agent certificate.
 */
export function updateAgentAllowedSites(
  pkiDir: string,
  label: string,
  allowedSites: string[],
): Promise<{ ok: true; label: string; allowedSites: string[] }> {
  return withRegistryLock(async () => {
    const registry = await loadAgentRegistry(pkiDir);
    const agent = registry.agents.find((a) => a.label === label && !a.revoked);
    if (!agent) {
      throw new MtlsError(
        `Agent certificate "${label}" not found`,
        'AGENT_NOT_FOUND',
      );
    }
    agent.allowedSites = allowedSites;
    await saveAgentRegistry(pkiDir, registry);
    return { ok: true as const, label, allowedSites: agent.allowedSites };
  });
}

// ---------------------------------------------------------------------------
// Agent certificate revocation
// ---------------------------------------------------------------------------

export interface RevokeAgentCertOptions {
  label: string;
  pkiDir: string;
  exec: ExecFn;
  logger: MtlsLogger;
  addToRevocationList: AddToRevocationListFn;
}

/**
 * Revoke an agent certificate by label.
 *
 * Adds the serial to the revocation list, marks it revoked in the registry,
 * removes the agent's key/cert/p12 files, and cascade-revokes plugin-agents.
 */
export function revokeAgentCert(
  opts: RevokeAgentCertOptions,
): Promise<{ ok: true; label: string }> {
  const { label, pkiDir, exec, logger, addToRevocationList } = opts;
  assertSafeLabel(label);

  return withRegistryLock(async () => {
    const registry = await loadAgentRegistry(pkiDir);
    const agent = registry.agents.find((a) => a.label === label && !a.revoked);

    if (!agent) {
      throw new MtlsError(
        `Agent certificate "${label}" not found`,
        'AGENT_NOT_FOUND',
      );
    }

    // 1. Add serial to revocation list
    logger.info({ label, serial: agent.serial }, 'Revoking agent certificate');
    await addToRevocationList(agent.serial, `agent:${label}`);

    // 2. Mark revoked in registry
    agent.revoked = true;
    agent.revokedAt = new Date().toISOString();

    // 3. Cascade revocation to plugin-agents delegated by this agent
    const pluginAgents = registry.agents.filter(
      (a) => !a.revoked && a.delegatedBy === label,
    );

    for (const pa of pluginAgents) {
      logger.info(
        { label: pa.label, serial: pa.serial, delegatedBy: label },
        'Cascade-revoking plugin-agent certificate',
      );
      await addToRevocationList(pa.serial, `agent:${pa.label}`);
      pa.revoked = true;
      pa.revokedAt = new Date().toISOString();

      // Remove plugin-agent's key/cert/p12 files
      await exec('rm', ['-rf', `${agentsDir(pkiDir)}/${pa.label}/`]).catch(
        (err: unknown) => {
          logger.warn(
            { err, label: pa.label },
            'Failed to remove plugin-agent certificate files',
          );
        },
      );
    }

    if (pluginAgents.length > 0) {
      logger.info(
        { label, cascadeCount: pluginAgents.length },
        'Cascade-revoked plugin-agent certificates',
      );
    }

    // 4. Save registry atomically
    await saveAgentRegistry(pkiDir, registry);

    // 5. Remove agent's key/cert/p12 files
    await exec('rm', ['-rf', `${agentsDir(pkiDir)}/${label}/`]).catch(
      (err: unknown) => {
        logger.warn({ err, label }, 'Failed to remove agent certificate files');
      },
    );

    return { ok: true as const, label };
  });
}
