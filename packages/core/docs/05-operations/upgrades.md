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

### Upgrade Order: Server First

Upgrade the **server before the agents**. Since 4.3 an agent's daemon (`lamaste-agentd`) accepts a request from the relay only with a signed relay assertion, which a 4.3 server sends and an older one does not: a 4.3 agent behind an older server refuses its agent-panel and plugin-tunnel requests (401) until the server is upgraded. An older agent keeps working behind a 4.3 server, which still sends the headers older daemons read.

Coming from 3.x, upgrade the **agents first**, as 4.0 required: agents from before 4.0 reject the 4.0 server's Chisel arguments and lose their tunnels, while a 4.3 agent behind a 3.x server keeps its tunnels and only its agent panel answers 401 until the server is upgraded.

On each agent machine, after the server:

```bash
sudo npm install -g --@lamalibre:registry=https://feria.codelama.com.tr/ @lamalibre/lamaste-agent
lamaste-agent update
```

Lamaste's packages are published to the hosted Feria, `https://feria.codelama.com.tr/`, not to npmjs (see [Where Lamaste's packages come from](#where-lamastes-packages-come-from)); the `--@lamalibre:registry=` option sends only the `@lamalibre` scope there.

`update` applies the panel's configuration, restarts the tunnel client, and installs the sync timer (which applies later tunnel changes within 30 seconds). An agent originally set up with `npx` must be installed globally first — the sync timer runs the installed program. On Linux it also rewrites the agent panel's user unit so the panel starts at boot. An agent from before 4.0 rotates its Chisel credential once on its first sync, because older versions exposed it in process arguments and 0644 unit files. The Desktop App updates the agents it manages.

A machine that hosts app plugins' agent halves needs the root-owned install shown above and its app host helper enabled once with `sudo lamaste-agent apphost enable` (see [App host](../04-api-reference/app-host.md)); after replacing the server's relay signing key, run `sudo lamaste-agent apphost pin` there. An upgrade of `lamaste-agent` does not replace that helper: when a release raises the app host protocol (4.4 speaks 2), run `sudo lamaste-agent apphost enable` again there — until then the agent refuses to install agent halves and the server does not offer it for hosting (`lamaste-agent apphost status` shows the helper as out of date).

### Where Lamaste's packages come from

Since 4.14 Lamaste's `@lamalibre/*` packages are published to the hosted Feria, **`https://feria.codelama.com.tr/`**, which serves them to anyone without a login. npmjs is no longer a source: its copies stop at 4.13 at most and are not updated. The source code and every release's packed tarballs are on [GitHub Releases](https://github.com/lamalibre/lamaste/releases) — the copy the registry is published from.

Every command that installs Lamaste names the registry for the `@lamalibre` scope only:

```bash
sudo npx --yes --@lamalibre:registry=https://feria.codelama.com.tr/ @lamalibre/create-lamaste
sudo npm install -g --@lamalibre:registry=https://feria.codelama.com.tr/ @lamalibre/lamaste-agent
```

Other dependencies still come from the machine's default registry. To avoid typing the option, set it once in npm's configuration — Lamaste follows it too:

```bash
npm config set @lamalibre:registry https://feria.codelama.com.tr/
```

**What Lamaste itself does (4.14 and later).** Every path that installs or checks Lamaste's own packages — the installer's `npm install`s, the panel's **Update** action (`lamaste-priv self-update`), plugin installs and update checks without a [registry credential](../04-api-reference/registry-and-oidc.md), the Desktop App's installs and update check, and the cloud provisioner and updater — takes `@lamalibre` from:

1. the registry npm's configuration names for `@lamalibre` (`@lamalibre:registry` in any npmrc, as root for the installer and **Update**; a development Feria, such as the one `feria-server setup` configures) — **refused** when it names a public registry (`registry.npmjs.org` and its mirrors), with a message saying to remove the line;
2. otherwise the hosted Feria.

With a registry credential the panel and agents keep installing plugins through the credential's registry, as before. The installer (`create-lamaste`) deploys the panel server it carries in its own package — a redeploy to `<version>` installs exactly `<version>`, no longer whatever a registry calls `latest`.

### Upgrading to 4.14

4.14 changes where Lamaste's packages come from (see [above](#where-lamastes-packages-come-from)); nothing else needs migrating. **A relay running 4.13 or older cannot reach 4.14 through its own Update action**: its update code asks npm's default registry, npmjs, which does not carry 4.14 — the panel either finds no newer version or fails with `E404`. It needs one step that names Feria, done once; every later update then works as before.

The Desktop App's **Update** button asks the relay's own Update action, so it hits the same wall until the step below is done.

**On the relay's console (any relay).** As root (SSH, or your provider's console), run the redeploy from Feria:

```bash
sudo npx --yes --@lamalibre:registry=https://feria.codelama.com.tr/ @lamalibre/create-lamaste@4.14.0 --yes
```

This is the same redeploy the Update action runs. Alternatively, let the old panel's own **Update** find Feria by naming it in root's npm configuration first, then use the **Update** action:

```bash
sudo npm config set @lamalibre:registry https://feria.codelama.com.tr/ --location=user
sudo cat /root/.npmrc   # @lamalibre:registry=https://feria.codelama.com.tr/
```

(The 4.13 helper runs `npx` with `HOME=/root`, so it reads `/root/.npmrc`; 4.14 keeps following that line.) A relay whose root `npmrc` routes `@lamalibre` to npmjs (`@lamalibre:registry=https://registry.npmjs.org/`) refuses to update until the line is removed or changed — the error names it.

**DigitalOcean servers, without a console.** A server provisioned through the Desktop App can be redeployed over SSH by the 4.14 cloud CLI, which fetches the installer from Feria whatever the relay runs (it adds a temporary SSH key through the DigitalOcean API and removes it afterwards):

```bash
LAMALIBRE_CLOUD_TOKEN=<token> npx --yes --@lamalibre:registry=https://feria.codelama.com.tr/ \
  @lamalibre/lamaste-cloud@4.14.0 update --id <serverId> --version 4.14.0
```

(`<serverId>` is the server's `id` in `~/.lamalibre/lamaste/servers.json`.)

**Agents.** Install the 4.14 agent from Feria and update as usual — the agent's own plugin installs follow the same rule from then on:

```bash
sudo npm install -g --@lamalibre:registry=https://feria.codelama.com.tr/ @lamalibre/lamaste-agent@4.14.0
lamaste-agent update
```

**Desktop App.** Install 4.14 as usual ([Desktop App Setup](../02-guides/desktop-app-setup.md)); its daemon installs, plugin host install, `lamaste-agent` install and panel update check use Feria from then on.

**Development.** A development Feria keeps working without changes: `feria-server setup` writes `@lamalibre:registry=http://localhost:4873` to `~/.npmrc`, and Lamaste follows npm's configuration. The Desktop App no longer hardcodes `http://127.0.0.1:4873` for its installs: it follows that line as well (its own Feria pill starts Feria with `--no-npmrc`, so run `feria-server setup` once).

### Upgrading to 4.6

4.6 adds plugins' web surfaces ([Web surface](../04-api-reference/agent-hosted-plugins.md#web-surface)). **Only the relay is upgraded**: the panel's **Update** action, or a `create-lamaste@4.6.0 --yes` redeploy.

- **`state.db` migration `0015`** adds `plugins.user_surface` and `plugins.web_tree_sha256`. Existing plugins declare no web surface: their approval digests are unchanged.
- **`lamaste-priv` must be the 4.6 one** before the panel writes a web surface's vhost: it now accepts a server-level `auth_request`, named locations and a named location as `try_files`' last argument. The Update action and the redeploy install it; a relay whose `lamaste-priv` is older refuses the vhost (`nginx site write failed … directive "auth_request" is not allowed in server`) and keeps the vhost it had.
- **Web trees live under `/var/www/lamaste/apps/`.** They are copies of approved package contents, made again at the panel's start when missing: nothing there needs a backup.
- **What changes for existing setups.** Gatekeeper reads `sites.json` as well as `tunnels.json`. The check that a tunnel and a site never share a hostname now runs under the tunnel lock, for enabling a tunnel too. The sites API serves `sites.json` under a lock, and an upload's size is recorded from the file as it is then.

### Upgrading to 4.5

4.5 adds the user directory and users of agent-hosted plugins ([Users and identity](../04-api-reference/agent-hosted-plugins.md#users-and-identity)). **Only the relay is upgraded**: the panel's **Update** action, or a `create-lamaste@4.5.0 --yes` redeploy.

- **`state.db` migration `0013`.** On its first start the panel creates the user directory (a `directoryId`, a `userId` per user, tombstones), the plugin audiences, the per-plugin feed state and the erasure records, and adds `plugins.identity`. It then reads `users.yml` — without writing it — and gives every existing user a `userId`. Back up `state.db` before upgrading, as before any upgrade: from now on it holds the mapping from usernames to user ids ([Backup and Restore](backup-and-restore.md#backup-considerations)).
- **The redeploy now touches the IP panel vhost.** Until 4.4 a redeploy left every panel vhost alone. From 4.5 it refreshes `lamalibre-lamaste-panel-ip` — the vhost the installer writes and the panel cannot — when its text differs from the current generator's: written, checked with `nginx -t`, put back on failure, and nginx reloaded; its `sites-enabled` link (which panel 2FA owns) is left as it is. A failure is reported and skipped (`Refreshing the IP panel vhost — Skipped`): the panel keeps working on the vhost it had, which still passes a client's `X-Lamalibre-Relay-Assertion` through to the panel (which accepts only a valid, single-use one Gatekeeper signed) — fix what `nginx -t` names and redeploy. The panel itself rewrites the domain panel, auth portal and tunnel vhosts at start, as since 4.3; each now clears a client's `X-Lamalibre-Relay-Assertion`.
- **No agent upgrade is needed**, and no agent half must be rebuilt. An agent half built on `@lamalibre/lamaste` 4.4 keeps working and **never receives a user caller**: the panel sends one only after the half has answered the identity feed with protocol 1 for its installed version. A plugin gets users by shipping a version that declares `identity` with a half built on 4.5 — an update that waits for approval — then binding its user surface to a tunnel.
- **What changes for existing setups.** The admin forwarder no longer reaches an agent half's `/admin/app` or anything under it (on the panel `/api/<route>/app*` is the user surface). The hook preview's `inactiveRoutes` is now `userSurfaceRoutes`. Every write of `users.yml` the panel makes — creating, updating, deleting users, accepting invitations — now runs under one lock, one after the other. Deleting a user keeps a tombstone in the directory and clears the username's grants and group memberships in Gatekeeper. A registry credential must carry the `read` scope as well as `admin` (a `PUT /api/registry-credential` with an admin-only identity is refused).

### Updating Lamaste (Panel Server and Client)

The Lamaste installer is idempotent — you can re-run it on an existing installation to update the panel server and client without losing your configuration.

**Step 1: SSH into your droplet**

```bash
ssh root@203.0.113.42
```

**Step 2: Re-run the installer**

```bash
npx --yes --@lamalibre:registry=https://feria.codelama.com.tr/ @lamalibre/create-lamaste@latest --yes
```

The `@latest` tag ensures you get the newest published version, from the hosted Feria (see [Where Lamaste's packages come from](#where-lamastes-packages-come-from)). The `--yes` flag skips the confirmation prompt. The installer deploys the panel server it carries, so `create-lamaste@<version>` installs exactly that version.

**What happens during re-install:**

- The installer detects the existing installation
- It preserves your `/etc/lamalibre/lamaste/panel.json` configuration (domain, email, onboarding status)
- It preserves your mTLS certificates (the PKI directory is not regenerated if it already exists)
- It stops the panel and the gatekeeper, and makes `/opt/lamalibre/lamaste/` root-owned: a tree left `lamaste`-owned by an earlier version is moved aside, every component (panel server, `lamaste-server` CLI, UI, docs, gatekeeper, certificate help page) is deployed fresh into a root-owned directory, and the old tree is removed at the end
- It rewrites `panel.json` (merged, as a fresh file renamed into place — root never writes through a path the `lamaste` user controls)
- It installs the pinned Chisel and Authelia releases if they are not already installed (a newer Authelia is kept), writes their systemd units, creates the `lamaste-chisel` group and the `lamaste-authelia` account, and sets the ownership described in [Configuration Files](../06-reference/config-files.md#file-permissions-table): `/var/www/lamaste` becomes `lamaste:www-data`, `/etc/authelia` `lamaste:lamaste-authelia`, the Chisel key `lamaste:lamaste-chisel 0640`, and the PKI directory `lamaste`'s. A running Authelia is stopped while its files change hands and started again afterwards
- It generates the OpenID Connect issuer key `/etc/authelia/oidc-issuer.pem` (0600, `lamaste-authelia`) if it is missing, and the Authelia unit it writes enables the `template` configuration filter. A 4.0 server updating to 4.1 therefore has the key before the new panel starts; plugin OIDC clients and the `--oidc` registry credential need it
- It upgrades Node.js from NodeSource when the installed version is older than 22.13 — the plugin hook runner's sandbox uses Node's stable permission model — and writes the hook runner's units (`lamalibre-lamaste-hooks@.socket`, `lamalibre-lamaste-hooks@.service`; see [Lifecycle hooks](../04-api-reference/lifecycle-hooks.md))
- It rewrites the panel's systemd unit and the sudoers rules (checked with `visudo -c` before they replace the old file), installs the root-owned programs in `/usr/local/sbin/` (`lamaste-priv`, `lamaste-certbot`, `lamaste-cert-info`) and removes the retired `lamaste-sign-csr` and `lamaste-pki-rename`, and installs the port-80 redirect site, and refreshes the IP panel vhost when its text differs (from 4.5; `nginx -t`, put back on failure)
- It restarts Chisel if its binary or unit changed, starts the gatekeeper if it was running, and restarts `lamalibre-lamaste-serverd`, whose startup reconciliation rewrites Chisel's authfile. The first start of a 4.3 panel also creates the relay signing key (`/etc/lamalibre/lamaste/relay-signing-key.json`, 0600) and rewrites existing tunnel, static site and auth portal vhosts; check its log for `Left tunnel vhosts as they are`, `Left site vhosts as they are` and `Failed to rewrite … vhost` (see the [4.3.0 upgrade notes](https://github.com/lamalibre/lamaste/blob/main/CHANGELOG.md))

The panel's **Update** action (`POST /api/system/update`) runs the same redeploy: it asks `sudo lamaste-priv self-update <version>` to start `create-lamaste@<version> --yes` in a transient systemd unit, fetched from the registry root's npm configuration names for `@lamalibre`, else the hosted Feria (see [System API](../04-api-reference/system.md)).

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

| Component    | Location                                                                                            | Update Method                                         |
| ------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Panel server | `/opt/lamalibre/lamaste/lamaste-serverd/`                                                           | Re-run `create-lamaste` (see above)                   |
| Panel client | `/opt/lamalibre/lamaste/lamaste-server-ui/`                                                         | Re-run `create-lamaste` (see above)                   |
| Chisel       | `/usr/local/bin/chisel`                                                                             | Pinned; installed by `create-lamaste`                 |
| Agents       | `sudo npm install -g --@lamalibre:registry=https://feria.codelama.com.tr/ @lamalibre/lamaste-agent` | Upgrade after the server, then `lamaste-agent update` |
| Authelia     | `/usr/local/bin/authelia`                                                                           | Pinned; installed by `create-lamaste` (newer is kept) |
| nginx        | System package                                                                                      | `sudo apt-get update && sudo apt-get upgrade`         |
| certbot      | System package                                                                                      | `sudo apt-get update && sudo apt-get upgrade`         |
| Node.js      | System package                                                                                      | Managed by installer (NodeSource repo)                |
| Ubuntu       | System packages                                                                                     | `sudo apt-get update && sudo apt-get upgrade`         |

| Post-Upgrade Check   | Command                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| All services running | `sudo systemctl status nginx chisel authelia lamalibre-lamaste-serverd` |
| nginx config valid   | `sudo nginx -t`                                                         |
| Panel health         | `curl -s http://127.0.0.1:3100/api/health`                              |
| Certificate renewal  | `sudo certbot renew --dry-run`                                          |
| Chisel version       | `/usr/local/bin/chisel --version`                                       |
| Authelia version     | `/usr/local/bin/authelia --version`                                     |
