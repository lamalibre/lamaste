# @lamalibre/portlama-agent

Mac tunnel agent for Portlama — installs a Chisel tunnel client and manages it
as a macOS launchd agent.

## Installation

```bash
npx @lamalibre/portlama-agent setup
```

The setup command downloads the Chisel binary, configures the tunnel connection,
installs a launchd plist, and starts the agent. The panel provides the
connection details and an agent-scoped mTLS certificate.

## Commands

| Command     | Description                              |
| ----------- | ---------------------------------------- |
| `setup`     | Install Chisel and configure the tunnel  |
| `update`    | Update Chisel binary to latest version   |
| `uninstall` | Remove Chisel, plist, and configuration  |
| `status`    | Show tunnel connection status            |
| `logs`      | Display recent tunnel logs               |

## Requirements

| Requirement | Details         |
| ----------- | --------------- |
| OS          | macOS           |
| Node.js     | >= 20.0.0       |
| Access      | User account (no root required) |

## How It Works

The agent registers with the Portlama panel using an agent-scoped mTLS
certificate (not the admin certificate). It connects to the server's Chisel
endpoint over WebSocket-over-HTTPS and exposes local ports as configured
in the panel's tunnel settings.

The launchd plist ensures the tunnel reconnects automatically after reboot
or network changes.

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
