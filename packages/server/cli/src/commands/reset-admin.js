/**
 * lamaste-server reset-admin — Emergency recovery tool for admin authentication.
 *
 * Requires root access on the server (run via DigitalOcean console).
 * Reverts admin auth from hardware-bound back to P12:
 *
 * 1. Generate new admin keypair + CSR + sign + P12
 * 2. Revoke old hardware-bound admin cert
 * 3. Set adminAuthMode: 'p12' in panel.json
 * 4. Clear 2FA if enabled
 * 5. Re-enable IP:9292 vhost
 * 6. Restart serverd + reload nginx
 * 7. Print new P12 password
 */

import crypto from 'node:crypto';
import {
  readFile,
  writeFile,
  rename,
  access,
  constants,
  copyFile,
  unlink,
  open,
} from 'node:fs/promises';
import chalk from 'chalk';
import { execa } from 'execa';
import { CONFIG_PATH, PKI_DIR, PANEL_SERVICE } from '../config.js';
import { emitStep, emitError, emitComplete } from '../ndjson.js';

/**
 * Atomically write the P12 password to a file (temp -> fsync -> chmod -> rename).
 * @param {string} destPath
 * @param {string} password
 */
async function atomicWritePassword(destPath, password) {
  const tmpPath = `${destPath}.tmp`;
  // Best-effort cleanup of a stale temp from a prior crashed run so 'wx' below
  // does not spuriously fail.
  await unlink(tmpPath).catch(() => {});
  // Use 'wx' to fail if a stale temp file exists (avoids races).
  const fh = await open(tmpPath, 'wx', 0o600);
  try {
    await fh.writeFile(password, 'utf-8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmpPath, destPath);
}

/**
 * @param {{ json: boolean, passwordFile?: string }} options
 */
export async function runResetAdmin({ json, passwordFile }) {
  // Verify running as root
  if (process.getuid && process.getuid() !== 0) {
    const msg = 'lamaste-server reset-admin must be run as root.';
    if (json) {
      emitError(msg);
    } else {
      console.error(`\n  Error: ${msg}`);
      console.error(`  Usage: sudo lamaste-server reset-admin\n`);
    }
    process.exit(1);
  }

  if (!json) {
    console.log('');
    console.log('  Lamaste Admin Reset');
    console.log('  Reverting admin authentication to P12...');
    console.log('');
  }

  // 1. Read current config
  if (json) emitStep('read-config', 'running');
  let config;
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    config = JSON.parse(raw);
    if (json) emitStep('read-config', 'complete');
  } catch (err) {
    const msg = `Cannot read config at ${CONFIG_PATH}: ${err.message}`;
    if (json) {
      emitStep('read-config', 'failed', msg);
      emitError(msg);
    } else {
      console.error(`  Error: ${msg}`);
    }
    process.exit(1);
  }

  // 2. Verify CA exists
  try {
    await access(`${PKI_DIR}/ca.key`, constants.R_OK);
    await access(`${PKI_DIR}/ca.crt`, constants.R_OK);
  } catch {
    const msg = `CA key/cert not found in ${PKI_DIR}`;
    if (json) emitError(msg);
    else console.error(`  Error: ${msg}`);
    process.exit(1);
  }

  // 3. Read old admin cert serial for revocation
  if (json) emitStep('generate-cert', 'running');
  let oldSerial = '';
  try {
    const { stdout } = await execa('openssl', [
      'x509',
      '-in',
      `${PKI_DIR}/client.crt`,
      '-serial',
      '-noout',
    ]);
    const match = stdout.match(/serial=([A-Fa-f0-9]+)/);
    oldSerial = match ? match[1] : '';
  } catch {
    // Old cert may not exist
  }

  // 4. Generate new admin key
  if (!json) console.log('  Generating new admin private key...');
  await execa('openssl', ['genrsa', '-out', `${PKI_DIR}/client.key.new`, '4096']);

  // 5. Create CSR
  if (!json) console.log('  Creating certificate signing request...');
  await execa('openssl', [
    'req',
    '-new',
    '-key',
    `${PKI_DIR}/client.key.new`,
    '-out',
    `${PKI_DIR}/client.csr`,
    '-subj',
    '/CN=admin/O=Lamaste',
  ]);

  // 6. Sign with CA
  if (!json) console.log('  Signing certificate with CA...');
  await execa('openssl', [
    'x509',
    '-req',
    '-in',
    `${PKI_DIR}/client.csr`,
    '-CA',
    `${PKI_DIR}/ca.crt`,
    '-CAkey',
    `${PKI_DIR}/ca.key`,
    '-CAcreateserial',
    '-out',
    `${PKI_DIR}/client.crt.new`,
    '-days',
    '730',
    '-sha256',
  ]);

  // 7. Create P12 bundle
  const p12Password = crypto.randomBytes(16).toString('hex');
  if (!json) console.log('  Creating PKCS12 bundle...');
  await execa(
    'openssl',
    [
      'pkcs12',
      '-export',
      '-keypbe',
      'PBE-SHA1-3DES',
      '-certpbe',
      'PBE-SHA1-3DES',
      '-macalg',
      'sha1',
      '-out',
      `${PKI_DIR}/client.p12.new`,
      '-inkey',
      `${PKI_DIR}/client.key.new`,
      '-in',
      `${PKI_DIR}/client.crt.new`,
      '-certfile',
      `${PKI_DIR}/ca.crt`,
      '-passout',
      'stdin',
    ],
    { input: p12Password },
  );

  if (json) emitStep('generate-cert', 'complete');

  // 8. Back up old files
  if (json) emitStep('backup', 'running');
  else console.log('  Backing up old certificates...');
  for (const ext of ['key', 'crt', 'p12']) {
    try {
      await access(`${PKI_DIR}/client.${ext}`, constants.F_OK);
      await copyFile(`${PKI_DIR}/client.${ext}`, `${PKI_DIR}/client.${ext}.bak`);
    } catch {
      // Old file may not exist
    }
  }
  if (json) emitStep('backup', 'complete');

  // 9. Move new files into place (atomic rename)
  if (json) emitStep('install-cert', 'running');
  else console.log('  Installing new certificates...');
  await rename(`${PKI_DIR}/client.key.new`, `${PKI_DIR}/client.key`);
  await rename(`${PKI_DIR}/client.crt.new`, `${PKI_DIR}/client.crt`);
  await rename(`${PKI_DIR}/client.p12.new`, `${PKI_DIR}/client.p12`);

  // 10. Persist P12 password for future redeployments and for NDJSON consumers.
  // Atomic write (temp -> fsync -> chmod 0600 -> rename) so partial writes never
  // expose the secret. Hard-fail if the write fails — never fall back to emitting
  // the password value over stdout.
  const defaultPasswordPath = `${PKI_DIR}/.p12-password`;
  const targetPasswordPath = passwordFile || defaultPasswordPath;
  try {
    await atomicWritePassword(defaultPasswordPath, p12Password);
    if (targetPasswordPath !== defaultPasswordPath) {
      await atomicWritePassword(targetPasswordPath, p12Password);
    }
  } catch (err) {
    const msg = `Failed to write P12 password file: ${err.message}`;
    if (json) {
      emitError(msg);
    } else {
      console.error(`  Error: ${msg}`);
    }
    process.exit(1);
  }

  // 11. Clean up
  await unlink(`${PKI_DIR}/client.csr`).catch(() => {});
  await unlink(`${PKI_DIR}/ca.srl`).catch(() => {});

  // 12. Set file permissions
  await execa('chmod', ['600', `${PKI_DIR}/client.key`, `${PKI_DIR}/client.p12`]);
  await execa('chmod', ['644', `${PKI_DIR}/client.crt`]);
  await execa('chown', [
    'lamaste:lamaste',
    `${PKI_DIR}/client.key`,
    `${PKI_DIR}/client.crt`,
    `${PKI_DIR}/client.p12`,
  ]);

  if (json) emitStep('install-cert', 'complete');

  // 13. Revoke old cert
  if (oldSerial) {
    if (json) emitStep('revoke-old', 'running');
    else console.log('  Revoking old admin certificate...');
    const revocationPath = `${PKI_DIR}/revoked.json`;
    let revoked = { revoked: [] };
    try {
      const raw = await readFile(revocationPath, 'utf-8');
      revoked = JSON.parse(raw);
    } catch {
      // File may not exist
    }
    if (!revoked.revoked.some((e) => e.serial === oldSerial)) {
      revoked.revoked.push({
        serial: oldSerial,
        label: 'admin (reset from hardware-bound)',
        revokedAt: new Date().toISOString(),
      });
      const tmpPath = `${revocationPath}.tmp`;
      await writeFile(tmpPath, JSON.stringify(revoked, null, 2) + '\n', 'utf-8');
      await rename(tmpPath, revocationPath);
    }
    if (json) emitStep('revoke-old', 'complete');
  }

  // 14. Clear 2FA if enabled
  if (config.panel2fa && config.panel2fa.enabled) {
    config.panel2fa = { enabled: false, secret: null, setupComplete: false };
    config.sessionSecret = null;
    if (!json) console.log('  Two-factor authentication has been disabled.');
  }

  // 15. Re-enable IP vhost if it was disabled by 2FA
  if (json) emitStep('config', 'running');
  try {
    const ipAvailable = '/etc/nginx/sites-available/lamalibre-lamaste-panel-ip';
    const ipEnabled = '/etc/nginx/sites-enabled/lamalibre-lamaste-panel-ip';
    await access(ipAvailable, constants.F_OK);
    await execa('ln', ['-sf', ipAvailable, ipEnabled]);
    if (!json) console.log('  IP vhost re-enabled.');
  } catch {
    // IP vhost may not exist
  }

  // 16. Update config
  if (!json) console.log('  Updating panel configuration...');
  config.adminAuthMode = 'p12';
  const configTmp = `${CONFIG_PATH}.tmp`;
  await writeFile(configTmp, JSON.stringify(config, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o640,
  });
  await rename(configTmp, CONFIG_PATH);
  await execa('chown', ['lamaste:lamaste', CONFIG_PATH]);
  if (json) emitStep('config', 'complete');

  // 17. Restart serverd
  if (json) emitStep('restart', 'running');
  else console.log('  Restarting panel server...');
  try {
    await execa('systemctl', ['restart', PANEL_SERVICE]);
    if (!json) console.log('  Panel server restarted successfully.');
  } catch (err) {
    const msg = `panel server restart failed: ${err.stderr || err.message}`;
    if (!json) {
      console.error(`  Warning: ${msg}`);
      console.error(`  You may need to restart it manually: systemctl restart ${PANEL_SERVICE}`);
    }
  }

  // 18. Reload nginx
  if (!json) console.log('  Reloading nginx...');
  try {
    await execa('nginx', ['-t']);
    await execa('systemctl', ['reload', 'nginx']);
    if (!json) console.log('  nginx reloaded successfully.');
  } catch (err) {
    const msg = `nginx reload failed: ${err.stderr || err.message}`;
    if (!json) {
      console.error(`  Warning: ${msg}`);
      console.error('  You may need to restart nginx manually: systemctl restart nginx');
    }
  }

  if (json) {
    emitStep('restart', 'complete');
    // SECURITY: never emit the password value in NDJSON. The password lives at
    // p12PasswordPath (mode 0600). Consumers (the desktop app) read the file
    // directly via privileged escalation (e.g. `pkexec cat`) and store it in
    // the OS keychain. The path-only contract avoids leaks into Tauri event
    // logs, journald, or anything else that captures NDJSON.
    emitComplete({ p12PasswordPath: targetPasswordPath });
    return;
  }

  // 19. Determine IP for scp command
  let serverIp = '';
  try {
    const { stdout } = await execa('hostname', ['-I']);
    const first = stdout.trim().split(/\s+/)[0];
    if (first) serverIp = first;
  } catch {
    serverIp = '<server-ip>';
  }

  // 20. Print result
  const b = chalk.bold;
  const c = chalk.cyan;
  const d = chalk.dim;

  console.log('');
  console.log('  ' + '='.repeat(44));
  console.log(b('  Admin certificate has been reset to P12.'));
  console.log(b('  Panel 2FA has been disabled (if it was on).'));
  console.log(b('  IP:9292 access has been restored.'));
  console.log('');
  console.log('  1. Download your client certificate:');
  console.log('');
  console.log(`     ${c(`scp root@${serverIp}:${PKI_DIR}/client.p12 .`)}`);
  console.log('');
  console.log('  2. Import client.p12 into your browser:');
  console.log('');
  console.log(`     ${d('macOS:   Double-click the file \u2192 Keychain Access')}`);
  console.log(
    `     ${d('         \u2192 select "System" keychain \u2192 enter the password below')}`,
  );
  console.log(
    `     ${d('         \u2192 find cert \u2192 double-click \u2192 Trust \u2192 Always Trust')}`,
  );
  console.log(`     ${d('Linux:   Chrome \u2192 Settings \u2192 Privacy & Security')}`);
  console.log(`     ${d('         \u2192 Security \u2192 Manage certificates \u2192 Import')}`);
  console.log(`     ${d('Windows: Double-click the file \u2192 Certificate Import Wizard')}`);
  console.log('');
  // SECURITY: the certificate password is printed to STDERR (not stdout) so
  // operators can redirect stdout to a log without capturing the secret:
  //   sudo lamaste-server reset-admin > reset.log
  // The password is also persisted to ${PKI_DIR}/.p12-password (mode 0600,
  // root-readable only) — the source of truth for redeployment scripts and
  // for the desktop app, which reads it via privileged escalation.
  console.log('  3. Certificate password:');
  console.log('');
  console.log(`     ${d(`(also stored at ${defaultPasswordPath}, mode 0600)`)}`);
  console.log('');
  console.error(`     ${b(p12Password)}`);
  console.log('');
  console.log('  4. Open the Lamaste panel:');
  console.log('');
  console.log(`     ${c(`https://${serverIp}:9292`)}`);
  console.log('');
  console.log('  ' + '='.repeat(44));
  console.log('');
}
