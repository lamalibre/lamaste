# Config Files

> Complete reference for every configuration and state file Lamaste uses.

## File Overview

| File                                     | Format     | Owner             | Mode | Purpose                       |
| ---------------------------------------- | ---------- | ----------------- | ---- | ----------------------------- |
| `/etc/lamalibre/lamaste/panel.json`               | JSON       | lamaste:lamaste | 0600 | Panel server configuration    |
| `/etc/lamalibre/lamaste/tunnels.json`             | JSON       | lamaste:lamaste | 0600 | Tunnel definitions            |
| `/etc/lamalibre/lamaste/sites.json`               | JSON       | lamaste:lamaste | 0600 | Static site definitions       |
| `/etc/authelia/configuration.yml`        | YAML       | root:root         | 0600 | Authelia server configuration |
| `/etc/authelia/users.yml`                | YAML       | root:root         | 0600 | User database                 |
| `/etc/authelia/.secrets.json`            | JSON       | root:root         | 0600 | Authelia secrets              |
| `/etc/lamalibre/lamaste/ticket-scopes.json`       | JSON       | lamaste:lamaste | 0600 | Ticket scope registry         |
| `/etc/lamalibre/lamaste/tickets.json`             | JSON       | lamaste:lamaste | 0600 | Ticket and session store      |
| `/etc/lamalibre/lamaste/invitations.json`         | JSON       | lamaste:lamaste | 0600 | Pending user invitations                                                        |
| `/etc/lamalibre/lamaste/plugins.json`             | JSON       | lamaste:lamaste | 0600 | Plugin registry                                                                 |
| `/etc/lamalibre/lamaste/storage-config.json`      | JSON       | lamaste:lamaste | 0600 | Storage server registry and plugin bindings (credentials AES-256-GCM encrypted) |
| `/etc/lamalibre/lamaste/storage-master.key`       | Binary     | lamaste:lamaste | 0600 | 32-byte master key for storage credential encryption |
| `/etc/lamalibre/lamaste/groups.json`              | JSON       | lamaste:lamaste | 0600 | Lamaste group definitions and membership |
| `/etc/lamalibre/lamaste/access-grants.json`       | JSON       | lamaste:lamaste | 0600 | Generic access grants (principal → resource) |
| `/etc/lamalibre/lamaste/gatekeeper.json`          | JSON       | lamaste:lamaste | 0600 | Gatekeeper settings (cache TTL, admin contact, logging) |
| `/etc/lamalibre/lamaste/access-request-log.json`  | JSON       | lamaste:lamaste | 0600 | Optional denied access log |
| `/etc/lamalibre/lamaste/pki/enrollment-tokens.json` | JSON     | lamaste:lamaste | 0600 | One-time enrollment tokens for hardware-bound enrollment |
| `/etc/lamalibre/lamaste/pki/revoked.json`         | JSON       | lamaste:lamaste | 0600 | Revoked certificate serial numbers |
| `/etc/lamalibre/lamaste/pki/agents/registry.json` | JSON       | lamaste:lamaste | 0600 | Agent certificate metadata |
| `/etc/nginx/sites-available/lamaste-*`  | nginx conf | root:root         | 0644 | Vhost configurations          |
| `/etc/nginx/snippets/lamalibre-lamaste-mtls.conf` | nginx conf | root:root         | 0644 | mTLS snippet                  |
| `/etc/nginx/snippets/lamalibre-lamaste-authz-cache.conf` | nginx conf | root:root | 0644 | Gatekeeper proxy_cache zone   |
| `/etc/systemd/system/lamalibre-lamaste-gatekeeper.service` | systemd | root:root | 0644 | Gatekeeper systemd unit       |
| `~/.lamalibre/lamaste/servers.json`               | JSON       | user              | 0600 | Desktop app server registry   |
| `~/.lamalibre/lamaste/agents.json`               | JSON       | user              | 0600 | Multi-agent registry          |
| `~/.lamalibre/lamaste/agents/<label>/config.json` | JSON      | user              | 0600 | Per-agent configuration       |
| `~/.lamalibre/lamaste/agents/<label>/client.p12`  | PKCS#12   | user              | 0600 | Per-agent mTLS certificate    |
| `~/.lamalibre/lamaste/agents/<label>/ca.crt`      | PEM       | user              | 0644 | Per-agent CA certificate      |
| `~/.lamalibre/lamaste/agents/<label>/logs/`       | directory | user              | 0700 | Per-agent Chisel log files    |
| `~/.lamalibre/lamaste/agent.json`                | JSON       | user              | 0600 | Legacy single-server config   |

---

## `/etc/lamalibre/lamaste/panel.json`

The primary configuration file for the panel server. Created by the installer, updated during onboarding and tunnel management.

**Schema:**

| Field               | Type           | Required | Default         | Description                                           |
| ------------------- | -------------- | -------- | --------------- | ----------------------------------------------------- |
| `ip`                | string         | Yes      | —               | Server public IP address                              |
| `domain`            | string \| null | Yes      | `null`          | Base domain (set during onboarding)                   |
| `serverId`          | string         | No       | —               | Auto-generated UUIDv4, used as bucket prefix for multi-server storage isolation |
| `email`             | string \| null | Yes      | `null`          | Admin email for Let's Encrypt (set during onboarding) |
| `dataDir`           | string         | Yes      | `/etc/lamalibre/lamaste` | Path to data/state directory                          |
| `staticDir`         | string         | No       | —               | Path to lamaste-server-ui dist directory                   |
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
  "dataDir": "/etc/lamalibre/lamaste",
  "staticDir": "/opt/lamalibre/lamaste/lamaste-server-ui/dist",
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
  "dataDir": "/etc/lamalibre/lamaste",
  "staticDir": "/opt/lamalibre/lamaste/lamaste-server-ui/dist",
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
  "dataDir": "/etc/lamalibre/lamaste",
  "staticDir": "/opt/lamalibre/lamaste/lamaste-server-ui/dist",
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

1. `LAMALIBRE_LAMASTE_CONFIG` environment variable (if set)
2. In development (`NODE_ENV=development` or `NODE_ENV` unset): `<package-root>/dev/panel.json`
3. In production (`NODE_ENV=production`): `/etc/lamalibre/lamaste/panel.json`

> **Note:** The systemd service unit sets `CONFIG_FILE` in the environment, but the panel server code reads `LAMALIBRE_LAMASTE_CONFIG`. The systemd variable `CONFIG_FILE` is not used by the application. In production deployments this has no effect because the code falls back to `/etc/lamalibre/lamaste/panel.json` when `LAMALIBRE_LAMASTE_CONFIG` is unset and `NODE_ENV=production`.

**Write pattern:** Atomic — writes to `.tmp` file then `rename()`.

**Validated with:** Zod schema in `packages/lamaste-serverd/src/lib/config.js`.

---

## `/etc/lamalibre/lamaste/tunnels.json`

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
| `accessMode`  | string \| undefined | `"public"`, `"authenticated"`, or `"restricted"`. Controls whether nginx skips auth, requires Authelia login only, or requires Authelia login plus a Gatekeeper grant. Absent for panel tunnels. |
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

**State directory:** Configurable via `LAMALIBRE_LAMASTE_STATE_DIR` environment variable, defaults to `/etc/lamalibre/lamaste`.

---

## `/etc/lamalibre/lamaste/sites.json`

Stores the array of static sites hosted through Lamaste.

**Schema:** Array of site objects.

| Field               | Type    | Description                                      |
| ------------------- | ------- | ------------------------------------------------ |
| `id`                | string  | UUID                                             |
| `fqdn`              | string  | Full domain (e.g., `blog.example.com`)           |
| `spaMode`           | boolean | If true, `try_files` falls back to `/index.html` |
| `autheliaProtected` | boolean | If true, requires Authelia authentication        |
| `rootPath`          | string  | Document root (e.g., `/var/www/lamaste/<id>/`)  |
| `createdAt`         | string  | ISO 8601 timestamp                               |

**Example:**

```json
[
  {
    "id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
    "fqdn": "blog.example.com",
    "spaMode": false,
    "autheliaProtected": false,
    "rootPath": "/var/www/lamaste/c3d4e5f6-a7b8-9012-cdef-123456789012/",
    "createdAt": "2026-03-13T12:00:00.000Z"
  }
]
```

**Write pattern:** Same as `tunnels.json` — atomic with `fsync()`.

---

## `/etc/lamalibre/lamaste/ticket-scopes.json`

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

## `/etc/lamalibre/lamaste/tickets.json`

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

## `/etc/lamalibre/lamaste/groups.json`

Stores Lamaste group definitions and membership. Separate from Authelia groups — Lamaste groups are used exclusively for Gatekeeper access control without modifying `users.yml`.

**Schema:**

| Field                  | Type     | Description                                  |
| ---------------------- | -------- | -------------------------------------------- |
| `groups`               | array    | Array of group objects                       |
| `groups[].name`        | string   | Group name (unique, lowercase alphanumeric, 2-63 chars)  |
| `groups[].description` | string   | Human-readable description                   |
| `groups[].members`     | string[] | Array of Authelia usernames                  |
| `groups[].createdAt`   | string   | ISO 8601 timestamp                           |
| `groups[].createdBy`   | string   | Admin who created the group                  |

**Example:**

```json
{
  "groups": [
    {
      "name": "developers",
      "description": "Backend and frontend developers",
      "members": ["alice", "bob"],
      "createdAt": "2026-04-01T10:00:00.000Z",
      "createdBy": "admin"
    }
  ]
}
```

**Write pattern:** Atomic — temp file, `fsync()`, `rename()`. Concurrency controlled by promise-chain mutex.

---

## `/etc/lamalibre/lamaste/access-grants.json`

Stores generic access grants mapping principals (users or groups) to resources (tunnel subdomains or other protected endpoints).

**Schema:**

| Field                    | Type           | Description                                              |
| ------------------------ | -------------- | -------------------------------------------------------- |
| `grants`                 | array          | Array of grant objects                                   |
| `grants[].grantId`       | string         | Unique identifier (e.g., `g_abc123`)                    |
| `grants[].principalType` | string         | `"user"` or `"group"`                                   |
| `grants[].principalId`   | string         | Authelia username or Lamaste group name                |
| `grants[].resourceType`  | string         | `"tunnel"`, `"plugin"`, or custom resource type         |
| `grants[].resourceId`    | string         | Resource identifier (e.g., tunnel subdomain)            |
| `grants[].context`       | object         | Optional metadata (empty `{}` by default)               |
| `grants[].used`          | boolean        | Whether the grant has been consumed                     |
| `grants[].createdAt`     | string         | ISO 8601 timestamp                                      |
| `grants[].usedAt`        | string \| null | ISO 8601 timestamp of consumption, or `null`            |

**Example:**

```json
{
  "grants": [
    {
      "grantId": "g_b2c3d4e5",
      "principalType": "user",
      "principalId": "alice",
      "resourceType": "tunnel",
      "resourceId": "myapp",
      "context": {},
      "used": false,
      "createdAt": "2026-04-01T10:05:00.000Z",
      "usedAt": null
    },
    {
      "grantId": "g_c3d4e5f6",
      "principalType": "group",
      "principalId": "developers",
      "resourceType": "tunnel",
      "resourceId": "staging",
      "context": {},
      "used": false,
      "createdAt": "2026-04-01T10:10:00.000Z",
      "usedAt": null
    }
  ]
}
```

**Write pattern:** Atomic — temp file, `fsync()`, `rename()`. Concurrency controlled by promise-chain mutex.

---

## `/etc/lamalibre/lamaste/gatekeeper.json`

Gatekeeper service settings. Controls cache behavior, admin contact information (displayed on the access-denied page), and logging configuration.

**Schema:**

| Field                     | Type             | Default | Description                                         |
| ------------------------- | ---------------- | ------- | --------------------------------------------------- |
| `adminEmail`              | string \| undefined | —    | Admin email shown on access-denied page             |
| `adminName`               | string \| undefined | —    | Admin display name shown on access-denied page      |
| `slackChannel`            | string \| undefined | —    | Slack channel for access request templates          |
| `teamsChannel`            | string \| undefined | —    | Teams channel for access request templates          |
| `sessionCacheTtlMs`       | number \| undefined | —    | In-memory session cache TTL in milliseconds (default 30000) |
| `accessLoggingEnabled`    | boolean \| undefined | —   | Whether to log denied access attempts               |
| `accessLogRetentionDays`  | number \| undefined | —    | How many days to retain access log entries           |

**Example:**

```json
{
  "adminEmail": "admin@example.com",
  "adminName": "Admin",
  "slackChannel": "#access-requests",
  "sessionCacheTtlMs": 30000,
  "accessLoggingEnabled": true,
  "accessLogRetentionDays": 90
}
```

**Write pattern:** Atomic — temp file, `fsync()`, `rename()`.

---

## `/etc/lamalibre/lamaste/access-request-log.json`

Optional log of denied access attempts. Written by the Gatekeeper when `accessLoggingEnabled` is true. Read by the Panel Server for the admin UI access request review page.

**Schema:** Array of access request entries.

| Field          | Type   | Description                                           |
| -------------- | ------ | ----------------------------------------------------- |
| `timestamp`    | string | ISO 8601 timestamp of the denied request              |
| `username`     | string | Authelia username of the denied user                  |
| `resourceType` | string | Resource type (e.g., `"tunnel"`, `"plugin"`)          |
| `resourceId`   | string | Resource identifier (e.g., tunnel subdomain)          |
| `resourceFqdn` | string | Full domain the user attempted to access              |

**Example:**

```json
[
  {
    "timestamp": "2026-04-01T14:30:00.000Z",
    "username": "charlie",
    "resourceType": "tunnel",
    "resourceId": "internal",
    "resourceFqdn": "internal.example.com"
  }
]
```

**Write pattern:** Atomic — temp file, `fsync()`, `rename()`.

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
  name: lamaste_session
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
  issuer: Lamaste
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

The user database. Authelia reads this file live (no restart needed for user changes, but Lamaste restarts Authelia after writes for safety).

**Format:**

```yaml
users:
  admin:
    displayname: admin
    password: $2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012
    email: admin@lamaste.local
    groups:
      - admins
  alice:
    displayname: alice
    password: $2b$12$xyzdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012
    email: alice@lamaste.local
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

### `~/.lamalibre/lamaste/servers.json`

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
    "p12Path": "/Users/admin/.lamaste/servers/d4e5f6a7/client.p12",
    "keychainIdentity": null,
    "activeMode": "admin",
    "adminAuth": {
      "method": "p12",
      "p12Path": "/Users/admin/.lamaste/servers/d4e5f6a7/admin.p12",
      "keychainIdentity": null
    }
  }
]
```

**Notes on `adminAuth`:** When `adminAuth` is present and valid, the desktop app shows the Agents/Servers mode toggle in the sidebar. Cloud-provisioned servers populate `adminAuth` automatically (the admin certificate is downloaded during provisioning). For manually added servers, the user must import an admin certificate to enable Server mode.

**P12 password:** Not stored in the JSON file. Retrieved from the OS credential store (`com.lamalibre.lamaste.server` service, keyed by server UUID).

**Cloud API token:** Not stored in this file. Retrieved from the OS credential store (`com.lamalibre.cloud` service).

**Write pattern:** Atomic — temp file with mode 0600, `fsync()`, then `rename()`.

**Config resolution:** `load_effective_config()` checks `agents.json` first (multi-agent registry), then `servers.json` (active entry), then falls back to `agent.json` (legacy).

---

### `~/.lamalibre/lamaste/agents.json`

Multi-agent registry. Created by `lamaste-agent setup`. Tracks all configured agents and the current default.

```json
{
  "version": 1,
  "currentLabel": "my-server",
  "agents": [
    {
      "label": "my-server",
      "panelUrl": "https://1.2.3.4:9292",
      "authMethod": "p12",
      "p12Path": "~/.lamalibre/lamaste/agents/my-server/client.p12",
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

Per-agent data is stored at `~/.lamalibre/lamaste/agents/<label>/`:
- `config.json` — agent configuration (panelUrl, authMethod, credentials)
- `client.p12` — mTLS certificate (mode 0600)
- `ca.crt` — CA certificate (mode 0644)
- `logs/chisel.log` — Chisel stdout log
- `logs/chisel.error.log` — Chisel stderr log
- `plugins.json` — agent plugin registry
- `plugins/` — per-plugin data directories

Service files use per-agent names:
- macOS: `com.lamalibre.lamaste.chisel-<label>` (plist label), `~/Library/LaunchAgents/com.lamalibre.lamaste.chisel-<label>.plist`
- Linux: `lamalibre-lamaste-chisel-<label>` (unit name), `~/.config/systemd/user/lamalibre-lamaste-chisel-<label>.service`

---

### `~/.lamalibre/lamaste/agent.json`

Legacy single-server configuration. Automatically migrated to the multi-agent registry on first use. After migration, renamed to `agent.json.backup`.

---

## nginx Vhost Patterns

### `/etc/nginx/sites-available/lamalibre-lamaste-panel-ip`

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

    ssl_certificate /etc/lamalibre/lamaste/pki/self-signed.pem;
    ssl_certificate_key /etc/lamalibre/lamaste/pki/self-signed-key.pem;

    include /etc/nginx/snippets/lamalibre-lamaste-mtls.conf;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    error_page 495 496 /cert-help.html;
    location = /cert-help.html {
        root /opt/lamalibre/lamaste/lamaste-server-ui;
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

### `/etc/nginx/sites-available/lamalibre-lamaste-panel-domain`

The domain-based panel vhost. Created during onboarding provisioning. Uses Let's Encrypt certificates and mTLS.

```nginx
server {
    listen 443 ssl;
    server_name panel.example.com;

    ssl_certificate /etc/letsencrypt/live/panel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;

    include /etc/nginx/snippets/lamalibre-lamaste-mtls.conf;
    # ... (same proxy headers and locations as IP vhost)
}
```

### `/etc/nginx/sites-available/lamalibre-lamaste-auth`

The Authelia authentication portal. Proxies to `127.0.0.1:9091`.

### `/etc/nginx/sites-available/lamalibre-lamaste-tunnel`

The Chisel WebSocket tunnel endpoint. Proxies to `127.0.0.1:9090` with WebSocket upgrade and 24-hour timeout.

### `/etc/nginx/sites-available/lamalibre-lamaste-app-<subdomain>`

Per-tunnel vhosts with Authelia forward authentication. Proxies to the tunnel's local port with WebSocket support.

### `/etc/nginx/sites-available/lamalibre-lamaste-site-<uuid>`

Per-static-site vhosts. Serve files from `/var/www/lamaste/<uuid>/` with optional Authelia protection and SPA mode.

---

## `/etc/nginx/snippets/lamalibre-lamaste-mtls.conf`

The mTLS configuration snippet included by all panel vhosts:

```nginx
ssl_client_certificate /etc/lamalibre/lamaste/pki/ca.crt;
ssl_verify_client optional;
```

This enables client certificate verification at the TLS level. The `optional` setting allows connections without a certificate (needed for public endpoints like `/api/enroll` and `/api/invite`). Protected locations enforce mTLS via `if ($ssl_client_verify != SUCCESS) { return 496; }` in each vhost's location blocks.

---

## `/etc/nginx/snippets/lamalibre-lamaste-authz-cache.conf`

Defines the nginx proxy_cache zone installed by the Gatekeeper installer task:

```nginx
proxy_cache_path /var/cache/nginx/authz levels=1:2 keys_zone=lamaste_authz:1m max_size=10m inactive=5m;
```

This cache zone is available for nginx-level caching of Gatekeeper authorization responses. However, the generated vhosts (`buildGatekeeperVhost()`) do not currently include `proxy_cache` directives. Authorization caching relies on the Gatekeeper's in-memory session cache (30-second default TTL).

---

## `/etc/systemd/system/lamalibre-lamaste-gatekeeper.service`

Systemd unit for the Gatekeeper tunnel authorization service. Runs as the `lamaste` user on `127.0.0.1:9294`.

```ini
[Unit]
Description=Lamaste Gatekeeper
After=network.target

[Service]
Type=simple
User=lamaste
Group=lamaste
WorkingDirectory=/opt/lamalibre/lamaste/gatekeeper
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

---

## File Permissions Table

| Path                                    | Owner             | Mode | Notes                |
| --------------------------------------- | ----------------- | ---- | -------------------- |
| `/etc/lamalibre/lamaste/`                        | lamaste:lamaste | 0755 | State directory      |
| `/etc/lamalibre/lamaste/panel.json`              | lamaste:lamaste | 0600 | Panel config         |
| `/etc/lamalibre/lamaste/tunnels.json`            | lamaste:lamaste | 0600 | Tunnel state         |
| `/etc/lamalibre/lamaste/sites.json`              | lamaste:lamaste | 0600 | Site state           |
| `/etc/lamalibre/lamaste/pki/`                    | lamaste:lamaste | 0700 | PKI directory        |
| `/etc/lamalibre/lamaste/pki/ca.key`              | root:root         | 0600 | CA private key       |
| `/etc/lamalibre/lamaste/pki/ca.crt`              | root:root         | 0644 | CA certificate       |
| `/etc/lamalibre/lamaste/pki/client.key`          | root:root         | 0600 | Client private key   |
| `/etc/lamalibre/lamaste/pki/client.crt`          | root:root         | 0644 | Client certificate   |
| `/etc/lamalibre/lamaste/pki/client.p12`          | root:root         | 0600 | PKCS12 bundle        |
| `/etc/lamalibre/lamaste/pki/.p12-password`       | root:root         | 0600 | PKCS12 password      |
| `/etc/lamalibre/lamaste/pki/self-signed.pem`     | root:root         | 0644 | Self-signed TLS cert |
| `/etc/lamalibre/lamaste/pki/self-signed-key.pem` | root:root         | 0600 | Self-signed TLS key  |
| `/etc/lamalibre/lamaste/ticket-scopes.json`     | lamaste:lamaste | 0600 | Ticket scope registry |
| `/etc/lamalibre/lamaste/tickets.json`           | lamaste:lamaste | 0600 | Ticket/session store  |
| `/etc/lamalibre/lamaste/invitations.json`       | lamaste:lamaste | 0600 | Pending invitations    |
| `/etc/lamalibre/lamaste/plugins.json`           | lamaste:lamaste | 0600 | Plugin registry        |
| `/etc/lamalibre/lamaste/storage-config.json`    | lamaste:lamaste | 0600 | Storage registry       |
| `/etc/lamalibre/lamaste/storage-master.key`     | lamaste:lamaste | 0600 | Storage encryption key |
| `/etc/lamalibre/lamaste/groups.json`            | lamaste:lamaste | 0600 | Lamaste groups        |
| `/etc/lamalibre/lamaste/access-grants.json`     | lamaste:lamaste | 0600 | Access grants          |
| `/etc/lamalibre/lamaste/gatekeeper.json`        | lamaste:lamaste | 0600 | Gatekeeper settings    |
| `/etc/lamalibre/lamaste/access-request-log.json` | lamaste:lamaste | 0600 | Denied access log     |
| `/etc/lamalibre/lamaste/pki/enrollment-tokens.json` | lamaste:lamaste | 0600 | Enrollment tokens  |
| `/etc/lamalibre/lamaste/pki/revoked.json`       | lamaste:lamaste | 0600 | Revocation list        |
| `/etc/lamalibre/lamaste/pki/agents/registry.json` | lamaste:lamaste | 0600 | Agent cert metadata  |
| `/etc/authelia/configuration.yml`       | root:root         | 0600 | Auth config          |
| `/etc/authelia/users.yml`               | root:root         | 0600 | User database        |
| `/etc/authelia/.secrets.json`           | root:root         | 0600 | Auth secrets         |
| `/etc/authelia/db.sqlite3`              | root:root         | 0600 | Auth session DB      |
| `/opt/lamalibre/lamaste/`                        | lamaste:lamaste | 0755 | Install directory    |
| `/var/www/lamaste/`                    | www-data:www-data | 0755 | Static site files    |
| `/etc/sudoers.d/lamaste`               | root:root         | 0440 | Sudo rules           |
| `~/.lamalibre/lamaste/servers.json`              | user              | 0600 | Server registry      |
| `~/.lamalibre/lamaste/agent.json`               | user              | 0600 | Legacy agent config  |
| `~/.lamalibre/lamaste/services.json`            | user              | 0600 | Service registry     |

## Quick Reference

| Config File         | Read By      | Modified By                         | Restart Needed?                            |
| ------------------- | ------------ | ----------------------------------- | ------------------------------------------ |
| `panel.json`        | lamalibre-lamaste-serverd | lamalibre-lamaste-serverd (atomic write)         | No (hot reload)                            |
| `tunnels.json`      | lamalibre-lamaste-serverd | lamalibre-lamaste-serverd (atomic write + fsync) | No                                         |
| `sites.json`        | lamalibre-lamaste-serverd | lamalibre-lamaste-serverd (atomic write + fsync) | No                                         |
| `ticket-scopes.json` | lamalibre-lamaste-serverd | lamalibre-lamaste-serverd (atomic write + mutex) | No                                        |
| `tickets.json`      | lamalibre-lamaste-serverd | lamalibre-lamaste-serverd (atomic write + mutex) | No                                         |
| `storage-config.json` | lamalibre-lamaste-serverd | lamalibre-lamaste-serverd (atomic write + mutex) | No                                       |
| `groups.json`        | gatekeeper   | lamalibre-lamaste-serverd (atomic write + mutex) | No (gatekeeper watches file)              |
| `access-grants.json` | gatekeeper   | lamalibre-lamaste-serverd (atomic write + mutex) | No (gatekeeper watches file)              |
| `gatekeeper.json`    | gatekeeper   | lamalibre-lamaste-serverd (atomic write)         | Yes (`systemctl restart lamalibre-lamaste-gatekeeper`) |
| `access-request-log.json` | lamalibre-lamaste-serverd | gatekeeper (atomic write)      | No                                        |
| `configuration.yml` | authelia     | onboarding provisioning             | Yes (`systemctl restart authelia`)         |
| `users.yml`         | authelia     | lamalibre-lamaste-serverd (via sudo)             | Yes (`systemctl restart authelia`)         |
| `lamaste-*` vhosts | nginx        | lamalibre-lamaste-serverd (via sudo)             | Yes (`nginx -t && systemctl reload nginx`) |
