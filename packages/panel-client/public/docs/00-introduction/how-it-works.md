# How It Works

> Portlama connects your local web apps to the internet through a cheap VPS relay, using encrypted WebSocket tunnels, with a browser-based admin panel you never need SSH to manage.

## In Plain English

Picture a building with a locked front door and no doorbell. People outside cannot get in to visit you. That is your home network — your router blocks all incoming connections for security.

Now imagine you rent a tiny storefront on a busy street. You dig a private underground passage from your building to the storefront. When a visitor walks into the storefront, an attendant escorts them through the passage to your building and back again. The visitor never knows they went underground — they just see your building's interior.

That is Portlama in a nutshell:

- **Your building** is your Mac (or any computer) running web apps behind a firewall.
- **The storefront** is a $4/month DigitalOcean droplet with a public IP address.
- **The underground passage** is an encrypted WebSocket tunnel (powered by Chisel).
- **The attendant** is nginx, routing visitors to the right app.
- **The locked front office** is the admin panel, where only people with a special key card (client certificate) can enter and manage everything.

The most unusual part: after you set up the storefront (a single command over SSH), you throw away the SSH key. You never go back through that door. All future management — adding new passages, changing locks, checking security cameras — happens through the front office using your key card.

### Why not just deploy to the cloud?

You could rent a bigger server and deploy your apps there. But that means:

- Paying for compute (your Mac is already sitting there, powered on)
- Managing deployments, Docker, CI/CD pipelines
- Migrating databases, file storage, environment configs
- Losing access to local hardware (GPUs, attached drives, local network devices)

Portlama keeps your apps at home and only relays the HTTP traffic. The VPS does almost no work — it just forwards bytes. That is why a $4 droplet with 512MB RAM is enough.

### Why not use ngrok or Cloudflare Tunnel?

Those are great tools. Portlama differs in a few ways:

- **Self-hosted**: You own the relay. No third-party sees your traffic.
- **Your domain**: Traffic goes through your own domain, not a vendor subdomain.
- **Your auth**: You control user accounts and 2FA, not a vendor dashboard.
- **Fixed cost**: $4/month for unlimited tunnels, not per-seat or per-tunnel pricing.
- **No vendor lock-in**: It is open source. The droplet is yours.

## For Users

### The Big Picture

Portlama has three phases of life: installation, onboarding, and daily operation.

**Phase 1: Installation (5 minutes, SSH)**

You SSH into a fresh Ubuntu droplet and run one command:

```bash
apt install -y npm
npx @lamalibre/create-portlama
```

This installs everything the relay needs: nginx, Node.js, firewall rules, certificates, and the management panel. At the end, it prints a client certificate file and password. You download the certificate, import it into your browser, and disconnect SSH. You never SSH in again.

**Phase 2: Onboarding (10 minutes, browser)**

You open `https://<droplet-ip>:9292` in your browser. Because you imported the client certificate, the browser proves your identity at the TLS level — no username/password needed.

The onboarding wizard walks you through:

1. Enter your domain name and email address
2. Point your DNS records to the droplet's IP
3. Click "Provision" — Portlama installs Chisel (tunnel server), Authelia (2FA), and configures nginx with Let's Encrypt certificates

**Phase 3: Daily operation (browser)**

After onboarding, the same URL shows the management panel:

- **Dashboard**: System stats, service health, resource usage
- **Tunnels**: Create, edit, delete tunnels. Download Mac client configs.
- **Users**: Add people who can access your tunneled apps (each gets TOTP 2FA)
- **Certificates**: Monitor Let's Encrypt expiry, rotate mTLS certificates
- **Services**: Start, stop, restart Chisel/Authelia/nginx. View live logs.

### Data Flow: How a Request Reaches Your App

When someone visits `https://myapp.example.com`:

```
1. Browser sends HTTPS request
   ↓
2. DNS resolves example.com → 203.0.113.42 (your droplet)
   ↓
3. nginx on the droplet receives the request
   ↓
4. nginx checks: does this visitor have a valid 2FA session?
   ├─ No  → Authelia login page (username + TOTP code)
   └─ Yes → continue
   ↓
5. nginx forwards the request to Chisel server (port 9090)
   ↓
6. Chisel server sends it through the WebSocket tunnel
   ↓
7. Chisel client on your Mac receives the request
   ↓
8. Chisel client forwards it to localhost:8001 (your app)
   ↓
9. Your app responds
   ↓
10. Response travels back: app → Chisel client → tunnel → Chisel server → nginx → browser
```

The entire round trip is encrypted end-to-end. The tunnel itself runs inside a standard HTTPS connection (WebSocket upgrade), so it passes through corporate firewalls and ISP filters that block custom protocols.

### The Admin Panel: A Different Security Model

The admin panel at `https://<ip>:9292` uses a completely different authentication mechanism than your tunneled apps:

| | Admin Panel | Tunneled Apps |
|---|---|---|
| **URL** | `https://<ip>:9292` | `https://app.example.com` |
| **Auth method** | mTLS client certificate | Username + TOTP 2FA |
| **Who accesses it** | You (the admin) | Your users |
| **Login required** | No — certificate is the login | Yes — Authelia login page |
| **Works without domain** | Yes (IP access always works) | No (needs DNS + domain) |

This split is deliberate. The admin panel works by IP address so you can always reach it, even if your domain's DNS breaks or your Let's Encrypt certificate expires. It uses client certificates so there is no login form to brute-force.

### Component Map

Here is every piece of software running on the droplet after onboarding:

```
┌──────────────────────────────────────────────────────────────────┐
│  Ubuntu 24.04 Droplet (512MB RAM)                                │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  nginx (public-facing, ports 443 + 9292)                    │ │
│  │                                                             │ │
│  │  Port 9292 — Admin panel vhost (mTLS)                       │ │
│  │    └─ proxy_pass → Panel Server (127.0.0.1:3100)            │ │
│  │                                                             │ │
│  │  Port 443 — Tunnel vhosts (Let's Encrypt TLS)               │ │
│  │    ├─ forward auth → Authelia (127.0.0.1:9091)              │ │
│  │    └─ proxy_pass → Chisel Server (127.0.0.1:9090)           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Panel Server     │  │ Authelia      │  │ Chisel Server     │  │
│  │ (Fastify, :3100) │  │ (TOTP, :9091) │  │ (tunnels, :9090)  │  │
│  │ REST API +       │  │ bcrypt users  │  │ WebSocket-over-   │  │
│  │ static files     │  │ ~25MB RAM     │  │ HTTPS             │  │
│  └──────────────────┘  └──────────────┘  └───────────────────┘  │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ UFW Firewall     │  │ fail2ban     │  │ certbot           │  │
│  │ ports 22/443/    │  │ SSH + nginx  │  │ auto-renewing     │  │
│  │ 9292 only        │  │ jails        │  │ Let's Encrypt     │  │
│  └──────────────────┘  └──────────────┘  └───────────────────┘  │
│                                                                  │
│  Total RAM: ~245MB    Swap: 1GB safety net                       │
└──────────────────────────────────────────────────────────────────┘
         ▲
         │ WebSocket tunnel (encrypted, inside HTTPS)
         │
┌────────┴─────────────────────────────────────────────────────────┐
│  Your Mac (behind firewall)                                      │
│                                                                  │
│  ┌──────────────────┐       ┌──────────────────────────────────┐ │
│  │ Chisel Client    │       │ Your Web Apps                    │ │
│  │ (launchd plist,  │──────→│ localhost:8001 (blog)            │ │
│  │  auto-reconnect) │       │ localhost:3000 (dashboard)       │ │
│  └──────────────────┘       │ localhost:5173 (dev server)      │ │
│                             └──────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### RAM Budget

Every component is chosen to fit within 512MB:

| Component | RAM Usage | Purpose |
|-----------|-----------|---------|
| Ubuntu OS baseline | ~120MB | Kernel, systemd, base services |
| nginx | ~15MB | Reverse proxy, TLS termination |
| Authelia | ~25MB | TOTP 2FA authentication |
| Chisel Server | ~20MB | WebSocket tunnel relay |
| Panel Server | ~30MB | Fastify REST API |
| fail2ban | ~35MB | Brute-force protection |
| **Total** | **~245MB** | **Headroom: ~265MB** |

A 1GB swap file provides a safety net. Authelia uses bcrypt (not argon2id) specifically because argon2id uses ~93MB per password hash and would cause out-of-memory kills on a 512MB droplet.

## For Developers

### Architecture Philosophy

Portlama follows three core principles:

1. **SSH is disposable.** The installer runs once over SSH and provisions everything. After that, SSH is only a fallback for disaster recovery. All day-to-day management happens through the browser-based panel, authenticated by mTLS client certificates.

2. **nginx is the only public surface.** Every backend service binds to `127.0.0.1`. nginx is the sole process listening on public ports (443 and 9292). This minimizes the attack surface to a single, well-audited reverse proxy.

3. **No database.** State is stored in JSON files (`panel.json`, `tunnels.json`) and YAML files (`users.yml` for Authelia). Writes use atomic rename (`write .tmp` then `rename`) to prevent corruption. At this scale, a database adds complexity without benefit.

### Monorepo Structure

```
portlama/
├── packages/
│   ├── create-portlama/       ← npx installer (runs once on VPS)
│   │   └── src/
│   │       ├── index.js       ← Listr2 orchestrator
│   │       ├── tasks/         ← harden, node, mtls, nginx, panel
│   │       └── lib/           ← secrets, summary, cert-help-page
│   │
│   ├── panel-server/          ← Fastify REST API (runs as systemd service)
│   │   └── src/
│   │       ├── index.js       ← server entry
│   │       ├── middleware/    ← mTLS verification, onboarding guard
│   │       ├── routes/        ← onboarding/ + management/ endpoints
│   │       └── lib/           ← business logic (nginx, chisel, authelia, certbot)
│   │
│   └── panel-client/          ← React SPA (served as static files)
│       └── src/
│           ├── App.jsx        ← mode detection (onboarding vs management)
│           ├── pages/         ← onboarding wizard + management pages
│           └── components/    ← shared UI components
```

### Installer Pipeline

The installer (`create-portlama`) runs as a Listr2 task pipeline:

```
Phase 1: Environment Detection
├── Verify root access
├── Detect OS (must be Ubuntu 24.04)
└── Detect public IP address

Phase 2: Installation
├── Harden OS
│   ├── Create 1GB swap file (swappiness=10)
│   ├── Configure UFW (allow 22, 443, 9292 only)
│   ├── Install and configure fail2ban
│   ├── Harden SSH (disable password auth)
│   └── Install system packages (nginx, certbot)
│
├── Install Node.js 20 LTS
│
├── Generate mTLS Certificates
│   ├── Create CA key + certificate (4096-bit RSA, 10-year validity)
│   ├── Create client key + CSR (4096-bit RSA)
│   ├── Sign client certificate with CA (2-year validity)
│   └── Create PKCS12 bundle (.p12) for browser import
│
├── Configure nginx
│   ├── Generate self-signed TLS certificate for IP access
│   ├── Write mTLS snippet (ssl_verify_client on)
│   ├── Write IP-based panel vhost (port 9292)
│   ├── Deploy certificate help page
│   ├── Enable site, remove default
│   └── Validate config and start nginx
│
└── Deploy Panel
    ├── Create portlama system user
    ├── Create directory structure (/opt/portlama, /etc/portlama, /var/www/portlama)
    ├── Deploy panel-server (copy + npm install --production)
    ├── Deploy panel-client (copy pre-built dist or build from source)
    ├── Write panel.json configuration
    ├── Write systemd service unit (portlama-panel.service)
    ├── Write sudoers rules (least-privilege for portlama user)
    └── Start panel service + health check
```

Every task is idempotent — re-running the installer updates the installation without losing existing configuration. Skip guards check for existing state (swap already exists, certificates already generated, etc.).

### Onboarding Provisioning

After the installer runs, the panel is in `FRESH` state. The onboarding wizard (accessed via browser) provisions the remaining stack:

```
Onboarding Wizard
├── Domain Step: user enters domain + email
├── DNS Step: panel shows required DNS records, user verifies
└── Provisioning Step: panel installs remaining components
    ├── Download and install Chisel binary
    ├── Download and install Authelia binary
    ├── Create Authelia configuration + first admin user
    ├── Issue Let's Encrypt certificate via certbot
    ├── Write domain-based nginx vhosts
    ├── Create systemd service units for Chisel + Authelia
    ├── Start all services
    └── Update panel.json → onboarding status: COMPLETED
```

After provisioning, onboarding endpoints return `410 Gone` and management endpoints become available.

### Security Layers

```
Layer 1: UFW Firewall
  └─ Only ports 22 (SSH), 443 (HTTPS), 9292 (admin panel) are open

Layer 2: fail2ban
  └─ Bans IPs after 5 failed SSH or nginx auth attempts (1 hour ban)

Layer 3: nginx TLS
  └─ All traffic is HTTPS. Self-signed cert for IP:9292, Let's Encrypt for domain.

Layer 4a: mTLS (admin panel)
  └─ ssl_verify_client on — no certificate = TLS handshake rejected before HTTP

Layer 4b: Authelia (tunneled apps)
  └─ Forward auth — username + TOTP 2FA required for every tunneled app

Layer 5: Localhost binding
  └─ Panel server, Authelia, Chisel all bind 127.0.0.1 — unreachable from outside

Layer 6: Systemd hardening
  └─ NoNewPrivileges, ProtectSystem=strict, ProtectHome, PrivateTmp

Layer 7: Least-privilege sudoers
  └─ portlama user can only run specific commands (nginx -t, systemctl for known services, certbot)
```

### Key File Locations on the Droplet

| Path | Purpose |
|------|---------|
| `/etc/portlama/panel.json` | Main configuration (IP, domain, onboarding status) |
| `/etc/portlama/tunnels.json` | Tunnel definitions |
| `/etc/portlama/pki/` | CA cert/key, client cert/key, self-signed cert |
| `/etc/portlama/pki/client.p12` | PKCS12 bundle for browser import |
| `/opt/portlama/panel-server/` | Fastify backend (Node.js) |
| `/opt/portlama/panel-client/dist/` | Built React SPA (static files) |
| `/var/www/portlama/` | Static site files served through tunnels |
| `/etc/nginx/sites-available/portlama-*` | nginx vhost configurations |
| `/etc/nginx/snippets/portlama-mtls.conf` | mTLS client certificate requirement |
| `/etc/systemd/system/portlama-panel.service` | Panel server systemd unit |
| `/etc/sudoers.d/portlama` | Least-privilege sudo rules |
| `/etc/fail2ban/jail.d/portlama.conf` | fail2ban jail configuration |

### State Machine

The panel operates in distinct states:

```
FRESH ──────→ DOMAIN_SET ──────→ DNS_READY ──────→ PROVISIONING ──────→ COMPLETED
  │               │                   │                    │                  │
  │  Onboarding   │  Onboarding       │  Onboarding        │  Onboarding      │ Management
  │  endpoints    │  endpoints        │  endpoints         │  endpoints       │ endpoints
  │  active       │  active           │  active            │  active          │ active
  │               │                   │                    │                  │
  │  Management   │  Management       │  Management        │  Management      │ Onboarding
  │  returns 503  │  returns 503      │  returns 503       │  returns 503     │ returns 410
```

### Technology Choices Explained

| Choice | Why | Alternatives Considered |
|--------|-----|------------------------|
| Chisel for tunnels | Single Go binary, WebSocket-over-HTTPS (bypasses DPI), ~20MB RAM | frp (heavier), bore (less mature), SSH tunnels (fragile) |
| Authelia for 2FA | Single Go binary, TOTP support, ~25MB RAM, file-based user store | Keycloak (too heavy), custom auth (security risk) |
| nginx for reverse proxy | Battle-tested, mTLS support, forward auth, low RAM | Caddy (no mTLS vhost control), Traefik (higher RAM) |
| Fastify for API | Fast, schema-first validation, native WebSocket, ESM | Express (slower, less structured), Hono (less ecosystem) |
| JSON files for state | Simple, no database process, atomic writes | SQLite (adds dependency), PostgreSQL (way too heavy) |
| bcrypt for passwords | Low memory (~4KB per hash) | argon2id (~93MB per hash, causes OOM on 512MB) |
| Client certificates for admin | Zero-login, unforgeable, works at TLS layer | Session cookies (brute-forceable), API keys (leakable) |

## Quick Reference

### Ports

| Port | Service | Access |
|------|---------|--------|
| 22 | SSH | Public (key-only, fail2ban protected) |
| 443 | nginx (tunnel vhosts) | Public (Let's Encrypt TLS + Authelia 2FA) |
| 9292 | nginx (admin panel) | Public (self-signed TLS + mTLS client cert) |
| 3100 | Panel Server (Fastify) | Localhost only |
| 9090 | Chisel Server | Localhost only |
| 9091 | Authelia | Localhost only |

### Services

| systemd Unit | Binary | Purpose |
|---|---|---|
| `portlama-panel` | `node src/index.js` | REST API + static file server |
| `nginx` | `/usr/sbin/nginx` | Reverse proxy, TLS, mTLS |
| `chisel` | `/usr/local/bin/chisel` | WebSocket tunnel server |
| `authelia` | `/usr/local/bin/authelia` | TOTP 2FA authentication |
| `fail2ban` | `/usr/bin/fail2ban-server` | Brute-force protection |
| `certbot.timer` | `/usr/bin/certbot` | Auto-renewing Let's Encrypt certs |

### Data Flow Summary

```
Browser → DNS → nginx:443 → Authelia check → Chisel server → tunnel → Chisel client → local app
Admin   →       nginx:9292 → mTLS check    → Panel server:3100
```

### Key Commands (on the droplet)

```bash
# Service management
systemctl status portlama-panel
systemctl restart chisel
journalctl -u portlama-panel -f    # live logs

# nginx
nginx -t                           # validate config
systemctl reload nginx             # apply vhost changes

# Certificates
certbot certificates               # list Let's Encrypt certs
certbot renew                      # force renewal check

# Firewall
ufw status                         # show open ports
fail2ban-client status             # show active jails
```

### Related Documentation

- [What is Portlama?](./what-is-portlama.md) — overview and use cases
- [Quick Start](./quickstart.md) — from zero to first tunnel in 10 minutes
- [Tunneling](../01-concepts/tunneling.md) — deep dive on Chisel and WebSocket tunnels
- [mTLS](../01-concepts/mtls.md) — how client certificate authentication works
- [Authentication](../01-concepts/authentication.md) — Authelia and TOTP 2FA
- [Security Model](../01-concepts/security-model.md) — defense-in-depth architecture
- [Glossary](../06-reference/glossary.md) — A-Z term definitions
