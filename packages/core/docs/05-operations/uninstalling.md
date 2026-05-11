# Uninstalling

> Completely remove Lamaste from your server, step by step.

## In Plain English

Uninstalling Lamaste means undoing everything the installer did: stopping the services, removing the files, deleting the user account, and optionally reverting the security hardening. After following this guide, your server will be as if Lamaste was never installed (except for system packages like nginx and Node.js, which you may want to keep).

## For Users

### Before You Begin

1. **Download your backup** — if you might want to reinstall later, back up first (see [Backup and Restore](backup-and-restore.md))
2. **Notify your users** — tunneled apps will become unreachable immediately after removal
3. **SSH access** — you will need root SSH access to the server

The uninstall guide is also available from the CLI:

```bash
npx @lamalibre/create-lamaste --uninstall
```

This prints the same steps listed below.

### Step 1: Stop and Disable Services

Stop all Lamaste-managed services so they do not restart on reboot:

```bash
sudo systemctl stop lamalibre-lamaste-serverd
sudo systemctl disable lamalibre-lamaste-serverd
sudo systemctl stop chisel
sudo systemctl disable chisel
sudo systemctl stop authelia
sudo systemctl disable authelia
```

Remove the systemd unit files:

```bash
sudo rm -f /etc/systemd/system/lamalibre-lamaste-serverd.service
sudo rm -f /etc/systemd/system/chisel.service
sudo rm -f /etc/systemd/system/authelia.service
sudo systemctl daemon-reload
```

**Verify:** No Lamaste services should appear as active:

```bash
systemctl list-units --type=service | grep -E 'lamaste|chisel|authelia'
```

Expected output: empty (no matching lines).

### Step 2: Remove nginx Configuration

Remove all Lamaste-related nginx vhosts and the mTLS snippet:

```bash
sudo rm -f /etc/nginx/sites-enabled/lamaste-*
sudo rm -f /etc/nginx/sites-available/lamaste-*
sudo rm -f /etc/nginx/snippets/lamalibre-lamaste-mtls.conf
```

Test the remaining nginx configuration and reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

If `nginx -t` fails, it means there are no remaining valid sites. You can either add back the default site or stop nginx entirely:

```bash
# Option A: Restore default site
sudo ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Option B: Stop nginx
sudo systemctl stop nginx
sudo systemctl disable nginx
```

### Step 3: Remove Lamaste Directories

These directories contain all Lamaste configuration, state, and deployed files:

```bash
sudo rm -rf /etc/lamalibre/lamaste/       # Configuration, PKI certificates, state
sudo rm -rf /opt/lamalibre/lamaste/       # Panel server and client files
sudo rm -rf /var/www/lamaste/   # Static site files
```

**Warning:** This permanently deletes your PKI certificates. If you have not backed up `/etc/lamalibre/lamaste/pki/`, you will not be able to recover the client certificate or CA key.

### Step 4: Remove Authelia Files

```bash
sudo rm -rf /etc/authelia/       # Authelia configuration and user database
sudo rm -rf /var/log/authelia/   # Authelia log files
```

### Step 5: Remove Binaries

Remove the Chisel and Authelia binaries:

```bash
sudo rm -f /usr/local/bin/chisel
sudo rm -f /usr/local/bin/authelia
```

### Step 6: Remove the Lamaste User

```bash
sudo userdel -r lamaste
```

The `-r` flag removes the home directory (if one exists). The `lamaste` user is a system user with no login shell, so there is nothing sensitive in its home directory.

### Step 7: Remove Sudoers Rules

```bash
sudo rm -f /etc/sudoers.d/lamaste
```

**Verify:** Confirm the file is gone:

```bash
ls -la /etc/sudoers.d/lamaste
```

Expected: `No such file or directory`.

### Step 8: Remove fail2ban Configuration (Optional)

If you want to keep fail2ban running (recommended for security), skip this step. Only the Lamaste-specific jail configuration is removed:

```bash
sudo rm -f /etc/fail2ban/jail.d/lamaste.conf
sudo systemctl restart fail2ban
```

### Step 9: Revert SSH Hardening (Optional)

During installation, Lamaste hardens SSH by disabling password authentication. If a backup of the original configuration was created, you can restore it:

```bash
# Check if the backup exists
ls -la /etc/ssh/sshd_config.pre-lamaste

# Restore if it exists
sudo cp /etc/ssh/sshd_config.pre-lamaste /etc/ssh/sshd_config
sudo sshd -t && sudo systemctl restart ssh
```

**Warning:** Only revert SSH hardening if you understand the security implications. Disabling password authentication is a security best practice regardless of Lamaste.

### Step 10: Revert Firewall Changes (Optional)

Remove the Lamaste-specific UFW rule for port 9292:

```bash
sudo ufw delete allow 9292/tcp
```

Ports 22 (SSH) and 443 (HTTPS) were also opened during installation. You may want to keep these:

```bash
# Only remove if you no longer need HTTPS on this server
sudo ufw delete allow 443/tcp
```

**Verify:**

```bash
sudo ufw status
```

### Step 11: Remove Swap File (Optional)

If Lamaste created the swap file (common on 512 MB droplets):

```bash
sudo swapoff /swapfile
sudo rm -f /swapfile
```

Remove the swap entry from `/etc/fstab`:

```bash
sudo sed -i '/\/swapfile/d' /etc/fstab
```

Remove the swappiness setting:

```bash
sudo rm -f /etc/sysctl.d/99-lamaste.conf
sudo sysctl vm.swappiness=60  # Restore Ubuntu default
```

### Step 12: Remove Let's Encrypt Certificates (Optional)

List all certificates managed by certbot:

```bash
sudo certbot certificates
```

Delete certificates for Lamaste domains:

```bash
# Replace with your actual domain
sudo certbot delete --cert-name panel.example.com
sudo certbot delete --cert-name auth.example.com
sudo certbot delete --cert-name tunnel.example.com
# Delete any app-specific certificates
sudo certbot delete --cert-name myapp.example.com
```

### Step 13: Remove System Packages (Optional)

If you installed this server solely for Lamaste and want to remove the system packages:

```bash
sudo apt-get remove --purge -y nginx certbot python3-certbot-nginx fail2ban
sudo apt-get autoremove -y
```

**Warning:** Only do this if no other applications on this server depend on these packages.

### Summary Checklist

| Step                      | Command                                                                    | Required? |
| ------------------------- | -------------------------------------------------------------------------- | --------- |
| 1. Stop services          | `systemctl stop/disable` + remove unit files                               | Yes       |
| 2. Remove nginx config    | `rm lamaste-*` vhosts and snippet                                          | Yes       |
| 3. Remove Lamaste dirs    | `rm -rf /etc/lamalibre/lamaste/ /opt/lamalibre/lamaste/ /var/www/lamaste/` | Yes       |
| 4. Remove Authelia files  | `rm -rf /etc/authelia/ /var/log/authelia/`                                 | Yes       |
| 5. Remove binaries        | `rm /usr/local/bin/chisel /usr/local/bin/authelia`                         | Yes       |
| 6. Remove user            | `userdel -r lamaste`                                                       | Yes       |
| 7. Remove sudoers         | `rm /etc/sudoers.d/lamaste`                                                | Yes       |
| 8. Remove fail2ban config | `rm /etc/fail2ban/jail.d/lamaste.conf`                                     | Optional  |
| 9. Revert SSH hardening   | Restore `sshd_config.pre-lamaste`                                          | Optional  |
| 10. Revert firewall       | `ufw delete allow 9292/tcp`                                                | Optional  |
| 11. Remove swap           | `swapoff /swapfile && rm /swapfile`                                        | Optional  |
| 12. Remove LE certs       | `certbot delete --cert-name <domain>`                                      | Optional  |
| 13. Remove packages       | `apt-get remove nginx certbot fail2ban`                                    | Optional  |

## For Developers

### What the Installer Creates

For reference, here is a complete list of everything the installer and onboarding provisioning create on the system:

**Systemd services:**

- `/etc/systemd/system/lamalibre-lamaste-serverd.service`
- `/etc/systemd/system/chisel.service`
- `/etc/systemd/system/authelia.service`

**Directories:**

- `/etc/lamalibre/lamaste/` (config, state)
- `/etc/lamalibre/lamaste/pki/` (certificates)
- `/opt/lamalibre/lamaste/` (panel server and client)
- `/opt/lamalibre/lamaste/lamaste-serverd/` (Fastify backend)
- `/opt/lamalibre/lamaste/lamaste-server-ui/` (React frontend build)
- `/var/www/lamaste/` (static site uploads)
- `/etc/authelia/` (auth config and user database)
- `/var/log/authelia/` (auth logs)

**Binaries:**

- `/usr/local/bin/chisel`
- `/usr/local/bin/authelia`

**nginx files:**

- `/etc/nginx/sites-available/lamalibre-lamaste-panel-ip`
- `/etc/nginx/sites-available/lamalibre-lamaste-panel-domain`
- `/etc/nginx/sites-available/lamalibre-lamaste-auth`
- `/etc/nginx/sites-available/lamalibre-lamaste-tunnel`
- `/etc/nginx/sites-available/lamalibre-lamaste-app-*`
- `/etc/nginx/sites-available/lamalibre-lamaste-site-*`
- Corresponding symlinks in `/etc/nginx/sites-enabled/`
- `/etc/nginx/snippets/lamalibre-lamaste-mtls.conf`

**System configuration:**

- `/etc/sudoers.d/lamaste`
- `/etc/fail2ban/jail.d/lamaste.conf`
- `/etc/ssh/sshd_config.pre-lamaste` (backup only)
- `/etc/sysctl.d/99-lamaste.conf`
- `/swapfile` (and entry in `/etc/fstab`)

**System user:**

- `lamaste` (system user, no login shell)

## Quick Reference

**Quick uninstall (required steps only):**

```bash
# Stop and remove services
sudo systemctl stop lamalibre-lamaste-serverd chisel authelia
sudo systemctl disable lamalibre-lamaste-serverd chisel authelia
sudo rm -f /etc/systemd/system/{lamalibre-lamaste-serverd,chisel,authelia}.service
sudo systemctl daemon-reload

# Remove nginx config
sudo rm -f /etc/nginx/sites-enabled/lamaste-*
sudo rm -f /etc/nginx/sites-available/lamaste-*
sudo rm -f /etc/nginx/snippets/lamalibre-lamaste-mtls.conf
sudo nginx -t && sudo systemctl reload nginx

# Remove files, binaries, user, and sudoers
sudo rm -rf /etc/lamalibre/lamaste/ /opt/lamalibre/lamaste/ /var/www/lamaste/
sudo rm -rf /etc/authelia/ /var/log/authelia/
sudo rm -f /usr/local/bin/chisel /usr/local/bin/authelia
sudo userdel -r lamaste
sudo rm -f /etc/sudoers.d/lamaste
```
