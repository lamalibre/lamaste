# Ports and Services

> Quick reference for port allocation, systemd units, file paths, log locations, and binary locations.

## Port Allocation

| Port | Binding     | Service                      | Protocol | Purpose                                                 |
| ---- | ----------- | ---------------------------- | -------- | ------------------------------------------------------- |
| 22   | `0.0.0.0`   | sshd                         | TCP      | SSH access (installer only, disposable)                 |
| 80   | `0.0.0.0`   | nginx                        | TCP      | HTTP — `301` to HTTPS; Let's Encrypt HTTP-01 challenges |
| 443  | `0.0.0.0`   | nginx                        | TCP      | HTTPS — domain-based access (panel, auth, tunnel, apps) |
| 9292 | `0.0.0.0`   | nginx                        | TCP      | HTTPS — IP-based panel access (mTLS, self-signed cert)  |
| 3100 | `127.0.0.1` | lamalibre-lamaste-serverd    | TCP      | Panel server (Fastify API + static files)               |
| 9090 | `127.0.0.1` | chisel                       | TCP      | Chisel tunnel server (WebSocket)                        |
| 9091 | `127.0.0.1` | authelia                     | TCP      | Authelia authentication server                          |
| 9294 | `127.0.0.1` | lamalibre-lamaste-gatekeeper | TCP      | Tunnel authorization (auth_request target)              |

**Key points:**

- Only nginx listens on public interfaces (`0.0.0.0`)
- All backend services bind to `127.0.0.1` — they are never directly accessible from the internet
- Port 9292 is the emergency fallback — it works even if your domain is lost or DNS breaks
- The UFW firewall only allows ports 22, 80, 443, and 9292. Port 80 serves Let's Encrypt HTTP-01 challenges and otherwise redirects every request to HTTPS (`lamalibre-lamaste-http-redirect`)

### Reserved tunnel ports

A tunnel's port is also a loopback port on the relay: its vhost proxies to `127.0.0.1:<port>`. The ports of Lamaste's own services can therefore never carry a tunnel:

| Port | Service                 |
| ---- | ----------------------- |
| 3100 | Panel server            |
| 9090 | Chisel server           |
| 9091 | Authelia                |
| 9292 | IP-based panel listener |
| 9294 | Gatekeeper              |

A tunnel on one of them would publish that internal service on a public hostname. For the panel that is an administrator takeover, not a leak: the panel trusts the client-certificate headers nginx sets. `RESERVED_TUNNEL_PORTS` in `@lamalibre/lamaste` is enforced by the request schema, inside the tunnel workflow, and again when the Chisel grants are rendered. Tunnel ports must also be 1024–65535.

## Systemd Units

| Unit Name                              | Type   | User                            | Description                                 |
| -------------------------------------- | ------ | ------------------------------- | ------------------------------------------- |
| `lamalibre-lamaste-serverd.service`    | simple | lamaste                         | Panel server (Fastify Node.js API)          |
| `chisel.service`                       | simple | nobody (group `lamaste-chisel`) | Chisel tunnel server (reverse mode)         |
| `authelia.service`                     | simple | lamaste-authelia                | Authelia authentication server              |
| `lamalibre-lamaste-gatekeeper.service` | simple | lamaste                         | Gatekeeper tunnel authorization service     |
| `nginx.service`                        | —      | root                            | nginx reverse proxy (system package)        |
| `fail2ban.service`                     | —      | root                            | Intrusion prevention (system package)       |
| `certbot.timer`                        | timer  | root                            | Automatic Let's Encrypt certificate renewal |

### Common systemctl Commands

| Command                         | Description                                   |
| ------------------------------- | --------------------------------------------- |
| `sudo systemctl status <unit>`  | Check service status and recent logs          |
| `sudo systemctl start <unit>`   | Start a stopped service                       |
| `sudo systemctl stop <unit>`    | Stop a running service                        |
| `sudo systemctl restart <unit>` | Stop then start a service                     |
| `sudo systemctl reload <unit>`  | Reload configuration without downtime (nginx) |
| `sudo systemctl enable <unit>`  | Start automatically on boot                   |
| `sudo systemctl disable <unit>` | Do not start on boot                          |

### Service Unit Files

| Unit                           | File Path                                                  |
| ------------------------------ | ---------------------------------------------------------- |
| `lamalibre-lamaste-serverd`    | `/etc/systemd/system/lamalibre-lamaste-serverd.service`    |
| `chisel`                       | `/etc/systemd/system/chisel.service`                       |
| `authelia`                     | `/etc/systemd/system/authelia.service`                     |
| `lamalibre-lamaste-gatekeeper` | `/etc/systemd/system/lamalibre-lamaste-gatekeeper.service` |
| `nginx`                        | `/lib/systemd/system/nginx.service` (system package)       |
| `fail2ban`                     | `/lib/systemd/system/fail2ban.service` (system package)    |
| `certbot.timer`                | `/lib/systemd/system/certbot.timer` (system package)       |

### Service Startup Order

```
network.target
    ├── nginx.service
    ├── lamalibre-lamaste-serverd.service
    ├── lamalibre-lamaste-gatekeeper.service
    ├── chisel.service
    ├── authelia.service
    └── fail2ban.service
```

All services start after `network.target` and are independent of each other. If one service fails, the others continue running.

The `chisel` and `authelia` units are written by `create-lamaste` (as root) and hardened (`NoNewPrivileges`, empty `CapabilityBoundingSet`, `ProtectSystem=strict`, `PrivateTmp`, `PrivateDevices`; Authelia also `UMask=027`, `ReadWritePaths=/etc/authelia /var/log/authelia` and `SystemCallFilter=@system-service`). `lamaste-authelia` is a system account with no login shell and no home directory, created by the installer. The panel runs as `lamaste` and can start, stop and restart these services through fixed sudoers lines, but never writes their units.

On every start the panel reconciles Chisel in the background (server key, authfile; it also checks that the installed binary is the pinned release and logs an error if not). If the authfile cannot be established it stops and disables `chisel.service` (marker: `/etc/lamalibre/lamaste/chisel-failed-closed`) and retries with backoff (30 s up to 10 min), re-enabling it on success — see [Tunneling](../01-concepts/tunneling.md#startup-reconciliation).

### Agent-side services

Per agent label, on the agent machine (user-level, no root):

| Linux (systemd user units)                          | macOS (LaunchAgents)                   | Purpose                                      |
| --------------------------------------------------- | -------------------------------------- | -------------------------------------------- |
| `lamalibre-lamaste-chisel-<label>.service`          | `com.lamalibre.lamaste.chisel-<label>` | Chisel client; stopped while no tunnels      |
| `lamalibre-lamaste-sync-<label>.service` + `.timer` | `com.lamalibre.lamaste.sync-<label>`   | `lamaste-agent sync` every 30 s              |
| `lamalibre-lamaste-panel-<label>.service`           | `com.lamalibre.lamaste.panel-<label>`  | Optional agent panel (`lamaste-agent panel`) |

## Key File Paths

### Configuration

| Path                                                     | Description                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `/etc/lamalibre/lamaste/panel.json`                      | Panel server configuration                                                          |
| `/etc/lamalibre/lamaste/tunnels.json`                    | Tunnel definitions                                                                  |
| `/etc/lamalibre/lamaste/sites.json`                      | Static site definitions                                                             |
| `/etc/lamalibre/lamaste/chisel-credentials.json`         | Per-agent Chisel credentials                                                        |
| `/etc/lamalibre/lamaste/chisel-users`                    | Chisel authfile: per-agent credentials + port grants (0640, group `lamaste-chisel`) |
| `/etc/lamalibre/lamaste/chisel-sentinel`                 | Sentinel Chisel user password                                                       |
| `/etc/lamalibre/lamaste/ticket-scopes.json`              | Ticket scope registry (scopes, instances, assignments)                              |
| `/etc/lamalibre/lamaste/tickets.json`                    | Ticket and session store                                                            |
| `/etc/lamalibre/lamaste/groups.json`                     | Lamaste group definitions and membership                                            |
| `/etc/lamalibre/lamaste/access-grants.json`              | Generic access grants (principal → resource)                                        |
| `/etc/lamalibre/lamaste/gatekeeper.json`                 | Gatekeeper settings (cache TTL, logging)                                            |
| `/etc/lamalibre/lamaste/access-request-log.json`         | Optional denied access log                                                          |
| `/etc/authelia/configuration.yml`                        | Authelia server configuration                                                       |
| `/etc/authelia/users.yml`                                | Authelia user database                                                              |
| `/etc/authelia/.secrets.json`                            | Authelia secrets (JWT, session, encryption)                                         |
| `/etc/nginx/snippets/lamalibre-lamaste-mtls.conf`        | mTLS configuration snippet                                                          |
| `/etc/nginx/snippets/lamalibre-lamaste-authz-cache.conf` | Gatekeeper proxy_cache zone definition                                              |
| `/etc/sudoers.d/lamaste`                                 | Sudo rules for lamaste user (fixed command lines, no wildcards)                     |
| `/usr/local/sbin/lamaste-priv`                           | Root-owned helper: panel vhosts (allow-listed), Authelia TOTP, self-update          |
| `/usr/local/sbin/lamaste-certbot`                        | Root-owned certbot wrapper (validated, fixed argv)                                  |
| `/usr/local/sbin/lamaste-cert-info`                      | Root-owned read-only Let's Encrypt certificate queries                              |
| `/etc/fail2ban/jail.d/lamaste.conf`                      | fail2ban jail configuration                                                         |
| `/etc/sysctl.d/99-lamaste.conf`                          | Kernel parameter (swappiness)                                                       |

### PKI Certificates

| Path                                             | Description                                          |
| ------------------------------------------------ | ---------------------------------------------------- |
| `/etc/lamalibre/lamaste/pki/ca.key`              | Certificate Authority private key (4096-bit RSA)     |
| `/etc/lamalibre/lamaste/pki/ca.crt`              | Certificate Authority certificate (10-year validity) |
| `/etc/lamalibre/lamaste/pki/client.key`          | Client certificate private key (4096-bit RSA)        |
| `/etc/lamalibre/lamaste/pki/client.crt`          | Client certificate (2-year validity, signed by CA)   |
| `/etc/lamalibre/lamaste/pki/client.p12`          | PKCS12 bundle for browser import                     |
| `/etc/lamalibre/lamaste/pki/.p12-password`       | Password for the PKCS12 bundle                       |
| `/etc/lamalibre/lamaste/pki/self-signed.pem`     | Self-signed TLS cert for IP:9292 (10-year validity)  |
| `/etc/lamalibre/lamaste/pki/self-signed-key.pem` | Self-signed TLS key for IP:9292                      |

### Let's Encrypt Certificates

| Path                                         | Description                       |
| -------------------------------------------- | --------------------------------- |
| `/etc/letsencrypt/live/<fqdn>/fullchain.pem` | Certificate chain                 |
| `/etc/letsencrypt/live/<fqdn>/privkey.pem`   | Private key                       |
| `/etc/letsencrypt/renewal/<fqdn>.conf`       | Auto-renewal configuration        |
| `/etc/letsencrypt/accounts/`                 | Let's Encrypt account credentials |

### nginx Vhosts

| Path                                                           | Description                              |
| -------------------------------------------------------------- | ---------------------------------------- |
| `/etc/nginx/sites-available/lamalibre-lamaste-http-redirect`   | Port 80 catch-all, `301` to HTTPS        |
| `/etc/nginx/sites-available/lamalibre-lamaste-panel-ip`        | IP:9292 panel vhost (mTLS, self-signed)  |
| `/etc/nginx/sites-available/lamalibre-lamaste-panel-domain`    | Domain panel vhost (mTLS, Let's Encrypt) |
| `/etc/nginx/sites-available/lamalibre-lamaste-auth`            | Authelia portal vhost                    |
| `/etc/nginx/sites-available/lamalibre-lamaste-tunnel`          | Chisel WebSocket vhost                   |
| `/etc/nginx/sites-available/lamalibre-lamaste-app-<subdomain>` | Per-tunnel app vhosts                    |
| `/etc/nginx/sites-available/lamalibre-lamaste-site-<uuid>`     | Per-static-site vhosts                   |

### Application Files

| Path                                                      | Description               |
| --------------------------------------------------------- | ------------------------- |
| `/opt/lamalibre/lamaste/lamaste-serverd/`                 | Fastify backend (Node.js) |
| `/opt/lamalibre/lamaste/lamaste-serverd/src/index.js`     | Server entry point        |
| `/opt/lamalibre/lamaste/lamaste-serverd/package.json`     | Server dependencies       |
| `/opt/lamalibre/lamaste/lamaste-server-ui/`               | React frontend            |
| `/opt/lamalibre/lamaste/lamaste-server-ui/dist/`          | Built static assets       |
| `/opt/lamalibre/lamaste/lamaste-server-ui/cert-help.html` | Certificate help page     |
| `/var/www/lamaste/`                                       | Static site uploads       |

## Log Locations

| Service                      | Log Method      | View Command                                                 |
| ---------------------------- | --------------- | ------------------------------------------------------------ |
| lamalibre-lamaste-serverd    | journald        | `journalctl -u lamalibre-lamaste-serverd`                    |
| lamalibre-lamaste-gatekeeper | journald        | `journalctl -u lamalibre-lamaste-gatekeeper`                 |
| chisel                       | journald        | `journalctl -u chisel`                                       |
| authelia                     | journald + file | `journalctl -u authelia` or `/var/log/authelia/authelia.log` |
| nginx                        | file            | `/var/log/nginx/access.log` and `/var/log/nginx/error.log`   |
| fail2ban                     | file            | `/var/log/fail2ban.log`                                      |
| certbot                      | file            | `/var/log/letsencrypt/letsencrypt.log`                       |

### Useful Log Commands

| Command                                      | Description                    |
| -------------------------------------------- | ------------------------------ |
| `journalctl -u lamalibre-lamaste-serverd -f` | Follow panel logs in real time |
| `journalctl -u chisel --since "1 hour ago"`  | Last hour of Chisel logs       |
| `journalctl -u authelia -n 50`               | Last 50 Authelia log entries   |
| `tail -f /var/log/nginx/error.log`           | Follow nginx error log         |
| `tail -f /var/log/fail2ban.log`              | Follow fail2ban activity       |
| `journalctl --disk-usage`                    | Check journal disk usage       |

## Binary Locations

| Binary   | Path                      | Source                                                                                      | Version Check        |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------- | -------------------- |
| Chisel   | `/usr/local/bin/chisel`   | GitHub release 1.12.0, SHA-256 pinned, installed by `create-lamaste`                        | `chisel --version`   |
| Authelia | `/usr/local/bin/authelia` | GitHub release 4.39.28, SHA-256 pinned, installed by `create-lamaste` (a newer one is kept) | `authelia --version` |
| Node.js  | `/usr/bin/node`           | NodeSource repo                                                                             | `node --version`     |
| npm      | `/usr/bin/npm`            | NodeSource repo                                                                             | `npm --version`      |
| nginx    | `/usr/sbin/nginx`         | apt package                                                                                 | `nginx -v`           |
| certbot  | `/usr/bin/certbot`        | apt package                                                                                 | `certbot --version`  |
| openssl  | `/usr/bin/openssl`        | apt package                                                                                 | `openssl version`    |

## Quick Reference

**Check all service statuses at once:**

```bash
sudo systemctl status nginx chisel authelia lamalibre-lamaste-serverd lamalibre-lamaste-gatekeeper --no-pager
```

**Check which ports are listening:**

```bash
sudo ss -tlnp | grep -E ':(22|80|443|3100|9090|9091|9292|9294)\s'
```

**Check disk usage of Lamaste directories:**

```bash
sudo du -sh /etc/lamalibre/lamaste/ /opt/lamalibre/lamaste/ /var/www/lamaste/ /etc/authelia/ /etc/letsencrypt/ 2>/dev/null
```

**Check all Lamaste-related nginx sites:**

```bash
ls -la /etc/nginx/sites-enabled/lamaste-*
```

**Validate nginx configuration:**

```bash
sudo nginx -t
```
