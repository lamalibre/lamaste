# Troubleshooting

> Common issues and solutions for Lamaste, organized by symptom.

## Cannot Connect to Panel After Certificate Import

**Symptom:** You imported the `.p12` client certificate into your browser, but `https://<ip>:9292` shows a connection error, SSL error, or "This site can't provide a secure connection."

**Cause 1: Browser is not presenting the certificate.**

Browsers handle client certificates differently. Some require a restart after import.

**Fix:**

1. Close all browser windows completely (not just the tab)
2. Reopen the browser
3. Navigate to `https://<ip>:9292`
4. If prompted to select a certificate, choose the Lamaste certificate
5. On macOS with Safari/Chrome, open Keychain Access and verify the certificate is in your login keychain and marked as trusted

**Cause 2: Wrong certificate password during import.**

If the import appeared to succeed but the certificate was not actually imported.

**Fix:**

1. Check the password in the installer output, or read it from the server:

```bash
sudo cat /etc/lamalibre/lamaste/pki/.p12-password
```

2. Remove any incorrectly imported certificates from your browser/keychain
3. Re-import the `.p12` file with the correct password

**Cause 3: nginx is not running.**

**Fix:**

```bash
sudo systemctl status nginx
# If inactive or failed:
sudo nginx -t
sudo systemctl start nginx
```

**Cause 4: Panel server is not running.**

**Fix:**

```bash
sudo systemctl status lamalibre-lamaste-serverd
# If inactive or failed:
sudo journalctl -u lamalibre-lamaste-serverd -n 30
sudo systemctl restart lamalibre-lamaste-serverd
```

---

## Certificate Help Page Appears Instead of Panel

**Symptom:** You see a page titled "Certificate Required" or similar help content instead of the Lamaste panel.

**Cause:** Your browser is connecting to the server but is not presenting a valid client certificate. nginx returns the help page (HTTP 495/496) when the mTLS handshake fails.

**Fix:**

1. Verify you have imported the client certificate (see the help page for instructions)
2. Try a different browser — some browsers have better client certificate support
3. On Firefox, go to Settings > Privacy & Security > Certificates > View Certificates > Your Certificates, and verify the Lamaste certificate is listed
4. On Chrome/macOS, open Keychain Access and verify the certificate is present and trusted

---

## DNS Verification Failing

**Symptom:** The onboarding DNS verification step keeps showing "DNS not ready" even after you created the records.

**Cause 1: DNS propagation delay.**

DNS changes can take up to 48 hours to propagate globally, though most propagate within 5-30 minutes.

**Fix:**

1. Wait 15-30 minutes and try again
2. Check your DNS records from an external tool:

```bash
dig example.com +short
dig test.example.com +short
```

3. Both should return your server's IP address (the wildcard record makes any subdomain resolve)

**Cause 2: Wrong record type or value.**

Lamaste requires two A records pointing to your server IP:

| Name            | Type | Value          |
| --------------- | ---- | -------------- |
| `example.com`   | A    | `203.0.113.42` |
| `*.example.com` | A    | `203.0.113.42` |

The base domain A record is needed for the domain itself. The wildcard (`*`) A record allows all subdomains (panel, auth, tunnel, and any tunnel subdomains you create) to resolve to the server without adding individual records.

**Fix:**

1. Log into your DNS provider
2. Verify you have both an A record for the base domain and a wildcard `*` A record pointing to the exact IP shown in the panel
3. Ensure there are no conflicting records (e.g., a CNAME on the same subdomain)

**Cause 3: Using a DNS proxy (e.g., Cloudflare).**

If you are using Cloudflare with the orange cloud (proxy) enabled, DNS verification may fail because the IP resolves to Cloudflare's servers instead of your droplet.

**Fix:**

Disable the Cloudflare proxy (grey cloud / DNS only) for your domain and the wildcard record. Lamaste manages its own TLS and does not need a CDN proxy.

---

## Let's Encrypt Certificate Issuance Failure

**Symptom:** Provisioning fails at the certificate issuance step with an error from certbot.

**Cause 1: DNS not pointing to this server.**

The ACME HTTP-01 challenge requires the domain to resolve to the server running certbot.

**Fix:**

1. Verify DNS is correct:

```bash
dig panel.example.com +short
# Should return this server's IP
```

2. If DNS is correct but recently changed, wait a few minutes for propagation

**Cause 2: Rate limit exceeded.**

Let's Encrypt allows 50 certificates per registered domain per week.

**Fix:**

1. Check the error message — it will mention "rate limit" if this is the cause
2. Wait until the rate limit window resets (one week)
3. If testing, use the Let's Encrypt staging environment (not supported by Lamaste's automated flow — this is a manual workaround)

**Cause 3: Port 80 blocked.**

certbot's nginx plugin uses port 80 for the HTTP-01 challenge during initial issuance.

**Fix:**

1. Temporarily open port 80:

```bash
sudo ufw allow 80/tcp
```

2. Re-run provisioning
3. After successful issuance, you can close port 80 again (renewals use the nginx plugin which handles this internally):

```bash
sudo ufw delete allow 80/tcp
```

**Cause 4: nginx server block not found.**

The certbot nginx plugin needs a matching `server_name` block.

**Fix:**

1. Check that the vhost files exist:

```bash
ls -la /etc/nginx/sites-available/lamaste-*
```

2. Ensure they are enabled:

```bash
ls -la /etc/nginx/sites-enabled/lamaste-*
```

3. Verify nginx configuration is valid:

```bash
sudo nginx -t
```

---

## Tunnel Client Cannot Connect

**Symptom:** You installed the Chisel client on your Mac (or other machine), but the tunnel does not establish. The tunneled app is not accessible through the domain.

**Cause 1: Chisel server is not running.**

**Fix:**

```bash
sudo systemctl status chisel
# If not active:
sudo systemctl start chisel
```

**Cause 2: Wrong tunnel endpoint.**

The Chisel client should connect to `https://tunnel.example.com`.

**Fix:**

Verify the tunnel endpoint in the plist or client command:

```bash
chisel client https://tunnel.example.com R:LOCAL_PORT:127.0.0.1:LOCAL_PORT
```

**Cause 3: Firewall blocking the connection.**

On the client machine, ensure outgoing HTTPS (port 443) is not blocked by a corporate firewall or VPN.

**Cause 4: DNS not set up for the tunnel subdomain.**

The `tunnel.example.com` A record must point to the server.

**Fix:**

```bash
dig tunnel.example.com +short
```

**Cause 5: Let's Encrypt certificate not issued for the tunnel subdomain.**

If the tunnel vhost references a certificate that does not exist, nginx will fail to start or refuse connections on that vhost.

**Fix:**

```bash
sudo certbot certificates | grep tunnel
```

If no certificate is listed, re-run provisioning or manually issue:

```bash
sudo certbot certonly --nginx -d tunnel.example.com --email your@email.com --agree-tos --non-interactive
```

---

## Service Fails to Start

**Symptom:** One of the Lamaste services shows `failed` status.

**General diagnostic steps:**

```bash
# 1. Check the service status
sudo systemctl status <service-name>

# 2. Read recent journal logs
sudo journalctl -u <service-name> -n 50 --no-pager

# 3. Check if the binary exists (for chisel/authelia)
ls -la /usr/local/bin/chisel
ls -la /usr/local/bin/authelia
```

### lamalibre-lamaste-serverd fails to start

**Common causes:**

| Cause                        | Log Message             | Fix                                                                  |
| ---------------------------- | ----------------------- | -------------------------------------------------------------------- |
| Missing `panel.json`         | `Config file not found` | Re-run installer or create the file manually                         |
| Invalid JSON in `panel.json` | `contains invalid JSON` | Fix the JSON syntax                                                  |
| Port 3100 in use             | `EADDRINUSE`            | Find and stop the conflicting process: `sudo ss -tlnp sport = :3100` |
| Missing Node.js modules      | `Cannot find module`    | `cd /opt/lamalibre/lamaste/lamalibre-lamaste-serverd && npm install --production`          |

### chisel fails to start

**Common causes:**

| Cause              | Log Message                        | Fix                                                                   |
| ------------------ | ---------------------------------- | --------------------------------------------------------------------- |
| Binary missing     | `exec format error` or `not found` | Re-download the binary (see [Upgrades](../05-operations/upgrades.md)) |
| Port 9090 in use   | `bind: address already in use`     | `sudo ss -tlnp sport = :9090` to find conflicting process             |
| Wrong architecture | `exec format error`                | Download the correct binary for your architecture (amd64 vs arm64)    |

### authelia fails to start

**Common causes:**

| Cause                       | Log Message            | Fix                                                                                               |
| --------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------- |
| Invalid `configuration.yml` | `configuration: error` | Check YAML syntax with `authelia validate-configuration --config /etc/authelia/configuration.yml` |
| Missing `users.yml`         | `cannot open file`     | Create an initial users file (see [Config Files](config-files.md))                                |
| Binary missing              | `not found`            | Re-download the binary                                                                            |
| Wrong permissions           | `permission denied`    | `sudo chmod 600 /etc/authelia/configuration.yml /etc/authelia/users.yml`                          |

---

## High Memory Usage

**Symptom:** Dashboard shows memory usage above 85%, or the server becomes unresponsive.

**Cause 1: Argon2id password hashing.**

If Authelia was manually configured to use argon2id instead of bcrypt, each authentication attempt uses ~93 MB of RAM.

**Fix:**

Verify the password algorithm in `/etc/authelia/configuration.yml`:

```yaml
authentication_backend:
  file:
    password:
      algorithm: bcrypt # MUST be bcrypt, not argon2id
      bcrypt:
        cost: 12
```

If it says `argon2id`, change it to `bcrypt` and re-hash user passwords.

**Cause 2: Node.js memory leak.**

If the panel server's memory grows continuously.

**Fix:**

```bash
sudo systemctl restart lamalibre-lamaste-serverd
```

If this recurs frequently, check lamalibre-lamaste-serverd logs for errors that might indicate a leak.

**Cause 3: Too many simultaneous connections.**

On a 512 MB droplet, the system has limited headroom.

**Fix:**

1. Check current connections:

```bash
ss -s
```

2. If under attack, check fail2ban:

```bash
sudo fail2ban-client status
```

**Cause 4: Swap is not active.**

Without swap, the system has no safety net when RAM is exhausted.

**Fix:**

```bash
# Check if swap is active
swapon --show

# If empty, create swap:
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## nginx Config Test Failure

**Symptom:** `sudo nginx -t` reports an error, or nginx fails to reload/restart.

**Common causes:**

| Error Message                   | Cause                                      | Fix                                                        |
| ------------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| `ssl_certificate ... not found` | Let's Encrypt cert missing or expired      | Re-issue: `sudo certbot certonly --nginx -d <domain>`      |
| `host not found in upstream`    | Backend service not resolvable             | Check that the upstream is `127.0.0.1`, not a hostname     |
| `duplicate listen`              | Two vhosts listening on the same port/name | Check for duplicate vhosts: `ls /etc/nginx/sites-enabled/` |
| `unknown directive`             | nginx version too old for directive        | Check version: `nginx -v`                                  |

**General fix procedure:**

1. Run the test to see the exact error:

```bash
sudo nginx -t 2>&1
```

2. Fix the identified file
3. Test again:

```bash
sudo nginx -t
```

4. Only reload after the test passes:

```bash
sudo systemctl reload nginx
```

---

## TOTP Not Working

**Symptom:** Users enter the correct 6-digit code from their authenticator app, but Authelia rejects it.

**Cause 1: Server clock drift.**

TOTP codes are time-based. If the server's clock is more than 30 seconds off, codes will be rejected.

**Fix:**

```bash
# Check server time
date

# If the time is wrong, sync with NTP:
sudo timedatectl set-ntp true
sudo systemctl restart systemd-timesyncd
timedatectl status
```

**Cause 2: Wrong TOTP secret enrolled.**

The user scanned the QR code incorrectly or the secret was not saved.

**Fix:**

Reset the user's TOTP from the Users page in the panel UI, or via the API:

```
POST /api/users/<username>/reset-totp
```

The user will need to scan a new QR code.

**Cause 3: Authenticator app clock drift.**

The user's phone clock may be out of sync.

**Fix:**

- Google Authenticator: Settings > Time correction for codes > Sync now
- Authy: Ensure the phone's time is set to automatic

**Cause 4: Authelia service not running.**

If Authelia is down, the forward auth check fails and nginx returns an error.

**Fix:**

```bash
sudo systemctl status authelia
sudo systemctl restart authelia
```

---

## Panel Shows "Service Unavailable" (503)

**Symptom:** The panel loads but shows 503 errors for management pages.

**Cause:** Onboarding has not been completed. Management API routes return 503 until `onboarding.status` is `COMPLETED`.

**Fix:**

1. Check onboarding status:

```bash
cat /etc/lamalibre/lamaste/panel.json | grep status
```

2. If status is not `COMPLETED`, complete the onboarding wizard through the browser
3. If onboarding was interrupted during provisioning, you may need to manually set the status:

```bash
# Only as a last resort — verify all components are actually provisioned first
sudo sed -i 's/"status": "PROVISIONING"/"status": "COMPLETED"/' /etc/lamalibre/lamaste/panel.json
sudo systemctl restart lamalibre-lamaste-serverd
```

---

## Panel Shows "Gone" (410) for Onboarding

**Symptom:** You try to access onboarding endpoints but get 410 Gone.

**Cause:** Onboarding has already been completed. Onboarding routes return 410 after `onboarding.status` reaches `COMPLETED`.

**Fix:** This is expected behavior. Use the management UI instead.

---

## Static Site Upload Fails

**Symptom:** Uploading a static site through the panel fails with an error.

**Cause 1: File too large.**

The default maximum upload size is 500 MB (configurable via `maxSiteSize` in `panel.json`).

**Fix:**

Edit `/etc/lamalibre/lamaste/panel.json` and increase `maxSiteSize`:

```json
{
  "maxSiteSize": 1073741824
}
```

Then restart the panel: `sudo systemctl restart lamalibre-lamaste-serverd`

**Cause 2: Disk full.**

**Fix:**

```bash
df -h /
# Free space by removing old backups, logs, or unused sites
```

---

## Quick Reference: Diagnostic Commands

| What to Check        | Command                                                      |
| -------------------- | ------------------------------------------------------------ |
| All service statuses | `sudo systemctl status nginx chisel authelia lamalibre-lamaste-serverd` |
| Panel health         | `curl -s http://127.0.0.1:3100/api/health`                   |
| nginx config test    | `sudo nginx -t`                                              |
| Open ports           | `sudo ss -tlnp`                                              |
| Memory usage         | `free -h`                                                    |
| Disk usage           | `df -h /`                                                    |
| DNS resolution       | `dig panel.example.com +short`                               |
| Certificate status   | `sudo certbot certificates`                                  |
| Server time          | `timedatectl status`                                         |
| Swap status          | `swapon --show`                                              |
| fail2ban status      | `sudo fail2ban-client status`                                |
| Recent panel logs    | `journalctl -u lamalibre-lamaste-serverd -n 30`                         |
| Recent nginx errors  | `tail -20 /var/log/nginx/error.log`                          |
| Authelia logs        | `journalctl -u authelia -n 30`                               |
| Chisel logs          | `journalctl -u chisel -n 30`                                 |
| Onboarding status    | `cat /etc/lamalibre/lamaste/panel.json \| grep status`                |
| PKI password         | `sudo cat /etc/lamalibre/lamaste/pki/.p12-password`                   |
