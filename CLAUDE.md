# Lamaste

Self-hosted secure tunneling platform. One command provisions a VPS, prints a certificate + URL, and SSH is never needed again. Everything is managed through a browser-based panel protected by mTLS client certificates.

All packages are at **v2.0.0**. The 2.0.0 refactor consolidated business logic into a shared core library (`@lamalibre/lamaste`), split CLIs from daemons, and eliminated ~60 Rust reimplementations of JavaScript logic in the desktop app.

## Repository Structure

```
lamaste/
├── packages/
│   ├── core/
│   │   └── lib/                       @lamalibre/lamaste — core library with subpath exports (root, /agent, /server)
│   ├── agent/
│   │   ├── cli/                       @lamalibre/lamaste-agent — agent operational CLI (thin, no Fastify)
│   │   ├── daemon/                    @lamalibre/lamaste-agentd — agent REST daemon on :9393 (no CLI parsing)
│   │   └── ui/                        @lamalibre/lamaste-agent-ui — agent React UI components + browser SPA build
│   ├── server/
│   │   ├── cli/                       @lamalibre/lamaste-server — server operational CLI (thin, no Fastify)
│   │   ├── daemon/                    @lamalibre/lamaste-serverd — server REST daemon on :3100 (renamed from serverd)
│   │   └── ui/                        @lamalibre/lamaste-server-ui — server/admin React UI + browser SPA (merged panel-client + lamaste-admin-panel)
│   ├── clients/
│   │   └── desktop/                   @lamalibre/lamaste-desktop — Tauri v2 desktop app (unified single binary; sidebar focuses on agents/servers/local/user)
│   ├── sdks/
│   │   ├── cloud/                     @lamalibre/lamaste-cloud — cloud provider abstraction for server and storage provisioning
│   │   ├── gatekeeper/                @lamalibre/lamaste-gatekeeper — tunnel authorization service (groups, grants, nginx auth_request on 127.0.0.1:9294)
│   │   ├── identity/                  @lamalibre/lamaste-identity — SDK for Authelia identity header parsing and user metadata queries
│   │   └── tickets/                   @lamalibre/lamaste-tickets — SDK for ticket system (agent-to-agent authorization)
│   ├── provisioners/
│   │   ├── server/                    @lamalibre/create-lamaste — zero-prompt server provisioner CLI
│   │   ├── agent/                     @lamalibre/create-lamaste-agent — agent cert enrollment provisioner
│   │   ├── admin/                     @lamalibre/create-lamaste-admin — admin cert upgrade to hardware-bound
│   │   ├── desktop/                   @lamalibre/create-lamaste-desktop — npx installer for the desktop app
│   │   └── e2e/                       @lamalibre/create-lamaste-e2e — npx installer + MCP server for E2E test infrastructure
│   └── tools/
│       └── lamaste-rodeo/             E2E test specs and runner integration for lamaste (paired with @lamalibre/rodeo)
├── tests/
│   ├── e2e/                           Single-VM end-to-end tests
│   └── e2e-three-vm/                  Three-VM integration tests (Multipass)
└── e2e-logs/                          Latest E2E test execution logs
```

## Naming Convention

All packages use the `@lamalibre/` scope. The naming pattern is:

- **`lamaste`** — the core library. You `import { ... } from '@lamalibre/lamaste'`. No `-lib` suffix.
- **`-d` suffix** for daemons — Unix convention (`httpd`, `sshd`, `mongod`). Instantly signals "long-running process". `lamaste-agentd`, `lamaste-serverd`.
- **`-ui`** for React component libraries — universal term. `lamaste-agent-ui`, `lamaste-server-ui`.
- **`create-*`** for all npx one-shot tools — the one npm convention everyone knows. `create-lamaste`, `create-lamaste-agent`, `create-lamaste-desktop`, `create-lamaste-admin`, `create-lamaste-e2e`.
- **Subject-first** word order: `lamaste-agent-ui` (agent's UI), not `lamaste-ui-agent`.
- **Domain grouping**: packages sort alphabetically by domain (`agent`, `server`, `cloud`).

## Architecture

### Branding

Lamalibre is the umbrella ecosystem; Lamaste is one product within it (others — `shell`, `sync`, `herd`, `gate`, etc. — share the same surfaces). Identifiers split along that line: **ecosystem-level** surfaces touched by anything outside lamaste use `lamalibre.*`, and **product-level** surfaces specific to lamaste nest under `lamalibre.lamaste.*`. The mechanical test for any new identifier (bundle id, unit name, FS path, env var, deep link, DO tag): "Will any product outside lamaste touch this surface?" Yes → ecosystem; No → product. npm package names (`@lamalibre/lamaste-*`), `RESERVED_API_PREFIXES`, capability names, the `lamaste_2fa_session` cookie, HTTP headers, Tauri event names, and registry filenames stay product-scoped — they are namespaced by the package they live in, not by reverse-DNS.

The single source of truth is `packages/core/lib/src/branding.ts` (TS) and `packages/clients/desktop/src-tauri/src/branding.rs` (Rust) — `ecosystemBundleId()` / `productBundleId()` / `ecosystemUnit()` / `productUnit()` helpers plus `userEcosystemRoot()` / `userProductRoot()` / `etcEcosystemRoot()` / `etcProductRoot()`. Never hardcode a bundle id, unit name, or path elsewhere.

| Category | Ecosystem | Product |
|---|---|---|
| Keychain (macOS) | `com.lamalibre.cloud`, `com.lamalibre.storage` | `com.lamalibre.lamaste.server`, `com.lamalibre.lamaste.admin` |
| launchd | `com.lamalibre.local-plugin-host` | `com.lamalibre.lamaste.agentd`, `com.lamalibre.lamaste.panel-<label>` |
| systemd | `lamalibre-local-plugin-host` | `lamalibre-lamaste-serverd`, `lamalibre-lamaste-gatekeeper` |
| FS path | `~/.lamalibre/local/`, `/etc/lamalibre/` | `~/.lamalibre/lamaste/`, `/etc/lamalibre/lamaste/` |
| Env var | `LAMALIBRE_CLOUD_TOKEN`, `LAMALIBRE_FERIA_BIN` | `LAMALIBRE_LAMASTE_CONFIG`, `LAMALIBRE_LAMASTE_DATA_DIR` |
| Deep link | `lamalibre://callback?product=lamaste#…` | (no product-only scheme) |
| DO tag | `lamalibre:managed` | `product:lamaste` (both required) |

### Core Library Pattern

`@lamalibre/lamaste` is a single package with subpath exports providing domain-specific entry points:

```json
{
  "name": "@lamalibre/lamaste",
  "exports": {
    ".":        "./dist/index.js",
    "./agent":  "./dist/agent/index.js",
    "./server": "./dist/server/index.js"
  }
}
```

```typescript
import { RESERVED_API_PREFIXES, ManifestSchema } from '@lamalibre/lamaste';
import { loadRegistry, loadAgent, isAgentLoaded } from '@lamalibre/lamaste/agent';
import { createTunnel, rotateCert } from '@lamalibre/lamaste/server';
```

**Root (`@lamalibre/lamaste`):**
- Types: `AdminClient`, `AgentClient` TypeScript interfaces, plugin manifest types, capability types
- Constants: Reserved API prefixes, curated plugin list, capability names
- Schemas: Plugin manifest Zod schema (single source of truth)
- Plugin Host: Fastify plugin for plugin route mounting, bundle serving, disabled handler (unified from three former routers)
- File Helpers: Atomic write (temp → fsync → rename), promise-chain mutex

**Agent subpath (`@lamalibre/lamaste/agent`):**
- Platform: Path helpers, platform detection
- Registry: Agent registry CRUD, label validation, legacy migration
- Config: Agent config I/O
- Service: Start/stop/status for launchctl and systemd
- Plugins: Agent and local plugin lifecycle (unified — uses shared schema/lifecycle from root)
- Local Host Service: Service config generation and lifecycle
- Service Discovery: Port scanning, process detection, Docker discovery
- Server Registry: `servers.json` and `storage-servers.json` CRUD
- Mode: Server mode and admin cert file operations

**Server subpath (`@lamalibre/lamaste/server`):**
- Plugins: Server-side plugin lifecycle (uses shared schema from root)
- Tunnels: Tunnel creation workflow with rollback
- Sites: Site creation with managed/custom domain branching
- mTLS: Certificate management and rotation
- Access Control: Authelia access control sync
- Provisioning: Provisioning orchestrator

**Isolation enforced via TypeScript project references:**
- `src/agent/` cannot import from `src/server/` and vice versa
- `src/index.ts` (shared core) cannot import from either domain
- Build fails on cross-domain imports — same guarantee as separate packages

### Agent Side vs Server Side Symmetry

| Layer | Agent side | Server side |
|---|---|---|
| **Domain logic** | `@lamalibre/lamaste/agent` | `@lamalibre/lamaste/server` |
| **Operational CLI** | `lamaste-agent` | `lamaste-server` (new) |
| **Long-running daemon** | `lamaste-agentd` on :9393 (extracted) | `lamaste-serverd` on :3100 (renamed) |
| **UI components** | `lamaste-agent-ui` (renamed) | `lamaste-server-ui` (merged) |
| **Provisioner** | `create-lamaste-agent` (renamed) | `create-lamaste` |
| **Desktop consumes via** | REST to :9393 / CLI subprocess | REST to :3100 / `curl_panel` |

### Rules

1. **`lamaste`** (core lib) owns shared contracts: types, constants, schemas, plugin host Fastify plugin, atomic file write helpers. Domain logic in subpath exports (`/agent`, `/server`).
2. **`lamaste/agent`** owns agent-side business logic: registry CRUD, config I/O, platform paths, service lifecycle, local plugin management, service discovery. Touches `~/.lamalibre/lamaste/` only.
3. **`lamaste/server`** owns server-side business logic: server plugin lifecycle, mTLS, tunnel/site workflows, access control. Touches `/etc/lamalibre/lamaste/` only.
4. **Operational CLIs** are thin layers: import their domain subpath, add CLI UX (prompts, progress bars), expose lib operations as subcommands with `--json`. `lamaste-agent` for agent ops, `lamaste-server` for server ops. No Fastify, no HTTP serving.
5. **Daemons** are thin HTTP layers: `lamaste-serverd` imports `lamaste/server`, handles HTTP/WebSocket only. `lamaste-agentd` imports `lamaste/agent`, serves REST API on :9393 + web SPA. No CLI argument parsing.
6. **UI packages** are host-agnostic React component libraries: `lamaste-agent-ui` and `lamaste-server-ui`. Each consumer provides its own client implementation (desktop via Tauri invoke, browser via fetch). Each package includes a browser SPA build target.
7. **Desktop** is a container, not an implementation. It has Rust for credentials, tray, deep links, and process management. All UI comes from `-ui` packages. All logic comes from daemons via REST or CLIs via subprocess. Never reimplements lib logic in Rust.
8. **Credentials stay in Rust.** macOS Keychain (`security-framework`) and Linux libsecret (`secret-tool`) are legitimately desktop-only. lib/cli accept credentials as env vars or stdin.
9. **Service lifecycle** (`launchctl`/`systemctl`) lives in `lamaste/agent`. Desktop calls it through the CLI.
10. **`create-*` packages** are npx one-shot tools. They import from `lamaste` for business logic but add interactive UX (Listr2, prompts, NDJSON progress). Thin wrappers, not logic owners.

### Plugin Model

Every plugin follows a consistent **monorepo** structure with up to 7 packages:

1. **Server plugin** — Fastify 5 (integrates into Lamaste or runs standalone)
2. **Agent daemon** — Local service manager (launchd on macOS, systemd on Linux)
3. **CLI tool** — Interactive CLI (@clack/prompts, picocolors)
4. **Desktop app** — Tauri v2 + Svelte 5 + Tailwind
5. **Shared library** — Types and utilities consumed across packages
6. **Installer** — `npx create-{plugin}` (esbuild bundled, zero runtime deps)
7. **E2E test MCP** — Test infrastructure

### Dual-Mode Pattern

All plugins run in two modes:
- **Standalone:** Own port, own CA, own auth — no Lamaste required
- **Plugin:** Integrated via mTLS, shared registry, panel pages within Lamaste

### Shared Libraries

- `@lamalibre/lamaste` — Core library with types, constants, schemas, plugin host, file helpers
- `@lamalibre/lamaste-tickets` — Agent-to-agent authorization SDK (used by 5+ packages)

### API Layer Pattern

- Routes handle HTTP only (validation, error responses)
- Business logic in `@lamalibre/lamaste` core library (agent and server subpaths)
- Zod for request/response validation at route level
- Fastify logger for all logging (never `console.log` in library code)

### State Management

- JSON files with atomic writes (temp → fsync → rename) — no external databases
- SQLite in Lamaste and Uyarlama only
- In-memory registry with periodic persistence (Herd)
- Event-driven updates via WebSocket pub/sub and SSE streaming

## Development

```bash
npm install                    # install all workspace dependencies
npm run build                  # build all packages
npm run dev:server             # lamaste-serverd backend (needs ./dev/panel.json)
npm run dev:client             # lamaste-server-ui frontend (proxies /api to :3100)
```

Build before considering a task complete. Avoid commands that hang (e.g., `npm start`).

## Feria Dev Registry

Feria has been extracted out of the lamaste monorepo and now lives in its own repository
at <https://github.com/lamalibre/feria>. In a typical local development checkout it sits
as a sibling of `lamaste/` (i.e. `~/lama/repositories/lamalibre/feria/`). The desktop app's
feria-discovery logic walks up from cwd looking for that sibling layout, and also accepts
a globally installed `@lamalibre/feria-server` binary or the `LAMALIBRE_FERIA_BIN` escape
hatch.

The behaviour and contract are unchanged — Feria is still the local npm registry that
stores `@lamalibre/*` packages on `127.0.0.1:4873`, proxies everything else to npmjs.org,
and auto-manages `~/.npmrc` on start/stop. The only differences are the install path and
the CLI rename: the operational CLI (formerly `feria`) is now published as
`@lamalibre/feria-server` and exposes a `feria-server` binary; the runtime/server library
is `@lamalibre/feria-serverd`. The `npx @lamalibre/create-feria` provisioner is the
zero-prompt installer.

**Storage layout (unchanged):**
```
~/.feria/
├── packages/@lamalibre/*/     # npm package tarballs + metadata
└── releases/<tag>/            # release artifacts (desktop binaries)
    ├── release.json
    └── *.dmg / *.deb / *.AppImage
```

**Commands (run from the sibling feria repo, or via the global `feria-server` binary):**
```bash
feria-server                                       # start registry on :4873, configure .npmrc
feria-server release -w <workflow.yml> version=…   # run GH Actions workflow locally → build + store artifacts
feria-server upload --tag <tag> --dir <path>       # upload pre-built binaries (quick testing)
feria-server setup / teardown / status             # manage .npmrc without starting server
```

**Workflow runner:** `feria-server release` parses GitHub Actions YAML, resolves `${{ }}` expressions, filters matrix to the current platform, executes build steps, and stores resulting artifacts via `softprops/action-gh-release` → Feria release API. Coordination jobs (no matrix) skip `run` steps; build jobs (with matrix) run everything.

**Republishing:** Feria allows overwriting existing versions (`npm publish --force`). No need to bump on every iteration during development.

**Dev → Test → Ship lifecycle:**

| Phase | Feria state | Registry | What happens |
|-------|-------------|----------|-------------|
| **Develop** | Running | `@lamalibre:registry=http://localhost:4873` | Code changes, builds, local testing |
| **Bump + Publish** | Running | Feria | `/bump-versions` bumps patch, publishes all affected packages to Feria |
| **E2E Tests** | Running | Feria | VMs install from Feria via `npx @lamalibre/create-lamaste`, `npm install @lamalibre/lamaste-agent`, etc. |
| **Ship** | Stopped | `@lamalibre:registry` removed | `feria-server teardown` restores .npmrc, then `npm publish` goes to npmjs.org |

**Key points:**
- Feria MUST be running before E2E tests — VMs resolve `@lamalibre/*` packages from it
- `feria-server release` builds desktop binaries via the workflow runner and stores them for `create-lamaste-desktop`
- `feria-server teardown` is required before shipping to npm — otherwise `npm publish` would go to Feria instead of npmjs.org
- After shipping, `feria-server setup` or restarting Feria re-enables local routing

## Tech Stack

| Layer          | Technology                                  |
| -------------- | ------------------------------------------- |
| Core library   | TypeScript, Zod, subpath exports            |
| Installer      | Node.js ESM, Listr2, execa                  |
| Server daemon  | Fastify 5, Zod validation, WebSocket        |
| Server UI      | React 18, Vite, Tailwind, react-query       |
| Tunnel server  | Chisel (Go binary, WebSocket-over-HTTPS)    |
| Auth           | Authelia (TOTP 2FA, bcrypt)                 |
| Reverse proxy  | nginx (TLS termination, mTLS, forward auth) |
| TLS            | Let's Encrypt / certbot                     |
| Panel auth     | mTLS client certificates                    |
| Ticket SDK     | TypeScript, undici (mTLS HTTP client)        |
| Cloud SDK      | TypeScript, undici (DO REST API + S3-compatible storage API, provider abstraction) |
| State          | JSON files + YAML (no database)             |
| Target OS      | Ubuntu 24.04 LTS                            |

## Coding Conventions

**JavaScript / Node.js:**

- ES Modules everywhere (`import`, not `require`)
- `execa` (or `child_process.execFile` in minimal-dependency packages) for shell commands with array arguments — never string interpolation
- Zod schemas for all API input validation at route level
- Routes handle HTTP only — business logic in `@lamalibre/lamaste` core library
- Fastify logger, never `console.log` in library code

**React / Frontend:**

- Functional components with hooks
- `@tanstack/react-query` for data fetching — no `useEffect + fetch`
- Tailwind utility classes only — no CSS files
- Dark terminal aesthetic: `zinc-950` bg, `zinc-900` cards, `cyan-400` accents
- Icons from `lucide-react`

**UI Packages (lamaste-server-ui, lamaste-agent-ui):**

- Host-agnostic React component libraries — pages use context hooks (`useAdminClient()`, `useAgentClient()`) instead of direct API/Tauri calls
- Each consumer provides its own client implementation: desktop app via Tauri `invoke()`, web panel via `apiFetch()`
- `AdminClient` and `AgentClient` are TypeScript interfaces defined in `@lamalibre/lamaste` core library — web and desktop clients must implement the full interface (enforced at build time)
- `AgentClientContext` interface: `getStatus`, `startAgent`, `stopAgent`, `restartAgent`, `updateAgent`, `getTunnels`, `createTunnel`, `deleteTunnel`, `toggleTunnel`, `scanServices`, `addCustomService`, `removeCustomService`, `getLogs`, `getConfig`, `getPanelUrl`, `rotateCertificate`, `downloadCertificate`, `getPanelExposeStatus`, `togglePanelExpose`, `uninstallAgent`, `getAgentPlugins`, `installAgentPlugin`, `enableAgentPlugin`, `disableAgentPlugin`, `uninstallAgentPlugin`, `updateAgentPlugin`, `fetchAgentPluginBundle`, `openExternal`
- Three client implementations: desktop via Tauri `invoke()` (`createDesktopAgentClient(label)`), web via `apiFetch()` (`createWebAgentClient()`), agent REST API in `lamaste-agentd`
- Web SPA build: `npm run build:web` in lamaste-agent-ui, output consumed by `lamaste-agentd` via build script. No committed artifacts
- Pages exported with `Agent` prefix to avoid collision with server-ui: `AgentDashboardPage`, `AgentTunnelsPage`, `AgentServicesPage`, `AgentLogsPage`, `AgentSettingsPage`, `AgentPluginsPage`, `AgentPluginPanel`
- `AgentPluginPanel` accepts `onPagesDiscovered` callback for sidebar injection — parent receives plugin `pages` metadata (array of `{ id, label, icon }`) for rendering plugin-specific navigation
- Plugin microfrontend theme uses oklch color values via `HOST_THEME` constant (surface, card, cardHover, border, accent, accentDim, textPrimary, textSecondary, success, warning, error)
- Unified PluginLoader component shared between `lamaste-server-ui` and `lamaste-agent-ui` — implements `window.__lamalibrePlugins[name]` mount/unmount protocol with theme/fetch as props

**Rust / Tauri (Desktop):**

- Desktop is a container, not an implementation — delegates to daemons via REST and CLIs via subprocess
- `agents.rs` — calls REST API on `lamaste-agentd` :9393 for agent registry CRUD, service start/stop/restart, plugin management
- `local_plugins.rs` — calls REST API on `lamaste-agentd` for local plugin operations
- `services.rs` — calls REST API on `lamaste-agentd` for service discovery and registry
- `mode.rs` — calls `lamaste-agent` CLI subprocess with `--json` for server mode and admin cert file operations
- `cloud.rs` — calls `lamaste-agent` CLI subprocess with `--json` for server/storage registry operations; bridges React UI to `@lamalibre/lamaste-cloud` Node.js CLI for compute (droplets) and storage (Spaces buckets). Storage commands: `store_storage_credentials`, `get_storage_credentials`, `delete_storage_credentials`, `validate_storage_credentials`, `get_spaces_regions`, `provision_storage_server`, `get_storage_servers`, `remove_storage_server`, `destroy_storage_server`. Storage-to-panel commands: `push_storage_to_panel`, `bind_plugin_storage`, `setup_plugin_storage`. Panel update commands: `check_panel_update`, `update_panel_server` (streams NDJSON as `panel-update-progress` Tauri events)
- `api.rs` — shared HTTP helpers, all server panel API calls go through `curl_panel`
- `admin_commands.rs` — REST API delegation to `lamaste-serverd` (already correct pattern)
- `credentials.rs` — OS credential storage, macOS `security-framework` crate (direct Keychain API), Linux `secret-tool` (libsecret). Four services: `com.lamalibre.cloud` (API tokens), `com.lamalibre.lamaste.server` (P12 passwords), `com.lamalibre.lamaste.admin` (admin P12 passwords), `com.lamalibre.storage` (Spaces access key + secret key as JSON)
- `local_install.rs` — spawns `create-lamaste --json` via `pkexec`, streams NDJSON progress as Tauri events, auto-imports P12 certificates
- `upgrade_admin.rs` — `upgrade_admin_to_hardware_bound` Tauri command shells out to `create-lamaste-admin --json` with NDJSON progress parsing. Stores new P12 password in credential store, updates `servers.json` with new P12 path
- `user_access.rs` — deep link handling (`lamalibre://` URL scheme)
- `tray.rs` — system tray icon state management
- `commands.rs` removed — legacy single-agent path eliminated, multi-agent is the only path
- `tokio::task::spawn_blocking` for subprocess calls and file I/O — never block the Tauri event loop
- Atomic file writes (temp → fsync → rename) for registry and config

**Desktop: Unified Single-Binary App:**

```
packages/clients/desktop/
    ├── src/                        React shell (App.jsx) imports both UI packages
    │   ├── pages/                  Agents.jsx, Servers.jsx, LocalPlugins.jsx, UserLogin.jsx, UserPlugins.jsx
    │   ├── lib/                    desktop-admin-client.js, desktop-agent-client.js, desktop-user-access-client.js
    │   └── components/             shared UI components
    └── src-tauri/                  one Rust crate, one binary, one tauri.conf.json
        identifier: com.lamalibre.lamaste.desktop  productName: Lamaste
```

One package, **one binary** (`lamaste-desktop`). The sidebar's Agents / Servers / Local / User
sections give users explicit, in-app focus on the side they want to manage at any given moment.
Each section uses its own React context (`AdminClientProvider`, `AgentClientProvider`) so the
panes are cleanly isolated despite sharing one process.

**Why not multiple binaries (agent-only / server-only).** This was considered and rejected
during the 2.0.0 refactor. The unified app is intentional:

- **The split brings no real bundle savings.** Tauri bundles are 10–15 MB end-to-end; the
  Rust modules unique to each side total well under 200 lines, and the React UI is delivered
  via webview, not embedded in the binary.
- **The Rust modules don't separate cleanly.** `agents.rs`, `cloud.rs`, `mode.rs`, and
  `admin_commands.rs` all share `api.rs`, `config.rs`, `credentials.rs`, and
  `daemon_lifecycle.rs`. A real cargo-feature split would require significant refactoring
  with negligible payoff.
- **Operational cost is significant.** Three targets means 3x the CI build matrix, 3x
  signing certificates, 3x notarization runs, 3x updater channels, and three separate
  bundle identifiers in the App Store / package repos. For a two-cofounder team this is
  meaningful drag.
- **UX is already focused via the sidebar.** A user managing only agents simply ignores
  the Servers section (and vice versa); there is no wasted screen real-estate when no
  agents/servers are configured because the sections collapse to their headers.

If a future need arises (e.g. a true headless server-admin variant for CI/CD agents), the
right answer is a separate package that depends on `@lamalibre/lamaste-server-ui` rather
than fragmenting this binary.

**Agent Web Panel:**

- Agents can expose their management panel at `agent-<label>.<domain>` via a tunnelled subdomain
- Requires `panel:expose` capability (admin grants per-agent)
- Separate Fastify HTTP server in `lamaste-agentd` serves SPA + REST API (`/api/*`)
- Runs as independent system service: `com.lamalibre.lamaste.panel-<label>` (macOS) / `lamalibre-lamaste-panel-<label>` (Linux)
- Default port 9393, configurable via `--port`
- mTLS nginx vhost (same CA as main panel) — agent panel server validates cert CN is `agent:<label>` (owning agent) or `admin`
- Tunnel type `panel` in `tunnels.json` — auto-created by `POST /api/tunnels/expose-panel`, removed by `DELETE /api/tunnels/retract-panel`
- `agent-` subdomain prefix reserved for panel tunnels — regular tunnels cannot use it
- CLI: `lamaste-agent panel --enable [--port 9393]`, `--disable`, `--status [--json]`, `panel reset-pin` (re-capture panel TLS server cert pin after rotation)

**Agent CLI (`lamaste-agent`) — CLI only, no Fastify:**

- Thin orchestrator: imports from `@lamalibre/lamaste/agent`, adds CLI UX
- `--json` global flag — NDJSON output for subprocess consumers (desktop, scripts)
- Subcommands: `setup`, `status`, `logs`, `update`, `uninstall`, `list`, `switch`, `chisel`, `sites`, `deploy`, `plugin install/uninstall/status`, `panel --enable/--disable/--status`. Lifecycle (`start`/`stop`/`restart`) is handled via the REST daemon, not the CLI.
- NDJSON protocol: `{event:"step",step:"<key>",status:"running|complete|skipped|failed"}`, `{event:"error",message:"...",recoverable:false}`, `{event:"complete",agent:{label,panelUrl,authMethod,p12Path,p12Password,domain,chiselVersion}}`
- No Fastify dependency — daemon code lives in `lamaste-agentd`

**Agent Daemon (`lamaste-agentd`) — daemon only, no CLI parsing:**

- Fastify REST API on :9393, imports from `@lamalibre/lamaste/agent`
- Uses unified plugin host Fastify plugin from `@lamalibre/lamaste`
- Serves web SPA built from `lamaste-agent-ui`
- REST endpoints for operations desktop consumes: `GET /api/agents`, `POST /api/agents/:label/start|stop|restart`, `PATCH /api/agents/current`, `DELETE /api/agents/:label`, `GET /api/local-plugins`, `GET /api/services/scan`, etc.
- Plugin CRUD endpoints: `GET /plugins`, `POST /plugins/install`, `POST /plugins/:name/enable`, `POST /plugins/:name/disable`, `DELETE /plugins/:name`, `POST /plugins/:name/update`, `GET /plugins/:name/bundle`

**Server CLI (`lamaste-server`) — NEW, CLI only, no Fastify:**

- Thin orchestrator: imports from `@lamalibre/lamaste/server`, adds CLI UX
- `--json` flag for NDJSON output on all commands
- Subcommands: `status`, `logs`, `restart`, `plugins list/install/enable/disable/uninstall`, `tunnels list/create/delete`, `sites list/create/delete`, `certs status/renew/list`, `chisel`, `reset-admin`, `uninstall`
- Absorbs standalone `lamaste-reset-admin` script
- Installed globally on the server during provisioning (`create-lamaste` adds it)

**Server Daemon (`lamaste-serverd`) — renamed from serverd:**

- Fastify REST API on :3100, imports from `@lamalibre/lamaste/server`
- Uses unified plugin host Fastify plugin from `@lamalibre/lamaste`
- Routes are thin HTTP handlers — business logic in core library
- Serves web SPA built from `lamaste-server-ui`
- No CLI argument parsing

**TypeScript (Ticket SDK):**

- Strict mode, ES2022 target, ESM output (`verbatimModuleSyntax`, `isolatedModules`)
- undici for HTTP — use undici's `fetch` export (not global) for type-safe `dispatcher` support
- Response shape validation — `assertObject` checks before type assertions
- No runtime dependencies beyond `undici`

**TypeScript (Identity SDK):**

- Same conventions as lamaste-tickets (strict, ESM, verbatimModuleSyntax, undici)
- Two export paths: `@lamalibre/lamaste-identity` (types, parser, client) and `@lamalibre/lamaste-identity/fastify` (Fastify plugin)
- Parser is pure (no HTTP, no dependencies) — `parseIdentity()` returns three-state result
- Client uses mTLS dispatcher factory (same pattern as tickets)

**Cloud SDK (lamaste-cloud):**

- TypeScript, same conventions as lamaste-tickets (strict, ESM, verbatimModuleSyntax)
- `undici` for HTTP — direct REST API calls to cloud providers, no heavy SDKs
- `child_process.execFile` for SSH/SCP/openssl commands (array args only)
- Two provider interfaces: `CloudProvider` (compute — droplets, SSH keys, DNS) and `StorageProvider` (object storage — buckets). Each cloud provider implements one or both
- Compute token scope validation: reject over-scoped tokens, require minimum necessary permissions. `domain:*` scopes are safe extras (opt-in DNS management)
- DNS management (opt-in): if token has `domain:read`, wizard lists DO-managed domains; after droplet creation, `setup_dns` provisioning step creates A + wildcard A records. Existing records with different IPs are warned, not overwritten. DNS records are NOT auto-cleaned on server destroy
- Storage provisioning: `StorageProvider` creates S3-compatible buckets (currently DigitalOcean Spaces). Uses AWS Signature V4 signing via `node:crypto` (no external S3 SDK). Hardcoded Spaces region list (DO has no API to list them). Storage servers are independent resources with their own lifecycle — not tied to compute servers
- NDJSON progress protocol on stdout for Rust/Tauri integration (used by compute provisioner, storage provisioner, and updater)
- SSH via `ssh-keygen`/`ssh`/`scp` commands — temporary ed25519 keys, secure-deleted after use. SSH TOFU accepted risk: first connection uses `accept-new`, pinned in per-session `known_hosts` for subsequent commands; DigitalOcean does not expose host fingerprints via API
- Credential storage: macOS Keychain (`security-framework` crate, no CLI) / Linux libsecret (`secret-tool` with stdin) — never plaintext, never in process args. Four services: `com.lamalibre.cloud` (API tokens), `com.lamalibre.lamaste.server` (P12 passwords, keyed by server UUID), `com.lamalibre.lamaste.admin` (admin P12 passwords), `com.lamalibre.storage` (Spaces access key + secret key as JSON)
- Compute token passed via `LAMALIBRE_CLOUD_TOKEN` env var (never CLI args). Storage credentials via `LAMALIBRE_SPACES_ACCESS_KEY` and `LAMALIBRE_SPACES_SECRET_KEY` env vars
- Server registry: `~/.lamalibre/lamaste/servers.json` with atomic writes (tmp → 0600 → fsync → rename)
- Storage server registry: `~/.lamalibre/lamaste/storage-servers.json` with same atomic write pattern. Stores bucket name, region, endpoint — no credentials (those stay in OS keychain)
- Droplet safety: only operate on droplets tagged `lamalibre:managed` AND `product:lamaste` (both required)
- Cleanup stack (shared `cleanup.ts`): each resource creation registers a rollback; on failure, cleanup runs in reverse. `destroy-storage` deletes both the bucket and the registry entry — bucket must be empty (S3 returns 409 BucketNotEmpty otherwise)
- Provisioning locks: `~/.lamalibre/lamaste/.provisioning.lock` (compute and update — shared) and `~/.lamalibre/lamaste/.storage-provisioning.lock` (storage) prevent concurrent operations
- Updater (`updater.ts`): handles server daemon updates via SSH. CLI command: `update --id <serverId> --version <version>`. SSHs into the server, runs `npx @lamalibre/create-lamaste@<version>` in redeploy mode, verifies health after restart. Uses the same ephemeral SSH key pattern and provisioning lock as the compute provisioner. Update scripts deployed to `/etc/lamalibre/lamaste/update-*.sh`
- Discovery (`discover.ts`): finds existing Lamaste-managed droplets (tagged `lamalibre:managed` + `product:lamaste`), resolves DNS domains pointing to each droplet's IP, determines panel URL. CLI command: `discover`. Desktop Tauri commands in `cloud.rs`: `discover_servers`, `register_discovered_server`
- SSH Recovery (`recover.ts`): recovers admin access when P12 certificate is lost. Generates ephemeral ed25519 SSH key pair (DO label `lamalibre-lamaste-update-<hex>`), user adds public key via DO console, SSHs in to run `sudo lamaste-server reset-admin`, downloads new P12. CLI commands: `recover-generate-key`, `recover-test-ssh`, `recover-admin`, `recover-cleanup`. Recovery directory is path-validated (canonicalize + prefix check) to prevent traversal. Desktop Tauri commands in `cloud.rs`: `generate_recovery_ssh_key`, `test_recovery_ssh`, `recover_admin_via_ssh`, `cleanup_recovery_ssh_key`

**Installer (`create-lamaste`):**

- Zero prompts — all configuration happens through browser onboarding UI
- Listr2 subtask lists with idempotent skip guards
- `--json` flag replaces Listr2 rendering with NDJSON progress lines on stdout (used by the desktop app's local install feature via `pkexec`)
- Imports from `@lamalibre/lamaste` for business logic — thin wrapper, not logic owner

## Critical Constraints

**RAM budget (512MB droplet):** Total stack ~245MB with ~265MB headroom + 1GB swap. Authelia MUST use bcrypt, NOT argon2id (argon2id uses ~93MB per hash → OOM).

**Security rules:**

- Panel vhost: `ssl_verify_client optional` at server level, `if ($ssl_client_verify != SUCCESS) { return 496; }` at protected locations — public endpoints (`/api/enroll`, `/api/invite`, `/api/user-access/exchange`, `/api/user-access/plugins`, `/api/user-access/enroll`) skip the check
- All services bind `127.0.0.1` — nginx is the sole public-facing service
- `https://<ip>:3100` always works (mTLS) — fallback if domain is lost. Exception: when panel 2FA is enabled, the IP vhost is disabled (domain-only access)
- Secrets: `crypto.randomBytes`, never hardcoded
- Onboarding endpoints: 410 Gone after completion
- Management endpoints: 503 before onboarding completes
- Agent TLS: panel uses a self-signed server cert separate from the mTLS CA — agent uses `-k` / `rejectUnauthorized: false` until server certificate distribution is implemented. The mTLS client cert still authenticates the agent to the panel.
- P12 password protection: curl uses a temporary config file (`-K`, O_EXCL + 0600, cleaned up in try/finally) and openssl uses `LAMALIBRE_LAMASTE_P12_PASS` environment variable — password never appears in process listings. Stale config files cleaned up at module load.
- Agent directory `~/.lamalibre/lamaste/` created with mode 0700. PEM private keys cleaned up after CA extraction during setup.
- Hardware-bound certificates: agent private keys can be imported into macOS Keychain as non-extractable (`security import -x`). Temporary key files exist on disk for seconds only during enrollment, then are securely deleted (overwrite + unlink).
- Enrollment tokens: one-time use, 10-minute expiry, stored at `/etc/lamalibre/lamaste/pki/enrollment-tokens.json`. Creating a token for a label that already has an active (unused, unexpired) token silently replaces it (retried installations do not fail). Public `/api/enroll` endpoint accepts token + CSR (no mTLS required — the token is the sole auth gate).
- Dual auth: agent config `authMethod` is `'p12'` (default, backwards compatible) or `'keychain'`. Panel API functions accept both calling conventions.
- Admin auth mode: panel.json `adminAuthMode` is `'p12'` (default) or `'hardware-bound'`. When hardware-bound, `GET /certs/mtls/download` and `POST /certs/mtls/rotate` return 410 Gone. Recovery: `sudo lamaste-server reset-admin` on the server.
- Admin upgrade: `POST /certs/admin/upgrade-to-hardware-bound` accepts CSR, signs with CA, revokes old admin cert, sets `adminAuthMode: 'hardware-bound'`. One-way operation — reversible only via DO root console.
- Panel 2FA: opt-in TOTP two-factor authentication for admin panel (on top of mTLS). Config fields: `panel2fa: { enabled, secret, setupComplete }` and `sessionSecret` in `panel.json`. Agents bypass 2FA entirely (only admin cert holders need it). Enabling 2FA disables IP:3100 vhost (domain required). Session: HMAC-SHA256 signed cookie (`lamaste_2fa_session`), 12h absolute expiry, 2h inactivity timeout, `HttpOnly`/`Secure`/`SameSite=Strict`. TOTP uses RFC 6238 with SHA-1, 30s period, +/-1 step drift window, replay protection. Rate limiting: 5 attempts / 2 min per IP, 5-min ban. Endpoints: `GET /settings/2fa` (status, exempt), `POST /settings/2fa/setup`, `POST /settings/2fa/confirm`, `POST /settings/2fa/verify` (exempt), `POST /settings/2fa/disable`. Recovery: `sudo lamaste-server reset-admin` clears 2FA, re-enables IP vhost, resets admin auth to P12. Middleware: `twofa-session.js` (Fastify plugin, runs after mTLS, before roleGuard). Dependency: `@fastify/cookie`.

**User plugin access (Authelia login to desktop):**

- Non-admin Authelia users can log into the desktop app and install plugins they've been granted access to by an admin
- Admin grants per-user, per-plugin access rights via `POST /api/user-access/grants` (admin-only, mTLS). State file: `/etc/lamalibre/lamaste/user-plugin-access.json` with atomic writes + promise-chain mutex
- Grant model: `{ grantId, username, pluginName, target, used, createdAt, usedAt }`. `target` is `'local'` (default, desktop install) or `'agent:<label>'` (browser access to agent-hosted plugin)
- Local grants: OAuth-like auth flow → desktop opens browser to `https://auth.<domain>/api/user-access/authorize` (Authelia-protected), panel generates 60-second OTP, redirects to `lamalibre://callback?product=lamaste#token=<otp>&domain=<domain>&nonce=<nonce>` deep link. Desktop exchanges OTP for HMAC-SHA256 signed session token
- Agent-side grants: auto-consumed on creation (`used: true`), no enrollment needed. User accesses plugin via browser at plugin tunnel URL (e.g., `https://herd.example.com`). Authelia access control rules gate per-user access. Revocable at any time (unlike consumed local grants)
- Desktop captures deep link via `tauri-plugin-deep-link`, exchanges OTP for session token via `POST /api/user-access/exchange` (public, rate-limited). Session: 12h expiry, 2h inactivity, carries `username` and `type: 'user-access'` (prevents cross-use with 2FA sessions)
- User session passed as `Authorization: Bearer <token>` header (not cookie — desktop uses Rust reqwest, not browser)
- User-session-protected endpoints: `GET /api/user-access/plugins` (list granted plugins — enriches agent-side grants with `tunnelUrl`, `agentLabel`, `tunnelEnabled`), `POST /api/user-access/enroll` (consume grant, generate enrollment token — rejects agent-side grants with 400). Middleware: `user-access-session.js` (Fastify plugin, reads Bearer token, validates signature/expiry/inactivity)
- Admin endpoints: `GET /api/user-access/grants`, `POST /api/user-access/grants` (`{ username, pluginName, target? }`), `DELETE /api/user-access/grants/:grantId` (revoke — agent-side grants always revocable, local grants only if unused)
- Grant consumption is atomic (mutex-serialized) to prevent double-enrollment races. Consumed grants are kept for audit (not deleted)
- OTP tokens: 32-byte random hex, 60-second expiry, single-use, timing-safe comparison. Expired tokens cleaned after 5 minutes
- Desktop UI: "User" sidebar section with Login/My Plugins views. Login opens browser, callback auto-exchanges token. My Plugins shows local grants with Install/Uninstall and agent-side grants with "Open in Browser" button
- Installed local plugins reuse local plugin infrastructure (`127.0.0.1:9293` Fastify host)
- Admin UI: "User Plugin Access" tab in lamaste-server-ui. Table of grants with Target column (Local/Agent badge), Create modal with Local/Agent target selector and agent dropdown, Revoke action
- nginx: auth vhost gets `/api/user-access/authorize` with Authelia forward auth + `/internal/authelia/authz` internal location. Panel domain vhost gets public locations for `/api/user-access/exchange`, `/api/user-access/plugins`, `/api/user-access/enroll`
- Reserved API prefix: `user-access` added to `RESERVED_API_PREFIXES` in `@lamalibre/lamaste` core library

**Plugin tunnels (agent-side user access):**

- Plugin tunnel type (`type: 'plugin'`) enables Authelia-protected access to a specific agent plugin via dedicated subdomain (e.g., `herd.example.com`)
- Created via `POST /api/tunnels` with `{ type: 'plugin', pluginName, agentLabel, subdomain, port }`. Admin-only
- Uses `writeAppVhost` with `pathPrefix` option — nginx rewrites `herd.example.com/path` → `127.0.0.1:9393/herd/path`, matching the plugin mount point on the agent daemon
- Tunnel state gains fields: `pluginName` (full `@lamalibre/` package name), `agentLabel`, `pluginRoute` (derived short name, e.g., `herd` from `@lamalibre/herd-server`)
- Authelia access control: `syncAllAccessControl()` in `@lamalibre/lamaste/server` merges site rules + plugin tunnel grant rules. Called on grant create/revoke, tunnel create/delete/toggle, and site updates. Admins group always allowed on restricted subdomains
- Agent daemon auth: recognizes `Remote-User` header (set by nginx after Authelia forward auth) as a third auth path. Sets `request.certRole = 'user'` and `request.autheliaUser`. Trusts nginx/Authelia — port 9393 binds `127.0.0.1`, external traffic only arrives via nginx
- Flow: admin creates plugin tunnel → admin creates agent-side grant → `syncAllAccessControl` updates Authelia rules → user visits plugin URL → Authelia authenticates + authorizes → nginx proxies with path rewrite + Remote-User header → agent daemon serves plugin

**Certificate scoping:**

- Admin cert (`CN=admin`) — full panel access
- Agent cert (`CN=agent:<label>`) — capability-based access, stored server-side in registry
  - Registry `enrollmentMethod`: `'p12'` (traditional) or `'hardware-bound'` (Keychain-bound)
  - `tunnels:read` / `tunnels:write` — tunnel listing and management
  - `services:read` / `services:write` — service status and control
  - `system:read` — system stats
  - `sites:read` / `sites:write` — static site file browsing and deployment (site CRUD is admin-only)
  - `panel:expose` — expose agent management panel at `agent-<label>.<domain>` via mTLS-protected vhost
  - `identity:read` — parse Authelia identity headers on plugin routes
  - `identity:query` — query panel for Authelia user metadata (users, groups)
  - `allowedSites: string[]` — per-site scoping; agent sees and can deploy to only listed sites
- Plugins and ticket scopes declare additional capabilities; these are merged with base capabilities dynamically via `getValidCapabilities()` (base + plugin + ticket scope). Plugin capabilities come from manifest (flat array or nested `{ agent: [...] }` — normalized to flat array internally); ticket scope capabilities come from scope declarations registered via `/api/tickets/scopes`
- Plugin management endpoints (install, enable, push install) are admin-only at the route level
- Revoked certs tracked in `revoked.json`, rejected by middleware
- Never give admin cert to agents — generate scoped agent certs

**Plugin system:**

- Plugins are `@lamalibre/`-scoped npm packages with a `lamaste-plugin.json` manifest (`name`, optional `displayName`, `version`, `description`, `capabilities`, `packages`, `panel`, `config`, `modes`)
- Manifest `modes` field: array of `['server', 'agent', 'local']` — defaults to `['server', 'agent']` if omitted. Plugins with `'local'` can run via the desktop app's local plugin host without a server
- Manifest `panel` field: flat format (`{ label, icon, route }`) for single-page plugins, or multi-page format (`{ pages: [{ path, title, icon?, description? }], apiPrefix? }`) — sidebar renders one entry per page with section header
- Manifest `config` field: declarative schema for plugin settings (`{ key: { type, default?, description?, enum? } }`) — stored in registry, used by plugin's settings UI
- Server-side plugin code runs unsandboxed in the daemon process — `@lamalibre/` scope is the trust boundary
- All `npm install` calls use `--ignore-scripts` to block postinstall script execution
- Plugin names and ticket scope names matching core API prefixes are rejected — single source of truth in `@lamalibre/lamaste` core library: `health`, `onboarding`, `invite`, `enroll`, `tunnels`, `sites`, `system`, `services`, `logs`, `users`, `certs`, `invitations`, `plugins`, `tickets`, `settings`, `identity`, `storage`, `agents`, `user-access`, `gatekeeper`
- Plugin manifest Zod schema is a single export from `@lamalibre/lamaste` — replaces three former copies in lamaste-serverd, lamaste-agentd, and local plugin host
- Unified plugin host Fastify plugin in `@lamalibre/lamaste` — configurable per server with auth strategy and data directory. Replaces three former implementations (server router, agent plugin router, local plugin host)
- Plugin server routes are mounted with two-level Fastify encapsulation: auth guard on outer scope (plugin cannot override), plugin code on inner scope
- Plugin panel bundles served at `/{pluginName}/panel.js` with runtime `@lamalibre/` scope check
- Disabled plugins return 503 via `onRequest` hook (Fastify cannot remove routes at runtime — clean state requires restart)
- Push install: admin enables a time-windowed session per agent, then sends install/update/uninstall commands
- Push install policies: IP allow/deny lists, allowed plugins (`@lamalibre/` scope enforced via Zod), allowed actions
- Plugin state: `/etc/lamalibre/lamaste/plugins.json` (registry), `/etc/lamalibre/lamaste/plugins/` (per-plugin data directories)
- Agent plugin state: `~/.lamalibre/lamaste/agents/<label>/plugins.json`, `~/.lamalibre/lamaste/agents/<label>/plugins/` directories
- Local plugin state: `~/.lamalibre/local/plugins.json` (registry), `~/.lamalibre/local/plugins/` (per-plugin data), `~/.lamalibre/local/node_modules/` (installed packages), `~/.lamalibre/local/logs/` (host logs)
- Plugin lifecycle is a single parameterized module in `@lamalibre/lamaste` — install (npm + manifest + registry), uninstall, enable, disable, update, bundle read. Differs only in data directory, mode filter, and max plugin cap

**Local plugin host (desktop-only, serverless plugin execution):**

- Runs plugins locally without a server or agent — accessible via "Local Plugins" sidebar section in the desktop app (visible in both Agents and Servers modes)
- Single shared Fastify instance on `127.0.0.1:9293` — no mTLS, localhost trust boundary only
- Managed as a launchd (macOS) / user-level systemd (Linux) service: `com.lamalibre.local-plugin-host` / `lamalibre-local-plugin-host`
- Plugin discovery: curated plugin list in `@lamalibre/lamaste` core library — only plugins with `modes` including `'local'` are installable
- Desktop calls `lamaste-agentd` REST API for install/enable/disable/uninstall operations
- Enable/disable requires host service restart (same pattern as lamaste-serverd plugin lifecycle)
- Plugin panel bundles read from local `node_modules/` and rendered via microfrontend loader (`new Function()` eval + `mount(ctx)`)
- Path helpers in `@lamalibre/lamaste/agent` (`localDir()`, `localPluginsFile()`, etc.) and `packages/clients/desktop/src-tauri/src/config.rs` (`local_dir()`, `local_plugins_path()`, etc.)
- Registry management in `@lamalibre/lamaste/agent` — read/write/install/enable/disable/uninstall with promise-chain mutex, @lamalibre/ scope validation, manifest `modes` check
- Fastify host server uses unified plugin host from `@lamalibre/lamaste` — mounts enabled plugin routes (no auth, localhost only), serves panel.js bundles, management API on `127.0.0.1:9293`
- Service config in `@lamalibre/lamaste/agent` — generates plist/systemd for the host entry point
- Desktop frontend: `packages/clients/desktop/src/pages/LocalPlugins.jsx` (management page)
- Migration to agent: "Move to Agent" button in LocalPlugins.jsx, opens agent selector, calls `lamaste-agentd` REST API. Copies plugin data dir, installs on agent, removes local copy

**Agent plugin hosting (agent-side plugin server):**

- Agents host plugins on their daemon (port 9393) — plugins mount at `/api/plugins/<name>/...` within the mTLS-protected `/api` prefix
- Three-tier plugin journey: try locally (port 9293) → migrate to agent (port 9393) → agent serves through Lamaste tunnel
- Plugin router uses unified plugin host Fastify plugin from `@lamalibre/lamaste` — mounts enabled plugins from `~/.lamalibre/lamaste/agents/<label>/plugins.json`
- Plugin lifecycle library in `@lamalibre/lamaste/agent` — install, uninstall, enable, disable, update, bundle read; uses shared parameterized lifecycle from core library
- Validates `modes.includes('agent')` — plugins must declare agent mode support in manifest
- Panel bundles served at `/api/plugins/<name>/panel.js` with 1hr cache
- Disabled plugin catch-all returns 503 with 5-second cache
- Enable/disable triggers panel service restart via `unloadPanelService`/`loadPanelService` (launchd/systemd KeepAlive restarts process with updated registry)
- Agent Plugins page in `packages/agent/ui/src/pages/Plugins.jsx` — plugin cards with install form, enable/disable/uninstall, react-query with 10s refetch
- `AgentClientContext` extended with: `getAgentPlugins`, `installAgentPlugin`, `enableAgentPlugin`, `disableAgentPlugin`, `uninstallAgentPlugin`, `updateAgentPlugin`, `fetchAgentPluginBundle`
- Desktop client: calls `lamaste-agentd` REST API for all plugin operations
- Migration command: calls `lamaste-agentd` REST API — copies data dir, installs on agent, removes from local registry
- Systemd `ReadWritePaths` includes agent data dir (plugins need write access for runtime state)
- Capability reporting: `lamaste-agent update` reports enabled plugin capabilities to server via `POST /api/agents/plugins/report`; server merges into `getValidCapabilities()` in-memory set
- CLI: `lamaste-agent plugin install/uninstall/update/status` delegates to `@lamalibre/lamaste/agent` library

**Ticket system (agent-to-agent authorization):**

- Scopes registered via `POST /api/tickets/scopes` (admin). Client SDK: `@lamalibre/lamaste-tickets` (TypeScript, undici mTLS). Future: `lamaste-tickets.json` manifest for declarative scope registration
- Two-layer isolation (panel-enforced): cert capability check → ticket binding (source/target). Self-tickets rejected (source cannot be target). Third layer (plugin transport CA) is plugin-side, not panel-enforced
- Instance IDs stored in `/etc/lamalibre/lamaste/ticket-scopes.json`, NOT on agent certificates — admin assigns instance scopes via panel UI/API
- Tickets: single-use, 30-second expiry, `crypto.randomBytes(32)` (256-bit), HMAC-based timing-safe comparison (per-process random key, fixed-length digests via HMAC-SHA256 before `timingSafeEqual`), stored at `/etc/lamalibre/lamaste/tickets.json`
- Ticket delivery: panel inbox per agent (`GET /api/tickets/inbox`), polling
- Sessions: heartbeat every 60s re-validates authorization (source cert not revoked, capability still present, assignment still valid); stale after 10 min (no activity), cleaned up after 24 hours
- Instance liveness: heartbeat every 60s (re-validates agent capability), stale after 5 min (no heartbeat), dead after 1 hour (removed with assignments)
- Rate limiting: 10 tickets per agent per minute
- Hard caps (DoS protection): 200 instances, 1000 tickets, 500 active sessions — returns 503 when exceeded
- Transport strategies: schema accepts `tunnel`, `relay`, `direct` — actual transport negotiation is plugin-side (panel stores preference only). `transport.direct.host` validates against a deny list (private/reserved IPs, loopback, link-local, cloud metadata endpoints) to prevent SSRF
- Scope registry: `POST /api/tickets/scopes` (admin), `GET /api/tickets/scopes` (admin), `DELETE /api/tickets/scopes/:name` (admin)
- Instance registration: `POST /api/tickets/instances` (admin/agent — requires certLabel, idempotent), `DELETE /api/tickets/instances/:instanceId` (admin/agent, owner or admin), `POST /api/tickets/instances/:instanceId/heartbeat` (admin/agent — requires certLabel)
- Instance assignment: `POST /api/tickets/assignments` (admin), `DELETE /api/tickets/assignments/:agentLabel/:instanceScope` (admin), `GET /api/tickets/assignments` (admin)
- Ticket operations: `POST /api/tickets` (admin/agent, request — requires certLabel), `GET /api/tickets/inbox` (admin/agent — requires certLabel), `POST /api/tickets/validate` (admin/agent — requires certLabel), `GET /api/tickets` (admin, list), `DELETE /api/tickets/:ticketId` (admin, revoke)
- Session management: `POST /api/tickets/sessions` (admin/agent — requires certLabel; session ID is server-generated via `crypto.randomBytes(16)`), `POST /api/tickets/sessions/:sessionId/heartbeat` (admin/agent — requires certLabel), `PATCH /api/tickets/sessions/:sessionId` (admin/agent — requires certLabel), `DELETE /api/tickets/sessions/:sessionId` (admin, kill), `GET /api/tickets/sessions` (admin, list)
- Error responses use same error message for all failure conditions in security-sensitive paths (ticket validation, deregistration — no information leakage); admin-facing endpoints return descriptive errors
- Concurrency: promise-chain mutex (same pattern as enrollment tokens)
- State files: atomic writes (temp → fsync → rename)

**Identity system (Authelia user identity for plugins):**

- Applies only to requests through Authelia-protected subdomains — does not replace mTLS
- Three layers: nginx header clearing (defense against forged headers), panel middleware (validation + decoration), SDK package (`@lamalibre/lamaste-identity`)
- Capabilities: `identity:read` (parse headers), `identity:query` (query panel for user metadata)
- SDK: TypeScript, undici (mTLS HTTP client), same conventions as lamaste-tickets
- SDK exports: `parseIdentity(headers)` (three-state: AutheliaIdentity / null / IdentityParseError), `hasGroup()`, `isIdentityParseError()` type guard, `createIdentityDispatcher()` (mTLS factory), `IdentityClient` (query class), `IdentityHttpError`, Fastify plugin (`@lamalibre/lamaste-identity/fastify`)
- Panel API: `GET /api/identity/self` (admin, Authelia headers → JSON), `GET /api/identity/users` (admin/identity:query), `GET /api/identity/users/:username` (admin/identity:query), `GET /api/identity/groups` (admin/identity:query)
- Reads from Authelia's `users.yml` — no new state files
- nginx security: `proxy_set_header Remote-* ""` clears client-injected headers before `auth_request`; Authelia re-injects on success
- Identity headers trusted ONLY on Authelia-protected vhosts — stripped on mTLS and agent panel vhosts

**Gatekeeper (tunnel authorization):**

- Standalone Fastify service on `127.0.0.1:9294` — nginx `auth_request` target for tunnel authorization
- Systemd service: `lamalibre-lamaste-gatekeeper`, runs as `lamaste` user, after `authelia.service`
- Package: `@lamalibre/lamaste-gatekeeper` (TypeScript, strict ESM)
- Dual group system: Authelia groups (identity tier: admins/internal/external in `users.yml`) vs Lamaste groups (access control: custom groups in `groups.json`). Authelia groups = WHO you are; Lamaste groups = WHAT you can access
- Generic grant model: `{ principalType: 'user'|'group', principalId, resourceType, resourceId, context? }` — resource-agnostic, extensible to any resource type (tunnel, plugin, custom)
- Three tunnel access modes: `public` (no auth, direct proxy), `authenticated` (Authelia login, all users pass), `restricted` (Authelia + grant check, 403 → access-request page)
- nginx vhost writers: `writePublicVhost()`, `writeAuthenticatedVhost()`, `writeRestrictedVhost()` in `@lamalibre/lamaste/server`
- Auth check flow: nginx → `GET /authz/check` on 9294 (forwards cookie + `X-Original-URL`) → validates via Authelia verify endpoint → checks tunnel accessMode → checks grants for restricted tunnels → returns 200/401/403
- Two-layer caching: nginx `proxy_cache` zone `lamalibre_lamaste_authz` (30s for 200, 10s for 403, key: `$cookie_authelia_session$http_host`) + gatekeeper in-memory session cache (30s). Result: 1000 requests/page → 1 Authelia call (warm cache: 0)
- Access-request page: inline HTML (no redirect) served on 403 via `error_page 403 = /internal/lamalibre-lamaste/authz`. User-friendly page with admin contact info and pre-filled message templates (email, Slack, Teams, WhatsApp)
- State files in `/etc/lamalibre/lamaste/`: `groups.json` (max 200 groups), `access-grants.json` (max 1000 grants, 90-day consumed grant retention), `gatekeeper.json` (settings), `access-request-log.json` (optional denied access log). All 0o600 permissions, atomic writes
- File watching: gatekeeper watches state files via `fs.watch` — no restart needed for group/grant/tunnel changes
- Panel proxy: `lamaste-serverd` proxies `/api/gatekeeper/*` → `http://127.0.0.1:9294/api/*` (admin-only, mTLS required). Routes in `packages/server/daemon/src/routes/management/gatekeeper-proxy.js`
- CLI: `lamalibre-lamaste-gatekeeper group|grant|access` subcommands for local management
- Migration: `migrateFromLegacy()` converts `user-plugin-access.json` grants to new generic format on first startup. Legacy file renamed to `.migrated`
- Installer task: `packages/provisioners/server/src/tasks/gatekeeper.js` — deploys package, creates state files, writes nginx cache config (`/etc/nginx/snippets/lamalibre-lamaste-authz-cache.conf`), installs systemd service, health-checks on startup
- `gatekeeper` added to `RESERVED_API_PREFIXES` in `@lamalibre/lamaste` core library
- Admin panel: 5 Gatekeeper pages (Dashboard, Groups, Grants, Access Requests, Settings) in `lamaste-server-ui`, 15 gatekeeper methods in `AdminClientContext`, 16 Tauri commands in `packages/clients/desktop/src-tauri/src/admin_commands.rs`

**File operations:**

- YAML writes: atomic (temp → rename) — Authelia reads `users.yml` live. Temp files use `lamalibre-lamaste-` prefix (sudoers restricts `mv` to this prefix for `/etc/authelia/` targets)
- After `users.yml` change: `systemctl restart authelia`
- Certbot library in `@lamalibre/lamaste/server`: `renewCert(domain, { forceRenewal })` accepts an options object; `forceRenewal: true` passes `--force-renewal` to certbot. `listCerts()` uses `certbot certificates --non-interactive`
- Before nginx reload: `nginx -t` — rollback on failure
- Never delete the last Authelia user

## Environment Variables

| Variable                            | Package             | Purpose                                                  |
| ----------------------------------- | ------------------- | -------------------------------------------------------- |
| `LAMALIBRE_LAMASTE_CONFIG`         | lamaste-serverd    | Path to panel.json (default: `/etc/lamalibre/lamaste/panel.json`) |
| `NODE_ENV`                          | lamaste-serverd    | `development` skips mTLS check                           |
| `LAMALIBRE_LAMASTE_ENROLLMENT_TOKEN` | lamaste-agent    | Enrollment token for `setup --token` (avoids process listing exposure) |
| `LAMALIBRE_CLOUD_TOKEN`             | lamaste-cloud      | Cloud provider API token (never CLI args)                |
| `LAMALIBRE_SPACES_ACCESS_KEY`       | lamaste-cloud      | Spaces access key for storage commands (never CLI args)  |
| `LAMALIBRE_SPACES_SECRET_KEY`       | lamaste-cloud      | Spaces secret key for storage commands (never CLI args)  |
| `LAMALIBRE_FERIA_BIN`               | lamaste-desktop    | Override path to feria-server binary (escape hatch)      |
| `LAMALIBRE_LAMASTE_DATA_DIR`       | lamaste-gatekeeper | Data directory (default: `/etc/lamalibre/lamaste`)      |

## License

[Polyform Noncommercial 1.0.0](LICENSE.md). Commercial licensing: license@codelama.com.tr
