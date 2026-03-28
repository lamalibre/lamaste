# What is Portlama?

> Portlama is a self-hosted secure tunneling platform that exposes web apps running behind a firewall through a cheap VPS, with zero-login admin access via client certificates.

## In Plain English

Imagine you have a computer at home running a web app — maybe a side project, a blog engine, or an internal tool. You want people on the internet to access it, but your home network is behind a router that blocks incoming connections.

The traditional solution is to rent a server in the cloud and deploy your app there. But that means maintaining a server, managing deployments, and paying for compute you might not need.

Portlama takes a different approach. You rent the cheapest possible server (a $4/month DigitalOcean droplet) and use it as a **relay**. Your home computer connects _out_ to the relay through a secure tunnel, and when someone visits your domain, the relay forwards the request back through the tunnel to your app.

Think of it like a postal forwarding service. Your app stays at home, but mail gets forwarded to the right address.

The clever part: after the initial 5-minute setup, you never need to SSH into the server again. Everything — domain setup, user management, certificate renewal, tunnel configuration — happens through a browser-based admin panel protected by a client certificate (like a digital ID card that your browser presents automatically).

## For Users

Portlama solves the problem of exposing local services to the internet securely. Here is what you get:

**What it does:**

- Exposes local web apps (any port) through HTTPS on your own domain
- Protects each app with TOTP two-factor authentication (Google Authenticator, Authy, etc.)
- Manages TLS certificates automatically via Let's Encrypt
- Provides a browser-based admin panel for everything — no SSH needed after setup

**What you need:**

- A Mac (or Linux machine) running the web apps you want to expose
- A $4/month DigitalOcean droplet (Ubuntu 24.04, 512MB RAM)
- A domain name (or use a managed subdomain)

**How setup works:**

**Option A: Manual setup (SSH)**

1. Create a fresh Ubuntu 24.04 droplet on DigitalOcean
2. SSH in once and run `npx @lamalibre/create-portlama`
3. Download the client certificate it prints
4. Import the certificate into your browser
5. Open `https://<droplet-ip>:9292` — you are in the admin panel
6. Complete the onboarding wizard (domain, DNS, stack provisioning)
7. Create tunnels, add users, manage everything from the browser
8. Disconnect SSH. You never need it again.

**Option B: Desktop app cloud provisioning**

1. Install the desktop app (`npx @lamalibre/install-portlama-desktop`)
2. Go to the Servers tab and click "Create a new server"
3. Enter your DigitalOcean API token — the app validates scopes and stores it securely in your OS credential store
4. Pick a region (the app measures latency to each) and a domain name
5. Click "Provision" — the app creates the droplet, installs Portlama, downloads your certificate, and connects automatically
6. Manage everything from the desktop app or the browser panel

See the [Cloud Provisioning guide](../02-guides/cloud-provisioning.md) for a detailed walkthrough.

**Key design choices:**

- The admin panel always works via IP address (`:9292`), even if your domain goes down
- Client certificate authentication means zero-login — your browser proves identity at the TLS level
- All services run on the cheapest possible VPS (512MB RAM budget, carefully tuned)

## For Developers

Portlama is a monorepo with several packages:

| Package                    | Technology                 | Purpose                              |
| -------------------------- | -------------------------- | ------------------------------------ |
| `create-portlama`          | Node.js ESM, Listr2, execa | Zero-prompt installer CLI            |
| `panel-server`             | Fastify 5, Node.js ESM     | REST API + WebSocket backend         |
| `panel-client`             | React 18, Vite, Tailwind   | Management UI (SPA)                  |
| `portlama-agent`           | Node.js ESM                | Tunnel agent CLI (macOS & Linux)     |
| `portlama-desktop`         | Tauri v2 (Rust + React)    | Desktop app with service discovery, multi-server & cloud provisioning |
| `portlama-admin-panel`     | React 18                   | Shared admin UI (pages, context, components) for panel-client and desktop |
| `portlama-agent-panel`     | React 18                   | Shared agent UI (pages, context, components) for desktop agent mode |
| `install-portlama-desktop` | Node.js ESM                | npx installer for the desktop app    |
| `portlama-tickets`         | TypeScript, undici          | SDK for agent-to-agent authorization |
| `portlama-cloud`           | TypeScript, undici          | Cloud provider abstraction for server provisioning |

**Architecture summary:**

```
Internet → nginx (TLS + mTLS) → Panel Server (Fastify, :3100)
                               → Authelia (TOTP 2FA, :9091)
                               → Chisel Server (WebSocket tunnels, :9090)
                                    ↑
                               Chisel Client (on your machine, auto-reconnect)
                                    ↑
                               Your local web app (:8001, :3000, etc.)
```

All backend services bind `127.0.0.1` only — nginx is the sole public-facing service. The panel is protected by mTLS (client certificates), while tunneled apps are protected by Authelia (TOTP 2FA).

State is stored in JSON files (`/etc/portlama/panel.json`, `tunnels.json`) with atomic writes (write to temp → fsync → rename). No database is needed at this scale.

The installer (`npx @lamalibre/create-portlama`) is completely non-interactive — it detects the environment, provisions everything, and prints a summary. All configuration happens through the browser-based onboarding wizard after installation.

## Quick Reference

| Item                 | Value                            |
| -------------------- | -------------------------------- |
| **Minimum VPS**      | 512MB RAM, Ubuntu 24.04          |
| **Install command**  | `npx @lamalibre/create-portlama` |
| **Admin panel**      | `https://<ip>:9292` (mTLS)       |
| **Auth for admin**   | Client certificate (zero-login)  |
| **Auth for apps**    | TOTP 2FA via Authelia            |
| **Tunnel protocol**  | WebSocket-over-HTTPS (Chisel)    |
| **TLS certificates** | Let's Encrypt (auto-renewing)    |
| **State storage**    | JSON files (no database)         |
| **RAM usage**        | ~245MB total (all services)      |
| **npm package**      | `@lamalibre/create-portlama`     |
| **License**          | Polyform Noncommercial 1.0.0     |
