import { execa } from 'execa';
import { writeFile, readFile, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateServiceUnit, generateSudoersContent } from '../lib/service-config.js';

/**
 * Read the installed panel-server's package.json version, or null if not found.
 * @param {string} installDir
 * @returns {Promise<string | null>}
 */
async function getInstalledVersion(installDir) {
  try {
    const pkgPath = join(installDir, 'panel-server', 'package.json');
    const raw = await readFile(pkgPath, 'utf8');
    return JSON.parse(raw).version || null;
  } catch {
    return null;
  }
}

/**
 * Read the vendor (new) panel-server's package.json version.
 * @param {string} vendorDir
 * @returns {Promise<string | null>}
 */
async function getVendorVersion(vendorDir) {
  try {
    const pkgPath = join(vendorDir, 'panel-server', 'package.json');
    const raw = await readFile(pkgPath, 'utf8');
    return JSON.parse(raw).version || null;
  } catch {
    return null;
  }
}

/**
 * Panel redeployment subtasks. Only updates panel-server and panel-client files,
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

  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);
  const packageRoot = join(thisDir, '..', '..');
  const vendorDir = join(packageRoot, 'vendor');

  return task.newListr([
    {
      title: 'Checking versions',
      task: async (_ctx, subtask) => {
        const installed = await getInstalledVersion(installDir);
        const vendor = await getVendorVersion(vendorDir);
        ctx.installedVersion = installed;
        ctx.vendorVersion = vendor;
        subtask.output = `Installed: ${installed || 'unknown'} → New: ${vendor || 'unknown'}`;
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Stopping panel service',
      task: async (_ctx, subtask) => {
        try {
          const { stdout: status } = await execa('systemctl', [
            'is-active',
            'portlama-panel',
          ]);
          if (status.trim() === 'active') {
            await execa('systemctl', ['stop', 'portlama-panel']);
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
      title: 'Updating panel-server',
      task: async (_ctx, subtask) => {
        const serverSrc = join(vendorDir, 'panel-server');
        const serverDest = join(installDir, 'panel-server');

        if (!existsSync(serverSrc)) {
          throw new Error(
            `Panel server source not found at ${serverSrc}. Ensure the package is intact.`,
          );
        }

        subtask.output = 'Copying panel-server files...';
        await cp(join(serverSrc, 'package.json'), join(serverDest, 'package.json'));
        await cp(join(serverSrc, 'src'), join(serverDest, 'src'), {
          recursive: true,
        });

        subtask.output = 'Installing production dependencies...';
        try {
          await execa('npm', ['install', '--production'], {
            cwd: serverDest,
          });
        } catch (err) {
          throw new Error(
            `Failed to install panel-server dependencies.\n${err.stderr || err.message}`,
          );
        }

        await execa('chown', ['-R', 'portlama:portlama', serverDest]);
        subtask.output = 'Panel server updated';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Updating panel-client',
      task: async (_ctx, subtask) => {
        const clientSrc = join(vendorDir, 'panel-client');
        const clientDest = join(installDir, 'panel-client');

        if (!existsSync(clientSrc)) {
          throw new Error(
            `Panel client source not found at ${clientSrc}. Ensure the package is intact.`,
          );
        }

        const prebuiltDist = join(clientSrc, 'dist');
        if (!existsSync(join(prebuiltDist, 'index.html'))) {
          throw new Error(
            'Pre-built panel-client dist not found. The package may be corrupted.',
          );
        }

        subtask.output = 'Copying panel-client dist...';
        const distDest = join(clientDest, 'dist');
        await rm(distDest, { recursive: true, force: true });
        await cp(prebuiltDist, distDest, { recursive: true });

        await execa('chown', ['-R', 'portlama:portlama', clientDest]);
        subtask.output = 'Panel client updated';
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
          staticDir: join(installDir, 'panel-client', 'dist'),
        };

        await writeFile(
          configPath,
          JSON.stringify(config, null, 2) + '\n',
          { mode: 0o640 },
        );
        await execa('chown', ['portlama:portlama', configPath]);

        subtask.output = 'Configuration updated';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Updating systemd unit and sudoers',
      task: async (_ctx, subtask) => {
        subtask.output = 'Writing systemd service unit...';
        const serviceUnit = generateServiceUnit({ installDir, configDir });
        await writeFile(
          '/etc/systemd/system/portlama-panel.service',
          serviceUnit,
        );

        subtask.output = 'Writing sudoers rules...';
        const sudoersContent = generateSudoersContent();
        const sudoersPath = '/etc/sudoers.d/portlama';
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

        subtask.output = 'Starting portlama-panel...';
        await execa('systemctl', ['start', 'portlama-panel']);

        subtask.output = 'Waiting for service to start...';
        await sleep(3000);

        const { stdout: status } = await execa('systemctl', [
          'is-active',
          'portlama-panel',
        ]);
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
            'portlama-panel',
            '--no-pager',
            '-n',
            '20',
          ]);
          throw new Error(
            `Panel health check failed.\nRecent logs:\n${logs}\n${error.message}`,
          );
        }
      },
      rendererOptions: { persistentOutput: true },
    },
  ]);
}
