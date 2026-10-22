import { execa } from 'execa';
import { writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { ensureHttpRedirect } from '../lib/http-redirect.js';
import { IP_PANEL_SITE, generateIpPanelVhost } from '../lib/ip-panel-vhost.js';

/**
 * nginx IP-based mTLS configuration subtasks.
 *
 * @param {object} ctx  Shared installer context.
 * @param {object} task Parent Listr2 task reference.
 * @returns {import('listr2').ListrTask[]}
 */
export function nginxTasks(ctx, task) {
  const pkiDir = ctx.pkiDir;

  return task.newListr([
    {
      title: 'Generating self-signed TLS certificate for IP access',
      task: async (_ctx, subtask) => {
        subtask.output = `Generating self-signed cert for IP ${ctx.ip}...`;
        await execa('openssl', [
          'req',
          '-x509',
          '-nodes',
          '-days',
          '3650',
          '-newkey',
          'rsa:2048',
          '-keyout',
          `${pkiDir}/self-signed-key.pem`,
          '-out',
          `${pkiDir}/self-signed.pem`,
          '-subj',
          `/CN=${ctx.ip}/O=Lamaste`,
          '-addext',
          `subjectAltName=IP:${ctx.ip}`,
        ]);

        await execa('chmod', ['600', `${pkiDir}/self-signed-key.pem`]);
        await execa('chmod', ['644', `${pkiDir}/self-signed.pem`]);

        subtask.output = 'Self-signed TLS certificate generated';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Writing mTLS snippet',
      task: async (_ctx, subtask) => {
        const snippetsDir = '/etc/nginx/snippets';
        if (!existsSync(snippetsDir)) {
          await execa('mkdir', ['-p', snippetsDir]);
        }

        const mtlsSnippet = `ssl_client_certificate ${pkiDir}/ca.crt;
ssl_verify_client optional;
`;
        await writeFile('/etc/nginx/snippets/lamalibre-lamaste-mtls.conf', mtlsSnippet);

        subtask.output = 'mTLS snippet written to /etc/nginx/snippets/lamalibre-lamaste-mtls.conf';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Writing IP-based panel vhost',
      task: async (_ctx, subtask) => {
        const vhostPath = `/etc/nginx/sites-available/${IP_PANEL_SITE}`;
        await writeFile(vhostPath, generateIpPanelVhost(pkiDir));

        subtask.output = `Vhost written to ${vhostPath}`;
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Enabling site and cleaning up defaults',
      task: async (_ctx, subtask) => {
        // Create symlink
        await execa('ln', [
          '-sf',
          `/etc/nginx/sites-available/${IP_PANEL_SITE}`,
          `/etc/nginx/sites-enabled/${IP_PANEL_SITE}`,
        ]);

        // Remove only the default site from sites-enabled (preserve other existing sites)
        const defaultSite = '/etc/nginx/sites-enabled/default';
        if (existsSync(defaultSite)) {
          await unlink(defaultSite).catch(() => {});
          subtask.output = 'Site enabled, default removed';
        } else {
          subtask.output = 'Site enabled';
        }
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Redirecting plain HTTP to HTTPS',
      task: async (_ctx, subtask) => {
        // nginx is (re)started by the next task; no reload here. Not fatal:
        // another site on this machine may already own port 80's default
        // server, and the relay works without the redirect.
        try {
          await ensureHttpRedirect({ reload: false });
          subtask.output = 'Port 80 answers every host with a redirect to https://';
        } catch (err) {
          subtask.skip(`Skipped — ${err.message}`);
        }
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Validating and starting nginx',
      task: async (_ctx, subtask) => {
        subtask.output = 'Validating nginx configuration...';
        try {
          await execa('nginx', ['-t']);
        } catch (error) {
          throw new Error(
            `nginx configuration validation failed:\n${error.stderr || error.message}`,
          );
        }

        subtask.output = 'Enabling and starting nginx...';
        await execa('systemctl', ['enable', 'nginx']);
        await execa('systemctl', ['restart', 'nginx']);

        const { stdout: status } = await execa('systemctl', ['is-active', 'nginx']);
        if (status.trim() !== 'active') {
          throw new Error(`nginx failed to start. Status: ${status.trim()}`);
        }

        subtask.output = 'nginx is running and listening on port 9292';
      },
      rendererOptions: { persistentOutput: true },
    },
  ]);
}
