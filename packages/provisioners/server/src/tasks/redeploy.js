import { execa } from 'execa';
import { writeFile, readFile, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateServiceUnit, generateSudoersContent } from '../lib/service-config.js';
import { lookupId } from '../lib/accounts.js';
import { ensureHttpRedirect } from '../lib/http-redirect.js';
import { generateCertHelpPage } from '../lib/cert-help-page.js';
import { ensureRootOwnedInstallDir, removeTree, writeFileNoFollow } from '../lib/ownership.js';
import { provisionRelayServices } from '../lib/relay-services.js';
import { installSudoersFile, installSudoersWrappers } from '../lib/wrappers.js';
import { deployGatekeeperPackage } from './gatekeeper.js';

const GATEKEEPER_SERVICE = 'lamalibre-lamaste-gatekeeper';

async function isActive(service) {
  try {
    const { stdout } = await execa('systemctl', ['is-active', service]);
    return stdout.trim() === 'active';
  } catch {
    return false;
  }
}

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
 * Panel redeployment subtasks — the upgrade path, also run by the panel's
 * self-update (`lamaste-priv self-update`). Updates the panel, CLI, UI, docs
 * and gatekeeper; installs the pinned chisel and Authelia releases, their
 * units, the sudoers rules and the programs they name; restarts what
 * changed. Does not touch OS hardening, mTLS certs or the panel's vhosts.
 *
 * Runs as root and may be started by a compromised panel, so it never
 * writes through a path the lamaste user controls (see lib/ownership.js).
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
      title: 'Stopping panel services',
      task: async (_ctx, subtask) => {
        const panelActive = await isActive('lamalibre-lamaste-serverd');
        if (panelActive) await execa('systemctl', ['stop', 'lamalibre-lamaste-serverd']);
        // Gatekeeper runs from the install directory, which may be replaced.
        ctx.gatekeeperWasActive = await isActive(GATEKEEPER_SERVICE);
        if (ctx.gatekeeperWasActive) await execa('systemctl', ['stop', GATEKEEPER_SERVICE]);
        subtask.output = panelActive ? 'Services stopped' : 'Panel was not running';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Securing the install directory',
      task: async (_ctx, subtask) => {
        // Earlier versions gave the install directory to the lamaste user.
        // Code root runs (the lamaste-server CLI) and code the panel runs
        // must not be writable by the panel: the old tree is moved aside,
        // every component is redeployed into a fresh root-owned directory,
        // and the old tree is removed at the end.
        const { previous } = await ensureRootOwnedInstallDir(installDir);
        ctx.previousInstallDir = previous;
        subtask.output = previous
          ? `Moved the lamaste-owned tree aside (${previous}); redeploying into a root-owned directory`
          : 'Install directory is root-owned';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Updating serverd',
      task: async (_ctx, subtask) => {
        const serverDest = join(installDir, 'serverd');
        // A fresh root-private directory: a predictable /tmp path could be
        // prepared in advance by another local user.
        const tmpDir = await mkdtemp(join(tmpdir(), 'lamaste-panel-update-'));

        try {
          // Download the package tarball to a temp directory via npm pack,
          // then extract. We cannot `npm install` inside serverDest because
          // its package.json has the same name — npm refuses to install a
          // package as a dependency of itself.
          await mkdir(serverDest, { recursive: true });

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
          subtask.output =
            'lamaste-server CLI not bundled — skipping (upgrade create-lamaste to fix)';
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
          throw new Error(
            'Pre-built lamaste-server-ui dist not found. The package may be corrupted.',
          );
        }

        subtask.output = 'Copying lamaste-server-ui dist...';
        await mkdir(clientDest, { recursive: true });
        const distDest = join(clientDest, 'dist');
        await rm(distDest, { recursive: true, force: true });
        await cp(prebuiltDist, distDest, { recursive: true });

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
          subtask.output = 'Documentation updated';
        } else {
          subtask.output = 'No bundled docs found — skipping';
        }
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Updating gatekeeper',
      task: async (_ctx, subtask) => {
        subtask.output = (await deployGatekeeperPackage(vendorDir, installDir))
          ? 'Gatekeeper updated'
          : 'Gatekeeper not bundled — skipping';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Updating certificate help page',
      task: async (_ctx, subtask) => {
        const helpDir = join(installDir, 'lamaste-server-ui');
        await mkdir(helpDir, { recursive: true });
        await writeFile(join(helpDir, 'cert-help.html'), generateCertHelpPage(ctx));
        subtask.output = 'Certificate help page written';
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

        // The config directory belongs to lamaste: write a fresh file and
        // rename it into place, never through what is already there.
        await writeFileNoFollow(configPath, JSON.stringify(config, null, 2) + '\n', {
          mode: 0o600,
          uid: await lookupId('user', 'lamaste'),
          gid: await lookupId('group', 'lamaste'),
        });

        subtask.output = 'Configuration updated';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Updating chisel and Authelia',
      task: async (_ctx, subtask) => {
        // Authelia is stopped while its files change hands (earlier versions
        // ran it as root: a root process writing its database during the
        // migration would leave root-owned files the new account cannot
        // open) and while its binary is replaced; it is started again below.
        ctx.autheliaWasActive = await isActive('authelia');
        if (ctx.autheliaWasActive) await execa('systemctl', ['stop', 'authelia']);
        const result = await provisionRelayServices(ctx, (line) => {
          subtask.output = line;
        });
        ctx.chiselChanged = result.chiselChanged;
        subtask.output = 'chisel and Authelia up to date';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Updating systemd unit and sudoers',
      task: async (_ctx, subtask) => {
        subtask.output = 'Writing systemd service unit...';
        const serviceUnit = generateServiceUnit({ installDir, configDir });
        await writeFile('/etc/systemd/system/lamalibre-lamaste-serverd.service', serviceUnit);

        // The programs the sudoers rules name go in first; retired ones go.
        await installSudoersWrappers(join(dirname(thisFile), '..', '..', 'scripts'), (line) => {
          subtask.output = line;
        });

        subtask.output = 'Writing sudoers rules...';
        await installSudoersFile(generateSudoersContent());

        subtask.output = 'Systemd unit and sudoers updated';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Redirecting plain HTTP to HTTPS',
      task: async (_ctx, subtask) => {
        // Not fatal: another site on this machine may already own port 80's
        // default server. The relay works without the redirect.
        try {
          const { changed } = await ensureHttpRedirect();
          subtask.output = changed
            ? 'Port 80 now redirects every host to https://'
            : 'Port 80 redirect already in place';
        } catch (err) {
          subtask.skip(`Skipped — ${err.message}`);
        }
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Reloading systemd and restarting panel',
      task: async (_ctx, subtask) => {
        subtask.output = 'Reloading systemd daemon...';
        await execa('systemctl', ['daemon-reload']);

        // A new binary or unit takes effect on restart. try-restart leaves a
        // service that is not running (not yet onboarded, or held down by the
        // panel's fail-closed reconciliation) alone.
        if (ctx.chiselChanged) {
          subtask.output = 'Restarting chisel...';
          await execa('systemctl', ['try-restart', 'chisel']);
        }
        if (ctx.autheliaWasActive) {
          subtask.output = 'Starting Authelia...';
          await execa('systemctl', ['start', 'authelia']);
        }
        if (ctx.gatekeeperWasActive) {
          subtask.output = 'Starting gatekeeper...';
          await execa('systemctl', ['start', GATEKEEPER_SERVICE]);
        }

        subtask.output = 'Starting lamalibre-lamaste-serverd...';
        await execa('systemctl', ['start', 'lamalibre-lamaste-serverd']);

        subtask.output = 'Waiting for service to start...';
        await sleep(3000);

        const { stdout: status } = await execa('systemctl', [
          'is-active',
          'lamalibre-lamaste-serverd',
        ]);
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
    {
      title: 'Removing the previous install directory',
      skip: () => (ctx.previousInstallDir ? false : 'Nothing to remove'),
      task: async (_ctx, subtask) => {
        // coreutils rm: does not follow symlinks the old (lamaste-owned) tree holds.
        await removeTree(ctx.previousInstallDir);
        subtask.output = `Removed ${ctx.previousInstallDir}`;
      },
      rendererOptions: { persistentOutput: true },
    },
  ]);
}
