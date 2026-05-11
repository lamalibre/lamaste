# Installer Flags

> CLI flags, environment variables, and exit codes for `npx @lamalibre/create-lamaste`.

## Usage

```bash
npx @lamalibre/create-lamaste [flags]
```

The installer runs as root on a fresh Ubuntu 24.04 server. It is completely non-interactive by default — all configuration happens later through the browser-based onboarding wizard.

## Flags

| Flag            | Short | Description                                     |
| --------------- | ----- | ----------------------------------------------- |
| `--help`        | `-h`  | Print help message and exit                     |
| `--yes`         | `-y`  | Skip the confirmation prompt                    |
| `--skip-harden` |       | Skip OS hardening (swap, UFW, fail2ban, SSH)    |
| `--dev`         |       | Allow private/non-routable IP addresses         |
| `--force-full`  |       | Run full installation even on existing installs |
| `--uninstall`   |       | Print manual removal guide and exit             |

### `--help`, `-h`

Prints a description of what the installer does, lists all flags, and exits with code 0. Does not modify anything on the system.

```bash
npx @lamalibre/create-lamaste --help
```

### `--yes`, `-y`

Skips the interactive confirmation prompt that appears before installation begins. Useful for automated deployments or scripts where you cannot press Enter.

```bash
npx @lamalibre/create-lamaste --yes
```

Without this flag, the installer displays a banner listing all changes it will make and waits for the user to press Enter or Ctrl+C.

### `--skip-harden`

Skips all OS hardening tasks:

- Swap file creation (1 GB)
- UFW firewall configuration (ports 22, 443, 9292)
- fail2ban installation and configuration
- SSH hardening (disabling password authentication)

Everything else (Node.js, nginx, mTLS, panel deployment) still runs.

```bash
npx @lamalibre/create-lamaste --skip-harden
```

Use this if you manage your own firewall rules, already have fail2ban configured, or are running on a platform that handles security at a different layer.

### `--dev`

Allows the installer to run on a machine with a private or non-routable IP address (e.g., `192.168.x.x`, `10.x.x.x`). By default, the installer requires a public IP.

```bash
npx @lamalibre/create-lamaste --dev
```

This is useful for:

- Testing the installer in a local VM
- Running on a server behind a NAT (where the public IP is not directly assigned to the interface)

When `--dev` is active, the installer prints the detected IP with a note: `(dev mode — private IP accepted)`.

### `--force-full`

Forces the installer to run the complete installation pipeline, ignoring skip guards that would normally detect an existing installation. This is useful when an installation is in an inconsistent state and you want to ensure all components are fully deployed.

```bash
npx @lamalibre/create-lamaste --force-full
```

Use this if:

- A previous installation was interrupted partway through
- Components were manually removed and need to be reinstalled
- You want to ensure every step runs regardless of existing state

### `--uninstall`

Prints a step-by-step guide for manually removing Lamaste from the server, then exits with code 0. Does not modify anything on the system.

```bash
npx @lamalibre/create-lamaste --uninstall
```

The printed guide covers:

1. Stop and disable services
2. Remove nginx configuration
3. Remove Lamaste directories (`/etc/lamalibre/lamaste/`, `/opt/lamalibre/lamaste/`, `/var/www/lamaste/`)
4. Remove the `lamaste` system user
5. Remove sudoers rules
6. Remove fail2ban configuration (optional)
7. Revert SSH hardening (optional)
8. Revert firewall changes (optional)
9. Remove swap file (optional)
10. Remove Let's Encrypt certificates (optional)

See also: [Uninstalling](../05-operations/uninstalling.md) for the full documentation.

## Environment Variables

| Variable          | Default                    | Description                                                                                                                                         |
| ----------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LAMALIBRE_LAMASTE_CONFIG` | `/etc/lamalibre/lamaste/panel.json` | Override the panel config file path (lamalibre-lamaste-serverd)                                                                                                  |
| `NODE_ENV`        | —                          | Set to `development` (or leave unset) to skip mTLS verification and use dev config path; set to `production` for production behavior (lamalibre-lamaste-serverd) |

These environment variables affect the **panel server** at runtime, not the installer itself. They are listed here because they are the only environment-level configuration Lamaste uses.

The installer sets these in the systemd service unit:

```ini
Environment=NODE_ENV=production
Environment=CONFIG_FILE=/etc/lamalibre/lamaste/panel.json
```

> **Note:** The systemd unit sets `CONFIG_FILE`, but the panel server code reads `LAMALIBRE_LAMASTE_CONFIG`. The `CONFIG_FILE` variable is not used by the application. In production this has no effect because the code falls back to `/etc/lamalibre/lamaste/panel.json` when `LAMALIBRE_LAMASTE_CONFIG` is unset and `NODE_ENV=production`.

## Exit Codes

| Code | Meaning                                                            |
| ---- | ------------------------------------------------------------------ |
| 0    | Success (installation complete, or `--help`/`--uninstall` printed) |
| 1    | Installation failed (error printed to stderr)                      |

When the installer fails, it prints a boxed error message with the failure reason and a note that you can safely re-run the installer to retry:

```
  ┌─────────────────────────────────────────────┐
  │  Lamaste installation failed.              │
  │  <error message>                            │
  │                                             │
  │  You can safely re-run this installer       │
  │  to retry.                                  │
  └─────────────────────────────────────────────┘
```

## Requirements

The installer checks these requirements at startup and fails with a descriptive error if any are not met:

| Requirement                | Check                          |
| -------------------------- | ------------------------------ |
| Root access                | `process.getuid() === 0`       |
| Ubuntu 24.04               | Reads `/etc/os-release`        |
| Public IP (unless `--dev`) | Detects via network interfaces |

## Installation Phases

The installer runs in two sequential phases:

**Phase 1: Environment checks**

1. Verify root access
2. Detect operating system (must be Ubuntu 24.04)
3. Detect IP address (must be public unless `--dev`)

**Phase 2: Installation tasks**

1. Harden operating system (skipped with `--skip-harden`)
   - Create 1 GB swap file
   - Configure UFW firewall (ports 22, 443, 9292)
   - Install and configure fail2ban
   - Harden SSH configuration
   - Install system dependencies (curl, openssl, nginx, certbot)
2. Install Node.js 20 LTS
3. Generate mTLS certificates (CA, client cert, PKCS12 bundle)
4. Configure nginx (self-signed TLS, mTLS snippet, panel vhost on port 9292)
5. Deploy Lamaste panel (system user, directories, server, client, config, systemd, sudoers)

## Idempotency

The installer is designed to be re-run safely. Skip guards prevent duplicate work:

| Component         | Skip Condition                                                               |
| ----------------- | ---------------------------------------------------------------------------- |
| Swap file         | Swap already active                                                          |
| UFW firewall      | Already active with required ports                                           |
| fail2ban          | Config exists and service is running                                         |
| SSH hardening     | Settings already correct                                                     |
| Node.js           | Already installed at expected version                                        |
| mTLS certificates | `ca.key` and `client.p12` already exist                                      |
| Panel config      | Existing `panel.json` is merged (preserves domain, email, onboarding status) |

Components that are always redeployed on re-run:

- Panel server files (`/opt/lamalibre/lamaste/lamaste-serverd/`)
- Panel client files (`/opt/lamalibre/lamaste/lamaste-server-ui/`)
- Systemd service unit
- Sudoers rules
- nginx vhost configuration

## Examples

**Fresh install on a new droplet:**

```bash
ssh root@203.0.113.42
npx @lamalibre/create-lamaste
```

**Automated install (no confirmation prompt):**

```bash
npx @lamalibre/create-lamaste --yes
```

**Install without OS hardening:**

```bash
npx @lamalibre/create-lamaste --yes --skip-harden
```

**Test in a local VM:**

```bash
npx @lamalibre/create-lamaste --dev
```

**Update an existing installation:**

```bash
npx @lamalibre/create-lamaste@latest --yes
```

**View the uninstall guide:**

```bash
npx @lamalibre/create-lamaste --uninstall
```

## Quick Reference

| Flag            | Effect                                 |
| --------------- | -------------------------------------- |
| `--help` / `-h` | Print help, exit 0                     |
| `--yes` / `-y`  | Skip confirmation                      |
| `--skip-harden` | No swap, UFW, fail2ban, SSH hardening  |
| `--dev`         | Allow private IPs                      |
| `--force-full`  | Full install even on existing installs |
| `--uninstall`   | Print removal guide, exit 0            |

| Requirement | Value                           |
| ----------- | ------------------------------- |
| OS          | Ubuntu 24.04                    |
| Access      | Root                            |
| IP          | Public (or `--dev` for private) |
| Exit 0      | Success                         |
| Exit 1      | Failure                         |
