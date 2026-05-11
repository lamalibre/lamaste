# @lamalibre/lamaste-desktop

Tauri v2 desktop application for managing Lamaste servers and tunnels on macOS and Ubuntu. Supports dual-mode operation (Agent and Server), multi-server management, cloud provisioning (DigitalOcean), and service discovery.

## Install

```bash
npx @lamalibre/create-lamaste-desktop
```

Downloads the latest release from GitHub, installs to `/Applications` (macOS) or `~/.local/bin` (Linux), and launches the app. See the [Desktop App Setup guide](../lamaste-server-ui/public/docs/02-guides/desktop-app-setup.md) for details.

## What It Does

The desktop app provides a native GUI for managing Lamaste with two operating modes:

### Dual Mode

The sidebar features an Agents/Servers pill toggle (visible when an admin certificate is detected for the active server):

- **Agent mode** (default) — local agent management: Dashboard, Tunnels, Services, Servers, Logs, Settings
- **Server mode** — full admin panel: Dashboard, Tunnels, Services, Static Sites, Users, Certificates, Tickets, Plugins, Logs, Settings

Server mode pages are imported from `@lamalibre/lamaste-server-ui`, a shared React package also consumed by the web panel. An `AdminClientContext` abstraction lets each host provide its own data client — the web uses browser `fetch`, the desktop uses Tauri `invoke` commands with the Rust backend handling mTLS.

Cloud-provisioned servers automatically include an admin certificate, so Server mode is available immediately. For servers added via `lamaste-agent setup`, an admin certificate must be imported manually.

### Features

- **mTLS authentication** — connects to the panel using agent-scoped or admin certificates
- **Tunnel management** — start, stop, and monitor Chisel tunnels
- **Service discovery** — auto-detects local services (Ollama, ComfyUI, PostgreSQL, Redis, etc.) and Docker containers, with one-click tunnel creation
- **Custom services** — user-defined service definitions persisted in `~/.lamalibre/lamaste/services.json`
- **Multi-server support** — manage multiple Lamaste servers from a single app, switch between them, persisted in `~/.lamalibre/lamaste/servers.json`
- **Cloud provisioning** — create DigitalOcean droplets with Lamaste pre-installed directly from the app (token scope validation, region latency measurement, automatic certificate download)
- **Local installation** — install a Lamaste server directly on the local Linux machine via `pkexec` + `create-lamaste --json` (NDJSON progress streaming, automatic certificate import, existing installation detection)
- **Secure credential storage** — cloud API tokens and P12 passwords stored in the OS credential store (macOS Keychain via `security-framework` crate, Linux libsecret via `secret-tool`)
- **System tray** — background operation with status indicator
- **IPC** — Rust backend handles mTLS, Chisel, cloud provisioning, local installation, and credential storage; React frontend handles UI

## Tech Stack

| Layer    | Technology                 |
| -------- | -------------------------- |
| Backend  | Tauri v2 (Rust)            |
| Frontend | React 18 + Vite + Tailwind |
| Data     | @tanstack/react-query      |
| Icons    | lucide-react               |
| Shell    | @tauri-apps/plugin-shell   |

## Prerequisites

- Node.js >= 20.0.0
- Rust toolchain (for Tauri)
- Platform-specific Tauri dependencies ([see Tauri docs](https://v2.tauri.app/start/prerequisites/))

## Development

```bash
# From the monorepo root
npm run dev -w packages/lamaste-desktop

# Or with Tauri
cd packages/lamaste-desktop
npm run tauri dev
```

## Further Reading

See the main repository for architecture details and the full development
plan: <https://github.com/lamalibre/lamaste>

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
