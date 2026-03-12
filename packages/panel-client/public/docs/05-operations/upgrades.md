# Upgrades

> Keep Portlama and its dependencies up to date with safe, tested upgrade procedures.

## In Plain English

Software needs updates — for security patches, bug fixes, and new features. Portlama is made up of several independent pieces (the panel, the tunnel server, the authentication server, and the operating system), and each one updates differently.

The good news: most updates are straightforward. The installer is designed to be re-run safely on an existing installation, and the individual binaries can be replaced without affecting other components.

## For Users

### Before Any Upgrade

Always follow these steps before upgrading any component:

1. **Back up your configuration** (see [Backup and Restore](backup-and-restore.md))
2. **Note what is currently working** — check the dashboard, verify services are active
3. **Plan for a brief outage** — most upgrades require a service restart (seconds, not minutes)

### Updating Portlama (Panel Server and Client)

The Portlama installer is idempotent — you can re-run it on an existing installation to update the panel server and client without losing your configuration.

**Step 1: SSH into your droplet**

```bash
ssh root@203.0.113.42
```

**Step 2: Re-run the installer**

```bash
npx @lamalibre/create-portlama@latest --yes
```

The `@latest` tag ensures you get the newest published version. The `--yes` flag skips the confirmation prompt.

**What happens during re-install:**

- The installer detects the existing installation
- It preserves your `/etc/portlama/panel.json` configuration (domain, email, onboarding status)
- It preserves your mTLS certificates (the PKI directory is not regenerated if it already exists)
- It deploys updated panel-server and panel-client files to `/opt/portlama/`
- It restarts the `portlama-panel` systemd service

**Step 3: Verify the update**

```bash
systemctl status portlama-panel
```

Expected output includes `active (running)`. Then open your browser and check the dashboard.

**Step 4: Disconnect SSH**

```bash
exit
```

### Updating Chisel

Chisel is the tunnel server binary at `/usr/local/bin/chisel`. It is installed during the onboarding provisioning step, not by the base installer.

**Step 1: Check the current version**

```bash
/usr/local/bin/chisel --version
```

**Step 2: Check the latest release**

Visit [https://github.com/jpillora/chisel/releases](https://github.com/jpillora/chisel/releases) or run:

```bash
curl -s https://api.github.com/repos/jpillora/chisel/releases/latest | grep tag_name
```

**Step 3: Download and replace the binary**

```bash
# Download the latest linux_amd64 release
curl -L -o /tmp/chisel.gz \
  "https://github.com/jpillora/chisel/releases/latest/download/chisel_$(curl -s https://api.github.com/repos/jpillora/chisel/releases/latest | grep -oP '"tag_name":\s*"v?\K[^"]+')_linux_amd64.gz"

# Extract
gunzip -f /tmp/chisel.gz

# Stop the service
sudo systemctl stop chisel

# Replace the binary
sudo mv /tmp/chisel /usr/local/bin/chisel
sudo chmod +x /usr/local/bin/chisel

# Start the service
sudo systemctl start chisel
```

**Step 4: Verify**

```bash
/usr/local/bin/chisel --version
sudo systemctl status chisel
```

The service should be `active (running)`. Check that your tunnel clients can reconnect — they will automatically retry after the brief interruption.

### Updating Authelia

Authelia is the authentication server binary at `/usr/local/bin/authelia`.

**Step 1: Check the current version**

```bash
/usr/local/bin/authelia --version
```

**Step 2: Check the latest release**

Visit [https://github.com/authelia/authelia/releases](https://github.com/authelia/authelia/releases) or run:

```bash
curl -s https://api.github.com/repos/authelia/authelia/releases/latest | grep tag_name
```

**Step 3: Download and replace the binary**

```bash
# Download the latest linux-amd64 tarball
AUTHELIA_URL=$(curl -s https://api.github.com/repos/authelia/authelia/releases/latest \
  | grep -oP '"browser_download_url":\s*"\K[^"]*linux-amd64[^"]*\.tar\.gz')
curl -L -o /tmp/authelia.tar.gz "$AUTHELIA_URL"

# Extract
mkdir -p /tmp/authelia-extract
tar xzf /tmp/authelia.tar.gz -C /tmp/authelia-extract

# Find the binary
AUTHELIA_BIN=$(find /tmp/authelia-extract -name authelia -type f)

# Stop the service
sudo systemctl stop authelia

# Replace the binary
sudo mv "$AUTHELIA_BIN" /usr/local/bin/authelia
sudo chmod +x /usr/local/bin/authelia

# Start the service
sudo systemctl start authelia

# Clean up
rm -rf /tmp/authelia.tar.gz /tmp/authelia-extract
```

**Step 4: Verify**

```bash
/usr/local/bin/authelia --version
sudo systemctl status authelia
```

**Important:** Authelia configuration format may change between major versions. Check the [Authelia changelog](https://github.com/authelia/authelia/blob/master/CHANGELOG.md) before upgrading across major versions. If the configuration format has changed, you need to update `/etc/authelia/configuration.yml` before restarting.

### System Package Updates (apt)

The underlying Ubuntu system should be kept up to date for security patches.

**Step 1: Update package lists**

```bash
sudo apt-get update
```

**Step 2: Review available upgrades**

```bash
sudo apt-get --simulate upgrade
```

This shows what would be upgraded without actually doing it. Review the list for any unexpected changes.

**Step 3: Apply upgrades**

```bash
sudo apt-get upgrade -y
```

**Step 4: Handle packages that require restart**

```bash
# Check if any services need restarting
sudo needrestart -r l
```

If nginx or other Portlama-related packages were updated, restart them:

```bash
sudo systemctl restart nginx
sudo systemctl restart portlama-panel
```

**Step 5: Kernel updates**

If a new kernel was installed, you will need to reboot:

```bash
sudo reboot
```

After reboot, all Portlama services start automatically (they are enabled via systemd). Verify via the dashboard or:

```bash
sudo systemctl status nginx chisel authelia portlama-panel
```

### Updating nginx

nginx is installed via apt, so it is updated as part of system package updates. However, after an nginx update:

1. Test the configuration:

```bash
sudo nginx -t
```

2. If the test passes, reload:

```bash
sudo systemctl reload nginx
```

3. Verify all sites are accessible.

### Updating certbot

certbot is also installed via apt. After updating:

1. Verify the timer is still active:

```bash
sudo systemctl status certbot.timer
```

2. Test a dry-run renewal:

```bash
sudo certbot renew --dry-run
```

### What to Check After Any Upgrade

After upgrading any component, verify these items:

1. **Dashboard loads** — open `https://<ip>:9292` in your browser
2. **All services active** — check the Services page or run:

```bash
sudo systemctl status nginx chisel authelia portlama-panel
```

3. **Tunnels connected** — if you have active tunnel clients, check the Chisel logs:

```bash
journalctl -u chisel --since "5 minutes ago"
```

4. **Authentication works** — visit a tunneled app and verify TOTP login

5. **Certificates valid** — check the Certificates page for any expiring certs

6. **nginx config valid** — always run after any upgrade:

```bash
sudo nginx -t
```

## For Developers

### Installer Idempotency

The installer achieves safe re-runs through skip guards:

- **mTLS certificates**: skipped if `ca.key` and `client.p12` already exist
- **Swap file**: skipped if swap is already active
- **UFW firewall**: skipped if already active with the required ports
- **fail2ban**: skipped if the config file exists and the service is running
- **SSH hardening**: skipped if settings are already correct
- **Panel config**: existing `panel.json` is merged (preserves `domain`, `email`, `onboarding.status`)

The panel server and client are always redeployed (files overwritten), and the systemd service is restarted.

### Version Pinning

Chisel and Authelia are downloaded from GitHub releases using the `latest` tag. For reproducible deployments, you could pin to specific versions by modifying the download URLs in:

- `packages/panel-server/src/lib/chisel.js` — `GITHUB_API` constant
- `packages/panel-server/src/lib/authelia.js` — `GITHUB_API` constant

### Automated Updates

Currently, Portlama does not include automated update mechanisms. For production deployments, consider:

- **Unattended upgrades** for Ubuntu security patches:

```bash
sudo apt-get install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

- **Certbot auto-renewal** is already configured via `certbot.timer` during onboarding provisioning

## Quick Reference

| Component | Location | Update Method |
|-----------|----------|---------------|
| Panel server | `/opt/portlama/panel-server/` | Re-run `npx @lamalibre/create-portlama@latest` |
| Panel client | `/opt/portlama/panel-client/` | Re-run `npx @lamalibre/create-portlama@latest` |
| Chisel | `/usr/local/bin/chisel` | Download binary from GitHub, replace, restart |
| Authelia | `/usr/local/bin/authelia` | Download binary from GitHub, replace, restart |
| nginx | System package | `sudo apt-get update && sudo apt-get upgrade` |
| certbot | System package | `sudo apt-get update && sudo apt-get upgrade` |
| Node.js | System package | Managed by installer (NodeSource repo) |
| Ubuntu | System packages | `sudo apt-get update && sudo apt-get upgrade` |

| Post-Upgrade Check | Command |
|--------------------|---------|
| All services running | `sudo systemctl status nginx chisel authelia portlama-panel` |
| nginx config valid | `sudo nginx -t` |
| Panel health | `curl -s http://127.0.0.1:3100/api/health` |
| Certificate renewal | `sudo certbot renew --dry-run` |
| Chisel version | `/usr/local/bin/chisel --version` |
| Authelia version | `/usr/local/bin/authelia --version` |
