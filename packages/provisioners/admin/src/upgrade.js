import { createInterface } from 'node:readline';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile, unlink, mkdir, readFile, rm, chmod, open, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { Listr } from 'listr2';
import chalk from 'chalk';
import { execa } from 'execa';

// ---------------------------------------------------------------------------
// Branded identifiers — single source of truth for this package.
// Mirrors `ORG` / `PROJECT` in @lamalibre/lamaste/agent. Inlined (rather
// than imported) so this provisioner stays free of the core lib dep.
// ---------------------------------------------------------------------------
const ORG = process.env.LAMALIBRE_ORG ?? 'lamalibre';
const PROJECT = process.env.LAMALIBRE_PROJECT ?? 'lamaste';

/**
 * Prompt for user input via readline.
 * @param {string} question
 * @param {string} [defaultValue]
 * @returns {Promise<string>}
 */
function prompt(question, defaultValue) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const suffix = defaultValue ? ` ${chalk.dim(`[${defaultValue}]`)}` : '';

  return new Promise((resolvePromise) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      rl.close();
      resolvePromise(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * Atomically write the P12 password to a file (temp -> fsync -> rename, mode 0600).
 * @param {string} destPath
 * @param {string} password
 */
async function atomicWritePassword(destPath, password) {
  const tmpPath = `${destPath}.tmp`;
  await unlink(tmpPath).catch(() => {});
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
 * Overwrite a file with random bytes, then unlink it.
 * @param {string} filePath
 */
async function secureDelete(filePath) {
  try {
    const { size } = await import('node:fs').then((fs) => fs.promises.stat(filePath));
    const randomData = crypto.randomBytes(Math.min(size, 16384));
    await writeFile(filePath, randomData);
    await unlink(filePath);
  } catch {
    await unlink(filePath).catch(() => {});
  }
}

/**
 * Create a temporary curl config file for P12 authentication.
 * @param {string} p12Path
 * @param {string} p12Password
 * @returns {Promise<string>} Path to the config file
 */
async function createCurlConfig(p12Path, p12Password) {
  const suffix = crypto.randomBytes(8).toString('hex');
  const adminTmp = join(homedir(), `.${ORG}`, `.${PROJECT}`, 'tmp', 'admin');
  await mkdir(adminTmp, { recursive: true, mode: 0o700 });
  const configPath = join(adminTmp, `curl-${suffix}.tmp`);
  const escapedPath = p12Path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedPass = p12Password.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const content = `cert = "${escapedPath}:${escapedPass}"\ncert-type = "P12"\n`;
  await writeFile(configPath, content, { flag: 'wx', mode: 0o600 });
  return configPath;
}

/**
 * Core upgrade logic shared between interactive and JSON modes.
 *
 * @param {object} ctx - Must contain: panelUrl, p12Path, p12Password, outputP12Path
 * @param {(step: string, status: string, output?: string) => void} onStep - Progress callback
 * @returns {Promise<{p12Path: string, p12Password: string, identity: string}>}
 */
async function runUpgradeSteps(ctx, onStep) {
  const tmpDir = join(homedir(), `.${ORG}`, `.${PROJECT}`, 'tmp', 'admin', 'upgrade');
  const keyPath = join(tmpDir, 'admin.key');
  const csrPath = join(tmpDir, 'admin.csr');
  const certPath = join(tmpDir, 'admin.crt');
  const caPath = join(tmpDir, 'ca.crt');
  const p12ImportPath = join(tmpDir, 'admin-import.p12');

  let certPem = null;
  let caCertPem = null;
  let csrPem = null;

  const cleanup = async () => {
    for (const f of [keyPath, csrPath, certPath, caPath, p12ImportPath]) {
      await secureDelete(f);
    }
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    // Step 1: Verify panel connectivity
    onStep('verify-panel', 'running');
    const configPath1 = await createCurlConfig(ctx.p12Path, ctx.p12Password);
    try {
      const { stdout } = await execa('curl', [
        '-K',
        configPath1,
        '-s',
        '-f',
        '--max-time',
        '30',
        '-k',
        `${ctx.panelUrl}/api/health`,
      ]);
      const health = JSON.parse(stdout);
      onStep('verify-panel', 'complete', `Panel reachable (status: ${health.status || 'ok'})`);
    } finally {
      await unlink(configPath1).catch(() => {});
    }

    // Step 2: Check admin auth mode
    onStep('check-auth-mode', 'running');
    const configPath2 = await createCurlConfig(ctx.p12Path, ctx.p12Password);
    try {
      const { stdout } = await execa('curl', [
        '-K',
        configPath2,
        '-s',
        '-f',
        '--max-time',
        '30',
        '-k',
        `${ctx.panelUrl}/api/certs/admin/auth-mode`,
      ]);
      const data = JSON.parse(stdout);
      if (data.adminAuthMode === 'hardware-bound') {
        throw new Error('Admin is already using hardware-bound authentication.');
      }
      onStep('check-auth-mode', 'complete', `Current mode: ${data.adminAuthMode || 'p12'}`);
    } finally {
      await unlink(configPath2).catch(() => {});
    }

    // Step 3: Generate keypair and CSR
    onStep('generate-keypair', 'running');
    await mkdir(tmpDir, { recursive: true, mode: 0o700 });
    await execa('openssl', ['genrsa', '-out', keyPath, '4096']);
    await chmod(keyPath, 0o600);
    await execa('openssl', [
      'req',
      '-new',
      '-key',
      keyPath,
      '-out',
      csrPath,
      '-subj',
      '/CN=admin/O=Lamaste',
    ]);
    csrPem = await readFile(csrPath, 'utf-8');
    onStep('generate-keypair', 'complete', 'Keypair generated (4096-bit RSA)');

    // Step 4: Upgrade admin certificate on panel (POINT OF NO RETURN)
    onStep('upgrade-cert', 'running');
    const configPath3 = await createCurlConfig(ctx.p12Path, ctx.p12Password);
    try {
      const { stdout } = await execa('curl', [
        '-K',
        configPath3,
        '-s',
        '-f',
        '--max-time',
        '60',
        '-k',
        '-X',
        'POST',
        '-H',
        'Content-Type: application/json',
        '-d',
        JSON.stringify({ csr: csrPem }),
        `${ctx.panelUrl}/api/certs/admin/upgrade-to-hardware-bound`,
      ]);
      const result = JSON.parse(stdout);
      if (!result.ok) {
        throw new Error(result.error || 'Upgrade failed');
      }
      certPem = result.cert;
      caCertPem = result.caCert;
      onStep(
        'upgrade-cert',
        'complete',
        `Certificate signed (serial: ${result.serial}, expires: ${result.expiresAt})`,
      );
    } finally {
      await unlink(configPath3).catch(() => {});
    }

    // Write cert and CA to temp files for subsequent steps
    await writeFile(certPath, certPem, { mode: 0o600 });
    await writeFile(caPath, caCertPem, { mode: 0o600 });

    // Step 5: Create output P12 for curl-based tools
    onStep('create-p12', 'running');
    const newP12Password = crypto.randomBytes(16).toString('hex');
    const outputP12Path = ctx.outputP12Path || join(tmpDir, 'admin.p12');

    // Ensure parent directory exists
    const outputDir = resolve(outputP12Path, '..');
    await mkdir(outputDir, { recursive: true, mode: 0o700 });

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
        outputP12Path,
        '-inkey',
        keyPath,
        '-in',
        certPath,
        '-certfile',
        caPath,
        '-name',
        'admin',
        '-passout',
        'env:LAMALIBRE_LAMASTE_TMP_P12_PASS',
      ],
      { env: { ...process.env, LAMALIBRE_LAMASTE_TMP_P12_PASS: newP12Password } },
    );

    await chmod(outputP12Path, 0o600);

    // Verify the new P12 is valid
    await execa(
      'openssl',
      ['pkcs12', '-in', outputP12Path, '-nokeys', '-passin', 'env:LAMALIBRE_LAMASTE_TMP_P12_PASS'],
      { env: { ...process.env, LAMALIBRE_LAMASTE_TMP_P12_PASS: newP12Password } },
    );

    onStep('create-p12', 'complete', `P12 created at ${outputP12Path}`);

    // Step 6: Import into Keychain (macOS only, best-effort)
    const identityName = 'Lamaste Admin';
    if (process.platform === 'darwin') {
      onStep('keychain-import', 'running');
      try {
        const keychainPath = join(homedir(), 'Library/Keychains/login.keychain-db');

        // Trust the CA in the login keychain (required for identity to be visible)
        await execa('security', ['import', caPath, '-k', keychainPath]);
        await execa('security', ['add-trusted-cert', '-k', keychainPath, caPath]);

        // Create a separate P12 for Keychain import (with -x non-extractable)
        const importPassword = crypto.randomBytes(16).toString('hex');
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
            p12ImportPath,
            '-inkey',
            keyPath,
            '-in',
            certPath,
            '-certfile',
            caPath,
            '-name',
            identityName,
            '-passout',
            'env:LAMALIBRE_LAMASTE_TMP_P12_PASS',
          ],
          { env: { ...process.env, LAMALIBRE_LAMASTE_TMP_P12_PASS: importPassword } },
        );

        // Import with -x (non-extractable) and browser access
        await execa('security', [
          'import',
          p12ImportPath,
          '-x',
          '-T',
          '/Applications/Safari.app',
          '-T',
          '/Applications/Google Chrome.app',
          '-T',
          '/usr/bin/curl',
          '-P',
          importPassword,
        ]);

        // Set key partition list for browser access (best-effort)
        try {
          await execa('security', [
            'set-key-partition-list',
            '-S',
            'apple:',
            '-k',
            '',
            '-D',
            identityName,
          ]);
        } catch {
          // May fail if Keychain is locked — import still succeeded
        }

        onStep(
          'keychain-import',
          'complete',
          `Identity "${identityName}" imported (non-extractable)`,
        );
      } catch {
        onStep('keychain-import', 'skipped', 'Keychain import failed (best-effort)');
      }
    }

    // Step 7: Cleanup temp files (secure-delete private key first)
    onStep('cleanup', 'running');
    await cleanup();
    onStep('cleanup', 'complete');

    return { p12Path: outputP12Path, p12Password: newP12Password, identity: identityName };
  } catch (err) {
    // Always attempt cleanup on failure
    await cleanup();
    throw err;
  }
}

/**
 * Run the admin hardware-bound upgrade flow (interactive mode with Listr2).
 */
export async function upgrade() {
  if (process.platform !== 'darwin') {
    throw new Error(
      'Hardware-bound certificates require macOS Keychain. ' +
        `Detected platform: ${process.platform}`,
    );
  }

  console.log('');
  console.log(chalk.bold('  Lamaste Admin — Hardware-Bound Certificate Upgrade'));
  console.log(chalk.dim("  Bind your admin certificate to this Mac's Keychain."));
  console.log(chalk.dim('  The private key will be non-extractable.'));
  console.log('');
  console.log(chalk.yellow('  WARNING: This is a one-way operation. After upgrading, the P12'));
  console.log(chalk.yellow('  download and rotation will be disabled on the panel. Recovery'));
  console.log(chalk.yellow('  requires running lamaste-reset-admin on the server via DO console.'));
  console.log('');

  const panelUrl = await prompt('Panel URL (e.g. https://1.2.3.4:9292)');
  if (!panelUrl) throw new Error('Panel URL is required.');
  const normalizedUrl = panelUrl.replace(/\/+$/, '');

  const p12Input = await prompt('Path to current admin certificate (.p12)');
  const p12Path = resolve(p12Input);
  if (!existsSync(p12Path)) {
    throw new Error(`P12 file not found at: ${p12Path}`);
  }

  const p12Password = await prompt('P12 password');
  if (!p12Password) throw new Error('P12 password is required.');

  const confirm = await prompt('Type "upgrade" to confirm');
  if (confirm !== 'upgrade') {
    console.log('\n  Aborted.\n');
    process.exit(0);
  }

  console.log('');

  // Default output P12 path for interactive mode
  const outputP12Path = join(homedir(), `.${ORG}`, `.${PROJECT}`, 'admin-upgraded.p12');

  const stepTitles = {
    'verify-panel': 'Verifying panel connectivity',
    'check-auth-mode': 'Checking admin auth mode',
    'generate-keypair': 'Generating keypair and CSR',
    'upgrade-cert': 'Upgrading admin certificate on panel',
    'create-p12': 'Creating P12 for API access',
    'keychain-import': 'Importing certificate into Keychain',
    cleanup: 'Cleaning up',
  };

  const tasks = new Listr(
    Object.entries(stepTitles).map(([key, title]) => ({
      title,
      task: (_ctx, task) =>
        new Promise((resolveTask, rejectTask) => {
          // Register this task's resolver — runUpgradeSteps will trigger it
          stepResolvers[key] = { resolve: resolveTask, reject: rejectTask, task };
        }),
      rendererOptions: { persistentOutput: true },
    })),
    {
      renderer: 'default',
      rendererOptions: { collapseSubtasks: false },
      exitOnError: true,
      concurrent: false,
    },
  );

  const stepResolvers = {};

  // Run upgrade steps in parallel with Listr2 rendering
  const upgradePromise = runUpgradeSteps(
    { panelUrl: normalizedUrl, p12Path, p12Password, outputP12Path },
    (step, status, output) => {
      // Wait for the resolver to be registered by Listr2
      const waitForResolver = () => {
        if (stepResolvers[step]) {
          const r = stepResolvers[step];
          if (output) r.task.output = output;
          if (status === 'complete' || status === 'skipped') {
            r.settled = true;
            r.resolve();
          } else if (status === 'failed') {
            r.settled = true;
            r.reject(new Error(output || 'Step failed'));
          }
          // 'running' status — do nothing, Listr shows it as running
        } else {
          setTimeout(waitForResolver, 10);
        }
      };
      if (status !== 'running') {
        waitForResolver();
      }
    },
  ).catch((err) => {
    // Reject only unsettled Listr2 step promises so tasks.run() doesn't hang
    for (const resolver of Object.values(stepResolvers)) {
      if (!resolver.settled) resolver.reject(err);
    }
    throw err;
  });

  // Start both — Listr drives the UI, runUpgradeSteps drives the logic
  const [result] = await Promise.all([upgradePromise, tasks.run()]);

  // Print success
  const c = chalk.cyan;
  const g = chalk.green;
  const b = chalk.bold;
  const d = chalk.dim;

  console.log('');
  console.log(c('  ╔══════════════════════════════════════════════════════════╗'));
  console.log(
    c('  ║') + `  ${g.bold('Admin certificate upgraded successfully!')}` + ' '.repeat(15) + c('║'),
  );
  console.log(c('  ╠══════════════════════════════════════════════════════════╣'));
  console.log(c('  ║') + ' '.repeat(58) + c('║'));
  console.log(
    c('  ║') +
      `  ${b('Identity:')} ${result.identity}` +
      ' '.repeat(Math.max(0, 43 - result.identity.length)) +
      c('║'),
  );
  console.log(
    c('  ║') + `  ${b('Key:')}      Non-extractable (Keychain-bound)` + ' '.repeat(12) + c('║'),
  );
  console.log(c('  ║') + ' '.repeat(58) + c('║'));
  console.log(
    c('  ║') +
      `  ${b('P12 File:')} ${d(result.p12Path)}` +
      ' '.repeat(Math.max(0, 43 - result.p12Path.length)) +
      c('║'),
  );
  // SECURITY: the new P12 password is NEVER printed. Operators that need
  // the password must use the non-interactive JSON mode (`--json`), which
  // persists the password to a 0600 file (see `upgradeJson` below) for
  // privileged retrieval by the desktop app or scripted consumers.
  const redactedPassword = '*** (use --json to retrieve)';
  console.log(
    c('  ║') +
      `  ${b('Password:')} ${d(redactedPassword)}` +
      ' '.repeat(Math.max(0, 43 - redactedPassword.length)) +
      c('║'),
  );
  console.log(c('  ║') + ' '.repeat(58) + c('║'));
  console.log(
    c('  ║') + `  ${d('Your browser will use the Keychain identity')}` + ' '.repeat(11) + c('║'),
  );
  console.log(
    c('  ║') + `  ${d('for mTLS. Desktop/CLI tools use the P12 file.')}` + ' '.repeat(8) + c('║'),
  );
  console.log(c('  ║') + ' '.repeat(58) + c('║'));
  console.log(c('  ║') + `  ${b('Recovery:')}` + ' '.repeat(47) + c('║'));
  console.log(c('  ║') + `    ${d('sudo lamaste-reset-admin')}` + ' '.repeat(29) + c('║'));
  console.log(
    c('  ║') + `    ${d('(run on the server via DO console)')}` + ' '.repeat(18) + c('║'),
  );
  console.log(c('  ║') + ' '.repeat(58) + c('║'));
  console.log(c('  ╚══════════════════════════════════════════════════════════╝'));
  console.log('');
}

/**
 * Run the admin hardware-bound upgrade in non-interactive JSON mode.
 * Emits NDJSON progress on stdout.
 *
 * SECURITY: the new P12 password is NEVER written to stdout. It is persisted
 * to `passwordFile` (default: `<outputP12Path>.password`) with mode 0600 via
 * atomic write (temp -> fsync -> rename). The NDJSON `complete` event carries
 * `p12PasswordPath` (the path) so consumers (the desktop app) can read it via
 * privileged escalation and store it in the OS keychain. This avoids leaks
 * into Tauri event logs, journald, or anything else that captures NDJSON.
 *
 * @param {object} options
 * @param {string} options.panelUrl - Panel URL
 * @param {string} options.p12Path - Path to current admin P12
 * @param {string} options.p12Password - Current P12 password
 * @param {string} options.outputP12Path - Where to write the new P12
 * @param {string} [options.passwordFile] - Where to write the new P12 password
 *   (default: `${outputP12Path}.password`). The file is created with mode 0600.
 */
export async function upgradeJson(options) {
  const { panelUrl, p12Path, p12Password, outputP12Path, passwordFile } = options;

  if (!panelUrl) throw new Error('panelUrl is required');
  if (!p12Path) throw new Error('p12Path is required');
  if (!p12Password) throw new Error('p12Password is required');
  if (!outputP12Path) throw new Error('outputP12Path is required');

  const normalizedUrl = panelUrl.replace(/\/+$/, '');
  const resolvedP12 = resolve(p12Path);
  const resolvedOutP12 = resolve(outputP12Path);
  const resolvedPasswordFile = resolve(passwordFile || `${resolvedOutP12}.password`);

  if (!existsSync(resolvedP12)) {
    const line = JSON.stringify({
      event: 'error',
      message: `P12 file not found at: ${resolvedP12}`,
      recoverable: false,
    });
    process.stdout.write(line + '\n');
    process.exit(1);
  }

  try {
    const result = await runUpgradeSteps(
      {
        panelUrl: normalizedUrl,
        p12Path: resolvedP12,
        p12Password,
        outputP12Path: resolvedOutP12,
      },
      (step, status, output) => {
        const line = JSON.stringify({ event: 'step', step, status, ...(output ? { output } : {}) });
        process.stdout.write(line + '\n');
      },
    );

    // Persist the new P12 password to disk before emitting `complete`. If this
    // fails, hard-error — never fall back to emitting the password value.
    try {
      await atomicWritePassword(resolvedPasswordFile, result.p12Password);
    } catch (writeErr) {
      const msg = `Failed to write P12 password file at ${resolvedPasswordFile}: ${writeErr.message}`;
      const line = JSON.stringify({ event: 'error', message: msg, recoverable: false });
      process.stdout.write(line + '\n');
      process.exit(1);
    }

    const line = JSON.stringify({
      event: 'complete',
      result: {
        p12Path: result.p12Path,
        p12PasswordPath: resolvedPasswordFile,
        identity: result.identity,
      },
    });
    process.stdout.write(line + '\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const line = JSON.stringify({ event: 'error', message: msg, recoverable: false });
    process.stdout.write(line + '\n');
    process.exit(1);
  }
}
