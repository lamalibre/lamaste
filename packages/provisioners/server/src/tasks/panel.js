import { execa } from 'execa';
import { writeFile, readFile, mkdir, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateServiceUnit, generateSudoersContent } from '../lib/service-config.js';

/**
 * Panel deployment subtasks: system user, directories, server + client deploy,
 * config, systemd service, sudoers, and service start.
 *
 * @param {object} ctx  Shared installer context.
 * @param {object} task Parent Listr2 task reference.
 * @returns {import('listr2').ListrTask[]}
 */
export function panelTasks(ctx, task) {
  const installDir = ctx.installDir;
  const configDir = ctx.configDir;

  // Resolve vendor directory relative to this package root.
  // This file is at packages/create-lamaste/src/tasks/panel.js
  // The package root is 2 levels up; vendor/ is bundled at publish time.
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);
  const packageRoot = join(thisDir, '..', '..');
  const vendorDir = join(packageRoot, 'vendor');

  return task.newListr([
    {
      title: 'Creating system user',
      task: async (_ctx, subtask) => {
        try {
          await execa('id', ['lamaste']);
          subtask.output = 'User lamaste already exists';
        } catch {
          await execa('useradd', [
            '--system',
            '--no-create-home',
            '--shell',
            '/usr/sbin/nologin',
            'lamaste',
          ]);
          subtask.output = 'Created system user: lamaste';
        }
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Creating directory structure',
      task: async (_ctx, subtask) => {
        await mkdir(`${installDir}/serverd`, { recursive: true });
        await mkdir(`${installDir}/server-ui`, { recursive: true });
        await mkdir(configDir, { recursive: true });
        await mkdir('/var/www/lamaste', { recursive: true });

        await execa('chown', ['-R', 'lamaste:lamaste', installDir]);
        await execa('chown', ['-R', 'lamaste:lamaste', configDir]);
        await execa('chown', ['-R', 'www-data:www-data', '/var/www/lamaste']);

        subtask.output = `Directories created: ${installDir}, ${configDir}, /var/www/lamaste`;
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Deploying serverd',
      task: async (_ctx, subtask) => {
        const serverSrc = join(vendorDir, 'serverd');
        const serverDest = `${installDir}/serverd`;

        if (!existsSync(serverSrc)) {
          throw new Error(
            `Panel server source not found at ${serverSrc}. Ensure the monorepo is intact.`,
          );
        }

        subtask.output = 'Copying serverd files...';
        // Copy package.json first. For src/ we nuke the existing directory
        // before copying — redeploys over an existing install need to drop
        // stale files that are no longer in the source tree. `fs.cp` with
        // recursive merges but does not delete orphans, and its overwrite
        // behaviour is not reliable for every file shape.
        await cp(join(serverSrc, 'package.json'), join(serverDest, 'package.json'), {
          force: true,
        });
        await rm(join(serverDest, 'src'), { recursive: true, force: true });
        await cp(join(serverSrc, 'src'), join(serverDest, 'src'), {
          recursive: true,
          force: true,
        });

        subtask.output = 'Installing production dependencies...';
        try {
          await execa('npm', ['install', '--production', '--ignore-scripts'], {
            cwd: serverDest,
          });
        } catch (err) {
          throw new Error(
            `Failed to install serverd dependencies. Check your network connection and try again.\n${err.stderr || err.message}`,
          );
        }

        await execa('chown', ['-R', 'lamaste:lamaste', serverDest]);

        subtask.output = 'Panel server deployed';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Deploying lamaste-server CLI',
      task: async (_ctx, subtask) => {
        // The 2.0 refactor split operational commands out of the daemon
        // into a separate CLI package. This task deploys the CLI alongside
        // the daemon and publishes two binaries:
        //   • /usr/local/bin/lamaste-server       (full subcommand set)
        //   • /usr/local/bin/lamaste-reset-admin  (shim for reset-admin
        //     — the emergency recovery path tests and operators depend on)
        const cliSrc = join(vendorDir, 'server');
        const cliDest = `${installDir}/server`;

        if (!existsSync(cliSrc)) {
          throw new Error(
            `lamaste-server CLI source not found at ${cliSrc}. The installer is missing bundled vendor files — rebuild create-lamaste.`,
          );
        }

        subtask.output = 'Copying lamaste-server CLI files...';
        await mkdir(cliDest, { recursive: true });
        await cp(join(cliSrc, 'package.json'), join(cliDest, 'package.json'), { force: true });
        await rm(join(cliDest, 'bin'), { recursive: true, force: true });
        await rm(join(cliDest, 'src'), { recursive: true, force: true });
        await cp(join(cliSrc, 'bin'), join(cliDest, 'bin'), { recursive: true, force: true });
        await cp(join(cliSrc, 'src'), join(cliDest, 'src'), { recursive: true, force: true });

        subtask.output = 'Installing lamaste-server CLI dependencies...';
        try {
          await execa('npm', ['install', '--production', '--ignore-scripts'], {
            cwd: cliDest,
          });
        } catch (err) {
          throw new Error(
            `Failed to install lamaste-server CLI dependencies.\n${err.stderr || err.message}`,
          );
        }

        await execa('chown', ['-R', 'lamaste:lamaste', cliDest]);

        const serverBin = join(cliDest, 'bin', 'lamaste-server.js');
        await execa('chmod', ['+x', serverBin]);
        await execa('ln', ['-sf', serverBin, '/usr/local/bin/lamaste-server']);

        // lamaste-reset-admin shim — a one-line wrapper that dispatches
        // to `lamaste-server reset-admin`. Kept as its own binary because
        // the recovery docs and existing tests refer to it by name; the
        // shim means the name can never drift from the CLI implementation.
        const shimPath = '/usr/local/bin/lamaste-reset-admin';
        const shim = [
          '#!/usr/bin/env bash',
          '# Shim installed by create-lamaste: delegates to lamaste-server CLI.',
          '# The authoritative reset-admin implementation lives in',
          '# @lamalibre/lamaste-server; this wrapper preserves the legacy',
          '# binary name used by operator docs and e2e tests.',
          'exec /usr/local/bin/lamaste-server reset-admin "$@"',
          '',
        ].join('\n');
        await writeFile(shimPath, shim, { mode: 0o755 });

        subtask.output = 'lamaste-server CLI deployed; lamaste-reset-admin shim installed';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Deploying server-ui',
      task: async (_ctx, subtask) => {
        const clientSrc = join(vendorDir, 'server-ui');
        const clientDest = `${installDir}/server-ui`;

        if (!existsSync(clientSrc)) {
          throw new Error(
            `Panel client source not found at ${clientSrc}. Ensure the monorepo is intact.`,
          );
        }

        // If a pre-built dist/ exists, use it directly (faster, avoids OOM on low-RAM VMs)
        const prebuiltDist = join(clientSrc, 'dist');
        if (existsSync(join(prebuiltDist, 'index.html'))) {
          subtask.output = 'Using pre-built lamaste-server-ui dist...';
          const distDest = join(clientDest, 'dist');
          await rm(distDest, { recursive: true, force: true });
          await cp(prebuiltDist, distDest, { recursive: true });

          await execa('chown', ['-R', 'lamaste:lamaste', clientDest]);
          subtask.output = 'Panel client deployed from pre-built dist';
          return;
        }

        // No pre-built dist — build from source in a temp directory
        const buildDir = '/tmp/lamalibre-lamaste-server-ui-build';
        await rm(buildDir, { recursive: true, force: true });
        await mkdir(buildDir, { recursive: true });

        subtask.output = 'Copying lamaste-server-ui source for build...';
        for (const entry of [
          'package.json',
          'src',
          'index.html',
          'vite.config.js',
          'tailwind.config.js',
          'postcss.config.js',
        ]) {
          const srcPath = join(clientSrc, entry);
          if (existsSync(srcPath)) {
            await cp(srcPath, join(buildDir, entry), { recursive: true });
          }
        }

        subtask.output = 'Installing dependencies for build...';
        try {
          await execa('npm', ['install', '--ignore-scripts'], { cwd: buildDir });
        } catch (err) {
          throw new Error(
            `Failed to install lamaste-server-ui build dependencies. Check your network connection and try again.\n${err.stderr || err.message}`,
          );
        }

        subtask.output = 'Building lamaste-server-ui (vite build)...';
        await execa('npx', ['vite', 'build'], { cwd: buildDir });

        subtask.output = 'Copying built assets...';
        const distSrc = join(buildDir, 'dist');
        const distDest = join(clientDest, 'dist');
        await rm(distDest, { recursive: true, force: true });
        await cp(distSrc, distDest, { recursive: true });

        await rm(buildDir, { recursive: true, force: true });

        await execa('chown', ['-R', 'lamaste:lamaste', clientDest]);
        subtask.output = 'Panel client built and deployed';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Deploying documentation',
      task: async (_ctx, subtask) => {
        const docsSrc = join(vendorDir, 'docs');
        const docsDest = `${installDir}/docs`;

        if (existsSync(docsSrc)) {
          subtask.output = 'Copying version-stamped docs...';
          await rm(docsDest, { recursive: true, force: true });
          await cp(docsSrc, docsDest, { recursive: true });
          await execa('chown', ['-R', 'lamaste:lamaste', docsDest]);
          subtask.output = 'Documentation deployed';
        } else {
          subtask.output = 'No bundled docs found — skipping';
        }
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Writing panel configuration',
      task: async (_ctx, subtask) => {
        const configPath = `${configDir}/panel.json`;
        let config;

        if (existsSync(configPath)) {
          // Preserve user/onboarding state from an existing configuration.
          // Only update installer-owned fields (ip, dataDir, staticDir).
          subtask.output = 'Existing panel.json found — merging...';
          const existing = JSON.parse(await readFile(configPath, 'utf8'));

          config = {
            ...existing,
            ip: ctx.ip,
            dataDir: configDir,
            staticDir: `${installDir}/server-ui/dist`,
          };
        } else {
          config = {
            ip: ctx.ip,
            domain: null,
            email: null,
            dataDir: configDir,
            staticDir: `${installDir}/server-ui/dist`,
            onboarding: {
              status: 'FRESH',
            },
          };
        }

        await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o640 });

        await execa('chown', ['lamaste:lamaste', configPath]);

        subtask.output = `Configuration written to ${configPath}`;
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Writing systemd service unit',
      task: async (_ctx, subtask) => {
        const serviceUnit = generateServiceUnit({ installDir, configDir });
        await writeFile('/etc/systemd/system/lamalibre-lamaste-serverd.service', serviceUnit);

        subtask.output = 'Systemd service unit written';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Installing PKI sudoers wrapper scripts',
      task: async (_ctx, subtask) => {
        // The two wrappers below replace previous sudoers wildcards that were
        // exploitable (see service-config.js comments). They MUST be installed
        // before the sudoers file is written — the sudoers entries reference
        // these absolute paths and visudo will reject the file otherwise (well,
        // it doesn't actually verify existence, but we want them in place
        // before the panel service starts and tries to call them).
        const scriptsSrc = join(packageRoot, 'scripts');
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

          // Validate the script parses as bash before installing — a syntax
          // error would only surface at runtime, when the panel needs to sign
          // a CSR and there is no fallback.
          subtask.output = `Validating ${w.name} syntax...`;
          await execa('bash', ['-n', src]);

          // Install with explicit mode + ownership. install(1) is part of
          // coreutils so it's always available on Ubuntu 24.04.
          subtask.output = `Installing ${w.name} to ${w.dest}...`;
          await execa('install', [
            '-o', 'root',
            '-g', 'root',
            '-m', '0755',
            src,
            w.dest,
          ]);
        }

        subtask.output = 'PKI sudoers wrappers installed';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Writing sudoers rules',
      task: async (_ctx, subtask) => {
        const sudoersContent = generateSudoersContent();
        const sudoersPath = '/etc/sudoers.d/lamaste';
        await writeFile(sudoersPath, sudoersContent, { mode: 0o440 });

        subtask.output = 'Validating sudoers file...';
        try {
          await execa('visudo', ['-c', '-f', sudoersPath]);
        } catch (error) {
          // Remove invalid sudoers file to avoid locking out sudo
          await rm(sudoersPath, { force: true });
          throw new Error(
            `Sudoers validation failed — file removed for safety.\n${error.stderr || error.message}`,
          );
        }

        subtask.output = 'Sudoers rules written and validated';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Starting panel service',
      task: async (_ctx, subtask) => {
        subtask.output = 'Reloading systemd daemon...';
        await execa('systemctl', ['daemon-reload']);

        subtask.output = 'Enabling and starting lamalibre-lamaste-serverd...';
        await execa('systemctl', ['enable', 'lamalibre-lamaste-serverd']);
        await execa('systemctl', ['start', 'lamalibre-lamaste-serverd']);

        // Wait for the service to start
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

        // Health check
        subtask.output = 'Running health check...';
        try {
          const { stdout: healthResponse } = await execa('curl', [
            '-s',
            '--max-time',
            '5',
            'http://127.0.0.1:3100/api/health',
          ]);
          subtask.output = `Panel service running. Health: ${healthResponse}`;
        } catch (error) {
          const { stdout: logs } = await execa('journalctl', [
            '-u',
            'lamalibre-lamaste-serverd',
            '--no-pager',
            '-n',
            '20',
          ]);
          throw new Error(
            `Panel health check failed. The service is running but not responding.\nRecent logs:\n${logs}\n${error.message}`,
          );
        }
      },
      rendererOptions: { persistentOutput: true },
    },
  ]);
}
