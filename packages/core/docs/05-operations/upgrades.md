# Upgrades

> Keep Lamaste and its dependencies up to date with safe, tested upgrade procedures.

## In Plain English

Software needs updates — for security patches, bug fixes, and new features. Lamaste is made up of several independent pieces (the panel, the tunnel server, the authentication server, and the operating system), and each one updates differently.

The good news: most updates are straightforward. The installer is designed to be re-run safely on an existing installation, and the individual binaries can be replaced without affecting other components.

## For Users

### Before Any Upgrade

Always follow these steps before upgrading any component:

1. **Back up your configuration** (see [Backup and Restore](backup-and-restore.md))
2. **Note what is currently working** — check the dashboard, verify services are active
3. **Plan for a brief outage** — most upgrades require a service restart (seconds, not minutes)

### Upgrade Order: Agents First

When a release changes both sides, upgrade every **agent before the server**. Agents from before this version reject the new shape of the relay's Chisel arguments; a current agent works against an older server and keeps its Chisel credential until the server offers rotation.

On each agent machine:

```bash
npm install -g @lamalibre/lamaste-agent
lamaste-agent update
```

`update` applies the panel's configuration, restarts the tunnel client, and installs the sync timer (which applies later tunnel changes within 30 seconds). An agent originally set up with `npx` must be installed globally first — the sync timer runs the installed program. On its first sync after the upgrade an agent from before this version rotates its Chisel credential once, because older versions exposed it in process arguments and 0644 unit files. The Desktop App updates the agents it manages.

### Updating Lamaste (Panel Server and Client)

The Lamaste installer is idempotent — you can re-run it on an existing installation to update the panel server and client without losing your configuration.

**Step 1: SSH into your droplet**

```bash
ssh root@203.0.113.42
```

**Step 2: Re-run the installer**

```bash
npx @lamalibre/create-lamaste@latest --yes
```

The `@latest` tag ensures you get the newest published version. The `--yes` flag skips the confirmation prompt.

**What happens during re-install:**

- The installer detects the existing installation
- It preserves your `/etc/lamalibre/lamaste/panel.json` configuration (domain, email, onboarding status)
- It preserves your mTLS certificates (the PKI directory is not regenerated if it already exists)
- It stops the panel and the gatekeeper, and makes `/opt/lamalibre/lamaste/` root-owned: a tree left `lamaste`-owned by an earlier version is moved aside, every component (panel server, `lamaste-server` CLI, UI, docs, gatekeeper, certificate help page) is deployed fresh into a root-owned directory, and the old tree is removed at the end
- It rewrites `panel.json` (merged, as a fresh file renamed into place — root never writes through a path the `lamaste` user controls)
- It installs the pinned Chisel and Authelia releases if they are not already installed (a newer Authelia is kept), writes their systemd units, creates the `lamaste-chisel` group and the `lamaste-authelia` account, and sets the ownership described in [Configuration Files](../06-reference/config-files.md#file-permissions-table): `/var/www/lamaste` becomes `lamaste:www-data`, `/etc/authelia` `lamaste:lamaste-authelia`, the Chisel key `lamaste:lamaste-chisel 0640`, and the PKI directory `lamaste`'s. A running Authelia is stopped while its files change hands and started again afterwards
- It rewrites the panel's systemd unit and the sudoers rules (checked with `visudo -c` before they replace the old file), installs the root-owned programs in `/usr/local/sbin/` (`lamaste-priv`, `lamaste-certbot`, `lamaste-cert-info`) and removes the retired `lamaste-sign-csr` and `lamaste-pki-rename`, and installs the port-80 redirect site
- It restarts Chisel if its binary or unit changed, starts the gatekeeper if it was running, and restarts `lamalibre-lamaste-serverd`, whose startup reconciliation rewrites Chisel's authfile

The panel's **Update** action (`POST /api/system/update`) runs the same redeploy: it asks `sudo lamaste-priv self-update <version>` to start `create-lamaste@<version> --yes` in a transient systemd unit (see [System API](../04-api-reference/system.md)).

**Step 3: Verify the update**

```bash
systemctl status lamalibre-lamaste-serverd
```

Expected output includes `active (running)`. Then open your browser and check the dashboard.

**Step 4: Disconnect SSH**

```bash
exit
```

### Updating Chisel

Chisel is the tunnel server binary at `/usr/local/bin/chisel`. Lamaste pins it: server and agents run Chisel 1.12.0 (`CHISEL_RELEASE` in `@lamalibre/lamaste`), downloaded from the fixed release URL and verified against a pinned SHA-256 before it is unpacked. **Do not replace the binary by hand.** On the server, `create-lamaste` installs it (as root) and replaces a binary that reports any other version; the panel cannot install binaries, and only logs an error at startup when the installed Chisel is not the pinned release (it then restarts Chisel on every authfile change). Each agent's sync replaces its own copy.

A new Chisel version therefore arrives with a Lamaste release that changes the pin: re-run the installer, which installs it and restarts Chisel. To check what is running:

```bash
/usr/local/bin/chisel --version
sudo systemctl status chisel
sudo journalctl -u lamalibre-lamaste-serverd --since "10 minutes ago" | grep -i chisel
```

Tunnel clients reconnect on their own after the brief interruption (they retry at most every 30 seconds).

### Updating Authelia

Authelia is the authentication server binary at `/usr/local/bin/authelia`. Lamaste pins it too: Authelia 4.39.28 (`AUTHELIA_RELEASE` in `@lamalibre/lamaste`), downloaded by `create-lamaste` from its fixed release URL and verified against a pinned SHA-256 per architecture. A new Authelia version arrives with a Lamaste release that changes the pin — re-run the installer. It stops Authelia while it replaces the binary and starts it again.

An installed Authelia **newer** than the pin is kept, never downgraded: its database may already use a schema the pinned release cannot read, and Authelia refuses to start on a database newer than itself. If you install a newer release by hand, stop the service, replace the binary as root with a `root:root 0755` file, and start it again; check the [Authelia changelog](https://github.com/authelia/authelia/blob/master/CHANGELOG.md) first, since the configuration format may change between versions.

```bash
/usr/local/bin/authelia --version
sudo systemctl status authelia
```

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

If nginx or other Lamaste-related packages were updated, restart them:

```bash
sudo systemctl restart nginx
sudo systemctl restart lamalibre-lamaste-serverd
```

**Step 5: Kernel updates**

If a new kernel was installed, you will need to reboot:

```bash
sudo reboot
```

After reboot, all Lamaste services start automatically (they are enabled via systemd). Verify via the dashboard or:

```bash
sudo systemctl status nginx chisel authelia lamalibre-lamaste-serverd
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
sudo systemctl status nginx chisel authelia lamalibre-lamaste-serverd
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

The panel server, CLI, client, docs and gatekeeper are always redeployed (files overwritten), and the systemd service is restarted. The pinned binaries, their units, the service accounts and the directory ownership are re-checked on every run and only changed when they differ.

### Version Pinning

Chisel and Authelia are pinned by version and SHA-256 in `packages/core/lib/src/constants.ts` (`CHISEL_RELEASE`, `AUTHELIA_RELEASE`); changing a pin means updating the version and every digest there. The downloads are verified by `downloadVerifiedChisel` / `downloadVerifiedAuthelia` (exported from `@lamalibre/lamaste`) before anything is unpacked; the server installer uses them in `packages/provisioners/server/src/lib/binaries.js`. The configuration the panel writes needs Authelia 4.38 or later.

### Automated Updates

Currently, Lamaste does not include automated update mechanisms. For production deployments, consider:

- **Unattended upgrades** for Ubuntu security patches:

```bash
sudo apt-get install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

- **Certbot auto-renewal** is already configured via `certbot.timer` during onboarding provisioning

## Quick Reference

| Component    | Location                                    | Update Method                                          |
| ------------ | ------------------------------------------- | ------------------------------------------------------ |
| Panel server | `/opt/lamalibre/lamaste/lamaste-serverd/`   | Re-run `npx @lamalibre/create-lamaste@latest`          |
| Panel client | `/opt/lamalibre/lamaste/lamaste-server-ui/` | Re-run `npx @lamalibre/create-lamaste@latest`          |
| Chisel       | `/usr/local/bin/chisel`                     | Pinned; installed by `create-lamaste`                  |
| Agents       | `npm install -g @lamalibre/lamaste-agent`   | Upgrade before the server, then `lamaste-agent update` |
| Authelia     | `/usr/local/bin/authelia`                   | Pinned; installed by `create-lamaste` (newer is kept)  |
| nginx        | System package                              | `sudo apt-get update && sudo apt-get upgrade`          |
| certbot      | System package                              | `sudo apt-get update && sudo apt-get upgrade`          |
| Node.js      | System package                              | Managed by installer (NodeSource repo)                 |
| Ubuntu       | System packages                             | `sudo apt-get update && sudo apt-get upgrade`          |

| Post-Upgrade Check   | Command                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| All services running | `sudo systemctl status nginx chisel authelia lamalibre-lamaste-serverd` |
| nginx config valid   | `sudo nginx -t`                                                         |
| Panel health         | `curl -s http://127.0.0.1:3100/api/health`                              |
| Certificate renewal  | `sudo certbot renew --dry-run`                                          |
| Chisel version       | `/usr/local/bin/chisel --version`                                       |
| Authelia version     | `/usr/local/bin/authelia --version`                                     |
