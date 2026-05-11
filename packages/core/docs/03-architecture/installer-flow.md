# Installer Flow

## What `npx @lamalibre/create-lamaste` Does

The installer is a **zero-prompt, fire-and-forget** command. It assumes:

- Fresh Ubuntu 24.04 droplet
- Running as root (or with sudo)
- Internet connectivity

It requires **no user input**. All configuration happens later through the browser UI.

## Execution Flow

```
$ npx @lamalibre/create-lamaste

  Lamaste Installer v1.0.0

  ✔ Detecting environment
  ✔ Hardening OS
    ├─ Creating 1GB swap
    ├─ Configuring UFW firewall (22, 443, 9292)
    ├─ Installing fail2ban
    ├─ Hardening SSH (no password auth)
    └─ Installing dependencies (curl, openssl, nginx, certbot)
  ✔ Installing Node.js 20 LTS
  ✔ Generating mTLS certificates
    ├─ CA certificate (10yr validity)
    ├─ Client certificate (2yr validity)
    └─ Browser bundle (client.p12)
  ✔ Configuring nginx
    ├─ Self-signed TLS for IP:9292
    ├─ mTLS enforcement
    └─ Proxy to panel backend
  ✔ Deploying Lamaste Panel
    ├─ Installing lamalibre-lamaste-serverd
    ├─ Building lamaste-server-ui
    ├─ Configuring systemd service
    └─ Starting panel service
  ✔ Verifying installation

  ══════════════════════════════════════════════════════════
  ✔ Lamaste installed successfully!

  1. Download your certificate:
     scp root@<droplet-ip>:/etc/lamalibre/lamaste/pki/client.p12 ~/Downloads/

  2. Import certificate into your browser:
     - macOS: Double-click client.p12 → Keychain Access → Always Trust
     - Password: <generated-p12-password>

  3. Open the management panel:
     https://<droplet-ip>:9292

  4. You can now disconnect from SSH.
     Everything else is managed through the browser.
  ══════════════════════════════════════════════════════════
```

## Tasks Breakdown

### 1. Environment Detection

- Verify Ubuntu 24.04
- Verify root or sudo access
- Detect droplet IP address (from metadata API or hostname -I)
- Check available RAM and disk

### 2. OS Hardening

- Create 1GB swap file
- Configure UFW: allow 22, 443, 9292; deny all else
- Install and configure fail2ban (SSH + nginx jails)
- Harden SSH: `PasswordAuthentication no`, `PermitRootLogin prohibit-password`
- Install system packages: curl, openssl, nginx, certbot, python3-certbot-nginx

### 3. Node.js Installation

- Install Node.js 20 LTS via NodeSource repository
- Verify node and npm are available

### 4. mTLS Certificate Generation

- Generate CA key + self-signed CA cert (10yr)
- Generate client key + CSR → sign with CA (2yr)
- Create PKCS12 bundle with random password
- Set file permissions (600 for keys, 644 for certs)
- Store everything under `/etc/lamalibre/lamaste/pki/`

### 5. nginx Configuration

- Generate self-signed TLS cert for IP-based access
- Write mTLS snippet (`ssl_verify_client on`, `ssl_client_certificate ca.crt`)
- Write IP:9292 vhost with mTLS + proxy to 127.0.0.1:3100
- Test config (`nginx -t`) and reload

### 6. Panel Deployment

- Create `/opt/lamalibre/lamaste/` directory structure
- Deploy lamalibre-lamaste-serverd from bundled `vendor/lamaste-serverd/` directory + npm install
- Deploy lamaste-server-ui from bundled `vendor/lamaste-server-ui/dist/` (pre-built, avoids Vite build on low-RAM VPS)
- Write `/etc/lamalibre/lamaste/panel.json` with droplet IP and paths
- Write systemd unit file for panel service
- Enable and start the service
- Configure sudoers for panel service user (systemctl, nginx, certbot operations)

### 7. Verification

- HTTP health check to 127.0.0.1:3100/api/health
- Verify nginx is proxying correctly
- Verify mTLS is enforced (curl without cert should fail)

### 8. Summary Output

- Print scp command for certificate download
- Print p12 password
- Print panel URL
- Print disconnect instruction

## Design Decisions

### Why zero-prompt?

The installer doesn't need domain, email, or ports — all of that is configured through the onboarding UI. This eliminates user error during SSH and makes the installer idempotent and scriptable.

### Why not Docker?

512MB RAM. Docker itself consumes ~100MB, which doesn't leave room for the services. Native systemd services are lighter and simpler to manage.

### Why self-signed TLS for IP access?

There's no domain yet during initial setup. The browser will show a certificate warning, but the mTLS client cert still protects the connection. Once onboarding adds a domain, Let's Encrypt provides a real cert for the domain-based access.

### What happens when re-running on an existing installation?

If an existing Lamaste installation is detected (`/etc/lamalibre/lamaste/panel.json` exists), the installer enters **redeploy mode** by default. This only updates the lamalibre-lamaste-serverd and lamaste-server-ui files, merges configuration, and restarts the service -- skipping OS hardening, mTLS certificates, and nginx configuration. Use `--force-full` to run the complete installation instead.

### Why not use the lamalibre-lamaste-serverd directly on port 9292?

nginx handles TLS termination and mTLS verification at the connection level. The lamalibre-lamaste-serverd never sees unauthenticated traffic. This is more secure than implementing TLS in Node.js.
