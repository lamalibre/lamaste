# System API

> Health checks and system resource monitoring for the Portlama droplet.

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

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `"ok"` if the server is responding |
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

| Field | Type | Unit | Description |
|-------|------|------|-------------|
| `cpu.usage` | `number` | Percent | Current CPU utilization (0-100), rounded to one decimal |
| `cpu.cores` | `number` | Count | Number of CPU cores |
| `memory.total` | `number` | Bytes | Total physical RAM |
| `memory.used` | `number` | Bytes | Used RAM |
| `memory.free` | `number` | Bytes | Free RAM |
| `disk.total` | `number` | Bytes | Total disk space on root filesystem |
| `disk.used` | `number` | Bytes | Used disk space on root filesystem |
| `disk.free` | `number` | Bytes | Free disk space on root filesystem |
| `uptime` | `number` | Seconds | System uptime since last boot |

**Example values for a typical 512MB droplet:**

| Metric | Typical Value | Human-Readable |
|--------|---------------|----------------|
| `memory.total` | `536870912` | 512 MB |
| `memory.used` | `260046848` | ~248 MB |
| `disk.total` | `26843545600` | 25 GB |
| `cpu.cores` | `1` | 1 vCPU |
| `uptime` | `432000` | 5 days |

**Errors:**

| Status | Body | When |
|--------|------|------|
| 500 | `{"error":"Failed to retrieve system stats"}` | `systeminformation` library call failed |
| 503 | `{"error":"Onboarding not complete","onboardingStatus":"FRESH"}` | Onboarding has not finished |

### Caching Behavior

The stats response is cached for 2 seconds. Multiple requests within the cache window return the same data without querying the operating system again. This prevents performance degradation when the dashboard polls frequently or multiple browser tabs are open.

## Quick Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | None (no mTLS) | Health check with version |
| GET | `/api/system/stats` | mTLS (admin or agent with `system:read`) | CPU, memory, disk, uptime |

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

| Bytes | Formula | Result |
|-------|---------|--------|
| `536870912` | `/ 1024 / 1024` | 512 MB |
| `26843545600` | `/ 1024 / 1024 / 1024` | 25 GB |

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
