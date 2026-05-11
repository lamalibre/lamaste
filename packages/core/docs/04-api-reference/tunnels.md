# Tunnels API

> Create, list, and delete WebSocket tunnels that expose local services through your Lamaste domain.

## In Plain English

A tunnel connects a web app running on your local machine (say, a development server on port 3000) to a public subdomain on your Lamaste domain (like `app.example.com`). When someone visits that URL, the request travels through the tunnel back to your local machine.

The tunnels API lets you create new tunnels, list existing ones, delete tunnels you no longer need, download a platform-agnostic agent configuration, or download a macOS-specific plist file that keeps your local Chisel client connected automatically.

## Authentication

All tunnel endpoints require a valid mTLS client certificate and a completed onboarding. See the [API Overview](./overview.md) for details.

If onboarding is not complete, all endpoints return `503 Service Unavailable`.

## Endpoints

### `GET /api/tunnels`

Returns all configured tunnels, sorted by creation date (newest first).

**Request:**

No request body.

```bash
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/tunnels | jq
```

**Response (200):**

```json
{
  "tunnels": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "subdomain": "app",
      "fqdn": "app.example.com",
      "port": 3000,
      "description": "React development server",
      "enabled": true,
      "createdAt": "2026-03-13T14:30:00.000Z"
    },
    {
      "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "subdomain": "myservice",
      "fqdn": "myservice.example.com",
      "port": 8080,
      "description": null,
      "enabled": true,
      "createdAt": "2026-03-12T10:15:00.000Z"
    }
  ]
}
```

| Field         | Type             | Description                                             |
| ------------- | ---------------- | ------------------------------------------------------- |
| `id`          | `string`         | UUID v4 identifier                                      |
| `subdomain`   | `string`         | The subdomain portion (e.g., `app`)                     |
| `fqdn`        | `string`         | Fully qualified domain name (e.g., `app.example.com`)   |
| `port`        | `number`         | Local port on your machine that this tunnel forwards to |
| `description` | `string \| null` | Optional human-readable description                     |
| `type`        | `string`         | Tunnel type: `'app'` (default) or `'panel'` (agent web panel) |
| `enabled`     | `boolean`        | Whether the tunnel is active (defaults to `true`)       |
| `createdAt`   | `string`         | ISO 8601 timestamp                                      |

---

### `POST /api/tunnels`

Creates a new tunnel. This is a multi-step operation that:

1. Issues a Let's Encrypt TLS certificate for `<subdomain>.<domain>`
2. Writes an nginx vhost configuration for the subdomain
3. Updates the Chisel server configuration to accept the new port
4. Saves the tunnel to the state file

If any step fails, previous steps are rolled back where possible (nginx vhost is removed if Chisel config or state persistence fails).

**Request:**

```json
{
  "subdomain": "app",
  "port": 3000,
  "description": "React development server"
}
```

| Field         | Type      | Validation                                                                   | Description                |
| ------------- | --------- | ---------------------------------------------------------------------------- | -------------------------- |
| `subdomain`   | `string`  | Lowercase alphanumeric + hyphens, max 63 chars, cannot start/end with hyphen | The subdomain to create    |
| `port`        | `integer` | 1024 - 65535                                                                 | Local port on your machine |
| `description` | `string`  | Max 200 chars, optional (defaults to `""`)                                   | Human-readable description |
| `type`        | `string`  | `'app'` (default) or `'panel'`, optional                                     | Tunnel type (`panel` requires `panel:expose` capability) |

**Subdomain regex:**

```
^[a-z0-9]([a-z0-9-]*[a-z0-9])?$
```

**Reserved subdomains** (cannot be used):

`panel`, `auth`, `tunnel`, `www`, `mail`, `ftp`, `api`

**Reserved prefix:** Subdomains starting with `agent-` are reserved for agent panel tunnels (created via `POST /api/tunnels/expose-panel`). Regular tunnel creation with `agent-` prefixed subdomains is rejected unless `type` is `'panel'`.

```bash
curl -s --cert client.p12:password \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"subdomain":"app","port":3000,"description":"React dev server"}' \
  https://203.0.113.42:9292/api/tunnels | jq
```

**Response (201):**

```json
{
  "ok": true,
  "tunnel": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "subdomain": "app",
    "fqdn": "app.example.com",
    "port": 3000,
    "description": "React dev server",
    "enabled": true,
    "createdAt": "2026-03-13T14:30:00.000Z"
  }
}
```

**Errors:**

| Status | Body                                                                                 | When                                        |
| ------ | ------------------------------------------------------------------------------------ | ------------------------------------------- |
| 400    | `{"error":"Validation failed","details":{"issues":[...]}}`                           | Invalid subdomain format, port out of range |
| 400    | `{"error":"Subdomain 'panel' is reserved"}`                                          | Subdomain is in the reserved list           |
| 400    | `{"error":"Subdomain 'app' is already in use"}`                                      | Another tunnel uses this subdomain          |
| 400    | `{"error":"Port 3000 is already in use by another tunnel"}`                          | Another tunnel uses this port               |
| 400    | `{"error":"Domain and email must be configured before creating tunnels"}`            | Domain not set in config                    |
| 500    | `{"error":"Failed to create tunnel","details":"Certificate issuance failed: ..."}`   | certbot failed                              |
| 500    | `{"error":"Failed to create tunnel","details":"Nginx configuration failed: ..."}`    | nginx vhost write or test failed            |
| 500    | `{"error":"Failed to create tunnel","details":"Chisel reconfiguration failed: ..."}` | Chisel config update failed                 |
| 500    | `{"error":"Failed to create tunnel","details":"State persistence failed: ..."}`      | Failed to write tunnels.json                |

### Creation Flow

```
Validate input
  ├── Check subdomain not reserved
  ├── Check subdomain uniqueness
  └── Check port uniqueness
       │
       ▼
Step 1: certbot issues TLS cert for <subdomain>.<domain>
       │
       ▼
Step 2: Write nginx vhost for the subdomain
       │ (rollback: remove vhost on failure)
       ▼
Step 3: Update Chisel server config with new port
       │ (rollback: remove vhost on failure)
       ▼
Step 4: Save tunnel to tunnels.json
       │ (rollback: remove vhost on failure)
       ▼
Return 201 with tunnel object
```

---

### `PATCH /api/tunnels/:id`

Toggles a tunnel between enabled and disabled. When disabled, the tunnel's nginx vhost symlink is removed (config file is kept) and the tunnel is excluded from the Chisel server configuration. When re-enabled, the vhost is restored and Chisel is reconfigured.

Only enabled tunnels are included in the agent config and Mac plist output.

**Request:**

```json
{
  "enabled": false
}
```

| Field     | Type      | Validation | Description                         |
| --------- | --------- | ---------- | ----------------------------------- |
| `enabled` | `boolean` | Required   | Whether the tunnel should be active |

```bash
curl -s --cert client.p12:password \
  -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"enabled":false}' \
  https://203.0.113.42:9292/api/tunnels/a1b2c3d4-e5f6-7890-abcd-ef1234567890 | jq
```

**Response (200):**

```json
{
  "ok": true,
  "tunnel": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "subdomain": "app",
    "fqdn": "app.example.com",
    "port": 3000,
    "description": "React dev server",
    "enabled": false,
    "createdAt": "2026-03-13T14:30:00.000Z"
  }
}
```

**Errors:**

| Status | Body                                                  | When                                     |
| ------ | ----------------------------------------------------- | ---------------------------------------- |
| 404    | `{"error":"Tunnel not found"}`                        | No tunnel with the given UUID            |
| 500    | `{"error":"Failed to toggle tunnel","details":"..."}` | nginx, Chisel, or state operation failed |

---

### `DELETE /api/tunnels/:id`

Deletes a tunnel by its UUID. This removes the nginx vhost, updates the Chisel configuration, and removes the tunnel from the state file.

The TLS certificate is not deleted (it is harmless to keep and may be reused if the subdomain is recreated).

**Request:**

No request body.

```bash
curl -s --cert client.p12:password \
  -X DELETE \
  https://203.0.113.42:9292/api/tunnels/a1b2c3d4-e5f6-7890-abcd-ef1234567890 | jq
```

**Response (200):**

```json
{
  "ok": true
}
```

**Errors:**

| Status | Body                                                  | When                                     |
| ------ | ----------------------------------------------------- | ---------------------------------------- |
| 404    | `{"error":"Tunnel not found"}`                        | No tunnel with the given UUID            |
| 500    | `{"error":"Failed to delete tunnel","details":"..."}` | nginx, Chisel, or state operation failed |

---

### `GET /api/tunnels/agent-config`

Returns platform-agnostic tunnel configuration for the lamaste-agent CLI. Used by `lamaste-agent setup` and `lamaste-agent update` on both macOS and Linux.

**Required capability:** `tunnels:read`

**Request:**

No request body.

```bash
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/tunnels/agent-config | jq
```

**Response (200):**

```json
{
  "domain": "example.com",
  "chiselServerUrl": "https://tunnel.example.com:443",
  "chiselArgs": ["client", "--tls-skip-verify", "https://tunnel.example.com:443", "R:127.0.0.1:3000:127.0.0.1:3000"],
  "tunnels": [
    { "port": 3000, "subdomain": "app" }
  ]
}
```

| Field            | Type       | Description                                          |
| ---------------- | ---------- | ---------------------------------------------------- |
| `domain`         | `string`   | Base domain                                          |
| `chiselServerUrl`| `string`   | Full URL to the Chisel server endpoint               |
| `chiselArgs`     | `string[]` | Chisel client arguments (used to generate service config) |
| `tunnels`        | `array`    | Enabled tunnels with port and subdomain              |

**Errors:**

| Status | Body                                        | When                    |
| ------ | ------------------------------------------- | ----------------------- |
| 400    | `{"error":"Domain not configured"}`         | Domain has not been set |
| 500    | `{"error":"Failed to generate agent config"}` | Config generation failed |

---

### `GET /api/tunnels/mac-plist`

Downloads a macOS launchd plist file that configures the Chisel client to connect to all configured tunnels automatically. The plist sets up a launchd service that starts on login and auto-reconnects on failure.

**Query parameters:**

| Parameter | Type     | Default | Description                                                                                     |
| --------- | -------- | ------- | ----------------------------------------------------------------------------------------------- |
| `format`  | `string` | (none)  | Set to `json` to get the plist content as JSON with instructions instead of a raw file download |

**Request (file download):**

```bash
curl -s --cert client.p12:password \
  -o com.lamalibre.lamaste.chisel.plist \
  https://203.0.113.42:9292/api/tunnels/mac-plist
```

**Response (200) — file download:**

Returns `Content-Type: application/x-plist` with `Content-Disposition: attachment; filename="com.lamalibre.lamaste.chisel.plist"`.

The response body is a raw XML plist file suitable for saving to `~/Library/LaunchAgents/`.

**Request (JSON format):**

```bash
curl -s --cert client.p12:password \
  "https://203.0.113.42:9292/api/tunnels/mac-plist?format=json" | jq
```

**Response (200) — JSON format:**

```json
{
  "plist": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist ...>...</plist>",
  "instructions": {
    "download": "Save the plist file to ~/Library/LaunchAgents/",
    "install": "launchctl load ~/Library/LaunchAgents/com.lamalibre.lamaste.chisel.plist",
    "uninstall": "launchctl unload ~/Library/LaunchAgents/com.lamalibre.lamaste.chisel.plist",
    "logs": "tail -f /usr/local/var/log/chisel.log",
    "status": "launchctl list | grep chisel",
    "prerequisite": "Install Chisel on your Mac: brew install chisel (or download from https://github.com/jpillora/chisel/releases)"
  }
}
```

**Errors:**

| Status | Body                                                       | When                    |
| ------ | ---------------------------------------------------------- | ----------------------- |
| 400    | `{"error":"Domain not configured"}`                        | Domain has not been set |
| 500    | `{"error":"Failed to generate Mac plist","details":"..."}` | Plist generation failed |

## Validation Rules

### Subdomain

- Lowercase letters, digits, and hyphens only
- Cannot start or end with a hyphen
- Maximum 63 characters
- Must not be one of: `panel`, `auth`, `tunnel`, `www`, `mail`, `ftp`, `api`
- Must not start with `agent-` (reserved for agent panel tunnels, unless `type` is `'panel'`)
- Must be unique across all tunnels
- Must be unique across all static sites (checked during site creation)

### Port

- Must be an integer
- Minimum: 1024 (no privileged ports)
- Maximum: 65535
- Must be unique across all tunnels

## Quick Reference

| Method | Path                                 | Description                                     |
| ------ | ------------------------------------ | ----------------------------------------------- |
| GET    | `/api/tunnels`                       | List all tunnels (newest first)                 |
| POST   | `/api/tunnels`                       | Create a tunnel (cert + vhost + chisel + state) |
| PATCH  | `/api/tunnels/:id`                   | Toggle tunnel enabled/disabled                  |
| DELETE | `/api/tunnels/:id`                   | Delete a tunnel by UUID                         |
| GET    | `/api/tunnels/agent-config`          | Platform-agnostic agent config (macOS & Linux)  |
| GET    | `/api/tunnels/mac-plist`             | Download launchd plist for Mac client           |
| GET    | `/api/tunnels/mac-plist?format=json` | Get plist content and instructions as JSON      |
| GET    | `/api/tunnels/agent-panel-status`    | Check if agent has an exposed panel tunnel      |
| POST   | `/api/tunnels/expose-panel`          | Create mTLS panel tunnel for requesting agent   |
| DELETE | `/api/tunnels/retract-panel`         | Remove the panel tunnel for requesting agent    |

### Tunnel Object Shape

```json
{
  "id": "uuid-v4",
  "subdomain": "app",
  "fqdn": "app.example.com",
  "port": 3000,
  "description": "optional string or null",
  "type": "app",
  "enabled": true,
  "createdAt": "2026-03-13T14:30:00.000Z"
}
```

> **Note:** The Mac plist (`GET /api/tunnels/mac-plist`) only includes tunnels where `enabled` is `true`. Disabled tunnels are excluded from the Chisel client configuration.

### curl Cheat Sheet

```bash
# List tunnels
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/tunnels | jq

# Create tunnel
curl -s --cert client.p12:password \
  -X POST -H "Content-Type: application/json" \
  -d '{"subdomain":"myapp","port":8080}' \
  https://203.0.113.42:9292/api/tunnels | jq

# Delete tunnel
curl -s --cert client.p12:password \
  -X DELETE \
  https://203.0.113.42:9292/api/tunnels/<uuid> | jq

# Download Mac plist
curl -s --cert client.p12:password \
  -o com.lamalibre.lamaste.chisel.plist \
  https://203.0.113.42:9292/api/tunnels/mac-plist
```
