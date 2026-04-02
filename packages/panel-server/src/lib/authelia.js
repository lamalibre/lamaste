import { execa } from 'execa';
import { writeFile as fsWriteFile } from 'node:fs/promises';
import { access, constants } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import bcrypt from 'bcryptjs';

const AUTHELIA_BIN = '/usr/local/bin/authelia';
const AUTHELIA_SERVICE = 'authelia';
const AUTHELIA_CONFIG_DIR = '/etc/authelia';
const AUTHELIA_CONFIG = path.join(AUTHELIA_CONFIG_DIR, 'configuration.yml');
const AUTHELIA_USERS = path.join(AUTHELIA_CONFIG_DIR, 'users.yml');
const AUTHELIA_SECRETS = path.join(AUTHELIA_CONFIG_DIR, '.secrets.json');
const AUTHELIA_LOG_DIR = '/var/log/authelia';
const GITHUB_API = 'https://api.github.com/repos/authelia/authelia/releases/latest';

/**
 * Check if a file exists at the given path.
 */
async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the currently installed Authelia version, or null if not installed.
 *
 * Authelia may output version info to stdout or stderr depending on the version,
 * so we check both. We also try the `version` subcommand as a fallback.
 */
async function getInstalledVersion() {
  // Try `authelia --version` first (older versions)
  try {
    const { stdout, stderr } = await execa(AUTHELIA_BIN, ['--version']);
    const output = (stdout || stderr || '').trim();
    if (output) return output;
  } catch {
    // --version may not be recognized in newer versions
  }

  // Try `authelia version` subcommand (newer versions, e.g., 4.38+)
  try {
    const { stdout, stderr } = await execa(AUTHELIA_BIN, ['version']);
    const output = (stdout || stderr || '').trim();
    if (output) return output;
  } catch {
    // Neither worked
  }

  return null;
}

/**
 * Write content to a system path using a temp file and sudo mv.
 */
async function sudoWriteFile(destPath, content, mode = '644') {
  const tmpFile = path.join(tmpdir(), `portlama-authelia-${crypto.randomBytes(4).toString('hex')}`);
  await fsWriteFile(tmpFile, content, 'utf-8');
  await execa('sudo', ['mv', tmpFile, destPath]);
  await execa('sudo', ['chmod', mode, destPath]);
}

/**
 * Download and install the Authelia binary from GitHub releases.
 */
export async function installAuthelia() {
  const exists = await fileExists(AUTHELIA_BIN);
  if (exists) {
    const version = await getInstalledVersion();
    if (version) {
      return { skipped: true, version };
    }
  }

  let releaseInfo;
  try {
    const { stdout } = await execa('curl', [
      '-s',
      '-L',
      '-H',
      'Accept: application/vnd.github+json',
      GITHUB_API,
    ]);
    releaseInfo = JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to fetch Authelia release info from GitHub: ${err.message}. Check internet connectivity.`,
    );
  }

  if (releaseInfo.message && releaseInfo.message.includes('rate limit')) {
    throw new Error(
      'GitHub API rate limit exceeded. Please try again later or set a GITHUB_TOKEN environment variable.',
    );
  }

  const { stdout: unameArch } = await execa('uname', ['-m']);
  const archMap = { x86_64: 'linux-amd64', aarch64: 'linux-arm64', arm64: 'linux-arm64' };
  const autheliaArch = archMap[unameArch.trim()] || 'linux-amd64';

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
    await execa('curl', ['-L', '-o', tmpTar, downloadUrl]);
  } catch (err) {
    throw new Error(
      `Failed to download Authelia from ${downloadUrl}: ${err.stderr || err.message}. Check internet connectivity.`,
    );
  }

  try {
    await execa('mkdir', ['-p', tmpExtractDir]);
    await execa('tar', ['xzf', tmpTar, '-C', tmpExtractDir]);

    // Find the authelia binary in extracted contents.
    // Newer releases name it 'authelia-linux-amd64', older ones just 'authelia'.
    const { stdout: findResult } = await execa('find', [
      tmpExtractDir,
      '-name',
      'authelia*',
      '-type',
      'f',
    ]);
    const candidates = findResult.trim().split('\n').filter(Boolean);

    // Prefer exact 'authelia' match, fall back to first authelia-* binary
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

    await execa('sudo', ['mv', binaryPath, AUTHELIA_BIN]);
    await execa('sudo', ['chmod', '+x', AUTHELIA_BIN]);
  } catch (err) {
    throw new Error(`Failed to install Authelia binary: ${err.stderr || err.message}`);
  } finally {
    await execa('rm', ['-rf', tmpTar, tmpExtractDir]).catch(() => {});
  }

  const version = await getInstalledVersion();
  if (!version) {
    // Gather diagnostics for the error message
    let diag = '';
    try {
      const { stdout: fileInfo } = await execa('file', [AUTHELIA_BIN]);
      diag += `file: ${fileInfo}\n`;
    } catch {
      /* ignore */
    }
    try {
      const { stdout: lsInfo } = await execa('ls', ['-la', AUTHELIA_BIN]);
      diag += `ls: ${lsInfo}\n`;
    } catch {
      /* ignore */
    }
    try {
      const result = await execa(AUTHELIA_BIN, ['--version'], { reject: false });
      diag += `--version stdout: ${result.stdout}\n--version stderr: ${result.stderr}\nexitCode: ${result.exitCode}\n`;
    } catch (e) {
      diag += `--version error: ${e.message}\n`;
    }
    throw new Error(
      `Authelia was installed but version check failed. The binary may be corrupted or incompatible.\nDiagnostics:\n${diag}`,
    );
  }

  return { installed: true, version };
}

/**
 * Write the Authelia configuration file.
 *
 * @param {string} domain - The base domain for session cookies
 * @param {object} secrets - Object with jwtSecret, sessionSecret, storageEncryptionKey
 */
export async function writeAutheliaConfig(domain, secrets) {
  const { jwtSecret, sessionSecret, storageEncryptionKey } = secrets;

  // Create directories
  try {
    await execa('sudo', ['mkdir', '-p', AUTHELIA_CONFIG_DIR]);
    await execa('sudo', ['mkdir', '-p', AUTHELIA_LOG_DIR]);
  } catch (err) {
    throw new Error(`Failed to create Authelia directories: ${err.stderr || err.message}`);
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
        name: 'portlama_session',
        secret: sessionSecret,
        cookies: [
          {
            domain: domain,
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
        issuer: 'Portlama',
        period: 30,
        digits: 6,
      },
    },
    { lineWidth: -1 },
  );

  try {
    await sudoWriteFile(AUTHELIA_CONFIG, configContent, '600');
  } catch (err) {
    throw new Error(`Failed to write Authelia configuration: ${err.stderr || err.message}`);
  }

  // Store secrets reference
  const secretsContent =
    JSON.stringify({ jwtSecret, sessionSecret, storageEncryptionKey }, null, 2) + '\n';
  try {
    await sudoWriteFile(AUTHELIA_SECRETS, secretsContent, '600');
  } catch (err) {
    throw new Error(`Failed to write Authelia secrets file: ${err.stderr || err.message}`);
  }

  return AUTHELIA_CONFIG;
}

/**
 * Create an Authelia user with a bcrypt-hashed password.
 *
 * @param {string} username
 * @param {string} password
 */
export async function createUser(username, password) {
  // Hash using bcryptjs (cost 12) — same algorithm Authelia expects, no CLI dependency.
  const hash = await bcrypt.hash(password, 12);

  if (!hash || !hash.startsWith('$2')) {
    throw new Error(`Bcrypt hashing produced invalid output: ${hash}`);
  }

  // Read existing users or start fresh
  let usersData = { users: {} };
  try {
    const { stdout } = await execa('sudo', ['cat', AUTHELIA_USERS]);
    const parsed = yaml.load(stdout);
    if (parsed && parsed.users) {
      usersData = parsed;
    }
  } catch {
    // File doesn't exist or is empty — start fresh
  }

  usersData.users[username] = {
    displayname: username,
    password: hash,
    email: `${username}@portlama.local`,
    groups: ['admins'],
  };

  await writeUsers(usersData);

  return { username, created: true };
}

/**
 * Read the Authelia users file and return user info (without password hashes).
 */
export async function readUsers() {
  try {
    const { stdout } = await execa('sudo', ['cat', AUTHELIA_USERS]);
    const parsed = yaml.load(stdout);

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
 *
 * @param {object} usersData - The full users YAML object with a users key
 */
export async function writeUsers(usersData) {
  const yamlContent = yaml.dump(usersData, { lineWidth: -1 });

  try {
    await sudoWriteFile(AUTHELIA_USERS, yamlContent, '600');
  } catch (err) {
    throw new Error(`Failed to write Authelia users file: ${err.stderr || err.message}`);
  }
}

/**
 * Write the Authelia systemd service unit file.
 */
export async function writeAutheliaService() {
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
    await execa('sudo', ['mv', tmpFile, '/etc/systemd/system/authelia.service']);
    await execa('sudo', ['chmod', '644', '/etc/systemd/system/authelia.service']);
    await execa('sudo', ['systemctl', 'daemon-reload']);
  } catch (err) {
    throw new Error(`Failed to write Authelia service file: ${err.stderr || err.message}`);
  }

  return '/etc/systemd/system/authelia.service';
}

/**
 * Enable and start the Authelia systemd service.
 */
export async function startAuthelia() {
  try {
    await execa('sudo', ['systemctl', 'enable', AUTHELIA_SERVICE]);
    await execa('sudo', ['systemctl', 'start', AUTHELIA_SERVICE]);
  } catch (err) {
    throw new Error(`Failed to start Authelia service: ${err.stderr || err.message}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const { stdout } = await execa('systemctl', ['is-active', AUTHELIA_SERVICE]);
    if (stdout.trim() === 'active') {
      return { active: true };
    }
  } catch {
    // is-active returns non-zero for inactive
  }

  let journalOutput = '';
  try {
    const { stdout } = await execa('journalctl', [
      '-u',
      AUTHELIA_SERVICE,
      '--no-pager',
      '-n',
      '10',
    ]);
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
export async function reloadAuthelia() {
  try {
    await execa('sudo', ['systemctl', 'restart', AUTHELIA_SERVICE]);
  } catch (err) {
    throw new Error(`Failed to restart Authelia service: ${err.stderr || err.message}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const { stdout } = await execa('systemctl', ['is-active', AUTHELIA_SERVICE]);
    if (stdout.trim() === 'active') {
      return { active: true };
    }
  } catch {
    // is-active returns non-zero for inactive
  }

  throw new Error('Authelia service is not active after restart.');
}

/**
 * Update the Authelia access_control configuration based on protected sites.
 *
 * Reads the existing configuration, replaces the access_control section with
 * per-site rules, writes the config atomically, and restarts Authelia.
 *
 * @param {Array<{ fqdn: string, autheliaProtected: boolean, allowedUsers?: string[] }>} sites
 */
export async function updateAccessControl(sites) {
  // Read current config
  let currentConfig;
  try {
    const { stdout } = await execa('sudo', ['cat', AUTHELIA_CONFIG]);
    currentConfig = yaml.load(stdout);
  } catch (err) {
    throw new Error(`Failed to read Authelia configuration: ${err.stderr || err.message}`);
  }

  if (!currentConfig) {
    throw new Error('Authelia configuration is empty or invalid');
  }

  // Migrate session config from old format (session.domain) to new format (session.cookies)
  // needed for Authelia 4.38+
  if (currentConfig.session && currentConfig.session.domain && !currentConfig.session.cookies) {
    const oldDomain = currentConfig.session.domain;
    currentConfig.session.cookies = [
      {
        domain: oldDomain,
        authelia_url: `https://auth.${oldDomain}`,
        default_redirection_url: `https://${oldDomain}`,
      },
    ];
    delete currentConfig.session.domain;
  }

  // Fix: default_redirection_url must differ from authelia_url (Authelia 4.38+ requirement)
  if (currentConfig.session?.cookies) {
    for (const cookie of currentConfig.session.cookies) {
      if (cookie.default_redirection_url === cookie.authelia_url) {
        cookie.default_redirection_url = `https://${cookie.domain}`;
      }
    }
  }

  // Migrate deprecated server.host/port to server.address
  if (currentConfig.server && (currentConfig.server.host || currentConfig.server.port)) {
    const host = currentConfig.server.host || '127.0.0.1';
    const port = currentConfig.server.port || 9091;
    currentConfig.server = { address: `tcp://${host}:${port}/` };
  }

  // Migrate deprecated jwt_secret to identity_validation.reset_password.jwt_secret
  if (currentConfig.jwt_secret) {
    if (!currentConfig.identity_validation) {
      currentConfig.identity_validation = {};
    }
    if (!currentConfig.identity_validation.reset_password) {
      currentConfig.identity_validation.reset_password = {};
    }
    if (!currentConfig.identity_validation.reset_password.jwt_secret) {
      currentConfig.identity_validation.reset_password.jwt_secret = currentConfig.jwt_secret;
    }
    delete currentConfig.jwt_secret;
  }

  // Build access_control rules from protected sites.
  //
  // Authelia evaluates rules top-to-bottom, first match wins.
  // For sites with allowedUsers:
  //   1. Allow rule with subject list (matched users get two_factor)
  //   2. Deny rule for the same domain (everyone else is denied)
  // Two access patterns:
  //   1. Open: autheliaProtected=true, no allowedUsers or empty array, no restrictAccess flag
  //      → default_policy: two_factor applies (any authenticated user)
  //   2. Restricted: allowedUsers array with entries, OR restrictAccess=true
  //      → per-user rules + admins group + deny fallback
  // Plugin tunnels set restrictAccess=true so even empty allowedUsers generates
  // deny rules (admins-only until grants are created).
  const rules = [];

  for (const site of sites) {
    if (!site.autheliaProtected) continue;
    const hasUserList = site.allowedUsers && site.allowedUsers.length > 0;
    if (!hasUserList && !site.restrictAccess) continue;

    // Allow specific users (if any)
    if (site.allowedUsers.length > 0) {
      rules.push({
        domain: site.fqdn,
        policy: 'two_factor',
        subject: site.allowedUsers.map((u) => ['user:' + u]),
      });
    }

    // Allow admins group (always has access to restricted subdomains)
    rules.push({
      domain: site.fqdn,
      policy: 'two_factor',
      subject: [['group:admins']],
    });

    // Deny everyone else for this domain
    rules.push({
      domain: site.fqdn,
      policy: 'deny',
    });
  }

  // default_policy: two_factor means any authenticated user can access
  // domains that don't have explicit deny rules above.
  currentConfig.access_control = {
    default_policy: 'two_factor',
  };

  if (rules.length > 0) {
    currentConfig.access_control.rules = rules;
  }

  // Restore secrets from the authoritative .secrets.json file.
  // The YAML load/dump round-trip can corrupt secret values if they contain
  // characters that js-yaml interprets as non-string types (e.g. hex-like
  // strings, scientific notation). Reading from secrets.json ensures we
  // always write the exact original values that the database was created with.
  try {
    const { stdout: secretsJson } = await execa('sudo', ['cat', AUTHELIA_SECRETS]);
    const secrets = JSON.parse(secretsJson);
    if (secrets.storageEncryptionKey && currentConfig.storage?.local) {
      currentConfig.storage.encryption_key = secrets.storageEncryptionKey;
    }
    if (secrets.sessionSecret && currentConfig.session) {
      currentConfig.session.secret = secrets.sessionSecret;
    }
    if (secrets.jwtSecret) {
      if (currentConfig.identity_validation?.reset_password) {
        currentConfig.identity_validation.reset_password.jwt_secret = secrets.jwtSecret;
      }
    }
  } catch {
    // Secrets file may not exist on older installations — proceed with
    // whatever values the YAML round-trip produced.
  }

  // Write updated config with forced quoting to prevent YAML type coercion
  const configContent = yaml.dump(currentConfig, {
    lineWidth: -1,
    quotingType: "'",
    forceQuotes: false,
  });
  // Backup current config before writing — allows rollback if Authelia fails to restart
  const bakPath = `${AUTHELIA_CONFIG}.bak`;
  try {
    await execa('sudo', ['cp', AUTHELIA_CONFIG, bakPath]);
  } catch {
    // First-time write or missing config — no backup needed
  }

  try {
    await sudoWriteFile(AUTHELIA_CONFIG, configContent, '600');
  } catch (err) {
    throw new Error(`Failed to write Authelia configuration: ${err.stderr || err.message}`);
  }

  // Restart Authelia to pick up config changes; rollback on failure
  try {
    await reloadAuthelia();
    // Clean up backup on success
    await execa('sudo', ['rm', '-f', bakPath]).catch(() => {});
  } catch (restartErr) {
    // Restore backup and attempt recovery restart
    try {
      await execa('sudo', ['mv', bakPath, AUTHELIA_CONFIG]);
      await reloadAuthelia();
    } catch {
      // Recovery failed — both configs may be broken, manual intervention needed
    }
    throw restartErr;
  }
}

/**
 * Create an Authelia user from an accepted invitation.
 *
 * @param {string} username - Pre-assigned username from the invitation
 * @param {string} email - Pre-assigned email from the invitation
 * @param {string[]} groups - Pre-assigned groups from the invitation
 * @param {string} hashedPassword - Already-hashed bcrypt password
 */
export async function createUserFromInvitation(username, email, groups, hashedPassword) {
  let usersData;
  try {
    usersData = await readUsersRaw();
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

  await writeUsers(usersData);
  await reloadAuthelia();

  return { username, created: true };
}

/**
 * Check whether the Authelia service is currently running.
 */
export async function isAutheliaRunning() {
  try {
    const { stdout } = await execa('systemctl', ['is-active', AUTHELIA_SERVICE]);
    return stdout.trim() === 'active';
  } catch {
    return false;
  }
}

/**
 * Read the raw users.yml data, returning the full object including passwords.
 * Used internally by CRUD operations that need to modify and re-write the file.
 *
 * @returns {object} The parsed users.yml content with a `users` key
 * @throws {Error} If the file cannot be read or parsed
 */
export async function readUsersRaw() {
  const { stdout } = await execa('sudo', ['cat', AUTHELIA_USERS]);
  const parsed = yaml.load(stdout);
  if (!parsed || !parsed.users) {
    return { users: {} };
  }
  return parsed;
}

/**
 * Hash a password with bcrypt cost factor 12.
 *
 * @param {string} password - The plaintext password
 * @returns {Promise<string>} The bcrypt hash
 */
export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

/**
 * Encode a Buffer as a base32 string (RFC 4648).
 *
 * @param {Buffer} buffer - The bytes to encode
 * @returns {string} The base32-encoded string
 */
export function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
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
 *
 * @param {string} encoded - The base32-encoded string
 * @returns {Buffer}
 */
export function base32Decode(encoded) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const stripped = encoded.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const output = [];

  for (let i = 0; i < stripped.length; i++) {
    const idx = alphabet.indexOf(stripped[i]);
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
 *
 * @param {string} username - The username to generate TOTP for
 * @param {object} [opts] - Options
 * @param {string} [opts.issuer] - Issuer name (default: 'Portlama')
 * @returns {{ secret: string, uri: string }} The base32 secret and otpauth URI
 */
export function generateTotpSecret(username, opts) {
  const issuer = opts?.issuer || 'Portlama';
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
 *
 * @param {string} username - The username to set TOTP for
 * @param {string} base32Secret - The base32-encoded secret
 */
export async function writeTotpToDatabase(username, base32Secret) {
  const dbPath = path.join(AUTHELIA_CONFIG_DIR, 'db.sqlite3');

  await execa('sudo', [
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
    'Portlama',
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
