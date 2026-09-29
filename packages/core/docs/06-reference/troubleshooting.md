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

certbot's nginx plugin answers the HTTP-01 challenge on port 80, for the first issuance and for every renewal. The installer opens port 80 in UFW and installs a catch-all site (`lamalibre-lamaste-http-redirect`) that redirects plain HTTP to HTTPS; certbot answers its challenges ahead of that redirect, so the redirect is not the problem.

**Fix:** Keep port 80 open — closing it makes every renewal fail.

```bash
sudo ufw status | grep 80
sudo ufw allow 80/tcp        # if missing
```

Also check any provider-level firewall (e.g. a DigitalOcean cloud firewall) in front of the droplet.

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

**Symptom:** You set up an agent (`lamaste-agent setup` or the Desktop App) on your Mac or Linux machine, but the tunnel does not establish. The tunneled app is not accessible through the domain. Start with `lamaste-agent status` and `lamaste-agent logs` on the agent.

**Cause 1: Chisel server is not running.**

The panel reconciles Chisel on every start and **stops and disables** it when it cannot establish a correct authfile (fail closed); `/etc/lamalibre/lamaste/chisel-failed-closed` exists while that is the case. It then retries on its own, from every 30 seconds up to every 10 minutes, and re-enables and starts Chisel once it succeeds. The panel log says why. Do not just `systemctl enable --now chisel` — fix the cause and let the panel bring it back.

**Fix:**

```bash
sudo systemctl status chisel
sudo journalctl -u lamalibre-lamaste-serverd -n 50 --no-pager | grep -i chisel
# A message "Chisel stopped: its authfile could not be brought in line ..."
# names the failure — commonly a missing lamaste-chisel group or a wrongly owned
# config directory (re-run the installer in redeploy mode) or a full disk.
# Once fixed, restart the panel:
sudo systemctl restart lamalibre-lamaste-serverd
```

**Cause 2: The agent has not picked up the change yet.**

The agent's sync timer applies tunnel changes within about 30 seconds. If that does not happen, the timer is not running or is failing — `lamaste-agent status` shows it on its **Sync** line (`not installed`, `installed but not running`, `last ran <time> — the timer is not running its program` when the last run is over 2 minutes old, or `failing since ...: <error>`), and `~/.lamalibre/lamaste/agents/<label>/logs/sync.log` has the details. The service is generated by `lamaste-agent` and connects to `https://tunnel.example.com:443`; do not edit the plist or systemd unit by hand.

**Fix:**

```bash
lamaste-agent update     # apply now and (re)install the sync timer
```

`update` needs the agent installed globally (`npm install -g @lamalibre/lamaste-agent`); an agent originally set up with `npx` must be installed first.

**Cause 3: The agent does not carry the tunnel.**

Every tunnel belongs to one agent, and the Chisel server lets each agent bind only the ports of the enabled tunnels it carries. The agent log shows `access denied` for the remote when the tunnel is disabled, deleted, carried by another agent, or `unassigned` (a tunnel from before tunnel ownership on a server with several agents, or a tunnel of an agent whose certificate was revoked). Because Chisel refuses the agent's whole session when one remote is not granted, **all** of that agent's tunnels are down until it stops asking for that port — the sync timer does this within about 30 seconds.

**Fix:** Check the tunnel's **Agent** column on the panel's Tunnels page; move it with **Edit** if needed (admin). The agent picks it up by itself; `lamaste-agent update` applies it at once.

**Cause 3a: The tunnel is withheld.**

A tunnel on a reserved port (3100, 9090, 9091, 9292, 9294), or two tunnels on the same port — only possible in state from before these checks — is granted to no agent and left out of `agent-config`. The panel logs `Tunnels on a reserved port or a port another tunnel also claims are carried by no agent` at startup. **Fix:** delete the tunnel and recreate it on a free port.

**Cause 3b: The agent carries no tunnels, or its tunnels were stopped.**

An agent with no tunnels keeps its Chisel client stopped (`status`: `no tunnels assigned`) and starts it once a tunnel is assigned. Tunnels stopped from the agent panel or desktop app stay stopped until started there again — the sync timer respects that.

**Cause 3c: The panel reports another domain.**

The agent only connects to `tunnel.<domain>` for the domain it enrolled with. If the panel's domain changed, sync fails with `The panel reports domain X, but this agent is enrolled with Y`. Re-enroll the agent.

**Cause 4: TLS verification fails.**

The agent verifies the certificate of `tunnel.example.com` like any HTTPS client (there is no `--tls-skip-verify`). The log shows an x509 / certificate error if that certificate is missing, expired, or for another name, or if the agent's clock is wrong. See Cause 9 below, and check the agent's clock.

**Cause 5: Authentication failed.**

The agent's Chisel credential was rotated or the agent was re-enrolled. The sync timer fetches a credential rotated by an administrator on its own (the panel's `chiselCredentialIssuedAt` changes); if the timer is not running, or to apply it at once:

**Fix:**

```bash
lamaste-agent chisel refresh-credential
```

**Cause 6 (Linux): The tunnel stops after reboot.**

The Chisel client and the sync timer are systemd user units and only run while the user has a session unless lingering is enabled. `lamaste-agent status` shows `At boot: only while this user is logged in`.

**Fix:**

```bash
sudo loginctl enable-linger "$USER"
```

**Cause 7: Firewall blocking the connection.**

On the client machine, ensure outgoing HTTPS (port 443) is not blocked by a corporate firewall or VPN.

**Cause 8: DNS not set up for the tunnel subdomain.**

The `tunnel.example.com` A record must point to the server.

**Fix:**

```bash
dig tunnel.example.com +short
```

**Cause 9: Let's Encrypt certificate not issued for the tunnel subdomain.**

If the tunnel vhost references a certificate that does not exist, nginx will fail to start or refuse connections on that vhost.

**Fix:**

```bash
sudo certbot certificates | grep tunnel
```

If no certificate is listed, re-run provisioning or issue it manually through the panel's wrapper (the same command the panel runs):

```bash
sudo /usr/local/sbin/lamaste-certbot issue your@email.com tunnel.example.com tunnel.example.com
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

| Cause                           | Log Message                             | Fix                                                                                                                            |
| ------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Missing `panel.json`            | `Config file not found`                 | Re-run installer or create the file manually                                                                                   |
| Invalid JSON in `panel.json`    | `contains invalid JSON`                 | Fix the JSON syntax                                                                                                            |
| Port 3100 in use                | `EADDRINUSE`                            | Find and stop the conflicting process: `sudo ss -tlnp sport = :3100`                                                           |
| Missing Node.js modules         | `Cannot find module`                    | Re-run the installer (`npx @lamalibre/create-lamaste --yes`); `/opt/lamalibre/lamaste` is root-owned and redeployed as a whole |
| Permission denied writing state | `EACCES` under `/etc/lamalibre/lamaste` | Re-run the installer; the redeploy re-applies the ownership of the config and PKI directories                                  |

### chisel fails to start

**Common causes:**

| Cause                      | Log Message                                                                           | Fix                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Binary missing             | `exec format error` or `not found`                                                    | Re-run the installer (`npx @lamalibre/create-lamaste --yes`) — it installs the pinned, checksum-verified release for the server's architecture; the panel cannot install binaries                                                 |
| Not the pinned release     | (panel log) `The installed chisel is not the pinned release — run create-lamaste ...` | Re-run the installer. Until then the panel restarts Chisel on every authfile change                                                                                                                                               |
| Authfile or key unreadable | `permission denied` on `chisel-users` or `chisel-server.key`                          | Both must be `0640 lamaste:lamaste-chisel` and the unit `Group=lamaste-chisel`; restart the panel, which re-applies the authfile's. If the group, the unit or the key's ownership is wrong, re-run the installer in redeploy mode |
| Stopped by the panel       | (panel log) `Chisel stopped: ...`; unit disabled, `chisel-failed-closed` present      | Reconciliation failed closed; see [Tunnel Client Cannot Connect](#tunnel-client-cannot-connect), Cause 1                                                                                                                          |
| Port 9090 in use           | `bind: address already in use`                                                        | `sudo ss -tlnp sport = :9090` to find conflicting process                                                                                                                                                                         |

### authelia fails to start

**Common causes:**

| Cause                       | Log Message                             | Fix                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invalid `configuration.yml` | `configuration: error`                  | Check YAML syntax with `authelia validate-configuration --config /etc/authelia/configuration.yml`                                                                                                                                                                                                                                                         |
| Missing `users.yml`         | `cannot open file`                      | Create an initial users file (see [Config Files](config-files.md))                                                                                                                                                                                                                                                                                        |
| Binary missing              | `not found`                             | Re-run the installer (`npx @lamalibre/create-lamaste --yes`); it installs the pinned release                                                                                                                                                                                                                                                              |
| Wrong permissions           | `permission denied`                     | Authelia runs as `lamaste-authelia`: `/etc/authelia` must be `lamaste:lamaste-authelia 2770`, `configuration.yml` `0640`, `users.yml` `0660`, `db.sqlite3` owned by `lamaste-authelia`. Re-run the installer to re-apply (a root-owned `/etc/authelia` from an older version is converted), or see [Config Files](config-files.md#file-permissions-table) |
| Database newer than binary  | storage schema version error at startup | A newer Authelia ran against this database and was replaced by an older one; the installer never downgrades an installed Authelia, so reinstall that newer release by hand                                                                                                                                                                                |

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

## Onboarding Fails: "Chisel is not installed" / "Authelia is not installed"

**Symptom:** The **Starting Chisel** or **Configuring Authelia** provisioning task fails with "Chisel is not installed. Run `npx @lamalibre/create-lamaste` on the server to repair the installation." (or the same for Authelia).

**Cause:** Onboarding downloads nothing: the installer installs both binaries (pinned releases), their systemd units and the `lamaste-authelia` account. The binary at `/usr/local/bin/chisel` or `/usr/local/bin/authelia` is missing — the installer was interrupted, or the file was removed.

**Fix:** Re-run the installer on the server, then start provisioning again from the wizard:

```bash
npx @lamalibre/create-lamaste --yes
```

If provisioning then fails writing Authelia's configuration with `/etc/authelia is not writable by the panel — run create-lamaste to repair the installation`, the directory's ownership is wrong; the same command repairs it.

---

## Tunnel, Site or Panel Change Fails: "nginx site write failed"

**Symptom:** Creating or changing a tunnel, static site or agent panel fails with an error like `nginx site write failed for lamalibre-lamaste-app-myapp: lamaste-priv: vhost line 12: directive "access_log" is not allowed in server` (or `arguments of "..." are not allowed`, `site name not allowed for write: ...`).

**Cause:** The panel installs vhosts only through the root helper `/usr/local/sbin/lamaste-priv`, which accepts only the panel's own site names and only directives on its allow-list (nginx's master process runs as root, so an unchecked vhost would be root access). The previous vhost is left in place. This happens when the panel generates something the installed helper does not know — typically a panel upgraded without re-running the installer, or a helper left over from an older version — or when a hand-edited generator adds a directive.

**Fix:**

1. Re-run the installer so the helper matches the panel: `npx @lamalibre/create-lamaste --yes`
2. If it persists on a current install, it is a bug: the vhost generators (`packages/server/daemon/src/lib/nginx.js`) and the allow-list (`packages/provisioners/server/scripts/lamaste-priv`) must change together — `npm test` checks every generated vhost against the allow-list. Do not work around it by editing files in `/etc/nginx` by hand.

`sudo: a password is required` for `lamaste-priv` means the helper or the sudoers file is missing or outdated: re-run the installer.

---

## Panel Update Fails to Start

**Symptom:** The panel's **Update** action (`POST /api/system/update`) returns `500` with `Could not start the update: ...`.

**Cause:** `sudo lamaste-priv self-update <version>` could not start the transient update unit — for example the helper is missing (an install from before `lamaste-priv`), or `systemd-run` failed.

**Fix:** Update from the console instead, which also installs the current helper: `npx @lamalibre/create-lamaste@<version> --yes`. The update unit's own output is in `journalctl -u 'lamalibre-lamaste-update-*'`.

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

**Cause 3: The web root is not writable by the panel (`EACCES`).**

The panel writes `/var/www/lamaste` itself: it must be `lamaste:www-data`, directories `2750`, files `0640`. An install from before this layout had it owned by `www-data`. Re-run the installer (`npx @lamalibre/create-lamaste --yes`); the redeploy converts the tree.

---

## Tunneled App Rejects Uploads (413)

**Symptom:** Uploads or large POST requests to a tunneled app fail with `413 Request Entity Too Large` from nginx.

**Cause:** The request is larger than the tunnel's body limit. Each tunnel's vhost sets `client_max_body_size` from its `maxBodySizeMb` (default 10 MiB). Tunnels created before the setting existed have no directive, so nginx's built-in 1 MiB applies.

**Fix:** On the panel's Tunnels page, click **Edit** on the tunnel and raise **Largest request body (MiB)** (up to 10240), or:

```bash
curl -s --cert client.p12:password \
  -X PATCH -H "Content-Type: application/json" \
  -d '{"maxBodySizeMb":500}' \
  https://203.0.113.42:9292/api/tunnels/<uuid> | jq
```

---

## Quick Reference: Diagnostic Commands

| What to Check        | Command                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| All service statuses | `sudo systemctl status nginx chisel authelia lamalibre-lamaste-serverd` |
| Panel health         | `curl -s http://127.0.0.1:3100/api/health`                              |
| nginx config test    | `sudo nginx -t`                                                         |
| Open ports           | `sudo ss -tlnp`                                                         |
| Memory usage         | `free -h`                                                               |
| Disk usage           | `df -h /`                                                               |
| DNS resolution       | `dig panel.example.com +short`                                          |
| Certificate status   | `sudo certbot certificates`                                             |
| Server time          | `timedatectl status`                                                    |
| Swap status          | `swapon --show`                                                         |
| fail2ban status      | `sudo fail2ban-client status`                                           |
| Recent panel logs    | `journalctl -u lamalibre-lamaste-serverd -n 30`                         |
| Recent nginx errors  | `tail -20 /var/log/nginx/error.log`                                     |
| Authelia logs        | `journalctl -u authelia -n 30`                                          |
| Chisel logs          | `journalctl -u chisel -n 30`                                            |
| Onboarding status    | `cat /etc/lamalibre/lamaste/panel.json \| grep status`                  |
| PKI password         | `sudo cat /etc/lamalibre/lamaste/pki/.p12-password`                     |
