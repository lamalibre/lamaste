import { execa } from 'execa';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { generateCertHelpPage } from '../lib/cert-help-page.js';

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
          `/CN=${ctx.ip}/O=Portlama`,
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
        await writeFile('/etc/nginx/snippets/portlama-mtls.conf', mtlsSnippet);

        subtask.output = 'mTLS snippet written to /etc/nginx/snippets/portlama-mtls.conf';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Writing IP-based panel vhost',
      task: async (_ctx, subtask) => {
        const vhostConfig = `# Rate limit zone for public enrollment endpoint (5 requests/minute per IP)
limit_req_zone $binary_remote_addr zone=enroll:1m rate=5r/m;

map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 9292 ssl;
    server_name _;

    ssl_certificate ${pkiDir}/self-signed.pem;
    ssl_certificate_key ${pkiDir}/self-signed-key.pem;

    include /etc/nginx/snippets/portlama-mtls.conf;

    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Show certificate help page when client cert is missing or invalid
    error_page 495 496 /cert-help.html;
    location = /cert-help.html {
        root /opt/portlama/panel-client;
        internal;
    }

    # Proxy to panel-server (mTLS required — reject if cert missing or invalid)
    location / {
        if ($ssl_client_verify != SUCCESS) {
            return 496;
        }
        proxy_pass http://127.0.0.1:3100;

        # Client cert headers — set from nginx TLS variables, never passed through from client
        proxy_set_header X-SSL-Client-Verify $ssl_client_verify;
        proxy_set_header X-SSL-Client-DN $ssl_client_s_dn;
        proxy_set_header X-SSL-Client-Serial $ssl_client_serial;

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Public API paths (no mTLS verification check).
    # ssl_verify_client is 'optional' at server level, so TLS handshake
    # succeeds without a cert. These locations skip the $ssl_client_verify
    # check and clear cert headers so the backend sees no client identity.
    location /api/enroll {
        limit_req zone=enroll burst=5 nodelay;
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;

        # Clear cert headers so the backend sees no client cert
        proxy_set_header X-SSL-Client-Verify "";
        proxy_set_header X-SSL-Client-DN "";
        proxy_set_header X-SSL-Client-Serial "";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/invite {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;

        proxy_set_header X-SSL-Client-Verify "";
        proxy_set_header X-SSL-Client-DN "";
        proxy_set_header X-SSL-Client-Serial "";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API paths with WebSocket upgrade support (mTLS required)
    location /api {
        if ($ssl_client_verify != SUCCESS) {
            return 496;
        }
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;

        # Client cert headers — set from nginx TLS variables, never passed through from client
        proxy_set_header X-SSL-Client-Verify $ssl_client_verify;
        proxy_set_header X-SSL-Client-DN $ssl_client_s_dn;
        proxy_set_header X-SSL-Client-Serial $ssl_client_serial;

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket: only upgrade when client requests it
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
`;
        await writeFile('/etc/nginx/sites-available/portlama-panel-ip', vhostConfig);

        subtask.output = 'Vhost written to /etc/nginx/sites-available/portlama-panel-ip';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Deploying certificate help page',
      task: async (_ctx, subtask) => {
        const helpDir = '/opt/portlama/panel-client';
        await mkdir(helpDir, { recursive: true });
        const html = generateCertHelpPage(ctx);
        await writeFile(`${helpDir}/cert-help.html`, html);
        subtask.output = 'Certificate help page deployed';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Enabling site and cleaning up defaults',
      task: async (_ctx, subtask) => {
        // Create symlink
        await execa('ln', [
          '-sf',
          '/etc/nginx/sites-available/portlama-panel-ip',
          '/etc/nginx/sites-enabled/portlama-panel-ip',
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
