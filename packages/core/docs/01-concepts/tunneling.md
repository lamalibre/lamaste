# Tunneling

> Lamaste uses WebSocket tunnels to securely relay traffic from the internet to web apps running behind your firewall.

## In Plain English

Imagine your home computer runs a web app, but your router blocks anyone from the internet from reaching it. It is like having a shop inside a locked building with no front door.

Lamaste solves this with a tunnel. Your home computer reaches _out_ to a small server on the internet (the VPS) and holds open a connection. When someone visits your domain, the VPS sends the request back through that open connection to your home computer, which responds as if the visitor connected directly.

Think of it like a phone call. Your home computer calls the VPS and stays on the line. When a visitor arrives at the VPS, the VPS says "someone is here for you" over the open line, and your home computer handles the conversation through that same call.

The connection uses WebSockets — a technology that keeps a two-way channel open over HTTPS. This means the tunnel looks like normal web traffic, so firewalls and corporate networks that block unusual protocols let it through without interference.

If the connection drops (internet hiccup, VPS restart, laptop sleep), the client automatically reconnects and picks up where it left off. You do not need to intervene.

## For Users

### When you encounter tunneling

Tunneling is the core of Lamaste. Every time you create a tunnel in the management UI, you are telling Lamaste to relay traffic from a subdomain on the internet to a specific port on your local machine.

For example, if you run a web app on port 3000 of your machine, you create a tunnel in the panel that maps `myapp.example.com` to port 3000. Visitors go to `https://myapp.example.com`, and Lamaste relays their requests through the tunnel to your machine's port 3000.

### How a tunnel gets created

1. Your machine is enrolled as an **agent** — once, with `lamaste-agent setup` or the Desktop App (see [Agent Setup](../02-guides/agent-setup.md))
2. You click "Add Tunnel" in the management panel
3. You enter a subdomain name (e.g., `myapp`), a port number (e.g., `3000`), and the agent that carries it
4. Lamaste issues a TLS certificate for `myapp.example.com` via Let's Encrypt
5. Lamaste writes an nginx vhost configuration to route `myapp.example.com` traffic
6. Lamaste grants that agent — and only that agent — the port on the tunnel server (the tunnel server picks up the grant without a restart)
7. Within about 30 seconds the agent's sync timer notices the new tunnel and starts relaying traffic — there is nothing to run on the agent (`lamaste-agent update` applies it at once)

### What runs where

```
Your machine (behind firewall)       Internet            Your VPS ($4 droplet)
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

The Chisel client runs as a user-level service (launchd on macOS, systemd on Linux). If the connection drops for any reason — network outage, VPS restart, laptop waking from sleep — it reconnects on its own, backing off between attempts to at most 30 seconds (`--max-retry-interval 30s`). You do not need to manually restart anything.

### Tunnel changes apply by themselves

Next to the Chisel client, every agent runs a small **sync timer** that asks the panel every 30 seconds which tunnels it carries and adjusts the client when that changed. Creating, deleting, disabling or moving a tunnel in the panel therefore reaches the agent within about 30 seconds.

This is more than a convenience. The tunnel server checks every port an agent asks for, and if even one of them is no longer granted — say, a tunnel was just disabled — it rejects the agent's **whole** connection, taking all of its other tunnels down with it. The timer makes the agent stop asking for a revoked port promptly.

An agent that carries no tunnel at all keeps its Chisel client stopped (Chisel cannot run without at least one port to forward) and starts it as soon as a tunnel is assigned. Stopping the tunnels on purpose from the agent panel or desktop app is remembered, and the timer leaves them stopped.

### Multiple tunnels

You can run multiple tunnels simultaneously. Each tunnel maps a different subdomain to a different local port:

| Subdomain           | Local port | What it exposes  |
| ------------------- | ---------- | ---------------- |
| `myapp.example.com` | 3000       | React dev server |
| `api.example.com`   | 8080       | Backend API      |
| `blog.example.com`  | 4000       | Blog engine      |

All tunnels carried by one agent share that agent's Chisel client connection. The client multiplexes all its port mappings over a single WebSocket — which is also why one refused port refuses them all.

### One agent per tunnel

Every tunnel belongs to exactly one agent. You can enroll many machines — a laptop, a build server, a VM — and each one carries its own tunnels. An agent is only told about its own tunnels, and the tunnel server only lets an agent open the ports of the tunnels it carries, so enrolling a second machine never lets it take over the first machine's hostnames. An administrator can move a tunnel to another agent from the panel (**Edit** on the tunnel row).

## For Developers

### Chisel overview

Lamaste uses [Chisel](https://github.com/jpillora/chisel), an open-source tunnel tool written in Go. Chisel encapsulates TCP connections inside WebSocket frames, which travel over standard HTTPS. This makes the tunnel traffic indistinguishable from normal web traffic to firewalls and DPI (Deep Packet Inspection) systems.

Lamaste uses Chisel in **reverse mode**. In reverse mode, the client connects to the server and registers ports it wants to expose. The server then listens on those local ports and forwards incoming connections back through the WebSocket to the client.

### Server configuration

The Chisel server runs as a systemd service on the VPS, binding to `127.0.0.1:9090`. Server and agents run the same pinned release, Chisel 1.12.0 — the first whose `--authfile` reload survives atomic renames and re-checks a user's grants on every new tunnel.

```ini
[Unit]
Description=Chisel Tunnel Server
After=network.target

[Service]
Type=simple
User=nobody
Group=lamaste-chisel
ExecStart=/usr/local/bin/chisel server --reverse --port 9090 --host 127.0.0.1 --keyfile /etc/lamalibre/lamaste/chisel-server.key --authfile /etc/lamalibre/lamaste/chisel-users
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
- **`--keyfile`** — pins the server's SSH identity across restarts
- **`--authfile`** — per-agent credentials and per-agent port grants (see below)
- **`User=nobody`, `Group=lamaste-chisel`** — runs with minimal privileges; the group is the only one that may read the 0640 authfile
- **`Restart=always`** — systemd restarts the process on any failure

The server is not exposed directly to the internet. nginx terminates TLS on `tunnel.example.com` and proxies the WebSocket connection to `127.0.0.1:9090`.

### Ownership and grants

Each tunnel in `tunnels.json` carries an `agentLabel` — the agent that carries it. The panel renders Chisel's authfile, `/etc/lamalibre/lamaste/chisel-users`, from two persisted inputs: the per-agent credential store (`chisel-credentials.json`) and the tunnel state. Each `agent-<label>` user is granted exactly the reverse remotes of the enabled tunnels it owns:

```json
{
  "lamaste-no-grants:<random>": [],
  "agent-laptop:<password>": ["^R:127\\.0\\.0\\.1:3000$", "^R:127\\.0\\.0\\.1:8080$"],
  "agent-build-server:<password>": []
}
```

- Chisel matches these patterns unanchored, so the `^…$` anchors are what keep a grant for port `2001` from also matching `20010`.
- An agent with no tunnels can authenticate but bind nothing. Disabled and unassigned tunnels grant nothing.
- A reserved port (3100, 9090, 9091, 9292, 9294 — Lamaste's own services) and a port claimed by two tunnels are never granted, whatever the state file says. Such a tunnel (only possible in state written before these checks) is also left out of its owner's `agent-config`, so the agent never asks for a port Chisel would refuse; it is carried by no one until it is deleted and recreated on a free port.
- `lamaste-no-grants` is a sentinel user with no grants. Chisel disables authentication entirely when its authfile has no users, so without it a fresh server (or one whose agents are all revoked) would be an open relay. Its random password lives in `/etc/lamalibre/lamaste/chisel-sentinel` (0600) and is never handed out.
- The authfile is `0640`, owner `lamaste`, group `lamaste-chisel`. The panel (a member of that group through `SupplementaryGroups=lamaste-chisel`) writes it directly, without sudo: a `0600` temp file in the same directory, `chgrp lamaste-chisel`, `chmod 0640`, fsync, rename. Chisel's file watcher therefore never sees it with the wrong permissions.
- Every tunnel change writes the state first, then re-renders the authfile. Chisel reloads the file on every replace, but a reload only applies to **new** sessions: a live session keeps the listeners it already bound. So an addition (a new agent, a new grant) takes effect without a restart, while a revocation (a removed or rotated password, a withdrawn grant) restarts Chisel with `systemctl try-restart` so live sessions drop what they no longer hold. `try-restart` leaves a Chisel that was stopped on purpose stopped. Until the panel knows Chisel is running the pinned release, every change restarts it.

On the API side the same rule holds: `GET /api/tunnels/agent-config` returns only the calling agent's enabled tunnels, an agent's `GET /api/tunnels` omits other agents' tunnels, and acting on one of those answers `404`.

### Client configuration

The Chisel client runs as a user-level service managed by `lamaste-agent` (and `lamaste-agentd`): a LaunchAgent plist on macOS, a systemd **user** unit on Linux. Both are generated by one implementation in `@lamalibre/lamaste/agent`. The client command looks like:

```bash
chisel client \
  --max-retry-interval 30s \
  https://tunnel.example.com:443 \
  R:127.0.0.1:3000:127.0.0.1:3000 \
  R:127.0.0.1:8080:127.0.0.1:8080
```

- **The relay is fixed.** The server URL is always `https://tunnel.<enrolled domain>:443`. The agent records the domain at enrollment and refuses a panel response that names another one; moving an agent to another relay means re-enrolling it.
- **TLS is verified.** `tunnel.example.com` carries a publicly trusted Let's Encrypt certificate and the client verifies it like any HTTPS client — there is no `--tls-skip-verify`. An agent drops that flag if an older panel still sends it.
- **The credential is not an argument.** Chisel reads `AUTH=<user>:<password>` from its environment. On Linux it comes from `EnvironmentFile=~/.lamalibre/lamaste/agents/<label>/chisel.env` (0600); on macOS from the plist's `EnvironmentVariables` (the plist is written 0600). `ps` shows nothing secret.
- **Loopback only.** Every remote must be `R:127.0.0.1:<port>:127.0.0.1:<port>`. The agent rejects any other form, even from the panel.

The `R:` prefix means "reverse" — the client asks the server to listen on that port on its `127.0.0.1` and forward connections back to the same port on the agent's `127.0.0.1`. Chisel's default 25-second keepalive keeps the WebSocket alive through NATs and firewalls.

On Linux, a user unit only runs while that user has a session unless _lingering_ is enabled. `lamaste-agent setup` and `status` report it; on headless machines run `sudo loginctl enable-linger <user>` once.

### Agent sync

`lamaste-agent sync` (run every 30 seconds by a systemd user timer `lamalibre-lamaste-sync-<label>` on Linux, or the LaunchAgent `com.lamalibre.lamaste.sync-<label>` on macOS) fetches `GET /api/tunnels/agent-config` and converges the client with it: verifies the relay URL, fetches a credential an administrator rotated (`chiselCredentialIssuedAt`), replaces a Chisel binary that is not the pinned release, rewrites the service definition when the granted remotes changed, and starts or stops the client. It rewrites and restarts nothing when everything already matches. `setup`, `update`, the agent panel and the agent daemon all use the same convergence code. Details: [Agent Setup](../02-guides/agent-setup.md#how-tunnel-changes-reach-the-agent).

### Data flow for a single request

Here is the complete path of an HTTP request through the tunnel:

```
1. Visitor requests    https://myapp.example.com/api/data
2. DNS resolves to     203.0.113.42 (your VPS IP)
3. nginx on VPS:
   a. Terminates TLS (Let's Encrypt cert for myapp.example.com)
   b. Checks Gatekeeper/Authelia (unless the tunnel is public) → user is allowed
   c. Proxies to 127.0.0.1:3000 (where Chisel server is listening for this port,
      because the carrying agent holds the grant for it)
4. Chisel server:
   a. Receives the proxied request on local port 3000
   b. Forwards through WebSocket to the connected Chisel client
5. Chisel client (on your machine):
   a. Receives the request from the WebSocket
   b. Connects to localhost:3000 on your machine
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

Every tunnel workflow — create, delete, toggle, assign, reconfigure, the combined `PATCH`, releasing a revoked agent's tunnels, and startup reconciliation — runs under one tunnel lock (`withTunnelLock` in `@lamalibre/lamaste/server`'s `tunnels.ts`), with its validation inside the lock. Two concurrent requests therefore cannot both pass a uniqueness check for the same subdomain or port. Authfile renders are additionally serialized with a keyed promise-chain mutex in `chisel-users.ts`, so enrollments and credential rotations never interleave authfile writes with tunnel changes.

### Startup reconciliation

Every time the panel starts it brings Chisel in line with the persisted state, in the background so the panel stays reachable meanwhile (`chisel-reconcile.js`):

1. Every active agent gets a Chisel credential if it lacks one.
2. Ownerless tunnels from versions before tunnel ownership are bound where the owner is certain: an `agent-<label>` panel tunnel only to that agent (when active), other tunnels only when exactly one machine agent is active (plugin-agent certificates carry no tunnels and are not counted). The rest stay unassigned and are logged. Tunnels that are withheld from every agent — a legacy tunnel on a reserved port, or two tunnels sharing a port — are logged too; delete each and recreate it on a free port.
3. Once onboarding has provisioned Chisel: the pinned release is installed if another version is present, the unit is rewritten (group `lamaste-chisel`), and the authfile is rewritten with its ownership and mode.
4. Chisel is restarted when the binary, the unit or a revocation requires it, and started if it is enabled but not running.

It **fails closed**: if the authfile or unit cannot be established, Chisel is stopped **and disabled**, and the marker file `/etc/lamalibre/lamaste/chisel-failed-closed` records when — an authfile left by an older version may grant every agent every port, and keeping it live would re-open what this version closes. Disabling the unit keeps a reboot from starting Chisel on that authfile before the panel has reconciled. Reconciliation retries with backoff (30 seconds, doubling up to 10 minutes); once it succeeds it re-enables and starts Chisel and removes the marker. A failed download of the pinned binary alone does not stop Chisel; the authfile still enforces access, and the download is retried.

### Installation

Chisel is installed during the onboarding provisioning step — not during the initial `npx @lamalibre/create-lamaste` install — and kept at the pinned release by every panel start. Both the server and the agents download the pinned release (`CHISEL_RELEASE` in `@lamalibre/lamaste`'s `constants.ts`) from its fixed URL, with no GitHub API lookup and no "latest":

```
https://github.com/jpillora/chisel/releases/download/v1.12.0/chisel_1.12.0_<os>_<arch>.gz
  → curl (HTTPS only, size and time bounded) → SHA-256 compared with the pinned digest
  → gunzip → /usr/local/bin/chisel (server) or ~/.lamalibre/lamaste/bin/chisel (agent)
```

A digest mismatch aborts the install and leaves any existing binary untouched. An installed binary reporting another version is replaced — on the server at panel startup, on an agent by its next sync. The binary is a single static Go executable with no runtime dependencies.

### Source files

| File                                                      | Purpose                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/core/lib/src/server/chisel.ts`                  | Install, start, stop, restart, status, unit re-apply                |
| `packages/core/lib/src/server/chisel-users.ts`            | Per-agent credentials, grants, authfile rendering, sentinel user    |
| `packages/core/lib/src/server/chisel-args.ts`             | Client `chiselArgs` returned by `agent-config`                      |
| `packages/core/lib/src/server/tunnels.ts`                 | Tunnel create/delete/toggle/assign/reconfigure                      |
| `packages/core/lib/src/chisel-download.ts`                | Pinned, checksum-verified Chisel download (server and agent)        |
| `packages/core/lib/src/agent/chisel-service.ts`           | Agent-side plist / systemd unit generation, `chiselArgs` validation |
| `packages/core/lib/src/agent/converge.ts`                 | Agent convergence with the panel (setup, update, sync)              |
| `packages/core/lib/src/agent/sync-service.ts`             | Agent sync timer                                                    |
| `packages/server/daemon/src/routes/management/tunnels.js` | Tunnel API endpoints                                                |
| `packages/server/daemon/src/lib/chisel-reconcile.js`      | Startup reconciliation, fail closed                                 |
| `packages/server/daemon/src/lib/chisel-runtime.js`        | Whether an authfile change needs a Chisel restart                   |

### Panel tunnels

In addition to regular application tunnels (type `app`), Lamaste supports panel tunnels (type `panel`) that expose an agent's management panel at a public subdomain.

**Key differences from app tunnels:**

- **Type:** Panel tunnels have type `panel` in `tunnels.json`, while regular tunnels have type `app`.
- **Subdomain prefix:** Panel tunnels use the reserved `agent-` subdomain prefix (e.g., `agent-macbook.example.com`). Regular tunnels cannot use subdomains starting with `agent-`.
- **nginx vhost:** Panel tunnel vhosts use mTLS client certificate verification (same CA as the main panel) instead of Authelia forward auth. The agent panel server validates that the certificate CN is either `agent:<label>` (the owning agent) or `admin`.
- **Lifecycle:** Panel tunnels are created via `POST /api/tunnels/expose-panel` and removed via `DELETE /api/tunnels/retract-panel`, not through the standard tunnel CRUD endpoints.
- **Capability:** The agent must have the `panel:expose` capability assigned to its certificate.

### Port mapping model

Every tunnel creates a chain of port mappings:

```
Public FQDN (443) → nginx vhost → Chisel server (local port) → WebSocket → Chisel client → localhost (local port)
```

The Chisel server in `--reverse` mode does not need per-tunnel port entries in its unit. The client declares which ports to expose when it connects, and the server opens a local listener for each one — but only if the authfile grants **every** remote the client asks for; one ungranted remote rejects the session. The restart after a revocation is what makes live sessions drop a binding the authfile no longer grants, and the agent's sync timer is what makes the agent stop asking for it.

## Quick Reference

### Architecture

| Component          | Location | Port             | Role                                           |
| ------------------ | -------- | ---------------- | ---------------------------------------------- |
| Chisel server      | VPS      | `127.0.0.1:9090` | Accepts WebSocket connections from clients     |
| Chisel client      | Agent    | outbound only    | Connects to VPS, exposes the agent's ports     |
| nginx tunnel vhost | VPS      | `443`            | TLS termination for `tunnel.example.com`       |
| nginx app vhost    | VPS      | `443`            | TLS + Authelia auth for each `app.example.com` |

### Chisel server flags

| Flag         | Value       | Purpose                  |
| ------------ | ----------- | ------------------------ |
| `--reverse`  | (no value)  | Enable reverse tunneling |
| `--port`     | `9090`      | WebSocket listen port    |
| `--host`     | `127.0.0.1` | Bind to localhost only   |
| `--keyfile`  | path        | Stable server identity   |
| `--authfile` | path        | Credentials and grants   |

The client adds `--max-retry-interval 30s`.

### Chisel client flags

| Argument     | Value                             | Purpose                           |
| ------------ | --------------------------------- | --------------------------------- |
| Server URL   | `https://tunnel.example.com:443`  | Where to connect (TLS verified)   |
| Port mapping | `R:127.0.0.1:3000:127.0.0.1:3000` | Reverse-map a loopback port       |
| `AUTH` (env) | `agent-<label>:<password>`        | Credential, never on command line |

### Systemd commands

```bash
# Check Chisel server status
systemctl status chisel

# View recent logs
journalctl -u chisel -n 50 --no-pager

# Restart the server (the panel does this itself when a grant is revoked)
sudo systemctl restart chisel
```

### Agent commands

```bash
# Install globally, then set up the agent (interactive)
npm install -g @lamalibre/lamaste-agent
lamaste-agent setup --label <label>

# Apply tunnel changes now (the sync timer does it within 30 s anyway)
lamaste-agent update

# Check agent status (boot persistence on Linux, sync timer, tunnels)
lamaste-agent status

# View logs
lamaste-agent logs
```

### macOS launchd commands

```bash
# Check if running (the service is managed by lamaste-agent; prefer
# lamaste-agent status / update over editing the plist by hand)
launchctl list | grep com.lamalibre.lamaste.chisel-<label>

# The sync timer
launchctl list | grep com.lamalibre.lamaste.sync-<label>
```

### Linux systemd commands

```bash
# Check agent service status (a systemd user unit)
systemctl --user status lamalibre-lamaste-chisel-<label>

# Check the sync timer
systemctl --user list-timers lamalibre-lamaste-sync-<label>.timer

# Keep the tunnel running after reboot without a login (once per user)
sudo loginctl enable-linger "$USER"
```

### Related documentation

- [mTLS](mtls.md) — how the admin panel connection is secured
- [Agent Setup](../02-guides/agent-setup.md) — enrolling macOS and Linux agents
- [Authentication](authentication.md) — how tunneled apps are protected with TOTP 2FA
- [nginx Reverse Proxy](nginx-reverse-proxy.md) — how nginx routes tunnel traffic
- [Certificates](certificates.md) — TLS certificates for tunnel subdomains
- [DNS and Domains](dns-and-domains.md) — how subdomains map to tunnels
