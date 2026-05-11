# Services API

> Monitor and control the systemd services that make up the Lamaste stack, with live log streaming via WebSocket.

## In Plain English

Lamaste runs several background services on the droplet: nginx (the reverse proxy), Chisel (the tunnel server), Authelia (the login system for tunneled apps), and the panel server itself. The services API lets you check whether each service is running, start or stop them, restart them, and watch their log output in real time.

Think of it as a simplified version of the `systemctl` and `journalctl` commands, accessible from your browser.

## Authentication

All service endpoints require a valid mTLS client certificate and a completed onboarding. See the [API Overview](./overview.md) for details.

If onboarding is not complete, all endpoints return `503 Service Unavailable`.

In addition to admin certificates, agent certificates with the appropriate capabilities can access these endpoints:

- `services:read` — grants access to `GET /api/services` (list statuses)
- `services:write` — grants access to `POST /api/services/:name/:action` (control services)

## Service Whitelist

Only these services can be managed through the API:

| Service Name                | Description                                      |
| --------------------------- | ------------------------------------------------ |
| `nginx`                     | Reverse proxy, TLS termination, mTLS enforcement |
| `chisel`                    | WebSocket tunnel server                          |
| `authelia`                  | TOTP two-factor authentication                   |
| `lamalibre-lamaste-serverd` | The panel server itself (Fastify)                |

Requests for any other service name are rejected with a 400 error. This whitelist prevents arbitrary systemd service manipulation.

## Safety Rules

- **Cannot stop the panel from the UI.** Calling `POST /api/services/lamalibre-lamaste-serverd/stop` returns a 400 error because stopping the panel would terminate the API session — you would lose the ability to restart it without SSH access.
- **All actions use sudo.** The panel runs as the `lamaste` user. Service control commands use `sudo systemctl` via sudoers rules that restrict which services and actions are permitted.

## Endpoints

### `GET /api/services`

Returns the status and uptime of all managed services. Statuses are queried in parallel from systemd.

**Request:**

No request body.

```bash
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/services | jq
```

**Response (200):**

```json
{
  "services": [
    {
      "name": "nginx",
      "status": "active",
      "uptime": "5d 3h 20m"
    },
    {
      "name": "chisel",
      "status": "active",
      "uptime": "5d 3h 19m"
    },
    {
      "name": "authelia",
      "status": "active",
      "uptime": "5d 3h 18m"
    },
    {
      "name": "lamalibre-lamaste-serverd",
      "status": "active",
      "uptime": "2h 45m"
    }
  ]
}
```

| Field    | Type             | Description                                                          |
| -------- | ---------------- | -------------------------------------------------------------------- |
| `name`   | `string`         | systemd service name                                                 |
| `status` | `string`         | One of: `active`, `inactive`, `failed`, `unknown`                    |
| `uptime` | `string \| null` | Human-readable uptime (e.g., `"2d 5h 30m"`), or `null` if not active |

The uptime is calculated from the `ActiveEnterTimestamp` reported by systemd and formatted as a human-readable duration. If the timestamp cannot be read, uptime is `null` even for active services.

---

### `POST /api/services/:name/:action`

Executes a systemctl action on a managed service. The command runs with a 30-second timeout.

**URL parameters:**

| Parameter | Type     | Validation                                   | Description        |
| --------- | -------- | -------------------------------------------- | ------------------ |
| `:name`   | `string` | Must be in the service whitelist             | Service to control |
| `:action` | `string` | One of: `start`, `stop`, `restart`, `reload` | Action to execute  |

```bash
curl -s --cert client.p12:password \
  -X POST \
  https://203.0.113.42:9292/api/services/nginx/restart | jq
```

**Response (200):**

```json
{
  "ok": true,
  "name": "nginx",
  "action": "restart"
}
```

**Errors:**

| Status | Body                                                                                      | When                                           |
| ------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 400    | `{"error":"Unknown service"}`                                                             | Service name not in whitelist                  |
| 400    | `{"error":"Invalid action"}`                                                              | Action not one of start/stop/restart/reload    |
| 400    | `{"error":"Cannot stop the panel service from the UI — it would terminate this session"}` | Attempting to stop `lamalibre-lamaste-serverd` |
| 400    | `{"error":"Validation failed","details":{"issues":[...]}}`                                | Zod validation of params failed                |
| 500    | `{"error":"Failed to restart nginx","details":"..."}`                                     | systemctl command failed                       |

### Available Actions

| Action    | systemctl Command               | Notes                                                                       |
| --------- | ------------------------------- | --------------------------------------------------------------------------- |
| `start`   | `sudo systemctl start <name>`   | Start a stopped service                                                     |
| `stop`    | `sudo systemctl stop <name>`    | Stop a running service (blocked for `lamalibre-lamaste-serverd`)            |
| `restart` | `sudo systemctl restart <name>` | Stop then start a service                                                   |
| `reload`  | `sudo systemctl reload <name>`  | Reload configuration without full restart (supported by nginx and authelia) |

---

### `WS /api/services/:name/logs`

WebSocket endpoint that streams live logs from journalctl for a specific service. The connection tails the last 100 log lines and then follows new output in real time.

**URL parameters:**

| Parameter | Type     | Validation                       | Description              |
| --------- | -------- | -------------------------------- | ------------------------ |
| `:name`   | `string` | Must be in the service whitelist | Service to tail logs for |

If the service name is not in the whitelist, the WebSocket is closed immediately with code 1008 ("Policy Violation") and the reason "Unknown service".

**Connection:**

```javascript
const ws = new WebSocket('wss://203.0.113.42:9292/api/services/nginx/logs');

ws.onmessage = (event) => {
  const entry = JSON.parse(event.data);
  console.log(`[${entry.timestamp}] ${entry.message}`);
};

ws.onclose = (event) => {
  console.log(`Log stream closed: ${event.reason}`);
};
```

**Message format:**

Each message is a JSON object with a timestamp and message:

```json
{
  "timestamp": "2026-03-13T14:30:45+0000",
  "message": "hostname nginx[1234]: 203.0.113.42 - - [13/Mar/2026:14:30:45 +0000] \"GET /api/health HTTP/1.1\" 200 32"
}
```

| Field       | Type     | Description                                                    |
| ----------- | -------- | -------------------------------------------------------------- |
| `timestamp` | `string` | ISO timestamp from journalctl `--output=short-iso` format      |
| `message`   | `string` | The rest of the log line (hostname, process, PID, and message) |

If the timestamp cannot be parsed from the log line, `timestamp` is an empty string and `message` contains the entire raw line.

**Special messages:**

```json
{
  "timestamp": "2026-03-13T14:30:45.000Z",
  "message": "[Error: Failed to start log stream for nginx]"
}
```

```json
{
  "timestamp": "2026-03-13T14:30:45.000Z",
  "message": "[Log stream ended]"
}
```

**Close codes:**

| Code | Reason                     | When                                   |
| ---- | -------------------------- | -------------------------------------- |
| 1000 | Log stream ended           | journalctl process exited normally     |
| 1008 | Unknown service            | Service name not in whitelist          |
| 1011 | Failed to spawn journalctl | Could not start the journalctl process |

**Implementation details:**

- Uses `journalctl -u <name> -f -n 100 --output=short-iso`
- The `-n 100` flag sends the last 100 log lines on connect (backfill)
- The `-f` flag follows new output in real time
- The journalctl process is killed (SIGTERM) when the WebSocket closes
- All active journalctl processes are cleaned up on server shutdown

## Quick Reference

| Method | Path                          | Description                           |
| ------ | ----------------------------- | ------------------------------------- |
| GET    | `/api/services`               | List all service statuses and uptimes |
| POST   | `/api/services/:name/:action` | Execute start/stop/restart/reload     |
| WS     | `/api/services/:name/logs`    | Stream live logs via WebSocket        |

### Service Status Object Shape

```json
{
  "name": "nginx",
  "status": "active",
  "uptime": "5d 3h 20m"
}
```

### Allowed Combinations

| Service                     | start | stop   | restart | reload |
| --------------------------- | ----- | ------ | ------- | ------ |
| `nginx`                     | Yes   | Yes    | Yes     | Yes    |
| `chisel`                    | Yes   | Yes    | Yes     | Yes    |
| `authelia`                  | Yes   | Yes    | Yes     | Yes    |
| `lamalibre-lamaste-serverd` | Yes   | **No** | Yes     | Yes    |

### curl Cheat Sheet

```bash
# List service statuses
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/services | jq

# Restart nginx
curl -s --cert client.p12:password \
  -X POST \
  https://203.0.113.42:9292/api/services/nginx/restart | jq

# Reload Authelia (after manual config changes)
curl -s --cert client.p12:password \
  -X POST \
  https://203.0.113.42:9292/api/services/authelia/reload | jq

# Stream nginx logs (requires wscat or similar)
wscat -c wss://203.0.113.42:9292/api/services/nginx/logs \
  --cert client.pem --key client-key.pem
```
