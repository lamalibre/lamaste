# @lamalibre/install-portlama-desktop

Download and install the [Portlama Desktop](https://github.com/lamalibre/portlama) app with one command.

```bash
npx @lamalibre/install-portlama-desktop
```

## What It Does

1. Detects your platform (macOS arm64/x64, Linux x64/arm64)
2. Fetches the latest desktop release from GitHub
3. Downloads and caches the binary in `~/.portlama/desktop/`
4. Installs and launches the app:
   - **macOS** — mounts the DMG, copies to `/Applications`, clears Gatekeeper quarantine
   - **Linux** — copies the AppImage to `~/.local/bin/portlama-desktop`

Run it again to update to a newer version. Cached downloads are reused when the version hasn't changed.

## Portlama Desktop

The desktop app provides a native GUI for managing Portlama tunnels with:

- **Service discovery** — auto-detects Ollama, ComfyUI, PostgreSQL, Redis, Docker containers, and 17+ other services
- **One-click expose** — select a running service and create a tunnel instantly
- **Custom services** — register your own service definitions
- **Tunnel management** — start, stop, and monitor Chisel tunnels
- **System tray** — runs in the background with a status indicator

## Prerequisites

- A Portlama server set up via `npx @lamalibre/create-portlama`
- An agent certificate (generated from the panel's Certificates page)
- Node.js >= 20

## macOS Gatekeeper

The app is not code-signed. If macOS blocks it:

- Right-click the app → **Open**
- Or: System Settings → Privacy & Security → **Open Anyway**

The installer attempts to clear the quarantine attribute automatically.

## Supported Platforms

| Platform            | Asset            |
| ------------------- | ---------------- |
| macOS Apple Silicon | `.dmg` (aarch64) |
| macOS Intel         | `.dmg` (x64)     |
| Linux x64           | `.AppImage`      |
| Linux arm64         | `.AppImage`      |

## Links

- [Portlama](https://github.com/lamalibre/portlama) — main repository
- [Desktop App Setup Guide](https://github.com/lamalibre/portlama/blob/main/packages/panel-client/public/docs/02-guides/desktop-app-setup.md)

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

[Polyform Noncommercial 1.0.0](https://github.com/lamalibre/portlama/blob/main/LICENSE.md)
