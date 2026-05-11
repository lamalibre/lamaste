import { execa } from 'execa';
import { writeFile, readFile, mkdir, cp, rm, rename, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateServiceUnit, generateSudoersContent } from '../lib/service-config.js';

/**
 * Read the installed serverd's package.json version, or null if not found.
 * @param {string} installDir
 * @returns {Promise<string | null>}
 */
async function getInstalledVersion(installDir) {
  try {
    const pkgPath = join(installDir, 'serverd', 'package.json');
    const raw = await readFile(pkgPath, 'utf8');
    return JSON.parse(raw).version || null;
  } catch {
    return null;
  }
}

/**
 * Fetch the latest published version of @lamalibre/lamaste-serverd from npm.
 * @returns {Promise<string | null>}
 */
async function getLatestNpmVersion() {
  try {
    const { stdout } = await execa('npm', ['view', '@lamalibre/lamaste-serverd', 'version']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Panel redeployment subtasks. Only updates serverd and lamaste-server-ui files,
 * runs npm install, merges config, and restarts the service. Does not touch
 * OS hardening, mTLS certs, nginx, or any other system configuration.
 *
 * @param {object} ctx  Shared installer context.
 * @param {object} task Parent Listr2 task reference.
 * @returns {import('listr2').ListrTask[]}
 */
export function redeployTasks(ctx, task) {
  const installDir = ctx.installDir;
  const configDir = ctx.configDir;

  // vendorDir still needed for lamaste-server-ui (pre-built static dist)
  const thisFile = fileURLToPath(import.meta.url);
  const vendorDir = join(dirname(thisFile), '..', '..', 'vendor');

  return task.newListr([
    {
      title: 'Checking versions',
      task: async (_ctx, subtask) => {
        const installed = await getInstalledVersion(installDir);
        const latest = await getLatestNpmVersion();
        ctx.installedVersion = installed;
        ctx.latestVersion = latest;
        subtask.output = `Installed: ${installed || 'unknown'} → Latest: ${latest || 'unknown'}`;
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Stopping panel service',
      task: async (_ctx, subtask) => {
        try {
          const { stdout: status } = await execa('systemctl', ['is-active', 'lamalibre-lamaste-serverd']);
          if (status.trim() === 'active') {
            await execa('systemctl', ['stop', 'lamalibre-lamaste-serverd']);
            subtask.output = 'Service stopped';
          } else {
            subtask.output = `Service was not running (${status.trim()})`;
          }
        } catch {
          subtask.output = 'Service was not running';
        }
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Updating serverd',
      task: async (_ctx, subtask) => {
        const serverDest = join(installDir, 'serverd');
        const tmpDir = join('/tmp', `lamaste-panel-update-${Date.now()}`);

        try {
          // Download the package tarball to a temp directory via npm pack,
          // then extract. We cannot `npm install` inside serverDest because
          // its package.json has the same name — npm refuses to install a
          // package as a dependency of itself.
          await execa('mkdir', ['-p', tmpDir]);

          subtask.output = 'Downloading @lamalibre/lamaste-serverd from npm...';
          const { stdout: tarball } = await execa('npm', [
            'pack',
            '@lamalibre/lamaste-serverd@latest',
            '--prefer-online',
            '--pack-destination',
            tmpDir,
          ]);
          const tarballPath = join(tmpDir, tarball.trim());

          subtask.output = 'Extracting package...';
          await execa('tar', ['xzf', tarballPath, '-C', tmpDir]);

          // npm pack extracts to a `package/` directory
          const extracted = join(tmpDir, 'package');

          subtask.output = 'Copying serverd files...';
          await rm(join(serverDest, 'src'), { recursive: true, force: true });
          await cp(join(extracted, 'src'), join(serverDest, 'src'), { recursive: true });
          await cp(join(extracted, 'package.json'), join(serverDest, 'package.json'));

          subtask.output = 'Installing production dependencies...';
          await execa('npm', ['install', '--production', '--ignore-scripts'], {
            cwd: serverDest,
          });

          await execa('chown', ['-R', 'lamaste:lamaste', serverDest]);

          subtask.output = `Panel server updated to ${ctx.latestVersion || 'latest'}`;
        } finally {
          await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Updating lamaste-server CLI',
      task: async (_ctx, subtask) => {
        // Deploy the operational CLI from the bundled vendor directory —
        // the redeploy path installs the CLI version that shipped with
        // this create-lamaste release rather than querying npm again.
        // Matches the full-install deploy in tasks/panel.js; also
        // (re)installs the lamaste-reset-admin shim so recovery is
        // available even if the shim drifted.
        const cliSrc = join(vendorDir, 'server');
        const cliDest = join(installDir, 'server');

        if (!existsSync(cliSrc)) {
          subtask.output = 'lamaste-server CLI not bundled — skipping (upgrade create-lamaste to fix)';
          return;
        }

        await mkdir(cliDest, { recursive: true });
        await cp(join(cliSrc, 'package.json'), join(cliDest, 'package.json'), { force: true });
        await rm(join(cliDest, 'bin'), { recursive: true, force: true });
        await rm(join(cliDest, 'src'), { recursive: true, force: true });
        await cp(join(cliSrc, 'bin'), join(cliDest, 'bin'), { recursive: true, force: true });
        await cp(join(cliSrc, 'src'), join(cliDest, 'src'), { recursive: true, force: true });

        subtask.output = 'Installing lamaste-server CLI dependencies...';
        await execa('npm', ['install', '--production', '--ignore-scripts'], { cwd: cliDest });
        await execa('chown', ['-R', 'lamaste:lamaste', cliDest]);

        const serverBin = join(cliDest, 'bin', 'lamaste-server.js');
        await execa('chmod', ['+x', serverBin]);
        await execa('ln', ['-sf', serverBin, '/usr/local/bin/lamaste-server']);

        const shimPath = '/usr/local/bin/lamaste-reset-admin';
        const shim = [
          '#!/usr/bin/env bash',
          '# Shim installed by create-lamaste: delegates to lamaste-server CLI.',
          'exec /usr/local/bin/lamaste-server reset-admin "$@"',
          '',
        ].join('\n');
        await writeFile(shimPath, shim, { mode: 0o755 });

        subtask.output = 'lamaste-server CLI updated; lamaste-reset-admin shim refreshed';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Updating server-ui',
      task: async (_ctx, subtask) => {
        const clientSrc = join(vendorDir, 'server-ui');
        const clientDest = join(installDir, 'server-ui');

        if (!existsSync(clientSrc)) {
          throw new Error(
            `Panel client source not found at ${clientSrc}. Ensure the package is intact.`,
          );
        }

        const prebuiltDist = join(clientSrc, 'dist');
        if (!existsSync(join(prebuiltDist, 'index.html'))) {
          throw new Error('Pre-built lamaste-server-ui dist not found. The package may be corrupted.');
        }

        subtask.output = 'Copying lamaste-server-ui dist...';
        const distDest = join(clientDest, 'dist');
        await rm(distDest, { recursive: true, force: true });
        await cp(prebuiltDist, distDest, { recursive: true });

        await execa('chown', ['-R', 'lamaste:lamaste', clientDest]);
        subtask.output = 'Panel client updated';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Updating documentation',
      task: async (_ctx, subtask) => {
        const docsSrc = join(vendorDir, 'docs');
        const docsDest = join(installDir, 'docs');

        if (existsSync(docsSrc)) {
          subtask.output = 'Copying version-stamped docs...';
          await rm(docsDest, { recursive: true, force: true });
          await cp(docsSrc, docsDest, { recursive: true });
          await execa('chown', ['-R', 'lamaste:lamaste', docsDest]);
          subtask.output = 'Documentation updated';
        } else {
          subtask.output = 'No bundled docs found — skipping';
        }
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Updating panel configuration',
      task: async (_ctx, subtask) => {
        const configPath = join(configDir, 'panel.json');

        if (!existsSync(configPath)) {
          subtask.output = 'No existing config — skipping (full install needed)';
          return;
        }

        subtask.output = 'Merging configuration...';
        const existing = JSON.parse(await readFile(configPath, 'utf8'));

        const config = {
          ...existing,
          ip: ctx.ip,
          dataDir: configDir,
          staticDir: join(installDir, 'server-ui', 'dist'),
        };

        const tmpConfigPath = `${configPath}.tmp`;
        await writeFile(tmpConfigPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
        const fd = await open(tmpConfigPath, 'r');
        await fd.sync();
        await fd.close();
        await rename(tmpConfigPath, configPath);
        await execa('chown', ['lamaste:lamaste', configPath]);

        subtask.output = 'Configuration updated';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Updating systemd unit and sudoers',
      task: async (_ctx, subtask) => {
        subtask.output = 'Writing systemd service unit...';
        const serviceUnit = generateServiceUnit({ installDir, configDir });
        await writeFile('/etc/systemd/system/lamalibre-lamaste-serverd.service', serviceUnit);

        // Install / refresh sudoers wrapper scripts before writing the
        // sudoers file. The sudoers entries reference these absolute paths,
        // and the panel calls them at runtime to sign CSRs and rename PKI
        // files (replacing two former wildcard sudoers entries that were
        // exploitable — see service-config.js comments).
        const scriptsSrc = join(dirname(thisFile), '..', '..', 'scripts');
        const wrappers = [
          { name: 'lamaste-sign-csr', dest: '/usr/local/sbin/lamaste-sign-csr' },
          { name: 'lamaste-pki-rename', dest: '/usr/local/sbin/lamaste-pki-rename' },
        ];
        for (const w of wrappers) {
          const src = join(scriptsSrc, w.name);
          if (!existsSync(src)) {
            throw new Error(
              `Sudoers wrapper script not found in package: ${src}. The provisioner package is incomplete.`,
            );
          }
          subtask.output = `Validating ${w.name} syntax...`;
          await execa('bash', ['-n', src]);
          subtask.output = `Installing ${w.name} to ${w.dest}...`;
          await execa('install', [
            '-o', 'root',
            '-g', 'root',
            '-m', '0755',
            src,
            w.dest,
          ]);
        }

        subtask.output = 'Writing sudoers rules...';
        const sudoersContent = generateSudoersContent();
        const sudoersPath = '/etc/sudoers.d/lamaste';
        await writeFile(sudoersPath, sudoersContent, { mode: 0o440 });

        try {
          await execa('visudo', ['-c', '-f', sudoersPath]);
        } catch (error) {
          await rm(sudoersPath, { force: true });
          throw new Error(
            `Sudoers validation failed — file removed for safety.\n${error.stderr || error.message}`,
          );
        }

        subtask.output = 'Systemd unit and sudoers updated';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Reloading systemd and restarting panel',
      task: async (_ctx, subtask) => {
        subtask.output = 'Reloading systemd daemon...';
        await execa('systemctl', ['daemon-reload']);

        subtask.output = 'Starting lamalibre-lamaste-serverd...';
        await execa('systemctl', ['start', 'lamalibre-lamaste-serverd']);

        subtask.output = 'Waiting for service to start...';
        await sleep(3000);

        const { stdout: status } = await execa('systemctl', ['is-active', 'lamalibre-lamaste-serverd']);
        if (status.trim() !== 'active') {
          const { stdout: logs } = await execa('journalctl', [
            '-u',
            'lamalibre-lamaste-serverd',
            '--no-pager',
            '-n',
            '20',
          ]);
          throw new Error(
            `Panel service failed to start. Status: ${status.trim()}\nRecent logs:\n${logs}`,
          );
        }

        subtask.output = 'Running health check...';
        try {
          const { stdout: healthResponse } = await execa('curl', [
            '-s',
            '--max-time',
            '5',
            'http://127.0.0.1:3100/api/health',
          ]);
          subtask.output = `Panel running. Health: ${healthResponse}`;
        } catch (error) {
          const { stdout: logs } = await execa('journalctl', [
            '-u',
            'lamalibre-lamaste-serverd',
            '--no-pager',
            '-n',
            '20',
          ]);
          throw new Error(`Panel health check failed.\nRecent logs:\n${logs}\n${error.message}`);
        }
      },
      rendererOptions: { persistentOutput: true },
    },
  ]);
}
