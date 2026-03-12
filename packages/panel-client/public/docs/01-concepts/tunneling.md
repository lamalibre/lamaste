# Tunneling

> Portlama uses WebSocket tunnels to securely relay traffic from the internet to web apps running behind your firewall.

## In Plain English

Imagine your home computer runs a web app, but your router blocks anyone from the internet from reaching it. It is like having a shop inside a locked building with no front door.

Portlama solves this with a tunnel. Your home computer reaches *out* to a small server on the internet (the VPS) and holds open a connection. When someone visits your domain, the VPS sends the request back through that open connection to your home computer, which responds as if the visitor connected directly.

Think of it like a phone call. Your home computer calls the VPS and stays on the line. When a visitor arrives at the VPS, the VPS says "someone is here for you" over the open line, and your home computer handles the conversation through that same call.

The connection uses WebSockets — a technology that keeps a two-way channel open over HTTPS. This means the tunnel looks like normal web traffic, so firewalls and corporate networks that block unusual protocols let it through without interference.

If the connection drops (internet hiccup, VPS restart, laptop sleep), the client automatically reconnects and picks up where it left off. You do not need to intervene.

## For Users

### When you encounter tunneling

Tunneling is the core of Portlama. Every time you create a tunnel in the management UI, you are telling Portlama to relay traffic from a subdomain on the internet to a specific port on your local machine.

For example, if you run a web app on port 3000 of your Mac, you create a tunnel in the panel that maps `myapp.example.com` to port 3000. Visitors go to `https://myapp.example.com`, and Portlama relays their requests through the tunnel to your Mac's port 3000.

### How a tunnel gets created

1. You click "Add Tunnel" in the management panel
2. You enter a subdomain name (e.g., `myapp`) and a port number (e.g., `3000`)
3. Portlama issues a TLS certificate for `myapp.example.com` via Let's Encrypt
4. Portlama writes an nginx vhost configuration to route `myapp.example.com` traffic
5. Portlama restarts the tunnel server to pick up the new mapping
6. You download the Mac client plist file and install it on your Mac
7. The Mac client connects to the VPS and starts relaying traffic

### What runs where

```
Your Mac (behind firewall)           Internet            Your VPS ($4 droplet)
┌─────────────────────┐                                 ┌──────────────────────┐
│                     │                                 │                      │
│  Web app (:3000)    │                                 │  nginx (TLS)         │
│       ↑             │                                 │       ↓              │
│  Chisel client  ────┼──── WebSocket over HTTPS ──────▶│  Chisel server       │
│  (auto-reconnect)   │                                 │  (127.0.0.1:9090)    │
│                     │                                 │                      │
└─────────────────────┘                                 └──────────────────────┘
                                                               ↑
                                                        Visitor browses
                                                        myapp.example.com
```

### Auto-reconnect

The Chisel client on your Mac runs as a launchd service. If the connection drops for any reason — network outage, VPS restart, laptop waking from sleep — it automatically reconnects within 5 seconds. You do not need to manually restart anything.

### Multiple tunnels

You can run multiple tunnels simultaneously. Each tunnel maps a different subdomain to a different local port:

| Subdomain | Local port | What it exposes |
|-----------|-----------|-----------------|
| `myapp.example.com` | 3000 | React dev server |
| `api.example.com` | 8080 | Backend API |
| `blog.example.com` | 4000 | Blog engine |

All tunnels share the same Chisel client connection. The client multiplexes all port mappings over a single WebSocket.

## For Developers

### Chisel overview

Portlama uses [Chisel](https://github.com/jpillora/chisel), an open-source tunnel tool written in Go. Chisel encapsulates TCP connections inside WebSocket frames, which travel over standard HTTPS. This makes the tunnel traffic indistinguishable from normal web traffic to firewalls and DPI (Deep Packet Inspection) systems.

Portlama uses Chisel in **reverse mode**. In reverse mode, the client connects to the server and registers ports it wants to expose. The server then listens on those local ports and forwards incoming connections back through the WebSocket to the client.

### Server configuration

The Chisel server runs as a systemd service on the VPS, binding to `127.0.0.1:9090`:

```ini
[Unit]
Description=Chisel Tunnel Server
After=network.target

[Service]
Type=simple
User=nobody
ExecStart=/usr/local/bin/chisel server --reverse --port 9090 --host 127.0.0.1
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=chisel

[Install]
WantedBy=multi-user.target
```

Key points:

- **`--reverse`** — enables reverse tunneling (clients declare which ports to expose)
- **`--port 9090`** — the port Chisel listens on for WebSocket connections
- **`--host 127.0.0.1`** — binds only to localhost; nginx handles public-facing TLS
- **`User=nobody`** — runs with minimal privileges
- **`Restart=always`** — systemd restarts the process on any failure

The server is not exposed directly to the internet. nginx terminates TLS on `tunnel.example.com` and proxies the WebSocket connection to `127.0.0.1:9090`.

### Client configuration

On the Mac, the Chisel client runs as a launchd service. The management panel generates a `.plist` file you download and install. The client command looks like:

```bash
chisel client --keepalive 25s \
  https://tunnel.example.com \
  R:3000:localhost:3000 \
  R:8080:localhost:8080
```

The `R:` prefix means "reverse" — the client tells the server to listen on that port and forward back to the client's localhost. The `--keepalive 25s` flag sends periodic pings to keep the WebSocket alive through NATs and firewalls.

### Data flow for a single request

Here is the complete path of an HTTP request through the tunnel:

```
1. Visitor requests    https://myapp.example.com/api/data
2. DNS resolves to     203.0.113.42 (your VPS IP)
3. nginx on VPS:
   a. Terminates TLS (Let's Encrypt cert for myapp.example.com)
   b. Checks Authelia forward auth → user is authenticated
   c. Proxies to 127.0.0.1:3000 (where Chisel server is listening for this port)
4. Chisel server:
   a. Receives the proxied request on local port 3000
   b. Forwards through WebSocket to the connected Chisel client
5. Chisel client (on your Mac):
   a. Receives the request from the WebSocket
   b. Connects to localhost:3000 on the Mac
   c. Forwards the request to your web app
6. Response travels back the same path in reverse
```

### WebSocket upgrade in nginx

The tunnel vhost uses WebSocket upgrade headers with a 24-hour read/send timeout to keep long-lived connections alive:

```nginx
location / {
    proxy_pass http://127.0.0.1:9090;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # Long timeout for WebSocket tunnel connections
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}
```

### Concurrency and locking

The panel server serializes Chisel config updates using a promise-chain mutex. When multiple tunnel operations happen simultaneously (e.g., creating two tunnels at once), they queue up rather than racing:

```javascript
// From packages/panel-server/src/lib/chisel.js
let chiselUpdateLock = Promise.resolve();

export async function updateChiselConfig(tunnels) {
  const previousLock = chiselUpdateLock;
  let resolveLock;
  chiselUpdateLock = new Promise((resolve) => {
    resolveLock = resolve;
  });

  try {
    await previousLock;
    await _doUpdateChiselConfig(tunnels);
  } finally {
    resolveLock();
  }
}
```

This prevents concurrent systemd restarts, which can leave the service in an unpredictable state.

### Installation

Chisel is installed from GitHub releases during the onboarding provisioning step — not during the initial `npx @lamalibre/create-portlama` install. The installer downloads the latest `linux_amd64` binary:

```
GitHub releases → curl download → gunzip → move to /usr/local/bin/chisel → chmod +x
```

The binary is a single static Go executable with no runtime dependencies.

### Source files

| File | Purpose |
|------|---------|
| `packages/panel-server/src/lib/chisel.js` | Install, start, stop, restart, status, config update |
| `packages/panel-server/src/routes/management/tunnels.js` | Tunnel CRUD API endpoints |
| `packages/create-portlama/src/tasks/nginx.js` | Tunnel vhost nginx template (written during provisioning) |

### Port mapping model

Every tunnel creates a chain of port mappings:

```
Public FQDN (443) → nginx vhost → Chisel server (local port) → WebSocket → Chisel client → localhost (Mac port)
```

The Chisel server in `--reverse` mode does not need per-tunnel port entries in its own config. The client declares which ports to expose when it connects, and the server dynamically allocates local listeners. Restarting Chisel after adding a tunnel is done to ensure a clean state, but the server configuration itself stays the same.

## Quick Reference

### Architecture

| Component | Location | Port | Role |
|-----------|----------|------|------|
| Chisel server | VPS | `127.0.0.1:9090` | Accepts WebSocket connections from clients |
| Chisel client | Mac | outbound only | Connects to VPS, exposes local ports |
| nginx tunnel vhost | VPS | `443` | TLS termination for `tunnel.example.com` |
| nginx app vhost | VPS | `443` | TLS + Authelia auth for each `app.example.com` |

### Chisel server flags

| Flag | Value | Purpose |
|------|-------|---------|
| `--reverse` | (no value) | Enable reverse tunneling |
| `--port` | `9090` | WebSocket listen port |
| `--host` | `127.0.0.1` | Bind to localhost only |

### Chisel client flags

| Flag | Value | Purpose |
|------|-------|---------|
| `--keepalive` | `25s` | WebSocket ping interval |
| Server URL | `https://tunnel.example.com` | Where to connect |
| Port mapping | `R:3000:localhost:3000` | Reverse-map local port |

### Systemd commands

```bash
# Check Chisel server status
systemctl status chisel

# View recent logs
journalctl -u chisel -n 50 --no-pager

# Restart the server
sudo systemctl restart chisel
```

### Mac launchd commands

```bash
# Load the tunnel service
launchctl load ~/Library/LaunchAgents/com.portlama.tunnel.plist

# Unload the tunnel service
launchctl unload ~/Library/LaunchAgents/com.portlama.tunnel.plist

# Check if running
launchctl list | grep portlama
```

### Related documentation

- [mTLS](mtls.md) — how the admin panel connection is secured
- [Authentication](authentication.md) — how tunneled apps are protected with TOTP 2FA
- [nginx Reverse Proxy](nginx-reverse-proxy.md) — how nginx routes tunnel traffic
- [Certificates](certificates.md) — TLS certificates for tunnel subdomains
- [DNS and Domains](dns-and-domains.md) — how subdomains map to tunnels
