# Installation

> Complete guide to provisioning a Lamaste server from a fresh DigitalOcean droplet in under 10 minutes.

## In Plain English

This guide walks you through creating a cheap cloud server and running a single command that turns it into a secure relay for your local web apps. By the end, you have a browser-accessible admin panel protected by a client certificate — no SSH required after setup.

## Prerequisites

Before you begin, make sure you have:

- A **DigitalOcean account** (or any VPS provider offering Ubuntu 24.04)
- A **local terminal** with SSH and SCP available (macOS Terminal, Linux shell, or Windows PowerShell)
- A **modern browser** (Chrome, Firefox, Safari, or Edge) for importing the client certificate
- Approximately **10 minutes** of uninterrupted time

## Step-by-Step

### 1. Create a DigitalOcean Droplet

1. Log in to [DigitalOcean](https://cloud.digitalocean.com/).
2. Click **Create** and select **Droplets**.
3. Choose these settings:

| Setting            | Value                                                 |
| ------------------ | ----------------------------------------------------- |
| **Region**         | Choose the closest to your users                      |
| **Image**          | Ubuntu 24.04 (LTS) x64                                |
| **Size**           | Basic, Regular, $4/mo (512 MB RAM, 1 vCPU, 10 GB SSD) |
| **Authentication** | SSH keys (recommended) or password                    |
| **Hostname**       | Something memorable, e.g. `lamaste-relay`             |

4. Click **Create Droplet**.
5. Wait for the droplet to boot. Copy its **public IP address** from the dashboard.

The $4/month droplet is sufficient. Lamaste is designed for a 512 MB RAM budget — all services together use approximately 245 MB, with a 1 GB swap file as a safety net.

### 2. SSH into the Droplet

Open your terminal and connect:

```bash
ssh root@203.0.113.42
```

Replace `203.0.113.42` with your droplet's actual IP address.

If you used an SSH key during droplet creation, you connect immediately. If you chose a password, enter it when prompted.

**Expected output:**

```
Welcome to Ubuntu 24.04 LTS (GNU/Linux 6.x.x-xxx-generic x86_64)
...
root@lamaste-relay:~#
```

### 3. Run the Installer

Execute the Lamaste installer:

```bash
apt install -y npm
npx @lamalibre/create-lamaste
```

The installer displays a confirmation banner before making any changes:

```
┌─────────────────────────────────────────────────────────────┐
│  Lamaste Installer                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  This will install Lamaste on this machine.                │
│                                                             │
│  The following changes will be made:                         │
│                                                             │
│    * Reset UFW firewall (allow ports 22, 80, 443, 9292)     │
│    * Harden SSH (disable password authentication)           │
│    * Install fail2ban, Node.js 20, nginx, certbot           │
│    * Generate mTLS certificates for browser access          │
│    * Create lamaste user and systemd service               │
│    * Deploy panel to /opt/lamalibre/lamaste/                         │
│                                                             │
│  Designed for a fresh Ubuntu 24.04 droplet.                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘

  Press Enter to continue or Ctrl+C to abort...
```

Press **Enter** to proceed. To skip the confirmation prompt, use `npx @lamalibre/create-lamaste --yes`.

### 4. What the Installer Does

The installer runs six sequential phases. Each phase displays real-time progress:

**Phase 1 — Environment checks**

```
✔ Checking environment
  ✔ Verifying root access
  ✔ Detecting operating system → Ubuntu 24.04 LTS
  ✔ Detecting IP address → 203.0.113.42
```

The installer verifies you are running as root on Ubuntu 24.04 and detects the droplet's public IP address.

**Phase 2 — OS hardening**

```
✔ Hardening operating system
  ✔ Creating swap file → Swap file created and activated
  ✔ Configuring UFW firewall → UFW enabled with ports 22, 80, 443, 9292 allowed
  ✔ Installing and configuring fail2ban → fail2ban status: active
  ✔ Hardening SSH configuration → SSH hardened: key-auth only, root with keys only
  ✔ Installing system dependencies → System dependencies installed, nginx stopped
```

This phase creates a 1 GB swap file, configures the UFW firewall to allow only ports 22 (SSH), 80 (HTTP for Let's Encrypt), 443 (HTTPS), and 9292 (panel), installs fail2ban with SSH and nginx jails, hardens SSH to disable password authentication, and installs nginx, certbot, curl, and openssl.

**Phase 3 — Node.js**

```
✔ Installing Node.js 20
  ✔ Checking existing Node.js installation → Node.js not found, installing v20 LTS
  ✔ Installing NodeSource repository → NodeSource repository added
  ✔ Installing Node.js 20 LTS → Node.js installed
  ✔ Verifying Node.js installation → Node.js v20.x.x, npm 10.x.x
```

If Node.js 20 or later is already installed, this phase is skipped.

**Phase 4 — mTLS certificates**

```
✔ Generating mTLS certificates
  ✔ Creating PKI directory → PKI directory: /etc/lamalibre/lamaste/pki
  ✔ Generating CA private key and certificate → CA key and certificate generated
  ✔ Generating client key and CSR → Client key and CSR generated
  ✔ Signing client certificate with CA → Client certificate signed and CSR removed
  ✔ Creating PKCS12 bundle → PKCS12 bundle created
```

This phase creates a private certificate authority (CA), signs a client certificate, and bundles it into a `.p12` file for browser import. The CA certificate has a 10-year validity; the client certificate has a 2-year validity.

**Phase 5 — nginx**

```
✔ Configuring nginx
  ✔ Generating self-signed TLS certificate for IP access → Self-signed TLS certificate generated
  ✔ Writing mTLS snippet → mTLS snippet written
  ✔ Writing IP-based panel vhost → Vhost written
  ✔ Deploying certificate help page → Certificate help page deployed
  ✔ Enabling site and cleaning up defaults → Site enabled, default removed
  ✔ Validating and starting nginx → nginx is running and listening on port 9292
```

nginx is configured to listen on port 9292 with TLS and mTLS client certificate verification. A self-signed certificate is used for the IP-based connection (a proper Let's Encrypt certificate is issued later during onboarding when you configure a domain).

**Phase 6 — Panel deployment**

```
✔ Deploying Lamaste panel
  ✔ Creating system user → Created system user: lamaste
  ✔ Creating directory structure → Directories created
  ✔ Deploying lamalibre-lamaste-serverd → Panel server deployed
  ✔ Deploying lamaste-server-ui → Panel client deployed from pre-built dist
  ✔ Writing panel configuration → Configuration written to /etc/lamalibre/lamaste/panel.json
  ✔ Writing systemd service unit → Systemd service unit written
  ✔ Writing sudoers rules → Sudoers rules written and validated
  ✔ Starting panel service → Panel service running. Health: {"status":"ok"}
```

The panel server runs as the `lamaste` system user with restricted sudoers rules, deployed to `/opt/lamalibre/lamaste/`. Configuration lives in `/etc/lamalibre/lamaste/panel.json`.

### 5. Read the Summary

After all phases complete, the installer prints a summary box:

```
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   Lamaste installed successfully!                             ║
║                                                                ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║   1. Download your client certificate:                         ║
║                                                                ║
║      scp root@203.0.113.42:/etc/lamalibre/lamaste/pki/client.p12 .     ║
║                                                                ║
║   2. Import client.p12 into your browser:                      ║
║                                                                ║
║      macOS:  Double-click the file → Keychain Access           ║
║              → select "System" keychain (not "login")          ║
║              → enter the password below when prompted          ║
║              → find cert in System keychain → double-click     ║
║              → Trust → Always Trust                            ║
║                                                                ║
║      Linux:  Chrome → Settings → Privacy & Security            ║
║              → Security → Manage certificates → Import         ║
║                                                                ║
║      Windows: Double-click the file → Certificate Import       ║
║               Wizard → enter the password below                ║
║                                                                ║
║   3. Certificate password:                                     ║
║                                                                ║
║      <random-password-here>                                    ║
║                                                                ║
║   4. Open the Lamaste panel:                                  ║
║                                                                ║
║      https://203.0.113.42:9292                                 ║
║                                                                ║
║      (Your browser will warn about the self-signed cert.       ║
║       This is expected — click "Advanced" → "Proceed")         ║
║                                                                ║
║   You can now disconnect from SSH.                             ║
║   The panel is running and accessible from your browser.       ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
```

**Save the certificate password.** You need it to import the `.p12` file into your browser.

### 6. Download the Client Certificate

Open a **new terminal window** on your local machine (not the SSH session) and run:

```bash
scp root@203.0.113.42:/etc/lamalibre/lamaste/pki/client.p12 .
```

This copies the certificate bundle to your current directory.

### 7. Import the Certificate into Your Browser

The `.p12` file contains both your client certificate and private key, protected by the password shown in the summary.

**macOS (Chrome, Safari, Firefox):**

1. Double-click `client.p12`.
2. Keychain Access opens. Select the **System** keychain (not "login").
3. Enter the certificate password when prompted.
4. Find the imported certificate in the System keychain (look for "admin" under "My Certificates").
5. Double-click the certificate, expand **Trust**, and set "When using this certificate" to **Always Trust**.
6. Close the dialog and enter your macOS password to confirm.

If you see an error about "Local Items" — ignore it. The System keychain import is what matters.

**Linux (Chrome):**

1. Open Chrome and navigate to `chrome://settings/certificates`.
2. Click **Import** under "Your Certificates".
3. Select `client.p12` and enter the password.

**Windows (Chrome, Edge):**

1. Double-click `client.p12`.
2. The Certificate Import Wizard opens.
3. Choose "Current User" and click Next.
4. Enter the certificate password and click Next.
5. Let Windows automatically select the certificate store.
6. Click Finish.

### 8. Access the Panel

Open your browser and navigate to:

```
https://203.0.113.42:9292
```

Your browser warns about the self-signed TLS certificate. This is expected — the IP-based connection uses a self-signed cert because Let's Encrypt cannot issue certificates for IP addresses.

- **Chrome:** Click "Advanced", then "Proceed to 203.0.113.42 (unsafe)".
- **Firefox:** Click "Advanced", then "Accept the Risk and Continue".
- **Safari:** Click "Show Details", then "visit this website".

Your browser then presents the client certificate. Select the "admin" certificate and click OK.

You see the Lamaste onboarding wizard. Proceed to the [Onboarding Guide](onboarding.md) for the next steps.

### 9. Disconnect SSH

You can now close your SSH session:

```bash
exit
```

Everything from this point forward happens through the browser-based admin panel. SSH is never needed again for normal operation.

## For Developers

### Installer Internals

The installer (`packages/create-lamaste`) is built with Listr2 for progress display and execa for shell commands. It runs as a single orchestrated pipeline:

```
main() → envTasks → confirmInstallation() → installTasks → printSummary()
```

Each task module exports a function that returns a Listr2 subtask list:

| Module        | File                  | Purpose                                       |
| ------------- | --------------------- | --------------------------------------------- |
| `hardenTasks` | `src/tasks/harden.js` | Swap, UFW, fail2ban, SSH, apt packages        |
| `nodeTasks`   | `src/tasks/node.js`   | Node.js 20 LTS via NodeSource                 |
| `mtlsTasks`   | `src/tasks/mtls.js`   | CA, client cert, PKCS12 bundle                |
| `nginxTasks`  | `src/tasks/nginx.js`  | Self-signed TLS, mTLS snippet, vhost          |
| `panelTasks`  | `src/tasks/panel.js`  | System user, deploy, config, systemd, sudoers |

### Idempotency

Every task includes skip guards. Running the installer a second time detects existing state and skips completed steps:

- Swap already active: skips creation
- Node.js 20+ installed: skips NodeSource setup
- mTLS CA and client.p12 exist: skips all certificate generation
- UFW active with correct rules: skips firewall configuration
- SSH already hardened: skips SSH changes
- Existing `panel.json`: merges rather than overwrites

### Directory Structure on the Server

After installation, the server has these Lamaste directories:

| Path                                        | Owner               | Purpose                            |
| ------------------------------------------- | ------------------- | ---------------------------------- |
| `/etc/lamalibre/lamaste/`                   | `lamaste:lamaste`   | Configuration and state files      |
| `/etc/lamalibre/lamaste/pki/`               | `root:root` (700)   | CA, client cert, server cert, .p12 |
| `/etc/lamalibre/lamaste/panel.json`         | `lamaste:lamaste`   | Panel configuration                |
| `/opt/lamalibre/lamaste/lamaste-serverd/`   | `lamaste:lamaste`   | Fastify backend                    |
| `/opt/lamalibre/lamaste/lamaste-server-ui/` | `lamaste:lamaste`   | React frontend (built)             |
| `/var/www/lamaste/`                         | `www-data:www-data` | Static site files                  |

### CLI Flags

| Flag            | Effect                                      |
| --------------- | ------------------------------------------- |
| `--help`, `-h`  | Print help and exit                         |
| `--yes`, `-y`   | Skip confirmation prompt                    |
| `--skip-harden` | Skip swap, UFW, fail2ban, and SSH hardening |
| `--dev`         | Allow private/non-routable IP addresses     |
| `--uninstall`   | Print manual removal guide and exit         |

### Systemd Service

The panel runs as `lamalibre-lamaste-serverd.service`:

```ini
[Service]
User=lamaste
Group=lamaste
WorkingDirectory=/opt/lamalibre/lamaste/lamalibre-lamaste-serverd
ExecStart=/usr/bin/node src/index.js
Environment=NODE_ENV=production
Environment=CONFIG_FILE=/etc/lamalibre/lamaste/panel.json
Restart=always
RestartSec=5
```

The service includes security hardening: `ProtectHome=true`, `PrivateTmp=true`, and `ReadWritePaths` for the config and static site directories. `NoNewPrivileges` is intentionally omitted because the panel needs sudo for provisioning (Chisel, Authelia, certbot, nginx, systemctl). Access is restricted via fine-grained sudoers rules in `/etc/sudoers.d/lamaste`.

## Quick Reference

| Item                     | Value                                                        |
| ------------------------ | ------------------------------------------------------------ |
| **Install command**      | `npx @lamalibre/create-lamaste`                              |
| **Minimum VPS**          | Ubuntu 24.04, 512 MB RAM                                     |
| **Required ports**       | 22 (SSH), 80 (HTTP/Let's Encrypt), 443 (HTTPS), 9292 (panel) |
| **Certificate location** | `/etc/lamalibre/lamaste/pki/client.p12`                      |
| **Download command**     | `scp root@<ip>:/etc/lamalibre/lamaste/pki/client.p12 .`      |
| **Panel URL**            | `https://<ip>:9292`                                          |
| **Config file**          | `/etc/lamalibre/lamaste/panel.json`                          |
| **Service name**         | `lamalibre-lamaste-serverd`                                  |
| **Service logs**         | `journalctl -u lamalibre-lamaste-serverd -f`                 |
| **Re-run safe**          | Yes (idempotent)                                             |
| **Total install time**   | ~5-10 minutes                                                |
