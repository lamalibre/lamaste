/**
 * Chisel auth-file credential management.
 *
 * The chisel server runs with `--authfile <AUTHFILE_PATH>` to authenticate
 * connecting agents. Each agent gets a per-agent password stored alongside
 * in `chisel-credentials.json`. The two files are kept in sync:
 *   - `chisel-credentials.json` is the source of truth (agents fetch via REST)
 *   - `chisel-users` is rendered from it for the chisel process
 *
 * The authfile also carries each agent's *grants*: the exact reverse
 * remotes (`R:127.0.0.1:<port>`) of the enabled tunnels that agent owns.
 * Authentication alone is not authorization — without grants any enrolled
 * agent could bind any tunnel's port and take over its hostname. The
 * authfile is therefore a function of two persisted inputs, the credential
 * store and the tunnel state, and is re-rendered whenever either changes.
 *
 * Concurrency: a promise-chain mutex (keyed by credentials file) serializes
 * every authfile render so concurrent enroll/revoke/tunnel changes cannot
 * interleave writes.
 *
 * Live reload: chisel (>= 1.12.0) watches the authfile's directory and
 * reloads it on every atomic replace. A reload applies to new sessions only —
 * a reverse remote an agent already holds keeps its listener until the
 * session ends. So a change that only *adds* (a new agent, a new grant) takes
 * effect by rewriting the file, while a change that *takes away* (a removed
 * or rotated password, a withdrawn grant) must also restart chisel. Every
 * function here reports that distinction as `revoked`; the caller owns the
 * restart decision.
 *
 * Permissions: the authfile holds every agent's password. It is written
 * 0640, owned by the daemon user, group {@link CHISEL_AUTHFILE_GROUP} — the
 * group the chisel server runs as — so chisel can read it and no one else
 * can. The temp file is created 0600 in the same directory and receives its
 * group and mode before the rename, so the file chisel's watcher sees never
 * has the wrong permissions.
 */

import crypto from 'node:crypto';
import { access, chmod, constants, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { AGENT_LABEL_REGEX, RESERVED_TUNNEL_PORTS } from '../constants.js';
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

/**
 * The group the chisel server process runs as, and the group of the authfile.
 * Created by the server provisioner; the daemon user is a member, which is
 * what lets it hand the file to this group without privileges.
 */
export const CHISEL_AUTHFILE_GROUP = 'lamaste-chisel';

export interface ChiselPaths {
  /** Path to the chisel-credentials.json registry (0600, owned by daemon user). */
  readonly credentialsFile: string;
  /** Path to the rendered chisel-users authfile (0640, group {@link CHISEL_AUTHFILE_GROUP}). */
  readonly authFilePath: string;
  /** Path to the no-grants sentinel password (0600, owned by daemon user). */
  readonly sentinelFile: string;
}

/**
 * What an authfile write changed. `changed`: the file on disk was replaced.
 * `revoked`: the new file takes something away (a user, a password, a
 * grant) that a live chisel session may still hold — chisel must be
 * restarted for it to take effect.
 */
export interface AuthfileChange {
  readonly changed: boolean;
  readonly revoked: boolean;
}

export interface ChiselCredentialResult extends AuthfileChange {
  readonly user: string;
  readonly password: string;
  /** When this password was issued (ISO 8601). Not secret. */
  readonly createdAt: string;
}

export interface RemoveCredentialResult extends AuthfileChange {
  readonly removed: boolean;
}

export interface MigrationResult extends AuthfileChange {
  readonly migrated: boolean;
  readonly agentCount: number;
}

/** The fields of a tunnel entry that decide chisel grants. */
export interface ChiselGrantTunnel {
  readonly port: number;
  readonly agentLabel?: string | undefined;
  readonly enabled?: boolean | undefined;
}

/** Reads the persisted tunnel state the grants are rendered from. */
export type LoadGrantTunnels = () => Promise<readonly ChiselGrantTunnel[]>;

export interface AgentRegistrySnapshot {
  readonly agents: ReadonlyArray<{ readonly label: string; readonly revoked?: boolean }>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CHISEL_USER_PREFIX = 'agent-';

/**
 * A chisel user that exists only so the authfile is never empty.
 *
 * Chisel disables authentication outright when its authfile holds no users:
 * every client is accepted and may reverse-bind any free port. A fresh server
 * before its first enrollment, or one whose agents are all revoked, would be
 * an open relay. This user keeps chisel in authenticating mode. Its password
 * is random, persisted, never handed out, and it is granted no remote. The
 * name cannot collide with an agent user, which always carries the `agent-`
 * prefix.
 */
const SENTINEL_USER = 'lamaste-no-grants';

function assertSafeLabel(label: string): void {
  if (typeof label !== 'string' || !AGENT_LABEL_REGEX.test(label)) {
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
export async function loadChiselCredentials(paths: ChiselPaths): Promise<ChiselCredentialStore> {
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

/**
 * Map each agent label to the sorted, de-duplicated ports it may bind: the
 * enabled tunnels it owns. Ownerless and disabled tunnels grant nothing.
 *
 * Two further rules make the grants safe regardless of how the state file
 * came to be: a reserved port ({@link RESERVED_TUNNEL_PORTS}) is never
 * granted, and a port that more than one tunnel entry claims is granted to
 * no one — one hostname must never be answerable by two machines, and the
 * state that produced the duplicate cannot say which one is right.
 */
export function chiselGrants(tunnels: readonly ChiselGrantTunnel[]): Map<string, number[]> {
  const claims = new Map<number, number>();
  for (const t of tunnels) claims.set(t.port, (claims.get(t.port) ?? 0) + 1);

  const grants = new Map<string, Set<number>>();
  for (const t of tunnels) {
    if (t.enabled === false || !t.agentLabel) continue;
    if (!Number.isInteger(t.port) || t.port < 1024 || t.port > 65535) continue;
    if (RESERVED_TUNNEL_PORTS.includes(t.port)) continue;
    if ((claims.get(t.port) ?? 0) > 1) continue;
    const set = grants.get(t.agentLabel) ?? new Set<number>();
    set.add(t.port);
    grants.set(t.agentLabel, set);
  }
  const out = new Map<string, number[]>();
  for (const [label, ports] of grants) {
    out.set(
      label,
      [...ports].sort((a, b) => a - b),
    );
  }
  return out;
}

/**
 * The tunnels of `tunnels` that chisel actually lets agent `label` bind: the
 * enabled tunnels it owns, minus any {@link chiselGrants} withholds. The
 * agent-config endpoint hands an agent exactly these — asking chisel for a
 * single port it does not grant would get the agent's whole session refused.
 */
export function grantedTunnelsFor<T extends ChiselGrantTunnel>(
  tunnels: readonly T[],
  label: string,
): T[] {
  const ports = new Set(chiselGrants(tunnels).get(label) ?? []);
  return tunnels.filter((t) => t.enabled !== false && t.agentLabel === label && ports.has(t.port));
}

/**
 * Enabled, owned tunnels that {@link chiselGrants} withholds — a reserved or
 * privileged port, or a port claimed twice (only possible in state written
 * before these checks). They are carried by no one until fixed.
 */
export function withheldTunnels<T extends ChiselGrantTunnel>(tunnels: readonly T[]): T[] {
  const grants = chiselGrants(tunnels);
  return tunnels.filter(
    (t) =>
      t.enabled !== false &&
      Boolean(t.agentLabel) &&
      !(grants.get(t.agentLabel as string) ?? []).includes(t.port),
  );
}

/**
 * The chisel address pattern for one reverse remote. Chisel matches the
 * pattern against `R:<server-bind-host>:<server-bind-port>` with an
 * unanchored `regexp.MatchString`, so the anchors are what keep port 2001
 * from also granting 20010.
 */
function reverseRemotePattern(port: number): string {
  return `^R:127\\.0\\.0\\.1:${port}$`;
}

export function renderAuthfile(
  creds: ChiselCredentialStore,
  grants: ReadonlyMap<string, readonly number[]>,
  sentinelPassword: string,
): string {
  assertSafePassword(sentinelPassword);
  // Chisel's --authfile expects a JSON object of `"<user>:<pass>": [<addr-regex>, ...]`.
  // The sentinel user (see SENTINEL_USER) keeps the object non-empty, which is
  // what keeps chisel authenticating before the first enrollment.
  //
  // An agent that owns no enabled tunnel gets an empty list: it can still
  // authenticate (so its client stays connected and picks up a grant on the
  // next sync) but chisel refuses every remote it asks for. Never `""`, `"*"`
  // or `".*"` — chisel treats those as allow-all.
  const entries: Record<string, readonly string[]> = {
    [`${SENTINEL_USER}:${sentinelPassword}`]: [],
  };
  const labels = Object.keys(creds).sort();
  for (const label of labels) {
    const entry = creds[label];
    if (!entry || !entry.password) continue;
    const ports = grants.get(label) ?? [];
    entries[`${CHISEL_USER_PREFIX}${label}:${entry.password}`] = ports.map(reverseRemotePattern);
  }
  return JSON.stringify(entries, null, 2) + '\n';
}

/**
 * Read the sentinel password, minting and persisting it on first use.
 * Call only while holding the credentials mutex.
 */
async function ensureSentinelPassword(paths: ChiselPaths): Promise<string> {
  try {
    const existing = (await readFile(paths.sentinelFile, 'utf-8')).trim();
    assertSafePassword(existing);
    return existing;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read chisel sentinel: ${message}`);
    }
  }
  const password = crypto.randomBytes(24).toString('hex');
  const tmpPath = `${paths.sentinelFile}.tmp`;
  await writeFile(tmpPath, password + '\n', { encoding: 'utf-8', mode: 0o600 });
  const fd = await open(tmpPath, 'r');
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
  await rename(tmpPath, paths.sentinelFile);
  return password;
}

async function renderFromState(
  paths: ChiselPaths,
  creds: ChiselCredentialStore,
  loadTunnels: LoadGrantTunnels,
): Promise<string> {
  const sentinel = await ensureSentinelPassword(paths);
  return renderAuthfile(creds, chiselGrants(await loadTunnels()), sentinel);
}

/**
 * Write the authfile atomically with its final ownership and mode: a 0600 temp
 * file in the authfile's own directory, handed to the chisel group, made
 * 0640, fsynced, then renamed over the old file. No privileges are needed —
 * the daemon user owns the directory and belongs to the chisel group.
 */
async function writeAuthfile(paths: ChiselPaths, content: string, exec: ExecFn): Promise<void> {
  const tmpFile = `${paths.authFilePath}.tmp-${crypto.randomBytes(8).toString('hex')}`;
  try {
    await writeFile(tmpFile, content, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
    await exec('chgrp', [CHISEL_AUTHFILE_GROUP, tmpFile]);
    await chmod(tmpFile, 0o640);
    const fd = await open(tmpFile, 'r');
    try {
      await fd.sync();
    } finally {
      await fd.close();
    }
    await rename(tmpFile, paths.authFilePath);
  } catch (err: unknown) {
    await rm(tmpFile, { force: true }).catch(() => undefined);
    const stderr = (err as ExecError).stderr;
    const message = stderr || (err instanceof Error ? err.message : String(err));
    throw new Error(`Failed to write chisel authfile: ${message}`);
  }
}

/** `user -> { password, patterns }` as chisel would load it, or null if unparsable. */
function parseAuthfile(
  content: string,
): Map<string, { password: string; patterns: Set<string> }> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const users = new Map<string, { password: string; patterns: Set<string> }>();
  for (const [auth, patterns] of Object.entries(raw as Record<string, unknown>)) {
    const colon = auth.indexOf(':');
    if (colon <= 0 || !Array.isArray(patterns)) return null;
    users.set(auth.slice(0, colon), {
      password: auth.slice(colon + 1),
      patterns: new Set(patterns.map(String)),
    });
  }
  return users;
}

/**
 * True when `next` takes away anything `previous` allowed: a user, a
 * password, or an address pattern. An unreadable previous file counts as a
 * revocation, since what live sessions hold cannot be known.
 */
export function authfileRevokes(previous: string | null, next: string): boolean {
  if (previous === null) return false;
  const before = parseAuthfile(previous);
  const after = parseAuthfile(next);
  if (!before || !after) return true;
  for (const [user, entry] of before) {
    const now = after.get(user);
    if (!now || now.password !== entry.password) return true;
    for (const pattern of entry.patterns) {
      if (!now.patterns.has(pattern)) return true;
    }
  }
  return false;
}

async function readAuthfile(paths: ChiselPaths): Promise<string | null> {
  try {
    return await readFile(paths.authFilePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Render from state, write only if it differs (or `force`), and classify the
 * change. `force` rewrites identical content too, which re-applies the
 * file's ownership and mode — used at startup so an authfile left by an
 * older version (0644, world-readable) is corrected even when its content
 * is current.
 */
async function renderAndWrite(
  paths: ChiselPaths,
  creds: ChiselCredentialStore,
  loadTunnels: LoadGrantTunnels,
  exec: ExecFn,
  force = false,
): Promise<AuthfileChange> {
  const content = await renderFromState(paths, creds, loadTunnels);
  const current = await readAuthfile(paths);
  if (current === content && !force) return { changed: false, revoked: false };
  const revoked = authfileRevokes(current, content);
  await writeAuthfile(paths, content, exec);
  return { changed: true, revoked };
}

// ---------------------------------------------------------------------------
// Chisel service restart
// ---------------------------------------------------------------------------

/**
 * Restart chisel if — and only if — it is running, so live sessions drop what
 * the authfile no longer allows. `try-restart` never starts a stopped chisel:
 * a server that stopped chisel on purpose (see the daemon's fail-closed
 * startup) stays stopped until its own reconciliation starts it.
 */
export async function reloadChiselAuth(
  exec: ExecFn,
  logger?: ChiselLogger,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await exec('sudo', ['systemctl', 'try-restart', 'chisel']);
    return { ok: true };
  } catch (err: unknown) {
    const stderr = (err as ExecError).stderr;
    const message = stderr || (err instanceof Error ? err.message : String(err));
    if (logger) {
      logger.warn(
        { err: message },
        'Failed to restart chisel after an authfile change that revokes access — ' +
          'live sessions keep what was revoked until chisel restarts',
      );
    }
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a fresh chisel password for an agent, persist it, and re-render
 * the authfile. Replacing an existing password is a revocation (the old one
 * may be in use); adding a new agent is not.
 */
export function addChiselCredential(
  label: string,
  paths: ChiselPaths,
  loadTunnels: LoadGrantTunnels,
  exec: ExecFn,
): Promise<ChiselCredentialResult> {
  assertSafeLabel(label);
  return writeMutex.run(paths.credentialsFile, async () => {
    const creds = await loadChiselCredentials(paths);
    const password = crypto.randomBytes(24).toString('hex');
    assertSafePassword(password);
    const createdAt = new Date().toISOString();
    creds[label] = { password, createdAt };
    await saveChiselCredentials(paths, creds);
    const change = await renderAndWrite(paths, creds, loadTunnels, exec);
    return {
      user: `${CHISEL_USER_PREFIX}${label}`,
      password,
      createdAt,
      ...change,
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
  loadTunnels: LoadGrantTunnels,
  exec: ExecFn,
): Promise<RemoveCredentialResult> {
  assertSafeLabel(label);
  return writeMutex.run(paths.credentialsFile, async () => {
    const creds = await loadChiselCredentials(paths);
    const existed = Object.prototype.hasOwnProperty.call(creds, label);
    if (!existed) {
      return { removed: false, changed: false, revoked: false };
    }
    delete creds[label];
    await saveChiselCredentials(paths, creds);
    const change = await renderAndWrite(paths, creds, loadTunnels, exec);
    return { removed: true, ...change };
  });
}

/**
 * Look up an agent's chisel credential. Returns null if missing.
 */
export async function getChiselCredential(
  label: string,
  paths: ChiselPaths,
): Promise<{ user: string; password: string; createdAt: string | null } | null> {
  assertSafeLabel(label);
  const creds = await loadChiselCredentials(paths);
  const entry = creds[label];
  if (!entry || !entry.password) return null;
  return {
    user: `${CHISEL_USER_PREFIX}${label}`,
    password: entry.password,
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : null,
  };
}

/**
 * When an agent's current chisel password was issued, or null if it has
 * none. Not secret: agents compare it with the credential they hold to learn
 * that it was rotated.
 */
export async function getChiselCredentialIssuedAt(
  label: string,
  paths: ChiselPaths,
): Promise<string | null> {
  const credential = await getChiselCredential(label, paths);
  return credential?.createdAt ?? null;
}

/**
 * Rotate an existing agent's chisel credential. If the agent has no existing
 * credential, behaves identically to `addChiselCredential`.
 */
export function rotateChiselCredential(
  label: string,
  paths: ChiselPaths,
  loadTunnels: LoadGrantTunnels,
  exec: ExecFn,
): Promise<ChiselCredentialResult> {
  return addChiselCredential(label, paths, loadTunnels, exec);
}

/**
 * Re-render the authfile from the credential store and the persisted tunnel
 * state, without touching credentials. Skips the write when the rendered
 * content is already on disk. Does not restart chisel — the caller restarts
 * it when the result says `revoked`.
 */
export function syncChiselAuthfile(
  paths: ChiselPaths,
  loadTunnels: LoadGrantTunnels,
  exec: ExecFn,
  options: { readonly force?: boolean } = {},
): Promise<AuthfileChange> {
  return writeMutex.run(paths.credentialsFile, async () => {
    const creds = await loadChiselCredentials(paths);
    return renderAndWrite(paths, creds, loadTunnels, exec, options.force === true);
  });
}

/**
 * Mint a chisel credential for every active (non-revoked) agent that has
 * none, then re-render the authfile. Covers a fresh install (no credential
 * store yet) and an upgrade from a version that ran chisel without auth.
 * Agents that receive a newly minted password must fetch it before their
 * tunnels reconnect; `lamaste-agent sync` does so on its own.
 */
export function migrateChiselCredentialsIfNeeded(
  loadAgentRegistry: () => Promise<AgentRegistrySnapshot>,
  paths: ChiselPaths,
  loadTunnels: LoadGrantTunnels,
  exec: ExecFn,
  logger: ChiselLogger,
): Promise<MigrationResult> {
  return writeMutex.run(paths.credentialsFile, async () => {
    const registry = await loadAgentRegistry();
    const activeLabels = (registry?.agents ?? [])
      .filter(
        (a): a is { label: string; revoked?: boolean } =>
          Boolean(a) &&
          !a.revoked &&
          typeof a.label === 'string' &&
          AGENT_LABEL_REGEX.test(a.label),
      )
      .map((a) => a.label);

    const credsExist = await fileExists(paths.credentialsFile);
    const existing = credsExist ? await loadChiselCredentials(paths) : {};
    const next: ChiselCredentialStore = { ...existing };

    let mintedCount = 0;
    for (const label of activeLabels) {
      if (next[label]?.password) continue;
      const password = crypto.randomBytes(24).toString('hex');
      next[label] = { password, createdAt: new Date().toISOString() };
      mintedCount++;
    }

    if (mintedCount > 0 || !credsExist) {
      await saveChiselCredentials(paths, next);
    }
    const change = await renderAndWrite(paths, next, loadTunnels, exec);

    if (mintedCount > 0) {
      logger.warn(
        { mintedCount, totalAgents: activeLabels.length },
        'Chisel credential migration: minted new per-agent passwords. ' +
          'Agents fetch them on their next `lamaste-agent sync`.',
      );
    }

    return {
      migrated: mintedCount > 0 || !credsExist,
      agentCount: activeLabels.length,
      ...change,
    };
  });
}
