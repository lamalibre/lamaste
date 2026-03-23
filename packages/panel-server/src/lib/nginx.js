import { execa } from 'execa';
import { writeFile as fsWriteFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const SITES_AVAILABLE = '/etc/nginx/sites-available';
const SITES_ENABLED = '/etc/nginx/sites-enabled';

/**
 * Check if a file exists at the given nginx path using sudo.
 */
async function fileExistsSudo(filePath) {
  try {
    await execa('sudo', ['test', '-f', filePath]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write content to an nginx site file using a temp file and sudo mv.
 */
async function writeVhostFile(name, content) {
  const tmpFile = path.join(tmpdir(), `nginx-${name}-${crypto.randomBytes(4).toString('hex')}`);
  await fsWriteFile(tmpFile, content, 'utf-8');

  try {
    await execa('sudo', ['mv', tmpFile, path.join(SITES_AVAILABLE, name)]);
    await execa('sudo', ['chmod', '644', path.join(SITES_AVAILABLE, name)]);
  } catch (err) {
    throw new Error(`Failed to write nginx vhost file ${name}: ${err.stderr || err.message}`);
  }
}

/**
 * Write the panel domain vhost with mTLS and Let's Encrypt certs.
 */
export async function writePanelVhost(domain) {
  const fqdn = `panel.${domain}`;
  const config = `# Rate limit zone for public enrollment endpoint (5 requests/minute per IP)
limit_req_zone $binary_remote_addr zone=enroll_domain:1m rate=5r/m;

server {
    listen 443 ssl;
    server_name ${fqdn};

    ssl_certificate /etc/letsencrypt/live/${fqdn}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${fqdn}/privkey.pem;

    # mTLS — same as IP-based access
    include /etc/nginx/snippets/portlama-mtls.conf;

    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Default location (mTLS required — reject if cert missing or invalid)
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

    # Public API paths (no mTLS verification check)
    location /api/enroll {
        limit_req zone=enroll_domain burst=5 nodelay;
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

  await writeVhostFile('portlama-panel-domain', config);
  return path.join(SITES_AVAILABLE, 'portlama-panel-domain');
}

/**
 * Write the Authelia auth portal vhost.
 */
export async function writeAuthVhost(domain) {
  const fqdn = `auth.${domain}`;
  const config = `server {
    listen 443 ssl;
    server_name ${fqdn};

    ssl_certificate /etc/letsencrypt/live/${fqdn}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${fqdn}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Invitation page — static HTML
    location /invite/ {
        alias /var/www/portlama/invite/;
        try_files $uri /invite/index.html;
    }

    # Invitation API — proxied to panel server (no mTLS)
    location /api/invite/ {
        proxy_pass http://127.0.0.1:3100/api/invite/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Default — proxy to Authelia
    location / {
        proxy_pass http://127.0.0.1:9091;
    }
}
`;

  await writeVhostFile('portlama-auth', config);
  return path.join(SITES_AVAILABLE, 'portlama-auth');
}

/**
 * Write the Chisel tunnel WebSocket vhost.
 */
export async function writeTunnelVhost(domain) {
  const fqdn = `tunnel.${domain}`;
  const config = `server {
    listen 443 ssl;
    server_name ${fqdn};

    ssl_certificate /etc/letsencrypt/live/${fqdn}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${fqdn}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    location / {
        proxy_pass http://127.0.0.1:9090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Long timeout for WebSocket tunnel connections
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
`;

  await writeVhostFile('portlama-tunnel', config);
  return path.join(SITES_AVAILABLE, 'portlama-tunnel');
}

/**
 * Write an app tunnel vhost with Authelia forward auth.
 *
 * Performs a safe write-with-rollback sequence:
 * 1. Backup existing vhost (if any)
 * 2. Write the new vhost config
 * 3. Create symlink in sites-enabled
 * 4. Test nginx config
 * 5. On success: reload nginx; on failure: rollback to backup
 *
 * @param {string} subdomain - The subdomain name (e.g., "myapp")
 * @param {string} domain - The base domain (e.g., "example.com")
 * @param {number} port - The local port to proxy to
 * @param {string} [certPath] - Optional cert directory path override (e.g. for wildcard certs)
 */
export async function writeAppVhost(subdomain, domain, port, certPath) {
  const fqdn = `${subdomain}.${domain}`;
  const certDir = certPath || `/etc/letsencrypt/live/${fqdn}`;
  // Normalize: remove trailing slash if present
  const certDirClean = certDir.replace(/\/+$/, '');

  const config = `server {
    listen 443 ssl;
    server_name ${fqdn};

    ssl_certificate ${certDirClean}/fullchain.pem;
    ssl_certificate_key ${certDirClean}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Authelia forward authentication (AuthRequest implementation for nginx)
    location /internal/authelia/authz {
        internal;

        proxy_pass http://127.0.0.1:9091/api/authz/auth-request;
        proxy_pass_request_body off;

        proxy_set_header Content-Length "";
        proxy_set_header Connection "";
        proxy_set_header X-Original-Method $request_method;
        proxy_set_header X-Original-URL $scheme://$http_host$request_uri;
        proxy_set_header X-Forwarded-For $remote_addr;

        proxy_http_version 1.1;
        proxy_buffers 4 32k;
        proxy_next_upstream error timeout invalid_header http_500 http_502 http_503;
    }

    location / {
        auth_request /internal/authelia/authz;
        auth_request_set $user $upstream_http_remote_user;
        auth_request_set $groups $upstream_http_remote_groups;
        auth_request_set $name $upstream_http_remote_name;
        auth_request_set $email $upstream_http_remote_email;
        auth_request_set $redirection_url $upstream_http_location;

        proxy_set_header Remote-User $user;
        proxy_set_header Remote-Groups $groups;
        proxy_set_header Remote-Name $name;
        proxy_set_header Remote-Email $email;

        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # Redirect unauthenticated requests to Authelia login portal
    error_page 401 =302 $redirection_url;
}
`;

  const name = `portlama-app-${subdomain}`;
  const availablePath = path.join(SITES_AVAILABLE, name);
  const bakPath = `${availablePath}.bak`;

  // 1. Backup existing vhost if present
  const existed = await fileExistsSudo(availablePath);
  if (existed) {
    await execa('sudo', ['cp', availablePath, bakPath]);
  }

  try {
    // 2. Write new vhost
    await writeVhostFile(name, config);

    // 3. Create symlink in sites-enabled
    await enableSite(name);

    // 4. Test nginx config
    const result = await testConfig();
    if (!result.valid) {
      // Rollback: restore backup or remove new file
      if (existed) {
        await execa('sudo', ['mv', bakPath, availablePath]);
      } else {
        await execa('sudo', ['rm', '-f', availablePath]);
        await execa('sudo', ['rm', '-f', path.join(SITES_ENABLED, name)]);
      }
      throw new Error(`Nginx config test failed after writing vhost for ${fqdn}: ${result.error}`);
    }

    // 5. Reload nginx
    await reload();

    // Clean up backup on success
    if (existed) {
      await execa('sudo', ['rm', '-f', bakPath]).catch(() => {});
    }

    return availablePath;
  } catch (err) {
    // If the error is already from our config test, re-throw it
    if (err.message.includes('Nginx config test failed')) {
      throw err;
    }

    // Rollback on unexpected errors
    if (existed) {
      await execa('sudo', ['mv', bakPath, availablePath]).catch(() => {});
    } else {
      await execa('sudo', ['rm', '-f', availablePath]).catch(() => {});
      await execa('sudo', ['rm', '-f', path.join(SITES_ENABLED, name)]).catch(() => {});
    }
    throw err;
  }
}

/**
 * Write a static site vhost with optional Authelia forward auth.
 *
 * Performs a safe write-with-rollback sequence (same as writeAppVhost):
 * 1. Backup existing vhost (if any)
 * 2. Write the new vhost config
 * 3. Create symlink in sites-enabled
 * 4. Test nginx config
 * 5. On success: reload nginx; on failure: rollback to backup
 *
 * @param {object} site - The site object from sites.json
 * @param {string} site.id - Site UUID
 * @param {string} site.fqdn - Full domain (e.g., "blog.example.com")
 * @param {boolean} site.spaMode - If true, try_files falls back to /index.html
 * @param {boolean} site.autheliaProtected - If true, add Authelia forward auth
 * @param {string} site.rootPath - Directory root (e.g., /var/www/portlama/{id}/)
 * @param {string} certDir - Certificate directory path
 * @param {string} [domain] - Base domain (needed for Authelia redirect URL)
 */
export async function writeStaticSiteVhost(site, certDir, domain) {
  const certDirClean = certDir.replace(/\/+$/, '');
  const tryFiles = site.spaMode ? 'try_files $uri $uri/ /index.html' : 'try_files $uri $uri/ =404';

  let autheliaBlock = '';
  let locationAuthDirectives = '';

  if (site.autheliaProtected && domain) {
    autheliaBlock = `
    # Authelia forward authentication (AuthRequest implementation for nginx)
    location /internal/authelia/authz {
        internal;

        proxy_pass http://127.0.0.1:9091/api/authz/auth-request;
        proxy_pass_request_body off;

        proxy_set_header Content-Length "";
        proxy_set_header Connection "";
        proxy_set_header X-Original-Method $request_method;
        proxy_set_header X-Original-URL $scheme://$http_host$request_uri;
        proxy_set_header X-Forwarded-For $remote_addr;

        proxy_http_version 1.1;
        proxy_buffers 4 32k;
        proxy_next_upstream error timeout invalid_header http_500 http_502 http_503;
    }
`;
    locationAuthDirectives = `
        auth_request /internal/authelia/authz;
        auth_request_set $user $upstream_http_remote_user;
        auth_request_set $groups $upstream_http_remote_groups;
        auth_request_set $redirection_url $upstream_http_location;`;
  }

  const config = `server {
    listen 443 ssl;
    server_name ${site.fqdn};

    ssl_certificate ${certDirClean}/fullchain.pem;
    ssl_certificate_key ${certDirClean}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    root ${site.rootPath};
    index index.html;

    # Security headers
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
${autheliaBlock}
    location / {${locationAuthDirectives}
        ${tryFiles};
    }
${
  site.autheliaProtected && domain
    ? `
    # Redirect unauthenticated requests to Authelia login portal
    error_page 401 =302 $redirection_url;
`
    : ''
}
}
`;

  const name = `portlama-site-${site.id}`;
  const availablePath = path.join(SITES_AVAILABLE, name);
  const bakPath = `${availablePath}.bak`;

  // 1. Backup existing vhost if present
  const existed = await fileExistsSudo(availablePath);
  if (existed) {
    await execa('sudo', ['cp', availablePath, bakPath]);
  }

  try {
    // 2. Write new vhost
    await writeVhostFile(name, config);

    // 3. Create symlink in sites-enabled
    await enableSite(name);

    // 4. Test nginx config
    const result = await testConfig();
    if (!result.valid) {
      if (existed) {
        await execa('sudo', ['mv', bakPath, availablePath]);
      } else {
        await execa('sudo', ['rm', '-f', availablePath]);
        await execa('sudo', ['rm', '-f', path.join(SITES_ENABLED, name)]);
      }
      throw new Error(
        `Nginx config test failed after writing vhost for ${site.fqdn}: ${result.error}`,
      );
    }

    // 5. Reload nginx
    await reload();

    // Clean up backup on success
    if (existed) {
      await execa('sudo', ['rm', '-f', bakPath]).catch(() => {});
    }

    return availablePath;
  } catch (err) {
    if (err.message.includes('Nginx config test failed')) {
      throw err;
    }

    // Rollback on unexpected errors
    if (existed) {
      await execa('sudo', ['mv', bakPath, availablePath]).catch(() => {});
    } else {
      await execa('sudo', ['rm', '-f', availablePath]).catch(() => {});
      await execa('sudo', ['rm', '-f', path.join(SITES_ENABLED, name)]).catch(() => {});
    }
    throw err;
  }
}

/**
 * Remove a static site vhost from sites-available and sites-enabled, then test and reload nginx.
 * Idempotent: if files don't exist, proceeds silently.
 *
 * @param {string} siteId - The site UUID
 */
export async function removeStaticSiteVhost(siteId) {
  const name = `portlama-site-${siteId}`;
  try {
    await execa('sudo', ['rm', '-f', path.join(SITES_ENABLED, name)]);
    await execa('sudo', ['rm', '-f', path.join(SITES_AVAILABLE, name)]);
    await execa('sudo', ['rm', '-f', `${path.join(SITES_AVAILABLE, name)}.bak`]);
  } catch (err) {
    throw new Error(`Failed to remove static site vhost ${name}: ${err.stderr || err.message}`);
  }

  const result = await testConfig();
  if (!result.valid) {
    throw new Error(`Nginx config test failed after removing vhost ${name}: ${result.error}`);
  }

  await reload();
}

/**
 * Remove an app vhost from sites-available and sites-enabled, then test and reload nginx.
 * Idempotent: if files don't exist, proceeds silently.
 *
 * @param {string} subdomain - The subdomain name
 */
export async function removeAppVhost(subdomain) {
  const name = `portlama-app-${subdomain}`;
  try {
    await execa('sudo', ['rm', '-f', path.join(SITES_ENABLED, name)]);
    await execa('sudo', ['rm', '-f', path.join(SITES_AVAILABLE, name)]);
    await execa('sudo', ['rm', '-f', `${path.join(SITES_AVAILABLE, name)}.bak`]);
  } catch (err) {
    throw new Error(`Failed to remove app vhost ${name}: ${err.stderr || err.message}`);
  }

  const result = await testConfig();
  if (!result.valid) {
    throw new Error(`Nginx config test failed after removing vhost ${name}: ${result.error}`);
  }

  await reload();
}

/**
 * Test the nginx configuration. Returns { valid: true } or { valid: false, error }.
 * Does NOT throw on invalid config.
 */
export async function testConfig() {
  try {
    await execa('sudo', ['nginx', '-t']);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.stderr || err.message };
  }
}

/**
 * Reload the nginx service.
 */
export async function reload() {
  try {
    await execa('sudo', ['systemctl', 'reload', 'nginx']);
    return { reloaded: true };
  } catch (err) {
    throw new Error(`Failed to reload nginx: ${err.stderr || err.message}`);
  }
}

/**
 * Enable a site by creating a symlink in sites-enabled.
 */
export async function enableSite(name) {
  try {
    await execa('sudo', [
      'ln',
      '-sf',
      path.join(SITES_AVAILABLE, name),
      path.join(SITES_ENABLED, name),
    ]);
  } catch (err) {
    throw new Error(`Failed to enable site ${name}: ${err.stderr || err.message}`);
  }
}

/**
 * Disable a site by removing its symlink from sites-enabled.
 */
export async function disableSite(name) {
  try {
    await execa('sudo', ['rm', '-f', path.join(SITES_ENABLED, name)]);
  } catch (err) {
    throw new Error(`Failed to disable site ${name}: ${err.stderr || err.message}`);
  }
}

/**
 * Enable an app tunnel vhost (restore symlink), test and reload nginx.
 *
 * @param {string} subdomain - The subdomain name
 */
export async function enableAppVhost(subdomain) {
  const name = `portlama-app-${subdomain}`;
  await enableSite(name);

  const result = await testConfig();
  if (!result.valid) {
    // Rollback: remove the symlink we just created
    await disableSite(name);
    throw new Error(`Nginx config test failed after enabling vhost ${name}: ${result.error}`);
  }

  await reload();
}

/**
 * Disable an app tunnel vhost (remove symlink only, keep config), test and reload nginx.
 *
 * @param {string} subdomain - The subdomain name
 */
export async function disableAppVhost(subdomain) {
  const name = `portlama-app-${subdomain}`;
  await disableSite(name);

  const result = await testConfig();
  if (!result.valid) {
    // Rollback: re-enable the site
    await enableSite(name);
    throw new Error(`Nginx config test failed after disabling vhost ${name}: ${result.error}`);
  }

  await reload();
}

/**
 * List all enabled Portlama sites.
 */
export async function listEnabledSites() {
  try {
    const entries = await readdir(SITES_ENABLED);
    return entries.filter((name) => name.startsWith('portlama-'));
  } catch {
    return [];
  }
}
