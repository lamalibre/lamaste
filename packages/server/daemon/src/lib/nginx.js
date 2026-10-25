import { execa } from 'execa';
import { access, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BACKEND_COOKIE_VARIABLE,
  RELAY_PANEL_PORT,
  USER_SURFACE_MAX_RESPONSE_SECONDS,
  isUserSurfaceRoute,
  userSurfaceApiPath,
  WEB_TREE_CONTENT_TYPES,
} from '@lamalibre/lamaste';

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

/** Site name of the panel's domain vhost (`panel.<domain>`). */
export const PANEL_DOMAIN_VHOST = 'lamalibre-lamaste-panel-domain';

/**
 * Cleared in every location that proxies a browser's request to the panel
 * itself: a relay assertion reaches the panel only from a user-surface
 * location of a tunnel vhost, which sets it from Gatekeeper's answer — never
 * one a client sent.
 */
const PANEL_ASSERTION_CLEARED = `
        # A relay assertion comes only from Gatekeeper, on a plugin's user surface
        proxy_set_header X-Lamalibre-Relay-Assertion "";`;

/**
 * Write the panel domain vhost with mTLS and Let's Encrypt certs.
 */
export async function writePanelVhost(domain) {
  const { name, config } = renderPanelVhost(domain);
  await writeVhostFile(name, config);
  return path.join(SITES_AVAILABLE, name);
}

/**
 * Render the panel domain vhost. Pure; the startup reconcile renders it on
 * the certificate directory the installed vhost names.
 *
 * @param {string} domain
 * @param {string} [certPath] - certificate directory (default: the panel's own lineage)
 * @returns {{ name: string, fqdn: string, config: string }}
 */
export function renderPanelVhost(domain, certPath) {
  const fqdn = `panel.${domain}`;
  assertLiteralHostname(fqdn);
  let certDirClean = certPath || `/etc/letsencrypt/live/${fqdn}`;
  while (certDirClean.endsWith('/')) certDirClean = certDirClean.slice(0, -1);
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

    ssl_certificate ${certDirClean}/fullchain.pem;
    ssl_certificate_key ${certDirClean}/privkey.pem;

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
        proxy_set_header Remote-Email "";${PANEL_ASSERTION_CLEARED}

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
        proxy_set_header Remote-Email "";${PANEL_ASSERTION_CLEARED}

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
        proxy_set_header Remote-Email "";${PANEL_ASSERTION_CLEARED}

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
        proxy_set_header Remote-Email "";${PANEL_ASSERTION_CLEARED}

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
        proxy_set_header Remote-Email "";${PANEL_ASSERTION_CLEARED}

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
        proxy_set_header Remote-Email "";${PANEL_ASSERTION_CLEARED}

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
        proxy_set_header Remote-Email "";${PANEL_ASSERTION_CLEARED}

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

  return { name: PANEL_DOMAIN_VHOST, fqdn, config };
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
        proxy_set_header X-Forwarded-Proto $scheme;${PANEL_ASSERTION_CLEARED}
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
        proxy_set_header X-Forwarded-Proto $scheme;${PANEL_ASSERTION_CLEARED}

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
 * The `Cookie` a tunnel or agent backend receives: the browser's cookies
 * without Authelia's session cookie. Authelia scopes that cookie to the base
 * domain, so the browser sends it to every tunnel host; a backend that got
 * it — any application on any agent, or whatever holds a tunnel port on the
 * relay — could replay it as the visitor on every authenticated host and
 * every plugin's user surface. `$lamaste_backend_cookie` is defined by the
 * http-level map create-lamaste installs (core `renderBackendCookieMap`,
 * `/etc/nginx/conf.d/lamalibre-lamaste-backend-cookie.conf`): every
 * `authelia_session` pair removed, or no `Cookie` at all when one could not
 * be. A vhost written before the map exists fails `nginx -t` and is rolled
 * back — never served with the cookie.
 */
const BACKEND_COOKIE_HEADER = `
        # Never Authelia's session cookie: the browser's other cookies only
        proxy_set_header Cookie ${BACKEND_COOKIE_VARIABLE};`;

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
 * listens on its port. Authelia's session cookie never reaches the backend
 * ({@link BACKEND_COOKIE_HEADER}).
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
${BACKEND_COOKIE_HEADER}

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
  assertBodySizeMb(maxBodySizeMb);
  return `\n    client_max_body_size ${maxBodySizeMb}m;\n`;
}

/** A body limit in MiB, as the tunnel workflow allows it — interpolated into nginx configuration. */
function assertBodySizeMb(maxBodySizeMb) {
  if (!Number.isInteger(maxBodySizeMb) || maxBodySizeMb < 1 || maxBodySizeMb > 10240) {
    throw new Error(`Invalid maxBodySizeMb for nginx vhost: ${maxBodySizeMb}`);
  }
}

/**
 * Request headers a user-surface location sends the panel. The panel's
 * user-surface context trusts nothing but the relay assertion — but the
 * panel serves other contexts on the same listener, so everything a browser
 * could send that any of them trusts is cleared: no user request can pass
 * for a client-certificate holder (`X-SSL-Client-*`), an Authelia user
 * (`Remote-*`), a desktop session (`Authorization`) or an administrator's
 * 2FA session (`Cookie`), nor name another host to the panel
 * (`X-Forwarded-Host`). `X-Forwarded-For` is the client's address alone:
 * the panel trusts one loopback hop (`trust-proxy.js`), so that is its
 * `request.ip` — what the user surface's rate limit keys on. `Connection`
 * cleared: the panel keeps the upstream connection alive (HTTP/1.1), and
 * the user surface carries no WebSocket.
 */
const USER_SURFACE_PROXY_HEADERS = `
        # Nothing else that any part of the panel trusts
        proxy_set_header Cookie "";
        proxy_set_header Authorization "";
        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";
        proxy_set_header X-SSL-Client-Verify "";
        proxy_set_header X-SSL-Client-DN "";
        proxy_set_header X-SSL-Client-Serial "";
        proxy_set_header X-Forwarded-Host "";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";`;

/**
 * The body of a tunnel vhost's Gatekeeper subrequest location,
 * `/authz/<check>/<fqdn>`: the tunnel is named in the path, in
 * `X-Original-URL` and in `Host` — never by the client's `Host` header (see
 * {@link originalUrl}) — and the session cookie is passed on.
 *
 * @param {'tunnel'|'user-surface'|'user-surface-shell'} check
 * @param {string} fqdn
 * @returns {string}
 */
function gatekeeperSubrequest(check, fqdn) {
  return `internal;
        # A subrequest is never authorized itself (a host may authorize at server level)
        auth_request off;

        proxy_pass http://127.0.0.1:9294/authz/${check}/${fqdn};
        proxy_pass_request_body off;

        proxy_set_header Content-Length "";
        proxy_set_header Connection "";
        proxy_set_header X-Original-Method $request_method;
        proxy_set_header X-Original-URL ${originalUrl(fqdn)};
        proxy_set_header X-Forwarded-For $remote_addr;${AUTHZ_CLEARED_HEADERS}
        proxy_set_header Host ${fqdn};
        proxy_set_header Cookie $http_cookie;

        proxy_http_version 1.1;`;
}

/**
 * The user-surface locations of a tunnel vhost — `/api/<route>/app` and
 * everything under it for each plugin it serves (`opts.userSurface`), and
 * the two internal locations they share:
 *
 * - `/internal/lamaste/user-surface-authz` asks Gatekeeper
 *   (`/authz/user-surface/<fqdn>`, the tunnel named in the path and in
 *   `X-Original-URL` and `Host`, as for the tunnel's own subrequest).
 *   Gatekeeper authenticates the Authelia session — and, on a restricted
 *   tunnel, checks its grant — then vouches for the user to the panel with
 *   a relay assertion bound to the method and the raw request target. Never
 *   cached: an assertion is single use.
 * - `/internal/lamaste/user-surface-401` answers a request without a
 *   session with Gatekeeper's JSON 401 — an application's request is never
 *   redirected to the login page.
 *
 * Each route's locations pass the assertion, and nothing else of the
 * browser's credentials ({@link USER_SURFACE_PROXY_HEADERS}), to the panel
 * with `proxy_pass` naming no URI: the panel receives the request target
 * exactly as the browser sent it — the target the assertion is bound to.
 * The body limit is the plugin's (its internal tunnel's); the timeouts are
 * the longest a user-surface response lives (`USER_SURFACE_MAX_RESPONSE_SECONDS`,
 * one hour — the panel ends one still open then, and ends it at once when
 * its user loses access), long enough for server-sent events, which the
 * panel streams unbuffered.
 *
 * @param {string} fqdn
 * @param {ReadonlyArray<{ route: string, maxBodySizeMb: number }>} userSurface
 * @returns {string}
 */
function userSurfaceLocations(fqdn, userSurface) {
  if (userSurface.length === 0) return '';
  const routes = userSurface.map(({ route, maxBodySizeMb }) => {
    if (!isUserSurfaceRoute(route)) {
      throw new Error(`Invalid user-surface route for nginx vhost: ${route}`);
    }
    assertBodySizeMb(maxBodySizeMb);
    const block = `{
        auth_request /internal/lamaste/user-surface-authz;
        auth_request_set $relay_assertion $upstream_http_x_lamalibre_relay_assertion;

        # The user, vouched for by Gatekeeper to the panel for this one request
        proxy_set_header X-Lamalibre-Relay-Assertion $relay_assertion;
${USER_SURFACE_PROXY_HEADERS}

        # No URI: the request target reaches the panel as the browser sent it
        proxy_pass http://127.0.0.1:${RELAY_PANEL_PORT};
        proxy_http_version 1.1;

        client_max_body_size ${maxBodySizeMb}m;
        # No response lives longer (the panel ends one then)
        proxy_read_timeout ${USER_SURFACE_MAX_RESPONSE_SECONDS}s;
        proxy_send_timeout ${USER_SURFACE_MAX_RESPONSE_SECONDS}s;

        # No session: a JSON 401, never a redirect
        error_page 401 = /internal/lamaste/user-surface-401;
    }`;
    const apiPath = userSurfaceApiPath(route);
    return `
    # The user surface of plugin "${route}"
    location = ${apiPath} ${block}

    location ^~ ${apiPath}/ ${block}
`;
  });
  return `
    # The user surface of agent-hosted plugins on this host: Gatekeeper
    # vouches for the session's user to the panel, for one request each.
    location = /internal/lamaste/user-surface-authz {
        ${gatekeeperSubrequest('user-surface', fqdn)}
    }

    location = /internal/lamaste/user-surface-401 {
        internal;
        auth_request off;

        proxy_pass http://127.0.0.1:9294/authz/user-surface-unauthenticated;
        proxy_pass_request_body off;

        proxy_set_header Content-Length "";
        proxy_set_header Cookie "";
        proxy_set_header Authorization "";
        # Gatekeeper's rate limit counts the client nginx saw, never one a client named
        proxy_set_header X-Forwarded-For $remote_addr;

        proxy_http_version 1.1;
    }
${routes.join('')}`;
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
  { pathPrefix, maxBodySizeMb, userSurface, enabled = true } = {},
) {
  const { name, fqdn, config } = renderPublicVhost(subdomain, domain, port, certPath, {
    pathPrefix,
    maxBodySizeMb,
    userSurface,
  });
  return safeWriteVhost(name, config, fqdn, { enabled });
}

function renderPublicVhost(
  subdomain,
  domain,
  port,
  certPath,
  { pathPrefix, maxBodySizeMb, userSurface } = {},
) {
  if (pathPrefix && !/^[a-z0-9][a-z0-9._-]*$/.test(pathPrefix)) {
    throw new Error(`Invalid pathPrefix for nginx vhost: ${pathPrefix}`);
  }
  // A public host has no signed-in user for Gatekeeper to vouch for.
  if (userSurface && userSurface.length > 0) {
    throw new Error("A public tunnel vhost cannot serve a plugin's user surface");
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
        proxy_set_header Remote-Email "";

        # Nor a relay assertion: only Gatekeeper's, set on an authenticated
        # vhost, may reach a backend (lamaste-agentd serves plugin routes)
        proxy_set_header X-Lamalibre-Relay-Assertion "";
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
  { pathPrefix, maxBodySizeMb, userSurface, enabled = true } = {},
) {
  const { name, fqdn, config } = renderGatekeeperTunnelVhost(subdomain, domain, port, certPath, {
    pathPrefix,
    maxBodySizeMb,
    userSurface,
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
  { pathPrefix, maxBodySizeMb, userSurface, enabled = true } = {},
) {
  const { name, fqdn, config } = renderGatekeeperTunnelVhost(subdomain, domain, port, certPath, {
    pathPrefix,
    maxBodySizeMb,
    userSurface,
    restricted: true,
  });
  return safeWriteVhost(name, config, fqdn, { enabled });
}

function renderGatekeeperTunnelVhost(
  subdomain,
  domain,
  port,
  certPath,
  { pathPrefix, maxBodySizeMb, userSurface, restricted },
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
    userSurface,
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
 * @param {string} subdomain
 * @param {string} domain
 * @param {number} port
 * @param {string} [certPath]
 * @param {{ pathPrefix?: string, maxBodySizeMb?: number, userSurface?: ReadonlyArray<{ route: string, maxBodySizeMb: number }> }} [opts]
 *   `userSurface`: the plugins' user surfaces the vhost serves (not on a public vhost)
 * @returns {{ name: string, fqdn: string, config: string }}
 */
export function renderTunnelVhost(accessMode, subdomain, domain, port, certPath, opts = {}) {
  const { pathPrefix, maxBodySizeMb, userSurface } = opts;
  if (accessMode === 'public') {
    return renderPublicVhost(subdomain, domain, port, certPath, {
      pathPrefix,
      maxBodySizeMb,
      userSurface,
    });
  }
  return renderGatekeeperTunnelVhost(subdomain, domain, port, certPath, {
    pathPrefix,
    maxBodySizeMb,
    userSurface,
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
 *
 * The backend gets Gatekeeper's relay assertion on a plugin tunnel, and no
 * relay assertion at all on any other — a client's is cleared. An app
 * tunnel bound as plugins' user surface also carries their locations
 * ({@link userSurfaceLocations}).
 */
function buildGatekeeperVhost(
  fqdn,
  certDirClean,
  port,
  domain,
  { pathPrefix, maxBodySizeMb, userSurface = [], restricted } = {},
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
        ${gatekeeperSubrequest('tunnel', fqdn)}
        proxy_buffers 4 32k;
        proxy_next_upstream error timeout invalid_header http_500 http_502 http_503;
    }
${userSurfaceLocations(fqdn, userSurface)}
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
            : `

        # No relay assertion reaches an app: Gatekeeper signs one only for a
        # plugin tunnel or the panel, never one a client sent
        proxy_set_header X-Lamalibre-Relay-Assertion "";`
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
 * The Content-Security-Policy of a plugin's web surface: its shell loads
 * scripts, styles, fonts and images from its own host only and talks to its
 * own host only (its user surface's API is there). Inline styles are
 * allowed — frameworks set `style` attributes and insert component styles
 * at run time — inline scripts never; no framing, no plugins, no foreign
 * form targets.
 */
const WEB_SURFACE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

/**
 * Response headers of the shell of a plugin's web surface, set in its
 * locations — not at server level, where the API's answers (headed by the
 * panel) would get a second copy. `no-cache`: a browser revalidates each file —
 * a 304 while the tree is the same, the new file once an update switched
 * it — so no page mixes two versions of the shell from its cache.
 */
const WEB_SURFACE_HEADERS = `
        add_header Content-Security-Policy "${WEB_SURFACE_CSP}" always;
        add_header X-Content-Type-Options nosniff always;
        add_header X-Frame-Options DENY always;
        add_header Referrer-Policy same-origin always;
        add_header Cross-Origin-Opener-Policy same-origin always;
        add_header Cross-Origin-Resource-Policy same-origin always;
        add_header Cache-Control no-cache always;`;

/**
 * The content types of a web tree's files, by extension
 * (`WEB_TREE_CONTENT_TYPES` — the only extensions a tree may hold).
 */
const WEB_SURFACE_TYPES = (() => {
  const byType = new Map();
  for (const [ext, type] of Object.entries(WEB_TREE_CONTENT_TYPES)) {
    byType.set(type, [...(byType.get(type) ?? []), ext.slice(1)]);
  }
  const entries = [...byType].map(([type, exts]) => `            ${type} ${exts.join(' ')};`);
  return `
        types {
${entries.join('\n')}
        }`;
})();

/**
 * The files a page still running the previous shell may ask for after an
 * update — its scripts, styles, fonts and images — and nothing else: a
 * document, an SVG or a manifest is never served from the previous tree.
 */
const WEB_SURFACE_SUBRESOURCE_RE = '[.](?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|ico)$';

/**
 * Service workers: never registered from a plugin's site. A worker outlives
 * the tree that installed it — a revert, the site's deletion, the
 * hostname's next owner — and answers in its place; asked for its script
 * (`Service-Worker: script`), the site answers 404, which also
 * unregisters a worker already installed at its next update check.
 */
const NO_SERVICE_WORKER = `
        if ($http_service_worker) {
            return 404;
        }`;

/**
 * Render the vhost of a plugin's web surface — a site the plugin owns
 * (`site.owner`). Pure; the startup reconcile renders it again to compare.
 *
 * While the plugin's surface is served (`opts.served`: its installed
 * version approved, declaring identity and a web surface, hosted), the
 * host serves two things under one Authelia session:
 *
 * - **the shell**: every path but the API, from the plugin's current tree
 *   (`<treesDir>/current`), GET and HEAD only, each file under its own
 *   content type (`WEB_SURFACE_TYPES`), never a service worker's script. Every request asks
 *   Gatekeeper first (`/authz/user-surface-shell/<fqdn>`: a session in the
 *   plugin's audience, and the site's grant when it is restricted) — a page
 *   without a session goes to the login, a user without access gets the
 *   access-request page. A script, style, font or image the current tree
 *   lacks is looked for in the previous tree (a page still running the old
 *   shell loads its lazy files after an update), else 404; any other
 *   unknown path gets the current shell's `index.html`.
 * - **the API**: `/api/<route>/app/*`, exactly as on a bound tunnel
 *   ({@link userSurfaceLocations}).
 *
 * While it is not served the host answers every request with 503 — and,
 * once its plugin is no longer installed (`opts.clearSiteData`), tells
 * browsers to clear the site's storage.
 *
 * @param {{ id: string, fqdn: string }} site
 * @param {string} certDir
 * @param {string} domain
 * @param {{ route: string, served: boolean, maxBodySizeMb: number, treesDir: string, clearSiteData?: boolean }} opts
 * @returns {{ name: string, fqdn: string, config: string }}
 */
export function renderWebSurfaceVhost(site, certDir, domain, opts) {
  const { route, served, maxBodySizeMb, treesDir, clearSiteData = false } = opts;
  assertLiteralHostname(site.fqdn);
  if (!isUserSurfaceRoute(route)) throw new Error(`Invalid web surface route: ${route}`);
  if (!path.isAbsolute(treesDir) || !/^[A-Za-z0-9/._-]+$/.test(treesDir)) {
    throw new Error(`Invalid web tree directory for nginx vhost: ${treesDir}`);
  }
  let certDirClean = certDir;
  while (certDirClean.endsWith('/')) certDirClean = certDirClean.slice(0, -1);

  const head = `server {
    listen 443 ssl;
    server_name ${site.fqdn};

    ssl_certificate ${certDirClean}/fullchain.pem;
    ssl_certificate_key ${certDirClean}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
`;

  if (!served) {
    // A plugin no longer installed: whatever comes next on this hostname is
    // not its shell, so browsers drop what it left — its storage, caches
    // and service workers. Never while the plugin is only unhosted or
    // awaiting approval: its users' data stays.
    const clear = clearSiteData
      ? `
        add_header Clear-Site-Data '"storage"' always;`
      : '';
    return {
      name: `lamalibre-lamaste-site-${site.id}`,
      fqdn: site.fqdn,
      config: `${head}
    # The web surface of plugin "${route}" is not served now (not installed,
    # not approved, not hosted, or its version declares no web surface)
    location / {${NO_SERVICE_WORKER}
        add_header Cache-Control no-store always;${clear}
        return 503;
    }
}
`,
    };
  }

  const url = originalUrl(site.fqdn);
  const config = `${head}
    root ${treesDir}/current;
    index index.html;

    # Every path of the shell: Gatekeeper first (the API's locations ask on their own)
    auth_request /internal/lamaste/shell-authz;
    error_page 401 =302 https://auth.${domain}/?rd=${url};
    error_page 403 = /internal/lamaste/shell-authz;

    location = /internal/lamaste/shell-authz {
        ${gatekeeperSubrequest('user-surface-shell', site.fqdn)}
    }
${userSurfaceLocations(site.fqdn, [{ route, maxBodySizeMb }])}
    # A script, style, font or image the current tree lacks: the previous
    # tree's (a page still running the old shell), else 404
    location ~* ${WEB_SURFACE_SUBRESOURCE_RE} {
        if ($request_method !~ ^(GET|HEAD)$) {
            return 405;
        }${NO_SERVICE_WORKER}
${WEB_SURFACE_HEADERS}${WEB_SURFACE_TYPES}
        try_files $uri @previous;
    }

    # Everything else: the current tree's file, else the shell
    location / {
        if ($request_method !~ ^(GET|HEAD)$) {
            return 405;
        }${NO_SERVICE_WORKER}
${WEB_SURFACE_HEADERS}${WEB_SURFACE_TYPES}
        try_files $uri /index.html;
    }

    location @previous {
${WEB_SURFACE_HEADERS}${WEB_SURFACE_TYPES}
        root ${treesDir}/previous;
        try_files $uri =404;
    }
}
`;
  return { name: `lamalibre-lamaste-site-${site.id}`, fqdn: site.fqdn, config };
}

/**
 * Write the vhost of a plugin's web surface (see {@link renderWebSurfaceVhost}).
 *
 * @param {{ id: string, fqdn: string }} site
 * @param {string} certDir
 * @param {string} domain
 * @param {{ route: string, served: boolean, maxBodySizeMb: number, treesDir: string }} opts
 */
export async function writeWebSurfaceVhost(site, certDir, domain, opts) {
  const { name, fqdn, config } = renderWebSurfaceVhost(site, certDir, domain, opts);
  return safeWriteVhost(name, config, fqdn, { enabled: true });
}

/**
 * Hand a hostname from one vhost to another in one nginx reload: vhost
 * `fromName` is unlinked, `name` written with `config` and linked, the
 * configuration tested and nginx reloaded once; `fromName` stays installed,
 * unlinked. Until the reload nginx serves the old vhost, after it the new
 * one; there is no moment in between. On any failure before the reload
 * both are put back as they were.
 *
 * @param {string} fromName the vhost giving the hostname up (linked)
 * @param {string} name a vhost that does not exist yet
 * @param {string} config
 * @param {string} fqdn
 */
async function handOverVhost(fromName, name, config, fqdn) {
  if (await siteExists(name)) throw new Error(`Vhost ${name} exists already`);
  const fromEnabled = await isSiteEnabled(fromName);
  const restore = async () => {
    await siteAction('remove', name).catch(() => {});
    if (fromEnabled) await enableSite(fromName).catch(() => {});
  };
  try {
    await disableSite(fromName);
    await writeVhostFile(name, config);
    await enableSite(name);
    const result = await testConfig();
    if (!result.valid) {
      throw new Error(`Nginx config test failed handing ${fqdn} to ${name}: ${result.error}`);
    }
    await reload();
  } catch (err) {
    await restore();
    throw err;
  }
  // `fromName` stays installed, only unlinked: the tunnel it served can be
  // enabled again by hand once the new vhost is gone.
}

/**
 * Unlink tunnel vhost `subdomain` when it is still enabled although a
 * plugin's site holds its hostname — a move the panel did not finish (it
 * wrote the state, then stopped before the handover). Does not reload:
 * the caller's next vhost install does, or it reloads itself. Returns
 * whether it unlinked.
 *
 * @param {string} subdomain the moved tunnel's
 */
export async function unlinkMovedAppVhost(subdomain) {
  const name = `lamalibre-lamaste-app-${subdomain}`;
  if (!(await isSiteEnabled(name))) return false;
  await disableSite(name);
  return true;
}

/**
 * Serve a plugin's web surface on the hostname of tunnel vhost `subdomain`
 * in one reload (see {@link handOverVhost}).
 *
 * @param {string} subdomain the tunnel's
 * @param {{ id: string, fqdn: string }} site
 * @param {string} certDir
 * @param {string} domain
 * @param {{ route: string, served: boolean, maxBodySizeMb: number, treesDir: string }} opts
 */
export async function moveAppVhostToWebSurface(subdomain, site, certDir, domain, opts) {
  const { name, fqdn, config } = renderWebSurfaceVhost(site, certDir, domain, opts);
  await handOverVhost(`lamalibre-lamaste-app-${subdomain}`, name, config, fqdn);
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
 * them; lamaste-agentd from 4.3 removes them unread. Authelia's session
 * cookie never does ({@link BACKEND_COOKIE_HEADER}): the agent panel's host
 * is under the base domain like every other.
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
        proxy_set_header X-Lamalibre-Relay-Assertion "";
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
${BACKEND_COOKIE_HEADER}

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
