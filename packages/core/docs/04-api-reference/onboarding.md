# Onboarding API

> The onboarding endpoints guide a fresh Lamaste installation through domain setup, DNS verification, and stack provisioning.

## In Plain English

When you first install Lamaste and open the admin panel, the system does not know your domain name yet. The onboarding API is the set of endpoints that walk you through the initial setup: telling the system your domain, checking that DNS is correctly configured, and then provisioning all the backend services (Chisel, Authelia, nginx vhosts, TLS certificates).

Once onboarding completes, these endpoints permanently return "410 Gone" — they are a one-time setup flow, not something you revisit.

## Authentication

All onboarding endpoints require a valid mTLS client certificate, the same as every other API endpoint. See the [API Overview](./overview.md) for details.

## Availability

| Endpoint                       | Available When        |
| ------------------------------ | --------------------- |
| `GET /api/onboarding/status`   | Always (no guard)     |
| All other onboarding endpoints | `status != COMPLETED` |

After onboarding completes, all endpoints except `/status` return:

```json
HTTP/1.1 410 Gone

{
  "error": "Onboarding already completed"
}
```

## Onboarding State Machine

The onboarding progresses through a linear sequence of states. Each API call validates the current state before proceeding.

```
FRESH ──POST /domain──▶ DOMAIN_SET ──POST /verify-dns──▶ DNS_READY
                                                              │
                                                   POST /provision
                                                              │
                                                              ▼
                                                        PROVISIONING
                                                              │
                                                        (background)
                                                              │
                                                              ▼
                                                         COMPLETED
```

## Endpoints

### `GET /api/onboarding/status`

Returns the current onboarding state. This is the first endpoint the panel client calls on load to determine whether to show the onboarding wizard or the management UI.

This endpoint is always accessible regardless of onboarding state — it has no guard.

**Request:**

No request body.

```bash
# Create a curl config file (do this once):
# echo 'cert = "client.p12:YOUR_P12_PASSWORD"' > ~/.curl-lamaste
# chmod 600 ~/.curl-lamaste

curl -s -K ~/.curl-lamaste \
  https://203.0.113.42:9292/api/onboarding/status
```

**Response (200):**

```json
{
  "status": "FRESH",
  "domain": null,
  "ip": "203.0.113.42"
}
```

| Field    | Type             | Description                                                             |
| -------- | ---------------- | ----------------------------------------------------------------------- |
| `status` | `string`         | One of: `FRESH`, `DOMAIN_SET`, `DNS_READY`, `PROVISIONING`, `COMPLETED` |
| `domain` | `string \| null` | The configured domain, or `null` if not yet set                         |
| `ip`     | `string`         | The droplet's public IP address                                         |

After domain is set:

```json
{
  "status": "DOMAIN_SET",
  "domain": "example.com",
  "ip": "203.0.113.42"
}
```

---

### `POST /api/onboarding/domain`

Sets the domain name and Let's Encrypt contact email. This is the first step in the onboarding flow.

**Request:**

```json
{
  "domain": "example.com",
  "email": "admin@example.com"
}
```

| Field    | Type     | Validation             | Description                                  |
| -------- | -------- | ---------------------- | -------------------------------------------- |
| `domain` | `string` | FQDN regex, min 1 char | Fully qualified domain name                  |
| `email`  | `string` | Valid email format     | Contact email for Let's Encrypt registration |

The domain is validated against this pattern:

```
^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$
```

```bash
curl -s -K ~/.curl-lamaste \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"domain":"example.com","email":"admin@example.com"}' \
  https://203.0.113.42:9292/api/onboarding/domain
```

**Response (200):**

```json
{
  "ok": true,
  "domain": "example.com",
  "email": "admin@example.com"
}
```

**Errors:**

| Status | Body                                                                               | When                                        |
| ------ | ---------------------------------------------------------------------------------- | ------------------------------------------- |
| 400    | `{"error":"Validation failed","details":{"issues":[...]}}`                         | Invalid domain format or missing email      |
| 409    | `{"error":"Cannot change domain in current state","onboardingStatus":"DNS_READY"}` | Onboarding has progressed past `DOMAIN_SET` |
| 410    | `{"error":"Onboarding already completed"}`                                         | Onboarding is finished                      |

**State transition:** `FRESH` or `DOMAIN_SET` → `DOMAIN_SET`

The endpoint is idempotent during the `FRESH` and `DOMAIN_SET` states — you can call it multiple times to correct the domain before verifying DNS. Once DNS verification succeeds, the domain is locked.

---

### `POST /api/onboarding/verify-dns`

Checks whether the configured domain's DNS A records point to the droplet's IP address. Also checks for wildcard DNS (optional but recommended).

**Request:**

No request body. The domain is read from the server's configuration.

```bash
curl -s -K ~/.curl-lamaste \
  -X POST \
  https://203.0.113.42:9292/api/onboarding/verify-dns
```

**Response (200) — DNS correct:**

```json
{
  "ok": true,
  "domain": "example.com",
  "resolvedIps": ["203.0.113.42"],
  "expectedIp": "203.0.113.42",
  "wildcardOk": true,
  "wildcardResolvedIps": ["203.0.113.42"],
  "message": "DNS is correctly configured. Both base domain and wildcard resolve to your server."
}
```

**Response (200) — DNS not yet propagated:**

```json
{
  "ok": false,
  "domain": "example.com",
  "resolvedIps": [],
  "expectedIp": "203.0.113.42",
  "wildcardOk": false,
  "wildcardResolvedIps": [],
  "message": "Domain does not resolve yet. Please add an A record pointing example.com to 203.0.113.42. DNS propagation can take up to 48 hours, but usually completes within minutes."
}
```

**Response (200) — Base OK, no wildcard:**

```json
{
  "ok": true,
  "domain": "example.com",
  "resolvedIps": ["203.0.113.42"],
  "expectedIp": "203.0.113.42",
  "wildcardOk": false,
  "wildcardResolvedIps": [],
  "message": "Base domain resolves correctly. Wildcard DNS is not configured — you will need to add individual subdomain records for each tunnel."
}
```

| Field                 | Type       | Description                                           |
| --------------------- | ---------- | ----------------------------------------------------- |
| `ok`                  | `boolean`  | `true` if the base domain resolves to the expected IP |
| `domain`              | `string`   | The domain being verified                             |
| `resolvedIps`         | `string[]` | IP addresses the base domain resolves to              |
| `expectedIp`          | `string`   | The droplet's public IP                               |
| `wildcardOk`          | `boolean`  | `true` if wildcard DNS is configured                  |
| `wildcardResolvedIps` | `string[]` | IP addresses the wildcard resolves to                 |
| `message`             | `string`   | Human-readable diagnostic message                     |

**Errors:**

| Status | Body                                                                                | When                        |
| ------ | ----------------------------------------------------------------------------------- | --------------------------- |
| 409    | `{"error":"Domain must be set before DNS verification","onboardingStatus":"FRESH"}` | Domain has not been set yet |
| 410    | `{"error":"Onboarding already completed"}`                                          | Onboarding is finished      |

**State transition:** `DOMAIN_SET` or `DNS_READY` → `DNS_READY` (only when `ok` is `true`)

The endpoint can be called repeatedly — it is safe to poll while waiting for DNS propagation. The state only advances when verification succeeds.

The wildcard check probes `test-lamaste-check.<domain>`. Wildcard DNS is optional; tunnels will still work with individual A records.

---

### `POST /api/onboarding/provision`

Starts the full stack provisioning process in the background. This installs and configures Chisel, Authelia, certbot certificates, and nginx vhosts.

Provisioning runs asynchronously. This endpoint returns immediately with a 202 status. Use the WebSocket stream endpoint to follow progress in real time.

**Request:**

No request body.

```bash
curl -s -K ~/.curl-lamaste \
  -X POST \
  https://203.0.113.42:9292/api/onboarding/provision
```

**Response (202):**

```json
{
  "ok": true,
  "message": "Provisioning started"
}
```

**Errors:**

| Status | Body                                                   | When                              |
| ------ | ------------------------------------------------------ | --------------------------------- |
| 409    | `{"error":"DNS must be verified before provisioning"}` | State is `FRESH` or `DOMAIN_SET`  |
| 409    | `{"error":"Provisioning already in progress"}`         | Provisioning is currently running |
| 410    | `{"error":"Onboarding already completed"}`             | Onboarding is finished            |

**State transition:** `DNS_READY` → `PROVISIONING` → `COMPLETED` (on success)

### Provisioning Tasks

The provisioning sequence runs these tasks in order:

| Task ID            | Title                    | What It Does                                                         |
| ------------------ | ------------------------ | -------------------------------------------------------------------- |
| `install-chisel`   | Installing Chisel        | Downloads binary, writes systemd service, starts service             |
| `install-authelia` | Installing Authelia      | Downloads binary, writes config, creates admin user, starts service  |
| `issue-certs`      | Issuing TLS certificates | Issues Let's Encrypt cert for `panel.<domain>`, sets up auto-renewal |
| `configure-nginx`  | Configuring nginx        | Writes panel/auth/tunnel vhosts, enables sites, tests and reloads    |
| `verify-services`  | Verifying services       | Checks all services are running (Chisel, Authelia, nginx, panel)     |
| `finalize`         | Finalizing setup         | Updates config to `COMPLETED` state                                  |

---

### `WS /api/onboarding/provision/stream`

WebSocket endpoint for real-time provisioning progress. Connects via the standard WebSocket upgrade handshake.

```javascript
const ws = new WebSocket('wss://203.0.113.42:9292/api/onboarding/provision/stream');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data);
};
```

**Initial message (sent immediately on connect):**

When a client connects, the server sends the full current state so late-joining clients can catch up:

```json
{
  "type": "state",
  "isRunning": true,
  "tasks": [
    {
      "id": "install-chisel",
      "title": "Installing Chisel",
      "status": "done",
      "message": "Chisel installed and running",
      "log": null
    },
    {
      "id": "install-authelia",
      "title": "Installing Authelia",
      "status": "running",
      "message": "Creating admin user...",
      "log": "Installed Authelia v4.38.0"
    },
    {
      "id": "issue-certs",
      "title": "Issuing TLS certificates",
      "status": "pending",
      "message": null,
      "log": null
    },
    {
      "id": "configure-nginx",
      "title": "Configuring nginx",
      "status": "pending",
      "message": null,
      "log": null
    },
    {
      "id": "verify-services",
      "title": "Verifying services",
      "status": "pending",
      "message": null,
      "log": null
    },
    {
      "id": "finalize",
      "title": "Finalizing setup",
      "status": "pending",
      "message": null,
      "log": null
    }
  ],
  "error": null,
  "result": null
}
```

**Progress messages (sent as tasks advance):**

```json
{
  "task": "install-authelia",
  "title": "Installing Authelia",
  "status": "running",
  "message": "Writing configuration...",
  "log": "Installed Authelia v4.38.0",
  "progress": { "current": 2, "total": 6 }
}
```

| Field      | Type             | Description                                              |
| ---------- | ---------------- | -------------------------------------------------------- |
| `task`     | `string`         | Task identifier                                          |
| `title`    | `string`         | Human-readable task title                                |
| `status`   | `string`         | One of: `pending`, `running`, `done`, `error`            |
| `message`  | `string \| null` | Current step description within the task                 |
| `log`      | `string \| null` | Additional log output (version numbers, skipped notices) |
| `progress` | `object`         | `{ current, total }` — overall progress counter          |

**Completion message:**

```json
{
  "task": "complete",
  "status": "done",
  "message": "Provisioning complete",
  "result": {
    "adminUsername": "admin",
    "adminPassword": "aB3dEf7hIjKlMn0p",
    "panelUrl": "https://panel.example.com",
    "authUrl": "https://auth.example.com"
  },
  "progress": { "current": 6, "total": 6 }
}
```

The `result` object contains the initial Authelia admin credentials. The password is randomly generated and shown only once.

**Error message:**

```json
{
  "task": "configure-nginx",
  "status": "error",
  "message": "Failed: Configuring nginx",
  "error": "nginx configuration test failed: ...",
  "progress": { "current": 3, "total": 6 }
}
```

If a task fails, all subsequent tasks remain in `pending` status and provisioning stops.

## Quick Reference

| Method | Path                               | State Required              | Returns                   |
| ------ | ---------------------------------- | --------------------------- | ------------------------- |
| GET    | `/api/onboarding/status`           | Any                         | Current state, domain, IP |
| POST   | `/api/onboarding/domain`           | `FRESH` or `DOMAIN_SET`     | Confirmation              |
| POST   | `/api/onboarding/verify-dns`       | `DOMAIN_SET` or `DNS_READY` | DNS resolution results    |
| POST   | `/api/onboarding/provision`        | `DNS_READY`                 | 202 Accepted              |
| WS     | `/api/onboarding/provision/stream` | Any (read-only)             | Real-time progress        |

### State Machine

```
FRESH ──▶ DOMAIN_SET ──▶ DNS_READY ──▶ PROVISIONING ──▶ COMPLETED
  │           │              │
  └───────────┘              │
  (domain can be changed)    │
                             └── (provision runs in background)
```

### curl Cheat Sheet

```bash
# Check current state
curl -s -K ~/.curl-lamaste \
  https://203.0.113.42:9292/api/onboarding/status | jq

# Set domain
curl -s -K ~/.curl-lamaste \
  -X POST -H "Content-Type: application/json" \
  -d '{"domain":"example.com","email":"admin@example.com"}' \
  https://203.0.113.42:9292/api/onboarding/domain | jq

# Verify DNS
curl -s -K ~/.curl-lamaste \
  -X POST \
  https://203.0.113.42:9292/api/onboarding/verify-dns | jq

# Start provisioning
curl -s -K ~/.curl-lamaste \
  -X POST \
  https://203.0.113.42:9292/api/onboarding/provision | jq
```
