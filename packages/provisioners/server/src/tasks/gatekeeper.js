import crypto from 'node:crypto';
import { execa } from 'execa';
import { writeFile, mkdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateGatekeeperServiceUnit } from '../lib/service-config.js';

/**
 * Gatekeeper deployment subtasks: deploy package, create state files,
 * write systemd service, enable and start.
 *
 * @param {object} ctx  Shared installer context.
 * @param {object} task Parent Listr2 task reference.
 * @returns {import('listr2').ListrTask[]}
 */
export function gatekeeperTasks(ctx, task) {
  const installDir = ctx.installDir;
  const configDir = ctx.configDir;

  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);
  const packageRoot = join(thisDir, '..', '..');
  const vendorDir = join(packageRoot, 'vendor');

  return task.newListr([
    {
      title: 'Deploying gatekeeper package',
      task: async (_ctx, subtask) => {
        const gatekeeperSrc = join(vendorDir, 'gatekeeper');
        const gatekeeperDest = `${installDir}/gatekeeper`;

        if (!existsSync(gatekeeperSrc)) {
          subtask.output = 'Gatekeeper package not found in vendor, skipping';
          return;
        }

        await mkdir(gatekeeperDest, { recursive: true });

        subtask.output = 'Copying gatekeeper files...';
        await cp(join(gatekeeperSrc, 'package.json'), join(gatekeeperDest, 'package.json'));
        await cp(join(gatekeeperSrc, 'dist'), join(gatekeeperDest, 'dist'), {
          recursive: true,
        });

        subtask.output = 'Installing production dependencies...';
        await execa('npm', ['install', '--production', '--ignore-scripts'], {
          cwd: gatekeeperDest,
        });

        await execa('chown', ['-R', 'lamaste:lamaste', gatekeeperDest]);
        subtask.output = 'Gatekeeper package deployed';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Creating gatekeeper state files',
      task: async (_ctx, subtask) => {
        const groupsPath = join(configDir, 'groups.json');
        const grantsPath = join(configDir, 'access-grants.json');
        const settingsPath = join(configDir, 'gatekeeper.json');

        // Create empty state files if they don't exist
        if (!existsSync(groupsPath)) {
          await writeFile(groupsPath, '{"groups":[]}\n', { encoding: 'utf-8', mode: 0o600 });
          subtask.output = 'Created groups.json';
        }
        if (!existsSync(grantsPath)) {
          await writeFile(grantsPath, '{"grants":[]}\n', { encoding: 'utf-8', mode: 0o600 });
          subtask.output = 'Created access-grants.json';
        }
        if (!existsSync(settingsPath)) {
          await writeFile(settingsPath, '{}\n', { encoding: 'utf-8', mode: 0o600 });
          subtask.output = 'Created gatekeeper.json';
        }

        await execa('chown', ['lamaste:lamaste', groupsPath, grantsPath, settingsPath]);
        subtask.output = 'State files ready';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Migrating legacy grants',
      skip: () => {
        const legacyPath = join(configDir, 'user-plugin-access.json');
        return !existsSync(legacyPath) ? 'No legacy grants file found' : false;
      },
      task: async (_ctx, subtask) => {
        // Migration is handled by the gatekeeper library on first startup.
        // We just ensure the gatekeeper service will pick it up.
        subtask.output = 'Legacy grants will be migrated on first gatekeeper startup';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Writing nginx proxy_cache config',
      skip: () => {
        const gatekeeperDest = `${installDir}/gatekeeper`;
        return !existsSync(join(gatekeeperDest, 'dist'))
          ? 'Gatekeeper package not deployed'
          : false;
      },
      task: async (_ctx, subtask) => {
        // Two-snippet design:
        //   lamalibre-lamaste-authz-cache.conf        — http{} scope, defines the zone.
        //   lamalibre-lamaste-authz-cache-loc.conf    — location{} scope, applies TTLs.
        // Denials (403) are NOT cached so grant additions take effect
        // immediately. Successful auth (200) is cached for 10s — matching
        // the Cache-Control max-age Gatekeeper sets on the response. Omitting
        // `proxy_ignore_headers Cache-Control` means nginx will honor the
        // upstream max-age as a further shortening signal.
        const cacheConfig = `# Lamaste Gatekeeper auth response cache zone
# Scope: http{}. Included from nginx.conf.
proxy_cache_path /var/cache/nginx/authz levels=1:2
    keys_zone=lamaste_authz:1m
    max_size=10m
    inactive=5m;
`;
        const cacheLocConfig = `# Lamaste Gatekeeper auth_request cache policy
# Scope: location{} using auth_request /authz/check.
proxy_cache lamaste_authz;
proxy_cache_key "$cookie_authelia_session$http_host";
proxy_cache_valid 200 10s;
proxy_cache_valid 403 0;
proxy_cache_use_stale off;
`;
        const snippetPath = '/etc/nginx/snippets/lamalibre-lamaste-authz-cache.conf';
        const locSnippetPath = '/etc/nginx/snippets/lamalibre-lamaste-authz-cache-loc.conf';

        // Create snippets directory if needed
        await execa('sudo', ['mkdir', '-p', '/etc/nginx/snippets']);

        const tmpFile = `/tmp/nginx-authz-cache-${crypto.randomBytes(4).toString('hex')}`;
        await writeFile(tmpFile, cacheConfig, 'utf-8');
        await execa('sudo', ['mv', tmpFile, snippetPath]);
        await execa('sudo', ['chmod', '644', snippetPath]);

        const tmpLoc = `/tmp/nginx-authz-cache-loc-${crypto.randomBytes(4).toString('hex')}`;
        await writeFile(tmpLoc, cacheLocConfig, 'utf-8');
        await execa('sudo', ['mv', tmpLoc, locSnippetPath]);
        await execa('sudo', ['chmod', '644', locSnippetPath]);

        subtask.output = 'nginx proxy_cache config written';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Writing gatekeeper systemd service',
      skip: () => {
        const gatekeeperDest = `${installDir}/gatekeeper`;
        return !existsSync(join(gatekeeperDest, 'dist'))
          ? 'Gatekeeper package not deployed'
          : false;
      },
      task: async (_ctx, subtask) => {
        const serviceUnit = generateGatekeeperServiceUnit({ installDir, configDir });
        const servicePath = '/etc/systemd/system/lamalibre-lamaste-gatekeeper.service';
        await writeFile(servicePath, serviceUnit);
        await execa('chmod', ['644', servicePath]);
        subtask.output = 'Systemd service unit written';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Starting gatekeeper service',
      skip: () => {
        const gatekeeperDest = `${installDir}/gatekeeper`;
        return !existsSync(join(gatekeeperDest, 'dist'))
          ? 'Gatekeeper package not deployed'
          : false;
      },
      task: async (_ctx, subtask) => {
        await execa('systemctl', ['daemon-reload']);
        await execa('systemctl', ['enable', 'lamalibre-lamaste-gatekeeper']);
        await execa('systemctl', ['start', 'lamalibre-lamaste-gatekeeper']);

        // Wait for startup
        await sleep(2000);

        const { stdout: status } = await execa('systemctl', [
          'is-active',
          'lamalibre-lamaste-gatekeeper',
        ]);
        if (status.trim() !== 'active') {
          const { stdout: logs } = await execa('journalctl', [
            '-u',
            'lamalibre-lamaste-gatekeeper',
            '-n',
            '20',
            '--no-pager',
          ]);
          throw new Error(`Gatekeeper service failed to start: ${status}\n${logs}`);
        }

        // Health check
        try {
          const { stdout } = await execa('curl', [
            '-s',
            '--max-time',
            '5',
            'http://127.0.0.1:9294/health',
          ]);
          subtask.output = `Gatekeeper service running. Health: ${stdout}`;
        } catch (err) {
          subtask.output = `Gatekeeper service active but health check pending (${err.message})`;
        }
      },
      rendererOptions: { persistentOutput: true },
    },
  ]);
}
