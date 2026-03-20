# Remote Shell

> Secure terminal access from admin to agent machines via tmux over the existing WebSocket tunnel, with policy-based access control, command blocklists, and session recording.

## In Plain English

Remote shell lets you open a terminal on an agent machine from your admin workstation — without SSH, without port forwarding, and without exposing any new ports. The connection travels through the same WebSocket tunnel that Portlama already uses for reverse proxying, so the agent machine's firewall configuration does not change.

The admin initiates a shell session from the CLI (`portlama-agent shell <label>`) or from the panel UI. The agent machine must be running the shell gateway (`portlama-agent shell-server`), which spawns a tmux session and relays I/O through the panel's WebSocket relay. Every keystroke and output is forwarded in real time.

Because remote shell grants direct command execution on the agent machine, it is protected by a 5-gate authentication chain and scoped through named shell policies. Shell access is never implicitly on — the admin must explicitly enable it per agent with a time window, and the admin's IP must pass the policy's allow/deny list.

## Prerequisites

- A completed [Portlama onboarding](onboarding.md) on your VPS
- An **admin certificate** on the machine initiating the shell session
- An **agent certificate** on the target machine, with agent setup completed (`portlama-agent setup`)
- **tmux** installed on the agent machine:
  - macOS: `brew install tmux`
  - Linux: `sudo apt install tmux`
- The agent CLI (`@lamalibre/portlama-agent`) installed and set up on both machines

## Step-by-Step

### 1. Enable Remote Shell Globally

Remote shell is disabled by default. Enable it from the panel or the desktop app:

**Desktop app:** Go to the **Shell** tab and toggle **Remote Shell** to enabled.

**Panel API:**

```bash
curl -k --cert-type P12 --cert admin.p12:<password> \
  https://<ip>:9292/api/shell/config \
  -X PATCH -H 'Content-Type: application/json' \
  -d '{"enabled": true}'
```

### 2. Create a Shell Policy (Optional)

A **default** policy ships out of the box with a standard command blocklist and no IP restrictions. You can create additional policies to scope access differently for different agents.

**Desktop app:** Shell tab → **Policies** → **Create Policy**.

**Panel API:**

```bash
curl -k --cert-type P12 --cert admin.p12:<password> \
  https://<ip>:9292/api/shell/policies \
  -X POST -H 'Content-Type: application/json' \
  -d '{
    "name": "Restricted",
    "description": "Locked-down policy for production agents",
    "allowedIps": ["203.0.113.10"],
    "deniedIps": [],
    "inactivityTimeout": 300,
    "commandBlocklist": {
      "hardBlocked": ["rm -rf /", "mkfs", "shutdown"],
      "restricted": { "sudo": false, "systemctl": false }
    }
  }'
```

**Policy fields:**

| Field               | Type     | Default        | Description                                                        |
| ------------------- | -------- | -------------- | ------------------------------------------------------------------ |
| `name`              | string   | —              | Human-readable policy name                                         |
| `allowedIps`        | string[] | `[]` (all)     | IPv4 addresses or CIDRs that may connect. Empty = all allowed.     |
| `deniedIps`         | string[] | `[]`           | IPv4 addresses or CIDRs that are always blocked. Takes precedence. |
| `inactivityTimeout` | number   | `600` (10 min) | Seconds of inactivity before the session is terminated.            |
| `maxFileSize`       | number   | `104857600`    | Maximum file transfer size in bytes (default 100 MB).              |
| `commandBlocklist`  | object   | (see below)    | Hard-blocked patterns and restricted command prefixes.             |

### 3. Enable Shell for an Agent

Shell access is granted per agent with a time window. After the window expires, the agent's shell access is automatically revoked.

**Desktop app:** Shell tab → find the agent → **Enable** → choose duration and policy.

**Panel API:**

```bash
curl -k --cert-type P12 --cert admin.p12:<password> \
  https://<ip>:9292/api/shell/enable/my-macbook \
  -X POST -H 'Content-Type: application/json' \
  -d '{"durationMinutes": 60, "policyId": "default"}'
```

Duration ranges from 5 minutes to 8 hours (480 minutes).

### 4. Start the Shell Gateway on the Agent

On the agent machine, run:

```bash
portlama-agent shell-server
```

This process:

1. Verifies tmux is installed
2. Extracts mTLS certificates from the agent's `.p12` file
3. Installs the `portlama-shell.sh` restricted shell wrapper
4. Polls the panel for shell configuration
5. When shell access is enabled, connects to the WebSocket relay and waits for an admin connection
6. Spawns a tmux session when the admin connects, with session recording enabled

The shell server runs as a long-lived process. For persistent operation, run it under a process manager (launchd on macOS, systemd on Linux).

### 5. Connect from the Admin Machine

From your admin workstation (with the admin certificate configured):

```bash
portlama-agent shell my-macbook
```

The client connects to the panel's WebSocket relay, which pairs the admin and agent sockets for bidirectional I/O. You see a live terminal session on the agent machine.

**Controls:**

- **Ctrl+]** — disconnect from the shell session
- The terminal auto-resizes when your window dimensions change

### 6. Transfer Files

> **Note:** The `portlama-agent cp` command is currently macOS-only. The shell gateway (`shell-server`) works on both macOS and Linux.

Copy files between your machine and a remote agent:

```bash
# Download from agent
portlama-agent cp my-macbook:/var/log/app.log ./app.log

# Upload to agent
portlama-agent cp ./config.json my-macbook:/etc/app/config.json
```

Remote paths use the format `agent-label:/absolute/path`. Only single file transfers are supported — archive directories first (e.g., `tar -czf archive.tar.gz dir/`).

### 7. View Session Logs

> **Note:** The `portlama-agent shell-log` command is currently macOS-only. The shell gateway (`shell-server`) works on both macOS and Linux.

List past shell sessions:

```bash
# All sessions
portlama-agent shell-log

# Sessions for a specific agent
portlama-agent shell-log my-macbook
```

Session recordings are stored on the agent machine at `~/.portlama/shell-recordings/<session-id>.log`. The server maintains an audit log of session metadata (start/end time, duration, source IP, status) in `/etc/portlama/shell-sessions.json`.

## Command Blocklist

The restricted shell wrapper (`portlama-shell.sh`) enforces a two-tier command blocklist:

**Hard-blocked** — commands that are always rejected (exact match):

- `rm -rf /`, `rm -rf /*`, `rm -rf ~`, `rm -rf ~/*`
- `mkfs`, `dd if=`, `shutdown`, `reboot`, `halt`, `poweroff`
- `chmod -R 777 /`, `> /dev/sda`, `> /dev/disk`
- `curl|sh`, `curl|bash`, `wget|sh`, `wget|bash`
- Fork bomb: `:(){ :|:& };:`

**Restricted** — commands that are blocked by default but can be individually enabled per policy:

- `sudo`, `su`, `launchctl`, `systemctl`
- `networksetup`, `ifconfig`, `diskutil`, `iptables`, `ufw`

Blocked commands produce a `BLOCKED: This command is not allowed in remote shell sessions.` message and are logged to `~/.portlama/shell-history.log` on the agent.

> **Note:** The command blocklist is an advisory guard rail, not a security boundary. A determined user with shell access can bypass it. The primary security controls are the 5-gate auth chain, session recording, and time-limited access windows.

## 5-Gate Authentication Chain

Every shell session must pass all five gates:

| Gate | Check                          | Failure result                         |
| ---- | ------------------------------ | -------------------------------------- |
| 1    | Global shell toggle enabled    | `Remote shell is not enabled globally` |
| 2    | Agent cert exists, not revoked | `Agent certificate not found`          |
| 3    | `shellEnabledUntil` in future  | `Shell access not enabled for agent`   |
| 4    | Admin IP passes policy ACL     | `Source IP is not allowed`             |
| 5    | Connecting cert is admin       | `Admin certificate required`           |

Gates are evaluated in order. The first failure terminates the connection attempt.

## Disabling Shell Access

**Revoke for a single agent:**

```bash
curl -k --cert-type P12 --cert admin.p12:<password> \
  https://<ip>:9292/api/shell/enable/my-macbook \
  -X DELETE
```

**Disable globally:**

```bash
curl -k --cert-type P12 --cert admin.p12:<password> \
  https://<ip>:9292/api/shell/config \
  -X PATCH -H 'Content-Type: application/json' \
  -d '{"enabled": false}'
```

## Troubleshooting

### "Remote shell is not enabled globally"

Enable remote shell in the panel or desktop app Shell tab. Shell is disabled by default.

### "Shell access not enabled for agent"

The agent's shell time window has expired or was never set. Enable it again from the Shell tab or via the API.

### "tmux is not installed"

Install tmux on the agent machine:

- macOS: `brew install tmux`
- Linux: `sudo apt install tmux`

### Agent does not connect within 30 seconds

The shell server may not be running on the agent machine. Verify with:

```bash
ps aux | grep shell-server
```

If not running, start it with `portlama-agent shell-server`.

### "Source IP is not allowed"

Your IP does not match the shell policy's allow list, or it matches the deny list. Check the policy configuration in the Shell tab or via `GET /api/shell/policies`.

### Session disconnects unexpectedly

Check if the shell time window expired. The agent's `shellEnabledUntil` timestamp is visible in the Shell tab. Extend it by enabling shell access again with a longer duration.

## Quick Reference

| Action                   | Command / Location                                        |
| ------------------------ | --------------------------------------------------------- |
| **Enable globally**      | Shell tab toggle or `PATCH /api/shell/config`             |
| **Create policy**        | Shell tab → Policies or `POST /api/shell/policies`        |
| **Enable for agent**     | Shell tab → Enable or `POST /api/shell/enable/:label`     |
| **Start shell gateway**  | `portlama-agent shell-server` (on agent machine)          |
| **Connect to shell**     | `portlama-agent shell <agent-label>` (from admin machine) |
| **Copy file (download)** | `portlama-agent cp agent:/remote/path ./local/path`       |
| **Copy file (upload)**   | `portlama-agent cp ./local/path agent:/remote/path`       |
| **View session logs**    | `portlama-agent shell-log [agent-label]`                  |
| **Disable for agent**    | Shell tab → Disable or `DELETE /api/shell/enable/:label`  |
| **Disable globally**     | Shell tab toggle or `PATCH /api/shell/config`             |

| File                   | Location                                     |
| ---------------------- | -------------------------------------------- |
| **Shell config**       | `/etc/portlama/shell-config.json` (server)   |
| **Session audit log**  | `/etc/portlama/shell-sessions.json` (server) |
| **Session recordings** | `~/.portlama/shell-recordings/` (agent)      |
| **Command blocklist**  | `~/.portlama/shell-blocklist.json` (agent)   |
| **Shell wrapper**      | `~/.portlama/portlama-shell.sh` (agent)      |
| **Command history**    | `~/.portlama/shell-history.log` (agent)      |

### Security

All agent-to-panel connections authenticate via mTLS client certificates extracted from the P12 bundle. The agent currently uses `-k` (curl) and `rejectUnauthorized: false` (WebSocket) because the panel's self-signed server TLS certificate belongs to a different PKI chain than the mTLS CA extracted from the P12 bundle, so server certificate verification is not possible with the available CA. Server certificate verification (e.g., via a pinned server cert or a shared CA) is planned for a future release. The P12 password is never exposed in process listings — it is passed via temporary config files for curl and environment variables for openssl.

### Related Documentation

- [Security Model](../01-concepts/security-model.md) — 5-gate auth chain and defense-in-depth
- [Certificate Management](certificate-management.md) — generating admin and agent certificates
- [Desktop App Setup](desktop-app-setup.md) — Shell tab in the desktop app
- [Mac Client Setup](mac-client-setup.md) — agent CLI reference
