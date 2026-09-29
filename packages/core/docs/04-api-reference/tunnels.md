# Tunnels API

> Create, list, move, and delete tunnels that expose services on an agent machine through your Lamaste domain.

## In Plain English

A tunnel connects a web app running on an agent machine (say, a development server on port 3000) to a public subdomain on your Lamaste domain (like `app.example.com`). When someone visits that URL, the request travels through the tunnel back to that machine.

Every tunnel belongs to exactly one **agent** — the enrolled machine that carries it. Only that agent is told about the tunnel, and only that agent's credential may open it on the server. Another agent cannot take over the hostname by binding the same port.

## Authentication

All tunnel endpoints require a valid mTLS client certificate and a completed onboarding. See the [API Overview](./overview.md) for details.

If onboarding is not complete, all endpoints return `503 Service Unavailable`.

**Admin vs agent certificates.** An admin certificate sees and manages every tunnel. An agent certificate sees and manages only the tunnels that agent carries: other agents' tunnels are absent from its list and answer `404` to it.

## Endpoints

### `GET /api/tunnels`

Returns tunnels, sorted by creation date (newest first). An agent certificate receives only its own tunnels.

**Query parameters:** `limit` (1–500, default 100), `offset` (default 0), `sort` (`createdAt` | `name`), `order` (`asc` | `desc`, default `desc`).

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
      "type": "app",
      "accessMode": "restricted",
      "agentLabel": "laptop",
      "enabled": true,
      "createdAt": "2026-03-13T14:30:00.000Z"
    }
  ],
  "total": 1,
  "limit": 100,
  "offset": 0
}
```

| Field           | Type             | Description                                                                                                                                                                                |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`            | `string`         | UUID v4 identifier                                                                                                                                                                         |
| `subdomain`     | `string`         | The subdomain portion (e.g., `app`)                                                                                                                                                        |
| `fqdn`          | `string`         | Fully qualified domain name (e.g., `app.example.com`)                                                                                                                                      |
| `port`          | `number`         | Port the carrying agent forwards; bound on `127.0.0.1` on both the server and the agent                                                                                                    |
| `description`   | `string \| null` | Optional human-readable description                                                                                                                                                        |
| `type`          | `string`         | `'app'` (default), `'panel'` (agent web panel), or `'plugin'`                                                                                                                              |
| `accessMode`    | `string`         | `'restricted'` (default), `'authenticated'`, or `'public'` — absent on panel tunnels                                                                                                       |
| `agentLabel`    | `string`         | The agent that carries the tunnel. Absent only on an unassigned legacy tunnel (see below)                                                                                                  |
| `maxBodySizeMb` | `number`         | Largest request body nginx accepts, in MiB. Absent on panel tunnels and on tunnels created before the setting existed, which keep nginx's built-in 1 MiB until a body limit is set on them |
| `enabled`       | `boolean`        | Whether the tunnel is active (defaults to `true`)                                                                                                                                          |
| `createdAt`     | `string`         | ISO 8601 timestamp                                                                                                                                                                         |

---

### `POST /api/tunnels`

Creates a new tunnel. This is a multi-step operation that:

1. Issues a Let's Encrypt TLS certificate for `<subdomain>.<domain>`
2. Writes an nginx vhost configuration for the subdomain
3. Saves the tunnel to the state file
4. Syncs Chisel: re-renders the authfile so the carrying agent may bind the new port (Chisel reloads it without a restart)

State is saved before Chisel is synced because the Chisel authfile is rendered from the persisted state. If any step fails, the previous steps are rolled back. The whole workflow — validation included — runs under the panel's single tunnel lock, so two concurrent requests cannot both claim the same subdomain or port.

The carrying agent's sync timer picks the tunnel up within about 30 seconds and starts forwarding the port; `lamaste-agent update` on the agent applies it immediately.

**Request:**

```json
{
  "subdomain": "app",
  "port": 3000,
  "agentLabel": "laptop",
  "description": "React development server",
  "accessMode": "restricted",
  "maxBodySizeMb": 10
}
```

| Field           | Type      | Validation                                                                   | Description                                                                                                               |
| --------------- | --------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `subdomain`     | `string`  | Lowercase alphanumeric + hyphens, max 63 chars, cannot start/end with hyphen | The subdomain to create                                                                                                   |
| `port`          | `integer` | 1024 - 65535, not a [reserved port](#port)                                   | Port the agent forwards                                                                                                   |
| `agentLabel`    | `string`  | An enrolled, non-revoked agent's label                                       | **Required for admin certificates.** An agent certificate may omit it (defaults to itself) but may not name another agent |
| `description`   | `string`  | Max 200 chars, optional (defaults to `""`)                                   | Human-readable description                                                                                                |
| `type`          | `string`  | `'app'` (default), `'panel'`, or `'plugin'`                                  | `panel` requires the `panel:expose` capability; `plugin` is admin-only                                                    |
| `accessMode`    | `string`  | `'restricted'` (default), `'authenticated'`, `'public'`                      | `authenticated` and `public` are admin-only                                                                               |
| `maxBodySizeMb` | `integer` | 1 - 10240 for admins, 1 - 100 for agents; optional (defaults to 10)          | Written into the vhost as `client_max_body_size`; larger requests get HTTP 413. Raise it for apps that take big uploads   |

**Subdomain regex:**

```
^[a-z0-9]([a-z0-9-]*[a-z0-9])?$
```

**Reserved subdomains** (cannot be used):

`panel`, `auth`, `tunnel`, `www`, `mail`, `ftp`, `api`

**Reserved prefix:** Subdomains starting with `agent-` are reserved for agent panel tunnels (created via `POST /api/tunnels/expose-panel`). Regular tunnel creation with `agent-` prefixed subdomains is rejected unless `type` is `'panel'`.

**Who may create:** an admin certificate, or an agent certificate with `tunnels:write` for a tunnel it carries itself. A **plugin-agent** certificate (`CN=plugin-agent:...`) cannot create tunnels: it belongs to a plugin running on an agent, not to a machine running a Chisel client, so it holds no Chisel credential and could carry nothing. Create a plugin's tunnel with the agent's own certificate or as an administrator.

```bash
curl -s --cert client.p12:password \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"subdomain":"app","port":3000,"agentLabel":"laptop","description":"React dev server"}' \
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
    "type": "app",
    "accessMode": "restricted",
    "agentLabel": "laptop",
    "maxBodySizeMb": 10,
    "enabled": true,
    "createdAt": "2026-03-13T14:30:00.000Z"
  }
}
```

**Errors:**

| Status | Body                                                                                                          | When                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 400    | `{"error":"Validation failed","details":{"issues":[...]}}`                                                    | Invalid subdomain format, port out of range or reserved      |
| 400    | `{"error":"agentLabel is required: name the agent that will carry the tunnel"}`                               | Admin certificate did not name the carrying agent            |
| 400    | `{"error":"Failed to create tunnel","details":"Agent 'x' is not enrolled or has been revoked"}`               | `agentLabel` does not name an active agent                   |
| 400    | `{"error":"Failed to create tunnel","details":"Subdomain 'panel' is reserved"}`                               | Subdomain is in the reserved list                            |
| 400    | `{"error":"Failed to create tunnel","details":"Subdomain 'app' is already in use"}`                           | Another tunnel uses this subdomain                           |
| 400    | `{"error":"Failed to create tunnel","details":"Port 3000 is already in use by another tunnel"}`               | Another tunnel uses this port                                |
| 400    | `{"error":"Failed to create tunnel","details":"Domain 'app.example.com' is already served by a static site"}` | A static site or site alias already answers on this hostname |
| 400    | `{"error":"Domain and email must be configured before creating tunnels"}`                                     | Domain not set in config                                     |
| 403    | `{"error":"Agents can only create tunnels they carry themselves"}`                                            | Agent certificate named another agent                        |
| 403    | `{"error":"Plugin-agent certificates cannot create tunnels — use the agent certificate of ..."}`              | Plugin-agent certificate                                     |
| 403    | `{"error":"Only administrators can set a body limit above 100 MiB"}`                                          | Agent certificate asked for `maxBodySizeMb` over 100         |
| 403    | `{"error":"Only administrators can set tunnel access mode to public or authenticated"}`                       | Agent certificate asked for a non-restricted mode            |
| 500    | `{"error":"Failed to create tunnel","details":"Certificate issuance failed: ..."}`                            | certbot failed                                               |
| 500    | `{"error":"Failed to create tunnel","details":"Nginx configuration failed: ..."}`                             | nginx vhost write or test failed                             |
| 500    | `{"error":"Failed to create tunnel","details":"State persistence failed: ..."}`                               | Failed to write tunnels.json                                 |
| 500    | `{"error":"Failed to create tunnel","details":"Chisel reconfiguration failed: ..."}`                          | Chisel authfile sync failed                                  |

### Creation Flow

```
Take the tunnel lock (held until the response)
       │
Validate input
  ├── Check agentLabel names an active agent
  ├── Check subdomain not reserved
  ├── Check subdomain uniqueness
  ├── Check port not reserved
  └── Check port uniqueness
       │
       ▼
Step 1: certbot issues TLS cert for <subdomain>.<domain>
       │
       ▼
Step 2: Write nginx vhost for the subdomain
       │ (rollback: remove vhost on failure)
       ▼
Step 3: Save tunnel to tunnels.json
       │ (rollback: remove vhost on failure)
       ▼
Step 4: Sync Chisel — authfile grants the owner the port (hot-reloaded)
       │ (rollback: remove tunnel from state, remove vhost)
       ▼
Return 201 with tunnel object
```

---

### `PATCH /api/tunnels/:id`

Changes any of: carrying agent, access mode, request body limit, enabled state. All of them are applied in one workflow under the tunnel lock, in that order — ownership first, so a later failure still leaves the tunnel with the agent the caller asked for; access mode and body limit next; the enabled state last, so a tunnel being disabled is never re-enabled by the vhost rewrite before it. Authorization is checked against the tunnel as it is when the lock is taken.

- **`enabled`** — when disabled, the tunnel's nginx vhost symlink is removed (the config file is kept) and the owner's Chisel grant for the port is withdrawn (Chisel restarts, which ends sessions still holding it). Re-enabling restores both. Only enabled tunnels appear in an agent's config, and the owner's sync timer drops or adds the remote within about 30 seconds.
- **`agentLabel`** (admin only) — moves the tunnel to another active agent. The previous owner loses the port grant in the same Chisel sync that gives it to the new owner. Both agents' sync timers apply the move within about 30 seconds; `lamaste-agent update` applies it at once. Agent panel tunnels (`type: 'panel'`) belong to the agent they expose and cannot be moved.
- **`accessMode`** and **`maxBodySizeMb`** — both live in the tunnel's nginx vhost, which is re-rendered and tested (nginx keeps the previous vhost if the test fails). Gatekeeper watches the tunnel state and picks up an access-mode change on its own. A disabled tunnel stays disabled. `public` and `authenticated` are admin-only, as on creation. Agent panel tunnels have a fixed mTLS vhost and cannot be reconfigured.

**Request:**

```json
{
  "enabled": false,
  "agentLabel": "build-server"
}
```

| Field           | Type      | Validation                             | Description                             |
| --------------- | --------- | -------------------------------------- | --------------------------------------- |
| `enabled`       | `boolean` | Optional                               | Whether the tunnel should be active     |
| `agentLabel`    | `string`  | Optional; an active agent; admin only  | The agent that should carry the tunnel  |
| `accessMode`    | `string`  | Optional; non-restricted is admin only | `restricted`, `authenticated`, `public` |
| `maxBodySizeMb` | `integer` | Optional; 1 - 10240 (agents: 1 - 100)  | Largest request body in MiB             |

At least one field is required; unknown fields are rejected.

```bash
curl -s --cert client.p12:password \
  -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"agentLabel":"build-server"}' \
  https://203.0.113.42:9292/api/tunnels/a1b2c3d4-e5f6-7890-abcd-ef1234567890 | jq
```

**Response (200):** `{ "ok": true, "tunnel": { ... } }` with the updated tunnel object.

**Errors:**

| Status | Body                                                                                            | When                                           |
| ------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 400    | `{"error":"Validation failed",...}`                                                             | Empty body, unknown field, or bad label format |
| 400    | `{"error":"Failed to update tunnel","details":"Agent 'x' is not enrolled or has been revoked"}` | `agentLabel` does not name an active agent     |
| 400    | `{"error":"Failed to update tunnel","details":"Agent panel tunnels belong to ..."}`             | Tried to move a panel tunnel                   |
| 403    | `{"error":"Only administrators can change which agent carries a tunnel"}`                       | Agent certificate sent `agentLabel`            |
| 403    | `{"error":"Only administrators can set a body limit above 100 MiB"}`                            | Agent certificate sent `maxBodySizeMb` > 100   |
| 404    | `{"error":"Tunnel not found"}`                                                                  | No such tunnel, or it belongs to another agent |
| 500    | `{"error":"Failed to update tunnel","details":"..."}`                                           | nginx, Chisel, or state operation failed       |

---

### `DELETE /api/tunnels/:id`

Deletes a tunnel by its UUID: removes the nginx vhost, removes the tunnel from the state file, and syncs Chisel so the owner's grant for the port is withdrawn.

The TLS certificate is not deleted (it is harmless to keep and may be reused if the subdomain is recreated).

```bash
curl -s --cert client.p12:password \
  -X DELETE \
  https://203.0.113.42:9292/api/tunnels/a1b2c3d4-e5f6-7890-abcd-ef1234567890 | jq
```

**Response (200):** `{ "ok": true }`

**Errors:**

| Status | Body                                                  | When                                           |
| ------ | ----------------------------------------------------- | ---------------------------------------------- |
| 404    | `{"error":"Tunnel not found"}`                        | No such tunnel, or it belongs to another agent |
| 500    | `{"error":"Failed to delete tunnel","details":"..."}` | nginx, Chisel, or state operation failed       |

---

### `GET /api/tunnels/agent-config`

Returns the Chisel client configuration for one agent: the enabled tunnels it carries that the Chisel authfile actually grants it, and nothing else. A tunnel on a reserved port or sharing its port with another tunnel (possible only in state written before those checks) is withheld — Chisel would refuse the agent's whole session for it. Used by `lamaste-agent setup`, `update`, and the agent's 30-second sync timer (`lamaste-agent sync`), on both macOS and Linux.

**Required capability:** `tunnels:read`

**Query parameters:**

| Parameter | Description                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `agent`   | Admin certificates only: the agent whose config to return. Ignored for agent certificates, which always get their own. |

```bash
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/tunnels/agent-config | jq
```

**Response (200) — agent certificate, or admin with `?agent=`:**

```json
{
  "domain": "example.com",
  "chiselServerUrl": "https://tunnel.example.com:443",
  "agentLabel": "laptop",
  "chiselArgs": ["client", "https://tunnel.example.com:443", "R:127.0.0.1:3000:127.0.0.1:3000"],
  "chiselCredentialIssuedAt": "2026-09-20T10:12:00.000Z",
  "tunnels": [{ "port": 3000, "subdomain": "app" }]
}
```

**Response (200) — admin without `?agent=`:** `{ "domain": "...", "chiselServerUrl": "..." }` only. A Chisel configuration is meaningless without an agent to carry it.

| Field                      | Type             | Description                                                                                                                                                                                                                                                                        |
| -------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`                   | `string`         | Base domain                                                                                                                                                                                                                                                                        |
| `chiselServerUrl`          | `string`         | Full URL to the Chisel server endpoint                                                                                                                                                                                                                                             |
| `agentLabel`               | `string`         | The agent this configuration is for                                                                                                                                                                                                                                                |
| `chiselArgs`               | `string[]`       | Chisel client arguments: `client`, the server URL, and one `R:127.0.0.1:<port>:127.0.0.1:<port>` remote per tunnel. No `--tls-skip-verify` (the agent verifies the relay's certificate) and no credential — the agent supplies its own through the service environment, never argv |
| `chiselCredentialIssuedAt` | `string \| null` | When the agent's current Chisel credential was issued — a timestamp, never the credential. An agent holding a credential with a different issue time (an administrator rotated it) fetches the current one from `GET /api/agents/me/chisel-credential`                             |
| `tunnels`                  | `array`          | The agent's enabled tunnels with port and subdomain                                                                                                                                                                                                                                |

**Errors:**

| Status | Body                                          | When                     |
| ------ | --------------------------------------------- | ------------------------ |
| 400    | `{"error":"Domain not configured"}`           | Domain has not been set  |
| 500    | `{"error":"Failed to generate agent config"}` | Config generation failed |

## Chisel Grants

The Chisel server authenticates every client against `/etc/lamalibre/lamaste/chisel-users`. That file is rendered by the panel from two persisted inputs — the per-agent credential store and the tunnel state — and re-rendered whenever either changes:

```json
{
  "lamaste-no-grants:<random>": [],
  "agent-laptop:<password>": ["^R:127\\.0\\.0\\.1:3000$"],
  "agent-build-server:<password>": []
}
```

- Each `agent-<label>` user may reverse-bind exactly the ports of the enabled tunnels it owns. An agent with no tunnels can connect but bind nothing. The patterns are anchored because Chisel matches them unanchored — `^…$` is what keeps port `2001` from also granting `20010`.
- `lamaste-no-grants` exists so the file is never empty. Chisel disables authentication entirely when its authfile has no users, which would turn a freshly installed server (or one whose agents are all revoked) into an open relay. Its password is random, stored at `chisel-sentinel` (0600), and never handed out.
- A port that belongs to a Lamaste service ([reserved ports](#port)), or a port that two tunnels claim, is never granted — even if the state file somehow holds such a tunnel.
- The file is `0640`, owner `lamaste`, group `lamaste-chisel` — the group the Chisel server runs as (`User=nobody`, `Group=lamaste-chisel`). The panel is a member of that group and writes the file itself, without sudo: a `0600` temp file in the same directory, `chgrp`, `chmod 0640`, fsync, rename. Chisel therefore never sees the file with the wrong permissions.
- Chisel 1.12.0 reloads the authfile on every replace, and the reload applies to new sessions. Additions (a new agent, a new grant) therefore take effect without a restart. A revocation (a removed or rotated password, a withdrawn grant) restarts Chisel with `systemctl try-restart`, because a live session keeps what it already bound — and `try-restart` leaves a deliberately stopped Chisel stopped.

### Why the grants matter to the agent

Chisel rejects a client's **whole** session when one remote it requests is not granted. An agent still asking for a disabled or moved tunnel's port would lose all of its other tunnels too. That is why agents run a sync timer that drops such remotes within about 30 seconds — see [Agent Setup](../02-guides/agent-setup.md#how-tunnel-changes-reach-the-agent).

### Upgrading from a version without tunnel ownership

On startup the panel reconciles older state. An agent panel tunnel without an `agentLabel` is bound to the agent its hostname names (`agent-<label>`) when that agent is active, and never to any other. Other tunnels without an `agentLabel` are bound to the only active machine agent when exactly one exists (plugin-agent certificates carry no tunnels and are not counted). With several active agents the carrier cannot be known, so those tunnels stay **unassigned**: they are carried by no agent, show as `unassigned` in the panel, are logged at startup, and come back as soon as an administrator moves them to an agent (`PATCH` with `agentLabel`).

Tunnels on a reserved port, or two tunnels on the same port, are granted to no agent and left out of every `agent-config`; the panel logs them at startup. Delete each and recreate it on a free port.

### When an agent certificate is revoked

Revoking an agent's certificate releases its tunnels: its app and plugin tunnels become unassigned (their hostnames stay reserved and dark until an administrator assigns them), and its `agent-<label>` panel tunnel is removed with its vhost. A later enrollment that reuses the label therefore inherits nothing.

## Validation Rules

### Subdomain

- Lowercase letters, digits, and hyphens only
- Cannot start or end with a hyphen
- Maximum 63 characters
- Must not be one of: `panel`, `auth`, `tunnel`, `www`, `mail`, `ftp`, `api`
- Must not start with `agent-` (reserved for agent panel tunnels, unless `type` is `'panel'`)
- Must be unique across all tunnels
- Must not be a hostname a static site or site alias already serves (checked on tunnel creation; site creation and alias changes check the reverse)

### Port

- Must be an integer
- Minimum: 1024 (no privileged ports)
- Maximum: 65535
- Must not be a reserved port: `3100` (panel server), `9090` (Chisel server), `9091` (Authelia), `9292` (IP-based panel listener), `9294` (Gatekeeper)
- Must be unique across all tunnels — Chisel binds the same port on the server and on the agent

A tunnel's vhost proxies to `127.0.0.1:<port>` on the relay, so a tunnel on one of Lamaste's own ports would publish that internal service on the internet. For the panel ports that would be an administrator takeover, not a leak: the panel trusts the client-certificate headers nginx sets. The reserved ports are rejected by the request schema, again inside the tunnel workflow, and never granted in the Chisel authfile.

### Agent label

- An enrolled, non-revoked agent: `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`

## Quick Reference

| Method | Path                              | Description                                                                                                         |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/tunnels`                    | List tunnels (an agent sees only its own)                                                                           |
| POST   | `/api/tunnels`                    | Create a tunnel carried by an agent                                                                                 |
| PATCH  | `/api/tunnels/:id`                | Move (admin), access mode, body limit, enable/disable                                                               |
| DELETE | `/api/tunnels/:id`                | Delete a tunnel by UUID                                                                                             |
| GET    | `/api/tunnels/agent-config`       | One agent's Chisel client config (macOS & Linux)                                                                    |
| GET    | `/api/tunnels/agent-panel-status` | Check if agent has an exposed panel tunnel                                                                          |
| POST   | `/api/tunnels/expose-panel`       | Create mTLS panel tunnel for requesting agent (refused when a static site or alias serves `agent-<label>.<domain>`) |
| DELETE | `/api/tunnels/retract-panel`      | Remove the panel tunnel for requesting agent                                                                        |

### curl Cheat Sheet

```bash
# List tunnels
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/tunnels | jq

# Create a tunnel carried by the agent "laptop"
curl -s --cert client.p12:password \
  -X POST -H "Content-Type: application/json" \
  -d '{"subdomain":"myapp","port":8080,"agentLabel":"laptop"}' \
  https://203.0.113.42:9292/api/tunnels | jq

# Move it to another agent
curl -s --cert client.p12:password \
  -X PATCH -H "Content-Type: application/json" \
  -d '{"agentLabel":"build-server"}' \
  https://203.0.113.42:9292/api/tunnels/<uuid> | jq

# Delete tunnel
curl -s --cert client.p12:password \
  -X DELETE \
  https://203.0.113.42:9292/api/tunnels/<uuid> | jq
```
