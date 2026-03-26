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
  // This file is at packages/create-portlama/src/tasks/panel.js
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
          await execa('id', ['portlama']);
          subtask.output = 'User portlama already exists';
        } catch {
          await execa('useradd', [
            '--system',
            '--no-create-home',
            '--shell',
            '/usr/sbin/nologin',
            'portlama',
          ]);
          subtask.output = 'Created system user: portlama';
        }
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Creating directory structure',
      task: async (_ctx, subtask) => {
        await mkdir(`${installDir}/panel-server`, { recursive: true });
        await mkdir(`${installDir}/panel-client`, { recursive: true });
        await mkdir(configDir, { recursive: true });
        await mkdir('/var/www/portlama', { recursive: true });

        await execa('chown', ['-R', 'portlama:portlama', installDir]);
        await execa('chown', ['-R', 'portlama:portlama', configDir]);
        await execa('chown', ['-R', 'www-data:www-data', '/var/www/portlama']);

        subtask.output = `Directories created: ${installDir}, ${configDir}, /var/www/portlama`;
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Deploying panel-server',
      task: async (_ctx, subtask) => {
        const serverSrc = join(vendorDir, 'panel-server');
        const serverDest = `${installDir}/panel-server`;

        if (!existsSync(serverSrc)) {
          throw new Error(
            `Panel server source not found at ${serverSrc}. Ensure the monorepo is intact.`,
          );
        }

        subtask.output = 'Copying panel-server files...';
        // Copy package.json and src directory
        await cp(join(serverSrc, 'package.json'), join(serverDest, 'package.json'));
        await cp(join(serverSrc, 'src'), join(serverDest, 'src'), {
          recursive: true,
        });

        subtask.output = 'Installing production dependencies...';
        try {
          await execa('npm', ['install', '--production', '--ignore-scripts'], {
            cwd: serverDest,
          });
        } catch (err) {
          throw new Error(
            `Failed to install panel-server dependencies. Check your network connection and try again.\n${err.stderr || err.message}`,
          );
        }

        await execa('chown', ['-R', 'portlama:portlama', serverDest]);

        // Create CLI symlink for portlama-reset-admin
        const resetAdminSrc = join(serverDest, 'src', 'cli', 'reset-admin.js');
        const resetAdminDest = '/usr/local/bin/portlama-reset-admin';
        if (existsSync(resetAdminSrc)) {
          await execa('chmod', ['+x', resetAdminSrc]);
          await execa('ln', ['-sf', resetAdminSrc, resetAdminDest]);
        }

        subtask.output = 'Panel server deployed';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Deploying panel-client',
      task: async (_ctx, subtask) => {
        const clientSrc = join(vendorDir, 'panel-client');
        const clientDest = `${installDir}/panel-client`;

        if (!existsSync(clientSrc)) {
          throw new Error(
            `Panel client source not found at ${clientSrc}. Ensure the monorepo is intact.`,
          );
        }

        // If a pre-built dist/ exists, use it directly (faster, avoids OOM on low-RAM VMs)
        const prebuiltDist = join(clientSrc, 'dist');
        if (existsSync(join(prebuiltDist, 'index.html'))) {
          subtask.output = 'Using pre-built panel-client dist...';
          const distDest = join(clientDest, 'dist');
          await rm(distDest, { recursive: true, force: true });
          await cp(prebuiltDist, distDest, { recursive: true });

          await execa('chown', ['-R', 'portlama:portlama', clientDest]);
          subtask.output = 'Panel client deployed from pre-built dist';
          return;
        }

        // No pre-built dist — build from source in a temp directory
        const buildDir = '/tmp/portlama-panel-client-build';
        await rm(buildDir, { recursive: true, force: true });
        await mkdir(buildDir, { recursive: true });

        subtask.output = 'Copying panel-client source for build...';
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
          await execa('npm', ['install'], { cwd: buildDir });
        } catch (err) {
          throw new Error(
            `Failed to install panel-client build dependencies. Check your network connection and try again.\n${err.stderr || err.message}`,
          );
        }

        subtask.output = 'Building panel-client (vite build)...';
        await execa('npx', ['vite', 'build'], { cwd: buildDir });

        subtask.output = 'Copying built assets...';
        const distSrc = join(buildDir, 'dist');
        const distDest = join(clientDest, 'dist');
        await rm(distDest, { recursive: true, force: true });
        await cp(distSrc, distDest, { recursive: true });

        await rm(buildDir, { recursive: true, force: true });

        await execa('chown', ['-R', 'portlama:portlama', clientDest]);
        subtask.output = 'Panel client built and deployed';
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
            staticDir: `${installDir}/panel-client/dist`,
          };
        } else {
          config = {
            ip: ctx.ip,
            domain: null,
            email: null,
            dataDir: configDir,
            staticDir: `${installDir}/panel-client/dist`,
            onboarding: {
              status: 'FRESH',
            },
          };
        }

        await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o640 });

        await execa('chown', ['portlama:portlama', configPath]);

        subtask.output = `Configuration written to ${configPath}`;
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Writing systemd service unit',
      task: async (_ctx, subtask) => {
        const serviceUnit = generateServiceUnit({ installDir, configDir });
        await writeFile('/etc/systemd/system/portlama-panel.service', serviceUnit);

        subtask.output = 'Systemd service unit written';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Writing sudoers rules',
      task: async (_ctx, subtask) => {
        const sudoersContent = generateSudoersContent();
        const sudoersPath = '/etc/sudoers.d/portlama';
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

        subtask.output = 'Enabling and starting portlama-panel...';
        await execa('systemctl', ['enable', 'portlama-panel']);
        await execa('systemctl', ['start', 'portlama-panel']);

        // Wait for the service to start
        subtask.output = 'Waiting for service to start...';
        await sleep(3000);

        const { stdout: status } = await execa('systemctl', ['is-active', 'portlama-panel']);
        if (status.trim() !== 'active') {
          const { stdout: logs } = await execa('journalctl', [
            '-u',
            'portlama-panel',
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
            'portlama-panel',
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
