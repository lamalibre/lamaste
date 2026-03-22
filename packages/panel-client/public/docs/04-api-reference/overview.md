# API Overview

> Nearly every interaction between the Portlama management UI and the backend happens through a JSON REST API protected by mTLS client certificates. The one exception is the invitation acceptance flow (`/api/invite/*`), which is public.

## In Plain English

When you open the Portlama management panel in your browser, the page you see is a single-page application (SPA) built with React. Every button you click — creating a tunnel, adding a user, renewing a certificate — sends a request to the panel server's REST API running on the same machine. The server processes the request, makes changes to the system (writing config files, reloading services), and sends back a JSON response.

The API sits behind nginx, which enforces mTLS on the panel vhost — meaning your browser must present a valid client certificate before the connection is even established. Without that certificate, the TLS handshake fails and no HTTP traffic reaches the API at all.

The one exception is the invitation flow. The `/api/invite/*` routes are registered in a public context without mTLS middleware, so that invited users can accept their invitation and set a password without needing a client certificate.

## Base URL

The API is served by the Fastify panel server at `127.0.0.1:3100`. In production, nginx reverse-proxies to this address. You never call port 3100 directly — all requests go through nginx on port 9292.

```
https://<droplet-ip>:9292/api/...
```

If a domain has been configured and provisioned:

```
https://panel.<your-domain>/api/...
```

Both URLs reach the same server. The IP-based URL always works, even if DNS is misconfigured.

## Authentication

### mTLS Client Certificates

All API endpoints except `/api/invite/*` require a valid mTLS client certificate. nginx verifies the certificate at the TLS layer and forwards the result to the panel server via the `X-SSL-Client-Verify` header.

```
Browser ──HTTPS + client cert──▶ nginx (port 9292)
  nginx checks ssl_client_verify
    ✓ SUCCESS → proxies to 127.0.0.1:3100 with X-SSL-Client-Verify: SUCCESS
    ✗ FAILED  → TLS handshake rejected, no HTTP traffic reaches the API
```

In development mode (`NODE_ENV=development`), the mTLS check is bypassed. A warning is logged once on startup.

**Rejection response (403):**

```json
{
  "error": "mTLS certificate required",
  "details": {
    "hint": "Access to the Portlama panel requires a valid client certificate."
  }
}
```

### No Session Tokens

There are no login endpoints, no cookies, no bearer tokens. The client certificate is the sole authentication mechanism. If the certificate is valid, every request is authorized. This is the same model used by LXD.

## Content Type

All request and response bodies use `application/json` unless explicitly noted otherwise:

- **File downloads** (plist, certificates) return their native MIME type
- **File uploads** use `multipart/form-data`
- **WebSocket connections** use the standard WebSocket upgrade handshake

Requests with a JSON body must include the `Content-Type: application/json` header.

## Error Format

Every error response follows a consistent contract:

```json
{
  "error": "Human-readable error summary",
  "details": {}
}
```

| Field     | Type     | Presence | Description                                       |
| --------- | -------- | -------- | ------------------------------------------------- |
| `error`   | `string` | Always   | A short, human-readable error message             |
| `details` | `object` | Optional | Additional structured information about the error |

### Validation Errors (400)

All request bodies are validated with [Zod](https://zod.dev/) schemas at the route level. When validation fails, the error handler returns a 400 with the Zod issues:

```json
{
  "error": "Validation failed",
  "details": {
    "issues": [
      {
        "path": ["subdomain"],
        "message": "Subdomain must be lowercase alphanumeric with optional hyphens, cannot start or end with a hyphen"
      },
      {
        "path": ["port"],
        "message": "Port must be at least 1024"
      }
    ]
  }
}
```

### Operational Errors (4xx)

Business logic errors return appropriate HTTP status codes with descriptive messages:

```json
{
  "error": "Cannot delete the last user"
}
```

Common status codes:

| Code | Meaning                             | Example                                      |
| ---- | ----------------------------------- | -------------------------------------------- |
| 400  | Bad request / validation failed     | Invalid subdomain format                     |
| 403  | mTLS certificate missing or invalid | No client cert presented                     |
| 404  | Resource not found                  | Tunnel ID does not exist                     |
| 409  | Conflict                            | Username already exists                      |
| 410  | Gone                                | Onboarding endpoint called after completion  |
| 503  | Service unavailable                 | Management endpoint called before onboarding |

### Internal Errors (500)

Unexpected errors return a generic message in production to avoid leaking internal details:

```json
{
  "error": "Internal server error"
}
```

In development mode, the response includes a `details` object with the error message and stack trace.

## Onboarding Guard

The API is split into two groups with mutual exclusion enforced by middleware:

| Route Group    | Prefix                                           | Available When        | Otherwise Returns         |
| -------------- | ------------------------------------------------ | --------------------- | ------------------------- |
| **Onboarding** | `/api/onboarding/*`                              | `status != COMPLETED` | `410 Gone`                |
| **Management** | `/api/*` (except health, onboarding, and invite) | `status == COMPLETED` | `503 Service Unavailable` |
| **Public**     | `/api/invite/*`                                  | Always (no mTLS)      | N/A                       |

The `GET /api/onboarding/status` endpoint is always accessible regardless of onboarding state. The `GET /api/health` endpoint is also always accessible — it is registered outside both guards. The `/api/invite/*` routes are registered in a separate public context with no mTLS middleware and no onboarding guard.

**410 response (onboarding complete):**

```json
{
  "error": "Onboarding already completed"
}
```

**503 response (onboarding incomplete):**

```json
{
  "error": "Onboarding not complete",
  "onboardingStatus": "FRESH"
}
```

### Onboarding States

The onboarding progresses through a linear state machine:

```
FRESH → DOMAIN_SET → DNS_READY → PROVISIONING → COMPLETED
```

Each state transition is triggered by a specific API call and validated server-side. You cannot skip states.

## CORS Policy

Cross-Origin Resource Sharing is configured to accept requests from a single origin — the panel UI:

- **Before domain setup:** `https://<droplet-ip>:9292`
- **After domain setup:** `https://panel.<domain>`

Only one origin is active at a time (determined by whether a domain is configured). Requests from other origins are rejected by the CORS policy.

## WebSocket Connections

Two endpoints use WebSocket for real-time streaming:

| Endpoint                              | Purpose                  | Protocol      |
| ------------------------------------- | ------------------------ | ------------- |
| `WS /api/onboarding/provision/stream` | Provisioning progress    | JSON messages |
| `WS /api/services/:name/logs`         | Live service log tailing | JSON messages |
| `WS /api/shell/connect/:label`        | Admin shell relay        | JSON messages |
| `WS /api/shell/agent/:label`          | Agent shell relay        | JSON messages |

WebSocket connections follow the standard upgrade handshake over the same HTTPS connection. The `wss://` protocol is used in production since all traffic goes through nginx with TLS.

WebSocket messages are always JSON objects. There is no binary framing.

## Common Response Patterns

### Success with Data

Most GET endpoints return the requested resource directly:

```json
{
  "tunnels": [{ "id": "...", "subdomain": "app", "port": 8080 }]
}
```

### Success with Confirmation

Mutating endpoints typically return an `ok` field:

```json
{
  "ok": true,
  "tunnel": { "id": "...", "subdomain": "app", "port": 8080 }
}
```

### Success with Warning

Some operations succeed but produce a non-fatal warning (for example, nginx reload failure after certificate renewal):

```json
{
  "ok": true,
  "domain": "app.example.com",
  "newExpiry": "2026-06-11T00:00:00.000Z",
  "warning": "Certificate renewed but nginx reload failed"
}
```

## File Upload Limits

The server accepts multipart file uploads up to 50 MB per file, used by the static sites file management endpoints.

## Rate Limiting

There is no application-level rate limiting. The mTLS requirement means only authenticated administrators can reach the API, and the expected number of concurrent users is one or two. If you are self-hosting and want rate limits, configure them in nginx.

## Quick Reference

| Item                        | Value                                  |
| --------------------------- | -------------------------------------- |
| **Base URL (IP)**           | `https://<ip>:9292/api`                |
| **Base URL (domain)**       | `https://panel.<domain>/api`           |
| **Authentication**          | mTLS client certificate                |
| **Content-Type**            | `application/json` (default)           |
| **Validation**              | Zod schemas at route level             |
| **Error format**            | `{ "error": "...", "details": {...} }` |
| **WebSocket protocol**      | `wss://` with JSON messages            |
| **Max upload size**         | 50 MB per file                         |
| **Internal listen address** | `127.0.0.1:3100`                       |

### Endpoint Summary

| Method | Path                                      | Group      | Description                            |
| ------ | ----------------------------------------- | ---------- | -------------------------------------- |
| GET    | `/api/health`                             | Always     | Health check                           |
| GET    | `/api/onboarding/status`                  | Always     | Onboarding state                       |
| POST   | `/api/onboarding/domain`                  | Onboarding | Set domain and email                   |
| POST   | `/api/onboarding/verify-dns`              | Onboarding | Verify DNS records                     |
| POST   | `/api/onboarding/provision`               | Onboarding | Start provisioning                     |
| WS     | `/api/onboarding/provision/stream`        | Onboarding | Provisioning progress                  |
| GET    | `/api/invite/:token`                      | Public     | Get invitation details                 |
| POST   | `/api/invite/:token/accept`               | Public     | Accept invitation                      |
| GET    | `/api/system/stats`                       | Management | System statistics                      |
| GET    | `/api/tunnels`                            | Management | List tunnels                           |
| POST   | `/api/tunnels`                            | Management | Create tunnel                          |
| PATCH  | `/api/tunnels/:id`                        | Management | Toggle tunnel enabled/disabled         |
| DELETE | `/api/tunnels/:id`                        | Management | Delete tunnel                          |
| GET    | `/api/tunnels/mac-plist`                  | Management | Download Mac plist                     |
| GET    | `/api/sites`                              | Management | List static sites                      |
| POST   | `/api/sites`                              | Management | Create static site                     |
| DELETE | `/api/sites/:id`                          | Management | Delete static site                     |
| PATCH  | `/api/sites/:id`                          | Management | Update site settings                   |
| POST   | `/api/sites/:id/verify-dns`               | Management | Verify site DNS                        |
| GET    | `/api/sites/:id/files`                    | Management | List site files                        |
| POST   | `/api/sites/:id/files`                    | Management | Upload site files                      |
| DELETE | `/api/sites/:id/files`                    | Management | Delete site file                       |
| GET    | `/api/invitations`                        | Management | List invitations                       |
| POST   | `/api/invitations`                        | Management | Create invitation                      |
| DELETE | `/api/invitations/:id`                    | Management | Revoke invitation                      |
| GET    | `/api/users`                              | Management | List users                             |
| POST   | `/api/users`                              | Management | Create user                            |
| PUT    | `/api/users/:username`                    | Management | Update user                            |
| DELETE | `/api/users/:username`                    | Management | Delete user                            |
| POST   | `/api/users/:username/reset-totp`         | Management | Reset TOTP secret                      |
| GET    | `/api/certs`                              | Management | List certificates                      |
| GET    | `/api/certs/auto-renew-status`            | Management | Auto-renew timer status                |
| POST   | `/api/certs/:domain/renew`                | Management | Force-renew certificate                |
| POST   | `/api/certs/mtls/rotate`                  | Management | Rotate mTLS cert                       |
| GET    | `/api/certs/mtls/download`                | Management | Download client.p12                    |
| POST   | `/api/certs/agent`                        | Management | Generate agent certificate             |
| GET    | `/api/certs/agent`                        | Management | List agent certificates                |
| GET    | `/api/certs/agent/:label/download`        | Management | Download agent .p12                    |
| PATCH  | `/api/certs/agent/:label/capabilities`    | Management | Update agent capabilities              |
| PATCH  | `/api/certs/agent/:label/allowed-sites`   | Management | Update agent site access               |
| DELETE | `/api/certs/agent/:label`                 | Management | Revoke agent certificate               |
| GET    | `/api/services`                           | Management | List service statuses                  |
| POST   | `/api/services/:name/:action`             | Management | Control a service (start/stop/restart) |
| WS     | `/api/services/:name/logs`                | Management | Stream service logs                    |
| GET    | `/api/shell/config`                       | Management | Get shell configuration                |
| PATCH  | `/api/shell/config`                       | Management | Update shell configuration             |
| GET    | `/api/shell/policies`                     | Management | List shell policies                    |
| POST   | `/api/shell/policies`                     | Management | Create shell policy                    |
| PATCH  | `/api/shell/policies/:policyId`           | Management | Update shell policy                    |
| DELETE | `/api/shell/policies/:policyId`           | Management | Delete shell policy                    |
| POST   | `/api/shell/enable/:label`                | Management | Enable shell access for an agent       |
| DELETE | `/api/shell/enable/:label`                | Management | Disable shell access for an agent      |
| GET    | `/api/shell/sessions`                     | Management | List shell session audit log           |
| GET    | `/api/shell/recordings/:label`            | Management | List session recordings for an agent   |
| GET    | `/api/shell/recordings/:label/:sessionId` | Management | Download a session recording           |
| GET    | `/api/shell/file/:label`                  | Management | Download file from agent               |
| POST   | `/api/shell/file/:label`                  | Management | Upload file to agent                   |
| WS     | `/api/shell/connect/:label`               | Management | Admin WebSocket for shell relay        |
| WS     | `/api/shell/agent/:label`                 | Management | Agent WebSocket for shell relay        |
| GET    | `/api/plugins`                            | Management | List installed plugins                 |
| GET    | `/api/plugins/:name`                      | Management | Get plugin details                     |
| POST   | `/api/plugins/install`                    | Management | Install a plugin                       |
| POST   | `/api/plugins/:name/enable`               | Management | Enable a plugin                        |
| POST   | `/api/plugins/:name/disable`              | Management | Disable a plugin                       |
| DELETE | `/api/plugins/:name`                      | Management | Uninstall a plugin                     |
| GET    | `/api/plugins/push-install/config`        | Management | Get push install configuration         |
| PATCH  | `/api/plugins/push-install/config`        | Management | Update push install configuration      |
| GET    | `/api/plugins/push-install/policies`      | Management | List push install policies             |
| POST   | `/api/plugins/push-install/policies`      | Management | Create push install policy             |
| PATCH  | `/api/plugins/push-install/policies/:id`  | Management | Update push install policy             |
| DELETE | `/api/plugins/push-install/policies/:id`  | Management | Delete push install policy             |
| POST   | `/api/plugins/push-install/enable/:label` | Management | Enable push install for agent          |
| DELETE | `/api/plugins/push-install/enable/:label` | Management | Disable push install for agent         |
| GET    | `/api/plugins/push-install/agent-status`  | Management | Agent checks own push install status   |
| POST   | `/api/plugins/push-install/command/:label`| Management | Send push install command to agent     |
| GET    | `/api/plugins/push-install/sessions`      | Management | List push install audit log            |

### Agent Capabilities

Agent certificates use capability-based access control. Base capabilities are always available; plugins can declare additional capabilities in their manifest.

**Base capabilities:**

| Capability       | Description                                                     |
| ---------------- | --------------------------------------------------------------- |
| `tunnels:read`   | List tunnels, download Mac plist (always-on, cannot be removed) |
| `tunnels:write`  | Create and delete tunnels                                       |
| `services:read`  | View service status                                             |
| `services:write` | Start, stop, and restart services                               |
| `system:read`    | View system stats (CPU, RAM, disk)                              |
| `sites:read`     | List sites and browse files                                     |
| `sites:write`    | Upload and delete files on assigned sites                       |

**Plugin-declared capabilities:** Plugins can declare additional capabilities in their `portlama-plugin.json` manifest. These are merged with base capabilities and available for assignment to agent certificates. Capabilities are validated dynamically via `getValidCapabilities()`.
