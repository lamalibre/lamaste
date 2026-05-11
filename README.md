# Lamaste

One-command setup for secure reverse tunnels with a management dashboard.

[![npm version](https://img.shields.io/npm/v/@lamalibre/create-lamaste)](https://www.npmjs.com/package/@lamalibre/create-lamaste)
[![npm version](https://img.shields.io/npm/v/@lamalibre/lamaste-agent)](https://www.npmjs.com/package/@lamalibre/lamaste-agent)
[![License: Polyform Noncommercial](https://img.shields.io/badge/License-Polyform%20Noncommercial-blue.svg)](LICENSE.md)

## Quick Start

### Desktop App (Recommended)

```bash
npx @lamalibre/create-lamaste-desktop
```

The desktop app lets you create a DigitalOcean server, manage agents, and configure tunnels — all from a native GUI. It handles cloud provisioning (including DNS setup), certificate management, service discovery, and tunnel authorization automatically.

1. Install the desktop app with the command above
2. Click **Create Server** and follow the wizard — select a region, optionally pick a domain, and the app provisions a droplet with Lamaste fully configured
3. The admin certificate is imported automatically — the server dashboard is ready immediately

### CLI (Alternative)

```bash
apt install -y npm
npx @lamalibre/create-lamaste
```

Run this on a fresh Ubuntu 24.04 droplet as root. The installer provisions everything with zero prompts, prints a client certificate and URL, and you disconnect SSH forever. All configuration happens through the browser-based management panel.

## What It Does

Lamaste is a self-hosted secure tunneling platform that exposes web apps running behind a firewall (e.g., on a Mac Studio) through a VPS via WebSocket-over-HTTPS tunnels. A single command sets up the entire stack on a cheap VPS, and a browser-based panel handles everything after that.

The installer provisions the server, generates mTLS certificates for secure panel access, and starts all services. You import the client certificate into your browser, navigate to `https://<ip>:9292`, and complete the onboarding wizard to configure your domain, DNS, and tunnel services.

## Requirements

- **OS**: Ubuntu 24.04 LTS
- **Access**: Root (the installer must run as root)
- **RAM**: 512 MB minimum (the stack is optimized for low-memory VPS instances)
- **Domain**: Optional. IP-only mode works out of the box; a domain enables Let's Encrypt TLS and nicer URLs

## Architecture

```
npx @lamalibre/create-lamaste (on fresh Ubuntu 24.04 droplet)
  Installs: Node.js, nginx, lamalibre-lamaste-serverd, lamaste-server-ui,
            lamalibre-lamaste-gatekeeper, mTLS PKI
  Prints:   client.p12 + password + https://<ip>:9292
  SSH is never needed again.

Browser (with imported client certificate):
  https://<ip>:9292
    Onboarding wizard    -> domain, DNS verification, stack provisioning
    Management panel     -> dashboard, tunnels, users, certificates, services,
                            gatekeeper (groups, grants, access control)
```

**Components:**

| Component           | Technology        | Role                                              |
| ------------------- | ----------------- | ------------------------------------------------- |
| Reverse proxy       | nginx             | TLS termination, mTLS, forward auth, authz cache  |
| Tunnel server       | Chisel            | WebSocket-over-HTTPS tunnels, bypasses DPI         |
| Authentication      | Authelia          | TOTP 2FA for tunneled services                     |
| Server daemon       | Fastify (Node.js) | REST API for management operations (lamalibre-lamaste-serverd) |
| Server UI           | React + Vite      | Browser-based management panel (lamaste-server-ui)   |
| Gatekeeper          | Fastify (Node.js) | Tunnel authorization service on 127.0.0.1:9294     |
| Agent daemon        | Fastify (Node.js) | Agent-side REST API and plugin host (lamalibre-lamaste-agentd) |
| Agent UI            | React + Vite      | Agent management panel (lamaste-agent-ui)         |
| Core library        | TypeScript        | Shared types, constants, schemas, helpers (lamaste) |
| TLS certificates    | Let's Encrypt     | Free, auto-renewing domain certificates            |
| Panel auth          | mTLS certificates | LXD-style zero-login for admin access              |
| Desktop app         | Tauri v2 (Rust)   | Native GUI with service discovery and cloud provisioning |

## Features

- **Zero-prompt installer** -- one command provisions the entire stack
- **Browser-based onboarding** -- domain setup, DNS verification, and service provisioning through a wizard
- **Tunnel management** -- create, list, and remove tunnels with automatic nginx vhost and TLS certificate generation
- **User management** -- Authelia user CRUD with TOTP enrollment and QR code generation
- **Certificate management** -- Let's Encrypt certificate listing, renewal, and mTLS client certificate rotation
- **Service control** -- start, stop, and restart services with live log streaming via WebSocket
- **System dashboard** -- CPU, RAM, disk, and uptime monitoring with service health indicators
- **Tunnel authorization** -- three access modes (public, authenticated, restricted) with group-based grants via Gatekeeper
- **Plugin ecosystem** -- install, enable, and manage `@lamalibre/` plugins on agents, locally, or server-side
- **Agent management** -- multi-agent support with per-agent certificates, capabilities, and plugin hosting
- **Desktop app** -- native macOS/Linux GUI with automatic service discovery (Ollama, ComfyUI, PostgreSQL, Docker containers, etc.), one-click tunnel creation, cloud provisioning, and agent management. Install with `npx @lamalibre/create-lamaste-desktop`
- **User plugin access** -- non-admin users can access plugins via Authelia-gated tunneled subdomains or desktop enrollment
- **IP fallback** -- `https://<ip>:9292` always works, even if the domain is lost (disabled when panel 2FA is enabled)
- **Low resource usage** -- the full stack runs within 250 MB RAM, suitable for $4/month VPS instances

## Security Model

- **mTLS for panel access** -- the management panel requires a client certificate. No certificate means the TLS handshake is rejected before any HTTP traffic is processed.
- **Hardware-bound certificates** -- agent and admin private keys can be imported into macOS Keychain as non-extractable. CSR-based enrollment with one-time tokens.
- **Panel 2FA** -- opt-in TOTP two-factor authentication for admin panel on top of mTLS.
- **Authelia 2FA for tunneled services** -- all services exposed through tunnels are protected by Authelia with TOTP two-factor authentication.
- **Gatekeeper authorization** -- tunnel access modes (public, authenticated, restricted) with group-based grants, nginx auth_request caching, and user-friendly access-request pages.
- **Certificate scoping** -- admin certs get full access; agent certs are capability-scoped (tunnels, services, sites, panel expose, identity, etc.).
- **Service binding** -- all services bind to `127.0.0.1` only. nginx is the sole public-facing service.
- **UFW firewall** -- only ports 22 (SSH, disabled after setup), 80 (HTTP redirect), 443 (HTTPS), and 9292 (panel) are open.
- **fail2ban** -- brute-force protection for SSH and nginx.
- **Atomic file writes** -- all configuration and state files are written atomically (temp, fsync, rename) to prevent corruption.
- **bcrypt password hashing** -- Authelia uses bcrypt instead of argon2id to avoid OOM kills on low-memory VPS instances.

## Configuration

All configuration lives under `/etc/lamalibre/lamaste/`:

| File                        | Purpose                                        |
| --------------------------- | ---------------------------------------------- |
| `panel.json`                | Server daemon configuration (IP, domain, state)|
| `pki/ca.crt`                | mTLS certificate authority                     |
| `pki/ca.key`                | CA private key                                 |
| `pki/client.p12`            | Client certificate bundle for browser import   |
| `pki/enrollment-tokens.json`| One-time agent enrollment tokens               |
| `tunnels.json`              | Tunnel definitions                             |
| `plugins.json`              | Plugin registry                                |
| `groups.json`               | Gatekeeper groups                              |
| `access-grants.json`        | Gatekeeper access grants                       |
| `ticket-scopes.json`        | Ticket system scope assignments                |

**Environment variables:**

| Variable                     | Default                    | Description                                      |
| ---------------------------- | -------------------------- | ------------------------------------------------ |
| `LAMALIBRE_LAMASTE_CONFIG`           | `/etc/lamalibre/lamaste/panel.json` | Path to panel configuration                      |
| `LAMALIBRE_LAMASTE_DATA_DIR`         | `/etc/lamalibre/lamaste`            | Data directory for gatekeeper state files         |
| `NODE_ENV`                            | `production`                         | Set to `development` to skip mTLS                |
| `LAMALIBRE_LAMASTE_ENROLLMENT_TOKEN` | —                                    | Agent enrollment token (avoids process listing)   |
| `LAMALIBRE_CLOUD_TOKEN`               | —                                    | Cloud provider API token (never CLI args)         |

## Troubleshooting

**Cannot connect to the panel after importing the certificate:**

- Verify the certificate was imported correctly in your browser's certificate manager.
- Check that you are accessing `https://<ip>:9292` (not HTTP, not a different port).
- On macOS, you may need to restart the browser after importing the `.p12` file.

**Onboarding DNS verification fails:**

- DNS propagation can take up to 48 hours. Use `dig A yourdomain.com` to check if the record points to your VPS IP.
- Ensure you created an A record (not CNAME) pointing to the VPS IP address.

**Service fails to start:**

- Check the service logs: in the management panel, go to Services and click the log icon.
- Verify sufficient memory: `free -h` on the server. The stack needs at least 250 MB free.

**Let's Encrypt certificate issuance fails:**

- Port 80 must be open and reachable from the internet (certbot uses HTTP-01 challenge).
- Verify DNS is pointing to the correct IP: `dig A yourdomain.com`.
- Check certbot logs: `/var/log/letsencrypt/letsencrypt.log`.

**Tunnel client cannot connect from Mac:**

- **Recommended:** Install the desktop app with `npx @lamalibre/create-lamaste-desktop` — it manages agents and tunnels through a GUI.
- **Alternative:** Install the agent CLI with `npx @lamalibre/create-lamaste-agent` and set up tunnels from the command line.

## Documentation

Full documentation is available at [**lamalibre.github.io/lamaste**](https://lamalibre.github.io/lamaste/) and also ships with the management panel UI.

| Section | Contents |
| --- | --- |
| [Introduction](https://lamalibre.github.io/lamaste/00-introduction/what-is-lamaste) | What is Lamaste, How It Works, Quick Start |
| [Concepts](https://lamalibre.github.io/lamaste/01-concepts/tunneling) | Tunneling, mTLS, Authentication, Certificates, Security Model, DNS, nginx |
| [Guides](https://lamalibre.github.io/lamaste/02-guides/installation) | Installation, Onboarding, First Tunnel, Desktop App, Mac Client, Users, Certs, Sites, DR |
| [Architecture](https://lamalibre.github.io/lamaste/03-architecture/overview) | System Overview, Panel Server/Client, nginx, State Management, Installer/Onboarding Flows |
| [API Reference](https://lamalibre.github.io/lamaste/04-api-reference/overview) | Onboarding, Tunnels, Users, Sites, Certificates, Services, System |
| [Operations](https://lamalibre.github.io/lamaste/05-operations/monitoring) | Monitoring, Upgrades, Backup & Restore, Uninstalling |
| [Reference](https://lamalibre.github.io/lamaste/06-reference/config-files) | Config Files, Ports & Services, Installer Flags, Troubleshooting, Glossary |
| [E2E Results](https://lamalibre.github.io/lamaste/e2e-results/single-vm-e2e) | Single-VM (15 tests) and Three-VM (11 tests) end-to-end test results |

## Built with Claude Code

This project was built in collaboration with [Claude Code](https://claude.ai/claude-code), Anthropic's CLI for Claude. Claude Code contributed across every phase of development:

- **Architecture and design** -- system layout, security model, mTLS PKI, nginx reverse proxy pipeline
- **Implementation** -- all 12 development phases from project foundation through desktop agent
- **Testing** -- single-VM E2E suite, three-VM integration tests with Multipass
- **Documentation** -- 41 user-facing docs, API reference, architecture diagrams, sequence diagrams
- **Security audit** -- input validation hardening, certificate scoping, revocation system

The collaboration follows a pattern where decisions are made together and solutions are built with best practices rather than shortcuts. Every commit in this repository was produced through this human-AI partnership.

## Contributing

Contributions are welcome. Please open an issue first to discuss what you would like to change.

## Disclaimer

This software is provided "as is", without warranty of any kind, express or implied. The authors and contributors accept no liability for any damages, data loss, security incidents, or legal consequences arising from the use of this software.

Lamaste is designed for self-hosted use cases — personal projects, development environments, demos, and internal tools. It is not a substitute for production infrastructure. Production workloads require dedicated hosting, load balancing, redundancy, monitoring, and operational expertise that are beyond the scope of this project.

**You are solely responsible for what you expose through Lamaste.** By tunneling an application to the public internet, you grant anyone with access the ability to interact with that application as if they were on your local network. This carries inherent risks:

- **Arbitrary code execution:** If the tunneled application contains vulnerabilities or backdoors, remote attackers may exploit them to execute code on your machine, access your file system, or compromise your operating system.
- **Data exposure:** Misconfigured or insecure applications may leak sensitive data, credentials, or private files to the internet.
- **Lateral movement:** A compromised tunneled application may be used as an entry point to attack other devices and services on your local network.
- **Resource abuse:** Publicly accessible applications may be used for cryptocurrency mining, spam relaying, botnet hosting, or other abuse that could result in legal action against you.

Lamaste provides authentication and access control mechanisms, but no security measure is absolute. It is your responsibility to understand the software you expose, keep it updated, and assess the risks of making it publicly accessible. The authors of Lamaste bear no responsibility for the consequences of tunneling untrusted, vulnerable, or malicious software.

## License

[Polyform Noncommercial 1.0.0](LICENSE.md) — free for personal, academic, and noncommercial use. For commercial licensing, contact license@codelama.com.tr.
