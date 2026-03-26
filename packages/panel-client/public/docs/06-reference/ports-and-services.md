# Ports and Services

> Quick reference for port allocation, systemd units, file paths, log locations, and binary locations.

## Port Allocation

| Port | Binding     | Service        | Protocol | Purpose                                                 |
| ---- | ----------- | -------------- | -------- | ------------------------------------------------------- |
| 22   | `0.0.0.0`   | sshd           | TCP      | SSH access (installer only, disposable)                 |
| 443  | `0.0.0.0`   | nginx          | TCP      | HTTPS — domain-based access (panel, auth, tunnel, apps) |
| 9292 | `0.0.0.0`   | nginx          | TCP      | HTTPS — IP-based panel access (mTLS, self-signed cert)  |
| 3100 | `127.0.0.1` | portlama-panel | TCP      | Panel server (Fastify API + static files)               |
| 9090 | `127.0.0.1` | chisel         | TCP      | Chisel tunnel server (WebSocket)                        |
| 9091 | `127.0.0.1` | authelia       | TCP      | Authelia authentication server                          |

**Key points:**

- Only nginx listens on public interfaces (`0.0.0.0`)
- All backend services bind to `127.0.0.1` — they are never directly accessible from the internet
- Port 9292 is the emergency fallback — it works even if your domain is lost or DNS breaks
- The UFW firewall only allows ports 22, 80, 443, and 9292 (port 80 is for Let's Encrypt HTTP-01 challenges)

## Systemd Units

| Unit Name                | Type   | User     | Description                                 |
| ------------------------ | ------ | -------- | ------------------------------------------- |
| `portlama-panel.service` | simple | portlama | Panel server (Fastify Node.js API)          |
| `chisel.service`         | simple | nobody   | Chisel tunnel server (reverse mode)         |
| `authelia.service`       | simple | root     | Authelia authentication server              |
| `nginx.service`          | —      | root     | nginx reverse proxy (system package)        |
| `fail2ban.service`       | —      | root     | Intrusion prevention (system package)       |
| `certbot.timer`          | timer  | root     | Automatic Let's Encrypt certificate renewal |

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

| Unit             | File Path                                               |
| ---------------- | ------------------------------------------------------- |
| `portlama-panel` | `/etc/systemd/system/portlama-panel.service`            |
| `chisel`         | `/etc/systemd/system/chisel.service`                    |
| `authelia`       | `/etc/systemd/system/authelia.service`                  |
| `nginx`          | `/lib/systemd/system/nginx.service` (system package)    |
| `fail2ban`       | `/lib/systemd/system/fail2ban.service` (system package) |
| `certbot.timer`  | `/lib/systemd/system/certbot.timer` (system package)    |

### Service Startup Order

```
network.target
    ├── nginx.service
    ├── portlama-panel.service
    ├── chisel.service
    ├── authelia.service
    └── fail2ban.service
```

All services start after `network.target` and are independent of each other. If one service fails, the others continue running.

## Key File Paths

### Configuration

| Path                                     | Description                                 |
| ---------------------------------------- | ------------------------------------------- |
| `/etc/portlama/panel.json`               | Panel server configuration                  |
| `/etc/portlama/tunnels.json`             | Tunnel definitions                          |
| `/etc/portlama/sites.json`               | Static site definitions                     |
| `/etc/portlama/ticket-scopes.json`       | Ticket scope registry (scopes, instances, assignments) |
| `/etc/portlama/tickets.json`             | Ticket and session store                    |
| `/etc/authelia/configuration.yml`        | Authelia server configuration               |
| `/etc/authelia/users.yml`                | Authelia user database                      |
| `/etc/authelia/.secrets.json`            | Authelia secrets (JWT, session, encryption) |
| `/etc/nginx/snippets/portlama-mtls.conf` | mTLS configuration snippet                  |
| `/etc/sudoers.d/portlama`                | Sudo rules for portlama user                |
| `/etc/fail2ban/jail.d/portlama.conf`     | fail2ban jail configuration                 |
| `/etc/sysctl.d/99-portlama.conf`         | Kernel parameter (swappiness)               |

### PKI Certificates

| Path                                    | Description                                          |
| --------------------------------------- | ---------------------------------------------------- |
| `/etc/portlama/pki/ca.key`              | Certificate Authority private key (4096-bit RSA)     |
| `/etc/portlama/pki/ca.crt`              | Certificate Authority certificate (10-year validity) |
| `/etc/portlama/pki/client.key`          | Client certificate private key (4096-bit RSA)        |
| `/etc/portlama/pki/client.crt`          | Client certificate (2-year validity, signed by CA)   |
| `/etc/portlama/pki/client.p12`          | PKCS12 bundle for browser import                     |
| `/etc/portlama/pki/.p12-password`       | Password for the PKCS12 bundle                       |
| `/etc/portlama/pki/self-signed.pem`     | Self-signed TLS cert for IP:9292 (10-year validity)  |
| `/etc/portlama/pki/self-signed-key.pem` | Self-signed TLS key for IP:9292                      |

### Let's Encrypt Certificates

| Path                                         | Description                       |
| -------------------------------------------- | --------------------------------- |
| `/etc/letsencrypt/live/<fqdn>/fullchain.pem` | Certificate chain                 |
| `/etc/letsencrypt/live/<fqdn>/privkey.pem`   | Private key                       |
| `/etc/letsencrypt/renewal/<fqdn>.conf`       | Auto-renewal configuration        |
| `/etc/letsencrypt/accounts/`                 | Let's Encrypt account credentials |

### nginx Vhosts

| Path                                                  | Description                              |
| ----------------------------------------------------- | ---------------------------------------- |
| `/etc/nginx/sites-available/portlama-panel-ip`        | IP:9292 panel vhost (mTLS, self-signed)  |
| `/etc/nginx/sites-available/portlama-panel-domain`    | Domain panel vhost (mTLS, Let's Encrypt) |
| `/etc/nginx/sites-available/portlama-auth`            | Authelia portal vhost                    |
| `/etc/nginx/sites-available/portlama-tunnel`          | Chisel WebSocket vhost                   |
| `/etc/nginx/sites-available/portlama-app-<subdomain>` | Per-tunnel app vhosts                    |
| `/etc/nginx/sites-available/portlama-site-<uuid>`     | Per-static-site vhosts                   |

### Application Files

| Path                                        | Description               |
| ------------------------------------------- | ------------------------- |
| `/opt/portlama/panel-server/`               | Fastify backend (Node.js) |
| `/opt/portlama/panel-server/src/index.js`   | Server entry point        |
| `/opt/portlama/panel-server/package.json`   | Server dependencies       |
| `/opt/portlama/panel-client/`               | React frontend            |
| `/opt/portlama/panel-client/dist/`          | Built static assets       |
| `/opt/portlama/panel-client/cert-help.html` | Certificate help page     |
| `/var/www/portlama/`                        | Static site uploads       |

## Log Locations

| Service        | Log Method      | View Command                                                 |
| -------------- | --------------- | ------------------------------------------------------------ |
| portlama-panel | journald        | `journalctl -u portlama-panel`                               |
| chisel         | journald        | `journalctl -u chisel`                                       |
| authelia       | journald + file | `journalctl -u authelia` or `/var/log/authelia/authelia.log` |
| nginx          | file            | `/var/log/nginx/access.log` and `/var/log/nginx/error.log`   |
| fail2ban       | file            | `/var/log/fail2ban.log`                                      |
| certbot        | file            | `/var/log/letsencrypt/letsencrypt.log`                       |

### Useful Log Commands

| Command                                     | Description                    |
| ------------------------------------------- | ------------------------------ |
| `journalctl -u portlama-panel -f`           | Follow panel logs in real time |
| `journalctl -u chisel --since "1 hour ago"` | Last hour of Chisel logs       |
| `journalctl -u authelia -n 50`              | Last 50 Authelia log entries   |
| `tail -f /var/log/nginx/error.log`          | Follow nginx error log         |
| `tail -f /var/log/fail2ban.log`             | Follow fail2ban activity       |
| `journalctl --disk-usage`                   | Check journal disk usage       |

## Binary Locations

| Binary   | Path                      | Source          | Version Check        |
| -------- | ------------------------- | --------------- | -------------------- |
| Chisel   | `/usr/local/bin/chisel`   | GitHub releases | `chisel --version`   |
| Authelia | `/usr/local/bin/authelia` | GitHub releases | `authelia --version` |
| Node.js  | `/usr/bin/node`           | NodeSource repo | `node --version`     |
| npm      | `/usr/bin/npm`            | NodeSource repo | `npm --version`      |
| nginx    | `/usr/sbin/nginx`         | apt package     | `nginx -v`           |
| certbot  | `/usr/bin/certbot`        | apt package     | `certbot --version`  |
| openssl  | `/usr/bin/openssl`        | apt package     | `openssl version`    |

## Quick Reference

**Check all service statuses at once:**

```bash
sudo systemctl status nginx chisel authelia portlama-panel --no-pager
```

**Check which ports are listening:**

```bash
sudo ss -tlnp | grep -E ':(22|443|3100|9090|9091|9292)\s'
```

**Check disk usage of Portlama directories:**

```bash
sudo du -sh /etc/portlama/ /opt/portlama/ /var/www/portlama/ /etc/authelia/ /etc/letsencrypt/ 2>/dev/null
```

**Check all Portlama-related nginx sites:**

```bash
ls -la /etc/nginx/sites-enabled/portlama-*
```

**Validate nginx configuration:**

```bash
sudo nginx -t
```
