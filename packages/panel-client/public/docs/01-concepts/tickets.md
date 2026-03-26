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
     │                           │ ── timing-safe compare     │
     │                           │ ── mark as used            │
     │                           │  { valid, transport }      │
     │                           │───────────────────────────▶│
     │                           │                            │
     │                           │  POST /tickets/sessions    │
     │                           │  {ticketId, sessionId}     │
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
5. **Validation** — target calls `POST /api/tickets/validate` with the ticket ID; timing-safe comparison marks it as used atomically
6. **Session** — target creates a session (`POST /api/tickets/sessions`); panel tracks with heartbeat re-validation
7. **Cleanup** — tickets expire after 1 hour (removed from store); dead sessions cleaned after 24 hours

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

Ticket validation uses `crypto.timingSafeEqual` to prevent timing attacks.

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
      "instanceScope": "shell:connect:a7f3b2c9d1e2f3a4",
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
      "instanceId": "a7f3b2c9d1e2f3a4",
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
      "sessionId": "session-id",
      "ticketId": "64-hex-char-ticket-id",
      "scope": "shell:connect",
      "instanceId": "a7f3b2c9d1e2f3a4",
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

### Source Files

| File                                                    | Purpose                                   |
| ------------------------------------------------------- | ----------------------------------------- |
| `packages/panel-server/src/lib/tickets.js`              | Business logic, validation, state management |
| `packages/panel-server/src/routes/management/tickets.js` | HTTP route handlers                       |
| `packages/panel-client/src/pages/management/Tickets.jsx` | Admin UI (5-tab interface)               |
| `packages/portlama-agent/src/lib/panel-api.js`          | Agent-side API functions                  |

## Quick Reference

### Ticket properties

| Property    | Value                             |
| ----------- | --------------------------------- |
| ID length   | 64 hex characters (256-bit)       |
| Expiry      | 30 seconds                        |
| Usage       | Single-use                        |
| Comparison  | Timing-safe (`crypto.timingSafeEqual`) |
| Rate limit  | 10 per agent per minute           |

### Instance lifecycle

| Event           | Status change    | Side effects                           |
| --------------- | ---------------- | -------------------------------------- |
| Registration    | → active         | Instance ID generated                  |
| Heartbeat       | stays active     | `lastHeartbeat` updated                |
| 5 min no beat   | → stale          | New tickets rejected                   |
| 1 hr no beat    | → dead           | Removed; assignments, tickets, sessions cleaned |
| Deregistration  | removed          | Same cleanup as dead                   |

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
