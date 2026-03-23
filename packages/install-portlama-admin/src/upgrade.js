import { createInterface } from 'node:readline';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { Listr } from 'listr2';
import chalk from 'chalk';
import { execa } from 'execa';

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
  const configPath = join(homedir(), `.portlama-admin-curl-${suffix}.tmp`);
  const escapedPath = p12Path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedPass = p12Password.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const content = `cert = "${escapedPath}:${escapedPass}"\ncert-type = "P12"\n`;
  await writeFile(configPath, content, { flag: 'wx', mode: 0o600 });
  return configPath;
}

/**
 * Run the admin hardware-bound upgrade flow.
 */
export async function upgrade() {
  // Verify macOS
  if (process.platform !== 'darwin') {
    throw new Error(
      'Hardware-bound certificates require macOS Keychain. ' +
        `Detected platform: ${process.platform}`,
    );
  }

  console.log('');
  console.log(chalk.bold('  Portlama Admin — Hardware-Bound Certificate Upgrade'));
  console.log(chalk.dim('  Bind your admin certificate to this Mac\'s Keychain.'));
  console.log(chalk.dim('  The private key will be non-extractable.'));
  console.log('');
  console.log(
    chalk.yellow('  WARNING: This is a one-way operation. After upgrading, the P12'),
  );
  console.log(
    chalk.yellow('  download and rotation will be disabled on the panel. Recovery'),
  );
  console.log(
    chalk.yellow('  requires running portlama-reset-admin on the server via DO console.'),
  );
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

  const tmpDir = join(homedir(), '.portlama-admin-upgrade');
  const ctx = {
    panelUrl: normalizedUrl,
    p12Path,
    p12Password,
    keyPath: join(tmpDir, 'admin.key'),
    csrPath: join(tmpDir, 'admin.csr'),
    certPem: null,
    caCertPem: null,
    identity: null,
  };

  const tasks = new Listr(
    [
      {
        title: 'Verifying panel connectivity',
        task: async (_ctx, task) => {
          const configPath = await createCurlConfig(ctx.p12Path, ctx.p12Password);
          try {
            const { stdout } = await execa('curl', [
              '-K',
              configPath,
              '-s',
              '-f',
              '--max-time',
              '30',
              '-k',
              `${ctx.panelUrl}/api/health`,
            ]);
            const health = JSON.parse(stdout);
            task.output = `Panel reachable (status: ${health.status || 'ok'})`;
          } finally {
            await unlink(configPath).catch(() => {});
          }
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Checking admin auth mode',
        task: async (_ctx, task) => {
          const configPath = await createCurlConfig(ctx.p12Path, ctx.p12Password);
          try {
            const { stdout } = await execa('curl', [
              '-K',
              configPath,
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
            task.output = `Current mode: ${data.adminAuthMode || 'p12'}`;
          } finally {
            await unlink(configPath).catch(() => {});
          }
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Generating keypair and CSR',
        task: async (_ctx, task) => {
          await mkdir(tmpDir, { recursive: true, mode: 0o700 });

          await execa('openssl', ['genrsa', '-out', ctx.keyPath, '4096']);
          await execa('chmod', ['600', ctx.keyPath]);

          await execa('openssl', [
            'req',
            '-new',
            '-key',
            ctx.keyPath,
            '-out',
            ctx.csrPath,
            '-subj',
            '/CN=admin/O=Portlama',
          ]);

          const { readFile: rf } = await import('node:fs/promises');
          ctx.csrPem = await rf(ctx.csrPath, 'utf-8');
          task.output = 'Keypair generated (4096-bit RSA)';
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Upgrading admin certificate on panel',
        task: async (_ctx, task) => {
          const configPath = await createCurlConfig(ctx.p12Path, ctx.p12Password);
          try {
            const { stdout } = await execa('curl', [
              '-K',
              configPath,
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
              JSON.stringify({ csr: ctx.csrPem }),
              `${ctx.panelUrl}/api/certs/admin/upgrade-to-hardware-bound`,
            ]);
            const result = JSON.parse(stdout);
            if (!result.ok) {
              throw new Error(result.error || 'Upgrade failed');
            }
            ctx.certPem = result.cert;
            ctx.caCertPem = result.caCert;
            task.output = `Certificate signed (serial: ${result.serial}, expires: ${result.expiresAt})`;
          } finally {
            await unlink(configPath).catch(() => {});
          }
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Importing certificate into Keychain',
        task: async (_ctx, task) => {
          const certPath = join(tmpDir, 'admin.crt');
          const caPath = join(tmpDir, 'ca.crt');
          const p12ImportPath = join(tmpDir, 'admin-import.p12');
          const importPassword = crypto.randomBytes(16).toString('hex');
          const identityName = 'Portlama Admin';

          await writeFile(certPath, ctx.certPem, { mode: 0o600 });
          await writeFile(caPath, ctx.caCertPem, { mode: 0o600 });

          // Create temporary P12 for import
          await execa('openssl', [
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
            ctx.keyPath,
            '-in',
            certPath,
            '-certfile',
            caPath,
            '-name',
            identityName,
            '-passout',
            `env:PORTLAMA_TMP_P12_PASS`,
          ], {
            env: { ...process.env, PORTLAMA_TMP_P12_PASS: importPassword },
          });

          // Import into Keychain with -x (non-extractable)
          // -T for Safari and Chrome access
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

          // Set key partition list for browser access
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

          ctx.identity = identityName;
          task.output = `Identity "${identityName}" imported (non-extractable)`;

          // Secure cleanup
          await secureDelete(ctx.keyPath);
          await secureDelete(certPath);
          await secureDelete(caPath);
          await secureDelete(p12ImportPath);
          await secureDelete(ctx.csrPath);
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Cleaning up',
        task: async () => {
          // Remove the temporary directory
          const { rm } = await import('node:fs/promises');
          await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        },
      },
    ],
    {
      renderer: 'default',
      rendererOptions: { collapseSubtasks: false },
      exitOnError: true,
    },
  );

  await tasks.run();

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
    c('  ║') + `  ${b('Identity:')} ${ctx.identity}` + ' '.repeat(Math.max(0, 43 - ctx.identity.length)) + c('║'),
  );
  console.log(
    c('  ║') + `  ${b('Key:')}      Non-extractable (Keychain-bound)` + ' '.repeat(12) + c('║'),
  );
  console.log(c('  ║') + ' '.repeat(58) + c('║'));
  console.log(
    c('  ║') + `  ${d('Your browser will now use the Keychain identity')}` + ' '.repeat(7) + c('║'),
  );
  console.log(
    c('  ║') + `  ${d('for mTLS authentication with the panel.')}` + ' '.repeat(14) + c('║'),
  );
  console.log(c('  ║') + ' '.repeat(58) + c('║'));
  console.log(
    c('  ║') + `  ${b('Recovery:')}` + ' '.repeat(47) + c('║'),
  );
  console.log(
    c('  ║') + `    ${d('sudo portlama-reset-admin')}` + ' '.repeat(29) + c('║'),
  );
  console.log(
    c('  ║') + `    ${d('(run on the server via DO console)')}` + ' '.repeat(18) + c('║'),
  );
  console.log(c('  ║') + ' '.repeat(58) + c('║'));
  console.log(c('  ╚══════════════════════════════════════════════════════════╝'));
  console.log('');
}
