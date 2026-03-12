# Quick Start

> Go from zero to your first publicly accessible tunnel in about 10 minutes, using a $4 DigitalOcean droplet and your Mac.

## In Plain English

This guide walks you through the entire process of setting up Portlama. By the end, you will have a web app running on your Mac that anyone on the internet can access through your own domain, protected by two-factor authentication.

Think of it as three steps: rent a storefront (create a droplet), set up the store (run the installer), and open for business (create a tunnel). The whole process takes about as long as making a cup of coffee.

## For Users

### Prerequisites

Before you start, make sure you have:

| Requirement | Details |
|---|---|
| **DigitalOcean account** | Any cloud provider works, but this guide uses DigitalOcean. You need a fresh Ubuntu 24.04 droplet. |
| **Domain name** | A domain you control (e.g., `example.com`). You need access to its DNS settings. |
| **Mac (or Linux machine)** | The computer running the web apps you want to expose. Must have outbound internet access. |
| **SSH key** | An SSH key pair for accessing the droplet. DigitalOcean can generate one during droplet creation. |
| **A local web app** | Something listening on a port — a dev server, a blog engine, any HTTP service. |

**Cost:** $4/month for the smallest DigitalOcean droplet (512MB RAM, 1 vCPU). That is all you need.

---

### Step 1: Create a Droplet

Log in to DigitalOcean and create a new droplet:

| Setting | Value |
|---|---|
| Image | Ubuntu 24.04 (LTS) |
| Plan | Basic, $4/mo (512MB RAM, 1 vCPU, 10GB SSD) |
| Region | Closest to your users |
| Authentication | SSH key (not password) |

Wait for the droplet to boot. Note its public IP address (e.g., `203.0.113.42`).

```
Droplet created: 203.0.113.42
```

---

### Step 2: Run the Installer

SSH into the droplet and run the Portlama installer:

```bash
ssh root@203.0.113.42
```

Once connected:

```bash
apt install -y npm
npx @lamalibre/create-portlama
```

The installer displays a confirmation banner showing what it will do:

```
┌─────────────────────────────────────────────────────────────┐
│  Portlama Installer                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  This will install Portlama on this machine.                │
│                                                             │
│  The following changes will be made:                         │
│                                                             │
│    * Reset UFW firewall (allow ports 22, 443, 9292 only)    │
│    * Harden SSH (disable password authentication)           │
│    * Install fail2ban, Node.js 20, nginx, certbot           │
│    * Generate mTLS certificates for browser access          │
│    * Create portlama user and systemd service               │
│    * Deploy panel to /opt/portlama/                         │
│                                                             │
│  Designed for a fresh Ubuntu 24.04 droplet.                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Press Enter to continue. The installer runs for 2-3 minutes:

```
  ✔ Checking environment
    ✔ Verifying root access
    ✔ Detecting operating system → Ubuntu 24.04.1 LTS
    ✔ Detecting IP address → 203.0.113.42
  ✔ Hardening operating system
    ✔ Creating swap file
    ✔ Configuring UFW firewall
    ✔ Installing and configuring fail2ban
    ✔ Hardening SSH configuration
    ✔ Installing system dependencies
  ✔ Installing Node.js 20
  ✔ Generating mTLS certificates
    ✔ Creating PKI directory
    ✔ Generating CA private key and certificate
    ✔ Generating client key and CSR
    ✔ Signing client certificate with CA
    ✔ Creating PKCS12 bundle
  ✔ Configuring nginx
  ✔ Deploying Portlama panel
  ✔ Installation complete
```

At the end, a summary box appears with everything you need:

```
╔════════════════════════════════════════════════════════════════╗
║                                                              ║
║   Portlama installed successfully!                           ║
║                                                              ║
╠════════════════════════════════════════════════════════════════╣
║                                                              ║
║   1. Download your client certificate:                       ║
║                                                              ║
║      scp root@203.0.113.42:/etc/portlama/pki/client.p12 .   ║
║                                                              ║
║   2. Import client.p12 into your browser                     ║
║                                                              ║
║   3. Certificate password:                                   ║
║                                                              ║
║      a1b2c3d4e5f6g7h8i9j0k1l2                               ║
║                                                              ║
║   4. Open the Portlama panel:                                ║
║                                                              ║
║      https://203.0.113.42:9292                               ║
║                                                              ║
║   You can now disconnect from SSH.                           ║
║                                                              ║
╚════════════════════════════════════════════════════════════════╝
```

---

### Step 3: Download the Client Certificate

On your local machine (not the droplet), open a new terminal and run the SCP command from the summary:

```bash
scp root@203.0.113.42:/etc/portlama/pki/client.p12 .
```

This downloads `client.p12` to your current directory. This file is your admin credential — it proves to the panel that you are the owner.

---

### Step 4: Import the Certificate

The import process varies by operating system:

**macOS:**

1. Double-click `client.p12`
2. Keychain Access opens. Select the **System** keychain (not "login")
3. Enter the certificate password from the installer summary
4. Find the certificate in the System keychain, double-click it
5. Expand **Trust**, set to **Always Trust**
6. Close and enter your macOS password to confirm

If you see an error about "Local Items" — ignore it. The System keychain import is what matters.

**Linux (Chrome/Chromium):**

1. Open Chrome Settings, then Privacy and Security, then Security
2. Click Manage certificates, then Import
3. Select `client.p12` and enter the password

**Windows:**

1. Double-click `client.p12`
2. The Certificate Import Wizard opens
3. Enter the password and follow the prompts

After importing, **restart your browser** to ensure it picks up the new certificate.

---

### Step 5: Open the Admin Panel

Navigate to the URL from the installer summary:

```
https://203.0.113.42:9292
```

Your browser will show two prompts:

1. **Self-signed certificate warning**: Click "Advanced" then "Proceed" (this is expected — the panel uses a self-signed TLS certificate for the IP-based URL)
2. **Client certificate selection**: Your browser asks which certificate to use. Select the Portlama certificate you just imported.

You are now in the admin panel. The onboarding wizard starts automatically.

---

### Step 6: Complete Onboarding

The onboarding wizard has three steps:

**Step 6a: Domain and Email**

Enter your domain name and email address:

```
Domain:  example.com
Email:   admin@example.com
```

The email is used for Let's Encrypt certificate notifications. The domain is where your tunneled apps will be accessible.

**Step 6b: DNS Verification**

The wizard shows the DNS records you need to create:

```
Type    Name              Value
A       example.com       203.0.113.42
A       *.example.com     203.0.113.42
```

Go to your domain registrar's DNS settings and create these records. The wildcard (`*`) record allows you to create tunnels like `app.example.com`, `blog.example.com`, etc., without adding DNS records for each one.

Click "Verify DNS" in the wizard. It checks that the records resolve correctly. DNS propagation can take a few minutes — the wizard retries automatically.

**Step 6c: Provisioning**

Click "Provision" and watch the progress. The wizard:

1. Downloads and installs Chisel (tunnel server)
2. Downloads and installs Authelia (2FA authentication)
3. Creates the first admin user with TOTP 2FA
4. Issues a Let's Encrypt TLS certificate for your domain
5. Writes nginx vhost configurations
6. Starts all services

This takes 1-2 minutes. When it finishes, onboarding is complete. The page shows your first user's TOTP QR code — scan it with Google Authenticator, Authy, or any TOTP app.

---

### Step 7: Create Your First Tunnel

You are now in the management panel. Navigate to **Tunnels** and click **Create Tunnel**.

Fill in the tunnel details:

| Field | Example | Description |
|---|---|---|
| Subdomain | `myapp` | Creates `myapp.example.com` |
| Local port | `8001` | The port your app listens on locally |
| Description | `My web app` | Optional label |

Click **Create**. The panel:

1. Writes an nginx vhost for `myapp.example.com`
2. Configures Chisel to route traffic to `localhost:8001`
3. Reloads nginx

---

### Step 8: Connect the Mac Client

After creating the tunnel, the panel shows a **Download plist** button. This downloads a macOS launchd configuration file that keeps the Chisel client running and auto-reconnecting.

Alternatively, you can run the Chisel client manually on your Mac:

```bash
chisel client \
  --tls-skip-verify \
  https://tunnel.example.com:443 \
  R:127.0.0.1:8001:127.0.0.1:8001
```

The `R:127.0.0.1:8001:127.0.0.1:8001` part means: "Reverse-forward port 8001 on the server's localhost to port 8001 on my Mac."

---

### Step 9: Test It

Open a browser and go to:

```
https://myapp.example.com
```

You will see the Authelia login page. Log in with the credentials created during onboarding (username + TOTP code from your authenticator app).

After authenticating, you see your local web app, served through the tunnel.

---

### Step 10: Disconnect SSH

Go back to your SSH terminal and type:

```bash
exit
```

You are done with SSH. Everything from here on is managed through the browser panel at `https://203.0.113.42:9292`.

If you ever need SSH again (disaster recovery, manual debugging), it is still available on port 22 with key-based authentication. But for normal operations, you will never need it.

---

### What You Have Now

```
Your Mac                          DigitalOcean Droplet            Internet
┌──────────┐   WebSocket tunnel   ┌──────────────────┐          ┌─────────┐
│ Web app  │◄────────────────────►│ nginx + Chisel   │◄─────────│ Visitors│
│ :8001    │   (encrypted, auto-  │ + Authelia (2FA) │  HTTPS   │         │
│          │    reconnecting)     │ + Let's Encrypt  │          │         │
└──────────┘                      └──────────────────┘          └─────────┘
                                  Admin: https://203.0.113.42:9292 (mTLS)
                                  App:   https://myapp.example.com (2FA)
```

## For Developers

### Installer CLI Flags

The installer accepts optional flags:

```bash
npx @lamalibre/create-portlama [flags]
```

| Flag | Effect |
|---|---|
| `--help`, `-h` | Print help message and exit |
| `--yes`, `-y` | Skip the confirmation prompt |
| `--skip-harden` | Skip OS hardening (swap, UFW, fail2ban, SSH) |
| `--dev` | Allow private/non-routable IP addresses |
| `--force-full` | Run full installation even on existing installs |
| `--uninstall` | Print manual removal guide and exit |

The `--dev` flag is useful for testing on local VMs that do not have public IP addresses.

The `--skip-harden` flag is useful when re-running the installer on a machine that was already hardened, or when you want to manage hardening separately.

### Re-running the Installer

The installer is idempotent. Running it again on an existing installation:

- Preserves `panel.json` configuration (merges, does not overwrite)
- Skips mTLS certificate generation if certificates already exist
- Skips swap creation if swap is already active
- Skips UFW configuration if all required ports are already allowed
- Skips fail2ban if already configured and running
- Updates panel-server and panel-client files
- Restarts the panel service

This means you can safely re-run the installer after an update to the `create-portlama` package without losing your configuration or certificates.

### Development Mode

For local development without a VPS:

```bash
# Terminal 1: Start panel backend
cd packages/panel-server
CONFIG_FILE=../../dev/panel.json NODE_ENV=development node src/index.js

# Terminal 2: Start panel frontend (Vite dev server, proxies /api to :3100)
cd packages/panel-client
npx vite
```

In development mode (`NODE_ENV=development` or `NODE_ENV` unset), the panel server skips mTLS client certificate verification, so you can access it without importing a certificate.

### Troubleshooting

**Browser does not prompt for certificate:**

- Make sure you imported the `.p12` into the correct keychain (System on macOS)
- Restart the browser completely (not just the tab)
- Check that the certificate is trusted (macOS: Keychain Access, find cert, Trust, Always Trust)

**Installer fails at "Detecting IP address":**

- The droplet must have a public IP address
- Use `--dev` flag for testing on private networks

**DNS verification fails:**

- DNS propagation can take up to 48 hours (usually minutes)
- Verify records with `dig example.com` or `nslookup example.com`
- Make sure you created both the `A` record and the wildcard `*.example.com` record

**Panel service fails to start:**

- Check logs: `journalctl -u portlama-panel -n 50`
- Verify config: `cat /etc/portlama/panel.json`
- Check if port 3100 is in use: `ss -tlnp sport = :3100`

## Quick Reference

### Prerequisites Checklist

```
[ ] DigitalOcean account (or any cloud provider)
[ ] Domain name with DNS access
[ ] SSH key pair
[ ] Mac or Linux machine with outbound internet
[ ] A local web app running on some port
```

### Command Sequence

```bash
# 1. Create droplet (Ubuntu 24.04, 512MB, $4/mo)
# 2. SSH in and install
ssh root@203.0.113.42
apt install -y npm
npx @lamalibre/create-portlama

# 3. Download cert (from your local machine)
scp root@203.0.113.42:/etc/portlama/pki/client.p12 .

# 4. Import cert into browser, open panel
#    https://203.0.113.42:9292

# 5. Complete onboarding wizard (domain, DNS, provision)
# 6. Create tunnel in management panel
# 7. Connect Chisel client on your Mac
# 8. Visit https://myapp.example.com
# 9. Disconnect SSH forever
```

### Time Estimates

| Step | Time |
|---|---|
| Create droplet | 1 minute |
| Run installer | 2-3 minutes |
| Import certificate | 1 minute |
| Onboarding wizard | 3-5 minutes (depends on DNS propagation) |
| Create first tunnel | 1 minute |
| **Total** | **~10 minutes** |

### Related Documentation

- [What is Portlama?](./what-is-portlama.md) — overview and use cases
- [How It Works](./how-it-works.md) — architecture and data flow
- [Installation Guide](../02-guides/installation.md) — detailed installation reference
- [First Tunnel Guide](../02-guides/first-tunnel.md) — in-depth tunnel creation walkthrough
- [Mac Client Setup](../02-guides/mac-client-setup.md) — launchd plist, auto-reconnect
- [Troubleshooting](../06-reference/troubleshooting.md) — common issues and solutions
- [Glossary](../06-reference/glossary.md) — A-Z term definitions
