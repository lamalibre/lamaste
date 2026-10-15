import { execa } from 'execa';
import { access, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

const SITES_AVAILABLE = '/etc/nginx/sites-available';
const SITES_ENABLED = '/etc/nginx/sites-enabled';

/**
 * The root helper that installs vhosts (create-lamaste installs it; see
 * provisioners/server/scripts/lamaste-priv). It accepts only the site names
 * the panel manages and only vhosts built from the directives these
 * generators use: nginx opens the files a configuration names as root, so a
 * free-form vhost would be a root shell for whoever controls the panel.
 */
const PRIV = '/usr/local/sbin/lamaste-priv';

/**
 * Ceiling for one nginx-related command (a `lamaste-priv` action, `nginx -t`,
 * a reload). Each takes well under a second; a hung one must fail — and roll
 * the vhost back — rather than hold up the caller, which at startup is the
 * panel before it listens.
 */
const NGINX_COMMAND_TIMEOUT_MS = 60_000;

/**
 * Run one `lamaste-priv nginx-site` action.
 *
 * @param {'write'|'backup'|'restore'|'discard-backup'|'enable'|'disable'|'remove'} action
 * @param {string} name
 * @param {string} [content] - vhost text, for `write`
 */
async function siteAction(action, name, content) {
  try {
    await execa('sudo', [PRIV, 'nginx-site', action, name], {
      timeout: NGINX_COMMAND_TIMEOUT_MS,
      ...(content === undefined ? {} : { input: content }),
    });
  } catch (err) {
    throw new Error(`nginx site ${action} failed for ${name}: ${err.stderr || err.message}`);
  }
}

/** True when `name` exists in sites-available. The directory is world-readable. */
async function siteExists(name) {
  try {
    await access(path.join(SITES_AVAILABLE, name));
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Install `content` as sites-available/<name>.
 */
async function writeVhostFile(name, content) {
  await siteAction('write', name, content);
}

/**
 * Write the panel domain vhost with mTLS and Let's Encrypt certs.
 */
export async function writePanelVhost(domain) {
  const fqdn = `panel.${domain}`;
  const config = `# Rate limit zone for public enrollment endpoint (5 requests/minute per IP)
limit_req_zone $binary_remote_addr zone=enroll_domain:1m rate=5r/m;

# WebSocket upgrade map — must be at http context level
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name ${fqdn};

    ssl_certificate /etc/letsencrypt/live/${fqdn}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${fqdn}/privkey.pem;

    # mTLS — same as IP-based access
    include /etc/nginx/snippets/lamalibre-lamaste-mtls.conf;

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

        # Strip Authelia identity headers — not trusted on mTLS vhost
        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";

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

        # Strip Authelia identity headers — not trusted on public endpoint
        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";

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

        # Strip Authelia identity headers — not trusted on public endpoint
        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # User access public endpoints (no mTLS — Bearer token auth handled by panel server)
    location /api/user-access/exchange {
        limit_req zone=enroll_domain burst=5 nodelay;
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;

        proxy_set_header X-SSL-Client-Verify "";
        proxy_set_header X-SSL-Client-DN "";
        proxy_set_header X-SSL-Client-Serial "";

        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/user-access/plugins {
        limit_req zone=enroll_domain burst=5 nodelay;
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;

        proxy_set_header X-SSL-Client-Verify "";
        proxy_set_header X-SSL-Client-DN "";
        proxy_set_header X-SSL-Client-Serial "";

        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/user-access/enroll {
        limit_req zone=enroll_domain burst=5 nodelay;
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;

        proxy_set_header X-SSL-Client-Verify "";
        proxy_set_header X-SSL-Client-DN "";
        proxy_set_header X-SSL-Client-Serial "";

        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";

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

        # Strip Authelia identity headers — not trusted on mTLS vhost
        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";

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

  await writeVhostFile('lamalibre-lamaste-panel-domain', config);
  return path.join(SITES_AVAILABLE, 'lamalibre-lamaste-panel-domain');
}

/**
 * A hostname written into a vhost as a literal. Where it names the vhost to
 * an authorization subrequest it must stay a literal — a `$` would make nginx
 * expand a variable there — so it is checked here, not trusted to the
 * callers' validation.
 */
const LITERAL_HOSTNAME_RE =
  /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function assertLiteralHostname(name) {
  if (typeof name !== 'string' || !LITERAL_HOSTNAME_RE.test(name)) {
    throw new Error(`Invalid hostname for nginx vhost: ${name}`);
  }
}

/**
 * The URL an authorization subrequest asks about: the vhost's own hostname,
 * written into the configuration, and the request's path and query.
 *
 * Never `$http_host`. nginx selects the vhost from the request line when the
 * request is in absolute form (`GET https://a.example.com/x HTTP/1.1`) and
 * from `Host` otherwise, so a client can send the request line of one
 * hostname with the `Host` header of another: built from `$http_host`, the
 * subrequest asked Authelia (and Gatekeeper) about the other hostname while
 * nginx served this one. `$host` is no better — on the default server it is
 * whatever `Host` the client sent. Every vhost here listens on 443 with TLS
 * only, so the scheme is fixed too. `$request_uri` is what follows the host in
 * the request target — it starts with `/`, or with `?` for an absolute-form
 * target without a path — so it cannot change the URL's host.
 *
 * @param {string} fqdn
 */
function originalUrl(fqdn) {
  assertLiteralHostname(fqdn);
  return `https://${fqdn}$request_uri`;
}

/**
 * Cleared in every authorization subrequest. Each names a host, a scheme or a
 * path, and the client's values would otherwise reach Gatekeeper and
 * Authelia; neither decides by them today, and neither may.
 */
const AUTHZ_CLEARED_HEADERS = `
        proxy_set_header X-Forwarded-Host "";
        proxy_set_header X-Forwarded-Proto "";
        proxy_set_header X-Forwarded-Uri "";
        proxy_set_header X-Forwarded-Method "";`;

/**
 * Write the Authelia auth portal vhost.
 */
export async function writeAuthVhost(domain) {
  const { name, config } = renderAuthVhost(domain);
  await writeVhostFile(name, config);
  return path.join(SITES_AVAILABLE, name);
}

/**
 * Render the Authelia auth portal vhost. Pure; the startup reconcile renders
 * it on the certificate directory the installed vhost names.
 *
 * @param {string} domain
 * @param {string} [certPath] - certificate directory (default: the portal's own lineage)
 * @returns {{ name: string, fqdn: string, config: string }}
 */
export function renderAuthVhost(domain, certPath) {
  const fqdn = `auth.${domain}`;
  let certDirClean = certPath || `/etc/letsencrypt/live/${fqdn}`;
  while (certDirClean.endsWith('/')) certDirClean = certDirClean.slice(0, -1);
  const config = `# Rate limit zone for user access authorize endpoint (5 requests/minute per IP)
limit_req_zone $binary_remote_addr zone=user_access_auth:1m rate=5r/m;

server {
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

    # Invitation page — static HTML
    location /invite/ {
        alias /var/www/lamaste/invite/;
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

    # User access authorization — Authelia forward auth protects this endpoint
    # so Remote-User header is set by Authelia on successful authentication.
    location /internal/authelia/authz {
        internal;

        proxy_pass http://127.0.0.1:9091/api/authz/auth-request;
        proxy_pass_request_body off;

        proxy_set_header Content-Length "";
        proxy_set_header Connection "";
        proxy_set_header X-Original-Method $request_method;
        # This vhost's hostname, never the client's Host header
        proxy_set_header X-Original-URL ${originalUrl(fqdn)};
        proxy_set_header X-Forwarded-For $remote_addr;${AUTHZ_CLEARED_HEADERS}

        proxy_http_version 1.1;
        proxy_buffers 4 32k;
        proxy_next_upstream error timeout invalid_header http_500 http_502 http_503;
    }

    location /api/user-access/authorize {
        limit_req zone=user_access_auth burst=3 nodelay;

        # Clear client-supplied identity headers (Authelia re-injects on success)
        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";

        auth_request /internal/authelia/authz;
        auth_request_set $user $upstream_http_remote_user;
        auth_request_set $redirection_url $upstream_http_location;

        proxy_set_header Remote-User $user;

        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;

        error_page 401 =302 $redirection_url;
    }

    # Default — proxy to Authelia
    location / {
        proxy_pass http://127.0.0.1:9091;
    }
}
`;

  return { name: 'lamalibre-lamaste-auth', fqdn, config };
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

  await writeVhostFile('lamalibre-lamaste-tunnel', config);
  return path.join(SITES_AVAILABLE, 'lamalibre-lamaste-tunnel');
}

/**
 * Request headers every tunnel location sends upstream.
 *
 * They are declared inside each `location`, not at server level: nginx
 * inherits `proxy_set_header` from the enclosing level only when a level
 * declares none of its own, and every tunnel location declares some — so
 * server-level headers never reached the app (it saw `Host: 127.0.0.1:<port>`).
 *
 * The client-certificate headers are cleared. The panel trusts
 * `X-SSL-Client-*` from nginx as proof of an mTLS client certificate; a
 * tunnel vhost must never pass client-supplied values through, whatever
 * listens on its port.
 */
const TUNNEL_PROXY_HEADERS = `
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Never forward client-supplied certificate headers (see above)
        proxy_set_header X-SSL-Client-Verify "";
        proxy_set_header X-SSL-Client-DN "";
        proxy_set_header X-SSL-Client-Serial "";

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";`;

/**
 * Render the per-tunnel `client_max_body_size` directive. Without it nginx
 * applies its built-in 1 MiB limit, which rejects ordinary uploads with 413.
 * Validated here as well as in the tunnel workflow because the value is
 * interpolated into nginx configuration.
 *
 * @param {number | undefined} maxBodySizeMb
 * @returns {string} a directive line, or '' when no limit was given
 */
function bodySizeDirective(maxBodySizeMb) {
  if (maxBodySizeMb === undefined) return '';
  if (!Number.isInteger(maxBodySizeMb) || maxBodySizeMb < 1 || maxBodySizeMb > 10240) {
    throw new Error(`Invalid maxBodySizeMb for nginx vhost: ${maxBodySizeMb}`);
  }
  return `\n    client_max_body_size ${maxBodySizeMb}m;\n`;
}

/**
 * Write a public vhost — no authentication, direct proxy.
 * Used for tunnels with accessMode='public'.
 */
export async function writePublicVhost(
  subdomain,
  domain,
  port,
  certPath,
  { pathPrefix, maxBodySizeMb, enabled = true } = {},
) {
  const { name, fqdn, config } = renderPublicVhost(subdomain, domain, port, certPath, {
    pathPrefix,
    maxBodySizeMb,
  });
  return safeWriteVhost(name, config, fqdn, { enabled });
}

function renderPublicVhost(subdomain, domain, port, certPath, { pathPrefix, maxBodySizeMb } = {}) {
  if (pathPrefix && !/^[a-z0-9][a-z0-9._-]*$/.test(pathPrefix)) {
    throw new Error(`Invalid pathPrefix for nginx vhost: ${pathPrefix}`);
  }

  const fqdn = `${subdomain}.${domain}`;
  const certDir = certPath || `/etc/letsencrypt/live/${fqdn}`;
  let certDirClean = certDir;
  while (certDirClean.endsWith('/')) certDirClean = certDirClean.slice(0, -1);

  const config = `server {
    listen 443 ssl;
    server_name ${fqdn};

    ssl_certificate ${certDirClean}/fullchain.pem;
    ssl_certificate_key ${certDirClean}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
${bodySizeDirective(maxBodySizeMb)}
    location / {
        # A public tunnel has no authenticated user: clear identity headers
        # an app might trust from an authenticated vhost.
        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";${
          pathPrefix
            ? `
        # Nor a relay assertion: lamaste-agentd, which serves plugin routes,
        # would otherwise be handed one a client sent.
        proxy_set_header X-Lamalibre-Relay-Assertion "";`
            : ''
        }
${TUNNEL_PROXY_HEADERS}

        ${pathPrefix ? `rewrite ^/?(.*)$ /${pathPrefix}/$1 break;\n        ` : ''}proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;

        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
`;

  return { name: `lamalibre-lamaste-app-${subdomain}`, fqdn, config };
}

/**
 * Write an authenticated vhost — Authelia via Gatekeeper, all authenticated users allowed.
 * Used for tunnels with accessMode='authenticated'.
 * Gatekeeper handles Authelia cookie validation and forwards identity headers.
 */
export async function writeAuthenticatedVhost(
  subdomain,
  domain,
  port,
  certPath,
  { pathPrefix, maxBodySizeMb, enabled = true } = {},
) {
  const { name, fqdn, config } = renderGatekeeperTunnelVhost(subdomain, domain, port, certPath, {
    pathPrefix,
    maxBodySizeMb,
    restricted: false,
  });
  return safeWriteVhost(name, config, fqdn, { enabled });
}

/**
 * Write a restricted vhost — Authelia via Gatekeeper, only granted users/groups allowed.
 * Used for tunnels with accessMode='restricted'.
 * On 403, Gatekeeper returns the inline access-request HTML page.
 */
export async function writeRestrictedVhost(
  subdomain,
  domain,
  port,
  certPath,
  { pathPrefix, maxBodySizeMb, enabled = true } = {},
) {
  const { name, fqdn, config } = renderGatekeeperTunnelVhost(subdomain, domain, port, certPath, {
    pathPrefix,
    maxBodySizeMb,
    restricted: true,
  });
  return safeWriteVhost(name, config, fqdn, { enabled });
}

function renderGatekeeperTunnelVhost(
  subdomain,
  domain,
  port,
  certPath,
  { pathPrefix, maxBodySizeMb, restricted },
) {
  if (pathPrefix && !/^[a-z0-9][a-z0-9._-]*$/.test(pathPrefix)) {
    throw new Error(`Invalid pathPrefix for nginx vhost: ${pathPrefix}`);
  }

  const fqdn = `${subdomain}.${domain}`;
  const certDir = certPath || `/etc/letsencrypt/live/${fqdn}`;
  let certDirClean = certDir;
  while (certDirClean.endsWith('/')) certDirClean = certDirClean.slice(0, -1);

  const config = buildGatekeeperVhost(fqdn, certDirClean, port, domain, {
    pathPrefix,
    maxBodySizeMb,
    restricted,
  });

  return { name: `lamalibre-lamaste-app-${subdomain}`, fqdn, config };
}

/**
 * Render the vhost of an app or plugin tunnel — what the tunnel workflows
 * write for `accessMode`. Pure; used to compare an installed vhost with what
 * the generators produce today (see vhost-reconcile.js).
 *
 * @param {'public'|'authenticated'|'restricted'} accessMode
 * @returns {{ name: string, fqdn: string, config: string }}
 */
export function renderTunnelVhost(accessMode, subdomain, domain, port, certPath, opts = {}) {
  const { pathPrefix, maxBodySizeMb } = opts;
  if (accessMode === 'public') {
    return renderPublicVhost(subdomain, domain, port, certPath, { pathPrefix, maxBodySizeMb });
  }
  return renderGatekeeperTunnelVhost(subdomain, domain, port, certPath, {
    pathPrefix,
    maxBodySizeMb,
    restricted: accessMode !== 'authenticated',
  });
}

/**
 * Build a Gatekeeper-backed nginx vhost config string.
 * Both 'authenticated' and 'restricted' modes use this — the difference
 * is handled server-side by Gatekeeper based on the tunnel's accessMode.
 * For restricted mode, the 403 body from Gatekeeper is served inline.
 *
 * The subrequest names the tunnel in its path, `/authz/tunnel/<fqdn>`,
 * written here as the agent-panel vhost writes its agent's label, and
 * `X-Original-URL` and `Host` carry the same hostname (see
 * {@link originalUrl}). Vhosts before 4.3 called `/authz/check` with both
 * built from the client's `Host`, so an Authelia user allowed on one tunnel
 * reached any other — the request line named the tunnel nginx served, `Host`
 * the one Gatekeeper authorized. Gatekeeper now refuses `/authz/check`: a
 * vhost the panel has not rewritten closes its tunnel instead of opening it.
 * The login redirect names this vhost for the same reason.
 */
function buildGatekeeperVhost(
  fqdn,
  certDirClean,
  port,
  domain,
  { pathPrefix, maxBodySizeMb, restricted } = {},
) {
  const url = originalUrl(fqdn);
  return `server {
    listen 443 ssl;
    server_name ${fqdn};

    ssl_certificate ${certDirClean}/fullchain.pem;
    ssl_certificate_key ${certDirClean}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
${bodySizeDirective(maxBodySizeMb)}
    # Gatekeeper authorization subrequest (handles Authelia validation + grant check).
    # The tunnel is named in the path — never by the client's Host header.
    location /internal/lamaste/authz {
        internal;

        proxy_pass http://127.0.0.1:9294/authz/tunnel/${fqdn};
        proxy_pass_request_body off;

        proxy_set_header Content-Length "";
        proxy_set_header Connection "";
        proxy_set_header X-Original-Method $request_method;
        proxy_set_header X-Original-URL ${url};
        proxy_set_header X-Forwarded-For $remote_addr;${AUTHZ_CLEARED_HEADERS}
        proxy_set_header Host ${fqdn};
        proxy_set_header Cookie $http_cookie;

        proxy_http_version 1.1;
        proxy_buffers 4 32k;
        proxy_next_upstream error timeout invalid_header http_500 http_502 http_503;
    }

    location / {
        auth_request /internal/lamaste/authz;
        auth_request_set $user $upstream_http_remote_user;
        auth_request_set $groups $upstream_http_remote_groups;
        auth_request_set $name $upstream_http_remote_name;
        auth_request_set $email $upstream_http_remote_email;${
          pathPrefix
            ? `
        auth_request_set $relay_assertion $upstream_http_x_lamalibre_relay_assertion;`
            : ''
        }

        proxy_set_header Remote-User $user;
        proxy_set_header Remote-Groups $groups;
        proxy_set_header Remote-Name $name;
        proxy_set_header Remote-Email $email;${
          pathPrefix
            ? `

        # The user, signed by Gatekeeper for this one request — lamaste-agentd,
        # which serves plugin routes, trusts no Remote-* header without it
        proxy_set_header X-Lamalibre-Relay-Assertion $relay_assertion;`
            : ''
        }
${TUNNEL_PROXY_HEADERS}

        ${pathPrefix ? `rewrite ^/?(.*)$ /${pathPrefix}/$1 break;\n        ` : ''}proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;

        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;

        # Authentication failure -> redirect to Authelia login, back to this vhost
        error_page 401 =302 https://auth.${domain}/?rd=${url};

        ${
          restricted
            ? `# Authorization failure -> Gatekeeper serves inline access-request page
        error_page 403 = /internal/lamaste/authz;`
            : ''
        }
    }
}
`;
}

/** True when `name` is linked into sites-enabled. The directory is world-readable. */
export async function isSiteEnabled(name) {
  try {
    await lstat(path.join(SITES_ENABLED, name));
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Shared safe-write logic: backup -> write -> link state -> test -> reload,
 * with rollback.
 *
 * `enabled` decides whether the site is linked into sites-enabled after the
 * write. On any failure the previous file (or its absence) and the previous
 * link state are restored, so rewriting a disabled tunnel's vhost can never
 * publish it — not even through a failed write.
 *
 * @param {string} name
 * @param {string} config
 * @param {string} fqdn
 * @param {{ enabled?: boolean }} [opts]
 */
async function safeWriteVhost(name, config, fqdn, { enabled = true } = {}) {
  const availablePath = path.join(SITES_AVAILABLE, name);

  const existed = await siteExists(name);
  const wasEnabled = await isSiteEnabled(name);
  if (existed) {
    await siteAction('backup', name);
  }

  const restore = async () => {
    if (existed) {
      await siteAction('restore', name).catch(() => {});
    } else {
      await siteAction('remove', name).catch(() => {});
    }
    if (existed && wasEnabled) {
      await enableSite(name).catch(() => {});
    } else {
      await disableSite(name).catch(() => {});
    }
  };

  try {
    await writeVhostFile(name, config);
    if (enabled) {
      await enableSite(name);
    } else {
      await disableSite(name);
    }

    const result = await testConfig();
    if (!result.valid) {
      await restore();
      throw Object.assign(
        new Error(`Nginx config test failed after writing vhost for ${fqdn}: ${result.error}`),
        { restored: true },
      );
    }

    await reload();

    if (existed) {
      await siteAction('discard-backup', name).catch(() => {});
    }

    return availablePath;
  } catch (err) {
    if (!err.restored) await restore();
    throw err;
  }
}

/**
 * Write a static site vhost with optional Authelia forward auth.
 *
 * Written through safeWriteVhost (backup, write, enable, test, reload; on
 * failure the previous file and link state are restored).
 *
 * @param {object} site - The site object from sites.json
 * @param {string} site.id - Site UUID
 * @param {string} site.fqdn - Full domain (e.g., "blog.example.com")
 * @param {boolean} site.spaMode - If true, try_files falls back to /index.html
 * @param {boolean} site.autheliaProtected - If true, add Authelia forward auth
 * @param {string} site.rootPath - Directory root (e.g., /var/www/lamaste/{id}/)
 * @param {string} certDir - Certificate directory path
 * @param {string} [domain] - Base domain (needed for Authelia redirect URL)
 */
export async function writeStaticSiteVhost(site, certDir, domain) {
  const { name, fqdn, config } = renderStaticSiteVhost(site, certDir, domain);
  return safeWriteVhost(name, config, fqdn, { enabled: true });
}

/**
 * Render a static site vhost. Pure; the startup reconcile renders it on the
 * certificate directory the installed vhost names.
 *
 * Authelia decides by the hostname of `X-Original-URL` — a site restricted to
 * some users has rules for its own hostname only — so the subrequest names
 * this site, never the client's `Host` (see {@link originalUrl}).
 *
 * @param {object} site - as for writeStaticSiteVhost
 * @param {string} certDir
 * @param {string} [domain]
 * @returns {{ name: string, fqdn: string, config: string }}
 */
export function renderStaticSiteVhost(site, certDir, domain) {
  let certDirClean = certDir;
  while (certDirClean.endsWith('/')) certDirClean = certDirClean.slice(0, -1);
  const aliasBlock = buildAliasRedirectBlock(site, certDirClean);
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
        # This site's hostname, never the client's Host header
        proxy_set_header X-Original-URL ${originalUrl(site.fqdn)};
        proxy_set_header X-Forwarded-For $remote_addr;${AUTHZ_CLEARED_HEADERS}

        proxy_http_version 1.1;
        proxy_buffers 4 32k;
        proxy_next_upstream error timeout invalid_header http_500 http_502 http_503;
    }
`;
    locationAuthDirectives = `
        # Clear client-supplied identity headers (Authelia re-injects on success)
        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";

        auth_request /internal/authelia/authz;
        auth_request_set $user $upstream_http_remote_user;
        auth_request_set $groups $upstream_http_remote_groups;
        # $name and $email captured for future proxy use (no proxy_pass in static sites)
        auth_request_set $name $upstream_http_remote_name;
        auth_request_set $email $upstream_http_remote_email;
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
${aliasBlock}`;

  return { name: `lamalibre-lamaste-site-${site.id}`, fqdn: site.fqdn, config };
}

/**
 * Server block answering a site's aliases with a permanent redirect to the
 * primary hostname, on the same certificate (its lineage covers every alias).
 * Hostnames are interpolated into nginx configuration, so they are validated
 * here as well as in the site workflow.
 *
 * @param {{ fqdn: string, aliases?: string[] }} site
 * @param {string} certDirClean
 * @returns {string} the server block, or '' when the site has no aliases
 */
function buildAliasRedirectBlock(site, certDirClean) {
  const aliases = site.aliases ?? [];
  if (aliases.length === 0) return '';
  const hostname = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
  for (const name of [site.fqdn, ...aliases]) {
    if (!hostname.test(name)) {
      throw new Error(`Invalid hostname for nginx vhost: ${name}`);
    }
  }
  return `
server {
    listen 443 ssl;
    server_name ${aliases.join(' ')};

    ssl_certificate ${certDirClean}/fullchain.pem;
    ssl_certificate_key ${certDirClean}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    return 301 https://${site.fqdn}$request_uri;
}
`;
}

/**
 * Remove a static site vhost from sites-available and sites-enabled, then test and reload nginx.
 * Idempotent: if files don't exist, proceeds silently.
 *
 * @param {string} siteId - The site UUID
 */
export async function removeStaticSiteVhost(siteId) {
  const name = `lamalibre-lamaste-site-${siteId}`;
  await siteAction('remove', name);

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
  const name = `lamalibre-lamaste-app-${subdomain}`;
  await siteAction('remove', name);

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
    await execa('sudo', ['nginx', '-t'], { timeout: NGINX_COMMAND_TIMEOUT_MS });
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
    await execa('sudo', ['systemctl', 'reload', 'nginx'], { timeout: NGINX_COMMAND_TIMEOUT_MS });
    return { reloaded: true };
  } catch (err) {
    throw new Error(`Failed to reload nginx: ${err.stderr || err.message}`);
  }
}

/**
 * Enable a site by creating a symlink in sites-enabled.
 */
export async function enableSite(name) {
  await siteAction('enable', name);
}

/**
 * Disable a site by removing its symlink from sites-enabled.
 */
export async function disableSite(name) {
  await siteAction('disable', name);
}

/**
 * Enable an app tunnel vhost (restore symlink), test and reload nginx.
 *
 * @param {string} subdomain - The subdomain name
 */
export async function enableAppVhost(subdomain) {
  const name = `lamalibre-lamaste-app-${subdomain}`;
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
  const name = `lamalibre-lamaste-app-${subdomain}`;
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
 * Disable the IP-based panel vhost (used when 2FA is enabled).
 * Tests nginx config before reloading; rolls back on failure.
 */
export async function disableIpVhost() {
  await disableSite('lamalibre-lamaste-panel-ip');
  const result = await testConfig();
  if (!result.valid) {
    await enableSite('lamalibre-lamaste-panel-ip');
    throw new Error(`nginx test failed after disabling IP vhost: ${result.error}`);
  }
  await reload();
}

/**
 * Re-enable the IP-based panel vhost (used when 2FA is disabled).
 * Tests nginx config before reloading; rolls back on failure.
 */
export async function enableIpVhost() {
  await enableSite('lamalibre-lamaste-panel-ip');
  const result = await testConfig();
  if (!result.valid) {
    await disableSite('lamalibre-lamaste-panel-ip');
    throw new Error(`nginx test failed after enabling IP vhost: ${result.error}`);
  }
  await reload();
}

/**
 * Write an agent panel vhost with mTLS authentication (not Authelia).
 *
 * Written through safeWriteVhost (backup, test, rollback).
 *
 * @param {string} subdomain - The subdomain name (e.g., "agent-my-agent")
 * @param {string} domain - The base domain (e.g., "example.com")
 * @param {number} port - The local port to proxy to
 * @param {string} [certPath] - Optional cert directory path override (e.g. for wildcard certs)
 */
export async function writeAgentPanelVhost(
  subdomain,
  domain,
  port,
  certPath,
  { enabled = true } = {},
) {
  const { name, fqdn, config } = renderAgentPanelVhost(subdomain, domain, port, certPath);
  return safeWriteVhost(name, config, fqdn, { enabled });
}

/**
 * Render an agent panel vhost. Pure.
 *
 * nginx verifies the browser's client certificate, then asks the panel
 * whether the request may reach the agent (`auth_request` to
 * `/api/agent-panel/authz/<label>`, with the certificate's verification
 * result, the method and `$request_uri`). The panel refuses a revoked or
 * foreign certificate and otherwise signs a relay assertion for exactly this
 * request, which goes to the agent's lamaste-agentd in
 * `X-Lamalibre-Relay-Assertion`. The daemon accepts nothing else from the
 * relay: its port, and the tunnel's port on the relay's loopback, can be
 * reached without going through nginx, so a header proves nothing to it.
 *
 * `X-SSL-Client-*` still go upstream for agents older than 4.3, which read
 * them; lamaste-agentd from 4.3 removes them unread.
 *
 * @param {string} subdomain - `agent-<label>`
 * @param {string} domain
 * @param {number} port
 * @param {string} [certPath]
 * @returns {{ name: string, fqdn: string, config: string }}
 */
export function renderAgentPanelVhost(subdomain, domain, port, certPath) {
  if (!/^agent-[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
    throw new Error(`Invalid agent panel subdomain for nginx vhost: ${subdomain}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port for nginx vhost: ${port}`);
  }
  const label = subdomain.slice('agent-'.length);
  const fqdn = `${subdomain}.${domain}`;
  const certDir = certPath || `/etc/letsencrypt/live/${fqdn}`;
  let certDirClean = certDir;
  while (certDirClean.endsWith('/')) certDirClean = certDirClean.slice(0, -1);

  const config = `server {
    listen 443 ssl;
    server_name ${fqdn};

    ssl_certificate ${certDirClean}/fullchain.pem;
    ssl_certificate_key ${certDirClean}/privkey.pem;

    # mTLS — same CA as the admin panel
    include /etc/nginx/snippets/lamalibre-lamaste-mtls.conf;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Authorization by the panel: refuses revoked and foreign certificates,
    # otherwise answers with the relay assertion for this one request
    location = /internal/lamaste/agent-panel-authz {
        internal;

        proxy_pass http://127.0.0.1:3100/api/agent-panel/authz/${label};
        proxy_pass_request_body off;
        proxy_http_version 1.1;

        proxy_set_header Content-Length "";
        proxy_set_header Connection "";
        proxy_set_header X-SSL-Client-Verify $ssl_client_verify;
        proxy_set_header X-SSL-Client-DN $ssl_client_s_dn;
        proxy_set_header X-SSL-Client-Serial $ssl_client_serial;
        proxy_set_header X-Original-Method $request_method;
        proxy_set_header X-Original-URI $request_uri;
        proxy_set_header X-Forwarded-For $remote_addr;

        # Nothing else of the browser's request is the panel's business
        proxy_set_header Cookie "";
        proxy_set_header Authorization "";
        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";
    }

    # Reject requests without valid client certificate
    location / {
        if ($ssl_client_verify != SUCCESS) {
            return 496;
        }

        auth_request /internal/lamaste/agent-panel-authz;
        auth_request_set $relay_assertion $upstream_http_x_lamalibre_relay_assertion;

        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;

        # The caller, signed by the panel for this one request
        proxy_set_header X-Lamalibre-Relay-Assertion $relay_assertion;

        # Client cert headers — set from nginx TLS variables, never passed through
        # from client; read only by agents older than 4.3
        proxy_set_header X-SSL-Client-Verify $ssl_client_verify;
        proxy_set_header X-SSL-Client-DN $ssl_client_s_dn;
        proxy_set_header X-SSL-Client-Serial $ssl_client_serial;

        # Strip Authelia identity headers — not trusted on agent panel (mTLS only)
        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
`;

  return { name: `lamalibre-lamaste-agent-panel-${subdomain}`, fqdn, config };
}

/**
 * The installed sites-available/<name>, or null when there is none. The
 * directory is world-readable.
 *
 * @param {string} name
 * @returns {Promise<string | null>}
 */
export async function readInstalledVhost(name) {
  try {
    return await readFile(path.join(SITES_AVAILABLE, name), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * The certificate directory a vhost's `ssl_certificate` names, without the
 * trailing slash — so a vhost can be rendered again on the certificate it was
 * written for (a tunnel may be on a wildcard certificate). Null when the
 * vhost names none.
 *
 * @param {string} config
 * @returns {string | null}
 */
export function vhostCertDir(config) {
  const match = /^\s*ssl_certificate\s+(\S+)\/fullchain\.pem;/m.exec(config);
  return match ? match[1] : null;
}

// Install a rendered vhost (vhost-reconcile.js) through the same backup /
// write / link state / test / reload / rollback path as every vhost write.
export { safeWriteVhost as installVhost };

/**
 * Remove an agent panel vhost from sites-available and sites-enabled, then test and reload nginx.
 * Idempotent: if files don't exist, proceeds silently.
 *
 * @param {string} subdomain - The subdomain name (e.g., "agent-my-agent")
 */
export async function removeAgentPanelVhost(subdomain) {
  const name = `lamalibre-lamaste-agent-panel-${subdomain}`;
  await siteAction('remove', name);

  const result = await testConfig();
  if (!result.valid) {
    throw new Error(`Nginx config test failed after removing vhost ${name}: ${result.error}`);
  }

  await reload();
}

/**
 * Enable an agent panel vhost (restore symlink), test and reload nginx.
 *
 * @param {string} subdomain - The subdomain name
 */
export async function enableAgentPanelVhost(subdomain) {
  const name = `lamalibre-lamaste-agent-panel-${subdomain}`;
  await enableSite(name);

  const result = await testConfig();
  if (!result.valid) {
    await disableSite(name);
    throw new Error(`Nginx config test failed after enabling vhost ${name}: ${result.error}`);
  }

  await reload();
}

/**
 * Disable an agent panel vhost (remove symlink only, keep config), test and reload nginx.
 *
 * @param {string} subdomain - The subdomain name
 */
export async function disableAgentPanelVhost(subdomain) {
  const name = `lamalibre-lamaste-agent-panel-${subdomain}`;
  await disableSite(name);

  const result = await testConfig();
  if (!result.valid) {
    await enableSite(name);
    throw new Error(`Nginx config test failed after disabling vhost ${name}: ${result.error}`);
  }

  await reload();
}
