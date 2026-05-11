# Certificate Management

> View, renew, and rotate the TLS and mTLS certificates that secure your Lamaste installation.

## In Plain English

Lamaste uses two types of certificates. The first type, Let's Encrypt certificates, encrypts the connection between visitors and your server — the padlock icon in your browser. These renew automatically. The second type, mTLS client certificates, is your digital ID card for accessing the admin panel. This guide covers how to monitor both types, force a renewal when needed, rotate the client certificate, and import a new one into your browser.

## Prerequisites

- A completed [Lamaste onboarding](onboarding.md)
- Access to the Lamaste admin panel
- For mTLS rotation: access to the browser where you import certificates

## Step-by-Step

### 1. Open the Certificates Page

Log in to the Lamaste admin panel at `https://panel.example.com` (or `https://<ip>:9292`).

Click **Certificates** in the sidebar navigation.

The page displays two sections: Let's Encrypt certificates and mTLS certificates. All certificates are sorted by expiry date (soonest first).

### 2. Understanding Certificate Types

**Let's Encrypt certificates** secure the HTTPS connection for your domains:

| Certificate | Domain               | Purpose                         |
| ----------- | -------------------- | ------------------------------- |
| Panel       | `panel.example.com`  | Admin panel HTTPS               |
| Auth        | `auth.example.com`   | Authelia login portal HTTPS     |
| Tunnel      | `tunnel.example.com` | Chisel WebSocket endpoint HTTPS |
| Per-tunnel  | `app.example.com`    | Individual tunnel HTTPS         |
| Per-site    | `blog.example.com`   | Static site HTTPS               |

These are issued during onboarding and when you create tunnels or static sites. They have a 90-day validity and renew automatically via the certbot timer.

**mTLS certificates** authenticate access to the panel:

| Certificate        | Subject            | Purpose                                                |
| ------------------ | ------------------ | ------------------------------------------------------ |
| CA certificate     | `CN=Lamaste CA`   | Signs all client certificates (10-year validity)       |
| Admin certificate  | `CN=admin`         | Full panel access via browser (2-year validity)        |
| Agent certificates | `CN=agent:<label>` | Scoped access for Mac tunnel clients (2-year validity) |
| Self-signed TLS    | `CN=<server-ip>`   | IP-based panel HTTPS (10-year validity)                |

The admin certificate is generated during installation. Agent certificates are created on demand through the panel. Neither type auto-renews — you rotate them manually when needed.

### 3. Check Certificate Status

Each certificate in the list shows:

- **Domain or subject** — Which domain the cert covers
- **Type** — `letsencrypt`, `mtls-ca`, or `mtls-client`
- **Expires** — The expiry date
- **Days remaining** — How many days until expiry
- **Status indicator** — Green (healthy), yellow (expiring within 30 days), red (expired)

The **auto-renewal status** section at the top shows whether the certbot timer is active:

- **Active** — The certbot timer is running and checks for renewals twice daily
- **Next run** — When the next renewal check is scheduled
- **Last run** — When the last renewal check occurred

### 4. Renew a Let's Encrypt Certificate

Let's Encrypt certificates renew automatically. You only need to force a renewal if:

- Auto-renewal failed (check the dashboard for certbot timer status)
- You want to renew immediately rather than waiting
- A certificate expired and needs reissuing

To force-renew a certificate:

1. Find the certificate in the list.
2. Click the **Renew** button next to it.
3. The panel runs `certbot renew --cert-name <domain> --force-renewal`.
4. After renewal, nginx is reloaded to use the new certificate.

**Expected duration:** 10-30 seconds. Certbot contacts Let's Encrypt to verify domain ownership and issue a new certificate.

**If renewal fails:**

- **DNS issue:** The domain must still resolve to your server. Verify with `dig <domain>`.
- **Rate limit:** Let's Encrypt has rate limits (50 certificates per registered domain per week). If you hit a limit, wait and try again later.
- **Port 80 blocked:** Certbot uses HTTP-01 challenges by default, which require port 80. Lamaste's UFW rules allow port 443 but not 80 — however, certbot is configured with the `--nginx` plugin, which handles validation through the existing nginx configuration on port 443.

### 5. Rotate the mTLS Client Certificate

The client certificate has a 2-year validity. When it approaches expiry, or if you want to revoke access from a previously exported certificate, rotate it.

**Before rotating:** Understand that rotation generates a new client certificate. The old certificate stops working immediately after you rotate. Make sure you are prepared to import the new certificate into your browser right away.

1. Go to the **Certificates** page.
2. Find the mTLS section.
3. Click **Rotate Client Certificate**.
4. The panel generates a new client key, signs it with the existing CA, and creates a new `.p12` bundle.
5. A download link appears for the new `client.p12` file.

**What happens during rotation:**

1. The current client key and certificate are backed up (`.bak` suffix).
2. A new 4096-bit RSA key is generated.
3. A new CSR is created with `/CN=Lamaste Client/O=Lamaste`.
4. The CA signs the new certificate (2-year validity).
5. A new PKCS12 bundle is created with a new random password.
6. The old key, certificate, and `.p12` are replaced.
7. nginx is reloaded to accept the new certificate.

### 6. Download the New Certificate

After rotation, download the new `.p12` file:

1. Click the **Download** button on the Certificates page.
2. Save the `client.p12` file.

Alternatively, use SCP from the command line (requires SSH access):

```bash
scp root@203.0.113.42:/etc/lamalibre/lamaste/pki/client.p12 .
```

The new `.p12` password is displayed on screen after rotation. Save it.

### 7. Import the New Certificate into Your Browser

Remove the old certificate first, then import the new one.

**macOS:**

1. Open **Keychain Access** (Applications, Utilities, Keychain Access).
2. Select the **System** keychain.
3. Find the old "admin" certificate under "My Certificates".
4. Right-click and delete it.
5. Double-click the new `client.p12` file.
6. Select the **System** keychain.
7. Enter the new certificate password.
8. Find the new certificate, double-click it, expand Trust, set to **Always Trust**.

**Chrome on Linux:**

1. Navigate to `chrome://settings/certificates`.
2. Under "Your Certificates", find and delete the old Lamaste certificate.
3. Click **Import** and select the new `client.p12` file.
4. Enter the password.

**Windows:**

1. Open the Certificate Manager (`certmgr.msc`).
2. Navigate to Personal, Certificates.
3. Find and delete the old admin certificate.
4. Double-click the new `client.p12` file.
5. Follow the Certificate Import Wizard.

After importing, refresh the panel page. Your browser presents the new certificate automatically.

### 8. Verify the New Certificate

After importing:

1. Close and reopen your browser (recommended for macOS).
2. Navigate to `https://panel.example.com` or `https://<ip>:9292`.
3. Your browser prompts you to select a certificate — choose the new "admin" certificate.
4. The panel loads normally.

If the panel does not load, the most likely cause is that the old certificate is still being presented. Clear the SSL state in your browser:

- **Chrome:** Settings, Privacy and Security, Security, Manage Certificates
- **Firefox:** Preferences, Privacy & Security, View Certificates
- **Safari:** Restart Safari (it picks up Keychain changes automatically)

## Agent Certificates

Agent certificates provide scoped access for Mac tunnel clients. Instead of sharing the admin certificate (which grants full panel access), generate a dedicated agent certificate with only the capabilities the agent needs.

### Why Agent Certificates?

The admin certificate (`CN=admin`) has unrestricted access to all panel endpoints. Giving it to a Mac running the Chisel tunnel client is a security risk — if the Mac is compromised, the attacker has full admin access. Agent certificates solve this by limiting what each client can do.

### Generate an Agent Certificate

1. Go to the **Certificates** page in the panel.
2. Scroll to the **Agent Certificates** section.
3. Click **Generate**.
4. Enter a label (e.g., `macbook-pro`, `office-imac`). Labels must be lowercase letters, numbers, and hyphens only.
5. Select capabilities:
   - **tunnels:read** — always enabled, cannot be removed. Allows listing tunnels and downloading the Mac plist.
   - **tunnels:write** — create and delete tunnels.
   - **services:read** — view service status.
   - **services:write** — start, stop, and restart services.
   - **system:read** — view system stats (CPU, RAM, disk).
   - **sites:read** — list sites and browse files.
   - **sites:write** — upload and delete files on assigned sites.
6. Click **Generate**.
7. **Save the P12 password immediately** — it is only shown once and cannot be retrieved later.
8. Click **Download** to save the `.p12` file.

### Distribute to a Mac User

Send the `.p12` file and password to the Mac user securely. They use it with the Lamaste agent CLI or import it for manual Chisel setup. See [Mac Client Setup](mac-client-setup.md) for details.

### Update Capabilities

Capabilities are stored server-side, not in the certificate. You can change what an agent is allowed to do without reissuing the certificate:

1. Find the agent in the **Agent Certificates** table.
2. Click the **Edit** (pencil) icon.
3. Check or uncheck capabilities.
4. Click **Save**.

The change takes effect on the agent's next API request.

### Revoke an Agent Certificate

If a Mac is lost, stolen, or no longer needs access:

1. Find the agent in the **Agent Certificates** table.
2. Click the **Revoke** (trash) icon.
3. Confirm the revocation.

Revocation is immediate — the certificate serial is added to a revocation list checked on every request. The agent's P12 files are deleted from the server.

## For Developers

### Certificate File Locations

| File                | Path                                          | Permission      |
| ------------------- | --------------------------------------------- | --------------- |
| CA key              | `/etc/lamalibre/lamaste/pki/ca.key`                    | 600             |
| CA certificate      | `/etc/lamalibre/lamaste/pki/ca.crt`                    | 644             |
| Client key          | `/etc/lamalibre/lamaste/pki/client.key`                | 600             |
| Client certificate  | `/etc/lamalibre/lamaste/pki/client.crt`                | 644             |
| PKCS12 bundle       | `/etc/lamalibre/lamaste/pki/client.p12`                | 600             |
| P12 password        | `/etc/lamalibre/lamaste/pki/.p12-password`             | 600             |
| Self-signed key     | `/etc/lamalibre/lamaste/pki/self-signed-key.pem`       | 600             |
| Self-signed cert    | `/etc/lamalibre/lamaste/pki/self-signed.pem`           | 644             |
| Let's Encrypt certs | `/etc/letsencrypt/live/<domain>/`             | certbot-managed |
| Revocation list     | `/etc/lamalibre/lamaste/pki/revoked.json`              | 600             |
| Agent registry      | `/etc/lamalibre/lamaste/pki/agents/registry.json`      | 600             |
| Agent certs         | `/etc/lamalibre/lamaste/pki/agents/<label>/client.p12` | 600             |

### API Endpoints

| Method   | Path                                    | Purpose                            |
| -------- | --------------------------------------- | ---------------------------------- |
| `GET`    | `/api/certs`                            | List all certificates (LE + mTLS)  |
| `GET`    | `/api/certs/auto-renew-status`          | Certbot timer status               |
| `POST`   | `/api/certs/:domain/renew`              | Force-renew a Let's Encrypt cert   |
| `POST`   | `/api/certs/mtls/rotate`                | Rotate the mTLS client certificate |
| `GET`    | `/api/certs/mtls/download`              | Download client.p12                |
| `POST`   | `/api/certs/agent`                      | Generate agent certificate         |
| `GET`    | `/api/certs/agent`                      | List agent certificates            |
| `GET`    | `/api/certs/agent/:label/download`      | Download agent .p12                |
| `PATCH`  | `/api/certs/agent/:label/capabilities`  | Update agent capabilities          |
| `PATCH`  | `/api/certs/agent/:label/allowed-sites` | Update agent site access           |
| `DELETE` | `/api/certs/agent/:label`               | Revoke agent certificate           |
| `POST`   | `/api/certs/agent/enroll`               | Generate enrollment token (admin)  |
| `POST`   | `/api/enroll`                           | Enroll agent with token (public)   |
| `POST`   | `/api/certs/admin/upgrade-to-hardware-bound` | Upgrade admin auth (admin)    |
| `GET`    | `/api/certs/admin/auth-mode`            | Get admin auth mode (admin)        |

### Certificate Response Format

```json
{
  "certs": [
    {
      "type": "letsencrypt",
      "domain": "panel.example.com",
      "expiresAt": "2024-04-15T00:00:00.000Z",
      "daysUntilExpiry": 75,
      "path": "/etc/letsencrypt/live/panel.example.com/fullchain.pem",
      "expiringSoon": false
    },
    {
      "type": "mtls-ca",
      "domain": null,
      "expiresAt": "2034-01-15T00:00:00.000Z",
      "daysUntilExpiry": 3650,
      "path": "/etc/lamalibre/lamaste/pki/ca.crt",
      "expiringSoon": false
    },
    {
      "type": "mtls-client",
      "domain": null,
      "expiresAt": "2028-01-15T00:00:00.000Z",
      "daysUntilExpiry": 730,
      "path": "/etc/lamalibre/lamaste/pki/client.crt",
      "expiringSoon": false
    }
  ]
}
```

### mTLS Rotation Internals

The `rotateClientCert()` function in `lib/mtls.js`:

1. Backs up existing files: `client.key` to `client.key.bak`, etc.
2. Generates new RSA 4096 key via `openssl genrsa`
3. Creates CSR with `openssl req -new -subj '/CN=Lamaste Client/O=Lamaste'`
4. Signs with CA using `openssl x509 -req -days 730`
5. Creates PKCS12 with legacy-compatible settings (`PBE-SHA1-3DES` and `sha1` MAC algorithm) for broad browser compatibility
6. Generates a new random hex password and returns it in the API response (`p12Password`)
7. Sets restrictive file permissions (600 for keys, 644 for certs)

The PKCS12 bundle uses legacy encryption settings (`-keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1`) because newer OpenSSL defaults produce files that macOS Keychain Access cannot import.

### Auto-Renewal Architecture

Certbot auto-renewal uses a systemd timer (`certbot.timer` or `certbot-renew.timer`, depending on the distribution). The timer runs twice daily and checks all managed certificates. Certificates within 30 days of expiry are renewed. After renewal, the certbot deploy hook reloads nginx to use the new certificate.

### nginx mTLS Snippet

The mTLS configuration is in `/etc/nginx/snippets/lamalibre-lamaste-mtls.conf`:

```nginx
ssl_client_certificate /etc/lamalibre/lamaste/pki/ca.crt;
ssl_verify_client on;
```

This tells nginx to require a client certificate signed by the Lamaste CA. No certificate means the TLS handshake is rejected before HTTP — the browser never reaches the panel server.

## Quick Reference

| Certificate Type  | Validity | Renewal                   |
| ----------------- | -------- | ------------------------- |
| Let's Encrypt     | 90 days  | Automatic (certbot timer) |
| mTLS CA           | 10 years | Manual (rarely needed)    |
| Admin client cert | 2 years  | Manual rotation via panel |
| Agent certs       | 2 years  | Generate new, revoke old  |
| Self-signed TLS   | 10 years | Manual (rarely needed)    |

| Action                  | How                                                |
| ----------------------- | -------------------------------------------------- |
| **View all certs**      | Certificates page in panel                         |
| **Force renew LE cert** | Click "Renew" next to the certificate              |
| **Rotate mTLS cert**    | Click "Rotate Client Certificate"                  |
| **Download new .p12**   | Click "Download" after rotation                    |
| **Check auto-renewal**  | View "Auto-Renewal Status" section                 |
| **Generate agent cert** | Agent Certificates section, click "Generate"       |
| **Update agent caps**   | Click edit icon next to agent, toggle capabilities |
| **Revoke agent cert**   | Click revoke icon next to agent, confirm           |

| Warning Sign             | Action                                  |
| ------------------------ | --------------------------------------- |
| Yellow badge (< 30 days) | Monitor — auto-renewal should handle it |
| Red badge (expired)      | Force-renew immediately                 |
| Auto-renewal inactive    | Check certbot timer with Services page  |
| mTLS < 90 days           | Plan rotation, download new cert        |
