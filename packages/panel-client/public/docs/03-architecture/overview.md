# System Architecture Overview

> Portlama is a relay-based tunneling platform where a $4 VPS acts as a gateway between the public internet and web apps running behind a firewall.

## In Plain English

Portlama has three main pieces:

1. **The Installer** (`npx @lamalibre/create-portlama`) — a one-shot script you run once on a fresh VPS. It sets up nginx, generates security certificates, and deploys a web-based control panel. After it finishes, you never SSH into the server again.

2. **The Panel** (browser UI + backend API) — a management interface protected by a client certificate. Through it, you configure your domain, create tunnels, manage users, and monitor services.

3. **The Tunnel Stack** (Chisel + Authelia + nginx + certbot) — the runtime infrastructure that routes traffic from the internet to your local apps through encrypted WebSocket tunnels, protected by two-factor authentication.

These three pieces interact through a clear lifecycle: the installer creates the panel, the panel provisions the tunnel stack, and the tunnel stack serves your apps.

## System Diagram

```
                            ┌──────────────────────────────────────────────────────┐
                            │                  VPS (Ubuntu 24.04)                   │
                            │                                                      │
  Admin Browser             │  ┌──────────────────────────────────────────────┐    │
  (with client cert)        │  │              nginx (public-facing)            │    │
         │                  │  │                                              │    │
         │ HTTPS :9292      │  │  :9292 (mTLS, self-signed)                  │    │
         ├─────────────────►│  │    └─► 127.0.0.1:3100 (Panel Server)       │    │
         │                  │  │                                              │    │
         │ HTTPS :443       │  │  :443 (Let's Encrypt)                       │    │
         │                  │  │    panel.<domain>                            │    │
         │                  │  │      └─► 127.0.0.1:3100 (Panel Server)     │    │
         │                  │  │    auth.<domain>                             │    │
  End Users                 │  │      └─► 127.0.0.1:9091 (Authelia)         │    │
         │                  │  │    tunnel.<domain>                           │    │
         ├─────────────────►│  │      └─► 127.0.0.1:9090 (Chisel Server)   │    │
         │                  │  │    <app>.<domain>                            │    │
         │                  │  │      └─► auth_request to Authelia           │    │
         │                  │  │      └─► 127.0.0.1:<port> (tunneled app)   │    │
         │                  │  └──────────────────────────────────────────────┘    │
         │                  │                                                      │
         │                  │  ┌──────────────┐  ┌──────────────┐                 │
         │                  │  │ Panel Server  │  │   Authelia    │                 │
         │                  │  │ (Fastify)     │  │ (TOTP 2FA)   │                 │
         │                  │  │ 127.0.0.1     │  │ 127.0.0.1    │                 │
         │                  │  │ :3100         │  │ :9091         │                 │
         │                  │  └──────────────┘  └──────────────┘                 │
         │                  │                                                      │
         │                  │  ┌──────────────────────┐                           │
         │                  │  │   Chisel Server       │                           │
         │                  │  │   127.0.0.1:9090      │◄────── WebSocket ──────┐  │
         │                  │  │   (reverse mode)      │                        │  │
         │                  │  └──────────────────────┘                        │  │
         │                  │                                                   │  │
         │                  └───────────────────────────────────────────────────┼──┘
         │                                                                      │
         │                                                                      │
         │                  ┌──────────────────────────────────────────┐        │
         │                  │        Home Network / Mac Studio         │        │
         │                  │                                          │        │
         │                  │  ┌──────────────────────┐               │        │
         │                  │  │   Chisel Client       │───────────────┼────────┘
         │                  │  │   (launchd plist)     │               │
         │                  │  │   auto-reconnect      │               │
         │                  │  └──────────┬───────────┘               │
         │                  │             │                            │
         │                  │  ┌──────────┴───────────┐               │
         │                  │  │  Your Web Apps         │               │
         │                  │  │  :3000, :8001, etc.    │               │
         │                  │  └──────────────────────┘               │
         │                  └──────────────────────────────────────────┘
```

## Component Roles

| Component         | Binary / Process                 | Role                                                                                       |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| **nginx**         | `nginx` (system package)         | Only public-facing service. TLS termination, mTLS enforcement, reverse proxy, forward auth |
| **Panel Server**  | `node src/index.js` (Fastify 5)  | REST API + WebSocket backend for all management operations                                 |
| **Panel Client**  | Static files (React SPA)         | Browser-based UI served by Panel Server via `@fastify/static`                              |
| **Chisel Server** | `/usr/local/bin/chisel`          | WebSocket tunnel server accepting reverse connections from clients                         |
| **Chisel Client** | `/usr/local/bin/chisel` (on Mac) | Connects outbound to VPS, exposes local ports via reverse tunneling                        |
| **Authelia**      | `/usr/local/bin/authelia`        | TOTP two-factor authentication for tunneled apps via nginx forward auth                    |
| **certbot**       | `certbot` (system package)       | Issues and auto-renews Let's Encrypt TLS certificates                                      |
| **fail2ban**      | `fail2ban` (system package)      | Rate-limits brute-force attempts on SSH and nginx                                          |

## Port Allocation

| Port   | Listener      | Protocol | Exposure      | Purpose                                  |
| ------ | ------------- | -------- | ------------- | ---------------------------------------- |
| `22`   | sshd          | TCP      | Public (UFW)  | SSH access (key-only after hardening)    |
| `443`  | nginx         | TCP      | Public (UFW)  | All domain-based HTTPS traffic           |
| `9292` | nginx         | TCP      | Public (UFW)  | IP-based admin panel access (mTLS)       |
| `3100` | Panel Server  | TCP      | Loopback only | Fastify API + static file serving        |
| `9090` | Chisel Server | TCP      | Loopback only | WebSocket tunnel endpoint                |
| `9091` | Authelia      | TCP      | Loopback only | Authentication portal + forward auth API |

All backend services (Panel Server, Chisel, Authelia) bind exclusively to `127.0.0.1`. nginx is the only process listening on public interfaces.

## RAM Budget (512MB Droplet)

The platform is designed to run on the cheapest possible VPS. Every technology choice was made with this constraint in mind.

| Component              | Approximate RAM | Notes                                            |
| ---------------------- | --------------- | ------------------------------------------------ |
| Ubuntu 24.04 baseline  | ~120 MB         | Systemd, kernel, base services                   |
| nginx                  | ~15 MB          | Efficient C-based reverse proxy                  |
| Authelia               | ~25 MB          | Go binary, **must use bcrypt** (not argon2id)    |
| Chisel Server          | ~20 MB          | Go binary, lightweight                           |
| Panel Server (Node.js) | ~30 MB          | Fastify is one of the leanest Node.js frameworks |
| fail2ban               | ~35 MB          | Python-based, runs as daemon                     |
| **Total**              | **~245 MB**     |                                                  |
| **Headroom**           | **~265 MB**     | Plus 1 GB swap as safety net                     |

Authelia is configured with bcrypt (cost factor 12) instead of argon2id. argon2id uses ~93 MB per hash operation and causes OOM kills on 512 MB droplets. This is a hard constraint documented in Authelia's configuration at `packages/panel-server/src/lib/authelia.js`.

## Data Flow: Admin Panel Access

```
1. Admin opens https://203.0.113.42:9292 in browser

2. nginx :9292 performs TLS handshake with self-signed server cert
   └─ ssl_verify_client on → requests client certificate

3. Browser presents client.p12 certificate (imported during setup)
   └─ nginx validates against CA at /etc/portlama/pki/ca.crt
   └─ Sets X-SSL-Client-Verify: SUCCESS header

4. nginx proxies to 127.0.0.1:3100
   └─ Passes X-SSL-Client-Verify and X-SSL-Client-DN headers

5. Panel Server (Fastify) onRequest hook checks X-SSL-Client-Verify
   └─ If not SUCCESS → 403 (never reached in production, nginx blocks first)
   └─ If SUCCESS → check certificate serial against revoked.json
   └─ If revoked → 403 "Certificate has been revoked"
   └─ Parse X-SSL-Client-DN for CN: admin → certRole=admin; agent:<label> → certRole=agent
   └─ Set request.certRole, request.certLabel, request.certCapabilities

6. Route handler executes business logic via lib/ layer
   └─ Returns JSON response

7. For SPA routes (non-/api paths), Fastify serves index.html from panel-client dist/
```

## Data Flow: Tunnel Traffic

```
1. Mac Chisel Client connects outbound to wss://tunnel.example.com:443
   └─ nginx :443 terminates TLS, proxies WebSocket to 127.0.0.1:9090
   └─ Chisel Server accepts reverse tunnel registration

2. End user visits https://myapp.example.com
   └─ nginx :443 matches server_name myapp.example.com
   └─ Let's Encrypt TLS certificate serves the connection

3. nginx sends auth_request to Authelia at 127.0.0.1:9091
   └─ Authelia checks session cookie
   └─ If no session → 401 → nginx redirects to auth.example.com
   └─ User enters username + TOTP code
   └─ Authelia sets session cookie → redirect back

4. With valid session, nginx proxies to 127.0.0.1:<port>
   └─ Chisel Server forwards the request through the WebSocket tunnel
   └─ Chisel Client on the Mac receives the request
   └─ Chisel Client forwards to 127.0.0.1:<port> on the Mac
   └─ Response travels back through the same path
```

## Data Flow: Onboarding Provisioning

```
1. Admin completes domain + DNS verification in the panel UI

2. Panel Client sends POST /api/onboarding/provision
   └─ Panel Server starts background provisioning task
   └─ Returns 202 Accepted immediately

3. Panel Client opens WebSocket to /api/onboarding/provision/stream
   └─ Receives real-time progress events for each task

4. Provisioning sequence (in Panel Server):
   a. Download + install Chisel binary from GitHub
   b. Download + install Authelia binary from GitHub
   c. Write Authelia config (bcrypt, TOTP, session cookies)
   d. Create admin user with random password
   e. Issue Let's Encrypt certs for panel/auth/tunnel subdomains
   f. Write nginx vhosts for panel-domain, auth, tunnel
   g. Enable sites + test nginx config + reload
   h. Verify all services are running + healthy
   i. Update panel.json onboarding.status to COMPLETED

5. Panel Client receives completion event with admin credentials
   └─ Displays TOTP enrollment QR code
```

## Monorepo Structure

```
portlama/
├── packages/
│   ├── create-portlama/               ← npx installer (zero-prompt)
│   │   ├── bin/create-portlama.js     ← CLI entry point
│   │   ├── src/
│   │   │   ├── index.js              ← Listr2 orchestrator
│   │   │   ├── tasks/
│   │   │   │   ├── harden.js         ← OS hardening (swap, UFW, fail2ban, SSH)
│   │   │   │   ├── node.js           ← Node.js 20 installation
│   │   │   │   ├── mtls.js           ← mTLS CA + client cert generation
│   │   │   │   ├── nginx.js          ← IP-based nginx vhost + mTLS snippet
│   │   │   │   └── panel.js          ← Panel deployment + systemd service
│   │   │   │   └── redeploy.js       ← Panel-only redeployment subtasks
│   │   │   └── lib/
│   │   │       ├── env.js            ← OS detection, IP detection, root check
│   │   │       ├── secrets.js        ← crypto.randomBytes wrappers
│   │   │       ├── summary.js        ← Post-install summary box
│   │   │       ├── cert-help-page.js ← HTML page for visitors without certs
│   │   │       └── service-config.js ← Systemd unit + sudoers content generators
│   │   └── vendor/                    ← Bundled panel-server + panel-client at publish time
│   │
│   ├── panel-server/                  ← Fastify REST API (127.0.0.1:3100)
│   │   └── src/
│   │       ├── index.js              ← Server entry, plugin registration
│   │       ├── middleware/
│   │       │   ├── mtls.js           ← Client cert verification + revocation + role parsing
│   │       │   ├── role-guard.js     ← Role-based access control (admin vs agent capabilities)
│   │       │   ├── onboarding-guard.js ← Route access control by onboarding state
│   │       │   └── errors.js         ← Global error handler (Zod, AppError, 500)
│   │       ├── routes/
│   │       │   ├── health.js         ← GET /api/health
│   │       │   ├── invite.js         ← Public invite acceptance routes (no mTLS)
│   │       │   ├── onboarding/
│   │       │   │   ├── index.js      ← Route registration + guard
│   │       │   │   ├── status.js     ← GET /api/onboarding/status
│   │       │   │   ├── domain.js     ← POST /api/onboarding/domain
│   │       │   │   ├── dns.js        ← POST /api/onboarding/verify-dns
│   │       │   │   └── provision.js  ← POST + WebSocket provisioning
│   │       │   ├── management.js     ← Route registration + guard
│   │       │   └── management/
│   │       │       ├── invitations.js ← Invitation CRUD (admin-only)
│   │       │       ├── system.js     ← GET /api/system/stats
│   │       │       ├── services.js   ← Service start/stop/restart
│   │       │       ├── logs.js       ← WebSocket live log streaming
│   │       │       ├── tunnels.js    ← Tunnel CRUD + plist download
│   │       │       ├── sites.js      ← Static site CRUD + file management
│   │       │       ├── users.js      ← Authelia user CRUD + TOTP
│   │       │       ├── certs.js      ← Certificate listing + renewal + mTLS rotation
│   │       │       └── plugins.js    ← Plugin management + push install API
│   │       ├── plugin-router.js      ← Dynamic plugin route mounting + disabled-plugin guard
│   │       └── lib/
│   │           ├── config.js         ← panel.json loading + Zod validation + atomic updates
│   │           ├── state.js          ← tunnels.json + sites.json + invitations.json atomic read/write
│   │           ├── revocation.js     ← Certificate revocation list management (revoked.json)
│   │           ├── invite-page.js    ← Invitation acceptance HTML page generator
│   │           ├── nginx.js          ← Vhost generation + write-with-rollback + reload
│   │           ├── chisel.js         ← Chisel install + service management
│   │           ├── authelia.js       ← Authelia install + config + user CRUD
│   │           ├── certbot.js        ← Let's Encrypt issuance + renewal
│   │           ├── mtls.js           ← mTLS cert info + rotation + dynamic capabilities
│   │           ├── plugins.js        ← Plugin install/uninstall/enable/disable + manifest validation
│   │           ├── push-install.js   ← Push install config, policies, sessions, agent enable/disable
│   │           ├── services.js       ← systemctl wrapper for managed services
│   │           ├── system-stats.js   ← CPU, memory, disk stats via systeminformation
│   │           ├── plist.js          ← macOS launchd plist generator
│   │           ├── files.js          ← Static site file operations (upload, delete, list)
│   │           └── app-error.js      ← Operational error class (AppError)
│   │
│   └── panel-client/                  ← React 18 + Vite + Tailwind SPA
│       └── src/
│           ├── App.jsx               ← Mode detection, routing, provider wrappers
│           ├── main.jsx              ← React root mount
│           ├── hooks/
│           │   ├── useOnboardingStatus.js ← Determines onboarding vs management mode
│           │   └── useProvisioningStream.js ← WebSocket hook for provisioning progress
│           ├── pages/
│           │   ├── onboarding/
│           │   │   ├── OnboardingShell.jsx ← Step container + progress indicator
│           │   │   ├── DomainStep.jsx     ← Domain + email form
│           │   │   ├── DnsStep.jsx        ← DNS record display + verification
│           │   │   ├── ProvisioningStep.jsx ← Real-time progress + log viewer
│           │   │   └── CompleteStep.jsx   ← Credentials + TOTP QR + next steps
│           │   ├── management/
│           │   │   ├── Dashboard.jsx      ← System stats + service health
│           │   │   ├── Tunnels.jsx        ← Tunnel CRUD + Mac plist download
│           │   │   ├── Sites.jsx          ← Static site management + file browser
│           │   │   ├── Services.jsx       ← Service control + live logs
│           │   │   ├── Certificates.jsx   ← Cert listing + renewal
│           │   │   └── Plugins.jsx       ← Plugin management + push install UI
│           │   ├── Users.jsx             ← Authelia user CRUD + TOTP enrollment
│           │   └── docs/
│           │       └── DocsPage.jsx      ← Documentation viewer (markdown)
│           └── components/
│               ├── layout/
│               │   ├── Layout.jsx        ← Sidebar + content area
│               │   ├── Sidebar.jsx       ← Navigation with mobile responsive
│               │   └── SidebarLink.jsx   ← Active-state nav link
│               ├── PluginLoader.jsx       ← Plugin micro-frontend loader
│               ├── Toast.jsx             ← Toast notification system
│               ├── LoadingScreen.jsx     ← Full-page loading state
│               ├── ErrorScreen.jsx       ← Full-page error with retry
│               └── FileBrowser.jsx       ← File tree for static site management
│
└── CLAUDE.md                          ← Project context for AI agents
```

## Security Layers

The platform implements defense-in-depth with multiple security layers:

```
Layer 1: Network (UFW)
  └─ Only ports 22, 443, 9292 open
  └─ Everything else is firewalled

Layer 2: fail2ban
  └─ SSH brute-force protection (5 attempts → 1 hour ban)
  └─ nginx auth failure protection

Layer 3: SSH Hardening
  └─ Password authentication disabled
  └─ Root login with key only

Layer 4: mTLS (Admin Panel)
  └─ nginx rejects connections without valid client certificate
  └─ Panel Server double-checks X-SSL-Client-Verify header
  └─ Panel Server checks certificate serial against revoked.json
  └─ Panel Server parses DN for role (admin vs agent) and sets certRole/certLabel/certCapabilities
  └─ Agent capabilities: tunnels:read/write, services:read/write, system:read, sites:read/write, plus plugin-declared capabilities

Layer 5: Authelia (Tunneled Apps)
  └─ nginx forward auth for every app request
  └─ TOTP two-factor authentication
  └─ Session cookies scoped to domain

Layer 6: Service Isolation
  └─ All backend services bind 127.0.0.1 only
  └─ portlama user runs with minimal privileges
  └─ Specific sudoers rules (no blanket root access)
  └─ systemd security hardening (NoNewPrivileges, ProtectSystem, ProtectHome)

Layer 7: TLS Everywhere
  └─ IP access: self-signed cert (port 9292)
  └─ Domain access: Let's Encrypt (port 443)
  └─ Tunnel traffic: WebSocket over HTTPS
```

## Design Decisions

### Why a $4 VPS as relay instead of a VPN or cloud deploy?

VPNs like Tailscale or Cloudflare Tunnel work well but lock you into a service provider. Cloud deployment means maintaining infrastructure and paying for compute. Portlama uses the cheapest possible VPS purely as a relay — your actual compute stays on hardware you own and control.

### Why nginx instead of Caddy or Traefik?

nginx has the smallest memory footprint of production-grade reverse proxies (~15 MB). On a 512 MB budget, every megabyte matters. nginx also has the most mature mTLS support and the widest documentation base. The tradeoff is more configuration complexity, which is managed programmatically through the Panel Server's `nginx.js` library.

### Why Chisel instead of SSH tunneling or WireGuard?

Chisel tunnels over WebSocket-over-HTTPS, which passes through virtually any firewall or DPI system. SSH tunnels are often blocked by corporate firewalls, and WireGuard requires a separate UDP port. Chisel also has built-in auto-reconnect and runs as a single Go binary with ~20 MB RAM usage.

### Why Authelia instead of a simpler auth solution?

Authelia provides TOTP 2FA as a single binary with ~25 MB RAM usage and file-based user storage. Alternatives like Keycloak (~500 MB RAM) or Auth0 (SaaS dependency) do not fit the constraints. Authelia integrates with nginx via the standard `auth_request` module.

### Why mTLS instead of passwords for the admin panel?

mTLS provides zero-login authentication — the browser presents the certificate automatically at the TLS level, before any HTTP request is processed. This eliminates credential stuffing, phishing, and session hijacking for admin access. The tradeoff is a one-time certificate import process during setup.

### Why JSON files instead of a database?

At this scale (single admin, handful of tunnels), a database adds RAM overhead and operational complexity for no benefit. JSON files with atomic writes (write temp, fsync, rename) provide crash-safe persistence. The entire state fits in a few kilobytes. Authelia's user database is YAML-based for the same reason.

### Why IP:9292 always works?

The IP-based panel access on port 9292 is the ultimate fallback. If your domain expires, DNS breaks, or Let's Encrypt fails to renew, you can always reach the panel via `https://<ip>:9292` to fix things. This is a core safety invariant of the system.

### Why systemd for all services?

systemd provides automatic restart on failure, structured logging via journal, dependency ordering, and resource isolation (cgroups). All Portlama services (`portlama-panel`, `chisel`, `authelia`) are managed through systemd, giving a consistent interface for the Panel Server to start, stop, restart, and query status. The `services.js` library wraps `systemctl` commands with an allowlist to prevent arbitrary service manipulation.

### Why sudoers instead of running as root?

The Panel Server runs as the `portlama` user with minimal privileges. Operations requiring root (nginx reload, certificate operations, file writes to system directories) go through scoped `sudoers` rules. Each rule is restricted to specific commands with specific arguments — there is no blanket `portlama ALL=(ALL) NOPASSWD: ALL`. This limits the blast radius of a compromised Panel Server process.

## Lifecycle Summary

The full lifecycle of a Portlama installation:

```
Phase 1: Installation (npx @lamalibre/create-portlama)
  └─ OS hardening, Node.js, mTLS certs, nginx, panel deploy
  └─ Result: Panel accessible at https://<ip>:9292

Phase 2: Onboarding (browser UI)
  └─ Domain input → DNS verification → stack provisioning
  └─ Provisions: Chisel, Authelia, Let's Encrypt, domain nginx vhosts
  └─ Result: Panel accessible at https://panel.<domain>

Phase 3: Operation (browser UI)
  └─ Create tunnels → apps accessible at https://<app>.<domain>
  └─ Manage users → TOTP enrollment for app access
  └─ Host static sites → served via nginx at https://<site>.<domain>
  └─ Monitor services → dashboard, live logs
  └─ Manage certificates → auto-renewal, mTLS rotation
  └─ Install plugins → extend functionality via @lamalibre/ npm packages

Phase 4: Recovery (if needed)
  └─ Domain lost? → https://<ip>:9292 always works
  └─ Service down? → Panel shows status, restart from UI
  └─ Cert expired? → Renew from certificates page
  └─ Need to re-install? → Re-run installer, config preserved
```

## Key Files

| File                                         | Role                                                 |
| -------------------------------------------- | ---------------------------------------------------- |
| `/etc/portlama/panel.json`                   | Central configuration (IP, domain, onboarding state) |
| `/etc/portlama/tunnels.json`                 | Tunnel definitions                                   |
| `/etc/portlama/sites.json`                   | Static site definitions                              |
| `/etc/portlama/pki/`                         | mTLS certificates (CA, client, server, PKCS12)       |
| `/opt/portlama/panel-server/`                | Deployed Panel Server code                           |
| `/opt/portlama/panel-client/dist/`           | Built Panel Client SPA                               |
| `/var/www/portlama/`                         | Static site file roots                               |
| `/etc/nginx/sites-available/portlama-*`      | nginx vhost configurations                           |
| `/etc/nginx/snippets/portlama-mtls.conf`     | Shared mTLS snippet                                  |
| `/etc/authelia/configuration.yml`            | Authelia main config                                 |
| `/etc/authelia/users.yml`                    | Authelia user database                               |
| `/etc/systemd/system/portlama-panel.service` | Panel Server systemd unit                            |
| `/etc/systemd/system/chisel.service`         | Chisel Server systemd unit                           |
| `/etc/systemd/system/authelia.service`       | Authelia systemd unit                                |
| `/etc/portlama/plugins.json`                 | Plugin registry (installed plugins and status)       |
| `/etc/portlama/plugins/`                     | Per-plugin data directories                          |
| `/etc/portlama/push-install-config.json`     | Push install configuration and policies              |
| `/etc/portlama/push-install-sessions.json`   | Push install session audit log                       |
| `/etc/sudoers.d/portlama`                    | Scoped sudo rules for portlama user                  |
