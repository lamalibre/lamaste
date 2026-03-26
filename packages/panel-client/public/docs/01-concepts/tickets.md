# Tickets (Agent-to-Agent Authorization)

> Tickets are the authorization mechanism that allows one agent to securely communicate with another agent through Portlama's panel-mediated system, using scoped, time-limited, single-use tokens.

## In Plain English

Imagine two of your machines — a laptop and a desktop — both connected to Portlama as agents. You want the laptop to open a remote shell on the desktop. The laptop cannot simply connect directly; it needs permission. Tickets are how Portlama grants that permission.

The process works like getting a visitor badge at an office building:

1. **The receptionist knows who works here** — the panel knows which agents are registered and what they can do (scopes and instances).
2. **A visitor requests access** — the source agent asks the panel for a ticket to reach a specific instance on the target agent.
3. **The receptionist checks the list** — the panel verifies both agents have the right capabilities and the target is assigned to that instance.
4. **A one-time badge is issued** — the panel creates a ticket that expires in 30 seconds and can only be used once.
5. **The badge is verified at the door** — the target agent validates the ticket with the panel, consuming it.
6. **A session is established** — once the ticket is consumed, a persistent session tracks the connection with regular heartbeat re-validation.

## For Users

### Key Concepts

**Scopes** define what types of interactions are possible. A scope is registered by an admin (or future: by a plugin installer) and declares named capabilities like `shell:connect` or `file:transfer`. Each scope also declares transport preferences (tunnel, relay, or direct).

**Instances** are live registrations of an agent offering a specific scope. When your desktop agent starts its shell service, it registers an instance for `shell:connect`. The panel assigns it a unique instance ID and tracks its liveness via heartbeats.

**Assignments** link agents to instances. The admin assigns your laptop agent to the desktop's shell instance, granting it permission to request tickets for that specific instance.

**Tickets** are the actual authorization tokens. They are 256-bit random values, valid for 30 seconds, single-use, and bound to a specific source, target, scope, and instance.

**Sessions** track active connections after a ticket is consumed. The panel re-validates authorization on every heartbeat (every 60 seconds), checking that both agents' certificates are still valid, their capabilities are still present, and the assignment still exists.

### Two-Layer Isolation

The ticket system enforces authorization at two layers, both mediated by the panel:

1. **Certificate capability check** — both the source and target agents must have the base scope capability on their certificates
2. **Ticket binding** — the source must own the instance, and the target must be assigned to it

A third layer (transport CA) is available plugin-side for end-to-end verification, but is not enforced by the panel.

### Managing Tickets in the Panel

The Tickets page in the admin panel has five tabs:

- **Scopes** — view registered scopes, their capabilities, and transport configuration. Delete scopes you no longer need.
- **Instances** — see which agents have registered instances, their liveness status (active, stale, dead), and deregister instances.
- **Assignments** — assign agents to instances (granting them permission to receive tickets) and remove assignments.
- **Tickets** — view pending and used tickets. Revoke tickets that should not be used.
- **Sessions** — monitor active sessions between agents. Kill sessions if needed.

### Instance Liveness

Instance owners send heartbeats every 60 seconds to keep their instances alive:

| Status   | Condition              | Effect                                        |
| -------- | ---------------------- | --------------------------------------------- |
| Active   | Heartbeat within 5 min | Tickets can be requested                      |
| Stale    | No heartbeat for 5 min | New tickets rejected (503)                    |
| Dead     | No heartbeat for 1 hr  | Instance removed, assignments and sessions cleaned up |

### Rate Limits and Hard Caps

To protect the 512 MB server from resource exhaustion:

| Resource   | Limit | Enforcement                  |
| ---------- | ----- | ---------------------------- |
| Instances  | 200   | 503 on registration attempt  |
| Tickets    | 1000  | 503 on request               |
| Sessions   | 500   | 503 on creation              |
| Ticket rate | 10/min per agent | 429 on excess       |

## For Developers

### Authorization Flow

```
Source Agent                    Panel                     Target Agent
     │                           │                            │
     │  POST /tickets            │                            │
     │  {scope, instanceId,      │                            │
     │   target}                 │                            │
     │──────────────────────────▶│                            │
     │                           │ ── validate capabilities   │
     │                           │ ── check instance ownership│
     │                           │ ── check assignment        │
     │                           │ ── rate limit check        │
     │  { ticket }               │                            │
     │◀──────────────────────────│                            │
     │                           │                            │
     │           (out-of-band ticket delivery)                │
     │──────────────────────────────────────────────────────▶│
     │                           │                            │
     │                           │  POST /tickets/validate    │
     │                           │  {ticketId}                │
     │                           │◀───────────────────────────│
     │                           │ ── HMAC timing-safe compare │
     │                           │ ── mark as used            │
     │                           │  { valid, transport }      │
     │                           │───────────────────────────▶│
     │                           │                            │
     │                           │  POST /tickets/sessions    │
     │                           │  {ticketId}                │
     │                           │◀───────────────────────────│
     │                           │  { session }               │
     │                           │───────────────────────────▶│
     │                           │                            │
     │                      (heartbeat loop)                  │
     │                           │  POST /sessions/:id/       │
     │                           │    heartbeat               │
     │                           │◀───────────────────────────│
     │                           │ ── re-validate all layers  │
     │                           │  { authorized: true }      │
     │                           │───────────────────────────▶│
```

### Ticket Lifecycle

1. **Request** — source calls `POST /api/tickets` with scope, instanceId, and target agent label
2. **Multi-stage validation** — panel checks: source has capability, target has capability, source owns instance, instance is active (not stale/dead), source is not targeting itself, target is assigned to instance
3. **Issuance** — 256-bit random ticket ID (`crypto.randomBytes(32)`), 30-second expiry
4. **Delivery** — ticket appears in target's inbox (`GET /api/tickets/inbox`)
5. **Validation** — target calls `POST /api/tickets/validate` with the ticket ID; HMAC-based timing-safe comparison marks it as used atomically
6. **Session** — target reports session creation (`POST /api/tickets/sessions`) with only the ticket ID; the panel generates the session ID server-side (`crypto.randomBytes(16)`) and sets all timestamps server-side, then tracks with heartbeat re-validation
7. **Cleanup** — tickets expire after 1 hour (removed from store); dead sessions cleaned after 24 hours

### Server-Generated Session IDs and Timestamps

Session IDs are always generated server-side via `crypto.randomBytes(16).toString('hex')`. The client sends only the `ticketId` when creating a session; the server generates and returns the session ID. This guarantees uniqueness without trusting client input.

Similarly, `lastActivityAt` timestamps are always set server-side. The client cannot influence when a session was last active; heartbeats update the timestamp on the server when they arrive, not when the client claims to have sent them.

### Session Heartbeat Re-validation

Every heartbeat checks six conditions. If any fails, the session is terminated:

| Check                      | Termination reason     |
| -------------------------- | ---------------------- |
| Source cert revoked        | `source_revoked`       |
| Source lacks capability    | `capability_removed`   |
| Target cert revoked        | `target_revoked`       |
| Target lacks capability    | `capability_removed`   |
| Assignment removed         | `assignment_removed`   |
| Admin killed session       | `admin_killed`         |

### Information Leakage Prevention

Security-sensitive endpoints use generic error responses:

- `POST /api/tickets` — returns 404 for all authorization failures (no distinction between "target not found", "not assigned", or "instance dead"). The exception is stale instances, which return 503 to signal a retriable condition.
- `POST /api/tickets/validate` — returns 401 "Invalid ticket" for all failures (expired, used, wrong target, not found)
- `DELETE /api/tickets/instances/:id` — returns 404 for unauthorized deregistration attempts

Ticket validation uses HMAC-based timing-safe comparison to prevent timing attacks. Both the submitted and stored ticket IDs are HMAC-SHA256'd with a per-process random key before being compared with `crypto.timingSafeEqual`. The HMAC step produces fixed-length digests, eliminating the length-leak that raw `timingSafeEqual` would expose if inputs differed in length, and the per-process key prevents pre-computation attacks if an attacker gains read access to the source code.

### Host Validation (SSRF Prevention)

When an instance registers with a `direct` transport strategy, the `host` field is validated against a deny list of private, reserved, and metadata IP ranges. The following are rejected:

- Loopback: `localhost`, `127.0.0.1`, `::1`
- Private IPv4: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- Link-local: `169.254.0.0/16`
- Cloud metadata endpoints: `169.254.169.254`, `metadata.google.internal`
- Zero network: `0.0.0.0/8`

This prevents agents from using the ticket system to probe internal services on the panel's network (SSRF).

### Capability Integration

Ticket scopes register capabilities dynamically. When a scope like `shell` declares `scopes: [{ name: 'shell:connect' }]`, the capability `shell:connect` becomes available for assignment to agent certificates alongside base capabilities (`tunnels:read`, etc.) and plugin capabilities.

The integration flow:

1. `POST /api/tickets/scopes` registers the scope
2. `refreshTicketScopeCapabilities()` extracts capability names
3. `setTicketScopeCapabilitiesOnMtls()` updates the mTLS module
4. `getValidCapabilities()` now includes ticket scope capabilities
5. Agent certs can be assigned the new capabilities via the Certificates page

### Concurrency and Persistence

- **Mutex** — all state mutations use a promise-chain mutex (same pattern as enrollment tokens)
- **Atomic writes** — temp file, fsync, rename pattern prevents corruption
- **State files** — `/etc/portlama/ticket-scopes.json` (scope registry, instances, assignments) and `/etc/portlama/tickets.json` (tickets, sessions), both mode `0600`

### Data Model

**Scope registry** (`ticket-scopes.json`):

```json
{
  "scopes": [
    {
      "name": "shell",
      "version": "1.0.0",
      "description": "Remote shell access",
      "scopes": [
        { "name": "shell:connect", "description": "Connect to shell", "instanceScoped": true }
      ],
      "transport": {
        "strategies": ["tunnel", "direct"],
        "preferred": "tunnel",
        "port": 9000,
        "protocol": "wss"
      },
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

**Ticket store** (`tickets.json`):

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

### Client SDK (`@lamalibre/portlama-tickets`)

The `@lamalibre/portlama-tickets` package is a TypeScript SDK that provides the client-side ticket lifecycle for plugins and agents. It uses `undici` for HTTP with mTLS dispatcher support and has no other runtime dependencies.

The SDK exports three main classes:

- **`TicketClient`** — low-level HTTP client for all ticket API endpoints. Handles mTLS authentication, response validation (`assertObject`/`assertField` checks before type assertions), and structured error reporting via `TicketHttpError` (carries the HTTP status code for retriable vs. permanent error distinction).

- **`TicketInstanceManager`** (source side) — manages the full instance lifecycle: creates the mTLS dispatcher, registers an instance for a scope, heartbeats it every 60 seconds, requests tickets with a per-agent cooldown (default 120 seconds) to avoid exhausting the global ticket cap, and auto-re-registers on 404 (instance expired). On `stop()`, it deregisters the instance from the panel immediately rather than waiting for the heartbeat timeout.

- **`TicketSessionManager`** (target side) — manages the session lifecycle: polls the ticket inbox for matching tickets (filtering by scope, discarding tickets with less than 5 seconds remaining TTL, picking the freshest), validates them, creates sessions, heartbeats every 60 seconds, transitions through `waiting` / `authorized` / `grace` / `terminated` / `stopped` states, and notifies the consuming plugin via an `onStateChange` callback.

The dispatcher factory (`createTicketDispatcher`) supports both PEM (cert + key + CA files) and P12 (single .p12 bundle) certificate configurations.

### Source Files

| File                                                    | Purpose                                   |
| ------------------------------------------------------- | ----------------------------------------- |
| `packages/panel-server/src/lib/tickets.js`              | Business logic, validation, state management |
| `packages/panel-server/src/routes/management/tickets.js` | HTTP route handlers                       |
| `packages/panel-client/src/pages/management/Tickets.jsx` | Admin UI (5-tab interface)               |
| `packages/portlama-agent/src/lib/panel-api.js`          | Agent-side API functions                  |
| `packages/portlama-tickets/src/client.ts`               | SDK: mTLS HTTP client for ticket API      |
| `packages/portlama-tickets/src/instance-manager.ts`     | SDK: source-side instance lifecycle       |
| `packages/portlama-tickets/src/session-manager.ts`      | SDK: target-side session lifecycle        |
| `packages/portlama-tickets/src/types.ts`                | SDK: shared type definitions              |

## Quick Reference

### Ticket properties

| Property    | Value                             |
| ----------- | --------------------------------- |
| ID length   | 64 hex characters (256-bit)       |
| Expiry      | 30 seconds                        |
| Usage       | Single-use                        |
| Comparison  | HMAC-SHA256 + `crypto.timingSafeEqual` (per-process random key) |
| Rate limit  | 10 per agent per minute           |

### Instance lifecycle

| Event           | Status change    | Side effects                           |
| --------------- | ---------------- | -------------------------------------- |
| Registration    | → active         | Instance ID generated                  |
| Heartbeat       | stays active     | `lastHeartbeat` updated                |
| 5 min no beat   | → stale          | New tickets rejected                   |
| 1 hr no beat    | → dead           | Removed; assignments, tickets, sessions cleaned |
| Deregistration  | removed          | Same cleanup as dead; SDK calls `DELETE` on `stop()` |

### Session states

| State  | Meaning                                             |
| ------ | --------------------------------------------------- |
| active | Connection is live, heartbeats succeeding           |
| grace  | Temporary disconnection, within reconnect window    |
| dead   | Terminated (admin kill, validation failure, or 10 min inactivity timeout) |

### Related documentation

- [Security Model](security-model.md) — defense-in-depth and capability-based access
- [Certificates](certificates.md) — agent certificate capabilities
- [Tickets API](../04-api-reference/tickets.md) — complete endpoint reference
- [Config Files](../06-reference/config-files.md) — ticket state file formats
