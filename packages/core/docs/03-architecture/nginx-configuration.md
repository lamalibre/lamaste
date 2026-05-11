# nginx Configuration Architecture

> nginx is the only public-facing service in Lamaste. It handles TLS termination, mTLS enforcement, reverse proxying, forward authentication, and WebSocket upgrades for all traffic.

## In Plain English

Every request to Lamaste passes through nginx first. For the admin panel, nginx checks that your browser has a valid client certificate before letting the request through. For tunneled apps, nginx asks Authelia to verify the user's identity. For tunnel connections from your machine, nginx upgrades the connection to a WebSocket and forwards it to the Chisel tunnel server.

nginx is the gatekeeper. The services behind it (Panel Server, Authelia, Chisel) all bind to `127.0.0.1` and are invisible from the internet. nginx is what makes them accessible — securely and selectively.

## Overview

```
Internet
  │
  ├── :9292 (IP-based, always available)
  │   └── lamalibre-lamaste-panel-ip
  │       ├── Self-signed TLS cert
  │       ├── mTLS client cert required
  │       └── Proxy → 127.0.0.1:3100 (Panel Server)
  │
  └── :443 (domain-based, after onboarding)
      │
      ├── panel.<domain>
      │   └── lamalibre-lamaste-panel-domain
      │       ├── Let's Encrypt TLS cert
      │       ├── mTLS client cert required
      │       └── Proxy → 127.0.0.1:3100 (Panel Server)
      │
      ├── auth.<domain>
      │   └── lamalibre-lamaste-auth
      │       ├── Let's Encrypt TLS cert
      │       └── Proxy → 127.0.0.1:9091 (Authelia)
      │
      ├── tunnel.<domain>
      │   └── lamalibre-lamaste-tunnel
      │       ├── Let's Encrypt TLS cert
      │       ├── WebSocket upgrade
      │       └── Proxy → 127.0.0.1:9090 (Chisel Server)
      │
      └── <app>.<domain>
          └── lamalibre-lamaste-app-<name>
              ├── Let's Encrypt TLS cert
              ├── Authelia forward auth
              ├── WebSocket upgrade
              └── Proxy → 127.0.0.1:<port> (tunneled app)
```

## Vhost Types

Lamaste manages nine categories of nginx vhosts. Each is generated programmatically by the Panel Server's `nginx.js` library or the installer's `nginx.js` task.

### 1. IP Panel Vhost (`lamalibre-lamaste-panel-ip`)

Created by the installer. The fallback admin access path that always works.

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 9292 ssl;
    server_name _;

    ssl_certificate /etc/lamalibre/lamaste/pki/self-signed.pem;
    ssl_certificate_key /etc/lamalibre/lamaste/pki/self-signed-key.pem;

    include /etc/nginx/snippets/lamalibre-lamaste-mtls.conf;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Certificate help page for visitors without client cert
    error_page 495 496 /cert-help.html;
    location = /cert-help.html {
        root /opt/lamalibre/lamaste/lamaste-server-ui;
        internal;
    }

    # Proxy to lamalibre-lamaste-serverd
    location / {
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

    # API paths with WebSocket upgrade support
    location /api {
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
```

Key characteristics:

- Listens on port 9292, separate from standard HTTPS port 443
- Uses a self-signed TLS certificate (browser will warn, this is expected)
- Includes the mTLS snippet for client certificate enforcement
- Error pages 495 (no cert) and 496 (bad cert) serve a static help page with import instructions
- Two `location` blocks: `/` for standard HTTP proxy, `/api` for WebSocket-capable proxy

### 2. Domain Panel Vhost (`lamalibre-lamaste-panel-domain`)

Created during onboarding provisioning. Domain-based panel access with proper TLS.

```nginx
server {
    listen 443 ssl;
    server_name panel.example.com;

    ssl_certificate /etc/letsencrypt/live/panel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;

    # mTLS — same as IP-based access
    include /etc/nginx/snippets/lamalibre-lamaste-mtls.conf;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
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

    # API paths with WebSocket upgrade support
    location /api {
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
```

Identical to the IP vhost except:

- Listens on port 443 (standard HTTPS)
- Uses Let's Encrypt certificate (no browser warning)
- `server_name` is `panel.<domain>`
- Requires the `map $http_upgrade $connection_upgrade` block from the IP vhost (or a shared config) to be present

### 3. Auth Vhost (`lamalibre-lamaste-auth`)

Created during onboarding provisioning. Serves the Authelia authentication portal.

```nginx
server {
    listen 443 ssl;
    server_name auth.example.com;

    ssl_certificate /etc/letsencrypt/live/auth.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/auth.example.com/privkey.pem;

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

    # Default — proxy to Authelia
    location / {
        proxy_pass http://127.0.0.1:9091;
    }
}
```

No mTLS requirement — end users access this to authenticate. Protected by Authelia's own login form and TOTP. The auth vhost also serves the invitation page (static HTML at `/invite/`) and proxies invitation API requests (`/api/invite/`) to the panel server, allowing invited users to set up their accounts without needing mTLS credentials.

### 4. Tunnel Vhost (`lamalibre-lamaste-tunnel`)

Created during onboarding provisioning. WebSocket endpoint for Chisel client connections.

```nginx
server {
    listen 443 ssl;
    server_name tunnel.example.com;

    ssl_certificate /etc/letsencrypt/live/tunnel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tunnel.example.com/privkey.pem;

    # ... standard SSL and proxy headers

    location / {
        proxy_pass http://127.0.0.1:9090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Long timeout for persistent tunnel connections
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

Key characteristics:

- WebSocket upgrade is mandatory (Chisel uses WebSocket transport)
- 24-hour read/send timeouts to keep tunnel connections alive without nginx closing them
- No mTLS and no Authelia — Chisel handles its own authentication

### 5. App Vhost (`lamalibre-lamaste-app-<name>`)

Created when a tunnel is added via the management UI. Each tunnel gets its own vhost.

```nginx
server {
    listen 443 ssl;
    server_name myapp.example.com;

    ssl_certificate /etc/letsencrypt/live/myapp.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/myapp.example.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Authelia forward authentication (AuthRequest implementation for nginx)
    location /internal/lamaste/authz {
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
        auth_request /internal/lamaste/authz;
        auth_request_set $user $upstream_http_remote_user;
        auth_request_set $groups $upstream_http_remote_groups;
        auth_request_set $name $upstream_http_remote_name;
        auth_request_set $email $upstream_http_remote_email;
        auth_request_set $redirection_url $upstream_http_location;

        proxy_set_header Remote-User $user;
        proxy_set_header Remote-Groups $groups;
        proxy_set_header Remote-Name $name;
        proxy_set_header Remote-Email $email;

        proxy_pass http://127.0.0.1:<port>;
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
```

Key characteristics:

- Forward auth via `auth_request` to Authelia's `/api/authz/auth-request` endpoint
- Passes authenticated user info as headers (`Remote-User`, `Remote-Groups`, etc.)
- WebSocket support for apps that need it
- 401 errors redirect to the Authelia login page with a return URL

### 6. Static Site Vhost (`lamalibre-lamaste-site-<id>`)

Created when a static site is added via the management UI. Serves files directly from disk.

```nginx
server {
    listen 443 ssl;
    server_name blog.example.com;

    ssl_certificate /etc/letsencrypt/live/blog.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/blog.example.com/privkey.pem;

    root /var/www/lamaste/<site-id>/;
    index index.html;

    # Security headers
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;

    # Optional Authelia forward auth (same pattern as app vhost)

    location / {
        try_files $uri $uri/ =404;       # Standard mode
        # OR
        try_files $uri $uri/ /index.html; # SPA mode
    }
}
```

Two serving modes based on the `spaMode` flag:

- **Standard**: `try_files $uri $uri/ =404` — serves files as-is, 404 for missing paths
- **SPA**: `try_files $uri $uri/ /index.html` — falls back to `index.html` for client-side routing

Optional Authelia protection is controlled by the `autheliaProtected` flag on the site object.

### 7. Public Tunnel Vhost (`lamalibre-lamaste-app-<name>`, access mode: public)

Created when a tunnel is configured with public access. Direct proxy with no authentication.

```nginx
server {
    listen 443 ssl;
    server_name public-app.example.com;

    ssl_certificate /etc/letsencrypt/live/public-app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/public-app.example.com/privkey.pem;

    # ... standard SSL settings and proxy headers

    location / {
        proxy_pass http://127.0.0.1:<port>;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

No `auth_request`, no Authelia, no Gatekeeper. Traffic is proxied directly to the tunneled app. Use only for services that handle their own authentication or are intentionally public.

### 8. Authenticated Tunnel Vhost (`lamalibre-lamaste-app-<name>`, access mode: authenticated)

Created when a tunnel requires Authelia login but no per-user grant checking. Any authenticated Authelia user can access the tunnel.

```nginx
server {
    listen 443 ssl;
    server_name app.example.com;

    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

    # ... standard SSL settings and proxy headers

    # Gatekeeper authorization subrequest (handles Authelia validation + grant check)
    location /internal/lamaste/authz {
        internal;

        proxy_pass http://127.0.0.1:9294/authz/check;
        proxy_pass_request_body off;

        proxy_set_header Content-Length "";
        proxy_set_header Connection "";
        proxy_set_header X-Original-Method $request_method;
        proxy_set_header X-Original-URL $scheme://$http_host$request_uri;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Host $http_host;
        proxy_set_header Cookie $http_cookie;

        proxy_http_version 1.1;
        proxy_buffers 4 32k;
        proxy_next_upstream error timeout invalid_header http_500 http_502 http_503;
    }

    location / {
        # Clear client-supplied identity headers
        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";

        auth_request /internal/lamaste/authz;
        auth_request_set $user $upstream_http_remote_user;
        auth_request_set $groups $upstream_http_remote_groups;
        auth_request_set $name $upstream_http_remote_name;
        auth_request_set $email $upstream_http_remote_email;

        proxy_set_header Remote-User $user;
        proxy_set_header Remote-Groups $groups;
        proxy_set_header Remote-Name $name;
        proxy_set_header Remote-Email $email;

        proxy_pass http://127.0.0.1:<port>;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;

        # Authentication failure -> redirect to Authelia login
        error_page 401 =302 https://auth.<domain>/?rd=$scheme://$http_host$request_uri;
    }
}
```

Key characteristics:

- `auth_request` targets the Gatekeeper at `127.0.0.1:9294/authz/check` instead of Authelia directly
- The Gatekeeper validates the Authelia session cookie and returns 200 (authenticated) or 401 (unauthenticated)
- Client-supplied `Remote-*` headers are cleared before the auth subrequest to prevent spoofing
- 401 redirects to the Authelia login portal

> **Note:** The `lamalibre-lamaste-authz-cache.conf` nginx snippet is installed by the Gatekeeper installer task, but the generated vhosts do not currently include `proxy_cache` directives. Authorization caching relies on the Gatekeeper's in-memory session cache (30-second TTL) rather than nginx-level proxy caching.

### 9. Restricted Tunnel Vhost (`lamalibre-lamaste-app-<name>`, access mode: restricted)

Created when a tunnel requires both Authelia login and an explicit access grant. Only users with a matching grant in `access-grants.json` can access the tunnel.

```nginx
server {
    listen 443 ssl;
    server_name restricted-app.example.com;

    ssl_certificate /etc/letsencrypt/live/restricted-app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/restricted-app.example.com/privkey.pem;

    # ... standard SSL settings and proxy headers

    # Gatekeeper authorization subrequest (handles Authelia validation + grant check)
    location /internal/lamaste/authz {
        internal;

        proxy_pass http://127.0.0.1:9294/authz/check;
        proxy_pass_request_body off;

        proxy_set_header Content-Length "";
        proxy_set_header Connection "";
        proxy_set_header X-Original-Method $request_method;
        proxy_set_header X-Original-URL $scheme://$http_host$request_uri;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Host $http_host;
        proxy_set_header Cookie $http_cookie;

        proxy_http_version 1.1;
        proxy_buffers 4 32k;
        proxy_next_upstream error timeout invalid_header http_500 http_502 http_503;
    }

    location / {
        # Clear client-supplied identity headers
        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";

        auth_request /internal/lamaste/authz;
        auth_request_set $user $upstream_http_remote_user;
        auth_request_set $groups $upstream_http_remote_groups;
        auth_request_set $name $upstream_http_remote_name;
        auth_request_set $email $upstream_http_remote_email;

        proxy_set_header Remote-User $user;
        proxy_set_header Remote-Groups $groups;
        proxy_set_header Remote-Name $name;
        proxy_set_header Remote-Email $email;

        proxy_pass http://127.0.0.1:<port>;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;

        # Authentication failure -> redirect to Authelia login
        error_page 401 =302 https://auth.<domain>/?rd=$scheme://$http_host$request_uri;

        # Authorization failure -> Gatekeeper serves inline access-request page
        error_page 403 = /internal/lamaste/authz;
    }
}
```

Key differences from the authenticated vhost:

- The Gatekeeper checks both the Authelia session and the access grant. If the user is authenticated but has no grant for this resource, the Gatekeeper returns 403 instead of 200
- `error_page 403 = /internal/lamaste/authz` replays the request to the Gatekeeper internal location. The `=` prefix causes nginx to use the response body and status code from the Gatekeeper, which serves an inline HTML access-request page with pre-filled message templates
- 401 (unauthenticated) still redirects to Authelia login as before

## nginx Cache Zone (`lamaste_authz`)

The Gatekeeper authorization responses are cached by nginx to reduce subrequest overhead. The cache zone is defined in a shared snippet:

**File:** `/etc/nginx/snippets/lamalibre-lamaste-authz-cache.conf`

```nginx
proxy_cache_path /var/cache/nginx/authz levels=1:2 keys_zone=lamaste_authz:1m max_size=10m inactive=5m;
```

| Parameter   | Value | Purpose                                                   |
| ----------- | ----- | --------------------------------------------------------- |
| `keys_zone` | `1m`  | 1 MB for cache keys (sufficient for thousands of entries) |
| `max_size`  | `10m` | 10 MB maximum disk storage for cached responses           |
| `inactive`  | `5m`  | Evict entries not accessed within 5 minutes               |

**Cache key:** `$cookie_authelia_session$http_host` — ensures each user session gets its own cache entry per host, preventing authorization decisions from leaking across users or subdomains.

**Cache TTLs (when used):**

- `200` (authorized): 30 seconds — reduces subrequests during rapid page loads
- `401` / `403` (denied): 10 seconds — allows quick re-check after login or grant changes

> **Note:** The cache zone is installed by the Gatekeeper installer task, but the generated vhosts (`buildGatekeeperVhost()`) do not currently include `proxy_cache` directives in the internal location block. Authorization caching currently relies on the Gatekeeper's in-memory session cache (30-second TTL). The nginx cache zone is available for future use if nginx-level caching is needed.

## mTLS Snippet Pattern

The mTLS configuration is shared across panel vhosts via an nginx snippet:

**File:** `/etc/nginx/snippets/lamalibre-lamaste-mtls.conf`

```nginx
ssl_client_certificate /etc/lamalibre/lamaste/pki/ca.crt;
ssl_verify_client optional;
```

Included with `include /etc/nginx/snippets/lamalibre-lamaste-mtls.conf;` in any vhost that requires client certificate verification.

**What `ssl_verify_client optional` does:**

- During the TLS handshake, nginx requests a client certificate from the browser
- The browser presents the imported `client.p12` certificate (or sends no certificate)
- nginx verifies the certificate was signed by the CA at `/etc/lamalibre/lamaste/pki/ca.crt`
- If verification succeeds: `$ssl_client_verify` is set to `SUCCESS`
- If no certificate is sent or verification fails: the TLS handshake still completes, but `$ssl_client_verify` is not `SUCCESS`

**Location-level mTLS enforcement:**

Protected locations (`/`, `/api`) enforce mTLS explicitly:

```nginx
if ($ssl_client_verify != SUCCESS) { return 496; }
```

Public locations (`/api/enroll`, `/api/invite`) skip the mTLS check and clear cert headers to prevent spoofing:

```nginx
location /api/enroll {
    proxy_set_header X-SSL-Client-Verify "";
    proxy_set_header X-SSL-Client-DN "";
    proxy_set_header X-SSL-Client-Serial "";
    # ... proxy_pass to lamalibre-lamaste-serverd
    limit_req zone=enroll burst=5 nodelay;
}
```

The `/api/enroll` endpoint is rate-limited (`limit_req zone=enroll burst=5 nodelay`) to prevent brute-force token attempts. The `enroll` zone is defined in the `http` block.

This design allows the panel vhosts to serve both mTLS-protected and public endpoints on the same port, while keeping the security boundary at the location level.

## Write-With-Rollback Pattern

All vhost modifications in the Panel Server follow a safe write-with-rollback sequence. This is implemented in `packages/lamaste-serverd/src/lib/nginx.js`.

```
┌─────────────────────────────────────────────────────┐
│ 1. Backup existing vhost (if any)                    │
│    sudo cp sites-available/<name> <name>.bak         │
├─────────────────────────────────────────────────────┤
│ 2. Write new vhost via temp file                     │
│    Write to /tmp/nginx-<name>-<random>               │
│    sudo mv /tmp/... → sites-available/<name>         │
│    sudo chmod 644 sites-available/<name>             │
├─────────────────────────────────────────────────────┤
│ 3. Enable site                                       │
│    sudo ln -sf sites-available/<name>                │
│              → sites-enabled/<name>                  │
├─────────────────────────────────────────────────────┤
│ 4. Test configuration                                │
│    sudo nginx -t                                     │
│    ├── Success → continue to step 5                  │
│    └── Failure → rollback                            │
│        If backup exists: sudo mv <name>.bak <name>   │
│        If no backup: sudo rm sites-available/<name>  │
│                      sudo rm sites-enabled/<name>    │
│        Throw error with nginx -t output              │
├─────────────────────────────────────────────────────┤
│ 5. Reload nginx                                      │
│    sudo systemctl reload nginx                       │
├─────────────────────────────────────────────────────┤
│ 6. Clean up backup                                   │
│    sudo rm <name>.bak (on success only)              │
└─────────────────────────────────────────────────────┘
```

**Why this matters:** A bad vhost configuration can prevent nginx from reloading, breaking all sites on the server. The `nginx -t` test catches syntax errors and missing certificate files before the reload. The rollback ensures the previous working configuration is restored if the test fails.

The implementation wraps the entire sequence in a try/catch. Even unexpected errors (e.g., `sudo mv` fails) trigger rollback:

```javascript
export async function writeAppVhost(subdomain, domain, port, certPath) {
  const existed = await fileExistsSudo(availablePath);
  if (existed) {
    await execa('sudo', ['cp', availablePath, bakPath]);
  }

  try {
    await writeVhostFile(name, config);
    await enableSite(name);

    const result = await testConfig();
    if (!result.valid) {
      // Rollback
      if (existed) {
        await execa('sudo', ['mv', bakPath, availablePath]);
      } else {
        await execa('sudo', ['rm', '-f', availablePath]);
        await execa('sudo', ['rm', '-f', path.join(SITES_ENABLED, name)]);
      }
      throw new Error(`Nginx config test failed: ${result.error}`);
    }

    await reload();

    if (existed) {
      await execa('sudo', ['rm', '-f', bakPath]).catch(() => {});
    }
  } catch (err) {
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
```

## Forward Auth Block

The Authelia forward auth integration uses nginx's `auth_request` module. Here is the flow:

```
1. User requests https://myapp.example.com/page
   │
2. nginx sends internal subrequest to /internal/lamaste/authz
   │  ├── proxy_pass → http://127.0.0.1:9091/api/authz/auth-request
   │  ├── Sends X-Original-URL, X-Original-Method headers
   │  └── Strips request body (Content-Length: "")
   │
3. Authelia checks the session cookie
   │  ├── Valid session → 200 + user info headers
   │  └── No session → 401 + Location header with redirect URL
   │
4. nginx processes auth_request result
   │  ├── 200 → Extract user info headers (auth_request_set)
   │  │         Set Remote-User, Remote-Groups, etc.
   │  │         Proxy to tunneled app at 127.0.0.1:<port>
   │  │
   │  └── 401 → auth_request_set captures $redirection_url from Location header
   │            error_page 401 =302 $redirection_url
   │            Redirect to Authelia login with return URL
   │
5. After Authelia login (TOTP verified):
   │  Authelia sets session cookie on the domain
   │  Redirects back to original URL
   │  Step 3 succeeds on retry
```

The forward auth pattern means the tunneled app never needs to implement authentication. It receives pre-verified user identity via HTTP headers.

## WebSocket Upgrade Support

WebSocket support requires specific nginx configuration:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

These directives are applied in:

- **Panel vhosts** (`/api` location) — for provisioning progress stream and live log streaming
- **Tunnel vhost** — for Chisel WebSocket transport
- **App vhosts** (`/` location) — for tunneled apps that use WebSocket

The 24-hour timeout (`proxy_read_timeout 86400s`) is set on tunnel and app vhosts to prevent nginx from closing long-lived WebSocket connections.

## Directory Structure

```
/etc/nginx/
├── nginx.conf                          ← Default nginx config (not modified by Lamaste)
├── sites-available/
│   ├── lamalibre-lamaste-panel-ip              ← IP:9292 panel access (created by installer)
│   ├── lamalibre-lamaste-panel-domain          ← panel.<domain> (created during onboarding)
│   ├── lamalibre-lamaste-auth        ← auth.<domain> (created during onboarding)
│   ├── lamalibre-lamaste-tunnel      ← tunnel.<domain> (created during onboarding)
│   ├── lamalibre-lamaste-app-myapp   ← <app>.<domain> (created per tunnel)
│   └── lamalibre-lamaste-site-<uuid> ← <site>.<domain> (created per static site)
├── sites-enabled/
│   ├── lamalibre-lamaste-panel-ip → ../sites-available/lamalibre-lamaste-panel-ip
│   ├── lamalibre-lamaste-panel-domain → ../sites-available/lamalibre-lamaste-panel-domain
│   ├── lamalibre-lamaste-auth → ../sites-available/lamalibre-lamaste-auth
│   ├── lamalibre-lamaste-tunnel → ../sites-available/lamalibre-lamaste-tunnel
│   ├── lamalibre-lamaste-app-myapp → ../sites-available/lamalibre-lamaste-app-myapp
│   └── lamalibre-lamaste-site-<uuid> → ../sites-available/lamalibre-lamaste-site-<uuid>
└── snippets/
    ├── lamalibre-lamaste-mtls.conf             ← Shared mTLS client cert verification
    └── lamalibre-lamaste-authz-cache.conf      ← Gatekeeper proxy_cache zone definition
```

All Lamaste-managed files are prefixed with `lamalibre-lamaste-` to distinguish them from other nginx configurations on the system.

## Vhost Lifecycle

### Created by the Installer

| Vhost                        | When         | Removed                 |
| ---------------------------- | ------------ | ----------------------- |
| `lamalibre-lamaste-panel-ip` | Installation | Never (fallback access) |

### Created During Onboarding

| Vhost                            | When                | Removed                      |
| -------------------------------- | ------------------- | ---------------------------- |
| `lamalibre-lamaste-panel-domain` | Provisioning step 4 | Never (primary panel access) |
| `lamalibre-lamaste-auth`         | Provisioning step 4 | Never (auth portal)          |
| `lamalibre-lamaste-tunnel`       | Provisioning step 4 | Never (tunnel endpoint)      |

### Created/Removed at Runtime

| Vhost                           | Created           | Removed                 |
| ------------------------------- | ----------------- | ----------------------- |
| `lamalibre-lamaste-app-<name>`  | POST /api/tunnels | DELETE /api/tunnels/:id |
| `lamalibre-lamaste-site-<uuid>` | POST /api/sites   | DELETE /api/sites/:id   |

## Key Files

| File                                                     | Role                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| `packages/create-lamaste/src/tasks/nginx.js`             | Installer: self-signed cert, mTLS snippet, IP vhost                   |
| `packages/lamaste-serverd/src/lib/nginx.js`              | Runtime: vhost generation, write-with-rollback, enable/disable/reload |
| `/etc/nginx/snippets/lamalibre-lamaste-mtls.conf`        | Shared mTLS snippet                                                   |
| `/etc/nginx/snippets/lamalibre-lamaste-authz-cache.conf` | Gatekeeper proxy_cache zone definition                                |
| `/etc/nginx/sites-available/lamalibre-lamaste-*`         | Vhost configuration files                                             |
| `/etc/nginx/sites-enabled/lamalibre-lamaste-*`           | Symlinks to enabled vhosts                                            |

## Design Decisions

### Why port 9292 for IP-based access?

Port 9292 is above the privileged port range (no root needed to listen) and is unlikely to conflict with other services. It is deliberately different from port 443 to ensure the IP-based fallback always works, even if domain-based HTTPS on 443 is misconfigured.

### Why self-signed certificates for IP access?

Let's Encrypt cannot issue certificates for IP addresses. A self-signed certificate provides encryption for the connection, even though the browser shows a warning. The mTLS client certificate is the real security mechanism — it proves the caller's identity regardless of the server certificate.

### Why include the mTLS snippet instead of inline?

The mTLS configuration (two lines) is identical across panel vhosts. An nginx snippet avoids duplication and ensures that if the CA certificate path changes, it only needs to be updated in one place. This is especially important because the IP vhost is created by the installer and the domain vhost is created by the Panel Server — they must stay in sync.

### Why error pages 495/496 for certificate help?

nginx emits error 495 when no client certificate is provided and 496 when the certificate is invalid. These are nginx-specific error codes (not standard HTTP). By mapping them to a static HTML page with import instructions, visitors who forgot to import their certificate see helpful guidance instead of a cryptic "400 Bad Request".

### Why 24-hour WebSocket timeouts?

Chisel tunnel connections and some app WebSocket connections are long-lived. nginx's default `proxy_read_timeout` of 60 seconds would close these connections, causing tunnel drops. The 24-hour timeout is effectively "never timeout" for practical purposes, while still allowing nginx to reclaim resources from genuinely dead connections.

### Why use sudo for nginx operations?

The Panel Server runs as the `lamaste` user, not root. Writing to `/etc/nginx/sites-available/` and reloading nginx require root privileges. Instead of running the Panel Server as root, Lamaste uses scoped `sudoers` rules that allow the `lamaste` user to perform only specific operations (mv to specific paths, `nginx -t`, `systemctl reload nginx`). This follows the principle of least privilege.
