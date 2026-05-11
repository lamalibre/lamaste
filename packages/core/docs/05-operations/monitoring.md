# Monitoring

> Monitor your Lamaste server's health through the dashboard, service indicators, and live log streaming.

## In Plain English

Your Lamaste server is a small machine doing several jobs at once: routing web traffic, checking passwords, managing encrypted tunnels, and running the admin panel. Monitoring means keeping an eye on how hard the machine is working and whether all those jobs are running smoothly.

Think of it like the dashboard in a car. You do not need to understand how the engine works to notice when a warning light comes on or the temperature gauge spikes. Lamaste gives you the same kind of dashboard for your server.

## For Users

### Dashboard Overview

The **Dashboard** page is the first thing you see after logging into the management panel. It provides a real-time snapshot of your server's health across four key metrics.

#### CPU Usage

The CPU percentage tells you how much processing power is being used at this moment.

| Range   | Meaning       | Action                      |
| ------- | ------------- | --------------------------- |
| 0-30%   | Normal idle   | None needed                 |
| 30-60%  | Moderate load | Normal under traffic        |
| 60-85%  | High load     | Investigate if sustained    |
| 85-100% | Critical      | Check for runaway processes |

On a single-vCPU $4 droplet, expect idle CPU around 2-5%. Brief spikes to 50-60% during certificate issuance or package updates are normal.

#### Memory (RAM)

Memory usage shows how much of the 512MB (or your droplet's total) is in use.

**Expected baseline usage:**

| Component            | Typical RAM |
| -------------------- | ----------- |
| OS (kernel, systemd) | ~120 MB     |
| nginx                | ~15 MB      |
| Authelia             | ~25 MB      |
| Chisel               | ~20 MB      |
| Panel (Node.js)      | ~30 MB      |
| Fail2ban             | ~35 MB      |
| **Total baseline**   | **~245 MB** |

This leaves roughly 265 MB of headroom on a 512 MB droplet, plus a 1 GB swap file as a safety net.

**Warning thresholds:**

| Used % | Status   | Notes                               |
| ------ | -------- | ----------------------------------- |
| < 70%  | Normal   | Healthy headroom                    |
| 70-85% | Elevated | Monitor trend                       |
| 85-95% | Warning  | Check for memory leaks              |
| > 95%  | Critical | Risk of OOM kills, check swap usage |

If you see memory climbing steadily over days without returning to baseline, one of the services may have a memory leak. Restart the suspect service from the Services page and watch whether usage stabilizes.

#### Disk Usage

Disk usage reflects the root filesystem. On a fresh 25 GB droplet, Lamaste and its dependencies occupy roughly 2-3 GB.

**Things that consume disk over time:**

- Log files (journald, nginx access/error logs, Authelia logs)
- Let's Encrypt certificate archives (small, but accumulate per domain)
- Static site uploads under `/var/www/lamaste/`
- Swap file (1 GB, fixed)

**Warning thresholds:**

| Used % | Status   | Action                                           |
| ------ | -------- | ------------------------------------------------ |
| < 70%  | Normal   | None                                             |
| 70-85% | Watch    | Review log rotation                              |
| 85-95% | Warning  | Clean old logs, remove unused sites              |
| > 95%  | Critical | Free space immediately to avoid service failures |

To check what is using disk space, SSH in and run:

```bash
sudo du -sh /var/log/* | sort -rh | head -10
```

#### Uptime

System uptime shows how long the server has been running since its last reboot. Long uptimes (weeks or months) are normal and expected. The only reasons to reboot are kernel updates or hardware-level issues with the hosting provider.

### Service Health Indicators

The dashboard shows the status of each managed service:

| Service  | Systemd Unit                | Role                                             |
| -------- | --------------------------- | ------------------------------------------------ |
| nginx    | `nginx`                     | Reverse proxy, TLS termination, mTLS enforcement |
| Chisel   | `chisel`                    | WebSocket tunnel server                          |
| Authelia | `authelia`                  | TOTP two-factor authentication                   |
| Panel    | `lamalibre-lamaste-serverd` | Management API and UI                            |

Each service displays one of these statuses:

| Status     | Indicator | Meaning                                                 |
| ---------- | --------- | ------------------------------------------------------- |
| `active`   | Green     | Running normally                                        |
| `inactive` | Gray      | Stopped (not started or manually stopped)               |
| `failed`   | Red       | Crashed or failed to start                              |
| `unknown`  | Gray      | Service not installed or systemd cannot determine state |

Along with the status, each active service shows its **uptime** — how long it has been running since it was last started or restarted. If you see a service that recently restarted on its own (uptime much shorter than system uptime), check its logs for crash details.

### Live Log Streaming

The **Services** page lets you view live logs for any managed service. This uses a WebSocket connection to stream `journalctl` output directly to your browser.

**How to use live logs:**

1. Navigate to the **Services** page
2. Click on a service name to expand it
3. The log viewer opens and begins streaming the last 100 lines
4. New log entries appear at the bottom in real time
5. Close the viewer or navigate away to stop the stream

**What the log entries look like:**

Each log line contains an ISO timestamp and the log message:

```
2026-03-13T10:30:45+0000 droplet lamalibre-lamaste-serverd[1234]: Server listening on 127.0.0.1:3100
2026-03-13T10:30:45+0000 droplet nginx[5678]: 203.0.113.42 - - [13/Mar/2026:10:30:45 +0000] "GET /api/health" 200
```

**Tips for reading logs:**

- **nginx** logs show every HTTP request — useful for seeing who is connecting and what they are requesting
- **chisel** logs show tunnel client connections and disconnections
- **authelia** logs show authentication attempts, including failed TOTP entries
- **lamalibre-lamaste-serverd** logs show API requests and any server-side errors

### What Metrics to Watch

For day-to-day monitoring, these are the most important signals:

**Check daily (or set up external monitoring):**

1. **All four services are active** — if any service is `failed`, investigate immediately
2. **Memory usage is below 85%** — sustained high memory indicates a problem
3. **Disk usage is below 85%** — running out of disk causes cascading failures

**Check weekly:**

1. **Certificate expiry dates** — the Certificates page shows days remaining. Let's Encrypt auto-renews at 30 days, but verify renewal is working
2. **Disk growth trend** — if disk usage climbs steadily, investigate what is growing

**Check after changes:**

1. After adding a tunnel: verify the tunnel client connects (check Chisel logs)
2. After adding a user: verify they can authenticate (check Authelia logs)
3. After domain/DNS changes: verify certificates issued successfully (check Certificates page)

## For Developers

### System Stats API

The dashboard fetches metrics from a single endpoint:

```
GET /api/system/stats
```

Response structure:

```json
{
  "cpu": {
    "usage": 3.2,
    "cores": 1
  },
  "memory": {
    "total": 536870912,
    "used": 262144000,
    "free": 274726912
  },
  "disk": {
    "total": 26843545600,
    "used": 3221225472,
    "free": 23622320128
  },
  "uptime": 1234567
}
```

Memory and disk values are in bytes. Uptime is in seconds. CPU usage is a percentage (0-100).

The backend uses the `systeminformation` library with a 2-second cache to avoid excessive system calls when multiple clients poll simultaneously. The panel client polls this endpoint every 5 seconds via `react-query` (`refetchInterval: 5000`).

### Service Status API

```
GET /api/services
```

Returns an array of service objects:

```json
{
  "services": [
    { "name": "nginx", "status": "active", "uptime": "5d 12h 30m" },
    { "name": "chisel", "status": "active", "uptime": "5d 12h 28m" },
    { "name": "authelia", "status": "active", "uptime": "5d 12h 28m" },
    { "name": "lamalibre-lamaste-serverd", "status": "active", "uptime": "5d 12h 30m" }
  ]
}
```

The allowed service list is defined in `packages/lamaste-serverd/src/lib/services.js`:

```
nginx, chisel, authelia, lamalibre-lamaste-serverd
```

Service actions are available via:

```
POST /api/services/:name/:action
```

Where `action` is one of: `start`, `stop`, `restart`, `reload`.

The panel prevents stopping `lamalibre-lamaste-serverd` from the UI, because that would terminate the session serving the request.

### Live Log WebSocket

The live log stream is available at:

```
WS /api/services/:name/logs
```

The server spawns `journalctl -u <service> -f -n 100 --output=short-iso` as a child process and pipes parsed lines to the WebSocket as JSON:

```json
{
  "timestamp": "2026-03-13T10:30:45+0000",
  "message": "droplet lamalibre-lamaste-serverd[1234]: Server listening on 127.0.0.1:3100"
}
```

The server tracks all active `journalctl` processes and terminates them on WebSocket close, WebSocket error, or server shutdown to prevent orphaned processes.

### External Monitoring

For production use, consider setting up an external uptime monitor that hits your panel's health endpoint:

```
GET /api/health
```

This endpoint returns `200 OK` when the panel server is running. Since it is behind mTLS, your monitoring tool needs the client certificate, or you can monitor the IP:9292 HTTPS port for a valid TLS handshake.

Alternatively, monitor the public-facing tunneled apps directly — if users can reach `https://myapp.example.com`, the full stack (nginx, Chisel, Authelia) is working.

## Quick Reference

| Metric         | Normal Range  | Warning          | Critical       |
| -------------- | ------------- | ---------------- | -------------- |
| CPU            | 0-30%         | 60-85% sustained | >85% sustained |
| Memory         | <70% of total | 85-95%           | >95%           |
| Disk           | <70% of total | 85-95%           | >95%           |
| Service status | `active`      | `inactive`       | `failed`       |

| API Endpoint                  | Method | Purpose                   |
| ----------------------------- | ------ | ------------------------- |
| `/api/system/stats`           | GET    | CPU, RAM, disk, uptime    |
| `/api/services`               | GET    | All service statuses      |
| `/api/services/:name/:action` | POST   | Start/stop/restart/reload |
| `/api/services/:name/logs`    | WS     | Live log stream           |
| `/api/health`                 | GET    | Health check              |

| Log Command (SSH)                            | Purpose                 |
| -------------------------------------------- | ----------------------- |
| `journalctl -u nginx -f`                     | Follow nginx logs       |
| `journalctl -u chisel -f`                    | Follow Chisel logs      |
| `journalctl -u authelia -f`                  | Follow Authelia logs    |
| `journalctl -u lamalibre-lamaste-serverd -f` | Follow panel logs       |
| `journalctl -u nginx --since "1 hour ago"`   | Last hour of nginx logs |
