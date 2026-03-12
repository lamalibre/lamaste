# Onboarding

> Walk through the onboarding wizard to configure your domain, verify DNS, and provision the full Portlama stack.

## In Plain English

After installing Portlama, the server is accessible only by IP address. The onboarding wizard connects your domain, verifies that DNS is pointing correctly, and installs all the services needed to run secure tunnels — Chisel for tunneling, Authelia for two-factor authentication, and Let's Encrypt for proper TLS certificates. When it finishes, you have a fully operational platform.

## Prerequisites

- A completed [Portlama installation](installation.md) with the admin panel accessible at `https://<ip>:9292`
- A **domain name** you control (e.g., `example.com`)
- Access to your domain's **DNS management** (registrar dashboard, Cloudflare, Route 53, etc.)
- An **email address** for Let's Encrypt certificate registration

## Step-by-Step

### 1. Open the Admin Panel

Navigate to `https://<ip>:9292` in your browser. Your browser presents the client certificate you imported during installation — select the "admin" certificate.

You see the onboarding wizard with the first step: **Configure your domain**.

### 2. Enter Domain and Email

The first step asks for two pieces of information:

| Field | Example | Purpose |
|-------|---------|---------|
| **Domain** | `example.com` | Base domain for your Portlama installation |
| **Email** | `you@example.com` | Used for Let's Encrypt certificate registration |

Enter your domain name (without `www.` or any prefix — just the base domain) and your email address, then click **Save & Continue**.

The domain must be a valid fully qualified domain name. The email is registered with Let's Encrypt and receives expiry warnings if auto-renewal fails.

**What happens behind the scenes:** The panel sends a `POST /api/onboarding/domain` request. The server validates the domain format and email, stores them in `/etc/portlama/panel.json`, and advances the onboarding status from `FRESH` to `DOMAIN_SET`.

### 3. Configure DNS Records

The wizard now shows the DNS records you need to create at your domain registrar or DNS provider.

You need two A records:

| Type | Name | Value |
|------|------|-------|
| **A** | `example.com` | `203.0.113.42` |
| **A** | `*.example.com` | `203.0.113.42` |

The first record points your base domain to the server. The second is a wildcard record that allows Portlama to create subdomains (like `app.example.com`, `blog.example.com`) without adding individual DNS records each time.

**How to add these records** (varies by provider):

**Cloudflare:**
1. Go to your domain's DNS settings.
2. Click "Add Record".
3. Type: A, Name: `@`, Content: your server IP, Proxy: DNS only (gray cloud).
4. Add another: Type: A, Name: `*`, Content: your server IP, Proxy: DNS only.

**DigitalOcean DNS:**
1. Go to Networking and select your domain.
2. Add an A record: Hostname `@`, Directs to: your droplet.
3. Add an A record: Hostname `*`, Directs to: your droplet.

**Namecheap:**
1. Go to Domain List and click Manage next to your domain.
2. Go to Advanced DNS.
3. Add: Type A Record, Host `@`, Value: your server IP.
4. Add: Type A Record, Host `*`, Value: your server IP.

**GoDaddy:**
1. Go to My Products and click DNS next to your domain.
2. Add Record: Type A, Name `@`, Value: your server IP.
3. Add Record: Type A, Name `*`, Value: your server IP.

DNS propagation usually takes a few minutes but can take up to 48 hours in some cases.

### 4. Verify DNS

After adding the records, click **Verify DNS** in the wizard.

The server checks two things:

1. **Base domain resolution** — Does `example.com` resolve to your server's IP?
2. **Wildcard resolution** — Does `*.example.com` resolve to your server's IP?

**If both pass:** You see two green checkmarks and the message "DNS is correctly configured. Both base domain and wildcard resolve to your server." Click **Continue**.

**If base passes but wildcard fails:** You see a green checkmark for the base domain and a yellow warning for the wildcard. The message reads "Base domain resolves correctly. Wildcard DNS is not configured — you will need to add individual subdomain records for each tunnel." You can still continue — wildcard DNS is recommended but not required. Without it, you add an A record manually for each tunnel subdomain.

**If base fails:** You see a red X. The message tells you what IP the domain resolves to (or that it does not resolve yet). Wait a few minutes and click **Verify DNS** again.

**If something goes wrong:** DNS propagation delays are the most common issue. Use a tool like `dig example.com` or [dnschecker.org](https://dnschecker.org) to verify your records are propagating. Some registrars cache aggressively — try clearing the DNS cache or waiting longer.

### 5. Start Provisioning

After DNS verification succeeds, click **Continue** to reach the provisioning step. Click **Start Provisioning** to begin.

The wizard displays a real-time progress view with six tasks:

**Task 1 — Installing Chisel**

Chisel is the tunneling engine. The provisioner downloads the Chisel binary, writes a systemd service configuration, and starts it. Chisel listens on `127.0.0.1:9090` for WebSocket connections from your Mac.

**Task 2 — Installing Authelia**

Authelia provides two-factor authentication for your tunneled apps. The provisioner downloads the binary, writes the configuration file (using your domain), creates the initial admin user with a random password, and starts the service. Authelia listens on `127.0.0.1:9091`.

Authelia uses **bcrypt** for password hashing (not argon2id) because argon2id uses approximately 93 MB per hash, which causes out-of-memory kills on a 512 MB droplet.

**Task 3 — Issuing TLS certificates**

The provisioner runs certbot to obtain Let's Encrypt certificates for `panel.example.com`, `auth.example.com`, and `tunnel.example.com`. It also sets up the certbot auto-renewal timer.

**Task 4 — Configuring nginx**

Three new nginx vhosts are written and enabled:

| Vhost | Domain | Purpose |
|-------|--------|---------|
| Panel | `panel.example.com` | Admin panel with mTLS |
| Auth | `auth.example.com` | Authelia login portal |
| Tunnel | `tunnel.example.com` | Chisel WebSocket endpoint |

nginx is tested with `nginx -t` and reloaded.

**Task 5 — Verifying services**

The provisioner checks that Chisel, Authelia, nginx, and the panel server are all running and healthy.

**Task 6 — Finalizing setup**

The onboarding status is set to `COMPLETED` in `panel.json`. Management routes become available and onboarding routes return `410 Gone`.

### 6. Save Your Credentials

After provisioning completes, the wizard shows the completion screen with:

- **Admin username:** `admin`
- **Admin password:** A randomly generated password (click the eye icon to reveal, click copy to copy)
- **Panel URL:** `https://panel.example.com`
- **Auth Portal URL:** `https://auth.example.com`
- **IP Access URL:** `https://203.0.113.42:9292` (always works, requires client certificate)

**Save the admin credentials immediately.** The password is generated during provisioning and is not shown again. You use these credentials to log into the Authelia portal when accessing your tunneled apps.

### 7. Set Up Two-Factor Authentication

On your first login to `auth.example.com`, Authelia prompts you to enroll in TOTP two-factor authentication:

1. Open an authenticator app (Google Authenticator, Authy, 1Password, etc.).
2. Scan the QR code displayed by Authelia.
3. Enter the 6-digit code from your authenticator to verify.

After enrollment, every login to a tunneled app requires your username, password, and a TOTP code.

### 8. Go to the Dashboard

Click **Go to Dashboard** to enter the management interface. You now have access to:

- **Dashboard** — System stats and service health
- **Tunnels** — Create and manage tunnels
- **Users** — Manage Authelia users
- **Certificates** — View and renew TLS certificates
- **Sites** — Host static websites
- **Services** — Start, stop, and restart services

Proceed to [Creating Your First Tunnel](first-tunnel.md) to expose your first local app.

## For Developers

### Onboarding State Machine

The onboarding follows a strict state progression stored in `panel.json`:

```
FRESH → DOMAIN_SET → DNS_READY → PROVISIONING → COMPLETED
```

Each transition is enforced by the API:

| Endpoint | Required State | New State |
|----------|---------------|-----------|
| `POST /api/onboarding/domain` | `FRESH` or `DOMAIN_SET` | `DOMAIN_SET` |
| `POST /api/onboarding/verify-dns` | `DOMAIN_SET` or `DNS_READY` | `DNS_READY` |
| `POST /api/onboarding/provision` | `DNS_READY` | `PROVISIONING` then `COMPLETED` |

After `COMPLETED`, all onboarding endpoints return `410 Gone`. Management endpoints return `503 Service Unavailable` before `COMPLETED`.

### Provisioning Internals

Provisioning runs asynchronously — the `POST /api/onboarding/provision` endpoint returns `202 Accepted` immediately and starts the provisioning sequence in the background. Progress is streamed to the client via a WebSocket connection at `/api/onboarding/provision/stream`.

Each provisioning task calls library functions in `packages/panel-server/src/lib/`:

| Task | Library | Key Function |
|------|---------|-------------|
| Install Chisel | `lib/chisel.js` | `installChisel()`, `writeChiselService()`, `startChisel()` |
| Install Authelia | `lib/authelia.js` | `installAuthelia()`, `writeAutheliaConfig()`, `createUser()` |
| Issue certs | `lib/certbot.js` | `issueCoreCerts()`, `setupAutoRenew()` |
| Configure nginx | `lib/nginx.js` | `writePanelVhost()`, `writeAuthVhost()`, `writeTunnelVhost()` |

### DNS Verification Logic

The DNS check resolves two hostnames using Node's `dns.resolve4()`:

1. `example.com` — must resolve to the server IP (required)
2. `test-portlama-check.example.com` — tests wildcard resolution (optional)

The test subdomain `test-portlama-check` is chosen to be unlikely to have an explicit A record, so resolution only succeeds if a wildcard record is present.

## Quick Reference

| Step | Action | Expected Duration |
|------|--------|------------------|
| Domain + email | Enter in wizard | 30 seconds |
| DNS records | Add at registrar | 2-5 minutes |
| DNS propagation | Wait and verify | 1-30 minutes |
| Provisioning | Automatic | 2-5 minutes |
| TOTP enrollment | Scan QR code | 1 minute |

| URL | Purpose | Auth Method |
|-----|---------|-------------|
| `https://panel.example.com` | Admin panel | mTLS client certificate |
| `https://auth.example.com` | Authelia login | Username + password + TOTP |
| `https://203.0.113.42:9292` | IP fallback panel | mTLS client certificate |

| Onboarding Status | Meaning |
|-------------------|---------|
| `FRESH` | No domain configured yet |
| `DOMAIN_SET` | Domain saved, DNS not verified |
| `DNS_READY` | DNS verified, ready to provision |
| `PROVISIONING` | Stack installation in progress |
| `COMPLETED` | Fully operational |
