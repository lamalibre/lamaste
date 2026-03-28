# @lamalibre/portlama-agent

Tunnel agent for Portlama — manages a Chisel tunnel client as a system service
on macOS (launchd) and Linux (systemd).

## Installation

```bash
npx @lamalibre/portlama-agent setup --label my-server
```

The setup command downloads the Chisel binary, configures the tunnel connection,
installs a system service (launchd plist on macOS, systemd unit on Linux), and
starts the agent. The panel provides the connection details and an agent-scoped
mTLS certificate.

Multiple agents can be configured simultaneously, each with its own label
pointing to a different Portlama server. Per-agent data is stored at
`~/.portlama/agents/<label>/`.

## Commands

All commands accept the `--label <name>` flag to target a specific agent.
Without `--label`, the current default agent is used.

| Command                            | Description                                |
| ---------------------------------- | ------------------------------------------ |
| `setup`                            | Install Chisel and configure the tunnel    |
| `update`                           | Re-fetch config from panel and restart     |
| `uninstall`                        | Remove Chisel, service, and configuration  |
| `uninstall --all`                  | Remove all agents and `~/.portlama`        |
| `status`                           | Show tunnel connection status              |
| `logs`                             | Display recent tunnel logs                 |
| `sites`                            | List all static sites                      |
| `sites create <name>`              | Create a new static site (admin cert only) |
| `sites delete <name-or-id>`        | Delete a static site (admin cert only)     |
| `deploy <name-or-id> <local-path>` | Deploy a local directory to a site         |
| `plugin`                           | Manage agent plugins (install, uninstall, update, status) |
| `list`                             | List all configured agents                 |
| `switch <label>`                   | Set the default agent                      |

### Sites Command

Manage static sites hosted on your Portlama server. Requires an agent certificate with `sites:read` and/or `sites:write` capabilities.

**Important:** `sites create` and `sites delete` require admin-level access (admin certificate). Agent certificates cannot create or delete sites. The admin creates sites through the panel and assigns them to agent certificates via **Panel > Certificates > Agent Certificates > Edit > Site Access**.

**List sites assigned to this agent:**

```bash
portlama-agent sites
```

The agent only sees sites listed in its `allowedSites` configuration. The admin controls which sites each agent can access.

**Create a managed subdomain site (admin only):**

```bash
portlama-agent sites create blog
```

**Create a site with options:**

```bash
# Managed subdomain with SPA mode and Authelia protection
portlama-agent sites create docs --spa --auth

# Custom domain site
portlama-agent sites create myblog --type custom --domain myblog.com
```

| Flag                       | Default   | Description                                         |
| -------------------------- | --------- | --------------------------------------------------- |
| `--type <managed\|custom>` | `managed` | Site type: managed subdomain or custom domain       |
| `--domain <fqdn>`          | —         | Custom domain (required when `--type custom`)       |
| `--spa`                    | off       | Enable SPA mode (serve `index.html` for all routes) |
| `--auth`                   | off       | Enable Authelia protection                          |

**Delete a site:**

```bash
portlama-agent sites delete blog
portlama-agent sites delete 550e8400-e29b-41d4-a716-446655440000
```

### Deploy Command

Deploy a local directory to a static site. This clears all existing files on the site and uploads all non-hidden files from the specified directory. It is a full replacement, not a merge.

Requires an agent certificate with both `sites:read` and `sites:write` capabilities, and the site must be listed in the agent's `allowedSites` configuration. The admin assigns sites to agent certs via **Panel > Certificates > Agent Certificates > Edit > Site Access**.

```bash
portlama-agent deploy blog ./dist
```

**Typical workflow:**

```bash
# Admin creates the site via the panel UI or with an admin certificate:
#   portlama-agent sites create blog   (requires admin cert)
# Then assigns the site to the agent cert via Panel > Certificates > Site Access

# Agent builds and deploys (requires agent cert with sites:read + sites:write)
npm run build
portlama-agent deploy blog ./dist
```

**What happens during deploy:**

1. All existing remote files are cleared.
2. All non-hidden files from the local directory are uploaded (batched for memory safety).
3. The remote file list is verified against what was uploaded.
4. A summary is printed with file count, total size, and live URL.

## Requirements

| Requirement | Details                                         |
| ----------- | ----------------------------------------------- |
| OS          | macOS or Ubuntu Linux (24.04 LTS)               |
| Node.js     | >= 20.0.0                                       |
| Access      | User account on macOS; root/sudo on Linux       |

## How It Works

The agent registers with the Portlama panel using an agent-scoped mTLS
certificate (not the admin certificate). It connects to the server's Chisel
endpoint over WebSocket-over-HTTPS and exposes local ports as configured
in the panel's tunnel settings.

The system service (launchd on macOS, systemd on Linux) ensures the tunnel
reconnects automatically after reboot or network changes.

## Further Reading

See the main repository for architecture, tunnel configuration, and the full
development plan: <https://github.com/lamalibre/portlama>

## Disclaimer

This software is provided "as is", without warranty of any kind, express or implied. The authors and contributors accept no liability for any damages, data loss, security incidents, or legal consequences arising from the use of this software.

Portlama is designed for self-hosted use cases — personal projects, development environments, demos, and internal tools. It is not a substitute for production infrastructure. Production workloads require dedicated hosting, load balancing, redundancy, monitoring, and operational expertise that are beyond the scope of this project.

**You are solely responsible for what you expose through Portlama.** By tunneling an application to the public internet, you grant anyone with access the ability to interact with that application as if they were on your local network. This carries inherent risks:

- **Arbitrary code execution:** If the tunneled application contains vulnerabilities or backdoors, remote attackers may exploit them to execute code on your machine, access your file system, or compromise your operating system.
- **Data exposure:** Misconfigured or insecure applications may leak sensitive data, credentials, or private files to the internet.
- **Lateral movement:** A compromised tunneled application may be used as an entry point to attack other devices and services on your local network.
- **Resource abuse:** Publicly accessible applications may be used for cryptocurrency mining, spam relaying, botnet hosting, or other abuse that could result in legal action against you.

Portlama provides authentication and access control mechanisms, but no security measure is absolute. It is your responsibility to understand the software you expose, keep it updated, and assess the risks of making it publicly accessible. The authors of Portlama bear no responsibility for the consequences of tunneling untrusted, vulnerable, or malicious software.

## License

[Polyform Noncommercial 1.0.0](./LICENSE.md) — see [LICENSE.md](./LICENSE.md) for details.
