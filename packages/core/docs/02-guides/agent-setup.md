# Agent Setup (macOS and Linux)

> Enroll a machine as a Lamaste agent so the tunnels it carries reach your domain.

> **Prefer the Desktop App?** The [Lamaste Desktop App](desktop-app-setup.md) wraps the same agent in a GUI with service discovery and one-click tunnels. This guide covers the command-line agent, which is also the way to enroll servers, VMs and other headless machines.

## In Plain English

Your Lamaste server is a relay. An **agent** is a machine that holds the actual services and connects out to the relay over one encrypted WebSocket. Because the agent dials out, it works from behind NAT and carrier-grade NAT with no inbound firewall rule.

Every tunnel belongs to exactly one agent. That agent is the only one told about the tunnel, and the only one whose credential lets the relay open the tunnel's port. Enrolling a second machine never lets it take over the first machine's hostnames.

## What the agent runs

| Piece                | Where                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent program        | `lamaste-agent`, installed globally with npm                                                                                                            |
| Chisel client binary | `~/.lamalibre/lamaste/bin/chisel` — Chisel 1.12.0, checksum-verified (downloaded at setup)                                                              |
| Agent data directory | `~/.lamalibre/lamaste/agents/<label>/` (0700)                                                                                                           |
| Agent certificate    | `~/.lamalibre/lamaste/agents/<label>/client.p12` (0600)                                                                                                 |
| Chisel credential    | `~/.lamalibre/lamaste/agents/<label>/chisel.json` (0600)                                                                                                |
| Tunnel service       | Linux: systemd **user** unit `lamalibre-lamaste-chisel-<label>` + `chisel.env` (0600). macOS: LaunchAgent `com.lamalibre.lamaste.chisel-<label>` (0600) |
| Sync timer           | Linux: user service + timer `lamalibre-lamaste-sync-<label>`. macOS: LaunchAgent `com.lamalibre.lamaste.sync-<label>`                                   |
| Logs                 | `~/.lamalibre/lamaste/agents/<label>/logs/` (`sync.log` for the timer)                                                                                  |

Four properties of the service are deliberate:

- **TLS is verified, and the relay is fixed.** The client connects to `https://tunnel.<domain>:443`, which carries a publicly trusted Let's Encrypt certificate, and verifies it like any HTTPS client. A machine on the path cannot impersonate your relay. `<domain>` is the domain the agent enrolled with: the agent refuses a panel that reports a different domain (re-enroll to move an agent to another relay).
- **The credential is never a process argument.** On Linux it lives in the 0600 `chisel.env` referenced by `EnvironmentFile=`; on macOS in the 0600 plist's environment. `ps` shows nothing secret.
- **The Chisel release is pinned.** Agent and relay both run Chisel 1.12.0, downloaded from its fixed GitHub release URL and checked against a pinned SHA-256 before it is unpacked. A binary reporting another version is replaced by the next sync. The client reconnects with `--max-retry-interval 30s`, so it is back within half a minute of a relay restart.
- **Only loopback ports.** The agent forwards `127.0.0.1:<port>` on the relay to `127.0.0.1:<port>` on the agent, and refuses any other address even if a panel response asks for one. To expose a service that is not on the agent's own loopback, run the agent on the machine (or VM) that hosts the service.

## Prerequisites

- A Lamaste server with onboarding complete — see [Installation](installation.md)
- Node.js 20 or later and npm on the agent machine
- macOS (arm64 or x64) or Linux (arm64 or x64) with systemd
- An **enrollment token** or an **agent certificate** (`.p12` + password) from the panel

## 1. Issue a credential on the panel

**Enrollment token (recommended).** The agent generates its private key locally; the key never leaves the machine. In the panel: **Certificates → Enrollment Token**, or via the API:

```bash
curl -s --cert client.p12:password \
  -X POST -H 'Content-Type: application/json' \
  -d '{"label":"build-server","capabilities":["tunnels:read"]}' \
  https://203.0.113.42:9292/api/certs/agent/enroll | jq
```

The token is single-use and expires after 10 minutes. `tunnels:read` is enough for an agent whose tunnels an administrator creates; add `tunnels:write` only if the agent should create its own.

**P12 certificate.** Alternatively generate an agent certificate under **Certificates → Agent Certificates** and copy the `.p12` and its password to the machine over a secure channel.

> Never use the admin certificate on an agent. It has unrestricted access to the panel.

## 2. Install the agent and run setup

Install the agent **globally** first:

```bash
npm install -g @lamalibre/lamaste-agent
```

A global install is required, not a convenience. Setup installs a sync timer (see [How tunnel changes reach the agent](#how-tunnel-changes-reach-the-agent)) that runs the installed `lamaste-agent` every 30 seconds for as long as the agent exists. An `npx` copy lives in npm's cache, which npm may clear at any time — the timer would silently stop. `setup` and `update` therefore refuse to run from `npx`, and they check this **before** an enrollment token is spent. For an installation npm does not manage, set `LAMALIBRE_LAMASTE_AGENT_CLI_PATH` to the absolute path of the `lamaste-agent` script the timer should run.

With a token — non-interactive, and the token stays out of the process list:

```bash
LAMALIBRE_LAMASTE_ENROLLMENT_TOKEN=<token> \
  lamaste-agent setup --label build-server --panel-url https://203.0.113.42:9292
```

With a P12 certificate — interactive; it asks for the panel URL, the `.p12` path and its password:

```bash
lamaste-agent setup --label build-server
```

Setup pins the panel's TLS public key on first contact (trust on first use) and prints it — compare it with the value shown in the panel before continuing. It then downloads and verifies Chisel, fetches the agent's chisel credential straight into a 0600 file, records the enrolled domain, starts the tunnel client if the agent already carries tunnels, and installs the sync timer.

## 3. Linux servers and VMs: survive reboot

The Chisel client and the sync timer are systemd **user** units. Without _lingering_, a user's units only run while that user has a login session — a headless machine loses its tunnels at every reboot until someone logs in. Setup and `lamaste-agent status` report this; enable it once:

```bash
sudo loginctl enable-linger "$USER"
```

`lamaste-agent status` then shows `At boot: starts without login (linger enabled)`. macOS LaunchAgents start at login by design and need nothing here.

## 4. Carry tunnels

An administrator creates a tunnel and names the agent that carries it (**Tunnels → Add Tunnel → Agent**, or `agentLabel` in `POST /api/tunnels` — see the [Tunnels API](../04-api-reference/tunnels.md)). The relay starts accepting that port from this agent immediately, and the agent's sync timer starts forwarding it within about 30 seconds. Nothing has to be run on the agent.

The same holds for every other change: a tunnel deleted, disabled, re-enabled, or moved to or from this agent on the panel is applied by the next sync. To apply a change at once, run:

```bash
lamaste-agent update
```

An agent with no tunnels keeps its Chisel client **stopped** — Chisel cannot run without at least one remote — and starts it automatically once a tunnel is assigned.

## How tunnel changes reach the agent

### In Plain English

The relay only lets an agent open the ports of the enabled tunnels it carries, and Chisel is strict about it: if an agent asks for even one port it is no longer allowed, the relay rejects the agent's **whole** connection. So when a tunnel is disabled or moved away, the agent has to stop asking for it quickly — otherwise all of its other tunnels go dark too. A small timer on the agent checks with the panel every 30 seconds and adjusts the tunnel client when something changed.

### The sync timer

`lamaste-agent sync --label <label>` fetches the agent's configuration (`GET /api/tunnels/agent-config`) and converges the local tunnel client with it:

1. The relay URL must be `https://tunnel.<enrolled domain>:443`; a panel reporting another domain is refused.
2. The chisel credential is current — a credential rotated by an administrator is fetched again (see [Credentials](#credentials)).
3. The Chisel binary is the pinned release.
4. The service definition lists exactly the tunnels the relay grants this agent.
5. The client runs when there is something to carry, and is stopped when the agent carries no tunnel or the operator stopped it.

When everything already matches, a run costs one panel request and changes nothing. The timer runs it:

| Platform | Units                                                                                        | Schedule                                                      |
| -------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Linux    | `lamalibre-lamaste-sync-<label>.service` (oneshot) and `.timer` in `~/.config/systemd/user/` | 5 s after the timer starts, then 30 s after each run finishes |
| macOS    | LaunchAgent `com.lamalibre.lamaste.sync-<label>` in `~/Library/LaunchAgents/`                | At load, then every 30 s (`StartInterval`)                    |

The timer logs quietly to `~/.lamalibre/lamaste/agents/<label>/logs/sync.log`: only runs that changed something, a warning when it first appears, and an error when it first appears and again once it clears — a failure or warning repeated every 30 seconds is logged once. The outcome of the last run is kept in `sync-state.json` in the agent directory, and `lamaste-agent status` shows it on its **Sync** line (for example `every 30s, last ok <time> (2 tunnel(s))`, or `failing since <time>: <error>`). A last run more than 2 minutes old is flagged — the timer is not running its program — with the advice to run `lamaste-agent update`.

The timer runs `<node> <installed lamaste-agent script> sync --label <label> --quiet` with absolute paths. For Node.js it records a stable path — when a `node` on `PATH` resolves to the running binary (e.g. `/opt/homebrew/bin/node` rather than Homebrew's versioned `Cellar/node/<version>/bin/node`), that path is used — so upgrading Node.js does not silently stop the timer. After moving the agent to another Node.js installation, run `lamaste-agent update` to rewrite the timer.

Setup, `update`, `sync`, the agent panel and the agent daemon all change the same service and `config.json`, possibly at the same moment. They serialize on a per-agent lock file, `~/.lamalibre/lamaste/agents/<label>/agent.lock`, which records the owner's PID, boot and start time. A lock left behind by a crash — its process gone, from an earlier boot, or older than 15 minutes — is taken over automatically.

`lamaste-agent update` applies the panel's view now, restarts the tunnel client, and (re)installs the sync timer — which is also how an agent set up before the timer existed gets one.

### Stopping tunnels on purpose

Stopping the tunnels from the agent panel or the desktop app is remembered (`tunnelsStopped` in the agent's `config.json`), so the timer keeps them stopped. **Start** and **Restart** clear it and converge with the panel again.

## Credentials

Each agent authenticates to the relay with its own chisel credential, stored in `chisel.json` (0600) and handed to the service through a 0600 file — never a process argument.

- **Rotated by an administrator.** The panel's agent configuration carries `chiselCredentialIssuedAt`, the time the agent's current credential was issued. When it differs from the stored one, the next sync fetches the new credential and restarts the client; `lamaste-agent chisel refresh-credential` does the same immediately.
- **Upgraded agents rotate once.** Agents set up before this version kept the credential in process arguments and 0644 unit files, where any local user could read it. On its first sync after the upgrade, such an agent replaces its credential through `POST /api/agents/me/chisel-credential/rotate`. If the relay refuses (it allows one self-rotation per 10 minutes, or it has not been upgraded yet), the agent keeps its current credential and tries again on the next sync. Agents enrolled with this version never need the rotation: their credential went straight from enrollment into a 0600 file.

## Upgrading

Upgrade agents **before** the server. Agents from before this version reject the new shape of the relay's Chisel arguments; a current agent works against an older server, keeping its credential until the server offers rotation.

```bash
npm install -g @lamalibre/lamaste-agent
lamaste-agent update
```

`update` installs the sync timer on an agent that was set up without one. An agent originally set up with `npx` must be installed globally first.

## Everyday commands

```bash
lamaste-agent status                 # health, boot persistence, sync timer, carried tunnels
lamaste-agent logs                   # follow the Chisel log
lamaste-agent sync                   # converge with the panel once (what the timer runs)
lamaste-agent update                 # apply the panel's view now, restart, (re)install the timer
lamaste-agent chisel refresh-credential   # fetch a rotated credential now instead of at the next sync
lamaste-agent list                   # agents configured on this machine
lamaste-agent switch <label>         # change the default agent
lamaste-agent uninstall --label <l>  # stop and remove one agent, including its sync timer
```

## Troubleshooting

| Symptom                                                     | Cause and fix                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup` says the agent must be installed globally           | It was run through `npx`. Run `npm install -g @lamalibre/lamaste-agent`, then `lamaste-agent setup ...` again. The enrollment token was not spent.                                                                              |
| Log shows a TLS / x509 error                                | `tunnel.<domain>` does not present a valid certificate for its name. Check the relay's certificate (`Certificates` page) and that the agent's clock is correct.                                                                 |
| Log shows authentication failed                             | The credential was rotated on the panel. The next sync picks it up; `lamaste-agent chisel refresh-credential` applies it now.                                                                                                   |
| Log shows `access denied` for a remote                      | The relay no longer grants this agent that port: the tunnel was disabled, deleted, or moved to another agent. The next sync drops it. If it persists, check `lamaste-agent status` — the sync timer may not be running.         |
| `status` shows `Sync: not installed`                        | The agent was set up before the timer existed. Install globally, then run `lamaste-agent update`.                                                                                                                               |
| `status` shows `Sync: last ran ... not running its program` | The timer's last run is over 2 minutes old: the timer was unloaded, or the program it runs is gone (Node.js or the agent was moved or uninstalled). Run `lamaste-agent update` from the global install to rewrite it.           |
| `status` shows `Sync: failing since ...`                    | The error is the last sync's. `The panel reports domain X, but this agent is enrolled with Y` means the panel moved to another domain: re-enroll the agent. Otherwise check the panel is reachable. Details in `logs/sync.log`. |
| Tunnels do not start although the agent carries some        | The tunnels were stopped from the agent panel or desktop app, and the timer respects that. Start them there.                                                                                                                    |
| Tunnel works until reboot                                   | Lingering is off. See step 3.                                                                                                                                                                                                   |
| New tunnel returns 502                                      | The agent has not synced yet (up to ~30 s), or nothing listens on `127.0.0.1:<port>` on the agent. Run `lamaste-agent update` to apply at once.                                                                                 |
| Upload fails with 413                                       | The request is larger than the tunnel's body limit. Raise **Largest request body** on the tunnel (`maxBodySizeMb`).                                                                                                             |

## For Developers

The agent-side logic lives in `packages/core/lib/src/agent/` and is shared by the CLI (`lamaste-agent`) and the agent daemon (`lamaste-agentd`):

- `converge.ts` — `convergeChiselService(label, agentConfigResponse, panelCalls, { forceRestart })`, the one refresh path of `setup`, `update`, `sync`, `chisel refresh-credential`, the agent panel and the daemon. Returns the resulting state (`running`, `idle` for no tunnels, `stopped` by the operator).
- `chisel-service.ts` — renders the service definition. `parseChiselArgs` validates the panel's `chiselArgs` (`['client', <serverUrl>, ...R:127.0.0.1:<p>:127.0.0.1:<p>]`) and discards a legacy `--tls-skip-verify` from older panels; `assertRelayServerUrl` pins the server URL to the enrolled domain. The stored credential is always combined in, so no refresh path can drop authentication.
- `sync-service.ts` — the sync timer (`installSyncService`, `removeSyncService`), `resolveInstalledAgentCli` (the global-install check, stable Node.js path) and `sync-state.json` (`isSyncStale`).
- `agent-lock.ts` — `withAgentLock(label, fn)`, the per-agent cross-process lock (`agents/<label>/agent.lock`) that every operation touching the service or `config.json` takes; `updateAgentConfig` in `converge.ts` is the locked read-modify-write for `config.json`.
- `chisel-binary.ts` + `../chisel-download.ts` — the pinned, checksum-verified Chisel download (`CHISEL_RELEASE` in `constants.ts`).
