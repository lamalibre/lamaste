import { createInterface } from 'node:readline';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile, unlink, mkdir, readFile, stat, open, rename, rm } from 'node:fs/promises';
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
 * Overwrite a file with random bytes, then unlink it.
 * @param {string} filePath
 */
async function secureDelete(filePath) {
  try {
    const { size } = await stat(filePath);
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
  const agentTmp = join(homedir(), `.${ORG}`, `.${PROJECT}`, 'tmp', 'agent');
  await mkdir(agentTmp, { recursive: true, mode: 0o700 });
  const configPath = join(agentTmp, `curl-${suffix}.tmp`);
  const escapedPath = p12Path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedPass = p12Password.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const content = `cert = "${escapedPath}:${escapedPass}"\ncert-type = "P12"\n`;
  await writeFile(configPath, content, { flag: 'wx', mode: 0o600 });
  return configPath;
}

/**
 * Prompt for the macOS login Keychain password via a native OS dialog.
 * Uses osascript to display a secure input dialog (hidden answer).
 * @returns {Promise<string>}
 */
async function promptKeychainPassword() {
  const { stdout } = await execa('osascript', [
    '-e',
    'display dialog "Lamaste needs your macOS login password to authorize Keychain access for the agent certificate." default answer "" with hidden answer buttons {"Cancel", "OK"} default button "OK" with title "Lamaste — Keychain Access" with icon caution',
    '-e',
    'text returned of result',
  ]);
  return stdout.trim();
}

/**
 * Extract the agent label from a P12 certificate.
 * Reads the certificate subject and extracts the label from CN=agent:<label>.
 * @param {string} p12Path
 * @param {string} p12Password
 * @returns {Promise<string>}
 */
async function extractLabelFromP12(p12Path, p12Password) {
  const { stdout } = await execa('openssl', [
    'pkcs12',
    '-in',
    p12Path,
    '-nokeys',
    '-clcerts',
    '-passin',
    'env:LAMALIBRE_LAMASTE_TMP_P12_PASS',
  ], {
    env: { ...process.env, LAMALIBRE_LAMASTE_TMP_P12_PASS: p12Password },
  });

  // Parse subject line for CN=agent:<label>
  const { stdout: subjectOut } = await execa('openssl', ['x509', '-subject', '-noout'], {
    input: stdout,
  });

  const match = subjectOut.match(/CN\s*=\s*agent:([a-z0-9][a-z0-9-]*)/);
  if (!match) {
    throw new Error('Could not extract agent label from certificate. Expected CN=agent:<label>');
  }
  return match[1];
}

/**
 * Path to the per-agent config file.
 * @param {string} label
 * @returns {string}
 */
function agentConfigPath(label) {
  return join(homedir(), `.${ORG}`, `.${PROJECT}`, 'agents', label, 'config.json');
}

/**
 * Path to the agents registry file.
 * @returns {string}
 */
function agentsRegistryPath() {
  return join(homedir(), `.${ORG}`, `.${PROJECT}`, 'agents.json');
}

/**
 * Update the local agent config and registry to use Keychain authentication.
 * Atomic writes: temp → fsync → rename.
 *
 * @param {string} label - Agent label
 * @param {string} keychainIdentity - Keychain identity name
 */
async function updateLocalAgentAuth(label, keychainIdentity) {
  // 1. Update per-agent config.json
  const configPath = agentConfigPath(label);
  try {
    const raw = await readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);
    config.authMethod = 'keychain';
    config.keychainIdentity = keychainIdentity;
    delete config.p12Path;
    delete config.p12Password;

    const tmpConfig = configPath + '.tmp';
    await writeFile(tmpConfig, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    const fd1 = await open(tmpConfig, 'r');
    await fd1.sync();
    await fd1.close();
    await rename(tmpConfig, configPath);
  } catch {
    // Config may not exist if installed via different method — skip
  }

  // 2. Update agents.json registry
  const registryPath = agentsRegistryPath();
  try {
    const raw = await readFile(registryPath, 'utf-8');
    const registry = JSON.parse(raw);
    if (registry && Array.isArray(registry.agents)) {
      const agent = registry.agents.find((a) => a.label === label);
      if (agent) {
        agent.authMethod = 'keychain';
        agent.keychainIdentity = keychainIdentity;
        delete agent.p12Path;
        delete agent.p12Password;

        const tmpRegistry = registryPath + '.tmp';
        await writeFile(tmpRegistry, JSON.stringify(registry, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
        const fd2 = await open(tmpRegistry, 'r');
        await fd2.sync();
        await fd2.close();
        await rename(tmpRegistry, registryPath);
      }
    }
  } catch {
    // Registry may not exist — skip
  }
}

/**
 * Run the agent hardware-bound certificate upgrade flow.
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
  console.log(chalk.bold('  Lamaste Agent — Hardware-Bound Certificate Upgrade'));
  console.log(chalk.dim('  Bind your agent certificate to this Mac\'s Keychain.'));
  console.log(chalk.dim('  The private key will be non-extractable.'));
  console.log('');
  console.log(
    chalk.yellow('  NOTE: This generates a new certificate with a Keychain-bound private key.'),
  );
  console.log(
    chalk.yellow('  The old P12 certificate will be revoked. This operation is reversible'),
  );
  console.log(
    chalk.yellow('  only by generating a new agent certificate from the panel.'),
  );
  console.log('');

  const panelUrl = await prompt('Panel URL (e.g. https://1.2.3.4:9292)');
  if (!panelUrl) throw new Error('Panel URL is required.');
  const normalizedUrl = panelUrl.replace(/\/+$/, '');

  const p12Input = await prompt('Path to current agent certificate (.p12)');
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

  const tmpDir = join(homedir(), `.${ORG}`, `.${PROJECT}`, 'tmp', 'agent', 'upgrade');
  const ctx = {
    panelUrl: normalizedUrl,
    p12Path,
    p12Password,
    label: null,
    keyPath: join(tmpDir, 'agent.key'),
    csrPath: join(tmpDir, 'agent.csr'),
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
        title: 'Extracting agent label from certificate',
        task: async (_ctx, task) => {
          ctx.label = await extractLabelFromP12(ctx.p12Path, ctx.p12Password);
          task.output = `Agent label: ${ctx.label}`;
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
            `/CN=agent:${ctx.label}/O=Lamaste`,
          ]);

          ctx.csrPem = await readFile(ctx.csrPath, 'utf-8');
          task.output = 'Keypair generated (4096-bit RSA)';
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Upgrading agent certificate on panel',
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
              `${ctx.panelUrl}/api/certs/agent/upgrade-cert`,
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
          const certPath = join(tmpDir, 'agent.crt');
          const caPath = join(tmpDir, 'ca.crt');
          const p12ImportPath = join(tmpDir, 'agent-import.p12');
          const importPassword = crypto.randomBytes(16).toString('hex');
          const identityName = `Lamaste Agent (${ctx.label})`;

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
            'env:LAMALIBRE_LAMASTE_TMP_P12_PASS',
          ], {
            env: { ...process.env, LAMALIBRE_LAMASTE_TMP_P12_PASS: importPassword },
          });

          // Trust the CA so macOS considers the identity valid
          try {
            await execa('security', [
              'add-trusted-cert',
              '-p',
              'ssl',
              caPath,
            ]);
          } catch {
            // May require admin approval — import still succeeds
          }

          // Import into Keychain with -x (non-extractable).
          // Known limitation: `security import -P` passes the password as a CLI argument,
          // visible in `ps aux`. The `security` command does not support stdin or env var
          // password input. Mitigated by: the P12 is ephemeral (random password, temp file,
          // deleted immediately after import), so the exposure window is seconds.
          await execa('security', [
            'import',
            p12ImportPath,
            '-x',
            '-T',
            '/usr/bin/curl',
            '-P',
            importPassword,
          ]);

          // Set key partition list so curl can access the identity without prompts.
          // Requires the login Keychain password — prompt via native macOS dialog.
          // Known limitation: `-k` passes the password as a CLI argument. The `security`
          // command does not support stdin for this subcommand.
          const keychainPassword = await promptKeychainPassword();
          try {
            await execa('security', [
              'set-key-partition-list',
              '-S',
              'apple-tool:,apple:',
              '-k',
              keychainPassword,
              '-l',
              identityName,
            ]);
          } catch {
            throw new Error(
              'Could not authorize Keychain access. The macOS login password may be incorrect.',
            );
          }

          ctx.identity = identityName;
          task.output = `Identity "${identityName}" imported (non-extractable)`;

          // Secure cleanup of temp files
          await secureDelete(ctx.keyPath);
          await secureDelete(certPath);
          await secureDelete(caPath);
          await secureDelete(p12ImportPath);
          await secureDelete(ctx.csrPath);
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Updating agent configuration',
        task: async (_ctx, task) => {
          await updateLocalAgentAuth(ctx.label, ctx.identity);
          task.output = `Config updated: authMethod=keychain, identity="${ctx.identity}"`;
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        title: 'Removing old P12 certificate',
        task: async () => {
          await secureDelete(ctx.p12Path);
        },
      },
      {
        title: 'Cleaning up',
        task: async () => {
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

  try {
    await tasks.run();
  } catch (err) {
    // Securely clean up the temporary directory (may contain private key)
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  // Print success
  const c = chalk.cyan;
  const g = chalk.green;
  const b = chalk.bold;
  const d = chalk.dim;

  console.log('');
  console.log(c('  ╔══════════════════════════════════════════════════════════╗'));
  console.log(
    c('  ║') + `  ${g.bold('Agent certificate upgraded successfully!')}` + ' '.repeat(15) + c('║'),
  );
  console.log(c('  ╠══════════════════════════════════════════════════════════╣'));
  console.log(c('  ║') + ' '.repeat(58) + c('║'));
  console.log(
    c('  ║') + `  ${b('Label:')}    ${ctx.label}` + ' '.repeat(Math.max(0, 44 - ctx.label.length)) + c('║'),
  );
  console.log(
    c('  ║') + `  ${b('Identity:')} ${ctx.identity}` + ' '.repeat(Math.max(0, 41 - ctx.identity.length)) + c('║'),
  );
  console.log(
    c('  ║') + `  ${b('Key:')}      Non-extractable (Keychain-bound)` + ' '.repeat(12) + c('║'),
  );
  console.log(c('  ║') + ' '.repeat(58) + c('║'));
  console.log(
    c('  ║') + `  ${d('The agent will now use the Keychain identity for')}` + ' '.repeat(5) + c('║'),
  );
  console.log(
    c('  ║') + `  ${d('mTLS authentication with the panel.')}` + ' '.repeat(18) + c('║'),
  );
  console.log(c('  ║') + ' '.repeat(58) + c('║'));
  console.log(
    c('  ║') + `  ${b('Recovery:')}` + ' '.repeat(47) + c('║'),
  );
  console.log(
    c('  ║') + `    ${d('Generate a new agent cert from the panel and')}` + ' '.repeat(8) + c('║'),
  );
  console.log(
    c('  ║') + `    ${d('re-run lamaste-agent setup with a new token.')}` + ' '.repeat(6) + c('║'),
  );
  console.log(c('  ║') + ' '.repeat(58) + c('║'));
  console.log(c('  ╚══════════════════════════════════════════════════════════╝'));
  console.log('');
}
