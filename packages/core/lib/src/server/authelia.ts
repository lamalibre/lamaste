/**
 * Authelia configuration management — config, users, service control,
 * access-control sync, TOTP helpers.
 *
 * create-lamaste installs Authelia (the pinned release), its unit, and the
 * account it runs as (`lamaste-authelia`, unprivileged). /etc/authelia is
 * owned by the lamaste user with group lamaste-authelia, so the panel writes
 * Authelia's configuration and users file directly, without privileges;
 * Authelia reads them through its group. Only storing a TOTP secret needs
 * another identity — Authelia's database is its own file — and goes through
 * the root helper `lamaste-priv`, which runs Authelia's CLI as its account.
 *
 * Pure logic: all process spawning goes through an injected `exec` function.
 * `bcryptHash` is also injected so the core library does not take a runtime
 * dependency on bcryptjs.
 *
 * The daemon provides both; callers may swap in test doubles.
 */

import crypto from 'node:crypto';
import {
  access,
  chmod,
  constants,
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { canonicalJson } from '../app-job-signature.js';
import { AUTHELIA_SESSION_COOKIE } from '../authelia-session.js';
import { isOidcClientId } from '../constants.js';
import { assertDomainName, domainOfHost } from '../domains.js';
import { externalGroup, memberGroup, oidcClientGroup, siteGroup } from '../owned-groups.js';
import type { OidcClientDeclaration } from '../schemas.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AUTHELIA_BIN = '/usr/local/bin/authelia';
export const AUTHELIA_SERVICE = 'authelia';
export const AUTHELIA_CONFIG_DIR = '/etc/authelia';
export const AUTHELIA_CONFIG = path.join(AUTHELIA_CONFIG_DIR, 'configuration.yml');
export const AUTHELIA_USERS = path.join(AUTHELIA_CONFIG_DIR, 'users.yml');
export const AUTHELIA_SECRETS = path.join(AUTHELIA_CONFIG_DIR, '.secrets.json');
export const AUTHELIA_LOG_DIR = '/var/log/authelia';
/**
 * `server.asset_path`: the one directory Authelia serves overridable assets
 * from (`/favicon.ico`, `/static/media/logo.png`, `/locales/...` — see
 * `auth-branding.ts`). Per-domain overrides happen in nginx; this holds
 * only the placeholder logo, whose existence when Authelia starts switches
 * the portal's logo slot on (`data-logooverride="true"`).
 */
export const AUTHELIA_ASSET_PATH = path.join(AUTHELIA_CONFIG_DIR, 'assets');
/** The placeholder logo (Lamaste's own) in {@link AUTHELIA_ASSET_PATH}. */
export const AUTHELIA_ASSET_LOGO = path.join(AUTHELIA_ASSET_PATH, 'logo.png');
/** The theme written explicitly, so the index HTML carries a known `data-theme` nginx can replace per domain. */
export const AUTHELIA_THEME_DEFAULT = 'light';
/** Lamaste's logo, shipped with this package, written as the placeholder. */
const LAMASTE_LOGO_ASSET = fileURLToPath(new URL('../../assets/lamaste-logo.png', import.meta.url));

/** The root helper that runs Authelia's CLI as its own account (see lamaste-priv). */
const PRIV = '/usr/local/sbin/lamaste-priv';

// ---------------------------------------------------------------------------
// Dependency interfaces
// ---------------------------------------------------------------------------

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode?: number;
}

export interface ExecError extends Error {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
}

export interface ExecFn {
  (
    file: string,
    args: string[],
    options?: { reject?: boolean; timeout?: number; input?: string },
  ): Promise<ExecResult>;
}

/**
 * bcrypt hash function. The daemon implementation wraps bcryptjs.
 */
export type BcryptHashFn = (password: string, cost: number) => Promise<string>;

function isExecError(err: unknown): err is ExecError {
  return err instanceof Error;
}

function errText(err: unknown): string {
  if (!isExecError(err)) return String(err);
  return err.stderr || err.message;
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
// Types
// ---------------------------------------------------------------------------

export interface AutheliaSecrets {
  readonly jwtSecret: string;
  readonly sessionSecret: string;
  readonly storageEncryptionKey: string;
}

export interface AutheliaUser {
  readonly username: string;
  readonly displayname: string;
  readonly email: string;
  readonly groups: string[];
  /** Authelia's `disabled: true` — the user cannot sign in. */
  readonly disabled: boolean;
}

export interface UsersYamlEntry {
  displayname?: string;
  email?: string;
  password?: string;
  groups?: string[];
  /** Authelia refuses to sign in a user marked `disabled: true`; absent means enabled. */
  disabled?: boolean;
  [k: string]: unknown;
}

export interface UsersYamlFile {
  users: Record<string, UsersYamlEntry>;
}

export interface ProtectedSiteRule {
  /** The site's id — its group (`lamaste:s:<id>`) names the users it lists. */
  readonly id?: string;
  readonly fqdn: string;
  readonly autheliaProtected: boolean;
  readonly allowedUsers?: string[];
  readonly restrictAccess?: boolean;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/**
 * Atomically replace a file in /etc/authelia (temp file, fsync, rename). The
 * directory is setgid lamaste-authelia, so the new file belongs to that
 * group; `mode` decides whether Authelia can read (0640) or also rewrite
 * (0660) it, or not see it at all (0600).
 */
async function writeAutheliaFile(
  destPath: string,
  content: string | Uint8Array,
  mode: number,
): Promise<void> {
  const tmpFile = path.join(
    path.dirname(destPath),
    `.${path.basename(destPath)}.${crypto.randomBytes(8).toString('hex')}`,
  );
  try {
    const fh = await open(tmpFile, 'wx', 0o600);
    try {
      await fh.writeFile(content);
      await fh.chmod(mode);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmpFile, destPath);
  } catch (err: unknown) {
    await rm(tmpFile, { force: true }).catch(() => undefined);
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      throw new Error(
        `${AUTHELIA_CONFIG_DIR} is not writable by the panel — run create-lamaste to repair the installation`,
      );
    }
    throw err;
  }
}

/** True once create-lamaste has installed Authelia. */
export async function isAutheliaInstalled(): Promise<boolean> {
  return fileExists(AUTHELIA_BIN);
}

// ---------------------------------------------------------------------------
// Config file
// ---------------------------------------------------------------------------

/**
 * Write the Authelia configuration file. `groupKey` is the domain's group
 * key (owned-groups.ts) when its record exists — the rules then admit its
 * members as users.yml's groups say; without one the configuration admits
 * no one until the panel renders the domain (updateDomainAccess).
 */
export async function writeAutheliaConfig(
  domain: string,
  secrets: AutheliaSecrets,
  options: {
    readonly groupKey?: string;
    /** Where to write (Authelia's files unless a test names others). */
    readonly configPath?: string;
    readonly secretsPath?: string;
  } & AutheliaAssetsOptions = {},
): Promise<string> {
  const { jwtSecret, sessionSecret, storageEncryptionKey } = secrets;
  const configPath = options.configPath ?? AUTHELIA_CONFIG;
  const secretsPath = options.secretsPath ?? AUTHELIA_SECRETS;

  // The placeholder logo exists before Authelia first starts: the logo
  // slot is switched on at its start (auth-branding.ts).
  await ensureAutheliaAssets({
    ...(options.assetDir !== undefined ? { assetDir: options.assetDir } : {}),
    ...(options.logoSource !== undefined ? { logoSource: options.logoSource } : {}),
  });

  const configContent = dumpAutheliaConfig({
    // `theme` and `server.asset_path` as the branded sign-in needs them
    // (ensureAutheliaBrandingConfig; every rewrite keeps them).
    theme: AUTHELIA_THEME_DEFAULT,
    server: {
      address: 'tcp://127.0.0.1:9091/',
      asset_path: AUTHELIA_ASSET_PATH,
    },
    log: {
      level: 'info',
      file_path: path.join(AUTHELIA_LOG_DIR, 'authelia.log'),
    },
    identity_validation: {
      reset_password: {
        jwt_secret: jwtSecret,
      },
    },
    authentication_backend: {
      ...LAMASTE_USERS_FILE_SETTINGS,
      file: {
        path: AUTHELIA_USERS,
        watch: true,
        password: {
          algorithm: 'bcrypt',
          bcrypt: {
            cost: 12,
          },
        },
      },
    },
    // The primary domain's rules: who they admit is users.yml's groups
    // (owned-groups.ts) — the panel renders every later change
    // (updateDomainAccess).
    access_control: options.groupKey
      ? renderGroupAccessControl([{ name: domain, groupKey: options.groupKey }], [])
      : { default_policy: 'deny', rules: [] },
    session: {
      // Authelia's default cookie name, from the one constant everything
      // that reads or strips it uses: Gatekeeper reads the session from it
      // alone, and the nginx map create-lamaste installs removes it from
      // every request a tunnel or agent backend receives
      // (`authelia-session.ts`). The e2e cookie-jar fixtures write it too.
      name: AUTHELIA_SESSION_COOKIE,
      secret: sessionSecret,
      cookies: renderSessionCookies([domain]),
      expiration: '12h',
      inactivity: '2h',
    },
    regulation: {
      max_retries: 5,
      find_time: '2m',
      ban_time: '5m',
    },
    storage: {
      encryption_key: storageEncryptionKey,
      local: {
        path: path.join(AUTHELIA_CONFIG_DIR, 'db.sqlite3'),
      },
    },
    notifier: {
      filesystem: {
        filename: path.join(AUTHELIA_CONFIG_DIR, 'notifications.txt'),
      },
    },
    totp: {
      issuer: 'Lamaste',
      period: 30,
      digits: 6,
    },
  });

  try {
    await writeAutheliaFile(configPath, configContent, 0o640);
  } catch (err: unknown) {
    throw new Error(`Failed to write Authelia configuration: ${errText(err)}`);
  }

  // The panel's own record of the secrets (Authelia reads them from its
  // configuration): readable by lamaste only.
  const secretsContent =
    JSON.stringify({ jwtSecret, sessionSecret, storageEncryptionKey }, null, 2) + '\n';
  try {
    await writeAutheliaFile(secretsPath, secretsContent, 0o600);
  } catch (err: unknown) {
    throw new Error(`Failed to write Authelia secrets file: ${errText(err)}`);
  }

  return configPath;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * Create a default Authelia user with a bcrypt-hashed password, added to
 * the `admins` group. `usersFile` is Authelia's users file unless a caller
 * names another (the daemon's tests).
 */
export async function createUser(
  username: string,
  password: string,
  bcryptHash: BcryptHashFn,
  usersFile: string = AUTHELIA_USERS,
): Promise<{ username: string; created: true }> {
  const hash = await bcryptHash(password, 12);

  if (!hash || !hash.startsWith('$2')) {
    throw new Error(`Bcrypt hashing produced invalid output: ${hash}`);
  }

  const usersData = await readUsersForWrite(usersFile);

  usersData.users[username] = {
    displayname: username,
    password: hash,
    email: `${username}@lamaste.local`,
    groups: ['admins'],
  };

  await writeUsers(usersData, usersFile);

  return { username, created: true };
}

/**
 * Read the Authelia users file and return user info (without password
 * hashes): `disabled` is true only for Authelia's `disabled: true`.
 */
export async function readUsers(usersFile: string = AUTHELIA_USERS): Promise<AutheliaUser[]> {
  try {
    const parsed = yaml.load(await readFile(usersFile, 'utf-8')) as UsersYamlFile | null;

    if (!parsed || !parsed.users) {
      return [];
    }

    return Object.entries(parsed.users).map(([username, data]) => ({
      username,
      displayname: data.displayname || username,
      email: data.email || '',
      groups: data.groups || [],
      disabled: data.disabled === true,
    }));
  } catch {
    return [];
  }
}

/**
 * Atomically write the Authelia users YAML file.
 */
export async function writeUsers(
  usersData: UsersYamlFile,
  usersFile: string = AUTHELIA_USERS,
): Promise<void> {
  const yamlContent = yaml.dump(usersData, { lineWidth: -1 });

  try {
    // 0660: Authelia rewrites the file in place when a user changes a password.
    await writeAutheliaFile(usersFile, yamlContent, 0o660);
  } catch (err: unknown) {
    throw new Error(`Failed to write Authelia users file: ${errText(err)}`);
  }
}

/**
 * Why the users file could not be read, without its content: a YAML
 * parser's message quotes the lines around the fault (usernames, password
 * hashes).
 */
function usersFileFault(err: unknown): string {
  const e = err as { name?: unknown; code?: unknown; mark?: { line?: unknown } };
  if (e?.name === 'YAMLException') {
    return typeof e.mark?.line === 'number'
      ? `not valid YAML at line ${e.mark.line + 1}`
      : 'not valid YAML';
  }
  return typeof e?.code === 'string' ? e.code : 'unreadable';
}

/**
 * Read the raw users.yml data, returning the full object including password
 * hashes. Used by CRUD operations that need to modify and re-write the file.
 * Throws when the file cannot be read or parsed.
 */
export async function readUsersRaw(usersFile: string = AUTHELIA_USERS): Promise<UsersYamlFile> {
  const parsed = yaml.load(await readFile(usersFile, 'utf-8')) as UsersYamlFile | null;
  if (!parsed || !parsed.users) {
    return { users: {} };
  }
  return parsed;
}

/**
 * The users file for a read-modify-write: a missing or empty file starts
 * fresh; one that cannot be read or parsed is refused — writing over it
 * would drop every user it holds.
 */
async function readUsersForWrite(usersFile: string): Promise<UsersYamlFile> {
  try {
    return await readUsersRaw(usersFile);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`Failed to read Authelia users file: ${usersFileFault(err)}`);
    }
    return { users: {} };
  }
}

/**
 * Hash a password with bcrypt cost factor 12 via the injected bcrypt hasher.
 */
export function hashPassword(password: string, bcryptHash: BcryptHashFn): Promise<string> {
  return bcryptHash(password, 12);
}

// ---------------------------------------------------------------------------
// systemd service
// ---------------------------------------------------------------------------

/** Authelia's health endpoint on loopback: 200 once it serves requests. */
const AUTHELIA_HEALTH_URL = 'http://127.0.0.1:9091/api/health';

/** How long a start or restart may take to serve requests. */
const AUTHELIA_READY_TIMEOUT_MS = 30_000;

/**
 * How long a rollback's restart may take: a configuration that stays broken
 * must not hold the caller (the domains' rendering lock) for a second full
 * wait.
 */
const AUTHELIA_ROLLBACK_READY_TIMEOUT_MS = 10_000;

/** True when systemd reports Authelia's unit failed (it gave up starting). */
async function autheliaFailed(exec: ExecFn): Promise<boolean> {
  try {
    const { stdout } = await exec('systemctl', ['is-failed', AUTHELIA_SERVICE]);
    return stdout.trim() === 'failed';
  } catch {
    // non-zero when the unit is not failed
    return false;
  }
}

/**
 * Wait until Authelia serves requests: its health endpoint answers 200.
 * `systemctl start|restart` returns as soon as the process is spawned — the
 * listener comes a moment later — so a caller that talks to Authelia right
 * after a restart (the registry credential's token request, a sign-in) would
 * otherwise race it. Stops early when systemd reports the unit failed.
 * Exported for tests; `startAuthelia` and `reloadAuthelia` wait with it.
 */
export async function autheliaReady(
  exec: ExecFn,
  {
    timeoutMs = AUTHELIA_READY_TIMEOUT_MS,
    intervalMs = 250,
    fetchImpl = globalThis.fetch,
  }: {
    readonly timeoutMs?: number;
    readonly intervalMs?: number;
    readonly fetchImpl?: (
      url: string,
      init?: { signal?: AbortSignal },
    ) => Promise<{ status: number }>;
  } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetchImpl(AUTHELIA_HEALTH_URL, { signal: AbortSignal.timeout(2_000) });
      if (res.status === 200) return true;
    } catch {
      // not listening yet
    }
    if (Date.now() >= deadline || (await autheliaFailed(exec))) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** The last lines of Authelia's journal, for an error that says why it did not come up. */
async function autheliaJournal(exec: ExecFn): Promise<string> {
  try {
    const { stdout } = await exec('journalctl', ['-u', AUTHELIA_SERVICE, '--no-pager', '-n', '10']);
    return stdout;
  } catch {
    return 'Could not read journal logs';
  }
}

/**
 * Enable and start the Authelia systemd service, and wait until it serves
 * requests.
 */
export async function startAuthelia(exec: ExecFn): Promise<{ active: true }> {
  try {
    await exec('sudo', ['systemctl', 'enable', AUTHELIA_SERVICE]);
    await exec('sudo', ['systemctl', 'start', AUTHELIA_SERVICE]);
  } catch (err: unknown) {
    throw new Error(`Failed to start Authelia service: ${errText(err)}`);
  }

  if (await autheliaReady(exec)) return { active: true };
  throw new Error(
    `Authelia is not serving requests after starting (${(await isAutheliaRunning(exec)) ? 'running' : 'not running'}). ` +
      `Journal output:\n${await autheliaJournal(exec)}`,
  );
}

/** Restart Authelia and wait up to `timeoutMs` for it to serve requests. */
async function restartAuthelia(exec: ExecFn, timeoutMs: number): Promise<{ active: true }> {
  try {
    await exec('sudo', ['systemctl', 'restart', AUTHELIA_SERVICE]);
  } catch (err: unknown) {
    throw new Error(`Failed to restart Authelia service: ${errText(err)}`);
  }

  if (await autheliaReady(exec, { timeoutMs })) return { active: true };
  throw new Error(
    `Authelia is not serving requests after restart (${(await isAutheliaRunning(exec)) ? 'running' : 'not running'})`,
  );
}

/**
 * Restart the Authelia service, and wait until it serves requests again.
 */
export function reloadAuthelia(exec: ExecFn): Promise<{ active: true }> {
  return restartAuthelia(exec, AUTHELIA_READY_TIMEOUT_MS);
}

/**
 * Check whether the Authelia service is currently running.
 */
export async function isAutheliaRunning(exec: ExecFn): Promise<boolean> {
  try {
    const { stdout } = await exec('systemctl', ['is-active', AUTHELIA_SERVICE]);
    return stdout.trim() === 'active';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Access control sync
// ---------------------------------------------------------------------------

/**
 * How Authelia must hold users.yml for the groups Lamaste owns there to
 * decide who reaches what (packages/core/docs/external-members-design.md):
 *
 * - `file.watch: true` — a change is reloaded without a restart;
 * - `refresh_interval: always` — a session's groups are read again at
 *   every request (Authelia's default with `watch`, rendered so nothing
 *   else can stand in for it);
 * - password change and reset disabled — Authelia's own writes of the file
 *   come from its in-memory copy, which may be older than the panel's last
 *   write (a reload skipped in its cooldown), and would put revoked groups
 *   back. Neither can work on a relay anyway: its notifier is a file, so no
 *   user can verify themselves for either.
 */
const LAMASTE_USERS_FILE_SETTINGS = {
  refresh_interval: 'always',
  password_change: { disable: true },
  password_reset: { disable: true },
} as const;

/**
 * Hold users.yml as {@link LAMASTE_USERS_FILE_SETTINGS} says in a
 * configuration written before (watch on, refresh always, Authelia's
 * password change and reset off). Mutates `config`; every rewrite of the
 * configuration applies it. A configuration with another backend than the
 * file is left alone.
 */
export function ensureUsersFileWatched(config: Record<string, unknown>): void {
  const backend = config.authentication_backend as Record<string, unknown> | undefined;
  const file = backend?.file as Record<string, unknown> | undefined;
  if (!backend || !file) return;
  file.watch = true;
  backend.refresh_interval = LAMASTE_USERS_FILE_SETTINGS.refresh_interval;
  for (const key of ['password_change', 'password_reset'] as const) {
    const section = (backend[key] as Record<string, unknown> | undefined) ?? {};
    section.disable = true;
    backend[key] = section;
  }
}

/**
 * Whether a configuration holds users.yml as Lamaste needs
 * ({@link ensureUsersFileWatched}): only then does a change of the file
 * reach every session without a restart.
 */
export function usersFileWatched(config: Record<string, unknown>): boolean {
  const backend = config.authentication_backend as Record<string, unknown> | undefined;
  const file = backend?.file as Record<string, unknown> | undefined;
  if (!backend || !file) return true;
  const disabled = (key: string): boolean =>
    (backend[key] as { disable?: unknown } | undefined)?.disable === true;
  return (
    file.watch === true &&
    backend.refresh_interval === LAMASTE_USERS_FILE_SETTINGS.refresh_interval &&
    disabled('password_change') &&
    disabled('password_reset')
  );
}

/**
 * Whether Authelia's configuration file holds users.yml as Lamaste needs
 * ({@link usersFileWatched}) — false too when it cannot be read. Authelia
 * runs the configuration it last started with, and every rewrite restarts
 * it, so the file says what the running Authelia does.
 */
export async function autheliaWatchesUsersFile(): Promise<boolean> {
  const config = await loadAutheliaConfigFile().catch(() => null);
  return config !== null && usersFileWatched(config);
}

/**
 * Read `configuration.yml`, apply `mutate`, restore the secrets the panel
 * owns, write the result atomically with a backup, and restart Authelia —
 * rolling the file back if the restart fails. Every configuration update
 * (access control, OIDC provider) goes through here so the migration and
 * safety logic exists once.
 */
/**
 * Where a rewrite reads and writes (Authelia's files unless a test names
 * others) and how it restarts Authelia.
 */
export interface AutheliaRewriteOptions {
  readonly configPath?: string;
  readonly secretsPath?: string;
  /** Restart Authelia after the write (default: `reloadAuthelia(exec)`). */
  readonly restart?: (exec: ExecFn) => Promise<unknown>;
}

async function rewriteAutheliaConfig(
  mutate: (config: Record<string, unknown>) => void | Promise<void>,
  exec: ExecFn,
  {
    configPath = AUTHELIA_CONFIG,
    secretsPath = AUTHELIA_SECRETS,
    restart = reloadAuthelia,
  }: AutheliaRewriteOptions = {},
): Promise<void> {
  // Read current config
  let currentConfig: Record<string, unknown>;
  try {
    const loaded = await loadAutheliaConfigFile(configPath);
    if (!loaded) {
      throw new Error('Authelia configuration is empty or invalid');
    }
    currentConfig = loaded;
  } catch (err: unknown) {
    throw new Error(`Failed to read Authelia configuration: ${errText(err)}`);
  }

  // Migrate session config from old format (session.domain) to new format (session.cookies)
  const session = currentConfig.session as
    | {
        domain?: string;
        cookies?: Array<{
          domain: string;
          authelia_url: string;
          default_redirection_url: string;
        }>;
        secret?: string;
      }
    | undefined;

  if (session && session.domain && !session.cookies) {
    const oldDomain = session.domain;
    session.cookies = renderSessionCookies([oldDomain]);
    delete session.domain;
  }

  // Fix: default_redirection_url must differ from authelia_url (Authelia 4.38+)
  if (session?.cookies) {
    for (const cookie of session.cookies) {
      if (cookie.default_redirection_url === cookie.authelia_url) {
        cookie.default_redirection_url = `https://${cookie.domain}`;
      }
    }
  }

  // Migrate deprecated server.host/port to server.address
  const server = currentConfig.server as
    | { host?: string; port?: number; address?: string }
    | undefined;
  if (server && (server.host || server.port)) {
    const host = server.host || '127.0.0.1';
    const port = server.port || 9091;
    currentConfig.server = { address: `tcp://${host}:${port}/` };
  }

  // Migrate deprecated jwt_secret to identity_validation.reset_password.jwt_secret
  const jwtSecret = currentConfig.jwt_secret;
  if (typeof jwtSecret === 'string') {
    let iv = currentConfig.identity_validation as
      | { reset_password?: { jwt_secret?: string } }
      | undefined;
    if (!iv) {
      iv = {};
      currentConfig.identity_validation = iv;
    }
    if (!iv.reset_password) {
      iv.reset_password = {};
    }
    if (!iv.reset_password.jwt_secret) {
      iv.reset_password.jwt_secret = jwtSecret;
    }
    delete currentConfig.jwt_secret;
  }

  ensureUsersFileWatched(currentConfig);
  ensureAutheliaBrandingConfig(currentConfig);

  await mutate(currentConfig);

  // Restore secrets from the authoritative .secrets.json file.
  try {
    const secretsJson = await readFile(secretsPath, 'utf-8');
    const secrets = JSON.parse(secretsJson) as Partial<AutheliaSecrets> & {
      oidcHmacSecret?: string;
    };
    const storage = currentConfig.storage as
      | { local?: unknown; encryption_key?: string }
      | undefined;
    if (secrets.storageEncryptionKey && storage?.local) {
      storage.encryption_key = secrets.storageEncryptionKey;
    }
    if (secrets.sessionSecret && session) {
      session.secret = secrets.sessionSecret;
    }
    const oidc = (
      currentConfig.identity_providers as { oidc?: { hmac_secret?: string } } | undefined
    )?.oidc;
    if (secrets.oidcHmacSecret && oidc) {
      oidc.hmac_secret = secrets.oidcHmacSecret;
    }
    if (secrets.jwtSecret) {
      const iv = currentConfig.identity_validation as
        | { reset_password?: { jwt_secret?: string } }
        | undefined;
      if (iv?.reset_password) {
        iv.reset_password.jwt_secret = secrets.jwtSecret;
      }
    }
  } catch {
    // Secrets file may not exist on older installations — proceed with
    // whatever values the YAML round-trip produced.
  }

  const configContent = dumpAutheliaConfig(currentConfig);

  // Backup current config before writing
  const bakPath = `${configPath}.bak`;
  let backedUp = false;
  try {
    await rm(bakPath, { force: true });
    await copyFile(configPath, bakPath, constants.COPYFILE_EXCL);
    await chmod(bakPath, 0o640);
    backedUp = true;
  } catch {
    // first-time write or missing config — no backup needed
  }

  try {
    await writeAutheliaFile(configPath, configContent, 0o640);
  } catch (err: unknown) {
    throw new Error(`Failed to write Authelia configuration: ${errText(err)}`);
  }

  try {
    await restart(exec);
    await rm(bakPath, { force: true }).catch(() => undefined);
  } catch (restartErr: unknown) {
    try {
      if (!backedUp) throw restartErr;
      await rename(bakPath, configPath);
      await restartAuthelia(exec, AUTHELIA_ROLLBACK_READY_TIMEOUT_MS);
    } catch {
      // both configs may be broken — surface original error
    }
    throw restartErr;
  }
}

/**
 * Whether two parts of the configuration say the same, whatever the order
 * of their keys (a section read back from the file keeps the file's order).
 */
function sameConfig(a: unknown, b: unknown): boolean {
  try {
    return canonicalJson(a ?? null) === canonicalJson(b ?? null);
  } catch {
    return false;
  }
}

/**
 * A domain as Authelia's rules name it: its name and its group key
 * (owned-groups.ts) — who is a member of it is users.yml's groups.
 */
export interface AutheliaDomain {
  readonly name: string;
  readonly groupKey: string;
}

/** What the relay's domains need from Authelia's configuration. */
export interface DomainAccess {
  /** The active domains. */
  readonly domains: readonly AutheliaDomain[];
  readonly sites: readonly ProtectedSiteRule[];
}

/**
 * Bring Authelia's configuration in line with the relay's domains: one
 * session cookie per domain ({@link renderSessionCookies}) and
 * `access_control` ({@link renderGroupAccessControl}). Both name groups,
 * never people, so they change only with the set of domains and protected
 * sites. Rewrites and restarts Authelia (see {@link rewriteAutheliaConfig})
 * only when one of them differs from what the file holds — or when the file
 * does not yet watch users.yml (a configuration from before 4.7); returns
 * whether it did.
 */
export async function updateDomainAccess(
  access: DomainAccess,
  exec: ExecFn,
): Promise<{ changed: boolean }> {
  const cookies = renderSessionCookies(access.domains.map((d) => d.name));
  const accessControl = renderGroupAccessControl(access.domains, access.sites);

  const current = await loadAutheliaConfigFile().catch(() => null);
  if (current) {
    const session = current.session as { cookies?: unknown } | undefined;
    if (
      sameConfig(session?.cookies, cookies) &&
      sameConfig(current.access_control, accessControl) &&
      usersFileWatched(current)
    ) {
      return { changed: false };
    }
  }

  await rewriteAutheliaConfig((config) => {
    const session = (config.session as Record<string, unknown> | undefined) ?? {};
    session.cookies = cookies;
    config.session = session;
    config.access_control = accessControl;
  }, exec);
  return { changed: true };
}

// ---------------------------------------------------------------------------
// Branding: the asset path, the placeholder logo and the theme
// ---------------------------------------------------------------------------

/**
 * Hold the configuration as the branded sign-in needs it
 * (`packages/core/docs/auth-branding-design.md`): `server.asset_path`
 * naming {@link AUTHELIA_ASSET_PATH} and an explicit `theme`
 * ({@link AUTHELIA_THEME_DEFAULT} unless one is set already). Mutates
 * `config`; every rewrite applies it.
 */
export function ensureAutheliaBrandingConfig(config: Record<string, unknown>): void {
  const server = (config.server as Record<string, unknown> | undefined) ?? {};
  server.asset_path = AUTHELIA_ASSET_PATH;
  config.server = server;
  if (typeof config.theme !== 'string' || config.theme === '') {
    config.theme = AUTHELIA_THEME_DEFAULT;
  }
}

/** Whether a configuration holds what {@link ensureAutheliaBrandingConfig} sets. */
export function autheliaBrandingConfigured(config: Record<string, unknown>): boolean {
  const server = config.server as Record<string, unknown> | undefined;
  return (
    server?.asset_path === AUTHELIA_ASSET_PATH &&
    typeof config.theme === 'string' &&
    config.theme !== ''
  );
}

export interface AutheliaAssetsOptions {
  /** The asset directory (default {@link AUTHELIA_ASSET_PATH}). */
  readonly assetDir?: string;
  /** The placeholder logo's source (default: Lamaste's logo shipped with this package). */
  readonly logoSource?: string;
}

/**
 * Make sure the asset directory holds the placeholder logo: the directory
 * 0750 (group `lamaste-authelia`, inherited from `/etc/authelia`), the
 * logo 0640 — written when missing or different, never through a link.
 * Returns whether the logo was written.
 */
export async function ensureAutheliaAssets({
  assetDir = AUTHELIA_ASSET_PATH,
  logoSource = LAMASTE_LOGO_ASSET,
}: AutheliaAssetsOptions = {}): Promise<{ logoWritten: boolean }> {
  const logoPath = path.join(assetDir, 'logo.png');
  const wanted = await readFile(logoSource);
  try {
    await mkdir(assetDir, { recursive: true, mode: 0o750 });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      throw new Error(
        `${AUTHELIA_CONFIG_DIR} is not writable by the panel — run create-lamaste to repair the installation`,
      );
    }
    throw err;
  }
  try {
    const fh = await open(logoPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if ((await fh.stat()).isFile() && (await fh.readFile()).equals(wanted)) {
        return { logoWritten: false };
      }
    } finally {
      await fh.close();
    }
  } catch {
    // Missing, a link, unreadable: written below (a link is renamed over).
  }
  await writeAutheliaFile(logoPath, wanted, 0o640);
  return { logoWritten: true };
}

export interface AutheliaBrandingBaseOptions
  extends AutheliaRewriteOptions, AutheliaAssetsOptions {}

/**
 * What every branded relay needs from Authelia, whether any domain has a
 * brand: the placeholder logo in the asset directory
 * ({@link ensureAutheliaAssets}) and, in its configuration,
 * `server.asset_path` and an explicit `theme`
 * ({@link ensureAutheliaBrandingConfig}). The configuration is rewritten
 * — and Authelia restarted, once — only when one of the keys is missing:
 * the structural change the upgrade to the branded sign-in makes. Returns
 * what was done, so the caller audits the restart.
 */
export async function ensureAutheliaBrandingBase(
  exec: ExecFn,
  options: AutheliaBrandingBaseOptions = {},
): Promise<{ logoWritten: boolean; restarted: boolean }> {
  const assets: AutheliaAssetsOptions = {
    ...(options.assetDir !== undefined ? { assetDir: options.assetDir } : {}),
    ...(options.logoSource !== undefined ? { logoSource: options.logoSource } : {}),
  };
  const { logoWritten } = await ensureAutheliaAssets(assets);
  const configPath = options.configPath ?? AUTHELIA_CONFIG;
  let current: Record<string, unknown> | null;
  try {
    current = await loadAutheliaConfigFile(configPath);
  } catch (err: unknown) {
    throw new Error(`Failed to read Authelia configuration: ${errText(err)}`);
  }
  if (current && autheliaBrandingConfigured(current)) return { logoWritten, restarted: false };
  // The rewrite applies ensureAutheliaBrandingConfig itself.
  await rewriteAutheliaConfig(() => undefined, exec, options);
  return { logoWritten, restarted: true };
}

// ---------------------------------------------------------------------------
// Domains: session cookies and membership
// ---------------------------------------------------------------------------

/** One `session.cookies` entry. */
export interface AutheliaSessionCookie {
  readonly domain: string;
  readonly authelia_url: string;
  readonly default_redirection_url: string;
}

/**
 * One `session.cookies` entry per domain, each with its own sign-in at
 * `auth.<domain>`. Authelia picks the entry whose domain the target host is
 * under, and redirects only to a target under one — so a domain's sign-in
 * sets and reads its own cookie. Pure.
 */
export function renderSessionCookies(domains: readonly string[]): AutheliaSessionCookie[] {
  return domains.map((domain) => {
    assertDomainName(domain);
    return {
      domain,
      authelia_url: `https://auth.${domain}`,
      // Authelia 4.38+ refuses a default redirection equal to authelia_url.
      default_redirection_url: `https://${domain}`,
    };
  });
}

/** An access_control rule or an OIDC authorization policy rule, as Authelia reads it. */
type AutheliaRule = Record<string, unknown>;

/** `name` with every regular-expression metacharacter escaped (RE2, as Authelia compiles). */
function quoteRegex(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The `domain_regex` that admits an external member of `domain` on a host
 * under it whose name is one of their groups (Authelia's `(?P<Group>…)`
 * capture — a host group, owned-groups.ts). The apex is not matched: no
 * Gatekeeper-gated host is the apex itself.
 */
export function externalHostRegex(domain: string): string {
  assertDomainName(domain);
  return `^(?P<Group>(?:[a-z0-9-]+\\.)+${quoteRegex(domain)})$`;
}

/**
 * The whole `access_control` section on groups Lamaste owns
 * (owned-groups.ts): the rules name groups, never people, so they change
 * only with the set of domains and protected sites — a membership, a kind,
 * a grant or a site's listed users is a users.yml change, which Authelia
 * applies without a restart.
 *
 * 1. per protected static site: its site group (`lamaste:s:<id>` — the
 *    listed users, members and external members alike) when it lists
 *    users; admins who are members (`group:admins` AND the domain's member
 *    group); then deny;
 * 2. per domain: its sign-in portal `auth.<d>` for members and external
 *    members alike — nginx never asks Authelia about the portal for a
 *    resource (it is no forward-auth target but the desktop user-access
 *    `authorize`, which refuses external members itself); Gatekeeper asks
 *    it for who an Authelia refusal was for; then its members on the
 *    domain and every host under it; its external members only on a host
 *    whose name is one of their groups ({@link externalHostRegex}, AND the
 *    domain's external group); deny;
 * 3. `default_policy: deny`.
 *
 * A site under no domain gets its deny alone, and so does a site listing
 * users without an id (none to name its group by). A protected site neither
 * listing users nor restricted has no rule of its own: the members of its
 * domain reach it, external members do not (no host group names it). The
 * apex of a domain is never a Gatekeeper-gated host, so the external rule
 * does not match it. Pure.
 */
export function renderGroupAccessControl(
  domains: readonly AutheliaDomain[],
  sites: readonly ProtectedSiteRule[],
): { default_policy: 'deny'; rules: AutheliaRule[] } {
  for (const d of domains) assertDomainName(d.name);
  const names = domains.map((d) => d.name);
  const keys = new Map(domains.map((d) => [d.name, d.groupKey]));
  const rules: AutheliaRule[] = [];

  for (const site of sites) {
    if (!site.autheliaProtected) continue;
    const hasUserList = (site.allowedUsers ?? []).length > 0;
    if (!hasUserList && !site.restrictAccess) continue;
    const fqdn = site.fqdn.toLowerCase();
    const domain = domainOfHost(fqdn, names);
    const key = domain === null ? undefined : keys.get(domain);
    if (key !== undefined) {
      if (hasUserList && site.id !== undefined) {
        rules.push({
          domain: fqdn,
          policy: 'two_factor',
          subject: [`group:${siteGroup(site.id)}`],
        });
      }
      rules.push({
        domain: fqdn,
        policy: 'two_factor',
        subject: [['group:admins', `group:${memberGroup(key)}`]],
      });
    }
    rules.push({ domain: fqdn, policy: 'deny' });
  }

  for (const { name, groupKey } of domains) {
    const hosts = [name, `*.${name}`];
    const member = `group:${memberGroup(groupKey)}`;
    const external = `group:${externalGroup(groupKey)}`;
    rules.push({ domain: [`auth.${name}`], policy: 'two_factor', subject: [member, external] });
    rules.push({ domain: hosts, policy: 'two_factor', subject: [member] });
    rules.push({
      domain_regex: [externalHostRegex(name)],
      policy: 'two_factor',
      subject: [external],
    });
    rules.push({ domain: hosts, policy: 'deny' });
  }

  return { default_policy: 'deny', rules };
}

// ---------------------------------------------------------------------------
// OpenID Connect provider
// ---------------------------------------------------------------------------

/**
 * Authelia is the relay's identity provider for plugin clients too — a CLI
 * logging in with the device-code flow (Feria's `feria login`), a service
 * authenticating with the client-credentials grant (Lamaste's own
 * `lamaste-server` principal brokering registry tokens). Plugins declare
 * clients in their manifest (`oidcClients`); Lamaste renders them into
 * `identity_providers.oidc.clients`.
 *
 * Tokens are signed with an RSA key that create-lamaste generates at
 * `/etc/authelia/oidc-issuer.pem`, owned by the Authelia account and
 * readable by nobody else — not by the panel. The configuration therefore
 * does not carry the key: Authelia runs with the `template` configuration
 * filter (`X_AUTHELIA_CONFIG_FILTERS=template`, set by create-lamaste in its
 * unit) and the key is pulled in with `{{ secret "<path>" }}` at load time.
 * The whole file is then a Go template, so the writer refuses any `{{` or
 * `}}` it would otherwise emit.
 *
 * The block is removed entirely when no client is declared: Authelia
 * refuses an `oidc` section without clients.
 */

/** RSA private key Authelia signs ID and JWT access tokens with (0600, lamaste-authelia). */
export const AUTHELIA_OIDC_KEY = path.join(AUTHELIA_CONFIG_DIR, 'oidc-issuer.pem');

/** `key_id` of the issuer key in the JWKS. */
export const AUTHELIA_OIDC_KEY_ID = 'lamaste-oidc';

/**
 * What the YAML carries in `jwks[].key` between reading and writing. The
 * file on disk has the template expression instead; js-yaml cannot parse
 * that line (`{{` opens a flow mapping), so the reader swaps it for this
 * sentinel and the writer swaps it back.
 */
export const OIDC_KEY_TEMPLATE_SENTINEL = '__LAMASTE_OIDC_ISSUER_KEY__';

/**
 * The template line Authelia reads the issuer key with. `indent` is the
 * column of `key:`; `mindent` gets the column of the PEM lines, one level
 * deeper, so the multi-line scalar nests correctly under it.
 */
export function oidcIssuerKeyTemplateLine(indent: number): string {
  return `${' '.repeat(indent)}key: {{ secret "${AUTHELIA_OIDC_KEY}" | mindent ${indent + 2} "|" | msquote }}`;
}

const OIDC_KEY_TEMPLATE_LINE_RE =
  /^( *)key: \{\{ secret "[^"]+" \| mindent \d+ "\|" \| msquote \}\}\s*$/;
const OIDC_KEY_SENTINEL_LINE_RE = new RegExp(`^( *)key: '?${OIDC_KEY_TEMPLATE_SENTINEL}'?\\s*$`);

/** Configuration text as stored → text js-yaml can parse. Pure. */
export function sentinelizeAutheliaConfig(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const m = OIDC_KEY_TEMPLATE_LINE_RE.exec(line);
      return m ? `${m[1] ?? ''}key: ${OIDC_KEY_TEMPLATE_SENTINEL}` : line;
    })
    .join('\n');
}

/**
 * Rendered YAML (sentinel inside) → the text Authelia reads. Refuses a
 * document containing `{{` or `}}` anywhere: with the template filter on,
 * such a value would be executed, not stored. Pure.
 */
export function renderAutheliaConfigTemplate(yamlText: string): string {
  if (yamlText.includes('{{') || yamlText.includes('}}')) {
    throw new Error(
      'Authelia configuration must not contain "{{" or "}}": the file is rendered as a Go template',
    );
  }
  return yamlText
    .split('\n')
    .map((line) => {
      const m = OIDC_KEY_SENTINEL_LINE_RE.exec(line);
      return m ? oidcIssuerKeyTemplateLine((m[1] ?? '').length) : line;
    })
    .join('\n');
}

/** Dump a configuration object the way every writer here does. */
function dumpAutheliaConfig(config: Record<string, unknown>): string {
  return renderAutheliaConfigTemplate(
    yaml.dump(config, { lineWidth: -1, quotingType: "'", forceQuotes: false }),
  );
}

/** Read and parse `configuration.yml` (template line sentinelized). */
async function loadAutheliaConfigFile(
  configPath: string = AUTHELIA_CONFIG,
): Promise<Record<string, unknown> | null> {
  const text = await readFile(configPath, 'utf-8');
  return yaml.load(sentinelizeAutheliaConfig(text)) as Record<string, unknown> | null;
}

/**
 * A manifest client with the plugin that declared it and the domain it
 * belongs to — the plugin's (the panel's own client: its registry
 * credential's issuer domain). `{domain}` in its audience and redirect URIs
 * is that domain, and a user-facing client admits only that domain's
 * members and the external members granted it ({@link renderOidcClientPolicies}).
 */
export interface AutheliaOidcClient extends OidcClientDeclaration {
  plugin: string;
  domain: string;
}

/** Secrets of confidential clients, as pbkdf2 digests Authelia accepts, keyed by client id. */
export type OidcClientSecretDigests = Readonly<Record<string, string>>;

/** Custom scope definitions for `identity_providers.oidc.scopes`. */
export type OidcScopeDefinitions = Readonly<Record<string, { claims: readonly string[] }>>;

export interface OidcProviderOptions {
  /** Required for every confidential client in the list. */
  secretDigests?: OidcClientSecretDigests;
  scopes?: OidcScopeDefinitions;
}

/**
 * Whether a client signs users in (device code, authorization code) rather
 * than a service (`client_credentials` — never mixed with a user grant,
 * schemas.ts).
 */
function isUserFacingClient(client: AutheliaOidcClient): boolean {
  return !client.grantTypes.includes('client_credentials');
}

/**
 * The custom lifespan every user-facing plugin client names: its access and
 * ID tokens live 15 minutes, which bounds what outlives a revoked
 * membership or grant (plugin clients get no refresh tokens). Unset token
 * types fall back to Authelia's defaults.
 */
export const OIDC_USER_LIFESPAN = 'lamaste_user';
const OIDC_USER_LIFESPAN_TOKENS = { access_token: '15 minutes', id_token: '15 minutes' } as const;

/** `{domain}` in an audience or redirect URI becomes the client's domain. */
function expandDomain(value: string, domain: string): string {
  return value.replaceAll('{domain}', domain);
}

/**
 * The `clients[]` entry Authelia expects for one client. A confidential
 * client needs the pbkdf2 digest of its secret. Pure.
 */
export function renderOidcClient(
  client: AutheliaOidcClient,
  secretDigest?: string,
): Record<string, unknown> {
  const { domain } = client;
  assertDomainName(domain);
  if (client.confidential && !secretDigest) {
    throw new Error(`OIDC client "${client.id}" is confidential but has no secret digest`);
  }
  if (!client.confidential && secretDigest) {
    throw new Error(`OIDC client "${client.id}" is public and must not carry a secret`);
  }
  // The manifest refuses refresh tokens (schemas.ts); one reaching here is a bug.
  if (
    (client.grantTypes as readonly string[]).includes('refresh_token') ||
    client.scopes.some((s) => s === 'offline' || s === 'offline_access')
  ) {
    throw new Error(
      `OIDC client "${client.id}" asks for refresh tokens, which plugin clients never get`,
    );
  }
  const entry: Record<string, unknown> = {
    client_id: client.id,
    client_name: client.name ?? `${client.plugin} (${client.id})`,
  };
  if (client.confidential) {
    entry.client_secret = secretDigest;
  } else {
    entry.public = true;
  }
  // Authelia 4.39 refuses anything but one_factor on a client with the
  // client_credentials grant (there is no end user to challenge). A client
  // with a user has its own policy: the members of its domain, and the
  // external members granted it (renderOidcClientPolicies).
  entry.authorization_policy = client.grantTypes.includes('client_credentials')
    ? 'one_factor'
    : oidcClientPolicyName(client.id);
  // Every consent is asked for explicitly — a device-flow approval screen
  // must say what is being granted. A pure service client has no user to
  // ask.
  if (isUserFacingClient(client)) {
    entry.consent_mode = 'explicit';
    entry.lifespan = OIDC_USER_LIFESPAN;
  }
  entry.scopes = [...client.scopes];
  entry.grant_types = [...client.grantTypes];
  entry.token_endpoint_auth_method = client.confidential ? 'client_secret_basic' : 'none';
  entry.access_token_signed_response_alg = client.accessTokenSignedResponseAlg;
  entry.requested_audience_mode = 'explicit';
  if (client.accessTokenClaims.length > 0) {
    entry.claims_policy = client.id;
  }
  if (client.audience.length > 0) {
    entry.audience = client.audience.map((a) => expandDomain(a, domain));
  }
  if (client.redirectUris.length > 0) {
    entry.redirect_uris = client.redirectUris.map((u) => expandDomain(u, domain));
  }
  if (client.requirePkce) entry.require_pkce = true;
  return entry;
}

/**
 * One claims policy per client that asks for claims in its access tokens,
 * named after the client (`claims_policy: <id>` on the client). Pure.
 */
export function renderOidcClaimsPolicies(
  clients: readonly AutheliaOidcClient[],
): Record<string, { access_token: string[] }> {
  const policies: Record<string, { access_token: string[] }> = {};
  for (const client of clients) {
    if (client.accessTokenClaims.length === 0) continue;
    policies[client.id] = { access_token: [...client.accessTokenClaims] };
  }
  return policies;
}

/**
 * The name of the authorization policy of one user-facing client:
 * `lamaste_client_<client id>` (ids are `[a-z0-9-]` — no dot for Authelia's
 * configuration loader to split a key at).
 */
export function oidcClientPolicyName(clientId: string): string {
  if (!isOidcClientId(clientId)) throw new Error('Not an OIDC client id');
  return `lamaste_client_${clientId}`;
}

/**
 * One authorization policy per user-facing client, on groups Lamaste owns
 * (owned-groups.ts): the members of the client's domain, with its factor;
 * its external members only when granted the client (the domain's external
 * group AND `group:lamaste:oidc@<id>`); everyone else refused. Authelia's
 * `access_control` does not apply to OIDC authorization, a client's policy
 * does. Authelia re-reads the user's groups before it applies one on the
 * authorization-code path — not on the device-code path, which checks the
 * groups the session last refreshed (the panel restarts Authelia when a
 * narrowing reaches a device-code client). Service (`client_credentials`)
 * clients get none. Every client's domain must be one of `domains`. Pure.
 */
export function renderOidcClientPolicies(
  clients: readonly AutheliaOidcClient[],
  domains: readonly AutheliaDomain[],
): Record<string, { default_policy: 'deny'; rules: AutheliaRule[] }> {
  const keys = new Map(domains.map((d) => [d.name, d.groupKey]));
  const policies: Record<string, { default_policy: 'deny'; rules: AutheliaRule[] }> = {};
  for (const client of clients) {
    if (!isUserFacingClient(client)) continue;
    const key = keys.get(client.domain);
    if (key === undefined) {
      throw new Error(`OIDC client "${client.id}" belongs to no domain of this relay`);
    }
    const factor = client.authorizationPolicy;
    policies[oidcClientPolicyName(client.id)] = {
      default_policy: 'deny',
      rules: [
        { policy: factor, subject: [`group:${memberGroup(key)}`] },
        {
          policy: factor,
          subject: [[`group:${externalGroup(key)}`, `group:${oidcClientGroup(client.id)}`]],
        },
      ],
    };
  }
  return policies;
}

/**
 * The whole `identity_providers.oidc` section, with the sentinel for the
 * key, and one authorization policy per user-facing client
 * ({@link renderOidcClientPolicies}). Every client's domain must be one of
 * `domains` (the active domains). Pure.
 */
export function buildOidcProviderSection(
  domains: readonly AutheliaDomain[],
  hmacSecret: string,
  clients: readonly AutheliaOidcClient[],
  options: OidcProviderOptions = {},
): Record<string, unknown> {
  const known = new Set(domains.map((d) => d.name));
  const stray = clients.find((c) => !known.has(c.domain));
  if (stray) {
    throw new Error(
      `OIDC client "${stray.id}" belongs to '${stray.domain}', no domain of this relay`,
    );
  }
  const digests = options.secretDigests ?? {};
  const section: Record<string, unknown> = {
    hmac_secret: hmacSecret,
    jwks: [
      {
        key_id: AUTHELIA_OIDC_KEY_ID,
        algorithm: 'RS256',
        use: 'sig',
        key: OIDC_KEY_TEMPLATE_SENTINEL,
      },
    ],
    lifespans: {
      device_code: '10 minutes',
      ...(clients.some(isUserFacingClient)
        ? { custom: { [OIDC_USER_LIFESPAN]: { ...OIDC_USER_LIFESPAN_TOKENS } } }
        : {}),
    },
  };
  const policies = renderOidcClaimsPolicies(clients);
  if (Object.keys(policies).length > 0) section.claims_policies = policies;
  if (options.scopes && Object.keys(options.scopes).length > 0) {
    section.scopes = Object.fromEntries(
      Object.entries(options.scopes).map(([name, def]) => [name, { claims: [...def.claims] }]),
    );
  }
  const authorizationPolicies = renderOidcClientPolicies(clients, domains);
  if (Object.keys(authorizationPolicies).length > 0) {
    section.authorization_policies = authorizationPolicies;
  }
  section.clients = clients.map((c) => renderOidcClient(c, digests[c.id]));
  return section;
}

/** The OIDC HMAC secret lives with the other panel-owned secrets in `.secrets.json`. */
async function ensureOidcHmacSecret(): Promise<string> {
  let secrets: Record<string, unknown> = {};
  try {
    secrets = JSON.parse(await readFile(AUTHELIA_SECRETS, 'utf-8')) as Record<string, unknown>;
  } catch {
    // Older installation without the file — created below.
  }
  const existing = secrets.oidcHmacSecret;
  if (typeof existing === 'string' && existing.length >= 32) return existing;
  const fresh = crypto.randomBytes(32).toString('hex');
  secrets.oidcHmacSecret = fresh;
  await writeAutheliaFile(AUTHELIA_SECRETS, JSON.stringify(secrets, null, 2) + '\n', 0o600);
  return fresh;
}

/**
 * Current `identity_providers.oidc` section, or `null` when there is none.
 * A configuration that cannot be read or parsed throws: taking it for an
 * absent section would rewrite Authelia (and restart it) on every render.
 */
async function readCurrentOidcSection(): Promise<Record<string, unknown> | null> {
  let loaded: Record<string, unknown> | null;
  try {
    loaded = await loadAutheliaConfigFile();
  } catch (err: unknown) {
    throw new Error(`Authelia's configuration cannot be read: ${errText(err)}`);
  }
  const ip = loaded?.identity_providers as { oidc?: Record<string, unknown> } | undefined;
  return ip?.oidc ?? null;
}

/**
 * True when the issuer key create-lamaste provisions is in place. The
 * panel cannot read it (0600, Authelia's account) — only see that it exists.
 */
export function isOidcIssuerKeyProvisioned(): Promise<boolean> {
  return fileExists(AUTHELIA_OIDC_KEY);
}

/**
 * Make Authelia's OIDC provider serve exactly `clients`. Restarts Authelia
 * only when the section actually changes. With no clients the section is
 * removed. Fails when the issuer key has not been provisioned.
 */
export async function updateOidcProvider(
  domains: readonly AutheliaDomain[],
  clients: readonly AutheliaOidcClient[],
  exec: ExecFn,
  options: OidcProviderOptions = {},
): Promise<{ changed: boolean; clients: number }> {
  const current = await readCurrentOidcSection();

  if (clients.length === 0) {
    if (current === null) return { changed: false, clients: 0 };
    await rewriteAutheliaConfig((config) => {
      const ip = config.identity_providers as Record<string, unknown> | undefined;
      if (ip) {
        delete ip.oidc;
        if (Object.keys(ip).length === 0) delete config.identity_providers;
      }
    }, exec);
    return { changed: true, clients: 0 };
  }

  if (!(await isOidcIssuerKeyProvisioned())) {
    throw new Error(
      `${AUTHELIA_OIDC_KEY} is missing — the OIDC issuer key is provisioned by create-lamaste; ` +
        'run the installer again (npx @lamalibre/create-lamaste, redeploy) to create it',
    );
  }

  const hmacSecret = await ensureOidcHmacSecret();
  const desired = buildOidcProviderSection(domains, hmacSecret, clients, options);
  if (current !== null && sameConfig(current, desired)) {
    return { changed: false, clients: clients.length };
  }

  await rewriteAutheliaConfig((config) => {
    const ip = (config.identity_providers as Record<string, unknown> | undefined) ?? {};
    ip.oidc = desired;
    config.identity_providers = ip;
  }, exec);
  return { changed: true, clients: clients.length };
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

/** How {@link createUserFromInvitation} writes the user. */
export interface CreateInvitedUserOptions {
  /**
   * Restart Authelia after writing (default true). A caller that brings
   * other state in line with the users file first — the panel's user
   * directory — passes false and restarts Authelia itself.
   */
  readonly restart?: boolean;
  /** Authelia's users file unless named (the daemon's tests). */
  readonly usersFile?: string;
}

/**
 * Create an Authelia user from an accepted invitation.
 */
export async function createUserFromInvitation(
  username: string,
  email: string,
  groups: string[],
  hashedPassword: string,
  exec: ExecFn,
  options: CreateInvitedUserOptions = {},
): Promise<{ username: string; created: true }> {
  const usersFile = options.usersFile ?? AUTHELIA_USERS;
  const usersData = await readUsersForWrite(usersFile);

  if (usersData.users[username]) {
    throw new Error(`User '${username}' already exists`);
  }

  usersData.users[username] = {
    displayname: username,
    email,
    password: hashedPassword,
    groups,
  };

  await writeUsers(usersData, usersFile);
  if (options.restart !== false) await reloadAuthelia(exec);

  return { username, created: true };
}

// ---------------------------------------------------------------------------
// Base32 + TOTP
// ---------------------------------------------------------------------------

/**
 * Encode a Buffer as a base32 string (RFC 4648).
 */
export function base32Encode(buffer: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    if (byte === undefined) continue;
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 0x1f];
  }

  return output;
}

/**
 * Decode a base32-encoded string (RFC 4648) to a Buffer.
 */
export function base32Decode(encoded: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  // Strip trailing '=' padding deterministically (avoid regex quantifier
  // backtracking on adversarial input of arbitrary length).
  let end = encoded.length;
  while (end > 0 && encoded.charCodeAt(end - 1) === 0x3d /* '=' */) end--;
  const stripped = encoded.slice(0, end).toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === undefined) continue;
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

/**
 * Generate a TOTP secret and otpauth URI for a user.
 */
export function generateTotpSecret(
  username: string,
  opts?: { issuer?: string },
): { secret: string; uri: string } {
  const issuer = opts?.issuer || 'Lamaste';
  const secretBytes = crypto.randomBytes(20);
  const secret = base32Encode(secretBytes);
  const encodedUsername = encodeURIComponent(username);
  const encodedIssuer = encodeURIComponent(issuer);
  const uri = `otpauth://totp/${encodedIssuer}:${encodedUsername}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri };
}

/**
 * Write a TOTP secret to Authelia's storage backend.
 *
 * Authelia v4.38+ stores TOTP configurations in its storage backend (SQLite).
 * The totp_secret field in users.yml is ignored. The secret is stored with
 * Authelia's own CLI (which handles storage encryption), run as Authelia's
 * account by the root helper; the secret travels on stdin, never in a
 * command line the sudo log would record.
 */
export async function writeTotpToDatabase(
  username: string,
  base32Secret: string,
  exec: ExecFn,
): Promise<void> {
  await exec('sudo', [PRIV, 'authelia-totp', username], { input: base32Secret });
}
