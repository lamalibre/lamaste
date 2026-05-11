# System API

> Health checks and system resource monitoring for the Lamaste droplet.

## In Plain English

The system API provides two things: a simple health check that confirms the panel server is running, and a statistics endpoint that reports CPU usage, memory, disk space, and how long the server has been up. The management dashboard uses the stats endpoint to display real-time system resource information.

## Authentication

The **health endpoint** (`GET /api/health`) does **not** require mTLS authentication. It is publicly accessible to any client that can reach the panel server. This allows external monitoring tools and the provisioning process to verify the panel is running without needing a client certificate.

The **system stats endpoint** (`GET /api/system/stats`) requires a valid mTLS client certificate and a completed onboarding. Admin certificates and agent certificates with the `system:read` capability can access it. See the [API Overview](./overview.md) for details.

## Endpoints

### `GET /api/health`

A lightweight health check that confirms the panel server is running and responding to requests. Returns the current version number read from `package.json`.

This endpoint has no onboarding guard — it is accessible at any point in the server's lifecycle. It is useful for monitoring and for the provisioning step that verifies the panel is running.

**Request:**

No request body.

```bash
# No client certificate required
curl -sk https://203.0.113.42:9292/api/health | jq
```

**Response (200):**

```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

| Field     | Type     | Description                                                        |
| --------- | -------- | ------------------------------------------------------------------ |
| `status`  | `string` | Always `"ok"` if the server is responding                          |
| `version` | `string` | Panel server version from `package.json` (falls back to `"0.0.0"`) |

This endpoint has no error cases — if the server is running, it returns 200.

---

### `GET /api/system/stats`

Returns current system resource usage. The data is gathered using the `systeminformation` library and cached for 2 seconds to prevent excessive system calls when multiple clients poll simultaneously.

**Request:**

No request body.

```bash
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/system/stats | jq
```

**Response (200):**

```json
{
  "cpu": {
    "usage": 12.5,
    "cores": 1
  },
  "memory": {
    "total": 536870912,
    "used": 268435456,
    "free": 268435456
  },
  "disk": {
    "total": 26843545600,
    "used": 5368709120,
    "free": 21474836480
  },
  "uptime": 432000
}
```

| Field          | Type     | Unit    | Description                                             |
| -------------- | -------- | ------- | ------------------------------------------------------- |
| `cpu.usage`    | `number` | Percent | Current CPU utilization (0-100), rounded to one decimal |
| `cpu.cores`    | `number` | Count   | Number of CPU cores                                     |
| `memory.total` | `number` | Bytes   | Total physical RAM                                      |
| `memory.used`  | `number` | Bytes   | Used RAM                                                |
| `memory.free`  | `number` | Bytes   | Free RAM                                                |
| `disk.total`   | `number` | Bytes   | Total disk space on root filesystem                     |
| `disk.used`    | `number` | Bytes   | Used disk space on root filesystem                      |
| `disk.free`    | `number` | Bytes   | Free disk space on root filesystem                      |
| `uptime`       | `number` | Seconds | System uptime since last boot                           |

**Example values for a typical 512MB droplet:**

| Metric         | Typical Value | Human-Readable |
| -------------- | ------------- | -------------- |
| `memory.total` | `536870912`   | 512 MB         |
| `memory.used`  | `260046848`   | ~248 MB        |
| `disk.total`   | `26843545600` | 25 GB          |
| `cpu.cores`    | `1`           | 1 vCPU         |
| `uptime`       | `432000`      | 5 days         |

**Errors:**

| Status | Body                                                             | When                                    |
| ------ | ---------------------------------------------------------------- | --------------------------------------- |
| 500    | `{"error":"Failed to retrieve system stats"}`                    | `systeminformation` library call failed |
| 503    | `{"error":"Onboarding not complete","onboardingStatus":"FRESH"}` | Onboarding has not finished             |

---

### `POST /api/system/update`

Triggers a background update of the Lamaste panel server to the specified version. The update is executed asynchronously via `systemd-run` so that the panel server process can restart without terminating the update.

**Authentication:** Admin-only. Agent certificates cannot trigger updates.

**Request:**

```json
{
  "version": "1.0.43"
}
```

| Field     | Type     | Required | Description                            |
| --------- | -------- | -------- | -------------------------------------- |
| `version` | `string` | Yes      | Target version to update to (e.g., `"1.0.43"`) |

```bash
curl -s --cert client.p12:password \
  -X POST -H 'Content-Type: application/json' \
  -d '{"version":"1.0.43"}' \
  https://203.0.113.42:9292/api/system/update | jq
```

**Response (202):**

```json
{
  "ok": true,
  "message": "Update to create-lamaste@1.0.43 initiated. The panel will restart shortly."
}
```

The 202 status indicates the update has been accepted and is running in the background. The panel server will restart as part of the update process, so the client should expect the connection to drop and poll `/api/health` to detect when the new version is running.

**Errors:**

| Status | Body                                                             | When                                    |
| ------ | ---------------------------------------------------------------- | --------------------------------------- |
| 400    | `{"error":"Validation failed","details":{"issues":[...]}}`       | Missing or invalid `version` field      |
| 403    | `{"error":"Insufficient certificate scope"}`                     | Non-admin certificate                   |
| 503    | `{"error":"Onboarding not complete","onboardingStatus":"FRESH"}` | Onboarding has not finished             |

---

### `POST /api/agents/plugins/report`

Accepts a plugin capability report from an agent. Called by `lamaste-agent update` to inform the server about plugins the agent has enabled. The server merges the reported capabilities into the valid capabilities set so they can be assigned to agents.

**Authentication:** mTLS (admin or agent certificate).

**Request:**

```json
{
  "plugins": [
    {
      "name": "sync",
      "version": "0.1.0",
      "capabilities": ["sync:connect"]
    }
  ]
}
```

| Field                      | Type     | Required | Description                        |
| -------------------------- | -------- | -------- | ---------------------------------- |
| `plugins`                  | `array`  | Yes      | List of enabled plugins            |
| `plugins[].name`           | `string` | Yes      | Plugin name from manifest          |
| `plugins[].version`        | `string` | Yes      | Plugin version                     |
| `plugins[].capabilities`   | `array`  | No       | Capability strings (defaults `[]`) |

**Response (200):**

```json
{
  "ok": true,
  "merged": 1
}
```

| Field    | Type     | Description                                     |
| -------- | -------- | ----------------------------------------------- |
| `ok`     | `boolean`| Always `true` on success                        |
| `merged` | `number` | Number of unique capabilities merged             |

---

### Caching Behavior

The stats response is cached for 2 seconds. Multiple requests within the cache window return the same data without querying the operating system again. This prevents performance degradation when the dashboard polls frequently or multiple browser tabs are open.

## Quick Reference

| Method | Path                          | Auth                                     | Description                    |
| ------ | ----------------------------- | ---------------------------------------- | ------------------------------ |
| GET    | `/api/health`                 | None (no mTLS)                           | Health check with version      |
| GET    | `/api/system/stats`           | mTLS (admin or agent with `system:read`) | CPU, memory, disk, uptime      |
| POST   | `/api/system/update`          | mTLS (admin only)                        | Trigger background update      |
| POST   | `/api/agents/plugins/report`  | mTLS (admin or agent)                    | Report agent plugin capabilities |

### Response Shapes

**Health:**

```json
{ "status": "ok", "version": "0.1.0" }
```

**Stats:**

```json
{
  "cpu": { "usage": 12.5, "cores": 1 },
  "memory": { "total": 536870912, "used": 268435456, "free": 268435456 },
  "disk": { "total": 26843545600, "used": 5368709120, "free": 21474836480 },
  "uptime": 432000
}
```

### Converting Bytes to Human-Readable

The API returns all size values in raw bytes. To convert:

| Bytes         | Formula                | Result |
| ------------- | ---------------------- | ------ |
| `536870912`   | `/ 1024 / 1024`        | 512 MB |
| `26843545600` | `/ 1024 / 1024 / 1024` | 25 GB  |

### curl Cheat Sheet

```bash
# Health check (no mTLS required)
curl -sk https://203.0.113.42:9292/api/health | jq

# System stats
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/system/stats | jq

# Just CPU usage
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/system/stats | jq '.cpu.usage'

# Memory in MB
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/system/stats | jq '{
    total_mb: (.memory.total / 1048576 | round),
    used_mb: (.memory.used / 1048576 | round),
    free_mb: (.memory.free / 1048576 | round)
  }'
```
