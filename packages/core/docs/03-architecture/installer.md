# Installer Architecture

> The `create-lamaste` package is a zero-prompt CLI that provisions a fresh Ubuntu 24.04 droplet with everything needed to run the Lamaste admin panel — in a single command.

## In Plain English

When you run `npx @lamalibre/create-lamaste` on a fresh VPS, the installer takes over and does everything automatically: hardens the OS, installs dependencies, generates security certificates, configures nginx, deploys the panel, and starts the service. It prints a summary with instructions for downloading your client certificate and accessing the panel. No prompts, no questions, no configuration files to edit.

The installer is deliberately limited in scope. It sets up just enough to serve the panel UI over a secure connection. Everything else — domain configuration, tunnel setup, user management — happens through the browser-based onboarding wizard after the installer finishes.

## Overview

```
npx @lamalibre/create-lamaste
  │
  ├── bin/create-lamaste.js          ← CLI entry point
  │     └── calls main() from src/index.js
  │
  └── src/index.js                     ← Listr2 orchestrator
        │
        ├── Phase 1: Environment Checks
        │     ├── checkRoot()          ← Verify running as root
        │     ├── detectOS()           ← Verify Ubuntu 24.04
        │     └── detectIP()           ← Find public IP (DO metadata or hostname)
        │
        ├── detectExistingState()      ← Pre-flight detection
        │     ├── Existing Lamaste?   ← Check /etc/lamalibre/lamaste/panel.json
        │     ├── Existing nginx?      ← List non-lamaste sites-enabled
        │     ├── Port 3100 in use?    ← Check with ss
        │     └── UFW active?          ← Count existing rules
        │
        ├── confirmInstallation()      ← Show banner + warnings, wait for Enter
        │
        ├── Phase 2: Installation Tasks
        │     ├── hardenTasks()        ← Swap, UFW, fail2ban, SSH hardening
        │     ├── nodeTasks()          ← Node.js 20 LTS installation
        │     ├── mtlsTasks()          ← CA + client cert + PKCS12 generation
        │     ├── nginxTasks()         ← Self-signed TLS, mTLS snippet, vhost, nginx start
        │     └── panelTasks()         ← User, dirs, deploy, config, systemd, start
        │
        └── printSummary()             ← Formatted box with SCP command + password + URL
```

## Task Execution Order

The installer runs tasks in a strict sequential order. Each task group depends on the outputs of the previous one.

### Phase 1: Environment Checks

Three checks run as subtasks of a single Listr2 group:

1. **Verify root access** — `process.getuid() !== 0` → error
2. **Detect operating system** — parse `/etc/os-release`, require Ubuntu 24.04
3. **Detect IP address** — try DigitalOcean metadata API (`169.254.169.254`), fall back to `hostname -I`. The `--dev` flag accepts private IPs for local testing.

### Pre-flight Detection

Between Phase 1 and Phase 2, the installer runs `detectExistingState()` to gather warnings for the confirmation banner. All checks are wrapped in try/catch — detection failures never block the installer.

Detected conditions:

- Existing `/etc/lamalibre/lamaste/panel.json` → "Re-running will update the installation but preserve your configuration"
- Non-lamaste nginx sites in `sites-enabled` → "Existing nginx sites will be affected"
- Port 3100 in use (checked via `ss`) → "The panel may fail to start"
- Active UFW with existing rules → "Existing UFW firewall rules will be reset"

### Phase 2: Installation Tasks

Five task groups run sequentially through Listr2:

| Order | Task Group | Source            | Key Operations                                                                                   |
| ----- | ---------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| 1     | Hardening  | `tasks/harden.js` | Swap file, UFW firewall, fail2ban, SSH hardening, system packages                                |
| 2     | Node.js    | `tasks/node.js`   | Check existing, add NodeSource repo, install, verify                                             |
| 3     | mTLS       | `tasks/mtls.js`   | CA key + cert, client key + CSR, sign, PKCS12 bundle                                             |
| 4     | nginx      | `tasks/nginx.js`  | Self-signed TLS cert, mTLS snippet, IP vhost, cert help page, enable site, start                 |
| 5     | Panel      | `tasks/panel.js`  | System user, directories, deploy server + client, config, systemd, sudoers, start + health check |

## Task Implementation Details

### Hardening (`tasks/harden.js`)

**Swap file creation:**

- Checks if swap is already active via `swapon --show`
- Creates 1 GB swap at `/swapfile` with `fallocate`, `mkswap`, `swapon`
- Adds to `/etc/fstab` if not already present
- Sets `vm.swappiness=10` via sysctl (reduces swap aggressiveness)

**UFW firewall:**

- If UFW is already active, only adds missing port rules (22, 443, 9292)
- If inactive, sets defaults (deny incoming, allow outgoing), allows ports, enables
- Never resets an active firewall — preserves existing rules

**fail2ban:**

- Installs via `apt-get`, writes drop-in config at `/etc/fail2ban/jail.d/lamaste.conf`
- Configures SSH jail (5 attempts, 1 hour ban) and nginx-http-auth jail
- Skip guard: checks if config already exists with expected content and service is active

**SSH hardening:**

- Sets `PasswordAuthentication no`, `PermitRootLogin prohibit-password`, `ChallengeResponseAuthentication no`
- Uses write-validate-swap pattern: writes to temp file, validates with `sshd -t -f`, then moves into place
- Creates backup at `/etc/ssh/sshd_config.pre-lamaste` before first modification
- If validation fails, temp file is deleted and original config remains untouched

**System dependencies:**

- Runs `apt-get update` then installs `curl`, `openssl`, `nginx`, `certbot`, `python3-certbot-nginx`
- Stops nginx after installation (will be configured and started by the nginx task)
- Removes the default nginx site from `sites-enabled`

### mTLS Certificates (`tasks/mtls.js`)

**CA generation:**

- 4096-bit RSA key at `/etc/lamalibre/lamaste/pki/ca.key` (mode 600)
- Self-signed CA certificate at `/etc/lamalibre/lamaste/pki/ca.crt` (mode 644) with 10-year validity
- Subject: `CN=Lamaste CA, O=Lamaste`

**Client certificate:**

- 4096-bit RSA key at `/etc/lamalibre/lamaste/pki/client.key` (mode 600)
- CSR signed by CA with 2-year validity
- Subject: `CN=admin, O=Lamaste`
- CSR is deleted after signing (no longer needed)

**PKCS12 bundle:**

- Combines client key + cert + CA cert into `/etc/lamalibre/lamaste/pki/client.p12` (mode 600)
- Uses legacy algorithms (`PBE-SHA1-3DES`, `sha1` MAC) for maximum browser compatibility — modern PKCS12 defaults are not supported by macOS Keychain Access
- Password generated via `crypto.randomBytes(24).toString('base64url')`
- Password saved to `/etc/lamalibre/lamaste/pki/.p12-password` (mode 600)

### nginx Configuration (`tasks/nginx.js`)

**Self-signed TLS certificate:**

- 2048-bit RSA key for the IP-based vhost
- Includes `subjectAltName=IP:<detected-ip>` for browser compatibility
- 10-year validity — this cert is only for IP access, not public-facing

**mTLS snippet:**

- Written to `/etc/nginx/snippets/lamalibre-lamaste-mtls.conf`
- Contains two lines: `ssl_client_certificate` pointing to CA cert, and `ssl_verify_client on`
- Shared by the IP vhost and the domain panel vhost (after onboarding)

**IP-based panel vhost:**

- Listens on port 9292 with SSL
- Includes the mTLS snippet for client certificate enforcement
- Proxies all traffic to `127.0.0.1:3100` (Panel Server)
- WebSocket upgrade support for `/api` paths
- Custom error pages (495/496) serve a certificate help page for visitors without certs

**Certificate help page:**

- Static HTML at `/opt/lamalibre/lamaste/lamaste-server-ui/cert-help.html`
- Styled with the same dark terminal aesthetic as the panel
- Shows step-by-step instructions for downloading and importing the client certificate
- Served by nginx when SSL client verification fails (error codes 495, 496)

### Panel Deployment (`tasks/panel.js`)

**System user:**

- Creates `lamaste` user with `--system --no-create-home --shell /usr/sbin/nologin`
- Idempotent: checks if user exists first with `id lamaste`

**Directory structure:**

- `/opt/lamalibre/lamaste/lamaste-serverd/` — deployed server code
- `/opt/lamalibre/lamaste/lamaste-server-ui/` — built client SPA
- `/etc/lamalibre/lamaste/` — configuration files
- `/var/www/lamaste/` — static site roots

**Server deployment:**

- Copies `package.json` and `src/` from `vendor/lamaste-serverd/`
- Runs `npm install --production` in the deployment directory
- Sets ownership to `lamaste:lamaste`

**Client deployment:**

- Prefers pre-built `dist/` directory from vendor (avoids Vite build on low-RAM VPS)
- Falls back to building from source in `/tmp/` if no pre-built dist exists
- Only the `dist/` output is deployed to the lamaste-server-ui directory

**Configuration:**

- Writes `/etc/lamalibre/lamaste/panel.json` with detected IP, directory paths, and `onboarding.status: "FRESH"`
- On re-run: merges with existing config, preserving user/onboarding state
- File mode 0640, owned by `lamaste:lamaste`

**Systemd service:**

- Unit file at `/etc/systemd/system/lamalibre-lamaste-serverd.service`
- Runs as `lamaste` user with security hardening: `NoNewPrivileges=true`, `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`
- `ReadWritePaths=/etc/lamalibre/lamaste /var/www/lamaste` are allowed
- Restart on failure with 5-second delay

**Sudoers rules:**

- Written to `/etc/sudoers.d/lamaste` with granular permissions
- Scoped to specific `systemctl` commands for managed services (nginx, chisel, authelia, lamalibre-lamaste-serverd)
- Scoped `mv` rules restricted to specific source/destination paths (e.g., `/tmp/* → /etc/nginx/sites-available/*`)
- Scoped file operations for static sites under `/var/www/lamaste/`
- Validated with `visudo -c` — removed immediately if validation fails
- No blanket root access

**Health check:**

- After starting the service, waits 3 seconds, checks `systemctl is-active`
- Sends HTTP request to `http://127.0.0.1:3100/api/health`
- If either check fails, captures recent journal logs and reports them in the error message

## Idempotency

The installer is designed to be safely re-run on the same machine. Every task group implements skip guards that detect existing state:

| Task            | Skip Condition                                            | Behavior                                  |
| --------------- | --------------------------------------------------------- | ----------------------------------------- |
| Swap creation   | `swapon --show` returns data                              | Skip silently                             |
| UFW firewall    | All required ports already allowed and active             | Skip silently                             |
| fail2ban        | Config exists with expected content and service is active | Skip silently                             |
| SSH hardening   | All settings already correct in `sshd_config`             | Skip silently                             |
| Node.js install | `node --version` returns v20+                             | Skip NodeSource + apt-get                 |
| mTLS certs      | `ca.key` and `client.p12` both exist                      | Skip entire group, read existing password |
| Panel config    | `panel.json` exists                                       | Merge instead of overwrite                |
| System user     | `id lamaste` succeeds                                    | Skip `useradd`                            |

The mTLS certificate skip guard is especially important: regenerating certificates would invalidate the admin's already-imported client certificate, locking them out of the panel.

## Redeploy Mode

When the installer detects an existing Lamaste installation (`/etc/lamalibre/lamaste/panel.json` exists) and the `--force-full` flag is not set, it enters **redeploy mode** instead of running the full installation.

Redeploy mode only updates the lamalibre-lamaste-serverd and lamaste-server-ui files, runs `npm install`, merges configuration, updates the systemd service unit and sudoers rules, and restarts the service. It does not touch OS hardening, mTLS certificates, nginx configuration, or any other system-level settings.

This provides a fast upgrade path: re-running `npx @lamalibre/create-lamaste` on an existing installation updates only the panel code while preserving all configuration and certificates. Use `--force-full` to bypass this and run the complete installer.

The redeploy logic lives in `tasks/redeploy.js`, with shared systemd unit and sudoers content generators in `lib/service-config.js`.

## Vendor Bundling

The `create-lamaste` package ships with the lamalibre-lamaste-serverd and lamaste-server-ui code bundled in a `vendor/` directory. This is necessary because:

1. The installer runs on a fresh VPS with no access to the monorepo
2. `npm install` on the server only installs the `create-lamaste` package
3. The vendor directory contains the exact code that was built and tested

The vendor directory structure:

```
packages/create-lamaste/vendor/
├── lamaste-serverd/
│   ├── package.json
│   └── src/                    ← Server source code
└── lamaste-server-ui/
    └── dist/                   ← Pre-built Vite output (preferred)
        ├── index.html
        └── assets/
```

When `dist/` contains a pre-built `index.html`, the installer copies it directly. This avoids running `vite build` on the VPS, which can OOM-kill on a 512 MB droplet.

## Error Handling

The installer follows a fail-fast philosophy with safe re-run guarantees:

**At the orchestrator level:**

- `exitOnError: true` on both Listr2 task groups — any failure stops the entire pipeline
- The error handler prints a formatted box with the error message and a "You can safely re-run this installer to retry" note
- Exit code 1 on any failure

**At the task level:**

- Every `execa` call includes descriptive error messages that explain what failed and suggest recovery steps
- Network errors (apt-get, curl, npm) include "Check your internet connection" hints
- Validation errors (sshd, nginx, sudoers) clean up temp files before throwing

**At the subtask level:**

- `subtask.output` provides real-time progress for long-running operations (e.g., "Downloading NodeSource setup script...")
- `rendererOptions: { persistentOutput: true }` keeps the last status visible in the terminal

## CLI Flags

| Flag            | Purpose                                                                      |
| --------------- | ---------------------------------------------------------------------------- |
| `--help`, `-h`  | Print help message describing what the installer does and exit               |
| `--yes`, `-y`   | Skip the confirmation prompt (for automated installs)                        |
| `--skip-harden` | Skip OS hardening tasks (swap, UFW, fail2ban, SSH)                           |
| `--dev`         | Accept private/non-routable IP addresses (for VM testing)                    |
| `--force-full`  | Run the full installation even on existing installs (bypasses redeploy mode) |
| `--uninstall`   | Print manual removal guide and exit                                          |

## Shared Context Object

All tasks share a `ctx` object that accumulates state through the pipeline:

```javascript
const ctx = {
  ip: null, // Detected public IP
  osRelease: null, // { id, versionId, prettyName }
  skipHarden: false, // --skip-harden flag
  nodeAlreadyInstalled: false, // Skip Node.js install if v20+
  nodeVersion: null, // e.g., "v20.11.1"
  npmVersion: null, // e.g., "10.2.4"
  p12Password: null, // Generated PKCS12 password
  pkiDir: '/etc/lamalibre/lamaste/pki', // Certificate directory
  configDir: '/etc/lamalibre/lamaste', // Configuration directory
  installDir: '/opt/lamalibre/lamaste', // Deployment directory
};
```

## Key Files

| File                                                 | Role                                      |
| ---------------------------------------------------- | ----------------------------------------- |
| `packages/create-lamaste/bin/create-lamaste.js`    | CLI entry point (`#!/usr/bin/env node`)   |
| `packages/create-lamaste/src/index.js`              | Main orchestrator with Listr2 pipeline    |
| `packages/create-lamaste/src/tasks/harden.js`       | OS hardening subtasks                     |
| `packages/create-lamaste/src/tasks/node.js`         | Node.js 20 installation subtasks          |
| `packages/create-lamaste/src/tasks/mtls.js`         | mTLS certificate generation subtasks      |
| `packages/create-lamaste/src/tasks/nginx.js`        | nginx IP-based configuration subtasks     |
| `packages/create-lamaste/src/tasks/panel.js`        | Panel deployment subtasks                 |
| `packages/create-lamaste/src/tasks/redeploy.js`     | Panel-only redeployment subtasks          |
| `packages/create-lamaste/src/lib/env.js`            | OS detection, IP detection, root check    |
| `packages/create-lamaste/src/lib/secrets.js`        | `crypto.randomBytes` wrappers             |
| `packages/create-lamaste/src/lib/summary.js`        | Post-install summary box printer          |
| `packages/create-lamaste/src/lib/cert-help-page.js` | HTML help page generator                  |
| `packages/create-lamaste/src/lib/service-config.js` | Systemd unit + sudoers content generators |

## Confirmation Banner

Between environment checks and installation, the installer displays a confirmation banner. This is the only user interaction point (unless `--yes` is passed).

The banner:

- Shows a formatted box listing all system modifications that will be made
- Displays detection warnings below the box (existing Lamaste install, UFW rules, port conflicts, existing nginx sites)
- Waits for the user to press Enter or Ctrl+C

```
┌─────────────────────────────────────────────────────────────┐
│  Lamaste Installer                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  This will install Lamaste on this machine.                │
│                                                             │
│  The following changes will be made:                         │
│                                                             │
│    • Reset UFW firewall (allow ports 22, 443, 9292 only)    │
│    • Harden SSH (disable password authentication)           │
│    • Install fail2ban, Node.js 20, nginx, certbot           │
│    • Generate mTLS certificates for browser access          │
│    • Create lamaste user and systemd service               │
│    • Deploy panel to /opt/lamalibre/lamaste/                         │
│                                                             │
│  Designed for a fresh Ubuntu 24.04 droplet.                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘

  ! An existing Lamaste installation was detected (onboarding: COMPLETED).
    Re-running will update the installation but preserve your configuration.
  ! Existing UFW firewall rules (6 rules) will be reset.
```

Warning messages are only shown when relevant conditions are detected. On a fresh droplet with no existing state, no warnings appear.

## Post-Install Summary

After all tasks complete, `printSummary()` reads the saved PKCS12 password and displays a formatted box with everything the user needs:

1. **SCP command** to download the client certificate: `scp root@<ip>:/etc/lamalibre/lamaste/pki/client.p12 .`
2. **Import instructions** for macOS, Linux, and Windows browsers
3. **Certificate password** (highlighted in yellow for visibility)
4. **Panel URL**: `https://<ip>:9292`
5. **Reassurance** that they can disconnect from SSH

The summary box uses dynamic width calculation, stripping ANSI color codes to measure actual character widths, and builds a Unicode box-drawing border around the content.

## Listr2 Rendering

The installer uses Listr2's default renderer with `collapseSubtasks: false`, which means all subtask output remains visible as the installer progresses. Each subtask uses `rendererOptions: { persistentOutput: true }` to keep the final status line visible after the subtask completes.

The rendering structure looks like this during execution:

```
✔ Checking environment
  ✔ Verifying root access
  ✔ Detecting operating system [Ubuntu 24.04.1 LTS]
  ✔ Detecting IP address [203.0.113.42]
◼ Hardening operating system
  ✔ Creating swap file [Swap file created and activated]
  ◼ Configuring UFW firewall [Allowing ports 22, 443, 9292...]
  ◼ Installing and configuring fail2ban
  ◼ Hardening SSH configuration
  ◼ Installing system dependencies
```

This gives the operator clear visibility into what is happening, which is important when modifying a production server.

## Design Decisions

### Why zero prompts?

The installer collects no input. Domain, email, and all other configuration happen through the browser-based onboarding wizard after the panel is running. This separation means the installer can be fully automated (`--yes` flag) and the user gets a graphical interface for the complex decisions.

### Why Listr2?

Listr2 provides structured task output with progress indicators, persistent output lines, and nested subtask rendering. This makes it clear what the installer is doing at every step — important for a script that modifies the OS.

### Why vendor bundling instead of npm workspace install?

The installer runs via `npx` on a fresh server. `npx` installs only the `create-lamaste` package, not the full monorepo. The vendor approach ships a self-contained bundle with all code needed, avoiding network-dependent monorepo installs on the target server.

### Why PBE-SHA1-3DES for PKCS12?

Modern OpenSSL defaults produce PKCS12 bundles that macOS Keychain Access cannot import. The legacy algorithm flags (`-keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1`) ensure compatibility across macOS, Windows, and Linux browsers. Security of the PKCS12 bundle is not critical — it is a one-time transport mechanism protected by a random password.
