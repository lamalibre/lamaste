# Backup and Restore

> Protect your Lamaste installation by backing up critical configuration, state, and certificates.

## In Plain English

A backup is a copy of everything that makes your Lamaste server work the way you set it up — your domain configuration, user accounts, encryption certificates, and tunnel definitions. If something goes wrong (accidental deletion, server failure, or provider issue), a backup lets you rebuild everything on a fresh server instead of starting from scratch.

Lamaste stores all its important data in a handful of directories. There is no database to dump. Everything is plain files: JSON, YAML, and certificate files. Backing up means copying these directories to a safe location.

## For Users

### Critical Files to Back Up

Lamaste's state is spread across four directories. All of them matter.

#### `/etc/lamalibre/lamaste/` — Configuration, State, and PKI

This is the most important directory. It contains:

| File                      | Purpose                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `panel.json`              | Server configuration (IP, domain, email, onboarding status) |
| `tunnels.json`            | Tunnel definitions (subdomain, port, enabled state)         |
| `sites.json`              | Static site definitions                                     |
| `invitations.json`        | Pending user invitations                                    |
| `pki/revoked.json`        | Revoked certificate tracking                                |
| `pki/ca.key`              | Certificate Authority private key                           |
| `pki/ca.crt`              | Certificate Authority certificate                           |
| `pki/client.key`          | Client certificate private key                              |
| `pki/client.crt`          | Client certificate                                          |
| `pki/client.p12`          | PKCS12 bundle (imported into browsers)                      |
| `pki/.p12-password`       | Password for the PKCS12 bundle                              |
| `pki/self-signed.pem`     | Self-signed TLS cert for IP:9292 access                     |
| `pki/self-signed-key.pem` | Self-signed TLS key for IP:9292 access                      |

**If you lose the PKI files**, every browser that imported the client certificate will need a new one. This is the single most important directory to back up.

#### `/etc/authelia/` — User Database and Authentication Config

| File                | Purpose                                                   |
| ------------------- | --------------------------------------------------------- |
| `configuration.yml` | Authelia server configuration                             |
| `users.yml`         | User accounts (usernames, bcrypt password hashes, groups) |
| `.secrets.json`     | JWT secret, session secret, storage encryption key        |
| `db.sqlite3`        | Authelia session/state database                           |

**If you lose the users database**, all user accounts and TOTP secrets are gone. Users will need to be recreated and re-enroll their authenticator apps.

#### `/etc/letsencrypt/` — TLS Certificates

| Path                   | Purpose                                  |
| ---------------------- | ---------------------------------------- |
| `live/*/fullchain.pem` | Active certificate chain for each domain |
| `live/*/privkey.pem`   | Private key for each domain              |
| `renewal/*.conf`       | Auto-renewal configuration per domain    |
| `accounts/`            | Let's Encrypt account credentials        |

**If you lose Let's Encrypt certificates**, you can re-issue them (free, no limit for different domains), but it takes a few minutes per domain and is subject to rate limits (50 certificates per registered domain per week).

#### `/etc/nginx/` — Reverse Proxy Configuration

| Path                                   | Purpose                                       |
| -------------------------------------- | --------------------------------------------- |
| `sites-available/lamaste-*`            | Lamaste vhost configurations                  |
| `sites-enabled/lamaste-*`              | Symlinks to enabled vhosts                    |
| `snippets/lamalibre-lamaste-mtls.conf` | mTLS configuration snippet                    |
| `nginx.conf`                           | Main nginx configuration (usually unmodified) |

**If you lose nginx configs**, the panel can regenerate vhosts for tunnels and sites, but you will need to re-run the provisioning or manually recreate the base vhosts (panel, auth, tunnel).

### Backup Commands

#### Full Backup (Recommended)

Run this on the droplet to create a single compressed archive of everything:

```bash
# Create a timestamped backup
BACKUP_FILE="/root/lamaste-backup-$(date +%Y%m%d-%H%M%S).tar.gz"

sudo tar czf "$BACKUP_FILE" \
  /etc/lamalibre/lamaste/ \
  /etc/authelia/ \
  /etc/letsencrypt/ \
  /etc/nginx/sites-available/lamaste-* \
  /etc/nginx/sites-enabled/lamaste-* \
  /etc/nginx/snippets/lamalibre-lamaste-mtls.conf \
  /etc/systemd/system/lamalibre-lamaste-serverd.service \
  /etc/systemd/system/chisel.service \
  /etc/systemd/system/authelia.service \
  /etc/fail2ban/jail.d/lamaste.conf \
  /etc/sudoers.d/lamaste \
  2>/dev/null

echo "Backup created: $BACKUP_FILE"
ls -lh "$BACKUP_FILE"
```

#### Download the Backup to Your Local Machine

```bash
# From your local machine
scp root@203.0.113.42:/root/lamaste-backup-*.tar.gz ~/backups/
```

#### Minimal Backup (Essential Files Only)

If you just want the irreplaceable data (certificates and state):

```bash
BACKUP_FILE="/root/lamaste-essential-$(date +%Y%m%d-%H%M%S).tar.gz"

sudo tar czf "$BACKUP_FILE" \
  /etc/lamalibre/lamaste/ \
  /etc/authelia/users.yml \
  /etc/authelia/.secrets.json \
  /etc/authelia/configuration.yml

echo "Essential backup created: $BACKUP_FILE"
```

#### Automated Daily Backup

Create a cron job that runs daily and keeps the last 7 backups:

```bash
sudo tee /etc/cron.daily/lamaste-backup << 'SCRIPT'
#!/bin/bash
BACKUP_DIR="/root/lamaste-backups"
mkdir -p "$BACKUP_DIR"

tar czf "$BACKUP_DIR/lamaste-$(date +%Y%m%d).tar.gz" \
  /etc/lamalibre/lamaste/ \
  /etc/authelia/ \
  /etc/letsencrypt/ \
  /etc/nginx/sites-available/lamaste-* \
  /etc/nginx/snippets/lamalibre-lamaste-mtls.conf \
  2>/dev/null

# Keep only the last 7 backups
ls -t "$BACKUP_DIR"/lamaste-*.tar.gz | tail -n +8 | xargs -r rm --
SCRIPT

sudo chmod +x /etc/cron.daily/lamaste-backup
```

### Restore Procedure

#### Restoring to the Same Server

If you need to restore files on the same server (e.g., after accidental deletion):

**Step 1: Stop all services**

```bash
sudo systemctl stop lamalibre-lamaste-serverd
sudo systemctl stop chisel
sudo systemctl stop authelia
sudo systemctl stop nginx
```

**Step 2: Extract the backup**

```bash
# Preview the contents first
tar tzf /root/lamaste-backup-20260313-103045.tar.gz | head -30

# Extract (overwrites existing files)
sudo tar xzf /root/lamaste-backup-20260313-103045.tar.gz -C /
```

**Step 3: Fix permissions**

```bash
sudo chown -R lamaste:lamaste /etc/lamalibre/lamaste/
sudo chmod 700 /etc/lamalibre/lamaste/pki/
sudo chmod 600 /etc/lamalibre/lamaste/pki/ca.key
sudo chmod 600 /etc/lamalibre/lamaste/pki/client.key
sudo chmod 600 /etc/lamalibre/lamaste/pki/client.p12
sudo chmod 600 /etc/lamalibre/lamaste/pki/.p12-password
sudo chmod 640 /etc/lamalibre/lamaste/panel.json
```

**Step 4: Validate nginx configuration**

```bash
sudo nginx -t
```

If the test fails, check for missing certificate files referenced in the vhosts.

**Step 5: Restart services**

```bash
sudo systemctl start nginx
sudo systemctl start authelia
sudo systemctl start chisel
sudo systemctl start lamalibre-lamaste-serverd
```

**Step 6: Verify**

```bash
sudo systemctl status nginx chisel authelia lamalibre-lamaste-serverd
curl -s http://127.0.0.1:3100/api/health
```

#### Restoring to a New Server (Migration)

To move Lamaste to a new droplet:

**Step 1: Create a fresh droplet** (Ubuntu 24.04, same region if possible)

**Step 2: Run the installer**

```bash
npx @lamalibre/create-lamaste@latest --yes
```

**Step 3: Stop services**

```bash
sudo systemctl stop lamalibre-lamaste-serverd chisel authelia nginx
```

**Step 4: Upload and extract the backup**

```bash
# From your local machine
scp ~/backups/lamaste-backup-20260313-103045.tar.gz root@<new-ip>:/root/

# On the new server
sudo tar xzf /root/lamaste-backup-20260313-103045.tar.gz -C /
```

**Step 5: Update the IP address in panel.json**

The new server has a different IP. Update it:

```bash
# Replace old IP with new IP
sudo sed -i 's/OLD_IP/NEW_IP/g' /etc/lamalibre/lamaste/panel.json
```

**Step 6: Regenerate the self-signed certificate for the new IP**

```bash
sudo openssl req -x509 -nodes -days 3650 \
  -newkey rsa:2048 \
  -keyout /etc/lamalibre/lamaste/pki/self-signed-key.pem \
  -out /etc/lamalibre/lamaste/pki/self-signed.pem \
  -subj "/CN=NEW_IP/O=Lamaste" \
  -addext "subjectAltName=IP:NEW_IP"
```

**Step 7: Update DNS records** to point to the new IP

**Step 8: Fix permissions (same as Step 3 above)**

**Step 9: Restart services**

```bash
sudo systemctl daemon-reload
sudo systemctl start nginx authelia chisel lamalibre-lamaste-serverd
```

**Step 10: Re-issue Let's Encrypt certificates** (they are bound to the server that responded to the ACME challenge)

If DNS is already pointing to the new server, the existing certificates will still work. When they are due for renewal, certbot will handle it automatically. If you need to force re-issuance:

```bash
sudo certbot renew --force-renewal
```

**Step 11: Verify everything works** through the browser at `https://<new-ip>:9292`

The existing client certificate (`.p12` file) will still work because the CA key was restored from the backup.

## For Developers

### State File Locations

All Lamaste state is stored as flat files with atomic writes:

| File                                      | Format | Write Pattern                            |
| ----------------------------------------- | ------ | ---------------------------------------- |
| `/etc/lamalibre/lamaste/panel.json`       | JSON   | Write `.tmp` then `rename()`             |
| `/etc/lamalibre/lamaste/tunnels.json`     | JSON   | Write `.tmp`, `fsync()`, then `rename()` |
| `/etc/lamalibre/lamaste/sites.json`       | JSON   | Write `.tmp`, `fsync()`, then `rename()` |
| `/etc/lamalibre/lamaste/invitations.json` | JSON   | Write `.tmp`, `fsync()`, then `rename()` |
| `/etc/authelia/users.yml`                 | YAML   | Write via `sudo mv` from temp file       |

The atomic write pattern (write to temporary file, sync, rename) ensures that a crash during a write does not corrupt the primary file. The `rename()` system call is atomic on POSIX filesystems.

### Backup Considerations

- **`/etc/lamalibre/lamaste/pki/ca.key`** is the root of trust. All client certificates are signed by this CA. If the CA key changes, all previously issued client certificates become invalid.
- **`/etc/authelia/.secrets.json`** contains the JWT secret. If this changes, all active Authelia sessions are invalidated and users must re-authenticate.
- **`/etc/authelia/db.sqlite3`** contains Authelia session data and TOTP registration states. It can be regenerated (users re-enroll TOTP), but this is disruptive.
- **Let's Encrypt account credentials** in `/etc/letsencrypt/accounts/` are tied to the email address used during registration. If lost, certbot creates a new account on next run.

## Quick Reference

| Directory                     | Contains                   | Criticality                       |
| ----------------------------- | -------------------------- | --------------------------------- |
| `/etc/lamalibre/lamaste/`     | Config, state, PKI         | Critical — irreplaceable PKI keys |
| `/etc/authelia/`              | User database, auth config | High — user accounts and secrets  |
| `/etc/letsencrypt/`           | TLS certificates           | Medium — can be re-issued         |
| `/etc/nginx/sites-available/` | Vhost configs              | Low — can be regenerated          |

| Backup Command                                                                   | What It Does        |
| -------------------------------------------------------------------------------- | ------------------- |
| `tar czf backup.tar.gz /etc/lamalibre/lamaste/ /etc/authelia/ /etc/letsencrypt/` | Full config backup  |
| `scp root@IP:/root/backup.tar.gz ~/backups/`                                     | Download backup     |
| `tar xzf backup.tar.gz -C /`                                                     | Restore from backup |

| Post-Restore Step    | Command                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Fix PKI permissions  | `sudo chmod 700 /etc/lamalibre/lamaste/pki/ && sudo chmod 600 /etc/lamalibre/lamaste/pki/ca.key` |
| Validate nginx       | `sudo nginx -t`                                                                                  |
| Restart all services | `sudo systemctl restart nginx authelia chisel lamalibre-lamaste-serverd`                         |
| Verify health        | `curl -s http://127.0.0.1:3100/api/health`                                                       |
