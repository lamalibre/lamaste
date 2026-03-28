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
| `/etc/portlama/ticket-scopes.json`       | JSON       | portlama:portlama | 0600 | Ticket scope registry         |
| `/etc/portlama/tickets.json`             | JSON       | portlama:portlama | 0600 | Ticket and session store      |
| `/etc/nginx/sites-available/portlama-*`  | nginx conf | root:root         | 0644 | Vhost configurations          |
| `/etc/nginx/snippets/portlama-mtls.conf` | nginx conf | root:root         | 0644 | mTLS snippet                  |
| `~/.portlama/servers.json`               | JSON       | user              | 0600 | Desktop app server registry   |
| `~/.portlama/agents.json`               | JSON       | user              | 0600 | Multi-agent registry          |
| `~/.portlama/agents/<label>/config.json` | JSON      | user              | 0600 | Per-agent configuration       |
| `~/.portlama/agents/<label>/client.p12`  | PKCS#12   | user              | 0600 | Per-agent mTLS certificate    |
| `~/.portlama/agents/<label>/ca.crt`      | PEM       | user              | 0644 | Per-agent CA certificate      |
| `~/.portlama/agents/<label>/logs/`       | directory | user              | 0700 | Per-agent Chisel log files    |
| `~/.portlama/agent.json`                | JSON       | user              | 0600 | Legacy single-server config   |

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
| `panel2fa`          | object         | No       | —               | Built-in TOTP 2FA configuration (see sub-fields below) |
| `panel2fa.enabled`  | boolean        | No       | `false`         | Whether 2FA is active for admin panel access          |
| `panel2fa.secret`   | string \| null | No       | `null`          | Base32-encoded TOTP secret                            |
| `panel2fa.setupComplete` | boolean   | No       | `false`         | Whether the 2FA setup flow has been confirmed         |
| `sessionSecret`     | string         | No       | —               | HMAC key for signing session cookies (auto-generated during 2FA setup) |
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

**Example (with 2FA enabled):**

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
  },
  "panel2fa": {
    "enabled": true,
    "secret": "JBSWY3DPEHPK3PXP...",
    "setupComplete": true
  },
  "sessionSecret": "a1b2c3d4..."
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

## `/etc/portlama/ticket-scopes.json`

Stores the ticket scope registry: registered scopes, active instances, and agent-to-instance assignments. Created automatically on first use.

**Schema:**

| Field         | Type  | Description                                              |
| ------------- | ----- | -------------------------------------------------------- |
| `scopes`      | array | Registered scope definitions (name, version, transport)  |
| `instances`   | array | Active instances (scope, instanceId, agentLabel, status) |
| `assignments` | array | Agent-to-instance assignments                            |

**Example:**

```json
{
  "scopes": [
    {
      "name": "shell",
      "version": "1.0.0",
      "description": "Remote shell access",
      "scopes": [{ "name": "shell:connect", "description": "Connect to shell", "instanceScoped": true }],
      "transport": { "strategies": ["tunnel"], "preferred": "tunnel", "port": 9000, "protocol": "wss" },
      "hooks": {},              // Reserved for future hook configuration
      "installedAt": "2026-03-26T10:00:00.000Z"
    }
  ],
  "instances": [
    {
      "scope": "shell:connect",
      "instanceId": "a7f3b2c9d1e2f3a4b5c6d7e8f9a0b1c2",
      "agentLabel": "macbook-pro",
      "registeredAt": "2026-03-26T10:05:00.000Z",
      "lastHeartbeat": "2026-03-26T10:15:30.000Z",
      "status": "active",
      "transport": { "strategies": ["tunnel"], "preferred": "tunnel" }
    }
  ],
  "assignments": [
    {
      "agentLabel": "linux-agent",
      "instanceScope": "shell:connect:a7f3b2c9d1e2f3a4b5c6d7e8f9a0b1c2",
      "assignedAt": "2026-03-26T10:10:00.000Z",
      "assignedBy": "admin"
    }
  ]
}
```

**Instance transport sub-schema:**

The instance `transport` object may include a `direct` sub-object when the `direct` strategy is listed:

| Field                      | Type     | Required | Description                                                     |
| -------------------------- | -------- | -------- | --------------------------------------------------------------- |
| `transport.strategies`     | string[] | Yes      | Array of `"tunnel"`, `"relay"`, `"direct"`                      |
| `transport.preferred`      | string   | No       | Preferred strategy (must be in `strategies`)                    |
| `transport.direct`         | object   | No       | Direct connection details (required when using `direct` strategy) |
| `transport.direct.host`    | string   | Yes*     | Public hostname or IP (1-255 chars). Private/reserved IPs rejected (SSRF prevention) |
| `transport.direct.port`    | number   | Yes*     | Port number (1024-65535)                                        |

\* Required when `transport.direct` is provided.

**Host validation:** The `transport.direct.host` field rejects private and reserved addresses: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, loopback (`localhost`, `127.0.0.1`, `::1`), cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`), and the zero network (`0.0.0.0/8`).

**Write pattern:** Atomic — temp file, `fsync()`, `rename()`. Concurrency controlled by promise-chain mutex.

---

## `/etc/portlama/tickets.json`

Stores active tickets and sessions for agent-to-agent authorization. Created automatically on first use.

**Schema:**

| Field      | Type  | Description                                                    |
| ---------- | ----- | -------------------------------------------------------------- |
| `tickets`  | array | Issued tickets (id, scope, instanceId, source, target, expiry) |
| `sessions` | array | Active sessions (server-generated sessionId, ticketId, status, heartbeat) |

**Example:**

```json
{
  "tickets": [
    {
      "id": "64-hex-char-ticket-id",
      "scope": "shell:connect",
      "instanceId": "a7f3b2c9d1e2f3a4b5c6d7e8f9a0b1c2",
      "source": "macbook-pro",
      "target": "linux-agent",
      "createdAt": "2026-03-26T10:15:00.000Z",
      "expiresAt": "2026-03-26T10:15:30.000Z",
      "used": false,
      "usedAt": null,
      "sessionId": null,
      "transport": {}
    }
  ],
  "sessions": [
    {
      "sessionId": "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8",
      "ticketId": "64-hex-char-ticket-id",
      "scope": "shell:connect",
      "instanceId": "a7f3b2c9d1e2f3a4b5c6d7e8f9a0b1c2",
      "source": "macbook-pro",
      "target": "linux-agent",
      "createdAt": "2026-03-26T10:15:30.000Z",
      "lastActivityAt": "2026-03-26T10:20:00.000Z",
      "status": "active",
      "reconnectGraceSeconds": 60
    }
  ]
}
```

**Write pattern:** Same as `ticket-scopes.json` — atomic with mutex.

**Cleanup:** Tickets older than 1 hour are removed. Dead sessions older than 24 hours are removed.

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

## Client-Side Configuration

### `~/.portlama/servers.json`

Stores the server registry for the desktop app's multi-server support. Created by cloud provisioning or manual server addition. When this file exists and contains an active entry, `load_effective_config()` uses it instead of `agent.json`.

**Schema:** Array of server entry objects.

| Field              | Type           | Description                                          |
| ------------------ | -------------- | ---------------------------------------------------- |
| `id`               | string         | UUID                                                 |
| `label`            | string         | Display name (typically the domain)                  |
| `panelUrl`         | string         | Panel URL (e.g., `https://203.0.113.42:9292`)        |
| `ip`               | string         | Server IP address                                    |
| `provider`         | string \| null | Cloud provider name (e.g., `digitalocean`)           |
| `providerId`       | string \| null | Provider-specific resource ID (e.g., droplet ID)     |
| `region`           | string \| null | Provider region slug                                 |
| `createdAt`        | string         | ISO 8601 timestamp                                   |
| `active`           | boolean        | Whether this is the currently active server          |
| `authMethod`       | string         | `"p12"` or `"keychain"`                              |
| `keychainIdentity` | string \| null | Keychain identity name (when `authMethod` is `"keychain"`) |
| `p12Path`          | string \| null | Path to P12 file (when `authMethod` is `"p12"`)      |
| `activeMode`       | string         | `"agent"` or `"admin"` — which UI mode the desktop app shows for this server. Defaults to `"agent"` |
| `adminAuth`        | object \| null | Admin certificate details for Server mode access (see sub-fields below) |
| `adminAuth.method` | string         | `"p12"` or `"keychain"` — how the admin cert is stored |
| `adminAuth.p12Path` | string \| null | Path to admin P12 file (when method is `"p12"`)     |
| `adminAuth.keychainIdentity` | string \| null | Keychain identity for admin cert (when method is `"keychain"`) |

**Example:**

```json
[
  {
    "id": "d4e5f6a7-b8c9-0123-defg-456789012345",
    "label": "example.com",
    "panelUrl": "https://203.0.113.42:9292",
    "ip": "203.0.113.42",
    "provider": "digitalocean",
    "providerId": "123456789",
    "region": "fra1",
    "createdAt": "2026-03-27T10:00:00.000Z",
    "active": true,
    "authMethod": "p12",
    "p12Path": "/Users/admin/.portlama/servers/d4e5f6a7/client.p12",
    "keychainIdentity": null,
    "activeMode": "admin",
    "adminAuth": {
      "method": "p12",
      "p12Path": "/Users/admin/.portlama/servers/d4e5f6a7/admin.p12",
      "keychainIdentity": null
    }
  }
]
```

**Notes on `adminAuth`:** When `adminAuth` is present and valid, the desktop app shows the Agents/Servers mode toggle in the sidebar. Cloud-provisioned servers populate `adminAuth` automatically (the admin certificate is downloaded during provisioning). For manually added servers, the user must import an admin certificate to enable Server mode.

**P12 password:** Not stored in the JSON file. Retrieved from the OS credential store (`com.portlama.server` service, keyed by server UUID).

**Cloud API token:** Not stored in this file. Retrieved from the OS credential store (`com.portlama.cloud` service).

**Write pattern:** Atomic — temp file with mode 0600, `fsync()`, then `rename()`.

**Config resolution:** `load_effective_config()` checks `agents.json` first (multi-agent registry), then `servers.json` (active entry), then falls back to `agent.json` (legacy).

---

### `~/.portlama/agents.json`

Multi-agent registry. Created by `portlama-agent setup`. Tracks all configured agents and the current default.

```json
{
  "version": 1,
  "currentLabel": "my-server",
  "agents": [
    {
      "label": "my-server",
      "panelUrl": "https://1.2.3.4:9292",
      "authMethod": "p12",
      "p12Path": "~/.portlama/agents/my-server/client.p12",
      "keychainIdentity": null,
      "agentLabel": "agent:my-machine",
      "domain": "example.com",
      "chiselVersion": "1.10.1",
      "setupAt": "2026-03-28T10:00:00.000Z",
      "updatedAt": null
    }
  ]
}
```

**Write pattern:** Atomic — temp file with mode 0600, `fsync()`, then `rename()`.

Per-agent data is stored at `~/.portlama/agents/<label>/`:
- `config.json` — agent configuration (panelUrl, authMethod, credentials)
- `client.p12` — mTLS certificate (mode 0600)
- `ca.crt` — CA certificate (mode 0644)
- `logs/chisel.log` — Chisel stdout log
- `logs/chisel.error.log` — Chisel stderr log
- `plugins.json` — agent plugin registry
- `plugins/` — per-plugin data directories

Service files use per-agent names:
- macOS: `com.portlama.chisel-<label>` (plist label), `~/Library/LaunchAgents/com.portlama.chisel-<label>.plist`
- Linux: `portlama-chisel-<label>` (unit name), `/etc/systemd/system/portlama-chisel-<label>.service`

---

### `~/.portlama/agent.json`

Legacy single-server configuration. Automatically migrated to the multi-agent registry on first use. After migration, renamed to `agent.json.backup`.

---

## nginx Vhost Patterns

### `/etc/nginx/sites-available/portlama-panel-ip`

The IP-based panel vhost. Created by the installer. Active as a fallback unless panel 2FA is enabled, which disables it (domain-only access).

```nginx
# Rate limit zone for public enrollment endpoint (5 requests/minute per IP)
limit_req_zone $binary_remote_addr zone=enroll:1m rate=5r/m;

map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

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

    # Protected locations — reject if client cert missing or invalid
    location / {
        if ($ssl_client_verify != SUCCESS) {
            return 496;
        }
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header X-SSL-Client-Verify $ssl_client_verify;
        proxy_set_header X-SSL-Client-DN $ssl_client_s_dn;
        proxy_set_header X-SSL-Client-Serial $ssl_client_serial;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Public API paths — no mTLS check, cert headers cleared
    location /api/enroll {
        limit_req zone=enroll burst=5 nodelay;
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header X-SSL-Client-Verify "";
        proxy_set_header X-SSL-Client-DN "";
        proxy_set_header X-SSL-Client-Serial "";
        # ... standard proxy headers
    }

    location /api/invite {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header X-SSL-Client-Verify "";
        proxy_set_header X-SSL-Client-DN "";
        proxy_set_header X-SSL-Client-Serial "";
        # ... standard proxy headers
    }

    # API paths with WebSocket upgrade support (mTLS required)
    location /api {
        if ($ssl_client_verify != SUCCESS) {
            return 496;
        }
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header X-SSL-Client-Verify $ssl_client_verify;
        proxy_set_header X-SSL-Client-DN $ssl_client_s_dn;
        proxy_set_header X-SSL-Client-Serial $ssl_client_serial;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
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
ssl_verify_client optional;
```

This enables client certificate verification at the TLS level. The `optional` setting allows connections without a certificate (needed for public endpoints like `/api/enroll` and `/api/invite`). Protected locations enforce mTLS via `if ($ssl_client_verify != SUCCESS) { return 496; }` in each vhost's location blocks.

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
| `/etc/portlama/ticket-scopes.json`     | portlama:portlama | 0600 | Ticket scope registry |
| `/etc/portlama/tickets.json`           | portlama:portlama | 0600 | Ticket/session store  |
| `/etc/authelia/configuration.yml`       | root:root         | 0600 | Auth config          |
| `/etc/authelia/users.yml`               | root:root         | 0600 | User database        |
| `/etc/authelia/.secrets.json`           | root:root         | 0600 | Auth secrets         |
| `/etc/authelia/db.sqlite3`              | root:root         | 0600 | Auth session DB      |
| `/opt/portlama/`                        | portlama:portlama | 0755 | Install directory    |
| `/var/www/portlama/`                    | www-data:www-data | 0755 | Static site files    |
| `/etc/sudoers.d/portlama`               | root:root         | 0440 | Sudo rules           |
| `~/.portlama/servers.json`              | user              | 0600 | Server registry      |
| `~/.portlama/agent.json`               | user              | 0600 | Legacy agent config  |
| `~/.portlama/services.json`            | user              | 0600 | Service registry     |

## Quick Reference

| Config File         | Read By      | Modified By                         | Restart Needed?                            |
| ------------------- | ------------ | ----------------------------------- | ------------------------------------------ |
| `panel.json`        | panel-server | panel-server (atomic write)         | No (hot reload)                            |
| `tunnels.json`      | panel-server | panel-server (atomic write + fsync) | No                                         |
| `sites.json`        | panel-server | panel-server (atomic write + fsync) | No                                         |
| `ticket-scopes.json` | panel-server | panel-server (atomic write + mutex) | No                                        |
| `tickets.json`      | panel-server | panel-server (atomic write + mutex) | No                                         |
| `configuration.yml` | authelia     | onboarding provisioning             | Yes (`systemctl restart authelia`)         |
| `users.yml`         | authelia     | panel-server (via sudo)             | Yes (`systemctl restart authelia`)         |
| `portlama-*` vhosts | nginx        | panel-server (via sudo)             | Yes (`nginx -t && systemctl reload nginx`) |
