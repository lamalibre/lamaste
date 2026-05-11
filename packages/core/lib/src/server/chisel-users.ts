/**
 * Chisel auth-file credential management.
 *
 * The chisel server runs with `--authfile <AUTHFILE_PATH>` to authenticate
 * connecting agents. Each agent gets a per-agent password stored alongside
 * in `chisel-credentials.json`. The two files are kept in sync:
 *   - `chisel-credentials.json` is the source of truth (agents fetch via REST)
 *   - `chisel-users` is rendered from it for the chisel process
 *
 * Concurrency: a promise-chain mutex (keyed by state dir) serializes all
 * credential mutations so concurrent enroll/revoke cannot corrupt the file.
 */

import crypto from 'node:crypto';
import { access, constants, readFile, rename, writeFile, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KeyedPromiseChainMutex } from '../file-helpers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface ExecError extends Error {
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface ExecFn {
  (file: string, args: string[]): Promise<ExecResult>;
}

export interface ChiselLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error?(obj: Record<string, unknown>, msg?: string): void;
}

export interface ChiselCredential {
  readonly password: string;
  readonly createdAt: string;
}

export type ChiselCredentialStore = Record<string, ChiselCredential>;

export interface ChiselPaths {
  /** Path to the chisel-credentials.json registry (0600, owned by daemon user). */
  readonly credentialsFile: string;
  /** Path to the rendered chisel-users authfile (0644, readable by chisel). */
  readonly authFilePath: string;
}

export interface ChiselCredentialResult {
  readonly user: string;
  readonly password: string;
  readonly restartOk: boolean;
  readonly restartError?: string;
}

export interface RemoveCredentialResult {
  readonly removed: boolean;
  readonly restartOk: boolean;
  readonly restartError?: string;
}

export interface MigrationResult {
  readonly migrated: boolean;
  readonly agentCount: number;
}

export interface AgentRegistrySnapshot {
  readonly agents: ReadonlyArray<{ readonly label: string; readonly revoked?: boolean }>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const LABEL_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const CHISEL_USER_PREFIX = 'agent-';

function assertSafeLabel(label: string): void {
  if (typeof label !== 'string' || !LABEL_REGEX.test(label)) {
    throw new Error(`Invalid agent label for chisel credential: ${label}`);
  }
}

function assertSafePassword(password: string): void {
  if (typeof password !== 'string' || !/^[a-f0-9]{32,}$/.test(password)) {
    throw new Error('Invalid chisel password format');
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Per-credentialsFile mutex
// ---------------------------------------------------------------------------

const writeMutex = new KeyedPromiseChainMutex();

// ---------------------------------------------------------------------------
// Internal persistence
// ---------------------------------------------------------------------------

/**
 * Load the chisel credential store keyed by agent label.
 */
export async function loadChiselCredentials(
  paths: ChiselPaths,
): Promise<ChiselCredentialStore> {
  try {
    const raw = await readFile(paths.credentialsFile, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as ChiselCredentialStore;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return {};
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read chisel credentials: ${message}`);
  }
}

async function saveChiselCredentials(
  paths: ChiselPaths,
  creds: ChiselCredentialStore,
): Promise<void> {
  const tmpPath = `${paths.credentialsFile}.tmp`;
  const content = JSON.stringify(creds, null, 2) + '\n';
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });
  const fd = await open(tmpPath, 'r');
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
  await rename(tmpPath, paths.credentialsFile);
}

function renderAuthfile(creds: ChiselCredentialStore): string {
  // Chisel's --authfile expects a JSON object of `"<user>:<pass>": [<addr-regex>, ...]`.
  // An empty or line-formatted file makes chisel fail on load with
  // "Invalid JSON: unexpected end of JSON input" and the service crash-loops;
  // on a fresh install with no agents we still need a valid empty object so
  // chisel boots into a no-auth-accepted state until the first enrollment.
  const entries: Record<string, readonly string[]> = {};
  const labels = Object.keys(creds).sort();
  for (const label of labels) {
    const entry = creds[label];
    if (!entry || !entry.password) continue;
    entries[`${CHISEL_USER_PREFIX}${label}:${entry.password}`] = ['.*'];
  }
  return JSON.stringify(entries, null, 2) + '\n';
}

async function writeAuthfile(
  paths: ChiselPaths,
  content: string,
  exec: ExecFn,
): Promise<void> {
  // Temp file name matches the sudoers `mv /tmp/lamalibre-lamaste-chisel-users-*`
  // rule that lets us install into /etc/lamalibre/lamaste/chisel-users.
  const tmpFile = path.join(tmpdir(), `lamalibre-lamaste-chisel-users-${crypto.randomBytes(8).toString('hex')}`);
  await writeFile(tmpFile, content, { encoding: 'utf-8', mode: 0o644 });
  try {
    await exec('sudo', ['mv', tmpFile, paths.authFilePath]);
    await exec('sudo', ['chown', 'lamaste:lamaste', paths.authFilePath]);
    await exec('sudo', ['chmod', '644', paths.authFilePath]);
  } catch (err: unknown) {
    await exec('rm', ['-f', tmpFile]).catch(() => undefined);
    const stderr = (err as ExecError).stderr;
    const message = stderr || (err instanceof Error ? err.message : String(err));
    throw new Error(`Failed to write chisel authfile: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Chisel service restart
// ---------------------------------------------------------------------------

/**
 * Restart the chisel systemd service so it re-reads the authfile.
 * Returns `{ ok: true }` on success or `{ ok: false, error }` on failure.
 *
 * Chisel does not support graceful authfile reload, so a restart is required
 * after every credential mutation. Connected agents auto-reconnect within ~25s.
 */
export async function reloadChiselAuth(
  exec: ExecFn,
  logger?: ChiselLogger,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await exec('sudo', ['systemctl', 'restart', 'chisel']);
    return { ok: true };
  } catch (err: unknown) {
    const stderr = (err as ExecError).stderr;
    const message = stderr || (err instanceof Error ? err.message : String(err));
    if (logger) {
      logger.warn(
        { err: message },
        'Failed to restart chisel after credential change — connected agents may continue using stale credentials until next reconnect',
      );
    }
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a fresh chisel password for an agent and persist it.
 *
 * Writes the credential store, regenerates the authfile, and triggers a
 * chisel service restart. Returns the credential and a `restartOk` flag so
 * callers can surface a warning if the restart failed.
 */
export function addChiselCredential(
  label: string,
  paths: ChiselPaths,
  exec: ExecFn,
  logger?: ChiselLogger,
): Promise<ChiselCredentialResult> {
  assertSafeLabel(label);
  return writeMutex.run(paths.credentialsFile, async () => {
    const creds = await loadChiselCredentials(paths);
    const password = crypto.randomBytes(24).toString('hex');
    assertSafePassword(password);
    creds[label] = {
      password,
      createdAt: new Date().toISOString(),
    };
    await saveChiselCredentials(paths, creds);
    await writeAuthfile(paths, renderAuthfile(creds), exec);
    const reload = await reloadChiselAuth(exec, logger);
    return {
      user: `${CHISEL_USER_PREFIX}${label}`,
      password,
      restartOk: reload.ok,
      ...(reload.ok ? {} : { restartError: reload.error }),
    };
  });
}

/**
 * Remove an agent's chisel credential and regenerate the authfile.
 * Idempotent — succeeds silently if the credential does not exist.
 */
export function removeChiselCredential(
  label: string,
  paths: ChiselPaths,
  exec: ExecFn,
  logger?: ChiselLogger,
): Promise<RemoveCredentialResult> {
  assertSafeLabel(label);
  return writeMutex.run(paths.credentialsFile, async () => {
    const creds = await loadChiselCredentials(paths);
    const existed = Object.prototype.hasOwnProperty.call(creds, label);
    if (!existed) {
      return { removed: false, restartOk: true };
    }
    delete creds[label];
    await saveChiselCredentials(paths, creds);
    await writeAuthfile(paths, renderAuthfile(creds), exec);
    const reload = await reloadChiselAuth(exec, logger);
    return {
      removed: true,
      restartOk: reload.ok,
      ...(reload.ok ? {} : { restartError: reload.error }),
    };
  });
}

/**
 * Look up an agent's chisel credential. Returns null if missing.
 */
export async function getChiselCredential(
  label: string,
  paths: ChiselPaths,
): Promise<{ user: string; password: string } | null> {
  assertSafeLabel(label);
  const creds = await loadChiselCredentials(paths);
  const entry = creds[label];
  if (!entry || !entry.password) return null;
  return {
    user: `${CHISEL_USER_PREFIX}${label}`,
    password: entry.password,
  };
}

/**
 * Rotate an existing agent's chisel credential. If the agent has no existing
 * credential, behaves identically to `addChiselCredential`.
 */
export function rotateChiselCredential(
  label: string,
  paths: ChiselPaths,
  exec: ExecFn,
  logger?: ChiselLogger,
): Promise<ChiselCredentialResult> {
  return addChiselCredential(label, paths, exec, logger);
}

/**
 * One-shot migration helper: if the authfile or credentials file is missing
 * on disk but the agent registry has entries, regenerate credentials for
 * every active (non-revoked) agent. New passwords are minted — existing
 * agents must fetch their new credential after upgrade.
 */
export function migrateChiselCredentialsIfNeeded(
  loadAgentRegistry: () => Promise<AgentRegistrySnapshot>,
  paths: ChiselPaths,
  exec: ExecFn,
  logger: ChiselLogger,
): Promise<MigrationResult> {
  return writeMutex.run(paths.credentialsFile, async () => {
    const authfileExists = await fileExists(paths.authFilePath);
    const credsExist = await fileExists(paths.credentialsFile);

    if (authfileExists && credsExist) {
      return { migrated: false, agentCount: 0 };
    }

    const registry = await loadAgentRegistry();
    const activeLabels = (registry?.agents ?? [])
      .filter(
        (a): a is { label: string; revoked?: boolean } =>
          Boolean(a) && !a.revoked && typeof a.label === 'string' && LABEL_REGEX.test(a.label),
      )
      .map((a) => a.label);

    const existing = credsExist ? await loadChiselCredentials(paths) : {};
    const next: ChiselCredentialStore = { ...existing };

    let mintedCount = 0;
    for (const label of activeLabels) {
      if (next[label]?.password) continue;
      const password = crypto.randomBytes(24).toString('hex');
      next[label] = { password, createdAt: new Date().toISOString() };
      mintedCount++;
    }

    await saveChiselCredentials(paths, next);
    await writeAuthfile(paths, renderAuthfile(next), exec);

    if (mintedCount > 0) {
      logger.warn(
        { mintedCount, totalAgents: activeLabels.length },
        'Chisel credential migration: minted new per-agent passwords. ' +
          'Existing agents must run `lamaste-agent chisel refresh-credential` ' +
          'before their tunnels will reconnect.',
      );
    } else if (!authfileExists) {
      logger.info(
        { totalAgents: activeLabels.length },
        'Chisel authfile missing but credentials present — regenerated authfile',
      );
    }

    await reloadChiselAuth(exec, logger);

    return { migrated: true, agentCount: activeLabels.length };
  });
}
