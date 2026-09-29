# nginx Reverse Proxy

> nginx is the only public-facing service in Lamaste — it terminates TLS, enforces mTLS for the admin panel, delegates authentication to Authelia for tunneled apps, and proxies all traffic to internal services.

## In Plain English

Every request that reaches your Lamaste server goes through nginx first. Think of nginx as a concierge at a hotel. Every guest must pass through the lobby. The concierge checks credentials, directs guests to the right room, and turns away anyone who does not belong.

When a visitor arrives, nginx handles several jobs:

1. **Encryption** — it decrypts the HTTPS connection (TLS termination), so internal services do not need to deal with TLS themselves
2. **Routing** — it looks at the domain name in the request (e.g., `panel.example.com` vs `myapp.example.com`) and sends the request to the right internal service
3. **Authentication** — for the admin panel, it checks for a client certificate; for tunneled apps, it asks Authelia if the visitor is logged in
4. **Protection** — it is the only service listening on public ports, so everything else is shielded from direct internet access

No other service in Lamaste listens on a public network interface. nginx is the single point of entry.

## For Users

### What nginx does for you

You do not interact with nginx directly. The management panel handles all nginx configuration changes behind the scenes:

- When you complete onboarding, nginx vhosts are created for `panel.example.com`, `auth.example.com`, and `tunnel.example.com`
- When you create a tunnel, an nginx vhost is created for `myapp.example.com`
- When TLS certificates are renewed, nginx reloads to pick up the new certificates
- When you delete a tunnel, the vhost is removed and nginx reloads

### Plain HTTP

Port 80 answers every hostname with a redirect to the same address over HTTPS, so an `http://` link to your panel, a tunnel or a site still works. Let's Encrypt validation, which also uses port 80, is not affected by the redirect.

### The IP fallback

The panel is always accessible at `https://<your-ip>:9292`, even if your domain's DNS is misconfigured or your Let's Encrypt certificates expire. This IP-based vhost uses a self-signed certificate (your browser shows a warning) and requires the [mTLS client certificate](mtls.md).

This is your emergency backdoor. If everything goes wrong with domains and certificates, you can always reach the admin panel through the IP address.

### Vhosts in Lamaste

Each service gets its own virtual host (vhost) — a configuration block that tells nginx how to handle requests for a specific domain:

| Domain               | Internal service                  | Authentication                          | Port |
| -------------------- | --------------------------------- | --------------------------------------- | ---- |
| `http://<anything>`  | None — `301` to `https://`        | None                                    | 80   |
| `https://<ip>:9292`  | Panel server (`:3100`)            | mTLS client certificate                 | 9292 |
| `panel.example.com`  | Panel server (`:3100`)            | mTLS client certificate                 | 443  |
| `auth.example.com`   | Authelia (`:9091`)                | None (it is the auth service)           | 443  |
| `tunnel.example.com` | Chisel server (`:9090`)           | None (Chisel handles its own auth)      | 443  |
| `myapp.example.com`  | Chisel → carrying agent (`:3000`) | Gatekeeper + Authelia (per access mode) | 443  |
| `blog.example.com`   | Files on disk (static site)       | Optional Authelia                       | 443  |

### When things go wrong

If nginx fails to start or reload, your services become unreachable because nginx is the only public-facing gateway. The panel server always validates the nginx configuration (`nginx -t`) before reloading. If validation fails, the change is rolled back and the current configuration stays in place.

## For Developers

### Vhost architecture

nginx vhost files live in the standard Debian layout:

```
/etc/nginx/
├── nginx.conf                          # Main config (default)
├── snippets/
│   └── lamalibre-lamaste-mtls.conf             # mTLS snippet (included by panel vhosts)
├── sites-available/
│   ├── lamalibre-lamaste-http-redirect         # :80 catch-all → HTTPS (installer)
│   ├── lamalibre-lamaste-panel-ip              # IP:9292 vhost (always present)
│   ├── lamalibre-lamaste-panel-domain          # panel.example.com (after onboarding)
│   ├── lamalibre-lamaste-auth        # auth.example.com (after onboarding)
│   ├── lamalibre-lamaste-tunnel      # tunnel.example.com (after onboarding)
│   ├── lamalibre-lamaste-app-myapp   # myapp.example.com (per tunnel)
│   └── lamalibre-lamaste-site-<uuid> # Static site vhosts
└── sites-enabled/
    └── (symlinks to sites-available)
```

All Lamaste vhost files are prefixed with `lamaste-` to distinguish them from any pre-existing nginx configurations.

### The IP-based panel vhost

This vhost is created during installation and is the only vhost that exists before onboarding:

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

    # mTLS enforcement
    include /etc/nginx/snippets/lamalibre-lamaste-mtls.conf;

    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Help page for visitors without client cert
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

Key details:

- **Port 9292** — non-standard port to avoid conflicting with domain-based vhosts on 443
- **`server_name _`** — matches any hostname (catch-all for IP access)
- **Self-signed cert** — browsers show a security warning, which is expected for IP access
- **mTLS snippet** — requires client certificate at the TLS level
- **Error pages 495/496** — nginx-specific error codes for missing (496) or failed (495) client certificates

### The mTLS snippet

The snippet at `/etc/nginx/snippets/lamalibre-lamaste-mtls.conf` contains two directives:

```nginx
ssl_client_certificate /etc/lamalibre/lamaste/pki/ca.crt;
ssl_verify_client on;
```

- **`ssl_client_certificate`** — points to the CA certificate that signed the admin's client certificate
- **`ssl_verify_client on`** — hard requirement; connections without a valid client certificate are rejected at the TLS layer

This snippet is included in both the IP-based vhost and the domain-based panel vhost. It is not included in app vhosts (those use Authelia instead).

### Domain-based panel vhost

Created during onboarding for `panel.example.com`:

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

The difference from the IP vhost: port 443 instead of 9292, Let's Encrypt certificates instead of self-signed, and a specific `server_name` instead of catch-all. Requires the same `map $http_upgrade $connection_upgrade` block to be present.

### App tunnel vhost

Each tunneled app gets its own vhost. Which template is used depends on the tunnel's access mode: `public` proxies directly, while `authenticated` and `restricted` (the default) delegate each request to Gatekeeper, which validates the Authelia session and — for restricted tunnels — the user's grant:

```nginx
server {
    listen 443 ssl;
    server_name myapp.example.com;

    ssl_certificate /etc/letsencrypt/live/myapp.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/myapp.example.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    client_max_body_size 10m;

    # Gatekeeper authorization subrequest (handles Authelia validation + grant check)
    location /internal/lamaste/authz {
        internal;

        proxy_pass http://127.0.0.1:9294/authz/check;
        proxy_pass_request_body off;
        # ... X-Original-URL, X-Original-Method, Cookie headers ...
    }

    location / {
        # Identity headers come from Gatekeeper's answer, replacing any
        # the client sent (a public tunnel sets them all to "")
        auth_request /internal/lamaste/authz;
        auth_request_set $user $upstream_http_remote_user;
        proxy_set_header Remote-User $user;
        # ... Remote-Groups, Remote-Name, Remote-Email ...

        # Proxy headers are declared here, in the location: a location with
        # any proxy_set_header of its own inherits none from the server block
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Never pass client-supplied certificate headers to the app
        proxy_set_header X-SSL-Client-Verify "";
        proxy_set_header X-SSL-Client-DN "";
        proxy_set_header X-SSL-Client-Serial "";

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_pass http://127.0.0.1:PORT;
        proxy_http_version 1.1;

        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;

        # Not logged in -> Authelia portal
        error_page 401 =302 https://auth.example.com/?rd=$scheme://$http_host$request_uri;
        # Restricted only: no grant -> Gatekeeper's access-request page
        error_page 403 = /internal/lamaste/authz;
    }
}
```

The `location /internal/lamaste/authz` block is marked `internal`, meaning it cannot be accessed directly by clients. It is only triggered by the `auth_request` directive in the main `location /` block.

The `127.0.0.1:PORT` target is also why a tunnel can never use the port of a Lamaste service (3100, 9090, 9091, 9292, 9294): that vhost would publish the internal service. For the panel it would be worse than a leak, because the panel trusts the `X-SSL-Client-*` headers nginx sets as proof of a client certificate — which is also why tunnel vhosts always clear them.

`client_max_body_size` comes from the tunnel's `maxBodySizeMb` (1–10240 MiB, default 10; an agent may set at most 100). Requests above it get HTTP 413. Tunnels created before the setting existed carry no directive and so nginx's built-in 1 MiB limit, until a body limit is set on them (`PATCH /api/tunnels/:id` with `maxBodySizeMb`, or **Edit** in the panel). `127.0.0.1:PORT` is the listener Chisel opens on the server for the tunnel's carrying agent — see [Tunneling](tunneling.md#ownership-and-grants).

### Tunnel (Chisel) vhost

The WebSocket tunnel endpoint at `tunnel.example.com`:

```nginx
server {
    listen 443 ssl;
    server_name tunnel.example.com;

    ssl_certificate /etc/letsencrypt/live/tunnel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tunnel.example.com/privkey.pem;

    # ... standard SSL and proxy headers ...

    location / {
        proxy_pass http://127.0.0.1:9090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Long timeout for persistent WebSocket connections
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

The 24-hour timeouts (`86400s`) are essential for the Chisel WebSocket connection, which stays open indefinitely. Without these timeouts, nginx would close idle connections after 60 seconds (the default).

### WebSocket upgrade headers

WebSocket connections start as HTTP and then "upgrade" to the WebSocket protocol. nginx needs explicit configuration to pass this upgrade through:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
```

The `$connection_upgrade` variable comes from a `map` block defined at the top of the IP panel vhost:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

- **`proxy_http_version 1.1`** — WebSocket requires HTTP/1.1 (not 1.0)
- **`Upgrade`** — forwards the client's upgrade request to the backend
- **`Connection $connection_upgrade`** — set to `upgrade` when the client requests a WebSocket upgrade, or `close` for regular HTTP requests. This avoids keeping non-WebSocket connections open unnecessarily

These headers appear in three places: the panel vhost (for live log streaming), the tunnel vhost (for Chisel), and app vhosts (for apps that use WebSockets).

### Proxy headers

Every vhost sets standard proxy headers so backend services know about the original request. In tunnel vhosts they are declared inside each `location` — nginx inherits `proxy_set_header` from the server level only into locations that declare none of their own, and every tunnel location declares some — so apps behind a tunnel see the real `Host` and client address:

| Header              | nginx variable               | Purpose                           |
| ------------------- | ---------------------------- | --------------------------------- |
| `Host`              | `$host`                      | Original hostname from the client |
| `X-Real-IP`         | `$remote_addr`               | Client's actual IP address        |
| `X-Forwarded-For`   | `$proxy_add_x_forwarded_for` | Chain of proxy IPs                |
| `X-Forwarded-Proto` | `$scheme`                    | Original protocol (http or https) |

For mTLS vhosts, three additional headers are set (tunnel vhosts and the panel's public, certificate-less locations set them to empty instead, so a client cannot forge them):

| Header                | nginx variable       | Purpose                          |
| --------------------- | -------------------- | -------------------------------- |
| `X-SSL-Client-Verify` | `$ssl_client_verify` | `SUCCESS`, `FAILED`, or `NONE`   |
| `X-SSL-Client-DN`     | `$ssl_client_s_dn`   | Client certificate subject DN    |
| `X-SSL-Client-Serial` | `$ssl_client_serial` | Client certificate serial number |

### Safe write-with-rollback

All vhost writes follow a safe sequence to prevent nginx from entering a broken state:

```
1. Back up existing vhost (if any) → file.bak
2. Write new vhost to sites-available/
3. Create symlink in sites-enabled/
4. Run nginx -t (test configuration)
5a. If test passes → reload nginx, delete backup
5b. If test fails → restore backup, remove new file, throw error
```

This pattern is implemented once, as `safeWriteVhost()` in `packages/server/daemon/src/lib/nginx.js`, and shared by every vhost writer (tunnels, static sites, agent panels, the core onboarding vhosts). The panel runs unprivileged, so each file step is a call to the root-owned helper `lamaste-priv`, with the vhost text on stdin:

```javascript
async function safeWriteVhost(name, config, fqdn, { enabled = true } = {}) {
  const existed = await siteExists(name);
  const wasEnabled = await isSiteEnabled(name);
  if (existed) await siteAction('backup', name); // sudo lamaste-priv nginx-site backup <name>

  try {
    await writeVhostFile(name, config); // nginx-site write <name> (validated, then written)
    await (enabled ? enableSite(name) : disableSite(name));
    const result = await testConfig(); // sudo nginx -t
    if (!result.valid) {
      // restore(): nginx-site restore (or remove), then the previous link state
      throw new Error(`Nginx config test failed after writing vhost for ${fqdn}: ...`);
    }
    await reload(); // sudo systemctl reload nginx
    if (existed) await siteAction('discard-backup', name);
  } catch (err) {
    // Any other error, including a vhost lamaste-priv refuses, is rolled back too
  }
}
```

`lamaste-priv` accepts only the panel's own site names and only vhosts whose every directive is on its allow-list — nginx's master process runs as root and opens the files a configuration names, so a free-form vhost would be root access. See [nginx Configuration](../03-architecture/nginx-configuration.md#vhost-allow-list).

The `nginx -t` command parses the entire configuration and reports syntax errors without affecting the running server. Only after it passes does the code reload nginx.

### TLS configuration

All vhosts use the same TLS settings:

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers HIGH:!aNULL:!MD5;
ssl_prefer_server_ciphers on;
```

- **TLSv1.2 and TLSv1.3** — modern protocols only; TLSv1.0 and TLSv1.1 are disabled
- **`HIGH:!aNULL:!MD5`** — strong cipher suites only, no anonymous or MD5 ciphers
- **`ssl_prefer_server_ciphers on`** — server chooses the cipher, not the client

### Static site vhosts

Static sites served directly by nginx (without proxying to a backend) use a different template:

```nginx
server {
    listen 443 ssl;
    server_name blog.example.com;

    # ... TLS configuration ...

    root /var/www/lamaste/<site-id>/;
    index index.html;

    # Security headers
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;

    location / {
        try_files $uri $uri/ =404;
        # Or for SPAs: try_files $uri $uri/ /index.html;
    }
}
```

Static sites can optionally include Authelia forward-auth protection if the `autheliaProtected` flag is set.

A custom-domain site can also have **aliases** (for example `www.myblog.net`). They get a second server block on the same certificate that answers with `return 301 https://myblog.net$request_uri;`. A hostname is served by at most one vhost: a tunnel cannot take a name a site or alias already serves, and an alias cannot take a tunnel's or another site's name.

### Source files

| File                                          | Purpose                                             |
| --------------------------------------------- | --------------------------------------------------- |
| `packages/server/daemon/src/lib/nginx.js`     | Vhost write, enable/disable, test, reload, rollback |
| `packages/create-lamaste/src/tasks/nginx.js`  | IP-based vhost, mTLS snippet, self-signed cert      |
| `packages/create-lamaste/src/tasks/harden.js` | nginx package installation                          |

## Quick Reference

### Vhost files

| File                             | Domain               | Auth              | Created      |
| -------------------------------- | -------------------- | ----------------- | ------------ |
| `lamalibre-lamaste-panel-ip`     | `_` (any) on `:9292` | mTLS              | Installation |
| `lamalibre-lamaste-panel-domain` | `panel.example.com`  | mTLS              | Onboarding   |
| `lamalibre-lamaste-auth`         | `auth.example.com`   | None              | Onboarding   |
| `lamalibre-lamaste-tunnel`       | `tunnel.example.com` | None              | Onboarding   |
| `lamalibre-lamaste-app-<name>`   | `<name>.example.com` | Authelia          | Per tunnel   |
| `lamalibre-lamaste-site-<uuid>`  | Custom FQDN          | Optional Authelia | Per site     |

### Internal service ports

| Service       | Bind address | Port |
| ------------- | ------------ | ---- |
| Panel server  | `127.0.0.1`  | 3100 |
| Authelia      | `127.0.0.1`  | 9091 |
| Chisel server | `127.0.0.1`  | 9090 |

### Public ports

| Port | Protocol | Purpose                                         |
| ---- | -------- | ----------------------------------------------- |
| 443  | HTTPS    | Domain-based vhosts (panel, auth, tunnel, apps) |
| 9292 | HTTPS    | IP-based panel access (always available)        |
| 22   | SSH      | SSH access (used only during installation)      |

### nginx commands

```bash
# Test configuration (always run before reload)
sudo nginx -t

# Reload (apply config changes without restart)
sudo systemctl reload nginx

# Restart (full restart)
sudo systemctl restart nginx

# View status
systemctl status nginx

# View error logs
sudo tail -f /var/log/nginx/error.log

# List enabled Lamaste vhosts
ls /etc/nginx/sites-enabled/lamaste-*
```

### Key nginx directives

| Directive                              | Purpose                                    |
| -------------------------------------- | ------------------------------------------ |
| `ssl_verify_client on`                 | Require client certificate (mTLS)          |
| `auth_request /internal/lamaste/authz` | Delegate auth to Gatekeeper subrequest     |
| `client_max_body_size`                 | Per-tunnel request body limit              |
| `proxy_http_version 1.1`               | Required for WebSocket upgrade             |
| `proxy_read_timeout 86400s`            | Keep WebSocket connections alive (24h)     |
| `error_page 495 496`                   | Handle missing/invalid client cert         |
| `error_page 401 =302`                  | Redirect unauthenticated users to Authelia |
| `internal`                             | Location accessible only via subrequests   |

### Related documentation

- [mTLS](mtls.md) — client certificate authentication details
- [Authentication](authentication.md) — Authelia forward-auth integration
- [Tunneling](tunneling.md) — WebSocket tunnels proxied by nginx
- [Certificates](certificates.md) — TLS certificates used by nginx vhosts
- [Security Model](security-model.md) — nginx as the sole public-facing service
