#!/usr/bin/env node

/**
 * portlama-reset-admin — Emergency recovery tool for admin authentication.
 *
 * Requires root access on the server (run via DigitalOcean console).
 * Reverts admin auth from hardware-bound back to P12:
 *
 * 1. Generate new admin keypair + CSR + sign + P12
 * 2. Revoke old hardware-bound admin cert
 * 3. Set adminAuthMode: 'p12' in panel.json
 * 4. Reload nginx
 * 5. Print new P12 password
 */

import crypto from 'node:crypto';
import { readFile, writeFile, rename, access, constants, copyFile, unlink } from 'node:fs/promises';
import { execa } from 'execa';

const PKI_DIR = process.env.PORTLAMA_PKI_DIR || '/etc/portlama/pki';
const CONFIG_PATH = process.env.PORTLAMA_CONFIG || '/etc/portlama/panel.json';

async function main() {
  // Verify running as root
  if (process.getuid && process.getuid() !== 0) {
    console.error('Error: portlama-reset-admin must be run as root.');
    console.error('Usage: sudo portlama-reset-admin');
    process.exit(1);
  }

  console.log('');
  console.log('  Portlama Admin Reset');
  console.log('  Reverting admin authentication to P12...');
  console.log('');

  // 1. Read current config
  let config;
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    config = JSON.parse(raw);
  } catch (err) {
    console.error(`Error: Cannot read config at ${CONFIG_PATH}: ${err.message}`);
    process.exit(1);
  }

  // 2. Verify CA exists
  try {
    await access(`${PKI_DIR}/ca.key`, constants.R_OK);
    await access(`${PKI_DIR}/ca.crt`, constants.R_OK);
  } catch {
    console.error(`Error: CA key/cert not found in ${PKI_DIR}`);
    process.exit(1);
  }

  // 3. Read old admin cert serial for revocation (if it exists)
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
  console.log('  Generating new admin private key...');
  await execa('openssl', ['genrsa', '-out', `${PKI_DIR}/client.key.new`, '4096']);

  // 5. Create CSR
  console.log('  Creating certificate signing request...');
  await execa('openssl', [
    'req',
    '-new',
    '-key',
    `${PKI_DIR}/client.key.new`,
    '-out',
    `${PKI_DIR}/client.csr`,
    '-subj',
    '/CN=admin/O=Portlama',
  ]);

  // 6. Sign with CA
  console.log('  Signing certificate with CA...');
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
  console.log('  Creating PKCS12 bundle...');
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

  // 8. Back up old files (if they exist)
  console.log('  Backing up old certificates...');
  for (const ext of ['key', 'crt', 'p12']) {
    try {
      await access(`${PKI_DIR}/client.${ext}`, constants.F_OK);
      await copyFile(`${PKI_DIR}/client.${ext}`, `${PKI_DIR}/client.${ext}.bak`);
    } catch {
      // Old file may not exist
    }
  }

  // 9. Move new files into place (atomic rename)
  console.log('  Installing new certificates...');
  await rename(`${PKI_DIR}/client.key.new`, `${PKI_DIR}/client.key`);
  await rename(`${PKI_DIR}/client.crt.new`, `${PKI_DIR}/client.crt`);
  await rename(`${PKI_DIR}/client.p12.new`, `${PKI_DIR}/client.p12`);

  // 10. Persist P12 password for future redeployments
  await writeFile(`${PKI_DIR}/.p12-password`, p12Password, { mode: 0o600 });

  // 11. Clean up
  await unlink(`${PKI_DIR}/client.csr`).catch(() => {});
  await unlink(`${PKI_DIR}/ca.srl`).catch(() => {});

  // 12. Set file permissions
  await execa('chmod', ['600', `${PKI_DIR}/client.key`, `${PKI_DIR}/client.p12`]);
  await execa('chmod', ['644', `${PKI_DIR}/client.crt`]);
  await execa('chown', [
    'portlama:portlama',
    `${PKI_DIR}/client.key`,
    `${PKI_DIR}/client.crt`,
    `${PKI_DIR}/client.p12`,
  ]);

  // 13. Revoke old cert (add to revocation list)
  if (oldSerial) {
    console.log('  Revoking old admin certificate...');
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
  }

  // 14. Clear 2FA if enabled
  if (config.panel2fa && config.panel2fa.enabled) {
    config.panel2fa = { enabled: false, secret: null, setupComplete: false };
    config.sessionSecret = null;
    console.log('  Two-factor authentication has been disabled.');
  }

  // 15. Re-enable IP vhost if it was disabled by 2FA
  try {
    const ipAvailable = '/etc/nginx/sites-available/portlama-panel-ip';
    const ipEnabled = '/etc/nginx/sites-enabled/portlama-panel-ip';
    await access(ipAvailable, constants.F_OK);
    await execa('ln', ['-sf', ipAvailable, ipEnabled]);
    console.log('  IP vhost re-enabled.');
  } catch {
    // IP vhost may not exist
  }

  // 16. Update config — set adminAuthMode back to p12
  console.log('  Updating panel configuration...');
  config.adminAuthMode = 'p12';
  const configTmp = `${CONFIG_PATH}.tmp`;
  await writeFile(configTmp, JSON.stringify(config, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o640,
  });
  await rename(configTmp, CONFIG_PATH);
  await execa('chown', ['portlama:portlama', CONFIG_PATH]);

  // 17. Reload nginx
  console.log('  Reloading nginx...');
  try {
    await execa('nginx', ['-t']);
    await execa('systemctl', ['reload', 'nginx']);
    console.log('  nginx reloaded successfully.');
  } catch (err) {
    console.error(`  Warning: nginx reload failed: ${err.stderr || err.message}`);
    console.error('  You may need to restart nginx manually: systemctl restart nginx');
  }

  // 18. Print result
  console.log('');
  console.log('  ============================================');
  console.log('  Admin certificate has been reset to P12.');
  console.log('  Panel 2FA has been disabled (if it was on).');
  console.log('  IP:9292 access has been restored.');
  console.log('');
  console.log(`  P12 Password: (saved in ${PKI_DIR}/.p12-password)`);
  console.log(`  P12 File:     ${PKI_DIR}/client.p12`);
  console.log('');
  console.log('  Download the P12 from the panel or copy it');
  console.log('  manually from the server.');
  console.log('  ============================================');
  console.log('');
}

main().catch((err) => {
  console.error(`\n  Fatal error: ${err.message}\n`);
  process.exit(1);
});
