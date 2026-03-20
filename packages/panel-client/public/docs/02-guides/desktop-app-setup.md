# Desktop App Setup

> Install the Portlama Desktop app for a native GUI experience with automatic service discovery and one-click tunnel creation.

## In Plain English

The Portlama Desktop app is a native application (built with Tauri) that replaces the manual Chisel client setup. Instead of downloading plists, editing configuration files, and running terminal commands, you get a graphical interface that:

- **Discovers local services automatically** — it scans your machine for well-known services (Ollama, ComfyUI, PostgreSQL, Redis, Docker containers, etc.) and shows them in a marketplace-style UI
- **Creates tunnels with one click** — select a detected service, click "Expose," and the app creates the tunnel, updates the Chisel config, and reloads the connection
- **Manages everything visually** — start/stop Chisel, view logs, manage tunnels, rotate certificates, all from a native window with a system tray icon

## Prerequisites

- A completed [Portlama onboarding](onboarding.md) on your VPS
- An **agent certificate** (`.p12` file and password) — generated from the panel's Certificates page
- **macOS** (Apple Silicon or Intel) or **Linux** (x64)
- **Node.js** >= 20 (for the npx installer)

> **Do not use the admin certificate.** Generate a scoped agent certificate from the panel. See [Certificate Management](certificate-management.md#agent-certificates).

## Installation

Run the installer:

```bash
npx @lamalibre/install-portlama-desktop
```

The installer:

1. Detects your platform (macOS arm64/x64 or Linux x64)
2. Downloads the latest release from GitHub
3. Caches the download in `~/.portlama/desktop/`
4. Installs the app:
   - **macOS:** Mounts the DMG, copies to `/Applications`, clears Gatekeeper quarantine, launches
   - **Linux:** Copies the AppImage to `~/.local/bin/portlama-desktop`, makes it executable, launches

On subsequent runs, the installer uses the cached download if the version hasn't changed.

### macOS Gatekeeper Note

The app is not code-signed with an Apple Developer certificate. On first launch:

- The installer attempts to clear the quarantine attribute automatically
- If macOS still blocks it: right-click the app → **Open**, or go to **System Settings → Privacy & Security → Open Anyway**

## Initial Setup

After the app launches, it shows a setup screen prompting you to run the agent setup:

```bash
npx @lamalibre/portlama-agent setup
```

This command connects to your VPS panel using the agent certificate and configures the local Chisel client. During setup, the client certificate and key are extracted from the P12 bundle for mTLS client authentication. Once setup completes, the app detects the configuration and switches to the main interface.

## Using the App

### Dashboard

Shows connection status (connected/disconnected), Chisel version, and controls to start/stop/restart the tunnel client.

### Tunnels

Lists all configured tunnels with their FQDNs, ports, and status. Create new tunnels or delete existing ones. Changes automatically reload the Chisel client.

### Services

The marketplace-style service discovery page:

- **Category filters:** All, AI, Database, Docker, Dev, Media, Monitoring, Custom
- **Automatic detection:** Scans for 17 well-known services plus all Docker containers
- **Status indicators:** Running (green), Installed (amber), Not Found (gray)
- **One-click expose:** Click "Expose" on any running service to create a tunnel
- **Custom services:** Add your own service definitions with name, port, binary, process name, and category

**Built-in services detected:**

| Service                | Default Port | Category   |
| ---------------------- | ------------ | ---------- |
| Ollama                 | 11434        | AI         |
| ComfyUI                | 8188         | AI         |
| LM Studio              | 1234         | AI         |
| Stable Diffusion WebUI | 7860         | AI         |
| Open WebUI             | 3000         | AI         |
| LocalAI                | 8080         | AI         |
| Jupyter                | 8888         | Dev        |
| VS Code Server         | 8080         | Dev        |
| n8n                    | 5678         | Dev        |
| Grafana                | 3000         | Monitoring |
| Home Assistant         | 8123         | Media      |
| Plex                   | 32400        | Media      |
| MinIO                  | 9000         | Database   |
| PostgreSQL             | 5432         | Database   |
| Redis                  | 6379         | Database   |
| MongoDB                | 27017        | Database   |
| Elasticsearch          | 9200         | Database   |

Docker containers with exposed ports are also detected and can be individually exposed.

### Shell

Manage remote shell access for your agents:

- **Global toggle** — enable or disable remote shell access across all agents
- **Shell policies** — create named policies with IP allow/deny lists, command blocklists, inactivity timeouts, and file transfer size limits
- **Per-agent control** — enable shell access for individual agents with a time window (5 minutes to 8 hours) and an assigned policy
- **Session audit log** — view past shell sessions with start/end times, duration, and status

The Shell tab is an admin-only feature. Agents provide shell access by running `portlama-agent shell-server` on the agent machine. See the [Remote Shell guide](remote-shell.md) for the full setup walkthrough.

### Logs

View Chisel client stdout and stderr logs.

### Settings

Certificate management — rotate or re-download the agent certificate, uninstall the agent.

## Updating

Run the installer again to get the latest version:

```bash
npx @lamalibre/install-portlama-desktop
```

If a new release is available, it downloads and installs the update. The previous version is replaced.

## Uninstalling

**macOS:**

```bash
rm -rf /Applications/Portlama.app
rm -rf ~/.portlama/desktop/
```

**Linux:**

```bash
rm ~/.local/bin/portlama-desktop
rm -rf ~/.portlama/desktop/
```

To also remove the agent configuration:

```bash
rm -rf ~/.portlama/
```

## Quick Reference

| Action               | Command / Location                        |
| -------------------- | ----------------------------------------- |
| **Install**          | `npx @lamalibre/install-portlama-desktop` |
| **Update**           | `npx @lamalibre/install-portlama-desktop` |
| **Agent setup**      | `npx @lamalibre/portlama-agent setup`     |
| **App location**     | `/Applications/Portlama.app` (macOS)      |
| **Config**           | `~/.portlama/agent.json`                  |
| **Service registry** | `~/.portlama/services.json`               |
| **Download cache**   | `~/.portlama/desktop/`                    |
| **Chisel logs**      | `~/.portlama/logs/chisel.log`             |
| **npm package**      | `@lamalibre/install-portlama-desktop`     |

### Related Documentation

- [Mac Client Setup](mac-client-setup.md) — manual CLI-based Chisel setup (alternative)
- [Certificate Management](certificate-management.md) — generating agent certificates
- [First Tunnel](first-tunnel.md) — creating tunnels via the panel UI
- [Quick Start](../00-introduction/quickstart.md) — full setup walkthrough
