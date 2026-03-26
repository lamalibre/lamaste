# Tickets API

> Endpoints for managing agent-to-agent authorization: scope registration, instance management, assignments, ticket operations, and session management.

## Authentication

All ticket endpoints require mTLS authentication. Endpoints marked "Admin" require an admin certificate. Endpoints marked "Admin/Agent" accept both admin certificates and agent certificates with the appropriate capability.

Agent-facing endpoints use generic error messages (404 or 401) for all authorization failures to prevent information leakage.

## Scope Management

### Register Scope

```
POST /api/tickets/scopes
```

**Auth:** Admin only

Register a new ticket scope (capability set with transport configuration).

**Request body:**

| Field                      | Type     | Required | Description                                |
| -------------------------- | -------- | -------- | ------------------------------------------ |
| `name`                     | string   | Yes      | Lowercase alphanumeric with hyphens (1-50 chars). Cannot use reserved names (`tunnels`, `plugins`, `health`, `tickets`, etc.) |
| `version`                  | string   | Yes      | Version string (1-50 chars)                |
| `description`              | string   | Yes      | Human-readable description (1-500 chars)   |
| `scopes`                   | array    | Yes      | Capability declarations (1-50 items)       |
| `scopes[].name`            | string   | Yes      | Capability name (e.g., `shell:connect`)    |
| `scopes[].description`     | string   | Yes      | What this capability grants                |
| `scopes[].instanceScoped`  | boolean  | Yes      | Whether tickets are scoped to instances    |
| `transport`                | object   | Yes      | Transport configuration                    |
| `transport.strategies`     | string[] | Yes      | Array of `"tunnel"`, `"relay"`, `"direct"` |
| `transport.preferred`      | string   | Yes      | Preferred strategy                         |
| `transport.port`           | number   | Yes      | Port number (0 or 1024-65535)              |
| `transport.protocol`       | string   | Yes      | `"wss"` or `"tcp"`                         |

**Response (201):**

```json
{
  "ok": true,
  "registered": ["shell:connect"]
}
```

**Errors:** 409 (scope name already registered), 500 (internal error)

---

### List Scopes

```
GET /api/tickets/scopes
```

**Auth:** Admin only

Returns all registered scopes, instances, and assignments.

**Response (200):**

```json
{
  "scopes": [...],
  "instances": [...],
  "assignments": [...]
}
```

---

### Delete Scope

```
DELETE /api/tickets/scopes/:name
```

**Auth:** Admin only

Unregisters a scope and removes its capabilities from the valid capability set.

**Response (200):**

```json
{
  "ok": true,
  "name": "shell"
}
```

**Errors:** 404 (scope not found), 500 (internal error)

---

## Instance Management

### Register Instance

```
POST /api/tickets/instances
```

**Auth:** Admin or Agent (requires base scope capability)

Register an instance offering a specific scope. Idempotent: re-registration with the same scope and agent updates transport and resets the heartbeat.

**Request body:**

| Field                     | Type     | Required | Description                                |
| ------------------------- | -------- | -------- | ------------------------------------------ |
| `scope`                   | string   | Yes      | Capability name (e.g., `shell:connect`)    |
| `transport`               | object   | Yes      | Transport configuration                    |
| `transport.strategies`    | string[] | Yes      | Array of `"tunnel"`, `"relay"`, `"direct"` |
| `transport.preferred`     | string   | No       | Preferred strategy                         |
| `transport.direct`        | object   | No       | Direct connection details (host, port)     |

**Response (201 new, 200 re-registration):**

```json
{
  "ok": true,
  "instanceId": "a7f3b2c9d1e2f3a4b5c6d7e8f9a0b1c2",
  "instanceScope": "shell:connect:a7f3b2c9d1e2f3a4b5c6d7e8f9a0b1c2"
}
```

**Errors:** 403 (insufficient capability), 404 (scope not found), 503 (hard cap: 200 instances)

---

### Deregister Instance

```
DELETE /api/tickets/instances/:instanceId
```

**Auth:** Admin or owning Agent

Removes an instance and cleans up related assignments, tickets, and sessions.

**Params:** `instanceId` — hex string (1-128 chars)

**Response (200):**

```json
{
  "ok": true,
  "instanceId": "a7f3b2c9d1e2f3a4b5c6d7e8f9a0b1c2"
}
```

**Errors:** 404 (not found or unauthorized — same response for both)

---

### Instance Heartbeat

```
POST /api/tickets/instances/:instanceId/heartbeat
```

**Auth:** Admin or owning Agent

Updates the instance's `lastHeartbeat` timestamp and maintains active status.

**Response (200):**

```json
{
  "ok": true
}
```

**Errors:** 404 (not found)

---

## Assignment Management

### Create Assignment

```
POST /api/tickets/assignments
```

**Auth:** Admin only

Assign an agent to an instance scope, granting it permission to receive tickets for that instance.

**Request body:**

| Field           | Type   | Required | Description                                        |
| --------------- | ------ | -------- | -------------------------------------------------- |
| `agentLabel`    | string | Yes      | Agent certificate label (1-100 chars)              |
| `instanceScope` | string | Yes     | Format: `scope:action:instanceid` (1-200 chars)   |

**Validation:**
- Agent must exist and not be revoked
- Agent must have the base scope capability
- Instance must exist and not be dead

**Response (201 new, 200 existing):**

```json
{
  "ok": true,
  "assignment": {
    "agentLabel": "linux-agent",
    "instanceScope": "shell:connect:a7f3b2c9d1e2f3a4",
    "assignedAt": "2026-03-26T10:10:00.000Z",
    "assignedBy": "admin"
  }
}
```

**Errors:** 400 (agent missing capability), 404 (agent or instance not found)

---

### Delete Assignment

```
DELETE /api/tickets/assignments/:agentLabel/:instanceScope
```

**Auth:** Admin only

**Response (200):**

```json
{
  "ok": true
}
```

**Errors:** 404 (assignment not found)

---

### List Assignments

```
GET /api/tickets/assignments
```

**Auth:** Admin only

**Query params:** `agentLabel` (optional), `instanceScope` (optional) — filters.

**Response (200):**

```json
{
  "assignments": [...]
}
```

---

## Ticket Operations

### Request Ticket

```
POST /api/tickets
```

**Auth:** Admin or Agent (requires base scope capability)

Request a ticket to authorize communication with a target agent.

**Request body:**

| Field        | Type   | Required | Description                          |
| ------------ | ------ | -------- | ------------------------------------ |
| `scope`      | string | Yes      | Capability name                      |
| `instanceId` | string | Yes      | Hex instance ID (1-64 chars)         |
| `target`     | string | Yes      | Target agent label (1-100 chars)     |

**Multi-stage validation:**
1. Source agent has base scope capability
2. Target agent has base scope capability and is not revoked
3. Source owns the instance
4. Instance is active (not stale or dead)
5. Source and target are different agents (self-tickets rejected)
6. Target is assigned to the instance

**Response (201):**

```json
{
  "ok": true,
  "ticket": {
    "id": "64-hex-char-ticket-id",
    "scope": "shell:connect",
    "instanceId": "a7f3b2c9d1e2f3a4",
    "source": "macbook-pro",
    "target": "linux-agent",
    "expiresAt": "2026-03-26T10:15:30.000Z"
  }
}
```

**Errors:** 404 (generic — all authorization failures), 429 (rate limit: 10/min per agent), 503 (stale instance or hard cap: 1000 tickets)

---

### Check Inbox

```
GET /api/tickets/inbox
```

**Auth:** Admin or Agent (requires `certLabel`)

Returns non-expired, unused tickets where the caller is the target.

**Response (200):**

```json
{
  "tickets": [
    {
      "id": "...",
      "scope": "shell:connect",
      "instanceId": "a7f3b2c9d1e2f3a4",
      "source": "macbook-pro",
      "expiresAt": "2026-03-26T10:15:30.000Z",
      "transport": {}
    }
  ]
}
```

**Errors:** 400 (missing certLabel)

---

### Validate Ticket

```
POST /api/tickets/validate
```

**Auth:** Admin or Agent (requires `certLabel`)

Validate and consume a ticket. This is an atomic operation — the ticket is marked as used on successful validation.

**Request body:**

| Field      | Type   | Required | Description                     |
| ---------- | ------ | -------- | ------------------------------- |
| `ticketId` | string | Yes      | Hex ticket ID (1-128 chars)     |

**Response (200):**

```json
{
  "valid": true,
  "scope": "shell:connect",
  "instanceId": "a7f3b2c9d1e2f3a4",
  "source": "macbook-pro",
  "target": "linux-agent",
  "transport": {}
}
```

**Errors:** 401 (generic "Invalid ticket" — covers expired, used, wrong target, not found)

---

### List Tickets (Admin)

```
GET /api/tickets
```

**Auth:** Admin only

Returns all tickets (including expired and used).

**Response (200):**

```json
{
  "tickets": [...]
}
```

---

### Revoke Ticket

```
DELETE /api/tickets/:ticketId
```

**Auth:** Admin only

Marks a ticket as used and terminates any associated session.

**Response (200):**

```json
{
  "ok": true
}
```

**Errors:** 404 (ticket not found)

---

## Session Management

### Create Session

```
POST /api/tickets/sessions
```

**Auth:** Admin or Agent (requires `certLabel`)

Create a session from a validated (used) ticket. The caller must be the ticket's target.

**Request body:**

| Field       | Type   | Required | Description                                    |
| ----------- | ------ | -------- | ---------------------------------------------- |
| `ticketId`  | string | Yes      | Hex ticket ID (1-128 chars)                    |
| `sessionId` | string | Yes      | Caller-chosen session ID (1-128 chars, alphanumeric + `-_`) |

**Response (201):**

```json
{
  "ok": true,
  "session": {
    "sessionId": "...",
    "ticketId": "...",
    "scope": "shell:connect",
    "instanceId": "a7f3b2c9d1e2f3a4",
    "source": "macbook-pro",
    "target": "linux-agent",
    "createdAt": "2026-03-26T10:15:30.000Z",
    "lastActivityAt": "2026-03-26T10:15:30.000Z",
    "status": "active",
    "reconnectGraceSeconds": 60
  }
}
```

**Errors:** 400 (invalid ticket state), 409 (duplicate session for ticket), 503 (hard cap: 500 sessions)

---

### Session Heartbeat

```
POST /api/tickets/sessions/:sessionId/heartbeat
```

**Auth:** Admin or Agent (requires `certLabel`)

Re-validates the session's authorization and updates activity timestamp.

**Validation checks:**
1. Session is not dead
2. Source certificate not revoked
3. Source has scope capability
4. Target certificate not revoked
5. Target has scope capability
6. Assignment still valid

**Response (200):**

```json
{
  "authorized": true
}
```

Or if authorization failed:

```json
{
  "authorized": false,
  "reason": "capability_removed"
}
```

**Errors:** 404 (session not found)

---

### Update Session

```
PATCH /api/tickets/sessions/:sessionId
```

**Auth:** Admin or Agent (requires `certLabel`)

Update session status (e.g., entering grace period for reconnection).

**Request body:**

| Field            | Type   | Required | Description                        |
| ---------------- | ------ | -------- | ---------------------------------- |
| `status`         | string | Yes      | `"active"` or `"grace"`           |
| `lastActivityAt` | string | No       | ISO 8601 datetime                  |

**Response (200):**

```json
{
  "ok": true
}
```

**Errors:** 404 (session not found), 409 (cannot reactivate dead session)

---

### Kill Session

```
DELETE /api/tickets/sessions/:sessionId
```

**Auth:** Admin only

Immediately terminates a session.

**Response (200):**

```json
{
  "ok": true
}
```

**Errors:** 404 (session not found)

---

### List Sessions

```
GET /api/tickets/sessions
```

**Auth:** Admin only

Returns all sessions (including dead ones pending cleanup).

**Response (200):**

```json
{
  "sessions": [...]
}
```

---

## Rate Limiting

Ticket requests are rate-limited to **10 per agent per minute**. The rate counter uses a 1-minute window with periodic cleanup every 2 minutes. Exceeding the limit returns:

```json
{
  "error": "Rate limit exceeded"
}
```

with HTTP 429.

## Hard Caps

Resource limits protect the 512 MB server:

| Resource          | Max   | HTTP response when exceeded |
| ----------------- | ----- | --------------------------- |
| Instances         | 200   | 503                         |
| Tickets           | 1000  | 503                         |
| Active sessions   | 500   | 503                         |

## Cleanup Timers

The panel server runs periodic cleanup (every 60 seconds):

| Item              | Condition                  | Action                                      |
| ----------------- | -------------------------- | ------------------------------------------- |
| Stale instances   | No heartbeat for 5 min     | Status → stale (tickets rejected)           |
| Dead instances    | No heartbeat for 1 hr      | Removed with assignments, tickets, sessions |
| Expired tickets   | Older than 1 hr            | Removed from store                          |
| Dead sessions     | Dead for 24 hr             | Removed from store                          |
