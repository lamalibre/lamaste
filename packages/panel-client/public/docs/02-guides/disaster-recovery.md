# Disaster Recovery

> Recover from common failures — lost domains, expired certificates, crashed services, and memory issues — without losing your data.

## In Plain English

Things break. Domains expire, certificates lapse, services crash, and servers run out of memory. Portlama is designed with resilience in mind: the admin panel always works via IP address even if your domain is lost, all configuration is stored in simple JSON files that survive reboots, and services are managed by systemd which restarts them automatically. This guide covers the most common failure scenarios and how to recover from each one.

## Prerequisites

- A Portlama installation (working or partially broken)
- Access to a browser with your mTLS client certificate imported
- For SSH fallback: SSH access to the server (last resort)

## Step-by-Step

### Scenario 1: Domain Lost or DNS Broken

**Symptoms:** Your domain-based URLs (`panel.example.com`, `app.example.com`) stop resolving. Visitors see DNS errors. But the server itself is running fine.

**Why this happens:** Domain registration expired, DNS provider had an outage, you accidentally deleted DNS records, or you are migrating to a new domain.

**Recovery:**

1. **Access the panel via IP.** This is the key design principle of Portlama: `https://<ip>:9292` always works, regardless of DNS state. Open:

```
https://203.0.113.42:9292
```

Your browser warns about the self-signed certificate (click through it) and presents your client certificate. The full admin panel is accessible.

2. **Diagnose the DNS issue.** From any machine, check what your domain resolves to:

```bash
dig example.com
dig panel.example.com
```

If there are no results or the wrong IP, the issue is at the DNS level.

3. **Fix the DNS records.** Log in to your domain registrar or DNS provider and verify:

| Type | Name | Value |
|------|------|-------|
| **A** | `example.com` | Your server IP |
| **A** | `*.example.com` | Your server IP |

4. **Wait for propagation.** DNS changes typically take 5-30 minutes. Use [dnschecker.org](https://dnschecker.org) to monitor propagation.

5. **If the domain is permanently lost** and you are switching to a new domain, you need to re-run the onboarding process. This is currently a manual operation requiring SSH access — see the SSH fallback section at the end of this guide.

**Key point:** Your tunnels, users, certificates, and all configuration data remain intact. The IP-based panel provides full management access regardless of DNS state.

### Scenario 2: Let's Encrypt Certificate Expired

**Symptoms:** Visitors see "Your connection is not private" or "Certificate expired" errors when visiting domain-based URLs. The IP-based panel (`https://<ip>:9292`) still works because it uses a self-signed certificate with a 10-year validity.

**Why this happens:** The certbot auto-renewal timer failed or was disabled. Certificates were not renewed within the 90-day validity period.

**Recovery:**

1. **Access the panel via IP:**

```
https://203.0.113.42:9292
```

2. **Go to the Certificates page.** Check which certificates are expired (shown with a red status badge).

3. **Force-renew the expired certificates.** Click the **Renew** button next to each expired certificate. The panel runs:

```bash
certbot renew --cert-name <domain> --force-renewal
```

4. **Verify renewal succeeded.** The certificate list updates with new expiry dates. The status badge turns green.

5. **Check the auto-renewal timer.** Go to the **Services** page and verify that the certbot timer is active. If it is stopped, start it:

- Find the certbot timer in the services list.
- Click **Start** to re-enable automatic renewal.

**If renewal fails from the panel:**

The most common reason is a DNS issue — certbot needs the domain to resolve to your server for HTTP-01 validation. Verify DNS is correct (see Scenario 1).

If the panel cannot renew the certificate, use SSH as a last resort:

```bash
ssh root@203.0.113.42
sudo certbot renew --force-renewal
sudo systemctl reload nginx
```

### Scenario 3: Service Crashed

**Symptoms:** Specific functionality is broken. For example: tunnels stop working (Chisel crashed), login stops working (Authelia crashed), or the panel itself is unreachable (panel server crashed).

**Why this happens:** An unexpected error, memory pressure, or a bug caused the service to exit. Systemd automatically restarts services (with a 5-second delay), but persistent issues can cause repeated crashes.

**Recovery:**

1. **Access the panel.** If the panel server itself crashed, try reloading the page — systemd restarts it within 5 seconds. If it does not come back, use SSH (see below).

If another service crashed (Chisel, Authelia, nginx), the panel is still accessible.

2. **Go to the Services page.** The dashboard shows the health status of all services:

| Service | Systemd Unit | Purpose |
|---------|-------------|---------|
| nginx | `nginx` | Reverse proxy, TLS termination |
| Chisel | `chisel` | Tunnel server |
| Authelia | `authelia` | TOTP two-factor authentication |
| Panel | `portlama-panel` | Admin panel backend |

3. **Check the service status.** A crashed service shows as "inactive" or "failed" with a red status badge.

4. **Restart the service.** Click the **Restart** button next to the failed service. The panel runs:

```bash
sudo systemctl restart <service-name>
```

5. **Check the logs.** If the service crashes again immediately after restart, check its logs from the Services page. The panel provides live log streaming — click the service to view recent log entries.

**Common causes and fixes:**

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Chisel crashes repeatedly | Port conflict or config error | Check `journalctl -u chisel -n 50` via SSH |
| Authelia won't start | Corrupt `users.yml` | Check file syntax, restore from backup if needed |
| nginx fails to reload | Invalid vhost config | Run `nginx -t` via SSH to find the bad config |
| Panel crashes on start | Missing `panel.json` or corrupt config | Verify file exists and is valid JSON |

### Scenario 4: Memory Issues (OOM Kills)

**Symptoms:** Services crash randomly, the server becomes unresponsive, or `dmesg` shows "Out of memory" messages. The 512 MB droplet is running low on RAM.

**Why this happens:** The RAM budget is tight by design (~245 MB for all services, ~265 MB headroom). Memory pressure occurs when a process leaks memory, when too many concurrent connections are open, or if an additional service was installed manually.

**Recovery:**

1. **Access the panel via IP** (if accessible).

2. **Check memory usage on the Dashboard.** The dashboard shows current RAM and swap usage.

3. **If the panel is unreachable, SSH in:**

```bash
ssh root@203.0.113.42
```

4. **Check what is using memory:**

```bash
free -h
ps aux --sort=-%mem | head -20
```

5. **Check for OOM kills:**

```bash
dmesg | grep -i "out of memory" | tail -10
journalctl -k | grep -i oom | tail -10
```

6. **Restart services to free memory:**

```bash
sudo systemctl restart portlama-panel
sudo systemctl restart chisel
sudo systemctl restart authelia
sudo systemctl restart nginx
```

7. **Check swap usage:**

```bash
swapon --show
free -h
```

If swap usage is consistently high (> 500 MB), the server is under memory pressure. Consider:

- **Upgrading the droplet** to 1 GB RAM ($6/month on DigitalOcean). This eliminates memory pressure entirely.
- **Removing unused services** that were installed manually.
- **Reducing nginx worker connections** if you have many concurrent users.

**Critical memory rule:** Authelia must use **bcrypt** for password hashing, not argon2id. Argon2id uses ~93 MB per hash operation, which causes immediate OOM kills on a 512 MB droplet. The Portlama installer configures bcrypt by default.

### Scenario 5: mTLS Certificate Expired

**Symptoms:** Your browser cannot connect to `https://<ip>:9292`. The TLS handshake fails with a certificate error. This is different from a Let's Encrypt certificate expiry — it affects the IP-based panel access.

**Why this happens:** The mTLS client certificate has a 2-year validity. If you did not rotate it before expiry, the browser presents an expired certificate that nginx rejects.

**Recovery:**

This scenario requires SSH access because you cannot reach the panel to rotate the certificate.

1. **SSH into the server:**

```bash
ssh root@203.0.113.42
```

2. **Check certificate expiry:**

```bash
openssl x509 -in /etc/portlama/pki/client.crt -noout -enddate
```

3. **Generate a new client certificate:**

```bash
cd /etc/portlama/pki

# Backup old files
cp client.key client.key.bak
cp client.crt client.crt.bak
cp client.p12 client.p12.bak

# Generate new key
openssl genrsa -out client.key 4096

# Create CSR
openssl req -new -key client.key -out client.csr -subj '/CN=Portlama Client/O=Portlama'

# Sign with CA (2 year validity)
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out client.crt -days 730 -sha256

# Create PKCS12 bundle
NEW_PASSWORD=$(openssl rand -base64 24)
openssl pkcs12 -export \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -out client.p12 -inkey client.key -in client.crt \
  -certfile ca.crt -passout "pass:${NEW_PASSWORD}"

# Save new password
echo -n "${NEW_PASSWORD}" > .p12-password
chmod 600 .p12-password client.key client.p12
chmod 644 client.crt

# Clean up
rm -f client.csr

echo "New certificate password: ${NEW_PASSWORD}"
```

4. **Reload nginx:**

```bash
nginx -t && systemctl reload nginx
```

5. **Download the new certificate:**

```bash
# From your local machine:
scp root@203.0.113.42:/etc/portlama/pki/client.p12 .
```

6. **Import into your browser** following the steps in [Certificate Management](certificate-management.md).

### Scenario 6: SSH Fallback (Last Resort)

If the panel is completely unreachable (both IP-based and domain-based), SSH is the last resort. The installer hardens SSH but does not disable it — key-based authentication always works.

**Connecting:**

```bash
ssh root@203.0.113.42
```

If you used an SSH key during droplet creation, this works. If SSH password authentication was disabled during hardening, you need the SSH key.

**DigitalOcean console access:** If SSH is broken, DigitalOcean provides a web-based console in the droplet dashboard. Click the droplet, then "Access", then "Launch Droplet Console".

**Common recovery commands:**

Check all service statuses:

```bash
systemctl status portlama-panel chisel authelia nginx
```

View recent panel logs:

```bash
journalctl -u portlama-panel --no-pager -n 50
```

Restart all Portlama services:

```bash
systemctl restart nginx chisel authelia portlama-panel
```

Check disk space:

```bash
df -h
```

Check memory:

```bash
free -h
```

Verify panel configuration:

```bash
cat /etc/portlama/panel.json | python3 -m json.tool
```

Test nginx configuration:

```bash
nginx -t
```

## For Developers

### Resilience Design

Portlama is architected for recovery:

- **IP:9292 always works.** The IP-based panel vhost uses a self-signed certificate with 10-year validity and is independent of DNS or Let's Encrypt. Even if every domain-based service fails, the admin panel is accessible.
- **Systemd restarts.** All services (`portlama-panel`, `chisel`, `authelia`) have `Restart=always` and `RestartSec=5` in their systemd units. A single crash is invisible to the user.
- **Atomic writes.** Configuration files (`panel.json`, `tunnels.json`, `sites.json`, `users.yml`) are written atomically (write to temp file, fsync, rename). A crash during write leaves the previous version intact.
- **State in flat files.** No database means no database corruption. JSON files and YAML files are human-readable and easy to repair manually.
- **1 GB swap.** The swap file provides a safety net against brief memory spikes. OOM kills are the last line of defense, not the first.

### Recovery Priority

When multiple things are broken, fix in this order:

1. **nginx** — Everything depends on the reverse proxy
2. **Panel server** — Needed for browser-based management
3. **Authelia** — Needed for tunnel access (but tunnels work without it if auth is bypassed)
4. **Chisel** — Needed for tunnel traffic
5. **Certbot timer** — Needed for long-term cert health but not urgent

### Configuration File Locations

| File | Purpose | Format |
|------|---------|--------|
| `/etc/portlama/panel.json` | Panel configuration, onboarding state | JSON |
| `/etc/portlama/tunnels.json` | Tunnel records | JSON array |
| `/etc/portlama/sites.json` | Static site records | JSON array |
| `/etc/authelia/users.yml` | Authelia user database | YAML |
| `/etc/authelia/configuration.yml` | Authelia config | YAML |
| `/etc/nginx/sites-available/portlama-*` | nginx vhosts | nginx config |
| `/etc/portlama/pki/` | All certificates and keys | PEM/P12 |

## Quick Reference

| Scenario | First Step | SSH Needed? |
|----------|-----------|-------------|
| Domain lost | Access via `https://<ip>:9292` | No |
| LE cert expired | Renew from Certificates page | No |
| Service crashed | Restart from Services page | No |
| Memory issues | Check Dashboard, restart services | Maybe |
| mTLS cert expired | Generate new cert via SSH | Yes |
| Panel unreachable | SSH in, check systemd status | Yes |

| Emergency Command | What It Does |
|-------------------|-------------|
| `systemctl restart portlama-panel` | Restart the panel server |
| `systemctl restart nginx` | Restart the reverse proxy |
| `systemctl restart chisel` | Restart the tunnel server |
| `systemctl restart authelia` | Restart the auth service |
| `nginx -t` | Test nginx config without restarting |
| `journalctl -u portlama-panel -n 50` | View recent panel logs |
| `free -h` | Check memory usage |
| `df -h` | Check disk space |
| `cat /etc/portlama/panel.json` | View panel configuration |

| Design Principle | Implementation |
|-----------------|----------------|
| IP fallback | `https://<ip>:9292` with self-signed TLS (10-year validity) |
| Auto-restart | `Restart=always` in all systemd units |
| Atomic writes | Write to `.tmp`, then `rename()` |
| Memory safety | bcrypt (not argon2id), 1 GB swap |
| No database | JSON/YAML flat files — human-readable, easy to repair |
