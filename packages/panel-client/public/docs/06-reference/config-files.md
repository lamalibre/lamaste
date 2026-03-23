# Config Files

> Complete reference for every configuration and state file Portlama uses.

## File Overview

| File                                     | Format     | Owner             | Mode | Purpose                       |
| ---------------------------------------- | ---------- | ----------------- | ---- | ----------------------------- |
| `/etc/portlama/panel.json`               | JSON       | portlama:portlama | 0640 | Panel server configuration    |
| `/etc/portlama/tunnels.json`             | JSON       | portlama:portlama | 0600 | Tunnel definitions            |
| `/etc/portlama/sites.json`               | JSON       | portlama:portlama | 0600 | Static site definitions       |
| `/etc/authelia/configuration.yml`        | YAML       | root:root         | 0600 | Authelia server configuration |
| `/etc/authelia/users.yml`                | YAML       | root:root         | 0600 | User database                 |
| `/etc/authelia/.secrets.json`            | JSON       | root:root         | 0600 | Authelia secrets              |
| `/etc/nginx/sites-available/portlama-*`  | nginx conf | root:root         | 0644 | Vhost configurations          |
| `/etc/nginx/snippets/portlama-mtls.conf` | nginx conf | root:root         | 0644 | mTLS snippet                  |

---

## `/etc/portlama/panel.json`

The primary configuration file for the panel server. Created by the installer, updated during onboarding and tunnel management.

**Schema:**

| Field               | Type           | Required | Default         | Description                                           |
| ------------------- | -------------- | -------- | --------------- | ----------------------------------------------------- |
| `ip`                | string         | Yes      | —               | Server public IP address                              |
| `domain`            | string \| null | Yes      | `null`          | Base domain (set during onboarding)                   |
| `email`             | string \| null | Yes      | `null`          | Admin email for Let's Encrypt (set during onboarding) |
| `dataDir`           | string         | Yes      | `/etc/portlama` | Path to data/state directory                          |
| `staticDir`         | string         | No       | —               | Path to panel-client dist directory                   |
| `maxSiteSize`       | number         | No       | `524288000`     | Max static site upload size in bytes (500 MB)         |
| `adminAuthMode`     | string         | No       | `"p12"`         | `"p12"` or `"hardware-bound"`. When `"hardware-bound"`, P12 download and rotation are disabled; admin authenticates via Keychain-backed certificate. |
| `onboarding.status` | enum           | Yes      | `FRESH`         | Current onboarding state                              |

**Onboarding status values:**

| Value          | Meaning                                             |
| -------------- | --------------------------------------------------- |
| `FRESH`        | No onboarding started — shows onboarding wizard     |
| `DOMAIN_SET`   | Domain and email entered, awaiting DNS verification |
| `DNS_READY`    | DNS verified, ready to provision                    |
| `PROVISIONING` | Stack provisioning in progress                      |
| `COMPLETED`    | Onboarding complete — shows management UI           |

**Example (fresh install):**

```json
{
  "ip": "203.0.113.42",
  "domain": null,
  "email": null,
  "dataDir": "/etc/portlama",
  "staticDir": "/opt/portlama/panel-client/dist",
  "onboarding": {
    "status": "FRESH"
  }
}
```

**Example (after onboarding):**

```json
{
  "ip": "203.0.113.42",
  "domain": "example.com",
  "email": "admin@example.com",
  "dataDir": "/etc/portlama",
  "staticDir": "/opt/portlama/panel-client/dist",
  "maxSiteSize": 524288000,
  "onboarding": {
    "status": "COMPLETED"
  }
}
```

**Config resolution order:**

1. `PORTLAMA_CONFIG` environment variable (if set)
2. In development (`NODE_ENV=development` or `NODE_ENV` unset): `<package-root>/dev/panel.json`
3. In production (`NODE_ENV=production`): `/etc/portlama/panel.json`

> **Note:** The systemd service unit sets `CONFIG_FILE` in the environment, but the panel server code reads `PORTLAMA_CONFIG`. The systemd variable `CONFIG_FILE` is not used by the application. In production deployments this has no effect because the code falls back to `/etc/portlama/panel.json` when `PORTLAMA_CONFIG` is unset and `NODE_ENV=production`.

**Write pattern:** Atomic — writes to `.tmp` file then `rename()`.

**Validated with:** Zod schema in `packages/panel-server/src/lib/config.js`.

---

## `/etc/portlama/tunnels.json`

Stores the array of configured tunnels. Created automatically when the first tunnel is added.

**Schema:** Array of tunnel objects.

| Field         | Type           | Description                               |
| ------------- | -------------- | ----------------------------------------- |
| `id`          | string         | UUID                                      |
| `subdomain`   | string         | Subdomain name (e.g., `myapp`)            |
| `fqdn`        | string         | Full domain (e.g., `myapp.example.com`)   |
| `port`        | number         | Local port on the tunnel client machine   |
| `description` | string \| null | Optional description (max 200 characters) |
| `enabled`     | boolean        | Whether the tunnel is active              |
| `createdAt`   | string         | ISO 8601 timestamp                        |

**Example:**

```json
[
  {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "subdomain": "myapp",
    "fqdn": "myapp.example.com",
    "port": 3000,
    "description": "My web app",
    "enabled": true,
    "createdAt": "2026-03-13T10:30:45.000Z"
  },
  {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "subdomain": "api",
    "fqdn": "api.example.com",
    "port": 8080,
    "description": null,
    "enabled": true,
    "createdAt": "2026-03-13T11:00:00.000Z"
  }
]
```

**Write pattern:** Atomic — writes to `.tmp`, calls `fsync()`, then `rename()`.

**State directory:** Configurable via `PORTLAMA_STATE_DIR` environment variable, defaults to `/etc/portlama`.

---

## `/etc/portlama/sites.json`

Stores the array of static sites hosted through Portlama.

**Schema:** Array of site objects.

| Field               | Type    | Description                                      |
| ------------------- | ------- | ------------------------------------------------ |
| `id`                | string  | UUID                                             |
| `fqdn`              | string  | Full domain (e.g., `blog.example.com`)           |
| `spaMode`           | boolean | If true, `try_files` falls back to `/index.html` |
| `autheliaProtected` | boolean | If true, requires Authelia authentication        |
| `rootPath`          | string  | Document root (e.g., `/var/www/portlama/<id>/`)  |
| `createdAt`         | string  | ISO 8601 timestamp                               |

**Example:**

```json
[
  {
    "id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
    "fqdn": "blog.example.com",
    "spaMode": false,
    "autheliaProtected": false,
    "rootPath": "/var/www/portlama/c3d4e5f6-a7b8-9012-cdef-123456789012/",
    "createdAt": "2026-03-13T12:00:00.000Z"
  }
]
```

**Write pattern:** Same as `tunnels.json` — atomic with `fsync()`.

---

## `/etc/authelia/configuration.yml`

Authelia server configuration. Written during onboarding provisioning.

**Key fields:**

```yaml
server:
  host: 127.0.0.1
  port: 9091

log:
  level: info
  file_path: /var/log/authelia/authelia.log

jwt_secret: <random-secret>

authentication_backend:
  file:
    path: /etc/authelia/users.yml
    password:
      algorithm: bcrypt
      bcrypt:
        cost: 12

access_control:
  default_policy: one_factor

session:
  name: portlama_session
  secret: <random-secret>
  domain: example.com
  expiration: 12h
  inactivity: 2h

storage:
  encryption_key: <random-secret>
  local:
    path: /etc/authelia/db.sqlite3

notifier:
  filesystem:
    filename: /etc/authelia/notifications.txt

totp:
  issuer: Portlama
  period: 30
  digits: 6
```

**Critical settings:**

| Setting              | Value       | Why                                                          |
| -------------------- | ----------- | ------------------------------------------------------------ |
| `server.host`        | `127.0.0.1` | Never bind to `0.0.0.0` — nginx handles public access        |
| `password.algorithm` | `bcrypt`    | Argon2id uses ~93 MB per hash, causes OOM on 512 MB droplets |
| `bcrypt.cost`        | `12`        | Balance between security and performance                     |
| `session.domain`     | Your domain | Must match the domain in `panel.json`                        |

**Do not edit this file directly** unless you understand Authelia configuration. Changes require a service restart: `sudo systemctl restart authelia`.

---

## `/etc/authelia/users.yml`

The user database. Authelia reads this file live (no restart needed for user changes, but Portlama restarts Authelia after writes for safety).

**Format:**

```yaml
users:
  admin:
    displayname: admin
    password: $2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012
    email: admin@portlama.local
    groups:
      - admins
  alice:
    displayname: alice
    password: $2b$12$xyzdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012
    email: alice@portlama.local
    groups:
      - admins
```

**Password format:** bcrypt hash (starts with `$2b$12$`). Never use argon2id on a 512 MB droplet.

**Write pattern:** Atomic via temp file + `sudo mv`. After writing, Authelia is restarted.

**Warning:** Never delete the last user. The panel server prevents this, but manual editing could bypass the guard.

---

## `/etc/authelia/.secrets.json`

Stores the randomly generated secrets used in the Authelia configuration. Backed up here so they can be referenced if the configuration file is regenerated.

```json
{
  "jwtSecret": "<64-char-random-string>",
  "sessionSecret": "<64-char-random-string>",
  "storageEncryptionKey": "<64-char-random-string>"
}
```

**Mode:** 0600 (root only). If these values change, all active sessions are invalidated.

---

## nginx Vhost Patterns

### `/etc/nginx/sites-available/portlama-panel-ip`

The IP-based panel vhost. Created by the installer. Always active as a fallback.

```nginx
server {
    listen 9292 ssl;
    server_name _;

    ssl_certificate /etc/portlama/pki/self-signed.pem;
    ssl_certificate_key /etc/portlama/pki/self-signed-key.pem;

    include /etc/nginx/snippets/portlama-mtls.conf;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    error_page 495 496 /cert-help.html;
    location = /cert-help.html {
        root /opt/portlama/panel-client;
        internal;
    }

    proxy_set_header X-SSL-Client-Verify $ssl_client_verify;
    proxy_set_header X-SSL-Client-DN $ssl_client_s_dn;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    location / {
        proxy_pass http://127.0.0.1:3100;
    }

    location /api {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### `/etc/nginx/sites-available/portlama-panel-domain`

The domain-based panel vhost. Created during onboarding provisioning. Uses Let's Encrypt certificates and mTLS.

```nginx
server {
    listen 443 ssl;
    server_name panel.example.com;

    ssl_certificate /etc/letsencrypt/live/panel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;

    include /etc/nginx/snippets/portlama-mtls.conf;
    # ... (same proxy headers and locations as IP vhost)
}
```

### `/etc/nginx/sites-available/portlama-auth`

The Authelia authentication portal. Proxies to `127.0.0.1:9091`.

### `/etc/nginx/sites-available/portlama-tunnel`

The Chisel WebSocket tunnel endpoint. Proxies to `127.0.0.1:9090` with WebSocket upgrade and 24-hour timeout.

### `/etc/nginx/sites-available/portlama-app-<subdomain>`

Per-tunnel vhosts with Authelia forward authentication. Proxies to the tunnel's local port with WebSocket support.

### `/etc/nginx/sites-available/portlama-site-<uuid>`

Per-static-site vhosts. Serve files from `/var/www/portlama/<uuid>/` with optional Authelia protection and SPA mode.

---

## `/etc/nginx/snippets/portlama-mtls.conf`

The mTLS configuration snippet included by all panel vhosts:

```nginx
ssl_client_certificate /etc/portlama/pki/ca.crt;
ssl_verify_client on;
```

This enforces client certificate verification at the TLS level. Connections without a valid client certificate signed by the Portlama CA are rejected before any HTTP processing occurs.

---

## File Permissions Table

| Path                                    | Owner             | Mode | Notes                |
| --------------------------------------- | ----------------- | ---- | -------------------- |
| `/etc/portlama/`                        | portlama:portlama | 0755 | State directory      |
| `/etc/portlama/panel.json`              | portlama:portlama | 0640 | Panel config         |
| `/etc/portlama/tunnels.json`            | portlama:portlama | 0600 | Tunnel state         |
| `/etc/portlama/sites.json`              | portlama:portlama | 0600 | Site state           |
| `/etc/portlama/pki/`                    | portlama:portlama | 0700 | PKI directory        |
| `/etc/portlama/pki/ca.key`              | root:root         | 0600 | CA private key       |
| `/etc/portlama/pki/ca.crt`              | root:root         | 0644 | CA certificate       |
| `/etc/portlama/pki/client.key`          | root:root         | 0600 | Client private key   |
| `/etc/portlama/pki/client.crt`          | root:root         | 0644 | Client certificate   |
| `/etc/portlama/pki/client.p12`          | root:root         | 0600 | PKCS12 bundle        |
| `/etc/portlama/pki/.p12-password`       | root:root         | 0600 | PKCS12 password      |
| `/etc/portlama/pki/self-signed.pem`     | root:root         | 0644 | Self-signed TLS cert |
| `/etc/portlama/pki/self-signed-key.pem` | root:root         | 0600 | Self-signed TLS key  |
| `/etc/authelia/configuration.yml`       | root:root         | 0600 | Auth config          |
| `/etc/authelia/users.yml`               | root:root         | 0600 | User database        |
| `/etc/authelia/.secrets.json`           | root:root         | 0600 | Auth secrets         |
| `/etc/authelia/db.sqlite3`              | root:root         | 0600 | Auth session DB      |
| `/opt/portlama/`                        | portlama:portlama | 0755 | Install directory    |
| `/var/www/portlama/`                    | www-data:www-data | 0755 | Static site files    |
| `/etc/sudoers.d/portlama`               | root:root         | 0440 | Sudo rules           |

## Quick Reference

| Config File         | Read By      | Modified By                         | Restart Needed?                            |
| ------------------- | ------------ | ----------------------------------- | ------------------------------------------ |
| `panel.json`        | panel-server | panel-server (atomic write)         | No (hot reload)                            |
| `tunnels.json`      | panel-server | panel-server (atomic write + fsync) | No                                         |
| `sites.json`        | panel-server | panel-server (atomic write + fsync) | No                                         |
| `configuration.yml` | authelia     | onboarding provisioning             | Yes (`systemctl restart authelia`)         |
| `users.yml`         | authelia     | panel-server (via sudo)             | Yes (`systemctl restart authelia`)         |
| `portlama-*` vhosts | nginx        | panel-server (via sudo)             | Yes (`nginx -t && systemctl reload nginx`) |
