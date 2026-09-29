# @lamalibre/lamaste-agent

Tunnel agent for Lamaste — manages a Chisel tunnel client as a system service
on macOS (launchd) and Linux (systemd).

## Installation

Install the agent globally, then run setup:

```bash
npm install -g @lamalibre/lamaste-agent
LAMALIBRE_LAMASTE_ENROLLMENT_TOKEN=<token> \
  lamaste-agent setup --label my-server --panel-url https://<server-ip>:9292
```

A global install is required: setup installs a **sync timer** that runs the
installed `lamaste-agent` every 30 seconds, and an `npx` copy can disappear from
npm's cache at any time. `setup` and `update` refuse to run from `npx` — before an
enrollment token is spent. For an installation npm does not manage, set
`LAMALIBRE_LAMASTE_AGENT_CLI_PATH` to the absolute path of the script the timer
should run.

The setup command downloads the pinned Chisel release (checksum-verified),
fetches the agent's Chisel credential, installs the tunnel client as a user-level
service (LaunchAgent on macOS, systemd user unit on Linux) and the sync timer, and
starts the client once the agent carries a tunnel. The panel provides the
connection details and an agent-scoped mTLS certificate.

Tunnel changes on the panel — a tunnel created, deleted, disabled or moved — reach
the agent within about 30 seconds through the sync timer; nothing has to be run
on the agent. The timer exists because Chisel rejects a client's whole session
when one requested port is no longer granted, so a revoked tunnel must be dropped
promptly or the agent's other tunnels go dark too. An agent with no tunnels keeps
its Chisel client stopped.

Multiple agents can be configured simultaneously, each with its own label
pointing to a different Lamaste server. Per-agent data is stored at
`~/.lamalibre/lamaste/agents/<label>/`.

## Commands

All commands accept the `--label <name>` flag to target a specific agent.
Without `--label`, the current default agent is used.

| Command                            | Description                                                       |
| ---------------------------------- | ----------------------------------------------------------------- |
| `setup`                            | Install Chisel, configure the tunnel, install the sync timer      |
| `update`                           | Apply the panel's config now, restart, (re)install the sync timer |
| `sync`                             | Converge with the panel once (what the timer runs)                |
| `uninstall`                        | Remove Chisel, service, sync timer, and configuration             |
| `uninstall --all`                  | Remove all agents and `~/.lamalibre/lamaste`                      |
| `status`                           | Show tunnel connection and sync timer status                      |
| `logs`                             | Display recent tunnel logs                                        |
| `sites`                            | List all static sites                                             |
| `sites create <name>`              | Create a new static site (admin cert only)                        |
| `sites delete <name-or-id>`        | Delete a static site (admin cert only)                            |
| `deploy <name-or-id> <local-path>` | Deploy a local directory to a site                                |
| `plugin`                           | Manage agent plugins (install, uninstall, update, status)         |
| `panel --enable [--port 9393]`     | Enable the agent management panel web server                      |
| `panel --disable`                  | Disable the agent management panel                                |
| `panel --status [--json]`          | Show agent panel status                                           |
| `chisel refresh-credential`        | Fetch a rotated Chisel credential now (sync does it within 30 s)  |
| `list`                             | List all configured agents                                        |
| `switch <label>`                   | Set the default agent                                             |

> The agent panel runs as a user-level service: a launchd plist under
> `~/Library/LaunchAgents/` on macOS, and a user-mode systemd unit under
> `~/.config/systemd/user/` on Linux. To keep the Linux panel service
> running after you log out, enable user lingering once with
> `sudo loginctl enable-linger $USER` — `panel --enable` warns if it
> detects this is missing. The same applies to the tunnel client and the sync
> timer.

### Sites Command

Manage static sites hosted on your Lamaste server. Requires an agent certificate with `sites:read` and/or `sites:write` capabilities.

**Important:** `sites create` and `sites delete` require admin-level access (admin certificate). Agent certificates cannot create or delete sites. The admin creates sites through the panel and assigns them to agent certificates via **Panel > Certificates > Agent Certificates > Edit > Site Access**.

**List sites assigned to this agent:**

```bash
lamaste-agent sites
```

The agent only sees sites listed in its `allowedSites` configuration. The admin controls which sites each agent can access.

**Create a managed subdomain site (admin only):**

```bash
lamaste-agent sites create blog
```

**Create a site with options:**

```bash
# Managed subdomain with SPA mode and Authelia protection
lamaste-agent sites create docs --spa --auth

# Custom domain site
lamaste-agent sites create myblog --type custom --domain myblog.com
```

| Flag                       | Default   | Description                                         |
| -------------------------- | --------- | --------------------------------------------------- |
| `--type <managed\|custom>` | `managed` | Site type: managed subdomain or custom domain       |
| `--domain <fqdn>`          | —         | Custom domain (required when `--type custom`)       |
| `--spa`                    | off       | Enable SPA mode (serve `index.html` for all routes) |
| `--auth`                   | off       | Enable Authelia protection                          |

**Delete a site:**

```bash
lamaste-agent sites delete blog
lamaste-agent sites delete 550e8400-e29b-41d4-a716-446655440000
```

### Deploy Command

Deploy a local directory to a static site. This clears all existing files on the site and uploads all non-hidden files from the specified directory. It is a full replacement, not a merge.

Requires an agent certificate with both `sites:read` and `sites:write` capabilities, and the site must be listed in the agent's `allowedSites` configuration. The admin assigns sites to agent certs via **Panel > Certificates > Agent Certificates > Edit > Site Access**.

```bash
lamaste-agent deploy blog ./dist
```

**Typical workflow:**

```bash
# Admin creates the site via the panel UI or with an admin certificate:
#   lamaste-agent sites create blog   (requires admin cert)
# Then assigns the site to the agent cert via Panel > Certificates > Site Access

# Agent builds and deploys (requires agent cert with sites:read + sites:write)
npm run build
lamaste-agent deploy blog ./dist
```

**What happens during deploy:**

1. All existing remote files are cleared.
2. All non-hidden files from the local directory are uploaded (batched for memory safety).
3. The remote file list is verified against what was uploaded.
4. A summary is printed with file count, total size, and live URL.

## Requirements

| Requirement | Details                                                                             |
| ----------- | ----------------------------------------------------------------------------------- |
| OS          | macOS or Ubuntu Linux (24.04 LTS)                                                   |
| Node.js     | >= 20.0.0                                                                           |
| Access      | User account (no root); on headless Linux, `sudo loginctl enable-linger $USER` once |
| Install     | Global: `npm install -g @lamalibre/lamaste-agent`                                   |

## How It Works

The agent registers with the Lamaste panel using an agent-scoped mTLS
certificate (not the admin certificate). It connects to the server's Chisel
endpoint over WebSocket-over-HTTPS and exposes local ports as configured
in the panel's tunnel settings.

The agent only ever connects to `https://tunnel.<enrolled domain>:443` and
verifies its certificate; it refuses a panel that reports another domain
(re-enroll to move). The Chisel credential lives in 0600 files, never in process
arguments; agents set up by older versions rotate it once on their first sync.

The user-level service (launchd on macOS, systemd on Linux) ensures the tunnel
reconnects automatically after reboot or network changes (retrying at least every
30 seconds), and the sync timer keeps it in line with the panel.

When upgrading, upgrade agents before the server: `npm install -g
@lamalibre/lamaste-agent && lamaste-agent update`.

## Further Reading

See the main repository for architecture, tunnel configuration, and the full
development plan: <https://github.com/lamalibre/lamaste>

## Disclaimer

This software is provided "as is", without warranty of any kind, express or implied. The authors and contributors accept no liability for any damages, data loss, security incidents, or legal consequences arising from the use of this software.

Lamaste is designed for self-hosted use cases — personal projects, development environments, demos, and internal tools. It is not a substitute for production infrastructure. Production workloads require dedicated hosting, load balancing, redundancy, monitoring, and operational expertise that are beyond the scope of this project.

**You are solely responsible for what you expose through Lamaste.** By tunneling an application to the public internet, you grant anyone with access the ability to interact with that application as if they were on your local network. This carries inherent risks:

- **Arbitrary code execution:** If the tunneled application contains vulnerabilities or backdoors, remote attackers may exploit them to execute code on your machine, access your file system, or compromise your operating system.
- **Data exposure:** Misconfigured or insecure applications may leak sensitive data, credentials, or private files to the internet.
- **Lateral movement:** A compromised tunneled application may be used as an entry point to attack other devices and services on your local network.
- **Resource abuse:** Publicly accessible applications may be used for cryptocurrency mining, spam relaying, botnet hosting, or other abuse that could result in legal action against you.

Lamaste provides authentication and access control mechanisms, but no security measure is absolute. It is your responsibility to understand the software you expose, keep it updated, and assess the risks of making it publicly accessible. The authors of Lamaste bear no responsibility for the consequences of tunneling untrusted, vulnerable, or malicious software.

## License

[Polyform Noncommercial 1.0.0](./LICENSE.md) — see [LICENSE.md](./LICENSE.md) for details.
