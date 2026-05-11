/**
 * Authelia lifecycle management — install, config, users, service control,
 * access-control sync, TOTP helpers.
 *
 * Pure logic: all process spawning goes through an injected `exec` function.
 * `bcryptHash` is also injected so the core library does not take a runtime
 * dependency on bcryptjs.
 *
 * The daemon provides both; callers may swap in test doubles.
 */

import crypto from 'node:crypto';
import { access, constants, writeFile as fsWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

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
const GITHUB_API = 'https://api.github.com/repos/authelia/authelia/releases/latest';

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
    options?: { reject?: boolean; timeout?: number },
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
}

export interface UsersYamlEntry {
  displayname?: string;
  email?: string;
  password?: string;
  groups?: string[];
  [k: string]: unknown;
}

export interface UsersYamlFile {
  users: Record<string, UsersYamlEntry>;
}

export interface ProtectedSiteRule {
  readonly fqdn: string;
  readonly autheliaProtected: boolean;
  readonly allowedUsers?: string[];
  readonly restrictAccess?: boolean;
}

// ---------------------------------------------------------------------------
// sudo-write helper
// ---------------------------------------------------------------------------

async function sudoWriteFile(
  destPath: string,
  content: string,
  mode: string,
  exec: ExecFn,
): Promise<void> {
  const tmpFile = path.join(
    tmpdir(),
    `lamalibre-lamaste-authelia-${crypto.randomBytes(4).toString('hex')}`,
  );
  await fsWriteFile(tmpFile, content, 'utf-8');
  await exec('sudo', ['mv', tmpFile, destPath]);
  await exec('sudo', ['chmod', mode, destPath]);
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

interface GitHubAsset {
  readonly name: string;
  readonly browser_download_url: string;
}
interface GitHubReleaseInfo {
  readonly assets?: GitHubAsset[];
  readonly message?: string;
}

async function getInstalledVersion(exec: ExecFn): Promise<string | null> {
  try {
    const { stdout, stderr } = await exec(AUTHELIA_BIN, ['--version']);
    const output = (stdout || stderr || '').trim();
    if (output) return output;
  } catch {
    // --version may not be recognized in newer versions
  }

  try {
    const { stdout, stderr } = await exec(AUTHELIA_BIN, ['version']);
    const output = (stdout || stderr || '').trim();
    if (output) return output;
  } catch {
    // neither worked
  }

  return null;
}

export interface InstallResult {
  readonly installed?: true;
  readonly skipped?: true;
  readonly version: string;
}

/**
 * Download and install the Authelia binary from GitHub releases.
 */
export async function installAuthelia(exec: ExecFn): Promise<InstallResult> {
  const exists = await fileExists(AUTHELIA_BIN);
  if (exists) {
    const version = await getInstalledVersion(exec);
    if (version) {
      return { skipped: true, version };
    }
  }

  let releaseInfo: GitHubReleaseInfo;
  try {
    const { stdout } = await exec('curl', [
      '-s',
      '-L',
      '-H',
      'Accept: application/vnd.github+json',
      GITHUB_API,
    ]);
    releaseInfo = JSON.parse(stdout) as GitHubReleaseInfo;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to fetch Authelia release info from GitHub: ${message}. Check internet connectivity.`,
    );
  }

  if (releaseInfo.message && releaseInfo.message.includes('rate limit')) {
    throw new Error(
      'GitHub API rate limit exceeded. Please try again later or set a GITHUB_TOKEN environment variable.',
    );
  }

  const { stdout: unameArch } = await exec('uname', ['-m']);
  const archMap: Record<string, string> = {
    x86_64: 'linux-amd64',
    aarch64: 'linux-arm64',
    arm64: 'linux-arm64',
  };
  const autheliaArch = archMap[unameArch.trim()] ?? 'linux-amd64';

  const asset = releaseInfo.assets?.find(
    (a) => a.name.includes(autheliaArch) && a.name.endsWith('.tar.gz') && !a.name.includes('musl'),
  );

  if (!asset) {
    throw new Error(
      `Could not find ${autheliaArch} tarball in the latest Authelia release. Available assets: ` +
        (releaseInfo.assets?.map((a) => a.name).join(', ') || 'none'),
    );
  }

  const downloadUrl = asset.browser_download_url;
  const tmpTar = path.join(tmpdir(), `authelia-${crypto.randomBytes(4).toString('hex')}.tar.gz`);
  const tmpExtractDir = path.join(
    tmpdir(),
    `authelia-extract-${crypto.randomBytes(4).toString('hex')}`,
  );

  try {
    await exec('curl', ['-L', '-o', tmpTar, downloadUrl]);
  } catch (err: unknown) {
    throw new Error(
      `Failed to download Authelia from ${downloadUrl}: ${errText(err)}. Check internet connectivity.`,
    );
  }

  try {
    await exec('mkdir', ['-p', tmpExtractDir]);
    await exec('tar', ['xzf', tmpTar, '-C', tmpExtractDir]);

    const { stdout: findResult } = await exec('find', [
      tmpExtractDir,
      '-name',
      'authelia*',
      '-type',
      'f',
    ]);
    const candidates = findResult.trim().split('\n').filter(Boolean);

    const binaryPath =
      candidates.find((p) => path.basename(p) === 'authelia') ||
      candidates.find(
        (p) => !path.basename(p).endsWith('.sha256') && !path.basename(p).endsWith('.md'),
      ) ||
      candidates[0];

    if (!binaryPath) {
      throw new Error(
        'Could not find authelia binary in extracted archive. Contents: ' + candidates.join(', '),
      );
    }

    await exec('sudo', ['mv', binaryPath, AUTHELIA_BIN]);
    await exec('sudo', ['chmod', '+x', AUTHELIA_BIN]);
  } catch (err: unknown) {
    throw new Error(`Failed to install Authelia binary: ${errText(err)}`);
  } finally {
    await exec('rm', ['-rf', tmpTar, tmpExtractDir]).catch(() => undefined);
  }

  const version = await getInstalledVersion(exec);
  if (!version) {
    let diag = '';
    try {
      const { stdout: fileInfo } = await exec('file', [AUTHELIA_BIN]);
      diag += `file: ${fileInfo}\n`;
    } catch {
      /* ignore */
    }
    try {
      const { stdout: lsInfo } = await exec('ls', ['-la', AUTHELIA_BIN]);
      diag += `ls: ${lsInfo}\n`;
    } catch {
      /* ignore */
    }
    try {
      const result = await exec(AUTHELIA_BIN, ['--version'], { reject: false });
      diag += `--version stdout: ${result.stdout}\n--version stderr: ${result.stderr}\nexitCode: ${result.exitCode ?? ''}\n`;
    } catch (e: unknown) {
      const em = e instanceof Error ? e.message : String(e);
      diag += `--version error: ${em}\n`;
    }
    throw new Error(
      `Authelia was installed but version check failed. The binary may be corrupted or incompatible.\nDiagnostics:\n${diag}`,
    );
  }

  return { installed: true, version };
}

// ---------------------------------------------------------------------------
// Config file
// ---------------------------------------------------------------------------

/**
 * Write the Authelia configuration file.
 */
export async function writeAutheliaConfig(
  domain: string,
  secrets: AutheliaSecrets,
  exec: ExecFn,
): Promise<string> {
  const { jwtSecret, sessionSecret, storageEncryptionKey } = secrets;

  try {
    await exec('sudo', ['mkdir', '-p', AUTHELIA_CONFIG_DIR]);
    await exec('sudo', ['mkdir', '-p', AUTHELIA_LOG_DIR]);
  } catch (err: unknown) {
    throw new Error(`Failed to create Authelia directories: ${errText(err)}`);
  }

  const configContent = yaml.dump(
    {
      server: {
        address: 'tcp://127.0.0.1:9091/',
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
        file: {
          path: AUTHELIA_USERS,
          password: {
            algorithm: 'bcrypt',
            bcrypt: {
              cost: 12,
            },
          },
        },
      },
      access_control: {
        default_policy: 'two_factor',
      },
      session: {
        // Authelia's default cookie name. Keep this in sync with the rest of
        // the stack — the nginx `lamaste_authz` cache key reads
        // `$cookie_authelia_session`, Gatekeeper's cookie extractor looks
        // for `authelia_session=`, and the e2e cookie-jar fixtures write
        // `authelia_session`. Renaming it here (e.g. to `lamaste_session`)
        // silently breaks forward-auth: nginx forwards the cookie unchanged,
        // Gatekeeper fails to find it, returns 401, and nginx redirects to
        // the Authelia portal — even for freshly-authenticated sessions.
        name: 'authelia_session',
        secret: sessionSecret,
        cookies: [
          {
            domain,
            authelia_url: `https://auth.${domain}`,
            default_redirection_url: `https://${domain}`,
          },
        ],
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
    },
    { lineWidth: -1 },
  );

  try {
    await sudoWriteFile(AUTHELIA_CONFIG, configContent, '600', exec);
  } catch (err: unknown) {
    throw new Error(`Failed to write Authelia configuration: ${errText(err)}`);
  }

  const secretsContent =
    JSON.stringify({ jwtSecret, sessionSecret, storageEncryptionKey }, null, 2) + '\n';
  try {
    await sudoWriteFile(AUTHELIA_SECRETS, secretsContent, '600', exec);
  } catch (err: unknown) {
    throw new Error(`Failed to write Authelia secrets file: ${errText(err)}`);
  }

  return AUTHELIA_CONFIG;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * Create a default Authelia user with a bcrypt-hashed password, added to
 * the `admins` group.
 */
export async function createUser(
  username: string,
  password: string,
  exec: ExecFn,
  bcryptHash: BcryptHashFn,
): Promise<{ username: string; created: true }> {
  const hash = await bcryptHash(password, 12);

  if (!hash || !hash.startsWith('$2')) {
    throw new Error(`Bcrypt hashing produced invalid output: ${hash}`);
  }

  let usersData: UsersYamlFile = { users: {} };
  try {
    const { stdout } = await exec('sudo', ['cat', AUTHELIA_USERS]);
    const parsed = yaml.load(stdout) as UsersYamlFile | null;
    if (parsed && parsed.users) {
      usersData = parsed;
    }
  } catch {
    // file missing or empty — start fresh
  }

  usersData.users[username] = {
    displayname: username,
    password: hash,
    email: `${username}@lamaste.local`,
    groups: ['admins'],
  };

  await writeUsers(usersData, exec);

  return { username, created: true };
}

/**
 * Read the Authelia users file and return user info (without password hashes).
 */
export async function readUsers(exec: ExecFn): Promise<AutheliaUser[]> {
  try {
    const { stdout } = await exec('sudo', ['cat', AUTHELIA_USERS]);
    const parsed = yaml.load(stdout) as UsersYamlFile | null;

    if (!parsed || !parsed.users) {
      return [];
    }

    return Object.entries(parsed.users).map(([username, data]) => ({
      username,
      displayname: data.displayname || username,
      email: data.email || '',
      groups: data.groups || [],
    }));
  } catch {
    return [];
  }
}

/**
 * Atomically write the Authelia users YAML file.
 */
export async function writeUsers(usersData: UsersYamlFile, exec: ExecFn): Promise<void> {
  const yamlContent = yaml.dump(usersData, { lineWidth: -1 });

  try {
    await sudoWriteFile(AUTHELIA_USERS, yamlContent, '600', exec);
  } catch (err: unknown) {
    throw new Error(`Failed to write Authelia users file: ${errText(err)}`);
  }
}

/**
 * Read the raw users.yml data, returning the full object including password
 * hashes. Used by CRUD operations that need to modify and re-write the file.
 */
export async function readUsersRaw(exec: ExecFn): Promise<UsersYamlFile> {
  const { stdout } = await exec('sudo', ['cat', AUTHELIA_USERS]);
  const parsed = yaml.load(stdout) as UsersYamlFile | null;
  if (!parsed || !parsed.users) {
    return { users: {} };
  }
  return parsed;
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

/**
 * Write the Authelia systemd service unit file.
 */
export async function writeAutheliaService(exec: ExecFn): Promise<string> {
  const serviceContent = `[Unit]
Description=Authelia Authentication Server
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/authelia --config /etc/authelia/configuration.yml
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=authelia

[Install]
WantedBy=multi-user.target
`;

  const tmpFile = path.join(tmpdir(), `authelia-service-${crypto.randomBytes(4).toString('hex')}`);
  await fsWriteFile(tmpFile, serviceContent, 'utf-8');

  try {
    await exec('sudo', ['mv', tmpFile, '/etc/systemd/system/authelia.service']);
    await exec('sudo', ['chmod', '644', '/etc/systemd/system/authelia.service']);
    await exec('sudo', ['systemctl', 'daemon-reload']);
  } catch (err: unknown) {
    throw new Error(`Failed to write Authelia service file: ${errText(err)}`);
  }

  return '/etc/systemd/system/authelia.service';
}

/**
 * Enable and start the Authelia systemd service.
 */
export async function startAuthelia(exec: ExecFn): Promise<{ active: true }> {
  try {
    await exec('sudo', ['systemctl', 'enable', AUTHELIA_SERVICE]);
    await exec('sudo', ['systemctl', 'start', AUTHELIA_SERVICE]);
  } catch (err: unknown) {
    throw new Error(`Failed to start Authelia service: ${errText(err)}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const { stdout } = await exec('systemctl', ['is-active', AUTHELIA_SERVICE]);
    if (stdout.trim() === 'active') {
      return { active: true };
    }
  } catch {
    // non-zero for inactive
  }

  let journalOutput = '';
  try {
    const { stdout } = await exec('journalctl', ['-u', AUTHELIA_SERVICE, '--no-pager', '-n', '10']);
    journalOutput = stdout;
  } catch {
    journalOutput = 'Could not read journal logs';
  }

  throw new Error(
    `Authelia service is not active after starting. Journal output:\n${journalOutput}`,
  );
}

/**
 * Restart the Authelia service.
 */
export async function reloadAuthelia(exec: ExecFn): Promise<{ active: true }> {
  try {
    await exec('sudo', ['systemctl', 'restart', AUTHELIA_SERVICE]);
  } catch (err: unknown) {
    throw new Error(`Failed to restart Authelia service: ${errText(err)}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const { stdout } = await exec('systemctl', ['is-active', AUTHELIA_SERVICE]);
    if (stdout.trim() === 'active') {
      return { active: true };
    }
  } catch {
    // non-zero for inactive
  }

  throw new Error('Authelia service is not active after restart.');
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
 * Update the Authelia access_control configuration based on protected sites.
 *
 * Reads the existing configuration, replaces the access_control section with
 * per-site rules, writes the config atomically, and restarts Authelia.
 * Rolls back to the previous config on restart failure.
 */
export async function updateAccessControl(
  sites: readonly ProtectedSiteRule[],
  exec: ExecFn,
): Promise<void> {
  // Read current config
  let currentConfig: Record<string, unknown>;
  try {
    const { stdout } = await exec('sudo', ['cat', AUTHELIA_CONFIG]);
    const loaded = yaml.load(stdout) as Record<string, unknown> | null;
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
    session.cookies = [
      {
        domain: oldDomain,
        authelia_url: `https://auth.${oldDomain}`,
        default_redirection_url: `https://${oldDomain}`,
      },
    ];
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

  // Build access_control rules from protected sites.
  const rules: Array<Record<string, unknown>> = [];

  for (const site of sites) {
    if (!site.autheliaProtected) continue;
    const allowedUsers = site.allowedUsers ?? [];
    const hasUserList = allowedUsers.length > 0;
    if (!hasUserList && !site.restrictAccess) continue;

    if (hasUserList) {
      rules.push({
        domain: site.fqdn,
        policy: 'two_factor',
        subject: allowedUsers.map((u) => ['user:' + u]),
      });
    }

    rules.push({
      domain: site.fqdn,
      policy: 'two_factor',
      subject: [['group:admins']],
    });

    rules.push({
      domain: site.fqdn,
      policy: 'deny',
    });
  }

  const accessControl: { default_policy: string; rules?: Array<Record<string, unknown>> } = {
    default_policy: 'two_factor',
  };

  if (rules.length > 0) {
    accessControl.rules = rules;
  }

  currentConfig.access_control = accessControl;

  // Restore secrets from the authoritative .secrets.json file.
  try {
    const { stdout: secretsJson } = await exec('sudo', ['cat', AUTHELIA_SECRETS]);
    const secrets = JSON.parse(secretsJson) as Partial<AutheliaSecrets>;
    const storage = currentConfig.storage as
      | { local?: unknown; encryption_key?: string }
      | undefined;
    if (secrets.storageEncryptionKey && storage?.local) {
      storage.encryption_key = secrets.storageEncryptionKey;
    }
    if (secrets.sessionSecret && session) {
      session.secret = secrets.sessionSecret;
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

  const configContent = yaml.dump(currentConfig, {
    lineWidth: -1,
    quotingType: "'",
    forceQuotes: false,
  });

  // Backup current config before writing
  const bakPath = `${AUTHELIA_CONFIG}.bak`;
  try {
    await exec('sudo', ['cp', AUTHELIA_CONFIG, bakPath]);
  } catch {
    // first-time write or missing config — no backup needed
  }

  try {
    await sudoWriteFile(AUTHELIA_CONFIG, configContent, '600', exec);
  } catch (err: unknown) {
    throw new Error(`Failed to write Authelia configuration: ${errText(err)}`);
  }

  try {
    await reloadAuthelia(exec);
    await exec('sudo', ['rm', '-f', bakPath]).catch(() => undefined);
  } catch (restartErr: unknown) {
    try {
      await exec('sudo', ['mv', bakPath, AUTHELIA_CONFIG]);
      await reloadAuthelia(exec);
    } catch {
      // both configs may be broken — surface original error
    }
    throw restartErr;
  }
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

/**
 * Create an Authelia user from an accepted invitation.
 */
export async function createUserFromInvitation(
  username: string,
  email: string,
  groups: string[],
  hashedPassword: string,
  exec: ExecFn,
): Promise<{ username: string; created: true }> {
  let usersData: UsersYamlFile;
  try {
    usersData = await readUsersRaw(exec);
  } catch {
    usersData = { users: {} };
  }

  if (usersData.users[username]) {
    throw new Error(`User '${username}' already exists`);
  }

  usersData.users[username] = {
    displayname: username,
    email,
    password: hashedPassword,
    groups,
  };

  await writeUsers(usersData, exec);
  await reloadAuthelia(exec);

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
  const stripped = encoded.replace(/=+$/, '').toUpperCase();
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
 * The totp_secret field in users.yml is ignored. This function uses Authelia's
 * own CLI to generate/replace the TOTP config, which correctly handles
 * storage encryption.
 */
export async function writeTotpToDatabase(
  username: string,
  base32Secret: string,
  exec: ExecFn,
): Promise<void> {
  const dbPath = path.join(AUTHELIA_CONFIG_DIR, 'db.sqlite3');

  await exec('sudo', [
    AUTHELIA_BIN,
    'storage',
    'user',
    'totp',
    'generate',
    username,
    '--secret',
    base32Secret,
    '--force',
    '--issuer',
    'Lamaste',
    '--algorithm',
    'SHA1',
    '--digits',
    '6',
    '--period',
    '30',
    '--config',
    AUTHELIA_CONFIG,
    '--sqlite.path',
    dbPath,
  ]);
}
