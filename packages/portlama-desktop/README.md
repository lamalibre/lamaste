# @lamalibre/portlama-desktop

Tauri v2 desktop application for managing Portlama tunnels on macOS and Ubuntu.
This is a private package internal to the
[Portlama monorepo](https://github.com/lamalibre/portlama) and is not published
to npm. It is currently in development.

## What It Does

The desktop agent provides a native GUI for managing Portlama tunnels with:

- **mTLS authentication** — connects to the panel using agent-scoped certificates
- **Tunnel management** — start, stop, and monitor Chisel tunnels
- **Service discovery** — auto-detects local services (Ollama, ComfyUI, PostgreSQL, Redis, etc.) and Docker containers, with one-click tunnel creation
- **Custom services** — user-defined service definitions persisted in `~/.portlama/services.json`
- **System tray** — background operation with status indicator
- **IPC** — Rust backend handles mTLS and Chisel; React frontend handles UI

## Tech Stack

| Layer    | Technology                        |
| -------- | --------------------------------- |
| Backend  | Tauri v2 (Rust)                   |
| Frontend | React 18 + Vite + Tailwind        |
| Data     | @tanstack/react-query             |
| Icons    | lucide-react                      |
| Shell    | @tauri-apps/plugin-shell          |

## Prerequisites

- Node.js >= 20.0.0
- Rust toolchain (for Tauri)
- Platform-specific Tauri dependencies ([see Tauri docs](https://v2.tauri.app/start/prerequisites/))

## Development

```bash
# From the monorepo root
npm run dev -w packages/portlama-desktop

# Or with Tauri
cd packages/portlama-desktop
npm run tauri dev
```

## Further Reading

See the main repository for architecture details and the full development
plan: <https://github.com/lamalibre/portlama>

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
